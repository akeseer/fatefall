import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { IntentModel, fnv1a32, normalizeText, featurize } from '../src/ai/IntentModel';
import { understand, parseDMCommandRegex } from '../src/ai/DMCommandParser';
import { INTENTS, intentAllowed, type DMContext, type DMIntent } from '../src/ai/DMCommand';

const root = resolve(__dirname, '..');
const modelPath = resolve(root, 'public/models/dm-intent-v1.bin');
const fixture = (name: string) => resolve(root, 'tests/fixtures', name);

function loadModel(): IntentModel {
  const buf = readFileSync(modelPath);
  // Copy out of Node's pooled Buffer so byteOffset is 0 and typed-array views line up.
  return IntentModel.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function readJsonl<T>(name: string): T[] {
  return readFileSync(fixture(name), 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

describe('featurizer', () => {
  it('hashes with FNV-1a as the Python side does', () => {
    // Reference values for the 32-bit FNV-1a of these ASCII strings.
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  it('normalises case, quotes, punctuation and whitespace', () => {
    expect(normalizeText('  GO   North!  ')).toBe('go north');
    expect(normalizeText('what’s in the “pack”?')).toBe("what's in the pack");
    expect(normalizeText('rename Kael to Xarthax-the-Bold')).toBe('rename kael to xarthax-the-bold');
    expect(normalizeText('')).toBe('');
  });

  it('produces an L2-normalised sparse vector', () => {
    const ctx: DMContext = { featureKind: null, inCombat: false, mode: 'dungeon' };
    const f = featurize('go north', ctx);
    expect(f.size).toBeGreaterThan(10);
    const norm = Math.sqrt([...f.values()].reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
    // Context is part of the vector, so the same words in a different room differ.
    const other = featurize('go north', { ...ctx, mode: 'town' });
    expect([...other.keys()].sort().join()).not.toBe([...f.keys()].sort().join());
  });
});

const hasModel = existsSync(modelPath);
const describeModel = hasModel ? describe : describe.skip;

describeModel('IntentModel', () => {
  const model = loadModel();
  const ctx = (over: Partial<DMContext> = {}): DMContext => ({ featureKind: null, inCombat: false, mode: 'dungeon', ...over });

  it('loads a well-formed weights file that matches the intent list', () => {
    expect(model.version).toBe(1);
    expect(model.intents.length).toBe(INTENTS.length);
    expect([...model.intents]).toEqual([...INTENTS]);
    expect(model.buckets & (model.buckets - 1)).toBe(0);
    expect(model.threshold).toBeGreaterThan(0);
    expect(model.threshold).toBeLessThanOrEqual(1);
  });

  it('rejects a file with the wrong magic', () => {
    const bad = new Uint8Array(64);
    expect(() => IntentModel.fromBuffer(bad.buffer)).toThrow(/magic/);
  });

  it('returns a probability distribution and never picks a gated-out intent', () => {
    const probs = model.probabilities('pray at the altar', ctx({ featureKind: 'vault' }));
    const sum = [...probs].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    const picked = model.predict('pray at the altar', ctx({ featureKind: 'vault' })).intent;
    expect(intentAllowed(picked, ctx({ featureKind: 'vault' }))).toBe(true);
    for (let i = 0; i < probs.length; i++) {
      if (!intentAllowed(model.intents[i], ctx({ featureKind: 'vault' }))) expect(probs[i]).toBe(0);
    }
  });

  it('matches the Python featurizer bucket for bucket', () => {
    const rows = JSON.parse(readFileSync(fixture('featurizer-parity.json'), 'utf-8')) as {
      text: string; ctx: { featureKind: string | null; inCombat: boolean; mode: string }; features: [number, number][];
    }[];
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) {
      const mine = featurize(row.text, row.ctx as DMContext, model.buckets);
      const got = [...mine.entries()].sort((a, b) => a[0] - b[0]);
      expect(got.length, `bucket count for ${JSON.stringify(row.text)}`).toBe(row.features.length);
      for (let i = 0; i < got.length; i++) {
        expect(got[i][0], `bucket for ${JSON.stringify(row.text)}`).toBe(row.features[i][0]);
        expect(got[i][1]).toBeCloseTo(row.features[i][1], 6);
      }
    }
  });

  it('matches the Python forward pass to within 1e-4', () => {
    const rows = JSON.parse(readFileSync(fixture('logits-parity.json'), 'utf-8')) as {
      text: string; ctx: DMContext; logits: number[];
    }[];
    let worst = 0;
    for (const row of rows) {
      const mine = model.forward(row.text, row.ctx);
      expect(mine.length).toBe(row.logits.length);
      for (let i = 0; i < mine.length; i++) worst = Math.max(worst, Math.abs(mine[i] - row.logits[i]));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('is fast enough to run on every keystroke', () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) model.predict('have everyone head north quietly', ctx());
    const perCall = (performance.now() - start) / 200;
    expect(perCall).toBeLessThan(5);
  });
});

describeModel('understand() with the trained model', () => {
  const model = loadModel();

  /**
   * Places where the model deliberately disagrees with the regex and is right.
   * The canonical labels come from the regex, which has known ordering quirks;
   * each entry here has been reviewed by hand and says why the model wins.
   */
  const REVIEWED_IMPROVEMENTS: Record<string, DMIntent> = {
    // On the surface, "descend into the dungeon" means go in, not take stairs.
    'descend into the dungeon': 'enter_dungeon',
    // In a chokepoint room this is the barricade order; the regex reads "hold" as pause.
    'hold the line': 'feature_chokepoint',
    // The regex's "look" branch claims "examine" before room features get a turn.
    'examine the ritual circle': 'feature_ritual',
  };

  it('does not quietly change what the documented orders mean', () => {
    const rows = readJsonl<{ text: string; ctx: DMContext; intent: DMIntent }>('canonical.jsonl');
    expect(rows.length).toBeGreaterThan(300);
    const changed: string[] = [];
    for (const row of rows) {
      const got = understand(row.text, row.ctx, model).cmd.intent;
      if (got === row.intent) continue;
      if (REVIEWED_IMPROVEMENTS[row.text] === got) continue;
      changed.push(`${JSON.stringify(row.text)}: regex ${row.intent} -> model ${got}`);
    }
    expect(changed, `canonical phrases changed meaning:\n${changed.join('\n')}`).toEqual([]);
  });

  it('understands paraphrases the regex cannot', () => {
    const rows = readJsonl<{ text: string; ctx: DMContext; intent: DMIntent; note?: string }>('dm-golden.jsonl');
    expect(rows.length).toBeGreaterThan(100);

    const wrong: string[] = [];
    for (const row of rows) {
      const got = understand(row.text, row.ctx, model).cmd;
      if (got.intent !== row.intent) wrong.push(`${JSON.stringify(row.text)}: want ${row.intent}, got ${got.intent}`);
    }
    const accuracy = 1 - wrong.length / rows.length;
    expect(accuracy, `golden-set accuracy ${(accuracy * 100).toFixed(1)}%:\n${wrong.join('\n')}`).toBeGreaterThanOrEqual(0.9);

    // The regex alone should do markedly worse — that is the point of the model.
    const regexRight = rows.filter(r => parseDMCommandRegex(r.text, r.ctx).intent === r.intent).length;
    expect(regexRight / rows.length).toBeLessThan(accuracy);
  });

  it('fills the slots the dispatcher needs', () => {
    const rows = readJsonl<{ text: string; ctx: DMContext; intent: DMIntent; slots?: Record<string, unknown> }>('dm-golden.jsonl');
    const wrong: string[] = [];
    let checked = 0;
    for (const row of rows) {
      if (!row.slots) continue;
      const got = understand(row.text, row.ctx, model).cmd as Record<string, unknown>;
      // A wrong intent is an intent failure, counted by the test above; this
      // test is only about how well the arguments are pulled out.
      if (got.intent !== row.intent) continue;
      checked++;
      for (const [k, want] of Object.entries(row.slots)) {
        if (got[k] !== want) wrong.push(`${JSON.stringify(row.text)}: ${k} want ${JSON.stringify(want)}, got ${JSON.stringify(got[k])}`);
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('does not invent orders out of chatter', () => {
    const rows = readJsonl<{ text: string; ctx: DMContext; intent: DMIntent }>('dm-golden.jsonl')
      .filter(r => r.intent === 'unknown');
    expect(rows.length).toBeGreaterThanOrEqual(15);
    const fired = rows.filter(r => understand(r.text, r.ctx, model).cmd.intent !== 'unknown');
    // A little over-eagerness is tolerable; acting on most chatter is not.
    expect(fired.length / rows.length, `acted on: ${fired.map(r => JSON.stringify(r.text)).join(', ')}`).toBeLessThanOrEqual(0.25);
  });
});

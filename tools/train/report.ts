/**
 * Score the shipped model on the acceptance sets and print a summary.
 *
 *   npm run model-report
 *
 * Reports what the player actually experiences: the answer understand() gives,
 * with the regex fallback in place, not the raw classifier accuracy.
 */
import { readFileSync } from 'node:fs';
import { IntentModel } from '../../src/ai/IntentModel';
import { understand, parseDMCommandRegex } from '../../src/ai/DMCommandParser';
import type { DMContext, DMIntent } from '../../src/ai/DMCommand';

const buf = readFileSync('public/models/dm-intent-v1.bin');
const model = IntentModel.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

type Row = { text: string; ctx: DMContext; intent: DMIntent; slots?: Record<string, unknown> };
const read = (p: string): Row[] => readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const golden = read('tests/fixtures/dm-golden.jsonl');
const canonical = read('tests/fixtures/canonical.jsonl');

const score = (rows: Row[], useModel: boolean) => {
  let right = 0;
  for (const r of rows) if (understand(r.text, r.ctx, useModel ? model : null).cmd.intent === r.intent) right++;
  return right / rows.length;
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const chatter = golden.filter(r => r.intent === 'unknown');
const orders = golden.filter(r => r.intent !== 'unknown');

console.log(`DM intent model v${model.version}`);
console.log(`  ${model.intents.length} intents · ${model.buckets} buckets · ${model.hidden} hidden units · ${(buf.length / 1024).toFixed(0)} KB on disk`);
console.log(`  accepts a reading at ${pct(model.threshold)} confidence, temperature ${model.temperature}\n`);

console.log('Hand-written orders (tests/fixtures/dm-golden.jsonl)');
console.log(`  regex only        ${pct(score(golden, false))}`);
console.log(`  with the model    ${pct(score(golden, true))}`);
console.log(`  real orders only  ${pct(score(orders, true))}   (${orders.length} orders)`);
console.log(`  chatter ignored   ${pct(score(chatter, true))}   (${chatter.length} lines of table talk)\n`);

console.log('Documented orders (tests/fixtures/canonical.jsonl)');
console.log(`  regex only        ${pct(score(canonical, false))}`);
console.log(`  with the model    ${pct(score(canonical, true))}   (differences are reviewed in tests/intent-model.test.ts)\n`);

const start = performance.now();
const N = 2000;
for (let i = 0; i < N; i++) model.predict(golden[i % golden.length].text, golden[i % golden.length].ctx);
console.log(`Speed: ${((performance.now() - start) / N * 1000).toFixed(0)} microseconds per order\n`);

const missed = orders.filter(r => understand(r.text, r.ctx, model).cmd.intent !== r.intent);
if (missed.length) {
  console.log(`Still misread (${missed.length}):`);
  for (const r of missed) {
    console.log(`  ${JSON.stringify(r.text)}  want ${r.intent}, got ${understand(r.text, r.ctx, model).cmd.intent}`);
  }
}
const fired = chatter.filter(r => understand(r.text, r.ctx, model).cmd.intent !== 'unknown');
if (fired.length) {
  console.log(`\nChatter acted on (${fired.length}):`);
  for (const r of fired) {
    const got = understand(r.text, r.ctx, model);
    console.log(`  ${JSON.stringify(r.text)} -> ${got.cmd.intent} (via ${got.source})`);
  }
}
void parseDMCommandRegex;

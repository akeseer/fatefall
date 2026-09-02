/**
 * The DM intent model — a small, self-trained classifier that reads a
 * free-form order and names the intent behind it.
 *
 * Architecture: hashed bag of word unigrams, word bigrams and character
 * 1–3-grams (plus a few context tokens) → 8192-bucket sparse vector →
 * ReLU hidden layer → one logit per `DMIntent`. Trained in Python
 * (tools/train), exported as a single binary blob, and run here with plain
 * TypeScript. Zero dependencies, ~14k multiply-adds per query.
 *
 * The featurizer below MUST stay equivalent to tools/train/featurizer.py;
 * tests/fixtures/featurizer-parity.json guards that.
 */

import { DMContext, DMIntent, INTENTS, intentAllowed } from './DMCommand';
import type { IntentPrediction, IntentPredictor } from './DMCommandParser';

export const MODEL_MAGIC = 'DMI1';
export const DEFAULT_BUCKETS = 8192;
const CHAR_NGRAMS = [1, 2, 3];

// ── Featurizer ───────────────────────────────────────────────────────────────

const QUOTES: Record<string, string> = {
  '‘': "'", '’': "'", 'ʼ': "'", '“': '"', '”': '"',
};

export function normalizeText(text: string): string {
  let s = text.normalize('NFC').toLowerCase();
  s = s.replace(/[‘’ʼ“”]/g, ch => QUOTES[ch]);
  s = s.replace(/[^a-z0-9' +\-]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const utf8 = new TextEncoder();

/** 32-bit FNV-1a over the UTF-8 bytes of `s`. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  const bytes = utf8.encode(s);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The raw feature strings, in the same order the Python side emits them. */
export function featureStrings(text: string, ctx: DMContext): string[] {
  const norm = normalizeText(text);
  const toks = norm ? norm.split(' ') : [];
  const out: string[] = [];
  for (const t of toks) out.push('w:' + t);
  for (let i = 0; i + 1 < toks.length; i++) out.push('b:' + toks[i] + '_' + toks[i + 1]);
  for (const t of toks) {
    const padded = '<' + t + '>';
    for (const n of CHAR_NGRAMS) {
      for (let i = 0; i + n <= padded.length; i++) out.push('c:' + padded.slice(i, i + n));
    }
  }
  out.push('x:feat=' + (ctx.featureKind ?? 'none'));
  out.push('x:combat=' + (ctx.inCombat ? '1' : '0'));
  out.push('x:mode=' + ctx.mode);
  return out;
}

/** Sparse, L2-normalised bucket → weight map. */
export function featurize(text: string, ctx: DMContext, buckets: number = DEFAULT_BUCKETS): Map<number, number> {
  const counts = new Map<number, number>();
  for (const f of featureStrings(text, ctx)) {
    const b = fnv1a32(f) & (buckets - 1);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  let sq = 0;
  for (const v of counts.values()) sq += v * v;
  const norm = Math.sqrt(sq);
  if (norm > 0) for (const [k, v] of counts) counts.set(k, v / norm);
  return counts;
}

// ── Weights file ─────────────────────────────────────────────────────────────

interface TensorMeta {
  name: string;
  dtype: 'i8' | 'f32';
  shape: number[];
  /** Byte offset from the start of the tensor section. */
  offset: number;
  bytes: number;
}

export interface ModelHeader {
  version: number;
  buckets: number;
  hidden: number;
  intents: string[];
  temperature: number;
  threshold: number;
  tensors: TensorMeta[];
  trainedAt?: string;
  devAccuracy?: number;
}

function readHeader(buf: ArrayBuffer): { header: ModelHeader; tensorStart: number } {
  const view = new DataView(buf);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== MODEL_MAGIC) throw new Error(`IntentModel: bad magic "${magic}"`);
  const len = view.getUint32(4, true);
  const json = new TextDecoder().decode(new Uint8Array(buf, 8, len));
  const header = JSON.parse(json) as ModelHeader;
  const tensorStart = (8 + len + 3) & ~3; // 4-byte aligned
  return { header, tensorStart };
}

// ── The model ────────────────────────────────────────────────────────────────

export class IntentModel implements IntentPredictor {
  readonly version: number;
  readonly buckets: number;
  readonly hidden: number;
  readonly intents: readonly DMIntent[];
  readonly temperature: number;
  readonly threshold: number;
  readonly header: ModelHeader;

  private readonly w1: Int8Array;      // [buckets, hidden]
  private readonly w1Scale: Float32Array; // [buckets]
  private readonly b1: Float32Array;   // [hidden]
  private readonly w2: Int8Array;      // [hidden, classes]
  private readonly w2Scale: Float32Array; // [hidden]
  private readonly b2: Float32Array;   // [classes]
  private readonly hiddenBuf: Float32Array;

  private constructor(header: ModelHeader, buf: ArrayBuffer, tensorStart: number) {
    this.header = header;
    this.version = header.version;
    this.buckets = header.buckets;
    this.hidden = header.hidden;
    this.temperature = header.temperature || 1;
    this.threshold = header.threshold ?? 0.6;
    this.intents = header.intents as DMIntent[];

    if (this.intents.length !== INTENTS.length || this.intents.some((x, i) => x !== INTENTS[i])) {
      throw new Error('IntentModel: intent list in the weights file does not match DMCommand.INTENTS');
    }
    if ((this.buckets & (this.buckets - 1)) !== 0) throw new Error('IntentModel: buckets must be a power of two');

    const tensor = (name: string) => {
      const t = header.tensors.find(x => x.name === name);
      if (!t) throw new Error(`IntentModel: missing tensor ${name}`);
      const start = tensorStart + t.offset;
      if (t.dtype === 'i8') return new Int8Array(buf, start, t.bytes);
      return new Float32Array(buf.slice(start, start + t.bytes));
    };
    this.w1 = tensor('W1') as Int8Array;
    this.w1Scale = tensor('W1_scale') as Float32Array;
    this.b1 = tensor('b1') as Float32Array;
    this.w2 = tensor('W2') as Int8Array;
    this.w2Scale = tensor('W2_scale') as Float32Array;
    this.b2 = tensor('b2') as Float32Array;

    const C = this.intents.length;
    if (this.w1.length !== this.buckets * this.hidden) throw new Error('IntentModel: W1 shape mismatch');
    if (this.w2.length !== this.hidden * C) throw new Error('IntentModel: W2 shape mismatch');
    if (this.b2.length !== C) throw new Error('IntentModel: b2 shape mismatch');
    this.hiddenBuf = new Float32Array(this.hidden);
  }

  static fromBuffer(buf: ArrayBuffer): IntentModel {
    const { header, tensorStart } = readHeader(buf);
    return new IntentModel(header, buf, tensorStart);
  }

  static async load(url: string): Promise<IntentModel> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`IntentModel: fetch ${url} → ${res.status}`);
    return IntentModel.fromBuffer(await res.arrayBuffer());
  }

  /** Raw logits for every intent (no gating, no temperature). */
  forward(text: string, ctx: DMContext): Float32Array {
    const H = this.hidden;
    const C = this.intents.length;
    const h = this.hiddenBuf;
    h.set(this.b1);
    for (const [bucket, weight] of featurize(text, ctx, this.buckets)) {
      const s = this.w1Scale[bucket] * weight;
      const row = bucket * H;
      for (let j = 0; j < H; j++) h[j] += s * this.w1[row + j];
    }
    const logits = new Float32Array(C);
    logits.set(this.b2);
    for (let j = 0; j < H; j++) {
      const a = h[j] > 0 ? h[j] : 0;
      if (a === 0) continue;
      const s = a * this.w2Scale[j];
      const row = j * C;
      for (let c = 0; c < C; c++) logits[c] += s * this.w2[row + c];
    }
    return logits;
  }

  /** Calibrated probabilities with context-invalid intents masked out. */
  probabilities(text: string, ctx: DMContext): Float32Array {
    const logits = this.forward(text, ctx);
    const C = logits.length;
    let max = -Infinity;
    for (let c = 0; c < C; c++) {
      if (!intentAllowed(this.intents[c], ctx)) logits[c] = -1e9;
      else logits[c] /= this.temperature;
      if (logits[c] > max) max = logits[c];
    }
    let sum = 0;
    const probs = new Float32Array(C);
    for (let c = 0; c < C; c++) {
      probs[c] = logits[c] <= -1e8 ? 0 : Math.exp(logits[c] - max);
      sum += probs[c];
    }
    for (let c = 0; c < C; c++) probs[c] /= sum;
    return probs;
  }

  predict(text: string, ctx: DMContext): IntentPrediction {
    const probs = this.probabilities(text, ctx);
    let best = 0;
    let second = -1;
    for (let c = 1; c < probs.length; c++) {
      if (probs[c] > probs[best]) { second = best; best = c; }
      else if (second < 0 || probs[c] > probs[second]) second = c;
    }
    const prob = probs[best];
    const margin = prob - (second >= 0 ? probs[second] : 0);
    return { intent: this.intents[best], prob, margin };
  }

  /** Top-k intents with probabilities, for debugging and the status readout. */
  topK(text: string, ctx: DMContext, k = 3): { intent: DMIntent; prob: number }[] {
    const probs = this.probabilities(text, ctx);
    return Array.from(probs)
      .map((p, i) => ({ intent: this.intents[i], prob: p }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, k);
  }
}

// ── Loading and the player's preference ──────────────────────────────────────

/** Weights live beside the built app, so this works in dev and in dist/. */
export function modelUrl(): string {
  const base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL('models/dm-intent-v1.bin', base).href;
}

const PREF_KEY = 'fatefall.dmModel';

/** The model is on unless the player turned it off; storage may be unavailable. */
export function intentModelEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setIntentModelEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode or storage disabled — the setting just won't persist */
  }
}

/**
 * Fetch and parse the weights. Never throws: a missing or corrupt file leaves
 * the game on the regex parser, which understands every documented order.
 */
export async function loadIntentModel(): Promise<IntentModel | null> {
  try {
    return await IntentModel.load(modelUrl());
  } catch (err) {
    console.warn('[DM] intent model unavailable — falling back to the regex parser.', err);
    return null;
  }
}

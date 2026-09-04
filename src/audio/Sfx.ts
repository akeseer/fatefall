/**
 * The sound effects: every event in the game that deserves a sound, voiced
 * from oscillators and filtered noise through the shared engine.
 *
 * Each effect is a few lines of synthesis with a comment saying what it is
 * meant to sound like, because that is the only spec there is. The register
 * is chiptune with a little body — square and triangle leads, sine thumps,
 * bandpassed noise for anything that cracks or hisses — which suits pixel
 * art and, more practically, is what a handful of oscillators can do well.
 *
 * Nothing here ever throws or blocks. Every effect checks that the engine is
 * audible first and returns quietly if it is not, so a browser without audio
 * and a muted game both behave exactly as the game did before it had sound.
 *
 * Effects that can fire in bursts — a hit per sword, a coin per pickup — are
 * rate-limited per kind, since twelve identical thuds in one frame is noise
 * in the bad sense.
 */

import { getAudio } from './Audio';

/** The least time between two plays of the same effect, in seconds. */
const MIN_GAP_S = 0.045;

const lastPlayed = new Map<string, number>();

/** True if this effect may play now; records the play if so. */
function gate(key: string): boolean {
  const a = getAudio();
  if (!a.audible || !a.ctx()) return false;
  const t = a.now();
  const last = lastPlayed.get(key) ?? -1;
  if (t - last < MIN_GAP_S) return false;
  lastPlayed.set(key, t);
  return true;
}

/** An oscillator with an amplitude envelope, wired to the effects bus. */
function tone(
  type: OscillatorType,
  freqFrom: number,
  freqTo: number | null,
  at: number,
  dur: number,
  peak: number,
  opts: { attack?: number; lowpass?: number; sweep?: 'exp' | 'lin' } = {},
): void {
  const a = getAudio();
  const c = a.ctx();
  const bus = a.sfx;
  if (!c || !bus) return;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freqFrom, at);
  if (freqTo !== null) {
    if (opts.sweep === 'lin') osc.frequency.linearRampToValueAtTime(freqTo, at + dur);
    else osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), at + dur);
  }
  const g = c.createGain();
  const attack = opts.attack ?? 0.008;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let out: AudioNode = osc;
  if (opts.lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opts.lowpass;
    osc.connect(lp);
    out = lp;
  }
  out.connect(g);
  g.connect(bus);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** A burst of the shared noise through a filter, with an envelope. */
function hiss(
  filter: BiquadFilterType,
  freq: number,
  at: number,
  dur: number,
  peak: number,
  q = 1,
): void {
  const a = getAudio();
  const c = a.ctx();
  const bus = a.sfx;
  const buf = a.noise;
  if (!c || !bus || !buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f);
  f.connect(g);
  g.connect(bus);
  src.start(at);
  src.stop(at + dur + 0.02);
}

const now = () => getAudio().now();

export const sfx = {
  // ── Blows ──

  /** A weapon landing: a short low thump under a slap of noise. */
  hit(): void {
    if (!gate('hit')) return;
    const t = now();
    tone('sine', 180, 70, t, 0.11, 0.42);
    hiss('bandpass', 1800, t, 0.05, 0.22, 0.8);
  },

  /** A critical: the thump, a bright crack, and a ringing second knock. */
  crit(): void {
    if (!gate('crit')) return;
    const t = now();
    tone('sine', 220, 50, t, 0.2, 0.6);
    hiss('highpass', 1200, t, 0.08, 0.4);
    tone('triangle', 660, 330, t + 0.07, 0.16, 0.22);
  },

  /** One of the party taking a hit: duller and lower than a blow landing on a foe. */
  hurt(): void {
    if (!gate('hurt')) return;
    const t = now();
    tone('sine', 140, 55, t, 0.14, 0.4);
    hiss('lowpass', 900, t, 0.06, 0.18);
  },

  /** Something dying: a tone falling away with the air going out of it. */
  slain(): void {
    if (!gate('slain')) return;
    const t = now();
    tone('sawtooth', 320, 40, t, 0.34, 0.2, { lowpass: 1400 });
    hiss('lowpass', 600, t + 0.05, 0.25, 0.16);
  },

  /** A hero going down: a slow drum and a low held note that does not resolve. */
  down(): void {
    if (!gate('down')) return;
    const t = now();
    tone('sine', 90, 40, t, 0.45, 0.5);
    tone('triangle', 196, 196, t + 0.12, 0.6, 0.12, { attack: 0.05 });
  },

  // ── Magic ──

  /** Fire: a roar of low noise with a rising crackle over it. */
  fire(): void {
    if (!gate('fire')) return;
    const t = now();
    hiss('lowpass', 500, t, 0.35, 0.3);
    hiss('bandpass', 2400, t + 0.04, 0.22, 0.14, 2);
    tone('sawtooth', 110, 60, t, 0.3, 0.16, { lowpass: 700 });
  },

  /** Lightning: a snap, then a bright zap sweeping down. */
  shock(): void {
    if (!gate('shock')) return;
    const t = now();
    hiss('highpass', 3000, t, 0.06, 0.45);
    tone('square', 1800, 220, t + 0.02, 0.18, 0.14, { lowpass: 3200 });
    tone('sine', 60, 40, t + 0.03, 0.2, 0.3);
  },

  /** Arcane force: a shimmer rising through a fifth, with a sparkle on top. */
  arcane(): void {
    if (!gate('arcane')) return;
    const t = now();
    tone('triangle', 440, 660, t, 0.28, 0.16, { sweep: 'lin' });
    tone('sine', 880, 1320, t + 0.06, 0.24, 0.1, { sweep: 'lin' });
    hiss('highpass', 6000, t + 0.1, 0.2, 0.06);
  },

  /** Healing: a soft rising chime in a major third. */
  heal(): void {
    if (!gate('heal')) return;
    const t = now();
    tone('sine', 523, 523, t, 0.22, 0.14, { attack: 0.02 });
    tone('sine', 659, 659, t + 0.09, 0.24, 0.14, { attack: 0.02 });
    tone('sine', 784, 784, t + 0.18, 0.4, 0.12, { attack: 0.02 });
  },

  /** A spell leaving the caster's hands: a short whoosh that precedes the impact. */
  cast(): void {
    if (!gate('cast')) return;
    const t = now();
    hiss('bandpass', 900, t, 0.16, 0.12, 1.2);
    tone('sine', 300, 900, t, 0.14, 0.08, { sweep: 'exp' });
  },

  // ── Fortune ──

  /** A level: a rising four-note figure, brighter than the heal. */
  levelUp(): void {
    if (!gate('levelUp')) return;
    const t = now();
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone('square', f, f, t + i * 0.11, 0.16 + (i === 3 ? 0.3 : 0), 0.13, { lowpass: 2800 }));
    tone('triangle', 262, 262, t + 0.33, 0.5, 0.08, { attack: 0.04 });
  },

  /** Coin: two quick clinks a fourth apart. */
  gold(): void {
    if (!gate('gold')) return;
    const t = now();
    tone('sine', 1760, 1760, t, 0.07, 0.14);
    tone('sine', 2349, 2349, t + 0.05, 0.12, 0.12);
    hiss('highpass', 7000, t, 0.04, 0.05);
  },

  /** A chest opening: the latch, then a shimmer over what is inside. */
  chest(): void {
    if (!gate('chest')) return;
    const t = now();
    tone('square', 220, 160, t, 0.06, 0.16, { lowpass: 1200 });
    hiss('bandpass', 1400, t + 0.02, 0.05, 0.14, 1.5);
    for (let i = 0; i < 4; i++) tone('sine', 1047 + i * 262, 1047 + i * 262, t + 0.12 + i * 0.06, 0.18, 0.07);
  },

  /** Drinking a potion: a glassy blip and a swallow. */
  potion(): void {
    if (!gate('potion')) return;
    const t = now();
    tone('sine', 900, 1400, t, 0.08, 0.12, { sweep: 'lin' });
    tone('sine', 400, 300, t + 0.12, 0.1, 0.1);
  },

  /** Reading a scroll: a paper rustle and a low arcane hum. */
  scroll(): void {
    if (!gate('scroll')) return;
    const t = now();
    hiss('bandpass', 3200, t, 0.12, 0.1, 0.7);
    tone('triangle', 196, 262, t + 0.08, 0.3, 0.08, { attack: 0.06, sweep: 'lin' });
  },

  // ── Places ──

  /** Going down the stairs: three descending steps of stone. */
  descend(): void {
    if (!gate('descend')) return;
    const t = now();
    for (let i = 0; i < 3; i++) {
      tone('sine', 220 - i * 40, 120 - i * 25, t + i * 0.14, 0.12, 0.3);
      hiss('lowpass', 800, t + i * 0.14, 0.06, 0.12);
    }
  },

  /** Coming up into daylight: the same steps, rising. */
  ascend(): void {
    if (!gate('ascend')) return;
    const t = now();
    for (let i = 0; i < 3; i++) {
      tone('sine', 140 + i * 40, 200 + i * 45, t + i * 0.14, 0.12, 0.26);
      hiss('lowpass', 800, t + i * 0.14, 0.06, 0.1);
    }
  },

  /** Arriving in town: a warm two-note figure, like a door opening onto an inn. */
  town(): void {
    if (!gate('town')) return;
    const t = now();
    tone('triangle', 392, 392, t, 0.18, 0.14, { attack: 0.02 });
    tone('triangle', 523, 523, t + 0.14, 0.32, 0.14, { attack: 0.02 });
    tone('sine', 262, 262, t + 0.14, 0.4, 0.07, { attack: 0.05 });
  },

  /** Setting out on the road: a short breath of wind. */
  depart(): void {
    if (!gate('depart')) return;
    const t = now();
    hiss('bandpass', 700, t, 0.4, 0.1, 0.6);
  },

  /** A cut to black: a soft downward whoosh under the fade. */
  fade(): void {
    if (!gate('fade')) return;
    const t = now();
    hiss('lowpass', 1200, t, 0.3, 0.1);
    tone('sine', 200, 90, t, 0.3, 0.06);
  },

  /** A fight beginning: a two-hit sting as the blinds close. */
  battle(): void {
    if (!gate('battle')) return;
    const t = now();
    tone('sawtooth', 110, 110, t, 0.14, 0.26, { lowpass: 900 });
    hiss('lowpass', 1500, t, 0.08, 0.3);
    tone('sawtooth', 147, 147, t + 0.17, 0.32, 0.28, { lowpass: 900 });
    hiss('lowpass', 1500, t + 0.17, 0.1, 0.32);
    tone('square', 587, 587, t + 0.17, 0.3, 0.06, { lowpass: 1800 });
  },

  /** The DM giving an order: a quill tick, so the prompt answers the keyboard. */
  order(): void {
    if (!gate('order')) return;
    const t = now();
    tone('triangle', 1200, 900, t, 0.05, 0.1);
  },

  /** A refused order or a mistake: a flat low buzz. */
  refuse(): void {
    if (!gate('refuse')) return;
    const t = now();
    tone('square', 140, 120, t, 0.16, 0.12, { lowpass: 600 });
  },

  /** A menu or button: a tiny blip. */
  click(): void {
    if (!gate('click')) return;
    const t = now();
    tone('square', 880, 880, t, 0.04, 0.07, { lowpass: 2400 });
  },
};

export type SfxName = keyof typeof sfx;

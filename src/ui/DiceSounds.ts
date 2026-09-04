/**
 * Dice sound layer — pure Web Audio synthesis, no assets.
 *
 * Subscribes to the dice event bus and voices every roll:
 *  - soft tick for ordinary rolls (pitch follows the die size)
 *  - a sharp crack + low thump for natural 20s (crits)
 *  - a sad, descending thud for natural 1s (fumbles)
 *
 * This was the first sound in the game and used to own its own AudioContext.
 * It is a client of the shared engine now — one context for the page, the
 * effects bus, the shared noise buffer, and the single mute — and keeps only
 * the voices that are its own.
 */

import { DiceRollEvent, DiceType, onDiceRoll } from '../rules/DiceEvents';
import { getAudio } from '../audio/Audio';

/** Higher-pitched clicks for smaller dice, deeper knocks for bigger ones. */
const TICK_FREQ: Record<DiceType, number> = {
  d4: 1250,
  d6: 1050,
  d8: 880,
  d10: 740,
  d12: 620,
  d20: 520,
  d100: 780,
};

const TICK_MIN_GAP = 0.035; // seconds — don't stack ticks from rapid-fire events

export class DiceSounds {
  private lastTick = 0;

  constructor() {
    onDiceRoll((e) => this.onRoll(e));
  }

  /** The shared context, or null when the engine is unavailable or muted. */
  private get ctx(): AudioContext | null {
    const a = getAudio();
    return a.audible ? a.ctx() : null;
  }
  private get master(): GainNode | null { return getAudio().sfx; }
  private get noise(): AudioBuffer | null { return getAudio().noise; }

  private ensureCtx(): AudioContext | null {
    return this.ctx;
  }

  private onRoll(e: DiceRollEvent) {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;

    if (e.outcome === 'crit') this.crack();
    else if (e.outcome === 'fumble') this.thud();
    else this.tick(e.diceType);
  }

  /** Soft click: a bandpassed noise burst + a tiny triangle knock. */
  private tick(type: DiceType) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (now - this.lastTick < TICK_MIN_GAP) return;
    this.lastTick = now;

    const freq = TICK_FREQ[type] ?? 520;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noise!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * 2.4;
    bp.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.14, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(this.master!);
    noise.start(now);
    noise.stop(now + 0.06);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.11, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
    osc.connect(og);
    og.connect(this.master!);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  /** Bigger crack: a bright noise burst on top of a falling low thump. */
  private crack() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(160, now);
    thump.frequency.exponentialRampToValueAtTime(52, now + 0.18);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.5, now);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    thump.connect(tg);
    tg.connect(this.master!);
    thump.start(now);
    thump.stop(now + 0.25);

    const snap = ctx.createBufferSource();
    snap.buffer = this.noise!;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.38, now);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    snap.connect(hp);
    hp.connect(sg);
    sg.connect(this.master!);
    snap.start(now);
    snap.stop(now + 0.1);

    // A second, ringing knock a beat later — "the die bounced twice".
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(320, now + 0.09);
    ring.frequency.exponentialRampToValueAtTime(140, now + 0.22);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, now + 0.09);
    rg.gain.exponentialRampToValueAtTime(0.16, now + 0.11);
    rg.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    ring.connect(rg);
    rg.connect(this.master!);
    ring.start(now + 0.09);
    ring.stop(now + 0.27);
  }

  /** Sad thud: a long, descending moan with a dull second knock. */
  private thud() {
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    const moan = ctx.createOscillator();
    moan.type = 'sine';
    moan.frequency.setValueAtTime(120, now);
    moan.frequency.exponentialRampToValueAtTime(45, now + 0.38);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(0.42, now);
    mg.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    moan.connect(mg);
    mg.connect(this.master!);
    moan.start(now);
    moan.stop(now + 0.45);

    const knock = ctx.createOscillator();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(85, now + 0.06);
    knock.frequency.exponentialRampToValueAtTime(58, now + 0.14);
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.0001, now + 0.06);
    kg.gain.exponentialRampToValueAtTime(0.2, now + 0.08);
    kg.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    knock.connect(kg);
    kg.connect(this.master!);
    knock.start(now + 0.06);
    knock.stop(now + 0.26);
  }

  /**
   * Victory fanfare: a bright rising fanfare (classic I–IV–V–I arpeggio)
   * with a shimmering noise swell underneath — the sound of triumph.
   */
  victoryFanfare() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;

    const now = ctx.currentTime;
    // Bright square-wave lead over a soft triangle bass, in C major.
    const notes: { freq: number; at: number; dur: number; gain: number }[] = [
      { freq: 523.25, at: 0.0,  dur: 0.16, gain: 0.16 },  // C5
      { freq: 523.25, at: 0.18, dur: 0.10, gain: 0.13 },  // C5 (repeated pick-up)
      { freq: 659.25, at: 0.34, dur: 0.14, gain: 0.15 },  // E5
      { freq: 783.99, at: 0.54, dur: 0.20, gain: 0.17 },  // G5
      { freq: 1046.5, at: 0.80, dur: 0.45, gain: 0.20 },  // C6 (held)
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(n.freq, now + n.at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + n.at);
      g.gain.exponentialRampToValueAtTime(n.gain, now + n.at + 0.015);
      g.gain.setValueAtTime(n.gain, now + n.at + n.dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur);
      // A lowpass keeps the square wave's buzz tame and leaves it warm.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2600;
      osc.connect(lp); lp.connect(g); g.connect(this.master!);
      osc.start(now + n.at);
      osc.stop(now + n.at + n.dur + 0.02);
    }
    // Chord swell underneath the final held note — the "ta-da!" body.
    for (const f of [261.63, 329.63, 392.0]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + 0.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + 0.8);
      g.gain.exponentialRampToValueAtTime(0.08, now + 0.86);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
      osc.connect(g); g.connect(this.master!);
      osc.start(now + 0.8);
      osc.stop(now + 1.55);
    }
    // Shimmer: a gentle highpassed noise swell riding the whole fanfare.
    const shimmer = ctx.createBufferSource();
    shimmer.buffer = this.noise!;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5500;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(0.035, now + 0.5);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    shimmer.connect(hp); hp.connect(sg); sg.connect(this.master!);
    shimmer.start(now);
    shimmer.stop(now + 1.45);
  }

  /** Defeat sting: a slow, descending minor phrase — the sound of loss. */
  defeatSting() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;

    const now = ctx.currentTime;
    const notes: { freq: number; at: number; dur: number; gain: number }[] = [
      { freq: 392.0,  at: 0.0,  dur: 0.3, gain: 0.13 },  // G4
      { freq: 311.13, at: 0.32, dur: 0.3, gain: 0.12 },  // Eb4
      { freq: 261.63, at: 0.64, dur: 0.6, gain: 0.12 },  // C4 (held, unresolved)
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.freq, now + n.at);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + n.at);
      g.gain.exponentialRampToValueAtTime(n.gain, now + n.at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur);
      osc.connect(g); g.connect(this.master!);
      osc.start(now + n.at);
      osc.stop(now + n.at + n.dur + 0.02);
    }
  }
}

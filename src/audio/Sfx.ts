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

  // ── The rest of the spellbook ──

  /** Cold: a glassy high shimmer that cracks at the end, like ice taking. */
  cold(): void {
    if (!gate('cold')) return;
    const t = now();
    tone('sine', 1800, 2600, t, 0.22, 0.09, { sweep: 'lin', attack: 0.03 });
    tone('triangle', 900, 1300, t + 0.04, 0.2, 0.06, { sweep: 'lin' });
    hiss('highpass', 5000, t + 0.18, 0.08, 0.16);
    tone('square', 2400, 1800, t + 0.2, 0.05, 0.05, { lowpass: 5000 });
  },

  /** Thunder: a deep slam and a long rumble that rolls away. */
  thunder(): void {
    if (!gate('thunder')) return;
    const t = now();
    tone('sine', 70, 35, t, 0.5, 0.55);
    hiss('lowpass', 220, t, 0.7, 0.32);
    hiss('bandpass', 700, t + 0.05, 0.25, 0.14, 0.6);
  },

  /** Necrotic: a falling groan with the air sucked out of it. */
  necrotic(): void {
    if (!gate('necrotic')) return;
    const t = now();
    tone('sawtooth', 240, 60, t, 0.45, 0.14, { lowpass: 900 });
    tone('sine', 480, 120, t + 0.05, 0.4, 0.08);
    hiss('lowpass', 400, t + 0.1, 0.35, 0.1);
  },

  /** Radiant: a bright choir chord swelling and gone. */
  radiant(): void {
    if (!gate('radiant')) return;
    const t = now();
    for (const [f, d] of [[523, 0], [659, 0.02], [784, 0.04], [1047, 0.06]] as [number, number][]) {
      tone('triangle', f, f, t + d, 0.5, 0.07, { attack: 0.08, lowpass: 3000 });
    }
    hiss('highpass', 6000, t + 0.05, 0.3, 0.05);
  },

  /** Psychic: a warbling tone bending upward, wrong on purpose. */
  psychic(): void {
    if (!gate('psychic')) return;
    const t = now();
    tone('sine', 300, 900, t, 0.3, 0.1, { sweep: 'lin' });
    tone('sine', 310, 870, t + 0.03, 0.3, 0.08, { sweep: 'lin' });
    tone('triangle', 1200, 600, t + 0.15, 0.2, 0.05);
  },

  /** Poison: a wet bubbling in a low band. */
  poison(): void {
    if (!gate('poison')) return;
    const t = now();
    for (let i = 0; i < 5; i++) tone('sine', 220 + i * 37, 180 + i * 30, t + i * 0.055, 0.07, 0.09);
    hiss('bandpass', 500, t, 0.32, 0.1, 1.5);
  },

  /** Acid: a hiss that eats downward. */
  acid(): void {
    if (!gate('acid')) return;
    const t = now();
    hiss('bandpass', 3000, t, 0.3, 0.16, 0.8);
    tone('sawtooth', 700, 200, t + 0.05, 0.28, 0.06, { lowpass: 1500 });
  },

  /** Force: a hard blue snap with a ring behind it. */
  force(): void {
    if (!gate('force')) return;
    const t = now();
    tone('square', 900, 700, t, 0.06, 0.12, { lowpass: 3000 });
    tone('sine', 1400, 1400, t + 0.03, 0.22, 0.08, { attack: 0.005 });
    hiss('highpass', 4000, t, 0.05, 0.1);
  },

  /** A bolt leaving the hand and crossing the field. */
  bolt(): void {
    if (!gate('bolt')) return;
    const t = now();
    tone('sine', 500, 1600, t, 0.16, 0.09, { sweep: 'exp' });
    hiss('bandpass', 1500, t, 0.14, 0.08, 1.2);
  },

  /** Magic missile: three darts, each a rising pip. */
  darts(): void {
    if (!gate('darts')) return;
    const t = now();
    for (let i = 0; i < 3; i++) tone('triangle', 800 + i * 120, 1500 + i * 150, t + i * 0.09, 0.09, 0.08, { sweep: 'exp' });
  },

  /** A swing that finds nothing: a whoosh of air and no landing. */
  miss(): void {
    if (!gate('miss')) return;
    const t = now();
    hiss('bandpass', 1100, t, 0.18, 0.12, 0.9);
    tone('sine', 400, 250, t, 0.14, 0.04);
  },

  /** A ward going up: a rising fifth that holds. */
  shield(): void {
    if (!gate('shield')) return;
    const t = now();
    tone('triangle', 440, 440, t, 0.3, 0.09, { attack: 0.02 });
    tone('triangle', 660, 660, t + 0.06, 0.34, 0.09, { attack: 0.02 });
    hiss('highpass', 5000, t + 0.02, 0.12, 0.05);
  },

  /** A blessing: soft rising motes. */
  bless(): void {
    if (!gate('bless')) return;
    const t = now();
    [784, 988, 1175, 1568].forEach((f, i) => tone('sine', f, f, t + i * 0.08, 0.3, 0.07, { attack: 0.03 }));
  },

  /** Haste: a quick upward zip. */
  haste(): void {
    if (!gate('haste')) return;
    const t = now();
    tone('square', 400, 2400, t, 0.18, 0.07, { sweep: 'exp', lowpass: 4000 });
    hiss('highpass', 3000, t + 0.05, 0.1, 0.06);
  },

  /** Rage: a low roar under a snarl. */
  rage(): void {
    if (!gate('rage')) return;
    const t = now();
    tone('sawtooth', 90, 130, t, 0.4, 0.2, { lowpass: 600, sweep: 'lin' });
    hiss('lowpass', 700, t, 0.35, 0.22);
    tone('square', 180, 150, t + 0.1, 0.25, 0.06, { lowpass: 900 });
  },

  /** Second wind: a breath in, and a heartbeat. */
  secondWind(): void {
    if (!gate('secondWind')) return;
    const t = now();
    hiss('lowpass', 900, t, 0.3, 0.1);
    tone('sine', 80, 80, t + 0.25, 0.1, 0.3);
    tone('sine', 80, 80, t + 0.4, 0.1, 0.22);
  },

  /** A mark laid on a quarry: a click and a held note. */
  mark(): void {
    if (!gate('mark')) return;
    const t = now();
    tone('square', 1400, 1400, t, 0.03, 0.08, { lowpass: 3000 });
    tone('sine', 660, 660, t + 0.04, 0.3, 0.06, { attack: 0.02 });
  },

  /** A sneak attack: a quick draw and a wet knife. */
  sneak(): void {
    if (!gate('sneak')) return;
    const t = now();
    hiss('highpass', 4000, t, 0.06, 0.14);
    tone('sine', 900, 300, t + 0.05, 0.1, 0.12);
    hiss('bandpass', 1200, t + 0.08, 0.08, 0.14, 1.2);
  },

  /** A flurry: three fast slaps. */
  flurry(): void {
    if (!gate('flurry')) return;
    const t = now();
    for (let i = 0; i < 3; i++) {
      hiss('bandpass', 1800, t + i * 0.07, 0.04, 0.16, 0.8);
      tone('sine', 220, 120, t + i * 0.07, 0.06, 0.2);
    }
  },

  /** A condition landing: a sour two-note fall. */
  afflict(): void {
    if (!gate('afflict')) return;
    const t = now();
    tone('triangle', 520, 520, t, 0.12, 0.09);
    tone('triangle', 390, 370, t + 0.12, 0.22, 0.09);
  },

  /** Sleep: a slow sigh downward. */
  sleep(): void {
    if (!gate('sleep')) return;
    const t = now();
    tone('sine', 660, 330, t, 0.6, 0.07, { sweep: 'exp', attack: 0.1 });
    hiss('lowpass', 500, t, 0.5, 0.06);
  },

  /** A legendary foe stirring: a gong. */
  legendary(): void {
    if (!gate('legendary')) return;
    const t = now();
    tone('sine', 110, 110, t, 1.2, 0.35, { attack: 0.01 });
    tone('sine', 165, 165, t, 1.0, 0.18, { attack: 0.01 });
    tone('triangle', 330, 320, t, 0.8, 0.08, { attack: 0.01 });
    hiss('bandpass', 900, t, 0.1, 0.2, 0.5);
  },

  /** A dragon's breath or a beast's roar: noise with a throat in it. */
  roar(): void {
    if (!gate('roar')) return;
    const t = now();
    tone('sawtooth', 120, 80, t, 0.5, 0.18, { lowpass: 500, sweep: 'lin' });
    hiss('lowpass', 900, t, 0.5, 0.26);
    hiss('bandpass', 2200, t + 0.1, 0.3, 0.1, 1.5);
  },

  /** A foe dissolving: a downward crackle into nothing. */
  dissolve(): void {
    if (!gate('dissolve')) return;
    const t = now();
    hiss('bandpass', 2400, t, 0.4, 0.14, 1.2);
    tone('sawtooth', 400, 60, t, 0.45, 0.1, { lowpass: 1200 });
  },

  // ── The rest of the spell list ──

  /** A blink out of the world and back: a whoosh reversed onto itself. */
  blink(): void {
    if (!gate('blink')) return;
    const t = now();
    tone('sine', 1200, 300, t, 0.14, 0.1, { sweep: 'exp' });
    hiss('bandpass', 2000, t, 0.1, 0.1, 1.2);
    tone('sine', 300, 1400, t + 0.16, 0.14, 0.1, { sweep: 'exp' });
    hiss('highpass', 5000, t + 0.2, 0.08, 0.08);
  },

  /** A spiritual weapon landing: a bell-bright clang. */
  hammer(): void {
    if (!gate('hammer')) return;
    const t = now();
    tone('square', 620, 590, t, 0.25, 0.1, { lowpass: 2600 });
    tone('sine', 1240, 1240, t, 0.4, 0.09, { attack: 0.003 });
    hiss('highpass', 3500, t, 0.06, 0.18);
    tone('sine', 90, 60, t, 0.14, 0.24);
  },

  /** A whip of thorns: a crack and the hiss of the lash. */
  lash(): void {
    if (!gate('lash')) return;
    const t = now();
    hiss('bandpass', 2600, t, 0.12, 0.1, 1.0);
    hiss('highpass', 4000, t + 0.1, 0.04, 0.3);
    tone('sine', 700, 200, t + 0.1, 0.1, 0.12);
  },

  /** Small magic: a tinkle of three high notes. */
  sparkle(): void {
    if (!gate('sparkle')) return;
    const t = now();
    [2093, 2637, 3136].forEach((f, i) => tone('sine', f, f, t + i * 0.06, 0.16, 0.06));
  },

  /** A spell unmade: a rising tone cut off, and the air closing. */
  counter(): void {
    if (!gate('counter')) return;
    const t = now();
    tone('sawtooth', 400, 1600, t, 0.18, 0.08, { sweep: 'exp', lowpass: 2500 });
    hiss('bandpass', 1200, t + 0.16, 0.06, 0.2, 0.8);
    tone('sine', 220, 110, t + 0.2, 0.2, 0.1);
  },

  /** Vicious mockery: a jeer with a buzz in it. */
  mock(): void {
    if (!gate('mock')) return;
    const t = now();
    tone('square', 330, 260, t, 0.12, 0.07, { lowpass: 1600 });
    tone('square', 392, 300, t + 0.11, 0.16, 0.07, { lowpass: 1600 });
    tone('sine', 900, 1300, t + 0.02, 0.2, 0.05, { sweep: 'lin' });
  },

  /** Webs and vines: something sticky spreading. */
  web(): void {
    if (!gate('web')) return;
    const t = now();
    hiss('bandpass', 700, t, 0.3, 0.12, 2);
    for (let i = 0; i < 4; i++) tone('sine', 500 - i * 60, 380 - i * 60, t + i * 0.06, 0.1, 0.06);
  },

  /** A pattern that bends the mind: a slow warble. */
  warble(): void {
    if (!gate('warble')) return;
    const t = now();
    tone('sine', 440, 520, t, 0.25, 0.09, { sweep: 'lin', attack: 0.03 });
    tone('sine', 520, 440, t + 0.25, 0.25, 0.09, { sweep: 'lin' });
    tone('triangle', 1100, 900, t + 0.1, 0.4, 0.04, { sweep: 'lin' });
  },

  /** A wall of force going up: a hum that stays. */
  wall(): void {
    if (!gate('wall')) return;
    const t = now();
    tone('triangle', 110, 110, t, 0.9, 0.12, { attack: 0.08 });
    tone('sine', 220, 220, t + 0.05, 0.8, 0.07, { attack: 0.08 });
    hiss('highpass', 6000, t, 0.1, 0.06);
  },

  /** An ice storm: hail on stone under a rumble. */
  storm(): void {
    if (!gate('storm')) return;
    const t = now();
    for (let i = 0; i < 7; i++) hiss('highpass', 4000 + i * 300, t + i * 0.05, 0.05, 0.12);
    tone('sine', 80, 45, t, 0.5, 0.3);
    hiss('lowpass', 300, t, 0.5, 0.2);
  },

  /** A curse or an enchantment coming undone: a fizzle downward. */
  fizzle(): void {
    if (!gate('fizzle')) return;
    const t = now();
    hiss('bandpass', 3000, t, 0.3, 0.1, 1.5);
    tone('triangle', 800, 200, t, 0.3, 0.06, { sweep: 'exp' });
  },

  /** Quiet holy or druidic magic: a low chord under breath. */
  chant(): void {
    if (!gate('chant')) return;
    const t = now();
    tone('sine', 262, 262, t, 0.5, 0.06, { attack: 0.08 });
    tone('sine', 392, 392, t + 0.03, 0.5, 0.05, { attack: 0.08 });
    hiss('lowpass', 900, t, 0.4, 0.05);
  },

  /** Rolling flames: a longer roar than a single bolt. */
  flames(): void {
    if (!gate('flames')) return;
    const t = now();
    hiss('lowpass', 600, t, 0.55, 0.3);
    hiss('bandpass', 2200, t + 0.05, 0.4, 0.12, 2);
    tone('sawtooth', 100, 70, t, 0.5, 0.14, { lowpass: 700 });
  },

  /** A menu or button: a tiny blip. */
  click(): void {
    if (!gate('click')) return;
    const t = now();
    tone('square', 880, 880, t, 0.04, 0.07, { lowpass: 2400 });
  },
};

export type SfxName = keyof typeof sfx;

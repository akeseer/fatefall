/**
 * The music: one piece per mood, played by a scheduler that keeps a little
 * ahead of the audio clock, and crossfaded when the mood changes.
 *
 * Like the effects, every note here is an oscillator or a burst of filtered
 * noise on the shared engine. There are no recordings and no loops of
 * recordings; a piece is a chord progression, a bass pattern, a pad and a
 * pool of lead phrases, and the notes are made as they are needed.
 *
 * ── The scheduler ──
 *
 * Web Audio plays a note at the time it is told to, but it has to be told
 * before that time comes, and a JavaScript timer is not reliable enough to
 * be told exactly on the beat. So the classic shape: a timer wakes every few
 * milliseconds and places every note that falls within a short window ahead
 * of `ctx.currentTime`, then goes back to sleep. Notes are placed on the
 * audio clock, never on wall time, which is what keeps the tempo steady.
 *
 * A hidden tab throttles timers to once a second, and the engine reports
 * itself inaudible there anyway, so the scheduler simply stops placing notes
 * while `audible` is false. On return it re-anchors the next note a hair
 * after the clock and carries on from the step it was at. The same
 * re-anchoring handles a timer that came late for any other reason: a step
 * whose time has already passed by more than a step is moved forward rather
 * than being played instantly alongside everything that came after it, so
 * there is never a pile-up.
 *
 * ── The crossfade ──
 *
 * A mood change does not cut. The piece that is playing keeps scheduling
 * while its output gain ramps to zero, and the new piece begins at zero and
 * ramps up over the same span, so for two seconds both are running. Once the
 * old piece's ramp has landed it stops scheduling, every voice it still owns
 * is stopped and disconnected, and its gain node goes with them. Each piece
 * therefore has its own gain node under the music bus, and the class holds a
 * set of live performances rather than a single current one.
 *
 * ── Variation ──
 *
 * The lead picks a phrase per bar from the piece's pool. The pick is a small
 * hash of the bar number, so a piece is deterministic from the moment it
 * starts but does not repeat itself every pass of the progression, and a
 * quiet bar is chosen the same way. Nothing here uses `Math.random`.
 *
 * ── Never in the way ──
 *
 * Nothing in this file throws past its own boundary. A scheduler tick that
 * fails tears the music down and stays quiet; a missing engine is treated as
 * silence. The game does not know or care whether the music is playing.
 */

import { getAudio } from './Audio';

export type MusicMood = 'title' | 'overworld' | 'overworld_night' | 'town' | 'dungeon' | 'battle' | 'boss' | 'none';

// ── Tunables ──

/** How often the scheduler wakes. Short enough that a late tick still lands inside the lookahead. */
const TICK_MS = 25;

/** How far ahead of the clock notes are placed. Long enough to ride out a late tick; short enough that a mood change is felt promptly. */
const LOOKAHEAD_S = 0.12;

/** The crossfade between moods, and the fade of a stop. Two seconds is long enough to be a dissolve rather than a cut. */
const CROSSFADE_S = 2.0;

/** How long after its fade a piece is torn down: the last release has to finish under the closed gain. */
const TEARDOWN_GRACE_S = 0.25;

/** The gap left before the next note when the scheduler resumes, so nothing is placed in the past. */
const RESUME_GAP_S = 0.05;

/** How often the scheduler asks the engine to resume a context that is not running, instead of every tick. */
const RESUME_POLL_S = 1.0;

/** Vibrato on the leads that have it: a slow wobble that arrives after the attack, as a player would add it. */
const VIBRATO_HZ = 5.5;
const VIBRATO_RISE_S = 0.25;

/** The kick: a sine dropping through its own pitch. The fall is what reads as a drum. */
const KICK_FROM_HZ = 150;
const KICK_TO_HZ = 45;
const KICK_S = 0.16;

/** The hat: the top of the noise, closed or open. */
const HAT_HZ = 7500;
const CLOSED_HAT_S = 0.03;
const OPEN_HAT_S = 0.12;

/** The snare: a band of noise with a short knock inside it. */
const SNARE_HZ = 1800;
const SNARE_S = 0.1;

/** A drip, for the dungeon: a high sine falling an octave. One in this many steps. */
const DRIP_ONE_IN = 22;

// ── Theory: pure, and tested ──

export const MAJOR: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
export const AEOLIAN: readonly number[] = [0, 2, 3, 5, 7, 8, 10];
export const PHRYGIAN: readonly number[] = [0, 1, 3, 5, 7, 8, 10];

/** Semitones above the key root of a scale degree; degrees outside 0..6 wrap through octaves. */
export function scaleNote(scale: readonly number[], degree: number): number {
  const oct = Math.floor(degree / 7);
  const i = ((degree % 7) + 7) % 7;
  return scale[i] + 12 * oct;
}

/** The triad (or seventh) built on a degree, as semitones above the key root. */
export function chordTones(scale: readonly number[], degree: number, seventh = false): number[] {
  const tones = [scaleNote(scale, degree), scaleNote(scale, degree + 2), scaleNote(scale, degree + 4)];
  if (seventh) tones.push(scaleNote(scale, degree + 6));
  return tones;
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** A small integer hash of a bar number under a seed: the whole of the music's "randomness". */
export function barHash(seed: number, bar: number): number {
  let h = (seed ^ Math.imul(bar + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Which phrase a bar plays: hashed from the bar, and never the phrase the
 * previous bar played, so a two-bar stutter cannot happen. Returns -1 for a
 * bar that rests, decided by the pool's density.
 */
export function choosePhrase(seed: number, bar: number, poolSize: number, density: number, previous: number): number {
  if (poolSize === 0) return -1;
  const h = barHash(seed, bar);
  if ((h >>> 8) % 1000 >= density * 1000) return -1;
  let i = h % poolSize;
  if (i === previous && poolSize > 1) i = (i + 1) % poolSize;
  return i;
}

// ── Pieces ──

/** A note of the lead, relative to the bar and the chord: [step, length in steps, scale degree above the chord root, semitone accidental]. */
type Phrase = readonly (readonly [number, number, number, number?])[];

/** A note of the bass: [step, length, semitones above the chord root, or the third of the chord, or a step towards the next chord]. */
type BassNote = readonly [number, number, number | 'third' | 'approach'];

export interface Piece {
  /** Seeds the phrase hash so two pieces on the same bar do not make the same choice. */
  seed: number;
  bpm: number;
  stepsPerBeat: number;
  beatsPerBar: number;
  /** MIDI note of the key root; the registers below are offsets from it. */
  root: number;
  scale: readonly number[];
  /** One scale degree per bar; the chord is the triad on it. */
  progression: readonly number[];
  bass: {
    type: OscillatorType;
    octave: number;
    gain: number;
    lowpass: number;
    pattern: readonly BassNote[];
  };
  lead: {
    type: OscillatorType;
    octave: number;
    gain: number;
    lowpass: number;
    attack: number;
    /** Vibrato depth in cents; zero leaves the wobble out entirely. */
    vibrato: number;
    /** The share of bars that carry a phrase at all. */
    density: number;
    phrases: readonly Phrase[];
    /** What the last bar of the progression plays instead, so it lands. */
    cadence: readonly Phrase[];
  };
  pad: {
    type: OscillatorType;
    octave: number;
    gain: number;
    lowpass: number;
    attack: number;
    /** The two oscillators of each pad note sit this many cents either side of true. */
    detune: number;
    sevenths: boolean;
  };
  drums?: {
    kick: readonly number[];
    snare: readonly number[];
    hat: readonly number[];
    openHat: readonly number[];
    gain: number;
  };
  /** Water. */
  drip?: boolean;
}

/**
 * Overworld: bright, travelling. C major, a walking bass under a triangle
 * lead, and a brush of hat on the off-beats so the road keeps moving.
 */
const OVERWORLD: Piece = {
  seed: 0x0a11,
  bpm: 116,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  root: 48,
  scale: MAJOR,
  //           I  V  vi IV   I  V  ii V   vi IV I  V   IV V  I  I
  progression: [0, 4, 5, 3, 0, 4, 1, 4, 5, 3, 0, 4, 3, 4, 0, 0],
  bass: {
    type: 'sine',
    octave: 0,
    gain: 0.16,
    lowpass: 600,
    pattern: [[0, 4, 0], [4, 4, 'third'], [8, 4, 7], [12, 4, 'approach']],
  },
  lead: {
    type: 'triangle',
    octave: 24,
    gain: 0.12,
    lowpass: 3200,
    attack: 0.012,
    vibrato: 10,
    density: 0.85,
    phrases: [
      [[0, 2, 0], [2, 2, 2], [4, 4, 4], [8, 2, 4], [10, 2, 5], [12, 4, 7]],
      [[0, 4, 4], [4, 2, 2], [6, 2, 0], [8, 4, 2], [12, 4, 4]],
      [[0, 2, 7], [2, 2, 6], [4, 2, 5], [6, 2, 4], [8, 4, 2], [12, 4, 0]],
      [[0, 6, 2], [6, 2, 4], [8, 4, 7], [12, 2, 6], [14, 2, 4]],
      [[0, 4, 0], [4, 4, 4], [8, 8, 2]],
      [[2, 2, 0], [4, 2, 2], [6, 2, 4], [8, 8, 7]],
      [[0, 3, 4], [3, 3, 2], [6, 2, 4], [8, 4, 5], [12, 4, 4]],
    ],
    cadence: [
      [[0, 4, 4], [4, 4, 2], [8, 8, 0]],
      [[0, 2, 2], [2, 2, 1], [4, 4, 0], [8, 8, 0]],
    ],
  },
  pad: { type: 'triangle', octave: 12, gain: 0.035, lowpass: 1800, attack: 0.08, detune: 5, sevenths: false },
  drums: { kick: [0, 8], snare: [], hat: [2, 6, 10, 14], openHat: [], gain: 0.6 },
};

/**
 * Overworld at night: the same progression in the relative minor. The
 * degrees are the overworld's read over A aeolian, which is exactly what a
 * shift to the relative minor is; slowed, softened, and the lead mostly rests.
 */
const OVERWORLD_NIGHT: Piece = {
  ...OVERWORLD,
  seed: 0x0a12,
  bpm: 80,
  root: 45,
  scale: AEOLIAN,
  bass: {
    type: 'sine',
    octave: 0,
    gain: 0.13,
    lowpass: 500,
    pattern: [[0, 8, 0], [8, 8, 7]],
  },
  lead: {
    type: 'sine',
    octave: 24,
    gain: 0.09,
    lowpass: 2400,
    attack: 0.05,
    vibrato: 8,
    density: 0.45,
    phrases: [
      [[0, 8, 4], [8, 8, 2]],
      [[4, 4, 0], [8, 8, 7]],
      [[0, 12, 2]],
      [[8, 4, 4], [12, 4, 5]],
      [[0, 6, 7], [6, 10, 4]],
      [[2, 6, 2], [8, 8, 0]],
    ],
    cadence: [[[0, 8, 2], [8, 8, 0]]],
  },
  pad: { type: 'triangle', octave: 12, gain: 0.03, lowpass: 1200, attack: 0.4, detune: 6, sevenths: false },
  drums: undefined,
};

/**
 * Town: warm and gentle, a lilting 6/8. G major with sevenths in the pad, a
 * bass that rocks between the root and the fifth, no drums at all.
 */
const TOWN: Piece = {
  seed: 0x70a1,
  bpm: 172,
  stepsPerBeat: 2,
  beatsPerBar: 6,
  root: 55,
  scale: MAJOR,
  //           I  IV I  V   I  IV ii V   vi iii IV I   ii V  I  I
  progression: [0, 3, 0, 4, 0, 3, 1, 4, 5, 2, 3, 0, 1, 4, 0, 0],
  bass: {
    type: 'sine',
    octave: -12,
    gain: 0.15,
    lowpass: 500,
    pattern: [[0, 5, 0], [6, 5, 7]],
  },
  lead: {
    type: 'triangle',
    octave: 12,
    gain: 0.11,
    lowpass: 2400,
    attack: 0.03,
    vibrato: 9,
    density: 0.8,
    phrases: [
      [[0, 4, 0], [4, 2, 2], [6, 4, 4], [10, 2, 2]],
      [[0, 2, 4], [2, 2, 2], [4, 2, 0], [6, 6, 2]],
      [[0, 6, 2], [6, 2, 4], [8, 2, 5], [10, 2, 4]],
      [[0, 4, 7], [4, 2, 6], [6, 4, 4], [10, 2, 2]],
      [[0, 2, 0], [2, 2, 2], [4, 2, 4], [6, 2, 7], [8, 4, 4]],
      [[0, 12, 4]],
      [[0, 4, 2], [4, 2, 4], [6, 4, 2], [10, 2, 0]],
    ],
    cadence: [[[0, 6, 2], [6, 6, 0]], [[0, 4, 4], [4, 2, 2], [6, 6, 0]]],
  },
  pad: { type: 'triangle', octave: 0, gain: 0.03, lowpass: 1600, attack: 0.2, detune: 6, sevenths: true },
};

/**
 * Dungeon: slow, low, and mostly pad. D phrygian, so the second degree is a
 * semitone above the root and never resolves; the bass is a drone, the lead
 * a note or two a bar, and water drips somewhere.
 */
const DUNGEON: Piece = {
  seed: 0xd0d0,
  bpm: 60,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  root: 50,
  scale: PHRYGIAN,
  //           i  i  VI v°  i  iv II i   VI III II v°  i  iv II i
  progression: [0, 0, 5, 4, 0, 3, 1, 0, 5, 2, 1, 4, 0, 3, 1, 0],
  bass: {
    type: 'triangle',
    octave: -12,
    gain: 0.16,
    lowpass: 400,
    pattern: [[0, 16, 0]],
  },
  lead: {
    type: 'sine',
    octave: 12,
    gain: 0.08,
    lowpass: 2000,
    attack: 0.08,
    vibrato: 0,
    density: 0.4,
    phrases: [
      [[0, 12, 0]],
      [[4, 8, 1]],
      [[0, 6, 4], [8, 8, 4, -1]],
      [[8, 8, 2]],
      [[0, 4, 7], [4, 12, 6]],
      [[6, 10, 1]],
      [[0, 4, 4], [4, 4, 2], [8, 8, 1]],
    ],
    cadence: [[[0, 16, 0]], [[0, 8, 1], [8, 8, 0]]],
  },
  pad: { type: 'sawtooth', octave: 0, gain: 0.03, lowpass: 520, attack: 1.2, detune: 7, sevenths: false },
  drip: true,
};

/**
 * Battle: driving. E aeolian at a run, a triangle bass pulsing in eighths,
 * a square lead under a lowpass, and a kick, hat and snare to push it.
 */
const BATTLE: Piece = {
  seed: 0xba77,
  bpm: 152,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  root: 52,
  scale: AEOLIAN,
  //           i  i  VI VII i  i  iv v   VI VII i  i   iv VI VII i
  progression: [0, 0, 5, 6, 0, 0, 3, 4, 5, 6, 0, 0, 3, 5, 6, 0],
  bass: {
    type: 'triangle',
    octave: -12,
    gain: 0.17,
    lowpass: 700,
    pattern: [[0, 2, 0], [2, 2, 0], [4, 2, 12], [6, 2, 0], [8, 2, 0], [10, 2, 12], [12, 2, 0], [14, 2, 'approach']],
  },
  lead: {
    type: 'square',
    octave: 12,
    gain: 0.075,
    lowpass: 2200,
    attack: 0.008,
    vibrato: 0,
    density: 0.9,
    phrases: [
      [[0, 2, 0], [2, 2, 0], [4, 2, 2], [6, 2, 0], [8, 2, 4], [10, 2, 2], [12, 4, 0]],
      [[0, 2, 7], [2, 2, 6], [4, 2, 4], [6, 2, 2], [8, 4, 0], [12, 2, 1, -1], [14, 2, 0]],
      [[0, 4, 4], [4, 2, 4], [6, 2, 4], [8, 2, 5], [10, 2, 4], [12, 4, 2]],
      [[0, 3, 0], [3, 3, 2], [6, 2, 4], [8, 3, 7], [11, 3, 4], [14, 2, 2]],
      [[0, 2, 0], [2, 2, 4], [4, 2, 7], [6, 2, 4], [8, 2, 0], [10, 2, 4], [12, 2, 7], [14, 2, 4]],
      [[0, 8, 7], [8, 2, 6], [10, 2, 5], [12, 4, 4]],
      [[0, 2, 4], [2, 2, 4, 1], [4, 4, 4], [8, 2, 2], [10, 2, 1], [12, 4, 0]],
    ],
    cadence: [
      [[0, 2, 4], [2, 2, 4], [4, 4, 0], [8, 8, 0]],
      [[0, 2, 7], [2, 2, 4], [4, 2, 2], [6, 2, 1, -1], [8, 8, 0]],
    ],
  },
  pad: { type: 'sawtooth', octave: 0, gain: 0.028, lowpass: 1200, attack: 0.05, detune: 6, sevenths: false },
  drums: { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], openHat: [14], gain: 1 },
};

/**
 * Boss: the battle, darker and faster, in a lower key. C phrygian gives it
 * the semitone above the root and a diminished chord to lean on, the lead
 * borrows the battle's phrases and adds the tritone, and the kick doubles.
 */
const BOSS: Piece = {
  ...BATTLE,
  seed: 0xb055,
  bpm: 170,
  root: 48,
  scale: PHRYGIAN,
  //           i  II i  VI  i  II vii v°  VI II i  i   vii VI II i
  progression: [0, 1, 0, 5, 0, 1, 6, 4, 5, 1, 0, 0, 6, 5, 1, 0],
  lead: {
    ...BATTLE.lead,
    gain: 0.07,
    lowpass: 2000,
    phrases: [
      ...BATTLE.lead.phrases,
      [[0, 2, 0], [2, 2, 1], [4, 2, 0], [6, 2, 4, -1], [8, 4, 4], [12, 4, 0]],
      [[0, 4, 4, -1], [4, 4, 4], [8, 2, 2], [10, 2, 1], [12, 4, 0]],
      [[0, 2, 0], [2, 2, 0], [4, 2, 0], [6, 2, 1], [8, 2, 0], [10, 2, 0], [12, 2, 0], [14, 2, 4, -1]],
    ],
  },
  pad: { type: 'sawtooth', octave: 0, gain: 0.03, lowpass: 900, attack: 0.04, detune: 8, sevenths: false },
  drums: { kick: [0, 4, 6, 8, 12, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], openHat: [14], gain: 1 },
};

/**
 * Title: the game before it begins. F major at a walk, a long sine under
 * each bar, sevenths in the pad, and a triangle lead that mostly climbs
 * through the chord like a harp being tried rather than played. No drums.
 */
const TITLE: Piece = {
  seed: 0x717e,
  bpm: 72,
  stepsPerBeat: 4,
  beatsPerBar: 4,
  root: 53,
  scale: MAJOR,
  //           I  vi IV V   I  iii IV V   vi IV I  V   IV V  I  I
  progression: [0, 5, 3, 4, 0, 2, 3, 4, 5, 3, 0, 4, 3, 4, 0, 0],
  bass: {
    type: 'sine',
    octave: -12,
    gain: 0.14,
    lowpass: 420,
    pattern: [[0, 16, 0]],
  },
  lead: {
    type: 'triangle',
    octave: 12,
    gain: 0.085,
    lowpass: 2600,
    attack: 0.02,
    vibrato: 6,
    density: 0.75,
    phrases: [
      [[0, 2, 0], [2, 2, 2], [4, 2, 4], [6, 2, 7], [8, 8, 9]],
      [[0, 2, 4], [2, 2, 2], [4, 2, 0], [6, 2, 2], [8, 4, 4], [12, 4, 2]],
      [[0, 4, 7], [4, 2, 4], [6, 2, 2], [8, 8, 4]],
      [[0, 2, 0], [2, 2, 4], [4, 2, 7], [6, 2, 4], [8, 2, 0], [10, 2, 4], [12, 4, 2]],
      [[0, 12, 2], [12, 4, 4]],
      [[2, 2, 2], [4, 2, 4], [6, 2, 5], [8, 8, 4]],
      [[0, 6, 4], [6, 2, 2], [8, 4, 0], [12, 4, 4]],
    ],
    cadence: [
      [[0, 4, 4], [4, 4, 2], [8, 8, 0]],
      [[0, 2, 2], [2, 2, 4], [4, 4, 2], [8, 8, 0]],
    ],
  },
  pad: { type: 'triangle', octave: 0, gain: 0.03, lowpass: 1400, attack: 0.6, detune: 6, sevenths: true },
};

export const PIECES: Readonly<Record<Exclude<MusicMood, 'none'>, Piece>> = {
  title: TITLE,
  overworld: OVERWORLD,
  overworld_night: OVERWORLD_NIGHT,
  town: TOWN,
  dungeon: DUNGEON,
  battle: BATTLE,
  boss: BOSS,
};

// ── The player ──

interface Chord {
  degree: number;
  /** Semitones above the key root. */
  tones: number[];
}

/** One piece in flight: its own gain under the bus and its own place in the pattern. */
interface Performance {
  mood: MusicMood;
  piece: Piece;
  out: GainNode;
  stepSec: number;
  stepsPerBar: number;
  step: number;
  /** Audio-clock time of the next step to place. */
  next: number;
  /** When set, the piece is fading and is torn down at this time. */
  dieAt: number | null;
  phrase: Phrase | null;
  lastPhrase: number;
  voices: Set<AudioScheduledSourceNode>;
}

/** What the harness reads; nothing in the game needs it. */
export interface MusicDebug {
  clock: number;
  current: MusicMood;
  liveVoices: number;
  paused: boolean;
  performances: { mood: MusicMood; step: number; next: number; ahead: number; gain: number; dieAt: number | null }[];
}

export class Music {
  private readonly perfs = new Set<Performance>();
  private current: Performance | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private paused = false;
  private lastResumeAsk = -Infinity;
  /** Every source node alive anywhere in the music, for the leak check. */
  private readonly live = new Set<AudioScheduledSourceNode>();

  /** The mood playing, or 'none'. A piece that is fading out does not count. */
  get mood(): MusicMood {
    return this.current?.mood ?? 'none';
  }

  get liveVoiceCount(): number {
    return this.live.size;
  }

  /**
   * Start a mood, crossfading from whatever is playing. The same mood again
   * is a no-op; 'none' is a stop. Silent where the engine has no context.
   */
  play(mood: MusicMood): void {
    try {
      if (mood === 'none') {
        this.stop();
        return;
      }
      if (this.current && this.current.mood === mood && this.current.dieAt === null) return;
      const a = getAudio();
      const c = a.ctx();
      const bus = a.music;
      if (!c || !bus) return;
      this.context = c;
      this.noise = a.noise;
      const t = c.currentTime;
      if (this.current) this.fadeOut(this.current, t);
      const p = this.begin(mood, c, bus, t);
      this.current = p;
      this.perfs.add(p);
      this.startTimer();
    } catch {
      this.panic();
    }
  }

  /** Fade the music out over the crossfade span and tear it down after. */
  stop(): void {
    try {
      const c = this.context;
      if (this.current && c) this.fadeOut(this.current, c.currentTime);
      this.current = null;
    } catch {
      this.panic();
    }
  }

  debug(): MusicDebug {
    const clock = this.context?.currentTime ?? 0;
    return {
      clock,
      current: this.mood,
      liveVoices: this.live.size,
      paused: this.paused,
      performances: [...this.perfs].map((p) => ({
        mood: p.mood,
        step: p.step,
        next: p.next,
        ahead: p.next - clock,
        gain: p.out.gain.value,
        dieAt: p.dieAt,
      })),
    };
  }

  // ── Performances ──

  private begin(mood: MusicMood, c: AudioContext, bus: GainNode, t: number): Performance {
    const piece = PIECES[mood as Exclude<MusicMood, 'none'>];
    const out = c.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + CROSSFADE_S);
    out.connect(bus);
    return {
      mood,
      piece,
      out,
      stepSec: 60 / piece.bpm / piece.stepsPerBeat,
      stepsPerBar: piece.stepsPerBeat * piece.beatsPerBar,
      step: 0,
      next: t + RESUME_GAP_S,
      dieAt: null,
      phrase: null,
      lastPhrase: -1,
      voices: new Set(),
    };
  }

  private fadeOut(p: Performance, t: number): void {
    if (p.dieAt !== null) return;
    const g = p.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + CROSSFADE_S);
    p.dieAt = t + CROSSFADE_S + TEARDOWN_GRACE_S;
  }

  private teardown(p: Performance): void {
    for (const v of p.voices) {
      try {
        v.stop();
      } catch {
        /* already stopped */
      }
      v.disconnect();
      this.live.delete(v);
    }
    p.voices.clear();
    p.out.disconnect();
    this.perfs.delete(p);
    if (this.current === p) this.current = null;
  }

  /** Everything off, now, with no fade: the response to a failure. */
  private panic(): void {
    this.stopTimer();
    for (const p of [...this.perfs]) {
      try {
        this.teardown(p);
      } catch {
        /* the node is gone either way */
      }
    }
    this.perfs.clear();
    this.current = null;
  }

  // ── The scheduler ──

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    try {
      const c = this.context;
      if (!c) {
        this.panic();
        return;
      }
      const a = getAudio();
      const now = c.currentTime;
      if (c.state !== 'running' && now - this.lastResumeAsk > RESUME_POLL_S) {
        this.lastResumeAsk = now;
        a.ctx();
      }
      if (!a.audible) {
        this.paused = true;
        return;
      }
      for (const p of [...this.perfs]) {
        if (p.dieAt !== null && now >= p.dieAt) {
          this.teardown(p);
          continue;
        }
        // Resuming, or a timer that came so late the next step is already
        // past: move the step forward rather than play it late.
        if (this.paused || p.next < now - p.stepSec) p.next = now + RESUME_GAP_S;
        const horizon = Math.min(now + LOOKAHEAD_S, p.dieAt ?? Infinity);
        while (p.next < horizon) {
          this.scheduleStep(p, p.step, p.next);
          p.step++;
          p.next += p.stepSec;
        }
      }
      this.paused = false;
      if (this.perfs.size === 0) this.stopTimer();
    } catch {
      this.panic();
    }
  }

  private chordAt(piece: Piece, bar: number): Chord {
    const degree = piece.progression[bar % piece.progression.length];
    return { degree, tones: chordTones(piece.scale, degree, piece.pad.sevenths) };
  }

  private scheduleStep(p: Performance, step: number, at: number): void {
    const piece = p.piece;
    const bar = Math.floor(step / p.stepsPerBar);
    const s = step % p.stepsPerBar;
    const chord = this.chordAt(piece, bar);
    const barSec = p.stepSec * p.stepsPerBar;

    if (s === 0) {
      this.pad(p, chord, at, barSec);
      const last = bar % piece.progression.length === piece.progression.length - 1;
      const pool = last ? piece.lead.cadence : piece.lead.phrases;
      const i = choosePhrase(piece.seed, bar, pool.length, last ? 1 : piece.lead.density, last ? -1 : p.lastPhrase);
      p.phrase = i < 0 ? null : pool[i];
      if (!last) p.lastPhrase = i < 0 ? p.lastPhrase : i;
    }

    // Bass: the chord root folded into one octave so VI and VII sit below.
    const bassRoot = chord.tones[0] >= 8 ? chord.tones[0] - 12 : chord.tones[0];
    for (const [bs, bl, interval] of piece.bass.pattern) {
      if (bs !== s) continue;
      let semis: number;
      if (interval === 'third') semis = bassRoot + (chord.tones[1] - chord.tones[0]);
      else if (interval === 'approach') {
        const next = this.chordAt(piece, bar + 1);
        const nextRoot = next.tones[0] >= 8 ? next.tones[0] - 12 : next.tones[0];
        semis = nextRoot === bassRoot ? bassRoot + 7 : nextRoot - 1;
      } else semis = bassRoot + interval;
      const midi = piece.root + piece.bass.octave + semis;
      this.voice(p, piece.bass.type, midiToHz(midi), at, bl * p.stepSec * 0.9, piece.bass.gain, {
        attack: 0.01,
        release: 0.06,
        lowpass: piece.bass.lowpass,
      });
    }

    // Lead: the phrase's degrees hang off the chord root, itself folded so
    // the V and above are heard below the tonic rather than a seventh up.
    if (p.phrase) {
      const base = chord.degree >= 4 ? chord.degree - 7 : chord.degree;
      for (const [ls, ll, d, acc] of p.phrase) {
        if (ls !== s) continue;
        const midi = piece.root + piece.lead.octave + scaleNote(piece.scale, base + d) + (acc ?? 0);
        const dur = ll * p.stepSec * 0.85;
        this.voice(p, piece.lead.type, midiToHz(midi), at, dur, piece.lead.gain, {
          attack: piece.lead.attack,
          release: 0.05,
          lowpass: piece.lead.lowpass,
          vibrato: piece.lead.vibrato,
        });
      }
    }

    const drums = piece.drums;
    if (drums) {
      if (drums.kick.includes(s)) this.kick(p, at, drums.gain);
      if (drums.snare.includes(s)) this.snare(p, at, drums.gain);
      if (drums.hat.includes(s)) this.hat(p, at, CLOSED_HAT_S, drums.gain);
      if (drums.openHat.includes(s)) this.hat(p, at, OPEN_HAT_S, drums.gain);
    }

    if (piece.drip && barHash(piece.seed ^ 0xd21b, step) % DRIP_ONE_IN === 0) this.drip(p, at);
  }

  /** The chord held for the bar: each tone as a detuned pair, folded into one octave above the pad's floor. */
  private pad(p: Performance, chord: Chord, at: number, barSec: number): void {
    const piece = p.piece;
    const low = piece.root + piece.pad.octave;
    for (const tone of chord.tones) {
      let midi = low + tone;
      while (midi >= low + 12) midi -= 12;
      const hz = midiToHz(midi);
      for (const sign of [-1, 1]) {
        this.voice(p, piece.pad.type, hz, at, barSec, piece.pad.gain, {
          attack: piece.pad.attack,
          release: 0.25,
          lowpass: piece.pad.lowpass,
          detune: sign * piece.pad.detune,
        });
      }
    }
  }

  // ── Voices ──

  /** An oscillator with an envelope, a lowpass, and optionally vibrato, into the performance's gain. */
  private voice(
    p: Performance,
    type: OscillatorType,
    hz: number,
    at: number,
    dur: number,
    peak: number,
    o: { attack: number; release: number; lowpass: number; vibrato?: number; detune?: number },
  ): void {
    const c = this.context;
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    if (o.detune) osc.detune.value = o.detune;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lowpass;
    const g = c.createGain();
    const end = at + dur;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + o.attack);
    g.gain.setValueAtTime(peak, Math.max(at + o.attack, end - o.release));
    g.gain.linearRampToValueAtTime(0, end);
    osc.connect(lp);
    lp.connect(g);
    g.connect(p.out);
    const nodes: AudioNode[] = [osc, lp, g];
    if (o.vibrato) {
      const lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = VIBRATO_HZ;
      const depth = c.createGain();
      depth.gain.setValueAtTime(0, at);
      depth.gain.linearRampToValueAtTime(o.vibrato, at + VIBRATO_RISE_S);
      lfo.connect(depth);
      depth.connect(osc.detune);
      lfo.start(at);
      lfo.stop(end + 0.01);
      nodes.push(lfo, depth);
      this.track(p, lfo, [lfo, depth]);
    }
    osc.start(at);
    osc.stop(end + 0.01);
    this.track(p, osc, nodes);
  }

  /** A burst of the shared noise through a filter, into the performance's gain. */
  private burst(p: Performance, filter: BiquadFilterType, hz: number, q: number, at: number, dur: number, peak: number): void {
    const c = this.context;
    if (!c || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(p.out);
    src.start(at);
    src.stop(at + dur + 0.01);
    this.track(p, src, [src, f, g]);
  }

  private kick(p: Performance, at: number, gain: number): void {
    const c = this.context;
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(KICK_FROM_HZ, at);
    osc.frequency.exponentialRampToValueAtTime(KICK_TO_HZ, at + KICK_S * 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.3 * gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + KICK_S);
    osc.connect(g);
    g.connect(p.out);
    osc.start(at);
    osc.stop(at + KICK_S + 0.01);
    this.track(p, osc, [osc, g]);
  }

  private hat(p: Performance, at: number, dur: number, gain: number): void {
    this.burst(p, 'highpass', HAT_HZ, 0.7, at, dur, 0.06 * gain);
  }

  private snare(p: Performance, at: number, gain: number): void {
    this.burst(p, 'bandpass', SNARE_HZ, 0.8, at, SNARE_S, 0.14 * gain);
    const c = this.context;
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, at);
    osc.frequency.exponentialRampToValueAtTime(120, at + 0.06);
    const g = c.createGain();
    g.gain.setValueAtTime(0.12 * gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    osc.connect(g);
    g.connect(p.out);
    osc.start(at);
    osc.stop(at + 0.08);
    this.track(p, osc, [osc, g]);
  }

  private drip(p: Performance, at: number): void {
    const c = this.context;
    if (!c) return;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, at);
    osc.frequency.exponentialRampToValueAtTime(900, at + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.035, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    osc.connect(g);
    g.connect(p.out);
    osc.start(at);
    osc.stop(at + 0.15);
    this.track(p, osc, [osc, g]);
  }

  /** Register a source so it is counted while alive and unwired the moment it ends. */
  private track(p: Performance, src: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    p.voices.add(src);
    this.live.add(src);
    src.onended = () => {
      for (const n of nodes) n.disconnect();
      p.voices.delete(src);
      this.live.delete(src);
    };
  }
}

/** The one player for the page, made on first use. */
let instance: Music | null = null;

export function getMusic(): Music {
  if (!instance) instance = new Music();
  return instance;
}

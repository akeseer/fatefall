/**
 * The audio engine: one AudioContext, two buses, and the rules for when
 * sound is allowed to happen.
 *
 * There are no sound files anywhere in the game and there will not be.
 * Everything that reaches the speakers is synthesised on the spot from
 * oscillators and filtered noise, the way the dice were already voiced
 * before this file existed. That keeps the bundle free of assets and lets a
 * sound be tuned in code next to the thing that makes it.
 *
 * ── One context ──
 *
 * Browsers cap the number of AudioContexts a page may hold and each one costs
 * a real audio thread, so there is exactly one, created lazily. Everything
 * else in the game — the dice, the effects, the music — asks this module for
 * it rather than making its own. A second context would also have made a
 * single mute impossible, since it would have had its own destination.
 *
 * ── The gesture ──
 *
 * The autoplay policy will not let a page make a sound until the user has
 * touched it. The context is therefore created on first use and resumed on
 * every use, and a pair of one-shot listeners on the first pointer or key
 * event unlock it early so the first sound is not swallowed. Nothing here
 * ever throws: a browser without audio, or a context that refuses, leaves the
 * game exactly as it was before there was any.
 *
 * ── Two buses ──
 *
 * Effects and music sit on separate gains under one master, each with its
 * own remembered volume, because a player who wants the music off almost
 * never wants the dice silenced with it.
 */

/** What is remembered between sessions. */
interface AudioPrefs {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
}

const PREFS_KEY = 'fatefall.audio';

const DEFAULT_PREFS: AudioPrefs = { master: 0.8, sfx: 0.9, music: 0.55, muted: false };

/** Length of the shared white-noise buffer. Every burst in the game is shorter than this. */
const NOISE_SECONDS = 1.0;

/** How quickly the master fades when muted or unmuted, so a toggle is a dip rather than a click. */
const MUTE_RAMP_S = 0.06;

export class GameAudio {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private prefs: AudioPrefs;
  private unlocked = false;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.prefs = { ...DEFAULT_PREFS, ...readPrefs() };
    if (typeof window !== 'undefined') {
      // Unlock on the first touch of any kind, once. `once` removes each
      // listener after it fires, but a pointer and a key are two listeners,
      // so the second is removed by hand when the first fires.
      const unlock = () => {
        this.unlocked = true;
        void this.ctx();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
    }
  }

  /**
   * The context, created on first use and resumed on every use. Null where
   * audio is unavailable, and callers treat null as "stay silent".
   */
  ctx(): AudioContext | null {
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return null;
      }
      const c = this.context;
      this.masterGain = c.createGain();
      this.sfxGain = c.createGain();
      this.musicGain = c.createGain();
      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(c.destination);
      this.applyPrefs(true);

      const buf = c.createBuffer(1, Math.floor(c.sampleRate * NOISE_SECONDS), c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  /** The effects bus. Null until the context exists. */
  get sfx(): GainNode | null { return this.ctx() ? this.sfxGain : null; }

  /** The music bus. Null until the context exists. */
  get music(): GainNode | null { return this.ctx() ? this.musicGain : null; }

  /** One second of white noise, shared by every burst in the game. */
  get noise(): AudioBuffer | null { return this.ctx() ? this.noiseBuffer : null; }

  /** The context's clock, or 0 when there is no context. */
  now(): number { return this.context?.currentTime ?? 0; }

  /** True once a user gesture has unlocked playback. */
  get ready(): boolean { return this.unlocked && this.context !== null && this.context.state === 'running'; }

  /**
   * Whether a sound should play right now at all: not while the tab is
   * hidden, which is when a clatter of dice from a background tab is the
   * most unwelcome sound a game can make.
   */
  get audible(): boolean {
    return !this.prefs.muted && !(typeof document !== 'undefined' && document.hidden);
  }

  get muted(): boolean { return this.prefs.muted; }
  get masterVolume(): number { return this.prefs.master; }
  get sfxVolume(): number { return this.prefs.sfx; }
  get musicVolume(): number { return this.prefs.music; }

  setMuted(muted: boolean): void {
    this.prefs.muted = muted;
    this.applyPrefs();
    this.persist();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.prefs.muted);
    return this.prefs.muted;
  }

  setVolumes(v: Partial<Pick<AudioPrefs, 'master' | 'sfx' | 'music'>>): void {
    if (v.master !== undefined) this.prefs.master = clamp01(v.master);
    if (v.sfx !== undefined) this.prefs.sfx = clamp01(v.sfx);
    if (v.music !== undefined) this.prefs.music = clamp01(v.music);
    this.applyPrefs();
    this.persist();
  }

  /** Be told when volume or mute changes, for a control that shows the state. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private applyPrefs(immediate = false): void {
    const c = this.context;
    if (!c || !this.masterGain || !this.sfxGain || !this.musicGain) return;
    const t = c.currentTime;
    const master = this.prefs.muted ? 0 : this.prefs.master;
    for (const [node, value] of [
      [this.masterGain, master],
      [this.sfxGain, this.prefs.sfx],
      [this.musicGain, this.prefs.music],
    ] as [GainNode, number][]) {
      node.gain.cancelScheduledValues(t);
      if (immediate) {
        // Both, deliberately. The context is usually still suspended when
        // the buses are made, and an automation event scheduled on a
        // suspended context's clock was found not to have taken by the time
        // it was running: the buses read 1/1/1 until the first mute toggle
        // re-applied them. Assigning the intrinsic value takes effect at once.
        node.gain.value = value;
        node.gain.setValueAtTime(value, t);
      } else {
        node.gain.setValueAtTime(node.gain.value, t);
        node.gain.linearRampToValueAtTime(value, t + MUTE_RAMP_S);
      }
    }
    for (const fn of this.listeners) fn();
  }

  private persist(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* private mode: the preference just will not stick */
    }
  }
}

function readPrefs(): Partial<AudioPrefs> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<AudioPrefs>;
    const out: Partial<AudioPrefs> = {};
    if (typeof p.master === 'number') out.master = clamp01(p.master);
    if (typeof p.sfx === 'number') out.sfx = clamp01(p.sfx);
    if (typeof p.music === 'number') out.music = clamp01(p.music);
    if (typeof p.muted === 'boolean') out.muted = p.muted;
    return out;
  } catch {
    return {};
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** The one engine for the page. Everything that makes a sound goes through it. */
let instance: GameAudio | null = null;

export function getAudio(): GameAudio {
  if (!instance) instance = new GameAudio();
  return instance;
}

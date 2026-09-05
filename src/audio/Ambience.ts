/**
 * The sound of the place: rain, wind, the hush of a cave, crickets after dark.
 *
 * Every other sound in the game is an event. This is the one that is always
 * there, which is why it is a separate file from the effects: an effect
 * starts and stops itself, while ambience is a handful of layers whose
 * loudness follows the world and never quite starts or stops at all.
 *
 * ── How it is made ──
 *
 * Each layer is the engine's one second of white noise, looped, pushed
 * through a filter into its own gain under the effects bus. Rain is a band of
 * hiss with a low rumble under it when it is heavy; wind is the bottom of the
 * noise with the filter swept slowly so it gusts; a cave is almost nothing,
 * a low hush so a silent dungeon does not sound like a muted tab; crickets
 * are a thin high band chopped by an LFO. Nothing is recorded and nothing is
 * downloaded, the same as the rest of the audio.
 *
 * ── How it moves ──
 *
 * The game says what the world is doing every step and this file turns that
 * into a target level per layer. The levels are pure and tested; the audio
 * side only glides each gain toward its target with a time constant, so
 * walking out of the rain into a cave is a fade over a second or two, and a
 * step that says the same thing as the last costs nothing at all.
 *
 * Nothing here throws past its own boundary and nothing plays without the
 * engine. A browser with no audio gets the same game it had before.
 */

import { getAudio } from './Audio';

/** What the world is doing, as far as sound is concerned. */
export interface AmbienceScene {
  /** Weather id, or null for clear skies. */
  weather: string | null;
  underground: boolean;
  night: boolean;
  town: boolean;
  inCombat: boolean;
}

/** Target level per layer, 0..1 before the layer's own ceiling. */
export interface AmbienceLevels {
  rain: number;
  rumble: number;
  wind: number;
  cave: number;
  crickets: number;
}

// ── Tunables ──

/** Time constant for a gain gliding to its target, in seconds. */
const GLIDE_S = 1.2;

/** Ceilings, so the pure levels stay in 0..1 and the mix is set in one place. */
const CEILING: AmbienceLevels = { rain: 0.13, rumble: 0.1, wind: 0.11, cave: 0.035, crickets: 0.02 };

/** Filter centres. */
const RAIN_HZ = 1400;
const RUMBLE_HZ = 110;
const WIND_HZ = 380;
const CAVE_HZ = 160;
const CRICKET_HZ = 4300;

/** How far and how fast the wind's filter wanders. */
const GUST_HZ = 0.13;
const GUST_DEPTH_HZ = 220;

/** The cricket chirp: a fast chop with a slower swell. */
const CHIRP_HZ = 7.5;

/** Daylight below which the night sounds come in. */
export const NIGHT_BELOW = 0.34;

/** A fight halves the weather so the blows are heard. */
const COMBAT_SCALE = 0.5;

/** In town the rain is still heard but the walls take some of the wind. */
const TOWN_WIND_SCALE = 0.5;

/** The target level of each layer for a scene. Pure. */
export function ambienceLevels(s: AmbienceScene): AmbienceLevels {
  const out: AmbienceLevels = { rain: 0, rumble: 0, wind: 0, cave: 0, crickets: 0 };
  if (s.underground) {
    out.cave = 1;
  } else {
    switch (s.weather) {
      case 'rain':
        out.rain = 0.6;
        out.wind = 0.15;
        break;
      case 'heavy_rain':
        out.rain = 1;
        out.rumble = 1;
        out.wind = 0.45;
        break;
      case 'snow':
        out.wind = 0.5;
        break;
      case 'sandstorm':
        out.wind = 1;
        out.rumble = 0.4;
        break;
      case 'fog':
      case 'eerie_mist':
        out.wind = 0.2;
        break;
      case 'cloudy':
        out.wind = 0.25;
        break;
      default:
        out.wind = 0.08;
    }
    if (s.town) out.wind *= TOWN_WIND_SCALE;
    // Crickets only where it is dark, quiet and out of doors.
    if (s.night && !s.town && out.rain === 0 && s.weather !== 'sandstorm' && s.weather !== 'snow') out.crickets = 1;
  }
  if (s.inCombat) {
    out.rain *= COMBAT_SCALE;
    out.rumble *= COMBAT_SCALE;
    out.wind *= COMBAT_SCALE;
    out.crickets *= COMBAT_SCALE;
  }
  return out;
}

const SILENT: AmbienceLevels = { rain: 0, rumble: 0, wind: 0, cave: 0, crickets: 0 };

interface Layer {
  gain: GainNode;
  nodes: AudioNode[];
  target: number;
}

export interface AmbienceDebug {
  built: boolean;
  targets: AmbienceLevels;
  gains: Partial<Record<keyof AmbienceLevels, number>>;
}

/** The weather, heard. */
export class Ambience {
  private layers: Partial<Record<keyof AmbienceLevels, Layer>> = {};
  private built = false;
  private context: AudioContext | null = null;
  private last: AmbienceLevels = { ...SILENT };

  /** Tell the ambience what the world is doing. Cheap when nothing changed. */
  update(scene: AmbienceScene): void {
    try {
      const a = getAudio();
      const want = a.audible ? ambienceLevels(scene) : SILENT;
      if (same(want, this.last)) return;
      // Nothing to hear and nothing built: stay that way without touching the engine.
      if (silent(want) && !this.built) return;
      const c = a.ctx();
      const bus = a.sfx;
      const buf = a.noise;
      if (!c || !bus || !buf) return;
      if (!this.built) this.build(c, bus, buf);
      // Recorded only once applied, so a step that found no engine asks again.
      this.last = want;
      const t = c.currentTime;
      for (const key of Object.keys(CEILING) as (keyof AmbienceLevels)[]) {
        const layer = this.layers[key];
        if (!layer) continue;
        const target = want[key] * CEILING[key];
        if (target === layer.target) continue;
        layer.target = target;
        layer.gain.gain.cancelScheduledValues(t);
        layer.gain.gain.setTargetAtTime(target, t, GLIDE_S);
      }
    } catch {
      this.teardown();
    }
  }

  /** Fade everything out. The layers stay built for next time. */
  stop(): void {
    try {
      const c = this.context;
      if (!c) return;
      const t = c.currentTime;
      for (const layer of Object.values(this.layers)) {
        if (!layer) continue;
        layer.target = 0;
        layer.gain.gain.cancelScheduledValues(t);
        layer.gain.gain.setTargetAtTime(0, t, GLIDE_S);
      }
      this.last = { ...SILENT };
    } catch {
      this.teardown();
    }
  }

  debug(): AmbienceDebug {
    const gains: AmbienceDebug['gains'] = {};
    for (const [k, layer] of Object.entries(this.layers)) if (layer) gains[k as keyof AmbienceLevels] = layer.gain.gain.value;
    return { built: this.built, targets: { ...this.last }, gains };
  }

  // ── Construction ──

  private build(c: AudioContext, bus: GainNode, noise: AudioBuffer): void {
    this.context = c;
    const t = c.currentTime;

    const source = (): AudioBufferSourceNode => {
      const src = c.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      // A different start offset per layer, so five copies of one second of
      // noise do not line up into one louder copy.
      src.start(t, Math.random() * noise.duration);
      return src;
    };
    const filter = (type: BiquadFilterType, hz: number, q: number): BiquadFilterNode => {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = hz;
      f.Q.value = q;
      return f;
    };
    const layer = (key: keyof AmbienceLevels, chain: AudioNode[], extra: AudioNode[] = []): void => {
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i + 1 < chain.length; i++) chain[i].connect(chain[i + 1]);
      chain[chain.length - 1].connect(g);
      g.connect(bus);
      this.layers[key] = { gain: g, nodes: [...chain, ...extra, g], target: 0 };
    };

    // Rain: a band of hiss.
    layer('rain', [source(), filter('bandpass', RAIN_HZ, 0.7)]);

    // Rumble: the bottom of the noise, for a downpour or a storm of sand.
    layer('rumble', [source(), filter('lowpass', RUMBLE_HZ, 0.9)]);

    // Wind: low noise with the filter swept slowly so it gusts.
    const windFilter = filter('lowpass', WIND_HZ, 1.4);
    const gust = c.createOscillator();
    gust.type = 'sine';
    gust.frequency.value = GUST_HZ;
    const gustDepth = c.createGain();
    gustDepth.gain.value = GUST_DEPTH_HZ;
    gust.connect(gustDepth);
    gustDepth.connect(windFilter.frequency);
    gust.start(t);
    layer('wind', [source(), windFilter], [gust, gustDepth]);

    // Cave: a hush.
    layer('cave', [source(), filter('lowpass', CAVE_HZ, 0.6)]);

    // Crickets: a thin high band, chopped.
    const chirpGate = c.createGain();
    chirpGate.gain.value = 0.5;
    const chirp = c.createOscillator();
    chirp.type = 'square';
    chirp.frequency.value = CHIRP_HZ;
    const chirpDepth = c.createGain();
    chirpDepth.gain.value = 0.5;
    chirp.connect(chirpDepth);
    chirpDepth.connect(chirpGate.gain);
    chirp.start(t);
    layer('crickets', [source(), filter('bandpass', CRICKET_HZ, 6), chirpGate], [chirp, chirpDepth]);

    this.built = true;
  }

  private teardown(): void {
    for (const layer of Object.values(this.layers)) {
      if (!layer) continue;
      for (const n of layer.nodes) {
        try {
          if ('stop' in n && typeof (n as AudioScheduledSourceNode).stop === 'function') (n as AudioScheduledSourceNode).stop();
        } catch {
          /* already stopped */
        }
        n.disconnect();
      }
    }
    this.layers = {};
    this.built = false;
    this.last = { ...SILENT };
  }
}

function same(a: AmbienceLevels, b: AmbienceLevels): boolean {
  return a.rain === b.rain && a.rumble === b.rumble && a.wind === b.wind && a.cave === b.cave && a.crickets === b.crickets;
}

function silent(a: AmbienceLevels): boolean {
  return a.rain === 0 && a.rumble === 0 && a.wind === 0 && a.cave === 0 && a.crickets === 0;
}

let instance: Ambience | null = null;

/** The one ambience for the page. */
export function getAmbience(): Ambience {
  if (!instance) instance = new Ambience();
  return instance;
}

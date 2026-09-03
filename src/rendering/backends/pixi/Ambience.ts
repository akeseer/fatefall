/**
 * The specks in the air: dust underground, pollen and midges over daylit
 * ground, fireflies after dark.
 *
 * This is the layer that stops a scene looking like a diorama. Everything else
 * on screen either sits still or moves because the game told it to — the party
 * walks, the weather falls, a spell bursts — and between those events the
 * world is completely inert. A handful of motes drifting on nothing fixes
 * that for almost no cost, and the eye reads it as air rather than as a
 * particle effect, which is exactly what it should do.
 *
 * ── Where it sits ──
 *
 * Inside the world container, above the drawn scene and below the lighting.
 * That ordering is the whole reason the underground case works: dust is only
 * interesting where light catches it, and putting the motes under the lighting
 * pass means the ones inside the party's torch are lit and the ones out in the
 * dark are not — for free, without this file knowing anything about where the
 * torch is. Above the lighting they would be a constant sprinkle of white
 * dots over a black screen, which is snow in a cave.
 *
 * ── Why it is not part of Weather ──
 *
 * Weather is something that is happening to the world and it stops. Ambience
 * is the world being alive and it never stops; it changes character with where
 * the party is and what time it is, but there is no "clear" case where it
 * switches off. Sharing a file would have meant one state machine answering to
 * two very different questions.
 */

import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import type { SceneMood } from '../../DrawCommand';

// ── Tunables ──

/** Ceiling on live motes. Past this the air reads as falling dirt rather than as air. */
const MAX_MOTES = 90;

/** How many are asked for in each setting. Underground gets the most: it is the one the light can pick out. */
const COUNT_UNDERGROUND = 84;
const COUNT_DAY = 46;
const COUNT_NIGHT = 26;

/** Below this daylight the outdoors is treated as night, and midges become fireflies. */
const NIGHT_BELOW = 0.34;

/** How far a mote drifts sideways per second, in pixels, before its own wander is added. */
const DRIFT_UNDERGROUND = 5;
const DRIFT_DAY = 13;
const DRIFT_NIGHT = 7;

/** Vertical drift. Dust falls very slowly; midges and fireflies hold their height and wander. */
const FALL_UNDERGROUND = 4;
const FALL_DAY = -2;
const FALL_NIGHT = -1;

/** Peak sideways wander, in pixels, and how fast each mote works through its own wander cycle. */
const WANDER_PX = 9;
const WANDER_HZ_MIN = 0.18;
const WANDER_HZ_MAX = 0.52;

/** Mote colours. Dust is warm because the only light down there is fire. */
const COLOR_UNDERGROUND = 0xffe6bd;
const COLOR_DAY = 0xfff6d2;
const COLOR_NIGHT = 0xbaffa0;

/** Base opacity per setting, before each mote's own depth is applied. */
const ALPHA_UNDERGROUND = 0.5;
const ALPHA_DAY = 0.32;
const ALPHA_NIGHT = 0.85;

/** Fireflies pulse; dust and pollen do not. */
const PULSE_HZ_MIN = 0.5;
const PULSE_HZ_MAX = 1.3;

/** How deep a firefly's pulse goes, as a fraction of its brightness. */
const PULSE_DEPTH = 0.75;

/** Time constant for crossing between settings, so walking into a cave is a fade. */
const FADE_TAU_MS = 900;

/** Longest step honoured, so a backgrounded tab does not resume with every mote teleported. */
const MAX_STEP_MS = 100;

/**
 * How far from the party's light a mote is still worth seeing, underground.
 *
 * Roughly the reach of the carried torch. Without this the specks cover the
 * whole viewport, and since most of an unexplored floor is undrawn black, what
 * you get is a cave full of stars. You only ever see dust in the beam.
 */
const DUST_REACH = 300;

/** What is left of a mote's brightness at the edge of that reach, so the field does not end on a line. */
const DUST_EDGE = 0.05;

/** Below this the layer is doing nothing the eye can see and is left out of the scene. */
const ALPHA_EPSILON = 0.01;

/** Side of the baked mote texture. Three pixels, because these are specks and must stay specks. */
const MOTE_TEXTURE_SIZE = 3;

/** What the air is doing, once the mood has been read. */
interface Air {
  count: number;
  /** True where motes are only visible near the party's own light. */
  litOnly: boolean;
  drift: number;
  fall: number;
  color: number;
  alpha: number;
  pulses: boolean;
}

/** One speck. Position is in screen pixels; these belong to the air, not to the ground. */
interface Mote {
  sprite: Sprite;
  x: number;
  y: number;
  /** 0 far, 1 near. Scales size, speed and opacity together, which is what gives the field depth. */
  depth: number;
  wanderPhase: number;
  wanderHz: number;
  pulsePhase: number;
  pulseHz: number;
}

/** The air, and what is drifting in it. */
export class Ambience {
  readonly layer: Container;
  /** False when there is nothing worth adding to the scene. */
  get active(): boolean {
    return this.alpha > ALPHA_EPSILON;
  }

  private readonly texture: Texture;
  private readonly motes: Mote[] = [];
  private readonly width: number;
  private readonly height: number;

  private clockMs = 0;
  private seeded = false;

  // Eased state, one field per thing that must not step when the setting changes.
  private count = 0;
  private drift = 0;
  private fall = 0;
  private alpha = 0;
  private pulse = 0;
  /** How much the field is confined to the party's light, eased so a cave mouth is a fade. */
  private lit = 0;
  /** Colour is eased as three channels so a cave does not flash green on the way in. */
  private r = 1;
  private g = 1;
  private b = 1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.texture = Ambience.bakeMote();

    this.layer = new Container();
    this.layer.interactiveChildren = false;

    for (let i = 0; i < MAX_MOTES; i++) {
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      // Additive, so a mote inside the torchlight glows rather than sitting on
      // top of it as a grey dot.
      sprite.blendMode = 'add';
      sprite.visible = false;
      this.layer.addChild(sprite);
      this.motes.push(this.spawn(sprite, i, true));
    }
  }

  /**
   * Recompute the air for this frame. `elapsedMs` is the delta since the last
   * call, not a running total.
   */
  update(mood: SceneMood, elapsedMs: number): void {
    const dt = Math.max(0, Math.min(MAX_STEP_MS, elapsedMs));
    this.clockMs += dt;

    const want = this.airFor(mood);
    if (!this.seeded) {
      this.seeded = true;
      this.count = want.count;
      this.drift = want.drift;
      this.fall = want.fall;
      this.alpha = want.alpha;
      this.pulse = want.pulses ? 1 : 0;
      this.lit = want.litOnly ? 1 : 0;
      this.r = ((want.color >> 16) & 0xff) / 255;
      this.g = ((want.color >> 8) & 0xff) / 255;
      this.b = (want.color & 0xff) / 255;
    } else {
      const k = 1 - Math.exp(-dt / FADE_TAU_MS);
      this.count += (want.count - this.count) * k;
      this.drift += (want.drift - this.drift) * k;
      this.fall += (want.fall - this.fall) * k;
      this.alpha += (want.alpha - this.alpha) * k;
      this.pulse += ((want.pulses ? 1 : 0) - this.pulse) * k;
      this.lit += ((want.litOnly ? 1 : 0) - this.lit) * k;
      this.r += (((want.color >> 16) & 0xff) / 255 - this.r) * k;
      this.g += (((want.color >> 8) & 0xff) / 255 - this.g) * k;
      this.b += ((want.color & 0xff) / 255 - this.b) * k;
    }

    if (!this.active) {
      for (const m of this.motes) m.sprite.visible = false;
      return;
    }

    const seconds = dt / 1000;
    const tint = packTint(this.r, this.g, this.b);
    const live = Math.round(this.count);
    const t = this.clockMs / 1000;
    const fx = mood.focus ? mood.focus.x : this.width / 2;
    const fy = mood.focus ? mood.focus.y : this.height / 2;

    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      if (i >= live) {
        m.sprite.visible = false;
        continue;
      }

      // Near motes move faster than far ones, which is the whole of the
      // parallax and costs one multiply.
      const speed = 0.45 + m.depth;
      m.x += this.drift * speed * seconds;
      m.y += this.fall * speed * seconds;

      // Wrapping rather than respawning keeps the field even; a mote that
      // reappeared at a random spot would make the air twinkle where it landed.
      if (m.x < -8) m.x += this.width + 16;
      if (m.x > this.width + 8) m.x -= this.width + 16;
      if (m.y < -8) m.y += this.height + 16;
      if (m.y > this.height + 8) m.y -= this.height + 16;

      const wander = Math.sin(t * m.wanderHz * Math.PI * 2 + m.wanderPhase) * WANDER_PX * m.depth;
      const sprite = m.sprite;
      sprite.visible = true;
      sprite.position.set(Math.round(m.x + wander), Math.round(m.y));
      sprite.scale.set(1 + Math.round(m.depth * 1.5));
      sprite.tint = tint;

      let a = this.alpha * (0.35 + m.depth * 0.65);
      if (this.lit > 0.01) {
        const dx = m.x - fx;
        const dy = m.y - fy;
        const reach = Math.sqrt(dx * dx + dy * dy) / DUST_REACH;
        // Squared falloff, so the beam has a bright core and a soft end rather
        // than a visible circle of dust around the party.
        const near = reach >= 1 ? 0 : (1 - reach) * (1 - reach);
        a *= 1 - this.lit * (1 - Math.max(DUST_EDGE, near));
      }
      if (this.pulse > 0.01) {
        const beat = 0.5 + 0.5 * Math.sin(t * m.pulseHz * Math.PI * 2 + m.pulsePhase);
        a *= 1 - this.pulse * PULSE_DEPTH * (1 - beat);
      }
      sprite.alpha = a;
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.texture.destroy(true);
  }

  /** What the air should be doing, given where the party is and what hour it is. */
  private airFor(mood: SceneMood): Air {
    if (mood.underground) {
      return {
        count: COUNT_UNDERGROUND, litOnly: true, drift: DRIFT_UNDERGROUND, fall: FALL_UNDERGROUND,
        color: COLOR_UNDERGROUND, alpha: ALPHA_UNDERGROUND, pulses: false,
      };
    }
    if (mood.daylight < NIGHT_BELOW) {
      return {
        count: COUNT_NIGHT, litOnly: false, drift: DRIFT_NIGHT, fall: FALL_NIGHT,
        color: COLOR_NIGHT, alpha: ALPHA_NIGHT, pulses: true,
      };
    }
    return {
      count: COUNT_DAY, litOnly: false, drift: DRIFT_DAY, fall: FALL_DAY,
      color: COLOR_DAY, alpha: ALPHA_DAY, pulses: false,
    };
  }

  /** Place one mote. Deterministic in `i`, so the field is the same every run. */
  private spawn(sprite: Sprite, i: number, scatter: boolean): Mote {
    const h = hash(i);
    return {
      sprite,
      x: scatter ? (h % 9973) / 9973 * this.width : -8,
      y: (hash(i + 977) % 9973) / 9973 * this.height,
      depth: (hash(i + 313) % 1000) / 1000,
      wanderPhase: (hash(i + 71) % 628) / 100,
      wanderHz: WANDER_HZ_MIN + ((hash(i + 149) % 1000) / 1000) * (WANDER_HZ_MAX - WANDER_HZ_MIN),
      pulsePhase: (hash(i + 421) % 628) / 100,
      pulseHz: PULSE_HZ_MIN + ((hash(i + 233) % 1000) / 1000) * (PULSE_HZ_MAX - PULSE_HZ_MIN),
    };
  }

  /**
   * Bake the speck once.
   *
   * A soft round mote would need alpha in the texture and would blur against
   * pixel-art terrain; this is a plus-shaped three by three, so it stays a
   * pixel-art speck at every scale the field uses.
   */
  private static bakeMote(): Texture {
    const size = MOTE_TEXTURE_SIZE;
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const centre = x === 1 && y === 1;
        const arm = x === 1 || y === 1;
        const v = centre ? 255 : arm ? 120 : 0;
        rgba[i] = v;
        rgba[i + 1] = v;
        rgba[i + 2] = v;
        rgba[i + 3] = v;
      }
    }
    const source = new BufferImageSource({
      resource: rgba,
      width: size,
      height: size,
      // Without this a byte array is guessed as BGRA and the tint comes out wrong.
      format: 'rgba8unorm',
      alphaMode: 'premultiplied-alpha',
      scaleMode: 'nearest',
      autoGarbageCollect: false,
    });
    return new Texture({ source });
  }
}

/** A cheap integer scramble, so a mote's constants are fixed by its index. */
function hash(i: number): number {
  let h = (i + 1) * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h < 0 ? -h : h;
}

/** Pack three zero-to-one channels into the 0xRRGGBB a Pixi tint wants. */
function packTint(r: number, g: number, b: number): number {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

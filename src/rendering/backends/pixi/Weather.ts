/**
 * Weather for the Pixi backend: precipitation, drifting fog banks and the sky's
 * own pulse, as one pooled particle layer over the drawn world.
 *
 * The map renderer already paints a weather veil — a flat colour wash and about
 * forty-five hand-stroked lines — and on the Canvas backend that is still the
 * whole of it. Forty-five lines is what a `fillRect` budget buys. A GPU can
 * afford a few hundred sprites, and a few hundred is the difference between a
 * texture that suggests rain and a volume the party is standing inside.
 *
 * ── Where the layer sits ──
 *
 * Inside the world container, above every drawn command and *below* the
 * lighting. That ordering is the one real decision in this file and it is worth
 * being explicit about, because all three positions are defensible and two of
 * them are wrong.
 *
 * Above the lighting and above the grade, weather would be on the lens: a sheet
 * of bright streaks that stays exactly as bright at midnight as at noon, over a
 * world the lighting has crushed to a third of its brightness. That is what a
 * weather overlay drawn last always looks like, and it is why so many games'
 * rain reads as a screen effect rather than as water.
 *
 * Underneath the lighting, rain is in the scene. The night multiply dims it, the
 * torch picks out the streaks falling through it, the colour grade tints it the
 * same blue the rest of the frame is tinted, and the vignette carries it into
 * the corners with everything else. Nothing here needs to know what time it is,
 * because the two layers above already do — and the point of `SceneMood` is that
 * every pass reads the same mood rather than each inventing its own night.
 *
 * The one thing given up is that heavy rain at midnight is faint. It should be.
 *
 * ── Pooling ──
 *
 * Every sprite in this file is allocated once in the constructor and recycled
 * forever after. A frame writes positions, alphas and tints and allocates
 * nothing at all; the only allocation after construction is a baked streak
 * texture, and those are cached by shape so a settled weather bakes none.
 *
 * ── Staying crisp ──
 *
 * The game is pixel art at a logical 1024 by 768 with nearest sampling, and soft
 * round particles over crisp square terrain look like two different games
 * stapled together. So every particle here is chunky by construction: streaks
 * are baked as actual stair-stepped runs of pixels at the angle they travel
 * rather than drawn as a rotated line, flakes are integer-sized squares, fog is
 * baked small and scaled up by a whole number so its edges stay blocks, and
 * every position written to a sprite is rounded to a pixel.
 *
 * Baking the slant into the texture has a second, better consequence: a particle
 * remembers the velocity it was baked for, so the streak always points exactly
 * where the particle is going. When the wind changes the field turns as
 * particles recycle, over a second or two, instead of every streak pivoting in
 * place.
 *
 * ── Transitions ──
 *
 * Weather flips in a single game tick and must never appear or vanish in one.
 * Two profiles of the same family — rain into heavy rain, fog into eerie mist —
 * are simply interpolated field by field, so the storm gathers. Two profiles of
 * different families cannot be interpolated (a raindrop is not a snowflake), so
 * the layer fades out, swaps underneath at zero, and fades back in.
 */

import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import type { SceneMood } from '../../DrawCommand';

// ─────────────────────────────────────────────────────────────────────────────
// Tunables. Everything the weather is made of lives here.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ceiling on live precipitation particles. The sandstorm asks for the most of
 * it, and past about five hundred at this resolution a screen of streaks stops
 * reading as weather and starts reading as static.
 */
const MAX_PARTICLES = 480;

/** Depth bands. Three is the fewest that reads as volume: something near, something far, something between. */
const BANDS = 3;

/** Fall speed per band, as a multiple of the profile's. The spread is what makes the field look deep rather than layered. */
const BAND_SPEED = [0.58, 1.0, 1.58];

/** Opacity per band. Distance costs contrast before it costs anything else, so the far band is half-there. */
const BAND_ALPHA = [0.46, 0.76, 1.0];

/** Streak length per band, as a multiple of the profile's. Longer near streaks read as faster without moving faster. */
const BAND_LENGTH = [0.62, 1.0, 1.44];

/** Flake side in pixels per band. Integers, because a flake is a square of pixels and 2.5 of them is a blur. */
const BAND_FLAKE = [1, 2, 3];

/** Thickness in pixels of a streak per band. Only the near band earns two, or the screen fills with fat lines. */
const BAND_THICKNESS = [1, 1, 2];

/** Live ground impacts. The camera looks straight down, so these are spread over the whole frame and there have to be enough of them to read as rain landing everywhere. */
const MAX_TICKS = 140;

/** How long one impact lives, in milliseconds. Long enough for both frames of the splash to be seen and short enough that it never reads as a mark on the ground. */
const TICK_LIFE_MS = 190;

/**
 * How much brighter an impact is than the streak that caused it. A drop landing
 * throws up a burst of water lit from every side at once, and drawn at the
 * streaks' own opacity it disappears into the terrain entirely.
 */
const TICK_BRIGHTNESS = 1.8;

/** Fog banks. Nine covers 1024 by 768 in three loose rows with enough overlap that the seams never line up. */
const MAX_BANKS = 9;

/** Base size of the baked fog puff, before it is scaled up. Deliberately tiny: this is what makes the fog chunky. */
const FOG_BASE_W = 40;
const FOG_BASE_H = 12;

/** Whole-number scale-ups of that puff, one per depth. Whole numbers only, so a baked pixel stays a square of screen pixels. */
const FOG_SCALES = [7, 10, 14];

/** Opacity of a bank per depth, as a multiple of the profile's. */
const FOG_DEPTH_ALPHA = [0.55, 0.82, 1.0];

/** Drift speed of a bank per depth, as a multiple of the profile's. Near banks outrun far ones, which is the whole of the parallax. */
const FOG_DEPTH_SPEED = [0.45, 0.85, 1.5];

/** Peak vertical wander of a bank, in pixels. Fog rolls; it does not slide along a rail. */
const FOG_BOB = 26;

/** How far a bank's opacity breathes, as a fraction of it. Banks thinning and thickening out of step is most of what sells fog as a volume. */
const FOG_BREATH = 0.38;

/** How far beyond the edge a particle enters, so the field is not obviously fed from a line. */
const SPAWN_BACKOFF = 46;

/**
 * How far past the edge a particle travels before it is recycled. Comfortably
 * larger than the backoff plus the longest streak, because a particle spawned
 * outside the cull bounds would be recycled on the frame it was created and the
 * count would quietly buy fewer particles than it asked for.
 */
const CULL_MARGIN = 140;

/** Time constant for fading the whole layer in and out across a change of family. */
const FADE_TAU_MS = 1500;

/** Time constant for morphing one profile into another of the same family. Long, so a storm gathers rather than switching on. */
const MORPH_TAU_MS = 2100;

/** Below this the layer is invisible, so it is left out of the display list entirely and the swap is done here. */
const FADE_EPSILON = 0.012;

/** Longest step the easing will honour, so a backgrounded tab does not come back to a field of particles teleporting. */
const MAX_STEP_MS = 100;

/**
 * Angular frequencies in radians per millisecond for the wind, and their
 * weights. Three waves that are not multiples of one another, so the gusting
 * never settles into a rhythm the eye can follow and lock onto.
 */
const WIND_HZ = [0.00031, 0.00097, 0.00234];
const WIND_WEIGHTS = [0.6, 0.28, 0.12];
const WIND_PHASE = [0, 2.2, 4.7];

/** How far a gust swings the fall speed, as a fraction of it. Small: a visible change in speed reads as a frame-rate problem. */
const GUST_SPEED_AMOUNT = 0.09;

/** Angular frequencies for the blood-red sky's pulse. Slower than the wind, because a sky breathes rather than gusts. */
const PULSE_HZ = [0.00019, 0.00061];
const PULSE_WEIGHTS = [0.7, 0.3];

/** Steps the baked alpha of a streak or a fog puff is quantised to. Banding is the point: a smooth ramp is what makes a particle look airbrushed. */
const ALPHA_STEPS = 5;

/** Opacity at the tail of a streak relative to its head, before quantising. A streak is motion blur, and the oldest end of it is the faintest. */
const STREAK_TAIL_ALPHA = 0.34;

/**
 * Pixels the ends of a baked streak are snapped to.
 *
 * A streak is cached by its shape, and a morph between two profiles sweeps
 * continuously through the shapes between them, so without a step the cache
 * would collect a texture for every distinct rounding along the way. Two pixels
 * quarters the reachable set for a change of a few degrees in the streak's
 * angle, and since each particle keeps whichever shape it was born with, the
 * field is always a mixture of neighbouring angles and the step never shows.
 */
const STREAK_QUANTUM = 2;

/**
 * One weather's worth of look. Every field is a number precisely so that two of
 * them can be interpolated coefficient by coefficient during a transition;
 * `family` and `additive` are the two things that cannot be, and together they
 * decide whether a change is a morph or a fade.
 */
interface Profile {
  /** Which texture family the precipitation is drawn from. Not interpolable. */
  family: 'streak' | 'flake';
  /** Whether precipitation is added to the scene rather than blended over it. Not interpolable. */
  additive: boolean;
  /** Live particles at full intensity. */
  count: number;
  /** Velocity of the middle band, in pixels per second. The streak is baked along it, so this is the wind as much as the fall. */
  vx: number;
  vy: number;
  /** Streak length of the middle band, in pixels. Ignored by flakes, which are square. */
  length: number;
  /** Peak lateral wander of a flake, in pixels per second. Ignored by streaks, whose direction is baked. */
  wander: number;
  /** Tint and opacity of one particle. */
  color: number;
  alpha: number;
  /** Ground impacts per second at full intensity. Zero for anything that does not land. */
  ticks: number;
  /** Fog banks alive at full intensity, and how strong each one is. */
  banks: number;
  bankAlpha: number;
  bankColor: number;
  /** Horizontal drift of the middle depth of fog, in pixels per second. */
  bankSpeed: number;
  /** Peak opacity of the full-screen breathing wash. Only a sky that is a mood rather than a precipitation uses it. */
  pulse: number;
  pulseColor: number;
}

/** Clear skies, and the value every unlisted weather id falls back to. */
const PROFILE_CLEAR: Profile = {
  family: 'flake', additive: false,
  count: 0, vx: 0, vy: 0, length: 0, wander: 0,
  color: 0xffffff, alpha: 0,
  ticks: 0,
  banks: 0, bankAlpha: 0, bankColor: 0xffffff, bankSpeed: 0,
  pulse: 0, pulseColor: 0xffffff,
};

/**
 * Keyed by `WeatherType` from `src/world/WeatherSystem.ts`, and by the same ids
 * `Atmosphere` grades. An id with no entry here is clear, so a new weather type
 * costs nothing until someone gives it a line.
 */
const PROFILES: Record<string, Profile> = {
  clear: PROFILE_CLEAR,

  // Cloud is entirely a grade. Atmosphere already flattens and cools it, and
  // there is nothing in the air to draw.
  cloudy: PROFILE_CLEAR,

  // Steady rain. The slant is about seventeen degrees off vertical, which is
  // enough to read as weather rather than as a dropped sheet of lines.
  rain: {
    ...PROFILE_CLEAR,
    family: 'streak',
    count: 250,
    vx: -190, vy: 640,
    length: 13,
    color: 0xb6cdf2, alpha: 0.46,
    ticks: 260,
  },

  // Heavier, faster, longer and steeper, and roughly twice as much of it. Every
  // number here is a push on the same axis as `rain`, so the two interpolate
  // into a storm arriving rather than a second weather appearing.
  heavy_rain: {
    ...PROFILE_CLEAR,
    family: 'streak',
    count: 420,
    vx: -410, vy: 930,
    length: 21,
    color: 0xcfdfff, alpha: 0.58,
    ticks: 640,
    // A storm carries its own low haze, which is what stops heavy rain reading
    // as a wall of lines in front of a perfectly clear picture.
    banks: 4, bankAlpha: 0.07, bankColor: 0x9fb0c8, bankSpeed: 26,
  },

  // Snow barely falls. The lateral wander is larger than the drift, so a flake
  // spends most of its life going sideways, and the near band is three pixels
  // across where the far band is one.
  snow: {
    ...PROFILE_CLEAR,
    family: 'flake',
    count: 270,
    vx: -22, vy: 58,
    wander: 30,
    color: 0xffffff, alpha: 0.82,
  },

  // Fog is banks and nothing else. Atmosphere supplies the flat haze — it lifts
  // black a long way and collapses contrast — so what is missing is structure,
  // and structure is what makes haze read as distance rather than as a filter.
  fog: {
    ...PROFILE_CLEAR,
    banks: 9, bankAlpha: 0.23, bankColor: 0xd6dde8, bankSpeed: 15,
  },

  // The same banks, sicker and slower, with a scatter of faint motes hanging in
  // them. The motes are the whole difference between weather and a haunting.
  eerie_mist: {
    ...PROFILE_CLEAR,
    family: 'flake', additive: true,
    count: 62,
    vx: 7, vy: -9,
    wander: 11,
    color: 0x9ce8bc, alpha: 0.5,
    banks: 9, bankAlpha: 0.25, bankColor: 0x86bfa0, bankSpeed: 8,
  },

  // Sand is the horizontal case: nearly all of the velocity is lateral, so the
  // baked streak comes out as a long flat run of pixels. Dense, warm, and fast
  // enough that a single grain is never resolvable.
  sandstorm: {
    ...PROFILE_CLEAR,
    family: 'streak',
    count: 470,
    vx: 1080, vy: 105,
    length: 17,
    // Nearly white rather than sand-coloured: Atmosphere has already pushed the
    // whole frame amber, and a grain the colour of the ground it is blowing off
    // is a grain nobody can see.
    color: 0xfff0d2, alpha: 0.56,
    // Driven dust, moving with the grains rather than sitting in banks.
    banks: 9, bankAlpha: 0.17, bankColor: 0xc9a05a, bankSpeed: 150,
  },

  // The aurora is light rather than obstruction, so its motes are added to the
  // scene instead of laid over it, and they drift upward.
  magical_aurora: {
    ...PROFILE_CLEAR,
    family: 'flake', additive: true,
    count: 70,
    vx: 26, vy: -30,
    wander: 20,
    color: 0x7cffc4, alpha: 0.42,
  },

  // A blood-red sky is a mood, not a precipitation, and Atmosphere already owns
  // the mood: it tints hard red, pushes saturation and closes the vignette in.
  // Nothing falls out of it, so nothing is drawn falling out of it. The one
  // thing a static grade cannot do is breathe, so that — and only that — is
  // what this profile adds.
  blood_red_sky: {
    ...PROFILE_CLEAR,
    pulse: 0.06, pulseColor: 0xd0181c,
  },
};

/** The particle layer. One instance per backend, updated once per frame. */
export class Weather {
  /** The display object to add to the world, above the drawn frame and below the lighting. */
  readonly layer: Container;

  private readonly width: number;
  private readonly height: number;

  private readonly particles: Particle[] = [];
  private readonly ticks: Impact[] = [];
  private readonly banks: Bank[] = [];
  private readonly pulseSprite: Sprite;

  /** Streaks baked by their shape, so a settled weather bakes nothing per frame. */
  private readonly streaks = new Map<string, Texture>();
  private readonly fogTexture: Texture;
  private readonly tickTextures: Texture[];

  /** Drives the wind, the pulse and the flakes' wander. Accumulated here so it cannot jump. */
  private clockMs = 0;
  private rngState = 0x9e3779b9;

  /** How much of the current profile is showing, from 0 to 1. */
  private fade = 0;
  /** The profile actually being drawn, morphed toward `target` when the two share a family. */
  private readonly current: Profile = { ...PROFILE_CLEAR };
  private target: Profile = PROFILE_CLEAR;
  /** Fractional impacts carried between frames, so a low rate still lands at the right average. */
  private tickDebt = 0;
  private seeded = false;
  /**
   * Whether the next particles to come alive should be scattered over the whole
   * screen rather than entered at the edge. Set whenever the family changes,
   * which is only ever while the layer is invisible, so a weather starts as a
   * field already filling the frame instead of as a front sweeping down it.
   */
  private scatter = true;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.layer = new Container();
    // Nothing here is ever a hit target, and skipping the whole subtree during
    // hit testing costs nothing to ask for.
    this.layer.interactiveChildren = false;

    this.fogTexture = Weather.bakeFog();
    this.tickTextures = Weather.bakeTicks();

    // The order the containers are added in is the depth order of the scene:
    // fog sits behind the rain falling through it, and the impacts on the
    // ground sit behind the near band falling in front of them.
    const fogLayer = new Container();
    const bandLayers = [new Container(), new Container(), new Container()];
    const tickLayer = new Container();
    this.layer.addChild(fogLayer, bandLayers[0], bandLayers[1], tickLayer, bandLayers[2]);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      // The band is fixed for the life of the particle so that its sprite never
      // has to be reparented, which is the only per-frame cost a display list
      // change would add.
      const band = i % BANDS;
      const sprite = new Sprite(Texture.WHITE);
      sprite.visible = false;
      bandLayers[band].addChild(sprite);
      this.particles.push({ sprite, band, x: 0, y: 0, vx: 0, vy: 0, phase: 0, wanderHz: 0, active: false });
    }

    for (let i = 0; i < MAX_TICKS; i++) {
      const sprite = new Sprite(this.tickTextures[0]);
      sprite.visible = false;
      tickLayer.addChild(sprite);
      this.ticks.push({ sprite, lifeMs: 0 });
    }

    for (let i = 0; i < MAX_BANKS; i++) {
      const depth = i % FOG_SCALES.length;
      const sprite = new Sprite(this.fogTexture);
      sprite.visible = false;
      sprite.scale.set(FOG_SCALES[depth]);
      fogLayer.addChild(sprite);
      // Banks are laid out on a loose grid rather than at random, because nine
      // random positions leave a hole about a third of the time.
      const column = i % 3;
      const row = Math.floor(i / 3);
      this.banks.push({
        sprite,
        depth,
        x: (column * this.width) / 3 + this.random() * 160 - 80,
        y: (row + 0.5) * (this.height / 3) - (FOG_BASE_H * FOG_SCALES[depth]) / 2 + this.random() * 60 - 30,
        phase: this.random() * Math.PI * 2,
      });
    }

    this.pulseSprite = new Sprite(Texture.WHITE);
    this.pulseSprite.width = width;
    this.pulseSprite.height = height;
    // Added rather than blended: a sky that is glowing red is emitting light,
    // and laying opaque red over the frame would only flatten it.
    this.pulseSprite.blendMode = 'add';
    this.pulseSprite.visible = false;
    this.layer.addChild(this.pulseSprite);
  }

  /** False when the layer would draw nothing, so the backend can leave it out of the display list. */
  get active(): boolean {
    return this.fade > FADE_EPSILON;
  }

  /**
   * Move the weather one frame on.
   *
   * `elapsedMs` is the time since the previous call, not a running total, so a
   * frame rate change alters neither how fast rain falls nor how long a front
   * takes to arrive.
   */
  update(mood: SceneMood, elapsedMs: number): void {
    const dt = clamp(elapsedMs, 0, MAX_STEP_MS);
    this.clockMs += dt;

    // Weather belongs to the sky, so a sealed corridor has none of it whatever
    // the overworld is doing.
    const id = mood.underground ? null : mood.weather;
    this.target = (id !== null ? PROFILES[id] : undefined) ?? PROFILE_CLEAR;

    this.trackProfile(dt);
    if (!this.active) {
      this.layer.visible = false;
      return;
    }
    this.layer.visible = true;

    const gust = wobble(this.clockMs, WIND_HZ, WIND_PHASE, WIND_WEIGHTS);
    this.updateParticles(dt, gust);
    this.updateTicks(dt);
    this.updateBanks(dt, gust);
    this.updatePulse();
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    // The sprites above do not own any of these, so they are released here.
    for (const texture of this.streaks.values()) texture.destroy(true);
    this.streaks.clear();
    this.fogTexture.destroy(true);
    for (const texture of this.tickTextures) texture.destroy(true);
  }

  // ── Transitions ──

  /**
   * Ease the layer toward the weather the mood is asking for.
   *
   * Two profiles of the same family are the same particles with different
   * numbers, so the numbers are simply interpolated and the layer never dips:
   * rain thickening into heavy rain is one continuous storm. Two profiles of
   * different families share nothing that can be interpolated, so the layer
   * fades to nothing, swaps while it is invisible, and fades back.
   */
  private trackProfile(dt: number): void {
    const target = this.target;
    const compatible = target.family === this.current.family && target.additive === this.current.additive;

    if (!this.seeded) {
      // The first frame is whatever the weather already is, rather than a front
      // rolling in over the title screen.
      this.seeded = true;
      copyProfile(this.current, target);
      this.applyBlend();
      this.fade = target === PROFILE_CLEAR ? 0 : 1;
      return;
    }

    if (compatible) {
      morphProfile(this.current, target, dt, MORPH_TAU_MS);
      // A profile that asks for nothing at all is still a fade-out, because
      // interpolating every field to zero would shrink the streaks to nothing
      // rather than let them thin out.
      this.fade = approach(this.fade, target === PROFILE_CLEAR ? 0 : 1, dt, FADE_TAU_MS);
      return;
    }

    this.fade = approach(this.fade, 0, dt, FADE_TAU_MS);
    if (this.fade > FADE_EPSILON) return;

    // Invisible: this is the only moment at which the family, and with it every
    // sprite's blend mode, can change without anyone seeing it happen.
    copyProfile(this.current, target);
    this.applyBlend();
    this.scatter = true;
    for (const p of this.particles) {
      p.active = false;
      p.sprite.visible = false;
    }
  }

  /** Set the blend mode of every particle at once, done only on a family swap. */
  private applyBlend(): void {
    const mode = this.current.additive ? 'add' : 'normal';
    for (const p of this.particles) p.sprite.blendMode = mode;
  }

  // ── Precipitation ──

  private updateParticles(dt: number, gust: number): void {
    const p = this.current;
    const want = Math.round(p.count * this.fade);
    if (want <= 0) {
      for (const particle of this.particles) {
        if (!particle.active) continue;
        particle.active = false;
        particle.sprite.visible = false;
      }
      return;
    }

    const seconds = dt / 1000;
    const speed = 1 + gust * GUST_SPEED_AMOUNT;
    const streak = p.family === 'streak';

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const particle = this.particles[i];
      const wanted = i < want;

      if (!particle.active) {
        // A particle only ever comes back at the edge, so raising the count in
        // the middle of a storm cannot make one appear in mid-air. The one
        // exception is a fresh weather, which is scattered while invisible.
        if (!wanted) continue;
        this.spawn(particle, streak, this.scatter);
      }

      particle.x += particle.vx * seconds * speed;
      particle.y += particle.vy * seconds * speed;
      if (!streak) {
        // Only flakes wander. A streak points along the velocity it was baked
        // for, so nudging it sideways would break the one thing the baking buys.
        particle.x += Math.sin(this.clockMs * particle.wanderHz + particle.phase) * p.wander * seconds;
      }

      if (this.offscreen(particle)) {
        if (!wanted) {
          // Retired at the edge rather than mid-flight, so thinning rain thins
          // out instead of switching particles off in front of the player.
          particle.active = false;
          particle.sprite.visible = false;
          continue;
        }
        this.spawn(particle, streak, false);
      }

      const sprite = particle.sprite;
      sprite.alpha = p.alpha * BAND_ALPHA[particle.band] * this.fade;
      sprite.tint = p.color;
      // Rounded on the way to the sprite and not in the particle's own state,
      // so the rounding never accumulates into a drift in the trajectory.
      sprite.position.set(Math.round(particle.x), Math.round(particle.y));
    }

    this.scatter = false;
  }

  /** Put a particle back at the edge the weather is coming from, with the velocity its texture is baked for. */
  private spawn(particle: Particle, streak: boolean, scatter: boolean): void {
    const p = this.current;
    const band = particle.band;
    const vx = p.vx * BAND_SPEED[band];
    const vy = p.vy * BAND_SPEED[band];

    particle.vx = vx;
    particle.vy = vy;
    particle.phase = this.random() * Math.PI * 2;
    // A spread of wander rates rather than one, or every flake in the field
    // sways in unison and the whole thing reads as a single swinging sheet.
    particle.wanderHz = 0.0007 + this.random() * 0.0016;
    particle.active = true;

    const sprite = particle.sprite;
    sprite.visible = true;

    let w: number;
    let h: number;
    if (streak) {
      const texture = this.streakTexture(vx, vy, p.length * BAND_LENGTH[band], BAND_THICKNESS[band]);
      sprite.texture = texture;
      sprite.scale.set(1);
      w = texture.width;
      h = texture.height;
    } else {
      const size = BAND_FLAKE[band];
      sprite.texture = Texture.WHITE;
      // Written as a scale rather than as width and height because `Texture.WHITE`
      // is one pixel, so the two are the same number and the scale is one write.
      sprite.scale.set(size);
      w = size;
      h = size;
    }

    if (scatter) {
      // Used once, on the first frame of a weather, so it starts as a field
      // already filling the screen rather than as a front sweeping down it.
      particle.x = this.random() * (this.width + w) - w;
      particle.y = this.random() * (this.height + h) - h;
      return;
    }

    // The entry edge is whichever one the velocity is pointing away from. The
    // dominant axis picks the edge; the other axis is scattered along it.
    if (Math.abs(vy) >= Math.abs(vx)) {
      particle.x = this.random() * (this.width + 2 * SPAWN_BACKOFF) - SPAWN_BACKOFF;
      particle.y = vy >= 0 ? -h - this.random() * SPAWN_BACKOFF : this.height + this.random() * SPAWN_BACKOFF;
    } else {
      particle.y = this.random() * (this.height + 2 * SPAWN_BACKOFF) - SPAWN_BACKOFF;
      particle.x = vx >= 0 ? -w - this.random() * SPAWN_BACKOFF : this.width + this.random() * SPAWN_BACKOFF;
    }
  }

  private offscreen(particle: Particle): boolean {
    return (
      particle.x < -CULL_MARGIN
      || particle.x > this.width + CULL_MARGIN
      || particle.y < -CULL_MARGIN
      || particle.y > this.height + CULL_MARGIN
    );
  }

  // ── Ground impacts ──

  /**
   * The little crowns rain throws up where it lands.
   *
   * The camera looks straight down, so there is no horizon and every pixel on
   * the screen is ground: impacts are scattered over the whole frame rather
   * than along a line. They cost almost nothing and they are the single cheapest
   * thing that makes rain look like it is landing somewhere rather than falling
   * in front of a picture.
   */
  private updateTicks(dt: number): void {
    const p = this.current;
    const rate = p.ticks * this.fade;
    const bright = clamp(p.alpha * TICK_BRIGHTNESS, 0, 1) * this.fade;

    for (const tick of this.ticks) {
      if (tick.lifeMs <= 0) continue;
      tick.lifeMs -= dt;
      if (tick.lifeMs <= 0) {
        tick.sprite.visible = false;
        continue;
      }
      const life = tick.lifeMs / TICK_LIFE_MS;
      // Two frames of splash: a dot, then a wider crown that fades out.
      tick.sprite.texture = this.tickTextures[life > 0.55 ? 0 : 1];
      tick.sprite.alpha = bright * life;
      tick.sprite.tint = p.color;
    }

    if (rate <= 0) return;
    // The fractional part is carried rather than rounded away, so a slow drizzle
    // still lands at the rate it asked for instead of never landing at all.
    this.tickDebt += (rate * dt) / 1000;
    let spawns = Math.floor(this.tickDebt);
    this.tickDebt -= spawns;

    for (const tick of this.ticks) {
      if (spawns <= 0) break;
      if (tick.lifeMs > 0) continue;
      tick.lifeMs = TICK_LIFE_MS;
      tick.sprite.visible = true;
      tick.sprite.texture = this.tickTextures[0];
      tick.sprite.alpha = bright;
      tick.sprite.tint = p.color;
      tick.sprite.position.set(
        Math.round(this.random() * this.width),
        Math.round(this.random() * this.height),
      );
      spawns--;
    }
    // Whatever the pool could not seat is dropped rather than queued: an impact
    // that lands a frame late is an impact in the wrong place.
    this.tickDebt = 0;
  }

  // ── Fog ──

  private updateBanks(dt: number, gust: number): void {
    const p = this.current;
    const want = Math.round(p.banks * this.fade);
    const seconds = dt / 1000;

    for (let i = 0; i < MAX_BANKS; i++) {
      const bank = this.banks[i];
      if (i >= want) {
        bank.sprite.visible = false;
        continue;
      }

      const scale = FOG_SCALES[bank.depth];
      const w = FOG_BASE_W * scale;

      bank.x += p.bankSpeed * FOG_DEPTH_SPEED[bank.depth] * (1 + gust * 0.5) * seconds;
      // Wrapped through the full width plus the bank, so a bank leaving on the
      // right is already back on the left before its trailing edge is gone.
      const span = this.width + w;
      if (bank.x > this.width) bank.x -= span;
      else if (bank.x < -w) bank.x += span;

      const bob = Math.sin(this.clockMs * 0.00017 + bank.phase) * FOG_BOB;
      // The breath is per bank and out of phase, so the field thins and
      // thickens unevenly the way a real bank does, rather than pulsing whole.
      const breath = 1 + Math.sin(this.clockMs * 0.00029 + bank.phase * 1.7) * FOG_BREATH;

      const sprite = bank.sprite;
      sprite.visible = true;
      sprite.tint = p.bankColor;
      sprite.alpha = Math.max(0, p.bankAlpha * FOG_DEPTH_ALPHA[bank.depth] * breath * this.fade);
      // Snapped to the scale's own grid so the baked pixels stay square blocks
      // rather than shimmering between two screen pixels as the bank drifts.
      sprite.position.set(Math.round(bank.x / scale) * scale, Math.round((bank.y + bob) / scale) * scale);
    }
  }

  // ── The sky itself ──

  private updatePulse(): void {
    const p = this.current;
    if (p.pulse <= 0) {
      this.pulseSprite.visible = false;
      return;
    }
    const breath = 0.5 + 0.5 * wobble(this.clockMs, PULSE_HZ, WIND_PHASE, PULSE_WEIGHTS);
    this.pulseSprite.visible = true;
    this.pulseSprite.tint = p.pulseColor;
    this.pulseSprite.alpha = p.pulse * breath * this.fade;
  }

  // ── Baking ──

  /**
   * A streak, baked as the actual run of pixels a particle travelling along
   * `(vx, vy)` would leave.
   *
   * Rotating a sprite would be one line and would be wrong: a rotated line
   * sampled with nearest neighbour crawls as its angle changes and its ends go
   * soft, and the whole point of this game's look is that a pixel is a pixel.
   * Walking the line and setting whole pixels gives the stair-stepping that
   * hand-drawn pixel-art rain has, for free.
   *
   * The shape is quantised before it is cached, so a weather that has settled
   * asks for the same handful of textures forever and a transition bakes a few
   * more on its way through.
   */
  private streakTexture(vx: number, vy: number, length: number, thickness: number): Texture {
    const speed = Math.hypot(vx, vy) || 1;
    const len = Math.max(4, Math.round(length));
    // The dominant axis is floored at one quantum so a shallow streak cannot
    // round away to a single block.
    const horizontal = Math.abs(vx) >= Math.abs(vy);
    const dx = snap((vx / speed) * len, horizontal);
    const dy = snap((vy / speed) * len, !horizontal);
    const key = `${dx},${dy},${thickness}`;

    const cached = this.streaks.get(key);
    if (cached) return cached;

    const texture = Weather.bakeStreak(dx, dy, thickness);
    this.streaks.set(key, texture);
    return texture;
  }

  private static bakeStreak(dx: number, dy: number, thickness: number): Texture {
    const width = Math.abs(dx) + thickness;
    const height = Math.abs(dy) + thickness;
    const rgba = new Uint8Array(width * height * 4);

    // Start at whichever corner puts the whole line inside the texture, then
    // walk one pixel per step along the dominant axis.
    const x0 = dx < 0 ? -dx : 0;
    const y0 = dy < 0 ? -dy : 0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));

    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 1 : s / steps;
      // The head of the streak is the end it is travelling toward, and it is
      // the brightest: what is behind it is the smear the eye reads as speed.
      const a = quantise(STREAK_TAIL_ALPHA + (1 - STREAK_TAIL_ALPHA) * t, ALPHA_STEPS);
      const px = x0 + Math.round(dx * t);
      const py = y0 + Math.round(dy * t);
      for (let oy = 0; oy < thickness; oy++) {
        for (let ox = 0; ox < thickness; ox++) {
          const x = px + ox;
          const y = py + oy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          writePremultipliedWhite(rgba, (y * width + x) * 4, a);
        }
      }
    }

    return makeTexture(rgba, width, height);
  }

  /**
   * The two frames of a raindrop landing: a dot, and the crown it throws up.
   *
   * Hand-authored as pixel maps rather than computed, because at five pixels
   * across there is no formula, there is only which pixels are lit.
   */
  private static bakeTicks(): Texture[] {
    const frames = [
      ['..#..',
       '.#.#.'],
      ['#...#',
       '.#.#.',
       '..#..'],
    ];
    return frames.map((rows) => {
      const width = rows[0].length;
      const height = rows.length;
      const rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (rows[y][x] !== '#') continue;
          writePremultipliedWhite(rgba, (y * width + x) * 4, 1);
        }
      }
      return makeTexture(rgba, width, height);
    });
  }

  /**
   * One fog puff, baked forty pixels across and scaled up by a whole number.
   *
   * Baking small is the trick that makes fog belong in a pixel-art frame. A
   * softly shaded blob drawn at full size is an airbrush stroke; the same blob
   * drawn at a fortieth of the size and blown up with nearest sampling is a
   * lump of chunky blocks whose edges match the terrain's. The alpha is
   * quantised on top of that, so even within one puff the density steps.
   *
   * The shape is an ellipse eaten into by two octaves of value noise, which is
   * what keeps nine copies of one texture from reading as nine copies of one
   * texture.
   */
  private static bakeFog(): Texture {
    const width = FOG_BASE_W;
    const height = FOG_BASE_H;
    const rgba = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      const ny = (y + 0.5) / height * 2 - 1;
      for (let x = 0; x < width; x++) {
        const nx = (x + 0.5) / width * 2 - 1;
        // Falls off to nothing at the rim so banks have no edge to give away
        // that they are rectangles.
        const r = Math.min(1, Math.hypot(nx, ny * 0.95));
        const shape = Math.pow(1 - r, 1.5);
        const noise = 0.55 * valueNoise(x * 0.22, y * 0.5) + 0.45 * valueNoise(x * 0.55, y * 1.1);
        const a = quantise(clamp(shape * (0.26 + 1.15 * noise), 0, 1), ALPHA_STEPS);
        writePremultipliedWhite(rgba, (y * width + x) * 4, a);
      }
    }

    return makeTexture(rgba, width, height);
  }

  /** A small deterministic generator, so a reload gives the same field rather than a different one. */
  private random(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x;
    return ((x >>> 0) % 100000) / 100000;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pooled state
// ─────────────────────────────────────────────────────────────────────────────

interface Particle {
  sprite: Sprite;
  /** Fixed at construction so the sprite never has to be reparented. */
  band: number;
  x: number;
  y: number;
  /** Held on the particle rather than read from the profile, so the motion always matches the baked streak. */
  vx: number;
  vy: number;
  phase: number;
  wanderHz: number;
  active: boolean;
}

interface Impact {
  sprite: Sprite;
  lifeMs: number;
}

interface Bank {
  sprite: Sprite;
  depth: number;
  x: number;
  y: number;
  phase: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move `current` a fraction of the way to `target`, framerate independently.
 * The same exponential the lighting and the atmosphere ease with, so a weather
 * front, a nightfall and a torch all settle at rates that can be compared.
 */
function approach(current: number, target: number, dt: number, tauMs: number): number {
  if (tauMs <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tauMs));
}

function clamp(v: number, lo: number, hi: number): number {
  return v >= lo ? (v > hi ? hi : v) : lo;
}

/** Snap a streak's extent to the quantum, keeping at least one of them where the axis is the one the streak runs along. */
function snap(v: number, dominant: boolean): number {
  const q = Math.round(v / STREAK_QUANTUM) * STREAK_QUANTUM;
  if (!dominant || q !== 0) return q;
  return v < 0 ? -STREAK_QUANTUM : STREAK_QUANTUM;
}

/** Snap to one of `steps` levels between 0 and 1. Deliberate banding; see the fog bake. */
function quantise(v: number, steps: number): number {
  return Math.round(clamp(v, 0, 1) * steps) / steps;
}

/** Several sine waves summed to roughly minus one to one, weights summing to one. */
function wobble(t: number, hz: number[], phase: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < hz.length; i++) sum += weights[i] * Math.sin(t * hz[i] + phase[i]);
  return sum;
}

/** Deterministic hash of a lattice point, from 0 to 1. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Bilinear value noise on the integer lattice. */
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi) + (hash2(xi + 1, yi) - hash2(xi, yi)) * sx;
  const b = hash2(xi, yi + 1) + (hash2(xi + 1, yi + 1) - hash2(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}

/**
 * Write one white pixel at `alpha` into a premultiplied buffer.
 *
 * White is the only colour baked, because every particle's actual colour comes
 * from its sprite tint: one texture then serves rain, sand and mist, and a
 * transition between two of them costs a tint write rather than a re-bake.
 */
function writePremultipliedWhite(rgba: Uint8Array, i: number, alpha: number): void {
  const a = Math.round(clamp(alpha, 0, 1) * 255);
  rgba[i] = a;
  rgba[i + 1] = a;
  rgba[i + 2] = a;
  rgba[i + 3] = a;
}

/** Wrap a premultiplied RGBA buffer as a texture, with the settings pixel art wants. */
function makeTexture(rgba: Uint8Array, width: number, height: number): Texture {
  const source = new BufferImageSource({
    resource: rgba,
    width,
    height,
    // Without this the buffer source guesses BGRA from a byte array and every
    // tint comes out with red and blue swapped.
    format: 'rgba8unorm',
    // The bytes above are written premultiplied, which is what Pixi's default
    // blending expects.
    alphaMode: 'premultiplied-alpha',
    // The whole point of baking small and scaling up: nearest keeps a baked
    // pixel a square block instead of smearing it into the terrain.
    scaleMode: 'nearest',
    // Wanted on every frame it is raining, so letting the collector unload it
    // would be pure waste.
    autoGarbageCollect: false,
  });
  return new Texture({ source });
}

function copyProfile(out: Profile, from: Profile): void {
  out.family = from.family;
  out.additive = from.additive;
  out.count = from.count;
  out.vx = from.vx;
  out.vy = from.vy;
  out.length = from.length;
  out.wander = from.wander;
  out.color = from.color;
  out.alpha = from.alpha;
  out.ticks = from.ticks;
  out.banks = from.banks;
  out.bankAlpha = from.bankAlpha;
  out.bankColor = from.bankColor;
  out.bankSpeed = from.bankSpeed;
  out.pulse = from.pulse;
  out.pulseColor = from.pulseColor;
}

/** Ease every interpolable field of `out` toward `to`. Colours are eased per channel, which is what keeps a hue from swinging through grey. */
function morphProfile(out: Profile, to: Profile, dt: number, tauMs: number): void {
  out.count = approach(out.count, to.count, dt, tauMs);
  out.vx = approach(out.vx, to.vx, dt, tauMs);
  out.vy = approach(out.vy, to.vy, dt, tauMs);
  out.length = approach(out.length, to.length, dt, tauMs);
  out.wander = approach(out.wander, to.wander, dt, tauMs);
  out.alpha = approach(out.alpha, to.alpha, dt, tauMs);
  out.ticks = approach(out.ticks, to.ticks, dt, tauMs);
  out.banks = approach(out.banks, to.banks, dt, tauMs);
  out.bankAlpha = approach(out.bankAlpha, to.bankAlpha, dt, tauMs);
  out.bankSpeed = approach(out.bankSpeed, to.bankSpeed, dt, tauMs);
  out.pulse = approach(out.pulse, to.pulse, dt, tauMs);
  out.color = approachColor(out.color, to.color, dt, tauMs);
  out.bankColor = approachColor(out.bankColor, to.bankColor, dt, tauMs);
  out.pulseColor = approachColor(out.pulseColor, to.pulseColor, dt, tauMs);
}

function approachColor(current: number, target: number, dt: number, tauMs: number): number {
  const r = approach((current >> 16) & 0xff, (target >> 16) & 0xff, dt, tauMs);
  const g = approach((current >> 8) & 0xff, (target >> 8) & 0xff, dt, tauMs);
  const b = approach(current & 0xff, target & 0xff, dt, tauMs);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

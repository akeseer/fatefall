/**
 * The lighting pass: one darkening layer that turns an evenly drawn map into a
 * lit scene.
 *
 * The map renderer paints every tile at the same brightness whether it is noon
 * on the plains or the fourth floor of a tomb, so all of the atmosphere has to
 * come from what is composited on top. `SceneMood` carries everything needed to
 * decide that: where the party is standing, whether the only light in the world
 * is the torch they are holding, and how much sun is left in the sky.
 *
 * ── The composite ──
 *
 * Every object in this layer is drawn with the `multiply` blend mode. That
 * choice is the whole design and it is worth being precise about why, because
 * the obvious alternative produces the grey wash that makes so many 2D games
 * look fogged rather than lit.
 *
 * Pixi's `multiply` is `src * DST_COLOR + dst * (1 - SRC_ALPHA)` over a
 * premultiplied source, which for a source colour `c` at alpha `a` works out to
 *
 *     result = dst * ((1 - a) + a * c)
 *
 * so the layer can only ever scale the world down, never paint over it. Two
 * useful properties fall out of that single line:
 *
 *  - The alpha is a darkness dial. Where the layer's colour is black, the world
 *    is left at `1 - a` of its brightness, so `a` alone sets how deep the
 *    shadows go and the same number works for a moonlit field and a lightless
 *    crypt.
 *  - The colour is a light. Where the layer's colour is white the world comes
 *    through untouched at full brightness, which is what makes the torch reveal
 *    the actual pixels of the map instead of laying a warm blob over them. An
 *    additive or screened light cannot do this: it adds its own colour to a
 *    scene that has already been crushed to near black, so the detail that was
 *    destroyed by the darkening never comes back.
 *
 * ── The geometry ──
 *
 * Because a multiply layer compounds wherever two of its pieces overlap, the
 * layer is built as an exact tiling of the screen with no overlap at all: one
 * sprite carrying the radial falloff, centred on the party, and four flat black
 * sprites filling the band of screen above, below, left and right of it. The
 * falloff texture reaches pure black at its inscribed circle and stays black in
 * the corners, so it meets the flat sprites at the same value and the seam is
 * invisible. Overlaying a full-screen darkening rectangle instead would square
 * the darkening under the torch and there would be no way to open a hole in it.
 *
 * The falloff itself is baked into a texture once, at construction. Redrawing a
 * radial gradient every frame would mean re-uploading a megabyte of pixels at
 * sixty hertz for a shape that never changes; the shape is fixed and only its
 * size, position, tint and alpha vary, and all four of those are free.
 */

import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import type { SceneMood } from '../../DrawCommand';
import { themeLight } from '../../ThemeLight';

// ── Tunables ──

/**
 * How far the world is crushed underground.
 *
 * Much gentler than it looks like it should be, for two reasons. The dungeon
 * palettes are already dark by design — a dragon graveyard's floor is #241a1a
 * before anything is done to it — and multiplying dark art by a dark layer
 * only ever reaches black, so the torch has nothing left to reveal. And the
 * fog of war already does the work this number looks like it should do: a room
 * the party has not walked into is not drawn at all. What is left for this to
 * do is give the lit part of the floor a falling-off edge, not hide it.
 */
const UNDERGROUND_DARKNESS = 0.45;

/**
 * Radius in pixels at which the carried torch has fallen to nothing. Wide
 * enough to cover the room the party is standing in at the game's 1024 by 768,
 * so what they are fighting is always lit and the rest of the floor is not.
 */
const TORCH_RADIUS = 310;

/** How far the world is crushed outdoors at true midnight. Well short of the dungeon so the map stays readable. */
const OUTDOOR_NIGHT_DARKNESS = 0.55;

/** Shapes dusk. Above 1 the light holds through the evening and then goes quickly, which reads as sunset. */
const OUTDOOR_NIGHT_CURVE = 1.7;

/** Radius of the soft glow kept around the party at night outdoors, so they never vanish into the dark. */
const OUTDOOR_GLOW_RADIUS = 380;

/** How much of the night the outdoor glow lifts, 0 for none and 1 for full daylight at its centre. */
const OUTDOOR_GLOW_STRENGTH = 0.55;

/** How much wider the light opens during a fight. A fight must never be harder to read than the walk to it. */
const COMBAT_RADIUS_GAIN = 1.3;

/** How much of the darkness is lifted during a fight, as a multiplier on it. */
const COMBAT_DARKNESS_RELIEF = 0.82;

/** How far flicker is damped during a fight, where a breathing radius would read as something moving. */
const COMBAT_FLICKER_CALM = 0.3;

/** Peak swing of the torch radius from flicker, as a fraction of it. Past about 0.08 it stops reading as flame. */
const FLICKER_RADIUS_AMOUNT = 0.05;

/** Peak swing of the torch brightness from flicker, as a fraction of it. */
const FLICKER_BRIGHTNESS_AMOUNT = 0.075;

/** Time constant for changes in darkness. Long, because a step in overall brightness is the most visible artefact there is. */
const DARKNESS_TAU_MS = 420;

/** Time constant for changes in light radius. */
const RADIUS_TAU_MS = 260;

/** Time constant for the light following the party. Short enough not to lag a walk, long enough to smooth the tile steps. */
const FOCUS_TAU_MS = 95;

/** Time constant for crossing between the torch underground and the ambient night above it. */
const MODE_TAU_MS = 520;

/**
 * A jump in focus further than this is a cut rather than a walk, and is
 * followed instantly. Sliding the light across the screen after a camera cut
 * looks like the party was dragged there; only the position is ever cut, and
 * brightness always eases.
 */
const FOCUS_CUT_DISTANCE = 260;

/** Longest step the smoothing will honour, so a backgrounded tab does not come back with a jump. */
const MAX_STEP_MS = 100;

/** Below this darkness the layer is doing nothing the eye can see, so it is skipped. */
const DARKNESS_EPSILON = 0.004;

/** Side of the baked falloff texture. Large enough that the core survives being scaled up, small enough to stay a megabyte. */
const LIGHT_TEXTURE_SIZE = 512;

/** Fraction of the radius held at full brightness before the falloff starts, which is the bright pool underfoot. */
const TORCH_CORE_FRACTION = 0.16;

/** Steepness of the falloff. Higher is a tighter pool of light with a longer, fainter tail. */
const TORCH_FALLOFF_EXPONENT = 2.1;

/** Colour of the light at its centre. Slightly starved of blue, because flame is warm. */
const TORCH_CORE_COLOR = [1.0, 0.94, 0.82];

/** Colour the light drifts toward as it dims, which cools the fringe the way real firelight does. */
const TORCH_EDGE_COLOR = [0.62, 0.74, 1.0];

/** Tint of the outdoor glow, standing in for moonlight rather than flame. */
const MOONLIGHT_COLOR = [0.76, 0.85, 1.0];

/** Extra darkening per weather id, added to whatever the sky already costs. Unlisted weather adds nothing. */
const WEATHER_DIM: Record<string, number> = {
  cloudy: 0.1,
  rain: 0.2,
  heavy_rain: 0.32,
  fog: 0.22,
  snow: 0.12,
  sandstorm: 0.34,
  eerie_mist: 0.26,
  blood_red_sky: 0.14,
};

/**
 * Angular frequencies in radians per millisecond for the flicker, three for the
 * radius and three for the brightness. They are deliberately not multiples of
 * one another, so the sum has no period the ear or eye can find and the flame
 * never settles into a visible loop.
 */
const FLICKER_RADIUS_HZ = [0.0089, 0.0213, 0.0527];
const FLICKER_BRIGHT_HZ = [0.0071, 0.0181, 0.0439];

/** Weights of those three waves, summing to one so the result stays inside plus or minus one. */
const FLICKER_WEIGHTS = [0.55, 0.3, 0.15];

/** Phase offsets keeping the two flickers from lining up and pulsing together. */
const FLICKER_RADIUS_PHASE = [0, 1.7, 4.1];
const FLICKER_BRIGHT_PHASE = [0.6, 2.4, 5.2];

/** The lit scene: a torch underground, ambient night above it, composited by multiplication. */
export class Lighting {
  /** The display object to add above the world. */
  readonly layer: Container;

  private readonly lightTexture: Texture;
  private readonly light: Sprite;
  /** Top, bottom, left and right of the light's square, tiling the rest of the screen exactly once. */
  private readonly shadows: Sprite[];

  private readonly width: number;
  private readonly height: number;

  /** Runs the flicker. Accumulated here rather than taken from the caller so it cannot jump. */
  private clockMs = 0;
  /** False until the first update, which is taken as read instead of eased into from nothing. */
  private seeded = false;

  // Everything below is the eased state, one field per thing that must never step.
  private darkness = 0;
  private radius = TORCH_RADIUS;
  private lift = 1;
  private torch = 0;
  private calm = 1;
  private focusX = 0;
  private focusY = 0;
  /** The colour of the carried light, eased per channel so a new floor does not flash. */
  private lr = 1;
  private lg = 1;
  private lb = 1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.focusX = width / 2;
    this.focusY = height / 2;

    this.lightTexture = Lighting.bakeLight();

    this.layer = new Container();
    // Nothing here is ever a hit target, and skipping the layer during hit
    // testing costs nothing to ask for.
    this.layer.interactiveChildren = false;

    this.shadows = [];
    for (let i = 0; i < 4; i++) {
      const shadow = new Sprite(Texture.WHITE);
      shadow.tint = 0x000000;
      shadow.blendMode = 'multiply';
      this.shadows.push(shadow);
      this.layer.addChild(shadow);
    }

    this.light = new Sprite(this.lightTexture);
    // Anchoring at the middle means the party's position is written straight to
    // the sprite, with no arithmetic per frame.
    this.light.anchor.set(0.5);
    this.light.blendMode = 'multiply';
    this.layer.addChild(this.light);
  }

  /**
   * Recompute the layer for this frame.
   *
   * `elapsedMs` is the time since the previous call, not a running total. It
   * drives both the easing and the flicker, so a frame rate change alters
   * neither the speed of a fade nor the rhythm of the flame.
   */
  update(mood: SceneMood, elapsedMs: number): void {
    const dt = Math.max(0, Math.min(MAX_STEP_MS, elapsedMs));
    this.clockMs += dt;

    // ── What this frame is asking for ──

    const underground = mood.underground;
    let darknessTarget: number;
    let radiusTarget: number;
    let liftTarget: number;

    if (underground) {
      darknessTarget = UNDERGROUND_DARKNESS;
      radiusTarget = TORCH_RADIUS;
      // A carried torch reads as a real light source only if its centre returns
      // the world to full brightness, so nothing is held back underground.
      liftTarget = 1;
    } else {
      const night = clamp01(1 - mood.daylight);
      darknessTarget = OUTDOOR_NIGHT_DARKNESS * Math.pow(night, OUTDOOR_NIGHT_CURVE);
      radiusTarget = OUTDOOR_GLOW_RADIUS;
      liftTarget = OUTDOOR_GLOW_STRENGTH;

      // Weather is folded in as a fraction of the light that is left rather
      // than added, so a storm at midnight cannot push past full black.
      const dim = (mood.weather && WEATHER_DIM[mood.weather]) || 0;
      darknessTarget += (1 - darknessTarget) * dim;

      // Without a focus there is no party to glow around, and outdoors a flat
      // dimming is the correct answer. Underground it would be a black screen,
      // so there the light stays wherever it last was.
      if (!mood.focus) radiusTarget = 0;
    }

    if (mood.inCombat) {
      radiusTarget *= COMBAT_RADIUS_GAIN;
      darknessTarget *= COMBAT_DARKNESS_RELIEF;
    }

    const focusX = mood.focus ? mood.focus.x : this.width / 2;
    const focusY = mood.focus ? mood.focus.y : this.height / 2;

    // ── Easing ──

    if (!this.seeded) {
      // The first frame is the scene as it stands rather than a fade up from
      // black, which would otherwise greet every player at the title.
      this.seeded = true;
      this.darkness = darknessTarget;
      this.radius = radiusTarget;
      this.lift = liftTarget;
      this.torch = underground ? 1 : 0;
      this.calm = mood.inCombat ? COMBAT_FLICKER_CALM : 1;
      [this.lr, this.lg, this.lb] = themeLight(mood.themeId);
      this.focusX = focusX;
      this.focusY = focusY;
    } else {
      this.darkness = approach(this.darkness, darknessTarget, dt, DARKNESS_TAU_MS);
      this.radius = approach(this.radius, radiusTarget, dt, RADIUS_TAU_MS);
      this.lift = approach(this.lift, liftTarget, dt, RADIUS_TAU_MS);
      this.torch = approach(this.torch, underground ? 1 : 0, dt, MODE_TAU_MS);
      this.calm = approach(this.calm, mood.inCombat ? COMBAT_FLICKER_CALM : 1, dt, MODE_TAU_MS);
      const want = themeLight(mood.themeId);
      this.lr = approach(this.lr, want[0], dt, MODE_TAU_MS);
      this.lg = approach(this.lg, want[1], dt, MODE_TAU_MS);
      this.lb = approach(this.lb, want[2], dt, MODE_TAU_MS);

      const dx = focusX - this.focusX;
      const dy = focusY - this.focusY;
      if (dx * dx + dy * dy > FOCUS_CUT_DISTANCE * FOCUS_CUT_DISTANCE) {
        this.focusX = focusX;
        this.focusY = focusY;
      } else {
        this.focusX = approach(this.focusX, focusX, dt, FOCUS_TAU_MS);
        this.focusY = approach(this.focusY, focusY, dt, FOCUS_TAU_MS);
      }
    }

    // ── Flicker ──

    // Flicker belongs to flame, so it is scaled by how much of a carried torch
    // there is and damped again while a fight is being read. It is applied on
    // top of the eased values rather than to them, because it is already
    // continuous and easing it would only flatten it out.
    const gain = this.torch * this.calm;
    const radius = this.radius * (1 + wobble(this.clockMs, FLICKER_RADIUS_HZ, FLICKER_RADIUS_PHASE) * FLICKER_RADIUS_AMOUNT * gain);
    const lift = this.lift * (1 + wobble(this.clockMs, FLICKER_BRIGHT_HZ, FLICKER_BRIGHT_PHASE) * FLICKER_BRIGHTNESS_AMOUNT * gain);

    // ── Writing the display objects ──

    this.layer.visible = this.darkness > DARKNESS_EPSILON;
    if (!this.layer.visible) return;

    // The light drifts from moonlight to the flame of the place as the party
    // goes underground — ember in a dragon graveyard, teal in a sunken temple —
    // and the whole thing is scaled by how bright the light is allowed to be.
    // The baked texture is black at its rim, and black survives any tint, so
    // the seam with the flat shadows holds whatever colour is chosen here.
    const brightness = clamp01(lift);
    this.light.tint = packTint(
      brightness * mix(MOONLIGHT_COLOR[0], this.lr, this.torch),
      brightness * mix(MOONLIGHT_COLOR[1], this.lg, this.torch),
      brightness * mix(MOONLIGHT_COLOR[2], this.lb, this.torch),
    );

    const alpha = clamp01(this.darkness);
    this.light.alpha = alpha;
    this.light.visible = radius > 0.5;
    this.light.position.set(this.focusX, this.focusY);
    // The falloff reaches black at the texture's inscribed circle, so scaling by
    // the requested radius over the texture's own puts it exactly there.
    this.light.scale.set((2 * radius) / LIGHT_TEXTURE_SIZE);

    this.layoutShadows(this.light.visible ? radius : 0, alpha);
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    // The sprites above do not own this texture, so it is released separately.
    this.lightTexture.destroy(true);
  }

  /**
   * Fit the four flat shadows to the screen outside the light's square.
   *
   * They must tile it exactly once: a gap is a patch of unlit world and an
   * overlap is a patch darkened twice, and against a multiply layer both are
   * immediately obvious as a hard edge.
   */
  private layoutShadows(radius: number, alpha: number): void {
    const left = clamp(this.focusX - radius, 0, this.width);
    const right = clamp(this.focusX + radius, 0, this.width);
    const top = clamp(this.focusY - radius, 0, this.height);
    const bottom = clamp(this.focusY + radius, 0, this.height);

    this.place(this.shadows[0], 0, 0, this.width, top, alpha);
    this.place(this.shadows[1], 0, bottom, this.width, this.height - bottom, alpha);
    this.place(this.shadows[2], 0, top, left, bottom - top, alpha);
    this.place(this.shadows[3], right, top, this.width - right, bottom - top, alpha);
  }

  private place(sprite: Sprite, x: number, y: number, w: number, h: number, alpha: number): void {
    if (w <= 0 || h <= 0) {
      sprite.visible = false;
      return;
    }
    sprite.visible = true;
    sprite.position.set(x, y);
    sprite.width = w;
    sprite.height = h;
    sprite.alpha = alpha;
  }

  /**
   * Bake the radial falloff, once.
   *
   * The texture is fully opaque and carries the light purely in its colour,
   * which is what lets the sprite's own alpha stay free to mean the depth of
   * the shadows. Its rim is exact black so that it meets the flat shadows
   * without a seam, and its corners, which lie outside the inscribed circle,
   * are black for the same reason.
   */
  private static bakeLight(): Texture {
    const size = LIGHT_TEXTURE_SIZE;
    const half = size / 2;
    const rgba = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      const dy = y + 0.5 - half;
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - half;
        const v = Lighting.falloff(Math.sqrt(dx * dx + dy * dy) / half);
        const i = (y * size + x) * 4;
        // The hue is interpolated by brightness rather than by distance so that
        // the warm core and the cool fringe stay tied to how lit a place is.
        rgba[i] = Math.round(255 * v * mix(TORCH_EDGE_COLOR[0], TORCH_CORE_COLOR[0], v));
        rgba[i + 1] = Math.round(255 * v * mix(TORCH_EDGE_COLOR[1], TORCH_CORE_COLOR[1], v));
        rgba[i + 2] = Math.round(255 * v * mix(TORCH_EDGE_COLOR[2], TORCH_CORE_COLOR[2], v));
        rgba[i + 3] = 255;
      }
    }

    const source = new BufferImageSource({
      resource: rgba,
      width: size,
      height: size,
      // Without this the buffer source guesses BGRA from a byte array and the
      // warm core comes out blue.
      format: 'rgba8unorm',
      // Every pixel is fully opaque, so premultiplied and straight bytes are
      // the same thing here, and claiming premultiplied keeps Pixi on the plain
      // multiply blend rather than its non-premultiplied variant.
      alphaMode: 'premultiplied-alpha',
      // The one place in this game where smoothing is wanted: the falloff is a
      // smooth function being scaled up, and nearest sampling would band it.
      scaleMode: 'linear',
      // This is needed on every frame the party is underground, so letting the
      // collector unload it would be pure waste.
      autoGarbageCollect: false,
    });

    return new Texture({ source });
  }

  /** Light as a fraction of full, at `t` of the way from the centre to the rim. */
  private static falloff(t: number): number {
    if (t >= 1) return 0;
    if (t <= TORCH_CORE_FRACTION) return 1;
    const u = (t - TORCH_CORE_FRACTION) / (1 - TORCH_CORE_FRACTION);
    // The exponent leaves the curve flat where it meets zero, which is what
    // makes the edge of the light soft instead of a visible circle.
    return Math.pow(1 - u, TORCH_FALLOFF_EXPONENT);
  }
}

/**
 * Move `current` a fraction of the way to `target`.
 *
 * The fraction comes from an exponential rather than a fixed step so that the
 * result depends on how much time passed and not on how many frames it was
 * divided into. A stutter therefore changes nothing the player can see.
 */
function approach(current: number, target: number, dt: number, tauMs: number): number {
  if (tauMs <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-dt / tauMs));
}

/** Three sine waves summed to a value in roughly minus one to one. */
function wobble(t: number, hz: number[], phase: number[]): number {
  return (
    FLICKER_WEIGHTS[0] * Math.sin(t * hz[0] + phase[0]) +
    FLICKER_WEIGHTS[1] * Math.sin(t * hz[1] + phase[1]) +
    FLICKER_WEIGHTS[2] * Math.sin(t * hz[2] + phase[2])
  );
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Pack three zero-to-one channels into the 0xRRGGBB a Pixi tint wants. */
function packTint(r: number, g: number, b: number): number {
  return (
    (Math.round(clamp01(r) * 255) << 16) |
    (Math.round(clamp01(g) * 255) << 8) |
    Math.round(clamp01(b) * 255)
  );
}

/**
 * Full-screen atmosphere for the Pixi backend: colour grading, vignette, bloom.
 *
 * The map renderer draws the same tiles at noon and at midnight, so everything
 * that makes a scene feel like dawn or like a flooded crypt has to happen after
 * the fact, over the finished frame. `SceneMood` already carries what the game
 * knows about the sky, so this class needs no game state of its own: it reads a
 * mood, decides what the frame should look like, and moves its filters towards
 * that look over the next few hundred milliseconds.
 *
 * The moving is the important half. Daylight ticks continuously and weather
 * flips instantly, so anything wired straight from mood to uniform would step
 * and strobe. Every visible quantity here is therefore a smoothed value that
 * chases a target with an exponential approach, which is frame-rate independent
 * and cannot overshoot.
 *
 * Three filters are attached to the world container, in this order:
 *
 *  1. A `ColorMatrixFilter` whose twenty coefficients are rebuilt each frame
 *     from a handful of scalars (tint, exposure, saturation, contrast, lift).
 *     Interpolating those scalars and composing the matrix once is far easier
 *     to reason about than interpolating twenty coefficients directly.
 *  2. A bloom, which is a small filter graph rather than a single pass: a
 *     threshold pass into a pooled texture, a blur of that texture, and a
 *     composite that adds the result back over the untouched original. It sits
 *     after the grade so torchlight glows in the colour the grade gave it.
 *  3. A vignette, written as a custom fragment shader because a shader costs one
 *     multiply per pixel where a drawn overlay would cost geometry, alpha
 *     blending and a hand-authored falloff that never looks as smooth.
 *
 * The custom shaders are supplied as GLSL only. The backend asks for WebGL, and
 * on a WebGPU renderer the constructor falls back to grading alone rather than
 * running a shaderless filter.
 */

import {
  BlurFilter,
  ColorMatrixFilter,
  Filter,
  GlProgram,
  Rectangle,
  RendererType,
  Texture,
  TexturePool,
  UniformGroup,
} from 'pixi.js';
import type { ColorMatrix, Container, FilterSystem, Renderer, RenderSurface } from 'pixi.js';
import type { SceneMood } from '../../DrawCommand';
import { themeLight } from '../../ThemeLight';

// ─────────────────────────────────────────────────────────────────────────────
// Tunables. Everything the look is made of lives here; nothing below this block
// needs reading to dial the game in.
// ─────────────────────────────────────────────────────────────────────────────

/** Luminance weights used by both the saturation matrix and the bloom threshold, so a colour that reads as bright in one reads as bright in the other. Rec. 709. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * How long each smoothed quantity takes to cover most of the distance to its
 * target, in milliseconds. These are time constants, so the value is about 63%
 * of the way there after one of them and visually settled after three.
 */
/** Colour grade. Long, because daylight drifts continuously and a short constant would let the clock's own steps show. */
const GRADE_TAU_MS = 900;
/** Weather. Weather changes in one tick, and a slow fade reads as the sky closing in rather than a switch being thrown. */
const WEATHER_TAU_MS = 2200;
/** Surface to underground. Short, because walking through a dungeon entrance should feel like a threshold, not a dissolve. */
const UNDERGROUND_TAU_MS = 320;
/** Combat entry and exit. Short enough that the punch lands on the first round. */
const COMBAT_TAU_MS = 260;
/** Vignette strength and centre. Medium, so it never pumps when the party moves. */
const VIGNETTE_TAU_MS = 700;
/** Bloom intensity and threshold. Medium, to keep a torch from popping on. */
const BLOOM_TAU_MS = 800;
/** Detection of whether daylight is rising or falling. Very long, because the whole point is to ignore a single noisy sample. */
const TREND_TAU_MS = 3500;

/** Largest frame delta the smoothing will honour. A tab that was hidden for a minute should resume at the right look immediately rather than crawl to it. */
const MAX_STEP_MS = 250;

/** Daylight below this is fully night, above it the twilight grade starts mixing in. */
const DAYLIGHT_NIGHT_END = 0.22;
/** Daylight at which the twilight grade is at full strength, which is where a sunset actually looks like one. */
const DAYLIGHT_TWILIGHT = 0.5;
/** Daylight above this is fully the noon grade. */
const DAYLIGHT_DAY_START = 0.85;

/**
 * Rate of daylight change, per second, that counts as unambiguously morning or
 * evening. `SceneMood` cannot distinguish dawn from dusk because both sit at the
 * same daylight value, so the direction of travel is the only signal available.
 * The cycle's steepest rate is roughly 0.019 per second, so this saturates well
 * before the sun is properly up or down.
 */
const TREND_REFERENCE_RATE = 0.004;

/** Vignette darkening at the corners, by scene. Night and underground want the frame to close in; daylight wants only enough to stop the edges glaring. */
const VIGNETTE_DAY = 0.16;
const VIGNETTE_NIGHT = 0.44;
const VIGNETTE_UNDERGROUND = 0.60;
/** Extra darkening while fighting, so the frame tightens on the fight. */
const VIGNETTE_COMBAT = 0.06;
/** Distance from the centre, where 1.0 is the corner, at which darkening begins. Lower spreads the vignette further into the frame. */
const VIGNETTE_INNER = 0.40;
/** Distance at which darkening reaches full strength. Above 1.0 the corners never quite reach it, which keeps the falloff from banding. */
const VIGNETTE_OUTER = 1.05;
/** How far the darkened edge is pulled towards the scene's own shadow colour instead of neutral black, from 0 to 1. A little of this is what separates a mood from a dirty lens. */
const VIGNETTE_EDGE_TINT = 0.30;
/** Brightness of that shadow colour relative to the grade's tint. Kept dark so the tint reads as a hue, not a wash. */
const VIGNETTE_EDGE_LEVEL = 0.10;
/** How far the vignette centre follows the party underground, from 0 to 1. Off above ground, where the frame is a window rather than a lantern. */
const VIGNETTE_FOCUS_BIAS = 0.35;
/** Furthest the centre may drift from the middle of the frame, as a fraction of frame size, so the vignette never crushes one edge. */
const VIGNETTE_FOCUS_LIMIT = 0.14;

/** Luminance at which a pixel starts to bloom, by scene. The dark threshold is lower so torches and spell light carry at night without the whole daylit map glowing. */
const BLOOM_THRESHOLD_DAY = 0.78;
const BLOOM_THRESHOLD_DARK = 0.54;
/** Width of the knee above the threshold. A soft knee stops bloom crawling along the edge of a bright shape as the grade shifts. */
const BLOOM_KNEE = 0.22;
/** How much of the blurred bright pass is added back, by scene. This is the restraint dial: past about 0.5 the game stops looking like a JRPG. */
const BLOOM_INTENSITY_DAY = 0.11;
const BLOOM_INTENSITY_NIGHT = 0.30;
const BLOOM_INTENSITY_UNDERGROUND = 0.36;
/** Extra glow while fighting, so spell effects read hotter than they do on the road. */
const BLOOM_COMBAT_BOOST = 0.25;
/** Radius of the glow in pixels. Wide enough to read as light spilling, narrow enough not to smear the pixel art. */
const BLOOM_BLUR_STRENGTH = 9;
/** Blur passes. Two is enough for a soft glow and costs half of Pixi's default four. */
const BLOOM_BLUR_QUALITY = 2;
/** Bloom intensity below which the whole bloom graph is unhooked, saving five full-screen passes. The two values give it hysteresis so it cannot flap. */
const BLOOM_OFF_BELOW = 0.004;
const BLOOM_ON_ABOVE = 0.012;

/** Contrast, saturation and exposure multipliers applied while `inCombat`. Small numbers: the fight should feel sharper, not like a different game. */
const COMBAT_CONTRAST = 0.09;
const COMBAT_SATURATION = 0.12;
const COMBAT_BRIGHTNESS = 0.03;

/**
 * The look of a scene, as the few scalars the colour matrix is composed from.
 *
 * `tint` is a per-channel multiplier standing in for the colour of the light,
 * `lift` is added afterwards and is what haze does to the black level.
 */
interface Grade {
  tint: number[];
  brightness: number;
  saturation: number;
  contrast: number;
  lift: number[];
}

/**
 * How far the underground grade's tint leans toward the light of the place.
 *
 * The torch already takes the theme's colour, but it sits under a grade that
 * cools every dungeon toward blue, and a teal torch in a blue room reads as
 * blue. Leaning the grade itself halfway toward the same colour lets the room
 * agree with its light — ember in the dragon graveyard, teal in the sunken
 * temple — without giving up the depth the cool cast provides.
 */
const GRADE_THEME_LEAN = 0.5;

/** Time constant for the grade crossing between themes, so a floor change is a fade. */
const GRADE_THEME_TAU_MS = 900;

/** Full daylight overhead: the reference the others are departures from. */
const GRADE_NOON: Grade = {
  tint: [1.0, 1.0, 1.0],
  brightness: 1.04,
  saturation: 1.0,
  contrast: 1.03,
  lift: [0.0, 0.0, 0.0],
};

/** Sunrise. Rosy rather than orange, and brighter than dusk, because morning light is thin and cold underneath its warmth. */
const GRADE_DAWN: Grade = {
  tint: [1.11, 0.95, 0.99],
  brightness: 0.94,
  saturation: 1.06,
  contrast: 0.99,
  lift: [0.035, 0.020, 0.028],
};

/** Sunset. Heavier amber and a squeezed blue channel, which is what makes long shadows read as evening. */
const GRADE_DUSK: Grade = {
  tint: [1.16, 0.92, 0.70],
  brightness: 0.90,
  saturation: 1.10,
  contrast: 1.02,
  lift: [0.030, 0.014, 0.004],
};

/** Night. Dim and blue, with saturation pulled down because the eye loses colour in the dark before it loses shape. */
/**
 * Night, and below it the dark underground.
 *
 * Both carry colour and almost no brightness, because brightness is the
 * lighting pass's job and it has already done it. When these grades darkened
 * as well, the two multiplied: midnight landed at 27% and underground at 12%,
 * and — worse — the torch was capped at 54% even at its centre, when the whole
 * point of lighting by multiply is that a light returns the world to its own
 * full brightness so the map's pixels come back rather than a warm blob being
 * laid over them.
 */
const GRADE_NIGHT: Grade = {
  tint: [0.60, 0.70, 1.00],
  brightness: 0.88,
  saturation: 0.70,
  contrast: 1.05,
  lift: [0.018, 0.024, 0.050],
};

/** Underground. Colder and darker still, and higher contrast, because the only light down there is carried and it falls off hard. */
const GRADE_UNDERGROUND: Grade = {
  tint: [0.70, 0.79, 0.96],
  brightness: 0.86,
  saturation: 0.66,
  contrast: 1.12,
  lift: [0.014, 0.018, 0.030],
};

/**
 * What weather does on top of the sky's own grade, plus its effect on the two
 * other stages. Multipliers on tint, exposure, saturation and contrast; an
 * addition to lift; `vignette` is added to the vignette's strength and `bloom`
 * multiplies its intensity.
 */
interface WeatherGrade {
  tint: number[];
  brightness: number;
  saturation: number;
  contrast: number;
  lift: number[];
  vignette: number;
  bloom: number;
}

/** No weather at all, and the value everything falls back to underground. */
const WEATHER_NONE: WeatherGrade = {
  tint: [1, 1, 1],
  brightness: 1,
  saturation: 1,
  contrast: 1,
  lift: [0, 0, 0],
  vignette: 0,
  bloom: 1,
};

/**
 * Keyed by `WeatherType` from `src/world/WeatherSystem.ts`. An id with no entry
 * grades as clear, so adding a weather type is a visual no-op until it is given
 * a line here rather than a compile error somewhere else.
 */
const WEATHER_GRADES: Record<string, WeatherGrade> = {
  clear: { ...WEATHER_NONE, saturation: 1.03 },

  cloudy: {
    tint: [0.98, 0.99, 1.03], brightness: 0.92, saturation: 0.92, contrast: 0.96,
    lift: [0.010, 0.010, 0.012], vignette: 0.03, bloom: 0.9,
  },

  // Rain cools and desaturates: wet stone reflects the sky, and the sky is grey.
  rain: {
    tint: [0.90, 0.95, 1.07], brightness: 0.85, saturation: 0.78, contrast: 0.97,
    lift: [0.012, 0.015, 0.022], vignette: 0.06, bloom: 0.8,
  },

  heavy_rain: {
    tint: [0.84, 0.91, 1.11], brightness: 0.71, saturation: 0.64, contrast: 1.03,
    lift: [0.016, 0.020, 0.032], vignette: 0.12, bloom: 0.7,
  },

  // Fog is the low-contrast case: black is lifted a long way and everything
  // collapses towards the middle, which is exactly what depth haze looks like.
  fog: {
    tint: [0.99, 1.00, 1.02], brightness: 0.96, saturation: 0.70, contrast: 0.78,
    lift: [0.100, 0.102, 0.112], vignette: 0.10, bloom: 1.4,
  },

  // Snow is the one weather that brightens. Blue is lifted rather than tinted so
  // the snow reads cold while lit surfaces stay white.
  snow: {
    tint: [0.97, 1.00, 1.06], brightness: 1.11, saturation: 0.86, contrast: 0.94,
    lift: [0.038, 0.044, 0.058], vignette: 0.05, bloom: 1.2,
  },

  sandstorm: {
    tint: [1.14, 1.00, 0.76], brightness: 0.90, saturation: 0.74, contrast: 0.84,
    lift: [0.082, 0.068, 0.044], vignette: 0.14, bloom: 1.1,
  },

  // The aurora is the only weather that pushes colour up, because it is light
  // rather than an obstruction to it.
  magical_aurora: {
    tint: [0.95, 1.02, 1.12], brightness: 1.03, saturation: 1.22, contrast: 1.03,
    lift: [0.010, 0.022, 0.036], vignette: 0.02, bloom: 1.5,
  },

  eerie_mist: {
    tint: [0.90, 1.05, 0.94], brightness: 0.86, saturation: 0.68, contrast: 0.84,
    lift: [0.050, 0.070, 0.056], vignette: 0.16, bloom: 1.3,
  },

  blood_red_sky: {
    tint: [1.22, 0.80, 0.78], brightness: 0.93, saturation: 1.12, contrast: 1.06,
    lift: [0.034, 0.002, 0.006], vignette: 0.10, bloom: 1.2,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shaders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pixi's stock filter vertex shader, reproduced rather than imported because the
 * published entry point does not export it.
 */
const FILTER_VERT = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

/**
 * The same, plus a coordinate that runs 0 to 1 across the filtered area.
 *
 * `vTextureCoord` cannot be used for this: it addresses a pooled power-of-two
 * texture, so the frame occupies some arbitrary corner of it and the centre of
 * the screen is not at 0.5. Recovering the frame position in the fragment stage
 * would need `uOutputFrame`, and Pixi only syncs those global filter uniforms to
 * the vertex stage. The quad's own vertex position is already exactly the number
 * wanted, so it is passed down as a varying instead.
 */
const VIGNETTE_VERT = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vAreaCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
    vAreaCoord = aPosition;
}
`;

/**
 * Vignette. The distance is measured in frame-normalised space and divided by
 * the half-diagonal, so a corner sits at 1.0 and the falloff is an ellipse that
 * follows the window's aspect instead of a circle cropped by it.
 *
 * Filter textures are premultiplied, so the darkening is a plain multiply and
 * the edge tint is scaled by alpha to stay premultiplied on the way out.
 */
const VIGNETTE_FRAG = /* glsl */ `
in vec2 vTextureCoord;
in vec2 vAreaCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

uniform vec2 uCenter;
uniform vec3 uEdgeColor;
uniform float uStrength;
uniform float uInner;
uniform float uOuter;
uniform float uEdgeTint;

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);

    float r = length(vAreaCoord - uCenter) / 0.7071068;
    float fall = smoothstep(uInner, uOuter, r) * uStrength;

    vec3 rgb = color.rgb * (1.0 - fall);
    rgb = mix(rgb, uEdgeColor * color.a, fall * uEdgeTint);

    finalColor = vec4(rgb, color.a);
}
`;

/**
 * Bright pass. The colour is un-premultiplied before its luminance is measured,
 * because a half-transparent white pixel is still white and should bloom like
 * one, then premultiplied again so the blur that follows behaves.
 */
const BLOOM_EXTRACT_FRAG = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uThreshold;
uniform float uKnee;

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    vec3 straight = color.a > 0.0 ? color.rgb / color.a : color.rgb;

    float luma = dot(straight, vec3(${LUMA_R}, ${LUMA_G}, ${LUMA_B}));
    float weight = smoothstep(uThreshold, uThreshold + uKnee, luma);

    finalColor = vec4(straight * weight * color.a, color.a);
}
`;

/**
 * Bloom composite. Both inputs are premultiplied, so the glow is simply added,
 * and the sum is clamped to alpha rather than to one: anything brighter than
 * its own coverage is not a colour a premultiplied target can hold.
 */
const BLOOM_COMPOSITE_FRAG = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uBloomTexture;
uniform float uIntensity;

void main(void)
{
    vec4 base = texture(uTexture, vTextureCoord);
    vec3 glow = texture(uBloomTexture, vTextureCoord).rgb * uIntensity;
    finalColor = vec4(min(base.rgb + glow, vec3(base.a)), base.a);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Bloom
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Threshold, blur, add back.
 *
 * This has to be a filter with its own `apply` rather than three filters in the
 * container's list, because the composite needs the original frame *and* the
 * blurred bright pass at once, and a filter chain only ever hands the next
 * filter what the last one produced.
 *
 * The two scratch textures come from Pixi's own pool and are returned in the
 * same call, so a frame allocates nothing.
 */
class BloomFilter extends Filter {
  private readonly extract: Filter;
  private readonly blur: BlurFilter;
  private readonly composite: Filter;

  constructor() {
    // No program of its own: this filter never draws, it only sequences the
    // three below. Pixi's own BlurFilter is built the same way, including the
    // explicit compatibility, which matters because a filter with no program is
    // otherwise judged compatible with no renderer and takes the entire chain
    // out of the frame with it rather than just itself.
    super({ resources: {}, compatibleRenderers: RendererType.BOTH });

    this.extract = new Filter({
      glProgram: GlProgram.from({ vertex: FILTER_VERT, fragment: BLOOM_EXTRACT_FRAG, name: 'atmosphere-bloom-extract' }),
      resources: {
        extractUniforms: new UniformGroup({
          uThreshold: { value: BLOOM_THRESHOLD_DAY, type: 'f32' },
          uKnee: { value: BLOOM_KNEE, type: 'f32' },
        }),
      },
    });

    this.blur = new BlurFilter({
      strength: BLOOM_BLUR_STRENGTH,
      quality: BLOOM_BLUR_QUALITY,
      kernelSize: 5,
    });
    // The blur is applied to a scratch texture that already covers the whole
    // frame, so it must not ask for padding it will never be given.
    this.blur.repeatEdgePixels = true;

    this.composite = new Filter({
      glProgram: GlProgram.from({ vertex: FILTER_VERT, fragment: BLOOM_COMPOSITE_FRAG, name: 'atmosphere-bloom-composite' }),
      resources: {
        compositeUniforms: new UniformGroup({
          uIntensity: { value: BLOOM_INTENSITY_DAY, type: 'f32' },
        }),
      },
    });
  }

  set threshold(value: number) {
    this.extract.resources.extractUniforms.uniforms.uThreshold = value;
  }

  set intensity(value: number) {
    this.composite.resources.compositeUniforms.uniforms.uIntensity = value;
  }

  override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clear: boolean): void {
    const bright = TexturePool.getSameSizeTexture(input);
    const blurred = TexturePool.getSameSizeTexture(input);

    this.extract.apply(filterManager, input, bright, true);
    this.blur.apply(filterManager, bright, blurred, true);

    // Both textures came from the same pool request, so the used region and the
    // padding match the input exactly and one texture coordinate reads both.
    this.composite.resources.uBloomTexture = blurred.source;
    this.composite.resources.uBloomSampler = blurred.source.style;
    this.composite.apply(filterManager, input, output, clear);

    TexturePool.returnTexture(blurred);
    TexturePool.returnTexture(bright);
  }

  override destroy(): void {
    // The composite still points at whichever pooled texture it last read, and
    // that texture belongs to Pixi's pool rather than to this filter. Dropping
    // the reference means a destroyed atmosphere cannot keep a scratch texture
    // alive after the frame that borrowed it.
    this.composite.resources.uBloomTexture = Texture.EMPTY.source;
    this.composite.resources.uBloomSampler = Texture.EMPTY.source.style;

    this.extract.destroy();
    this.blur.destroy();
    this.composite.destroy();
    super.destroy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Atmosphere
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ordinary clamp, written so that a NaN comes out as `low` rather than as a NaN.
 *
 * Every visible quantity here is a running average of its own past, so one bad
 * sample arriving from the mood would not glitch a frame, it would poison the
 * state permanently and leave the screen ungraded until the game restarted.
 * Since every value entering the class passes through here, this is the one
 * place that has to care.
 */
function clamp(value: number, low: number, high: number): number {
  return value >= low ? (value > high ? high : value) : low;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite ramp from 0 to 1 across [edge0, edge1], matching the GLSL builtin. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Blend two grades into a third, which is preallocated so a frame allocates nothing. */
function mixGrade(out: Grade, a: Grade, b: Grade, t: number): Grade {
  for (let i = 0; i < 3; i++) {
    out.tint[i] = lerp(a.tint[i], b.tint[i], t);
    out.lift[i] = lerp(a.lift[i], b.lift[i], t);
  }
  out.brightness = lerp(a.brightness, b.brightness, t);
  out.saturation = lerp(a.saturation, b.saturation, t);
  out.contrast = lerp(a.contrast, b.contrast, t);
  return out;
}

function emptyGrade(): Grade {
  return { tint: [1, 1, 1], brightness: 1, saturation: 1, contrast: 1, lift: [0, 0, 0] };
}

export class Atmosphere {
  private readonly width: number;
  private readonly height: number;
  /** The custom shaders are GLSL, so on a WebGPU renderer only the colour grade runs. */
  private readonly shadersAvailable: boolean;

  private readonly grade = new ColorMatrixFilter();
  private readonly bloom: BloomFilter | null;
  private readonly vignette: Filter | null;

  private world: Container | null = null;
  /** Whether the bloom is currently in the container's filter list, which is what makes turning it off actually save the passes. */
  private bloomAttached = false;

  // Smoothed state. Each of these chases a target derived from the mood.
  private undergroundMix = 0;
  /** The light of the current place, and where it is easing to. */
  private themeTint: [number, number, number] = [1, 1, 1];
  private wantTheme: [number, number, number] = [1, 1, 1];
  private combatMix = 0;
  private vignetteStrength = VIGNETTE_DAY;
  private vignetteCenterX = 0.5;
  private vignetteCenterY = 0.5;
  private bloomIntensity = BLOOM_INTENSITY_DAY;
  private bloomThreshold = BLOOM_THRESHOLD_DAY;
  private dayVelocity = 0;
  private lastDaylight = -1;

  private readonly skyGrade = emptyGrade();
  private readonly twilightGrade = emptyGrade();
  private readonly smoothedGrade = emptyGrade();
  private readonly targetGrade = emptyGrade();
  private readonly weather: WeatherGrade = {
    tint: [1, 1, 1], brightness: 1, saturation: 1, contrast: 1, lift: [0, 0, 0], vignette: 0, bloom: 1,
  };

  /** Reused so composing the colour matrix never allocates. */
  private readonly matrix: number[] = new Array<number>(20).fill(0);

  constructor(renderer: Renderer, width: number, height: number) {
    this.width = width;
    this.height = height;
    this.shadersAvailable = renderer.type === RendererType.WEBGL;

    if (this.shadersAvailable) {
      this.bloom = new BloomFilter();
      this.vignette = new Filter({
        glProgram: GlProgram.from({ vertex: VIGNETTE_VERT, fragment: VIGNETTE_FRAG, name: 'atmosphere-vignette' }),
        resources: {
          vignetteUniforms: new UniformGroup({
            uCenter: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
            uEdgeColor: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
            uStrength: { value: VIGNETTE_DAY, type: 'f32' },
            uInner: { value: VIGNETTE_INNER, type: 'f32' },
            uOuter: { value: VIGNETTE_OUTER, type: 'f32' },
            uEdgeTint: { value: VIGNETTE_EDGE_TINT, type: 'f32' },
          }),
        },
      });
    } else {
      this.bloom = null;
      this.vignette = null;
    }

    // Seed the smoothed grade at full daylight so the first frame after a load
    // is already correct rather than fading up from nothing.
    mixGrade(this.smoothedGrade, GRADE_NOON, GRADE_NOON, 0);
    this.writeMatrix();
  }

  /**
   * Attach the filters to the container holding the drawn world. Call once.
   *
   * A fixed `filterArea` is set as well, and it is not decoration: without it
   * Pixi walks the whole display list every frame to work out how large the
   * filtered region is, and the region it finds would be the bounds of what
   * happens to be drawn rather than the window the vignette is measured against.
   */
  attach(world: Container): void {
    this.world = world;
    world.filterArea = new Rectangle(0, 0, this.width, this.height);
    this.bloomAttached = this.bloom !== null;
    this.syncFilters();
  }

  /**
   * Move every effect one frame towards what the mood asks for.
   *
   * `elapsedMs` is the time since the previous call, not a running total. A
   * long gap is honoured up to `MAX_STEP_MS` and then treated as a jump, so a
   * backgrounded tab resumes at the right look instead of crawling to it.
   */
  update(mood: SceneMood, elapsedMs: number): void {
    this.wantTheme = mood.underground ? themeLight(mood.themeId) : [1, 1, 1];
    const dt = clamp(elapsedMs, 0, MAX_STEP_MS);
    const daylight = clamp(mood.daylight, 0, 1);

    this.trackDaylightTrend(daylight, dt);
    this.undergroundMix = this.approach(this.undergroundMix, mood.underground ? 1 : 0, UNDERGROUND_TAU_MS, dt);
    this.combatMix = this.approach(this.combatMix, mood.inCombat ? 1 : 0, COMBAT_TAU_MS, dt);
    this.trackWeather(mood.weather, dt);

    this.updateGrade(daylight, dt);
    this.updateVignette(mood, daylight, dt);
    this.updateBloom(daylight, dt);
  }

  destroy(): void {
    if (this.world) {
      this.world.filters = [];
      this.world.filterArea = undefined;
      this.world = null;
    }
    this.grade.destroy();
    this.bloom?.destroy();
    this.vignette?.destroy();
  }

  // ── Smoothing ──

  /**
   * Exponential approach. Framerate independence matters here because the game
   * steps on a fixed 33 ms tick but renders on animation frames, so a fixed
   * per-frame fraction would fade at different speeds on different displays.
   */
  private approach(current: number, target: number, tauMs: number, dtMs: number): number {
    if (dtMs <= 0) return current;
    return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
  }

  /**
   * Decide whether the sun is coming up or going down.
   *
   * `SceneMood` carries only a daylight level, and dawn and dusk share every
   * level between them, so the sign of the rate of change is the only thing that
   * tells them apart. It is smoothed hard because a single frame's difference is
   * mostly noise from the clock's own resolution.
   */
  private trackDaylightTrend(daylight: number, dtMs: number): void {
    if (this.lastDaylight < 0 || dtMs <= 0) {
      this.lastDaylight = daylight;
      return;
    }
    const rate = ((daylight - this.lastDaylight) / dtMs) * 1000;
    this.lastDaylight = daylight;
    this.dayVelocity = this.approach(this.dayVelocity, rate, TREND_TAU_MS, dtMs);
  }

  /** How much of the twilight look should be dusk rather than dawn, from 0 to 1. */
  private duskness(): number {
    return 0.5 - 0.5 * clamp(this.dayVelocity / TREND_REFERENCE_RATE, -1, 1);
  }

  /** Chase the current weather's modifiers, treating an unknown id as clear skies. */
  private trackWeather(id: string | null, dtMs: number): void {
    const target = (id !== null ? WEATHER_GRADES[id] : undefined) ?? WEATHER_NONE;
    const w = this.weather;
    for (let i = 0; i < 3; i++) {
      w.tint[i] = this.approach(w.tint[i], target.tint[i], WEATHER_TAU_MS, dtMs);
      w.lift[i] = this.approach(w.lift[i], target.lift[i], WEATHER_TAU_MS, dtMs);
    }
    w.brightness = this.approach(w.brightness, target.brightness, WEATHER_TAU_MS, dtMs);
    w.saturation = this.approach(w.saturation, target.saturation, WEATHER_TAU_MS, dtMs);
    w.contrast = this.approach(w.contrast, target.contrast, WEATHER_TAU_MS, dtMs);
    w.vignette = this.approach(w.vignette, target.vignette, WEATHER_TAU_MS, dtMs);
    w.bloom = this.approach(w.bloom, target.bloom, WEATHER_TAU_MS, dtMs);
  }

  // ── Colour grading ──

  private updateGrade(daylight: number, dtMs: number): void {
    // Night, twilight and noon are three keyframes on the daylight axis; the sky
    // is whichever pair the current level falls between.
    const twilight = mixGrade(this.twilightGrade, GRADE_DAWN, GRADE_DUSK, this.duskness());
    if (daylight <= DAYLIGHT_TWILIGHT) {
      const t = smoothstep(DAYLIGHT_NIGHT_END, DAYLIGHT_TWILIGHT, daylight);
      mixGrade(this.skyGrade, GRADE_NIGHT, twilight, t);
    } else {
      const t = smoothstep(DAYLIGHT_TWILIGHT, DAYLIGHT_DAY_START, daylight);
      mixGrade(this.skyGrade, twilight, GRADE_NOON, t);
    }

    const target = mixGrade(this.targetGrade, this.skyGrade, GRADE_UNDERGROUND, this.undergroundMix);

    // The room agrees with its light: the underground tint leans toward the
    // theme's colour, eased per channel so going down a floor is a fade.
    const kTheme = 1 - Math.exp(-dtMs / GRADE_THEME_TAU_MS);
    for (let i = 0; i < 3; i++) {
      this.themeTint[i] += (this.wantTheme[i] - this.themeTint[i]) * kTheme;
      target.tint[i] = lerp(target.tint[i], target.tint[i] * this.themeTint[i], this.undergroundMix * GRADE_THEME_LEAN);
    }

    // Weather is a property of the sky, so it fades out as the party descends
    // rather than following them into a sealed corridor.
    const sky = 1 - this.undergroundMix;
    const w = this.weather;
    for (let i = 0; i < 3; i++) {
      target.tint[i] *= lerp(1, w.tint[i], sky);
      target.lift[i] += w.lift[i] * sky;
    }
    target.brightness *= lerp(1, w.brightness, sky);
    target.saturation *= lerp(1, w.saturation, sky);
    target.contrast *= lerp(1, w.contrast, sky);

    // Combat is applied last and undiluted, because a fight in fog should still
    // read as sharper than walking through the same fog.
    target.contrast *= 1 + COMBAT_CONTRAST * this.combatMix;
    target.saturation *= 1 + COMBAT_SATURATION * this.combatMix;
    target.brightness *= 1 + COMBAT_BRIGHTNESS * this.combatMix;

    const s = this.smoothedGrade;
    for (let i = 0; i < 3; i++) {
      s.tint[i] = this.approach(s.tint[i], target.tint[i], GRADE_TAU_MS, dtMs);
      s.lift[i] = this.approach(s.lift[i], target.lift[i], GRADE_TAU_MS, dtMs);
    }
    s.brightness = this.approach(s.brightness, target.brightness, GRADE_TAU_MS, dtMs);
    s.saturation = this.approach(s.saturation, target.saturation, GRADE_TAU_MS, dtMs);
    s.contrast = this.approach(s.contrast, target.contrast, GRADE_TAU_MS, dtMs);

    this.writeMatrix();
  }

  /**
   * Compose the five scalars into the twenty coefficients Pixi wants.
   *
   * The stages fold into a single matrix exactly, which is why they are worth
   * expressing separately: saturating, then stretching contrast about mid grey,
   * then tinting and exposing, then lifting, is
   *
   *   out = tint * exposure * (contrast * (S . rgb - 0.5) + 0.5) + lift
   *
   * and everything except the `S . rgb` term is constant per channel, so it
   * collapses into the row's scale and its offset.
   */
  private writeMatrix(): void {
    const g = this.smoothedGrade;
    const s = g.saturation;
    const c = g.contrast;
    const m = this.matrix;

    // A saturation matrix keeps luminance fixed while moving each channel
    // towards or away from it, which is what stops desaturation dimming a scene.
    const luma = [LUMA_R, LUMA_G, LUMA_B];

    for (let row = 0; row < 3; row++) {
      const scale = g.tint[row] * g.brightness * c;
      for (let col = 0; col < 3; col++) {
        const sat = luma[col] * (1 - s) + (row === col ? s : 0);
        m[row * 5 + col] = scale * sat;
      }
      m[row * 5 + 3] = 0;
      m[row * 5 + 4] = g.tint[row] * g.brightness * (0.5 - 0.5 * c) + g.lift[row];
    }

    // Alpha passes through untouched: coverage is not a colour.
    m[15] = 0;
    m[16] = 0;
    m[17] = 0;
    m[18] = 1;
    m[19] = 0;

    this.grade.matrix = m as unknown as ColorMatrix;
  }

  // ── Vignette ──

  private updateVignette(mood: SceneMood, daylight: number, dtMs: number): void {
    const vignette = this.vignette;
    if (!vignette) return;

    const sky = 1 - this.undergroundMix;
    const byDaylight = lerp(VIGNETTE_NIGHT, VIGNETTE_DAY, smoothstep(0.2, 0.8, daylight));
    const target =
      lerp(byDaylight, VIGNETTE_UNDERGROUND, this.undergroundMix)
      + this.weather.vignette * sky
      + VIGNETTE_COMBAT * this.combatMix;

    this.vignetteStrength = this.approach(this.vignetteStrength, clamp(target, 0, 0.95), VIGNETTE_TAU_MS, dtMs);

    // Underground the frame is a lantern rather than a window, so the dark
    // closes in around the party instead of around the middle of the screen.
    let targetX = 0.5;
    let targetY = 0.5;
    if (mood.focus && VIGNETTE_FOCUS_BIAS > 0) {
      const bias = VIGNETTE_FOCUS_BIAS * this.undergroundMix;
      const fx = clamp(mood.focus.x / this.width, 0, 1);
      const fy = clamp(mood.focus.y / this.height, 0, 1);
      targetX = 0.5 + clamp((fx - 0.5) * bias, -VIGNETTE_FOCUS_LIMIT, VIGNETTE_FOCUS_LIMIT);
      targetY = 0.5 + clamp((fy - 0.5) * bias, -VIGNETTE_FOCUS_LIMIT, VIGNETTE_FOCUS_LIMIT);
    }
    this.vignetteCenterX = this.approach(this.vignetteCenterX, targetX, VIGNETTE_TAU_MS, dtMs);
    this.vignetteCenterY = this.approach(this.vignetteCenterY, targetY, VIGNETTE_TAU_MS, dtMs);

    const uniforms = vignette.resources.vignetteUniforms.uniforms;
    const center = uniforms.uCenter as Float32Array;
    center[0] = this.vignetteCenterX;
    center[1] = this.vignetteCenterY;

    // The edge colour follows the grade's own tint, so a night vignette falls
    // towards blue-black and a dusk one towards brown, without a second table.
    const edge = uniforms.uEdgeColor as Float32Array;
    const g = this.smoothedGrade;
    edge[0] = g.tint[0] * VIGNETTE_EDGE_LEVEL;
    edge[1] = g.tint[1] * VIGNETTE_EDGE_LEVEL;
    edge[2] = g.tint[2] * VIGNETTE_EDGE_LEVEL;

    uniforms.uStrength = this.vignetteStrength;
    uniforms.uInner = VIGNETTE_INNER;
    uniforms.uOuter = VIGNETTE_OUTER;
    uniforms.uEdgeTint = VIGNETTE_EDGE_TINT;
  }

  // ── Bloom ──

  private updateBloom(daylight: number, dtMs: number): void {
    const bloom = this.bloom;
    if (!bloom) return;

    const lit = smoothstep(0.2, 0.8, daylight);
    const sky = 1 - this.undergroundMix;

    const base = lerp(BLOOM_INTENSITY_NIGHT, BLOOM_INTENSITY_DAY, lit);
    const target =
      lerp(base, BLOOM_INTENSITY_UNDERGROUND, this.undergroundMix)
      * lerp(1, this.weather.bloom, sky)
      * (1 + BLOOM_COMBAT_BOOST * this.combatMix);

    this.bloomIntensity = this.approach(this.bloomIntensity, Math.max(0, target), BLOOM_TAU_MS, dtMs);

    // A dark scene needs a lower bar for what counts as bright, or nothing in it
    // ever crosses the threshold and the torches stay flat.
    const thresholdTarget = lerp(
      BLOOM_THRESHOLD_DARK,
      BLOOM_THRESHOLD_DAY,
      lit * sky,
    );
    this.bloomThreshold = this.approach(this.bloomThreshold, thresholdTarget, BLOOM_TAU_MS, dtMs);

    bloom.intensity = this.bloomIntensity;
    bloom.threshold = this.bloomThreshold;

    // Five full-screen passes are not worth paying for a glow nobody can see, so
    // the bloom leaves the chain entirely when it fades out. The two thresholds
    // give it hysteresis, because relinking the filter list is what costs.
    const wanted = this.bloomAttached
      ? this.bloomIntensity > BLOOM_OFF_BELOW
      : this.bloomIntensity > BLOOM_ON_ABOVE;
    if (wanted !== this.bloomAttached) {
      this.bloomAttached = wanted;
      this.syncFilters();
    }
  }

  /** Rebuild the container's filter list, which is only done when its membership changes. */
  private syncFilters(): void {
    const world = this.world;
    if (!world) return;

    const filters: Filter[] = [this.grade];
    if (this.bloom && this.bloomAttached) filters.push(this.bloom);
    if (this.vignette) filters.push(this.vignette);
    world.filters = filters;
  }
}

/**
 * The PixiJS backend: the recorded frame replayed through a WebGL scene graph.
 *
 * The shape of a frame drives every decision here. Eleven thousand commands
 * arrive per frame and over ninety-five percent of them are `rect`, so the one
 * thing that must not happen is a display object per command: eleven thousand
 * Sprites would spend the whole frame budget in transform and bounds updates
 * before a single triangle reached the GPU.
 *
 * The strategy is therefore a small, stable display list of pooled objects that
 * is rebuilt each frame from the command stream:
 *
 *  - Rectangles, strokes, paths, circles and images all go into one `Graphics`.
 *    Pixi's `GraphicsContext` is a retained command buffer of its own, so this
 *    turns eleven thousand game commands into one display object whose geometry
 *    Pixi batches into a handful of draw calls.
 *  - Consecutive rectangles sharing a colour and an alpha are accumulated into a
 *    single path and closed with one `fill()`. Each `fill()` clones the active
 *    path and appends an instruction, so collapsing runs is where the real
 *    saving is, and the pixel art draws in runs by nature. Only *consecutive*
 *    rectangles are merged: later commands must paint over earlier ones, so
 *    globally grouping by colour would reorder the frame.
 *  - Text cannot live inside a `Graphics`, so a text command closes the current
 *    `Graphics` and the next drawing command opens a fresh one. That keeps
 *    painter's order exact at the cost of a few extra objects per frame, which
 *    is affordable because there are only a handful of labels.
 *
 * Everything that would otherwise be allocated per frame is pooled or cached by
 * a stable key: `Graphics` by position in the display list, `Text` by its
 * content and style, textures by `BakedImage.id`, parsed colours and fonts by
 * their CSS string.
 */

import {
  Application,
  BufferImageSource,
  CanvasTextMetrics,
  Container,
  Graphics,
  Text,
  Texture,
  Color,
} from 'pixi.js';
import type { BakedImage, DrawCommand, Frame, RenderBackend } from '../DrawCommand';
import { Atmosphere } from './pixi/Atmosphere';
import { Lighting } from './pixi/Lighting';
import { Weather } from './pixi/Weather';

/** A colour parsed once out of its CSS string. */
interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1, from `rgba(...)` notation; multiplied into every command's own alpha. */
  a: number;
  /** The same colour as 0xRRGGBB, which is what Pixi's fill styles want. */
  rgb: number;
}

/** A CSS font shorthand split into the pieces a `TextStyle` needs. */
interface ParsedFont {
  family: string;
  size: number;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
  /** Distance from the top of the glyph box to the baseline, to undo Pixi's top-left origin. */
  ascent: number;
}

/** A pooled text object plus the bookkeeping that decides when to throw it away. */
interface TextEntry {
  /** One instance per simultaneous use of the same string in a single frame. */
  items: Text[];
  used: number;
  usedInFrame: number;
  lastFrame: number;
}

/**
 * Bands used to fake a gradient. The contract permits an approximation because
 * gradients are only ever large soft washes at low alpha, and sixteen bands puts
 * the banding well below what the eye picks out of an eight percent overlay.
 */
const GRADIENT_BANDS = 16;

/** How many frames a cached text object may go unused before it is destroyed. */
const TEXT_TTL_FRAMES = 300;

export class PixiBackend implements RenderBackend {
  readonly name = 'PixiJS';

  private app: Application | null = null;
  /**
   * Everything the frame draws, plus the lighting on top of it. It exists as a
   * container of its own so the grade can be a filter on it: the colour pass
   * therefore sees the lit scene, which is what lets a torch bloom and a night
   * fall away at the edges instead of grading a flat, evenly drawn map.
   */
  private world: Container | null = null;

  /** Reused across frames and handed out in display order by `openGraphics`. */
  private graphicsPool: Graphics[] = [];
  private graphicsUsed = 0;
  /** The `Graphics` currently accepting geometry, or null if a text command closed it. */
  private active: Graphics | null = null;

  private textCache = new Map<string, TextEntry>();
  private textures = new Map<string, Texture>();
  private colors = new Map<string, Rgba>();
  private fonts = new Map<string, ParsedFont>();

  private frameId = 0;

  /** Rain, snow, fog and dust, composited over the frame and under the lighting. */
  private weather: Weather | null = null;
  /** The darkening-and-torch pass, composited over the finished world. */
  private lighting: Lighting | null = null;
  /** Colour grade, vignette and bloom, as filters over the lit world. */
  private atmosphere: Atmosphere | null = null;
  /** Timestamp of the last submit, so lighting is eased in real time. */
  private lastSubmitMs = 0;

  // The colour and alpha of the run of rectangles waiting for its `fill()`.
  private runFill: string | null = null;
  private runAlpha = 1;

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    const app = new Application();
    await app.init({
      canvas,
      width,
      height,
      // The game drives its own loop and calls `submit`, so Pixi's ticker must
      // not render behind its back and show a half-built frame.
      autoStart: false,
      // Pixel art: one device pixel per logical pixel, and no edge smoothing.
      resolution: 1,
      autoDensity: false,
      antialias: false,
      powerPreference: 'high-performance',
    });

    this.app = app;

    const world = new Container();
    app.stage.addChild(world);
    this.world = world;

    this.weather = new Weather(width, height);
    this.lighting = new Lighting(width, height);
    this.atmosphere = new Atmosphere(app.renderer, width, height);
    this.atmosphere.attach(world);
    this.lastSubmitMs = performance.now();
  }

  submit(frame: Frame): void {
    const app = this.app;
    const world = this.world;
    if (!app || !world) return;

    this.frameId++;
    // Rebuilding the display list from scratch is what guarantees the canvas
    // shows this frame and nothing of the last one; the objects themselves are
    // pooled, so nothing is allocated by the teardown.
    world.removeChildren();
    this.graphicsUsed = 0;
    this.active = null;
    this.runFill = null;
    this.sweepTextCache();

    // Pixi clears the framebuffer to the background colour before rendering, so
    // this is the frame's clear rather than a rectangle drawn under everything.
    app.renderer.background.color = this.color(frame.clear).rgb;

    for (const c of frame.commands) {
      if (c.op === 'rect') {
        // The hot path, kept free of branches beyond the run check.
        if (c.fill !== this.runFill || c.alpha !== this.runAlpha) {
          this.flushRun();
          this.runFill = c.fill;
          this.runAlpha = c.alpha;
        }
        this.openGraphics().rect(c.x, c.y, c.w, c.h);
        continue;
      }

      // Anything else has to appear above the rectangles recorded before it, so
      // the pending run is closed first.
      this.flushRun();
      this.drawOther(c);
    }

    this.flushRun();

    const now = performance.now();
    const dt = now - this.lastSubmitMs;
    this.lastSubmitMs = now;

    // Weather is in the scene rather than on the lens, so it goes above the
    // drawn world and below the lighting that darkens both. Like the lighting it
    // has to be re-added, because the display list was torn down at the top of
    // this frame; unlike it, a clear sky is left out of the list entirely.
    const weather = this.weather;
    if (weather) {
      weather.update(frame.mood, dt);
      if (weather.active) world.addChild(weather.layer);
    }

    // The lighting layer multiplies down everything drawn above, so it goes on
    // last.
    const lighting = this.lighting;
    if (lighting) {
      lighting.update(frame.mood, dt);
      world.addChild(lighting.layer);
    }
    // Graded after the lighting rather than before it, so the vignette and the
    // bloom are working on a scene that has already been lit.
    this.atmosphere?.update(frame.mood, dt);

    app.render();
  }

  destroy(): void {
    for (const texture of this.textures.values()) {
      texture.destroy(true);
    }
    this.textures.clear();

    for (const entry of this.textCache.values()) {
      for (const text of entry.items) text.destroy({ texture: true, textureSource: true });
    }
    this.textCache.clear();

    for (const graphics of this.graphicsPool) {
      graphics.destroy({ context: true });
    }
    this.graphicsPool.length = 0;

    this.colors.clear();
    this.fonts.clear();

    // Destroyed before the application, which would otherwise walk the stage and
    // free the layer's children out from under it.
    // Both let go of the world container before the application walks the
    // stage and frees it out from under them.
    this.atmosphere?.destroy();
    this.atmosphere = null;
    this.lighting?.destroy();
    this.lighting = null;
    this.weather?.destroy();
    this.weather = null;

    // The canvas belongs to the game and another backend may be about to take
    // it over, so the view is left in the DOM.
    this.app?.destroy({ removeView: false }, { children: true, texture: true, textureSource: true });
    this.app = null;
    this.world = null;
    this.active = null;
  }

  // ── Display list ──

  /** The `Graphics` accepting geometry right now, opening a new one if needed. */
  private openGraphics(): Graphics {
    if (this.active) return this.active;

    let graphics = this.graphicsPool[this.graphicsUsed];
    if (!graphics) {
      graphics = new Graphics();
      this.graphicsPool[this.graphicsUsed] = graphics;
    }
    this.graphicsUsed++;
    graphics.clear();
    this.world?.addChild(graphics);
    this.active = graphics;
    return graphics;
  }

  /** Close the run of same-coloured rectangles with the single fill it earned. */
  private flushRun(): void {
    if (this.runFill === null) return;
    const color = this.color(this.runFill);
    // `active` is non-null here: a run only exists because a rect opened one.
    this.active?.fill({ color: color.rgb, alpha: color.a * this.runAlpha });
    this.runFill = null;
  }

  private drawOther(c: DrawCommand): void {
    switch (c.op) {
      case 'rect':
        // Handled on the hot path in `submit`.
        break;

      case 'strokeRect': {
        const color = this.color(c.stroke);
        this.openGraphics()
          .rect(c.x, c.y, c.w, c.h)
          // Canvas centres a stroke on the path, which is Pixi's 0.5 alignment.
          .stroke({ color: color.rgb, alpha: color.a * c.alpha, width: c.lineWidth, alignment: 0.5 });
        break;
      }

      case 'image': {
        const texture = this.texture(c.image);
        const graphics = this.openGraphics();
        // `Graphics.texture` takes its opacity from the current fill style
        // rather than an argument, so the alpha is set just before the draw.
        graphics.setFillStyle({ color: 0xffffff, alpha: c.alpha });
        graphics.texture(texture, 0xffffff, c.x, c.y, c.image.width, c.image.height);
        break;
      }

      case 'text': {
        const font = this.font(c.font);
        const text = this.acquireText(c.text, c.font, c.fill, c.align, font);
        // Canvas positions text on its baseline; Pixi positions it by the top of
        // the glyph box, so the ascent is subtracted to make the two agree.
        text.position.set(c.x, c.y - font.ascent);
        text.alpha = c.alpha;
        this.world?.addChild(text);
        // Text is its own display object, so the next shape needs a new
        // `Graphics` above it to keep later commands painting over earlier ones.
        this.active = null;
        break;
      }

      case 'path': {
        if (c.points.length === 0) break;
        const graphics = this.openGraphics().poly(c.points, c.closed);
        if (c.fill) {
          const color = this.color(c.fill);
          graphics.fill({ color: color.rgb, alpha: color.a * c.alpha });
        }
        if (c.stroke) {
          const color = this.color(c.stroke);
          graphics.stroke({ color: color.rgb, alpha: color.a * c.alpha, width: c.lineWidth, alignment: 0.5 });
        }
        break;
      }

      case 'circle': {
        const graphics = this.openGraphics().circle(c.x, c.y, c.r);
        if (c.fill) {
          const color = this.color(c.fill);
          graphics.fill({ color: color.rgb, alpha: color.a * c.alpha });
        }
        if (c.stroke) {
          const color = this.color(c.stroke);
          graphics.stroke({ color: color.rgb, alpha: color.a * c.alpha, width: c.lineWidth, alignment: 0.5 });
        }
        break;
      }

      case 'gradient':
        this.drawGradient(c);
        break;
    }
  }

  /**
   * Gradients are approximated with flat bands, which the command contract
   * explicitly allows.
   *
   * The bands never overlap, and that is the point: these washes are drawn at
   * alphas around one tenth, and overlapping translucent bands would compound
   * into a visibly darker core instead of a smooth falloff. Linear washes become
   * abutting horizontal strips and radial ones become concentric stroked rings,
   * both of which tile the area exactly once.
   *
   * The vertical axis for a linear wash is an assumption: the command carries
   * the rectangle being filled but not the gradient's own axis, so there is
   * nothing better to infer from.
   */
  private drawGradient(c: Extract<DrawCommand, { op: 'gradient' }>): void {
    if (c.stops.length === 0) return;
    const graphics = this.openGraphics();

    if (c.kind === 'linear') {
      for (let i = 0; i < GRADIENT_BANDS; i++) {
        const top = c.y + (c.h * i) / GRADIENT_BANDS;
        const bottom = c.y + (c.h * (i + 1)) / GRADIENT_BANDS;
        const color = this.sampleStops(c.stops, (i + 0.5) / GRADIENT_BANDS);
        graphics
          .rect(c.x, top, c.w, bottom - top)
          .fill({ color: color.rgb, alpha: color.a * c.alpha });
      }
      return;
    }

    // The recorder hands radial washes a bounding box twice the outer radius,
    // so the circle is the box's inscribed one.
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h / 2;
    const outer = c.w / 2;
    if (outer <= 0) return;
    const band = outer / GRADIENT_BANDS;

    const centre = this.sampleStops(c.stops, 0.5 / GRADIENT_BANDS);
    graphics.circle(cx, cy, band).fill({ color: centre.rgb, alpha: centre.a * c.alpha });

    for (let i = 1; i < GRADIENT_BANDS; i++) {
      const color = this.sampleStops(c.stops, (i + 0.5) / GRADIENT_BANDS);
      // A stroke of exactly one band's width centred on the band's midpoint is
      // an annulus, which is how a ring is drawn without cutting a hole.
      graphics
        .circle(cx, cy, band * (i + 0.5))
        .stroke({ color: color.rgb, alpha: color.a * c.alpha, width: band, alignment: 0.5 });
    }
  }

  /** The colour a stop list reaches at `t`, interpolated in straight RGBA. */
  private sampleStops(stops: { at: number; color: string }[], t: number): Rgba {
    if (stops.length === 1) return this.color(stops[0].color);

    let lower = stops[0];
    let upper = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].at && t <= stops[i + 1].at) {
        lower = stops[i];
        upper = stops[i + 1];
        break;
      }
    }

    const span = upper.at - lower.at;
    const k = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - lower.at) / span));
    const a = this.color(lower.color);
    const b = this.color(upper.color);
    const r = Math.round(a.r + (b.r - a.r) * k);
    const g = Math.round(a.g + (b.g - a.g) * k);
    const bl = Math.round(a.b + (b.b - a.b) * k);
    return { r, g, b: bl, a: a.a + (b.a - a.a) * k, rgb: (r << 16) | (g << 8) | bl };
  }

  // ── Caches ──

  /**
   * Textures are uploaded once per `BakedImage.id` and never re-read, because
   * the sprite cache bakes an image once and hands back the same bytes forever.
   */
  private texture(image: BakedImage): Texture {
    const cached = this.textures.get(image.id);
    if (cached) return cached;

    const source = new BufferImageSource({
      resource: this.premultiply(image.rgba),
      width: image.width,
      height: image.height,
      // Without this the buffer source guesses BGRA from a byte array and the
      // sprites come out with red and blue swapped.
      format: 'rgba8unorm',
      // The bytes arrive straight and are premultiplied above, which is what
      // Pixi's default blending expects.
      alphaMode: 'premultiplied-alpha',
      scaleMode: 'nearest',
      // These are the game's whole sprite set and are wanted every frame, so
      // letting the collector unload and re-upload them would be pure waste.
      autoGarbageCollect: false,
    });

    const texture = new Texture({ source });
    this.textures.set(image.id, texture);
    return texture;
  }

  /** Copy straight RGBA into premultiplied RGBA, leaving the caller's bytes alone. */
  private premultiply(rgba: Uint8ClampedArray): Uint8Array {
    const out = new Uint8Array(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      const a = rgba[i + 3];
      if (a === 255) {
        out[i] = rgba[i];
        out[i + 1] = rgba[i + 1];
        out[i + 2] = rgba[i + 2];
      } else if (a !== 0) {
        const k = a / 255;
        out[i] = Math.round(rgba[i] * k);
        out[i + 1] = Math.round(rgba[i + 1] * k);
        out[i + 2] = Math.round(rgba[i + 2] * k);
      }
      out[i + 3] = a;
    }
    return out;
  }

  /**
   * Text objects are keyed by everything that decides their texture, so a label
   * that says the same thing this frame as last frame costs a position write
   * rather than a canvas rasterisation. The list per key covers the case of the
   * same string appearing twice in one frame, which needs two objects.
   */
  private acquireText(
    content: string,
    fontSpec: string,
    fill: string,
    align: CanvasTextAlign,
    font: ParsedFont,
  ): Text {
    const key = `${fontSpec}\u0000${fill}\u0000${align}\u0000${content}`;
    let entry = this.textCache.get(key);
    if (!entry) {
      entry = { items: [], used: 0, usedInFrame: -1, lastFrame: this.frameId };
      this.textCache.set(key, entry);
    }
    if (entry.usedInFrame !== this.frameId) {
      entry.usedInFrame = this.frameId;
      entry.used = 0;
    }
    entry.lastFrame = this.frameId;

    let text = entry.items[entry.used];
    if (!text) {
      text = new Text({
        text: content,
        style: {
          fontFamily: font.family,
          fontSize: font.size,
          fontWeight: font.weight,
          fontStyle: font.style,
          fill,
        },
      });
      // Canvas alignment is about the anchor point rather than a text box, so
      // it maps onto the horizontal anchor exactly.
      text.anchor.set(align === 'center' ? 0.5 : align === 'right' || align === 'end' ? 1 : 0, 0);
      entry.items[entry.used] = text;
    }
    entry.used++;
    return text;
  }

  /** Drop text objects that have not been asked for in a long while. */
  private sweepTextCache(): void {
    if (this.frameId % TEXT_TTL_FRAMES !== 0) return;
    for (const [key, entry] of this.textCache) {
      if (this.frameId - entry.lastFrame < TEXT_TTL_FRAMES) continue;
      for (const text of entry.items) text.destroy({ texture: true, textureSource: true });
      this.textCache.delete(key);
    }
  }

  /**
   * Parsing a CSS colour goes through a full string parser, which is far too
   * expensive to repeat thousands of times a frame. The game draws from a small
   * fixed palette, so the cache stays small and is warm after the first frame.
   */
  private color(css: string): Rgba {
    const cached = this.colors.get(css);
    if (cached) return cached;

    let parsed: Rgba;
    try {
      const c = Color.shared.setValue(css);
      const [r, g, b] = c.toUint8RgbArray();
      parsed = { r, g, b, a: c.alpha, rgb: c.toNumber() };
    } catch {
      // A colour the parser rejects is dropped rather than thrown, because a
      // single bad string should not take down the whole frame.
      parsed = { r: 0, g: 0, b: 0, a: 0, rgb: 0 };
    }
    this.colors.set(css, parsed);
    return parsed;
  }

  /** Split a CSS font shorthand, and measure the ascent the baseline needs. */
  private font(css: string): ParsedFont {
    const cached = this.fonts.get(css);
    if (cached) return cached;

    const match = /^\s*(?:(italic|oblique)\s+)?(?:(bold|bolder|[1-9]00)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/i.exec(css);
    // The game only ever asks for normal or bold, so a numeric weight is folded
    // to whichever of the two it is nearer.
    const weight = match?.[2]?.toLowerCase();
    const parsed: ParsedFont = {
      style: match?.[1] ? 'italic' : 'normal',
      weight: weight && (weight === 'bold' || weight === 'bolder' || parseInt(weight, 10) >= 600) ? 'bold' : 'normal',
      size: match ? parseFloat(match[3]) : 10,
      family: match ? match[4].trim() : 'monospace',
      ascent: CanvasTextMetrics.measureFont(css).ascent,
    };
    this.fonts.set(css, parsed);
    return parsed;
  }
}

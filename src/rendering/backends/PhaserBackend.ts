/**
 * The Phaser backend: a recorded frame replayed through Phaser 4's WebGL renderer.
 *
 * Phaser is built around owning the frame: it runs its own requestAnimationFrame
 * loop, updates scenes, and renders whenever the browser is ready. This game owns
 * its frame instead, and `submit` is required to leave the canvas showing exactly
 * the frame it was handed. The two are reconciled by putting Phaser's loop to
 * sleep once the scene is up and pumping it by hand from `submit`, so a submitted
 * frame is on screen by the time the call returns and Phaser never renders a frame
 * the game did not ask for. The scene itself is inert: it has no `update`, holds no
 * state, and exists only to own a display list and a camera.
 */

import * as Phaser from 'phaser';
import type { BakedImage, Frame, RenderBackend } from '../DrawCommand';

/** A CSS colour taken apart once: packed RGB for Phaser, alpha kept separate. */
interface Paint {
  rgb: number;
  alpha: number;
  r: number;
  g: number;
  b: number;
}

const OPAQUE_BLACK: Paint = { rgb: 0x000000, alpha: 1, r: 0, g: 0, b: 0 };

/** Bands used to fake a linear gradient. Enough that a soft wash reads as smooth. */
const GRADIENT_BANDS = 32;

/**
 * Colour strings are recycled aggressively by the palette but also generated per
 * frame with full float precision (`rgba(255,60,40,0.13866)`), so the cache is
 * capped rather than left to grow with every distinct pulse value.
 */
const COLOR_CACHE_LIMIT = 2048;

/** Whether this browser can give a WebGL context at all. */
function supportsWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    return !!(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * An empty scene. Everything is driven from the backend, which reaches in through
 * `scene.add` and `scene.cameras`; the scene's only job is to say when it is ready.
 */
class FrameScene extends Phaser.Scene {
  /** Resolves the backend's `init` promise. Cleared once fired. */
  ready: (() => void) | null = null;

  constructor() {
    super({ key: 'fatefall-frame' });
  }

  create(): void {
    const ready = this.ready;
    this.ready = null;
    if (ready) ready();
  }
}

export class PhaserBackend implements RenderBackend {
  readonly name = 'Phaser';

  private game: Phaser.Game | null = null;
  private scene: FrameScene | null = null;

  /**
   * Batching strategy. Rectangles are over ninety-five per cent of a frame and
   * run into the thousands, so they go into `Graphics` objects that are cleared
   * and refilled in place: a Graphics command buffer costs an array push per
   * shape, where a game object per rectangle would cost an allocation, a
   * transform and a display-list entry per rectangle per frame. Only images and
   * text need real game objects, and those are pooled by slot. A Graphics object
   * carries one depth, so it cannot straddle an image or a piece of text: the
   * command list is instead cut into runs, one Graphics object per run of
   * consecutive drawing commands, with depths assigned in submission order so
   * later commands paint over earlier ones. Frames have a stable shape, so the
   * pools settle after the first frame or two and stop allocating entirely.
   */
  private readonly graphicsPool: Phaser.GameObjects.Graphics[] = [];
  private readonly imagePool: Phaser.GameObjects.Image[] = [];
  private readonly textPool: Phaser.GameObjects.Text[] = [];
  /**
   * What each pooled Text was last told to show. Setting text, font or colour
   * re-renders the object's private canvas and re-uploads its texture, so the
   * setters are skipped when nothing changed, which is the common case.
   */
  private readonly textState: { text: string; font: string; fill: string; ascent: number }[] = [];

  /** Texture keys already uploaded, mapped to the key actually safe to draw. */
  private readonly textures = new Map<string, string>();
  private readonly colors = new Map<string, Paint>();

  /** The camera background is only reassigned when the frame's clear changes. */
  private clearColor = '';

  /** Reused for CSS colours the hand-rolled parser does not recognise. */
  private probe: CanvasRenderingContext2D | null = null;

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    const scene = new FrameScene();
    const created = new Promise<void>(resolve => { scene.ready = resolve; });

    const game = new Phaser.Game({
      // Phaser refuses AUTO once it is handed a canvas, because it will not run
      // its own feature detection against an element it did not create. The
      // choice is made here instead, on a throwaway canvas so the real one keeps
      // its one and only context for whichever renderer actually gets it.
      type: supportsWebGL() ? Phaser.WEBGL : Phaser.CANVAS,
      // Phaser adopts the game's own canvas rather than making one. `parent: null`
      // stops it relocating an element that is already placed in the document.
      canvas,
      parent: null,
      width,
      height,
      // NONE leaves the canvas' CSS size alone; the page already lays it out.
      scale: { mode: Phaser.Scale.ScaleModes.NONE },
      pixelArt: true,
      transparent: false,
      backgroundColor: '#000000',
      banner: false,
      // The game handles its own keyboard and pointer input on this canvas, and
      // Phaser's input plugin would attach a second set of listeners to it.
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      audio: { noAudio: true },
      scene,
    });
    this.game = game;

    // A renderer that cannot start should fail the caller rather than leave it
    // awaiting forever: Phaser reports a failed boot by throwing out of its own
    // DOM-ready callback, where nothing is left to reject this promise.
    let timer = 0;
    const bootFailed = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('PhaserBackend: the scene did not boot')), 5000);
    });
    try {
      await Promise.race([created, bootFailed]);
    } finally {
      window.clearTimeout(timer);
    }

    this.scene = scene;

    // From here the game drives the clock. Sleeping the TimeStep stops Phaser's
    // requestAnimationFrame; `submit` advances it exactly one step per frame.
    game.loop.sleep();
  }

  submit(frame: Frame): void {
    const game = this.game;
    const scene = this.scene;
    if (!game || !scene) return;

    if (frame.clear !== this.clearColor) {
      this.clearColor = frame.clear;
      scene.cameras.main.setBackgroundColor(frame.clear);
    }

    let usedGraphics = 0;
    let usedImages = 0;
    let usedTexts = 0;
    let depth = 0;

    let layer: Phaser.GameObjects.Graphics | null = null;
    // Runs of rectangles share a colour far more often than not, and a skipped
    // fillStyle is one fewer entry for the renderer to walk.
    let lastFill = -1;
    let lastFillAlpha = -1;

    const target = (): Phaser.GameObjects.Graphics => {
      if (layer) return layer;
      let g = this.graphicsPool[usedGraphics];
      if (!g) {
        g = scene.add.graphics();
        this.graphicsPool.push(g);
      }
      usedGraphics++;
      g.clear();
      g.setVisible(true);
      g.setDepth(depth++);
      lastFill = -1;
      lastFillAlpha = -1;
      layer = g;
      return g;
    };

    for (const c of frame.commands) {
      switch (c.op) {
        case 'rect': {
          const paint = this.paint(c.fill);
          const alpha = paint.alpha * c.alpha;
          const g = target();
          if (paint.rgb !== lastFill || alpha !== lastFillAlpha) {
            g.fillStyle(paint.rgb, alpha);
            lastFill = paint.rgb;
            lastFillAlpha = alpha;
          }
          g.fillRect(c.x, c.y, c.w, c.h);
          break;
        }

        case 'strokeRect': {
          const paint = this.paint(c.stroke);
          const g = target();
          g.lineStyle(c.lineWidth, paint.rgb, paint.alpha * c.alpha);
          g.strokeRect(c.x, c.y, c.w, c.h);
          break;
        }

        case 'path': {
          if (c.points.length === 0) break;
          const g = target();
          g.beginPath();
          for (let i = 0; i < c.points.length; i++) {
            const p = c.points[i];
            if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
          }
          if (c.closed) g.closePath();
          if (c.fill) {
            const paint = this.paint(c.fill);
            g.fillStyle(paint.rgb, paint.alpha * c.alpha);
            g.fillPath();
            lastFill = -1;
          }
          if (c.stroke) {
            const paint = this.paint(c.stroke);
            g.lineStyle(c.lineWidth, paint.rgb, paint.alpha * c.alpha);
            g.strokePath();
          }
          break;
        }

        case 'circle': {
          const g = target();
          if (c.fill) {
            const paint = this.paint(c.fill);
            g.fillStyle(paint.rgb, paint.alpha * c.alpha);
            g.fillCircle(c.x, c.y, c.r);
            lastFill = -1;
          }
          if (c.stroke) {
            const paint = this.paint(c.stroke);
            g.lineStyle(c.lineWidth, paint.rgb, paint.alpha * c.alpha);
            g.strokeCircle(c.x, c.y, c.r);
          }
          break;
        }

        case 'gradient': {
          this.drawGradient(target(), c);
          lastFill = -1;
          break;
        }

        case 'image': {
          let img = this.imagePool[usedImages];
          if (!img) {
            // Origin (0, 0) so the command's x and y mean the top-left corner,
            // which is what the recorded drawImage call meant.
            img = scene.add.image(0, 0, '__DEFAULT').setOrigin(0, 0);
            this.imagePool.push(img);
          }
          usedImages++;
          img.setTexture(this.textureKey(c.image));
          img.setPosition(c.x, c.y);
          img.setAlpha(c.alpha);
          img.setVisible(true);
          img.setDepth(depth++);
          layer = null;
          break;
        }

        case 'text': {
          const slot = usedTexts;
          let t = this.textPool[slot];
          if (!t) {
            t = scene.add.text(0, 0, '', { color: '#ffffff' });
            this.textPool.push(t);
            this.textState.push({ text: '', font: '', fill: '', ascent: 0 });
          }
          usedTexts++;
          const state = this.textState[slot];
          if (state.font !== c.font) {
            t.setFont(c.font);
            state.font = c.font;
            // A canvas fillText places the baseline at y; a Phaser Text places
            // its top edge there. The font's ascent is the distance between them.
            state.ascent = t.style.getTextMetrics().ascent;
          }
          if (state.text !== c.text) {
            t.setText(c.text);
            state.text = c.text;
          }
          if (state.fill !== c.fill) {
            t.setColor(c.fill);
            state.fill = c.fill;
          }
          // 'start' and 'end' are treated as left and right: the game's text is
          // all left-to-right, and the recorder only ever emits the three.
          const originX = c.align === 'center' ? 0.5 : (c.align === 'right' || c.align === 'end') ? 1 : 0;
          t.setOrigin(originX, 0);
          t.setPosition(c.x, c.y - state.ascent);
          t.setAlpha(c.alpha);
          t.setVisible(true);
          t.setDepth(depth++);
          layer = null;
          break;
        }
      }
    }

    // Pooled objects left over from a busier frame must not survive into this one.
    for (let i = usedGraphics; i < this.graphicsPool.length; i++) {
      this.graphicsPool[i].clear();
      this.graphicsPool[i].setVisible(false);
    }
    for (let i = usedImages; i < this.imagePool.length; i++) this.imagePool[i].setVisible(false);
    for (let i = usedTexts; i < this.textPool.length; i++) this.textPool[i].setVisible(false);

    // One Phaser step: update the (empty) scene, clear to the camera background,
    // and render the display list. The canvas holds this frame when it returns.
    game.loop.tick();
  }

  destroy(): void {
    const game = this.game;
    this.game = null;
    this.scene = null;

    if (game) {
      for (const key of this.textures.values()) {
        if (key !== '__DEFAULT') game.textures.remove(key);
      }
      game.destroy(false);
      // Phaser defers teardown to its next step, and this backend's step never
      // comes on its own, so the loop is pumped once to let the destroy run.
      game.loop.tick();
    }

    this.graphicsPool.length = 0;
    this.imagePool.length = 0;
    this.textPool.length = 0;
    this.textState.length = 0;
    this.textures.clear();
    this.colors.clear();
    this.probe = null;
    this.clearColor = '';
  }

  // ── Textures ──────────────────────────────────────

  /**
   * Upload a baked sprite once and remember its key. Phaser's `pixelArt` config
   * already asks for nearest filtering, but the mode is set on the texture too so
   * a fallback to the canvas renderer cannot smudge it.
   */
  private textureKey(image: BakedImage): string {
    const known = this.textures.get(image.id);
    if (known !== undefined) return known;

    const game = this.game;
    let key = '__DEFAULT';
    if (game) {
      // A copy, not a view: Phaser holds on to the array, and the sprite cache is
      // free to reuse the buffer it baked into.
      const texture = game.textures.addUint8Array(image.id, new Uint8Array(image.rgba), image.width, image.height);
      if (texture) {
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        key = image.id;
      }
    }
    this.textures.set(image.id, key);
    return key;
  }

  // ── Gradients ─────────────────────────────────────

  /**
   * Gradients are approximated with flat bands. They are only used for large soft
   * washes such as the night overlay, where a band boundary is well below what the
   * eye picks out, and the alternative is a shader or a baked texture for something
   * that appears once or twice a frame.
   */
  private drawGradient(
    g: Phaser.GameObjects.Graphics,
    c: { kind: 'linear' | 'radial'; x: number; y: number; w: number; h: number; stops: { at: number; color: string }[]; alpha: number },
  ): void {
    if (c.stops.length === 0) return;

    if (c.kind === 'radial') {
      // Matching the 2D reference: the gradient is centred in the rect with a
      // radius of half its width, and everything past that takes the last stop.
      const last = this.sample(c.stops, 1);
      g.fillStyle(last.rgb, last.alpha * c.alpha);
      g.fillRect(c.x, c.y, c.w, c.h);

      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      const thickness = c.w / 2 / GRADIENT_BANDS;
      // Rings are stroked rather than filled because these ramps are nearly all
      // translucent: a real gradient composites one colour per pixel, whereas
      // stacked discs would blend thirty-two of them and turn a 0.08 alpha torch
      // glow into a solid blob. A stroke of width `thickness` centred half a band
      // in covers each annulus exactly once, and the innermost one covers the
      // centre. The smoothness is raised because a 32-gon is visible at this size.
      for (let i = GRADIENT_BANDS; i > 0; i--) {
        const paint = this.sample(c.stops, (i - 0.5) / GRADIENT_BANDS);
        const mid = thickness * (i - 0.5);
        g.lineStyle(thickness, paint.rgb, paint.alpha * c.alpha);
        g.strokeEllipse(cx, cy, mid * 2, mid * 2, 64);
      }
      return;
    }

    // The recorder keeps the destination rect but not the gradient's own vector,
    // so the reference backend runs the ramp along the rect's diagonal. Banding
    // is done across whichever axis dominates, which is exact for the axis-aligned
    // washes the game actually draws and a fair approximation otherwise.
    const acrossX = Math.abs(c.w) >= Math.abs(c.h);
    const span = acrossX ? c.w : c.h;
    const step = span / GRADIENT_BANDS;
    // Bands butt up against each other rather than overlapping: they share an
    // exact edge, and doubling a pixel would show as a seam on a translucent wash.
    for (let i = 0; i < GRADIENT_BANDS; i++) {
      const paint = this.sample(c.stops, (i + 0.5) / GRADIENT_BANDS);
      g.fillStyle(paint.rgb, paint.alpha * c.alpha);
      if (acrossX) {
        g.fillRect(c.x + step * i, c.y, step, c.h);
      } else {
        g.fillRect(c.x, c.y + step * i, c.w, step);
      }
    }
  }

  /** The colour a gradient shows at position `t` along its ramp. */
  private sample(stops: { at: number; color: string }[], t: number): Paint {
    const first = stops[0];
    if (t <= first.at) return this.paint(first.color);
    for (let i = 1; i < stops.length; i++) {
      const b = stops[i];
      if (t > b.at) continue;
      const a = stops[i - 1];
      const spread = b.at - a.at;
      const k = spread <= 0 ? 1 : (t - a.at) / spread;
      const pa = this.paint(a.color);
      const pb = this.paint(b.color);
      const r = Math.round(pa.r + (pb.r - pa.r) * k);
      const g = Math.round(pa.g + (pb.g - pa.g) * k);
      const bl = Math.round(pa.b + (pb.b - pa.b) * k);
      return { rgb: (r << 16) | (g << 8) | bl, alpha: pa.alpha + (pb.alpha - pa.alpha) * k, r, g, b: bl };
    }
    return this.paint(stops[stops.length - 1].color);
  }

  // ── Colours ───────────────────────────────────────

  /**
   * Phaser wants a packed integer and a separate alpha where the recorder has a
   * CSS string, and there is one of these per rectangle. The palette reuses a few
   * hundred strings, so the parse is memoised; the cap is there because sprite
   * flourishes also mint strings like `rgba(255,60,40,0.1386)` afresh each frame.
   */
  private paint(css: string): Paint {
    const hit = this.colors.get(css);
    if (hit) return hit;
    if (this.colors.size >= COLOR_CACHE_LIMIT) this.colors.clear();
    const parsed = this.parse(css);
    this.colors.set(css, parsed);
    return parsed;
  }

  private parse(css: string): Paint {
    const s = css.trim();

    if (s.charCodeAt(0) === 35) {
      const digits = s.length - 1;
      if (digits === 3 || digits === 4) {
        const r = Number.parseInt(s[1] + s[1], 16);
        const g = Number.parseInt(s[2] + s[2], 16);
        const b = Number.parseInt(s[3] + s[3], 16);
        const a = digits === 4 ? Number.parseInt(s[4] + s[4], 16) / 255 : 1;
        if (!Number.isNaN(r + g + b + a)) return { rgb: (r << 16) | (g << 8) | b, alpha: a, r, g, b };
      } else if (digits === 6 || digits === 8) {
        const rgb = Number.parseInt(s.slice(1, 7), 16);
        // Sprite glows build their alpha by appending two hex digits to a palette
        // colour, so eight-digit hex is a normal case here rather than an oddity.
        const a = digits === 8 ? Number.parseInt(s.slice(7, 9), 16) / 255 : 1;
        if (!Number.isNaN(rgb + a)) {
          return { rgb, alpha: a, r: (rgb >> 16) & 0xff, g: (rgb >> 8) & 0xff, b: rgb & 0xff };
        }
      }
    } else if (s.charCodeAt(0) === 114) {
      const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
      if (m) {
        const r = Math.min(255, Math.round(Number(m[1])));
        const g = Math.min(255, Math.round(Number(m[2])));
        const b = Math.min(255, Math.round(Number(m[3])));
        const a = m[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(m[4])));
        return { rgb: (r << 16) | (g << 8) | b, alpha: a, r, g, b };
      }
    }

    return this.parseViaCanvas(s);
  }

  /**
   * Anything else (named colours, percentages, hsl) is handed to the browser: a
   * 2D context normalises whatever it is given into hex or rgba on read-back,
   * which the fast path above can then take apart.
   */
  private parseViaCanvas(css: string): Paint {
    let probe = this.probe;
    if (!probe) {
      probe = document.createElement('canvas').getContext('2d');
      this.probe = probe;
    }
    if (!probe) return OPAQUE_BLACK;
    probe.fillStyle = '#000000';
    probe.fillStyle = css;
    const normalised = probe.fillStyle;
    // Guard against a rejected value: the context keeps its old style, and
    // re-entering here with the same string would loop.
    if (typeof normalised !== 'string' || normalised === css) return OPAQUE_BLACK;
    return this.parse(normalised);
  }
}

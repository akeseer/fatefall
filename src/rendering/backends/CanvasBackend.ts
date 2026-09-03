/**
 * The 2D canvas backend: the game's original renderer, behind the interface.
 *
 * It is the default because it is the only one that costs no runtime
 * dependency, and it doubles as the reference: a frame replayed here must look
 * exactly like the same frame drawn straight to a context, which is what makes
 * the recording trustworthy enough for the other backends to build on.
 */

import type { BakedImage, Frame, RenderBackend, SceneMood } from '../DrawCommand';
import { transitionShape } from '../DrawCommand';
import { themeLight } from '../ThemeLight';

/** How far the world is crushed underground, where the party's torch is the only light. */
const UNDERGROUND_DARKNESS = 0.78;

/** How far it is crushed outdoors at true midnight. */
const OUTDOOR_NIGHT_DARKNESS = 0.55;

/** A fight must never be harder to read than the walk to it. */
const COMBAT_RELIEF = 0.82;

/** Reach of the carried torch, and of the moonlight the party keeps about them. */
const TORCH_RADIUS = 310;
const GLOW_RADIUS = 380;

/** A wash per weather, matched to the ids the game actually sets. */
const WEATHER_TINTS: Record<string, { c: string; a: number }> = {
  cloudy: { c: '#8a93a8', a: 0.10 },
  rain: { c: '#23374f', a: 0.18 },
  heavy_rain: { c: '#1a2a3f', a: 0.28 },
  fog: { c: '#b9c2cc', a: 0.22 },
  snow: { c: '#e1e6f5', a: 0.12 },
  sandstorm: { c: '#c09a52', a: 0.30 },
  eerie_mist: { c: '#6f8f7a', a: 0.24 },
  blood_red_sky: { c: '#8e1f22', a: 0.16 },
};

export class CanvasBackend implements RenderBackend {
  readonly name = 'Canvas 2D';
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  /** Sprites as small canvases, so they can be composited rather than written. */
  private images = new Map<string, HTMLCanvasElement>();

  async init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void> {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CanvasBackend: this browser gave no 2D context');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.width = width;
    this.height = height;
  }

  submit(frame: Frame): void {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.globalAlpha = 1;
    ctx.fillStyle = frame.clear;
    ctx.fillRect(0, 0, this.width, this.height);

    for (const c of frame.commands) {
      switch (c.op) {
        case 'rect':
          ctx.globalAlpha = c.alpha;
          ctx.fillStyle = c.fill;
          ctx.fillRect(c.x, c.y, c.w, c.h);
          break;
        case 'strokeRect':
          ctx.globalAlpha = c.alpha;
          ctx.strokeStyle = c.stroke;
          ctx.lineWidth = c.lineWidth;
          ctx.strokeRect(c.x, c.y, c.w, c.h);
          break;
        case 'image':
          // Blitted, not written. putImageData replaces pixels including
          // their alpha, so every sprite used to punch a transparent hole in
          // the map around itself and the page showed through as a dark box.
          // drawImage composites, which is what a sprite over terrain wants.
          ctx.globalAlpha = c.alpha;
          ctx.drawImage(this.texture(c.image), c.x, c.y);
          break;
        case 'text':
          ctx.globalAlpha = c.alpha;
          ctx.fillStyle = c.fill;
          ctx.font = c.font;
          ctx.textAlign = c.align;
          ctx.fillText(c.text, c.x, c.y);
          break;
        case 'path': {
          ctx.globalAlpha = c.alpha;
          ctx.beginPath();
          c.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          if (c.closed) ctx.closePath();
          if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
          if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.lineWidth; ctx.stroke(); }
          break;
        }
        case 'circle': {
          ctx.globalAlpha = c.alpha;
          ctx.beginPath();
          ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
          if (c.fill) { ctx.fillStyle = c.fill; ctx.fill(); }
          if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = c.lineWidth; ctx.stroke(); }
          break;
        }
        case 'gradient': {
          ctx.globalAlpha = c.alpha;
          const g = c.kind === 'linear'
            ? ctx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h)
            : ctx.createRadialGradient(c.x + c.w / 2, c.y + c.h / 2, 0, c.x + c.w / 2, c.y + c.h / 2, c.w / 2);
          for (const s of c.stops) g.addColorStop(s.at, s.color);
          ctx.fillStyle = g;
          ctx.fillRect(c.x, c.y, c.w, c.h);
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
    this.applyMood(ctx, frame.mood);
    this.applyTransition(ctx, frame.mood);
  }

  /**
   * Light and tint the finished scene.
   *
   * The map renderer draws the world at noon under a clear sky and leaves the
   * mood to whoever is replaying the frame, so this is the plain-canvas answer
   * to what Pixi does with a lighting layer and a colour grade. It is coarser
   * on purpose — one multiply pass and one tint — but it is the difference
   * between a dungeon that is lit by a torch and a dungeon lit like a car park.
   *
   * Unlike the recorder, this holds a real context, so it can use a gradient
   * and a blend mode rather than being limited to flat rectangles.
   */
  private applyMood(ctx: CanvasRenderingContext2D, mood: SceneMood): void {
    const tint = mood.weather ? WEATHER_TINTS[mood.weather] : undefined;
    if (tint) {
      ctx.globalAlpha = tint.a;
      ctx.fillStyle = tint.c;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }

    const night = mood.underground ? UNDERGROUND_DARKNESS : OUTDOOR_NIGHT_DARKNESS * Math.max(0, 1 - mood.daylight);
    const darkness = mood.inCombat ? night * COMBAT_RELIEF : night;
    if (darkness <= 0.01) return;

    // Multiply, so the layer can only ever scale the world down — the party's
    // light then reveals the map's own pixels instead of laying a pool of
    // colour over them.
    const radius = mood.underground ? TORCH_RADIUS : GLOW_RADIUS;
    const fx = mood.focus ? mood.focus.x : this.width / 2;
    const fy = mood.focus ? mood.focus.y : this.height / 2;
    const grad = ctx.createRadialGradient(fx, fy, 0, fx, fy, radius);
    const lit = Math.round(255 * (1 - darkness * (mood.underground ? 0 : 0.45)));
    const dark = Math.round(255 * (1 - darkness));
    // Underground the core takes the colour of the place, as the Pixi torch does.
    const [tr, tg, tb] = mood.underground ? themeLight(mood.themeId) : [1, 1, 0.92];
    grad.addColorStop(0, `rgb(${Math.round(255 * tr)},${Math.round(lit * tg)},${Math.round(lit * tb)})`);
    grad.addColorStop(1, `rgb(${dark},${dark},${Math.round(dark * 1.12)})`);

    // One fill of the whole frame with the gradient. A canvas gradient
    // carries its last stop out past its radius, so this darkens the corners
    // to `dark` and opens the light in the middle in a single multiply. The
    // first version filled the frame with `dark` and then drew the gradient
    // over a square around the party — which multiplied that square twice,
    // and left a hard-edged box darker than the room around it.
    const previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = previous;
  }

  /**
   * The lens, last of all: the same fade and blinds the Pixi backend draws,
   * from the same shared shape, so a transition looks identical whichever
   * backend the player is on.
   */
  private applyTransition(ctx: CanvasRenderingContext2D, mood: SceneMood): void {
    const t = mood.transition;
    if (!t) return;
    const { closed, black } = transitionShape(t.kind, t.progress);
    ctx.fillStyle = '#000';
    if (closed > 0) {
      const n = 8;
      const barH = Math.ceil(this.height / n);
      const w = Math.round(this.width * closed);
      for (let i = 0; i < n; i++) ctx.fillRect(i % 2 === 0 ? 0 : this.width - w, i * barH, w, barH);
    }
    if (black > 0) {
      ctx.globalAlpha = black;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Sprites live on their own small canvas so they can be composited rather
   * than written. Built once per texture id and reused for the run.
   */
  private texture(image: BakedImage): HTMLCanvasElement {
    let cached = this.images.get(image.id);
    if (!cached) {
      cached = document.createElement('canvas');
      cached.width = image.width;
      cached.height = image.height;
      const c = cached.getContext('2d')!;
      c.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
      this.images.set(image.id, cached);
    }
    return cached;
  }

  destroy(): void {
    this.images.clear();
    this.ctx = null;
  }
}

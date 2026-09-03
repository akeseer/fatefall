/**
 * A canvas that writes down what it was asked to draw.
 *
 * It implements the slice of CanvasRenderingContext2D the game actually uses,
 * which the renderer and the sprite functions between them exercise about
 * eleven thousand times a frame. Nothing here draws; each call appends to a
 * command list that a backend replays.
 *
 * Being duck-typed rather than a subclass is deliberate: `MapRenderer` and the
 * sprite functions take a `CanvasRenderingContext2D` and are handed one of
 * these instead, with no change to either.
 */

import type { BakedImage, DrawCommand, Frame, SceneMood } from './DrawCommand';

interface GradientStop { at: number; color: string; }

/** What createLinearGradient and friends hand back to the caller. */
class RecordedGradient {
  readonly stops: GradientStop[] = [];
  constructor(
    readonly kind: 'linear' | 'radial',
    readonly x: number,
    readonly y: number,
    readonly w: number,
    readonly h: number,
  ) {}
  addColorStop(at: number, color: string): void {
    this.stops.push({ at, color });
  }
}

export class RecordingContext {
  private commands: DrawCommand[] = [];
  private clearColor = '#0a0a12';

  // ── Canvas state the game sets ──
  fillStyle: string | RecordedGradient = '#000';
  strokeStyle: string | RecordedGradient = '#000';
  lineWidth = 1;
  globalAlpha = 1;
  font = '10px monospace';
  textAlign: CanvasTextAlign = 'left';
  imageSmoothingEnabled = false;

  /** Saved states, for save() and restore(). */
  private stack: { fill: string | RecordedGradient; stroke: string | RecordedGradient; lineWidth: number; alpha: number; font: string; align: CanvasTextAlign; dx: number; dy: number }[] = [];
  /** Only translation is tracked; the game never scales or skews the world. */
  private dx = 0;
  private dy = 0;
  /** Rotation is used by two sprite flourishes and is folded into nothing. */
  private rotation = 0;

  private mood: SceneMood = { daylight: 1, underground: false, weather: null, focus: null, inCombat: false };

  /** Start a new frame. */
  begin(clear: string, mood: SceneMood): void {
    this.commands = [];
    this.clearColor = clear;
    this.mood = mood;
    this.dx = 0;
    this.dy = 0;
    this.rotation = 0;
    this.globalAlpha = 1;
    this.stack.length = 0;
  }

  /** The frame recorded since `begin`. */
  end(): Frame {
    return { clear: this.clearColor, commands: this.commands, mood: this.mood };
  }

  private solid(style: string | RecordedGradient): string {
    // A gradient used as a plain fill collapses to its first stop, which is
    // close enough for the two soft washes that do this.
    return typeof style === 'string' ? style : style.stops[0]?.color ?? '#000';
  }

  // ── Rectangles: the overwhelming majority of every frame ──
  fillRect(x: number, y: number, w: number, h: number): void {
    if (this.fillStyle instanceof RecordedGradient) {
      const g = this.fillStyle;
      this.commands.push({ op: 'gradient', kind: g.kind, x: x + this.dx, y: y + this.dy, w, h, stops: g.stops, alpha: this.globalAlpha });
      return;
    }
    this.commands.push({ op: 'rect', x: x + this.dx, y: y + this.dy, w, h, fill: this.fillStyle, alpha: this.globalAlpha });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.commands.push({
      op: 'strokeRect', x: x + this.dx, y: y + this.dy, w, h,
      stroke: this.solid(this.strokeStyle), lineWidth: this.lineWidth, alpha: this.globalAlpha,
    });
  }

  clearRect(_x: number, _y: number, _w: number, _h: number): void {
    // The backend clears the whole frame; partial clears are only ever used to
    // wipe an offscreen sprite canvas, which never reaches a backend.
  }

  // ── Text ──
  fillText(text: string, x: number, y: number): void {
    this.commands.push({
      op: 'text', text, x: x + this.dx, y: y + this.dy,
      fill: this.solid(this.fillStyle), font: this.font, align: this.textAlign, alpha: this.globalAlpha,
    });
  }

  // ── Paths ──
  private points: { x: number; y: number }[] = [];
  private pathClosed = false;

  beginPath(): void {
    this.points = [];
    this.pathClosed = false;
  }
  moveTo(x: number, y: number): void { this.points.push({ x: x + this.dx, y: y + this.dy }); }
  lineTo(x: number, y: number): void { this.points.push({ x: x + this.dx, y: y + this.dy }); }
  closePath(): void { this.pathClosed = true; }

  arc(x: number, y: number, r: number, _s: number, _e: number): void {
    this.circleAt = { x: x + this.dx, y: y + this.dy, r };
  }
  private circleAt: { x: number; y: number; r: number } | null = null;

  fill(): void {
    if (this.circleAt) {
      this.commands.push({ op: 'circle', ...this.circleAt, fill: this.solid(this.fillStyle), lineWidth: this.lineWidth, alpha: this.globalAlpha });
      this.circleAt = null;
      return;
    }
    if (this.points.length === 0) return;
    this.commands.push({ op: 'path', points: [...this.points], fill: this.solid(this.fillStyle), lineWidth: this.lineWidth, closed: true, alpha: this.globalAlpha });
  }

  stroke(): void {
    if (this.circleAt) {
      this.commands.push({ op: 'circle', ...this.circleAt, stroke: this.solid(this.strokeStyle), lineWidth: this.lineWidth, alpha: this.globalAlpha });
      this.circleAt = null;
      return;
    }
    if (this.points.length === 0) return;
    this.commands.push({ op: 'path', points: [...this.points], stroke: this.solid(this.strokeStyle), lineWidth: this.lineWidth, closed: this.pathClosed, alpha: this.globalAlpha });
  }

  // ── Transform and state ──
  save(): void {
    this.stack.push({ fill: this.fillStyle, stroke: this.strokeStyle, lineWidth: this.lineWidth, alpha: this.globalAlpha, font: this.font, align: this.textAlign, dx: this.dx, dy: this.dy });
  }
  restore(): void {
    const s = this.stack.pop();
    if (!s) return;
    this.fillStyle = s.fill;
    this.strokeStyle = s.stroke;
    this.lineWidth = s.lineWidth;
    this.globalAlpha = s.alpha;
    this.font = s.font;
    this.textAlign = s.align;
    this.dx = s.dx;
    this.dy = s.dy;
  }
  translate(x: number, y: number): void { this.dx += x; this.dy += y; }
  rotate(a: number): void { this.rotation += a; }

  // ── Gradients ──
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): RecordedGradient {
    return new RecordedGradient('linear', x0, y0, x1 - x0, y1 - y0);
  }
  createRadialGradient(x0: number, y0: number, _r0: number, _x1: number, _y1: number, r1: number): RecordedGradient {
    return new RecordedGradient('radial', x0 - r1, y0 - r1, r1 * 2, r1 * 2);
  }

  // ── Images ──

  /**
   * Sprites reach the screen through putImageData. That call replaces pixels
   * outright, alpha included, so every sprite used to punch a transparent
   * hole in the map around itself. Recording it as a draw lets the backends
   * composite instead, which is what a sprite over terrain has always wanted.
   *
   * The transform is still ignored, matching the original call: the game only
   * ever translates for two flourishes, neither of which draws a sprite.
   *
   * The sprite cache hands back the same ImageData object every time, so an
   * identity is minted once per sprite and a backend uploads each texture
   * only on the frame it first appears.
   */
  putImageData(data: ImageData, x: number, y: number): void {
    this.commands.push({ op: 'image', image: bakeImage(data), x, y, alpha: 1 });
  }
}

/** Stable identities for the sprite cache's ImageData objects. */
const bakedIds = new WeakMap<ImageData, string>();
let nextBakedId = 0;

/** Wrap a cached ImageData as a texture source, minting its id on first sight. */
export function bakeImage(data: ImageData): BakedImage {
  let id = bakedIds.get(data);
  if (id === undefined) {
    id = `sprite_${nextBakedId++}`;
    bakedIds.set(data, id);
  }
  return { id, width: data.width, height: data.height, rgba: data.data };
}

/**
 * The 2D canvas backend: the game's original renderer, behind the interface.
 *
 * It is the default because it is the only one that costs no runtime
 * dependency, and it doubles as the reference: a frame replayed here must look
 * exactly like the same frame drawn straight to a context, which is what makes
 * the recording trustworthy enough for the other backends to build on.
 */

import type { BakedImage, Frame, RenderBackend } from '../DrawCommand';

export class CanvasBackend implements RenderBackend {
  readonly name = 'Canvas 2D';
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  /** ImageData is what putImageData wants, rebuilt once per texture id. */
  private images = new Map<string, ImageData>();

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
          // putImageData ignores alpha by definition, which is why the
          // recorder pins it to 1 for this command.
          ctx.putImageData(this.imageData(c.image), c.x, c.y);
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
  }

  private imageData(image: BakedImage): ImageData {
    let data = this.images.get(image.id);
    if (!data) {
      data = new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height);
      this.images.set(image.id, data);
    }
    return data;
  }

  destroy(): void {
    this.images.clear();
    this.ctx = null;
  }
}

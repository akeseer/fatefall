import { GAME_WIDTH, GAME_HEIGHT } from './types';

export class Renderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Swap in a brand-new canvas element in the same place.
   *
   * A canvas keeps whichever context type it was first given for life, so a
   * canvas that has carried WebGL can never return a 2D context. Switching
   * renderers therefore means replacing the element, not reusing it.
   */
  replaceCanvas(): HTMLCanvasElement {
    const fresh = document.createElement('canvas');
    fresh.id = this.canvas.id;
    fresh.className = this.canvas.className;
    fresh.setAttribute('style', this.canvas.getAttribute('style') ?? '');
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.resize();
    return fresh;
  }

  resize() {
    const scale = Math.min(
      window.innerWidth / GAME_WIDTH,
      window.innerHeight / GAME_HEIGHT
    );
    this.canvas.width = GAME_WIDTH;
    this.canvas.height = GAME_HEIGHT;
    this.canvas.style.width = `${GAME_WIDTH * scale}px`;
    this.canvas.style.height = `${GAME_HEIGHT * scale}px`;
    // Scale the UI overlay with the same factor (it stays a logical 1024x768
    // box, centered like the canvas) so the HUD never outgrows the window.
    const overlay = document.getElementById('ui-overlay');
    if (overlay) overlay.style.transform = `translate(-50%, -50%) scale(${scale})`;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear() {
    this.ctx.fillStyle = '#0a0a12';
    this.ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }
}
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
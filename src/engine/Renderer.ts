import { GAME_WIDTH, GAME_HEIGHT } from './types';
import { computeLayout, type Layout, type ScaleMode } from '../settings/Settings';

/**
 * The canvas element and how it sits in the window.
 *
 * The game draws a fixed 1024x768 picture. This class owns the CSS side of
 * it: how large that picture is shown, how the HUD box is scaled to match,
 * and the swap of the element itself when the graphics backend changes. The
 * backing store (the canvas' own width and height) belongs to the backend
 * that draws into it, because a backend rendering at the display's density
 * needs more device pixels than logical ones.
 */
export class Renderer {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  /** How the picture meets the window; set from the player's display settings. */
  private scaleMode: ScaleMode = 'fit';
  private uiScale = 1;
  /** The last layout computed, for the settings readout and the density decision. */
  public layout: Layout = { canvasW: GAME_WIDTH, canvasH: GAME_HEIGHT, uiScale: 1, scale: 1 };
  /** Called after every relayout, with the new layout. */
  public onLayout: ((layout: Layout) => void) | null = null;

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

  /** Change how the picture is fitted; relays out at once. */
  setLayout(scaleMode: ScaleMode, uiScale: number): void {
    this.scaleMode = scaleMode;
    this.uiScale = uiScale;
    this.resize();
  }

  resize() {
    const layout = computeLayout(window.innerWidth, window.innerHeight, GAME_WIDTH, GAME_HEIGHT, this.scaleMode, this.uiScale);
    this.layout = layout;
    this.canvas.style.width = `${layout.canvasW}px`;
    this.canvas.style.height = `${layout.canvasH}px`;
    // The UI overlay stays a logical 1024x768 box, centered like the canvas,
    // and scales with the picture (times the player's UI scale) so the HUD
    // never outgrows the window.
    const overlay = document.getElementById('ui-overlay');
    if (overlay) overlay.style.transform = `translate(-50%, -50%) scale(${layout.uiScale})`;
    this.ctx.imageSmoothingEnabled = false;
    this.onLayout?.(layout);
  }

  clear() {
    this.ctx.fillStyle = '#0a0a12';
    this.ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  }
}

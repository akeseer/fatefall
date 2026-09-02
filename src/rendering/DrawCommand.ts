/**
 * A frame of drawing, described rather than performed.
 *
 * The map renderer and the sprite functions between them make about eleven
 * thousand canvas calls a frame, nearly all of them filled rectangles: the
 * pixel art is drawn a pixel at a time. Rather than rewrite that against a
 * second and third graphics library, the calls are recorded through a
 * canvas-shaped shim and replayed by whichever backend is in use.
 *
 * The upshot is that `MapRenderer` and `Sprites` know nothing about Pixi or
 * Phaser, and a backend only has to understand these few commands.
 */

/** A texture baked once from the sprite cache, in straight RGBA. */
export interface BakedImage {
  /** Stable key, so a backend can upload once and reuse. */
  id: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export type DrawCommand =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: string; alpha: number }
  | { op: 'strokeRect'; x: number; y: number; w: number; h: number; stroke: string; lineWidth: number; alpha: number }
  | { op: 'image'; image: BakedImage; x: number; y: number; alpha: number }
  | { op: 'text'; text: string; x: number; y: number; fill: string; font: string; align: CanvasTextAlign; alpha: number }
  | { op: 'path'; points: { x: number; y: number }[]; fill?: string; stroke?: string; lineWidth: number; closed: boolean; alpha: number }
  | { op: 'circle'; x: number; y: number; r: number; fill?: string; stroke?: string; lineWidth: number; alpha: number }
  /**
   * A gradient wash. Backends may approximate it with a few bands; it is only
   * ever used for large soft overlays, never for anything the eye measures.
   */
  | { op: 'gradient'; kind: 'linear' | 'radial'; x: number; y: number; w: number; h: number; stops: { at: number; color: string }[]; alpha: number };

/** One frame: what to clear to, and what to draw on top. */
export interface Frame {
  clear: string;
  commands: DrawCommand[];
}

/**
 * Somewhere to put a frame. Implemented once per graphics library.
 *
 * `submit` is called with a complete frame and must leave the canvas showing
 * exactly it. Backends are free to batch, cache textures by `BakedImage.id`,
 * or draw immediately.
 */
export interface RenderBackend {
  /** Human name for the settings readout and the console. */
  readonly name: string;
  /** Prepare to draw into this canvas at the game's logical size. */
  init(canvas: HTMLCanvasElement, width: number, height: number): Promise<void>;
  submit(frame: Frame): void;
  /** Release GPU resources. Called when switching backends. */
  destroy(): void;
}

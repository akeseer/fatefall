/**
 * Placeholder for the Phaser backend, so the module graph resolves while the
 * real implementation is being written. It refuses to start rather than
 * pretending to draw, and the caller falls back to the canvas renderer.
 */

import type { Frame, RenderBackend } from '../DrawCommand';

export class PhaserBackend implements RenderBackend {
  readonly name = 'Phaser (not built yet)';

  async init(): Promise<void> {
    throw new Error('PhaserBackend is not implemented yet.');
  }

  submit(_frame: Frame): void {}

  destroy(): void {}
}

/**
 * Choosing a renderer.
 *
 * Canvas 2D is bundled with the game because it is the only one that costs no
 * runtime dependency. Pixi and Phaser are behind dynamic imports, so a player
 * on the default never downloads either: they are fetched on the frame someone
 * actually asks for them.
 */

import type { RenderBackend } from '../DrawCommand';
import { CanvasBackend } from './CanvasBackend';

export type RenderBackendId = 'canvas' | 'pixi' | 'phaser';

export async function createBackend(id: RenderBackendId): Promise<RenderBackend> {
  switch (id) {
    case 'pixi': {
      const { PixiBackend } = await import('./PixiBackend');
      return new PixiBackend();
    }
    case 'phaser': {
      const { PhaserBackend } = await import('./PhaserBackend');
      return new PhaserBackend();
    }
    default:
      return new CanvasBackend();
  }
}

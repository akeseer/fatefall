import { Vector2, TILE_SIZE, GAME_WIDTH, GAME_HEIGHT } from './types';

export class Camera {
  public x: number = 0;
  public y: number = 0;
  public targetX: number = 0;
  public targetY: number = 0;
  /** Map bounds in pixels (width/height) — the camera never shows beyond them. */
  private boundW: number = 0;
  private boundH: number = 0;
  private smoothing: number = 0.1;

  /** Constrain the view to the map so it never pans into the black void. */
  setBounds(mapWidth: number, mapHeight: number) {
    this.boundW = mapWidth * TILE_SIZE;
    this.boundH = mapHeight * TILE_SIZE;
    this.clampTarget();
    this.clampPosition();
  }

  follow(target: Vector2) {
    this.targetX = target.x * TILE_SIZE - GAME_WIDTH / 2 + TILE_SIZE / 2;
    this.targetY = target.y * TILE_SIZE - GAME_HEIGHT / 2 + TILE_SIZE / 2;
    this.clampTarget();
  }

  update() {
    this.x += (this.targetX - this.x) * this.smoothing;
    this.y += (this.targetY - this.y) * this.smoothing;
    this.clampPosition();
  }

  private clampTarget() {
    if (this.boundW <= 0 || this.boundH <= 0) return;
    this.targetX = Math.max(0, Math.min(this.targetX, this.boundW - GAME_WIDTH));
    this.targetY = Math.max(0, Math.min(this.targetY, this.boundH - GAME_HEIGHT));
  }

  private clampPosition() {
    if (this.boundW <= 0 || this.boundH <= 0) return;
    this.x = Math.max(0, Math.min(this.x, this.boundW - GAME_WIDTH));
    this.y = Math.max(0, Math.min(this.y, this.boundH - GAME_HEIGHT));
  }

  /** Convert world pixel coords to screen coords */
  worldToScreen(wx: number, wy: number): Vector2 {
    return { x: wx - this.x, y: wy - this.y };
  }
}
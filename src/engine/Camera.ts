import { Vector2, TILE_SIZE, GAME_WIDTH, GAME_HEIGHT } from './types';

/** Time for the view to close most of the gap to its target. */
const FOLLOW_TAU_MS = 130;

/** How fast a shake oscillates. Fast enough to read as an impact, not a wobble. */
const SHAKE_HZ = 34;

/**
 * The two axes run at different rates so the motion never traces a line. A
 * shake that moves along one diagonal reads as the whole picture sliding;
 * one that never repeats reads as a hit.
 */
const SHAKE_HZ_Y = 27;

/** Where the view is, and how it gets there. */
export class Camera {
  /** Eased position, before any shake. */
  private baseX: number = 0;
  private baseY: number = 0;
  private shakeX: number = 0;
  private shakeY: number = 0;

  /**
   * The view as anything drawing should use it: the eased position plus
   * whatever the shake is doing this frame.
   *
   * Assigning to it snaps — the whole camera moves there at once and any
   * shake is dropped. That is what every teleport, floor change and new run
   * wants, and it means those call sites read as plainly as they always did.
   */
  get x(): number { return this.baseX + this.shakeX; }
  set x(v: number) { this.baseX = v; this.shakeX = 0; }
  get y(): number { return this.baseY + this.shakeY; }
  set y(v: number) { this.baseY = v; this.shakeY = 0; }

  public targetX: number = 0;
  public targetY: number = 0;
  /** Map bounds in pixels (width/height) — the camera never shows beyond them. */
  private boundW: number = 0;
  private boundH: number = 0;

  private shakeMs = 0;
  private shakeLifeMs = 0;
  private shakeAmplitude = 0;
  /** Advances only while a shake is running, so each one starts from rest. */
  private shakeClockMs = 0;

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

  /**
   * Kick the view.
   *
   * `amplitude` is in pixels at the peak. A stronger shake already running is
   * left alone rather than being restarted softer, so a flurry of small hits
   * cannot cut off the crit that landed in the middle of it.
   */
  shake(amplitude: number, durationMs: number): void {
    if (this.shakeMs > 0 && this.shakeAmplitude > amplitude) return;
    this.shakeAmplitude = amplitude;
    this.shakeLifeMs = durationMs;
    this.shakeMs = durationMs;
  }

  /**
   * Move the view for a frame of `dtMs`.
   *
   * The easing is exponential in elapsed time rather than a fixed fraction per
   * call, so the camera travels at the same speed whatever the frame rate and
   * a stutter changes nothing the player can see.
   */
  update(dtMs: number = 33) {
    const dt = Math.max(0, Math.min(100, dtMs));
    const k = 1 - Math.exp(-dt / FOLLOW_TAU_MS);
    this.baseX += (this.targetX - this.baseX) * k;
    this.baseY += (this.targetY - this.baseY) * k;
    this.clampPosition();

    if (this.shakeMs > 0) {
      this.shakeMs = Math.max(0, this.shakeMs - dt);
      this.shakeClockMs += dt;
      // Squared falloff, so the kick is at the front and the tail settles out
      // rather than stopping dead on a frame boundary.
      const life = this.shakeLifeMs > 0 ? this.shakeMs / this.shakeLifeMs : 0;
      const amp = this.shakeAmplitude * life * life;
      const t = this.shakeClockMs / 1000;
      this.shakeX = Math.round(Math.sin(t * SHAKE_HZ) * amp);
      this.shakeY = Math.round(Math.cos(t * SHAKE_HZ_Y) * amp * 0.7);
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
      this.shakeClockMs = 0;
    }
  }

  private clampTarget() {
    if (this.boundW <= 0 || this.boundH <= 0) return;
    this.targetX = Math.max(0, Math.min(this.targetX, this.boundW - GAME_WIDTH));
    this.targetY = Math.max(0, Math.min(this.targetY, this.boundH - GAME_HEIGHT));
  }

  private clampPosition() {
    if (this.boundW <= 0 || this.boundH <= 0) return;
    this.baseX = Math.max(0, Math.min(this.baseX, this.boundW - GAME_WIDTH));
    this.baseY = Math.max(0, Math.min(this.baseY, this.boundH - GAME_HEIGHT));
  }

  /** Convert world pixel coords to screen coords */
  worldToScreen(wx: number, wy: number): Vector2 {
    return { x: wx - this.x, y: wy - this.y };
  }
}

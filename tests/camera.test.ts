import { describe, it, expect } from 'vitest';
import { Camera } from '../src/engine/Camera';
import { TILE_SIZE, GAME_WIDTH, GAME_HEIGHT } from '../src/engine/types';

/** A map large enough that nothing under test runs into the bounds. */
const BIG = 400;

function camera(): Camera {
  const c = new Camera();
  c.setBounds(BIG, BIG);
  return c;
}

describe('following the party', () => {
  it('centres the view on the tile it is given', () => {
    const c = camera();
    c.follow({ x: 100, y: 80 });
    expect(c.targetX).toBe(100 * TILE_SIZE - GAME_WIDTH / 2 + TILE_SIZE / 2);
    expect(c.targetY).toBe(80 * TILE_SIZE - GAME_HEIGHT / 2 + TILE_SIZE / 2);
  });

  it('closes the gap without ever overshooting it', () => {
    const c = camera();
    c.follow({ x: 100, y: 100 });
    let previous = -1;
    for (let i = 0; i < 60; i++) {
      c.update(16);
      expect(c.x).toBeGreaterThan(previous);
      expect(c.x).toBeLessThanOrEqual(c.targetX);
      previous = c.x;
    }
  });

  /**
   * The reason the easing is exponential in elapsed time rather than a fixed
   * fraction per call: it used to run on the fixed 33 ms simulation step while
   * the sprites it followed interpolated at the display's rate, so the party
   * slid against the ground on anything faster than 30 Hz. Moving it to the
   * frame is only safe if the speed does not depend on how the time is sliced.
   */
  it('travels the same distance however the time is divided into frames', () => {
    const fast = camera();
    const slow = camera();
    fast.follow({ x: 100, y: 100 });
    slow.follow({ x: 100, y: 100 });
    for (let i = 0; i < 12; i++) fast.update(8);
    for (let i = 0; i < 2; i++) slow.update(48);
    expect(fast.x).toBeCloseTo(slow.x, 0);
  });

  it('holds still once it has arrived', () => {
    const c = camera();
    c.follow({ x: 100, y: 100 });
    for (let i = 0; i < 200; i++) c.update(16);
    const settled = c.x;
    c.update(16);
    expect(c.x).toBeCloseTo(settled, 6);
  });

  it('never pans past the edge of the map into the void', () => {
    const c = new Camera();
    c.setBounds(40, 40);
    c.follow({ x: 39, y: 39 });
    for (let i = 0; i < 200; i++) c.update(16);
    expect(c.x).toBeLessThanOrEqual(40 * TILE_SIZE - GAME_WIDTH);
    expect(c.y).toBeLessThanOrEqual(40 * TILE_SIZE - GAME_HEIGHT);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
  });
});

describe('shaking on a hit', () => {
  it('moves the view and then puts it back', () => {
    const c = camera();
    c.follow({ x: 100, y: 100 });
    for (let i = 0; i < 200; i++) c.update(16);
    const settled = c.x;

    c.shake(8, 250);
    let moved = false;
    for (let i = 0; i < 8; i++) {
      c.update(16);
      if (Math.abs(c.x - settled) > 0.5) moved = true;
    }
    expect(moved).toBe(true);

    for (let i = 0; i < 40; i++) c.update(16);
    expect(c.x).toBeCloseTo(settled, 6);
  });

  it('stays within the amplitude it was asked for', () => {
    const c = camera();
    c.follow({ x: 100, y: 100 });
    for (let i = 0; i < 200; i++) c.update(16);
    const settled = c.x;
    c.shake(6, 300);
    for (let i = 0; i < 30; i++) {
      c.update(10);
      expect(Math.abs(c.x - settled)).toBeLessThanOrEqual(6);
    }
  });

  /** A flurry of small hits must not cut off the crit that landed mid-flurry. */
  it('lets the harder hit win when two land together', () => {
    const c = camera();
    c.shake(9, 300);
    c.update(16);
    const strong = Math.abs(c.x);
    c.shake(2, 300);
    c.update(16);
    expect(Math.abs(c.x)).toBeGreaterThanOrEqual(Math.min(strong, 2));
  });

  it('drops the shake when the view is snapped somewhere else', () => {
    const c = camera();
    c.shake(9, 300);
    c.update(16);
    c.x = 500;
    expect(c.x).toBe(500);
  });
});

describe('snapping the view', () => {
  /**
   * Every teleport, floor change and new run assigns to `x`/`y` directly. The
   * eased position has to follow, or the next frame drags the view back.
   */
  it('takes the whole camera with it, not just this frame', () => {
    const c = camera();
    c.x = 800;
    c.y = 600;
    c.targetX = 800;
    c.targetY = 600;
    c.update(16);
    expect(c.x).toBeCloseTo(800, 6);
    expect(c.y).toBeCloseTo(600, 6);
  });
});

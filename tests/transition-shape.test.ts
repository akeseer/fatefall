import { describe, it, expect } from 'vitest';
import { transitionShape } from '../src/rendering/DrawCommand';

/**
 * The one function every backend reads to draw a transition. It is shared so
 * the Pixi and Canvas backends cannot drift apart; these pin the shape they
 * are both promised, not the exact curve.
 */
describe('a fade', () => {
  it('starts fully black and ends clear', () => {
    expect(transitionShape('fade', 0).black).toBe(1);
    expect(transitionShape('fade', 1).black).toBe(0);
  });

  it('never asks for blinds', () => {
    for (let p = 0; p <= 1; p += 0.1) expect(transitionShape('fade', p).closed).toBe(0);
  });

  it('lifts quickly at first and settles, so it reads as arriving', () => {
    const early = transitionShape('fade', 0).black - transitionShape('fade', 0.25).black;
    const late = transitionShape('fade', 0.75).black - transitionShape('fade', 1).black;
    expect(early).toBeLessThan(late);
  });
});

describe('the blinds', () => {
  it('close over the first part, with nothing black on top yet', () => {
    expect(transitionShape('blinds', 0).closed).toBe(0);
    expect(transitionShape('blinds', 0.2).closed).toBeGreaterThan(0);
    expect(transitionShape('blinds', 0.2).closed).toBeLessThan(1);
    expect(transitionShape('blinds', 0.2).black).toBe(0);
  });

  it('hold fully black for a beat once shut', () => {
    const held = transitionShape('blinds', 0.5);
    expect(held.closed).toBe(1);
    expect(held.black).toBe(1);
  });

  it('fade up at the end with the blinds still shut behind', () => {
    const late = transitionShape('blinds', 0.9);
    expect(late.closed).toBe(1);
    expect(late.black).toBeGreaterThan(0);
    expect(late.black).toBeLessThan(1);
    expect(transitionShape('blinds', 1).black).toBe(0);
  });

  it('never opens again once shut', () => {
    let prev = 0;
    for (let p = 0; p <= 1; p += 0.05) {
      const { closed } = transitionShape('blinds', p);
      expect(closed).toBeGreaterThanOrEqual(prev);
      prev = closed;
    }
  });
});

describe('both kinds', () => {
  it('stay inside 0..1 and clamp progress rather than trusting it', () => {
    for (const kind of ['fade', 'blinds'] as const) {
      for (const p of [-1, 0, 0.3, 0.999, 1, 2]) {
        const { closed, black } = transitionShape(kind, p);
        expect(closed).toBeGreaterThanOrEqual(0);
        expect(closed).toBeLessThanOrEqual(1);
        expect(black).toBeGreaterThanOrEqual(0);
        expect(black).toBeLessThanOrEqual(1);
      }
      expect(transitionShape(kind, 2)).toEqual(transitionShape(kind, 1));
      expect(transitionShape(kind, -1)).toEqual(transitionShape(kind, 0));
    }
  });
});

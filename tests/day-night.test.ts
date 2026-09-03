import { describe, it, expect } from 'vitest';
import { lightFromPhase, timeOfDayFromPhase } from '../src/world/DayNightSystem';

/**
 * Phase runs 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight. The curve
 * used to be built on `-cos`, which peaks at phase 0 rather than 0.25, so the
 * day ran a quarter-turn out of step with its own labels: the renderer drew
 * mornings at a tenth of full light and dusk at full, and midnight came out
 * brighter than noon. These pin the orientation rather than the exact values.
 */
describe('the light of day', () => {
  it('is brightest at noon and darkest at midnight', () => {
    expect(lightFromPhase(0.25)).toBeGreaterThan(lightFromPhase(0.5));
    expect(lightFromPhase(0.25)).toBeGreaterThan(lightFromPhase(0));
    expect(lightFromPhase(0.75)).toBeLessThan(lightFromPhase(0.5));
    expect(lightFromPhase(0.75)).toBeLessThan(lightFromPhase(0));
  });

  it('puts noon at full light and midnight at the floor', () => {
    expect(lightFromPhase(0.25)).toBeCloseTo(1, 2);
    expect(lightFromPhase(0.75)).toBeCloseTo(0.08, 2);
  });

  it('rises through the morning and falls through the evening', () => {
    expect(lightFromPhase(0.05)).toBeLessThan(lightFromPhase(0.15));
    expect(lightFromPhase(0.15)).toBeLessThan(lightFromPhase(0.25));
    // Past about 0.63 the curve is sitting on its 0.08 floor, so the evening
    // has to be sampled before it flattens out into the small hours.
    expect(lightFromPhase(0.5)).toBeGreaterThan(lightFromPhase(0.58));
    expect(lightFromPhase(0.58)).toBeGreaterThan(lightFromPhase(0.63));
  });

  /** The labels and the light have to agree, which is what went wrong before. */
  it('is bright whenever it calls itself day and dim whenever it calls itself night', () => {
    for (let p = 0; p < 1; p += 0.01) {
      const label = timeOfDayFromPhase(p);
      const light = lightFromPhase(p);
      if (label === 'day') expect(light).toBeGreaterThan(0.6);
      if (label === 'night') expect(light).toBeLessThan(0.55);
    }
  });

  it('reads the same for a phase that has wrapped past one', () => {
    expect(lightFromPhase(1.25)).toBeCloseTo(lightFromPhase(0.25), 6);
    expect(lightFromPhase(-0.25)).toBeCloseTo(lightFromPhase(0.75), 6);
  });
});

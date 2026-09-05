import { describe, it, expect } from 'vitest';
import { generateQuestGivers } from '../src/quests/QuestGivers';

/**
 * Each town draws two or three givers from the pool, seeded by its id. The
 * old shuffle masked a multiplier's state to 31 bits instead of reducing it,
 * so its low bits cycled, and an id that hashed to zero never shuffled at
 * all. These pin that the draw is stable per town and spread across towns.
 */
describe('generateQuestGivers', () => {
  it('gives a town the same givers every time', () => {
    const a = generateQuestGivers('town_7').map(g => g.name);
    const b = generateQuestGivers('town_7').map(g => g.name);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a.length).toBeLessThanOrEqual(3);
  });

  it('numbers the ids by town and seat', () => {
    const givers = generateQuestGivers('town_3');
    expect(givers.map(g => g.id)).toEqual(givers.map((_, i) => `qg_town_3_${i}`));
    for (const g of givers) expect(g.reputation).toBe(0);
  });

  it('spreads the pool across many towns rather than favouring the front of the list', () => {
    const seen = new Map<string, number>();
    let threes = 0;
    const towns = 400;
    for (let i = 0; i < towns; i++) {
      const givers = generateQuestGivers(`town_${i}`);
      if (givers.length === 3) threes++;
      for (const g of givers) seen.set(g.name, (seen.get(g.name) ?? 0) + 1);
    }
    // Both party sizes occur, and no single giver takes more than a third of
    // the seats: with a pool of several, an even draw sits well below that.
    expect(threes).toBeGreaterThan(towns * 0.3);
    expect(threes).toBeLessThan(towns * 0.7);
    const seats = [...seen.values()].reduce((a, b) => a + b, 0);
    for (const [, n] of seen) expect(n / seats).toBeLessThan(1 / 3);
    expect(seen.size).toBeGreaterThan(3);
  });
});

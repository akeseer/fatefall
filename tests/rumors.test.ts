import { describe, it, expect } from 'vitest';
import { initTownLife, refreshRumor, RUMOR_LIFETIME_MS } from '../src/world/TownLife';
import type { Overworld, OverworldTown } from '../src/world/Overworld';
import { TileMap } from '../src/world/TileMap';

const towns: OverworldTown[] = [
  { id: 'town_1', name: 'Emberwatch', tile: { x: 10, y: 10 }, radius: 3, population: 400, description: '', archetypeId: 'market', buildingIds: [] },
  { id: 'town_2', name: 'Duskhollow', tile: { x: 40, y: 12 }, radius: 3, population: 250, description: '', archetypeId: 'market', buildingIds: [] },
];
const world = (): Overworld => ({ map: new TileMap(), towns, entrances: [], spawnTownId: 'town_1', pois: [], regions: [] });

/**
 * A town's rumor was picked once and repeated for the whole run, because the
 * time it was set was recorded and never read. Now it moves on once stale.
 */
describe('refreshRumor', () => {
  it('keeps a fresh rumor', () => {
    const ow = world();
    const tl = initTownLife(ow, 1000);
    const before = tl.byTown.town_1.rumor;
    expect(refreshRumor(tl.byTown.town_1, ow, towns[0], 1000 + RUMOR_LIFETIME_MS / 2)).toBeNull();
    expect(tl.byTown.town_1.rumor).toBe(before);
  });

  it('replaces a stale one and restarts its clock', () => {
    const ow = world();
    const tl = initTownLife(ow, 1000);
    const entry = tl.byTown.town_1;
    const later = 1000 + RUMOR_LIFETIME_MS + 1;
    const fresh = refreshRumor(entry, ow, towns[0], later);
    expect(fresh).toBe(entry.rumor);
    expect(entry.rumorSince).toBe(later);
    expect(typeof entry.rumorBias).toBe('string');
    // Stale again only after another lifetime.
    expect(refreshRumor(entry, ow, towns[0], later + 1)).toBeNull();
  });

  it('almost always finds something new to say', () => {
    const ow = world();
    const tl = initTownLife(ow, 0);
    const entry = tl.byTown.town_1;
    let same = 0;
    let t = 0;
    for (let i = 0; i < 100; i++) {
      const old = entry.rumor;
      t += RUMOR_LIFETIME_MS + 1;
      refreshRumor(entry, ow, towns[0], t);
      if (entry.rumor === old) same++;
    }
    expect(same).toBeLessThan(5);
  });
});

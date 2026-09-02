import { describe, it, expect } from 'vitest';
import { initTownLife, refreshBulletinBoard } from '../src/world/TownLife';
import type { Overworld, OverworldTown, OverworldEntrance } from '../src/world/Overworld';
import { TileMap } from '../src/world/TileMap';

const towns: OverworldTown[] = [
  { id: 'town_1', name: 'Emberwatch', tile: { x: 10, y: 10 }, radius: 3, population: 400, description: '', archetypeId: 'market', buildingIds: [] },
  { id: 'town_2', name: 'Duskhollow', tile: { x: 40, y: 12 }, radius: 3, population: 250, description: '', archetypeId: 'market', buildingIds: [] },
];
const entrances: OverworldEntrance[] = [
  { id: 'gate_1', name: 'The Sunken Crypts', tile: { x: 20, y: 5 }, depth: 4, description: '' },
];

const world = (): Overworld => ({ map: new TileMap(), towns, entrances, spawnTownId: 'town_1', pois: [] });

describe('refreshBulletinBoard', () => {
  it('replaces untouched notices on each visit', () => {
    const ow = world();
    const tl = initTownLife(ow);
    const first = refreshBulletinBoard(tl, 'town_1', ow, 2).map(t => t.id);
    const second = refreshBulletinBoard(tl, 'town_1', ow, 2).map(t => t.id);
    expect(second).not.toEqual(first);
  });

  it('keeps work the party has taken on', () => {
    const ow = world();
    const tl = initTownLife(ow);
    const posted = refreshBulletinBoard(tl, 'town_1', ow, 2);
    const taken = posted[0];
    taken.accepted = true;
    taken.progress = 1;

    const after = refreshBulletinBoard(tl, 'town_1', ow, 2);
    const kept = after.find(t => t.id === taken.id);
    expect(kept, 'an accepted task must survive the next posting').toBeDefined();
    expect(kept!.progress).toBe(1);
    expect(kept!.accepted).toBe(true);
  });

  it('keeps finished work until it is claimed', () => {
    const ow = world();
    const tl = initTownLife(ow);
    const posted = refreshBulletinBoard(tl, 'town_1', ow, 2);
    posted[0].accepted = true;
    posted[0].completed = true;

    const after = refreshBulletinBoard(tl, 'town_1', ow, 2);
    expect(after.some(t => t.id === posted[0].id && t.completed)).toBe(true);
  });

  it('never lists the same task twice', () => {
    const ow = world();
    const tl = initTownLife(ow);
    refreshBulletinBoard(tl, 'town_1', ow, 2)[0].accepted = true;
    for (let visit = 0; visit < 6; visit++) {
      const board = refreshBulletinBoard(tl, 'town_1', ow, 2);
      expect(new Set(board.map(t => t.id)).size).toBe(board.length);
    }
  });

  it('leaves the boards of other towns alone', () => {
    const ow = world();
    const tl = initTownLife(ow);
    refreshBulletinBoard(tl, 'town_1', ow, 2);
    expect(tl.byTown['town_2'].bulletinTasks).toEqual([]);
  });
});

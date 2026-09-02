import { describe, it, expect } from 'vitest';
import { generateBulletinTasks, bulletinProgress, bulletinIcon } from '../src/quests/BulletinBoard';
import type { OverworldTown, OverworldEntrance } from '../src/world/Overworld';

const town: OverworldTown = {
  id: 'town_1', name: 'Emberwatch', tile: { x: 10, y: 10 }, radius: 3, population: 400,
  description: 'A test town.', archetypeId: 'market', buildingIds: [],
};
const entrances: OverworldEntrance[] = [
  { id: 'gate_1', name: 'The Sunken Crypts', tile: { x: 20, y: 5 }, depth: 4, description: '' },
  { id: 'gate_2', name: 'Ashen Spire', tile: { x: 3, y: 30 }, depth: 6, description: '' },
];

describe('generateBulletinTasks', () => {
  it('is deterministic for the same town and visit', () => {
    const a = generateBulletinTasks(town, 1, 2, entrances);
    const b = generateBulletinTasks(town, 1, 2, entrances);
    expect(a).toEqual(b);
  });

  it('changes between visits', () => {
    const a = generateBulletinTasks(town, 1, 2, entrances);
    const b = generateBulletinTasks(town, 2, 2, entrances);
    expect(a).not.toEqual(b);
  });

  it('produces 3-4 well-formed, unstarted tasks with unique ids', () => {
    for (let visit = 0; visit < 20; visit++) {
      const tasks = generateBulletinTasks(town, visit, 3, entrances);
      expect(tasks.length).toBeGreaterThanOrEqual(3);
      expect(tasks.length).toBeLessThanOrEqual(4);
      expect(new Set(tasks.map(t => t.id)).size).toBe(tasks.length);
      for (const t of tasks) {
        expect(t.progress).toBe(0);
        expect(t.completed).toBe(false);
        expect(t.targetCount).toBeGreaterThan(0);
        expect(t.rewardGold).toBeGreaterThan(0);
        expect(t.rewardXp).toBeGreaterThan(0);
        expect(t.title.length).toBeGreaterThan(0);
        if (t.kind === 'slay') expect(t.targetKind).toMatch(/^[a-z_]+$/);
        if (t.entranceId) expect(entrances.some(e => e.id === t.entranceId)).toBe(true);
      }
    }
  });

  it('scales rewards with party level', () => {
    const low = generateBulletinTasks(town, 1, 1, entrances);
    const high = generateBulletinTasks(town, 1, 10, entrances);
    expect(high[0].rewardGold).toBeGreaterThan(low[0].rewardGold);
  });

  it('works with no entrances', () => {
    const tasks = generateBulletinTasks(town, 1, 1, []);
    expect(tasks.every(t => t.entranceId === undefined)).toBe(true);
  });
});

describe('bulletin helpers', () => {
  it('renders progress and icons per kind', () => {
    const base = { id: 'x', title: '', detail: '', targetCount: 3, progress: 1, rewardGold: 1, rewardXp: 1, repReward: 1, completed: false };
    expect(bulletinProgress({ ...base, kind: 'slay' })).toBe('1/3 slain');
    expect(bulletinProgress({ ...base, kind: 'scout' })).toBe('1/3 rooms explored');
    expect(bulletinProgress({ ...base, kind: 'deliver', progress: 0 })).toBe('Not started');
    expect(bulletinProgress({ ...base, kind: 'escort', completed: true })).toContain('Complete');
    for (const k of ['slay', 'collect', 'escort', 'deliver', 'scout'] as const) {
      expect(bulletinIcon(k).length).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  generateBulletinTasks, bulletinProgress, bulletinIcon, bulletinObjective, bulletinObjectiveMet, pluralise,
} from '../src/quests/BulletinBoard';
import type { OverworldTown, OverworldEntrance } from '../src/world/Overworld';
import { getMonsterTemplate } from '../src/entities/Monster';

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
        // Nothing counts until the party takes the work on.
        expect(t.accepted).toBe(false);
        expect(t.targetCount).toBeGreaterThan(0);
        expect(t.rewardGold).toBeGreaterThan(0);
        expect(t.rewardXp).toBeGreaterThan(0);
        expect(t.title.length).toBeGreaterThan(0);
        // Slay targets must be real template ids: progress is read from the
        // kill ledger, which is keyed by template id and not by display name.
        if (t.kind === 'slay') {
          expect(t.targetKind).toMatch(/^[a-z_]+$/);
          expect(getMonsterTemplate(t.targetKind!), `no template for ${t.targetKind}`).toBeTruthy();
        }
        if (t.entranceId) expect(entrances.some(e => e.id === t.entranceId)).toBe(true);
      }
    }
  });

  it('never posts the same notice twice on one board', () => {
    for (let visit = 0; visit < 30; visit++) {
      const titles = generateBulletinTasks(town, visit, 3, entrances).map(t => t.title);
      expect(new Set(titles).size, `visit ${visit} repeated a notice`).toBe(titles.length);
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

describe('pluralise', () => {
  it('leaves collective names alone', () => {
    for (const n of ['Lizardfolk', 'Merfolk', 'Deer', 'Sheep', 'Undead']) expect(pluralise(n)).toBe(n);
  });

  it('handles the awkward endings', () => {
    expect(pluralise('Goblin')).toBe('Goblins');
    expect(pluralise('Wraith')).toBe('Wraiths');
    expect(pluralise('Lich')).toBe('Liches');
    expect(pluralise('Harpy')).toBe('Harpies');
    expect(pluralise('Wolf')).toBe('Wolves');
    expect(pluralise('Sphinx')).toBe('Sphinxes');
  });
});

describe('bulletin helpers', () => {
  const base = {
    id: 'x', title: '', detail: '', targetCount: 3, progress: 1,
    rewardGold: 1, rewardXp: 1, repReward: 1, accepted: true, completed: false,
  };

  it('renders progress and icons per kind', () => {
    expect(bulletinProgress({ ...base, kind: 'slay' })).toBe('1/3 slain');
    expect(bulletinProgress({ ...base, kind: 'collect' })).toBe('1/3 collected');
    expect(bulletinProgress({ ...base, kind: 'scout' })).toBe('1/3 rooms explored');
    expect(bulletinProgress({ ...base, kind: 'deliver' })).toContain('town');
    expect(bulletinProgress({ ...base, kind: 'escort', completed: true })).toContain('Complete');
    for (const k of ['slay', 'collect', 'escort', 'deliver', 'scout'] as const) {
      expect(bulletinIcon(k).length).toBeGreaterThan(0);
    }
  });

  it('shows untaken work as not taken, whatever its progress says', () => {
    expect(bulletinProgress({ ...base, kind: 'slay', accepted: false })).toBe('Not taken');
    expect(bulletinProgress({ ...base, kind: 'scout', accepted: false, progress: 2 })).toBe('Not taken');
  });

  it('only calls an objective met once it is accepted and counted out', () => {
    expect(bulletinObjectiveMet({ ...base, kind: 'slay' })).toBe(false);
    expect(bulletinObjectiveMet({ ...base, kind: 'slay', progress: 3 })).toBe(true);
    expect(bulletinObjectiveMet({ ...base, kind: 'slay', progress: 3, accepted: false })).toBe(false);
    expect(bulletinObjectiveMet({ ...base, kind: 'slay', progress: 9 })).toBe(true);
  });

  it('describes what each kind actually asks for', () => {
    expect(bulletinObjective({ ...base, kind: 'slay' })).toContain('3');
    expect(bulletinObjective({ ...base, kind: 'escort' })).toContain('different town');
    expect(bulletinObjective({ ...base, kind: 'deliver' })).toContain('different town');
    expect(bulletinObjective({ ...base, kind: 'scout' })).toContain('room');
    expect(bulletinObjective({ ...base, kind: 'scout', targetCount: 1 })).toContain('1 room');
  });
});

import { describe, it, expect } from 'vitest';
import { dealPersonalQuests, debtPayable, generatePersonalQuest, heirloomsPossibleOn, hookLine, pilgrimageArrives, rivalsDueOn } from '../src/events/PersonalQuests';

const seed = (over: Partial<{ id: string; name: string; background?: string; classId: string; deity?: string }> = {}) => ({
  id: 'm1', name: 'Ana', background: 'Criminal', classId: 'rogue', ...over,
});

describe('personal quests', () => {
  it('the background picks the road', () => {
    expect(generatePersonalQuest(seed({ background: 'Criminal' })).kind).toBe('debt');
    expect(generatePersonalQuest(seed({ background: 'Noble' })).kind).toBe('rival');
    expect(generatePersonalQuest(seed({ background: 'Folk Hero' })).kind).toBe('heirloom');
    expect(generatePersonalQuest(seed({ background: 'Acolyte', deity: 'Lathander' })).kind).toBe('pilgrimage');
  });

  it('an unknown background still gets a road', () => {
    const q = generatePersonalQuest(seed({ background: 'Time Traveller' }), () => 0.99);
    expect(['debt', 'rival', 'heirloom', 'pilgrimage']).toContain(q.kind);
  });

  it('every road names its member in the hook and carries a perk', () => {
    for (const bg of ['Criminal', 'Noble', 'Folk Hero', 'Acolyte']) {
      const q = generatePersonalQuest(seed({ background: bg }));
      expect(q.hook).toContain('Ana');
      expect(q.ending.length).toBeGreaterThan(20);
      expect(q.perk.title.length).toBeGreaterThan(0);
      expect(q.done).toBe(false);
      expect(hookLine(q)).toContain('Ana');
    }
  });

  it('the rival perk follows the class', () => {
    expect(generatePersonalQuest(seed({ background: 'Noble', classId: 'wizard' })).perk.ability).toBe('int');
    expect(generatePersonalQuest(seed({ background: 'Noble', classId: 'cleric' })).perk.ability).toBe('wis');
    expect(generatePersonalQuest(seed({ background: 'Noble', classId: 'fighter' })).perk.ability).toBe('str');
  });

  it('dealing skips members who already have a road', () => {
    const first = dealPersonalQuests([seed(), seed({ id: 'm2', name: 'Bo', background: 'Noble' })], []);
    expect(first).toHaveLength(2);
    const again = dealPersonalQuests([seed(), seed({ id: 'm2', name: 'Bo' }), seed({ id: 'm3', name: 'Cy', background: 'Sage' })], first);
    expect(again).toHaveLength(3);
    expect(again.slice(0, 2)).toEqual(first);
    expect(again[2].kind).toBe('heirloom');
  });

  it('a pilgrimage counts distinct towns and finishes on the third', () => {
    const q = generatePersonalQuest(seed({ background: 'Acolyte' }));
    expect(pilgrimageArrives(q, 't1')).toBe(false);
    expect(pilgrimageArrives(q, 't1')).toBe(false);
    expect(q.progress).toBe(1);
    expect(pilgrimageArrives(q, 't2')).toBe(false);
    expect(pilgrimageArrives(q, 't3')).toBe(true);
    q.done = true;
    expect(pilgrimageArrives(q, 't4')).toBe(false);
  });

  it('a debt is payable only with the coin in hand, and only once', () => {
    const q = generatePersonalQuest(seed({ background: 'Criminal' }), () => 0);
    expect(q.target).toBe(60);
    expect(debtPayable(q, 59)).toBe(false);
    expect(debtPayable(q, 60)).toBe(true);
    q.done = true;
    expect(debtPayable(q, 600)).toBe(false);
  });

  it('rivals and heirlooms wait for a deep enough floor', () => {
    const rival = generatePersonalQuest(seed({ background: 'Noble' }), () => 0);
    const heirloom = generatePersonalQuest(seed({ id: 'm2', background: 'Sage' }), () => 0.9);
    expect(rival.target).toBe(2);
    expect(heirloom.target).toBe(3);
    const all = [rival, heirloom];
    expect(rivalsDueOn(all, 1)).toEqual([]);
    expect(rivalsDueOn(all, 2)).toEqual([rival]);
    expect(heirloomsPossibleOn(all, 2)).toEqual([]);
    expect(heirloomsPossibleOn(all, 3)).toEqual([heirloom]);
    rival.done = true;
    expect(rivalsDueOn(all, 5)).toEqual([]);
  });
});

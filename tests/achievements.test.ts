import { describe, it, expect } from 'vitest';
import { ACHIEVEMENTS, newlyEarned, achievementById, type AchievementSnapshot } from '../src/game/Achievements';
import { exportRun } from '../src/game/RunExport';

const snap = (over: Partial<AchievementSnapshot> = {}): AchievementSnapshot => ({
  kills: 0, victories: 0, defeats: 0, deepest: 1, rooms: 0, gold: 0, rolls: 0, crits: 0, fumbles: 0, bestCritStreak: 0,
  maxLevel: 1, members: 4, actsDone: 0, storyComplete: false, hardcore: false, day: 1, counters: {}, ...over,
});

describe('achievements', () => {
  it('are forty, unique, and none is earned by a fresh party', () => {
    expect(ACHIEVEMENTS.length).toBe(40);
    expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(40);
    expect(newlyEarned(snap(), new Set())).toEqual([]);
  });

  it('are earned by what was done, and only once', () => {
    const earned = new Set<string>();
    const first = newlyEarned(snap({ kills: 1, crits: 1 }), earned);
    expect(first.map(a => a.id).sort()).toEqual(['first_blood', 'natural_twenty']);
    for (const a of first) earned.add(a.id);
    expect(newlyEarned(snap({ kills: 1, crits: 1 }), earned)).toEqual([]);
    expect(newlyEarned(snap({ counters: { riddles: 5, parleys: 1 } }), earned).map(a => a.id).sort()).toEqual(['parley', 'riddle', 'riddles_five']);
    expect(newlyEarned(snap({ victories: 20, defeats: 1 }), earned).map(a => a.id)).toEqual(['ten_fights']);
    expect(newlyEarned(snap({ victories: 20 }), earned).map(a => a.id)).toContain('unbroken');
    expect(newlyEarned(snap({ hardcore: true, victories: 10 }), earned).map(a => a.id)).toContain('hardcore_ten');
    expect(achievementById('story_done')?.epithet).toBe('the Fated');
  });
});

describe('the run as text', () => {
  it('lays the run out in sections and never leaves one empty', () => {
    const text = exportRun({ partyName: 'The Brigade', members: ['Ana, level 3 Human Rogue'], day: 4, acts: [], roads: ['Ana: A debt'], deeds: ['Slew a goblin'], notes: [], fallen: [], titles: ['First Blood'], numbers: ['1 foe slain'] });
    expect(text).toContain('THE BRIGADE');
    expect(text).toContain('The party\n---------\n- Ana');
    expect(text).toContain('No act has ended yet');
    expect(text).toContain('- First Blood');
    expect(text).toContain('- Slew a goblin');
    expect(text.endsWith('\n')).toBe(true);
  });
});

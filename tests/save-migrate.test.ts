import { describe, it, expect } from 'vitest';
import { migrateSave, SAVE_VERSION, type SaveData } from '../src/save/SaveManager';

/** A minimal v1 save: pooled spell uses, `isAlive` instead of death saves, no traps. */
function v1Save(): any {
  const member = (id: string, classId: string, isAlive: boolean) => ({
    id, name: id, classId, raceId: 'human',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    level: 3, xp: 900, hp: isAlive ? 12 : 0, maxHp: 24, ac: 14, speed: 30,
    tile: { x: 1, y: 1 }, direction: 'down', inventory: [], gold: 5,
    isAlive, conditions: [], concentration: null,
    maxHitDice: 3, hitDiceRemaining: 3, maxSpellUses: 4, spellUsesRemaining: 2,
    spellSlots: {}, knownSpells: [], pendingConcentrationBreak: false,
    personality: { aggression: 0.5, curiosity: 0.5, caution: 0.5, loyalty: 0.5, greed: 0.5 },
  });
  return {
    version: 1, savedAt: 0, dungeonLevel: 2, dungeonName: 'Old Crypt', phase: 0,
    monsterIdCounter: 3, dmStance: 'auto', dmDirection: null, speed: 1,
    camera: { x: 0, y: 0, targetX: 0, targetY: 0 },
    map: { width: 2, height: 2, tiles: [[1, 1], [1, 1]], explored: [[true, false], [false, false]] },
    rooms: [],
    party: { leaderIndex: 0, formation: [], members: [member('Kael', 'fighter', true), member('Mira', 'wizard', false)] },
    monsters: [], combat: null,
  };
}

describe('migrateSave', () => {
  it('rejects garbage and passes current saves through untouched', () => {
    expect(migrateSave(null as any)).toBeNull();
    expect(migrateSave({} as any)).toBeNull();
    const current = { version: SAVE_VERSION } as SaveData;
    expect(migrateSave(current)).toBe(current);
  });

  it('upgrades a v1 save all the way to the current version', () => {
    const out = migrateSave(v1Save())!;
    expect(out).not.toBeNull();
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.traps).toEqual([]);
    expect(typeof out.clockPhase).toBe('number');
    expect(typeof out.clockElapsed).toBe('number');

    const [kael, mira] = out.party.members;
    // v1→v2: death-save fields derived from isAlive.
    expect(kael.isDead).toBe(false);
    expect(mira.isDead).toBe(true);
    expect(kael.baseMaxHp).toBe(24);
    expect(kael.deathSaveSuccesses).toBe(0);
    expect(kael.exhaustion).toBe(0);
    // v2→v3: per-level slots from class tables; non-casters get none.
    expect(kael.maxSpellSlots).toEqual({});
    expect(mira.maxSpellSlots[1]).toBeGreaterThan(0);
    expect(mira.spellSlots).toEqual(mira.maxSpellSlots);
  });

  it('does not mutate its input', () => {
    const input = v1Save();
    const snapshot = JSON.stringify(input);
    migrateSave(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('v8 -> v9 marks old bulletin tasks as not taken', () => {
    const v8: any = { ...v1Save(), version: 8, traps: [] };
    v8.party.members = v8.party.members.map((m: any) => ({ ...m, isDead: false, maxSpellSlots: {}, spellSlots: {} }));
    v8.townLife = {
      byTown: {
        town_1: { bulletinTasks: [{ id: 'a', progress: 2, completed: false }, { id: 'b', progress: 0, completed: true }] },
        town_2: { bulletinTasks: [] },
      },
    };
    const out = migrateSave(v8)!;
    expect(out.version).toBe(SAVE_VERSION);
    const tasks = (out.townLife as any).byTown.town_1.bulletinTasks;
    // Old boards had no notion of accepting, so nothing counts until retaken.
    expect(tasks.every((t: any) => t.accepted === false)).toBe(true);
    expect(tasks[0].progress).toBe(2);
  });

  it('v8 -> v9 survives a save with no town life at all', () => {
    const v8: any = { ...v1Save(), version: 8, traps: [] };
    v8.party.members = v8.party.members.map((m: any) => ({ ...m, isDead: false, maxSpellSlots: {}, spellSlots: {} }));
    expect(migrateSave(v8)!.version).toBe(SAVE_VERSION);
  });

  it('v9 -> v10 leaves older saves without a mood or a known town', () => {
    const v9: any = { ...v1Save(), version: 9, traps: [] };
    v9.party.members = v9.party.members.map((m: any) => ({ ...m, isDead: false, maxSpellSlots: {}, spellSlots: {} }));
    const out = migrateSave(v9)!;
    expect(out.version).toBe(SAVE_VERSION);
    // These are optional, so an old save restores exactly as it used to.
    expect(out.delveMood).toBeUndefined();
    expect(out.currentTownId).toBeUndefined();
    expect(out.bossSlainThisFloor).toBeUndefined();
  });

  it('v10 carries the mood, the town and the slain boss through untouched', () => {
    const mood = { icon: '🌕', label: 'Moon-roused', effects: ['+1 attack'] };
    const current: any = {
      ...v1Save(), version: SAVE_VERSION, traps: [],
      delveMood: mood, currentTownId: 'town_2', bossSlainThisFloor: true,
    };
    const out = migrateSave(current)!;
    expect(out.delveMood).toEqual(mood);
    expect(out.currentTownId).toBe('town_2');
    expect(out.bossSlainThisFloor).toBe(true);
  });

  it('keeps existing clock values on a v6 save', () => {
    const v6 = { ...v1Save(), version: 6, traps: [], clockPhase: 0.9, clockElapsed: 123 };
    v6.party.members = v6.party.members.map((m: any) => ({ ...m, isDead: false, maxSpellSlots: {}, spellSlots: {} }));
    const out = migrateSave(v6)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.clockPhase).toBe(0.9);
    expect(out.clockElapsed).toBe(123);
  });
});

describe('v11 -> v12 run settings', () => {
  it('leaves an older run without a mode or a hardcore flag, which restore reads as auto and forgiving', () => {
    const out = migrateSave({ version: 11, party: { members: [] } } as any)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.runMode).toBeUndefined();
    expect(out.hardcore).toBeUndefined();
  });

  it('carries the mode and the flag through untouched', () => {
    const save = { version: SAVE_VERSION, runMode: 'manual', hardcore: true } as SaveData;
    const out = migrateSave(save)!;
    expect(out.runMode).toBe('manual');
    expect(out.hardcore).toBe(true);
  });
});

describe('v14 -> v15 personal quests', () => {
  it('leaves an older run without roads, which restore deals on load', () => {
    const out = migrateSave({ version: 14, party: { members: [] } } as any)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.personalQuests).toBeUndefined();
  });

  it('carries the roads through untouched', () => {
    const quests = [{ id: 'pq_m1', memberId: 'm1', memberName: 'Ana', kind: 'debt', title: 'A debt', hook: 'h', ending: 'e', target: 80, progress: 0, visited: [], done: false, perk: { ability: 'cha', title: 'the Square' } }];
    const out = migrateSave({ version: SAVE_VERSION, personalQuests: quests } as any)!;
    expect(out.personalQuests).toEqual(quests);
  });
});

describe('v15 -> v16 standing orders', () => {
  it('leaves an older run without policies, which restore reads as the defaults', () => {
    const out = migrateSave({ version: 15, party: { members: [] } } as any)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.dmPolicies).toBeUndefined();
  });

  it('carries the policies through untouched', () => {
    const out = migrateSave({ version: SAVE_VERSION, dmPolicies: { tolls: 'refuse', parley: 'always', loot: 'all' } } as any)!;
    expect(out.dmPolicies).toEqual({ tolls: 'refuse', parley: 'always', loot: 'all' });
  });
});

describe('v16 -> v17 tallies, achievements, notes, the fallen', () => {
  it('leaves an older run empty-handed, which restore reads as nothing yet', () => {
    const out = migrateSave({ version: 16, party: { members: [] } } as any)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.achievements).toBeUndefined();
    expect(out.fallen).toBeUndefined();
  });

  it('carries them through untouched', () => {
    const fallen = [{ name: 'Ana', className: 'Rogue', level: 4, where: 'floor 3 of Kingsgrave', day: 12 }];
    const out = migrateSave({ version: SAVE_VERSION, counters: { riddles: 2 }, achievements: ['riddle'], notes: ['a'], fallen } as any)!;
    expect(out.counters).toEqual({ riddles: 2 });
    expect(out.achievements).toEqual(['riddle']);
    expect(out.notes).toEqual(['a']);
    expect(out.fallen).toEqual(fallen);
  });
});

describe('v17 -> v18 torches', () => {
  it('leaves an older run without a count, which restore reads as a few', () => {
    const out = migrateSave({ version: 17, party: { members: [] } } as any)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.torches).toBeUndefined();
  });
  it('carries the count through', () => {
    expect(migrateSave({ version: SAVE_VERSION, torches: 7 } as any)!.torches).toBe(7);
  });
});

describe('v18 -> v19 difficulty and sieges', () => {
  it('leaves an older run at normal with nobody at the gates', () => {
    const out = migrateSave({ version: 18, party: { members: [] } } as any)!;
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.difficulty).toBeUndefined();
    expect(out.sieges).toBeUndefined();
  });
  it('carries them through', () => {
    const out = migrateSave({ version: SAVE_VERSION, difficulty: 'hard', sieges: { town_1: { strength: 3, since: 5 } } } as any)!;
    expect(out.difficulty).toBe('hard');
    expect(out.sieges).toEqual({ town_1: { strength: 3, since: 5 } });
  });
});

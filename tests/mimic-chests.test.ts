import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RoomFeatureController } from '../src/game/RoomFeatureController';
import type { RoomFeatureHost } from '../src/game/RoomFeatureController';
import { assignFeature } from '../src/world/RoomFeatures';
import type { RoomFeature } from '../src/world/RoomFeatures';
import type { Room } from '../src/world/DungeonGenerator';
import type { MonsterTemplate } from '../src/entities/Monster';
import type { LootResult } from '../src/loot/LootTables';
import { resetDiceEvents, getDiceHistory } from '../src/rules/DiceEvents';
import { grantLuckDie } from '../src/rules/LuckDie';

// ── Test doubles ─────────────────────────────────────

interface FakeChar {
  name: string;
  strMod: number;
  wisMod: number;
  hp: number;
  isConscious: boolean;
  damageTaken: number;
  takeDamage(n: number): void;
}

function mkChar(name: string, wisMod = 1): FakeChar {
  const c: FakeChar = {
    name, strMod: 2, wisMod, hp: 30, isConscious: true, damageTaken: 0,
    takeDamage(n: number) {
      c.damageTaken += n;
      c.hp -= n;
      if (c.hp <= 0) c.isConscious = false;
    },
  };
  return c;
}

/** The narrow slice of the game a room feature touches, recorded for asserts. */
function mkHost(feature: RoomFeature | undefined, dungeonLevel = 3) {
  const leader = mkChar('Ardan');
  const scout = mkChar('Wren', 3);
  const messages: string[] = [];
  const spawned: MonsterTemplate[][] = [];
  const looted: LootResult[] = [];
  const host = {
    party: { leader, members: [leader, scout], alive: [leader, scout] },
    dungeonLevel,
    hud: {
      addCombatMessage: (line: string) => { messages.push(line); },
      setParty: () => {},
    },
    townLife: null,
    currentTown: null,
    currentRoom: () => ({ feature } as unknown as Room),
    addGold: () => {},
    bestScout: () => scout,
    bestDisarmer: () => scout,
    spawnEncounter: (t: MonsterTemplate[]) => { spawned.push(t); },
    distributeLoot: (l: LootResult) => { looted.push(l); },
    recordTreasureFound: () => {},
  };
  return {
    controller: new RoomFeatureController(host as unknown as RoomFeatureHost),
    leader, scout, messages, spawned, looted,
    log: () => messages.join('\n'),
  };
}

function mkChest(over: Partial<RoomFeature> = {}): RoomFeature {
  return {
    id: 'feature_1_5_5',
    kind: 'chest',
    name: 'an iron-bound chest',
    entryLine: 'An iron-bound chest squats in the corner.',
    inspect: 'The bands are rusted but the wood beneath is sound.',
    used: false,
    ...over,
  };
}

/** Deterministic stand-in for Math.random so no assertion rides on luck. */
function stubRandom(value: number | (() => number)) {
  const real = Math.random;
  Math.random = typeof value === 'function' ? value : () => value;
  return () => { Math.random = real; };
}

let restoreRandom: (() => void) | null = null;

beforeEach(() => {
  resetDiceEvents();
  grantLuckDie(null);
});

afterEach(() => {
  restoreRandom?.();
  restoreRandom = null;
});

// ── Placement ────────────────────────────────────────

describe('assignFeature — chest variants', () => {
  it('never wears a lock or a trap on a mimic: the bait always opens', () => {
    // A seeded stream keeps the sweep reproducible run to run.
    let s = 0x1a2b3c4d;
    restoreRandom = stubRandom(() => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    });

    const chests: RoomFeature[] = [];
    for (let i = 0; i < 600; i++) {
      const room = { cx: i, cy: 0 } as unknown as Room;
      const f = assignFeature(room, 4, { force: true });
      if (f?.kind === 'chest') chests.push(f);
    }

    expect(chests.length).toBeGreaterThan(50);
    const mimics = chests.filter(f => f.mimic);
    expect(mimics.length).toBeGreaterThan(0);
    // A mimic is bait, not a container: no lock, no needle.
    expect(mimics.every(f => !f.locked && !f.trapped)).toBe(true);
    // Ordinary chests are untouched by the new roll.
    expect(chests.some(f => !f.mimic && f.locked)).toBe(true);
    expect(chests.some(f => !f.mimic && f.trapped)).toBe(true);
  });

  it('leaves non-chest features without a mimic flag', () => {
    for (let i = 0; i < 200; i++) {
      const room = { cx: i, cy: 1 } as unknown as Room;
      const f = assignFeature(room, 5, { force: true });
      if (f && f.kind !== 'chest') expect(f.mimic).toBeUndefined();
    }
  });
});

// ── The controller's mimic branch ────────────────────

describe('featureChest — mimics', () => {
  it('bites the one who reached for it and starts a fight instead of paying out loot', () => {
    restoreRandom = stubRandom(0); // d20 → 1: nobody spots it
    const f = mkChest({ mimic: true });
    const t = mkHost(f);

    expect(t.controller.perform('feature_chest')).toBe(true);
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0][0].id).toBe('mimic');
    expect(t.looted).toHaveLength(0);
    expect(t.leader.damageTaken).toBeGreaterThan(0);
    expect(t.log()).toMatch(/Mimic/);
    // Spent, so the AI's chest-seeking stops pathing to it.
    expect(f.used).toBe(true);
    // ...but the room remembers what it was.
    expect(f.mimic).toBe(true);
  });

  it('costs the mimic its ambush when the scout spots it, not the fight', () => {
    restoreRandom = stubRandom(0.999); // d20 → 20
    const f = mkChest({ mimic: true });
    const t = mkHost(f);

    t.controller.perform('feature_chest');
    expect(t.leader.damageTaken).toBe(0);
    expect(t.spawned[0][0].id).toBe('mimic');
    expect(t.log()).toMatch(/Wren/);
    expect(t.log()).toMatch(/breathing/);
  });

  it('publishes the spot check to the dice tray', () => {
    restoreRandom = stubRandom(0.999);
    mkHost(mkChest({ mimic: true })).controller.perform('feature_chest');
    const check = getDiceHistory().find(e => e.kind === 'check');
    expect(check?.label).toContain('Wren');
    expect(check?.outcome).toBe('crit');
  });

  it('ignores a lock and a trap it should never have had', () => {
    restoreRandom = stubRandom(0.999);
    const f = mkChest({ mimic: true, locked: true, trapped: true });
    const t = mkHost(f);

    t.controller.perform('feature_chest');
    // No Strength check, no needle: the lid was never real.
    expect(t.log()).not.toMatch(/Strength/);
    expect(t.log()).not.toMatch(/needle/);
    expect(t.scout.damageTaken).toBe(0);
    expect(t.spawned).toHaveLength(1);
  });

  it('does not spring twice — a spent mimic narrates the wreckage', () => {
    restoreRandom = stubRandom(0);
    const f = mkChest({ mimic: true, used: true });
    const t = mkHost(f);

    expect(t.controller.perform('feature_chest')).toBe(true);
    expect(t.spawned).toHaveLength(0);
    expect(t.leader.damageTaken).toBe(0);
    expect(t.log()).toMatch(/glue/);
    expect(t.log()).not.toMatch(/stands open and empty/);
  });

  it('leaves ordinary chests paying out loot', () => {
    restoreRandom = stubRandom(0.999); // forces the lock open if there is one
    const f = mkChest({ locked: true });
    const t = mkHost(f);

    t.controller.perform('feature_chest');
    expect(t.spawned).toHaveLength(0);
    expect(t.looted).toHaveLength(1);
    expect(f.used).toBe(true);
  });
});

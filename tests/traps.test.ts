import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TRAP_KINDS,
  TrapKind,
  PlacedTrap,
  getTrapKind,
  placeTraps,
  bestPassivePerception,
  rollPerception,
  rollDisarm,
  triggerTrap,
  sweepDetection,
} from '../src/traps/Traps';
import { GameCharacter } from '../src/entities/Character';
import { Monster } from '../src/entities/Monster';
import { Room } from '../src/world/DungeonGenerator';
import { TileMap, TileType } from '../src/world/TileMap';
import { CONDITION_META } from '../src/rules/Rules';
import { grantLuckDie } from '../src/rules/LuckDie';
import { resetDiceEvents, getDiceHistory } from '../src/rules/DiceEvents';

// ── Test doubles ─────────────────────────────────────

/** A stand-in party member: the trap code only reads a handful of fields. */
type TrapVictim = GameCharacter & {
  damageTaken: number[];
  conditionsApplied: { id: string; turns: number; name: string; sourceId?: string }[];
  saveOutcome: { success: boolean; natural: number; total: number };
};

function mkMember(over: Record<string, unknown> = {}): TrapVictim {
  const m: Record<string, unknown> = {
    id: `c_${Math.random().toString(36).slice(2, 8)}`,
    name: 'Hero',
    charClass: { id: 'fighter' },
    isAlive: true,
    isDead: false,
    wisMod: 0,
    dexMod: 0,
    profBonus: 2,
    damageTaken: [] as number[],
    conditionsApplied: [] as unknown[],
    saveOutcome: { success: false, natural: 7, total: 9 },
    makeSavingThrow(_ability: string, dc: number) {
      return { ...(m.saveOutcome as object), dc };
    },
    takeDamage(amount: number) {
      (m.damageTaken as number[]).push(amount);
      return `${String(m.name)} takes ${amount} damage.`;
    },
    applyCondition(id: string, turns: number, name: string, sourceId?: string) {
      (m.conditionsApplied as unknown[]).push({ id, turns, name, sourceId });
      return true;
    },
    ...over,
  };
  return m as unknown as TrapVictim;
}

function mkTrap(over: Partial<PlacedTrap> = {}): PlacedTrap {
  return { id: 't1', kindId: 'spiked_pit', tile: { x: 5, y: 5 }, detected: false, disarmed: false, ...over };
}

function mkMonster(x: number, y: number): Monster {
  return { tile: { x, y } } as unknown as Monster;
}

const START_ROOM: Room = { x: 2, y: 2, width: 6, height: 6, cx: 5, cy: 5 };
const FAR_ROOM: Room = { x: 20, y: 2, width: 8, height: 8, cx: 24, cy: 6 };
const CORRIDOR_Y = 5;
const CORRIDOR_XS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

/** A two-room map joined by a corridor — the minimum placeTraps will work on. */
function mkMap(): { map: TileMap; rooms: Room[] } {
  const map = new TileMap(40, 30);
  for (const room of [START_ROOM, FAR_ROOM]) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) map.setTile(x, y, TileType.Floor);
    }
  }
  for (const x of CORRIDOR_XS) map.setTile(x, CORRIDOR_Y, TileType.Floor);
  return { map, rooms: [START_ROOM, FAR_ROOM] };
}

function inRoom(tile: { x: number; y: number }, room: Room): boolean {
  return tile.x >= room.x && tile.x < room.x + room.width &&
         tile.y >= room.y && tile.y < room.y + room.height;
}

/** Pin Math.random so the d20 inside rollPerception / rollDisarm is known. */
function pinD20(natural: number): void {
  vi.spyOn(Math, 'random').mockReturnValue((natural - 1) / 20 + 0.001);
}

beforeEach(() => {
  resetDiceEvents();
  grantLuckDie(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── The table itself ─────────────────────────────────

describe('TRAP_KINDS table', () => {
  it('gives every trap a unique id', () => {
    const ids = TRAP_KINDS.map(k => k.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('gives every trap a name, a trigger line and positive DCs', () => {
    for (const kind of TRAP_KINDS) {
      expect(kind.name.trim().length).toBeGreaterThan(0);
      expect(kind.triggerText.trim().length).toBeGreaterThan(0);
      expect(kind.detectDc).toBeGreaterThan(0);
      expect(kind.disarmDc).toBeGreaterThan(0);
      expect(kind.saveDc).toBeGreaterThan(0);
      expect(kind.effect.damageType.trim().length).toBeGreaterThan(0);
    }
  });

  // triggerTrap parses these strings with a regex; an unparseable expression
  // silently degrades to zero damage instead of failing loudly.
  it('states damage as a parseable dice expression, or the "0" no-damage sentinel', () => {
    for (const kind of TRAP_KINDS) {
      if (kind.effect.dice === '0') {
        expect(kind.effect.damageType).toBe('none');
        // A trap that deals no damage must do something else, or it is inert.
        expect(kind.effect.condition).toBeDefined();
        continue;
      }
      expect(kind.effect.dice).toMatch(/^\d+d\d+([+-]\d+)?$/);
      const [, count, sides] = kind.effect.dice.match(/^(\d+)d(\d+)/)!;
      expect(Number(count)).toBeGreaterThan(0);
      expect(Number(sides)).toBeGreaterThan(1);
    }
  });

  it('only applies conditions the rules engine actually knows about', () => {
    const known = Object.keys(CONDITION_META);
    for (const kind of TRAP_KINDS) {
      if (!kind.effect.condition) continue;
      expect(known).toContain(kind.effect.condition.id);
      expect(kind.effect.condition.turns).toBeGreaterThan(0);
      expect(kind.effect.condition.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('looks a trap kind up by id and reports an unknown id as undefined', () => {
    for (const kind of TRAP_KINDS) expect(getTrapKind(kind.id)).toBe(kind);
    expect(getTrapKind('not_a_trap')).toBeUndefined();
  });
});

// ── Placement ────────────────────────────────────────

describe('placeTraps', () => {
  it('places nothing on a map with fewer than two rooms', () => {
    const { map } = mkMap();
    expect(placeTraps(map, [], [], 5)).toEqual([]);
    expect(placeTraps(map, [START_ROOM], [], 5)).toEqual([]);
  });

  it('never places a trap in the room the party starts in', () => {
    const { map, rooms } = mkMap();
    for (let i = 0; i < 30; i++) {
      for (const trap of placeTraps(map, rooms, [], 8)) {
        expect(inRoom(trap.tile, START_ROOM)).toBe(false);
      }
    }
  });

  it('never places a trap on a floor tile a monster is standing on', () => {
    const { map, rooms } = mkMap();
    const monsters = CORRIDOR_XS.map(x => mkMonster(x, CORRIDOR_Y));
    const occupied = new Set(monsters.map(m => `${m.tile.x},${m.tile.y}`));
    for (let i = 0; i < 30; i++) {
      for (const trap of placeTraps(map, rooms, monsters, 8)) {
        expect(occupied.has(`${trap.tile.x},${trap.tile.y}`)).toBe(false);
      }
    }
  });

  it('never stacks two traps on the same tile and gives each a unique id', () => {
    const { map, rooms } = mkMap();
    for (let i = 0; i < 30; i++) {
      const traps = placeTraps(map, rooms, [], 10);
      const tiles = traps.map(t => `${t.tile.x},${t.tile.y}`);
      expect(new Set(tiles).size).toBe(tiles.length);
      expect(new Set(traps.map(t => t.id)).size).toBe(traps.length);
    }
  });

  it('starts every placed trap hidden, armed and pointing at a real trap kind', () => {
    const { map, rooms } = mkMap();
    const traps = placeTraps(map, rooms, [], 6);
    expect(traps.length).toBeGreaterThan(0);
    for (const trap of traps) {
      expect(trap.detected).toBe(false);
      expect(trap.disarmed).toBe(false);
      expect(getTrapKind(trap.kindId)).toBeDefined();
      expect(map.getTile(trap.tile.x, trap.tile.y)).toBe(TileType.Floor);
    }
  });

  it('seeds more traps deeper down, but never more than twelve', () => {
    const { map, rooms } = mkMap();
    expect(placeTraps(map, rooms, [], 1).length).toBe(3);
    expect(placeTraps(map, rooms, [], 4).length).toBe(8);
    expect(placeTraps(map, rooms, [], 20).length).toBe(12);
    expect(placeTraps(map, rooms, [], 100).length).toBe(12);
  });

  it('favours corridors over open rooms', () => {
    const { map, rooms } = mkMap();
    let corridor = 0;
    let total = 0;
    for (let i = 0; i < 60; i++) {
      for (const trap of placeTraps(map, rooms, [], 1)) {
        total++;
        if (!inRoom(trap.tile, FAR_ROOM)) corridor++;
      }
    }
    expect(corridor / total).toBeGreaterThan(0.5);
  });
});

// ── Passive detection ────────────────────────────────

describe('bestPassivePerception', () => {
  it('reports 10 + WIS for a plain party member', () => {
    const fighter = mkMember({ wisMod: 3 });
    expect(bestPassivePerception([fighter])).toEqual({ member: fighter, score: 13 });
  });

  it('adds proficiency for scouts, so the rogue beats a wiser fighter', () => {
    const fighter = mkMember({ name: 'Fighter', wisMod: 3, profBonus: 4 });
    const rogue = mkMember({ name: 'Rogue', wisMod: 2, profBonus: 4, charClass: { id: 'rogue' } });
    const best = bestPassivePerception([fighter, rogue])!;
    expect(best.member).toBe(rogue);
    expect(best.score).toBe(16);
  });

  it('counts a ranger as a scout too', () => {
    const ranger = mkMember({ wisMod: 1, profBonus: 3, charClass: { id: 'ranger' } });
    expect(bestPassivePerception([ranger])!.score).toBe(14);
  });

  it('ignores the dead when picking the sharpest eyes', () => {
    const deadScout = mkMember({ name: 'Dead', wisMod: 5, isAlive: false, charClass: { id: 'rogue' } });
    const alive = mkMember({ name: 'Alive', wisMod: 1 });
    expect(bestPassivePerception([deadScout, alive])!.member).toBe(alive);
  });

  // This used to fall back to `{ member: members[0], score: 10 }`, handing
  // back a corpse for an all-dead party and undefined for an empty one, which
  // callers then read `.name` off.
  it('reports nobody when the whole party is down', () => {
    const dead = mkMember({ name: 'Fallen', isAlive: false });
    expect(bestPassivePerception([dead])).toBeNull();
    expect(bestPassivePerception([])).toBeNull();
  });
});

describe('sweepDetection', () => {
  it('reveals a nearby trap when passive perception meets its DC', () => {
    const trap = mkTrap({ kindId: 'spiked_pit', tile: { x: 5, y: 5 } }); // detect DC 15
    const scout = mkMember({ name: 'Nym', wisMod: 5 }); // passive 15
    const messages = sweepDetection([trap], [scout], { x: 5, y: 7 }, 3);
    expect(trap.detected).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('Nym');
    expect(messages[0]).toContain('Spiked Pit');
  });

  it('leaves a trap hidden when passive perception falls one short of its DC', () => {
    const trap = mkTrap({ kindId: 'spiked_pit' }); // detect DC 15
    const scout = mkMember({ wisMod: 4 }); // passive 14
    expect(sweepDetection([trap], [scout], { x: 5, y: 5 }, 5)).toEqual([]);
    expect(trap.detected).toBe(false);
  });

  it('leaves a trap hidden when it lies outside the sweep radius', () => {
    const trap = mkTrap({ tile: { x: 20, y: 5 } });
    const scout = mkMember({ wisMod: 10 }); // passive 20, beats every DC
    expect(sweepDetection([trap], [scout], { x: 5, y: 5 }, 4)).toEqual([]);
    expect(trap.detected).toBe(false);
  });

  it('measures the sweep radius as a square, not a circle', () => {
    // A trap 4 diagonal steps away is inside a radius-4 Chebyshev sweep even
    // though its straight-line distance is ~5.7.
    const trap = mkTrap({ tile: { x: 9, y: 9 } });
    const scout = mkMember({ wisMod: 10 });
    sweepDetection([trap], [scout], { x: 5, y: 5 }, 4);
    expect(trap.detected).toBe(true);
  });

  it('does not re-announce a trap that is already detected or disarmed', () => {
    const seen = mkTrap({ id: 'a', detected: true });
    const spent = mkTrap({ id: 'b', disarmed: true, tile: { x: 6, y: 5 } });
    const scout = mkMember({ wisMod: 10 });
    expect(sweepDetection([seen, spent], [scout], { x: 5, y: 5 }, 5)).toEqual([]);
  });

  it('an all-seeing party finds every trap kind in range in one sweep', () => {
    const traps = TRAP_KINDS.map((k, i) => mkTrap({ id: `t${i}`, kindId: k.id, tile: { x: 5, y: 5 } }));
    const scout = mkMember({ wisMod: 10 }); // passive 20 clears every detect DC
    const messages = sweepDetection(traps, [scout], { x: 5, y: 5 }, 1);
    expect(messages).toHaveLength(TRAP_KINDS.length);
    expect(traps.every(t => t.detected)).toBe(true);
  });
});

// ── Active checks ────────────────────────────────────

describe('rollPerception', () => {
  it('adds the searcher WIS modifier to the d20', () => {
    pinD20(11);
    const { natural, total } = rollPerception(mkMember({ wisMod: 4 }));
    expect(natural).toBe(11);
    expect(total).toBe(15);
  });

  it('adds proficiency on top for a scout', () => {
    pinD20(11);
    const { total } = rollPerception(mkMember({ wisMod: 4, profBonus: 3, charClass: { id: 'ranger' } }));
    expect(total).toBe(18);
  });

  it('lets a banked luck die decide the natural roll', () => {
    pinD20(2); // the d20 would have been a 2
    grantLuckDie({ value: 20, source: 'test' });
    const { natural, total } = rollPerception(mkMember({ name: 'Hero', wisMod: 1 }));
    expect(natural).toBe(20);
    expect(total).toBe(21);
  });

  it('logs the search to the dice feed as a d20 check', () => {
    pinD20(20);
    rollPerception(mkMember({ name: 'Nym' }));
    const [event] = getDiceHistory();
    expect(event.kind).toBe('check');
    expect(event.diceType).toBe('d20');
    expect(event.label).toContain('Nym');
    expect(event.outcome).toBe('crit');
  });
});

describe('rollDisarm', () => {
  const spikedPit = getTrapKind('spiked_pit') as TrapKind;

  it('never disarms any trap on a natural 1 from an unskilled hand', () => {
    pinD20(1);
    const clumsy = mkMember({ dexMod: -5, profBonus: 2 });
    for (const kind of TRAP_KINDS) {
      const result = rollDisarm(clumsy, mkTrap({ kindId: kind.id }), kind);
      expect(result.natural).toBe(1);
      expect(result.success).toBe(false);
      expect(result.criticalFailure).toBe(true);
    }
  });

  it('always disarms every trap on a natural 20 from an expert rogue', () => {
    pinD20(20);
    const expert = mkMember({ dexMod: 5, profBonus: 6, charClass: { id: 'rogue' } });
    for (const kind of TRAP_KINDS) {
      const result = rollDisarm(expert, mkTrap({ kindId: kind.id }), kind);
      expect(result.natural).toBe(20);
      expect(result.total).toBe(31);
      expect(result.success).toBe(true);
      expect(result.criticalFailure).toBe(false);
    }
  });

  it('adds proficiency for a rogue but not for a fighter with the same DEX', () => {
    pinD20(10);
    const fighter = rollDisarm(mkMember({ dexMod: 2, profBonus: 3 }), mkTrap(), spikedPit);
    pinD20(10);
    const rogue = rollDisarm(
      mkMember({ dexMod: 2, profBonus: 3, charClass: { id: 'rogue' } }), mkTrap(), spikedPit,
    );
    expect(fighter.total).toBe(12);
    expect(rogue.total).toBe(15);
    expect(fighter.success).toBe(false); // DC 13
    expect(rogue.success).toBe(true);
  });

  it('treats a near miss as an ordinary failure, not a critical one', () => {
    pinD20(10); // total 10 vs DC 13 — short, but by less than 5
    const result = rollDisarm(mkMember(), mkTrap(), spikedPit);
    expect(result.success).toBe(false);
    expect(result.criticalFailure).toBe(false);
  });

  it('treats a miss by more than five as a critical failure', () => {
    pinD20(2); // total 2 vs DC 13
    const result = rollDisarm(mkMember(), mkTrap(), spikedPit);
    expect(result.success).toBe(false);
    expect(result.criticalFailure).toBe(true);
  });

  it('logs the attempt with the trap name and its disarm DC', () => {
    pinD20(10);
    rollDisarm(mkMember({ name: 'Nym' }), mkTrap(), spikedPit);
    const [event] = getDiceHistory();
    expect(event.label).toContain('Nym');
    expect(event.label).toContain('Spiked Pit');
    expect(event.label).toContain(`DC ${spikedPit.disarmDc}`);
    expect(event.outcome).toBe('failure');
  });

  it('does not disarm the trap by itself — that is the caller\'s job', () => {
    pinD20(20);
    const trap = mkTrap();
    rollDisarm(mkMember({ dexMod: 5, charClass: { id: 'rogue' } }), trap, spikedPit);
    expect(trap.disarmed).toBe(false);
  });
});

// ── Triggering ───────────────────────────────────────

describe('triggerTrap', () => {
  it('deals full damage and applies the condition on a failed save', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // every damage die maxes out
    const trap = mkTrap({ kindId: 'poison_dart' }); // 1d4+2, poisoned for 2 turns
    const victim = mkMember({ name: 'Kael', saveOutcome: { success: false, natural: 3, total: 5 } });
    const result = triggerTrap(trap, victim);
    expect(victim.damageTaken).toEqual([6]);
    expect(victim.conditionsApplied).toEqual([
      { id: 'poisoned', turns: 2, name: 'Poisoned', sourceId: trap.id },
    ]);
    expect(result.casualties).toEqual(['Kael']);
    expect(result.messages[0]).toContain('a poisoned dart whistles');
  });

  it('halves the damage and spares the condition on a successful save', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const trap = mkTrap({ kindId: 'poison_dart' }); // 1d4+2 → 6 full, 3 halved
    const victim = mkMember({ saveOutcome: { success: true, natural: 18, total: 20 } });
    triggerTrap(trap, victim);
    expect(victim.damageTaken).toEqual([3]);
    expect(victim.conditionsApplied).toEqual([]);
  });

  it('rounds halved damage down', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // every die shows a 1 → 1d4+2 = 3
    const victim = mkMember({ saveOutcome: { success: true, natural: 18, total: 20 } });
    triggerTrap(mkTrap({ kindId: 'poison_dart' }), victim);
    expect(victim.damageTaken).toEqual([1]);
  });

  it('applies only the condition for a trap that deals no damage', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const trap = mkTrap({ kindId: 'sleep_gas' }); // dice '0'
    const victim = mkMember({ name: 'Mira', saveOutcome: { success: false, natural: 4, total: 6 } });
    const result = triggerTrap(trap, victim);
    expect(victim.damageTaken).toEqual([]);
    expect(victim.conditionsApplied[0].id).toBe('unconscious');
    // No hit points lost means nobody is listed as a casualty.
    expect(result.casualties).toEqual([]);
  });

  it('spends the trap so it cannot fire twice', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const trap = mkTrap();
    triggerTrap(trap, mkMember());
    expect(trap.disarmed).toBe(true);
    expect(trap.detected).toBe(true);
  });

  it('narrates the save result against the trap save DC', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const kind = getTrapKind('spiked_pit')!;
    const victim = mkMember({ name: 'Kael', saveOutcome: { success: true, natural: 15, total: 17 } });
    const result = triggerTrap(mkTrap({ kindId: 'spiked_pit' }), victim);
    expect(result.messages.join(' ')).toContain(`DEX 17 vs DC ${kind.saveDc}`);
    expect(result.messages.join(' ')).toContain('piercing damage');
  });

  it('fires every trap kind without throwing', () => {
    for (const kind of TRAP_KINDS) {
      const victim = mkMember({ saveOutcome: { success: false, natural: 5, total: 7 } });
      const result = triggerTrap(mkTrap({ kindId: kind.id }), victim);
      expect(result.messages.length).toBeGreaterThan(0);
      for (const line of result.messages) expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});

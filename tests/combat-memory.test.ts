import { describe, it, expect } from 'vitest';
import { GameCharacter } from '../src/entities/Character';
import { Monster } from '../src/entities/Monster';
import { Party } from '../src/entities/Party';
import { chooseMonsterTarget } from '../src/combat/TargetAI';

// Plain-object mocks (the targeting brain only reads simple fields).
function mkMember(over: Record<string, unknown>): GameCharacter {
  return {
    id: `m${Math.random().toString(36).slice(2, 8)}`,
    name: 'Hero',
    charClass: { id: 'fighter' },
    hp: 10,
    maxHp: 10,
    ac: 15,
    isDead: false,
    tile: { x: 0, y: 0 },
    isAlive: true,
    vendettas: {},
    ...over,
  } as unknown as GameCharacter;
}

function mkMonster(over: Record<string, unknown>): Monster {
  return {
    id: `x${Math.random().toString(36).slice(2, 8)}`,
    template: { id: 'goblin', name: 'Goblin', cr: 1, hp: 7, ac: 15, type: 'humanoid' },
    hp: 7,
    maxHp: 7,
    isAlive: true,
    isDead: false,
    tile: { x: 0, y: 0 },
    fled: false,
    tormentorId: null,
    grudge: 0,
    ...over,
  } as unknown as Monster;
}

function mkParty(members: GameCharacter[], leaderIndex = 0): Party {
  return { members, leaderIndex } as unknown as Party;
}

describe('monster grudges (combat memory)', () => {
  it('a monster with a burning grudge hunts its tormentor by name', () => {
    const nemesis = mkMember({ name: 'Tormentor', tile: { x: 5, y: 0 } });
    const healer = mkMember({ name: 'Healer', charClass: { id: 'cleric' }, tile: { x: 0, y: 0 } });
    const party = mkParty([healer, nemesis]);
    const monster = mkMonster({ tile: { x: 0, y: 0 }, tormentorId: nemesis.id, grudge: 3 });

    const { target, reason } = chooseMonsterTarget(party, monster);
    expect(target).toBe(nemesis);
    expect(reason).toContain('vengeance');
  });

  it('a mild grudge does not override tactical scoring yet', () => {
    const healer = mkMember({ name: 'Healer', charClass: { id: 'cleric' }, tile: { x: 0, y: 0 } });
    const party = mkParty([healer]);
    const monster = mkMonster({ tile: { x: 0, y: 0 }, tormentorId: healer.id, grudge: 1 });

    // Grudge 1 < threshold 2: falls through to normal scoring (healer is
    // reachable and juicy) — but the reason must NOT be vengeance.
    const { reason } = chooseMonsterTarget(party, monster);
    expect(reason).not.toContain('vengeance');
  });

  it('the grudge fades if the tormentor is out of reach', () => {
    const nemesis = mkMember({ name: 'Far', tile: { x: 20, y: 0 } });
    const healer = mkMember({ name: 'Healer', charClass: { id: 'cleric' }, tile: { x: 0, y: 0 } });
    const party = mkParty([healer, nemesis]);
    const monster = mkMonster({ tile: { x: 0, y: 0 }, tormentorId: nemesis.id, grudge: 5 });

    const { target } = chooseMonsterTarget(party, monster);
    expect(target).not.toBe(nemesis);
  });

  it('ignores the grudge when the tormentor is already dead', () => {
    const dead = mkMember({ name: 'Dead', hp: 0, isDead: true, isAlive: false, tile: { x: 5, y: 0 } });
    const healer = mkMember({ name: 'Healer', charClass: { id: 'cleric' }, tile: { x: 0, y: 0 } });
    const party = mkParty([healer, dead]);
    const monster = mkMonster({ tile: { x: 0, y: 0 }, tormentorId: dead.id, grudge: 5 });

    const { target } = chooseMonsterTarget(party, monster);
    expect(target).toBe(healer);
  });

  it('a downed tormentor is a valid vengeance target (coup de grace)', () => {
    const downed = mkMember({ name: 'Downed', hp: 0, tile: { x: 5, y: 0 } });
    const healer = mkMember({ name: 'Healer', charClass: { id: 'cleric' }, tile: { x: 0, y: 0 } });
    const party = mkParty([healer, downed]);
    const monster = mkMonster({ tile: { x: 0, y: 0 }, tormentorId: downed.id, grudge: 5 });

    const { target, reason } = chooseMonsterTarget(party, monster);
    expect(target).toBe(downed);
    expect(reason).toContain('vengeance');
  });
});

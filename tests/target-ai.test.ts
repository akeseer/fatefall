import { describe, it, expect } from 'vitest';
import { GameCharacter } from '../src/entities/Character';
import { Monster } from '../src/entities/Monster';
import { Party } from '../src/entities/Party';
import { chooseMonsterTarget, choosePartyFocus } from '../src/combat/TargetAI';

// Plain-object mocks: the targeting brain only reads simple fields (hp, maxHp,
// ac, tile, charClass.id, isAlive, isDead), so we don't need the real classes.
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
    ...over,
  } as unknown as GameCharacter;
}

function mkMonster(over: Record<string, unknown>): Monster {
  return {
    id: `x${Math.random().toString(36).slice(2, 8)}`,
    template: { id: 'goblin', name: 'Goblin', cr: 1, hp: 7, ac: 15 },
    hp: 7,
    maxHp: 7,
    isAlive: true,
    isDead: false,
    tile: { x: 0, y: 0 },
    ...over,
  } as unknown as Monster;
}

function mkParty(members: GameCharacter[], leaderIndex = 0): Party {
  return { members, leaderIndex } as unknown as Party;
}

describe('chooseMonsterTarget', () => {
  it('fixates on a downed hero to land the killing blow', () => {
    const downed = mkMember({ hp: 0, tile: { x: 0, y: 0 } });
    const healthy = mkMember({ hp: 10, tile: { x: 0, y: 0 } });
    const party = mkParty([healthy, downed]);
    const monster = mkMonster({ tile: { x: 0, y: 0 } });

    const { target } = chooseMonsterTarget(party, monster);
    expect(target).toBe(downed);
  });

  it('denies the healer over a front-liner when both are reachable', () => {
    const healer = mkMember({ charClass: { id: 'cleric' }, tile: { x: 0, y: 0 }, hp: 10 });
    const fighter = mkMember({ charClass: { id: 'fighter' }, tile: { x: 0, y: 0 }, hp: 10 });
    const party = mkParty([fighter, healer]);
    const monster = mkMonster({ tile: { x: 0, y: 0 } });

    const { target } = chooseMonsterTarget(party, monster);
    expect(target).toBe(healer);
  });
});

describe('choosePartyFocus', () => {
  it('picks the near-death foe first so the party lands the kill', () => {
    const dying = mkMonster({ id: 'dying', hp: 4, maxHp: 30, tile: { x: 0, y: 0 } });
    const boss = mkMonster({ id: 'boss', hp: 60, maxHp: 60, template: { id: 'dragon', name: 'Dragon', cr: 20, hp: 60, ac: 20 } });
    const party = mkParty([]);

    const { target, reason } = choosePartyFocus(party, [boss, dying]);
    expect(target).toBe(dying);
    expect(reason).toContain('nearly dead');
  });

  it('falls back to the boss when nothing is near death', () => {
    const grunt = mkMonster({ id: 'grunt', hp: 30, maxHp: 30, template: { id: 'goblin', name: 'Goblin', cr: 1, hp: 30, ac: 15 } });
    const boss = mkMonster({ id: 'boss', hp: 60, maxHp: 60, template: { id: 'dragon', name: 'Dragon', cr: 20, hp: 60, ac: 20 } });
    const party = mkParty([]);

    const { target } = choosePartyFocus(party, [grunt, boss]);
    expect(target).toBe(boss);
  });
});

import { describe, it, expect } from 'vitest';
import { shouldMonsterFlee } from '../src/combat/TargetAI';
import { Monster } from '../src/entities/Monster';
import type { MonsterTemplate } from '../src/entities/Monster';

function makeMonster(overrides: Partial<MonsterTemplate> = {}): Monster {
  const template: MonsterTemplate = {
    id: 'bandit',
    name: 'Bandit',
    description: 'a desperate highwayman',
    hp: 20,
    ac: 12,
    speed: 30,
    abilities: { str: 10, dex: 12, con: 10, int: 10, wis: 10, cha: 10 },
    attackBonus: 3,
    damageDie: 6,
    damageDice: 1,
    damageBonus: 1,
    xp: 50,
    cr: 1,
    size: 'Medium',
    type: 'humanoid',
  };
  const tpl = { ...template, ...overrides };
  const monster = new Monster('test_' + tpl.id, tpl, { x: 0, y: 0 });
  return monster;
}

function forceBoss(monster: Monster): void {
  Object.defineProperty(monster, 'isBoss', { get: () => true, configurable: true });
}

const calmCtx = { alliesAlive: 3, alliesFled: 0, foesStanding: 4, round: 1 };

describe('shouldMonsterFlee', () => {
  it('flees when badly wounded regardless of the pack', () => {
    const m = makeMonster();
    m.hp = 5; // 25% of 20
    expect(shouldMonsterFlee(m, calmCtx)).toBe(true);
  });

  it('stands its ground while healthy with allies around', () => {
    const m = makeMonster();
    m.hp = 16; // 80%
    expect(shouldMonsterFlee(m, calmCtx)).toBe(false);
  });

  it("never flees for fearless kinds even at death's door", () => {
    for (const type of ['undead', 'construct', 'ooze', 'plant'] as const) {
      const m = makeMonster({ id: 'x', type });
      m.hp = 1;
      expect(shouldMonsterFlee(m, calmCtx)).toBe(false);
    }
  });

  it('never flees for a boss', () => {
    const m = makeMonster();
    m.hp = 1;
    forceBoss(m);
    expect(shouldMonsterFlee(m, calmCtx)).toBe(false);
  });

  it('flees when alone against a standing healthy party', () => {
    const m = makeMonster();
    m.hp = 20;
    expect(shouldMonsterFlee(m, { alliesAlive: 1, alliesFled: 0, foesStanding: 3, round: 3 })).toBe(true);
  });

  it('does not panic when alone but the party is nearly spent', () => {
    const m = makeMonster();
    m.hp = 20;
    expect(shouldMonsterFlee(m, { alliesAlive: 1, alliesFled: 0, foesStanding: 1, round: 3 })).toBe(false);
  });

  it('respects an already-fled creature (idempotent)', () => {
    const m = makeMonster();
    m.hp = 5;
    m.fled = true;
    expect(shouldMonsterFlee(m, calmCtx)).toBe(false);
  });
});

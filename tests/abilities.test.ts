import { describe, it, expect } from 'vitest';
import { GameCharacter } from '../src/entities/Character';
import { Party } from '../src/entities/Party';
import { COMBAT_ABILITIES, getAbilityForClass, sneakAttackDice } from '../src/combat/Abilities';

function mkHero(classId: string, level = 1): GameCharacter {
  return {
    id: `h${Math.random().toString(36).slice(2, 8)}`,
    name: 'Hero',
    charClass: { id: classId },
    level,
    hp: 10,
    maxHp: 10,
    abilityUses: {},
    isDead: false,
    isAlive: true,
  } as unknown as GameCharacter;
}

describe('combat abilities registry', () => {
  it('assigns each martial class its signature ability', () => {
    expect(getAbilityForClass('fighter', 1)?.id).toBe('second_wind');
    expect(getAbilityForClass('barbarian', 1)?.id).toBe('rage');
    expect(getAbilityForClass('monk', 2)?.id).toBe('flurry_of_blows');
    expect(getAbilityForClass('ranger', 1)?.id).toBe('hunters_mark');
    expect(getAbilityForClass('rogue', 1)?.id).toBe('sneak_attack');
  });

  it('gives every class one active ability of its own', () => {
    const expected: Record<string, string> = {
      fighter: 'second_wind', barbarian: 'rage', monk: 'flurry_of_blows', ranger: 'hunters_mark',
      artificer: 'arcane_jolt', blood_hunter: 'blood_mite', paladin: 'divine_smite', cleric: 'channel_divinity',
      wizard: 'arcane_recovery', druid: 'wild_shape', bard: 'bardic_inspiration', sorcerer: 'chaos_surge', warlock: 'eldritch_hex',
    };
    for (const [cls, id] of Object.entries(expected)) {
      const a = getAbilityForClass(cls, 5);
      expect(a?.id, cls).toBe(id);
      expect(a?.effect, cls).toBeDefined();
      expect(a!.usesPerRest(5), cls).toBeGreaterThan(0);
    }
    // The rogue's is a passive that rides its strikes.
    expect(getAbilityForClass('rogue', 5)?.id).toBe('sneak_attack');
  });

  it('respects minLevel gating', () => {
    expect(getAbilityForClass('monk', 1)?.id).toBeUndefined();
    expect(getAbilityForClass('monk', 2)?.id).toBe('flurry_of_blows');
  });

  it('scales rage uses with barbarian level', () => {
    const rage = COMBAT_ABILITIES.find(a => a.id === 'rage')!;
    expect(rage.usesPerRest(1)).toBe(2);
    expect(rage.usesPerRest(3)).toBe(3);
  });

  it('sneak attack dice grow every two levels', () => {
    expect(sneakAttackDice(1)).toBe(1);
    expect(sneakAttackDice(3)).toBe(2);
    expect(sneakAttackDice(5)).toBe(3);
    expect(sneakAttackDice(9)).toBe(5);
  });
});

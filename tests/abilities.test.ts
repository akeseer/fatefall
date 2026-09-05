import { describe, it, expect } from 'vitest';
import {
  COMBAT_ABILITIES, getAbilitiesForClass, getAbilityForClass, getAbilityById, sneakAttackDice, hasAbilityFor,
  resourceKindOf, resourceMax, resourceRegen, costLabel, CLASS_RESOURCE, MARK_ABILITIES,
} from '../src/combat/Abilities';
import { CLASSES } from '../src/data/gameData';

/** The skill ladders: every class climbs one, paying from its own pool. */
describe('class skill ladders', () => {
  it('give every class at least three active skills by level 7, unlocked in order', () => {
    for (const cls of CLASSES) {
      const at1 = getAbilitiesForClass(cls.id, 1);
      const at7 = getAbilitiesForClass(cls.id, 7);
      expect(at1.length, cls.id).toBeGreaterThanOrEqual(1);
      expect(at7.length, cls.id).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < at7.length; i++) expect(at7[i].minLevel, cls.id).toBeGreaterThanOrEqual(at7[i - 1].minLevel);
      for (const a of at7) expect(a.effect, `${cls.id}:${a.id}`).toBeDefined();
    }
  });

  it('gate skills by level', () => {
    expect(getAbilitiesForClass('fighter', 1).map(a => a.id)).toEqual(['power_strike', 'second_wind']);
    expect(getAbilitiesForClass('fighter', 3).map(a => a.id)).toContain('action_surge');
    expect(getAbilitiesForClass('fighter', 2).map(a => a.id)).not.toContain('action_surge');
    expect(getAbilitiesForClass('monk', 1).map(a => a.id)).toEqual(['flurry_of_blows']);
    expect(getAbilitiesForClass('monk', 6).map(a => a.id)).toContain('ki_wave');
  });

  it('names the newest skill as the signature, and keeps the rogue\'s passive', () => {
    expect(getAbilityForClass('fighter', 1)?.id).toBe('second_wind');
    expect(getAbilityForClass('fighter', 3)?.id).toBe('action_surge');
    expect(getAbilityForClass('barbarian', 1)?.id).toBe('rage');
    expect(getAbilityForClass('rogue', 1)?.id).not.toBeNull();
    expect(getAbilitiesForClass('rogue', 1).some(a => a.id === 'sneak_attack')).toBe(false);
    expect(getAbilityById('sneak_attack')?.passive).toBe(true);
    expect(hasAbilityFor('rogue', 1)).toBe(true);
  });

  it('has unique ids and a cost every pool can eventually pay', () => {
    const ids = COMBAT_ABILITIES.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of COMBAT_ABILITIES) {
      expect(a.cost, a.id).toBeGreaterThanOrEqual(0);
      expect(a.cooldown, a.id).toBeGreaterThanOrEqual(0);
      const kind = resourceKindOf(a.classId);
      if (kind !== 'blood') expect(resourceMax(a.classId, a.minLevel), a.id).toBeGreaterThanOrEqual(a.cost);
    }
  });

  it('puts every skill that hits with dice on a class that can roll them', () => {
    for (const a of COMBAT_ABILITIES) {
      if (a.effect === 'burst' || a.effect === 'drain') expect(a.bonusDamageDice, a.id).toBeDefined();
      if (a.effect === 'heal' || a.effect === 'heal_ally' || a.effect === 'heal_all') expect(a.healDice, a.id).toBeDefined();
      if (a.effect === 'ward') expect(a.ward, a.id).toBeDefined();
      if (a.effect === 'rage') expect(a.buff?.rounds, a.id).toBeGreaterThan(0);
    }
    for (const id of MARK_ABILITIES) expect(getAbilityById(id)?.effect).toBe('attack');
  });
});

describe('resource pools', () => {
  it('assign every class a pool', () => {
    for (const cls of CLASSES) expect(CLASS_RESOURCE[cls.id], cls.id).toBeDefined();
  });

  it('grow with level and refill a little each round', () => {
    expect(resourceMax('wizard', 1)).toBeLessThan(resourceMax('wizard', 5));
    expect(resourceMax('fighter', 1)).toBeLessThan(resourceMax('fighter', 5));
    expect(resourceMax('blood_hunter', 5)).toBe(0);
    for (const kind of ['mana', 'stamina', 'ki', 'focus'] as const) expect(resourceRegen(kind)).toBeGreaterThan(0);
    expect(resourceRegen('blood')).toBe(0);
  });

  it('describe a cost in the pool\'s own words', () => {
    expect(costLabel(getAbilityById('divine_smite')!)).toBe('4 mana');
    expect(costLabel(getAbilityById('rage')!)).toBe('4 stamina');
    expect(costLabel(getAbilityById('blood_mite')!)).toBe('3 HP');
    expect(costLabel(getAbilityById('arcane_recovery')!)).toBe('free');
  });
});

describe('sneak attack dice', () => {
  it('scale with rogue level', () => {
    expect(sneakAttackDice(1)).toBe(1);
    expect(sneakAttackDice(3)).toBe(2);
    expect(sneakAttackDice(5)).toBe(3);
  });
});

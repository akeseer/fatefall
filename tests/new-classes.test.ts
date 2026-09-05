import { describe, it, expect } from 'vitest';
import { CLASSES, getCasterType, maxSlotsFor } from '../src/data/gameData';
import { STARTER_GEAR, createCharacter } from '../src/game/CharacterFactory';
import { SUBCLASSES } from '../src/ai/DnDGrimoire';
import { COMBAT_ABILITIES, getAbilityForClass } from '../src/combat/Abilities';
import { GameCharacter } from '../src/entities/Character';

function byId(id: string) {
  return CLASSES.find(c => c.id === id);
}

describe('new classes', () => {
  it('registers both classes with full definitions', () => {
    const artificer = byId('artificer');
    const bloodHunter = byId('blood_hunter');
    expect(artificer).toBeDefined();
    expect(bloodHunter).toBeDefined();
    expect(artificer!.hitDie).toBe(8);
    expect(bloodHunter!.hitDie).toBe(10);
    expect(artificer!.primaryAbilities).toContain('int');
    expect(bloodHunter!.primaryAbilities).toContain('str');
  });

  it('gives artificer full casting and blood hunter none', () => {
    expect(getCasterType('artificer')).toBe('full');
    expect(getCasterType('blood_hunter')).toBe('none');
    // Artificer gets real slots at level 1; blood hunter gets none.
    const slots = maxSlotsFor('artificer', 1);
    expect(Array.isArray(slots)).toBe(true);
    expect(slots[0]).toBeGreaterThan(0);
  });

  it('assigns starting spells to both classes', () => {
    const a = createCharacter('artificer');
    expect(a.knownSpells.length).toBeGreaterThan(0);
    const b = createCharacter('blood_hunter');
    // Blood hunter rites: a small curated list, not empty.
    expect(b.knownSpells.length).toBeGreaterThan(0);
  });

  it('equips class-appropriate starter gear', () => {
    const artGear = STARTER_GEAR['artificer'];
    const bhGear = STARTER_GEAR['blood_hunter'];
    expect(artGear.some(i => i.type === 'weapon')).toBe(true);
    expect(artGear.some(i => i.type === 'armor')).toBe(true);
    expect(bhGear.some(i => i.type === 'weapon')).toBe(true);
    expect(bhGear.some(i => i.type === 'armor')).toBe(true);
    // Artificer wears studded leather (power 12), blood hunter light (11).
    expect(artGear.find(i => i.type === 'armor')!.power).toBe(12);
  });

  it('has subclasses for both classes', () => {
    expect(SUBCLASSES['artificer']!.length).toBeGreaterThanOrEqual(4);
    expect(SUBCLASSES['blood_hunter']!.length).toBeGreaterThanOrEqual(4);
  });

  it('gives each class its signature ability', () => {
    expect(COMBAT_ABILITIES.some(a => a.classId === 'artificer')).toBe(true);
    expect(COMBAT_ABILITIES.some(a => a.classId === 'blood_hunter')).toBe(true);
    expect(getAbilityForClass('artificer', 2)).not.toBeNull();
    // Every class starts with something: the artificer's Arcane Jolt is there from level 1.
    expect(getAbilityForClass('artificer', 1)?.id).toBe('arcane_jolt');
    expect(getAbilityForClass('blood_hunter', 1)).not.toBeNull();
  });

  it('generates playable characters end-to-end', () => {
    for (let i = 0; i < 10; i++) {
      const a: GameCharacter = createCharacter('artificer');
      expect(a.maxHp).toBeGreaterThan(0);
      expect(a.subclass).toBeDefined();
      expect(a.subclass).not.toContain('Wanderer');
      const b: GameCharacter = createCharacter('blood_hunter');
      expect(b.maxHp).toBeGreaterThan(0);
    }
  });
});

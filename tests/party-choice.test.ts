import { describe, it, expect } from 'vitest';
import { createParty } from '../src/game/CharacterFactory';
import { rollClasses, PARTY_SIZE } from '../src/ui/PartyBuilder';
import { CLASSES } from '../src/data/gameData';

/**
 * A new run begins with the player choosing the party's classes. The factory
 * honours the picks seat by seat and rolls everything else, as it always did.
 */
describe('createParty with chosen classes', () => {
  it('seats the chosen classes in order and rolls the rest of each hero', () => {
    const party = createParty(4, ['wizard', 'rogue', 'cleric', 'fighter']);
    expect(party.map(m => m.charClass.id)).toEqual(['wizard', 'rogue', 'cleric', 'fighter']);
    for (const m of party) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.race.id.length).toBeGreaterThan(0);
      expect(m.maxHp).toBeGreaterThan(0);
      expect(m.inventory.length).toBeGreaterThan(0);
    }
  });

  it('allows the same class twice when the player wants it', () => {
    const party = createParty(4, ['fighter', 'fighter', 'fighter', 'fighter']);
    expect(party.map(m => m.charClass.id)).toEqual(['fighter', 'fighter', 'fighter', 'fighter']);
    // Four fighters, four different people.
    expect(new Set(party.map(m => m.id)).size).toBe(4);
  });

  it('fills unpicked seats with classes the party does not already have', () => {
    for (let i = 0; i < 20; i++) {
      const party = createParty(4, ['bard', 'monk']);
      const ids = party.map(m => m.charClass.id);
      expect(ids.slice(0, 2)).toEqual(['bard', 'monk']);
      expect(new Set(ids).size).toBe(4);
    }
  });

  it('ignores a pick that is not a class and rolls that seat instead', () => {
    const party = createParty(4, ['dragon_rider', 'cleric']);
    expect(party[1].charClass.id).toBe('cleric');
    expect(CLASSES.some(c => c.id === party[0].charClass.id)).toBe(true);
    expect(party[0].charClass.id).not.toBe('cleric');
  });

  it('still rolls a whole party when nothing is chosen', () => {
    const party = createParty(4);
    expect(party).toHaveLength(4);
    expect(new Set(party.map(m => m.charClass.id)).size).toBe(4);
  });
});

describe('rollClasses', () => {
  it('draws distinct real classes, as many as the party seats', () => {
    for (let i = 0; i < 30; i++) {
      const picks = rollClasses(PARTY_SIZE);
      expect(picks).toHaveLength(PARTY_SIZE);
      expect(new Set(picks).size).toBe(PARTY_SIZE);
      for (const p of picks) expect(CLASSES.some(c => c.id === p)).toBe(true);
    }
  });
});

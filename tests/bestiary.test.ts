import { describe, it, expect } from 'vitest';
import { BESTIARY, getBestiaryEntry } from '../src/ai/DnDKnowledge';
import { ODND_BESTIARY, ADND1E_BESTIARY, CLASSIC_BESTIARY, ADND2E_BESTIARY, DND3E_BESTIARY, DND35E_BESTIARY, DND4E_BESTIARY, DND5E_BESTIARY, DND2025_BESTIARY } from '../src/ai/editions';

const EDITIONS = {
  odnd: ODND_BESTIARY, adnd1e: ADND1E_BESTIARY, classic: CLASSIC_BESTIARY, adnd2e: ADND2E_BESTIARY,
  dnd3e: DND3E_BESTIARY, dnd35e: DND35E_BESTIARY, dnd4e: DND4E_BESTIARY, dnd5e: DND5E_BESTIARY,
  dnd2025: DND2025_BESTIARY,
};

describe('edition bestiaries', () => {
  it('every edition carries a worthwhile number of creatures', () => {
    // The four later editions used to hold a dozen entries each against 67 for
    // original D&D, so the compendium was lopsided. Keep them all substantial.
    for (const [name, list] of Object.entries(EDITIONS)) {
      expect(list.length, `${name} is too thin`).toBeGreaterThanOrEqual(20);
    }
  });

  it('has no duplicate ids anywhere in the compendium', () => {
    const seen = new Map<string, string>();
    for (const [name, list] of Object.entries(EDITIONS)) {
      for (const e of list) {
        expect(seen.has(e.id), `${e.id} appears in both ${seen.get(e.id)} and ${name}`).toBe(false);
        seen.set(e.id, name);
      }
    }
  });

  it('has no duplicate names within an edition', () => {
    for (const [name, list] of Object.entries(EDITIONS)) {
      const names = list.map(e => e.name);
      expect(new Set(names).size, `${name} repeats a creature`).toBe(names.length);
    }
  });

  it('every entry is complete enough to render in the compendium', () => {
    for (const [edition, list] of Object.entries(EDITIONS)) {
      for (const e of list) {
        const where = `${edition}/${e.id}`;
        expect(e.name, where).toBeTruthy();
        expect(e.type, where).toBeTruthy();
        expect(e.size, where).toBeTruthy();
        expect(e.alignment, where).toBeTruthy();
        expect(typeof e.cr, where).toBe('number');
        expect(e.cr, where).toBeGreaterThanOrEqual(0);
        expect(typeof e.ac, where).toBe('number');
        expect(e.hp, where).toBeTruthy();
        expect(e.speed, where).toBeTruthy();
        expect(e.description.length, where).toBeGreaterThan(20);
        expect(e.lore.length, where).toBeGreaterThan(20);
        expect(e.tactics.length, where).toBeGreaterThan(10);
        expect(e.habitat, where).toBeTruthy();
        expect(Array.isArray(e.abilities), where).toBe(true);
        expect(e.abilities.length, where).toBeGreaterThan(0);
        expect(Array.isArray(e.languages), where).toBe(true);
        expect(Array.isArray(e.senses), where).toBe(true);
      }
    }
  });

  it('every edition entry is reachable through the flattened bestiary', () => {
    for (const list of Object.values(EDITIONS)) {
      for (const e of list) {
        expect(getBestiaryEntry(e.id)?.name, `${e.id} is missing from BESTIARY`).toBe(e.name);
      }
    }
    expect(BESTIARY.length).toBeGreaterThan(400);
  });
});

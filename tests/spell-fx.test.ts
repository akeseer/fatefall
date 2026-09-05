import { describe, it, expect } from 'vitest';
import { SPELL_FX, spellFxFor } from '../src/ui/SpellFx';
import { SPELLS } from '../src/data/gameData';
import { sfx } from '../src/audio/Sfx';
import { ELEMENT_COLORS } from '../src/ui/BattleFx';

/** Every spell in the table has a look; every look points at things that exist. */
describe('the spell effects table', () => {
  it('covers every spell in the data', () => {
    const missing = SPELLS.map(s => s.name).filter(n => !spellFxFor(n));
    expect(missing).toEqual([]);
  });

  it('names only sounds the bank has and elements the palette has', () => {
    const bank = new Set(Object.keys(sfx));
    for (const [name, fx] of Object.entries(SPELL_FX)) {
      expect(bank.has(fx.sound), `${name} → sound ${fx.sound}`).toBe(true);
      expect(ELEMENT_COLORS[fx.element], `${name} → element ${fx.element}`).toBeDefined();
    }
  });

  it('spreads the spells across many motifs rather than one', () => {
    const motifs = new Set(Object.values(SPELL_FX).map(f => f.motif));
    expect(motifs.size).toBeGreaterThanOrEqual(25);
    // The signature ones are what they should be.
    expect(spellFxFor('Fireball')?.motif).toBe('aoe');
    expect(spellFxFor('Magic Missile')?.motif).toBe('darts');
    expect(spellFxFor('Lightning Bolt')?.motif).toBe('zapline');
    expect(spellFxFor('Misty Step')?.motif).toBe('blink');
    expect(spellFxFor('Spiritual Weapon')?.motif).toBe('hammer');
    expect(spellFxFor('Thorn Whip')?.motif).toBe('lash');
    expect(spellFxFor('Vicious Mockery')?.motif).toBe('mock');
    expect(spellFxFor('Ice Storm')?.motif).toBe('storm');
    expect(spellFxFor('nothing of the sort')).toBeNull();
  });
});

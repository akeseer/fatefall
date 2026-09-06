import { describe, it, expect } from 'vitest';
import { surgeFor, WILD_MAGIC_TABLE_SIZE } from '../src/combat/WildMagic';

describe('wild magic', () => {
  it('has twenty results, each naming the caster and carrying an effect', () => {
    expect(WILD_MAGIC_TABLE_SIZE).toBe(20);
    const kinds = new Set<string>();
    for (let roll = 1; roll <= 20; roll++) {
      const s = surgeFor(roll, 'Sera');
      expect(s.roll).toBe(roll);
      expect(s.text).toContain('Wild magic');
      expect(s.text.includes('Sera') || s.effect.kind !== 'none' || /torch|butterflies|bell|see through/.test(s.text)).toBe(true);
      kinds.add(s.effect.kind);
    }
    expect(kinds).toContain('heal_party');
    expect(kinds).toContain('burn_foe');
    expect(kinds).toContain('bless');
    expect(kinds).toContain('none');
  });

  it('clamps rolls off the table', () => {
    expect(surgeFor(0, 'x').roll).toBe(0);
    expect(surgeFor(99, 'x').effect).toEqual(surgeFor(20, 'x').effect);
  });
});

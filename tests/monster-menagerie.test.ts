import { describe, it, expect } from 'vitest';
import { MONSTER_TEMPLATES, THEME_MONSTERS, getMonsterTemplate } from '../src/entities/Monster';
import { MENAGERIE_MONSTERS, MENAGERIE_THEMES, MENAGERIE_SPECIALS, MENAGERIE_BOSS_KITS } from '../src/entities/MonsterMenagerie';
import { MENAGERIE_KINDS, CLASSIC_KINDS, isUndeadKind, isUnholyKind, alignmentForKind, TALKING_KINDS, FEARLESS_KINDS } from '../src/entities/MonsterKinds';
import { EXPANSION_ART } from '../src/entities/MonsterExpansion';
import { artForTemplate, drawComposedMonster } from '../src/entities/MonsterArt';
import { elementalMultiplier, MONSTER_SPECIALS, BOSS_KITS } from '../src/rules/Rules';
import { canParley } from '../src/events/Parley';
import { LOCATIONS } from '../src/ai/DnDKnowledge';

describe('the menagerie', () => {
  it('adds twenty-five kinds, two creatures of each', () => {
    expect(MENAGERIE_KINDS.length).toBe(25);
    expect(new Set([...CLASSIC_KINDS, ...MENAGERIE_KINDS]).size).toBe(39);
    for (const kind of MENAGERIE_KINDS) {
      const of = MENAGERIE_MONSTERS.filter(m => m.type === kind);
      expect(of.length, kind).toBe(2);
    }
    expect(MENAGERIE_MONSTERS.length).toBe(50);
    for (const m of MENAGERIE_MONSTERS) {
      expect(getMonsterTemplate(m.id)).toBe(m);
      expect(EXPANSION_ART[m.id], m.id).toBeDefined();
    }
    expect(new Set(MONSTER_TEMPLATES.map(m => m.id)).size).toBe(MONSTER_TEMPLATES.length);
  });

  it('the ten zones are locations with rosters of real creatures', () => {
    for (const [zone, ids] of Object.entries(MENAGERIE_THEMES)) {
      expect(LOCATIONS.some(l => l.id === zone), zone).toBe(true);
      const roster = THEME_MONSTERS[zone] ?? [];
      expect(roster.length, zone).toBeGreaterThan(12);
      for (const id of roster) expect(getMonsterTemplate(id), `${zone}: ${id}`).toBeDefined();
      // Names that the bestiary does not know are dropped, never kept.
      expect(roster.every(id => ids.includes(id))).toBe(true);
    }
  });

  it('riders and kits reached the rules', () => {
    for (const id of Object.keys(MENAGERIE_SPECIALS)) expect(MONSTER_SPECIALS[id]).toBe(MENAGERIE_SPECIALS[id]);
    for (const id of Object.keys(MENAGERIE_BOSS_KITS)) expect(BOSS_KITS[id]).toBe(MENAGERIE_BOSS_KITS[id]);
  });

  it('the kinds mean something to the rules', () => {
    expect(isUndeadKind('vampire')).toBe(true);
    expect(isUndeadKind('automaton')).toBe(false);
    expect(isUnholyKind('devil')).toBe(true);
    expect(elementalMultiplier('radiant', 'vampire').mult).toBeGreaterThan(1);
    expect(elementalMultiplier('fire', 'fungus').mult).toBeGreaterThan(1);
    expect(elementalMultiplier('poison', 'automaton').mult).toBeLessThan(1);
    expect(elementalMultiplier('cold', 'reptile').mult).toBeGreaterThan(1);
    expect(FEARLESS_KINDS.has('automaton')).toBe(true);
    expect(TALKING_KINDS.has('genie')).toBe(true);
    expect(canParley([{ name: 'Gutter Hag', type: 'hag', cr: 3, isBoss: false }])).toBe(true);
    expect(canParley([{ name: 'Hall Raptor', type: 'dinosaur', cr: 2, isBoss: false }])).toBe(false);
    expect(alignmentForKind('devil', 4)).toBe('lawful evil');
    expect(alignmentForKind('insect', 1)).toBe('unaligned');
  });

  it('every new kind draws with a body that fits it', () => {
    const seen = new Map<string, string>();
    for (const kind of MENAGERIE_KINDS) {
      const spec = artForTemplate({ id: `test_${kind}`, name: 'Thing', type: kind, size: 'Medium' });
      let n = 0;
      drawComposedMonster(() => { n++; }, spec);
      expect(n).toBeGreaterThan(0);
      seen.set(kind, spec.body);
    }
    expect(seen.get('insect')).toBe('spider');
    expect(seen.get('avian')).toBe('flyer');
    expect(seen.get('wyrm')).toBe('serpent');
    expect(seen.get('shade')).toBe('wraith');
    expect(seen.get('titan')).toBe('brute');
  });
});

import { describe, it, expect } from 'vitest';
import { MONSTER_TEMPLATES, THEME_MONSTERS, getMonsterTemplate } from '../src/entities/Monster';
import { EXPANSION_MONSTERS, EXPANSION_THEMES, EXPANSION_SPECIALS, EXPANSION_BOSS_KITS, EXPANSION_ART } from '../src/entities/MonsterExpansion';
import { artForTemplate, drawComposedMonster, type Grid } from '../src/entities/MonsterArt';
import { MONSTER_SPECIALS, BOSS_KITS } from '../src/rules/Rules';
import { LOCATIONS } from '../src/ai/DnDKnowledge';

describe('the second hundred', () => {
  it('is a hundred creatures with unique ids that joined the bestiary', () => {
    expect(EXPANSION_MONSTERS.length).toBe(100);
    const ids = new Set(MONSTER_TEMPLATES.map(m => m.id));
    expect(ids.size).toBe(MONSTER_TEMPLATES.length);
    for (const m of EXPANSION_MONSTERS) expect(getMonsterTemplate(m.id)).toBe(m);
  });

  it('spans the floors and the types', () => {
    const crs = EXPANSION_MONSTERS.map(m => m.cr);
    expect(crs.filter(c => c <= 1).length).toBeGreaterThanOrEqual(20);
    expect(crs.filter(c => c >= 10).length).toBeGreaterThanOrEqual(15);
    const types = new Set(EXPANSION_MONSTERS.map(m => m.type));
    expect(types.size).toBe(14);
    for (const m of EXPANSION_MONSTERS) {
      expect(m.hp).toBeGreaterThan(0);
      expect(m.xp).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(30);
    }
  });

  it('every theme affinity names a real creature, and the new themes are real locations', () => {
    for (const [theme, ids] of Object.entries(EXPANSION_THEMES)) {
      for (const id of ids) expect(getMonsterTemplate(id), `${theme}: ${id}`).toBeDefined();
      expect(THEME_MONSTERS[theme]).toEqual(expect.arrayContaining(ids));
      expect(LOCATIONS.some(l => l.id === theme), theme).toBe(true);
    }
    for (const id of ['salt_mine_deeps', 'drowned_lighthouse', 'plague_hospice', 'giants_causeway']) {
      expect(THEME_MONSTERS[id]?.length ?? 0).toBeGreaterThan(8);
    }
  });

  it('riders and boss kits point at creatures and reached the rules', () => {
    for (const id of Object.keys(EXPANSION_SPECIALS)) {
      expect(getMonsterTemplate(id), id).toBeDefined();
      expect(MONSTER_SPECIALS[id]).toBe(EXPANSION_SPECIALS[id]);
    }
    for (const id of Object.keys(EXPANSION_BOSS_KITS)) {
      expect(getMonsterTemplate(id), id).toBeDefined();
      expect(BOSS_KITS[id]).toBe(EXPANSION_BOSS_KITS[id]);
      expect(EXPANSION_BOSS_KITS[id].legendary.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('composed art', () => {
  const paint = (): { grid: Grid; count: () => number; colors: Set<string> } => {
    let n = 0; const colors = new Set<string>();
    return { grid: (c) => { n++; colors.add(c); }, count: () => n, colors };
  };

  it('every new creature has a spec and it draws', () => {
    for (const m of EXPANSION_MONSTERS) {
      const spec = EXPANSION_ART[m.id];
      expect(spec, m.id).toBeDefined();
      const p = paint();
      drawComposedMonster(p.grid, spec);
      expect(p.count()).toBeGreaterThanOrEqual(6);
    }
  });

  it('derives a spec for anything by type and name, and a flash paints only white', () => {
    const bodies = new Set<string>();
    for (const m of MONSTER_TEMPLATES) {
      const spec = artForTemplate(m);
      bodies.add(spec.body);
      const p = paint();
      drawComposedMonster(p.grid, spec, '#fff');
      expect(p.count()).toBeGreaterThan(0);
      expect([...p.colors]).toEqual(['#fff']);
    }
    expect(bodies.size).toBeGreaterThanOrEqual(9);
    expect(artForTemplate({ id: 'x', name: 'Giant Spider', type: 'beast', size: 'Large' }).body).toBe('spider');
    expect(artForTemplate({ id: 'x', name: 'Swarm of Bats', type: 'beast', size: 'Medium' }).body).toBe('swarm');
    expect(artForTemplate({ id: 'x', name: 'Ancient Red Dragon', type: 'dragon', size: 'Large' }).traits).toEqual(expect.arrayContaining(['wings', 'crown']));
    expect(artForTemplate({ id: 'x', name: 'Ghost', type: 'undead', size: 'Medium' }).body).toBe('wraith');
  });

  it('is deterministic per id', () => {
    const a = artForTemplate({ id: 'orc', name: 'Orc', type: 'humanoid', size: 'Medium' });
    const b = artForTemplate({ id: 'orc', name: 'Orc', type: 'humanoid', size: 'Medium' });
    expect(a).toEqual(b);
  });
});

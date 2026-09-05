/**
 * The seven newer class skills, resolved by the engine: each is used once by
 * hand on a set-up fight and its consequence checked in the log or the state.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CombatEngine } from '../src/combat/CombatEngine';
import { Party } from '../src/entities/Party';
import { createCharacter } from '../src/game/CharacterFactory';
import { Monster, getMonsterTemplate } from '../src/entities/Monster';
import { resetDiceEvents } from '../src/rules/DiceEvents';
import { grantLuckDie, onLuckDieSpent } from '../src/rules/LuckDie';

function setup(classId: string, monsters: string[] = ['goblin'], level = 5) {
  const party = new Party();
  const hero = createCharacter(classId, 'human', 'Hero');
  while (hero.level < level) hero.addXp(100000);
  party.addMember(hero);
  party.setPosition({ x: 5, y: 5 });
  const engine = new CombatEngine(party);
  engine.startCombat(monsters.map((t, i) => new Monster(`m${i}`, getMonsterTemplate(t)!, { x: 6 + i, y: 5 })));
  engine.log.messages.length = 0;
  const use = () => (engine as unknown as { useClassAbility(h: typeof hero): boolean }).useClassAbility(hero);
  return { party, hero, engine, use, log: () => engine.log.messages.join('\n') };
}

beforeEach(() => { resetDiceEvents(); grantLuckDie(null); onLuckDieSpent(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the newer class skills', () => {
  it('paladin: Divine Smite strikes with radiant dice and says so', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { use, log, hero } = setup('paladin', ['skeleton']);
    expect(use()).toBe(true);
    expect(log()).toMatch(/smites .* holy light/);
    expect(log()).toContain('unholy thing screams');
    expect(hero.abilityUses.divine_smite).toBeLessThan(hero.charClass.id === 'paladin' ? 3 : 99);
  });

  it('cleric: Channel Divinity scours every foe, undead twice as hard', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { use, log, engine } = setup('cleric', ['goblin', 'skeleton']);
    const before = engine.monsters.map(m => m.hp);
    expect(use()).toBe(true);
    expect(log()).toContain('channels divinity');
    const lost = engine.monsters.map((m, i) => before[i] - m.hp);
    expect(lost[0]).toBeGreaterThan(0);
    // Twice the goblin's share, unless that is more health than the skeleton had.
    expect(lost[1]).toBe(Math.min(before[1], lost[0] * 2));
  });

  it('sorcerer: Chaos Surge reaches two foes and no more', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { use, log, engine } = setup('sorcerer', ['goblin', 'goblin', 'goblin']);
    const before = engine.monsters.map(m => m.hp);
    expect(use()).toBe(true);
    expect(log()).toContain('Chaos Surge');
    const hurt = engine.monsters.filter((m, i) => m.hp < before[i]).length;
    expect(hurt).toBe(2);
  });

  it('wizard: Arcane Recovery gives back a spent slot, and does nothing when none is spent', () => {
    const { use, log, hero } = setup('wizard');
    expect(use()).toBe(false);
    hero.spellSlots[1] = (hero.spellSlots[1] ?? 1) - 1;
    const before = hero.spellSlots[1];
    expect(use()).toBe(true);
    expect(hero.spellSlots[1]).toBe(before + 1);
    expect(log()).toContain('Arcane Recovery');
  });

  it('druid: Wild Shape mends and adds weight to blows for three rounds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { use, log, hero, engine } = setup('druid');
    hero.hp = 1;
    expect(use()).toBe(true);
    expect(hero.hp).toBeGreaterThan(1);
    expect(log()).toContain('Wild Shape');
    expect((engine as unknown as { rageRounds: Record<string, number> }).rageRounds[hero.id]).toBe(3);
  });

  it('bard: Bardic Inspiration blesses the party', () => {
    const { use, log, engine } = setup('bard');
    expect(engine.partyBlessRounds).toBe(0);
    expect(use()).toBe(true);
    expect(engine.partyBlessRounds).toBe(3);
    expect(log()).toContain('rousing verse');
  });

  it('warlock: Eldritch Hex marks the quarry for five rounds', () => {
    const { use, log, hero, engine } = setup('warlock');
    expect(use()).toBe(true);
    expect(log()).toMatch(/hexes .* every hit against it bites/);
    const marks = (engine as unknown as { marks: Record<string, { rounds: number }> }).marks;
    expect(marks[hero.id].rounds).toBe(5);
  });
});

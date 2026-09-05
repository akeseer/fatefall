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
  const use = (id?: string) => (engine as unknown as { useClassAbility(h: typeof hero, id?: string): boolean }).useClassAbility(hero, id);
  return { party, hero, engine, use, log: () => engine.log.messages.join('\n') };
}

beforeEach(() => { resetDiceEvents(); grantLuckDie(null); onLuckDieSpent(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the newer class skills', () => {
  it('paladin: Divine Smite strikes with radiant dice and says so', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { use, log, hero } = setup('paladin', ['skeleton']);
    expect(use('divine_smite')).toBe(true);
    expect(log()).toMatch(/smites .* holy light/);
    expect(log()).toContain('unholy thing screams');
    expect(hero.resource).toBe(hero.resourceMax - 4);
  });

  it('cleric: Channel Divinity scours every foe, undead twice as hard', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { use, log, engine } = setup('cleric', ['goblin', 'skeleton']);
    const before = engine.monsters.map(m => m.hp);
    expect(use('channel_divinity')).toBe(true);
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
    expect(use('chaos_surge')).toBe(true);
    expect(log()).toContain('Chaos Surge');
    const hurt = engine.monsters.filter((m, i) => m.hp < before[i]).length;
    expect(hurt).toBe(2);
  });

  it('wizard: Arcane Recovery gives back a spent slot, and does nothing when none is spent', () => {
    const { use, log, hero } = setup('wizard');
    expect(use('arcane_recovery')).toBe(false);
    hero.spellSlots[1] = (hero.spellSlots[1] ?? 1) - 1;
    const before = hero.spellSlots[1];
    expect(use('arcane_recovery')).toBe(true);
    expect(hero.spellSlots[1]).toBe(before + 1);
    expect(log()).toContain('Arcane Recovery');
  });

  it('druid: Wild Shape mends and adds weight to blows for three rounds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { use, log, hero, engine } = setup('druid');
    hero.hp = 1;
    expect(use('wild_shape')).toBe(true);
    expect(hero.hp).toBeGreaterThan(1);
    expect(log()).toContain('Wild Shape');
    expect((engine as unknown as { rageRounds: Record<string, number> }).rageRounds[hero.id]).toBe(3);
  });

  it('bard: Bardic Inspiration blesses the party', () => {
    const { use, log, engine } = setup('bard');
    expect(engine.partyBlessRounds).toBe(0);
    expect(use('bardic_inspiration')).toBe(true);
    expect(engine.partyBlessRounds).toBe(3);
    expect(log()).toContain('find their nerve');
  });

  it('warlock: Eldritch Hex marks the quarry for five rounds', () => {
    const { use, log, hero, engine } = setup('warlock');
    expect(use('eldritch_hex')).toBe(true);
    expect(log()).toMatch(/hexes .* every hit against it bites/);
    const marks = (engine as unknown as { marks: Record<string, { rounds: number }> }).marks;
    expect(marks[hero.id].rounds).toBe(5);
  });
});

describe('resources and cooldowns', () => {
  it('spends the pool, refuses what it cannot pay for, and refills a little each round', () => {
    // Low dice: every swing misses, so nobody dies and the rounds keep turning.
    vi.spyOn(Math, 'random').mockReturnValue(0.02);
    const { use, hero, engine } = setup('fighter', ['goblin'], 3);
    const max = hero.resourceMax;
    expect(hero.resource).toBe(max);
    expect(use('action_surge')).toBe(true);
    expect(hero.resource).toBe(max - 4);
    // On cooldown now.
    expect(use('action_surge')).toBe(false);
    hero.resource = 1;
    expect(use('power_strike')).toBe(false);
    // Rounds pass: the pool refills and the cooldown runs down.
    // Two combatants: every two steps is a round.
    const startRound = engine.log.round;
    while (engine.isActive && engine.log.round < startRound + 5) engine.step();
    // The regen paid for Power Strikes along the way, and the surge is off cooldown.
    expect(engine.log.messages.filter(m => m.includes('Power Strike')).length).toBeGreaterThan(0);
    // The cooldown has run out; whether it is affordable depends on what the strikes left in the pool.
    expect(engine.getDecisionAbilities(hero).find(k => k.ability.id === 'action_surge')?.cooldown).toBe(0);
  });

  it('a blood hunter pays in hit points and never below one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { use, hero } = setup('blood_hunter', ['goblin'], 1);
    const hp = hero.hp;
    expect(use('crimson_rite')).toBe(true);
    expect(hero.hp).toBe(hp - 2);
    hero.hp = 2;
    expect(hero.canAfford(hero.skills.find(a => a.id === 'blood_mite')!)).toBe(false);
  });

  it('a rest refills the pool', () => {
    const { hero } = setup('wizard');
    hero.resource = 0;
    hero.shortRest();
    expect(hero.resource).toBe(hero.resourceMax);
  });

  it('the menu lists every unlocked skill with its readiness', () => {
    const { hero, engine } = setup('cleric', ['goblin'], 6);
    const list = engine.getDecisionAbilities(hero);
    expect(list.map(k => k.ability.id)).toEqual(['healing_touch', 'sacred_hammer', 'channel_divinity', 'mass_heal']);
    expect(list.every(k => k.ready)).toBe(true);
  });
});

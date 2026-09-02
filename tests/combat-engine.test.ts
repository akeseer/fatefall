/**
 * CombatEngine — the deepest module in the game, and until now the least
 * covered. These tests drive the real engine through its public surface
 * (startCombat / step / submitCommand) and pin the rules a fight depends on:
 * initiative, attack resolution, victory and defeat, death saves, spell slots
 * and upcasting, concentration, morale, reinforcements and the fated Luck die.
 *
 * Randomness: the engine calls Math.random directly and is not injectable, so
 * every deterministic test pins it with vi.spyOn. rollD20() is
 * Math.floor(r * 20) + 1 and rollDice(n, s) sums Math.floor(r * s) + 1, so one
 * fixed r fixes every roll in the step. Fixtures are always built BEFORE the
 * spy goes in: createCharacter derives its id from Math.random, and a frozen
 * Math.random would hand two heroes the same id.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CombatEngine } from '../src/combat/CombatEngine';
import { Party } from '../src/entities/Party';
import { GameCharacter } from '../src/entities/Character';
import { createCharacter } from '../src/game/CharacterFactory';
import { Monster, getMonsterTemplate } from '../src/entities/Monster';
import { resetDiceEvents, getDiceHistory } from '../src/rules/DiceEvents';
import { grantLuckDie, getLuckDie, onLuckDieSpent } from '../src/rules/LuckDie';

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeParty(classes: string[]): Party {
  const party = new Party();
  classes.forEach((id, i) => party.addMember(createCharacter(id, 'human', `Hero${i + 1}`)));
  return party;
}

function monsterAt(templateId: string, id: string, x = 5, y = 5): Monster {
  return new Monster(id, getMonsterTemplate(templateId)!, { x, y });
}

/**
 * Pin Math.random. `rollD20()` becomes Math.floor(value * 20) + 1, so:
 *   0     → natural 1  (and the minimum on every damage die)
 *   0.05  → natural 2
 *   0.5   → natural 11
 *   0.999 → natural 20 (and the maximum on every damage die)
 */
function fixRandom(value: number) {
  return vi.spyOn(Math, 'random').mockReturnValue(value);
}
const NAT_1 = 0;
const NAT_2 = 0.05;
const NAT_11 = 0.5;
const NAT_20 = 0.999;

/** Step until a hero is held for orders (or the fight ends). */
function stepToPause(engine: CombatEngine, max = 40): GameCharacter | null {
  let n = 0;
  while (!engine.decisionActor && engine.isActive && n < max) {
    engine.step();
    n++;
  }
  return engine.decisionActor;
}

/** Every attack roll this named combatant has published to the dice bus. */
function attackRollsBy(name: string) {
  return getDiceHistory().filter(e => e.kind === 'attack' && e.label.startsWith(name));
}

function messages(engine: CombatEngine): string {
  return engine.log.messages.join('\n');
}

/** Take a hero all the way to dead: down them, then three death-save failures. */
function killOutright(hero: GameCharacter): void {
  hero.takeDamage(hero.hp + 1);
  while (!hero.isDead) hero.takeDamage(1, { crit: true }); // a crit on the fallen = 2 failures
}

beforeEach(() => {
  resetDiceEvents();
  grantLuckDie(null);
  onLuckDieSpent(() => {});
});

// ── Initiative ───────────────────────────────────────────────────────────

describe('CombatEngine initiative', () => {
  it('rolls every living hero and monster into the turn order', () => {
    const party = makeParty(['fighter', 'cleric']);
    const engine = new CombatEngine(party);
    const foes = [monsterAt('goblin', 'm1'), monsterAt('goblin', 'm2', 6, 5)];

    engine.startCombat(foes);

    expect(engine.initiativeOrder).toHaveLength(4);
    expect(new Set(engine.initiativeOrder).size, 'nobody appears twice').toBe(4);
    for (const entity of [...party.members, ...foes]) {
      expect(engine.initiativeOrder).toContain(entity);
    }
    expect(messages(engine)).toContain('Combat begins');
  });

  it('drops the dead and the fled out of the turn order', () => {
    const party = makeParty(['fighter', 'fighter', 'fighter']);
    const engine = new CombatEngine(party);
    const stays = monsterAt('goblin', 'm1');
    const runner = monsterAt('goblin', 'm2', 6, 5);
    engine.startCombat([stays, runner]);
    expect(engine.initiativeOrder).toHaveLength(5);

    const fallen = party.members[2];
    killOutright(fallen);
    runner.fled = true;

    fixRandom(NAT_1); // every d20 is a 1, so this step changes nothing else
    engine.step();

    expect(engine.initiativeOrder).not.toContain(fallen);
    expect(engine.initiativeOrder).not.toContain(runner);
    expect(engine.initiativeOrder).toHaveLength(3);
  });

  it('advances the round counter when the turn order wraps around', () => {
    // Five combatants, all rolling natural 1s: nobody lands a blow, nobody
    // dies, so the only thing the steps can do is walk the turn order.
    const party = makeParty(['fighter', 'fighter']);
    const engine = new CombatEngine(party);
    engine.startCombat([
      monsterAt('goblin', 'm1', 9, 9),
      monsterAt('goblin', 'm2', 10, 9),
      monsterAt('goblin', 'm3', 11, 9),
    ]);
    fixRandom(NAT_1);

    expect(engine.log.round).toBe(0);
    for (let i = 0; i < 5; i++) engine.step();
    expect(engine.log.round, 'still the opening round').toBe(0);

    engine.step(); // the sixth step wraps the five-entity order
    expect(engine.log.round).toBe(1);
  });
});

// ── Attack resolution ────────────────────────────────────────────────────

describe('CombatEngine attack resolution', () => {
  it('turns a natural 20 into a critical hit that can kill outright', () => {
    const party = makeParty(['fighter']);
    const hero = party.members[0];
    const engine = new CombatEngine(party);
    const goblin = monsterAt('goblin', 'm1');
    engine.setDecisionPause(true);
    engine.startCombat([goblin]);

    const rng = fixRandom(NAT_1); // nothing lands while we walk up to the hero's turn
    expect(stepToPause(engine)).toBe(hero);

    rng.mockReturnValue(NAT_20);
    engine.submitCommand({ type: 'attack', targetMonsterId: 'm1' });

    expect(attackRollsBy(hero.name).some(e => e.outcome === 'crit')).toBe(true);
    expect(goblin.isAlive, 'a goblin at 0 HP is no longer alive').toBe(false);
    expect(goblin.hp).toBe(0);
    expect(messages(engine)).toContain('is slain!');
  });

  it('misses on a natural 1 no matter how good the attacker is', () => {
    const party = makeParty(['fighter']);
    const hero = party.members[0];
    const engine = new CombatEngine(party);
    const goblin = monsterAt('goblin', 'm1');
    engine.setDecisionPause(true);
    engine.startCombat([goblin]);

    fixRandom(NAT_1);
    expect(stepToPause(engine)).toBe(hero);
    engine.submitCommand({ type: 'attack', targetMonsterId: 'm1' });

    expect(attackRollsBy(hero.name).some(e => e.outcome === 'fumble')).toBe(true);
    expect(goblin.hp, 'a fumble deals no damage').toBe(goblin.maxHp);
    expect(goblin.isAlive).toBe(true);
  });

  it('subtracts the rolled damage from a target too tough to drop', () => {
    const party = makeParty(['fighter']);
    const hero = party.members[0];
    const engine = new CombatEngine(party);
    const ogre = monsterAt('ogre', 'm1'); // 59 HP — survives anything a level 1 hero throws
    engine.setDecisionPause(true);
    engine.startCombat([ogre]);

    const rng = fixRandom(NAT_1);
    expect(stepToPause(engine)).toBe(hero);

    rng.mockReturnValue(NAT_20);
    engine.submitCommand({ type: 'attack', targetMonsterId: 'm1' });

    // A maximum weapon die plus the hero's damage bonus. (Character.attack only
    // doubles the dice from level 5 up, so a level 1 crit rolls a single die.)
    const expected = hero.getWeaponDamageDie() + hero.damageBonus;
    expect(ogre.hp).toBe(ogre.maxHp - expected);
    expect(ogre.isAlive).toBe(true);
  });
});

// ── Ending the fight ─────────────────────────────────────────────────────

describe('CombatEngine end of combat', () => {
  it('declares the party the winner once every monster is dead', () => {
    const party = makeParty(['fighter', 'cleric']);
    const engine = new CombatEngine(party);
    const goblin = monsterAt('goblin', 'm1');
    engine.startCombat([goblin]);
    fixRandom(NAT_1);

    goblin.takeDamage(99);
    const log = engine.step();

    expect(log.isOver).toBe(true);
    expect(log.winner).toBe('party');
    expect(engine.isActive).toBe(false);
    expect(party.members.every(m => m.xp > 0), 'victory pays XP').toBe(true);
  });

  it('binds the wounds of the fallen when the party wins', () => {
    const party = makeParty(['fighter', 'cleric']);
    const engine = new CombatEngine(party);
    const goblin = monsterAt('goblin', 'm1');
    engine.startCombat([goblin]);
    fixRandom(NAT_1);

    const downed = party.members[1];
    downed.takeDamage(999); // down, not dead
    expect(downed.isConscious).toBe(false);

    goblin.takeDamage(99);
    engine.step();

    expect(engine.log.winner).toBe('party');
    expect(downed.hp).toBeGreaterThanOrEqual(1);
    expect(messages(engine)).toContain('revived at 1 HP');
  });

  it('declares the monsters the winner once nobody in the party is conscious', () => {
    const party = makeParty(['fighter', 'cleric']);
    const engine = new CombatEngine(party);
    engine.startCombat([monsterAt('goblin', 'm1')]);
    fixRandom(NAT_1);

    for (const member of party.members) member.takeDamage(999);

    const log = engine.step();
    expect(log.isOver).toBe(true);
    expect(log.winner).toBe('monsters');
    expect(engine.isActive).toBe(false);
    expect(messages(engine)).toContain('defeated');
  });

  it('counts a fight the foes ran away from as a party victory', () => {
    const party = makeParty(['fighter', 'fighter']);
    const engine = new CombatEngine(party);
    const goblin = monsterAt('goblin', 'm1');
    engine.startCombat([goblin]);
    fixRandom(NAT_1);

    goblin.hp = 1; // badly wounded: morale breaks on its own turn

    let steps = 0;
    while (engine.isActive && steps < 30) {
      engine.step();
      steps++;
    }

    expect(goblin.fled).toBe(true);
    expect(messages(engine)).toContain('breaks and flees');
    expect(engine.log.winner).toBe('party');
    expect(messages(engine)).toContain('fled');
  });
});

// ── Death saves ──────────────────────────────────────────────────────────

/**
 * Death-save fixtures: heroes with an unreachable AC and three goblins.
 * The AC keeps every monster swing off the downed hero (a hit on the fallen is
 * an auto-crit and two extra failures), and three goblins keep the pack's
 * morale steady so the fight lasts long enough for three saves to be rolled.
 */
function dyingHeroFight(): { engine: CombatEngine; standing: GameCharacter; downed: GameCharacter } {
  const party = makeParty(['fighter', 'fighter']);
  for (const member of party.members) member.ac = 30;
  const engine = new CombatEngine(party);
  engine.startCombat([
    monsterAt('goblin', 'm1'),
    monsterAt('goblin', 'm2', 6, 5),
    monsterAt('goblin', 'm3', 7, 5),
  ]);
  const downed = party.members[1];
  downed.takeDamage(downed.hp); // exactly to 0: dying, no failures yet
  return { engine, standing: party.members[0], downed };
}

describe('CombatEngine death saves', () => {
  it('rolls a death save on a dying hero turn instead of letting them act', () => {
    const { engine, downed } = dyingHeroFight();
    fixRandom(NAT_11); // 11 clears DC 10 — a success

    let steps = 0;
    while (downed.deathSaveSuccesses === 0 && steps < 40) {
      engine.step();
      steps++;
    }

    expect(downed.deathSaveSuccesses).toBeGreaterThan(0);
    expect(attackRollsBy(downed.name), 'the dying do not swing').toHaveLength(0);
    expect(messages(engine)).toContain('death saves');
  });

  it('kills a dying hero on the third failed death save', () => {
    const { engine, downed } = dyingHeroFight();
    fixRandom(NAT_2); // a 2 fails, but is not the natural 1 that costs two failures

    let steps = 0;
    while (!downed.isDead && steps < 60) {
      engine.step();
      steps++;
    }

    expect(downed.isDead).toBe(true);
    expect(downed.deathSaveFailures).toBe(3);
    expect(messages(engine)).toContain('3 death-save failures');
    expect(engine.isActive, 'one hero still stands, so the fight goes on').toBe(true);
  });

  it('stabilises a dying hero on the third successful death save, and then leaves them be', () => {
    const { engine, downed } = dyingHeroFight();
    fixRandom(NAT_11);

    let steps = 0;
    while (!downed.stabilized && steps < 60) {
      engine.step();
      steps++;
    }

    expect(downed.stabilized).toBe(true);
    expect(downed.isDead).toBe(false);
    expect(downed.hp).toBe(0);
    expect(messages(engine)).toContain('stabilizes, clinging to life');

    // A stabilised hero stops rolling: their turns pass quietly.
    for (let i = 0; i < 10; i++) engine.step();
    expect(messages(engine)).toContain('lies stabilized and unconscious');
  });
});

// ── Spell slots and upcasting ────────────────────────────────────────────

/** A lone caster, paused for orders, with nothing able to hit them. */
function casterFight(foe: Monster): { engine: CombatEngine; caster: GameCharacter } {
  const party = makeParty(['cleric']);
  const caster = party.members[0];
  caster.ac = 40;
  const engine = new CombatEngine(party);
  engine.setDecisionPause(true);
  engine.startCombat([foe]);
  fixRandom(NAT_1);
  stepToPause(engine);
  return { engine, caster };
}

describe('CombatEngine spell slots', () => {
  it('spends a slot when a caster casts a levelled spell', () => {
    const { engine, caster } = casterFight(monsterAt('goblin', 'm1'));
    engine.party.upcastPolicy = 'never';
    const before = caster.spellSlots[1];

    engine.submitCommand({ type: 'spell', spellId: 'inflict_wounds', targetMonsterId: 'm1' });

    expect(caster.spellSlots[1]).toBe(before - 1);
    expect(messages(engine)).toContain('spends a 1st-level slot on Inflict Wounds');
  });

  it("leaves the big slots alone under the 'never' upcast policy", () => {
    const { engine, caster } = casterFight(monsterAt('goblin', 'm1'));
    caster.level = 5;
    caster.recomputeSpellSlots(); // 4 / 3 / 2
    engine.party.upcastPolicy = 'never';

    engine.submitCommand({ type: 'spell', spellId: 'inflict_wounds', targetMonsterId: 'm1' });

    expect(caster.spellSlots[1]).toBe(3);
    expect(caster.spellSlots[2]).toBe(3);
    expect(caster.spellSlots[3]).toBe(2);
    expect(messages(engine)).not.toContain('upcasts');
  });

  it("burns the highest slot available under the 'always' upcast policy", () => {
    const { engine, caster } = casterFight(monsterAt('goblin', 'm1'));
    caster.level = 5;
    caster.recomputeSpellSlots();
    engine.party.upcastPolicy = 'always';

    engine.submitCommand({ type: 'spell', spellId: 'inflict_wounds', targetMonsterId: 'm1' });

    expect(caster.spellSlots[3]).toBe(1);
    expect(caster.spellSlots[1], 'the base slot is untouched').toBe(4);
    expect(messages(engine)).toContain('upcasts Inflict Wounds into a 3rd-level slot');
  });

  it("upcasts under 'auto' when a tough foe stands over a hurting party", () => {
    const ogre = monsterAt('ogre', 'm1'); // 59 HP clears the 'tough foe' bar
    const { engine, caster } = casterFight(ogre);
    caster.level = 5;
    caster.recomputeSpellSlots();
    engine.party.upcastPolicy = 'auto';
    caster.takeDamage(Math.ceil(caster.maxHp * 0.6)); // the party is below half strength

    engine.submitCommand({ type: 'spell', spellId: 'inflict_wounds', targetMonsterId: 'm1' });

    expect(caster.spellSlots[2], 'one step above the base level').toBe(2);
    expect(caster.spellSlots[1]).toBe(4);
    expect(messages(engine)).toContain('upcasts Inflict Wounds into a 2nd-level slot');
  });

  it("holds the big slots back under 'auto' when the fight does not call for them", () => {
    const { engine, caster } = casterFight(monsterAt('goblin', 'm1')); // 7 HP, party at full
    caster.level = 5;
    caster.recomputeSpellSlots();
    engine.party.upcastPolicy = 'auto';

    engine.submitCommand({ type: 'spell', spellId: 'inflict_wounds', targetMonsterId: 'm1' });

    expect(caster.spellSlots[1]).toBe(3);
    expect(caster.spellSlots[2]).toBe(3);
    expect(caster.spellSlots[3]).toBe(2);
  });

  it('spends exactly one slot on a healing cast when the base slot is empty', () => {
    // The right-sizing block used to spend a slot and then reconsider, calling
    // the spending helper a second time when the base slot was gone. One Cure
    // Wounds cost the caster two slots and announced itself twice.
    const { engine, caster } = casterFight(monsterAt('goblin', 'm1'));
    caster.level = 5;
    caster.recomputeSpellSlots();
    caster.spellSlots[1] = 0; // 1st-level slots already spent this fight
    engine.party.upcastPolicy = 'always';
    caster.takeDamage(Math.max(1, Math.floor(caster.maxHp * 0.15))); // wounded, not critical
    const before = caster.spellSlotsRemaining;

    engine.submitCommand({ type: 'spell', spellId: 'cure_wounds' });

    expect(caster.spellSlotsRemaining, 'one cast, one slot').toBe(before - 1);
    const upcastLines = engine.log.messages.filter(m => m.includes('upcasts Cure Wounds'));
    expect(upcastLines).toHaveLength(1);
  });

  it('heals a dying ally with the dice it paid for', () => {
    // The emergency arm used to re-derive the slot level from the slots left
    // *after* one had already been spent, so it landed on the lowest still in
    // stock: a 3rd-level slot vanished, the log announced the upcast, and the
    // ally was healed for 1d8. The spend and the dice now agree.
    const party = makeParty(['cleric', 'fighter']);
    const caster = party.members[0];
    const ally = party.members[1];
    for (const member of party.members) member.ac = 40;
    // A big HP pool so the heal is not silently capped — that is what makes the
    // difference between 1d8 and 3d8 observable at all.
    ally.baseMaxHp = 100;
    const engine = new CombatEngine(party);
    engine.setDecisionPause(true);
    engine.startCombat([monsterAt('goblin', 'm1')]);

    const rng = fixRandom(NAT_11); // death saves succeed while we reach the caster's turn
    ally.takeDamage(ally.hp); // down and dying before initiative runs on
    expect(stepToPause(engine)).toBe(caster);

    caster.level = 5;
    caster.recomputeSpellSlots();
    engine.party.upcastPolicy = 'always';
    rng.mockReturnValue(NAT_20); // every healing die rolls its maximum

    engine.submitCommand({ type: 'spell', spellId: 'cure_wounds' });

    expect(messages(engine)).toContain('upcasts Cure Wounds into a 3rd-level slot');
    expect(caster.spellSlots[3], 'a 3rd-level slot really was spent').toBe(1);
    // Cure Wounds is 1d8 at base and gains a die per level above it, so a
    // 3rd-level slot with every die maxed is 3d8 + mod.
    expect(ally.hp).toBe(24 + caster.spellcastingMod);
  });
});

// ── Concentration ────────────────────────────────────────────────────────

describe('CombatEngine concentration', () => {
  it('ends a concentrating caster’s Bless when a blow breaks their focus', () => {
    const party = makeParty(['cleric']);
    const caster = party.members[0];
    caster.ac = 5; // low enough that the goblin lands its blows
    const engine = new CombatEngine(party);
    engine.setDecisionPause(true);
    engine.startCombat([monsterAt('goblin', 'm1')]);

    fixRandom(NAT_2); // the hero always misses; the goblin always hits for a few HP
    expect(stepToPause(engine)).toBe(caster);
    engine.submitCommand({ type: 'spell', spellId: 'bless' });

    expect(engine.partyBlessRounds).toBe(3);
    expect(caster.concentration?.spellName).toBe('Bless');

    // Run the fight on until the goblin connects. The concentration save is
    // DC 10 against a d20 of 2 plus a small CON modifier: it cannot hold.
    let steps = 0;
    while (caster.concentration && steps < 20) {
      if (engine.decisionActor) engine.submitCommand({ type: 'attack' });
      else engine.step();
      steps++;
    }

    expect(caster.concentration).toBeUndefined();
    expect(engine.partyBlessRounds, 'the party-wide buff dies with the concentration').toBe(0);
    expect(messages(engine)).toContain('concentration on Bless is broken');
  });
});

// ── Conditions ───────────────────────────────────────────────────────────

describe('CombatEngine conditions', () => {
  it('skips an incapacitated hero’s turn without stopping to ask the DM', () => {
    const party = makeParty(['fighter']);
    const hero = party.members[0];
    const engine = new CombatEngine(party);
    engine.setDecisionPause(true);
    engine.startCombat([monsterAt('goblin', 'm1')]);
    hero.applyCondition('stunned', 8, 'Stunned');

    fixRandom(NAT_1);
    for (let i = 0; i < 6 && engine.isActive; i++) {
      engine.step();
      expect(engine.decisionActor, 'a stunned hero is never held for orders').toBeNull();
    }

    expect(messages(engine)).toContain('cannot act (Stunned)');
    expect(attackRollsBy(hero.name), 'a stunned hero never swings').toHaveLength(0);
  });
});

// ── Morale and reinforcements ────────────────────────────────────────────

describe('CombatEngine morale and reinforcements', () => {
  it('raises the alarm once per fight and rolls the backup into initiative', () => {
    const party = makeParty(['fighter', 'fighter']);
    const engine = new CombatEngine(party);
    const shouter = monsterAt('goblin', 'm1');
    shouter.hp = 3; // bloodied below 60%: worth calling for kin
    shouter.alertLevel = 2;
    const backup = monsterAt('goblin', 'm3', 8, 8);

    let calls = 0;
    engine.onReinforcementsRequested = () => {
      calls++;
      engine.addReinforcements([backup]);
    };
    engine.startCombat([shouter, monsterAt('goblin', 'm2', 6, 5)]);
    fixRandom(NAT_1);

    for (let i = 0; i < 25 && engine.isActive; i++) engine.step();

    expect(calls, 'one shout per fight, however many turns pass').toBe(1);
    expect(engine.reinforcementsRequested).toBe(true);
    expect(engine.monsters).toContain(backup);
    expect(engine.initiativeOrder).toContain(backup);
    expect(backup.alertLevel).toBe(2);
    expect(messages(engine)).toContain('Reinforcements pour in');
  });

  it('stays quiet about motive when a monster simply hits whoever is nearest', () => {
    // The guard compared against 'closest reachable threat' while the targeting
    // brain returns 'the closest reachable threat', so it never matched and the
    // "fixates on" line — meant for genuinely tactical picks — was logged on
    // every single monster turn.
    const party = makeParty(['fighter', 'fighter']);
    const [leader, outrider] = party.members;
    for (const member of party.members) member.ac = 30;
    leader.tile = { x: 0, y: 0 };
    outrider.tile = { x: 20, y: 20 }; // the only hero the goblin can reach
    const engine = new CombatEngine(party);
    engine.startCombat([monsterAt('goblin', 'm1', 20, 21)]);

    fixRandom(NAT_1);
    for (let i = 0; i < 6 && engine.isActive; i++) engine.step();

    const fixation = engine.log.messages.find(m => m.includes('fixates on'));
    expect(fixation, 'a plain nearest-foe swing needs no explanation').toBeUndefined();
  });
});

// ── The fated Luck die ───────────────────────────────────────────────────

describe('CombatEngine and the Luck die', () => {
  it('spends the banked die on the first party roll of the fight — initiative', () => {
    const party = makeParty(['fighter', 'cleric']);
    const first = party.members[0];
    const engine = new CombatEngine(party);
    const spent: string[] = [];
    onLuckDieSpent((die, roller) => spent.push(`${roller}:${die.value}`));
    grantLuckDie({ value: 20, source: 'roll d20' });

    engine.startCombat([monsterAt('goblin', 'm1')]);

    expect(getLuckDie(), 'the die is consumed, not kept').toBeNull();
    expect(spent).toEqual([`${first.name}:20`]);
    expect(messages(engine)).toContain(`${first.name}: Initiative ${20 + first.dexMod}`);
  });

  it('lets a banked 20 decide a hero’s attack in place of the dice', () => {
    const party = makeParty(['fighter']);
    const hero = party.members[0];
    const engine = new CombatEngine(party);
    const goblin = monsterAt('goblin', 'm1');
    engine.setDecisionPause(true);
    engine.startCombat([goblin]);

    fixRandom(NAT_1); // the dice say 1; the fated die must overrule them
    expect(stepToPause(engine)).toBe(hero);
    grantLuckDie({ value: 20, source: 'roll d20' });

    engine.submitCommand({ type: 'attack', targetMonsterId: 'm1' });

    expect(getLuckDie()).toBeNull();
    expect(attackRollsBy(hero.name).some(e => e.outcome === 'crit')).toBe(true);
    expect(goblin.hp).toBeLessThan(goblin.maxHp);
  });
});

// ── Long randomised runs ─────────────────────────────────────────────────

/** A small deterministic PRNG so a failing fuzz run can be replayed by seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Invariants that must hold after every single step of any fight. */
function expectConsistent(engine: CombatEngine, where: string): void {
  const log = engine.log;
  expect(log.isOver, `${where}: isOver must track isActive`).toBe(!engine.isActive);
  if (log.isOver) expect(log.winner, `${where}: a finished fight has a winner`).not.toBeNull();
  else expect(log.winner, `${where}: an unfinished fight has no winner`).toBeNull();
  expect(log.round, `${where}: rounds never go negative`).toBeGreaterThanOrEqual(0);
  for (const m of engine.monsters) {
    expect(m.hp, `${where}: ${m.name} HP`).toBeGreaterThanOrEqual(0);
    expect(m.isAlive, `${where}: ${m.name} alive iff above 0 HP`).toBe(m.hp > 0);
  }
  for (const member of engine.party.members) {
    expect(member.hp, `${where}: ${member.name} HP`).toBeGreaterThanOrEqual(0);
    if (member.hp > 0) expect(member.isDying, `${where}: ${member.name} standing yet dying`).toBe(false);
  }
}

describe('CombatEngine over long randomised runs', () => {
  it('always finishes a mixed fight without throwing or contradicting itself', () => {
    for (const seed of [1, 7, 42, 1234, 20260902]) {
      const party = makeParty(['fighter', 'cleric', 'wizard', 'rogue']);
      const foes = [
        monsterAt('goblin', 'm1', 3, 3),
        monsterAt('orc', 'm2', 4, 3),
        monsterAt('skeleton', 'm3', 2, 4),
      ];
      const engine = new CombatEngine(party);

      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      engine.startCombat(foes);
      let steps = 0;
      while (engine.isActive && steps < 1500) {
        engine.step();
        steps++;
        expectConsistent(engine, `seed ${seed} step ${steps}`);
      }

      expect(engine.isActive, `seed ${seed} never resolved in ${steps} steps`).toBe(false);
      expect(engine.log.isOver).toBe(true);
      expect(engine.log.winner).not.toBeNull();
      vi.restoreAllMocks(); // the next party needs real randomness for unique ids
    }
  });

  it('resolves a legendary boss fight — lair actions and all — without breaking', () => {
    for (const seed of [3, 77, 555]) {
      const party = makeParty(['fighter', 'cleric', 'wizard', 'rogue']);
      const boss = monsterAt('lich', 'boss1', 4, 4);
      const engine = new CombatEngine(party);

      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      engine.startCombat([boss]);
      expect(engine.getBosses(), 'a lich is a legendary foe').toContain(boss);
      expect(messages(engine)).toContain('legendary foe');

      let steps = 0;
      while (engine.isActive && steps < 1500) {
        engine.step();
        steps++;
        expectConsistent(engine, `boss seed ${seed} step ${steps}`);
      }

      expect(engine.isActive, `boss seed ${seed} never resolved`).toBe(false);
      expect(engine.log.winner).not.toBeNull();
      vi.restoreAllMocks();
    }
  });
});

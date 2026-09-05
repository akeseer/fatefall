/**
 * Temporary edges the world hands the combat engine: the war room's +2 to
 * hit, the hearth-blessed delve's extra bite against undead, and the gloom
 * delve's steeper fear saves.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CombatEngine } from '../src/combat/CombatEngine';
import { Party } from '../src/entities/Party';
import { createCharacter } from '../src/game/CharacterFactory';
import { Monster, getMonsterTemplate } from '../src/entities/Monster';
import { resetDiceEvents, getDiceHistory } from '../src/rules/DiceEvents';
import { grantLuckDie, onLuckDieSpent } from '../src/rules/LuckDie';

function makeParty(classes: string[]): Party {
  const party = new Party();
  classes.forEach((id, i) => party.addMember(createCharacter(id, 'human', `Hero${i + 1}`)));
  party.setPosition({ x: 5, y: 5 });
  return party;
}

function monsterAt(templateId: string, id: string, x = 6, y = 5): Monster {
  return new Monster(id, getMonsterTemplate(templateId)!, { x, y });
}

/** Run a fight to its end, on a fixed die so it always finishes. */
function fightToEnd(engine: CombatEngine, max = 400) {
  for (let n = 0; n < max && engine.isActive; n++) engine.step();
  expect(engine.isActive).toBe(false);
}

beforeEach(() => {
  resetDiceEvents();
  grantLuckDie(null);
  onLuckDieSpent(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the war-room edge', () => {
  it('adds its bonus to a hero\'s attack roll while a fight is owed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // natural 11 on every d20
    const party = makeParty(['fighter']);
    const engine = new CombatEngine(party);
    engine.warRoomAttackBonus = 2;
    engine.warRoomFightsLeft = 1;
    engine.startCombat([monsterAt('goblin', 'g1')]);
    while (engine.isActive && !getDiceHistory().some(e => e.kind === 'attack' && e.label.startsWith('Hero1'))) engine.step();
    const swing = getDiceHistory().find(e => e.kind === 'attack' && e.label.startsWith('Hero1'))!;
    expect(swing.total).toBe(11 + party.members[0].attackBonus + 2);
  });

  it('is spent when the battle it was promised for ends', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // every blow lands hard
    const party = makeParty(['fighter', 'fighter']);
    const engine = new CombatEngine(party);
    engine.warRoomAttackBonus = 2;
    engine.warRoomFightsLeft = 1;
    engine.startCombat([monsterAt('goblin', 'g1')]);
    fightToEnd(engine);
    expect(engine.warRoomFightsLeft).toBe(0);
    expect(engine.warRoomAttackBonus).toBe(0);
    expect(engine.log.messages.join('\n')).toContain('tactical edge is spent');
  });
});

describe('the delve moods in a fight', () => {
  it('hearth-blessed: the party\'s hits land two points harder on undead, and only undead', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // max on every die: a hit, and a known damage roll
    const swingAt = (templateId: string, bonus: number) => {
      resetDiceEvents();
      const party = makeParty(['fighter']);
      const engine = new CombatEngine(party);
      engine.hearthBlessedUndeadBonus = bonus;
      const foe = monsterAt(templateId, 'f1');
      foe.maxHp = 500; foe.hp = 500; // survives the swing so the damage is recorded
      engine.startCombat([foe]);
      const before = foe.hp;
      while (engine.isActive && foe.hp === before) engine.step();
      return before - foe.hp;
    };
    const plainSkeleton = swingAt('skeleton', 0);
    expect(swingAt('skeleton', 2)).toBe(plainSkeleton + 2);
    const plainGoblin = swingAt('goblin', 0);
    expect(swingAt('goblin', 2)).toBe(plainGoblin);
  });

  it('gloom: frightful presence asks a point more of the party\'s nerve', () => {
    const party = makeParty(['fighter']);
    const withBonus = new CombatEngine(party);
    withBonus.gloomFearDcBonus = 1;
    withBonus.startCombat([monsterAt('banshee', 'b1')]);
    const line = withBonus.log.messages.find(m => m.includes('Frightful Presence'))!;
    const plain = new CombatEngine(makeParty(['fighter']));
    plain.startCombat([monsterAt('banshee', 'b2')]);
    const plainLine = plain.log.messages.find(m => m.includes('Frightful Presence'))!;
    const dc = (s: string) => Number(/DC (\d+)/.exec(s)![1]);
    expect(dc(line)).toBe(dc(plainLine) + 1);
  });
});

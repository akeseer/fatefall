import { describe, it, expect, beforeEach } from 'vitest';
import { CombatEngine } from '../src/combat/CombatEngine';
import { Party } from '../src/entities/Party';
import { createCharacter } from '../src/game/CharacterFactory';
import { Monster, getMonsterTemplate } from '../src/entities/Monster';
import { resetDiceEvents } from '../src/rules/DiceEvents';
import { grantLuckDie } from '../src/rules/LuckDie';

function fight(): CombatEngine {
  const party = new Party();
  party.addMember(createCharacter('fighter', 'human', 'Kael'));
  party.addMember(createCharacter('cleric', 'dwarf', 'Mira'));
  const goblin = new Monster('m1', getMonsterTemplate('goblin')!, { x: 5, y: 5 });
  const engine = new CombatEngine(party);
  engine.startCombat([goblin]);
  return engine;
}

/** Run the fight forward, stopping early if it stalls or ends. */
function stepUntilIdle(engine: CombatEngine, max = 200): number {
  let steps = 0;
  while (steps < max && engine.isActive && !engine.decisionActor) {
    engine.step();
    steps++;
  }
  return steps;
}

describe('combat decision pause', () => {
  beforeEach(() => {
    resetDiceEvents();
    grantLuckDie(null);
  });

  it('holds a hero for orders in manual mode', () => {
    const engine = fight();
    engine.setDecisionPause(true);
    stepUntilIdle(engine);
    expect(engine.decisionActor, 'manual mode should pause on a hero').not.toBeNull();
  });

  it('releases the held hero when the mode switches to auto', () => {
    const engine = fight();
    engine.setDecisionPause(true);
    stepUntilIdle(engine);
    expect(engine.decisionActor).not.toBeNull();

    // Switching the battle window to Auto used to change only the button: the
    // engine stayed paused on a hero nobody would ever give an order to, and
    // the fight never advanced again.
    engine.setDecisionPause(false);
    expect(engine.decisionActor, 'auto mode must release the held hero').toBeNull();
    expect(engine.decisionPause).toBe(false);
  });

  it('resolves the whole fight once released, rather than stalling', () => {
    const engine = fight();
    engine.setDecisionPause(true);
    stepUntilIdle(engine);
    engine.setDecisionPause(false);

    let steps = 0;
    while (engine.isActive && steps < 500) {
      engine.step();
      steps++;
      // A pause that is off must never re-hold a hero.
      expect(engine.decisionActor, `re-paused at step ${steps}`).toBeNull();
    }
    expect(engine.isActive, 'the fight should have finished').toBe(false);
    expect(engine.log.winner).not.toBeNull();
  });

  it('drops queued orders when handing the fight to the AI', () => {
    const engine = fight();
    engine.setDecisionPause(true);
    engine.queuedOrders.set('someone', { type: 'attack' });
    engine.setDecisionPause(false);
    expect(engine.queuedOrders.size).toBe(0);
  });

  it('never pauses at all in auto mode', () => {
    const engine = fight();
    engine.setDecisionPause(false);
    for (let i = 0; i < 60 && engine.isActive; i++) {
      engine.step();
      expect(engine.decisionActor).toBeNull();
    }
  });
});

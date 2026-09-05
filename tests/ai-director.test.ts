/**
 * The tactical planner's out-of-combat decisions: how the party rescues a
 * dying ally, and how its exploration choices reach the game intact.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIDirector, planDyingRescue } from '../src/ai/AIDirector';
import { Party } from '../src/entities/Party';
import { createCharacter } from '../src/game/CharacterFactory';
import { TileMap, TileType } from '../src/world/TileMap';
import type { Room } from '../src/world/DungeonGenerator';
import { resetDiceEvents } from '../src/rules/DiceEvents';
import { grantLuckDie } from '../src/rules/LuckDie';

function makeParty(classes: string[]): Party {
  const party = new Party();
  classes.forEach((id, i) => party.addMember(createCharacter(id, 'human', `Hero${i + 1}`)));
  return party;
}

/** Drop a member to 0 HP without killing them: dying, rolling death saves. */
function down(party: Party, index: number) {
  const m = party.members[index];
  m.takeDamage(m.hp);
  expect(m.isDying).toBe(true);
}

/** A map that is floor over the given rectangle and wall everywhere else. */
function floorMap(w: number, h: number, floor: { x: number; y: number; w: number; h: number }): TileMap {
  const map = new TileMap(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) map.setTile(x, y, TileType.Wall);
  for (let y = floor.y; y < floor.y + floor.h; y++) {
    for (let x = floor.x; x < floor.x + floor.w; x++) map.setTile(x, y, TileType.Floor);
  }
  return map;
}

const room = (cx: number, cy: number): Room => ({ x: cx - 1, y: cy - 1, width: 3, height: 3, cx, cy });

beforeEach(() => {
  resetDiceEvents();
  grantLuckDie(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('planDyingRescue', () => {
  it('finds nothing to do while everyone is on their feet', () => {
    expect(planDyingRescue(makeParty(['cleric', 'fighter']))).toBeNull();
  });

  it('prefers a healing spell from a conscious caster with a slot to spend', () => {
    const party = makeParty(['cleric', 'fighter']);
    down(party, 1);
    const plan = planDyingRescue(party);
    expect(plan?.kind).toBe('spell');
    if (plan?.kind !== 'spell') return;
    expect(plan.healer).toBe(party.members[0]);
    expect(plan.target).toBe(party.members[1]);
    expect(plan.spell.healing).toBeTruthy();
    expect(plan.spell.level).toBe(1);
  });

  it('falls back to the weakest healing potion anyone conscious carries', () => {
    const party = makeParty(['cleric', 'fighter']);
    const [cleric, fighter] = party.members;
    cleric.spellSlots = {}; // every slot spent
    fighter.inventory.push({ id: 'potion_greater_healing', name: 'Potion of Greater Healing', type: 'potion', description: '', value: 150 });
    down(party, 1); // the fighter is dying and cannot drink; the cleric pours
    fighter.inventory.length = 0;
    cleric.inventory.push(
      { id: 'potion_superior_healing', name: 'Potion of Superior Healing', type: 'potion', description: '', value: 450 },
      { id: 'potion_healing', name: 'Potion of Healing', type: 'potion', description: '', value: 50 },
    );
    const plan = planDyingRescue(party);
    expect(plan).toEqual({ kind: 'potion', holder: cleric, itemId: 'potion_healing', target: fighter });
  });

  it('ignores the dying member\'s own potions and spells — they cannot act', () => {
    const party = makeParty(['fighter', 'cleric']);
    down(party, 1); // the only caster is the one on the floor
    party.members[1].inventory.push({ id: 'potion_healing', name: 'Potion of Healing', type: 'potion', description: '', value: 50 });
    expect(planDyingRescue(party)).toBeNull();
  });
});

describe('AIDirector.decideAction with a dying ally', () => {
  const map = floorMap(12, 12, { x: 1, y: 1, w: 10, h: 10 });

  it('calls for healing only when someone can actually deliver it', () => {
    const party = makeParty(['cleric', 'fighter']);
    party.setPosition({ x: 5, y: 5 });
    down(party, 1);
    const director = new AIDirector(party);
    expect(director.decideAction(map, [], [], [], [], []).type).toBe('heal');
  });

  it('regroups instead when the healer has nothing left to cast', () => {
    const party = makeParty(['cleric', 'fighter']);
    party.setPosition({ x: 5, y: 5 });
    party.members[0].spellSlots = {};
    down(party, 1);
    const director = new AIDirector(party);
    expect(director.decideAction(map, [], [], [], [], []).type).toBe('regroup');
  });
});

describe('AIDirector.decideAction exploring', () => {
  it('marks a march toward a real destination as pathing', () => {
    // A long corridor with an unexplored room at the far end: the planner
    // walks the BFS path, and the flag must survive into the action or the
    // game's loop detector will second-guess every step.
    const map = floorMap(30, 5, { x: 1, y: 2, w: 28, h: 1 });
    map.reveal(2, 2, 3);
    const party = makeParty(['fighter', 'rogue']);
    party.setPosition({ x: 2, y: 2 });
    const director = new AIDirector(party);
    const action = director.decideAction(map, [], [], [], [], [room(27, 2)]);
    expect(action.type).toBe('explore');
    if (action.type !== 'explore') return;
    expect(action.pathing).toBe(true);
    expect(action.direction).toBe('right');
  });

  it('idles when boxed in with no walkable neighbour, leaving the step to the game\'s router', () => {
    const map = floorMap(7, 7, { x: 3, y: 3, w: 1, h: 1 });
    const party = makeParty(['fighter', 'rogue']);
    party.setPosition({ x: 3, y: 3 });
    const director = new AIDirector(party);
    const action = director.decideAction(map, [], [], [], [], []);
    expect(action.type).toBe('idle');
  });
});

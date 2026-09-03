/**
 * The other half of the DM order pipeline.
 *
 * `tests/dm-parser.test.ts` covers which order a sentence *is*; this covers
 * what the party then does about it. Every case drives the dispatcher through
 * a fake host, so the assertions are on the lines the party says back and on
 * the state the order leaves behind — the two things an order actually is.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DMCommandDispatcher, type DMCommandHost } from '../src/game/DMCommandDispatcher';
import { createCharacter } from '../src/game/CharacterFactory';
import { Party } from '../src/entities/Party';
import { TileMap } from '../src/world/TileMap';
import { initTownLife } from '../src/world/TownLife';
import { createClock, timeOfDayFromPhase } from '../src/world/DayNightSystem';
import { calendarFromElapsed } from '../src/world/CalendarSystem';
import { resetDiceEvents } from '../src/rules/DiceEvents';
import { grantLuckDie } from '../src/rules/LuckDie';
import type { GameCharacter, InventoryItem } from '../src/entities/Character';
import type { HUD } from '../src/ui/HUD';
import type { Monster, MonsterTemplate } from '../src/entities/Monster';
import type { Room } from '../src/world/DungeonGenerator';
import type { PlacedTrap } from '../src/traps/Traps';
import type { Overworld, OverworldEntrance, OverworldTown } from '../src/world/Overworld';
import type { TownLifeState } from '../src/world/TownLife';
import type { BanditCampState } from '../src/quests/BanditCamps';
import type { Quest } from '../src/quests/Quests';
import type { QuestGiver } from '../src/quests/QuestGivers';
import type { BulletinTask } from '../src/quests/BulletinBoard';
import type { WeatherState } from '../src/world/WeatherSystem';
import type { CalendarDay } from '../src/world/CalendarSystem';
import type { ClockState, TimeOfDay } from '../src/world/DayNightSystem';
import type { PartyHistory } from '../src/ai/LoreGenerator';
import type { DMIntent } from '../src/ai/DMCommand';
import { Direction } from '../src/engine/types';

const EMBERWATCH: OverworldTown = {
  id: 'town_1', name: 'Emberwatch', tile: { x: 10, y: 10 }, radius: 3, population: 400,
  description: '', archetypeId: 'port_town', buildingIds: [],
};
const DUSKHOLLOW: OverworldTown = {
  id: 'town_2', name: 'Duskhollow', tile: { x: 40, y: 12 }, radius: 3, population: 250,
  description: '', archetypeId: 'port_town', buildingIds: [],
};
const BARROW: OverworldEntrance = {
  id: 'ent_1', name: 'The Sunken Barrow', tile: { x: 22, y: 30 },
} as OverworldEntrance;

const world = (): Overworld => ({
  map: new TileMap(), towns: [EMBERWATCH, DUSKHOLLOW], entrances: [BARROW],
  spawnTownId: 'town_1', pois: [], regions: [],
});

const task = (over: Partial<BulletinTask> = {}): BulletinTask => ({
  id: 't1', kind: 'slay', title: 'Thin the wolves', detail: 'Wolves at the mill.',
  targetKind: 'wolf', targetCount: 3, progress: 0,
  rewardGold: 40, rewardXp: 60, repReward: 2, accepted: false, completed: false, ...over,
});

const npc = (name: string): QuestGiver => ({
  id: 'npc_' + name, name, title: 'Quartermaster', portrait: '🧔', portraitColor: '#ca8',
  backstory: '', dialogue: {} as QuestGiver['dialogue'], specialty: 'trade',
  repPerQuest: 2, reputation: 0,
} as QuestGiver);

/**
 * A host that records everything instead of doing it. Delegating arms are
 * spies, so a test can assert the order reached the right slice of the game
 * without dragging that slice in.
 */
class FakeHost implements DMCommandHost {
  readonly lines: { text: string; color?: string }[] = [];

  // Where the party is
  inOverworld = false;
  inTown = false;
  inDungeon = true;
  inBattle = false;
  dungeonName = 'The Sunken Barrow';
  dungeonLevel = 3;
  currentTown: OverworldTown | null = null;
  overworld: Overworld | null = world();
  townLife: TownLifeState | null = initTownLife(world());
  room: Room | undefined = undefined;
  currentRoom(): Room | undefined { return this.room; }
  describeCurrentRoom(): string { return 'A low vaulted room, dripping.'; }
  describeOverworldHere(): string { return 'Open moorland under a wide sky.'; }

  // The party
  readonly party = new Party();
  history: PartyHistory = { kills: 0, victories: 0, defeats: 0, roomsVisited: 0, deepestLevel: 1, killLedger: {} };
  readonly hud = {
    addCombatMessage: (text: string, color?: string) => { this.lines.push({ text, color }); },
    setParty: () => {},
    setDungeonTitle: (t: string) => { this.title = t; },
    townPanel: { show: () => { this.townPanelShown = true; }, refresh: () => {} },
  } as unknown as HUD;
  title = '';
  townPanelShown = false;
  bestScout(): GameCharacter { return this.party.members[1] ?? this.party.leader; }
  findItemOwner(nameQuery: string): GameCharacter | null {
    return this.party.members.find(m => m.inventory.some(i => i.name.toLowerCase().includes(nameQuery))) ?? null;
  }

  // The world
  monsters: Monster[] = [];
  traps: PlacedTrap[] = [];
  banditCamps: BanditCampState = { camps: [], clues: [] };
  weather: WeatherState | null = null;
  calendar: CalendarDay = calendarFromElapsed(0);
  calendarDesc(): string { return 'Sunday, new moon'; }
  clock: ClockState = createClock();
  lastClockStage: TimeOfDay = 'dawn';

  silveredWeapon = false;
  moonForgeLevel = 0;
  moonForgeBlade = false;

  dmStance: 'auto' | 'aggressive' | 'cautious' = 'auto';
  dmDirection: Direction | undefined = undefined;
  activeSlot = 0;

  // Work in hand
  quests: Quest[] = [];
  active: Quest | undefined = undefined;
  activeQuest(): Quest | undefined { return this.active; }
  acceptQuest = vi.fn();
  reportQuest = vi.fn();
  listQuests = vi.fn();
  board: BulletinTask[] = [];
  boardForTown = vi.fn((_townId: string) => this.board);
  acceptBulletinTask = vi.fn();
  listBulletinTasks = vi.fn();

  // Market
  shelf: InventoryItem[] = [];
  packs: InventoryItem[] = [];
  marketStock = vi.fn(() => this.shelf);
  partyInventory = vi.fn(() => this.packs);
  buyItem = vi.fn();
  sellItem = vi.fn();

  // Orders whose body lives elsewhere
  featureHandled = true;
  performFeatureIntent = vi.fn((_i: DMIntent) => this.featureHandled);
  trapInReach = true;
  checkTrapDisarm = vi.fn((_d?: number) => this.trapInReach);
  rollDiceForParty = vi.fn();
  handleLootedItemUse = vi.fn();
  journalCodex = vi.fn();
  handleModelToggle = vi.fn();
  greetQuestGiver = vi.fn();
  spawnEncounter = vi.fn((_t: MonsterTemplate[]) => {});
  proclaim = vi.fn();

  // Effects
  isPaused = false;
  togglePause = vi.fn(() => { this.isPaused = !this.isPaused; });
  saveGame = vi.fn((_silent?: boolean) => true);
  startFreshRun = vi.fn();
  isDescending = false;
  beginDescent = vi.fn(() => { this.isDescending = true; });
  departTown = vi.fn();
  travelTo = vi.fn();
  enterDungeonFromEntrance = vi.fn();
  exitDungeonToOverworld = vi.fn();

  constructor() {
    this.party.members = [
      createCharacter('fighter', 'human', 'Kael'),
      createCharacter('rogue', 'halfling', 'Wren'),
    ];
    for (const m of this.party.members) { m.gold = 0; m.inventory = []; }
    this.party.setPosition({ x: 5, y: 5 });
  }

  /** Every line the party said, joined — handy for a loose "did it mention…". */
  get transcript(): string { return this.lines.map(l => l.text).join('\n'); }
  said(fragment: string): boolean { return this.transcript.includes(fragment); }
  colorOf(fragment: string): string | undefined {
    return this.lines.find(l => l.text.includes(fragment))?.color;
  }
}

let host: FakeHost;
let dm: DMCommandDispatcher;

beforeEach(() => {
  resetDiceEvents();
  grantLuckDie(null);
  host = new FakeHost();
  dm = new DMCommandDispatcher(host);
});

describe('meta orders', () => {
  it('help lists every documented order', () => {
    dm.dispatch({ intent: 'help' }, 'help');
    expect(host.lines.length).toBeGreaterThan(20);
    expect(host.said('descend / deeper')).toBe(true);
    expect(host.said('model on / off / status')).toBe(true);
    expect(host.lines.every(l => l.color === '#8a8')).toBe(true);
  });

  it('pause holds the world, and only once', () => {
    dm.dispatch({ intent: 'pause' }, 'pause');
    expect(host.togglePause).toHaveBeenCalledTimes(1);
    expect(host.said('Time holds its breath.')).toBe(true);

    dm.dispatch({ intent: 'pause' }, 'pause');
    expect(host.togglePause).toHaveBeenCalledTimes(1);
  });

  it('resume rescinds the standing orders as well as the pause', () => {
    host.isPaused = true;
    host.dmStance = 'aggressive';
    host.dmDirection = Direction.Up;
    dm.dispatch({ intent: 'resume' }, 'as you were');
    expect(host.dmStance).toBe('auto');
    expect(host.dmDirection).toBeUndefined();
    expect(host.togglePause).toHaveBeenCalledTimes(1);
  });

  it('"save to slot 2" moves the active slot before saving', () => {
    dm.dispatch({ intent: 'save', slot: 2 }, 'save to slot 2');
    expect(host.activeSlot).toBe(1);
    expect(host.said('future saves go to slot 2')).toBe(true);
    expect(host.saveGame).toHaveBeenCalledWith(false);
  });

  it('a bare save leaves the slot alone', () => {
    host.activeSlot = 2;
    dm.dispatch({ intent: 'save' }, 'save');
    expect(host.activeSlot).toBe(2);
    expect(host.said('future saves go to slot')).toBe(false);
    expect(host.saveGame).toHaveBeenCalledWith(false);
  });

  it('model toggling is handed straight to the understander', () => {
    dm.dispatch({ intent: 'model_toggle', state: 'status' }, 'model status');
    expect(host.handleModelToggle).toHaveBeenCalledWith('status');
  });
});

describe('renaming', () => {
  it('renames the party and retitles the window with where they stand', () => {
    dm.dispatch({ intent: 'rename_party', name: 'The Ninefold Lantern' }, 'rename party ...');
    expect(host.party.partyName).toBe('The Ninefold Lantern');
    expect(host.title).toBe('The Ninefold Lantern — The Sunken Barrow');
  });

  it('titles a surface rename with the town, not the dungeon', () => {
    host.inDungeon = false;
    host.inTown = true;
    host.currentTown = EMBERWATCH;
    dm.dispatch({ intent: 'rename_party', name: 'The Sable Hand' }, 'rename party ...');
    expect(host.title).toBe('The Sable Hand — Emberwatch');
  });

  it('renames a member, stripping punctuation out of the new name', () => {
    dm.dispatch({ intent: 'rename_member', oldName: 'Kael', newName: 'Ka<el> the!! Bold' }, 'rename ...');
    expect(host.party.members[0].name).toBe('Kael the Bold');
    expect(host.said('Kael is now known as')).toBe(true);
  });

  it('refuses a name that cleans away to nothing, and an unknown member', () => {
    dm.dispatch({ intent: 'rename_member', oldName: 'Kael', newName: '!!!' }, 'rename ...');
    expect(host.party.members[0].name).toBe('Kael');
    expect(host.said('is not valid')).toBe(true);

    dm.dispatch({ intent: 'rename_member', oldName: 'Nobody', newName: 'Grom' }, 'rename ...');
    expect(host.said('No party member named')).toBe(true);
  });
});

describe('orders refused while blades are out', () => {
  const refusals: [DMIntent, string][] = [
    ['move', 'They cannot reposition mid-melee!'],
    ['descend', 'Not with swords still drawn!'],
    ['wait_until', 'Not while blades are drawn!'],
    ['long_rest', 'Not mid-melee!'],
    ['short_rest', 'No rest mid-fight — win first!'],
    ['search_traps', 'Not mid-melee!'],
    ['disarm_trap', 'Not mid-melee!'],
    ['raid_camp', 'Not mid-melee!'],
  ];

  it.each(refusals)('%s is refused', (intent, line) => {
    host.inBattle = true;
    dm.dispatch({ intent, direction: Direction.Up, time: 'dawn' } as never, intent);
    expect(host.said(line)).toBe(true);
    expect(host.colorOf(line)).toBe('#c66');
  });

  it('a room feature is refused too, as confused glances', () => {
    host.inBattle = true;
    dm.dispatch({ intent: 'feature_altar' }, 'pray at the altar');
    expect(host.performFeatureIntent).not.toHaveBeenCalled();
    expect(host.said('confused glances')).toBe(true);
  });

  it('but using a looted item still works mid-fight', () => {
    host.inBattle = true;
    dm.dispatch({ intent: 'use_item', arg: 'healing' }, 'drink a healing potion');
    expect(host.handleLootedItemUse).toHaveBeenCalledWith('healing');
  });
});

describe('marching and descending', () => {
  it('a march order names the compass direction and clears the stance', () => {
    host.dmStance = 'cautious';
    dm.dispatch({ intent: 'move', direction: Direction.Left }, 'go west');
    expect(host.dmDirection).toBe(Direction.Left);
    expect(host.dmStance).toBe('auto');
    expect(host.said('the party sets off west')).toBe(true);
  });

  it('descend needs stairs, and there are none on the surface', () => {
    host.inDungeon = false;
    host.inOverworld = true;
    dm.dispatch({ intent: 'descend' }, 'descend');
    expect(host.said('There are no stairs here')).toBe(true);
    expect(host.beginDescent).not.toHaveBeenCalled();
  });

  it('descend queues one descent and ignores a second order', () => {
    dm.dispatch({ intent: 'descend' }, 'descend');
    expect(host.beginDescent).toHaveBeenCalledTimes(1);

    dm.dispatch({ intent: 'descend' }, 'deeper');
    expect(host.beginDescent).toHaveBeenCalledTimes(1);
    expect(host.said('already on its way down')).toBe(true);
  });

  it('leave_dungeon climbs out from below and says so elsewhere', () => {
    dm.dispatch({ intent: 'leave_dungeon' }, 'leave');
    expect(host.exitDungeonToOverworld).toHaveBeenCalled();

    host.inDungeon = false; host.inTown = true;
    dm.dispatch({ intent: 'leave_dungeon' }, 'leave');
    expect(host.said('try "depart" to leave')).toBe(true);
  });

  it('enter_dungeon only works standing on a mouth', () => {
    host.inDungeon = false;
    host.inOverworld = true;
    host.party.setPosition({ x: 1, y: 1 });
    dm.dispatch({ intent: 'enter_dungeon' }, 'enter');
    expect(host.enterDungeonFromEntrance).not.toHaveBeenCalled();
    expect(host.said('There is no dungeon entrance here.')).toBe(true);

    host.party.setPosition(BARROW.tile);
    dm.dispatch({ intent: 'enter_dungeon' }, 'enter');
    expect(host.enterDungeonFromEntrance).toHaveBeenCalledWith(BARROW);
  });
});

describe('travel orders', () => {
  beforeEach(() => { host.inDungeon = false; host.inOverworld = true; });

  it('sets course for a town by partial name', () => {
    dm.dispatch({ intent: 'travel_to', destination: 'dusk' }, 'travel to duskhollow');
    expect(host.travelTo).toHaveBeenCalledWith('town', 'town_2');
    expect(host.said('sets course for Duskhollow')).toBe(true);
  });

  it('falls through to dungeon mouths, then to a shrug', () => {
    dm.dispatch({ intent: 'travel_to', destination: 'barrow' }, 'travel to the barrow');
    expect(host.travelTo).toHaveBeenCalledWith('entrance', 'ent_1');

    dm.dispatch({ intent: 'travel_to', destination: 'atlantis' }, 'travel to atlantis');
    expect(host.said('No town or dungeon named "atlantis" on the maps.')).toBe(true);
  });

  it('makes no sense underground', () => {
    host.inOverworld = false; host.inDungeon = true;
    dm.dispatch({ intent: 'travel_to', destination: 'duskhollow' }, 'travel to duskhollow');
    expect(host.travelTo).not.toHaveBeenCalled();
    expect(host.said('Travel orders only make sense on the surface.')).toBe(true);
  });

  it('go_to_town heads for the last town, or the spawn town', () => {
    dm.dispatch({ intent: 'go_to_town' }, 'go to town');
    expect(host.travelTo).toHaveBeenCalledWith('town', 'town_1');

    host.currentTown = DUSKHOLLOW;
    dm.dispatch({ intent: 'go_to_town' }, 'go to town');
    expect(host.travelTo).toHaveBeenLastCalledWith('town', 'town_2');
  });

  it('go_to_town from underground sends them up first', () => {
    host.inOverworld = false; host.inDungeon = true;
    dm.dispatch({ intent: 'go_to_town' }, 'go to town');
    expect(host.said('climb out first')).toBe(true);
  });
});

describe('waiting out the hours', () => {
  it('turns the sky forward to the wanted stage', () => {
    host.clock = { ...createClock(), phase: 0.2, elapsed: 1000, timeOfDay: timeOfDayFromPhase(0.2), light: 1 };
    dm.dispatch({ intent: 'wait_until', time: 'night' }, 'wait until night');
    expect(host.clock.phase).toBeCloseTo(0.75, 6);
    expect(host.clock.timeOfDay).toBe(timeOfDayFromPhase(0.75));
    expect(host.lastClockStage).toBe(host.clock.timeOfDay);
    expect(host.said('settles in to wait out the hours')).toBe(true);
  });

  it('wraps past midnight rather than running the clock backwards', () => {
    host.clock = { ...createClock(), phase: 0.9, elapsed: 0, timeOfDay: timeOfDayFromPhase(0.9), light: 0 };
    dm.dispatch({ intent: 'wait_until', time: 'dusk' }, 'wait until dusk');
    expect(host.clock.phase).toBeCloseTo(0.5, 6);
    expect(host.clock.elapsed).toBeCloseTo(0.6 * 180_000, 3);
  });

  it('waiting for the stage you are already in costs a whole day', () => {
    host.clock = { ...createClock(), phase: 0.75, elapsed: 0, timeOfDay: timeOfDayFromPhase(0.75), light: 0 };
    dm.dispatch({ intent: 'wait_until', time: 'night' }, 'wait until night');
    expect(host.clock.phase).toBeCloseTo(0.75, 6);
    expect(host.clock.elapsed).toBeCloseTo(180_000, 3);
  });
});

describe('board work and quests', () => {
  it('accept task 2 means the second notice on the board', () => {
    host.inDungeon = false; host.inTown = true;
    host.currentTown = EMBERWATCH;
    const second = task({ id: 't2', title: 'Walk the miller home', kind: 'escort' });
    host.board = [task(), second];
    dm.dispatch({ intent: 'accept_task', index: 2 }, 'accept task 2');
    expect(host.boardForTown).toHaveBeenCalledWith('town_1');
    expect(host.acceptBulletinTask).toHaveBeenCalledWith(second);
  });

  it('a bare "accept task" takes the first', () => {
    host.inDungeon = false; host.inTown = true;
    host.currentTown = EMBERWATCH;
    const first = task();
    host.board = [first, task({ id: 't2' })];
    dm.dispatch({ intent: 'accept_task' }, 'accept the task');
    expect(host.acceptBulletinTask).toHaveBeenCalledWith(first);
  });

  it('board work is taken on in town, and settled work is not re-taken', () => {
    dm.dispatch({ intent: 'accept_task', index: 1 }, 'accept task 1');
    expect(host.said('Board work is taken on in town.')).toBe(true);

    host.inDungeon = false; host.inTown = true; host.currentTown = EMBERWATCH;
    host.board = [task({ completed: true })];
    dm.dispatch({ intent: 'accept_task', index: 1 }, 'accept task 1');
    expect(host.said('is already settled up')).toBe(true);
    expect(host.acceptBulletinTask).not.toHaveBeenCalled();
  });

  it('only one quest at a time', () => {
    host.active = { id: 'q1' } as Quest;
    dm.dispatch({ intent: 'accept_quest', index: 1 }, 'accept quest');
    expect(host.acceptQuest).not.toHaveBeenCalled();
    expect(host.said('A quest is already accepted')).toBe(true);
  });

  it('accept_quest numbers only the untaken quests', () => {
    const taken = { id: 'q0', accepted: true, turnedIn: false } as Quest;
    const open = { id: 'q1', accepted: false, turnedIn: false } as Quest;
    host.quests = [taken, open];
    dm.dispatch({ intent: 'accept_quest', index: 1 }, 'accept quest');
    expect(host.acceptQuest).toHaveBeenCalledWith(open);
  });

  it('a quest is reported in town, once its objective is met', () => {
    host.active = { id: 'q1', completed: false } as Quest;
    dm.dispatch({ intent: 'turn_in_quest' }, 'turn in');
    expect(host.said('finish the objective first')).toBe(true);

    host.active = { id: 'q1', completed: true } as Quest;
    dm.dispatch({ intent: 'turn_in_quest' }, 'turn in');
    expect(host.reportQuest).not.toHaveBeenCalled();
    expect(host.said('claimed in town')).toBe(true);

    host.inDungeon = false; host.inTown = true;
    dm.dispatch({ intent: 'turn_in_quest' }, 'turn in');
    expect(host.reportQuest).toHaveBeenCalledWith(host.active);
  });
});

describe('the market', () => {
  const potion: InventoryItem = { id: 'p1', name: 'Potion of Healing', type: 'potion', description: '', value: 50 };

  beforeEach(() => { host.inDungeon = false; host.inTown = true; host.currentTown = EMBERWATCH; });

  it('shop opens the panel and buys nothing', () => {
    dm.dispatch({ intent: 'shop' }, 'shop');
    expect(host.townPanelShown).toBe(true);
    expect(host.buyItem).not.toHaveBeenCalled();
  });

  it('buy searches the shelves, sell searches the packs', () => {
    host.shelf = [potion];
    host.packs = [];
    dm.dispatch({ intent: 'buy', item: 'Potion of Healing' }, 'buy a potion of healing');
    expect(host.buyItem).toHaveBeenCalledWith(potion);

    // The same name on the shelf must not make a sale the party can't back.
    dm.dispatch({ intent: 'sell', item: 'Potion of Healing' }, 'sell a potion of healing');
    expect(host.sellItem).not.toHaveBeenCalled();
    expect(host.said('No item matching "potion of healing".')).toBe(true);
  });

  it('there is no market outside town', () => {
    host.inTown = false; host.inDungeon = true;
    dm.dispatch({ intent: 'buy', item: 'rope' }, 'buy rope');
    expect(host.townPanelShown).toBe(false);
    expect(host.said('the market is in town')).toBe(true);
  });
});

describe('bandit camps', () => {
  const clue = (over = {}) => ({
    id: 'c1', campId: 'camp1', sourceName: 'Rask', reportReward: 90,
    tier: 2 as const, description: 'A scrawled map.', resolved: false, ...over,
  });

  beforeEach(() => { host.inDungeon = false; host.inOverworld = true; });

  it('a raid spawns a warband scaled to the tier and spends the clue', () => {
    const c = clue();
    host.banditCamps.clues = [c];
    dm.dispatch({ intent: 'raid_camp' }, 'raid the camp');
    expect(host.spawnEncounter).toHaveBeenCalledTimes(1);
    // 2 + tier rank and file, plus a highwayman at tier 2.
    expect(host.spawnEncounter.mock.calls[0][0]).toHaveLength(5);
    expect(c.resolved).toBe(true);
  });

  it('there is nothing to raid without a clue', () => {
    dm.dispatch({ intent: 'raid_camp' }, 'raid the camp');
    expect(host.spawnEncounter).not.toHaveBeenCalled();
    expect(host.said('no camp clues to act on')).toBe(true);
  });

  /** A camp sits on the surface, which is what the refusal has always said. */
  it('refuses a raid from underground, not merely from town', () => {
    host.inOverworld = false; host.inDungeon = true;
    host.banditCamps.clues = [clue()];
    dm.dispatch({ intent: 'raid_camp' }, 'raid the camp');
    expect(host.spawnEncounter).not.toHaveBeenCalled();
    expect(host.said('head to the overworld')).toBe(true);
  });

  it('reporting splits the bounty among the living', () => {
    host.inOverworld = false; host.inDungeon = false; host.inTown = true;
    host.banditCamps.clues = [clue({ reportReward: 90 })];
    dm.dispatch({ intent: 'report_camp' }, 'report the camp');
    expect(host.party.members.map(m => m.gold)).toEqual([45, 45]);
  });

  /**
   * A clue is worth too much to be spent on a reward nobody collects, and the
   * constable's line used to print over four corpses.
   */
  it('keeps the clue when there is no one left to carry it in', () => {
    host.inOverworld = false; host.inTown = true;
    const c = clue();
    host.banditCamps.clues = [c];
    // A character at 0 HP is dying, not dead — isAlive is `!isDead`, so a
    // party has to actually be gone before the constable has no one to talk to.
    host.party.members.forEach(m => { m.hp = 0; m.isDead = true; });
    dm.dispatch({ intent: 'report_camp' }, 'report the camp');
    expect(c.resolved).toBe(false);
    expect(host.said('no one left standing')).toBe(true);
    expect(host.said('as promised')).toBe(false);
  });

  it('clues are listed with what can be done about them', () => {
    host.banditCamps.clues = [clue(), clue({ id: 'c2', resolved: true })];
    dm.dispatch({ intent: 'list_clues' }, 'list clues');
    expect(host.said('A scrawled map. (Tier 2)')).toBe(true);
    expect(host.said('90 gp')).toBe(true);
    // The resolved one is not offered again.
    expect(host.transcript.match(/A scrawled map/g)).toHaveLength(1);
  });

  /**
   * The list used to be numbered, which read as a menu — but neither order
   * takes an index, so every number was a choice the DM did not have.
   */
  it('marks the one clue the orders will actually act on', () => {
    host.banditCamps.clues = [clue(), clue({ id: 'c2', description: 'A tavern boast.' })];
    dm.dispatch({ intent: 'list_clues' }, 'list clues');
    expect(host.said('▶ A scrawled map.')).toBe(true);
    expect(host.transcript).not.toMatch(/1\. A scrawled map/);
  });
});

describe('townsfolk', () => {
  beforeEach(() => {
    host.inDungeon = false; host.inTown = true; host.currentTown = EMBERWATCH;
    host.townLife!.byTown['town_1'].questGivers = [npc('Marn Halloway'), npc('Sil')];
  });

  it('talking finds an NPC by part of their name', () => {
    dm.dispatch({ intent: 'talk_to', npc: 'marn' }, 'talk to marn');
    expect(host.greetQuestGiver).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Marn Halloway' }),
    );
  });

  it('and shrugs at a stranger', () => {
    dm.dispatch({ intent: 'talk_to', npc: 'gandalf' }, 'talk to gandalf');
    expect(host.greetQuestGiver).not.toHaveBeenCalled();
    expect(host.said('No one named "gandalf" is around right now.')).toBe(true);
  });

  it('the locals are only listed in town', () => {
    host.inTown = false; host.inDungeon = true;
    dm.dispatch({ intent: 'list_npcs' }, 'list npcs');
    expect(host.said('You must be in town to see the locals.')).toBe(true);

    host.inTown = true; host.inDungeon = false;
    dm.dispatch({ intent: 'list_npcs' }, 'list npcs');
    expect(host.said('Marn Halloway')).toBe(true);
    expect(host.said('Sil')).toBe(true);
  });
});

describe('looking around and taking stock', () => {
  it('look narrates the room underground and the land above', () => {
    dm.dispatch({ intent: 'look' }, 'look');
    expect(host.said('A low vaulted room, dripping.')).toBe(true);

    host.inDungeon = false; host.inOverworld = true;
    dm.dispatch({ intent: 'look' }, 'look');
    expect(host.said('Open moorland under a wide sky.')).toBe(true);
  });

  it('an empty inventory says so rather than listing nothing', () => {
    dm.dispatch({ intent: 'inventory' }, 'inventory');
    expect(host.said('carries nothing but weapons, wounds, and determination')).toBe(true);
  });

  it('inventory totals coin and carried value separately', () => {
    host.party.members[0].gold = 120;
    host.party.members[0].inventory = [
      { id: 'gem_1', name: 'Star Sapphire', type: 'treasure', description: '', value: 300 },
      { id: 'ration', name: 'Rations', type: 'potion', description: '', value: 0 },
    ];
    dm.dispatch({ intent: 'inventory' }, 'pack');
    expect(host.said("Kael's pack:")).toBe(true);
    expect(host.said('💎 Star Sapphire (300 gp)')).toBe(true);
    expect(host.said('🍞 Rations')).toBe(true);
    expect(host.said('Combined wealth: 120 gp in coin + 300 gp in carried items.')).toBe(true);
  });

  it('report names the place, the standing orders and the trap tally', () => {
    host.dmStance = 'cautious';
    host.dmDirection = Direction.Right;
    host.traps = [
      { id: 'tr1', kindId: 'spiked_pit', tile: { x: 1, y: 1 }, detected: true, disarmed: false },
      { id: 'tr2', kindId: 'poison_dart', tile: { x: 2, y: 2 }, detected: false, disarmed: false },
      { id: 'tr3', kindId: 'poison_dart', tile: { x: 3, y: 3 }, detected: true, disarmed: true },
    ];
    dm.dispatch({ intent: 'report' }, 'report');
    expect(host.said('The Sunken Barrow —')).toBe(true);
    expect(host.said('Orders: cautious (marching east)')).toBe(true);
    expect(host.said('traps: 1/2 visible')).toBe(true);
  });

  it('report labels a town and a trapless floor', () => {
    host.inDungeon = false; host.inTown = true; host.currentTown = EMBERWATCH;
    dm.dispatch({ intent: 'report' }, 'report');
    expect(host.said('Emberwatch (town) —')).toBe(true);
    expect(host.said('traps: none')).toBe(true);
  });

  it('gear lists what each member is wearing', () => {
    dm.dispatch({ intent: 'gear' }, 'gear');
    expect(host.said('Equipped gear:')).toBe(true);
    expect(host.said('Kael (AC ')).toBe(true);
    expect(host.said('Wren (AC ')).toBe(true);
  });

  it('journal and quests are handed on with the raw text', () => {
    dm.dispatch({ intent: 'journal', raw: 'journal page 2' }, 'journal page 2');
    expect(host.journalCodex).toHaveBeenCalledWith('journal page 2');
    dm.dispatch({ intent: 'quests' }, 'quests');
    expect(host.listQuests).toHaveBeenCalled();
    dm.dispatch({ intent: 'tasks' }, 'tasks');
    expect(host.listBulletinTasks).toHaveBeenCalled();
  });
});

describe('traps', () => {
  it('search finds armed traps within three tiles and no further', () => {
    host.party.setPosition({ x: 10, y: 10 });
    host.traps = [
      { id: 'near', kindId: 'spiked_pit', tile: { x: 12, y: 11 }, detected: false, disarmed: false },
      { id: 'far', kindId: 'spiked_pit', tile: { x: 20, y: 10 }, detected: false, disarmed: false },
      { id: 'spent', kindId: 'spiked_pit', tile: { x: 10, y: 11 }, detected: false, disarmed: true },
    ];
    dm.dispatch({ intent: 'search_traps' }, 'search for traps');
    expect(host.traps[0].detected).toBe(true);
    expect(host.traps[1].detected).toBe(false);
    expect(host.traps[2].detected).toBe(false);
    expect(host.said('reveals 1 hidden hazard!')).toBe(true);
  });

  it('an empty sweep still reports the roll', () => {
    dm.dispatch({ intent: 'search_traps' }, 'search for traps');
    expect(host.said('finds no traps nearby')).toBe(true);
  });

  it('disarm says so when nothing is in reach', () => {
    host.trapInReach = false;
    dm.dispatch({ intent: 'disarm_trap' }, 'disarm trap');
    expect(host.checkTrapDisarm).toHaveBeenCalledWith(3);
    expect(host.said('no detected trap within reach')).toBe(true);

    host.trapInReach = true;
    host.lines.length = 0;
    dm.dispatch({ intent: 'disarm_trap' }, 'disarm trap');
    expect(host.lines).toHaveLength(0);
  });
});

describe('room features', () => {
  it('a handled feature refreshes the party and says nothing itself', () => {
    dm.dispatch({ intent: 'feature_chest' }, 'open the chest');
    expect(host.performFeatureIntent).toHaveBeenCalledWith('feature_chest');
    expect(host.said('confused glances')).toBe(false);
  });

  it('a feature the room does not have is met with confused glances', () => {
    host.featureHandled = false;
    dm.dispatch({ intent: 'feature_forge' }, 'use the forge');
    expect(host.said('confused glances')).toBe(true);
  });

  it('an unknown order is met the same way', () => {
    dm.dispatch({ intent: 'unknown' }, 'do a barrel roll');
    expect(host.said('confused glances')).toBe(true);
    expect(host.colorOf('confused glances')).toBe('#888');
  });
});

describe('doctrine and drill', () => {
  it('upcast sets the casting policy and explains it', () => {
    dm.dispatch({ intent: 'upcast', policy: 'always' }, 'upcast always');
    expect(host.party.upcastPolicy).toBe('always');
    expect(host.said('maximum upcast!')).toBe(true);

    dm.dispatch({ intent: 'upcast', policy: 'never' }, 'upcast never');
    expect(host.party.upcastPolicy).toBe('never');
    expect(host.said('no upcasting')).toBe(true);
  });

  it('a stance replaces any march order', () => {
    host.dmDirection = Direction.Up;
    dm.dispatch({ intent: 'stance', stance: 'aggressive' }, 'attack');
    expect(host.dmDirection).toBeUndefined();
    expect(host.dmStance).toBe('aggressive');
    expect(host.said('hunt anything that moves')).toBe(true);
  });

  it('formation 1x4 is named as a single file', () => {
    dm.dispatch({ intent: 'formation', rows: 1, cols: 4 }, 'formation 1x4');
    expect(host.said('a single-file line, four deep')).toBe(true);
    expect(host.said('block')).toBe(false);
  });

  it('formation 2x2 is named as a block', () => {
    dm.dispatch({ intent: 'formation', rows: 2, cols: 2 }, 'formation 2x2');
    expect(host.said('2×2 block')).toBe(true);
  });
});

describe('summoning', () => {
  it('summons the shortest-named match and proclaims it', () => {
    dm.dispatch({ intent: 'summon', monster: 'goblin' }, 'summon a goblin');
    expect(host.spawnEncounter).toHaveBeenCalledTimes(1);
    const [templates] = host.spawnEncounter.mock.calls[0];
    expect(templates).toHaveLength(1);
    expect(templates[0].name.toLowerCase()).toContain('goblin');
    expect(host.proclaim).toHaveBeenCalledWith(`At your word, a ${templates[0].name} manifests!`);
  });

  it('shrugs at something not in the bestiary', () => {
    dm.dispatch({ intent: 'summon', monster: 'zzyzx' }, 'summon ...');
    expect(host.spawnEncounter).not.toHaveBeenCalled();
    expect(host.said('Nothing in the bestiary answers to "zzyzx".')).toBe(true);
  });
});

describe('equipment', () => {
  const sword: InventoryItem = {
    id: 'sw1', name: 'Longsword +1', type: 'weapon', description: 'Keen.', value: 200, power: 1,
  };

  it('equips from the carrier who actually holds the item', () => {
    host.party.members[1].inventory = [{ ...sword }];
    dm.dispatch({ intent: 'equip', item: 'longsword' }, 'equip the longsword');
    expect(host.party.members[1].equipment.weapon?.id).toBe('sw1');
    expect(host.said('(AC ')).toBe(true);
  });

  it('says so when no one carries it', () => {
    dm.dispatch({ intent: 'equip', item: 'halberd' }, 'equip the halberd');
    expect(host.said('No one carries a "halberd"')).toBe(true);
  });

  it('will not re-equip what is already worn', () => {
    // A name nothing else in the pack shares, so "equip it" can only mean this.
    const blade: InventoryItem = { ...sword, id: 'sw2', name: 'Sunder, Blade of Dusk' };
    host.party.members[0].inventory = [blade];
    host.party.members[0].equip('sw2');
    host.lines.length = 0;
    dm.dispatch({ intent: 'equip', item: 'sunder', member: 'kael' }, 'equip kael sunder');
    expect(host.said('is already using the Sunder, Blade of Dusk')).toBe(true);
  });

  it('unequip takes off a named slot across the whole party', () => {
    host.party.members[0].inventory = [{ ...sword }];
    host.party.members[0].equip('sw1');
    host.lines.length = 0;
    dm.dispatch({ intent: 'unequip', arg: 'weapon' }, 'unequip weapon');
    expect(host.party.members[0].equipment.weapon).toBeUndefined();
  });

  it('unequip says so when nothing matches', () => {
    dm.dispatch({ intent: 'unequip', arg: 'crown' }, 'unequip crown');
    expect(host.said('Nothing like that is equipped')).toBe(true);
  });
});

describe('resting', () => {
  it('a long rest camps and refreshes the sheet', () => {
    host.party.members[0].hp = 1;
    dm.dispatch({ intent: 'long_rest' }, 'make camp');
    expect(host.said('makes camp right here')).toBe(true);
    expect(host.party.members[0].hp).toBe(host.party.members[0].maxHp);
  });

  it('a short rest is announced too', () => {
    dm.dispatch({ intent: 'short_rest' }, 'rest');
    expect(host.said('pauses for a short rest')).toBe(true);
  });
});

describe('pass-throughs that belong to Game', () => {
  it('new_game, depart and roll are handed straight on', () => {
    dm.dispatch({ intent: 'new_game' }, 'new game');
    expect(host.startFreshRun).toHaveBeenCalled();
    dm.dispatch({ intent: 'depart_town' }, 'depart');
    expect(host.departTown).toHaveBeenCalled();
    dm.dispatch({ intent: 'roll', expr: '2d6+3' }, 'roll 2d6+3');
    expect(host.rollDiceForParty).toHaveBeenCalledWith('2d6+3');
  });
});

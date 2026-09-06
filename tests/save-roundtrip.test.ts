import { describe, it, expect, beforeEach } from 'vitest';
import { SaveSerializer, type SaveHost } from '../src/game/SaveSerializer';
import { Party } from '../src/entities/Party';
import { GameCharacter } from '../src/entities/Character';
import { Monster, getMonsterTemplate } from '../src/entities/Monster';
import { CombatEngine } from '../src/combat/CombatEngine';
import { Camera } from '../src/engine/Camera';
import { TileMap, TileType } from '../src/world/TileMap';
import { createClock } from '../src/world/DayNightSystem';
import { CLASSES, RACES } from '../src/data/gameData';
import { LOCATIONS } from '../src/ai/DnDKnowledge';
import { grantLuckDie } from '../src/rules/LuckDie';
import type { HUD } from '../src/ui/HUD';
import type { Room } from '../src/world/DungeonGenerator';
import { Direction } from '../src/engine/types';
import { beginStory } from '../src/story/Story';

/**
 * A round trip through SaveSerializer: a run is captured to a `SaveData`,
 * applied to a second, empty game, and captured again. The two snapshots must
 * agree — anything the serializer drops or re-guesses shows up as a diff.
 *
 * The host is a stand-in for `Game` holding the same state, which is the point
 * of `SaveHost` existing: serialization can be exercised without a DOM, a
 * canvas or a render loop. The effect callbacks are inert here — they are
 * Game's own machinery (its dungeon generator, its battle window, its loop
 * timers) and none of them touch what a save carries.
 */
class TestHost implements SaveHost {
  mode = 2; // GameMode.Dungeon
  phase = 0; // GamePhase.Exploration
  get inOverworld(): boolean { return this.mode === 0; }
  get inTown(): boolean { return this.mode === 1; }
  get inDungeon(): boolean { return this.mode === 2; }
  get inCombat(): boolean { return this.phase === 1; }

  dungeonLevel = 1;
  dungeonName = '';
  dungeonTheme: SaveHost['dungeonTheme'] = null;
  dungeonEntranceId: string | null = null;
  bossSlainThisFloor = false;
  delveMood: SaveHost['delveMood'] = null;
  map = new TileMap(4, 3);
  rooms: Room[] = [];
  traps: SaveHost['traps'] = [];
  monsters: Monster[] = [];
  monsterIdCounter = 0;

  overworld = null;
  worldRegions: SaveHost['worldRegions'] = [];
  wanderers: SaveHost['wanderers'] = [];
  pois: SaveHost['pois'] = [];
  currentTown = null;
  townLife = null;
  banditCamps: SaveHost['banditCamps'] = { camps: [], clues: [] };
  weather: SaveHost['weather'] = null;
  clock = createClock();
  lastClockStage: SaveHost['lastClockStage'] = 'dawn';

  party = new Party();
  history: SaveHost['history'] = { kills: 0, victories: 0, defeats: 0, roomsVisited: 0, deepestLevel: 1, killLedger: {} };
  quests: SaveHost['quests'] = [];
  activeQuestId: string | null = null;
  expeditionJournal: string[] = [];
  treasuresFound = 0;
  silveredWeapon = false;
  moonForgeLevel = 0;
  moonForgeBlade = false;

  combatEngine = new CombatEngine(this.party);
  camera = new Camera();
  tickInterval = 800;

  dmStance: SaveHost['dmStance'] = 'auto';
  dmDirection: SaveHost['dmDirection'] = undefined;
  runMode: SaveHost['runMode'] = 'auto';
  hardcore = false;
  story: SaveHost['story'] = null;
  personalQuests: SaveHost['personalQuests'] = [];
  dmPolicies: SaveHost['dmPolicies'] = { tolls: 'auto', parley: 'auto', loot: 'all' };
  counters: SaveHost['counters'] = {};
  achievements: SaveHost['achievements'] = [];
  notes: SaveHost['notes'] = [];
  fallen: SaveHost['fallen'] = [];
  torches: SaveHost['torches'] = 4;
  difficulty: SaveHost['difficulty'] = 'normal';
  sieges: SaveHost['sieges'] = {};
  bonds: SaveHost['bonds'] = {};
  hirelings: SaveHost['hirelings'] = {};
  familiars: SaveHost['familiars'] = {};
  mounted: SaveHost['mounted'] = false;
  retired: SaveHost['retired'] = [];
  arrows: SaveHost['arrows'] = 40;
  pacts: SaveHost['pacts'] = {};
  trophies: SaveHost['trophies'] = [];

  /** Only the handful of HUD calls a restore makes; nothing renders. */
  hud = {
    setDelveMoodChip: () => {},
    setSpeed: (speed: number) => { this.tickInterval = 800 / speed; },
    setDungeonLevel: () => {},
    setDungeonTitle: (t: string) => { this.title = t; },
    setParty: () => {},
    townPanel: { show: () => {} },
  } as unknown as HUD;

  title = '';

  enterDungeonMode(): void { this.mode = 2; }
  enterOverworldMode(): void { this.mode = 0; }
  syncKnownFoes(): void {}
  resumeRun(): void {}
  reopenBattleView(): void { this.battleViewOpened = true; }
  resetTransientTimers(): void {}
  ensureNavigableDungeon(): void {}
  rebuildLostDungeonFloor(): void { this.floorRebuilt = true; }
  markRestoredRoomVisited(): void {}
  clearTravelPlans(): void {}

  battleViewOpened = false;
  floorRebuilt = false;
}

function room(x: number, y: number, id: string): Room {
  return {
    x, y, width: 3, height: 3, cx: x + 1, cy: y + 1,
    // Rooms without a feature get one assigned on restore, which would roll
    // dice; give every room one so the round trip stays deterministic.
    feature: {
      id, kind: 'altar', name: 'a rusted altar', entryLine: 'An altar squats here.',
      inspect: 'Wax has pooled and hardened on the stone.', used: false,
    },
  };
}

function hero(id: string, classId: string, tile: { x: number; y: number }): GameCharacter {
  const charClass = CLASSES.find(c => c.id === classId)!;
  const char = new GameCharacter(id, id, charClass, RACES[0], {
    str: 14, dex: 12, con: 13, int: 11, wis: 10, cha: 9,
  });
  char.level = 3;
  char.xp = 900;
  char.hp = 7;
  char.tile = { ...tile };
  char.direction = 'left';
  char.gold = 42;
  char.exhaustion = 1;
  char.deathSaveSuccesses = 1;
  char.hitDiceRemaining = 2;
  char.knownSpells = ['magic_missile'];
  char.inventory = [{ id: 'potion_healing', name: 'Potion of Healing', type: 'potion', value: 50, description: 'Heals 2d4+2.' }];
  char.equipment = { weapon: { id: 'sword_1', name: 'Longsword +1', type: 'weapon', value: 300, description: 'A keen blade.', power: 8 } };
  char.recomputeAC();
  return char;
}

/** A populated run: two heroes, a monster, traps, a mood, a stocked journal. */
function populatedHost(): TestHost {
  const host = new TestHost();

  host.dungeonLevel = 4;
  host.dungeonName = 'The Weeping Vault';
  host.dungeonTheme = LOCATIONS[0];
  host.dungeonEntranceId = 'entrance_3';
  host.bossSlainThisFloor = true;
  host.delveMood = { icon: '🌑', label: 'Moon-roused', effects: ['+1 to hit for lycanthropes'] };
  host.phase = 0;

  host.map = new TileMap(4, 3);
  host.map.tiles[0][0] = TileType.Floor;
  host.map.tiles[1][2] = TileType.Wall;
  host.map.explored[0][0] = true;

  host.rooms = [room(0, 0, 'feat_a'), room(5, 5, 'feat_b')];
  host.traps = [{ id: 'trap_1', kindId: 'pit', tile: { x: 3, y: 4 }, detected: true, disarmed: false }];

  const goblin = new Monster('m_1', getMonsterTemplate('goblin')!, { x: 6, y: 6 });
  goblin.hp = 4;
  goblin.alertLevel = 2;
  goblin.patrolPoints = [{ x: 6, y: 6 }, { x: 8, y: 6 }];
  goblin.patrolIndex = 1;
  host.monsters = [goblin];
  host.monsterIdCounter = 12;

  host.party.partyName = 'The Ashen Company';
  const a = hero('Kael', 'fighter', { x: 2, y: 2 });
  const b = hero('Mira', 'wizard', { x: 3, y: 2 });
  host.party.members = [a, b];
  host.party.leaderIndex = 0;
  // Restore rebuilds the formation from the saved tiles, leader anchored at
  // (0,0); start from the same shape so the round trip is comparable.
  host.party.formation = [{ x: 0, y: 0 }, { x: 1, y: 0 }];

  host.history = { kills: 17, victories: 4, defeats: 1, roomsVisited: 9, deepestLevel: 4, killLedger: { goblin: 11, orc: 6 } };
  host.expeditionJournal = ['Descended on a black morning.', 'Lost the lantern on floor two.'];
  host.treasuresFound = 5;
  host.silveredWeapon = true;
  host.moonForgeLevel = 2;
  host.moonForgeBlade = true;
  host.banditCamps = { camps: [], clues: [] };
  host.weather = {
    type: 'rain', ticksLeft: 40, visibility: 0.7, rangedModifier: -2,
    moveCostMultiplier: 1.2, description: 'Rain sheets across the hills.', icon: 'rain',
  };
  host.clock = { ...createClock(), phase: 0.42, elapsed: 75_600 };
  host.dmStance = 'cautious';
  host.dmDirection = Direction.Left;
  host.runMode = 'manual';
  host.hardcore = true;
  host.story = beginStory(77);
  host.camera.x = 128;
  host.camera.y = 64;
  host.camera.targetX = 130;
  host.camera.targetY = 66;
  host.tickInterval = 400; // speed 2

  return host;
}

describe('SaveSerializer round trip', () => {
  beforeEach(() => {
    grantLuckDie(null);
  });

  it('captures a run and applies it back unchanged', () => {
    const source = populatedHost();
    grantLuckDie({ value: 17, source: 'd20' });

    const saved = new SaveSerializer(source).capture();

    const target = new TestHost();
    new SaveSerializer(target).apply(saved);
    const again = new SaveSerializer(target).capture();

    expect({ ...again, savedAt: 0 }).toEqual({ ...saved, savedAt: 0 });
  });

  it('restores the fields the run is actually made of', () => {
    const source = populatedHost();
    const saved = new SaveSerializer(source).capture();

    const target = new TestHost();
    new SaveSerializer(target).apply(saved);

    // The delve
    expect(target.mode).toBe(2);
    expect(target.dungeonLevel).toBe(4);
    expect(target.dungeonName).toBe('The Weeping Vault');
    expect(target.dungeonTheme?.id).toBe(LOCATIONS[0].id);
    expect(target.dungeonEntranceId).toBe('entrance_3');
    expect(target.bossSlainThisFloor).toBe(true);
    expect(target.delveMood).toEqual(source.delveMood);
    expect(target.monsterIdCounter).toBe(12);
    expect(target.title).toBe('The Ashen Company — The Weeping Vault');

    // The map, rebuilt rather than shared
    expect(target.map).not.toBe(source.map);
    expect(target.map.width).toBe(4);
    expect(target.map.height).toBe(3);
    expect(target.map.getTile(0, 0)).toBe(TileType.Floor);
    expect(target.map.getTile(2, 1)).toBe(TileType.Wall);
    expect(target.map.explored[0][0]).toBe(true);

    // Rooms keep their features; traps come back detached from the originals
    expect(target.rooms.map(r => r.feature?.id)).toEqual(['feat_a', 'feat_b']);
    expect(target.traps).toEqual(source.traps);
    expect(target.traps[0]).not.toBe(source.traps[0]);

    // The party, rebuilt in place so engine references stay valid
    expect(target.party.members).toHaveLength(2);
    expect(target.party.partyName).toBe('The Ashen Company');
    expect(target.party.leaderIndex).toBe(0);
    expect(target.party.formation).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    const kael = target.party.members[0];
    expect(kael.name).toBe('Kael');
    expect(kael.charClass.id).toBe('fighter');
    expect(kael.level).toBe(3);
    expect(kael.xp).toBe(900);
    expect(kael.hp).toBe(7);
    expect(kael.maxHp).toBe(source.party.members[0].maxHp);
    expect(kael.ac).toBe(source.party.members[0].ac);
    expect(kael.gold).toBe(42);
    expect(kael.exhaustion).toBe(1);
    expect(kael.deathSaveSuccesses).toBe(1);
    expect(kael.hitDiceRemaining).toBe(2);
    expect(kael.tile).toEqual({ x: 2, y: 2 });
    expect(kael.direction).toBe('left');
    expect(kael.knownSpells).toEqual(['magic_missile']);
    expect(kael.inventory.map(i => i.id)).toEqual(['potion_healing']);
    expect(kael.equipment.weapon?.name).toBe('Longsword +1');

    // Monsters, re-resolved from their template ids
    expect(target.monsters).toHaveLength(1);
    expect(target.monsters[0].template.id).toBe('goblin');
    expect(target.monsters[0].hp).toBe(4);
    expect(target.monsters[0].alertLevel).toBe(2);
    expect(target.monsters[0].patrolPoints).toEqual([{ x: 6, y: 6 }, { x: 8, y: 6 }]);
    expect(target.monsters[0].patrolIndex).toBe(1);

    // The chronicle and the world's odds and ends
    expect(target.history).toEqual(source.history);
    expect(target.expeditionJournal).toEqual(source.expeditionJournal);
    expect(target.treasuresFound).toBe(5);
    expect(target.silveredWeapon).toBe(true);
    expect(target.moonForgeLevel).toBe(2);
    expect(target.moonForgeBlade).toBe(true);
    expect(target.weather).toEqual(source.weather);
    expect(target.clock.phase).toBeCloseTo(0.42);
    expect(target.clock.elapsed).toBe(75_600);
    expect(target.dmStance).toBe('cautious');
    expect(target.dmDirection).toBe(Direction.Left);
    expect(target.runMode).toBe('manual');
    expect(target.hardcore).toBe(true);
    expect(target.story?.seed).toBe(77);

    // Camera and speed
    expect(target.camera.x).toBe(128);
    expect(target.camera.targetY).toBe(66);
    expect(target.tickInterval).toBe(400);
  });

  it('carries a fight in progress, and never restores an invisible foe', () => {
    const source = populatedHost();
    source.phase = 1; // GamePhase.Combat
    source.monsters[0].conditions = [
      { id: 'invisible', name: 'Invisible', duration: 6, source: 'Potion' } as any,
      { id: 'poisoned', name: 'Poisoned', duration: 2, source: 'Tomb gas' } as any,
    ];
    source.combatEngine.monsters = source.monsters;
    source.combatEngine.isActive = true;
    source.combatEngine.currentTurnIndex = 1;
    source.combatEngine.partyBlessRounds = 3;
    source.combatEngine.blessSourceId = 'Kael:bless';
    source.combatEngine.initiativeOrder = [source.party.members[0], source.monsters[0]];

    const saved = new SaveSerializer(source).capture();
    expect(saved.combat).not.toBeNull();
    expect(saved.combat!.initiative).toEqual([
      { kind: 'char', id: 'Kael' },
      { kind: 'monster', id: 'm_1' },
    ]);

    const target = new TestHost();
    new SaveSerializer(target).apply(saved);

    expect(target.combatEngine.isActive).toBe(true);
    expect(target.combatEngine.currentTurnIndex).toBe(1);
    expect(target.combatEngine.partyBlessRounds).toBe(3);
    expect(target.combatEngine.blessSourceId).toBe('Kael:bless');
    expect(target.combatEngine.initiativeOrder.map(e => e.id)).toEqual(['Kael', 'm_1']);
    expect(target.battleViewOpened).toBe(true);
    // The party must always be able to see what it fights.
    expect(target.monsters[0].conditions.map(c => c.id)).toEqual(['poisoned']);
  });

  it('leaves a save with no fight out of combat', () => {
    const source = populatedHost();
    source.combatEngine.isActive = true; // active engine, but phase is Exploration
    const saved = new SaveSerializer(source).capture();
    expect(saved.combat).toBeNull();

    const target = new TestHost();
    new SaveSerializer(target).apply(saved);
    expect(target.combatEngine.isActive).toBe(false);
    expect(target.battleViewOpened).toBe(false);
  });

  it('defaults an older save that carries none of the newer fields', () => {
    const source = populatedHost();
    const saved: any = new SaveSerializer(source).capture();
    delete saved.mode;
    delete saved.banditCamps;
    delete saved.pois;
    delete saved.expeditionJournal;
    delete saved.weather;
    delete saved.silveredWeapon;
    delete saved.moonForgeLevel;
    delete saved.moonForgeBlade;
    delete saved.treasuresFound;
    delete saved.delveMood;
    delete saved.bossSlainThisFloor;
    delete saved.clockPhase;
    delete saved.partyName;

    const target = new TestHost();
    new SaveSerializer(target).apply(saved);

    // No overworld in the save, so the party stays underground regardless.
    expect(target.mode).toBe(2);
    expect(target.banditCamps).toEqual({ camps: [], clues: [] });
    expect(target.pois).toEqual([]);
    expect(target.expeditionJournal).toEqual([]);
    expect(target.weather).toBeNull();
    expect(target.silveredWeapon).toBe(false);
    expect(target.moonForgeLevel).toBe(0);
    expect(target.moonForgeBlade).toBe(false);
    expect(target.treasuresFound).toBe(0);
    expect(target.delveMood).toBeNull();
    expect(target.bossSlainThisFloor).toBe(false);
    expect(target.party.partyName).toBe('The Unnamed Party');
    // A save with no clock phase gets a fresh one rather than a broken one.
    expect(target.clock.phase).toBe(createClock().phase);
  });
});

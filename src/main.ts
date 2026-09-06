import { Renderer } from './engine/Renderer';
import { Camera } from './engine/Camera';
import { TileMap } from './world/TileMap';
import { generateDungeon, hashSeed, Room } from './world/DungeonGenerator';
import { getPrebuilt, loadPrebuiltFloor, type PrebuiltFloor } from './world/Prebuilt';
import { assignFeaturesToRooms, assignFeature, RoomFeature } from './world/RoomFeatures';
import { RoomFeatureController } from './game/RoomFeatureController';
import { RecordingContext } from './rendering/RecordingContext';
import { CanvasBackend } from './rendering/backends/CanvasBackend';
import { createBackend, type RenderBackendId } from './rendering/backends';
import type { RenderBackend, SceneMood } from './rendering/DrawCommand';
import { BulletinBoardController } from './game/BulletinBoardController';
import { MarketController } from './game/MarketController';
import { SaveSerializer } from './game/SaveSerializer';
import { DMCommandDispatcher, DM_DIR_NAMES } from './game/DMCommandDispatcher';
import { DMCommand, DMContext, DMIntent, FEATURE_INTENT_KIND } from './ai/DMCommand';
import { understand, IntentPredictor } from './ai/DMCommandParser';
import { IntentModel, loadIntentModel, intentModelEnabled, setIntentModelEnabled } from './ai/IntentModel';
import { Overworld, OverworldEntrance, OverworldTown, entranceAt, generateOverworld, getEntranceById, getTownById, townAt } from './world/Overworld';
import { OverworldPOI, createMoonForgePOI, discoverNearbyPOIs, poiIcon } from './world/OverworldPOI';
import { WeatherState, rollWeather, tickWeather } from './world/WeatherSystem';
import { ClockState, TimeOfDay, NIGHT_VISIBILITY_LIGHT, DAY_MS, createClock, dayChangeNarration, tickClock } from './world/DayNightSystem';
import { CalendarDay, calendarFromElapsed } from './world/CalendarSystem';
import { BIOME_EVENTS, Wanderer, isWildlife, randomTravelEvent, scatterWildlife, spawnOverworldLife, stepWanderers } from './world/OverworldLife';
import { astarPath } from './world/Pathfinding';
import { WorldRegion, generateWorldRegions, regionAt, regionSummary } from './world/WorldRegions';
import { FESTIVAL_FLAVOR, TownLifeState, initTownLife, tickTownLife, rollArrivalEvent, eventFor, townPriceModifier, rollTavernBuff, getTavernBuffNarration, refreshBulletinBoard } from './world/TownLife';
import { TOWN_ARCHETYPES, TownServiceId, ReputationShopItem } from './world/TownTypes';
import { Ambush, findAmbushTiles, getAmbushChance, rollAmbush } from './world/Ambushes';
import { Quest, QuestState, checkQuestProgress, generateQuests, questProgressText, questTargetEntrance } from './quests/Quests';
import { QuestGiver, getReputationTier, getDialogue, getQuestDialogue, awardReputation } from './quests/QuestGivers';
import { BanditCampState, BanditClue, rollBanditClue, raidCamp, reportCamp } from './quests/BanditCamps';
import { MARKET_POTIONS, MARKET_SCROLLS } from './loot/LootTables';
import { Party } from './entities/Party';
import { GameCharacter, InventoryItem, EquipSlot, slotForItem, magicBonusOf, isCursed } from './entities/Character';
import { BulletinTask, bulletinIcon, bulletinProgress, bulletinObjective, bulletinObjectiveMet } from './quests/BulletinBoard';
import { Monster, MonsterTemplate, getMonsterTemplate, getRandomMonster, MONSTER_TEMPLATES, THEME_MONSTERS, isUnseeableMonster } from './entities/Monster';
import { SpriteRenderer } from './entities/Sprites';
import { MapRenderer } from './rendering/MapRenderer';
import type { FloaterKind, EffectKind } from './rendering/MapRenderer';
import { CombatEngine } from './combat/CombatEngine';
import type { PartyCommand, CombatLog } from './combat/CombatEngine';
import { BattleView, type MenuConsumable } from './ui/BattleView';
import { AIDirector, planDyingRescue } from './ai/AIDirector';
import { HUD, GameSpeed } from './ui/HUD';
import { createParty, createCharacter } from './game/CharacterFactory';
import { Direction, GAME_HEIGHT, GAME_WIDTH, TILE_SIZE, Vector2, manhattan, vec2 } from './engine/types';
import { TileType } from './world/TileMap';
import { rollDice, abilityModifier, getSpellById, isCaster, ordinal, CLASSES, RACES, SPELLS, type Ability } from './data/gameData';
import { CompendiumEntry } from './ui/DnDCompendium';
import { rollD20, savingThrow, abilityCheck } from './rules/Rules';
import { hazardByKind, hazardDc, readHazard, type HazardRoll } from './events/Hazards';
import { pickCampScene, readWatch, type CampMember } from './events/CampScenes';
import { parleyOffer, chooseParleyResponse, parleyDc, resolveParley, canParley, tollFor, type ParleyFoe, type ParleyOffer, type ParleyParty } from './events/Parley';
import { rollRoadEvent, type RoadEvent } from './events/RoadEvents';
import { banditGang } from './world/Ambushes';
import { banterFor } from './events/Banter';
import { randomPartyName } from './entities/PartyNames';
import { THEME_MOTIF } from './ui/BattleScenes';
import { setDiceTheme, type DiceTheme } from './ui/DiceTray';
import { COMPONENT_ITEMS } from './combat/Components';
import { rollTieredGear } from './loot/TieredGear';
import { seasonFor, seasonLine, type Season } from './world/Seasons';
import { townTier } from './world/TownLife';
import { rarityTag } from './loot/LootTables';
import { DEFAULT_POLICIES, parsePolicyOrder, describePolicies, type DmPolicies } from './ai/DmPolicies';
import { summarizeFight } from './combat/FightSummary';
import { newlyEarned, achievementById, type AchievementSnapshot } from './game/Achievements';
import { exportRun } from './game/RunExport';
import { bossOpening, bossBloodied } from './combat/BossVoice';
import { answersRiddle, pickRiddle, riddleById, riddleDc, RIDDLE_PATIENCE_TICKS, type Riddle } from './events/Riddles';
import { pickRumor } from './world/TownLife';
import { dealPersonalQuests, debtPayable, heirloomsPossibleOn, hookLine, pilgrimageArrives, rivalsDueOn, type PersonalQuest } from './events/PersonalQuests';
import { pushDiceRoll, getDiceStats, parseDiceExpr, setDiceFloor } from './rules/DiceEvents';
import { grantLuckDie, onLuckDieSpent } from './rules/LuckDie';
import { SaveData, clearSlot, listSaves, loadFromSlot, saveToSlot } from './save/SaveManager';
import { rollCombatLoot, LootSource, LootResult, EMPTY_PURSE } from './loot/LootTables';
import {
  PlacedTrap, getTrapKind, placeTraps, rollDisarm, sweepDetection, triggerTrap,
} from './traps/Traps';

import {
  generateRoomDescription,
  generateMonsterDescription,
  generateCombatTurnNarration,
  generateVictoryNarration,
  generateFirstKillNarration,
  generateDungeonLore,
  generatePartyCommentary,
  generateBattleWornBanter,
  KNOWN_FOE_KILLS,
  KNOWN_FOE_EXPERT_KILLS,
  knownFoeBonusForKills,
  generateLocationDescription,
  generateAtmosphericRoomDescription,
  PartyHistory,
} from './ai/LoreGenerator';
import { LOCATIONS, getRandomElement, LocationTemplate, getLocation, MAGIC_ITEMS } from './ai/DnDKnowledge';
import { getLLM } from './ai/LLMService';
import { sfx } from './audio/Sfx';
import { getAudio } from './audio/Audio';
import { getMusic, type MusicMood } from './audio/Music';
import { getAmbience, NIGHT_BELOW } from './audio/Ambience';
import { StoryController } from './game/StoryController';
import { resolveDeadEnd, stuckStage } from './ai/DeadEnd';
import { getDiceHistory, type DiceRollEvent } from './rules/DiceEvents';
import type { BattleScene } from './ui/BattleScenes';
import { STORY_BOSS_HP_SCALE, type StoryState } from './story/Story';

// ── Context-aware compendium content ────────────────

const LEGEND_TEMPLATES: ((name: string) => string)[] = [
  n => `Old tales of ${n} stir in the shadows of this place\u2026`,
  n => `Bards will sing of the hour this party first read of ${n}.`,
  n => `Somewhere below, something shifts as the legend of ${n} is spoken aloud.`,
];

interface FactionEncounter {
  hostile: boolean;
  monsters?: string[];
  intro: string;
}

const FACTION_ENCOUNTERS: Record<string, FactionEncounter> = {
  'the harpers': {
    hostile: false,
    intro: 'A Harper agent steps from the gloom, sharing healing herbs and a quiet word of warning.',
  },
  'the emerald enclave': {
    hostile: false,
    intro: 'Druids of the Emerald Enclave mark the party with blessed ash \u2014 poisons burn away and wounds close.',
  },
  'the zhentarim': {
    hostile: true,
    monsters: ['orc', 'gnoll', 'goblin'],
    intro: 'Zhentarim enforcers block the corridor: "{name} claims the toll on these halls. Pay up or bleed."',
  },
  'the order of the gauntlet': {
    hostile: true,
    monsters: ['gnoll', 'orc'],
    intro: 'A splinter cell of {name} demands the party prove their faith \u2014 steel first, questions later.',
  },
  "the lords' alliance": {
    hostile: true,
    monsters: ['orc', 'gnoll'],
    intro: 'Corrupt levies flying the banner of {name} intend to arrest the party and claim their treasure.',
  },
  'the red wizards of thay': {
    hostile: true,
    monsters: ['drow_elite', 'bone_devil_monster'],
    intro: 'Scarlet robes at the edge of torchlight \u2014 {name} has come for specimens. The party qualifies.',
  },
  'the cult of the dragon': {
    hostile: true,
    monsters: ['kobold', 'kobold'],
    intro: 'Cultists of {name} kneel around a sigil, chanting the name of their scaled masters\u2026',
  },
  'house jarkoti trade consortium': {
    hostile: true,
    monsters: ['drow_elite', 'goblin'],
    intro: '"Contract clause seven," drones a {name} factor. "Trespassers forfeit all carried assets."',
  },
  'the grey wardens of kellmarch': {
    hostile: true,
    monsters: ['werewolf', 'dire_wolf'],
    intro: 'A rival lodge of {name} tests the party\u2019s mettle \u2014 they release the hounds.',
  },
  'the silent ledger': {
    hostile: true,
    monsters: ['drow_elite', 'will_o_wisp_monster'],
    intro: 'An envelope sealed in black wax lies open on the stone. {name} knows you read it.',
  },
};

// ── State ────────────────────────────────────────────

enum GamePhase {
  Exploration,
  Combat,
  CombatAnimating,
}

/** Where the party currently is in the world. */
enum GameMode {
  Overworld, // traveling the surface world
  Town,      // inside a town (quests, market, rest)
  Dungeon,   // inside a dungeon (existing exploration/combat loop)
}

let gameLoop: Game;

class Game {
  public renderer: Renderer;
  public camera: Camera;
  public map: TileMap;
  public party: Party;
  public sprites: SpriteRenderer;
  public mapRenderer: MapRenderer;
  /** Every frame is described here before a backend draws it. */
  private readonly recorder = new RecordingContext();
  /** Whichever graphics library is showing the world. Canvas 2D by default. */
  public backend: RenderBackend = new CanvasBackend();
  /** True once a backend has finished starting; frames are dropped until then. */
  private backendReady = false;
  public combatEngine: CombatEngine;
  public aiDirector: AIDirector;
  /** Adaptive difficulty: consecutive dominant wins (positive) or battered fights (negative). */
  private difficultyStreak: number = 0;
  public hud: HUD;

  public monsters: Monster[] = [];
  public traps: PlacedTrap[] = [];
  public rooms: Room[] = [];
  public phase: GamePhase = GamePhase.Exploration;
  public dungeonLevel: number = 1;
  public dungeonName: string = '';
  public dungeonTheme: LocationTemplate | null = null;
  /**
   * The stated mood of the current delve, derived from the sky the party
   * entered under (gloom, moon-roused, sacred). Persists floor to floor so
   * its consequences stay explicit in the HUD while underground.
   */
  public delveMood: { icon: string; label: string; effects: string[] } | null = null;

  // ── Overworld / quest state ──
  public mode: GameMode = GameMode.Overworld;
  public overworld: Overworld | null = null;
  /** Named territories keep the surface readable to the AI and player. */
  public worldRegions: WorldRegion[] = [];
  private lastOverworldRegionId: string | null = null;
  public wanderers: Wanderer[] = [];
  public quests: Quest[] = [];
  public activeQuestId: string | null = null;
  public dungeonEntranceId: string | null = null;
  public currentTown: OverworldTown | null = null;
  /** The living pulse of towns: rumors, festivals, caravans (v5+). */
  public townLife: TownLifeState | null = null;
  private townLifeTimer: number = 0;
  /** No ambushes until this timestamp (a short mercy after a fight). */
  private ambushCooldownUntil: number = 0;
  /** Cooldown for moon-phase surface events so they don't chain every step. */
  private moonEventCooldownUntil: number = 0;
  /** Counter for scripted dungeon-mood events (fires after many exploration ticks). */
  private dungeonMoodTicks: number = 0;
  /** Cooldown so dungeon mood events don't chain mid-floor. */
  private dungeonMoodCdUntil: number = 0;
  /** Discovered bandit camps and pending clues. */
  public banditCamps: BanditCampState = { camps: [], clues: [] };
  private entranceBaseName: string = '';
  /** Points of Interest scattered across the overworld. */
  public pois: OverworldPOI[] = [];
  public expeditionJournal: string[] = [];
  private activePOI: OverworldPOI | null = null;
  public weather: WeatherState | null = null;
  /** Persistent day/night clock over the overworld. */
  public clock: ClockState = createClock();
  public lastClockStage: TimeOfDay = 'dawn';
  /** The named calendar day (weekday + moon) derived from the clock. */
  public calendar: CalendarDay = calendarFromElapsed(this.clock.elapsed);
  /** Pending guard hire from town service — applied when entering the next dungeon. */
  public pendingGuardHire: { name: string; classId: string } | null = null;
  /** The party forged a silvered weapon from moon-touched materials. */
  public silveredWeapon: boolean = false;
  /** Smith moon-contract depth — each tier deepens the forged weapon. */
  public moonForgeLevel: number = 0;
  /** Legendary upgrade earned at the hidden moon-forge delve. */
  public moonForgeBlade: boolean = false;
  private overworldDestination: { kind: 'town' | 'entrance'; id: string } | null = null;
  private overworldPath: Vector2[] = [];
  private biomeNarrated: Set<number> = new Set();
  private townWaitTimer: number = 0;
  private travelNarrateCounter: number = 0;
  public bossSlainThisFloor: boolean = false;

  /** A running account of what this party has done — feeds room narration. */
  public history: PartyHistory = { kills: 0, victories: 0, defeats: 0, roomsVisited: 0, deepestLevel: 1, killLedger: {} };
  private visitedRooms: Set<number> = new Set();
  /** Cached A* route the dungeon exploration brain is currently walking. */
  private dungeonRoute: Vector2[] = [];
  /** Room index the cached route leads to (−1 = no route). */
  private dungeonRouteGoal: number = -1;

  private tickTimer: number = 0;
  public tickInterval: number = 800; // ms between AI actions
  private combatTickTimer: number = 0;
  /** True while a step's blows are being shown one at a time; no new step until it is done. */
  private presenting = false;
  /** Monsters the party has already talked to: a parley happens once. */
  private parleyed = new Set<string>();
  /** No road event until this timestamp, so the road is not a carnival. */
  private roadEventCooldownUntil = 0;
  /** Each member's own road. Rides in the save. */
  public personalQuests: PersonalQuest[] = [];
  /** Standing orders: how the party answers tolls and parleys without being asked. Rides in the save. */
  public dmPolicies: DmPolicies = { ...DEFAULT_POLICIES };
  /** Named tallies of things done, for the achievements. Rides in the save. */
  public counters: Record<string, number> = {};
  /** Achievement ids earned, in order. Rides in the save. */
  public achievements: string[] = [];
  /** The DM's notebook. Rides in the save. */
  public notes: string[] = [];
  /** Members lost for good. Rides in the save; the title shows the last few. */
  public fallen: { name: string; className: string; level: number; where: string; day: number }[] = [];
  private achievementTicks = 0;
  /** The act whose lieutenant has already been placed, so each act gets one. */
  private lieutenantActIndex = 0;
  /** A tile the DM pointed at; the party walks there before anything else. */
  private waypoint: Vector2 | null = null;
  /** The boss hall's doors are locked and a keeper carries the key. */
  private floorLocked = false;
  private floorKeyHeld = false;
  private lockedNoticeGiven = false;
  /** Hidden rooms on this floor: the secret door's tile and the room behind it. */
  private secretDoors: { x: number; y: number; room: Room; found: boolean; tries: number }[] = [];
  /** Torches in the pack. Rides in the save. */
  public torches = 4;
  /** How hard the world hits. Rides in the save. */
  public difficulty: 'story' | 'normal' | 'hard' = 'normal';
  /** Towns with a band at the gates, by id. Rides in the save. */
  public sieges: Record<string, { strength: number; since: number }> = {};
  /** Fights won side by side, by pair ("a|b"). At five the pair has a bond. Rides in the save. */
  public bonds: Record<string, number> = {};
  /** Floors left on each hireling's contract. Rides in the save. */
  public hirelings: Record<string, number> = {};
  /** Each member's familiar, by id. Rides in the save; set onto the characters on load. */
  public familiars: Record<string, { kind: string; name: string }> = {};
  /** The party rides. Rides in the save. */
  public mounted = false;
  /** Members who retired to a town. Rides in the save. */
  public retired: string[] = [];
  /** Arrows in the quiver. Rides in the save. */
  public arrows = 40;
  /** Warlock pacts, by member id. Rides in the save. */
  public pacts: Record<string, { demand: string; target: number; progress: number; done: boolean }> = {};
  /** Boss heads taken, and where each hangs. Rides in the save. */
  public trophies: { name: string; dungeon: string; floor: number; mounted: string | null }[] = [];
  private encumberedNoted = false;
  /** A big purchase argued down by the party's best talker; set for the market at start. */
  haggle?: (cost: number, itemName: string) => number;
  /** A claimed ruin. Rides in the save. */
  public base: { x: number; y: number; name: string } | null = null;
  /** The beast that roams the surface. Rides in the save. */
  public roamer: { templateId: string; name: string; x: number; y: number } | null = null;
  private lastSeason: Season | null = null;
  private roamerTicks = 0;
  private roamerWarned = false;
  private bridgesCrossed = new Set<string>();
  private merchantOffers = new Set<string>();
  private lastTownTier: Record<string, number> = {};
  get dayIndex(): number { return Math.floor(this.clock.elapsed / DAY_MS); }
  /** Keys to the great vaults. Rides in the save. */
  public vaultKeys = 0;
  /** This floor's warring bands, if it has them, and whose side the party took. */
  private floorFactions: { a: string; b: string; chosen: string | null } | null = null;
  /** A floor that is about freeing everyone in it. */
  private rescue: { total: number; freed: number } | null = null;
  /** The floor's own weather: spores, cold, or gas. */
  private floorWeather: 'spores' | 'cold' | 'gas' | null = null;
  /** Rooms where the party has laid caltrops or a tripwire. */
  private partyTraps = new Set<number>();
  private retireOffered = new Set<string>();
  /** Ticks left on the torch that is burning; nothing burning when zero. */
  private torchLeft = 0;
  /** The party's light has gone out. */
  private darkness = false;
  private static readonly TORCH_TICKS = 700;
  private achievementQueue: string[] = [];
  private achievementCardOpen = false;
  /** Bosses that have spoken their bloodied line this fight. */
  private bossBloodiedSaid = new Set<string>();
  /** A freed prisoner walking with the party to the next town. Not saved. */
  private escortee: { name: string; reward: number } | null = null;
  /** Exploration ticks toward the next thing the dungeon does on its own. */
  private livingTicks = 0;
  /** The riddle door the party stands before, and how long they have stood there. */
  private pendingRiddle: { feature: RoomFeature; riddle: Riddle; ticks: number } | null = null;
  /** Levels last seen per member, so a level-up anywhere gets its ceremony. */
  private knownLevels = new Map<string, number>();
  /** Members waiting for their ceremony, in order; one card at a time. */
  private ceremonyQueue: GameCharacter[] = [];
  private ceremonyOpen = false;
  private combatTickInterval: number = BattleView.TURN_MS; // ms between combat turns at 1x
  public monsterIdCounter: number = 0;
  private stuckDirCount: number = 0;
  private lastActionDir: string = '';
  private overworldStuckCount: number = 0;
  /** Consecutive ticks the party tried to flee but couldn't move (deadlock breaker). */
  private fleeStuckCount: number = 0;
  /** Rolling recent leader tiles (overworld) for square-loop detection. */
  private overworldRecentTiles: { x: number; y: number }[] = [];
  /** Rolling recent leader tiles (dungeon) for square-loop detection. */
  private dungeonRecentTiles: { x: number; y: number }[] = [];
  /** AI ticks since the delve last made progress; the fail-safe against circles reads it. */
  private idleTicks = 0;
  /** Which stage of the fail-safe has already been announced this floor. */
  private stuckAnnounced: 0 | 1 | 2 | 3 = 0;

  // Live DM orders from the command panel
  public dmDirection?: Direction;
  public dmStance: 'auto' | 'aggressive' | 'cautious' = 'auto';

  /**
   * How this run is played. Auto: the party runs itself and fights resolve on
   * their own. Manual: every fight opens the command menu, and the party holds
   * at each new room and each town gate until the player lets it go on.
   */
  public runMode: 'auto' | 'manual' = 'auto';

  /** Hardcore: a dead adventurer is gone for good; a dead party ends the run. */
  public hardcore = false;

  /** The main quest: where the tale of the shattered die stands for this run. */
  public story: StoryState | null = null;
  readonly storyController = new StoryController(this);

  /** Where the fight is, for the battle window's backdrop. */
  private battleScene(): BattleScene {
    const place = this.mode === GameMode.Dungeon ? 'dungeon' : this.mode === GameMode.Town ? 'town' : 'overworld';
    const region = this.mode === GameMode.Dungeon ? undefined : regionAt(this.worldRegions, this.party.leader.tile);
    return {
      place,
      themeId: this.mode === GameMode.Dungeon ? (this.dungeonTheme?.id ?? null) : null,
      biome: region?.biome ?? null,
      weather: this.mode === GameMode.Dungeon ? null : (this.weather?.type ?? null),
      townArchetype: this.mode === GameMode.Town ? (this.currentTown?.archetypeId ?? null) : null,
      daylight: this.clock.light,
    };
  }

  /** Pause or resume from outside the toggle, keeping the button honest. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.hud.setPausedIndicator(paused);
  }

  /** A town's regard for the party shifts: gratitude or fear. */
  adjustTownReputation(townId: string, delta: number): void {
    const tl = this.townLife?.byTown[townId];
    if (!tl) return;
    tl.townReputation = Math.max(-100, Math.min(100, tl.townReputation + delta));
  }

  private paused: boolean = false;
  private saveTimer: number = 0;
  /** Ticks until the party may try another auto-disarm (avoids spam). */
  private disarmCooldown: number = 0;
  /** Guards against queuing multiple dungeon descents on consecutive ticks. */
  private descending: boolean = false;

  constructor() {
    this.renderer = new Renderer();
    this.camera = new Camera();
    this.map = new TileMap();
    this.camera.setBounds(this.map.width, this.map.height);
    this.sprites = new SpriteRenderer();
    // The renderer draws into the recorder, not the canvas. It takes a
    // CanvasRenderingContext2D and the recorder answers that shape, so nothing
    // in MapRenderer or Sprites had to change.
    this.mapRenderer = new MapRenderer(this.recorder as unknown as CanvasRenderingContext2D, this.sprites);

    // Create party
    const members = createParty(4);
    this.party = new Party();
    for (let i = 0; i < members.length; i++) {
      // Leader anchors at (0,0); followers stagger behind in two rows.
      this.party.addMember(members[i], {
        x: i % 2 === 0 ? 0 : 1,
        y: -Math.floor(i / 2),
      } as Vector2);
    }

    this.combatEngine = new CombatEngine(this.party);
    this.aiDirector = new AIDirector(this.party);
    this.hud = new HUD();

    this.hud.onSpeedChange = (speed) => this.setSpeed(speed);
    this.hud.onPauseToggle = () => this.togglePause();
    this.hud.onNewDungeon = this.guard(() => this.handleNewWorldButton());
    this.hud.onCompendiumAction = this.guard((entry, mode) => this.handleCompendiumAction(entry, mode));
    this.hud.setKillLedgerProvider(() => this.history.killLedger);
    this.hud.questProvider = () => this.activeQuest() ?? null;
    this.hud.questStateProvider = () => this.questState();
    this.hud.onDMCommand = this.guard((text) => this.handleDMCommand(text));
    window.addEventListener('pointerdown', (e) => this.onMapPointer(e));
    this.hud.onModelToggle = this.guard(() => {
      if (this.loadedIntentModel) this.handleModelToggle(this.intentPredictor ? 'off' : 'on');
    });
    this.hud.onSave = () => this.saveGame(false);

    // When a fated Luck die is spent, narrate the resolution.
    onLuckDieSpent((d, roller) => {
      this.hud.addCombatMessage(
        `\ud83c\udfb2 Fate resolves: ${roller}'s roll lands on the fated ${d.value} (banked from "${d.source}").`,
        '#fd8'
      );
    });

    // Town panel wiring — quest board + market talk straight back to the game.
    this.hud.onTownOpen = this.guard(() => this.handleTownOpen());
    this.hud.townPanel.townProvider = () => this.currentTown;
    this.hud.townPanel.rumorProvider = () => {
      const tl = this.townLife?.byTown[this.currentTown?.id ?? ''];
      return tl ? { text: tl.rumor } : null;
    };
    this.hud.townPanel.festivalProvider = () => {
      const tl = this.townLife?.byTown[this.currentTown?.id ?? ''];
      return tl?.festival ? { name: tl.festival.name, kind: tl.festival.kind } : null;
    };
    this.hud.townPanel.questProvider = () => this.quests;
    this.hud.townPanel.questStateProvider = () => this.questState();
    this.hud.townPanel.goldProvider = () => this.partyGold();
    this.haggle = (cost, itemName) => {
      const talker = [...this.party.alive].sort((a, b) => this.talkMod(b) - this.talkMod(a))[0] ?? this.party.leader;
      const r = abilityCheck(this.talkMod(talker), 14, `${talker.name} \u2014 Haggling`);
      if (r.natural === 1) { this.hud.addCombatMessage(`${talker.name} haggles over the ${itemName} and insults the merchant's mother. The price goes up.`, '#c66'); return Math.round(cost * 1.1); }
      if (r.success) { this.hud.addCombatMessage(`${talker.name} talks the ${itemName} down from ${cost} to ${Math.round(cost * 0.85)}.`, '#8cf'); return Math.round(cost * 0.85); }
      return cost;
    };
    this.hud.townPanel.inventoryProvider = () => this.partyInventory();
    this.hud.townPanel.buyStockProvider = () => this.marketStock();
    this.hud.townPanel.onAcceptQuest = this.guard((q) => this.acceptQuest(q));
    this.hud.townPanel.onReportQuest = this.guard((q) => this.reportQuest(q));
    this.hud.townPanel.onBuy = this.guard((item) => this.buyItem(item));
    this.hud.townPanel.onSell = this.guard((item) => this.sellItem(item));
    this.hud.townPanel.onRest = this.guard(() => this.restAtInn());
    this.hud.townPanel.onDepart = this.guard(() => this.departTown());
    this.hud.townPanel.questGiverProvider = () => {
      if (!this.currentTown || !this.townLife) return [];
      return this.townLife.byTown[this.currentTown.id]?.questGivers ?? [];
    };
    this.hud.townPanel.eventProvider = () => {
      if (!this.currentTown || !this.townLife) return null;
      const e = eventFor(this.townLife, this.currentTown.id);
      return e ? { name: e.name, icon: e.icon, effect: { description: e.effect.description } } : null;
    };
    this.hud.townPanel.marketDayProvider = () => this.calendar.isMarketday;
    this.hud.townPanel.priceModifierProvider = () => {
      if (!this.currentTown || !this.townLife) return 1;
      const archetype = TOWN_ARCHETYPES[this.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
      return townPriceModifier(this.townLife, this.currentTown.id, archetype?.priceModifier ?? 1);
    };
    this.hud.townPanel.onUseService = this.guard((serviceId) => this.useTownService(serviceId));
    this.hud.townPanel.townRepProvider = () => {
      if (!this.currentTown || !this.townLife) return 0;
      return this.townLife.byTown[this.currentTown.id]?.townReputation ?? 0;
    };
    this.hud.townPanel.onBuyRepItem = this.guard((item) => this.buyRepItem(item));
    this.hud.townPanel.bulletinProvider = () => {
      if (!this.currentTown || !this.townLife) return [];
      // The local board, plus any finished work carried in from elsewhere —
      // an escort is completed by arriving somewhere else, so without this
      // the party is told to report in and finds nothing to claim.
      return [
        ...this.bulletin.boardForTown(this.currentTown.id),
        ...this.bulletin.awayTasksReadyToClaim(this.currentTown.id),
      ];
    };
    this.hud.townPanel.onBulletinComplete = this.guard((task) => this.completeBulletinTask(task));
    this.hud.townPanel.onVisitNPC = this.guard((id) => {
      const npc = this.currentTown && this.townLife
        ? this.townLife.byTown[this.currentTown.id]?.questGivers?.find(g => g.id === id)
        : undefined;
      if (npc) this.greetQuestGiver(npc);
    });

    // Every new run begins in the open world, outside a town.
    this.generateOverworld();
  }

  // ── Dungeon Generation ──────────────────────────

  /**
   * Spawn monsters, the floor boss, and traps for the current floor's rooms.
   * Shared by fresh generation and the narrow-corridor save migration.
   */
  /**
   * Derive and announce the delve mood — the stated way the sky you walked in
   * under colors THIS delve. The mood persists across floors so its mechanical
   * consequences stay explicit in the HUD, not buried in narration.
   */
  private narrateDelveMood(): void {
    const w = this.weather;
    const c = this.calendar;
    const atNight = this.clock.light < NIGHT_VISIBILITY_LIGHT;
    const foul = !!(w && (
      w.type === 'eerie_mist' || w.type === 'heavy_rain' || w.type === 'blood_red_sky' || w.type === 'sandstorm'
    ));
    const gloomy = c.isGloomDay || atNight || foul;
    const moonRoused = c.moonLight > 0.86;
    const sacred = !w ? c.isSacredDay : (c.isSacredDay || w.type === 'magical_aurora');

    // Only a handful of conditions actually manifest underground — pick exactly
    // one stated, mechanical mood instead of piling all weather into the floor.
    if (moonRoused) this.delveMood = {
      icon: '\ud83c\udf15',
      label: 'moon-roused',
      effects: ['werecreatures stir & transform', 'pack hunts stalk the floors', 'full-moon trophies fall'],
    };
    else if (gloomy) this.delveMood = {
      icon: '\ud83c\udf11',
      label: 'gloom-delve',
      effects: ['undead hunger for the light', 'shadows crawl at the edges', 'fear & dread bite harder'],
    };
    else if (sacred) this.delveMood = {
      icon: '\ud83c\udf1f',
      label: 'hearth-blessed',
      effects: ['wounds knit quicker', 'undead wince from the light', 'a gentle warmth follows'],
    };
    else this.delveMood = null;

    // Narrate the specific sky it came from so the mood reads as continuity.
    const lines: string[] = [];
    if (moonRoused) {
      lines.push('the full moon you walked in under spills silver down the gullet of the stairs, and the dark below stirs, roused by its light');
    } else if (c.moonLight < 0.14) {
      lines.push('you climb down into a gloom the new moon has left unlit; the stone drinks the torchlight and gives nothing back');
    }
    if (w) {
      if (w.type === 'heavy_rain') lines.push('rainwater sheens the top steps, and far below a drip finds a rhythm like slow drums');
      else if (w.type === 'fog' || w.type === 'eerie_mist') lines.push('fog spills past your shoulders down the stairwell, reluctant to be left behind');
      else if (w.type === 'sandstorm') lines.push('a breath of grit rides the stairs down with you, settling in the seams of the old stone');
      else if (w.type === 'magical_aurora') lines.push('faint aurora-light limns the stairwell — curiosity, not malice, follows you down');
      else if (w.type === 'blood_red_sky') lines.push('you carry the red sky’s hunger down with you, and something in the dark seems glad of it');
    }
    if (c.isGloomDay) lines.push('it is Gloom day above and, you suspect, below');
    else if (c.isSacredDay) lines.push('Hearth’s blessing holds even underground');

    if (this.delveMood) {
      this.hud.addCombatMessage(
        `⬇️ The delve is ${this.delveMood.label.toUpperCase()}: ${this.delveMood.effects.join('; ')}.`,
        '#8a6fb5'
      );
    } else if (lines.length > 0) {
      this.hud.addCombatMessage(`⬇️ The way down remembers the weather: ${lines.join('; ')}.`, '#7a9');
    }
    // Keep the persistent chip in sync as soon as the mood is set.
    this.hud.setDelveMoodChip(this.delveMood);
  }

  /**
   * A one-line omen spoken at the threshold of the floor boss's hall. What
   * the party sees here tells them how the delve mood has armed the boss.
   */
  private narrateBossOmen(): void {
    const mood = this.delveMood?.label;
    const bossName = this.monsters
      .find(m => m.template.name.includes('(Boss)'))
      ?.template.name.replace('💀 ', '').replace(' (Boss)', '') ?? 'the keeper of this floor';
    if (mood === 'moon-roused') {
      this.hud.addCombatMessage(
        `🌕 Omen: the great doors are scored with fresh claw-marks, and a howl answers from within — ${bossName} is not alone tonight.`,
        '#c86'
      );
    } else if (mood === 'gloom-delve') {
      this.hud.addCombatMessage(
        `🌑 Omen: the air at the threshold is cold as a grave, and the dark inside the hall seems to breathe — ${bossName} has been given over to the Gloom.`,
        '#a8a'
      );
    } else if (mood === 'hearth-blessed') {
      this.hud.addCombatMessage(
        `🌕 Omen: a faint warmth clings to the threshold stones — Hearth's light goes before you into the dark.`,
        '#8cf'
      );
    } else {
      this.hud.addCombatMessage(
        `Omen: the hall beyond is quiet, but the stone has been worn smooth by something that paces.`,
        '#a89'
      );
    }
  }

  /** The stated delve mood (or none) used to seed fitting prey on a floor. */
  private delveMoodPool(): string[] {
    switch (this.delveMood?.label) {
      case 'moon-roused': return ['werewolf', 'wererat', 'weretiger', 'dire_wolf', 'werebear'];
      case 'gloom-delve': return ['skeleton', 'zombie', 'ghoul', 'ghost', 'specter', 'wight', 'shadow', 'wraith'];
      case 'hearth-blessed': return [];
      default: return [];
    }
  }

  /**
   * Across a delve, the stated mood seeds a floor’s hunger with fitting prey.
   * This draws from the SAME pool the HUD chip announces, so the stated
   * consequence (werecreatures prowl / undead hunger) always matches what
   * actually shows up.
   */
  private surfaceFlavorTemplate(maxCr: number): MonsterTemplate | null {
    const pool = this.delveMoodPool();
    const candidates = pool
      .map(id => getMonsterTemplate(id))
      .filter((t): t is MonsterTemplate => !!t && t.cr <= maxCr);
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private populateDungeonFloor(): void {
    // Monsters in every room except the starting one — each room holds at
    // least one creature (bigger rooms hold more) so the dungeon actually
    // feels populated instead of echoing and empty.
    //
    // An accepted hunt quest must be completable. pickHuntKind targets come
    // from a generic pool (dire wolf, skeleton, goblin, ...) that a dungeon
    // theme may never include (a fire node has no wolves), and even the generic
    // pool only gets that CR deep. So reserve a few spawn slots for the active
    // hunt target once this floor's CR is fair for it — guaranteeing the object
    // of the quest can actually be found instead of hoping RNG rolls it.
    const hunt = this.activeHuntTarget();
    // Still need to slay this many more to finish the quest.
    let huntToSpawn = hunt ? Math.max(0, hunt.remaining) : 0;
    // Cap forced spawns per floor so a hunt quest doesn't turn the whole delve
    // into one monster type — any surplus carries to deeper floors naturally
    // because remaining() drops as kills land.
    huntToSpawn = Math.min(huntToSpawn, 4);
    let huntAnnounced = false;

    for (let i = 1; i < this.rooms.length; i++) {
      const room = this.rooms[i];
      const partyLevel = Math.max(1, this.dungeonLevel);

      // Every room gets 1; rooms ≥ 55 tiles get 2; rooms ≥ 90 get 3.
      const area = room.width * room.height;
      const numMonsters = Math.min(3, 1 + (area >= 55 ? 1 : 0) + (area >= 90 ? 1 : 0));

      for (let m = 0; m < numMonsters; m++) {
        // Cap CR at half the dungeon level (min 0.25)
        const maxCr = Math.max(0.25, Math.floor(partyLevel / 2));
        let template = getRandomMonster(maxCr, this.dungeonTheme?.id);
        // Prioritize placing the hunt target when it's fair for this floor.
        if (hunt && huntToSpawn > 0 && hunt.template.cr <= maxCr) {
          template = hunt.template;
          huntToSpawn--;
          if (!huntAnnounced) { this.narrateHuntEncounter(hunt); huntAnnounced = true; }
        } else {
          // The sky the party entered under may seed a fitting foe (were on a
          // full moon, undead in gloom or foul weather) when one fits the CR.
          if (Math.random() < 0.4) {
            template = this.surfaceFlavorTemplate(maxCr) ?? template;
          }
        }
        const pos = findEmptyTile(this.map, room, this.monsters);
        if (pos) {
          this.spawnMonster(template, pos);
        }
      }
    }

    // Place a boss in the last room
    if (this.rooms.length > 1) {
      const bossRoom = this.rooms[this.rooms.length - 1];
      const bossCr = Math.min(5, this.dungeonLevel);
      const boss = this.spawnFloorBoss(bossRoom);

      // The stated delve mood bends the floor's boss — the sky's hunger has a
      // throne-room of its own down here.
      const mood = this.delveMood?.label;
      if (mood === 'moon-roused') {
        // Full moon: the boss is flanked by a small were-pack that came down
        // the stairs with the silver light. They are moon-pack, so they leave
        // trophies when the party wins.
        const werePool = ['werewolf', 'wererat', 'weretiger', 'dire_wolf'];
        const flankCount = 2 + (Math.random() < 0.4 ? 1 : 0); // 2-3 bodyguards
        const flank: Monster[] = [];
        for (let f = 0; f < flankCount; f++) {
          const t = getMonsterTemplate(werePool[Math.floor(Math.random() * werePool.length)]);
          if (!t || t.cr > bossCr + 1) continue;
          const pos = findEmptyTile(this.map, bossRoom, [...this.monsters, ...flank]);
          if (!pos) continue;
          const w2 = this.spawnMonster(t, pos);
          w2.alertLevel = 2;
          w2.moonPack = true;
          flank.push(w2);
        }
        if (flank.length > 0) {
          // spawnMonster already registers each flanker in this.monsters.
          this.hud.addCombatMessage(
            `🐺 The ${boss.template.name.replace('💀 ', '').replace(' (Boss)', '')} does not keep court alone — the full moon has filled its hall with a were-pack.`,
            '#c86'
          );
        }
      } else if (mood === 'gloom-delve') {
        // Gloom day: the boss rises as an empowered undead shade — harder to
        // put down, and it strikes with the weight of the dark.
        const baseName = boss.template.name.replace('💀 ', '').replace(' (Boss)', '');
        boss.maxHp = Math.floor(boss.maxHp * 1.35);
        boss.hp = boss.maxHp;
        boss.template = {
          ...boss.template,
          name: `💀 ${baseName} (Boss)`, // keep the label; add the shade to damage
          damageBonus: (boss.template.damageBonus ?? 0) + 2,
          attackBonus: boss.template.attackBonus + 1,
          description: `Risen through the Gloom, this ${baseName} moves like a shade — its flesh hangs wrong and its eyes are pits of deep dark.`,
        };
        boss.hp = boss.maxHp;
      }
    }

    // Seed traps and hazards — corridors are the classic ambush spots.
    this.traps = placeTraps(this.map, this.rooms, this.monsters, this.dungeonLevel);
  }

  /**
   * The party is a flexible formation — it funnels single-file through any
   * passage the leader can walk — so a floor only needs to be reachable by
   * the leader. Saves whose floors are genuinely disconnected from the
   * party (or that predate walkable connectors) get rebuilt in place (same
   * level and theme) so continued runs can actually navigate.
   */
  ensureNavigableDungeon(): void {
    const leader = this.party.leader;
    const w = this.map.width;
    const h = this.map.height;
    if (w <= 0 || h <= 0 || this.rooms.length < 2) return;

    // Leader-only BFS from the leader.
    const seen = new Uint8Array(w * h);
    const startIdx = leader.tile.y * w + leader.tile.x;
    if (startIdx < 0 || startIdx >= w * h) return;
    const q: number[] = [startIdx];
    seen[startIdx] = 1;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++];
      const cx = cur % w;
      const cy = (cur / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni]) continue;
        if (!this.map.isWalkable(nx, ny)) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }

    let reachableRooms = 0;
    for (const r of this.rooms) {
      if (seen[r.cy * w + r.cx]) reachableRooms++;
    }
    if (reachableRooms >= 2) return;

    this.hud.addCombatMessage('The old corridors were too narrow for the party — the dungeon reshapes itself.', '#a86');
    this.map = new TileMap();
    this.camera.setBounds(this.map.width, this.map.height);
    this.rooms = generateDungeon(this.map, 14 + Math.min(6, this.dungeonLevel), 4, 10, this.dungeonSeed());
    assignFeaturesToRooms(this.rooms, this.dungeonLevel);
    this.monsters = [];
    this.monsterIdCounter = 0;
    this.populateDungeonFloor();

    const startRoom = this.rooms[0];
    this.party.setPosition({ x: startRoom.cx, y: startRoom.cy }, (x, y) => this.map.isWalkable(x, y));
    this.camera.x = startRoom.cx * TILE_SIZE - 512;
    this.camera.y = startRoom.cy * TILE_SIZE - 384;
    this.camera.targetX = this.camera.x;
    this.camera.targetY = this.camera.y;

    this.combatEngine.monsters = this.monsters;
    this.combatEngine.isActive = false;
    this.combatEngine.initiativeOrder = [];
    this.combatEngine.currentTurnIndex = 0;
    this.phase = GamePhase.Exploration;
    this.visitedRooms = new Set([0]);
    this.history.roomsVisited = Math.max(this.history.roomsVisited, 1);
    this.hud.addCombatMessage(this.describeCurrentRoom(), '#8aa');
  }

  /**
   * Generate the next dungeon floor. With `opts.name`/`opts.theme` (set when
   * entering from an overworld entrance) the delve keeps that identity across
   * every floor; otherwise a fresh theme + name is rolled as before.
   */
  /**
   * Fixed-map seed: a stable id (entrance id when known, else the dungeon's
   * name) hashed with the floor level, so the SAME named dungeon always
   * produces the SAME layout on every visit — floor 3 of 'Gloomhollow Keep'
   * looks the same whether it's your first delve or your fifth.
   */
  private dungeonSeed(): number {
    const base = this.dungeonEntranceId ?? this.dungeonName ?? 'unknown-depths';
    return hashSeed(`${base}::floor-${Math.max(1, this.dungeonLevel)}`);
  }

  generateNewDungeon(opts?: { name?: string; theme?: LocationTemplate | null }): void {
    this.noteProgress();
    // A new floor, and a new run, both fade up from black.
    this.beginTransition('fade');
    // Fresh floor — the breadcrumb trail and any cached exploration route reset.
    this.dungeonRecentTiles = [];
    this.dungeonRoute = [];
    this.dungeonRouteGoal = -1;
    // Leaving a floor? Summarize the dice cast here before moving down.
    if (this.rooms.length > 0) {
      const leaving = getDiceStats().byFloor[this.dungeonLevel];
      if (leaving && leaving.rolls > 0) {
        this.hud.addCombatMessage(
          `\ud83d\uddfa Floor ${this.dungeonLevel} dice: ${leaving.rolls} rolls \u2014 ${leaving.crits} natural 20s, ${leaving.fumbles} natural 1s.`,
          '#fd8'
        );
      }
      // The first generated floor is level 1; later floors advance one level.
      this.dungeonLevel++;
    }
    setDiceFloor(this.dungeonLevel);
    this.map = new TileMap();
    this.camera.setBounds(this.map.width, this.map.height);
    // A gate to a pre-built dungeon has this floor already laid out; anything
    // else is generated from the delve's seed as before.
    const fixedFloor = this.currentPrebuilt()?.floors[this.dungeonLevel - 1] ?? null;
    this.rooms = fixedFloor
      ? loadPrebuiltFloor(this.map, fixedFloor)
      : generateDungeon(this.map, 14 + Math.min(6, this.dungeonLevel), 4, 10, this.dungeonSeed());
    assignFeaturesToRooms(this.rooms, this.dungeonLevel);
    this.monsters = [];
    this.monsterIdCounter = 0;
    this.bossSlainThisFloor = false;

    // The dungeon's location theme shapes its ecology — an entrance's theme
    // persists for the whole delve; unthemed descents roll fresh.
    if (opts?.theme) this.dungeonTheme = opts.theme;
    if (!this.dungeonTheme) this.dungeonTheme = getRandomElement(LOCATIONS);
    this.hud.addCombatMessage(generateLocationDescription(this.dungeonTheme.id), '#997');
    this.hud.setDungeonTitle(`${this.party.partyName} — ${this.dungeonName} (${this.dungeonTheme.name})`);

    // The sky above reaches down into a delve: whatever weather or moon the
    // party walked in under colors the mood — and the hunger — of the dungeon.
    // We derive it at the start of a fresh delve, and again if a run restored
    // mid-delve has no mood yet, so the HUD chip is never silently absent.
    if (this.dungeonLevel === 1 || !this.delveMood) {
      this.narrateDelveMood();
    }

    // Place party in first room
    if (this.rooms.length > 0) {
      const startRoom = this.rooms[0];
      this.party.setPosition({ x: startRoom.cx, y: startRoom.cy }, (x, y) => this.map.isWalkable(x, y));
      this.camera.x = startRoom.cx * TILE_SIZE - 512;
      this.camera.y = startRoom.cy * TILE_SIZE - 384;
      this.camera.targetX = this.camera.x;
      this.camera.targetY = this.camera.y;
    }

    // Populate the floor: monsters, boss, traps.
    if (fixedFloor) this.populatePrebuiltFloor(fixedFloor);
    else this.populateDungeonFloor();
    this.dressFloor();
    this.weatherBelow();
    this.placeSetPiece(fixedFloor);
    this.dressFloorMore();
    if (this.traps.length > 0) {
      this.hud.addCombatMessage(`The dungeon is riddled with ${this.traps.length} hidden hazard${this.traps.length === 1 ? '' : 's'} — watch your step.`, '#a86');
    }

    // Set dungeon name — an entrance's name persists floor to floor.
    if (opts?.name) this.entranceBaseName = opts.name;
    if (!this.entranceBaseName) {
      const prefixes = ['The', 'The Dark', 'The Cursed', 'The Forgotten', 'The Sunken', 'The Shadowed', 'The Haunted', 'The Ancient'];
      const suffixes = ['Catacombs', 'Halls', 'Depths', 'Labyrinth', 'Crypt', 'Pits', 'Warrens', 'Keep'];
      this.entranceBaseName = `${pick(prefixes)} ${pick(suffixes)}`;
    }
    this.dungeonName = `${this.entranceBaseName} (Level ${this.dungeonLevel})`;
    this.hud.setDungeonLevel(this.dungeonLevel);
    this.hud.setDungeonTitle(`${this.party.partyName} — ${this.dungeonName}`);

    // The party makes camp at the stairwell before every descent: a long rest.
    if (this.dungeonLevel > 1) {
      this.hud.addCombatMessage('The party makes camp at the stairwell to recover \u2014 long rest.', '#8cf');
      for (const restMsg of this.party.longRest()) {
        this.hud.addCombatMessage(restMsg, '#7c7');
      }
      this.ritualsAtCamp();
      this.patronDream();
      this.campScene();
    }

    this.phase = GamePhase.Exploration;
    this.descending = false; // The new floor is ready — descents may queue again.
    this.hud.addCombatMessage(`Welcome to ${this.dungeonName}!`, '#ffd700');
    this.placeRivals();
    this.placeLieutenant();
    this.consequences();
    this.useDungeonMap();
    this.tickHirelings();
    // A quest that cares about depth may complete the moment this floor lands.
    this.checkActiveQuestProgress();
    this.hud.addCombatMessage(generateDungeonLore(this.dungeonLevel), '#a8a');
    if (this.dungeonLevel > this.history.deepestLevel) this.history.deepestLevel = this.dungeonLevel;
    // Rumors travel with adventurers
    if (Math.random() < 0.4) {
      this.hud.addCombatMessage(getLLM().tellRumor(this.dungeonName), '#a97');
    }
    this.visitedRooms = this.rooms.length > 0 ? new Set([0]) : new Set();
    this.blockedChests.clear();
    // Numbers expire in about a second on their own, but a floor change is
    // instant — without this a hit from the last room follows the party down.
    this.mapRenderer.clearNumbers();
    this.history.roomsVisited = this.visitedRooms.size;
    this.hud.addCombatMessage(this.describeCurrentRoom(), '#8aa');
    this.hud.addCombatMessage(this.describeParty(), '#ccc');
    // Party leader commentary
    const leader = this.party.leader;
    this.hud.addCombatMessage(
      generatePartyCommentary(leader.name, leader.charClass.id, leader.personality, 'entering_dungeon'),
      '#ca8'
    );
    this.hud.setParty(this.party);

    // Explore starting position
    this.map.reveal(this.party.leader.tile.x, this.party.leader.tile.y, 7);
  }

  /**
   * Adaptive difficulty: converts recent fight results into a spawn-pressure
   * multiplier. Dominant wins stack pressure (harder monsters, up to +30%
   * HP); close calls and wipes ease off (weaker spawns, down to −35%).
   */
  private difficultyPressure(): number {
    if (this.difficultyStreak > 0) return Math.min(1.3, 1 + this.difficultyStreak * 0.06);
    if (this.difficultyStreak < 0) return Math.max(0.65, 1 + this.difficultyStreak * 0.12);
    return 1;
  }

  /**
   * Feed a fight result to the difficulty director. Dominant wins push the
   * pressure up; close calls and party wipes bring it down. Big swings are
   * narrated so the world honestly admits it is reacting.
   */
  private recordCombatOutcome(partyDeaths: number, avgHpPct: number): void {
    const before = this.difficultyPressure();
    if (partyDeaths > 0 || avgHpPct < 0.2) {
      this.difficultyStreak = Math.max(-3, this.difficultyStreak - 1);
    } else if (avgHpPct > 0.85) {
      this.difficultyStreak = Math.min(5, this.difficultyStreak + 1);
    } else {
      this.difficultyStreak = 0;
    }
    const after = this.difficultyPressure();
    if (after - before >= 0.12) {
      this.hud.addCombatMessage("📈 Word of the party's prowess spreads — deadlier things begin to stalk the deep places.", '#a96');
    } else if (before - after >= 0.12) {
      this.hud.addCombatMessage('📉 The depths ease their grip — even the dark can tell when a party has bled enough.', '#8a8');
    }
  }

  spawnMonster(template: MonsterTemplate, pos: Vector2): Monster {
    const id = `monster_${++this.monsterIdCounter}`;
    // The party must never fight what it cannot see: if a template is
    // unseeable by nature, fall back to a visible monster of the same CR.
    if (isUnseeableMonster(template.id)) {
      const visible = getRandomMonster(Math.max(0.25, template.cr));
      template = visible ?? template;
    }
    const monster = new Monster(id, template, pos);
    // The challenge setting: a story party meets softer monsters, a hard one sturdier.
    const hpScale = this.difficulty === 'story' ? 0.75 : this.difficulty === 'hard' ? 1.33 : 1;
    if (hpScale !== 1) { monster.maxHp = Math.max(1, Math.round(monster.maxHp * hpScale)); monster.hp = monster.maxHp; }
    // Adaptive difficulty: the director's pressure quietly shapes the
    // dungeon. Rising stakes: monsters fight fit (scaled-up HP). A battered
    // party gets mercy: weakened spawns so a run can breathe again.
    const pressure = this.difficultyPressure();
    if (pressure !== 1) {
      const scaled = Math.max(1, Math.round(monster.maxHp * pressure));
      monster.maxHp = scaled;
      monster.hp = scaled;
    }
    // Give it some patrol points in its room
    monster.patrolPoints = [
      { ...pos },
      { x: pos.x + 1, y: pos.y },
      { x: pos.x, y: pos.y + 1 },
      { x: pos.x - 1, y: pos.y },
    ];
    this.monsters.push(monster);
    return monster;
  }

  // ── Game Loop ───────────────────────────────────

  private lastTimestamp: number = 0;
  private lastDt: number = 16;
  private running: boolean = true;
  public runStarted: boolean = false;
  public activeSlot: number = 0;
  public frameCount: number = 0;

  /** Fixed simulation step in ms (~30 sim ticks/s); rendering runs at display rate. */
  private static readonly SIM_STEP_MS = 33;
  /** Never simulate more than this many steps per frame after a stall or a hidden tab. */
  private static readonly MAX_STEPS_PER_FRAME = 3;
  private rafId: number | null = null;
  /** Timer that steps the sim when a visible-but-occluded window gets no animation frames. */
  private watchdogId: ReturnType<typeof setTimeout> | null = null;
  private static readonly WATCHDOG_MS = 100;
  private accumulator: number = 0;
  private consecutiveErrors: number = 0;
  /** Set when repeated errors halted the sim; cleared by the pause toggle / resume order. */
  private errorHalt: boolean = false;

  start() {
    // Already looping — never spawn a second frame chain.
    if (this.running && (this.rafId !== null || this.watchdogId !== null)) return;
    this.lastTimestamp = performance.now();
    this.accumulator = 0;
    this.consecutiveErrors = 0;
    this.errorHalt = false;
    this.running = true;
    this.runStarted = true;
    this.applyRunMode();
    this.storyController.ensureStory();
    this.ensurePersonalQuests();
    this.ensureFamiliars();
    this.storyController.afterStart();
    // Both are armed here, not just the frame request. A window that is
    // visible but never painted (occluded, or a host that withholds frames)
    // gets no first animation frame at all, and the watchdog cannot rescue a
    // loop that has not run once — so the game would simply never start.
    this.rafId = requestAnimationFrame(this.gameStep);
    this.armWatchdog();
  }

  /**
   * Wake the loop after the tab comes back into view. Safe to call at any
   * time: it does nothing unless a run is going and the loop has gone quiet.
   */
  resumeLoop(): void {
    if (!this.running || !this.runStarted) return;
    // Do not credit the time spent hidden to the simulation.
    this.lastTimestamp = performance.now();
    this.accumulator = 0;
    if (this.watchdogId === null) this.armWatchdog();
    if (this.rafId === null) this.rafId = requestAnimationFrame(this.gameStep);
  }

  /** Schedule the fallback step for a visible window that gets no frames. */
  private armWatchdog(): void {
    if (this.watchdogId !== null) clearTimeout(this.watchdogId);
    this.watchdogId = setTimeout(() => {
      this.watchdogId = null;
      if (this.running && document.visibilityState === 'visible') this.gameStep(performance.now());
    }, Game.WATCHDOG_MS);
  }

  /**
   * One animation frame: advance the sim by as many fixed steps as real time
   * allows (capped), then draw once. requestAnimationFrame does not fire in a
   * hidden tab, so the world pauses while backgrounded and the elapsed-time
   * clamp keeps it from fast-forwarding when the tab returns.
   */
  private gameStep = (now: number) => {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.watchdogId !== null) { clearTimeout(this.watchdogId); this.watchdogId = null; }
    // Stopped on purpose (e.g. back to the main menu) — just idle.
    if (!this.running) return;

    const elapsed = Math.min(250, Math.max(0, now - this.lastTimestamp));
    this.lastTimestamp = now;

    if (!this.errorHalt) {
      this.accumulator += elapsed;
      try {
        let steps = 0;
        while (this.accumulator >= Game.SIM_STEP_MS && steps < Game.MAX_STEPS_PER_FRAME) {
          this.frameCount++;
          this.lastDt = Game.SIM_STEP_MS;
          this.update(Game.SIM_STEP_MS);
          this.checkLevelUps();
          if (++this.achievementTicks >= 60) { this.achievementTicks = 0; this.checkAchievements(); this.checkSeason(); }
          this.accumulator -= Game.SIM_STEP_MS;
          steps++;
        }
        // Drop any backlog we could not catch up on rather than spiralling.
        if (steps >= Game.MAX_STEPS_PER_FRAME) this.accumulator = 0;
        this.render();
        this.consecutiveErrors = 0;
      } catch (err) {
        this.handleStepError(err);
      }
    }

    this.rafId = requestAnimationFrame(this.gameStep);
    // Browsers stop animation frames for occluded windows even when the tab
    // is technically visible; a hidden tab stays paused (no reschedule).
    this.armWatchdog();
  };

  /**
   * A thrown error inside the sim or a UI handler. One-off glitches are logged
   * and the loop carries on; a run of them halts the sim and tells the player,
   * instead of silently repeating the failure every frame.
   */
  private handleStepError(err: unknown): void {
    console.error('Game step error:', err);
    this.consecutiveErrors++;
    if (this.consecutiveErrors < 3 || this.errorHalt) return;
    this.errorHalt = true;
    this.paused = true;
    this.hud.setPausedIndicator(true);
    const detail = err instanceof Error ? err.message : String(err);
    this.hud.showErrorBanner(
      `Something broke and the game has paused itself. Your last autosave is safe. ` +
      `Press Pause (or type "resume") to try to continue. Details: ${detail}`,
    );
  }

  /** Wrap a UI-driven handler in the same safety net as the game loop. */
  private guard<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      try {
        fn(...args);
      } catch (err) {
        this.handleStepError(err);
      }
    };
  }

  private update(dt: number) {
    if (this.errorHalt) return;
    this.music.play(this.musicMood());
    this.storyController.refreshChip();
    this.ambience.update({
      weather: this.weather?.type ?? null,
      underground: this.mode === GameMode.Dungeon,
      night: this.clock.light < NIGHT_BELOW,
      town: this.mode === GameMode.Town,
      inCombat: this.phase === GamePhase.Combat,
    });
    // Persist the run every few seconds (also on tab hide / page unload).
    this.saveTimer += dt;
    if (this.saveTimer >= 8000) {
      this.saveTimer = 0;
      this.saveGame();
    }

    if (this.paused) return;

    // A big die roll is on screen — freeze the world until it lands, so the
    // roll actually resolves before the game moves on. Combat and movement
    // resume the moment the cycle (and any queued die) finishes.
    if (this.hud.isDiceRolling()) return;

    // The spoils of the last fight are still on screen: the world waits for
    // them to be read. Exploring on underneath them let the party blunder
    // into the next fight during the countdown, and the summary's own close
    // then shut the window over that new fight.
    if (this.phase !== GamePhase.Combat && this.hud.battleView.isVisible()) return;

    // The sun creeps across the sky. Crossing into a new stage of the day is
    // its own small narration when out in the world.
    const prevStage = this.lastClockStage;
    this.clock = tickClock(this.clock, dt);
    this.calendar = calendarFromElapsed(this.clock.elapsed);
    if (this.clock.timeOfDay !== prevStage) {
      this.lastClockStage = this.clock.timeOfDay;
      if (this.mode === GameMode.Overworld) {
        const line = dayChangeNarration(prevStage, this.clock.timeOfDay);
        if (line) this.hud.addCombatMessage(`🌗 ${line}`, '#7ca');
        // Crossing from night into dawn rolls a new calendar day forward;
        // the weekday is worth knowing.
        if (this.clock.timeOfDay === 'dawn') {
          this.hud.addCombatMessage(`📅 ${this.calendar.weekday} — ${this.calendarDesc()}`, '#7aa');
        }
      }
    }

    // Update monster flash timers
    for (const m of this.monsters) {
      if (m.flashTimer > 0) m.flashTimer -= dt / 1000;
    }

    // Tick AI decisions
    this.tickTimer += dt;
    this.combatTickTimer += dt;

    if (this.phase === GamePhase.Combat) {
      // Combat runs anywhere — dungeons and ambushes on the open road alike.
      this.updateCombat();
    } else if (this.mode === GameMode.Dungeon) {
      if (this.phase === GamePhase.Exploration) {
        if (this.tickTimer >= this.tickInterval * (this.isEncumbered() ? 1.3 : 1)) {
          this.tickTimer = 0;
          this.aiTick();
          // Occasionally the sky you descended under closes in: a howling pack
          // corners the party, shadows pool at a shaft, or a boon finds them.
          this.maybeDungeonMoodEvent();
          this.maybeLivingDungeonEvent();
          this.tickRiddle();
        }
      }
    } else if (this.mode === GameMode.Overworld || this.mode === GameMode.Town) {
      // The world breathes on its own clock: caravans roll, festivals begin.
      this.townLifeTimer += dt;
      if (this.townLifeTimer >= 1000 && this.overworld && this.townLife) {
        this.townLifeTimer = 0;
        const lines = tickTownLife(
          this.townLife,
          this.overworld,
          this.map,
          this.wanderers,
          Date.now(),
          { partyTile: this.party.leader.tile, partyTownId: this.currentTown?.id ?? null },
        );
        for (const line of lines.slice(0, 2)) this.hud.addCombatMessage(line, '#9a9');
      }
      if (this.mode === GameMode.Overworld && this.tickTimer >= this.tickInterval) {
        this.tickTimer = 0;
        this.overworldTick();
      }
    }
    // Live weather readout in the top bar (surface only — it's weather, not sky).
    this.refreshWeatherChip(Date.now());
    // The stated delve mood is only relevant underground — hide it anywhere else.
    this.hud.setDelveMoodChip(this.mode === GameMode.Dungeon ? this.delveMood : null);
    if (this.mode === GameMode.Town) {
      // The party rests and waits for orders — but if nobody is watching,
      // they eventually accept the first quest and head out on their own.
      this.townWaitTimer += dt;
      if (this.townWaitTimer > 45000 && this.activeQuestId === null) {
        const available = this.storyController.nextPosting();
        if (available) {
          this.hud.addCombatMessage('With no orders, the party takes the first posting off the quest board...', '#9a9');
          this.acceptQuest(available);
        }
      }
    }
  }

  private aiTick() {
    const leader = this.party.leader;
    if (!leader.isAlive) {
      // If the leader dies, the party retreats — scarred but alive.
      this.hud.addCombatMessage(`${leader.name} has fallen! The party retreats to recover...`, '#c44');
      this.partyRetreat();
      this.generateNewDungeon();
      return;
    }

    // Build lists of nearby things
    const visibleMonsters = this.getVisibleMonsters(8);
    const lootNearby = this.unopenedChestsNearby(10);
    const doorsNearby = this.getNearbyTilesByType(TileType.Door, leader.tile, 2);
    const stairsNearby = this.getNearbyTilesByType(TileType.StairsDown, leader.tile, 1);

    // The fail-safe: a party that has made no progress for a long while
    // stops wandering, reads the map, and if the floor is a dead end resolves
    // it rather than circling until the player notices.
    if (this.mode === GameMode.Dungeon) {
      this.tickTorch();
      this.checkLockedDoors();
      this.checkSecretDoors();
      if (this.followWaypoint()) return;
    }
    if (this.mode === GameMode.Dungeon && this.stuckFailsafe()) return;

    const action = this.aiDirector.decideAction(
      this.map,
      visibleMonsters,
      lootNearby,
      doorsNearby,
      stairsNearby,
      this.rooms,
    );

    // DM stance: aggressive parties hunt down nearby foes on sight.
    if (this.dmStance === 'aggressive' && this.phase === GamePhase.Exploration) {
      const prey = this.getVisibleMonsters(12);
      if (prey.length > 0) {
        this.hud.addCombatMessage(`\u2694\ufe0f By your order \u2014 the party charges ${prey[0].template.name}!`, '#c84');
        this.startCombat(prey);
        return;
      }
    }

    switch (action.type) {
      case 'explore': {
        // A DM march order overrides the AI's chosen path.
        if (this.dmDirection) {
          const orderedDir = this.dmDirection;
          if (this.moveParty(orderedDir)) {
            if (this.frameCount % 30 === 0) {
              this.hud.addCombatMessage(`${leader.name} marches ${DM_DIR_NAMES[orderedDir]} as ordered.`, '#6a8');
            }
          } else {
            this.hud.addCombatMessage(`The way ${DM_DIR_NAMES[orderedDir]} is blocked \u2014 the march order is rescinded.`, '#c88');
            this.dmDirection = undefined;
          }
          break;
        }

        // Track same-direction count
        if (action.direction === this.lastActionDir) {
          this.stuckDirCount++;
        } else {
          this.stuckDirCount = 1;
          this.lastActionDir = action.direction;
        }

        // While marching a BFS path to a real destination, never override the
        // step — a long corridor legitimately means many steps the same way.
        // Only redirect during aimless wandering when the party is actually
        // looping (revisiting tiles): marching straight is optimal, squares
        // are not.
        const dirToUse = (!action.pathing && this.isLoopingTiles(this.dungeonRecentTiles, leader.tile))
          ? this.pickDifferentDir(action.direction)
          : action.direction;

        const moved = this.moveParty(dirToUse);
        if (moved) {
          if (dirToUse !== action.direction) {
            const dirName = { up: 'north', down: 'south', left: 'west', right: 'east' }[dirToUse];
            this.hud.addCombatMessage(`${leader.name} turns ${dirName}...`, '#8a8');
            this.stuckDirCount = 1;
            this.lastActionDir = dirToUse;
          } else {
            this.hud.addCombatMessage(action.message, '#8c8');
          }
        } else {
          // Blocked — try alternates
          let altMoved = false;
          for (const altDir of [Direction.Right, Direction.Left, Direction.Up, Direction.Down]) {
            if (altDir !== dirToUse && this.moveParty(altDir)) {
              altMoved = true;
              this.stuckDirCount = 1;
              this.lastActionDir = altDir;
              const dirName = { up: 'north', down: 'south', left: 'west', right: 'east' }[altDir];
              this.hud.addCombatMessage(`${leader.name} redirects ${dirName}...`, '#8a8');
              break;
            }
          }
          if (!altMoved) {
            this.stuckDirCount = 0;
            // Truly stuck — search for stairs or nearest door to break free.
            const stairs = this.getNearbyTilesByType(TileType.StairsDown, leader.tile, 10);
            const doors = this.getNearbyTilesByType(TileType.Door, leader.tile, 10);
            if (stairs.length > 0) {
              const s = stairs[0];
              const dx = Math.sign(s.x - leader.tile.x);
              const dy = Math.sign(s.y - leader.tile.y);
              const dir = dx === 1 ? Direction.Right : dx === -1 ? Direction.Left : dy === 1 ? Direction.Down : Direction.Up;
              this.moveParty(dir);
              this.hud.addCombatMessage(`${leader.name} heads for the stairwell...`, '#cc8');
            } else if (doors.length > 0) {
              const d = doors[0];
              const ddx = Math.sign(d.x - leader.tile.x);
              const ddy = Math.sign(d.y - leader.tile.y);
              const dir = ddx === 1 ? Direction.Right : ddx === -1 ? Direction.Left : ddy === 1 ? Direction.Down : Direction.Up;
              this.moveParty(dir);
              this.hud.addCombatMessage(`${leader.name} pushes through a door...`, '#ca8');
            } else {
              this.hud.addCombatMessage(`${leader.name} finds the way blocked.`, '#888');
            }
          }
        }
        break;
      }
      case 'attack': {
        if (action.target && this.dmStance !== 'cautious') {
          if (this.tryParley(visibleMonsters)) break;
          this.hud.addCombatMessage(action.message, '#c84');
          this.startCombat(visibleMonsters);
        } else if (action.target) {
          this.hud.addCombatMessage(`${leader.name} holds the party back \u2014 caution was ordered.`, '#886');
        }
        break;
      }
      case 'rest': {
        this.takeShortRest(action.message);
        break;
      }
      case 'heal':
      case 'regroup': {
        // Both mean "someone is dying". Bring them round with a spell or a
        // potion when the party has one; otherwise the only cure is a rest,
        // and a party that merely announces its worry stands over the body
        // forever.
        this.hud.addCombatMessage(action.message, '#a86');
        if (!this.rescueDying()) this.takeShortRest('The party closes ranks and tends to the fallen.');
        break;
      }
      case 'revive': {
        this.hud.addCombatMessage(action.message, '#8cf');
        this.spendRevivifyScroll();
        break;
      }
      case 'enter_door': {
        this.hud.addCombatMessage(action.message, '#ca8');
        // Open the door: move onto it and turn it to floor
        if (doorsNearby.length > 0) {
          const door = doorsNearby[0];
          this.map.setTile(door.x, door.y, TileType.Floor);
        }
        break;
      }
      case 'go_down_stairs': {
        if (this.descending) break; // A descent is already queued.
        const activeQuest = this.activeQuest();
        // The quest's floor is done — climb back out instead of going deeper.
        if (activeQuest && activeQuest.completed) {
          this.hud.addCombatMessage('The quest is fulfilled — the party turns from the stairs and climbs back toward the surface.', '#ffd700');
          this.exitDungeonToOverworld();
          break;
        }
        this.hud.addCombatMessage(action.message, '#cc8');
        this.descending = true;
        setTimeout(() => this.generateNewDungeon(), 500);
        break;
      }
      case 'idle': {
        // The exploration brain picks a real destination — the nearest
        // unvisited room, or the stairwell once every room is seen — and the
        // party walks an A* route there instead of shuffling into walls.
        if (!this.exploreStep()) {
          this.hud.addCombatMessage(`${leader.name} finds no way forward from here.`, '#888');
        }
        break;
      }
      case 'scout': {
        // A quiet step forward, watching for traps.
        const scoutMoved = this.moveParty(action.direction);
        if (scoutMoved) {
          this.hud.addCombatMessage(action.message, '#8a8');
        } else {
          this.hud.addCombatMessage(`${leader.name} finds the way blocked.`, '#888');
        }
        break;
      }
      case 'flee': {
        // Actually run: step away from the nearest visible threat. A fleeing
        // party that just stands still spams the log forever (crippled parties
        // can deadlock this way), so if escape is impossible, fall back to the
        // same scarred retreat used when the leader falls.
        const threat = visibleMonsters[0];
        const away =
          !threat
            ? undefined
            : threat.tile.x > leader.tile.x ? Direction.Left
            : threat.tile.x < leader.tile.x ? Direction.Right
            : threat.tile.y > leader.tile.y ? Direction.Up
            : Direction.Down;
        if (away && this.moveParty(away)) {
          this.fleeStuckCount = 0;
          this.hud.addCombatMessage(action.message, '#c88');
        } else if (away) {
          this.fleeStuckCount++;
          if (this.fleeStuckCount > 6) {
            this.fleeStuckCount = 0;
            this.hud.addCombatMessage('The party is cornered — they drag their wounded clear of the dungeon...', '#c44');
            this.partyRetreat();
            this.generateNewDungeon();
          }
        } else {
          this.hud.addCombatMessage(action.message, '#a86');
        }
        break;
      }
      case 'loot': {
        // Standing on the chest already: open it. Otherwise walk toward it,
        // and give up on this one if the way is blocked so the party is never
        // stuck shouldering a wall.
        const room = this.rooms.find(r => r.cx === action.target.x && r.cy === action.target.y);
        if (leader.tile.x === action.target.x && leader.tile.y === action.target.y) {
          if (room?.feature?.kind === 'chest') {
            this.hud.addCombatMessage(action.message, '#a86');
            this.performFeatureIntent('feature_chest');
          }
        } else if (!this.moveParty(action.direction)) {
          // `action.direction` is a straight bearing with no pathfinding, so a
          // chest around a corner blocks on the first step. Giving up is right
          // eventually, but marking the feature `used` was not: that reads as
          // opened everywhere else — the map draws it ajar, a DM order calls it
          // empty, and the loot is gone. Count the refusals instead, and only
          // stop offering this one to the AI.
          const key = `${action.target.x},${action.target.y}`;
          const tries = (this.blockedChests.get(key) ?? 0) + 1;
          this.blockedChests.set(key, tries);
        } else if (this.frameCount % 30 === 0) {
          this.hud.addCombatMessage(action.message, '#a86');
        }
        break;
      }
    }

    // Remember this position for the breadcrumb trail + square-loop detection.
    this.trackTile(this.dungeonRecentTiles, leader.tile);

    // Reveal FOW
    this.map.reveal(leader.tile.x, leader.tile.y, 7);

    // Update HUD
    this.hud.setParty(this.party);

    // Camera follow
    this.camera.follow(leader.tile);

    // A room never seen before earns an atmospheric description.
    const roomIdx = this.currentRoomIndex();
    if (roomIdx !== -1 && !this.visitedRooms.has(roomIdx)) {
      this.visitedRooms.add(roomIdx);
      this.noteProgress();
      this.history.roomsVisited = this.visitedRooms.size;
      this.bulletinScoutProgress(1);
      this.hud.addCombatMessage(this.describeCurrentRoom(), '#8aa');
      this.manualHold('a new room');
      const entered = this.currentRoom()?.feature;
      const banter = banterFor(this.party.alive.map(m => ({ name: m.name, classId: m.charClass.id, greed: m.personality.greed, caution: m.personality.caution, aggression: m.personality.aggression, hpPct: m.hp / m.maxHp })), entered?.kind ?? null);
      if (banter) for (const line of banter) this.hud.addCombatMessage(line, '#c9c2b0');
      if (entered?.kind === 'hazard' && !entered.used) void this.runHazard(entered);
      if (entered?.kind === 'puzzle_room' && !entered.used) this.poseRiddle(entered);
      if (entered?.kind === 'altar' && !entered.used) this.shrineChoice(entered);
      if (entered?.kind === 'chest' && !entered.used) this.detectMagicOn(entered);
      if (entered?.kind === 'prison' && !entered.used && this.rescue) this.roomFeatures.perform('feature_prison');
      if (this.floorWeather === 'spores' && Math.random() < 0.35) this.sporeRoom();
      // Hearth-blessed delve: "wounds knit quicker" — every new room reached
      // closes a little of the party's hurts.
      if (this.mode === GameMode.Dungeon && this.delveMood?.label === 'hearth-blessed') {
        const knit = this.party.alive.filter(m => m.hp < m.maxHp);
        if (knit.length > 0) {
          for (const m of knit) m.heal(rollDice(1, 4));
          this.hud.addCombatMessage(`🌟 A gentle warmth follows the party into the room — wounds knit a little (${knit.map(m => m.name).join(', ')}).`, '#8cf');
        }
      }
      // The floor boss's hall: the stated mood speaks a one-line omen before
      // the party walks in, so what waits inside never comes as a surprise.
      if (this.mode === GameMode.Dungeon && roomIdx === this.rooms.length - 1) {
        this.narrateBossOmen();
      }
    }

    // Traps: passive detection, auto-disarm of nearby hazards, then step triggers.
    for (const msg of this.sweepTraps()) this.hud.addCombatMessage(msg, '#a86');
    if (this.disarmCooldown > 0) {
      this.disarmCooldown--;
    } else if (this.checkTrapDisarm(1)) {
      this.disarmCooldown = 3;
    }
    this.checkTrapTriggers();
    this.hud.setParty(this.party);
  }

  private pickDifferentDir(current: Direction): Direction {
    const dirs = [Direction.Right, Direction.Down, Direction.Left, Direction.Up];
    // Prefer perpendicular directions first, then reverse
    const shuffled = [...dirs].sort(() => Math.random() - 0.5);
    for (const d of shuffled) {
      if (d !== current) return d;
    }
    return dirs[0];
  }

  /**
   * Push a tile onto a rolling recent-tile deque (breadcrumb trail +
   * square-loop detection). Consecutive duplicates are collapsed so standing
   * still doesn't bloat the deque or false-trigger loop detection.
   */
  private trackTile(deque: { x: number; y: number }[], tile: Vector2): void {
    const last = deque[deque.length - 1];
    if (last && last.x === tile.x && last.y === tile.y) return;
    deque.push({ x: tile.x, y: tile.y });
    if (deque.length > 14) deque.shift();
  }

  /**
   * True when the tile appears repeatedly in the recent deque — the party is
   * tracing a square or pacing back and forth instead of progressing.
   */
  private isLoopingTiles(deque: { x: number; y: number }[], tile: Vector2, minCount: number = 3): boolean {
    let count = 0;
    for (const t of deque) if (t.x === tile.x && t.y === tile.y) count++;
    return count >= minCount;
  }

  private moveParty(dir: Direction): boolean {
    const leader = this.party.leader;
    const dx = dir === Direction.Left ? -1 : dir === Direction.Right ? 1 : 0;
    const dy = dir === Direction.Up ? -1 : dir === Direction.Down ? 1 : 0;

    const newX = leader.tile.x + dx;
    const newY = leader.tile.y + dy;

    if (!this.map.isWalkable(newX, newY)) return false;

    // The party is a flexible formation: the leader steps anywhere walkable
    // and the followers spread into the preferred shape when space allows or
    // funnel single-file through tight passages.
    leader.direction = dir;
    leader.tile = { x: newX, y: newY };
    this.party.stepFollowers((x, y) => this.map.isWalkable(x, y), { x: newX, y: newY });
    return true;
  }

  // ── Combat ──────────────────────────────────────

  /**
   * Feed the kill ledger into the AI: rebuild the known-foe set (AIDirector
   * morale/bark) and the attack bonus map (CombatEngine) from it.
   */
  syncKnownFoes(): void {
    const bonusMap: Record<string, number> = {};
    const known = new Set<string>();
    for (const [id, kills] of Object.entries(this.history.killLedger)) {
      if (kills >= KNOWN_FOE_KILLS) {
        known.add(id);
        bonusMap[id] = knownFoeBonusForKills(kills);
      }
    }
    this.combatEngine.knownFoeBonus = bonusMap;
    this.aiDirector.knownFoes = known;
  }

  private startCombat(monsters: Monster[]) {
    this.noteProgress();
    this.beginTransition('blinds');
    this.combatEngine.defenseBonus = 0;
    this.combatEngine.gasPerRound = this.mode === GameMode.Dungeon && this.floorWeather === 'gas' ? 1 : 0;
    this.springPartyTrap(monsters);
    this.summonAlly(monsters);
    this.combatEngine.onRangedShot = () => { if (this.arrows <= 0) return false; this.arrows--; if (this.arrows === 5) this.hud.addCombatMessage('\ud83c\udff9 Five arrows left in the quiver.', '#a98'); return true; };
    // Cover: pillars, roots and cogs to fight behind.
    const motif = this.mode === GameMode.Dungeon ? THEME_MOTIF[this.dungeonTheme?.id ?? ''] : undefined;
    if (motif === 'pillars' || motif === 'roots' || motif === 'gears') {
      this.combatEngine.defenseBonus += 1;
      this.hud.addCombatMessage(`\ud83d\udee1 The ${motif === 'pillars' ? 'pillars' : motif === 'roots' ? 'roots' : 'machinery'} give the party something to fight behind (+1 AC).`, '#8a8');
    }
    // The room itself takes a hand when a boss holds it.
    const hallFeature = this.currentRoom()?.feature?.kind;
    const floorDc = 11 + Math.floor(this.dungeonLevel / 2);
    this.combatEngine.roomLair = this.mode !== GameMode.Dungeon ? null
      : hallFeature === 'altar' ? { name: 'Altar Flare', description: 'the altar flares with a light that hates the living', damage: '1d6', saveAbility: 'wis', dc: floorDc }
      : hallFeature === 'forge' ? { name: 'Forge Blast', description: 'the forge vents a gout of sparks and molten slag', damage: '2d4', saveAbility: 'dex', dc: floorDc }
      : hallFeature === 'fountain' ? { name: 'Fountain Surge', description: 'the fountain heaves and the floor runs with black water', saveAbility: 'str', dc: floorDc, condition: 'prone', durationTurns: 1 }
      : hallFeature === 'ritual_chamber' ? { name: 'Ritual Backlash', description: 'the circle on the floor wakes and reaches for whoever stands in it', damage: '1d8', saveAbility: 'con', dc: floorDc }
      : null;
    const feature = this.currentRoom()?.feature;
    if (feature?.kind === 'chokepoint' && feature.barricaded) {
      this.combatEngine.defenseBonus = 1;
      this.hud.addCombatMessage('The barricaded chokepoint funnels the foe \u2014 the party fights behind cover (+1 AC).', '#8a8');
    }
    // Transfer tavern rumor buff from TownLife to CombatEngine.
    if (this.townLife && this.currentTown) {
      const tl = this.townLife.byTown[this.currentTown.id];
      if (tl.tavernBuff && tl.tavernBuffFightsLeft > 0) {
        this.combatEngine.tavernBuffDamage = tl.tavernBuff.damageBonus;
        this.combatEngine.tavernBuffAC = tl.tavernBuff.acBonus;
        this.combatEngine.tavernBuffAttack = tl.tavernBuff.attackBonus;
        this.combatEngine.tavernBuffGoldFind = tl.tavernBuff.goldFindBonus;
        this.combatEngine.tavernBuffXp = tl.tavernBuff.xpBonus;
        this.combatEngine.tavernBuffFightsLeft = tl.tavernBuffFightsLeft;
      }
    }
    // The stated delve mood reaches into the fight. Hearth-blessed: the light
    // the party carries burns the undead. Gloom: dread bites harder, so fear
    // saves are a point steeper. Both are only true underground.
    const mood = this.mode === GameMode.Dungeon ? this.delveMood?.label : undefined;
    this.combatEngine.hearthBlessedUndeadBonus = mood === 'hearth-blessed' ? 2 : 0;
    this.combatEngine.gloomFearDcBonus = mood === 'gloom-delve' ? 1 : 0;
    // Weather reaches into the fight: stinging rain throws off weapons;
    // an arcane aurora sharpens casting.
    if (this.weather) {
      this.combatEngine.weatherAttackMod = this.weather.rangedModifier;
      this.combatEngine.weatherSpellMod = this.weather.type === 'magical_aurora' ? 2 : 0;
    } else {
      this.combatEngine.weatherAttackMod = 0;
      this.combatEngine.weatherSpellMod = 0;
    }
    // The calendar flavors the fight itself.
    this.combatEngine.gloomDayUndeadBonus = this.calendar.isGloomDay ? 1 : 0;
    this.combatEngine.fullMoonLycanthropeBonus = this.calendar.moonLight > 0.8 ? 1 : 0;
    // A forged silvered weapon stays with the party wherever they fight.
    this.combatEngine.silveredWeapon = this.silveredWeapon;
    this.combatEngine.moonForgeLevel = this.moonForgeLevel || 1;
    this.combatEngine.moonForgeBlade = this.moonForgeBlade;
    // In the dark, every strike goes slack — the party gropes for footing
    // while creatures bred for shadow see perfectly.
    const nightPenalty = this.mode === GameMode.Overworld && this.clock.light < NIGHT_VISIBILITY_LIGHT ? -1 : 0;
    if (nightPenalty !== 0) {
      this.combatEngine.weatherAttackMod += nightPenalty;
      this.hud.addCombatMessage(`Darkness hampers the party — attacks struggle in the gloom (-${-nightPenalty} attack rolls).`, '#aab');
    }
    this.combatEngine.startCombat(monsters);
    // Monsters dash around walls, not through them.
    this.combatEngine.isTileWalkable = (x, y) => this.map.isWalkable(x, y);
    this.combatEngine.bondBonus = (hero) => this.party.alive.some(a => a !== hero && manhattan(a.tile, hero.tile) <= 1 && (this.bonds[bondKey(a.id, hero.id)] ?? 0) >= 5) ? 1 : 0;
    // A monster's mid-fight cry for help can pull unalerted kin from the rest
    // of the floor into the battle — same kind, capped squad, not every time.
    this.combatEngine.onReinforcementsRequested = () => {
      if (Math.random() > 0.35) return; // the shout usually dies in the dark
      const engaged = new Set(this.combatEngine.monsters.map(m => m));
      const living = this.combatEngine.monsters.filter(m => m.isAlive && !m.fled);
      const kinds = new Set(living.map(m => m.template.id));
      const reserve = this.monsters.filter(m => !engaged.has(m) && m.isAlive && m.alertLevel >= 1 && kinds.has(m.template.id));
      const squad = reserve.slice(0, 1 + (Math.random() < 0.3 ? 1 : 0));
      if (squad.length === 0) return;
      this.combatEngine.addReinforcements(squad);
      const names = [...new Set(squad.map(m => m.template.name))].join(' and ');
      this.hud.addCombatMessage(`🚨 ${names} answers the call — the fight grows!`, '#c86');
    };
    // FF command menu: Manual mode pauses every hero's turn until the DM
    // picks; Auto lets the AI resolve. The toggle lives in the battle window.
    this.combatEngine.setDecisionPause(this.runMode === 'manual');
    this.wireBattleModeToggle();
    // A fresh fight starts with a clean order queue.
    this.combatEngine.queuedOrders.clear();
    this.combatEngine.onItemCommand = (itemId, holderId, actor) => {
      const holder = this.party.members.find(m => m.id === holderId) ?? actor;
      const item = holder.inventory.find(i => i.id === itemId);
      if (item) {
        holder.useItem(itemId);
        this.applyLootedItem(item, actor);
      } else {
        this.hud.addCombatMessage('That item is no longer in the pack.', '#888');
      }
    };
    this.combatEngine.onFleeCommand = (caller) => {
      this.hud.addCombatMessage(`${caller.name} sounds the retreat — the party disengages!`, '#c88');
      this.combatEngine.isActive = false;
      this.combatEngine.decisionPause = false;
      this.phase = GamePhase.Exploration;
      this.hud.setBosses([]);
      this.hud.battleView.close();
      this.partyRetreat();
    };
    this.hud.battleView.onCommand = this.guard(this.handleBattleCommand);
    this.bossBloodiedSaid.clear();
    for (const b of monsters.filter(m => m.isBoss || /\(Boss\)/.test(m.template.name))) {
      this.hud.addCombatMessage(bossOpening(b.template.name.replace(/^\ud83d\udc80 /, '').replace(/ \(Boss\)$/, ''), b.template.type, b.id), '#e0705f');
    }
    this.phase = GamePhase.Combat;
    this.combatTickTimer = 0;
    this.refreshBossBar();
    // Bring up the Final-Fantasy-style battle window for the fight.
    // Its in-window speed control rescales the combat tick directly.
    this.hud.battleView.onSpeedChange = (speed) => { this.combatTickInterval = BattleView.TURN_MS / speed; };
    this.hud.battleView.syncSpeedFromInterval(this.combatTickInterval);
    // Held back long enough for the blinds to close over the map first. The
    // window covers the canvas entirely, so opened at once it would hide the
    // one moment the wipe exists for. A fight that is somehow already over by
    // then does not get a window.
    setTimeout(() => {
      if (this.phase !== GamePhase.Combat) return;
      this.hud.battleView.open(this.party, this.combatEngine.monsters, this.sprites, this.battleScene());
      this.hud.battleView.update({
        round: this.combatEngine.log.round,
        actors: this.combatEngine.initiativeOrder,
        currentActorId: this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex]?.id ?? null,
        messages: ['⚔️ A battle begins!'],
      });
    }, Game.BATTLE_WINDOW_DELAY_MS);

    // Add monsters that were engaged
    const engaged = new Set(monsters.map(m => m.id));          this.hud.addCombatMessage('⚔️ Combat initiated!', '#c84');

    // Monster lore
    for (const m of monsters.slice(0, 2)) {
      this.hud.addCombatMessage(generateMonsterDescription(m.template.id), '#a8a');
    }
    // Party combat bark
    this.hud.addCombatMessage(
      generatePartyCommentary(
        this.party.leader.name,
        this.party.leader.charClass.id,
        this.party.leader.personality,
        'seeing_monster'
      ),
      '#ca8'
    );

    // Battle-worn knowledge: kinds the party has slain enough of to know
    // cold earn tactical banter and a flat edge on every strike against them.
    this.syncKnownFoes();
    const knownHere = new Set<string>();
    for (const m of monsters) {
      const kills = this.history.killLedger[m.template.id] ?? 0;
      if (kills >= KNOWN_FOE_KILLS && !knownHere.has(m.template.id)) {
        knownHere.add(m.template.id);
        this.hud.addCombatMessage(
          '\ud83d\udde1 ' + generateBattleWornBanter(
            m.template.id,
            m.template.name,
            kills,
            {
              name: this.party.leader.name,
              classId: this.party.leader.charClass.id,
              personality: this.party.leader.personality,
            },
          ),
          '#ca8'
        );
      }
    }
    for (const msg of this.combatEngine.log.messages) {
      this.hud.addCombatMessage(msg, '#888');
    }

    this.hud.setParty(this.party);
  }

  /** Usable potions/scrolls from every member's pack, for the battle menu's Item pane. */
  private buildMenuConsumables(): MenuConsumable[] {
    const out: MenuConsumable[] = [];
    for (const m of this.party.alive) {
      for (const i of m.inventory) {
        if (i.type === 'potion' || i.type === 'scroll') {
          out.push({ itemId: i.id, holderId: m.id, name: i.name, holderName: m.name });
        }
      }
    }
    return out;
  }

  /** The DM picked a command in the battle window — execute it and resume. */
  private handleBattleCommand = (heroId: string, cmd: PartyCommand): void => {
    if (cmd.type === 'item') {
      // Items resolve game-side right now; the engine then burns the turn.
      const holder = this.party.members.find(m => m.id === cmd.holderId);
      const actor = this.party.members.find(m => m.id === heroId);
      const item = holder?.inventory.find(i => i.id === cmd.itemId);
      if (holder && actor && item) {
        holder.useItem(item.id);
        this.applyLootedItem(item, actor);
        this.combatEngine.submitCommand(cmd);
        this.hud.addCombatLogBatch(this.combatEngine.log);
      } else {
        this.hud.addCombatMessage('That item is gone — pick another command.', '#c88');
        const decider = this.combatEngine.decisionActor;
        if (decider) {
          this.hud.battleView.showCommandMenu(decider, this.combatEngine.getDecisionSpells(decider), this.buildMenuConsumables(), this.combatEngine.getDecisionAbilities(decider));
        }
      }
      return;
    }

    this.combatEngine.submitCommand(cmd);
    // Push the turn's narration straight into both log surfaces.
    this.hud.addCombatLogBatch(this.combatEngine.log);
    this.hud.setParty(this.party);
    this.refreshBossBar();
    this.hud.battleView.update({
      round: this.combatEngine.log.round,
      actors: this.combatEngine.initiativeOrder,
      currentActorId: this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex]?.id ?? null,
      messages: this.combatEngine.log.messages,
      over: this.combatEngine.log.isOver,
      winner: this.combatEngine.log.winner,
    });
    this.combatEngine.log.messages = [];
    // The paused turn is over — clear the engine's decision flag and let the
    // tick loop resume. If combat ended, the next updateCombat pass resolves it.
    this.hud.setParty(this.party);
  };

  private refreshBossBar() {
    this.hud.setBosses(
      this.combatEngine.getBosses().map(b => ({
        name: b.template.name,
        hp: b.hp,
        maxHp: b.maxHp,
        legendary: b.legendaryActions,
      }))
    );
  }

  // ── Events beyond combat: hazards, camps, parleys, the road ──────────

  /**
   * Show a run of dice and lines in order: each die tumbles and lands, then
   * its line is posted. Lines without a die post at once. The tray is told
   * to leave these dice to us so it does not also show them.
   */
  private async presentRolls(items: { roll: DiceRollEvent | null; line: string; color: string }[]): Promise<void> {
    const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));
    this.hud.dice.deferCombat = true;
    try {
      for (const it of items) {
        if (it.roll && this.running) {
          await this.hud.dice.playRoll(it.roll);
          await sleep(80);
        }
        this.hud.addCombatMessage(it.line, it.color);
      }
    } finally {
      this.hud.dice.deferCombat = false;
    }
    this.hud.setParty(this.party);
  }

  /** Roll with the tray held back, and hand back the roll's event for presenting. */
  private rollHeld<T>(roll: () => T): { result: T; event: DiceRollEvent | null } {
    this.hud.dice.deferCombat = true;
    const before = getDiceHistory().length;
    const result = roll();
    const event = getDiceHistory()[before] ?? null;
    return { result, event };
  }

  /** The room itself is the danger: every member saves, and the failures pay. */
  private async runHazard(feature: RoomFeature): Promise<void> {
    if (!feature.hazard) return;
    feature.used = true;
    const def = hazardByKind(feature.hazard);
    const dc = hazardDc(def, this.dungeonLevel);
    const members = this.party.conscious;
    if (members.length === 0) return;
    const items: { roll: DiceRollEvent | null; line: string; color: string }[] = [];
    items.push({ roll: null, line: `\u26a0 ${def.name.charAt(0).toUpperCase() + def.name.slice(1)} \u2014 ${def.checkName}, DC ${dc}.`, color: '#e8b45a' });
    const rolls: HazardRoll[] = [];
    const events: (DiceRollEvent | null)[] = [];
    for (const m of members) {
      const mod = abilityModifier(m.abilities[def.ability]);
      const label = `${m.name} \u2014 ${def.checkName}`;
      const { result, event } = this.rollHeld(() => def.checkName.endsWith('save')
        ? savingThrow(mod, dc, { label })
        : abilityCheck(mod, dc, label));
      rolls.push({ memberName: m.name, success: result.success });
      events.push(event);
    }
    const outcome = readHazard(def, rolls);
    this.tally('hazards');
    // One line per member follows its die; the group line closes.
    for (let i = 0; i < rolls.length; i++) {
      items.push({ roll: events[i], line: outcome.lines[i], color: rolls[i].success ? '#8c8' : '#c66' });
    }
    items.push({ roll: null, line: outcome.lines[outcome.lines.length - 1], color: outcome.success && outcome.punished.length === 0 ? '#8cf' : '#c84' });
    await this.presentRolls(items);
    // What the failures cost.
    const punished = members.filter(m => outcome.punished.includes(m.name));
    if (punished.length > 0) {
      const p = def.penalty;
      if (p.kind === 'damage') {
        for (const m of punished) this.hud.addCombatMessage(m.takeDamage(rollDice(p.dice[0], p.dice[1])), '#c66');
      } else if (p.kind === 'exhaustion') {
        for (const m of punished) this.hud.addCombatMessage(m.gainExhaustion(), '#c66');
      } else if (p.kind === 'encounter') {
        const templates: MonsterTemplate[] = [];
        for (let i = 0; i < p.count; i++) templates.push(getRandomMonster(Math.max(p.cr, Math.ceil(this.dungeonLevel * 0.75))));
        this.spawnEncounter(templates);
      }
      this.hud.setParty(this.party);
    }
    if (outcome.success) {
      this.grantXp(() => def.xp + this.dungeonLevel * 5);
    }
    this.noteProgress();
  }

  /** One short scene by the fire, with whatever it leaves behind. */
  private campScene(): void {
    const members: CampMember[] = this.party.alive.map(m => ({
      name: m.name,
      className: m.charClass.name,
      raceName: m.race.name,
      hpPct: m.hp / m.maxHp,
      loyalty: m.personality.loyalty,
      caution: m.personality.caution,
      greed: m.personality.greed,
      wisMod: m.wisMod,
      deity: m.deity,
      background: m.background,
    }));
    const scene = pickCampScene(members, {
      placeName: this.entranceBaseName || this.dungeonName,
      floor: this.dungeonLevel,
      nextActTitle: this.storyController.nextPosting()?.title,
    });
    if (!scene) return;
    this.tally('camps');
    const wasPaused = this.paused;
    this.setPaused(true);
    this.hud.showStoryCard({ kicker: 'Camp', title: scene.title, body: scene.body }, () => {
      if (!wasPaused) this.setPaused(false);
      const fx = scene.effect;
      switch (fx.kind) {
        case 'edge':
          this.grantBattleEdge(fx.attack, fx.fights);
          this.hud.addCombatMessage(`\ud83d\udd25 The talk by the fire steadies them: +${fx.attack} to attack rolls for the next ${fx.fights} fights.`, '#e8b45a');
          break;
        case 'heal': {
          const healed = this.party.alive.filter(m => m.hp < m.maxHp);
          for (const m of healed) m.heal(rollDice(fx.dice[0], fx.dice[1]));
          this.hud.addCombatMessage(healed.length > 0 ? `\ud83d\udd25 A good night: ${healed.map(m => m.name).join(', ')} wake stronger than the rest alone would leave them.` : '\ud83d\udd25 A good night. Everyone wakes whole.', '#8cf');
          this.hud.setParty(this.party);
          break;
        }
        case 'watch': {
          const watcher = this.party.alive.find(m => m.name === fx.watcher) ?? this.party.leader;
          const { result, event } = this.rollHeld(() => abilityCheck(watcher.wisMod, fx.dc, `${watcher.name} \u2014 Perception`));
          const read = readWatch(watcher.name, result.success, result.natural);
          void this.presentRolls([{ roll: event, line: `\ud83d\udd6f ${read.lines[0]}`, color: result.success ? '#8c8' : '#c84' }]).then(() => {
            if (read.gold > 0) { this.addGold(read.gold); this.hud.addCombatMessage(`\ud83d\udcb0 +${read.gold} gold from the lost pack.`, '#ffd700'); }
            if (read.ambush && this.mode === GameMode.Dungeon) {
              const cr = Math.max(0.5, this.dungeonLevel * 0.75);
              this.spawnEncounter([getRandomMonster(cr), getRandomMonster(cr)]);
            }
          });
          break;
        }
        case 'omen':
          this.hud.addCombatMessage('\ud83c\udf19 The dream stays with them into the morning. Whatever waits below has their names already.', '#a8a');
          break;
        case 'none':
          break;
      }
    }, { seconds: 12 });
  }

  /** The party's weight and temper, for the parley's judgment. */
  private parleyParty(): ParleyParty {
    const leader = this.party.leader;
    const alive = this.party.alive;
    const avgHpPct = alive.length > 0 ? alive.reduce((s, m) => s + m.hp / m.maxHp, 0) / alive.length : 0;
    return {
      level: leader.level,
      aliveCount: alive.length,
      avgHpPct,
      gold: this.partyGold(),
      alignment: leader.alignment,
      aggression: leader.personality.aggression,
      caution: leader.personality.caution,
      greed: leader.personality.greed,
      bestChaMod: Math.max(...alive.map(m => this.talkMod(m))),
    };
  }

  /** Charisma, with training where the class has it. */
  private talkMod(m: GameCharacter): number {
    const trained = ['bard', 'paladin', 'warlock', 'sorcerer'].includes(m.charClass.id);
    return m.chaMod + (trained ? m.profBonus : 0);
  }

  /**
   * Foes that can talk sometimes would rather. True when the meeting is
   * handled here (peace, or a fight this starts itself once the die lands);
   * false when the caller should simply fight.
   */
  private tryParley(monsters: Monster[], forced?: ParleyOffer): boolean {
    if (this.dmStance === 'aggressive' || this.phase !== GamePhase.Exploration) return false;
    if (monsters.length === 0 || monsters.some(m => this.parleyed.has(m.id))) return false;
    const foes: ParleyFoe[] = monsters.map(m => ({
      name: m.template.name,
      type: m.template.type,
      cr: m.template.cr,
      isBoss: m.isBoss || /\(Boss\)/.test(m.template.name),
    }));
    const party = this.parleyParty();
    if (this.dmPolicies.parley === 'never' && !forced) return false;
    let offer = forced ?? parleyOffer(foes, party);
    // "Always parley": a band that can talk is always given the chance.
    if (!offer && this.dmPolicies.parley === 'always' && canParley(foes)) offer = 'truce';
    if (!offer) return false;
    for (const m of monsters) this.parleyed.add(m.id);
    const speaker = [...this.party.alive].sort((a, b) => this.talkMod(b) - this.talkMod(a))[0];
    const band = [...new Set(monsters.map(m => m.template.name))].join(' and ');
    const opening: Record<ParleyOffer, string> = {
      surrender: `\ud83d\udde3 The ${band} see what they are facing and lower their weapons. One of them offers coin for their lives.`,
      toll: `\ud83d\udde3 The ${band} do not attack. Their leader names a toll for the road, and waits.`,
      truce: `\ud83d\udde3 The ${band} stop short. Neither side is sure of the other. Someone has to speak first.`,
    };
    this.hud.addCombatMessage(opening[offer], '#d8c88a');
    let response = chooseParleyResponse(offer, party);
    if (offer === 'toll' && this.dmPolicies.tolls === 'refuse') response = 'refuse';
    if (offer === 'toll' && this.dmPolicies.tolls === 'pay' && this.partyGold() >= tollFor(foes, party)) response = 'accept';
    let check: { success: boolean; natural: number } | null = null;
    let event: DiceRollEvent | null = null;
    if (response === 'persuade') {
      const dc = parleyDc(offer, foes);
      const rolled = this.rollHeld(() => abilityCheck(this.talkMod(speaker), dc, `${speaker.name} \u2014 Persuasion`));
      check = rolled.result;
      event = rolled.event;
    }
    const result = resolveParley(offer, response, foes, party, speaker.name, check);
    void this.presentRolls(result.lines.map((line, i) => ({ roll: i === 0 ? event : null, line, color: result.fight ? '#c84' : '#8cf' }))).then(() => {
      if (!this.running) return;
      if (result.gold > 0) { this.addGold(result.gold); this.hud.addCombatMessage(`\ud83d\udcb0 +${result.gold} gold.`, '#ffd700'); }
      else if (result.gold < 0) { this.spendGold(-result.gold); this.hud.addCombatMessage(`\ud83d\udcb0 \u2212${-result.gold} gold.`, '#c8a860'); }
      if (result.xp > 0) this.grantXp(() => result.xp);
      if (result.foesLeave) {
        this.tally('parleys');
        if (offer === 'toll' && response === 'refuse') this.tally('tolls_refused');
        for (const m of monsters) m.fled = true;
        this.monsters = this.monsters.filter(m => !monsters.includes(m));
        this.noteProgress();
      }
      if (offer === 'toll' && response === 'refuse') this.tally('tolls_refused');
      if (result.fight && this.phase === GamePhase.Exploration) {
        this.startCombat(monsters.filter(m => m.isAlive));
      }
      this.hud.setParty(this.party);
    });
    return true;
  }

  /** Between towns the road holds more than ambushes. */
  private maybeRoadEvent(): void {
    if (this.mode !== GameMode.Overworld || this.phase !== GamePhase.Exploration) return;
    if (Date.now() < this.roadEventCooldownUntil || Date.now() < this.ambushCooldownUntil) return;
    const leader = this.party.leader;
    const nearTown = (this.overworld?.towns ?? []).some(tn => manhattan(tn.tile, leader.tile) <= 12);
    const event = rollRoadEvent({
      gold: this.partyGold(),
      partyLevel: leader.level,
      weather: this.weather?.type ?? null,
      isSacredDay: this.calendar.isSacredDay,
      nearTown,
      woundedCount: this.party.alive.filter(m => m.hp < m.maxHp / 2).length,
    });
    if (!event) return;
    this.roadEventCooldownUntil = Date.now() + 90000;
    for (const line of event.lines) this.hud.addCombatMessage(line, '#d8c88a');
    this.applyRoadEvent(event);
  }

  private applyRoadEvent(event: RoadEvent): void {
    const leader = this.party.leader;
    const fx = event.effect;
    const say = (line: string | undefined, color: string) => { if (line) this.hud.addCombatMessage(line.replace('{name}', leader.name), color); };
    switch (fx.kind) {
      case 'physician':
        if (this.spendGold(fx.cost)) {
          for (const m of this.party.alive) m.heal(rollDice(fx.heal[0], fx.heal[1]));
          say(event.pass, '#8cf');
        } else {
          say(event.fail, '#a98');
        }
        this.hud.setParty(this.party);
        break;
      case 'blessing':
        this.grantBattleEdge(fx.attack, fx.fights);
        say(event.pass, '#e8b45a');
        this.hud.addCombatMessage(`\u2728 +${fx.attack} to attack rolls for the next ${fx.fights} fights.`, '#e8b45a');
        break;
      case 'toll': {
        const spots = findAmbushTiles(this.map, leader.tile, 3);
        const spawned: Monster[] = [];
        const gang = banditGang(leader.level);
        for (let i = 0; i < gang.length && i < spots.length; i++) {
          const m = this.spawnMonster(gang[i], spots[i]);
          m.alertLevel = 2;
          spawned.push(m);
        }
        if (spawned.length === 0) { this.hud.addCombatMessage('The bridge-keepers think better of it and let the party pass.', '#888'); break; }
        if (!this.tryParley(spawned, 'toll')) this.startCombat(spawned);
        break;
      }
      case 'exposure': {
        if (this.mounted && Math.random() < 0.25) {
          this.mounted = false;
          this.hud.addCombatMessage('\ud83d\udc0e The horse bolts in the storm and is not seen again. The party walks.', '#c84');
        }
        const items: { roll: DiceRollEvent | null; line: string; color: string }[] = [];
        let failed = 0;
        for (const m of this.party.alive) {
          const { result, event: ev } = this.rollHeld(() => savingThrow(m.conMod, fx.dc, { label: `${m.name} \u2014 Constitution save` }));
          if (result.success) {
            items.push({ roll: ev, line: `${m.name} keeps their head down and their feet moving.`, color: '#8c8' });
          } else {
            failed++;
            items.push({ roll: ev, line: m.takeDamage(rollDice(fx.damage[0], fx.damage[1])), color: '#c66' });
          }
        }
        void this.presentRolls(items).then(() => say(failed === 0 ? event.pass : event.fail, failed === 0 ? '#8cf' : '#c84'));
        break;
      }
      case 'contest': {
        const mods: Record<'str' | 'cha' | 'dex', number> = { str: leader.strMod, cha: this.talkMod(leader), dex: leader.dexMod };
        const best = fx.abilities.reduce((a, b) => (mods[b] > mods[a] ? b : a));
        const names: Record<'str' | 'cha' | 'dex', string> = { str: 'Athletics', cha: 'Persuasion', dex: 'Acrobatics' };
        const { result, event: ev } = this.rollHeld(() => abilityCheck(mods[best], fx.dc, `${leader.name} \u2014 ${names[best]}`));
        void this.presentRolls([{ roll: ev, line: (result.success ? event.pass ?? '' : event.fail ?? '').replace('{name}', leader.name), color: result.success ? '#8cf' : '#c84' }]).then(() => {
          if (result.success) {
            this.addGold(fx.gold);
            this.grantXp(() => fx.xp);
            this.hud.addCombatMessage(`\ud83d\udcb0 +${fx.gold} gold, and a story worth telling.`, '#ffd700');
          } else if (fx.lossGold > 0) {
            this.spendGold(fx.lossGold);
            this.hud.addCombatMessage(`\ud83d\udcb0 \u2212${fx.lossGold} gold.`, '#c8a860');
          }
          this.hud.setParty(this.party);
        });
        break;
      }
      case 'gift':
        this.addGold(fx.gold);
        this.grantXp(() => fx.xp);
        this.hud.addCombatMessage(`\ud83d\udcb0 +${fx.gold} gold when the walls come in sight, and thanks that are worth more.`, '#ffd700');
        break;
    }
  }

  // ── Personal quests, prisoners and the living dungeon ─────────────────

  /** Every member has a road; anyone without one (a new run, an old save) is dealt theirs. */
  private ensurePersonalQuests(): void {
    const before = this.personalQuests.length;
    this.personalQuests = dealPersonalQuests(
      this.party.members.map(m => ({ id: m.id, name: m.name, background: m.background, classId: m.charClass.id, deity: m.deity })),
      this.personalQuests,
    );
    for (const q of this.personalQuests.slice(before)) {
      this.hud.addCombatMessage(hookLine(q), '#d8c88a');
      this.expeditionJournal.push(`${q.memberName}'s road: ${q.title}`);
    }
  }

  /** A road ends: the card, the title, the point in the ability it tested. */
  private completePersonalQuest(q: PersonalQuest): void {
    if (q.done) return;
    q.done = true;
    this.tally('roads_done');
    const m = this.party.members.find(x => x.id === q.memberId);
    if (m) {
      m.abilities[q.perk.ability] = Math.min(20, m.abilities[q.perk.ability] + 1);
      m.addXp(100);
    }
    const abilityName: Record<string, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
    this.expeditionJournal.push(`${q.memberName} finished their road: ${q.title}. Now ${q.memberName} ${q.perk.title}.`);
    const wasPaused = this.paused;
    this.setPaused(true);
    this.hud.showStoryCard({
      kicker: 'A road ends',
      title: `${q.memberName} ${q.perk.title}`,
      body: `${q.ending}\n\nThe road tested ${abilityName[q.perk.ability]}, and left its mark: +1 ${abilityName[q.perk.ability]}, and a name the party will use when it matters.`,
    }, () => {
      if (!wasPaused) this.setPaused(false);
      this.hud.addCombatMessage(`\u2726 ${q.memberName} ${q.perk.title}: +1 ${abilityName[q.perk.ability]}, +100 XP.`, '#ffd700');
      this.hud.setParty(this.party);
    }, { seconds: 14 });
  }

  /** Town gates: debts are paid, pilgrimages counted, and an escorted prisoner pays. */
  private personalArrival(town: OverworldTown): void {
    if (this.escortee) {
      const e = this.escortee;
      this.escortee = null;
      this.tally('escortees');
      this.addGold(e.reward);
      this.grantXp(() => 40);
      this.hud.addCombatMessage(`\ud83d\udc9b ${e.name.charAt(0).toUpperCase() + e.name.slice(1)} is home. The money was real: ${e.reward} gold, and a door in ${town.name} that will always open.`, '#ffd700');
    }
    for (const q of this.personalQuests) {
      if (q.done) continue;
      if (q.kind === 'pilgrimage') {
        if (pilgrimageArrives(q, town.id)) this.completePersonalQuest(q);
        else if (q.progress > 0 && q.visited[q.visited.length - 1] === town.id) {
          this.hud.addCombatMessage(`\ud83d\udd6f ${q.memberName} stops at the gate of ${town.name} and speaks a prayer (${q.progress}/${q.target}).`, '#a8a');
        }
      } else if (debtPayable(q, this.partyGold())) {
        if (this.spendGold(q.target)) this.completePersonalQuest(q);
      }
    }
  }

  /** A deep enough floor: a member's rival waits in a far room. */
  private placeRivals(): void {
    if (this.mode !== GameMode.Dungeon) return;
    for (const q of rivalsDueOn(this.personalQuests, this.dungeonLevel)) {
      if (this.monsters.some(m => m.rivalOf === q.memberId)) continue;
      const room = this.rooms[Math.max(1, Math.floor(this.rooms.length / 2))] ?? this.rooms[this.rooms.length - 1];
      if (!room) continue;
      const pos = findEmptyTile(this.map, room, this.monsters) ?? this.walkableIn(room);
      if (!pos) continue;
      const base = getRandomMonster(Math.max(1, this.dungeonLevel), undefined);
      const talker = base.type === 'humanoid' ? base : (getMonsterTemplate('bandit_captain') ?? base);
      const template: MonsterTemplate = { ...talker, name: `${q.rivalName}`, hp: Math.round(talker.hp * 1.5), xp: talker.xp * 2 };
      const rival = this.spawnMonster(template, pos);
      rival.rivalOf = q.memberId;
      this.hud.addCombatMessage(`\ud83d\udc41 ${q.memberName} goes still at the top of the stairs. Somewhere on this floor: ${q.rivalName}. ${q.memberName} would know that laugh anywhere.`, '#e8b45a');
    }
  }

  /** A fallen rival ends its member's road. */
  private checkRivalsSlain(slain: Monster[]): void {
    for (const m of slain) {
      if (!m.rivalOf || m.fled) continue;
      const q = this.personalQuests.find(x => x.memberId === m.rivalOf && !x.done);
      if (q) this.completePersonalQuest(q);
    }
  }

  /** A hoard deep enough may hold what a member lost. */
  private maybeHeirloom(loot: LootResult): void {
    if (this.mode !== GameMode.Dungeon) return;
    if (loot.items.length === 0 && loot.goldValue === 0) return;
    const due = heirloomsPossibleOn(this.personalQuests, this.dungeonLevel);
    if (due.length === 0) return;
    if (Math.random() > (loot.hoard ? 0.7 : 0.3)) return;
    this.completePersonalQuest(due[0]);
  }

  /** Mark the boss hall and the stairs on the map, for a prisoner's dust-map. */
  revealSecrets(): string | null {
    if (this.mode !== GameMode.Dungeon) return null;
    const told: string[] = [];
    const stairs = this.findStairsTile();
    if (stairs) { this.map.reveal(stairs.x, stairs.y, 3); told.push('the way down'); }
    const hall = this.rooms[this.rooms.length - 1];
    if (hall) { this.map.reveal(hall.cx, hall.cy, Math.max(hall.width, hall.height)); told.push('the hall where it sleeps'); }
    if (told.length === 0) return null;
    return `\ud83d\uddfa The map shows ${told.join(' and ')} now.`;
  }

  /** A freed prisoner walks with the party; the next town pays. */
  takeEscortee(name: string, reward: number): void {
    this.escortee = { name, reward };
  }

  /**
   * The dungeon does things on its own: a patrol comes looking, a corridor
   * falls in. Roughly every hundred-odd exploration ticks, and never in a
   * way that cuts the party off from the stairs or the boss.
   */
  private maybeLivingDungeonEvent(): void {
    if (this.mode !== GameMode.Dungeon || this.phase !== GamePhase.Exploration) return;
    this.livingTicks++;
    if (this.livingTicks < 110) return;
    this.livingTicks = 0;
    if (Math.random() < 0.55) this.sendPatrol();
    else this.caveIn();
  }

  /** Two or three of the floor's kind, from a room already seen, coming this way. */
  private sendPatrol(): void {
    const here = this.currentRoomIndex();
    const seen = [...this.visitedRooms].filter(i => i !== here && this.rooms[i]);
    if (seen.length === 0) return;
    const room = this.rooms[seen[Math.floor(Math.random() * seen.length)]];
    const count = 2 + (Math.random() < 0.4 ? 1 : 0);
    const spawned: Monster[] = [];
    const cr = Math.max(0.5, this.dungeonLevel * 0.6);
    for (let i = 0; i < count; i++) {
      const pos = findEmptyTile(this.map, room, this.monsters);
      if (!pos) break;
      const m = this.spawnMonster(getRandomMonster(cr, this.dungeonThemeId()), pos);
      m.alertLevel = 2;
      spawned.push(m);
    }
    if (spawned.length === 0) return;
    const names = [...new Set(spawned.map(m => m.template.name))].join(' and ');
    this.hud.addCombatMessage(`\ud83d\udc63 Footsteps, from a room the party has already been through. A patrol of ${names} is coming this way.`, '#c84');
    sfx.battle();
  }

  /** A corridor tile falls in, if the stairs and the boss hall stay reachable. */
  private caveIn(): void {
    const leader = this.party.leader;
    const inRoom = (x: number, y: number) => this.rooms.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    const candidates: Vector2[] = [];
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        const x = leader.tile.x + dx, y = leader.tile.y + dy;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < 4 || d > 12) continue;
        if (this.map.getTile(x, y) !== TileType.Floor || inRoom(x, y)) continue;
        if (this.monsters.some(m => m.isAlive && m.tile.x === x && m.tile.y === y)) continue;
        if (this.party.members.some(m => m.tile.x === x && m.tile.y === y)) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return;
    const spot = candidates[Math.floor(Math.random() * candidates.length)];
    this.map.setTile(spot.x, spot.y, TileType.Wall);
    const stairs = this.findStairsTile();
    const hall = this.rooms[this.rooms.length - 1];
    const goals = [stairs, hall ? this.walkableIn(hall) : null].filter((g): g is Vector2 => g !== null);
    const cut = goals.some(g => astarPath(this.map, leader.tile, g, { maxNodes: 12000 }).length === 0 && !(g.x === leader.tile.x && g.y === leader.tile.y));
    if (cut) {
      this.map.setTile(spot.x, spot.y, TileType.Floor);
      return;
    }
    this.hud.addCombatMessage('\ud83e\udea8 A groan of stone somewhere close, then a roar of it: a corridor comes down in a boil of dust. When it settles, one way through this place is gone.', '#c8a860');
    this.kickCameraFor(['smashes']);
    sfx.thunder();
  }

  /** The current dungeon's theme id, for monsters that fit the floor. */
  private dungeonThemeId(): string | undefined {
    return this.dungeonTheme?.id ?? undefined;
  }

  // ── Riddle doors, the tavern, and the ceremony ────────────────────────

  /** The puzzle room asks its question. */
  private poseRiddle(feature: RoomFeature): void {
    const riddle = (feature.riddleId && riddleById(feature.riddleId)) || pickRiddle();
    feature.riddleId = riddle.id;
    this.pendingRiddle = { feature, riddle, ticks: 0 };
    this.hud.addCombatMessage(`\ud83d\udeaa A sealed door, and a voice from it that is not quite a voice: "${riddle.text}"`, '#d8c88a');
    this.hud.addCombatMessage('   Answer it in a word, or the party will puzzle at it themselves.', '#887');
    this.manualHold('a riddle door');
  }

  /** The party waits on the DM, then tries its own wits. */
  private tickRiddle(): void {
    const p = this.pendingRiddle;
    if (!p) return;
    if (this.currentRoom()?.feature !== p.feature) {
      // Walked away: the door keeps its question for next time.
      this.pendingRiddle = null;
      return;
    }
    p.ticks++;
    if (p.ticks >= RIDDLE_PATIENCE_TICKS) this.attemptPuzzle(p.feature, (l, c) => this.hud.addCombatMessage(l, c));
  }

  /** The sharpest mind in the party rolls against the door. */
  attemptPuzzle(feature: RoomFeature, say: (l: string, c?: string) => void): void {
    if (feature.used) return;
    if (!this.pendingRiddle || this.pendingRiddle.feature !== feature) this.poseRiddle(feature);
    const thinker = [...this.party.conscious].sort((a, b) => b.intMod - a.intMod)[0];
    if (!thinker) return;
    const dc = riddleDc(this.dungeonLevel);
    const { result, event } = this.rollHeld(() => abilityCheck(thinker.intMod + (thinker.charClass.id === 'wizard' || thinker.charClass.id === 'artificer' ? thinker.profBonus : 0), dc, `${thinker.name} \u2014 Investigation`));
    const riddle = this.pendingRiddle!.riddle;
    if (result.success) {
      void this.presentRolls([{ roll: event, line: `${thinker.name} frowns at the door a long moment, then says it: "${riddle.answers[0]}."`, color: '#8cf' }])
        .then(() => this.solveRiddle('party'));
    } else {
      feature.used = true;
      this.pendingRiddle = null;
      const coin = 5 + Math.floor(Math.random() * 10);
      void this.presentRolls([{ roll: event, line: `${thinker.name} guesses, and guesses wrong. The door goes silent for good; ${coin} gp lie in the dust beneath the lock, dropped by someone who guessed before.`, color: '#a89' }])
        .then(() => { this.addGold(coin); say(`\ud83d\udcb0 +${coin} gold.`, '#ffd700'); });
    }
  }

  /** The door opens: for the DM's word, generously; for the party's, well enough. */
  private solveRiddle(by: 'dm' | 'party'): void {
    const p = this.pendingRiddle;
    if (!p) return;
    this.pendingRiddle = null;
    p.feature.used = true;
    this.tally('riddles');
    const base = 30 + Math.floor(Math.random() * 50);
    const gold = by === 'dm' ? base * 2 : base;
    const xp = by === 'dm' ? 60 : 30;
    sfx.chest();
    if (by === 'dm') {
      this.hud.addCombatMessage(`\ud83d\udeaa "${p.riddle.answers[0]}." The word is yours, and the door knows it: it opens without a sound, as if it had been waiting for someone who would not guess.`, '#ffd700');
    } else {
      this.hud.addCombatMessage('\ud83d\udeaa The door grinds open, grudging every inch.', '#ffd700');
    }
    this.addGold(gold);
    this.grantXp(() => xp);
    this.hud.addCombatMessage(`\ud83d\udcb0 Behind it, a cache: ${gold} gold, and +${xp} XP for the wits.`, '#8cf');
    this.noteProgress();
    if (this.paused && this.runMode === 'manual') this.setPaused(false);
  }

  /** A dice game against the house, on the tray: the party's roller against the house's. */
  private playDiceGame(): void {
    const stake = 15;
    if (this.partyGold() < stake) { this.hud.addCombatMessage('Not enough gold to sit at the table.', '#c66'); return; }
    this.addGold(-stake);
    const roller = [...this.party.alive].sort((a, b) => b.personality.greed - a.personality.greed)[0] ?? this.party.leader;
    const ours = this.rollHeld(() => {
      const n = rollD20();
      pushDiceRoll({ kind: 'free', diceType: 'd20', label: `${roller.name} rolls the bones`, expression: 'd20', rolls: [n], total: n, outcome: n === 20 ? 'crit' : n === 1 ? 'fumble' : 'neutral' });
      return n;
    });
    const house = this.rollHeld(() => {
      const n = rollD20();
      pushDiceRoll({ kind: 'free', diceType: 'd20', label: 'The house rolls', expression: 'd20', rolls: [n], total: n, outcome: n === 20 ? 'crit' : n === 1 ? 'fumble' : 'neutral' });
      return n;
    });
    const items = [
      { roll: ours.event, line: `\ud83c\udfb2 ${roller.name} puts ${stake} gold on the table and rolls: ${ours.result}.`, color: '#d8c88a' },
      { roll: house.event, line: `\ud83c\udfb2 The house rolls: ${house.result}.`, color: '#d8c88a' },
    ];
    void this.presentRolls(items).then(() => {
      if (ours.result === 20) {
        this.tally('dice_won');
        this.addGold(stake * 6);
        this.hud.addCombatMessage(`A natural 20. The table goes quiet, then loud. ${roller.name} sweeps up ${stake * 6} gold and buys the room a round.`, '#ffd700');
      } else if (ours.result === 1) {
        this.hud.addCombatMessage(`A natural 1. The house takes the stake, and ${roller.name}'s boots, and is not unkind about it.`, '#c44');
      } else if (ours.result > house.result) {
        this.tally('dice_won');
        this.addGold(stake * 3);
        this.hud.addCombatMessage(`${roller.name} beats the house. ${stake * 3} gold comes back across the table.`, '#8cf');
      } else if (ours.result === house.result) {
        this.addGold(stake);
        this.hud.addCombatMessage('A push. The stake comes back, and nobody is happy.', '#8a8');
      } else {
        this.hud.addCombatMessage(`The house wins. ${stake} gold gone, and a lesson nobody will learn.`, '#c66');
      }
      this.hud.setParty(this.party);
      this.hud.townPanel.refresh();
    });
  }

  /** A night out: a rumour and standing in town, and a Constitution save or a hangover. */
  private carouse(): void {
    const cost = 20;
    if (!this.currentTown) return;
    if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold for a night like that.', '#c66'); return; }
    this.addGold(-cost);
    const town = this.currentTown;
    const reveller = [...this.party.alive].sort((a, b) => b.chaMod - a.chaMod)[0] ?? this.party.leader;
    const { result, event } = this.rollHeld(() => savingThrow(reveller.conMod, 12, { label: `${reveller.name} \u2014 Constitution save (the morning after)` }));
    const rumor = pickRumor({ town });
    this.adjustTownReputation(town.id, 1);
    const items = [
      { roll: null as DiceRollEvent | null, line: `\ud83c\udf7b ${reveller.name} buys the first round and the fourth, learns three names and a song, and by midnight ${town.name} has decided the party is all right.`, color: '#d8c88a' },
      { roll: null as DiceRollEvent | null, line: `\ud83d\udde3 Someone leans in: "${rumor.text}"`, color: '#a8a' },
      { roll: event, line: result.success
        ? `${reveller.name} wakes clear-headed, which is frankly unfair.`
        : `${reveller.name} wakes on the floor of the common room with a head like a struck bell.`, color: result.success ? '#8c8' : '#c84' },
    ];
    void this.presentRolls(items).then(() => {
      if (!result.success) this.hud.addCombatMessage(reveller.gainExhaustion(), '#c66');
      this.grantXp(() => 25);
      this.hud.addCombatMessage(`\u2b50 Standing in ${town.name} rises. +25 XP for the stories.`, '#8cf');
      this.hud.setParty(this.party);
      this.hud.townPanel.refresh();
    });
  }

  /** Levels compared each step: anyone who rose gets a ceremony, one at a time. */
  private checkLevelUps(): void {
    for (const m of this.party.members) {
      const known = this.knownLevels.get(m.id);
      if (known === undefined) { this.knownLevels.set(m.id, m.level); continue; }
      if (m.level > known) {
        this.knownLevels.set(m.id, m.level);
        if (m.isAlive && !this.ceremonyQueue.includes(m)) this.ceremonyQueue.push(m);
      }
    }
    if (!this.ceremonyOpen && this.ceremonyQueue.length > 0 && this.phase !== GamePhase.Combat) {
      this.levelUpCeremony(this.ceremonyQueue.shift()!);
    }
  }

  /** The class's defining ability, for the tempering choice. */
  private keyAbility(m: GameCharacter): Ability {
    const table: Record<string, Ability> = {
      fighter: 'str', barbarian: 'str', paladin: 'str', blood_hunter: 'str',
      rogue: 'dex', ranger: 'dex', monk: 'dex',
      wizard: 'int', artificer: 'int',
      cleric: 'wis', druid: 'wis',
      bard: 'cha', sorcerer: 'cha', warlock: 'cha',
    };
    return table[m.charClass.id] ?? 'str';
  }

  /** A short rite at each new level: the party chooses what the growth becomes. */
  private levelUpCeremony(m: GameCharacter): void {
    this.ceremonyOpen = true;
    const abilityName: Record<Ability, string> = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
    const key = this.keyAbility(m);
    const options = [
      { id: 'vigor', label: 'Vigour', text: `Harder to put down: +3 hit points for good.` },
      { id: 'temper', label: 'Tempering', text: `Sharpen what ${m.name} is: +1 ${abilityName[key]}${m.abilities[key] >= 20 ? ' (already at its peak; +3 hit points instead)' : ''}.` },
      { id: 'fortune', label: 'Fortune', text: 'A fated die: the party\'s next d20 comes up a 17, whatever it is for.' },
    ];
    const wasPaused = this.paused;
    this.setPaused(true);
    const fallback = () => {
      const p = m.personality;
      if (p.caution >= 6) return options[0];
      if (p.greed >= 6) return options[2];
      return options[1];
    };
    this.hud.showStoryChoice(
      `\u2b06 ${m.name} reaches level ${m.level}. Around the fire, or wherever they stand, the others notice: something has set in ${m.name} that was not there before. What does it become?`,
      options,
      (o) => {
        if (!wasPaused) this.setPaused(false);
        this.ceremonyOpen = false;
        if (o.id === 'vigor' || (o.id === 'temper' && m.abilities[key] >= 20)) {
          m.baseMaxHp += 3;
          m.hp = Math.min(m.maxHp, m.hp + 3);
          this.hud.addCombatMessage(`\u2b06 ${m.name} \u2014 Vigour: +3 hit points (${m.maxHp} now).`, '#7c7');
        } else if (o.id === 'temper') {
          m.abilities[key] += 1;
          this.hud.addCombatMessage(`\u2b06 ${m.name} \u2014 Tempering: ${abilityName[key]} ${m.abilities[key]}.`, '#7c7');
        } else {
          grantLuckDie({ value: 17, source: `${m.name}'s fortune` });
          this.hud.addCombatMessage(`\u2b06 ${m.name} \u2014 Fortune: the party's next d20 is fated to a 17.`, '#ffd700');
        }
        this.hud.setParty(this.party);
      },
      { seconds: this.runMode === 'manual' ? 45 : 12, fallback },
      this.sprites.getSpriteCanvas(m),
    );
  }

  /** The pre-built dungeon behind the gate the party came in by, if it was one. */
  private currentPrebuilt() {
    const entrance = this.overworld?.entrances.find(e => e.id === this.dungeonEntranceId);
    return getPrebuilt(entrance?.prebuiltId);
  }

  /**
   * A pre-built floor: every creature on its own tile, the boss in its hall.
   * An accepted hunt still gets its quarry, placed in a room or two, so a
   * fixed roster never makes a posting impossible.
   */
  private populatePrebuiltFloor(floor: PrebuiltFloor): void {
    for (const [id, x, y] of floor.monsters) {
      const template = getMonsterTemplate(id);
      if (!template) continue;
      if (!this.map.isWalkable(x, y) || this.monsters.some(m => m.tile.x === x && m.tile.y === y)) continue;
      this.spawnMonster(template, { x, y });
    }
    const hunt = this.activeHuntTarget();
    if (hunt && hunt.remaining > 0 && hunt.template.cr <= Math.max(0.25, Math.floor(this.dungeonLevel / 2))) {
      let placed = 0;
      for (let i = 1; i < this.rooms.length - 1 && placed < Math.min(2, hunt.remaining); i++) {
        const pos = findEmptyTile(this.map, this.rooms[i], this.monsters);
        if (!pos) continue;
        this.spawnMonster(hunt.template, pos);
        placed++;
      }
      if (placed > 0) this.narrateHuntEncounter(hunt);
    }
    if (this.rooms.length > 1) {
      const [bossId, bx, by] = floor.boss;
      const template = getMonsterTemplate(bossId);
      const hall = this.rooms[this.rooms.length - 1];
      this.spawnFloorBoss(hall, template ? { template, pos: { x: bx, y: by } } : undefined);
    }
    this.traps = placeTraps(this.map, this.rooms, this.monsters, this.dungeonLevel);
  }

  /** One more of a thing done, for the achievements. */
  tally(key: string): void {
    this.counters[key] = (this.counters[key] ?? 0) + 1;
  }

  /** What the run looks like right now, for the achievements. */
  private achievementSnapshot(): AchievementSnapshot {
    const d = getDiceStats();
    return {
      kills: this.history.kills,
      victories: this.history.victories,
      defeats: this.history.defeats,
      deepest: this.history.deepestLevel,
      rooms: this.history.roomsVisited,
      gold: this.partyGold(),
      rolls: d.rolls,
      crits: d.crits,
      fumbles: d.fumbles,
      bestCritStreak: d.bestCritStreak,
      maxLevel: Math.max(0, ...this.party.members.map(m => m.level)),
      members: this.party.members.length,
      actsDone: this.story?.actsDone ?? 0,
      storyComplete: this.story?.complete ?? false,
      hardcore: this.hardcore,
      day: Math.floor(this.clock.elapsed / DAY_MS) + 1,
      counters: this.counters,
    };
  }

  /** Anything newly true is earned: a line now, a card when there is a quiet moment. */
  private checkAchievements(): void {
    if (!this.runStarted) return;
    const earned = newlyEarned(this.achievementSnapshot(), new Set(this.achievements));
    for (const a of earned) {
      this.achievements.push(a.id);
      this.achievementQueue.push(a.id);
      this.hud.addCombatMessage(`\ud83c\udfc5 ${a.title}: ${a.text} The party may be called ${a.epithet}.`, '#ffd700');
      this.expeditionJournal.push(`Earned: ${a.title}`);
      sfx.levelUp();
    }
    this.showNextAchievement();
  }

  private showNextAchievement(): void {
    if (this.achievementCardOpen || this.phase === GamePhase.Combat || this.hud.battleView.isVisible()) return;
    if (document.querySelector('#story-card')) return;
    const id = this.achievementQueue.shift();
    if (!id) return;
    const a = achievementById(id);
    if (!a) return;
    this.achievementCardOpen = true;
    const wasPaused = this.paused;
    this.setPaused(true);
    this.hud.showStoryCard({ kicker: 'Achievement', title: a.title, body: `${a.text}\n\nFrom here the party may be called ${a.epithet}.` }, () => {
      if (!wasPaused) this.setPaused(false);
      this.achievementCardOpen = false;
      this.showNextAchievement();
    }, { seconds: 8 });
  }

  // ── Doors, keys, torches, and the DM's pointing finger ────────────────

  /** After the floor is peopled: lock the boss hall behind a keeper, hide a room, light a torch. */
  private dressFloor(): void {
    this.floorLocked = false;
    this.floorKeyHeld = false;
    this.lockedNoticeGiven = false;
    this.secretDoors = [];
    this.waypoint = null;
    this.darkness = false;
    this.combatEngine.darkness = false;
    if (this.torchLeft <= 0) this.relight();
    if (this.rooms.length >= 4) {
      if (Math.random() < 0.55) this.lockBossHall();
      if (Math.random() < 0.6) this.hideRoom();
    }
  }

  /** The boss hall's doors are locked; a monster elsewhere on the floor carries the key. */
  private lockBossHall(): void {
    const hall = this.rooms[this.rooms.length - 1];
    const inHall = (x: number, y: number) => x >= hall.x && x < hall.x + hall.width && y >= hall.y && y < hall.y + hall.height;
    const entrances: Vector2[] = [];
    for (let x = hall.x - 1; x <= hall.x + hall.width; x++) {
      for (const y of [hall.y - 1, hall.y + hall.height]) {
        if (this.map.getTile(x, y) === TileType.Floor && (this.map.isWalkable(x, y + 1) && inHall(x, y + 1) || this.map.isWalkable(x, y - 1) && inHall(x, y - 1))) entrances.push({ x, y });
      }
    }
    for (let y = hall.y; y < hall.y + hall.height; y++) {
      for (const x of [hall.x - 1, hall.x + hall.width]) {
        if (this.map.getTile(x, y) === TileType.Floor && (this.map.isWalkable(x + 1, y) && inHall(x + 1, y) || this.map.isWalkable(x - 1, y) && inHall(x - 1, y))) entrances.push({ x, y });
      }
    }
    if (entrances.length === 0 || entrances.length > 3) return;
    const start = this.rooms[0];
    const candidates = this.monsters.filter(m => m.isAlive && !m.isBoss && !/\(Boss\)/.test(m.template.name) && !m.rivalOf
      && !inHall(m.tile.x, m.tile.y)
      && !(m.tile.x >= start.x && m.tile.x < start.x + start.width && m.tile.y >= start.y && m.tile.y < start.y + start.height));
    if (candidates.length === 0) return;
    const keeper = candidates[Math.floor(Math.random() * candidates.length)];
    keeper.hasKey = true;
    keeper.template = { ...keeper.template, name: `${keeper.template.name} the Keykeeper`, hp: Math.round(keeper.template.hp * 1.3) };
    keeper.maxHp = Math.round(keeper.maxHp * 1.3);
    keeper.hp = keeper.maxHp;
    for (const e of entrances) this.map.setTile(e.x, e.y, TileType.LockedDoor);
    this.floorLocked = true;
  }

  /** A small room carved into the rock behind a stretch of wall, with a door that looks like wall. */
  private hideRoom(): void {
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 3 + Math.floor(Math.random() * (this.map.width - 6));
      const y = 3 + Math.floor(Math.random() * (this.map.height - 6));
      if (this.map.getTile(x, y) !== TileType.Wall) continue;
      const open = dirs.find(([dx, dy]) => this.map.getTile(x + dx, y + dy) === TileType.Floor);
      if (!open) continue;
      const [dx, dy] = [-open[0], -open[1]];
      const w = dx === 0 ? 4 : 3, h = dx === 0 ? 3 : 4;
      const rx = dx === 1 ? x + 1 : dx === -1 ? x - w : x - 1;
      const ry = dy === 1 ? y + 1 : dy === -1 ? y - h : y - 1;
      let clear = rx >= 2 && ry >= 2 && rx + w < this.map.width - 2 && ry + h < this.map.height - 2;
      for (let yy = ry - 1; clear && yy <= ry + h; yy++) for (let xx = rx - 1; clear && xx <= rx + w; xx++) {
        if (xx === x && yy === y) continue;
        if (this.map.getTile(xx, yy) !== TileType.Void && this.map.getTile(xx, yy) !== TileType.Wall) clear = false;
      }
      if (!clear) continue;
      for (let yy = ry; yy < ry + h; yy++) for (let xx = rx; xx < rx + w; xx++) this.map.setTile(xx, yy, TileType.Floor);
      for (let yy = ry - 1; yy <= ry + h; yy++) for (let xx = rx - 1; xx <= rx + w; xx++) {
        if (this.map.getTile(xx, yy) === TileType.Void) this.map.setTile(xx, yy, TileType.Wall);
      }
      this.map.setTile(x, y, TileType.SecretDoor);
      const room: Room = { x: rx, y: ry, width: w, height: h, cx: rx + Math.floor(w / 2), cy: ry + Math.floor(h / 2) };
      this.secretDoors.push({ x, y, room, found: false, tries: 0 });
      return;
    }
  }

  /** A member beside a locked door: it opens for the key, or says what it wants. */
  private checkLockedDoors(): void {
    if (!this.floorLocked) return;
    const near = this.party.members.some(m => dirsAround(m.tile).some(t => this.map.getTile(t.x, t.y) === TileType.LockedDoor));
    if (!near) return;
    const keeperAlive = this.monsters.some(m => m.isAlive && m.hasKey);
    if (this.floorKeyHeld || !keeperAlive) {
      for (let y = 0; y < this.map.height; y++) for (let x = 0; x < this.map.width; x++) {
        if (this.map.getTile(x, y) === TileType.LockedDoor) this.map.setTile(x, y, TileType.Door);
      }
      this.floorLocked = false;
      this.hud.addCombatMessage(this.floorKeyHeld ? '\ud83d\udd13 The iron key turns. The hall is open.' : '\ud83d\udd13 The lock is old and the key lies in the dust before it. The hall is open.', '#ffd700');
      sfx.chest();
      this.noteProgress();
      this.dungeonRoute = [];
      return;
    }
    if (!this.lockedNoticeGiven) {
      this.lockedNoticeGiven = true;
      const keeper = this.monsters.find(m => m.isAlive && m.hasKey);
      this.hud.addCombatMessage(`\ud83d\udd12 The hall is locked, and the lock is not for picking. Somewhere on this floor, ${keeper?.template.name ?? 'something'} carries the key.`, '#e8b45a');
      this.dungeonRoute = [];
    }
  }

  /** A member beside a hidden door: the sharpest eyes look for the seam. */
  private checkSecretDoors(): void {
    for (const sd of this.secretDoors) {
      if (sd.found || sd.tries >= 2) continue;
      const near = this.party.members.some(m => Math.abs(m.tile.x - sd.x) + Math.abs(m.tile.y - sd.y) <= 1);
      if (!near) continue;
      sd.tries++;
      const scout = this.bestScout();
      const dc = 12 + Math.floor(this.dungeonLevel / 2);
      const { result, event } = this.rollHeld(() => abilityCheck(scout.intMod + (scout.charClass.id === 'rogue' ? scout.profBonus : 0), dc, `${scout.name} \u2014 Investigation (a draught from the wall)`));
      if (result.success) {
        sd.found = true;
        this.map.setTile(sd.x, sd.y, TileType.Door);
        this.rooms.push(sd.room);
        assignFeature(sd.room, this.dungeonLevel, { force: true });
        this.map.reveal(sd.room.cx, sd.room.cy, 4);
        const gold = 30 + this.dungeonLevel * 25 + Math.floor(Math.random() * 30);
        void this.presentRolls([{ roll: event, line: `\ud83d\udeaa ${scout.name} feels the draught, finds the seam, and a section of wall swings in on a room no one has seen in a very long time.`, color: '#ffd700' }]).then(() => {
          this.addGold(gold);
          this.grantXp(() => 40 + this.dungeonLevel * 10);
          this.tally('secrets');
          this.hud.addCombatMessage(`\ud83d\udcb0 Dust, and under the dust ${gold} gold${sd.room.feature ? `, and ${sd.room.feature.name}` : ''}.`, '#8cf');
          this.dungeonRoute = [];
          this.noteProgress();
        });
      } else {
        void this.presentRolls([{ roll: event, line: `${scout.name} runs a hand along the wall where the air moves, and finds only wall. For now.`, color: '#a98' }]);
      }
      return;
    }
  }

  /** The torch burns down; the next is lit, or the dark comes. */
  private tickTorch(): void {
    if (this.torchLeft > 0) {
      this.torchLeft -= this.floorWeather === 'cold' ? 2 : 1;
      if (this.torchLeft < 0) this.torchLeft = 0;
      if (this.torchLeft === 120) this.hud.addCombatMessage('\ud83d\udd25 The torch gutters. Not long left in it.', '#a98');
      if (this.torchLeft === 0) this.relight();
    }
  }

  private relight(): void {
    if (this.torches > 0) {
      this.torches--;
      this.torchLeft = Game.TORCH_TICKS;
      this.darkness = false;
      this.combatEngine.darkness = false;
      this.hud.addCombatMessage(`\ud83d\udd25 ${this.party.leader.name} lights a fresh torch. ${this.torches} left in the pack.`, '#e8b45a');
    } else if (!this.darkness) {
      this.darkness = true;
      this.combatEngine.darkness = true;
      this.hud.addCombatMessage('\ud83c\udf11 The last torch dies. The dark comes in close, and everything in it can see the party better than the party can see it. Torches are sold in any town.', '#c84');
    }
  }

  /** A click on the map marks a tile; the party goes there before anything else. */
  private onMapPointer(e: PointerEvent): void {
    const el = e.target as HTMLElement | null;
    if (!(el instanceof HTMLCanvasElement) || !this.runStarted || this.phase === GamePhase.Combat || this.mode === GameMode.Town) return;
    if (e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (GAME_WIDTH / rect.width) + this.camera.x;
    const py = (e.clientY - rect.top) * (GAME_HEIGHT / rect.height) + this.camera.y;
    const tile = { x: Math.floor(px / TILE_SIZE), y: Math.floor(py / TILE_SIZE) };
    if (!this.map.isWalkable(tile.x, tile.y)) return;
    if (this.mode === GameMode.Dungeon && !this.map.explored[tile.y]?.[tile.x]) return;
    this.waypoint = tile;
    this.dungeonRoute = [];
    this.overworldPath = [];
    this.hud.addCombatMessage(`\ud83d\udccd You point. The party heads for the spot (${tile.x}, ${tile.y}).`, '#8cf');
    sfx.order();
  }

  /** In the dungeon, a marked tile is the party's whole plan until it stands on it. */
  private followWaypoint(): boolean {
    const w = this.waypoint;
    if (!w) return false;
    const leader = this.party.leader;
    if (leader.tile.x === w.x && leader.tile.y === w.y) {
      this.waypoint = null;
      this.hud.addCombatMessage('\ud83d\udccd The party reaches the spot you marked and looks to you.', '#8cf');
      this.manualHold('the marked spot');
      return false;
    }
    const route = astarPath(this.map, leader.tile, w, { maxNodes: 8000 });
    const next = route[0];
    if (!next) {
      this.waypoint = null;
      this.hud.addCombatMessage('\ud83d\udccd There is no way through to the spot you marked. The party carries on.', '#886');
      return false;
    }
    const dx = Math.sign(next.x - leader.tile.x);
    const dy = Math.sign(next.y - leader.tile.y);
    const dir = dx === 1 ? Direction.Right : dx === -1 ? Direction.Left : dy === 1 ? Direction.Down : Direction.Up;
    return this.moveParty(dir);
  }

  /** The floor before the act's boss holds the boss's lieutenant. */
  private placeLieutenant(): void {
    const act = this.story?.act;
    if (!act || this.mode !== GameMode.Dungeon) return;
    if (this.dungeonEntranceId !== act.entranceId || this.dungeonLevel !== act.targetFloor - 1 || act.targetFloor < 2) return;
    if (this.lieutenantActIndex === act.index) return;
    this.lieutenantActIndex = act.index;
    const room = this.rooms[Math.max(1, Math.floor(this.rooms.length * 0.66))];
    if (!room) return;
    const pos = findEmptyTile(this.map, room, this.monsters) ?? this.walkableIn(room);
    if (!pos) return;
    const base = getRandomMonster(Math.max(1, this.dungeonLevel), this.dungeonTheme?.id);
    const template: MonsterTemplate = { ...base, name: `${act.bossName}'s lieutenant`, hp: Math.round(base.hp * 1.4), xp: base.xp * 2, attackBonus: base.attackBonus + 1 };
    const lt = this.spawnMonster(template, pos);
    lt.alertLevel = 1;
    this.tally('lieutenants');
    this.hud.addCombatMessage(`\ud83d\udc41 Somewhere on this floor, ${act.bossName}'s lieutenant keeps the stair. The master is one floor further down, and knows the party is coming.`, '#e8b45a');
  }

  /** A map in the pack lays the floor out the moment the party arrives. */
  private useDungeonMap(): void {
    const holder = this.party.members.find(m => m.hasItem('dungeon_map'));
    if (!holder || this.mode !== GameMode.Dungeon) return;
    holder.useItem('dungeon_map');
    for (const r of this.rooms) this.map.reveal(r.cx, r.cy, Math.max(r.width, r.height) + 1);
    this.hud.addCombatMessage(`\ud83d\uddfa ${holder.name} unfolds the map. It is this floor, and it is good: every room, every turn, the stair.`, '#8cf');
  }

  /** An altar asks for something, and gives something back, or is passed by. */
  private shrineChoice(feature: RoomFeature): void {
    const options = [
      { id: 'gold', label: 'Offer coin', text: '25 gold on the stone, for a blessing on the blades: +1 to attack rolls for three fights.' },
      { id: 'blood', label: 'Offer blood', text: 'Every member gives 1d4 of their own. The old gods pay better: +2 to attack rolls for three fights, and the wounds close again after.' },
      { id: 'pass', label: 'Pass by', text: 'Whatever it was for, it is not for the party.' },
    ];
    const leader = this.party.leader;
    const fallback = () => leader.personality.greed >= 6 ? options[2] : leader.personality.aggression >= 6 ? options[1] : this.partyGold() >= 25 ? options[0] : options[2];
    const wasPaused = this.paused;
    this.setPaused(true);
    this.hud.showStoryChoice(`\u26e9 ${feature.entryLine} The stone wants something, and says nothing.`, options, (o) => {
      if (!wasPaused) this.setPaused(false);
      if (o.id === 'gold') {
        if (!this.spendGold(25)) { this.hud.addCombatMessage('The party has not the coin, and the stone does not take promises.', '#886'); return; }
        feature.used = true;
        this.grantBattleEdge(1, 3);
        this.tally('offerings');
        this.hud.addCombatMessage('\u26e9 The coin is gone before it lands. Something is pleased. +1 to attack rolls for three fights.', '#e8b45a');
      } else if (o.id === 'blood') {
        feature.used = true;
        for (const m of this.party.alive) this.hud.addCombatMessage(m.takeDamage(Math.max(1, Math.min(m.hp - 1, rollDice(1, 4)))), '#c66');
        this.grantBattleEdge(2, 3);
        this.tally('offerings');
        this.hud.addCombatMessage('\u26e9 The blood soaks into the stone and does not stain it. +2 to attack rolls for three fights, and the wounds already itch with healing.', '#e8b45a');
        for (const m of this.party.alive) m.heal(rollDice(1, 4));
        this.hud.setParty(this.party);
      } else {
        this.hud.addCombatMessage('The party passes the altar without touching it. The stone remembers that too.', '#887');
      }
    }, { seconds: 15, fallback });
  }

  /** Word comes along the road that a town has a band at its gates. */
  private maybeSiege(): void {
    if (!this.overworld || Object.keys(this.sieges).length > 0 || Math.random() > 0.006) return;
    const towns = this.overworld.towns.filter(t => t.id !== this.currentTown?.id);
    if (towns.length === 0) return;
    const town = towns[Math.floor(Math.random() * towns.length)];
    const strength = 2 + Math.floor(this.party.leader.level / 2);
    this.sieges[town.id] = { strength, since: Math.floor(this.clock.elapsed / DAY_MS) + 1 };
    this.hud.addCombatMessage(`\ud83c\udff0 A rider on a lathered horse: ${town.name} has a band at its gates and cannot get its harvest in. Whoever breaks the siege will not pay for a drink there again.`, '#e8b45a');
    this.expeditionJournal.push(`${town.name} besieged`);
  }

  /** A besieged town is entered through its besiegers. True when the gate fight has started. */
  private siegeAtGate(town: OverworldTown): boolean {
    const siege = this.sieges[town.id];
    if (!siege) return false;
    delete this.sieges[town.id];
    const gang = banditGang(this.party.leader.level);
    while (gang.length < siege.strength + 1) gang.push(gang[gang.length - 1]);
    const spots = findAmbushTiles(this.map, this.party.leader.tile, gang.length);
    const spawned: Monster[] = [];
    for (let i = 0; i < gang.length && i < spots.length; i++) {
      const m = this.spawnMonster(gang[i], spots[i]);
      m.alertLevel = 2;
      spawned.push(m);
    }
    if (spawned.length === 0) return false;
    this.hud.addCombatMessage(`\ud83c\udff0 The band at the gates of ${town.name} turns from the walls to the road. ${spawned.length} of them, and the town watching from the ramparts.`, '#c84');
    this.adjustTownReputation(town.id, 3);
    this.grantXp(() => 30 * siege.strength);
    this.addGold(20 * siege.strength);
    this.hud.addCombatMessage(`\u2b50 ${town.name} will remember who came. Reputation rises, and the purse is ${20 * siege.strength} gold heavier for it.`, '#ffd700');
    this.tally('sieges');
    this.startCombat(spawned);
    return true;
  }

  // ── The party's own things: bonds, contracts, familiars, retirement ────

  /** Every pair standing close at a victory grows a little closer. */
  private strengthenBonds(): void {
    const alive = this.party.alive;
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        if (manhattan(a.tile, b.tile) > 2) continue;
        const key = bondKey(a.id, b.id);
        this.bonds[key] = (this.bonds[key] ?? 0) + 1;
        if (this.bonds[key] === 5) {
          this.hud.addCombatMessage(`\ud83e\udd1d ${a.name} and ${b.name} have fought side by side long enough to know each other's blind side. Adjacent, each hits truer.`, '#e8b45a');
          this.expeditionJournal.push(`${a.name} and ${b.name} bonded`);
          this.tally('bonds');
        }
      }
    }
  }

  /** A new floor: each hireling's contract runs a floor shorter, and runs out. */
  private tickHirelings(): void {
    for (const id of Object.keys(this.hirelings)) {
      const m = this.party.members.find(x => x.id === id);
      if (!m) { delete this.hirelings[id]; continue; }
      this.hirelings[id]--;
      if (this.hirelings[id] > 0) continue;
      delete this.hirelings[id];
      const pay = 15 + m.level * 5;
      const paid = this.spendGold(pay);
      const i = this.party.members.indexOf(m);
      if (i >= 0 && this.party.members.length > 1) {
        this.party.members.splice(i, 1);
        if (this.party.formation[i]) this.party.formation.splice(i, 1);
        if (i < this.party.leaderIndex) this.party.leaderIndex--;
        else if (i === this.party.leaderIndex) this.party.leaderIndex = 0;
      }
      this.hud.addCombatMessage(paid
        ? `\ud83d\udcdc ${m.name}'s contract is up at the stairwell. ${pay} gold changes hands, and ${m.name} climbs out whistling.`
        : `\ud83d\udcdc ${m.name}'s contract is up, and the purse cannot cover the ${pay} owed. ${m.name} takes it from the next hoard's share in the telling, and climbs out sour.`, '#a98');
      this.hud.setParty(this.party);
    }
  }

  /** Casters and rangers keep something small at heel; anyone without one is given theirs. */
  private ensureFamiliars(): void {
    const kinds: Record<string, string[]> = { wizard: ['cat', 'owl', 'raven'], sorcerer: ['cat', 'weasel'], warlock: ['imp', 'raven', 'toad'], ranger: ['hound', 'hawk'], druid: ['fox', 'owl', 'toad'], artificer: ['weasel'] };
    const names = ['Soot', 'Pip', 'Wren', 'Ash', 'Bramble', 'Quill', 'Moth', 'Tansy', 'Rook', 'Ember', 'Nettle', 'Gimble'];
    for (const m of this.party.members) {
      const pool = kinds[m.charClass.id];
      if (!pool) continue;
      if (!this.familiars[m.id]) {
        const kind = pool[Math.floor(Math.random() * pool.length)];
        const name = names[Math.floor(Math.random() * names.length)];
        this.familiars[m.id] = { kind, name };
        this.hud.addCombatMessage(`\ud83d\udc3e ${m.name} has ${name}, a ${kind}, who goes where ${m.name} goes and notices what ${m.name} misses.`, '#a8a');
      }
      m.familiar = this.familiars[m.id];
    }
  }

  /** A member of twenty levels in a town may retire there, and hand out work from a chair by the fire. */
  private maybeOfferRetirement(town: OverworldTown): void {
    if (this.party.members.length < 2) return;
    const m = this.party.members.find(x => x.level >= 20 && !this.retireOffered.has(x.id) && !x.isTemporaryCompanion);
    if (!m) return;
    this.retireOffered.add(m.id);
    const wasPaused = this.paused;
    this.setPaused(true);
    this.hud.showStoryChoice(`${m.name} is level ${m.level}, and ${town.name} has a chair by the fire and a board that needs a hand who knows the deep. ${m.name} could stop here.`, [
      { id: 'retire', label: `${m.name} retires`, text: `${m.name} leaves the party and becomes a quest giver in ${town.name}, with work for the ones who go on.` },
      { id: 'stay', label: 'Not yet', text: 'There is more road in them.' },
    ], (o) => {
      if (!wasPaused) this.setPaused(false);
      if (o.id !== 'retire') return;
      const i = this.party.members.indexOf(m);
      this.party.members.splice(i, 1);
      if (this.party.formation[i]) this.party.formation.splice(i, 1);
      if (i < this.party.leaderIndex) this.party.leaderIndex--;
      else if (i === this.party.leaderIndex) this.party.leaderIndex = 0;
      this.retired.push(m.name);
      const tl = this.townLife?.byTown[town.id];
      const specialty = ['fighter', 'barbarian', 'paladin', 'monk', 'blood_hunter'].includes(m.charClass.id) ? 'combat' : ['wizard', 'artificer', 'sorcerer'].includes(m.charClass.id) ? 'lore' : ['cleric', 'warlock'].includes(m.charClass.id) ? 'faith' : ['rogue', 'bard'].includes(m.charClass.id) ? 'stealth' : 'nature';
      if (tl) {
        const line = (s: string) => [`"${s}"`];
        tl.questGivers.push({
          id: `retired_${m.id}`, name: m.name, title: `Retired ${m.charClass.name}`, portrait: '\ud83c\udfc5', portraitColor: '#e8c56a',
          backstory: `${m.name} went further down than anyone in ${town.name} and came back to sit by the fire. The board by the door is theirs now.`,
          dialogue: {
            stranger: line('You have the look. I had it too. Take the posting and come back with the look gone.'),
            acquaintance: line('You again. Good. The deep is no place for strangers, and you are not one any more.'),
            trusted: line('I would go with you if these knees would let me. Take this instead, and my name for the door.'),
            legend: line('They will tell it about you the way they tell it about me. Make it a good one.'),
          },
          specialty, repPerQuest: 25, reputation: 0,
        });
      }
      this.hud.addCombatMessage(`\ud83c\udfc5 ${m.name} sits down in ${town.name} and does not get up. There is a board by the door now with ${m.name}'s name on it.`, '#ffd700');
      this.expeditionJournal.push(`${m.name} retired to ${town.name}`);
      this.tally('retired');
      this.hud.setParty(this.party);
    }, { seconds: 30, fallback: () => ({ id: 'stay', label: 'Not yet', text: '' }) });
  }

  // ── Magic beyond the fight: rituals, scrolls, patrons, summons ────────

  /** At the fire the casters do the slow work: reading, identifying, learning. */
  private ritualsAtCamp(): void {
    const casters = this.party.alive.filter(m => isCaster(m.charClass.id));
    if (casters.length === 0) return;
    // Identify: everything unnamed in the packs gets a name.
    let identified = 0;
    for (const m of this.party.members) for (const i of m.inventory) if (i.identified === false) { i.identified = true; identified++; }
    if (identified > 0) this.hud.addCombatMessage(`\ud83d\udd6f ${casters[0].name} sits with the unknown things from the packs and, by firelight and a slow ritual, names ${identified} of them.`, '#c9a6ff');
    // Learning: a wizard with a scroll of a spell not yet known copies it into the book.
    const scrollSpell: Record<string, string> = { scroll_fireball: 'fireball', scroll_cure_wounds: 'cure_wounds', scroll_invisibility: 'invisibility', scroll_lightning_bolt: 'lightning_bolt' };
    for (const wizard of casters.filter(m => m.charClass.id === 'wizard' || m.charClass.id === 'artificer')) {
      for (const holder of this.party.members) {
        const scroll = holder.inventory.find(i => scrollSpell[i.id] && !wizard.knownSpells.includes(scrollSpell[i.id]));
        if (!scroll) continue;
        const spell = SPELLS.find(sp => sp.id === scrollSpell[scroll.id]);
        if (!spell || wizard.level < Math.max(1, spell.level * 2 - 1)) continue;
        holder.useItem(scroll.id);
        wizard.knownSpells.push(spell.id);
        this.hud.addCombatMessage(`\ud83d\udcd6 ${wizard.name} copies ${spell.name} from the scroll into the book, line by careful line. The scroll crumbles; the spell stays.`, '#c9a6ff');
        this.tally('spells_learned');
        break;
      }
    }
  }

  /** A caster at a chest: a ritual of detection says what the lid is hiding. */
  private detectMagicOn(feature: RoomFeature): void {
    const caster = this.party.alive.find(m => ['wizard', 'artificer', 'cleric', 'sorcerer'].includes(m.charClass.id));
    if (!caster) return;
    const what = feature.mimic ? 'it is not a chest at all, and it is hungry' : feature.trapped ? 'the lid is wired' : feature.locked ? 'a stuck lid and nothing worse' : 'nothing on it but dust and coin';
    this.hud.addCombatMessage(`\ud83d\udd2e ${caster.name} passes a hand over the chest and reads what clings to it: ${what}.`, '#c9a6ff');
  }

  /** A warlock without a pact dreams of the patron at the fire, and wakes with a task. */
  private patronDream(): void {
    const warlock = this.party.alive.find(m => m.charClass.id === 'warlock' && !this.pacts[m.id]);
    if (!warlock) return;
    const demands: [string, number][] = [['kills', 12 + warlock.level * 2], ['kills', 20 + warlock.level * 2]];
    const [demand, target] = demands[Math.floor(Math.random() * demands.length)];
    this.pacts[warlock.id] = { demand, target, progress: 0, done: false };
    const wasPaused = this.paused;
    this.setPaused(true);
    this.hud.showStoryCard({ kicker: 'The Patron', title: `${warlock.name} dreams`, body: `Something with too many voices leans close in the dream and says the terms plainly: ${target} things dead by the party's hand, and it will be pleased, and its pleasure is worth having.\n\n${warlock.name} wakes with the taste of it and does not say what was promised.` }, () => { if (!wasPaused) this.setPaused(false); }, { seconds: 12 });
  }

  /** Kills count toward every open pact; a pact kept pays in the patron's coin. */
  private advancePacts(kills: number): void {
    if (kills <= 0) return;
    for (const [id, pact] of Object.entries(this.pacts)) {
      if (pact.done) continue;
      pact.progress += kills;
      const warlock = this.party.members.find(m => m.id === id);
      if (!warlock) continue;
      if (pact.progress >= pact.target) {
        pact.done = true;
        warlock.abilities.cha = Math.min(20, warlock.abilities.cha + 1);
        this.tally('pacts');
        this.hud.addCombatMessage(`\ud83d\udc41 The patron is pleased. ${warlock.name} feels it like a hand on the shoulder: +1 Charisma, and the voices are warmer for a while.`, '#c9a6ff');
        this.expeditionJournal.push(`${warlock.name} kept the pact`);
      } else if (pact.progress - kills < pact.target / 2 && pact.progress >= pact.target / 2) {
        this.hud.addCombatMessage(`\ud83d\udc41 Halfway to what the patron asked of ${warlock.name}.`, '#a8a');
      }
    }
  }

  /** A druid or wizard with a slot to spend calls something to fight beside them. */
  private summonAlly(foes: Monster[]): void {
    if (foes.length === 0 || this.party.members.some(m => m.id.startsWith('summon_'))) return;
    const caster = this.party.alive.find(m => (m.charClass.id === 'druid' || m.charClass.id === 'wizard') && m.level >= 3 && m.canCastSpell(2));
    if (!caster || Math.random() > 0.5 || this.party.members.length >= 6) return;
    caster.spendSlotAt(2);
    const isDruid = caster.charClass.id === 'druid';
    const name = isDruid ? ['Summoned Wolf', 'Summoned Boar', 'Summoned Bear'][Math.floor(Math.random() * 3)] : ['Bound Sprite', 'Lesser Elemental', 'Arcane Hound'][Math.floor(Math.random() * 3)];
    const cls = CLASSES.find(c => c.id === (isDruid ? 'barbarian' : 'fighter')) ?? CLASSES[0];
    const race = RACES.find(r => r.id === 'human') ?? RACES[0];
    const ally = new GameCharacter(`summon_${Date.now()}`, name, cls, race, { str: 14 + Math.floor(caster.level / 3), dex: 13, con: 12, int: 4, wis: 10, cha: 6 });
    ally.isTemporaryCompanion = true;
    ally.baseMaxHp = 8 + caster.level * 3;
    ally.hp = ally.maxHp;
    ally.tile = { ...caster.tile };
    this.party.addMember(ally);
    this.hud.addCombatMessage(`\u2728 ${caster.name} spends a second-level slot and ${isDruid ? 'the ground gives up' : 'the air knots itself into'} ${name.replace(/^(Summoned|Bound|Lesser|Arcane) /, 'a $1 ').toLowerCase()} to fight beside the party until the fight is done.`, '#c9a6ff');
    this.tally('summons');
  }

  /** Whatever was summoned goes back where it came from when the fight ends. */
  private dismissSummons(): void {
    for (let i = this.party.members.length - 1; i >= 0; i--) {
      const m = this.party.members[i];
      if (!m.id.startsWith('summon_')) continue;
      this.party.members.splice(i, 1);
      if (this.party.formation[i]) this.party.formation.splice(i, 1);
      if (i < this.party.leaderIndex) this.party.leaderIndex--;
      else if (i === this.party.leaderIndex) this.party.leaderIndex = 0;
      this.hud.addCombatMessage(`\u2728 ${m.name} ${m.isAlive ? 'fades as the magic lets go' : 'was already gone'}.`, '#a8a');
    }
    if (this.party.leaderIndex >= this.party.members.length) this.party.leaderIndex = 0;
    this.hud.setParty(this.party);
  }

  // ── Parts, curses, trophies, the weight of the pack ───────────────────

  /** A curse fed on enough kills lets go of its own accord. */
  private feedCurses(kills: number): void {
    if (kills <= 0) return;
    for (const m of this.party.alive) {
      const item = m.findCursedEquipped();
      if (!item) continue;
      item.curseKills = (item.curseKills ?? 0) + kills;
      const needed = 15;
      if (item.curseKills >= needed) {
        const line = m.liftCurse();
        this.hud.addCombatMessage(`\ud83d\udd13 The ${item.name} has drunk enough. ${line ?? 'Its grip on ' + m.name + ' loosens and is gone.'}`, '#8cf');
        this.tally('curses_broken');
      } else if (item.curseKnown && item.curseKills - kills < needed / 2 && item.curseKills >= needed / 2) {
        this.hud.addCombatMessage(`The ${item.name} is quieter on ${m.name}'s arm. Halfway sated, perhaps.`, '#a8a');
      }
    }
  }

  /** The first tavern hangs whatever heads the party carries. */
  private mountTrophies(town: OverworldTown): void {
    const loose = this.trophies.filter(t => !t.mounted);
    if (loose.length === 0) return;
    for (const t of loose) t.mounted = town.name;
    this.adjustTownReputation(town.id, 2 * loose.length);
    this.tally('trophies');
    this.hud.addCombatMessage(`\ud83c\udfc6 Over the bar in ${town.name} now: ${loose.map(t => `the head of ${t.name} (floor ${t.floor} of ${t.dungeon})`).join(', ')}. Drinks are cheaper for a while, and the stories are free.`, '#ffd700');
    this.expeditionJournal.push(`Mounted ${loose.map(t => t.name).join(', ')} in ${town.name}`);
  }

  /** Fourteen things in one pack is the line. */
  private isEncumbered(): boolean {
    return this.party.members.some(m => m.inventory.length > 14);
  }

  private checkEncumbrance(): void {
    const now = this.isEncumbered();
    if (now && !this.encumberedNoted) {
      this.encumberedNoted = true;
      const who = this.party.members.find(m => m.inventory.length > 14);
      this.hud.addCombatMessage(`\ud83c\udf92 ${who?.name ?? 'Someone'} is carrying too much, and everyone walks slower for it. Sell, or drop, or stop picking things up.`, '#c84');
    } else if (!now && this.encumberedNoted) {
      this.encumberedNoted = false;
      this.hud.addCombatMessage('\ud83c\udf92 The packs are bearable again. The pace picks up.', '#8a8');
    }
  }

  // ── The world: seasons, roads, rivers, the capital, the beast, a base ─

  /** The season turns every ten days; the map and the markets follow. */
  private checkSeason(): void {
    const season = seasonFor(this.dayIndex);
    this.mapRenderer.setSeason(season);
    if (this.lastSeason === null) { this.lastSeason = season; return; }
    if (season !== this.lastSeason) {
      this.lastSeason = season;
      this.hud.addCombatMessage(seasonLine(season), '#a8c8a8');
      this.expeditionJournal.push(`The season turned to ${season}`);
    }
  }

  /** What the sky did reaches the first floor down: rain floods, cold eats torches. */
  private weatherBelow(): void {
    if (this.dungeonLevel !== 1 || !this.weather) return;
    const t = this.weather.type;
    if (/rain|storm|flood/i.test(t)) {
      let pools = 0;
      for (const r of this.rooms.slice(1, 4)) {
        if (r.width < 4 || r.height < 4) continue;
        const px = r.x + (Math.random() < 0.5 ? 0 : r.width - 2), py = r.y + (Math.random() < 0.5 ? 0 : r.height - 2);
        for (let y = py; y < py + 2; y++) for (let x = px; x < px + 2; x++) if (this.map.getTile(x, y) === TileType.Floor && !(x === r.cx && y === r.cy)) { this.map.setTile(x, y, TileType.Water); pools++; }
      }
      if (pools > 0) this.hud.addCombatMessage('\ud83c\udf27 The rain above has found its way down: the first rooms stand in black water.', '#88a');
    } else if (/snow|blizzard|frost|ice/i.test(t)) {
      this.torchLeft = Math.max(60, this.torchLeft - 200);
      this.hud.addCombatMessage('\u2744 The cold comes down the stair with the party and eats at the torch.', '#88a');
    }
  }

  /** Good roads near a prosperous town; bad ones near a besieged one. */
  private roadQuality(tile: Vector2): number {
    if (!this.overworld || this.map.getTile(tile.x, tile.y) !== TileType.Road) return 0;
    const near = this.overworld.towns.find(t => manhattan(t.tile, tile) <= 14);
    if (!near) return 0;
    if (this.sieges[near.id]) return -1;
    return townTier(this.townLife?.byTown[near.id]) >= 2 ? 1 : 0;
  }

  /** Every bridge crosses a river, and every river has a name. */
  private nameTheRiver(tile: Vector2): void {
    if (this.map.getTile(tile.x, tile.y) !== TileType.Bridge) return;
    const key = `${tile.x},${tile.y}`;
    if (this.bridgesCrossed.has(key)) return;
    this.bridgesCrossed.add(key);
    const names = ['the Sallow', 'the Greywater', 'the Hollowbeck', 'the Kingsflow', 'the Wend', 'the Bittern', 'the Ashwater', 'the Long Lea', 'the Marrow', 'the Silverun'];
    const river = names[(tile.y * 7 + Math.floor(tile.x / 9)) % names.length];
    this.hud.addCombatMessage(`\ud83c\udf09 The party crosses ${river} by the bridge here. The water is ${['brown and quick', 'slow and black', 'clear over stones', 'high with rain'][(tile.x + tile.y) % 4]}.`, '#88a');
  }

  /** Arriving anywhere: the capital's court, a town's growth, the festival's games. */
  private townArrivalExtras(town: OverworldTown): void {
    const tl = this.townLife?.byTown[town.id];
    if (!tl || !this.overworld) return;
    if (town.id === this.overworld.spawnTownId && !tl.questGivers.some(g => g.id === 'crown_steward')) {
      tl.questGivers.push({
        id: 'crown_steward', name: 'Aldous Vane', title: 'Steward of the Crown', portrait: '\ud83d\udc51', portraitColor: '#e8c56a',
        backstory: `${town.name} is the capital, such as the realm has, and Aldous Vane keeps its ledgers, its bank, and its list of things the Crown would like killed.`,
        dialogue: {
          stranger: ['"The Crown pays well and asks few questions. It asks one: can you be relied upon?"'],
          acquaintance: ['"The Crown has noticed you. That is not always good news, but today it is."'],
          trusted: ['"There are things I would tell no one else. Sit."'],
          legend: ['"When the histories are written you will be in them, and I will have written that page."'],
        },
        specialty: 'combat', repPerQuest: 40, reputation: 0,
      });
      this.hud.addCombatMessage(`\ud83d\udc51 ${town.name} is the capital, such as it is: a bank, a court, and a Steward with a list of the Crown's enemies.`, '#ffd700');
    }
    const tier = townTier(tl);
    const last = this.lastTownTier[town.id] ?? 1;
    if (tier > last) {
      this.hud.addCombatMessage(`\ud83c\udfd8 ${town.name} has grown on the party's custom: ${tier === 2 ? 'a market town now, with better prices and a paved road out' : 'a proper city, with the best prices in the realm and roads to match'}.`, '#ffd700');
      this.expeditionJournal.push(`${town.name} grew to tier ${tier}`);
    }
    this.lastTownTier[town.id] = tier;
    if (tl.festival && !this.merchantOffers.has(`festival:${town.id}:${tl.festival.startedAt}`)) {
      this.merchantOffers.add(`festival:${town.id}:${tl.festival.startedAt}`);
      this.festivalGame(town, tl.festival.kind);
    }
  }

  /** A festival has games; the party's best enters one, on the tray. */
  private festivalGame(town: OverworldTown, kind: string): void {
    const games = [
      { name: 'the archery', ability: 'dex' as const, label: 'Archery' },
      { name: 'the wrestling', ability: 'str' as const, label: 'Wrestling' },
      { name: 'the footrace', ability: 'con' as const, label: 'The footrace' },
    ];
    const game = games[Math.abs(kind.length + town.name.length) % games.length];
    const best = [...this.party.alive].sort((a, b) => abilityModifier(b.abilities[game.ability]) - abilityModifier(a.abilities[game.ability]))[0];
    if (!best) return;
    const { result, event } = this.rollHeld(() => abilityCheck(abilityModifier(best.abilities[game.ability]) + best.profBonus, 13, `${best.name} \u2014 ${game.label}`));
    void this.presentRolls([{ roll: event, line: result.success
      ? `\ud83c\udfaa ${best.name} enters ${game.name} and wins it going away. ${town.name} cheers, and the purse is 30 gold heavier.`
      : `\ud83c\udfaa ${best.name} enters ${game.name} and loses narrowly to a farmer's daughter who has clearly done this before.`, color: result.success ? '#ffd700' : '#a98' }]).then(() => {
      if (result.success) { this.addGold(30); this.adjustTownReputation(town.id, 1); this.tally('games_won'); }
    });
  }

  /** Cleared places point to the next: the witch knows the grove, the grove the tomb. */
  private chainFrom(poi: OverworldPOI): void {
    const next: Record<string, string> = { witch_hut: 'enchanted_grove', enchanted_grove: 'lost_tomb', lost_tomb: 'dragon_lair', ancient_ruins: 'lost_tomb', hidden_shrine: 'crystal_cave', bandit_outpost: 'abandoned_mine', watchtower: 'ancient_battlefield', abandoned_mine: 'crystal_cave' };
    const kind = next[poi.kind];
    if (!kind) return;
    const target = this.pois.find(p => !p.discovered && p.kind === kind);
    if (!target) return;
    target.discovered = true;
    if (this.overworld) this.overworld.map.reveal(target.tile.x, target.tile.y, 3);
    this.hud.addCombatMessage(`\ud83d\uddfa Something at ${poi.name} points the way on: ${target.name} lies ${target.tile.x < poi.tile.x ? 'west' : 'east'} and ${target.tile.y < poi.tile.y ? 'north' : 'south'} of here, and is on the map now.`, '#ff9');
    this.expeditionJournal.push(`${poi.name} led to ${target.name}`);
  }

  /** A cleared ruin the party stands at becomes a base: a bed, a roof, torches. */
  private claimRuins(): void {
    if (this.mode !== GameMode.Overworld) { this.hud.addCombatMessage('Ruins are claimed from the surface, standing at them.', '#886'); return; }
    const here = this.party.leader.tile;
    const ruin = this.pois.find(p => p.cleared && /ruins|watchtower|failed_settlement/.test(p.kind) && manhattan(p.tile, here) <= 2);
    if (!ruin) { this.hud.addCombatMessage('There are no cleared ruins here to claim. Clear one, stand on it, and say so.', '#886'); return; }
    this.base = { x: ruin.tile.x, y: ruin.tile.y, name: ruin.name };
    this.hud.addCombatMessage(`\ud83c\udfda ${ruin.name} is the party's now: a roof, a bed, a chest, a door that shuts. Come back to it and rest.`, '#ffd700');
    this.expeditionJournal.push(`Claimed ${ruin.name} as a base`);
    this.tally('bases');
  }

  private restAtBase(tile: Vector2): void {
    if (!this.base || tile.x !== this.base.x || tile.y !== this.base.y) return;
    if (this.merchantOffers.has(`base:${this.dayIndex}`)) return;
    this.merchantOffers.add(`base:${this.dayIndex}`);
    this.hud.addCombatMessage(`\ud83c\udfda Home, of a kind. The party sleeps at ${this.base.name} behind a door that shuts.`, '#8cf');
    for (const msg of this.party.longRest()) this.hud.addCombatMessage(msg, '#7c7');
    for (const m of this.party.members) if (m.exhaustion > 0) m.exhaustion--;
    this.torches = Math.max(this.torches, 4);
    this.hud.setParty(this.party);
  }

  /** A merchant on the road has one rare thing, once a day, at a price. */
  private merchantOnTheRoad(): void {
    const leader = this.party.leader;
    const merchant = this.wanderers.find(w => w.kind === 'merchant' && manhattan(w.tile, leader.tile) <= 2);
    if (!merchant) return;
    const key = `${merchant.id}:${this.dayIndex}`;
    if (this.merchantOffers.has(key)) return;
    this.merchantOffers.add(key);
    const pool = MAGIC_ITEMS.filter(i => i.rarity === 'uncommon' || i.rarity === 'rare');
    const item = pool[Math.floor(Math.random() * pool.length)];
    if (!item) return;
    const price = item.rarity === 'rare' ? 260 : 120;
    const buys = this.partyGold() >= price + 60 && this.party.leader.personality.greed >= 4;
    if (buys) {
      this.spendGold(price);
      this.party.leader.addToInventory({ id: item.id, name: item.name, type: 'treasure', description: item.description, value: price, rarity: item.rarity });
      this.hud.addCombatMessage(`\ud83d\uded2 ${merchant.name} unrolls a cloth on the road: ${item.name}, ${price} gold, and no haggling on the road. The party pays.`, '#ffd700');
    } else {
      this.hud.addCombatMessage(`\ud83d\uded2 ${merchant.name} unrolls a cloth on the road: ${item.name}, ${price} gold. The party has a look and walks on.`, '#a98');
    }
  }

  /** The beast of the region: born with the world, roaming until slain. */
  private spawnRoamer(): void {
    if (!this.overworld || this.roamer) return;
    const cr = 3 + Math.floor(this.party.leader.level / 2);
    const pool = MONSTER_TEMPLATES.filter(m => m.cr >= cr - 0.5 && m.cr <= cr + 1 && (m.type === 'beast' || m.type === 'monstrosity' || m.type === 'dragon' || m.type === 'giant') && !isUnseeableMonster(m.id));
    const t = pool[Math.floor(Math.random() * pool.length)] ?? getRandomMonster(cr);
    const region = regionAt(this.worldRegions, this.party.leader.tile);
    let spot: Vector2 | null = null;
    for (let i = 0; i < 60 && !spot; i++) {
      const x = 4 + Math.floor(Math.random() * (this.overworld.map.width - 8)), y = 4 + Math.floor(Math.random() * (this.overworld.map.height - 8));
      if (this.overworld.map.isWalkable(x, y) && manhattan({ x, y }, this.party.leader.tile) > 25) spot = { x, y };
    }
    if (!spot) return;
    this.roamer = { templateId: t.id, name: `the ${t.name} of ${region?.name.replace(/^The /, '') ?? 'the Wilds'}`, x: spot.x, y: spot.y };
    this.hud.addCombatMessage(`\ud83d\udc3e Word in every tavern: something has been taking sheep and shepherds along the far roads. They call it ${this.roamer.name}. Whoever brings its head home will drink free for a year.`, '#e8b45a');
  }

  private stepRoamer(): void {
    if (!this.roamer || !this.overworld || this.mode !== GameMode.Overworld) return;
    if (++this.roamerTicks % 3 !== 0) return;
    const r = this.roamer;
    const lead = this.party.leader.tile;
    const d = manhattan({ x: r.x, y: r.y }, lead);
    const towardParty = d <= 30;
    const dx = towardParty ? Math.sign(lead.x - r.x) : (Math.random() < 0.5 ? 1 : -1);
    const dy = towardParty ? Math.sign(lead.y - r.y) : (Math.random() < 0.5 ? 1 : -1);
    const nx = r.x + (Math.random() < 0.5 ? dx : 0), ny = r.y + (Math.random() < 0.5 ? 0 : dy);
    if (this.overworld.map.isWalkable(nx, ny) && !townAt(this.overworld, nx, ny)) { r.x = nx; r.y = ny; }
    if (d <= 8 && !this.roamerWarned) { this.roamerWarned = true; this.hud.addCombatMessage(`\ud83d\udc3e Something large moves along the ridge, keeping pace. ${r.name} has the party's scent.`, '#c84'); }
    if (d > 12) this.roamerWarned = false;
    if (manhattan({ x: r.x, y: r.y }, lead) <= 1 && this.phase === GamePhase.Exploration) {
      const t = getMonsterTemplate(r.templateId);
      if (!t) { this.roamer = null; return; }
      const spot = findAmbushTiles(this.map, lead, 1)[0];
      if (!spot) return;
      const m = this.spawnMonster({ ...t, name: `\ud83d\udc80 ${r.name.charAt(0).toUpperCase() + r.name.slice(1)} (Boss)`, xp: t.xp * 3 }, spot);
      m.maxHp = Math.round(m.maxHp * 1.6); m.hp = m.maxHp; m.alertLevel = 2;
      this.roamer = null;
      this.hud.addCombatMessage(`\ud83d\udc3e ${r.name} comes down off the ridge. It has been following since the last town, and it is done following.`, '#e0705f');
      this.tally('roamers');
      this.startCombat([m]);
    }
  }

  private trackRoamer(): void {
    if (!this.roamer) { this.hud.addCombatMessage('There is no beast abroad that the party knows of.', '#886'); return; }
    const lead = this.party.leader.tile;
    const dx = this.roamer.x - lead.x, dy = this.roamer.y - lead.y;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
    const d = Math.abs(dx) + Math.abs(dy);
    this.hud.addCombatMessage(`\ud83d\udc3e ${this.party.leader.name} reads the ground: ${this.roamer.name} passed ${d <= 6 ? 'this hour' : d <= 20 ? 'today' : 'days ago'}, heading ${dir}. About ${d} tiles off. The map has the mark.`, '#e8b45a');
    if (this.overworld) this.overworld.map.reveal(this.roamer.x, this.roamer.y, 2);
  }

  // ── Set pieces, factions, rescues, the floor's weather, traps, companions ──

  /** The pre-built dungeon's set piece: one room on one floor, made as the data says. */
  private placeSetPiece(fixedFloor: PrebuiltFloor | null): void {
    const pb = this.currentPrebuilt();
    if (!fixedFloor || !pb?.setPiece || pb.setPiece.floor !== this.dungeonLevel) return;
    const room = this.rooms[Math.min(this.rooms.length - 1, pb.setPiece.room)];
    if (!room) return;
    const f = assignFeature(room, this.dungeonLevel, { force: true });
    if (!f) return;
    f.kind = pb.setPiece.kind as RoomFeature['kind'];
    if (pb.setPiece.hazard) { f.hazard = pb.setPiece.hazard as RoomFeature['hazard']; const def = hazardByKind(f.hazard!); f.name = def.name; f.entryLine = def.entryLine; f.inspect = def.inspect; }
    else { f.name = pb.setPiece.line; f.entryLine = `Here is ${pb.setPiece.line}, the thing this place is remembered for.`; }
    f.used = false;
    this.hud.addCombatMessage(`\ud83d\udcdc ${pb.name} is remembered for ${pb.setPiece.line}. It is on this floor.`, '#a8a');
  }

  /** Warring bands, a floor of prisoners, and what the air is doing. */
  private dressFloorMore(): void {
    this.floorFactions = null;
    this.rescue = null;
    this.partyTraps.clear();
    this.floorWeather = null;
    if (this.mode !== GameMode.Dungeon) return;
    // Two humanoid kinds with two or more each: a war the party can pick a side in.
    const counts = new Map<string, number>();
    for (const m of this.monsters) if (m.isAlive && m.template.type === 'humanoid' && !/\(Boss\)/.test(m.template.name)) counts.set(m.template.id, (counts.get(m.template.id) ?? 0) + 1);
    const bands = [...counts.entries()].filter(([, n]) => n >= 2).map(([id]) => id);
    if (bands.length >= 2 && Math.random() < 0.6) {
      this.floorFactions = { a: bands[0], b: bands[1], chosen: null };
      const na = getMonsterTemplate(bands[0])?.name ?? bands[0], nb = getMonsterTemplate(bands[1])?.name ?? bands[1];
      const wasPaused = this.paused;
      this.setPaused(true);
      this.hud.showStoryChoice(`\u2694 Two bands hold this floor and hate each other more than they hate the party: the ${na}s and the ${nb}s. A word in the right ear could turn one against the other.`, [
        { id: 'a', label: `Side with the ${na}s`, text: `The ${na}s stand aside for the party; the ${nb}s get their reinforcements and their fury.` },
        { id: 'b', label: `Side with the ${nb}s`, text: `The ${nb}s stand aside; the ${na}s dig in.` },
        { id: 'none', label: 'Take no side', text: 'The party fights everything, as usual.' },
      ], (o) => {
        if (!wasPaused) this.setPaused(false);
        if (o.id === 'none' || !this.floorFactions) return;
        const friend = o.id === 'a' ? this.floorFactions.a : this.floorFactions.b;
        const foe = o.id === 'a' ? this.floorFactions.b : this.floorFactions.a;
        this.floorFactions.chosen = friend;
        this.monsters = this.monsters.filter(m => m.template.id !== friend || /\(Boss\)/.test(m.template.name));
        const tpl = getMonsterTemplate(foe);
        if (tpl) for (let i = 0; i < 2; i++) { const room = this.rooms[1 + Math.floor(Math.random() * Math.max(1, this.rooms.length - 2))]; const pos = room && findEmptyTile(this.map, room, this.monsters); if (pos) this.spawnMonster(tpl, pos).alertLevel = 2; }
        const gold = 20 + this.dungeonLevel * 15;
        this.addGold(gold);
        this.tally('factions');
        this.hud.addCombatMessage(`\ud83e\udd1d The ${getMonsterTemplate(friend)?.name ?? friend}s melt back into their tunnels, and leave ${gold} gold on a rock as earnest. The ${tpl?.name ?? foe}s have heard, and are coming.`, '#e8b45a');
      }, { seconds: 20, fallback: () => ({ id: 'none', label: 'Take no side', text: '' }) });
    }
    // A rescue floor: three cells, all to be opened.
    if (this.dungeonLevel >= 2 && Math.random() < 0.15) {
      const cells = this.rooms.slice(1, -1).filter(r => r.feature?.kind !== 'hazard').slice(0, 3);
      if (cells.length === 3) {
        for (const r of cells) { const f = assignFeature(r, this.dungeonLevel, { force: true }); if (f) { f.kind = 'prison'; f.name = 'a barred cell with someone in it'; f.entryLine = 'A cell door, barred from this side, and a face at the grate that has stopped expecting anyone.'; f.inspect = 'The bar is heavy but not locked.'; f.used = false; } }
        this.rescue = { total: 3, freed: 0 };
        this.hud.addCombatMessage('\ud83d\udd12 A face at a grate, and another, and another: this floor is a gaol, and everyone in it is waiting on the party.', '#e8b45a');
      }
    }
    // The floor's weather.
    if (Math.random() < 0.25) {
      const w = (['spores', 'cold', 'gas'] as const)[Math.floor(Math.random() * 3)];
      this.floorWeather = w;
      this.hud.addCombatMessage(w === 'spores' ? '\u2601 The air on this floor drifts with spores. Every room is a breath held.'
        : w === 'cold' ? '\u2744 A cold snap has this floor in its grip. Torches gutter twice as fast.'
        : '\u2601 The air on this floor is wrong: yellow, and heavier the longer a fight goes on.', '#88a');
    }
  }

  /** A room full of spores: everyone saves or is poisoned. */
  private sporeRoom(): void {
    const items: { roll: DiceRollEvent | null; line: string; color: string }[] = [];
    for (const m of this.party.conscious) {
      const { result, event } = this.rollHeld(() => savingThrow(m.conMod, 11, { label: `${m.name} \u2014 Constitution save (spores)` }));
      if (!result.success) m.applyCondition('poisoned', 2, 'Poisoned', 'spores');
      items.push({ roll: event, line: result.success ? `${m.name} holds a breath through the worst of it.` : `${m.name} breathes it in and goes green.`, color: result.success ? '#8c8' : '#c66' });
    }
    void this.presentRolls([{ roll: null, line: '\u2601 The spores are thick in here.', color: '#88a' }, ...items]);
  }

  /** The host's word that a prisoner is free; on a rescue floor it counts. */
  notePrisonerFreed(): void {
    if (!this.rescue) return;
    this.rescue.freed++;
    if (this.rescue.freed < this.rescue.total) { this.hud.addCombatMessage(`\ud83d\udd13 ${this.rescue.freed} of ${this.rescue.total} freed.`, '#8cf'); return; }
    const gold = 40 + this.dungeonLevel * 20;
    this.addGold(gold);
    this.grantXp(() => 40 + this.dungeonLevel * 10);
    this.tally('rescues');
    this.rescue = null;
    const wasPaused = this.paused;
    this.setPaused(true);
    this.hud.showStoryCard({ kicker: 'Everyone', title: 'A floor emptied of its prisoners', body: `The last door swings and the last of them comes out blinking. They go up the stair together, holding each other up, and the one who can still talk presses ${gold} gold into the party's hands and says the town will hear of this. It will.` }, () => { if (!wasPaused) this.setPaused(false); }, { seconds: 12 });
  }

  vaultKeysHeld(): number { return this.vaultKeys; }
  spendVaultKeys(n: number): void { this.vaultKeys = Math.max(0, this.vaultKeys - n); this.tally('vaults'); }

  /** Caltrops in the doorway: the next fight in this room opens with the foes stepping on them. */
  private setPartyTrap(): void {
    if (this.mode !== GameMode.Dungeon) { this.hud.addCombatMessage('Traps are for corridors and rooms below.', '#886'); return; }
    const idx = this.currentRoomIndex();
    if (idx < 0) { this.hud.addCombatMessage('The party is between rooms; there is nothing to trap.', '#886'); return; }
    if (this.partyTraps.size >= 2) { this.hud.addCombatMessage('The party is out of caltrops and wire for this floor.', '#886'); return; }
    if (this.partyTraps.has(idx)) { this.hud.addCombatMessage('This room is already trapped.', '#886'); return; }
    this.partyTraps.add(idx);
    const who = this.bestDisarmer();
    this.hud.addCombatMessage(`\ud83e\udea4 ${who.name} scatters caltrops across the doorway and runs a wire at shin height. Whatever comes in next will not come in well.`, '#8cf');
  }

  private springPartyTrap(foes: Monster[]): void {
    if (this.mode !== GameMode.Dungeon) return;
    const idx = this.currentRoomIndex();
    if (idx < 0 || !this.partyTraps.has(idx)) return;
    this.partyTraps.delete(idx);
    let hurt = 0;
    for (const m of foes) { if (!m.isAlive) continue; const dmg = rollDice(1, 6) + 1; m.takeDamage(dmg); hurt++; }
    this.tally('traps_sprung');
    this.hud.addCombatMessage(`\ud83e\udea4 The caltrops take ${hurt} of them in the feet and the wire takes the first one over. The fight starts with the party ahead.`, '#e8b45a');
  }

  /** What was spared comes back; what was slaughtered has kin. */
  private consequences(): void {
    const flags = this.story?.flags ?? [];
    if (this.mode !== GameMode.Dungeon || this.dungeonLevel < 3) return;
    if (flags.includes('merciful') && !(this.counters.consequence_merciful ?? 0)) {
      this.tally('consequence_merciful');
      const room = this.rooms[Math.max(1, Math.floor(this.rooms.length * 0.5))];
      const pos = room && findEmptyTile(this.map, room, this.monsters);
      const base = getRandomMonster(Math.max(1, this.dungeonLevel));
      if (pos) {
        const m = this.spawnMonster({ ...base, name: 'the one the party spared', hp: Math.round(base.hp * 1.5), xp: base.xp * 2 }, pos);
        m.alertLevel = 2;
        this.hud.addCombatMessage('\ud83d\udc41 Mercy has a memory. The one the party let go has been waiting on this floor, and has brought friends, and a grudge.', '#e0705f');
      }
    } else if (flags.includes('ruthless') && !(this.counters.consequence_ruthless ?? 0)) {
      this.tally('consequence_ruthless');
      const room = this.rooms[Math.max(1, Math.floor(this.rooms.length * 0.5))];
      const base = getRandomMonster(Math.max(0.5, this.dungeonLevel * 0.6), this.dungeonTheme?.id);
      let n = 0;
      for (let i = 0; i < 3; i++) { const pos = room && findEmptyTile(this.map, room, this.monsters); if (pos) { this.spawnMonster({ ...base, name: `${base.name} (kin of the slain)` }, pos).alertLevel = 2; n++; } }
      if (n > 0) this.hud.addCombatMessage('\ud83d\udc41 Ruthlessness has a memory too. Kin of the slaughtered have come down looking for the ones who did it.', '#e0705f');
    }
  }

  /** A companion for the act: someone with reason to want the villain dead. */
  hireCompanion(act: { index: number; bossName: string; monsterType: string }): void {
    if (this.party.members.length >= 6 || this.party.members.some(m => m.id.startsWith('companion_'))) return;
    const classId = ['undead', 'vampire', 'shade', 'spirit'].includes(act.monsterType) ? 'cleric' : ['fiend', 'demon', 'devil', 'yugoloth'].includes(act.monsterType) ? 'paladin' : ['aberration', 'outsider', 'dreamborn'].includes(act.monsterType) ? 'wizard' : 'ranger';
    const cls = CLASSES.find(c => c.id === classId) ?? CLASSES[0];
    const race = RACES[Math.floor(Math.random() * RACES.length)];
    const names = ['Idris Vell', 'Maren Coldwater', 'Tobiah Ash', 'Serra Quill', 'Oswin Blackrook', 'Neve Harrow'];
    const name = names[act.index % names.length];
    const level = Math.max(1, Math.round(this.party.members.reduce((s, m) => s + m.level, 0) / Math.max(1, this.party.members.length)));
    const c = new GameCharacter(`companion_${act.index}`, name, cls, race, { str: 13, dex: 13, con: 13, int: 12, wis: 12, cha: 12 });
    for (let i = 1; i < level; i++) c.levelUp();
    c.isTemporaryCompanion = true;
    c.background = 'Folk Hero';
    this.party.addMember(c);
    this.hud.addCombatMessage(`\ud83e\udd1d ${name}, a ${race.name.toLowerCase()} ${cls.name.toLowerCase()} with a personal quarrel with ${act.bossName}, asks to walk with the party until it is settled. The party makes room.`, '#e8b45a');
    this.expeditionJournal.push(`${name} joined for the act against ${act.bossName}`);
    this.hud.setParty(this.party);
  }

  dismissCompanion(): void {
    const i = this.party.members.findIndex(m => m.id.startsWith('companion_'));
    if (i < 0) return;
    const c = this.party.members[i];
    this.party.members.splice(i, 1);
    if (this.party.formation[i]) this.party.formation.splice(i, 1);
    if (i < this.party.leaderIndex) this.party.leaderIndex--;
    else if (i === this.party.leaderIndex) this.party.leaderIndex = 0;
    this.hud.addCombatMessage(`\ud83e\udd1d ${c.name}'s quarrel is settled. They clasp every hand in turn and take the road home.`, '#a8a');
    this.hud.setParty(this.party);
  }

  /**
   * Show one engine step as a sequence. The engine resolves a whole turn at
   * once and narrates it; shown all at once, a turn with two attacks read as
   * two things happening together, and the dice for them came afterwards.
   * Here each attack line waits for its die to land first, then plays its
   * blow, then the next line follows after a beat. The window's state (health
   * bars, the turn order) is refreshed with each piece.
   */
  private async presentStep(log: CombatLog, lines: string[], actor: GameCharacter | Monster | null, rolls: DiceRollEvent[]): Promise<void> {
    // Every phrase COMBAT_NARRATION and the engine use for a blow that was
    // rolled for: hits, crits and misses alike. Rolls no line claims are
    // played before the tail of the turn, so no die is ever skipped.
    const attackLine = /\b(bites deep|smashes through|finds a gap|connects with|feints low|strikes a vital|lands a massive|pierces|struck a telling|swing goes wide|narrowly sidesteps|glances harmlessly|overcommits|strikes|hits|misses|slashes|stabs|shoots|fires|hurls|lunges|claws|bites)\b/i;
    const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));
    const round = this.combatEngine.log.round;
    const show = (messages: string[], last: boolean) => {
      if (messages.length === 0 && !last) return;
      const piece: CombatLog = { ...log, messages };
      this.hud.addCombatLogBatch(piece);
      this.kickCameraFor(messages);
      this.popCombatNumbers(messages, actor);
      this.hud.setParty(this.party);
      this.refreshBossBar();
      this.hud.battleView.update({
        round,
        actors: this.combatEngine.initiativeOrder,
        currentActorId: this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex]?.id ?? null,
        messages,
        over: last ? log.isOver : false,
        winner: last ? log.winner : null,
      });
    };
    let batch: string[] = [];
    let ri = 0;
    try {
      for (const msg of lines) {
        if (attackLine.test(msg) && ri < rolls.length) {
          // The die first, then the blow it decided.
          show(batch, false);
          batch = [];
          if (!this.running || this.phase !== GamePhase.Combat) break;
          await this.hud.dice.playRoll(rolls[ri++]);
          await sleep(90);
        }
        if (msg.includes('CRITICAL')) {
          // Hit-stop: the field holds on the critical for a beat, and shakes.
          show(batch, false);
          batch = [msg];
          show(batch, false);
          batch = [];
          this.camera.shake(9, 260);
          await sleep(170);
          continue;
        }
        if (msg.includes('opportunity attack')) {
          // A parting blow is its own beat: the field pauses on it.
          show(batch, false);
          batch = [];
          this.kickCameraFor(['smashes']);
          await sleep(220);
        }
        batch.push(msg);
      }
      while (ri < rolls.length && this.running && this.phase === GamePhase.Combat) {
        show(batch, false);
        batch = [];
        await this.hud.dice.playRoll(rolls[ri++]);
        await sleep(90);
      }
      show(batch, false);
      // Let the last blow land before the next combatant moves.
      if (lines.length > 0) await sleep(Math.min(450, this.combatTickInterval * 0.5));
    } finally {
      this.hud.dice.deferCombat = false;
      show([], true);
    }
  }

  /**
   * Keep the engine in step with the battle window's Manual/Auto toggle.
   * The toggle used to change only the button: the engine stayed paused on a
   * hero who would never be given an order, and the fight stopped for good.
   */
  private wireBattleModeToggle(): void {
    this.hud.battleView.onModeChange = this.guard((mode) => {
      this.combatEngine.setDecisionPause(mode === 'manual');
      if (mode === 'auto') {
        this.hud.battleView.hideCommandMenu();
        this.hud.addCombatMessage('The party fights on its own judgment.', '#8cf');
      } else {
        this.hud.addCombatMessage('The party waits on your word each turn.', '#8cf');
      }
    });
  }

  private updateCombat() {
    // FF command menu: when a hero awaits the DM's order, hold the tick
    // clock — the fight literally waits for the menu pick, then resumes.
    if (this.combatEngine.decisionActor) return;
    // A step is shown blow by blow; the next one waits for the last to land.
    if (this.presenting) return;
    if (this.combatTickTimer >= this.combatTickInterval) {
      this.combatTickTimer = 0;

      const actor = this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex] ?? null;
      const rollsBefore = getDiceHistory().length;
      // The engine's log runs for the whole fight; only what this step added
      // is new. Feeding the whole log to the window every tick replayed every
      // earlier blow again, which is what made the fight look simultaneous.
      const linesBefore = this.combatEngine.log.messages.length;
      this.hud.dice.deferCombat = true;
      const log = this.combatEngine.step();
      const fresh = log.messages.slice(linesBefore);
      for (const b of this.combatEngine.monsters) {
        if (!b.isAlive || this.bossBloodiedSaid.has(b.id) || b.hp > b.maxHp / 2) continue;
        if (!(b.isBoss || /\(Boss\)/.test(b.template.name))) continue;
        this.bossBloodiedSaid.add(b.id);
        fresh.push(bossBloodied(b.template.name.replace(/^\ud83d\udc80 /, '').replace(/ \(Boss\)$/, ''), b.template.type, b.id));
      }
      const rolls = getDiceHistory().slice(rollsBefore).filter(e => e.kind === 'attack' || e.kind === 'save' || e.kind === 'death-save');
      this.presenting = true;
      void this.presentStep(log, fresh, actor, rolls).finally(() => { this.presenting = false; });

      // FF command menu: the engine paused on a conscious hero's turn —
      // surface the Attack/Spell/Item/Flee menu and wait for the DM.
      const decider = this.combatEngine.decisionActor;
      if (decider) {
        const bv = this.hud.battleView;
        bv.setPartyRoster(this.party.alive);
        // Drop queue entries the engine already consumed last cycle.
        bv.queuedOrders = new Map(this.combatEngine.queuedOrders);
        bv.spellsFor = (hero) => this.combatEngine.getDecisionSpells(hero);
        bv.itemsFor = () => this.buildMenuConsumables();
        bv.onQueuedOrder = (heroId, cmd) => {
          this.combatEngine.queuedOrders.set(heroId, cmd);
          this.hud.addCombatMessage(`⏳ ${this.party.members.find(m => m.id === heroId)?.name ?? 'Ally'} — order queued.`, '#8a9');
        };
        // Formation presets: the battle-cry line lands in the combat feed.
        bv.onFormation = (line) => this.hud.addCombatMessage(line, '#d8c88a');
        // Order chips on hero cards mirror the engine queue every tick.
        bv.chipSyncFromGame = () => { bv.queuedOrders = new Map(this.combatEngine.queuedOrders); };
        bv.showCommandMenu(
          decider,
          this.combatEngine.getDecisionSpells(decider),
          this.buildMenuConsumables(),
          this.combatEngine.getDecisionAbilities(decider),
        );
      }

      if (log.isOver) {
        // Combat over — make sure the menu can't linger over the aftermath.
        this.combatEngine.decisionPause = false;
        this.combatEngine.queuedOrders.clear();
        this.hud.battleView.hideCommandMenu();
        if (log.winner === 'party') {
          // Remove dead AND fled monsters — keep their stats for the loot roll first.
          const slainMonsters = this.monsters.filter(m => !m.isAlive || m.fled);
          const escaped = slainMonsters.filter(m => m.fled);
          this.history.kills += slainMonsters.length - escaped.length;
          this.noteProgress();
          this.history.victories++;
          this.checkRivalsSlain(slainMonsters);
          this.strengthenBonds();
          this.dismissSummons();
          this.advancePacts(slainMonsters.filter(m => !m.fled).length);
          for (const b of slainMonsters.filter(m => !m.fled && /\(Boss\)/.test(m.template.name))) {
            const name = b.template.name.replace(/^\ud83d\udc80 /, '').replace(/ \(Boss\)$/, '');
            this.trophies.push({ name, dungeon: this.entranceBaseName || this.dungeonName, floor: this.dungeonLevel, mounted: null });
            this.hud.addCombatMessage(`\ud83c\udfc6 ${name}'s head comes off with some effort and goes in a sack. A tavern somewhere will want it over the bar.`, '#e8b45a');
          }
          this.feedCurses(slainMonsters.filter(m => !m.fled).length);
          if (this.dungeonLevel >= 3 && slainMonsters.some(m => !m.fled && /\(Boss\)/.test(m.template.name)) && Math.random() < 0.35) {
            this.vaultKeys++;
            this.hud.addCombatMessage(`\ud83d\udddd A heavy key of black iron, not for any door on this floor. The party holds ${this.vaultKeys} such.`, '#ffd700');
          }
          this.checkEncumbrance();
          if (slainMonsters.some(m => m.hasKey && !m.fled)) {
            this.floorKeyHeld = true;
            this.hud.addCombatMessage('\ud83d\udd11 An iron key, warm from the body. The locked hall will open now.', '#ffd700');
          }
          const numbers = summarizeFight(this.combatEngine.log.messages, this.party.members.map(m => m.name), this.combatEngine.log.round);
          this.hud.addCombatMessage(numbers.line, '#9aa');
          if (numbers.taken === 0) this.tally('flawless');
          this.checkAchievements();
          // Adaptive difficulty: a flawless rout raises future pressure.
          const standing = this.party.alive;
          const avgHpPct = standing.length > 0
            ? standing.reduce((s, m) => s + m.hp / m.maxHp, 0) / standing.length
            : 0;
          this.recordCombatOutcome(0, avgHpPct);
          this.monsters = this.monsters.filter(m => m.isAlive && !m.fled);
          if (escaped.length > 0) {
            const names = [...new Set(escaped.map(m => m.template.name))];
            this.hud.addCombatMessage(`💨 The ${names.join(' and ')} ${escaped.length === 1 ? 'flees' : 'flee'} into the wilds with its life — the field is yours.`, '#9a8');
          }

          // Bestiary ledger — tally per monster kind and sing out first-time kills.
          const firstKills: string[] = [];
        for (const m of slainMonsters) {
          if (m.fled) continue; // escaped foes earn no bestiary kill credit
          const prev = this.history.killLedger[m.template.id] ?? 0;
            this.history.killLedger[m.template.id] = prev + 1;
            if (prev === 0) firstKills.push(m.template.id);
            if (m.template.name.includes('(Boss)')) { this.bossSlainThisFloor = true; this.tally('bosses'); }
          }
          // Quests that hinge on kills or the floor boss may now be complete.
          this.checkActiveQuestProgress();
          for (const id of firstKills) {
            const tpl = slainMonsters.find(m => m.template.id === id)?.template;
            if (!tpl) continue;
            this.hud.addCombatMessage('📖 ' + generateFirstKillNarration(id, tpl.name), '#7bd');
          }

          // New kills may push a kind past the "known" threshold — refresh
          // the AI's knowledge before the next fight.
          this.syncKnownFoes();

          // Award XP
          this.hud.addCombatMessage('⚔️ ' + generateVictoryNarration(), '#ffd700');
          this.hud.addCombatMessage(generatePartyCommentary(
            this.party.leader.name,
            this.party.leader.charClass.id,
            this.party.leader.personality,
            'victory'
          ), '#ca8');
          // Treasure — D&D loot tables keyed to the slain creatures' CR.
          // Escaped creatures carry their pockets with them.
          const corpses = slainMonsters.filter(m => !m.fled);
          const loot = this.rollAndGrantLoot(corpses);
          // Victory fanfare + loot summary panel over the battle window.
          const xpEach = Math.ceil(corpses.reduce((s, m) => s + m.template.xp, 0) / Math.max(1, this.party.alive.length));
          const kindOf = (i: InventoryItem): 'magic' | 'potion' | 'scroll' | 'treasure' | 'other' =>
            i.type === 'potion' ? 'potion' : i.type === 'scroll' ? 'scroll' : i.type === 'treasure' ? 'treasure' : 'other';
          const tally = new Map<string, number>();
          for (const m of corpses) tally.set(m.template.name, (tally.get(m.template.name) ?? 0) + 1);
          this.hud.battleView.showSpoils({
            xpEach,
            gold: loot.goldValue,
            items: loot.items.map(i => ({ name: i.name, kind: kindOf(i) })),
            kills: Array.from(tally.entries()).map(([name, count]) => ({ name, count })),
            boss: slainMonsters.some(m => /boss/i.test(m.template.name) || m.isBoss),
          });
          // A full-moon hunt leaves trophies the smith will pay or forge for.
          const packSlain = corpses.filter(m => m.moonPack);
          if (packSlain.length > 0) {
            const trophies: string[] = [];
            const fangs = packSlain.length;
            if (fangs > 0) trophies.push(`${fangs} Moon-Touched Fang${fangs === 1 ? '' : 's'}`);
            const pelt = packSlain.some(m => /were|wolf|mastiff/i.test(m.template.name));
            if (pelt) trophies.push('a silver-flecked Were-Pelt');
            const trophyItems: InventoryItem[] = [];
            for (let i = 0; i < fangs; i++) {
              trophyItems.push({
                id: `moonfang_${Date.now()}_${i}`,
                name: 'Moon-Touched Fang',
                type: 'treasure' as const,
                value: 12,
                description: 'A fang that glints as if lit from within. Smiths pay well for them; enough could forge a silvered weapon.',
              });
            }
            if (pelt) {
              trophyItems.push({
                id: `werepelt_${Date.now()}`,
                name: 'Silver-Flecked Were-Pelt',
                type: 'treasure' as const,
                value: 40,
                description: 'A pelt tufted with pale silver hairs. Bold proof of a full-moon kill.',
              });
            }
            for (const it of trophyItems) this.party.leader.inventory.push({ ...it });
            this.hud.addCombatMessage(`🐺 The moon-pack falls, leaving ${trophies.join(' and ')} behind. The smith will take them — or forge them for you.`, '#ca8');
          }
          // A gloom-spawned creature always yields a torn half of a rune tablet —
          // a lore trophy the party can study (and eventually match to its twin).
          const runeBearer = slainMonsters.find(m => m.dropsRuneHalf);
          if (runeBearer) {
            const runeHalf: InventoryItem = {
              id: `rune_half_${Date.now()}`,
              name: 'Torn Rune Tablet (Half)',
              type: 'treasure' as const,
              value: 30,
              description: 'A cracked half of a warding tablet, its script old beyond memory. The other half must lie somewhere in the dark below — match them to read the full ward.',
            };
            this.party.leader.inventory.push({ ...runeHalf });
            this.hud.addCombatMessage(`🗿 From the dissipating ${runeBearer.template.name}, a torn half of a rune tablet clatters to the floor — old ward-script, warm to the touch.`, '#a8c');
            this.expeditionJournal.push(`Recovered a torn rune-tablet half from a ${runeBearer.template.name} in ${this.dungeonName}`);
          }
          if (this.mode !== GameMode.Dungeon) {
            this.hud.addCombatMessage('🛡️ The road is clear again — the ambush is broken.', '#8d8');
            this.ambushCooldownUntil = Date.now() + 45000;
            // Bandit clues: defeated bandits may drop maps to hidden camps.
            const banditIds = slainMonsters.filter(m => ['bandit', 'highwayman', 'bandit_captain'].includes(m.template.id)).map(m => m.template.id);
            if (banditIds.length > 0 && this.overworld && this.map) {
              const leader = this.party.leader;
              const clueResult = rollBanditClue(
                banditIds,
                leader.level,
                this.map,
                this.overworld,
                this.banditCamps,
                leader.tile
              );
              if (clueResult) {
                this.hud.addCombatMessage(`🗺️ ${clueResult.clue.sourceName} drops something during the fight...`, '#ca8');
                this.hud.addCombatMessage(`   ${clueResult.clue.description}`, '#a89');
                this.hud.addCombatMessage(`   Tip: "raid camp" to assault it, or "report camp" in town for gold.`, '#888');
              }
            }
          }
          // The party's learned wisdom surfaces after battle
          if (Math.random() < 0.45) {
            const llm = getLLM();
            const wisdom = getRandomElement([
              () => llm.explainRule(),
              () => llm.describeDeity(),
              () => llm.describeCondition(),
              () => llm.describePlane(),
              () => llm.tellLegend(),
              () => llm.museOnAlignment(),
              () => llm.describeTrap(),
              () => llm.speakProphecy(),
            ])();
            this.hud.addCombatMessage(wisdom, '#9aa');
          }
          this.phase = GamePhase.Exploration;
          this.hud.setBosses([]);
          // Keep the battle window up until the player reads the spoils.
          this.hud.battleView.closeAfterSpoils();
          // Clear POI after combat victory.
          if (this.activePOI) {
            // The moon-forge's guardian fallen, the anvil remakes the blade legendary.
            if (this.activePOI.kind === 'moon_forge' && !this.moonForgeBlade) {
              this.moonForgeBlade = true;
              for (const m of this.party.members) if (m.isAlive) m.addXp(120);
              this.hud.addCombatMessage(`⚔ The guardian's silver dissolves into the anvil, and the smith's work is unmade and remade — the party's blade becomes the legendary Moonfall.`, '#ffd700');
              this.hud.addCombatMessage(`Moonfall: +2 damage on every strike, +4 on critical hits, forever.`, '#ffd700');
              this.expeditionJournal.push(`Forged the legendary Moonfall at ${this.activePOI.name}`);
            }
            this.activePOI.cleared = true;
            this.chainFrom(this.activePOI);
            this.hud.addCombatMessage(`${poiIcon(this.activePOI.kind)} ${this.activePOI.name} has been cleared!`, '#8f8');
            this.expeditionJournal.push(`Cleared ${this.activePOI.name}`);
            this.activePOI = null;
          }
        } else {
          // Party overwhelmed — a harrowing retreat, not a free resurrection.
          this.history.defeats++;
          // Adaptive difficulty: defeat and near-defeat both ease the pressure.
          this.recordCombatOutcome(
            this.party.members.filter(m => m.isDead).length,
            this.party.alive.length > 0
              ? this.party.alive.reduce((s, m) => s + m.hp / m.maxHp, 0) / this.party.alive.length
              : 0,
          );
          this.hud.addCombatMessage('The party has been defeated...', '#c44');
          // Defeat sting rides the same audio engine as the victory fanfare.
          this.hud.battleView.showDefeat();
          this.phase = GamePhase.Exploration;
          this.hud.setBosses([]);
          // Dismiss the battle window now the fight is lost.
          this.hud.battleView.close();
          this.partyRetreat();

          if (this.mode !== GameMode.Dungeon) {
            // Surface defeat: the ambushers melt back into the wilds and the
            // party drags itself to the nearest town to recover.
            this.monsters = [];
            const town = this.nearestTown(this.party.leader.tile);
            if (town) {
              this.overworldDestination = { kind: 'town', id: town.id };
              this.overworldPath = [];
              this.hud.addCombatMessage(`The survivors stagger back toward ${town.name} to lick their wounds.`, '#c66');
            }
            this.ambushCooldownUntil = Date.now() + 30000;
          } else {
            // Remove one random monster as "the one that got away"
            if (this.monsters.length > 0) {
              const idx = Math.floor(Math.random() * this.monsters.length);
              this.monsters.splice(idx, 1);
            }
          }
        }
      }
    }
  }

  // ── Rendering ───────────────────────────────────

  /**
   * Switch graphics library. The heavy ones are imported only when asked for,
   * so a player on the default canvas never downloads them.
   */
  async useBackend(id: RenderBackendId): Promise<void> {
    const next = await createBackend(id);
    // A canvas element can only ever hold one kind of context, so a canvas
    // that has carried WebGL will never give back a 2D one. Each switch gets a
    // fresh element, and the old backend is torn down only once the new one
    // has started, so a failure leaves the current renderer untouched.
    const canvas = this.renderer.replaceCanvas();
    try {
      await next.init(canvas, GAME_WIDTH, GAME_HEIGHT);
    } catch (err) {
      this.renderer.replaceCanvas();
      await this.backend.init(this.renderer.canvas, GAME_WIDTH, GAME_HEIGHT);
      throw err;
    }
    this.backend.destroy();
    this.backend = next;
    this.backendReady = true;
    try {
      localStorage.setItem('fatefall.renderer', id);
    } catch {
      /* private mode: the choice just will not stick */
    }
    this.hud.addCombatMessage(`Renderer: ${next.name}.`, '#8cf');
  }

  /**
   * How the scene should feel, for backends that can light and grade it. The
   * map renderer draws the same tiles at noon and at midnight; the game knows
   * the difference, so it says so here rather than teaching the renderer.
   */
  /**
   * Shake the view when a round lands hard.
   *
   * The combat log is the only account of what happened that reaches this far
   * — CombatLog carries messages and nothing structured — so the beat is read
   * out of the text, which is what CombatEngine itself does to spot a crit.
   * The reason to do it here rather than plumb an event through is that the
   * shake is a matter of presentation: if the log is right about the round,
   * the picture is right about it too.
   */
  /**
   * Put a round's numbers over the creatures they happened to.
   *
   * Like the camera kick above, this reads the log's text, because CombatLog
   * carries messages and nothing structured. Rather than pick names out with a
   * regex — the lines carry prefixes and punctuation that make that brittle —
   * every creature on the field is asked whether a line is about it, which
   * also hands back the tile to put the number on.
   *
   * Where several identical monsters are in the fight the log cannot say which
   * bandit was hit, so the number goes to the first living one of that name.
   * It can land on a sibling; the alternative is threading the target through
   * CombatEngine, which is a real change to a DOM-free module for a cosmetic
   * gain, and this is close enough to read correctly in play.
   */
  private popCombatNumbers(messages: string[], actor: GameCharacter | Monster | null = null): void {
    if (messages.length === 0) return;
    // Whoever's turn it was, captured before the step consumed it. A spell is
    // only worth drawing in flight if we know where it came from.
    const origin = actor && actor.tile ? actor.tile : null;
    const pop = (tile: Vector2, text: string, kind: FloaterKind) =>
      this.mapRenderer.popNumber(tile.x * TILE_SIZE, tile.y * TILE_SIZE, text, kind);
    const burst = (tile: Vector2, line: string, healing = false) => {
      const kind = healing ? 'heal' : effectFor(line);
      // The sound of it, by the same reading of the line the picture uses.
      if (kind === 'fire') sfx.fire();
      else if (kind === 'shock') sfx.shock();
      else if (kind === 'arcane') sfx.arcane();
      else if (kind === 'heal') sfx.heal();
      // Magic crosses the room; a weapon does not. Drawing a streak of light
      // for a man stepping forward and swinging reads as nonsense.
      if (origin && kind !== 'strike' && (origin.x !== tile.x || origin.y !== tile.y)) {
        this.mapRenderer.popBolt(origin.x * TILE_SIZE, origin.y * TILE_SIZE, tile.x * TILE_SIZE, tile.y * TILE_SIZE, kind);
        sfx.cast();
      }
      this.mapRenderer.popEffect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, kind);
    };

    for (const line of messages) {
      const crit = line.includes('CRITICAL');
      let placed = false;

      for (const m of this.monsters) {
        const name = m.template.name;
        if (line.includes(name + ' is slain')) {
          pop(m.tile, 'slain', 'slain');
          sfx.slain();
          this.mapRenderer.popDeath(m.tile.x * TILE_SIZE, m.tile.y * TILE_SIZE, m);
          placed = true;
          break;
        }
        const dealt = m.isAlive ? amountAfter(line, name + ' takes ') : null;
        if (dealt !== null) { pop(m.tile, '-' + dealt, crit ? 'crit' : (damageTint(line) ?? 'hit')); burst(m.tile, line); elementSound(line); if (crit) sfx.crit(); else if (effectFor(line) === 'strike') sfx.hit(); placed = true; break; }
      }
      if (placed) continue;

      for (const c of this.party.members) {
        if (line.includes(c.name + ' is down')) { pop(c.tile, 'down', 'down'); sfx.down(); break; }
        const taken = amountAfter(line, c.name + ' takes ');
        if (taken !== null) { pop(c.tile, '-' + taken, crit ? 'crit' : (damageTint(line) ?? 'hurt')); burst(c.tile, line); elementSound(line); if (crit) sfx.crit(); else if (effectFor(line) === 'strike') sfx.hurt(); break; }
        const healed = amountAfter(line, c.name + ' heals ');
        if (healed !== null) { pop(c.tile, '+' + healed, 'heal'); burst(c.tile, line, true); break; }
      }
    }
  }

  private kickCameraFor(messages: string[]): void {
    let amplitude = 0;
    for (const m of messages) {
      if (m.includes('CRIT')) { amplitude = Math.max(amplitude, 7); this.flash = Math.max(this.flash, 0.55); }
      else if (m.includes('goes down') || m.includes('falls')) amplitude = Math.max(amplitude, 5);
    }
    if (amplitude > 0) this.camera.shake(amplitude, 260);
  }

  /** How long a place change and a battle wipe take, in ms. */
  private static readonly FADE_MS = 520;
  private static readonly BLINDS_MS = 700;
  /** How long the blinds have the map before the battle window covers it. */
  private static readonly BATTLE_WINDOW_DELAY_MS = 380;

  /** The white hit of a critical, 0..1, gone in about a seventh of a second. */
  private flash = 0;

  /** The score. It follows where the party is and what they are doing, and crossfades between. */
  private readonly music = getMusic();

  /** The weather, heard: rain, wind, the hush of a cave. Follows the same state the picture does. */
  readonly ambience = getAmbience();

  /**
   * Which piece the moment wants. Asked every simulation step; the music
   * treats the same answer twice as nothing to do, and a new answer as a
   * crossfade, so this can be blunt about it.
   */
  private musicMood(): MusicMood {
    if (!this.running) return 'title';
    if (this.phase === GamePhase.Combat) {
      return this.combatEngine.getBosses().length > 0 ? 'boss' : 'battle';
    }
    if (this.mode === GameMode.Town) return 'town';
    if (this.mode === GameMode.Dungeon) {
      const t = this.dungeonTheme?.id ?? '';
      if (/clockwork_foundry|astral_wreck|ancient_dwarven_hall|salt_mine_deeps/.test(t)) return 'dungeon_clockwork';
      if (/haunted_theatre|vampire_castle|plague_hospice|frozen_necropolis|shadowfell_crossing|royal_crypt/.test(t)) return 'dungeon_haunted';
      return 'dungeon';
    }
    return this.clock.light < 0.34 ? 'overworld_night' : 'overworld';
  }

  /** The transition in flight. Advanced in render(), since it is a property of the picture. */
  private transition: { kind: 'fade' | 'blinds'; ms: number; total: number } | null = null;

  /**
   * Begin a transition. A change of place cuts to black and fades up on the
   * new place; a fight closes blinds over the map and fades up on the battle.
   * By the time this is called the mode has already switched — the effect is
   * the announcement, not the mechanism, which is what lets it be added to a
   * dozen call sites without reordering any of them.
   */
  beginTransition(kind: 'fade' | 'blinds'): void {
    this.transition = { kind, ms: 0, total: kind === 'fade' ? Game.FADE_MS : Game.BLINDS_MS };
    if (kind === 'blinds') sfx.battle();
    else sfx.fade();
  }

  private sceneMood(): SceneMood {
    // Every mode draws the world through the same camera, so the party's light
    // sits at the same place in the frame whether it is a torch in a tomb or the
    // bit of moonlight that keeps them visible on the road at night.
    const leader = this.party.leader;
    const focus = {
      x: leader.tile.x * TILE_SIZE - this.camera.x + TILE_SIZE / 2,
      y: leader.tile.y * TILE_SIZE - this.camera.y + TILE_SIZE / 2,
    };
    return {
      daylight: this.clock.light,
      underground: this.mode === GameMode.Dungeon,
      themeId: this.mode === GameMode.Dungeon ? (this.dungeonTheme?.id ?? null) : null,
      flash: this.flash,
      weather: this.weather?.type ?? null,
      focus,
      lightScale: this.mode === GameMode.Dungeon ? (this.darkness ? 0.42 : this.torchLeft > 0 && this.torchLeft < 120 ? 0.7 : 1) : 1,
      inCombat: this.phase === GamePhase.Combat,
      transition: this.transition
        ? { kind: this.transition.kind, progress: Math.min(1, this.transition.ms / this.transition.total) }
        : null,
    };
  }

  private render() {
    // Where the view is is a property of the picture, not of the simulation,
    // so it eases here at the display's rate. On the fixed 33 ms sim step it
    // moved at 30 Hz while the sprites it was following interpolated at full
    // frame rate, and the party visibly slid against the ground.
    this.camera.update(this.lastDt);
    // The flash is a hit, not a fade: it lands at full and is gone almost at
    // once, which is what makes it read as impact rather than as a light.
    if (this.flash > 0) this.flash = Math.max(0, this.flash - this.lastDt / 140);
    if (this.transition) {
      this.transition.ms += this.lastDt;
      if (this.transition.ms >= this.transition.total) this.transition = null;
    }

    // The frame is described into a recorder rather than drawn straight to a
    // context, so the same frame can be replayed by any backend. The map
    // renderer and the sprite functions are unchanged; they simply receive a
    // recorder where they used to receive a canvas context.
    this.recorder.begin('#0a0a12', this.sceneMood());
    // Most of the tick is spent gliding, so a march is motion rather than a
    // step and a pause; the remainder lets a stop read as a stop.
    const moveMs = Math.max(160, Math.min(720, this.tickInterval * 0.88));
    if (this.mode === GameMode.Overworld || this.mode === GameMode.Town) {
      const campTiles = this.banditCamps.camps.filter(c => c.discovered && !c.resolved).map(c => c.tile);
      // The active quest's destination: its target entrance while hunting, or
      // the giver town once the objective is complete (time to report).
      const active = this.activeQuest();
      let questDest: { x: number; y: number } | null = null;
      if (active && this.overworld) {
        if (active.completed) {
          questDest = this.overworld.towns.find(t => t.id === active.giverTownId)?.tile ?? null;
        } else {
          questDest = questTargetEntrance(active, this.overworld)?.tile ?? null;
        }
      }
      this.mapRenderer.renderOverworld(
        this.map,
        this.camera,
        this.party.members.filter(m => m.isAlive),
        this.wanderers,
        this.overworld?.towns ?? [],
        this.overworld?.entrances ?? [],
        this.lastDt,
        moveMs,
        this.festivalsByTown(),
        this.monsters,
        campTiles,
        this.pois,
        questDest,
        this.overworldRecentTiles,
      );
    } else {
      this.mapRenderer.render(
        this.map,
        this.camera,
        this.party.members.filter(m => m.isAlive),
        this.monsters,
        this.traps,
        this.rooms,
        this.dungeonTheme?.id,
        this.lastDt,
        moveMs,
        this.dungeonRecentTiles
      );
    }
    if (this.backendReady) this.backend.submit(this.recorder.end());
  }

  // ── Helpers ─────────────────────────────────────

  /**
   * Room centres holding a chest the party has not opened yet, within reach.
   * Chests live on the room's feature, so the room centre is where to walk to.
   */
  /** Pieces of treasure the party has hauled out this run (collect_item quests). */
  public treasuresFound: number = 0;

  /**
   * How many times the party may fail to step toward a chest before the AI
   * stops being offered it. More than one because a blocked step is usually a
   * companion or a monster standing in the way, which clears on its own.
   */
  private static readonly CHEST_GIVE_UP_TRIES = 3;

  /** Chests the party could not reach this floor, by room centre. */
  private blockedChests = new Map<string, number>();

  /**
   * Spend one revivify scroll on a fallen ally, where the party stands.
   *
   * The scroll's worth is the rest it saves: tending the dead costs dungeon
   * time and dungeon time draws wandering monsters. If the scroll cannot be
   * found after all, the ally is tended back the slow way rather than left
   * down, because the AI asks again every tick and a no-op here would spin.
   */
  private spendRevivifyScroll(): void {
    const fallen = this.party.members.find(m => m.isDead);
    if (!fallen) return;
    const holder = this.party.members.find(m => m.inventory.some(i => i.id === 'scroll_revivify'));
    const scroll = holder?.useItem('scroll_revivify');
    fallen.revive(1);
    if (holder && scroll) {
      this.hud.addCombatMessage(
        `${holder.name} unrolls ${scroll.name} — a golden thread pulls ${fallen.name} back from death at 1 HP.`,
        '#fd8',
      );
      return;
    }
    this.hud.addCombatMessage(`${fallen.name} is tended to and brought back at 1 HP.`, '#f88');
  }

  private unopenedChestsNearby(radius: number): Vector2[] {
    if (this.mode !== GameMode.Dungeon) return [];
    const from = this.party.leader.tile;
    return this.rooms
      .filter(r => r.feature?.kind === 'chest' && !r.feature.used)
      .map(r => vec2(r.cx, r.cy))
      .filter(t => (this.blockedChests.get(`${t.x},${t.y}`) ?? 0) < Game.CHEST_GIVE_UP_TRIES)
      .filter(t => manhattan(from, t) <= radius);
  }

  private getVisibleMonsters(range: number): Monster[] {
    const leader = this.party.leader;
    return this.monsters.filter(m => {
      if (!m.isAlive) return false;
      const d = manhattan(leader.tile, m.tile);
      return d <= range;
    });
  }

  private getNearbyTilesByType(type: TileType, pos: Vector2, range: number): Vector2[] {
    const results: Vector2[] = [];
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (this.map.getTile(pos.x + dx, pos.y + dy) === type) {
          results.push({ x: pos.x + dx, y: pos.y + dy });
        }
      }
    }
    return results;
  }

  private setSpeed(speed: GameSpeed) {
    this.tickInterval = 800 / speed;
    this.combatTickInterval = BattleView.TURN_MS / speed;
  }

  /**
   * FF command menu: run one full combat tick while the command menu is open.
   * Returns true if a hero's turn is now paused awaiting a decision.
   */
  private stepCombatOnce(): boolean {
    const actor = this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex] ?? null;
    const log = this.combatEngine.step();
    this.hud.addCombatLogBatch(log);
    this.kickCameraFor(log.messages);
    this.popCombatNumbers(log.messages, actor);
    this.hud.setParty(this.party);
    this.refreshBossBar();
    this.hud.battleView.update({
      round: this.combatEngine.log.round,
      actors: this.combatEngine.initiativeOrder,
      currentActorId: this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex]?.id ?? null,
      messages: log.messages,
      over: log.isOver,
      winner: log.winner,
    });
    if (log.isOver) {
      // Let updateCombat's normal end-of-combat branch handle resolution by
      // continuing the regular tick loop — report not-paused.
      return false;
    }
    return this.combatEngine.decisionActor != null;
  }

  /** True while the world is held still, by the player or by an error halt. */
  get isPaused(): boolean { return this.paused; }

  togglePause() {
    this.paused = !this.paused;
    this.hud.setPausedIndicator(this.paused);
    if (!this.paused) this.clearErrorHalt();
  }

  /** Lift a self-inflicted error pause (new run, restore, or the player resuming). */
  private clearErrorHalt(): void {
    if (!this.errorHalt) return;
    this.errorHalt = false;
    this.consecutiveErrors = 0;
    this.accumulator = 0;
    this.hud.hideErrorBanner();
  }

  /** Narrate the surface around the leader (towns, entrances, biomes). */
  describeOverworldHere(): string {
    if (!this.overworld) return 'The open road stretches in every direction.';
    const t = this.map.getTile(this.party.leader.tile.x, this.party.leader.tile.y);
    const town = townAt(this.overworld, this.party.leader.tile.x, this.party.leader.tile.y);
    const e = entranceAt(this.overworld, this.party.leader.tile.x, this.party.leader.tile.y);
    if (town) return `${town.name} rises before the party — ${town.description}.`;
    if (e) return `A dark entrance yawns nearby: ${e.name}. ${e.description}.`;
    const biome = t === TileType.Forest ? 'Forested land closes in — the canopy filters the light.'
      : t === TileType.Mountain ? 'Thin mountain air and bare stone rise around the trail.'
      : t === TileType.Desert ? 'Heat shimmers over a dry, sandy expanse.'
      : t === TileType.Swamp ? 'Murky pools and hanging moss — the ground squelches underfoot.'
      : t === TileType.Snow ? 'Snow stretches white to every horizon, the road a dark thread through it.'
      : t === TileType.Sand ? 'The shore runs alongside the water, sand warm underfoot.'
      : t === TileType.Road || t === TileType.Bridge ? 'The road runs straight and true, worn smooth by countless carts.'
      : 'Open grassland rolls to the horizon.';
    const dest = this.overworldDestination
      ? this.overworldDestination.kind === 'town' ? 'a town' : 'a dungeon entrance'
      : null;
    return dest ? `${biome} The party presses on toward ${dest}.` : biome;
  }

  private describeParty(): string {
    const members = this.party.members;
    return 'Party: ' + members.map(m => {
      let desc = `${m.name} (Lv${m.level} ${m.race.name} ${m.charClass.name}`;
      if (m.subclass) desc += `, ${m.subclass.split(' (')[0]}`;
      if (m.alignment) desc += `, ${m.alignment}`;
      if (m.deity) desc += `, sworn to ${m.deity}`;
      return desc + ')';
    }).join(', ');
  }

  // ── Atmospheric room narration ──────────────────

  /** The room currently containing the leader, if any. */
  currentRoom(): Room | undefined {
    const leader = this.party.leader;
    return this.rooms.find(r =>
      leader.tile.x >= r.x && leader.tile.x < r.x + r.width &&
      leader.tile.y >= r.y && leader.tile.y < r.y + r.height
    );
  }

  private currentRoomIndex(): number {
    const leader = this.party.leader;
    return this.rooms.findIndex(r =>
      leader.tile.x >= r.x && leader.tile.x < r.x + r.width &&
      leader.tile.y >= r.y && leader.tile.y < r.y + r.height
    );
  }

  /** Living monsters sharing the leader's current room. */
  private monstersInCurrentRoom(): Monster[] {
    const room = this.currentRoom();
    if (!room) return [];
    return this.monsters.filter(m =>
      m.isAlive &&
      m.tile.x >= room.x && m.tile.x < room.x + room.width &&
      m.tile.y >= room.y && m.tile.y < room.y + room.height
    );
  }

  /**
   * A paragraph describing the room the party stands in, woven from the
   * dungeon's theme, the monsters present, and the party's history.
   */
  describeCurrentRoom(): string {
    if (!this.dungeonTheme) return generateRoomDescription(this.dungeonLevel);

    const monsters = this.monstersInCurrentRoom().map(m => ({
      id: m.template.id,
      name: m.template.name.replace(/^\ud83d\udc80 /, '').replace(/^\u2620\ufe0f? /, '').replace(/ \(Boss\)$/, ''),
      type: m.template.type,
      size: m.template.size,
    }));

    const members = this.party.members;
    const living = members.filter(m => !m.isDead);
    const avgHpPct = living.length === 0
      ? 0
      : living.reduce((s, m) => s + Math.max(0, m.hp) / m.maxHp, 0) / living.length;
    const leader = this.party.leader;

    const base = generateAtmosphericRoomDescription({
      theme: this.dungeonTheme,
      dungeonLevel: this.dungeonLevel,
      monsters,
      party: {
        leaderName: leader.name,
        deity: leader.deity,
        background: leader.background,
        alignment: leader.alignment,
        averageHpPct: avgHpPct,
        exhausted: members.filter(m => m.exhaustion > 0).length,
        downed: members.filter(m => !m.isConscious && !m.isDead).length,
        dead: members.filter(m => m.isDead).length,
      },
      history: { ...this.history },
    });

    // The room's own feature is always called out so the party knows what
    // stands before them (and what DM orders will interact with it).
    const feature = this.currentRoom()?.feature;
    if (feature) {
      return `${base}\n\n\u2694 ${feature.entryLine}`;
    }
    return base;
  }

  // ── Room feature interactions ──────────────────

  /** What to type for each feature kind, shown on generic searches. */
  /**
   * Act on a room-feature intent for the room the party stands in. The work
   * itself lives in RoomFeatureController; Game only supplies the context.
   */
  /** True while the party is standing in a town. */
  get inTown(): boolean { return this.mode === GameMode.Town; }

  /** Everything that happens when the party uses a room's feature. */
  private readonly roomFeatures = new RoomFeatureController(this);

  performFeatureIntent(intent: DMIntent): boolean {
    return this.roomFeatures.perform(intent);
  }

  // ── Traps & hazards ────────────────────────────

  /** Passive detection: mark nearby undetected traps the party can notice. */
  private sweepTraps(): string[] {
    if (this.traps.length === 0) return [];
    return sweepDetection(this.traps, this.party.members, this.party.leader.tile, 2);
  }

  /** Best member for trap work: a rogue if possible, else highest dexterity. */
  bestDisarmer(): GameCharacter {
    const alive = this.party.alive;
    if (alive.length === 0) return this.party.leader;
    const rogues = alive.filter(m => m.charClass.id === 'rogue');
    const pool = rogues.length > 0 ? rogues : alive;
    return pool.reduce((best, m) => (m.dexMod > best.dexMod ? m : best), pool[0]);
  }

  /** Best scout for active searches: rogues/rangers, else highest wisdom. */
  bestScout(): GameCharacter {
    const alive = this.party.alive;
    if (alive.length === 0) return this.party.leader;
    const scouts = alive.filter(m => ['rogue', 'ranger'].includes(m.charClass.id));
    const pool = scouts.length > 0 ? scouts : alive;
    return pool.reduce((best, m) => (m.wisMod > best.wisMod ? m : best), pool[0]);
  }

  /**
   * A detected trap within reach is disarmed by the best-suited hand.
   * Returns true if a disarm (or fumble) actually happened.
   */
  checkTrapDisarm(maxDist: number = 1): boolean {
    if (this.phase !== GamePhase.Exploration) return false;
    const leader = this.party.leader;
    const target = this.traps
      .filter(t => t.detected && !t.disarmed)
      .map(t => ({ t, d: Math.max(Math.abs(t.tile.x - leader.tile.x), Math.abs(t.tile.y - leader.tile.y)) }))
      .sort((a, b) => a.d - b.d)[0];
    if (!target || target.d > maxDist) return false;

    const kind = getTrapKind(target.t.kindId)!;
    const disarmer = this.bestDisarmer();
    const result = rollDisarm(disarmer, target.t, kind);
    if (result.success) {
      target.t.disarmed = true;
      this.hud.addCombatMessage(`${disarmer.name} disarms the ${kind.name} with steady hands (${result.total} vs DC ${kind.disarmDc}).`, '#6c6');
    } else if (result.criticalFailure) {
      this.hud.addCombatMessage(`${disarmer.name} fumbles the ${kind.name}...`, '#c44');
      for (const msg of triggerTrap(target.t, disarmer).messages) this.hud.addCombatMessage(msg, '#c66');
    } else {
      this.hud.addCombatMessage(`${disarmer.name} fails to disable the ${kind.name} (${result.total} vs DC ${kind.disarmDc}).`, '#a86');
    }
    return true;
  }

  /** Any member standing on an armed trap springs it. */
  private checkTrapTriggers(): void {
    if (this.traps.length === 0) return;
    for (const trap of this.traps) {
      if (trap.disarmed) continue;
      for (const member of this.party.members) {
        if (!member.isAlive) continue;
        if (member.tile.x === trap.tile.x && member.tile.y === trap.tile.y) {
          for (const msg of triggerTrap(trap, member).messages) this.hud.addCombatMessage(msg, '#c66');
          break;
        }
      }
    }
  }

  // ── Save / Load ────────────────────────────────

  /** Reading the run out to a slot, and writing a saved one back in. */
  private readonly saves = new SaveSerializer(this);

  /** Serialize the run to the active slot. Manual saves log confirmation. */
  saveGame(silent: boolean = true): boolean {
    const ok = saveToSlot(this.activeSlot, this.toSaveData());
    if (!silent) {
      this.hud.addCombatMessage(
        ok ? `💾 Saved to slot ${this.activeSlot + 1}.` : 'The quill snaps — the save fails!',
        ok ? '#8cf' : '#c44'
      );
    }
    return ok;
  }

  /** The run as a slot-ready snapshot. The field-by-field mapping is in SaveSerializer. */
  private toSaveData(): SaveData {
    return this.saves.capture();
  }

  /** Apply a saved snapshot to this running game, in place. */
  restore(save: SaveData) {
    this.saves.apply(save);
  }

  // ── What a restore asks of Game ────────────────
  //
  // SaveSerializer moves the state. These are the effects that go with it —
  // the ones that need Game's own machinery — each called at the point in a
  // restore where it has always happened.

  /** Put the party underground: a dungeon-only save carries no surface world. */
  enterDungeonMode(): void { this.mode = GameMode.Dungeon; }

  /** Put the party on the surface — where a save that names no mode belongs. */
  enterOverworldMode(): void { this.mode = GameMode.Overworld; }

  /** True while the party is travelling the surface world. */
  get inOverworld(): boolean { return this.mode === GameMode.Overworld; }

  /** True while the party is inside a dungeon. */
  get inDungeon(): boolean { return this.mode === GameMode.Dungeon; }

  /** True while a battle is being fought out turn by turn. */
  get inCombat(): boolean { return this.phase === GamePhase.Combat; }

  /**
   * True from the moment initiative is rolled until the last blow has finished
   * landing — `inCombat` plus its animating tail. This, not `inCombat`, is what
   * a DM order asks before refusing to march, rest or descend.
   */
  get inBattle(): boolean { return this.phase !== GamePhase.Exploration; }

  /** Lift the pause and any error halt the run was carrying when it stopped. */
  resumeRun(): void {
    this.paused = false;
    this.clearErrorHalt();
  }

  /** Re-open the battle window for a save taken mid-fight. */
  reopenBattleView(): void {
    this.hud.battleView.onSpeedChange = (speed) => { this.combatTickInterval = BattleView.TURN_MS / speed; };
    this.hud.battleView.onCommand = this.guard(this.handleBattleCommand);
    this.combatEngine.setDecisionPause(this.runMode === 'manual');
    this.wireBattleModeToggle();
    this.hud.battleView.syncSpeedFromInterval(this.combatTickInterval);
    this.hud.battleView.open(this.party, this.combatEngine.monsters, this.sprites, this.battleScene());
    this.hud.battleView.update({
      round: this.combatEngine.log.round,
      actors: this.combatEngine.initiativeOrder,
      currentActorId: this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex]?.id ?? null,
      messages: ['⏳ Battle restored.'],
    });
  }

  /** Zero the loop timers and stuck counters a restored run would inherit. */
  resetTransientTimers(): void {
    this.tickTimer = 0;
    this.combatTickTimer = 0;
    this.saveTimer = 0;
    this.stuckDirCount = 0;
    this.lastActionDir = '';
  }

  /**
   * A dungeon save that somehow lost its layout would strand the party in a
   * layoutless void. Regenerate the floor from the fixed-map seed — the same
   * halls as the original delve.
   */
  rebuildLostDungeonFloor(): void {
    this.hud.addCombatMessage('The dungeon reassembles itself from old stone — its halls remember you.', '#a86');
    this.map = new TileMap();
    this.camera.setBounds(this.map.width, this.map.height);
    this.rooms = generateDungeon(this.map, 14 + Math.min(6, this.dungeonLevel), 4, 10, this.dungeonSeed());
    assignFeaturesToRooms(this.rooms, this.dungeonLevel);
    this.traps = [];
    this.monsters = [];
    this.monsterIdCounter = 0;
    this.populateDungeonFloor();
    const startRoom = this.rooms[0];
    this.party.setPosition({ x: startRoom.cx, y: startRoom.cy }, (x, y) => this.map.isWalkable(x, y));
    this.camera.x = startRoom.cx * TILE_SIZE - 512;
    this.camera.y = startRoom.cy * TILE_SIZE - 384;
    this.camera.targetX = this.camera.x;
    this.camera.targetY = this.camera.y;
    this.visitedRooms = new Set([0]);
    this.phase = GamePhase.Exploration;
    this.combatEngine.monsters = this.monsters;
    this.combatEngine.isActive = false;
    this.combatEngine.initiativeOrder = [];
    this.combatEngine.currentTurnIndex = 0;
  }

  /** Count the room the party stands in as seen, so a restore doesn't re-narrate it. */
  markRestoredRoomVisited(): void {
    const here = this.currentRoomIndex();
    this.visitedRooms = here === -1 ? new Set() : new Set([here]);
    this.history.roomsVisited = Math.max(this.history.roomsVisited, this.visitedRooms.size);
  }

  /** Forget where the party was walking to — a restored run stands still. */
  clearTravelPlans(): void {
    this.townWaitTimer = 0;
    this.overworldDestination = null;
    this.overworldPath = [];
  }

  /**
   * Point the surface march at a town or a dungeon mouth. Any route already
   * plotted is dropped, so the next tick paths afresh to the new goal.
   */
  travelTo(kind: 'town' | 'entrance', id: string): void {
    this.overworldDestination = { kind, id };
    this.overworldPath = [];
  }

  /** True while a descent is already queued, so a second order is a no-op. */
  get isDescending(): boolean { return this.descending; }

  /**
   * Send the party looking for the stairwell down. The floor is not built
   * until the search has had a moment to look like a search.
   */
  beginDescent(): void {
    this.descending = true;
    setTimeout(() => this.generateNewDungeon(), 400);
  }

  /**
   * Save the run, close every panel, stop the loop, and show the start
   * screen again — the world freezes behind the menu until a slot is chosen.
   */
  returnToMainMenu(): void {
    this.saveGame();
    this.hud.closeOverlays();
    this.running = false;
    this.music.play('title');
    this.ambience.stop();
    this.hud.showStartScreen(listSaves(), this.activeSlot);
  }

  /** Start-screen decision: continue the chosen slot's run or begin fresh in it. */
  handleStartChoice(choice: 'continue' | 'new', slot: number): void {
    this.hud.hideStartScreen();
    this.activeSlot = slot;

    if (choice === 'continue') {
      const saved = loadFromSlot(slot);
      if (saved) {
        this.restore(saved);
        this.hud.resetLog();
        // An older save has no roads for its members; deal them now, since
        // start() is a no-op when the title screen already had the loop going.
        this.ensurePersonalQuests();
    this.ensureFamiliars();
        this.hud.addCombatMessage(
          `\u23f3 Run restored \u2014 ${saved.dungeonName} (slot ${slot + 1}), saved ${new Date(saved.savedAt).toLocaleString()}.`,
          '#ffd700'
        );
      }
    } else if (choice === 'new') {
      // A brand-new run begins with the player choosing the party's classes;
      // the run itself starts when they set out.
      this.hud.partyBuilder.show({
        portrait: (classId) => this.mapRenderer.sprites.getClassSprite(classId),
        onBack: () => {
          this.hud.partyBuilder.hide();
          this.hud.showStartScreen(listSaves(), slot);
        },
        onBegin: (classIds, options) => {
          this.hud.partyBuilder.hide();
          this.startFreshRun(classIds, options);
          this.start();
        },
      });
      return;
    }

    this.start();
  }

  /**
   * The floor's boss, placed in a room: a level above the floor, answering to
   * the theme, or the story's antagonist on the act's floor. Used when the
   * floor is laid out, and by the fail-safe when a posting still wants a boss
   * that is nowhere to be found.
   */
  private spawnFloorBoss(room: { cx: number; cy: number }, fixed?: { template: MonsterTemplate; pos: Vector2 }): Monster {
    const bossCr = Math.min(5, this.dungeonLevel);
    const themeId = this.dungeonTheme?.id;
    const bossTemplates = MONSTER_TEMPLATES.filter(m => m.cr >= bossCr - 0.5 && m.cr <= bossCr + 0.5 && !isUnseeableMonster(m.id));
    const themedBosses = themeId && THEME_MONSTERS[themeId]
      ? bossTemplates.filter(m => THEME_MONSTERS[themeId].includes(m.id))
      : [];
    let bossTemplate = themedBosses.length > 0
      ? themedBosses[Math.floor(Math.random() * themedBosses.length)]
      : bossTemplates.length > 0
        ? bossTemplates[Math.floor(Math.random() * bossTemplates.length)]
        : getRandomMonster(bossCr, themeId);
    // A pre-built hall names its own boss.
    if (fixed) bossTemplate = fixed.template;
    // The story's antagonist takes the last room on the act's floor.
    const storyBoss = this.storyController.bossOverride(this.dungeonLevel);
    if (storyBoss) {
      bossTemplate = storyBoss.template;
      this.hud.addCombatMessage(`\u2620 ${storyBoss.name} is here. The air knows it.`, '#e0705f');
    }
    // Somewhere it can stand: its fixed tile when it has one, a free tile in
    // the room, any walkable tile in it, or the room's centre as a last resort.
    const fixedFree = fixed && this.map.isWalkable(fixed.pos.x, fixed.pos.y) && !this.monsters.some(m => m.isAlive && m.tile.x === fixed.pos.x && m.tile.y === fixed.pos.y);
    const pos = (fixedFree ? fixed!.pos : null) ?? findEmptyTile(this.map, room as Room, this.monsters) ?? this.walkableIn(room as Room) ?? { x: room.cx, y: room.cy };
    const boss = this.spawnMonster(bossTemplate, pos);
    boss.maxHp = Math.floor(boss.maxHp * (storyBoss ? 1.5 * STORY_BOSS_HP_SCALE : 1.5));
    boss.hp = boss.maxHp;
    boss.template = { ...boss.template, name: `💀 ${boss.template.name} (Boss)`, xp: boss.template.xp * 3 };
    return boss;
  }

  /** Any walkable tile inside a room, nearest its centre first. */
  private walkableIn(room: Room): Vector2 | null {
    let best: Vector2 | null = null;
    let bestD = Infinity;
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (!this.map.isWalkable(x, y)) continue;
        const d = Math.abs(x - room.cx) + Math.abs(y - room.cy);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    return best;
  }

  /** A walkable, unoccupied tile within a few steps of the party, for a foe that must be reachable. */
  private walkableNearParty(): Vector2 | null {
    const lead = this.party.leader.tile;
    const taken = new Set([...this.monsters.filter(m => m.isAlive), ...this.party.members].map(m => `${m.tile.x},${m.tile.y}`));
    for (let r = 2; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dy) !== r) continue;
          const x = lead.x + dx, y = lead.y + dy;
          if (this.map.isWalkable(x, y) && !taken.has(`${x},${y}`)) return { x, y };
        }
      }
    }
    return null;
  }

  /** The delve did something: the fail-safe's count starts over. */
  private noteProgress(): void {
    this.idleTicks = 0;
    this.stuckAnnounced = 0;
  }

  /**
   * True when the fail-safe took the party's turn. Stage one: after a long
   * while without progress, walk an A* route to the nearest unvisited room
   * or the stairs instead of wandering. Stage two, or stage one with nowhere
   * to route to: the floor is a dead end; raise the boss the posting still
   * wants, or take the stairs, or climb out.
   */
  private stuckFailsafe(): boolean {
    if (this.phase !== GamePhase.Exploration || this.descending || this.dmDirection) return false;
    this.idleTicks++;
    const stage = stuckStage(this.idleTicks);
    if (stage === 0) return false;
    const leader = this.party.leader;
    if (stage === 1) {
      if (this.stuckAnnounced < 1) {
        this.stuckAnnounced = 1;
        this.hud.addCombatMessage(`\ud83e\udded ${leader.name} calls a halt. The party stops wandering and takes stock of the map.`, '#e8b45a');
      }
      if (this.exploreStep()) return true;
      // Nothing to route to: fall through to the dead-end resolution now.
    }
    if (this.stuckAnnounced < 2) this.stuckAnnounced = 2;
    const q = this.activeQuest();
    const resolution = resolveDeadEnd({
      quest: q ? { kind: q.kind, targetFloor: q.targetFloor, completed: q.completed } : null,
      floor: this.dungeonLevel,
      bossAlive: this.monsters.some(m => m.isAlive && (m.isBoss || /\(Boss\)/.test(m.template.name))),
      bossSlain: this.bossSlainThisFloor,
      hasStairs: this.findStairsTile() !== null,
      roomsUnvisited: this.rooms.filter((_, i) => !this.visitedRooms.has(i)).length,
    });
    switch (resolution) {
      case 'raise_boss': {
        // The farthest room, unvisited if any is, so the fight is a march and not an ambush.
        const byDistance = this.rooms
          .map((r, i) => ({ r, i, d: Math.abs(r.cx - leader.tile.x) + Math.abs(r.cy - leader.tile.y) }))
          .sort((a, b) => b.d - a.d);
        const room = (byDistance.find(x => !this.visitedRooms.has(x.i)) ?? byDistance[0])?.r ?? this.rooms[this.rooms.length - 1];
        const boss = this.spawnFloorBoss(room);
        this.combatEngine.monsters = this.monsters;
        this.hud.addCombatMessage(`\ud83d\udd6f Something that had kept out of sight comes looking for the party: ${boss.template.name.replace(/^\ud83d\udc80 /, '')} is on this floor after all.`, '#e0705f');
        this.dungeonRoute = [];
        this.dungeonRouteGoal = -1;
        this.noteProgress();
        return true;
      }
      case 'hunt_boss': {
        // March on the boss along an A* route, one step a tick, until the fight starts.
        const boss = this.monsters.find(m => m.isAlive && (m.isBoss || /\(Boss\)/.test(m.template.name)));
        if (!boss) return false;
        // A locked hall: the quarry is whoever holds the key, until it is held.
        const keeper = this.monsters.find(m => m.isAlive && m.hasKey);
        const quarry = this.floorLocked && !this.floorKeyHeld && keeper ? keeper : boss;
        if (this.stuckAnnounced < 3) {
          this.stuckAnnounced = 3;
          this.hud.addCombatMessage(`\ud83c\udfaf ${leader.name} has had enough of corridors. The party goes straight for ${quarry.template.name.replace(/^\ud83d\udc80 /, '')}.`, '#e8b45a');
        }
        // Route to the quarry, or to a walkable tile beside it when it stands on something the party cannot.
        const goals = this.map.isWalkable(quarry.tile.x, quarry.tile.y)
          ? [quarry.tile]
          : [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: quarry.tile.x + dx, y: quarry.tile.y + dy })).filter(t => this.map.isWalkable(t.x, t.y));
        let route: Vector2[] = [];
        for (const goal of goals) {
          route = astarPath(this.map, leader.tile, goal, { maxNodes: 8000 });
          if (route.length > 0) break;
        }
        const next = route[0];
        if (!next) {
          // No way to it at all: then it comes to them. A quest boss walled off
          // by the generator must never be a quest the party cannot finish.
          const here = this.walkableNearParty();
          if (!here) return false;
          quarry.tile = { ...here };
          this.hud.addCombatMessage(`\ud83d\udca8 The walls between them do not hold ${quarry.template.name.replace(/^\ud83d\udc80 /, '')} back. It finds the party instead.`, '#e0705f');
          this.noteProgress();
          return true;
        }
        const dx = Math.sign(next.x - leader.tile.x);
        const dy = Math.sign(next.y - leader.tile.y);
        const dir = dx === 1 ? Direction.Right : dx === -1 ? Direction.Left : dy === 1 ? Direction.Down : Direction.Up;
        return this.moveParty(dir);
      }
      case 'descend': {
        this.hud.addCombatMessage(`${leader.name} gives up on this floor. The party takes the stairs down.`, '#cc8');
        this.descending = true;
        this.noteProgress();
        setTimeout(() => this.generateNewDungeon(), 500);
        return true;
      }
      case 'leave': {
        this.hud.addCombatMessage(`There is nothing more for the party here. They climb back toward the surface.`, '#cc8');
        this.noteProgress();
        this.exitDungeonToOverworld();
        return true;
      }
    }
    return false;
  }

  /** Rebuild the party from scratch (a brand-new run), from the chosen classes where given. */
  private rebuildPartyFromScratch(classIds: string[] = []): void {
    const members = createParty(4, classIds);
    this.party.members.length = 0;
    this.party.formation = [];
    this.party.leaderIndex = 0;
    for (let i = 0; i < members.length; i++) {
      // Leader anchors at (0,0); followers stagger behind in two rows.
      this.party.addMember(members[i], {
        x: i % 2 === 0 ? 0 : 1,
        y: -Math.floor(i / 2),
      } as Vector2);
    }
    this.party.generateDefaultName();
  }

  /**
   * A lost fight or a fallen leader. Survivors gain a level of exhaustion
   * (a retreat, not a free resurrection); exhaustion level 6 is fatal and
   * stays fatal. If everyone is dead — or the leader fell beyond saving — a
   * new party takes up the quest with a clean slate.
   */
  private partyRetreat(): void {
    if (this.hardcore) {
      this.hardcoreRetreat();
      return;
    }
    let deadCount = 0;
    for (const member of this.party.members) {
      if (!member.isDead) {
        this.hud.addCombatMessage(member.gainExhaustion(), '#c66');
      }
      if (member.isDead) deadCount++;
    }
    if (deadCount === this.party.members.length || !this.party.leader.isAlive) {
      this.hud.addCombatMessage('A new party arrives to continue the quest...', '#888');
      for (const member of this.party.members) {
        member.exhaustion = 0;
        member.revive(member.maxHp);
      }
      return;
    }
    // Survivors drag everyone else out at half strength.
    for (const member of this.party.members) {
      if (member.isDead) continue;
      member.revive(Math.ceil(member.maxHp * 0.5));
    }
  }

  /**
   * The mode's standing orders. Fights open on the command menu in Manual
   * and resolve on their own in Auto; the toggle in the battle window still
   * changes it for the run. Called when the loop starts, so a restored run
   * comes back the way it was played.
   */
  private applyRunMode(): void {
    this.combatEngine.dcShift = this.difficulty === 'story' ? -2 : this.difficulty === 'hard' ? 2 : 0;
    this.hud.battleView.setMode(this.runMode === 'manual' ? 'manual' : 'auto');
    // A restored fight must not sit waiting on a decision Auto will never ask for.
    if (this.phase === GamePhase.Combat) this.combatEngine.setDecisionPause(this.runMode === 'manual');
    this.hud.setRunFlags(this.runMode, this.hardcore);
  }

  /** In Manual, the party holds where it stands and waits for the player. */
  private manualHold(where: string): void {
    if (this.runMode !== 'manual' || this.paused || this.phase === GamePhase.Combat) return;
    this.paused = true;
    this.hud.setPausedIndicator(true);
    this.hud.addCombatMessage(`\u23f8 The party holds at ${where} and looks to you. Press Play (or P) when they should go on.`, '#e8b45a');
  }

  /**
   * A lost fight in hardcore. The survivors stagger out as they always did;
   * the dead stay dead and leave the party, and a party with no one left is
   * a run that is over.
   */
  private hardcoreRetreat(): void {
    for (const member of this.party.members) {
      if (!member.isDead) this.hud.addCombatMessage(member.gainExhaustion(), '#c66');
    }
    this.dismissSummons();
    const fallen = this.party.members.filter(m => m.isDead);
    for (const m of fallen) {
      this.hud.addCombatMessage(`\u2620 ${m.name} will not rise again. ${m.charClass.name}, level ${m.level}; ${this.history.kills} foes fell before them.`, '#e0705f');
      this.expeditionJournal.push(`${m.name} died and was not brought back`);
      const where = this.mode === GameMode.Dungeon ? `on floor ${this.dungeonLevel} of ${this.entranceBaseName || this.dungeonName}` : this.mode === GameMode.Town ? `in ${this.currentTown?.name ?? 'a town'}` : 'on the open road';
      this.fallen.push({ name: m.name, className: m.charClass.name, level: m.level, where, day: Math.floor(this.clock.elapsed / DAY_MS) + 1 });
    }
    this.removeFallen();
    if (this.party.members.length === 0) {
      this.endRun();
      return;
    }
    for (const member of this.party.members) {
      if (member.hp <= 0) member.revive(Math.ceil(member.maxHp * 0.5));
    }
    this.party.generateDefaultName();
    this.hud.setParty(this.party);
  }

  /** Take the dead out of the party, keeping the formation and the leader straight. */
  private removeFallen(): void {
    for (let i = this.party.members.length - 1; i >= 0; i--) {
      if (!this.party.members[i].isDead) continue;
      this.party.members.splice(i, 1);
      this.party.formation.splice(i, 1);
      if (i < this.party.leaderIndex) this.party.leaderIndex--;
      else if (i === this.party.leaderIndex) this.party.leaderIndex = 0;
    }
    if (this.party.leaderIndex >= this.party.members.length) this.party.leaderIndex = 0;
  }

  /** The run is over: the slot is cleared and the title returns after the epitaph. */
  private endRun(): void {
    sfx.down();
    clearSlot(this.activeSlot);
    this.runStarted = false;
    this.running = false;
    this.music.play('title');
    this.ambience.stop();
    this.hud.closeOverlays();
    this.hud.showRunEnd(
      {
        partyName: this.party.partyName,
        kills: this.history.kills,
        victories: this.history.victories,
        deepest: this.history.deepestLevel,
        rooms: this.history.roomsVisited,
      },
      () => this.hud.showStartScreen(listSaves(), this.activeSlot),
    );
  }

  /** DM "roll <expr>" — parse and roll dice for the party, feeding the dice tray. */
  rollDiceForParty(expr: string): void {
    const m = expr.match(/^(\d*)d(\d+)([+-]\d+)?(?:\s+(adv|advantage|dis|disadvantage))?$/i);
    if (!m) {
      this.hud.addCombatMessage('Try "roll d20", "roll 2d6+3", or "roll d20 advantage".', '#888');
      return;
    }
    const count = Math.max(1, parseInt(m[1] || '1', 10));
    const sides = parseInt(m[2], 10);
    const mod = parseInt(m[3] || '0', 10);
    const mode = (m[4] || '').toLowerCase();
    const rolls: number[] = [];
    for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * sides) + 1);

    let kept = rolls[0];
    let total = rolls.reduce((s, n) => s + n, 0) + mod;
    if (count === 1 && (mode.startsWith('adv') || mode.startsWith('dis'))) {
      // d20 advantage/disadvantage: roll twice, keep best/worst.
      const second = Math.floor(Math.random() * sides) + 1;
      rolls.push(second);
      kept = mode.startsWith('adv') ? Math.max(rolls[0], second) : Math.min(rolls[0], second);
      total = kept + mod;
    }

    const leader = this.party.leader;
    let outcome: 'crit' | 'fumble' | 'neutral' = 'neutral';
    // A natural 20 or 1 on the kept die (incl. advantage/disadvantage) is drama.
    if (sides === 20 && kept === 20) outcome = 'crit';
    else if (sides === 20 && kept === 1) outcome = 'fumble';
    const diceType = parseDiceExpr(expr)?.type ?? 'd20';
    pushDiceRoll({
      kind: 'free',
      diceType,
      label: `${leader.name} rolls ${expr}`,
      expression: expr.toLowerCase(),
      rolls,
      total,
      outcome,
    });
    this.hud.addCombatMessage(`\ud83c\udfb2 ${leader.name} rolls ${expr} \u2192 ${total}${mode ? ` (${mode})` : ''}`, '#fd8');

    // A single d20 roll banks its result as a fated Luck die for the party.
    if (sides === 20 && count === 1) {
      grantLuckDie({ value: kept, source: expr.toLowerCase() });
      this.hud.addCombatMessage(
        `\u26a1 Fated! ${leader.name} banks a Luck die \u2014 ${kept} from "${expr}" \u2014 the party's next d20 roll will come out as ${kept}.`,
        '#fd8'
      );
    }
  }

  /**
   * Roll D&D loot tables for a won fight and hand the haul to the party:
   * coins are split among the living, items go to the leader's inventory.
   */
  private rollAndGrantLoot(slainMonsters: Monster[]): LootResult {
    if (slainMonsters.length === 0) {
      this.hud.addCombatMessage('There was nothing left to loot.', '#888');
      return { coins: EMPTY_PURSE, goldValue: 0, items: [], magicItems: [], narration: [], hoard: false };
    }

    const sources: LootSource[] = slainMonsters.map(m => ({
      cr: m.template.cr,
      name: m.template.name,
      type: m.template.type,
      // Floor bosses are renamed "(Boss)"; legendary monsters carry a kit.
      isBoss: /boss/i.test(m.template.name) || m.isBoss,
    }));
    const loot = rollCombatLoot(sources, this.dungeonLevel);
    for (const part of monsterParts(slainMonsters)) { loot.items.push(part); loot.narration.push(`\ud83e\uddb4 Taken from the body: ${part.name}.`); }

    // Tavern rumor buff: bonus gold find.
    const tavernGoldBonus = this.combatEngine.getTavernGoldFindBonus();
    if (tavernGoldBonus > 0) {
      loot.goldValue += tavernGoldBonus;
      this.hud.addCombatMessage(`Your tavern contacts tip you off to extra loot: +${tavernGoldBonus} gp!`, '#a89');
    }

    this.distributeLoot(loot, 'The corpses yield nothing but dust.');

    this.hud.setParty(this.party);
    return loot;
  }

  /**
   * Hand a rolled haul to the party: narrate it, split the coin among the
   * living, stow the items with the leader, then re-kit anyone whose find
   * beats what they are wearing. Shared by combat spoils and chests.
   */
  distributeLoot(loot: LootResult, emptyLine: string): void {
    if (loot.items.length > 0 || loot.goldValue > 0) sfx.chest();
    for (const line of loot.narration) {
      this.hud.addCombatMessage(line, '#dd0');
    }
    // A pinch of something rare, now and then, for the spells that want one.
    if (this.mode === GameMode.Dungeon && this.dungeonLevel >= 2 && Math.random() < 0.1) {
      const comp = COMPONENT_ITEMS[Math.floor(Math.random() * COMPONENT_ITEMS.length)];
      if (!this.party.members.some(m => m.hasItem(comp.id))) {
        this.party.leader.addToInventory({ ...comp });
        this.hud.addCombatMessage(`\u2697 In a twist of oilcloth: ${comp.name}. ${comp.description}`, '#c9a6ff');
      }
    }
    // Now and then a hoard holds a map of the floor below.
    if (this.mode === GameMode.Dungeon && Math.random() < 0.12 && !this.party.members.some(m => m.hasItem('dungeon_map'))) {
      this.party.leader.addToInventory({ id: 'dungeon_map', name: 'Dungeon Map', type: 'treasure', description: 'A hand-drawn map of the floor below, folded small. Whoever drew it did not come back for it.', value: 0 });
      this.hud.addCombatMessage('\ud83d\uddfa Folded into the take: a map of the floor below.', '#8cf');
    }
    for (const mi of loot.magicItems) {
      if (mi.rarity !== 'legendary' && mi.rarity !== 'very rare' && mi.rarity !== 'artifact') continue;
      this.tally('legendaries');
      this.expeditionJournal.push(`Found ${mi.name} (${mi.rarity})`);
      const wasPaused = this.paused;
      this.setPaused(true);
      this.hud.showStoryCard({ kicker: `${rarityTag(mi.rarity).replace(/:$/, '')} \u2014 found`, title: mi.name, body: `${mi.type}${mi.attunement ? ', requires attunement' : ''}.\n\n${mi.description}` }, () => { if (!wasPaused) this.setPaused(false); }, { seconds: 14 });
    }

    this.maybeHeirloom(loot);
    // Split the coin value among the living members.
    const living = this.party.alive;
    if (loot.goldValue > 0 && living.length > 0) {
      const each = Math.floor(loot.goldValue / living.length);
      const remainder = loot.goldValue - each * living.length;
      for (let i = 0; i < living.length; i++) {
        living[i].gold += each + (i === 0 ? remainder : 0);
      }
      this.hud.addCombatMessage(
        `💰 ${loot.goldValue} gp in coin split among the party (${each} gp each${remainder > 0 ? `, +${remainder} to ${living[0].name}` : ''}).`,
        '#fd8'
      );
    }

    // Items go to the leader's pack.
    const leader = this.party.leader;
    for (const item of loot.items) {
      leader.addToInventory(item);
      this.hud.addCombatMessage(`${leader.name} stows ${item.name}.`, item.type === 'treasure' ? '#ca8' : '#a9f');
    }
    // Coppers are worth less than a whole gold piece, so goldValue can round to
    // zero on a haul that still found something. Only call it empty when the
    // purse is genuinely bare.
    const anyCoin = Object.values(loot.coins).some(n => n > 0);
    if (loot.items.length === 0 && loot.goldValue === 0 && !anyCoin) {
      this.hud.addCombatMessage(emptyLine, '#888');
    }

    // After the haul lands, everyone re-kits: any looted gear that beats
    // what a member currently wears is swapped on and narrated.
    this.autoEquipUpgrades();
    this.recordTreasureFound(loot.items.length);
  }

  /**
   * Count found treasure once, wherever it came from.
   *
   * Combat spoils and chests come through distributeLoot, but the treasure
   * room and the vault hand items straight to the leader — so the two richest
   * finds in the game used to advance no collect task and no collect_item
   * quest, while the flavour text pointed the party at exactly them.
   */
  recordTreasureFound(count: number): void {
    if (count <= 0) return;
    this.treasuresFound += count;
    this.bulletinCollectProgress(count);
  }

  /**
   * Hand out XP through `addXp`, announcing each level earned. A raw `xp +=`
   * skips the level-up entirely — the bug the bulletin board's rewards once
   * had — so every grant outside combat goes through here.
   */
  grantXp(amountFor: (m: GameCharacter) => number): void {
    for (const m of this.party.members) {
      const amount = amountFor(m);
      if (amount <= 0) continue;
      if (m.addXp(amount)) {
        this.hud.addCombatMessage(`⬆ ${m.name} reaches level ${m.level}!`, '#7c7');
        sfx.levelUp();
      }
    }
  }

  /**
   * A flat bonus to the party's attack rolls for the next `fights` battles
   * (the war room's tactical study). Lives on the combat engine and is not
   * saved: a one-battle edge is not worth a save-schema bump.
   */
  grantBattleEdge(attackBonus: number, fights: number): void {
    this.combatEngine.warRoomAttackBonus = Math.max(this.combatEngine.warRoomAttackBonus, attackBonus);
    this.combatEngine.warRoomFightsLeft = Math.max(this.combatEngine.warRoomFightsLeft, fights);
  }

  /**
   * Post-combat auto-equip pass. Scans every living member's pack for gear
   * that beats their currently equipped piece and swaps it on, with a
   * narration line per upgrade. Parties loot as a group, so any member may
   * claim any pack item — whoever benefits most gets it.
   */
  private autoEquipUpgrades(): void {
    for (const member of this.party.alive) {
      for (const slot of ['weapon', 'armor', 'shield', 'trinket'] as EquipSlot[]) {
        // Consider every pack item that would fill this slot (weapons and
        // armor-type items; shields/trinkets route by name).
        const candidates = member.inventory
          .map(item => ({ item, slot: slotForItem(item) }))
          .filter(c => c.slot === slot);
        if (candidates.length === 0) continue;

        const current = member.equipment[slot] ?? null;
        const currentScore = current ? this.gearScore(current, member, slot) : -Infinity;
        // Try candidates best-first; the first that actually equips (some are
        // refused by class proficiencies) wins the slot.
        const ranked = candidates
          .map(c => ({ ...c, score: this.gearScore(c.item, member, slot) }))
          .filter(c => c.score > currentScore)
          .sort((a, b) => b.score - a.score);
        let equipped: { item: InventoryItem; line: string } | null = null;
        for (const c of ranked) {
          // The party's practiced eye catches curse-telltales before anyone
          // straps a haunted piece on — cursed gear is never auto-equipped.
          if (isCursed(c.item)) continue;
          const result = member.equip(c.item.id);
          if (result.ok) { equipped = { item: c.item, line: result.line }; break; }
        }
        if (!equipped) continue;

        const flavor = this.upgradeFlavor(slot, current, equipped.item, member);
        this.hud.addCombatMessage(`⚔ ${equipped.line} ${flavor}`, '#fd8');
      }
    }
  }

  /**
   * How good is this piece of gear for this member in this slot? Higher is
   * better. Weapons: damage die + magic bonus + finesse synergy. Armor/shield/
   * trinket: effective AC contribution. Unidentified items score as junk —
   * nobody equips a mystery on faith.
   */
  private gearScore(item: InventoryItem, member: GameCharacter, slot: EquipSlot): number {
    if (item.identified === false) return -100;
    if (slot === 'weapon') {
      const die = item.power && item.power >= 4 && item.power <= 12 ? item.power : 4;
      // Finesse or ranged weapons favor DEX; heavy arms favor STR.
      const useDex = /bow|dagger|rapier|scimitar|shortsword|dart|sling/i.test(item.name);
      const attackStat = useDex ? member.dexMod : member.strMod;
      // Proficiency swings the score hard both ways: a trained blade lands
      // far more often, while an untrained one forfeits the prof bonus.
      const profSwing = member.isProficientWithWeapon(item) ? member.profBonus * 3 : -member.profBonus * 3;
      return die + attackStat + magicBonusOf(item) * 3 + profSwing;
    }
    if (slot === 'armor') return item.power ?? 11;
    if (slot === 'shield') return item.power ?? 2;
    return magicBonusOf(item) || 1;
  }

  /** One-line flavor describing why the swap was worth it. */
  private upgradeFlavor(slot: EquipSlot, oldItem: InventoryItem | null | undefined, newItem: InventoryItem, member: GameCharacter): string {
    const name = (i: InventoryItem) => i.name;
    switch (slot) {
      case 'weapon': {
        const oldDie = oldItem?.power && oldItem.power >= 4 && oldItem.power <= 12 ? oldItem.power : 4;
        const newDie = newItem.power && newItem.power >= 4 && newItem.power <= 12 ? newItem.power : 4;
        const dmgNote = newDie > oldDie ? ` (d${oldDie} → d${newDie} damage die)` : '';
        return oldItem
          ? `${member.name} trades ${name(oldItem)} for ${name(newItem)}${dmgNote}.`
          : `${member.name} arms themselves with ${name(newItem)}.`;
      }
      case 'armor': {
        const oldAc = oldItem?.power ?? 10;
        const newAc = newItem.power ?? 10;
        return oldItem
          ? `${member.name} swaps ${name(oldItem)} for ${name(newItem)} — AC ${member.ac}${newAc > oldAc ? ` (was ${Math.max(10 + member.dexMod, oldAc)})` : ''}.`
          : `${member.name} dons ${name(newItem)} — AC ${member.ac}.`;
      }
      case 'shield':
        return oldItem
          ? `${member.name} trades ${name(oldItem)} for ${name(newItem)}.`
          : `${member.name} raises ${name(newItem)} — AC ${member.ac}.`;
      case 'trinket':
        return `${member.name} fastens ${name(newItem)} — AC ${member.ac}.`;
    }
  }

  /**
   * DM order: drink a looted potion or read a looted scroll. Works mid-combat
   * — the acting member spends their next turn on it.
   */
  handleLootedItemUse(raw: string): void {
    let query = raw.trim();
    let targetName: string | null = null;
    const onMatch = query.match(/\s+on\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)$/);
    if (onMatch) {
      targetName = onMatch[1].trim();
      query = query.slice(0, onMatch.index).trim();
    }
    const namedTarget = targetName
      ? this.party.members.find(m => m.name.toLowerCase().includes(targetName.toLowerCase())) ?? null
      : null;
    if (targetName && !namedTarget) {
      this.hud.addCombatMessage(`No party member answers to \"${targetName}\".`, '#c66');
      return;
    }

    const q = query.toLowerCase();

    // Bare "potion" → the strongest healing potion anyone carries, drunk by
    // the most injured member (or a named target).
    const healRank: Record<string, number> = { potion_healing: 1, potion_greater_healing: 2, potion_superior_healing: 3 };
    if (q === 'potion' || q === 'a potion' || q === 'healing potion' || q === 'health potion' || q === 'potion of healing') {
      let best: { holder: GameCharacter; item: InventoryItem } | null = null;
      for (const m of this.party.members) {
        for (const i of m.inventory) {
          const rank = healRank[i.id];
          if (rank && (!best || rank > (healRank[best.item.id] ?? 0))) best = { holder: m, item: i };
        }
      }
      if (!best) {
        this.hud.addCombatMessage('The party carries no healing potions.', '#888');
        return;
      }
      const drinker = namedTarget ?? this.mostInjuredMember();
      if (!drinker) return;
      best.holder.useItem(best.item.id);
      this.applyLootedItem(best.item, drinker);
      return;
    }

    // Otherwise: find the item by name across every member's pack. The match
    // is word-based, so "scroll of fireball" finds "Spell Scroll (Fireball)".
    const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'for']);
    const qWords = q.split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
    const qCompact = q.replace(/[^a-z0-9]/g, '');
    const matchesItem = (i: InventoryItem): boolean => {
      const name = i.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      if (name.includes(q.replace(/[^a-z0-9]+/g, ' ').trim())) return true;
      if (qWords.length > 0 && qWords.every(w => name.includes(w))) return true;
      if (i.id.includes(qCompact)) return true;
      return false;
    };
    let holder: GameCharacter | null = null;
    let item: InventoryItem | null = null;
    outer: for (const m of this.party.members) {
      for (const i of m.inventory) {
        if (matchesItem(i)) {
          holder = m;
          item = i;
          break outer;
        }
      }
    }
    if (!item || !holder) {
      this.hud.addCombatMessage(`The party carries no \"${query}\". Try \"loot\" to see the pack.`, '#888');
      return;
    }
    holder.useItem(item.id);
    this.applyLootedItem(item, namedTarget ?? holder);
  }

  /** Resolve a looted potion or scroll's actual mechanical effect. */
  private applyLootedItem(item: InventoryItem, target: GameCharacter): void {
    // Shop wares describe themselves as "Restores N HP."; that is their whole effect.
    const restoresHp = (i: InventoryItem): number | null => {
      const m = /restores (\d+) hp/i.exec(i.description);
      return m ? Number(m[1]) : null;
    };
    const inCombat = this.phase === GamePhase.Combat && this.combatEngine.isActive;
    const say = (msg: string, color = '#9c6') => this.hud.addCombatMessage(msg, color);

    if (item.type === 'potion') {
      sfx.potion();
      if (item.id === 'potion_healing' || item.id === 'potion_greater_healing' || item.id === 'potion_superior_healing') {
        const { count, size, bonus } = parseHealDice(item.description);
        const heal = rollDice(count, size) + bonus;
        say(`${target.name} drinks ${item.name} (${count}d${size}+${bonus}).`);
        say(target.heal(heal), '#8d8');
      } else if (item.id === 'potion_invisibility') {
        target.applyCondition('invisible', 6, 'Invisible');
        say(`${target.name} drinks ${item.name} \u2014 fading from sight! Attacks against them have disadvantage.`);
      } else if (item.id === 'potion_speed') {
        this.combatEngine.addPotionBuff(target.id, { damageBonus: 0, extraAttacks: 1, turns: 3 });
        say(`${target.name} drinks ${item.name} \u2014 hasted! One extra attack each round for 3 rounds.`);
      } else if (item.id === 'potion_giant_strength') {
        this.combatEngine.addPotionBuff(target.id, { damageBonus: 2, extraAttacks: 0, turns: 3 });
        say(`${target.name} drinks ${item.name} \u2014 +2 damage on every strike for 3 rounds!`);
      } else if (item.id.startsWith('hearth_light')) {
        // Stored Hearth-light: spend the banked blessing — heal 2d4+2 and
        // gain 3 rounds of the party's Bless (+1d4 on attacks).
        const heal = rollDice(2, 4) + 2;
        say(`${target.name} uncups the stored Hearth-light \u2014 warmth spills out and the party's hearts are lifted (+${heal} HP).`);
        say(target.heal(heal), '#8d8');
        const hadBless = this.combatEngine.partyBlessRounds > 0;
        this.combatEngine.partyBlessRounds = Math.max(this.combatEngine.partyBlessRounds, 3);
        if (!hadBless) {
          this.combatEngine.blessSourceId = `${target.id}:hearthlight`;
          say(`✨ The stored light kindles into a Bless — +1d4 on attack rolls for 3 rounds!`, '#8cf');
        }
      } else if (restoresHp(item) !== null) {
        const heal = restoresHp(item)!;
        say(`${target.name} drinks ${item.name}.`);
        say(target.heal(heal), '#8d8');
      } else {
        say(`${target.name} drinks ${item.name}. ${item.description}`);
      }
    } else if (item.type === 'scroll') {
      sfx.scroll();
      const reader = target;
      if (item.id === 'scroll_fireball' || item.id === 'scroll_lightning_bolt') {
        const foes = this.combatEngine.monsters.filter(m => m.isAlive);
        if (foes.length === 0) {
          say(`${reader.name} reads ${item.name} \u2014 but no foes remain to blast. The scroll is tucked back away.`, '#c66');
          reader.addToInventory(item);
          return;
        }
        const isFire = item.id === 'scroll_fireball';
        say(`${reader.name} unrolls ${item.name} and speaks the word!`);
        for (const foe of foes) {
          const damage = rollDice(8, 6);
          const save = savingThrow(abilityModifier(foe.template.abilities.dex), 15, {
            label: `${foe.template.name} DEX save`,
          });
          const dealt = save.success ? Math.floor(damage / 2) : damage;
          say(`${foe.template.name} ${save.success ? 'dodges half' : 'is engulfed'} \u2014 ${dealt} ${isFire ? 'fire' : 'lightning'} damage (DEX ${save.total} vs DC 15).`, '#c84');
          say(foe.takeDamage(dealt));
        }
      } else if (item.id === 'scroll_cure_wounds') {
        const heal = rollDice(1, 8) + reader.spellcastingMod;
        say(`${reader.name} reads ${item.name} over ${target.name}.`);
        say(target.heal(Math.max(1, heal)), '#8d8');
      } else if (item.id === 'scroll_invisibility') {
        target.applyCondition('invisible', 6, 'Invisible');
        say(`${target.name} fades from sight as ${reader.name} reads ${item.name}!`);
      } else if (item.id === 'scroll_revivify') {
        const dead = this.party.members.find(m => m.isDead);
        if (!dead) {
          say('No one lies dead \u2014 the scroll is tucked back into the pack.', '#888');
          reader.addToInventory(item); // keep the scroll for when it's needed
          return;
        }
        dead.revive(1);
        say(`${reader.name} reads ${item.name} \u2014 a golden thread of life pulls ${dead.name} back from death at 1 HP!`, '#fd8');
      } else if (restoresHp(item) !== null) {
        const heal = restoresHp(item)!;
        say(`${reader.name} reads ${item.name} over ${target.name}.`);
        say(target.heal(heal), '#8d8');
      } else {
        say(`${reader.name} reads ${item.name}. ${item.description}`);
      }
    }

    // Mid-combat, the acting member already spent their action on the item.
    if (inCombat) target.pendingItemUse = true;
    this.hud.setParty(this.party);
  }

  /** The conscious member with the lowest HP ratio (most in need of a potion). */
  /** Find which party member carries an item by (fuzzy) name. */
  findItemOwner(nameQuery: string): GameCharacter | null {
    const q = nameQuery.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!q) return null;
    for (const m of this.party.members) {
      if (m.inventory.some(i => i.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(q))) return m;
    }
    return null;
  }

  /**
   * The party's own short rest, taken on the AI's initiative: one hit die of
   * healing per standing member, and the dead carried back to 1 HP so the
   * party never pushes deeper with a crippled team.
   */
  private takeShortRest(message: string): void {
    this.hud.addCombatMessage(message, '#8cf');
    for (const member of this.party.alive) {
      const heal = rollDice(1, member.charClass.hitDie) + member.conMod;
      this.hud.addCombatMessage(member.heal(heal), '#8cf');
    }
    for (const member of this.party.members) {
      if (member.isDead) {
        member.revive(1);
        this.hud.addCombatMessage(`${member.name} is tended to and brought back at 1 HP.`, '#f88');
      }
    }
  }

  /**
   * Bring a dying ally round on the spot with the plan `planDyingRescue`
   * found — a healing spell paid for from the healer's slots, or the weakest
   * healing potion someone is carrying. False when there is no such plan.
   */
  private rescueDying(): boolean {
    const plan = planDyingRescue(this.party);
    if (!plan) return false;
    if (plan.kind === 'spell') {
      const slot = plan.healer.spendSpellSlot(plan.spell.level);
      if (slot === null) return false;
      const [dicePart] = (plan.spell.healing ?? '1d4').split('+');
      const [count, size] = dicePart.split('d').map(Number);
      const healing = rollDice(count || 1, size || 4) + plan.healer.spellcastingMod;
      sfx.heal();
      this.hud.addCombatMessage(`${plan.healer.name} kneels and casts ${plan.spell.name} on ${plan.target.name}!`, '#8cf');
      this.hud.addCombatMessage(plan.target.heal(healing), '#8d8');
      return true;
    }
    const item = plan.holder.inventory.find(i => i.id === plan.itemId);
    if (!item) return false;
    plan.holder.useItem(item.id);
    this.hud.addCombatMessage(`${plan.holder.name} tips a ${item.name} between ${plan.target.name}'s lips.`, '#8cf');
    this.applyLootedItem(item, plan.target);
    return true;
  }

  private mostInjuredMember(): GameCharacter | null {
    const candidates = this.party.members.filter(m => !m.isDead);
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  }

  /** Wipe the active slot and start over: fresh party, fresh floor 1. */
  startFreshRun(classIds: string[] = [], options: { mode: 'auto' | 'manual'; hardcore: boolean; difficulty?: 'story' | 'normal' | 'hard' } = { mode: 'auto', hardcore: false }): void {
    clearSlot(this.activeSlot);
    this.runMode = options.mode;
    this.hardcore = options.hardcore;
    this.difficulty = options.difficulty ?? 'normal';
    this.base = null;
    this.roamer = null;
    setTimeout(() => this.spawnRoamer(), 800);
    if (readBank() > 0) setTimeout(() => this.hud.addCombatMessage(`\ud83c\udfe6 A counting-house somewhere holds ${readBank()} gold in the name of a party that did not come back. Any bank will pay it out.`, '#ffd700'), 600);
    this.sieges = {};
    this.dungeonLevel = 0;
    this.history = { kills: 0, victories: 0, defeats: 0, roomsVisited: 0, deepestLevel: 1, killLedger: {} };
    this.dungeonTheme = null;
    grantLuckDie(null);
    this.rebuildPartyFromScratch(classIds);
    this.syncKnownFoes();
    this.dmStance = 'auto';
    this.dmDirection = undefined;
    this.paused = false;
    this.clearErrorHalt();
    this.combatEngine.isActive = false;
    this.combatEngine.initiativeOrder = [];
    this.combatEngine.currentTurnIndex = 0;
    this.combatEngine.partyBlessRounds = 0;
    this.combatEngine.blessSourceId = '';
    this.generateOverworld();
    this.combatEngine.monsters = this.monsters;
    this.storyController.beginNewRun();
    this.personalQuests = [];
    this.ensurePersonalQuests();
    this.ensureFamiliars();
    this.hud.addCombatMessage('A fresh run begins — the old tale is erased.', '#ffd700');
  }

  /** The ↻ button: a new dungeon floor, or a whole new world above ground. */
  private handleNewWorldButton(): void {
    if (this.mode === GameMode.Dungeon) {
      this.generateNewDungeon();
    } else {
      this.generateOverworld();
      this.hud.addCombatMessage('A new world unfolds — the party is set down on the road outside a fresh town.', '#ffd700');
    }
  }

  // ── Overworld, towns, quests & commerce ─────────

  activeQuest(): Quest | undefined {
    return this.activeQuestId ? this.quests.find(q => q.id === this.activeQuestId) : undefined;
  }

  /**
   * When the active quest is to slay a creature kind, return its template and
   * how many more kills are still needed to complete it. Otherwise undefined.
   */
  private activeHuntTarget(): { template: MonsterTemplate; remaining: number } | undefined {
    const q = this.activeQuest();
    if (!q || q.completed || q.kind !== 'slay_kind' || !q.targetKind) return undefined;
    const template = getMonsterTemplate(q.targetKind);
    if (!template) return undefined;
    const slain = this.history.killLedger[q.targetKind] ?? 0;
    return { template, remaining: Math.max(0, q.targetCount - slain) };
  }

  /** Narrate the first hunt-target sighting on a floor, so it reads intentionally. */
  private narrateHuntEncounter(hunt: { template: MonsterTemplate }): void {
    this.hud.addCombatMessage(
      `👁 ${hunt.template.name} (${hunt.template.id}) tracks the party from the shadows — the quarry of the hunt is here.`,
      '#f0a24a'
    );
  }

  /** Map of townId → festival kind for towns currently celebrating. */
  private festivalsByTown(): Record<string, string> {
    const out: Record<string, string> = {};
    if (!this.townLife) return out;
    const now = Date.now();
    for (const tl of Object.values(this.townLife.byTown)) {
      if (tl.festival && now <= tl.festival.until) out[tl.townId] = tl.festival.kind;
    }
    return out;
  }

  private questState(): QuestState {
    return {
      dungeonLevel: this.dungeonLevel,
      killLedger: this.history.killLedger,
      bossSlainThisFloor: this.bossSlainThisFloor,
      // Only meaningful underground; on the surface there is no floor to clear.
      monstersAliveOnFloor: this.mode === GameMode.Dungeon
        ? this.monsters.filter(m => m.isAlive).length
        : undefined,
      treasuresFound: this.treasuresFound,
    };
  }

  private checkActiveQuestProgress(): void {
    // Board work is tallied here too: both are driven by the kill ledger and
    // the current floor, and both are re-checked at exactly these moments.
    this.bulletinSlayProgress();
    const q = this.activeQuest();
    if (!q) return;
    if (checkQuestProgress(q, this.questState())) {
      this.hud.addCombatMessage(`✦ Quest objective complete: ${q.title}!`, '#ffd700');
      this.hud.townPanel.refresh();
    }
  }

  /** Build the overworld and place the party on the road outside the spawn town. */
  generateOverworld(): void {
    this.overworld = generateOverworld();
    this.map = this.overworld.map;
    this.camera.setBounds(this.map.width, this.map.height);
    // Fresh world — the overworld breadcrumb trail resets.
    this.overworldRecentTiles = [];
    this.wanderers = spawnOverworldLife(this.overworld);
    this.worldRegions = this.overworld.regions ?? generateWorldRegions(this.map, this.overworld.towns, this.overworld.entrances);
    this.lastOverworldRegionId = null;
    this.townLife = initTownLife(this.overworld);
    this.townLifeTimer = 0;
    this.ambushCooldownUntil = 0;
    this.banditCamps = { camps: [], clues: [] };
    // POIs are generated as part of the overworld map — carry them into the
    // live game (restore does the same; fresh runs previously lost them).
    this.pois = [...this.overworld.pois];
    this.weather = rollWeather(0, null);
    this.clock = createClock();
    this.lastClockStage = this.clock.timeOfDay;
    this.expeditionJournal = [];
    this.quests = [];
    this.activeQuestId = null;
    this.dungeonEntranceId = null;
    this.entranceBaseName = '';
    this.bossSlainThisFloor = false;
    this.dungeonLevel = 0;
    this.dungeonTheme = null;
    this.monsters = [];
    this.traps = [];
    this.rooms = [];
    this.phase = GamePhase.Exploration;
    this.combatEngine.isActive = false;
    this.combatEngine.initiativeOrder = [];
    this.combatEngine.currentTurnIndex = 0;
    this.descending = false;

    const spawn = getTownById(this.overworld, this.overworld.spawnTownId) ?? this.overworld.towns[0];
    this.currentTown = spawn;
    this.mode = GameMode.Overworld;
    this.overworldDestination = { kind: 'town', id: spawn.id };
    this.overworldPath = [];
    this.biomeNarrated = new Set();
    this.townWaitTimer = 0;

    // Park the party a short walk from the town gate.
    const w = this.map.width;
    const h = this.map.height;
    let start = { x: spawn.tile.x, y: spawn.tile.y + 7 };
    if (!this.map.isWalkable(start.x, start.y)) {
      outer:
      for (let r = 6; r <= 16; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = spawn.tile.x + dx;
            const ny = spawn.tile.y + dy;
            if (nx < 3 || ny < 3 || nx >= w - 3 || ny >= h - 3) continue;
            if (this.map.isWalkable(nx, ny) && manhattan({ x: nx, y: ny }, spawn.tile) >= 6) {
              start = { x: nx, y: ny };
              break outer;
            }
          }
        }
      }
    }
    this.party.setPosition(start, (x, y) => this.map.isWalkable(x, y));
    this.camera.x = start.x * TILE_SIZE - 512;
    this.camera.y = start.y * TILE_SIZE - 384;
    this.camera.targetX = this.camera.x;
    this.camera.targetY = this.camera.y;

    this.hud.setDungeonTitle(`${this.party.partyName} — The Wilderlands`);
    this.hud.setDungeonLevel(0);
    this.hud.addCombatMessage(`Welcome to The Wilderlands — a vast realm of ${this.overworld.towns.length} towns and ${this.overworld.entrances.length} dark entrances.`, '#ffd700');
    this.hud.addCombatMessage(`The party stirs to life on the road outside ${spawn.name} — ${spawn.description}.`, '#ffd700');
    this.hud.addCombatMessage('They make for town to seek work: quests, supplies, and a warm inn await.', '#9a9');
    this.hud.addCombatMessage(this.describeParty(), '#ccc');
    this.hud.setParty(this.party);
  }

  /** One AI tick on the surface: march toward the destination, live world around you. */
  private overworldTick(): void {
    const leader = this.party.leader;
    if (!leader.isAlive || !this.overworld) return;

    // The world breathes.
    stepWanderers(this.wanderers, this.map);

    // Weather evolves.
    if (this.weather) {
      const next = tickWeather(this.weather);
      if (next) {
        this.weather = next;
        if (this.frameCount % 120 === 0) {
          this.hud.addCombatMessage(`${this.weather.icon} ${this.weather.description}`, '#88a');
        }
      } else {
        this.weather = rollWeather(this.dungeonLevel, null);
        this.hud.addCombatMessage(`The weather shifts: ${this.weather.description}`, '#88a');
      }
    }
    const spooked = scatterWildlife(this.wanderers, leader.tile, 4);
    if (spooked.length > 0 && Math.random() < 0.4) {
      this.hud.addCombatMessage(`${spooked[0].name} bolts into the undergrowth!`, '#888');
    }

    // Discover nearby POIs.
    const newPOIs = discoverNearbyPOIs(this.pois, leader.tile, 3);
    for (const poi of newPOIs) {
      this.hud.addCombatMessage(`${poiIcon(poi.kind)} Discovered: ${poi.name} — ${poi.description}`, '#ff9');
      this.expeditionJournal.push(`Discovered ${poi.name} (${poi.kind.replace(/_/g, ' ')})`);
      // Check if party is right on the POI tile
      if (leader.tile.x === poi.tile.x && leader.tile.y === poi.tile.y) {
        this.handlePOIEntry(poi);
      }
    }
    // Check if party steps onto an undiscovered or uncleared POI tile
    for (const poi of this.pois) {
      if (poi.cleared) continue;
      if (leader.tile.x === poi.tile.x && leader.tile.y === poi.tile.y) {
        if (!poi.discovered) {
          poi.discovered = true;
          this.hud.addCombatMessage(`${poiIcon(poi.kind)} The party stumbles upon: ${poi.name}!`, '#ff9');
          this.expeditionJournal.push(`Discovered ${poi.name} (${poi.kind.replace(/_/g, ' ')})`);
        }
        this.handlePOIEntry(poi);
      }
    }

    // A DM march order wins over the party's own plans.
    if (this.dmDirection) {
      const orderedDir = this.dmDirection;
      if (this.moveParty(orderedDir)) {
        if (this.frameCount % 30 === 0) {
          this.hud.addCombatMessage(`${leader.name} marches ${DM_DIR_NAMES[orderedDir]} as ordered.`, '#6a8');
        }
      } else {
        this.hud.addCombatMessage(`The way ${DM_DIR_NAMES[orderedDir]} is blocked — the march order is rescinded.`, '#c88');
        this.dmDirection = undefined;
      }
      this.camera.follow(leader.tile);
      return;
    }

    if (!this.overworldDestination) this.chooseOverworldDestination();

    // Arrivals: a town (when headed home) or the quest entrance.
    const hereTown = townAt(this.overworld, leader.tile.x, leader.tile.y);
    if (hereTown && this.overworldDestination?.kind === 'town') {
      this.arriveAtTown(hereTown);
      return;
    }
    const hereEntrance = entranceAt(this.overworld, leader.tile.x, leader.tile.y);
    if (hereEntrance && this.overworldDestination?.kind === 'entrance' && this.overworldDestination.id === hereEntrance.id) {
      this.enterDungeonFromEntrance(hereEntrance);
      return;
    }
    if (hereTown) {
      this.hud.addCombatMessage(`The party passes through ${hereTown.name} without stopping.`, '#9a9');
    }

    const dest = this.overworldDestination;
    let target: Vector2 | null = null;
    if (dest) {
      const t = dest.kind === 'town' ? getTownById(this.overworld, dest.id) : getEntranceById(this.overworld, dest.id);
      if (t) target = t.tile;
    }
    if (this.waypoint) {
      if (leader.tile.x === this.waypoint.x && leader.tile.y === this.waypoint.y) {
        this.waypoint = null;
        this.overworldPath = [];
        this.hud.addCombatMessage('\ud83d\udccd The party reaches the spot you marked and looks to you.', '#8cf');
      } else {
        target = this.waypoint;
      }
    }
    if (!target) {
      this.chooseOverworldDestination();
      return;
    }

    // Record this position for the breadcrumb trail + square-loop detection.
    this.trackTile(this.overworldRecentTiles, leader.tile);

    // March the path — two tiles per tick for a brisk overworld pace, fewer
    // when weather mires the route (sandstorm, deep snow, heavy rain).
    const paceSteps = Math.max(
      1,
      Math.round((this.mounted ? 3 : 2) / (this.weather?.moveCostMultiplier ?? 1)) - (this.isEncumbered() ? 1 : 0) + this.roadQuality(leader.tile)
    );
    let moved = 0;
    for (let step = 0; step < paceSteps; step++) {
      if (this.overworldPath.length === 0) {
        this.overworldPath = this.bfsOverworldPath(leader.tile, target);
      }
      if (this.overworldPath.length === 0) break;
      const next = this.overworldPath[0];
      const dx = Math.sign(next.x - leader.tile.x);
      const dy = Math.sign(next.y - leader.tile.y);
      const dir = dx === 1 ? Direction.Right : dx === -1 ? Direction.Left : dy === 1 ? Direction.Down : Direction.Up;
      if (this.moveParty(dir)) {
        this.overworldPath.shift();
        moved++;
      } else {
        this.overworldPath = [];
        break;
      }
    }

    if (moved === 0) {
      this.overworldStuckCount++;
      // Square-loop guard: if the party keeps revisiting the same tiles
      // instead of progressing, snap it past the trap — no endless loops.
      if (this.overworldStuckCount > 8 || this.isLoopingTiles(this.overworldRecentTiles, leader.tile)) {
        this.hud.addCombatMessage(`${leader.name} finds a shortcut through the wilds...`, '#8cf');
        this.overworldStuckCount = 0;
        this.overworldRecentTiles = [];
        // Force-arrive at the target destination.
        if (dest && dest.kind === 'town') {
          const t = getTownById(this.overworld, dest.id);
          if (t) { this.party.setPosition(t.tile); this.arriveAtTown(t); return; }
        } else if (dest) {
          const e = getEntranceById(this.overworld, dest.id);
          if (e) { this.party.setPosition(e.tile); this.enterDungeonFromEntrance(e); return; }
        }
      } else {
        // Fresh BFS from the CURRENT tile — the recomputed path routes around
        // whatever blocked the old one, which is the optimal route and can
        // never trace a square (no blind wandering in fixed order).
        this.overworldPath = this.bfsOverworldPath(leader.tile, target);
        if (this.overworldPath.length > 0) {
          const next = this.overworldPath[0];
          const dx = Math.sign(next.x - leader.tile.x);
          const dy = Math.sign(next.y - leader.tile.y);
          const dir = dx === 1 ? Direction.Right : dx === -1 ? Direction.Left : dy === 1 ? Direction.Down : Direction.Up;
          this.moveParty(dir);
        } else {
          // No route at all — hold ground rather than wander blindly.
          this.hud.addCombatMessage(`${leader.name} surveys the wilds for a way around...`, '#8a8');
        }
      }
    } else {
      this.overworldStuckCount = 0;
      if (this.travelNarrateCounter++ % 24 === 0 && Math.random() < 0.7) {
        this.hud.addCombatMessage(randomTravelEvent(), '#997');
      }
    }

    // Biome narration — first time crossing each kind of terrain.
    const t = this.map.getTile(leader.tile.x, leader.tile.y);
    if ((t === TileType.Forest || t === TileType.Mountain || t === TileType.Desert || t === TileType.Swamp || t === TileType.Snow || t === TileType.Sand) && !this.biomeNarrated.has(t)) {
      this.biomeNarrated.add(t);
      const lines = BIOME_EVENTS[t];
      if (lines) this.hud.addCombatMessage(lines[Math.floor(Math.random() * lines.length)], '#8aa');
    }

    // Nearby folk share a word as the party passes.
    const near = this.wanderers.find(w => w.message && !isWildlife(w.kind) && manhattan(w.tile, leader.tile) <= 2);
    if (near && Math.random() < 0.25) {
      this.hud.addCombatMessage(`${near.name}: ${near.message}`, '#9a9');
    }

    this.map.reveal(leader.tile.x, leader.tile.y, 7);
    this.hud.setParty(this.party);
    this.camera.follow(leader.tile);

    // The wilds are not always empty. Roads hide bandits; the wilds hide worse.
    if (Date.now() > this.ambushCooldownUntil) {
      const tile = this.map.getTile(leader.tile.x, leader.tile.y);
      const nearTown = this.overworld.towns.some(tn => manhattan(tn.tile, leader.tile) <= 12);
      // Weather stirs the wilds: a blood-red sky calls forth more, and bolder,
      // prey while an eerie mist draws the unliving up from the mire.
      // And when the sun is down, the creatures of shadow prowl hungrier.
      let chanceMul = 1;
      let extraImbued = 0;
      const isDark = this.clock.light < NIGHT_VISIBILITY_LIGHT;
      if (this.weather) {
        if (this.weather.type === 'blood_red_sky') { chanceMul = 2; extraImbued = 1; }
        else if (this.weather.type === 'eerie_mist') { chanceMul = 1.6; extraImbued = 1; }
        else if (this.weather.type === 'heavy_rain' || this.weather.type === 'sandstorm') chanceMul = 1.3;
        else if (this.weather.type === 'magical_aurora') chanceMul = 0.5;
      }
      if (isDark) chanceMul *= 1.5;
      // The calendar joins the chorus: on Gloom the thin veil lets the dead
      // stride the roads, and a full moon wakes the hunger in lycanthropes.
      if (this.calendar.isGloomDay) { chanceMul *= 1.25; extraImbued += 1; }
      if (this.calendar.moonLight > 0.8) chanceMul *= 1.3;
      if (this.calendar.isSacredDay) chanceMul *= 0.85;
      if (Math.random() < getAmbushChance(this.map, tile, leader.tile, nearTown) * chanceMul) {
        const ambush = rollAmbush(this.map, tile, leader.tile, leader.level);
        if (ambush) {
          this.triggerSurfaceAmbush(ambush);
          // Under an eerie mist or blood-red sky, the unliving hunger past reason.
          if (extraImbued > 0) this.triggerImbuedReinforcement(extraImbued);
        }
      }
    }
    // The moon is more than decoration: some nights menace, others bare old secrets.
    this.maybeMoonSurfaceEvent();
    this.maybeRoadEvent();
    this.maybeSiege();
    this.nameTheRiver(leader.tile);
    this.stepRoamer();
    this.restAtBase(leader.tile);
    this.merchantOnTheRoad();
  }

  /** A weather-blessed surge of undead/fiendish reinforcements on the surface ambush. */
  private triggerImbuedReinforcement(count: number): void {
    const leader = this.party.leader;
    const pool: string[] = [
      'zombie', 'skeleton', 'ghost', 'ghoul', 'specter', 'wraith', 'shade', 'wight',
      'imp', 'shadow_demon', 'vrock_monster', 'heliotrope_chillshade',
    ].map(id => (getMonsterTemplate(id)?.cr ?? 99) <= leader.level + 2 ? id : '').filter(Boolean);
    if (pool.length === 0) return;
    const spots = findAmbushTiles(this.map, leader.tile, count);
    if (spots.length === 0) return;
    const monsters: Monster[] = [];
    for (let i = 0; i < count && i < spots.length; i++) {
      const template = getMonsterTemplate(pool[Math.floor(Math.random() * pool.length)]!);
      if (!template) continue;
      const m = this.spawnMonster(template, spots[i]);
      monsters.push(m);
    }
    if (monsters.length === 0) return;
    this.monsters.push(...monsters);
    if (this.combatEngine.isActive) {
      this.combatEngine.monsters.push(...monsters);
    }
    this.hud.addCombatMessage(`😈 The ${this.weather?.type === 'eerie_mist' ? 'mist' : 'red sky'} spawns reinforcements — ${monsters.map(m => m.template.name).join(', ')} rise from the earth!`, '#a6f');
  }

  /**
   * A voiced journal line for a mood event — the party leader reacts aloud,
   * so the chronicle reads as a story with voices instead of a dry log.
   * Keeps the party's personalities (and the class voices from the lore
   * generator) visible in the expedition record.
   */
  private journalLeaderReaction(kind: 'moon_pack' | 'gloom_shadow' | 'hearth_boon'): string {
    const leader = this.party.leader;
    const cls = leader.charClass.id;
    const name = leader.name;
    const pools: Record<string, Record<string, string[]>> = {
      moon_pack: {
        fighter: ['"Contact under the moon — form up, they mean to take us."', '"They came down with the light. Fine — we meet them steel-first."'],
        wizard: ['"The moon we walked under has followed us down. Of course it has."', '"Moon-roused beasts — I\'ve read of this. Form a line, I\'ll burn them."'],
        rogue: ['"I don\'t like how the moonlight pools down here. And now they howl."', '"Pack hunters under a full moon. We should not be here."'],
        cleric: ['"The moon rises even underground. Whatever it rouses, we will put down."', '"Stay in my light — the dark hunts in packs tonight."'],
      },
      gloom_shadow: {
        fighter: ['"Something in that dark moved wrong. Swords out."', '"That shadow stood up on its own. This place is worse than we thought."'],
        wizard: ['"The gloom down here has weight — and it\'s not empty. Prepare."', '"Shadows that walk are older magic than any of mine. Mind the flanks."'],
        rogue: ['"I\'ve been in dark places. That one\'s alive. That\'s different."', '"Whatever that is, it saw us first. I hate when they see us first."'],
        cleric: ['"Unholy shadow. My light will hold it back — strike while it flinches."', '"The dark here is not natural. Something feeds it. Ready your faith."'],
      },
      hearth_boon: {
        fighter: ['"That warmth in the stone… I\'ll take the favor. Wounds are closing."', '"Something blessed this hall. We take it and we move."'],
        wizard: ['"Arcane warmth — a hearth-glow with no hearth. Curious. And welcome."', '"The aurora down here? It\'s lending us strength. Note it in the chronicle."'],
        rogue: ['"A warm patch in a dungeon this cold? I\'ll take it, but I\'m watching it."', '"Whatever that light was, it felt like luck. Spend it well."'],
        cleric: ['"The gods keep their hearth even under the earth. Kneel, and be healed."', '"A blessing follows us down. Take it — and give thanks quietly."'],
      },
    };
    const byClass = pools[kind][cls];
    const line = byClass && byClass.length > 0
      ? byClass[Math.floor(Math.random() * byClass.length)]
      : pools[kind][Object.keys(pools[kind])[0]][0];
    return `${name}: ${line}`;
  }

  /** Scripted dungeon-mood events: the sky you descended under can close in mid-delve. */
  private maybeDungeonMoodEvent(): void {
    if (this.mode !== GameMode.Dungeon) return;
    if (this.phase !== GamePhase.Exploration) return;
    if (Date.now() < this.dungeonMoodCdUntil) return;
    this.dungeonMoodTicks++;
    if (this.dungeonMoodTicks < 150) return; // roughly every ~150 exploration ticks
    this.dungeonMoodTicks = 0;
    this.dungeonMoodCdUntil = Date.now() + 60000;

    const leader = this.party.leader;
    const c = this.calendar;
    const w = this.weather;
    const isFullMoon = c.moonLight > 0.86;
    const gloomy = c.isGloomDay || this.clock.light < NIGHT_VISIBILITY_LIGHT
      || (w && (w.type === 'eerie_mist' || w.type === 'blood_red_sky' || w.type === 'heavy_rain'));
    const blessed = c.isSacredDay || (w && w.type === 'magical_aurora');

    // A boon instead of a menace: Hearth or the aurora brightens a floor. It
    // mends the party now, and banks a stored Hearth-light to spend later.
    if (blessed && Math.random() < 0.5) {
      const heal = Math.floor(leader.maxHp * 0.15);
      for (const m of this.party.alive) m.hp = Math.min(m.maxHp, m.hp + heal);
      const hearthLight: InventoryItem = {
        id: `hearth_light_${Date.now()}`,
        name: 'Stored Hearth-light',
        type: 'potion' as const,
        value: 25,
        description: 'A coin of captured warmth from a blessed corridor. Spend it when the dark closes in — it heals, and lends the party heart.',
        effect: 'Heal 2d4+2 and gain 3 rounds of blessing (+1d4 attacks).',
        power: 2,
      };
      this.party.leader.inventory.push({ ...hearthLight });
      this.hud.addCombatMessage(w && w.type === 'magical_aurora'
        ? `✨ Auroral light seeps down through the stone, and the party's wounds knit as it passes (+${heal} HP each). A sliver of that light is banked for later — Stored Hearth-light gained.`
        : `✨ A breath of Hearth's blessing moves through the dark corridor (+${heal} HP each), and one coin of its warmth is banked for later — Stored Hearth-light gained.`, '#8cf');
      this.expeditionJournal.push(`A ${w && w.type === 'magical_aurora' ? 'auroral' : 'Hearth'} blessing mended the party and banked a Stored Hearth-light in ${this.dungeonName}`);
      this.expeditionJournal.push(this.journalLeaderReaction('hearth_boon'));
      return;
    }

    // Full moon: a pack corners the party in this room.
    if (isFullMoon && Math.random() < 0.75) {
      const pool = ['dire_wolf', 'wererat', 'weretiger', 'werewolf'];
      const count = 2 + Math.floor(Math.random() * Math.max(1, Math.min(3, Math.floor(leader.level / 2))));
      const spots = findAmbushTiles(this.map, leader.tile, count);
      const pack: Monster[] = [];
      for (let i = 0; i < count && i < spots.length; i++) {
        const t = getMonsterTemplate(pool[Math.floor(Math.random() * pool.length)]);
        if (!t) continue;
        if (t.cr > leader.level + 2) continue;
        const m = this.spawnMonster(t, spots[i]);
        m.alertLevel = 2;
        m.moonPack = true; // fallen pack always leave their moon-touched trophies
        pack.push(m);
      }
      if (pack.length === 0) return;
      this.monsters.push(...pack);
      this.hud.addCombatMessage(`🐺 The full moon you carried down reaches this room — a pack skulks out of the dark, long done waiting.`, '#c86');
      this.startCombat(pack);
      this.expeditionJournal.push(`Cornered by a ${pack.map(m => m.template.name).join(', ')} pack deep in ${this.dungeonName}`);
      this.expeditionJournal.push(this.journalLeaderReaction('moon_pack'));
      return;
    }

    // Gloom / foul-weather mood: shadows cohere into something that should not be.
    if (gloomy && Math.random() < 0.75) {
      const pool = ['shadow', 'wight', 'ghast', 'wraith', 'specter', 'ghoul'];
      const spots = findAmbushTiles(this.map, leader.tile, 2);
      if (spots.length === 0) return;
      const t = getMonsterTemplate(pool[Math.floor(Math.random() * pool.length)]);
      if (!t || t.cr > leader.level + 2) return;
      const m = this.spawnMonster(t, spots[0]);
      m.dropsRuneHalf = true; // the gloom-corrupted creature carries a torn rune tablet
      this.monsters.push(m);
      this.hud.addCombatMessage(`⬛ In this gloom the party's torchlight pools strangely — and the shadow at the end of the corridor stands up.`, '#c66');
      this.startCombat([m]);
      this.expeditionJournal.push(`Surprised by a ${m.template.name} in the murk of ${this.dungeonName}`);
      this.expeditionJournal.push(this.journalLeaderReaction('gloom_shadow'));
      return;
    }
  }

  /**
   * The moon's phase can move the surface world itself: on the full moon a
   * howling pack hunts the roads, and on the new moon the dark unseals a
   * forgotten vault of moon-silver. Both are rare, cooldown-gated events.
   */
  private maybeMoonSurfaceEvent(): void {
    if (this.mode !== GameMode.Overworld || !this.overworld) return;
    if (Date.now() < this.moonEventCooldownUntil) return;
    const nearTown = this.overworld.towns.some(tn => manhattan(tn.tile, this.party.leader.tile) <= 12);
    if (nearTown) return;

    const c = this.calendar;
    const leader = this.party.leader;

    // Full moon: a hunting pack bounds out of the moonshadow.
    if (c.moonLight > 0.86 && Math.random() < 0.05) {
      this.moonEventCooldownUntil = Date.now() + 45000;
      const pack: Monster[] = [];
      const pool = ['dire_wolf', 'dire_wolf', 'mastiff', 'werewolf', 'wererat'];
      const count = 2 + Math.floor(Math.random() * Math.min(3, 1 + Math.floor(leader.level / 2)));
      const spots = findAmbushTiles(this.map, leader.tile, count);
      if (spots.length === 0) return;
      for (let i = 0; i < count && i < spots.length; i++) {
        const t = getMonsterTemplate(pool[Math.floor(Math.random() * pool.length)]);
        if (!t) continue;
        if (t.cr > leader.level + 2) continue;
        const m = this.spawnMonster(t, spots[i]);
        m.alertLevel = 2;
        m.moonPack = true; // fallen pack leave moon-touched trophies
        pack.push(m);
      }
      if (pack.length === 0) return;
      this.monsters.push(...pack);
      const lyrical = [
        'A silver howl splits the night — the full moon has called its hunters. A pack pours out of the moonshadow!',
        'Eyes catch the moonlight in a ring around the party. On this night of nights, the wilds bring the hunt to them.',
        'Bones of lesser things carpet the glade — then the howling starts, closing in like the tide.',
      ];
      this.hud.addCombatMessage(`🐺 ${lyrical[Math.floor(Math.random() * lyrical.length)]}`, '#c86');
      this.expeditionJournal.push(`Ambushed by a moon-hunting pack of ${[...new Set(pack.map(m => m.template.name))].join(', ')} under the full moon`);
      this.startCombat(pack);
      this.hud.addCombatMessage(generatePartyCommentary(
        leader.name, leader.charClass.id, leader.personality, 'seeing_monster'
      ), '#ca8');
      return;
    }

    // New moon: the dark bares a forgotten vault.
    if (c.moonLight < 0.14 && Math.random() < 0.035) {
      this.moonEventCooldownUntil = Date.now() + 90000;
      const gold = 40 + Math.floor(Math.random() * 80) * (1 + Math.floor(leader.level / 3));
      this.addGold(gold);
      const moonsilver: InventoryItem = {
        id: `moonsilver_${Date.now()}`,
        name: 'Moon-Silver Crescent',
        type: 'treasure' as const,
        value: 90 + Math.floor(Math.random() * 40),
        description: 'A crescent of pale lunar silver. Priests and smiths pay well for the metal; smiths may forge it into a single blessed weapon.',
      };
      this.party.leader.inventory.push({ ...moonsilver });
      this.expeditionJournal.push(`Found a moon-silver vault under the new moon (${gold}gp + ${moonsilver.name})`);
      const reveal = [
        'With no moon, the earth itself opens — a slab tilts aside to reveal a dry hollow lined with raw moon-silver.',
        'Starlight pools on a bare patch of earth. Prising it up, the party finds a buried strongbox silvered to a dull gleam.',
        'A stone lies plainly on the trail, and beneath it a cache the new moon has guarded from silver-eyed creatures.',
      ];
      this.hud.addCombatMessage(`🌑 ${reveal[Math.floor(Math.random() * reveal.length)]}`, '#8cf');
      this.hud.addCombatMessage(`Found ${gold} gp and a ${moonsilver.name}.`, '#ffd700');
      return;
    }
  }

  /** Tier-3 smith: reveal the hidden moon-forge POI on the map. */
  private revealMoonForge(): void {
    if (!this.overworld || !this.map) return;
    if (this.pois.some(p => p.kind === 'moon_forge')) return;
    const forge = createMoonForgePOI(this.map, this.overworld.towns);
    if (!forge) return;
    this.pois.push(forge);
    this.expeditionJournal.push(`The moon-forge of Corund was revealed to the party`);
    this.hud.addCombatMessage(`🌙 As the final temper rings off the anvil, the smith goes quiet. "There is a forge older than mine," he says, "where the moon pools like water. It will finish what we've begun — seek ${forge.name} in the wilds."`, '#ffd700');
    this.hud.addCombatMessage(`🌙 Map marker revealed: ${forge.name}`, '#8cf');
  }

  /** Surface weather readout: an icon, label, and the live mechanical effects. */
  private refreshWeatherChip(now: number): void {
    if (!this.weather || this.mode !== GameMode.Overworld && this.mode !== GameMode.Town) {
      this.hud.setWeatherChip(null);
      return;
    }
    const w = this.weather;
    const effects: string[] = [];
    if (w.rangedModifier !== 0) effects.push(`${w.rangedModifier > 0 ? '+' : ''}${w.rangedModifier} attack rolls`);
    if (w.moveCostMultiplier > 1) effects.push(`travel slowed x${w.moveCostMultiplier}`);
    if (w.visibility < 1) effects.push(`low visibility`);
    if (w.type === 'magical_aurora') effects.push('casting empowered');
    if (w.type === 'blood_red_sky') effects.push('monsters restless');
    const tod = this.clock.timeOfDay;
    const todIcon = tod === 'dawn' ? '🌅' : tod === 'day' ? '☀️' : tod === 'dusk' ? '🌇' : '🌙';
    if (this.clock.light < NIGHT_VISIBILITY_LIGHT) effects.push('darkness −1 attack');
    this.hud.setWeatherChip({ icon: `${todIcon} ${w.icon}`, label: `${this.calendar.weekday} · ${tod} / ${w.type.replace(/_/g, ' ')}`, effects });
    void now;
  }

  /** A short human line describing today's calendar significance. */
  calendarDesc(): string {
    const c = this.calendar;
    const moonLabel = c.moonPhase.replace(/_/g, ' ');
    const tags: string[] = [];
    if (c.isMarketday) tags.push('market day');
    if (c.isSacredDay) tags.push('temple day');
    if (c.isGloomDay) tags.push('the veil thins');
    const suffix = tags.length ? ` · ${tags.join(', ')}` : '';
    return `${c.weekday}${suffix}. (${moonLabel} moon)`;
  }

  /** The nearest town to a position — where a defeated party limps home. */
  private nearestTown(pos: Vector2): OverworldTown | null {
    if (!this.overworld) return null;
    let best: OverworldTown | null = null;
    let bestD = Infinity;
    for (const town of this.overworld.towns) {
      const d = manhattan(town.tile, pos);
      if (d < bestD) {
        bestD = d;
        best = town;
      }
    }
    return best;
  }

  /** Bandits or beasts spring on the party out on the surface. */
  private triggerSurfaceAmbush(ambush: Ambush): void {
    const leader = this.party.leader;
    this.hud.addCombatMessage('⚔️ ' + ambush.narration, '#c84');
    const spots = findAmbushTiles(this.map, leader.tile, ambush.templates.length);
    if (spots.length === 0) {
      this.hud.addCombatMessage('The ambushers find no footing — the party slips past.', '#888');
      return;
    }
    const spawned: Monster[] = [];
    for (let i = 0; i < ambush.templates.length && i < spots.length; i++) {
      const m = this.spawnMonster(ambush.templates[i], spots[i]);
      m.alertLevel = 2;
      spawned.push(m);
    }
    if (spawned.length === 0) return;
    const names = [...new Set(spawned.map(m => m.template.name))].join(', ');
    this.hud.addCombatMessage(`The party is surrounded by ${names} on the open road.`, '#ca8');
    if (this.tryParley(spawned)) return;
    this.startCombat(spawned);
    this.hud.addCombatMessage(generatePartyCommentary(
      leader.name,
      leader.charClass.id,
      leader.personality,
      'seeing_monster'
    ), '#ca8');
  }

  /** When truly stuck, teleport the party to the nearest walkable tile closer to target. */
  private teleportCloserToTarget(target: Vector2): void {
    const leader = this.party.leader;
    const best = { tile: leader.tile, dist: manhattan(leader.tile, target) };
    const w = this.map.width;
    const h = this.map.height;
    for (let r = 1; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = leader.tile.x + dx;
          const ny = leader.tile.y + dy;
          if (nx < 2 || ny < 2 || nx >= w - 2 || ny >= h - 2) continue;
          if (!this.map.isWalkable(nx, ny)) continue;
          const d = manhattan({ x: nx, y: ny }, target);
          if (d < best.dist) {
            best.tile = { x: nx, y: ny };
            best.dist = d;
          }
        }
      }
      if (best.dist < r) break; // Found something closer
    }
    if (best.tile !== leader.tile) {
      this.party.setPosition(best.tile);
      this.overworldPath = [];
    }
  }

  /** BFS shortest path (leader-only) across the overworld tiles. */
  /**
   * The dungeon exploration brain. Chooses the nearest unexplored room as a
   * frontier target (stairwell first once everything is seen), walks an A*
   * route cached across ticks, and returns false only when the floor is
   * fully explored AND the stairs are unreachable — i.e. truly stuck.
   *
   * One step per call; the route persists so long corridors aren't re-solved
   * every tick.
   */
  private exploreStep(): boolean {
    const leader = this.party.leader;

    // Room-level frontier: nearest unvisited room by A* cost, prefer stairs.
    const goal = this.pickExplorationTarget();
    if (goal === null) return false;

    // Re-solve only when the cached route is stale (new goal, or the party
    // drifted off it — knocked back by combat, say).
    if (this.dungeonRouteGoal !== goal || this.dungeonRoute.length === 0) {
      const target = goal === -1
        ? this.findStairsTile()
        : { x: this.rooms[goal].cx, y: this.rooms[goal].cy };
      if (!target) return false;
      this.dungeonRoute = astarPath(this.map, leader.tile, target, { maxNodes: 8000 });
      this.dungeonRouteGoal = goal;
      if (this.dungeonRoute.length === 0) {
        this.dungeonRouteGoal = -1;
        return false;
      }
    }

    // Follow the cached route.
    const next = this.dungeonRoute[0];
    const dx = Math.sign(next.x - leader.tile.x);
    const dy = Math.sign(next.y - leader.tile.y);
    const dir = dx === 1 ? Direction.Right : dx === -1 ? Direction.Left : dy === 1 ? Direction.Down : Direction.Up;
    if (this.moveParty(dir)) {
      this.dungeonRoute.shift();
      return true;
    }
    // Blocked (door still shut, party scattered): re-solve next tick.
    this.dungeonRoute = [];
    this.dungeonRouteGoal = -1;
    return false;
  }

  /**
   * Frontier scoring: which room to head for? Unvisited rooms win; the
   * stairwell (-1 sentinel, routed to the stairs tile) wins once everything
   * is seen. Nearest by straight-line cost keeps exploration tight instead
   * of ping-ponging across the floor.
   */
  private pickExplorationTarget(): number | null {
    const leader = this.party.leader;
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < this.rooms.length; i++) {
      if (this.visitedRooms.has(i)) continue;
      const r = this.rooms[i];
      const cost = Math.abs(r.cx - leader.tile.x) + Math.abs(r.cy - leader.tile.y);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    if (best !== -1) return best;
    // All rooms visited: descend (or leave, if the quest is done — the
    // go_down_stairs handler already covers that case).
    return -1;
  }

  /** Nearest walkable-adjacent stairs tile, or null. */
  private findStairsTile(): Vector2 | null {
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (this.map.getTile(x, y) === TileType.StairsDown) return { x, y };
      }
    }
    return null;
  }

  /**
   * A* route from the party to a target, honoring terrain costs. Roads beat
   * mountains; the search itself can't trace loops. Falls back to [] only
   * when genuinely unreachable — partial paths cover huge maps.
   */
  private bfsOverworldPath(from: Vector2, to: Vector2): Vector2[] {
    return astarPath(this.map, from, to, { maxNodes: 30000 });
  }

  /** Where should the party march? Quest entrance, or home to town. */
  /** Handle the party entering a POI tile — trigger encounter, loot, or lore. */
  private handlePOIEntry(poi: OverworldPOI): void {
    if (poi.cleared) return;
    const leader = this.party.leader;

    switch (poi.kind) {
      case 'ancient_ruins': {
        this.hud.addCombatMessage(`${poi.name} echoes with forgotten power. Ancient magic crackles in the air...`, '#a8f');
        if (Math.random() < 0.6) {
          this.hud.addCombatMessage('The ruins are guarded! Ancient constructs and wraiths rise from the rubble!', '#c66');
          this.spawnPOICombat(poi, 3 + Math.floor(Math.random() * 3));
        } else {
          const gold = 30 + Math.floor(Math.random() * 70);
          this.addGold(gold);
          this.hud.addCombatMessage(`${leader.name} finds a hidden cache! The party gains ${gold} gold in ancient coins.`, '#dd0');
          const xp = 15 + this.party.members.length * 5;
          for (const m of this.party.members) { if (m.isAlive) m.addXp(xp); }
          this.expeditionJournal.push(`Explored ${poi.name}: found ${gold}gp in ancient treasure`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'abandoned_mine': {
        this.hud.addCombatMessage(`${poi.name} descends into shadow. The sound of pickaxes echoes — but no living miners remain...`, '#888');
        if (Math.random() < 0.5) {
          this.hud.addCombatMessage('Mineral veins! But something is nesting in the deep shaft...', '#c66');
          this.spawnPOICombat(poi, 2 + Math.floor(Math.random() * 3));
        } else {
          const gems = 20 + Math.floor(Math.random() * 50);
          this.addGold(gems);
          this.hud.addCombatMessage(`${leader.name} mines raw gems and ore worth ${gems} gold!`, '#dd0');
          const xp = 10 + this.party.members.length * 4;
          for (const m of this.party.members) { if (m.isAlive) m.addXp(xp); }
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'witch_hut': {
        this.hud.addCombatMessage(`A hag lurks within ${poi.name}. She offers a bargain...`, '#a8a');
        if (Math.random() < 0.4) {
          this.hud.addCombatMessage('The hag betrays the party! Illusion magic and summoned beasts fill the hut!', '#c66');
          this.spawnPOICombat(poi, 2 + Math.floor(Math.random() * 2));
        } else {
          const spellNames = ['Magic Missile', 'Cure Wounds', 'Shield', 'Detect Magic', 'Faerie Fire'];
          const spell = spellNames[Math.floor(Math.random() * spellNames.length)];
          const member = this.party.members.find(m => m.isAlive && m.knownSpells.length < 10) ?? this.party.leader;
          member.knownSpells.push(spell);
          this.hud.addCombatMessage(`The hag ${Math.random() < 0.5 ? 'grudgingly teaches' : 'cackles and shares'} a secret: ${member.name} learns ${spell}!`, '#a8f');
          this.expeditionJournal.push(`Visited ${poi.name}: learned ${spell}`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'dragon_lair': {
        this.hud.addCombatMessage(`${poi.name} reeks of sulfur and char. Claw marks gouge the rock — something enormous lives here...`, '#c44');
        this.hud.addCombatMessage(`Something enormous stirs in the cavern — this is no mere beast!`, '#f44');
        this.spawnPOICombat(poi, 4);
        break;
      }
      case 'ancient_battlefield': {
        this.hud.addCombatMessage(`The ground of ${poi.name} is littered with ancient arms. The dead stir uneasily...`, '#a88');
        if (Math.random() < 0.5) {
          this.hud.addCombatMessage('Skeletal warriors rise to defend their ancient battle lines!', '#c66');
          this.spawnPOICombat(poi, 4 + Math.floor(Math.random() * 3));
        } else {
          const weaponNames = ['Ancient Sword +1', 'Rusted Shield +2', 'War Hammer +1', 'Longbow of Precision'];
          const weapon = weaponNames[Math.floor(Math.random() * weaponNames.length)];
          const member = this.party.leader;
          member.inventory.push({ id: `loot_${Date.now()}_${Math.floor(Math.random()*10000)}`, name: weapon, type: 'weapon', value: 50 + Math.floor(Math.random() * 100), description: `A ${weapon} recovered from the battlefield.`, identified: true });
          this.hud.addCombatMessage(`${leader.name} claims a relic from the field: ${weapon}!`, '#dd0');
          this.expeditionJournal.push(`Explored ${poi.name}: recovered ${weapon}`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'hidden_shrine': {
        this.hud.addCombatMessage(`${poi.name} radiates a warm, golden light. The air feels sacred here...`, '#ffd700');
        for (const m of this.party.members) {
          if (m.isAlive) {
            const healed = Math.min(m.maxHp - m.hp, 5 + Math.floor(Math.random() * 10));
            m.hp += healed;
            if (healed > 0) this.hud.addCombatMessage(`${m.name} is healed for ${healed} HP by the shrine's blessing.`, '#8f8');
          }
        }
        const blessing = Math.floor(Math.random() * 3);
        if (blessing === 0) {
          for (const m of this.party.members) { if (m.isAlive) m.addXp(20); }
          this.hud.addCombatMessage('The shrine grants divine insight — the party gains 20 XP each.', '#ffd700');
        } else if (blessing === 1) {
          this.addGold(40);
          this.hud.addCombatMessage(`Offerings of gold gleam at the shrine's base — 40 gp recovered.`, '#dd0');
        } else {
          for (const m of this.party.members) {
            if (m.isAlive && m.hitDiceRemaining < m.maxHitDice) m.hitDiceRemaining = Math.min(m.hitDiceRemaining + 1, m.maxHitDice);
          }
          this.hud.addCombatMessage('The shrine restores hit dice — each party member recovers 1 hit die.', '#8cf');
        }
        this.expeditionJournal.push(`Prayed at ${poi.name}: received divine blessing`);
        poi.cleared = true;
        this.chainFrom(poi);
        break;
      }
      case 'crystal_cave': {
        this.hud.addCombatMessage(`${poi.name} sparkles with a thousand colors. The crystals pulse with arcane energy...`, '#a8f');
        if (Math.random() < 0.35) {
          this.hud.addCombatMessage('The crystals animate! Crystal guardians rise from the walls!', '#c66');
          this.spawnPOICombat(poi, 2 + Math.floor(Math.random() * 3));
        } else {
          const gemValue = 40 + Math.floor(Math.random() * 80);
          this.addGold(gemValue);
          this.hud.addCombatMessage(`${leader.name} harvests pristine crystals worth ${gemValue} gold!`, '#dd0');
          // Restore some spell slots
          for (const m of this.party.members) {
            if (m.isAlive && m.spellSlots) {
              for (const lvl in m.spellSlots) {
                if (m.spellSlots[lvl] < (m.maxSpellSlots[lvl] ?? 0)) {
                  m.spellSlots[lvl] = Math.min(m.spellSlots[lvl] + 1, m.maxSpellSlots[lvl]);
                  break;
                }
              }
            }
          }
          this.hud.addCombatMessage('The crystal energy restores arcane power — spell slots partially restored.', '#a8f');
          this.expeditionJournal.push(`Explored ${poi.name}: harvested crystals worth ${gemValue}gp`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'bandit_outpost': {
        this.hud.addCombatMessage(`${poi.name} — armed bandits spot the party immediately!`, '#c44');
        this.spawnPOICombat(poi, 3 + Math.floor(Math.random() * 3));
        break;
      }
      case 'lost_tomb': {
        this.hud.addCombatMessage(`${poi.name} — the sealed door grinds open at your touch. Cold air rushes out...`, '#a8f');
        if (Math.random() < 0.55) {
          this.hud.addCombatMessage('The tomb guardians awaken! Undead rise to protect the eternal rest!', '#c66');
          this.spawnPOICombat(poi, 3 + Math.floor(Math.random() * 4));
        } else {
          const loot = [
            { name: 'Cloak of Protection +1', type: 'armor' as const, value: 120, description: 'A fine cloak that hums with protective magic. +1 AC.' },
            { name: 'Periapt of Health', type: 'treasure' as const, value: 80, description: 'Grants immunity to disease. The owner feels vigor flow through them.' },
            { name: 'Gem of Seeing', type: 'treasure' as const, value: 100, description: 'A gem that reveals invisible creatures and hidden doors when held aloft.' },
          ];
          const item = loot[Math.floor(Math.random() * loot.length)];
          this.party.leader.inventory.push({ ...item, id: `loot_${Date.now()}_${Math.floor(Math.random()*10000)}`, identified: false });
          this.hud.addCombatMessage(`${leader.name} opens the sarcophagus and finds: ${item.name}!`, '#dd0');
          this.expeditionJournal.push(`Plundered ${poi.name}: found ${item.name}`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'enchanted_grove': {
        this.hud.addCombatMessage(`${poi.name} — fey creatures dance in the moonlight. The air shimmers with wild magic...`, '#a8f');
        const effect = Math.floor(Math.random() * 4);
        if (effect === 0) {
          for (const m of this.party.members) {
            if (m.isAlive) {
              m.hp = Math.min(m.maxHp, m.hp + 10);
              m.addXp(15);
            }
          }
          this.hud.addCombatMessage('Pixies scatter healing dust over the party! Everyone recovers 10 HP and gains 15 XP.', '#8f8');
        } else if (effect === 1) {
          const spell = ['Misty Step', 'Invisibility', 'Polymorph', 'Mirror Image'][Math.floor(Math.random() * 4)];
          const member = this.party.members.find(m => m.isAlive && m.spellSlots) ?? this.party.leader;
          if (member.spellSlots) {
            for (const lvl in member.maxSpellSlots) {
              if (member.spellSlots[lvl] < member.maxSpellSlots[lvl]) {
                member.spellSlots[lvl] = member.maxSpellSlots[lvl];
                break;
              }
            }
          }
          this.hud.addCombatMessage(`A fey spirit whispers the secret of ${spell} to ${member.name}! Full spell slots restored!`, '#a8f');
        } else if (effect === 2) {
          this.hud.addCombatMessage('The fey enchant a weapon with temporary magic! All party weapons deal +1d6 damage for 3 fights.', '#dd0');
          // We'll just give gold as a proxy
          this.addGold(60);
          this.hud.addCombatMessage('The pixies gift the party with 60 gold in fey coins that shimmer and fade.', '#dd0');
        } else {
          this.hud.addCombatMessage('A mischievous sprite casts a spell — the party grows to twice their size for a moment!', '#a8f');
          for (const m of this.party.members) {
            if (m.isAlive) m.addXp(25);
          }
          this.hud.addCombatMessage('The wild magic surge grants everyone 25 XP!', '#ffd700');
        }
        this.expeditionJournal.push(`Visited ${poi.name}: fey encounter`);
        poi.cleared = true;
        this.chainFrom(poi);
        break;
      }
      case 'watchtower': {
        this.hud.addCombatMessage(`${poi.name} — the beacon-cage is rusted, but the view is priceless.`, '#a8a');
        if (Math.random() < 0.4) {
          this.hud.addCombatMessage('Something nests in the tower! A winged guardian defends its roost!', '#c66');
          this.spawnPOICombat(poi, 2 + Math.floor(Math.random() * 2));
        } else {
          // The value of a watchtower: intelligence about the world.
          const undiscoveredPOIs = this.pois.filter(p => !p.discovered);
          if (undiscoveredPOIs.length > 0) {
            for (const p of undiscoveredPOIs.slice(0, 3)) p.discovered = true;
            this.hud.addCombatMessage('From the top, the whole realm unfolds — the party marks distant landmarks on the map!', '#ff9');
          } else {
            this.addGold(40);
            this.hud.addCombatMessage('The signal chest still holds a watch-sergeant\'s pay: 40 gold and a dusty commendation.', '#dd0');
          }
          this.expeditionJournal.push(`Climbed ${poi.name}: the realm mapped from above`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'wizard_tower': {
        this.hud.addCombatMessage(`${poi.name} hums with stored magic. The door is unlocked — which is somehow worse.`, '#a8f');
        if (Math.random() < 0.5) {
          this.hud.addCombatMessage('The tower\'s wards mistake the party for thieves! Animated defenses attack!', '#c66');
          this.spawnPOICombat(poi, 3 + Math.floor(Math.random() * 2));
        } else {
          // A wizard\'s legacy: a scroll and a slot restoration.
          const member = this.party.members.find(m => m.isAlive && m.spellSlots) ?? this.party.leader;
          if (member.spellSlots) {
            for (const lvl in member.maxSpellSlots) {
              if (member.spellSlots[lvl] < member.maxSpellSlots[lvl]) {
                member.spellSlots[lvl] = member.maxSpellSlots[lvl];
                break;
              }
            }
          }
          const scrolls = ['Scroll of Fireball', 'Scroll of Counterspell', 'Scroll of Fly', 'Scroll of Greater Healing'];
          const scroll = scrolls[Math.floor(Math.random() * scrolls.length)];
          this.party.leader.inventory.push({ name: scroll, type: 'scroll' as const, value: 90, description: 'A wizard\'s spare scroll, still potent.', id: `loot_${Date.now()}_${Math.floor(Math.random()*10000)}`, identified: true });
          this.hud.addCombatMessage(`The abandoned study yields ${scroll}, and ${member.name} restores spent slots at the mana font!`, '#8f8');
          this.expeditionJournal.push(`Studied at ${poi.name}: found ${scroll}`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'haunted_forest': {
        this.hud.addCombatMessage(`${poi.name} — the air is several degrees colder here. Something is wrong with the trees.`, '#a8a');
        if (Math.random() < 0.6) {
          this.hud.addCombatMessage('The dead of the wood rise! Wraiths and specters drift between the trunks!', '#c66');
          this.spawnPOICombat(poi, 3 + Math.floor(Math.random() * 3));
        } else {
          // Surviving the forest untested: a grim gift.
          const gold = 50 + Math.floor(Math.random() * 60);
          this.addGold(gold);
          for (const m of this.party.members) {
            if (m.isAlive) m.addXp(20);
          }
          this.hud.addCombatMessage(`The party navigates by starlight and finds a dead ranger's cache: ${gold} gold, and hard-won experience.`, '#dd0');
          this.expeditionJournal.push(`Traversed ${poi.name}: a grim passage`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'mineral_spring': {
        this.hud.addCombatMessage(`${poi.name} — the water sparkles like gemstones and smells of iron and gold.`, '#8ff');
        // Springs are always a blessing — the world needs kind places.
        for (const m of this.party.members) {
          if (m.isAlive) {
            m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp * 0.5));
          }
        }
        this.hud.addCombatMessage('The party bathes in the healing waters — everyone recovers half their maximum HP!', '#8f8');
        if (Math.random() < 0.3) {
          const gems = 30 + Math.floor(Math.random() * 70);
          this.addGold(gems);
          this.hud.addCombatMessage(`Glints in the shallows prove real: ${gems} gold in washed-up gems!`, '#dd0');
        }
        this.expeditionJournal.push(`Bathed at ${poi.name}: the waters restored them`);
        poi.cleared = true;
        this.chainFrom(poi);
        break;
      }
      case 'failed_settlement': {
        this.hud.addCombatMessage(`${poi.name} — doors left open, a chair still facing the road as if waiting.`, '#a86');
        if (Math.random() < 0.45) {
          this.hud.addCombatMessage('The dead villagers never left! Ghouls in ruined finery shamble out!', '#c66');
          this.spawnPOICombat(poi, 2 + Math.floor(Math.random() * 3));
        } else {
          const gold = 60 + Math.floor(Math.random() * 90);
          this.addGold(gold);
          if (Math.random() < 0.5) {
            this.party.leader.inventory.push({ name: 'Settlement Ledger', type: 'treasure' as const, value: 40, description: 'The town\'s last records. Somewhere in them, a name worth remembering.', id: `loot_${Date.now()}_${Math.floor(Math.random()*10000)}`, identified: true });
            this.hud.addCombatMessage(`The homes yield ${gold} gold and a ledger of the town's final days.`, '#dd0');
          } else {
            this.hud.addCombatMessage(`The abandoned homes yield ${gold} gold in left-behind coin.`, '#dd0');
          }
          this.expeditionJournal.push(`Searched ${poi.name}: the town's last coin`);
          poi.cleared = true;
          this.chainFrom(poi);
        }
        break;
      }
      case 'goblin_camp': {
        this.hud.addCombatMessage(`${poi.name} — the cooking pot is suspiciously large, and the smell is worse.`, '#a86');
        // Goblin camps always fight — but the loot is proportionally good.
        this.spawnPOICombat(poi, 3 + Math.floor(Math.random() * 3));
        break;
      }
      case 'moon_forge': {
        // The forge will only answer a blade already steeped in moon-silver.
        if (!this.silveredWeapon) {
          this.hud.addCombatMessage(`${poi.name} slumbers under a dome of dim light. The anvil glows faintly, but nothing stirs without a silvered blade to wake it.`, '#a8a');
          break;
        }
        this.hud.addCombatMessage(`The party enters ${poi.name} — a cup of the sky inverted over a ruined anvil. Moonwater trembles in the hollows.`, '#caa');
        // A guardian keeps the old forge — but dies of the moon's own lustre.
        this.hud.addCombatMessage('Shadows pool into a lank, silver-eyed guardian. It sees the blade and bows, then strikes once, by way of test.', '#a8f');
        // The reward (remaking the blade into the legendary Moonfall) is granted
        // on victory in the loot path once the guardian falls.
        this.spawnPOICombat(poi, this.party.leader.level >= 8 ? 4 : Math.min(3, Math.max(1, 1 + Math.floor(this.party.leader.level / 2))), 'shadowfell_crossing');
        break;
      }
    }
  }

  /** Spawn a POI encounter with themed monsters. */
  private spawnPOICombat(poi: OverworldPOI, count: number, themeId?: string): void {
    const monsters: Monster[] = [];
    const cr = Math.max(1, Math.floor(this.party.leader.level / 2) + Math.floor(this.dungeonLevel / 3));
    for (let i = 0; i < count; i++) {
      const template = getRandomMonster(cr, themeId);
      const tile = {
        x: poi.tile.x + Math.round((Math.random() - 0.5) * 4),
        y: poi.tile.y + Math.round((Math.random() - 0.5) * 4),
      };
      const m = new Monster(`poi_${this.monsterIdCounter++}`, template, tile);
      monsters.push(m);
    }
    if (monsters.length > 0) {
      this.startCombat(monsters);
      this.hud.addCombatMessage(`⚔️ The party engages ${monsters.length} foe${monsters.length > 1 ? 's' : ''} at ${poi.name}!`, '#f44');
      this.activePOI = poi;
    } else {
      this.hud.addCombatMessage('The area is empty — the threats have long since passed.', '#888');
      poi.cleared = true;
    }
  }

  private chooseOverworldDestination(): void {
    if (!this.overworld) return;
    const active = this.activeQuest();
    if (active) {
      if (active.completed) {
        this.overworldDestination = { kind: 'town', id: active.giverTownId };
      } else {
        const e = questTargetEntrance(active, this.overworld);
        if (e) this.overworldDestination = { kind: 'entrance', id: e.id };
      }
      return;
    }
    // No active quest — the party's next goal is WORK: head to the nearest
    // town with an open posting on its board. Wandering to a random dungeon
    // entrance makes the party criss-cross the map instead of focusing.
    const leader = this.party.leader;
    let best: OverworldTown | null = null;
    let bestD = Infinity;
    for (const t of this.overworld.towns) {
      const hasPosting = this.quests.some(q => !q.accepted && !q.turnedIn && q.giverTownId === t.id);
      // Slight preference (30 tiles) for boards that actually have work.
      const d = manhattan(t.tile, leader.tile) - (hasPosting ? 30 : 0);
      if (d < bestD) { bestD = d; best = t; }
    }
    if (best) {
      this.overworldDestination = { kind: 'town', id: best.id };
      return;
    }
    // No towns at all (shouldn't happen) — fall back to the nearest entrance.
    let bestE: OverworldEntrance | null = null;
    let bestED = Infinity;
    for (const e of this.overworld.entrances) {
      const d = manhattan(e.tile, leader.tile);
      if (d < bestED) { bestED = d; bestE = e; }
    }
    if (bestE) this.overworldDestination = { kind: 'entrance', id: bestE.id };
  }

  /** The party walks into town: rest, quests, market, and a warm fire. */
  private arriveAtTown(town: OverworldTown): void {
    this.beginTransition('fade');
    sfx.town();
    this.mode = GameMode.Town;
    this.bulletinArrivalProgress(town.id);
    this.currentTown = town;
    this.overworldDestination = null;
    this.overworldPath = [];
    this.hud.setDungeonTitle(`${this.party.partyName} — ${town.name}`);
    this.hud.addCombatMessage(`The party reaches ${town.name} — ${town.description}.`, '#ffd700');
    this.personalArrival(town);
    if (this.siegeAtGate(town)) return;
    this.maybeOfferRetirement(town);
    this.mountTrophies(town);
    this.townArrivalExtras(town);

    // The town's rumor sets the mood — and reshapes the quest board.
    const tl = this.townLife?.byTown[town.id];
    if (tl) {
      this.hud.addCombatMessage(`In the taproom, the talk is all one thing: “${tl.rumor}”`, '#a89');
      if (tl.festival && Date.now() <= tl.festival.until) {
        this.hud.addCombatMessage(`🎪 ${town.name} is celebrating ${tl.festival.name} — ${FESTIVAL_FLAVOR[tl.festival.kind]}.`, '#f6c');
      }
    }

    // Roll a random town event on arrival.
    if (tl) {
      const evt = rollArrivalEvent(this.townLife!, town.id);
      if (evt) {
        this.hud.addCombatMessage(`${evt.icon} ${evt.name} — ${evt.narration}`, '#ff8');
        // Apply event mechanical effects.
        switch (evt.effect.type) {
          case 'gold_bonus':
            this.addGold(evt.effect.value);
            this.hud.addCombatMessage(`💰 +${evt.effect.value} gp from the event!`, '#ffd700');
            break;
          case 'xp_bonus':
            // addXp, not a raw bump: a level earned at a town festival should
            // fire like any other, and a raw `xp +=` skips the level-up
            // entirely — the same bug the bulletin board's rewards once had.
            this.hud.addCombatMessage(`⬆️ +${evt.effect.value} XP per member from the event!`, '#8cf');
            for (const m of this.party.members) {
              if (m.addXp(evt.effect.value)) {
                this.hud.addCombatMessage(`⬆ ${m.name} reaches level ${m.level}!`, '#7c7');
                sfx.levelUp();
              }
            }
            break;
          case 'free_rest':
            for (const msg of this.party.longRest()) this.hud.addCombatMessage(msg, '#7c7');
            this.hud.addCombatMessage(`✨ Free healing granted by the event!`, '#8cf');
            break;
          case 'combat':
            this.hud.addCombatMessage(`👹 Monsters are attacking the town! The party rushes to defend!`, '#c66');
            // Will trigger combat on next tick
            this.overworldDestination = null;
            break;
          case 'quest_unlock':
            // Refresh quests with bonus quantity
            if (this.overworld && this.currentTown) {
              const extra = generateQuests(this.overworld, this.currentTown, Math.max(1, this.party.leader.level), evt.effect.value + 2, this.quests, 'hunt', []);
              this.quests.push(...extra);
              this.hud.addCombatMessage(`📋 ${extra.length} new urgent quests posted on the board!`, '#ffd700');
            }
            break;
        }
      }
    }

    // Refresh the bulletin board for this town.
    if (this.townLife && this.overworld) {
      const newTasks = refreshBulletinBoard(this.townLife, town.id, this.overworld, Math.max(1, this.party.leader.level));
      if (newTasks.length > 0) {
        this.hud.addCombatMessage(`📋 The bulletin board has ${newTasks.length} new tasks posted.`, '#8cf');
      }
    }

    this.hud.addCombatMessage('The party takes rooms at the inn — long rest.', '#8cf');
    for (const msg of this.party.longRest()) this.hud.addCombatMessage(msg, '#7c7');

    // Turn in completed quests, then keep the board stocked.
    for (const q of this.quests) {
      if (q.accepted && q.completed && !q.turnedIn) this.reportQuest(q);
    }
    if (!this.quests.some(q => !q.turnedIn)) {
      const bias = tl?.rumorBias ?? 'none';
      const givers = tl?.questGivers?.map(g => ({ id: g.id, specialty: g.specialty }));
      const fresh = generateQuests(this.overworld!, town, Math.max(1, this.party.leader.level), 3, this.quests, bias, givers);
      this.quests.push(...fresh);
    }
    const open = this.quests.filter(q => !q.turnedIn).length;
    this.hud.addCombatMessage(`The quest board at ${town.name} has ${open} posting${open === 1 ? '' : 's'} — open the Town panel to take one.`, '#9a9');
    this.hud.setParty(this.party);
    this.townWaitTimer = 0;
    this.hud.townPanel.show();

    // The party autonomously handles town business after a brief pause.
    setTimeout(() => this.autoTownActions(), 3500);
    this.storyController.onTownArrival(town);
    this.manualHold(`the gates of ${town.name}`);
  }

  /** Leave town: with a quest in hand, the party marches to its dungeon. */
  /** Use a service in the current town building. */
  private useTownService(serviceId: TownServiceId): void {
    if (this.mode !== GameMode.Town || !this.currentTown || !this.townLife) {
      this.hud.addCombatMessage('You must be in a town to use services.', '#886');
      return;
    }
    const archetype = TOWN_ARCHETYPES[this.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
    if (!archetype) return;
    const town = this.currentTown;

    switch (serviceId) {
      case 'remove_curse': {
        const cost = 120;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        const afflicted = this.party.members.find(m => m.findCursedEquipped());
        if (!afflicted) {
          this.hud.addCombatMessage('The priests pass their hands over the party — no curse clings to anyone.', '#8a8');
          return;
        }
        this.addGold(-cost);
        const item = afflicted.findCursedEquipped()!;
        afflicted.liftCurse();
        this.hud.addCombatMessage(`✨ The temple rites wash over ${afflicted.name} — the pall on the ${item.name} lifts. It can now be removed.`, '#8cf');
        this.hud.setParty(this.party);
        break;
      }
      case 'train_combat': {
        const cost = 50;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        this.hud.addCombatMessage(`⚔️ Combat training complete — each member gains 30 XP.`, '#8cf');
        this.grantXp(m => (m.isAlive ? 30 : 0));
        break;
      }
      case 'train_magic': {
        const cost = 75;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        this.hud.addCombatMessage(`📖 Arcane study complete — casters gain 40 XP, others 15 XP.`, '#8cf');
        this.grantXp(m => (m.isAlive ? (isCaster(m.charClass.id) ? 40 : 15) : 0));
        break;
      }
      case 'heal': {
        // Sacred day: the priests open the temple to all pilgrims.
        const sacred = this.calendar.isSacredDay;
        const cost = sacred ? 10 : 25;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        for (const m of this.party.members) {
          // Sacred day also mends more — the clergy bless the wounded at length.
          const ratio = sacred ? 0.85 : 0.5;
          const heal = Math.floor(m.maxHp * ratio);
          m.hp = Math.min(m.maxHp, m.hp + heal);
        }
        this.hud.addCombatMessage(sacred
          ? `✨ The ${this.calendar.weekday} rites fill the nave — each member recovers 85% HP for a pittance.`
          : `✨ The temple clerics heal all wounds — each member recovers 50% HP.`, '#8cf');
        break;
      }
      case 'identify': {
        const cost = 30;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        let identified = false;
        for (const m of this.party.members) {
          const item = m.inventory.find(i => i.identified === false);
          if (item) {
            item.identified = true;
            this.hud.addCombatMessage(`🔮 Identified: ${item.name} — ${item.description}${item.effect ? ' Effect: ' + item.effect : ''}`, '#8cf');
            identified = true;
            break;
          }
        }
        if (!identified) {
          this.hud.addCombatMessage(`🔮 The wizard examines your items... everything is already known.`, '#8a8');
        }
        break;
      }
      case 'enchant': {
        const cost = 200;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        this.combatEngine.townBuffDamage += 3;
        this.combatEngine.townBuffFightsLeft = Math.max(this.combatEngine.townBuffFightsLeft, 3);
        this.hud.addCombatMessage(`🔥 The blacksmith's forge flares — +3 damage for 3 battles!`, '#ffd700');
        break;
      }
      case 'craft': {
        // Three monster parts and forty gold make a real piece of gear.
        const parts = this.partyInventory().filter(i => i.id.startsWith('part_'));
        if (parts.length >= 3 && this.partyGold() >= 40) {
          this.addGold(-40);
          for (const p of parts.slice(0, 3)) for (const m of this.party.members) if (m.hasItem(p.id)) { m.useItem(p.id); break; }
          const piece = rollTieredGear({ maxBonus: Math.min(3, 1 + Math.floor(this.party.leader.level / 6)), minBonus: 1 });
          this.party.leader.addToInventory(piece);
          this.hud.addCombatMessage(`\u2692 The artisan takes ${parts.slice(0, 3).map(p => p.name).join(', ')} and forty gold, and hands back ${piece.name}. ${piece.description}`, '#ffd700');
          this.tally('crafted');
          this.hud.townPanel.refresh();
          break;
        }
        const cost = 100;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        const craftPool = [
          { name: 'Healing Potion', type: 'potion' as const, value: 25, description: 'Restores 30 HP.', power: 30 },
          { name: 'Scroll of Magic Missile', type: 'scroll' as const, value: 40, description: 'Deals 14 force damage.', power: 14 },
          { name: 'Scroll of Cure Wounds', type: 'scroll' as const, value: 60, description: 'Restores 28 HP.', power: 28 },
          { name: 'Antidote', type: 'potion' as const, value: 15, description: 'Cures poison.', power: 10 },
          { name: 'Potion of Fire Breath', type: 'potion' as const, value: 100, description: 'Deals 42 fire damage.', power: 42 },
        ];
        const crafted = craftPool[Math.floor(Math.random() * craftPool.length)];
        const item: InventoryItem = { id: `crafted_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, name: crafted.name, type: crafted.type, value: crafted.value, description: crafted.description, power: crafted.power };
        this.party.leader.inventory.push(item);
        this.hud.addCombatMessage(`⚒️ The artisan crafts a ${crafted.name}! Added to ${this.party.leader.name}'s inventory.`, '#8cf');
        break;
      }
      case 'bounty_board': {
        // Refresh quests with combat bias
        if (!this.currentTown) break;
        const fresh = generateQuests(this.overworld!, this.currentTown, Math.max(1, this.party.leader.level), 5, this.quests, 'hunt', []);
        this.quests.push(...fresh);
        this.hud.addCombatMessage(`📋 The bounty board has been refreshed with ${fresh.length} new postings!`, '#ffd700');
        break;
      }
            case 'tavern_rumors': {
        const cost = 10;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        const buff = rollTavernBuff();
        if (buff && this.currentTown && this.townLife) {
          const tl = this.townLife.byTown[this.currentTown.id];
          tl.tavernBuff = buff;
          tl.tavernBuffFightsLeft = 3;
          const narration = getTavernBuffNarration(buff);
          this.hud.addCombatMessage(`You buy a round... ${narration}`, '#a89');
          this.hud.addCombatMessage(`Buff: ${buff.name} \u2014 ${buff.description} (3 fights)`, '#8cf');
        } else {
          const hints = [
            'The bartender whispers: there is a hidden vault beneath the third floor.',
            'A drunk ranger mutters: the boss on floor 5 has a weakness to fire.',
            'A traveling merchant says: the chests on the upper floors hold the best loot.',
            'An old adventurer claims: there is a secret passage behind the waterfall on floor 2.',
          ];
          this.hud.addCombatMessage(`You buy a round... ${hints[Math.floor(Math.random() * hints.length)]}`, '#a89');
        }
        break;
      }
      case 'temple_blessing': {
        const cost = 40;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        this.combatEngine.townBuffSaveBonus += 2;
        this.combatEngine.townBuffFightsLeft = Math.max(this.combatEngine.townBuffFightsLeft, 3);
        this.hud.addCombatMessage(`✨ The priests bestow a divine blessing — +2 to all saves for 3 battles!`, '#ffd700');
        break;
      }
      case 'blacksmith_upgrade': {
        const cost = 150;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        this.combatEngine.townBuffAC += 1;
        this.combatEngine.townBuffFightsLeft = Math.max(this.combatEngine.townBuffFightsLeft, 3);
        this.hud.addCombatMessage(`🔨 The smith reinforces your armor — +1 AC for 3 battles!`, '#ffd700');
        break;
      }
      case 'silver_forge': {
        const inv = this.partyInventory();
        // First forge: crescent + 2 fangs OR a pelt.
        if (!this.silveredWeapon) {
          const crescent = inv.find(i => i.name === 'Moon-Silver Crescent');
          const fangs = inv.filter(i => i.name === 'Moon-Touched Fang').length;
          const pelt = inv.some(i => i.name === 'Silver-Flecked Were-Pelt');
          if (!crescent || !(fangs >= 2 || pelt)) {
            this.hud.addCombatMessage('⛔ The smith needs a Moon-Silver Crescent and two moon-fangs (or a were-pelt). Full-moon hunts leave them behind.', '#c88');
            break;
          }
          let removed = 0;
          for (const m of this.party.members) {
            m.inventory = m.inventory.filter(i => {
              if (i.name === 'Moon-Silver Crescent' || i.name === 'Silver-Flecked Were-Pelt') return false;
              if (i.name === 'Moon-Touched Fang' && removed < 2) { removed++; return false; }
              return true;
            });
          }
        this.silveredWeapon = true;
        this.moonForgeLevel = 1;
          this.hud.addCombatMessage(`🌟 ${this.party.leader.name} holds the crescent high as the smith works the bellows — a blade of pale silver rings in the firelight. The party is forever braver for it.`, '#ffd700');
          this.hud.addCombatMessage(`⚔ Forged! All attacks gain +1 damage permanently, and strike shapeshifters for double damage.`, '#ffd700');
          this.hud.addCombatMessage('The smith nods approvingly. "Bring me more moon-fangs and a were-pelt — I can temper it further."', '#ca8');
          break;
        }
        // Later tempering: 2 fangs + 1 pelt per tier, up to the moon-forge cap.
        if (this.moonForgeLevel >= 3) {
          this.hud.addCombatMessage('The blade is forged to its fullest. No mortal smith can draw more from it.', '#886');
          break;
        }
        const fangs = inv.filter(i => i.name === 'Moon-Touched Fang').length;
        const pelt = inv.some(i => i.name === 'Silver-Flecked Were-Pelt');
        if (fangs < 2 || !pelt) {
          this.hud.addCombatMessage('⛔ Further tempering needs another two moon-fangs and a were-pelt.', '#c88');
          break;
        }
        let used = 0;
        for (const m of this.party.members) {
          m.inventory = m.inventory.filter(i => {
            if (i.name === 'Silver-Flecked Were-Pelt' && used < 2) { used = 3; return false; }
            if (i.name === 'Moon-Touched Fang' && used < 2) { used++; return false; }
            return true;
          });
        }
        this.moonForgeLevel++;
        const forgedNames = ['the blade drinks the moonlight and hardens', 'runic moon-traces thread up the steel', 'the edge turns silver-frost and sings when drawn'];
        this.hud.addCombatMessage(`💠 The smith tempers the blade once more — ${forgedNames[this.moonForgeLevel - 2]}. It now strikes shapeshifters even harder.`, '#ffd700');
        if (this.moonForgeLevel >= 3) {
          this.hud.addCombatMessage('🌙 The finished blade hums with quiet moonlight. It will cut any shape-shifted flesh like prayer.', '#8cf');
          this.revealMoonForge();
        }
        break;
      }
      case 'guild_registration': {
        const cost = 25;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        if (this.currentTown && this.townLife) {
          const tl = this.townLife.byTown[this.currentTown.id];
          if (tl.guildRegistered) {
            this.hud.addCombatMessage('You are already registered with the local guild chapter.', '#8a8');
          } else {
            tl.guildRegistered = true;
            tl.townReputation = Math.min(100, tl.townReputation + 10);
            this.hud.addCombatMessage('Registered with the Adventurers Guild! Quest rewards +50%, magic item drop chance +20%.', '#ffd700');
          }
        }
        break;
      }
      case 'hire_guard': {
        const cost = 40;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        const guardNames = ['Bram Ironhand', 'Sara Shieldborn', 'Dex Quickblade', 'Mara Stoneguard', 'Krag Fireblood', 'Elara Windrunner'];
        const guardClasses = ['fighter', 'ranger', 'barbarian'];
        const gName = guardNames[Math.floor(Math.random() * guardNames.length)];
        const gClass = guardClasses[Math.floor(Math.random() * guardClasses.length)];
        this.hud.addCombatMessage(gName + ' joins the party as a temporary companion for the next dungeon!', '#8cf');
        // Store the guard info for the next dungeon entry
        this.pendingGuardHire = { name: gName, classId: gClass };
        break;
      }
      case 'tavern_gamble': {
        this.playDiceGame();
        break;
      }
      case 'carouse': {
        this.carouse();
        break;
      }
      case 'buy_horse': {
        const cost = 80;
        if (this.mounted) { this.hud.addCombatMessage('The party already has a horse, and it is enough trouble.', '#886'); return; }
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold for a horse.', '#c66'); return; }
        this.addGold(-cost);
        this.mounted = true;
        this.hud.addCombatMessage('\ud83d\udc0e A sound horse, a saddle that fits, and the road a third shorter for it.', '#e8b45a');
        this.hud.townPanel.refresh();
        break;
      }
      case 'ship_passage': {
        const cost = 60;
        if (!this.overworld || !this.currentTown) return;
        const far = this.overworld.towns.filter(t => t.id !== this.currentTown!.id && manhattan(t.tile, this.currentTown!.tile) >= 30);
        if (far.length === 0) { this.hud.addCombatMessage('No boat sails from here to anywhere worth the fare.', '#886'); return; }
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold for passage.', '#c66'); return; }
        this.addGold(-cost);
        const dest = far[Math.floor(Math.random() * far.length)];
        const here = this.currentTown.name;
        this.hud.townPanel.hide();
        this.mode = GameMode.Overworld;
        this.currentTown = null;
        this.party.setPosition({ x: dest.tile.x, y: dest.tile.y + 1 });
        this.map.reveal(dest.tile.x, dest.tile.y, 8);
        this.hud.addCombatMessage(`\u26f5 Three days of grey water from ${here}, and the party comes ashore at ${dest.name} with its legs still rolling.`, '#8cf');
        this.tally('voyages');
        this.arriveAtTown(dest);
        break;
      }
      case 'bank_deposit': {
        const keep = 50;
        const put = Math.max(0, this.partyGold() - keep);
        if (put <= 0) { this.hud.addCombatMessage('There is nothing to bank past walking-around money.', '#886'); return; }
        this.spendGold(put);
        setBank(readBank() + put);
        this.hud.addCombatMessage(`\ud83c\udfe6 ${put} gold goes into the ledger. The counting-house holds ${readBank()} in the party's name, and will hold it for whoever comes after.`, '#ffd700');
        this.hud.townPanel.refresh();
        break;
      }
      case 'bank_withdraw': {
        const held = readBank();
        if (held <= 0) { this.hud.addCombatMessage('The ledger shows nothing in the party\'s name.', '#886'); return; }
        setBank(0);
        this.addGold(held);
        this.hud.addCombatMessage(`\ud83c\udfe6 ${held} gold comes out of the counting-house.`, '#ffd700');
        this.hud.townPanel.refresh();
        break;
      }
      case 'buy_arrows': {
        const cost = 8;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold for arrows.', '#c66'); return; }
        this.addGold(-cost);
        this.arrows += 30;
        this.hud.addCombatMessage(`\ud83c\udff9 Thirty arrows into the quiver (${this.arrows} now).`, '#e8b45a');
        this.hud.townPanel.refresh();
        break;
      }
      case 'buy_torches': {
        const cost = 12;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold for torches.', '#c66'); return; }
        this.addGold(-cost);
        this.torches += 3;
        this.hud.addCombatMessage(`\ud83d\udd25 Three pitch torches go in the pack (${this.torches} carried).`, '#e8b45a');
        this.hud.townPanel.refresh();
        break;
      }
      case 'temple_donate': {
        const cost = 50;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        if (this.currentTown && this.townLife) {
          const tl = this.townLife.byTown[this.currentTown.id];
          tl.townReputation = Math.min(100, tl.townReputation + 15);
        }
        const blessings = [
          'The priests are moved by your generosity. You feel lighter, as if a burden has lifted.',
          'The temple bells ring in your honor. A warm glow settles over the party.',
          'The high priest personally blesses your weapons. They gleam with faint light.',
          'Incense and prayer surround you. The temple marks you as a friend of the faith.',
        ];
        this.hud.addCombatMessage(blessings[Math.floor(Math.random() * blessings.length)], '#ffd700');
        // Random small healing as karma bonus
        for (const m of this.party.members) {
          const heal = Math.floor(Math.random() * 10) + 5;
          m.hp = Math.min(m.maxHp, m.hp + heal);
        }
        this.hud.addCombatMessage('Karma smiles — each party member recovers a few HP.', '#8cf');
        break;
      }
      case 'rest':
        this.restAtInn();
        break;
      default:
        this.hud.addCombatMessage('That service is not available here.', '#886');
    }
    this.hud.townPanel.refresh();
  }

  /**
   * The party autonomously manages town time: heal the wounded, stock up on
   * potions, grab a tavern buff, register with the guild, and accept a quest
   * before setting out. Called shortly after arriving so the player can watch
   * the party make its own decisions.
   */
  private autoTownActions(): void {
    if (this.mode !== GameMode.Town || !this.currentTown) return;
    const actions: string[] = [];

    // 1. Heal at temple if anyone is below 60% HP.
    const wounded = this.party.members.filter(m => m.isAlive && m.hp < m.maxHp * 0.6);
    if (wounded.length > 0 && this.partyGold() >= 25) {
      this.useTownService('heal');
      actions.push('healed at the temple');
    }

    // 2. Buy a healing potion if nobody carries one and we can afford it.
    const hasPotion = this.party.leader.inventory.some(i => i.type === 'potion' && i.name.toLowerCase().includes('heal'));
    if (!hasPotion && this.partyGold() >= 18) {
      const potion: InventoryItem = {
        id: `auto_potion_${Date.now()}`,
        name: 'Healing Potion',
        type: 'potion',
        value: 18,
        description: 'Restores 30 HP.',
        power: 30,
      };
      this.buyItem(potion);
      actions.push('bought a healing potion');
    }

    // 3. Grab tavern rumors for a combat buff (10 gp).
    const tl = this.townLife?.byTown[this.currentTown.id];
    if (tl && !tl.tavernBuff && this.partyGold() >= 10) {
      this.useTownService('tavern_rumors');
      actions.push('listened to tavern rumors');
    }
    // 3b. If the party has gathered moon-touched materials, forge or temper the weapon.
    const haveCrescent = this.partyInventory().some(i => i.name === 'Moon-Silver Crescent');
    const haveTemper = this.partyInventory().filter(i => i.name === 'Moon-Touched Fang').length >= 2
      && this.partyInventory().some(i => i.name === 'Silver-Flecked Were-Pelt');
    if (!this.silveredWeapon && haveCrescent) {
      this.useTownService('silver_forge');
      if (this.silveredWeapon) actions.push('forged a silvered weapon');
    } else if (this.silveredWeapon && this.moonForgeLevel < 3 && haveTemper) {
      const before = this.moonForgeLevel;
      this.useTownService('silver_forge');
      if (this.moonForgeLevel > before) actions.push(`tempered the moon-forge blade (tier ${this.moonForgeLevel})`);
    }

    // 4. Register with the guild if not yet registered (10 rep bonus).
    if (tl && !tl.guildRegistered && this.partyGold() >= 25) {
      this.useTownService('guild_registration');
      actions.push('registered with the guild');
    }

    // 5. Accept a quest if none is active.
    if (!this.activeQuestId) {
      const available = this.storyController.nextPosting();
      if (available) {
        this.hud.addCombatMessage('The party reviews the quest board and picks a posting...', '#9a9');
        this.acceptQuest(available);
        actions.push(`accepted: ${available.title}`);
      } else {
        this.hud.addCombatMessage('No quests available — the party rests and waits.', '#888');
      }
    }

    // 6. An accepted quest is still unfinished — after restocking, march
    //    straight back to its dungeon instead of idling in town.
    if (this.activeQuestId) {
      const running = this.activeQuest();
      if (running && !running.completed) {
        this.hud.addCombatMessage(`The party is bound for ${questTargetEntrance(running, this.overworld!)?.name ?? 'the quest dungeon'} — ${running.title} is not finished.`, '#9a9');
        this.departTown();
        actions.push(`departed to continue: ${running.title}`);
      }
    }

    if (actions.length > 0) {
      this.hud.addCombatMessage(`\u2694 The party takes care of business: ${actions.join(', ')}.`, '#8cf');
    }
  }

  departTown(): void {
    if (this.mode !== GameMode.Town) {
      this.hud.addCombatMessage('The party is not in town right now.', '#886');
      return;
    }
    const active = this.activeQuest();
    if (!active) {
      this.hud.addCombatMessage('No quest is accepted — take a posting from the quest board first.', '#886');
      this.hud.townPanel.refresh();
      return;
    }
    const townName = this.currentTown?.name ?? 'town';
    this.hud.townPanel.hide();
    this.beginTransition('fade');
    sfx.depart();
    this.mode = GameMode.Overworld;
    this.currentTown = null;
    this.overworldDestination = active.completed
      ? { kind: 'town', id: active.giverTownId }
      : { kind: 'entrance', id: active.entranceId };
    this.overworldPath = [];
    const e = questTargetEntrance(active, this.overworld!);
    const destName = active.completed ? 'the town to report' : (e?.name ?? 'the dungeon');
    this.hud.addCombatMessage(`The party packs up and sets out from ${townName} — bound for ${destName}.`, '#ca8');
    this.townWaitTimer = 0;
  }

  acceptQuest(q: Quest): void {
    if (q.accepted) return;
    q.accepted = true;
    if (q.kind === 'collect_item') q.baselineTreasures = this.treasuresFound;
    this.activeQuestId = q.id;
    this.hud.addCombatMessage(`📜 The party accepts the posting: ${q.title}`, '#ffd700');
    this.hud.townPanel.refresh();
    // A quest is a reason to leave — the party sets out at once.
    this.departTown();
  }

  reportQuest(q: Quest): void {
    if (q.turnedIn) return;
    q.turnedIn = true;
    if (this.activeQuestId === q.id) this.activeQuestId = null;
    // The act ends after the reward, so the card comes over a settled ledger.
    queueMicrotask(() => this.storyController.onQuestTurnedIn(q));
    this.hud.addCombatMessage(`💰 ${q.title} — complete! ${q.rewardGold} gp and ${q.rewardXp} XP per member.`, '#ffd700');
    this.addGold(q.rewardGold);
    for (const m of this.party.members) {
      if (m.isDead) continue;
      if (m.addXp(q.rewardXp)) {
        this.hud.addCombatMessage(`🌟 ${m.name} levels up — now level ${m.level}!`, '#ffd700');
      }
    }
    if (q.rewardItemId) {
      const item = MAGIC_ITEMS.find(mi => mi.id === q.rewardItemId);
      if (item) {
        this.addItemToParty({ id: item.id, name: item.name, type: 'treasure', description: item.description, value: 0 });
        this.hud.addCombatMessage(`✨ The quest giver presents ${item.name}!`, '#c9b8ff');
      }
    }
    // Award reputation to the quest-giver NPC
    if (q.giverNpcId && this.townLife && this.currentTown) {
      const tl = this.townLife.byTown[this.currentTown.id];
      if (tl?.questGivers) {
        const npc = tl.questGivers.find(g => g.id === q.giverNpcId);
        if (npc) {
          const repMsg = awardReputation(npc, q.rewardGold);
          this.hud.addCombatMessage(`${npc.portrait} ${npc.name} nods approvingly.`, '#a89');
          if (repMsg) this.hud.addCombatMessage(`   ${repMsg}`, '#ffd700');
        }
      }
    }
    this.hud.townPanel.refresh();
  }

  listQuests(): void {
    if (this.quests.length === 0) {
      this.hud.addCombatMessage('No quests are posted — reach a town to find work.', '#888');
      return;
    }
    const state = this.questState();
    let i = 0;
    for (const q of this.quests) {
      if (q.turnedIn) continue;
      i++;
      const status = !q.accepted ? 'available' : q.completed ? '✔ COMPLETE' : 'in progress';
      const progress = q.accepted ? ` [${questProgressText(q, state)}]` : '';
      this.hud.addCombatMessage(`${i}. ${q.title} — ${status}${progress}`, q.completed ? '#ffd700' : q.accepted ? '#8cf' : '#9a9');
      this.hud.addCombatMessage(`   ${q.detail}`, '#778');
    }
  }

  private handleTownOpen(): void {
    if (this.mode === GameMode.Town) {
      this.hud.townPanel.show();
    } else {
      this.hud.addCombatMessage('The party is not in a town right now — let them reach one first.', '#886');
    }
  }

  enterDungeonFromEntrance(e: OverworldEntrance): void {
    this.beginTransition('fade');
    sfx.descend();
    this.dungeonEntranceId = e.id;
    this.mode = GameMode.Dungeon;
    this.dungeonLevel = 1;
    this.rooms = [];
    this.bossSlainThisFloor = false;
    this.hud.addCombatMessage(`The party descends into ${e.name} — ${e.description}.`, '#a8a');
    const theme = e.themeId ? (getLocation(e.themeId) ?? undefined) : undefined;
    // Apply pending guard hire.
    if (this.pendingGuardHire && this.party.members.length < 5) {
      const gh = this.pendingGuardHire;
      const cls = CLASSES.find(c => c.id === gh.classId) ?? CLASSES.find(c => c.id === 'fighter')!;
      const guardChar = new GameCharacter(
        'guard_' + Date.now(), gh.name, cls,
        RACES.find(r => r.id === 'human') ?? RACES[0],
        { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 10 },
      );
      guardChar.isTemporaryCompanion = true;
      this.party.addMember(guardChar);
      this.hirelings[guardChar.id] = 3 + Math.floor(this.party.leader.level / 3);
      this.hud.addCombatMessage(`\ud83d\udcdc ${gh.name}'s contract runs ${this.hirelings[guardChar.id]} floors, and then there is pay owed.`, '#a98');
      this.hud.addCombatMessage(gh.name + ' takes formation with the party.', '#8cf');
      this.pendingGuardHire = null;
    } else if (this.pendingGuardHire) {
      this.hud.addCombatMessage('The party is full - ' + this.pendingGuardHire.name + ' cannot join.', '#c66');
      this.addGold(40); // refund
      this.pendingGuardHire = null;
    }
    this.generateNewDungeon({ name: e.name, theme });
    this.hud.addCombatMessage('Remember: to claim the reward they must climb back out and report to the quest board.', '#9a9');
  }

  /** Leave the dungeon for the surface — quest complete or by order. */
  exitDungeonToOverworld(): void {
    this.noteProgress();
    this.beginTransition('fade');
    sfx.ascend();
    this.descending = true;
    const entranceId = this.dungeonEntranceId;
    // Old saves may not have an overworld yet — build one on first exit.
    if (!this.overworld) this.generateOverworld();
    const ow = this.overworld!;
    // The live map must be the overworld again (it was the dungeon's while below).
    this.map = ow.map;
    this.camera.setBounds(this.map.width, this.map.height);
    this.mode = GameMode.Overworld;
    this.phase = GamePhase.Exploration;
    this.combatEngine.isActive = false;
    this.combatEngine.initiativeOrder = [];
    this.combatEngine.currentTurnIndex = 0;
    this.monsters = [];
    this.traps = [];
    this.rooms = [];
    this.hud.setBosses([]);

    // POI respawn: cleared POIs have a 30% chance to respawn with new encounters
    // for every 3 dungeon floors cleared. The overworld stays dangerous.
    for (const poi of this.pois) {
      if (poi.cleared && Math.random() < 0.15 * Math.floor(this.dungeonLevel / 3)) {
        poi.cleared = false;
        poi.discovered = true; // keep it discovered
      }
    }

    // Remove temporary companions (hired guards) when leaving the dungeon.
    const removed: string[] = [];
    for (let i = this.party.members.length - 1; i >= 0; i--) {
      if (this.party.members[i].isTemporaryCompanion) {
        removed.push(this.party.members[i].name);
        this.party.members.splice(i, 1);
        if (this.party.formation[i]) this.party.formation.splice(i, 1);
      }
    }
    if (removed.length > 0) {
      this.hud.addCombatMessage(removed.join(', ') + ' departs as the party emerges from the dungeon.', '#8a8');
    }

    // Emerge at the entrance (or the spawn town if unknown).
    const e = entranceId ? getEntranceById(ow, entranceId) : undefined;
    const pos = e
      ? { ...e.tile }
      : { ...(getTownById(ow, ow.spawnTownId) ?? ow.towns[0]).tile };
    this.party.setPosition(pos, (x, y) => this.map.isWalkable(x, y));
    this.camera.x = pos.x * TILE_SIZE - 512;
    this.camera.y = pos.y * TILE_SIZE - 384;
    this.camera.targetX = this.camera.x;
    this.camera.targetY = this.camera.y;

    const active = this.activeQuest();
    if (active && active.completed) {
      this.overworldDestination = { kind: 'town', id: active.giverTownId };
      this.hud.addCombatMessage(`The party climbs out into daylight — ${active.title} is done. Time to report back.`, '#ffd700');
    } else {
      // Quest unfinished or no quest at all: recover at the NEAREST town,
      // not the spawn town at the far end of the map (that trek is pure
      // backtracking). autoTownActions then heads straight back out — to
      // the quest dungeon if one is running, or to the board for new work.
      const town = this.nearestTown(pos);
      this.overworldDestination = town
        ? { kind: 'town', id: town.id }
        : { kind: 'town', id: ow.spawnTownId };
      this.hud.addCombatMessage('The party climbs back out of the dungeon into the open air.', '#ca8');
    }
    this.overworldPath = [];
    this.dungeonLevel = 0;
    this.dungeonEntranceId = null;
    this.hud.setDungeonTitle(`${this.party.partyName} — The Wilderlands`);
    this.hud.addCombatMessage(this.describeParty(), '#ccc');
    this.hud.setParty(this.party);
    this.descending = false;
  }

  // ── Commerce ─────────────────────────────────────

  partyGold(): number {
    return this.party.members.reduce((s, m) => s + m.gold, 0);
  }

  addGold(n: number): void {
    this.party.leader.gold += n;
    if (n > 0) sfx.gold();
  }

  /** Spend gold across the party, richest first. True if fully paid. */
  /**
   * Take coin from the party, richest pocket first.
   *
   * Checked before a single coin moves. This used to take what it could find
   * and only then discover the party was short, returning false with the
   * purse already empty and nothing bought — the caller sees a refused
   * purchase, the player sees their gold gone.
   */
  spendGold(n: number): boolean {
    if (this.partyGold() < n) return false;
    let remaining = n;
    const sorted = [...this.party.members].sort((a, b) => b.gold - a.gold);
    for (const m of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(m.gold, remaining);
      m.gold -= take;
      remaining -= take;
    }
    return true;
  }

  /** The shop: stock, prices, and goods changing hands. */
  private readonly market = new MarketController(this);

  partyInventory(): InventoryItem[] { return this.market.partyInventory(); }
  private addItemToParty(item: InventoryItem): void { this.market.addItemToParty(item); }
  marketStock(): InventoryItem[] { return this.market.marketStock(); }
  buyItem(item: InventoryItem): void { this.market.buyItem(item); }
  sellItem(item: InventoryItem): void { this.market.sellItem(item); }
  private buyRepItem(repItem: ReputationShopItem): void { this.market.buyRepItem(repItem); }

  // ── Bulletin board tasks ──────────────────────────────────

  /** The town's small jobs: taking them on, tracking them, paying them out. */
  private readonly bulletin = new BulletinBoardController(this);

  acceptBulletinTask(task: BulletinTask): void { this.bulletin.acceptBulletinTask(task); }
  boardForTown(townId: string): BulletinTask[] { return this.bulletin.boardForTown(townId); }
  private completeBulletinTask(task: BulletinTask): void { this.bulletin.completeBulletinTask(task); }
  listBulletinTasks(): void { this.bulletin.listBulletinTasks(); }
  private bulletinSlayProgress(): void { this.bulletin.bulletinSlayProgress(); }
  private bulletinCollectProgress(found: number): void { this.bulletin.bulletinCollectProgress(found); }
  private bulletinScoutProgress(rooms: number): void { this.bulletin.bulletinScoutProgress(rooms); }
  private bulletinArrivalProgress(townId: string): void { this.bulletin.bulletinArrivalProgress(townId); }

  private restAtInn(): void {
    if (this.mode !== GameMode.Town) return;
    sfx.heal();
    this.hud.addCombatMessage('The party rests at the inn.', '#8cf');
    for (const msg of this.party.longRest()) this.hud.addCombatMessage(msg, '#7c7');
    this.hud.setParty(this.party);
    this.hud.townPanel.refresh();
  }

  // ── Context-aware compendium actions ────────────

  private handleCompendiumAction(entry: CompendiumEntry, mode: 'encounter' | 'legend'): void {
    if (!entry.action) return;

    if (mode === 'legend') {
      const line = pick(LEGEND_TEMPLATES)(entry.name);
      this.hud.addCombatMessage(`\ud83d\udcd6 ${line}`, '#c9b8ff');
      return;
    }

    switch (entry.action.kind) {
      case 'summon-monster':
        this.conjureMonsterLegend(entry);
        break;
      case 'teach-spell':
        this.teachSpellFromPage(entry);
        break;
      case 'faction':
        this.runFactionEncounter(entry);
        break;
      case 'deity':
        this.manifestShrine(entry);
        break;
    }
    this.hud.setParty(this.party);
  }

  private conjureMonsterLegend(entry: CompendiumEntry): void {
    const template = getMonsterTemplate(entry.action!.refId);
    if (!template) return;

    let effective = template;
    let note = '';
    if (template.cr > this.dungeonLevel + 8) {
      effective = { ...template, hp: Math.ceil(template.hp / 2), xp: Math.ceil(template.xp / 2) };
      note = ' A weakened echo of the legend answers the call.';
    }
    this.proclaim(`${entry.name} steps out of legend and into the halls!${note}`);
    this.spawnEncounter([effective]);
  }

  private teachSpellFromPage(entry: CompendiumEntry): void {
    const spell = getSpellById(entry.action!.refId);
    if (!spell) return;

    const casters = this.party.members.filter(m => isCaster(m.charClass.id));
    if (casters.length === 0) {
      this.proclaim('The arcane script defeats every eye in the party.');
      return;
    }
    const learner = casters.find(m => !m.knownSpells.includes(spell.id));
    if (learner) {
      learner.knownSpells.push(spell.id);
      const summary = learner.slotSummaryFor(spell.level);
      const ready = learner.canCastSpell(spell.level);
      this.proclaim(ready
        ? `${learner.name} studies the page and commits ${spell.name} to memory! Slots ready: ${summary}.`
        : `${learner.name} studies the page and commits ${spell.name} to memory \u2014 though every matching slot is spent (${summary}) and a rest is needed to cast it.`);
    } else {
      const master = casters[Math.floor(Math.random() * casters.length)];
      // Restore a slot that can actually cast the studied spell; fall back to
      // the lowest expended slot if none at this level are spent.
      const restored = master.restoreSpellSlotForSpell(spell.level) ?? master.restoreSpellSlot();
      if (restored === null) {
        this.proclaim(`${master.name} already knows ${spell.name}, and every slot is already full.`);
      } else if (restored >= spell.level) {
        this.proclaim(`${master.name} already knows ${spell.name} \u2014 the study restores a ${ordinal(restored)}-level slot (${master.spellSlots[restored] ?? 0}/${master.maxSpellSlots[restored] ?? 0}), enough to cast it!`);
      } else {
        this.proclaim(`${master.name} already knows ${spell.name} \u2014 the study restores a ${ordinal(restored)}-level slot, though ${spell.name} needs a ${ordinal(Math.max(1, spell.level))}-level one.`);
      }
    }
  }

  private runFactionEncounter(entry: CompendiumEntry): void {
    const encounter = FACTION_ENCOUNTERS[entry.action!.refId.toLowerCase()];
    if (!encounter) return;

    this.proclaim(encounter.intro.replace(/\{name\}/g, entry.name));

    if (encounter.hostile && encounter.monsters) {
      let ids = [...encounter.monsters];
      if (entry.action!.refId.toLowerCase() === 'the cult of the dragon' && this.dungeonLevel >= 5) {
        ids.push('young_white_dragon_monster');
      }
      const templates = ids.map(id => getMonsterTemplate(id)).filter((t): t is NonNullable<typeof t> => Boolean(t));
      this.spawnEncounter(templates);
    } else {
      for (const member of this.party.alive) {
        this.hud.addCombatMessage(member.heal(rollDice(2, 8)), '#8cf');
      }
    }
  }

  private manifestShrine(entry: CompendiumEntry): void {
    const alignment = entry.subtitle.split('|')[0].trim();
    const evil = /evil/i.test(alignment);
    const good = /good/i.test(alignment);
    const benevolent = good || (!evil && Math.random() < 0.5);

    if (benevolent) {
      this.proclaim(`A quiet shrine to ${entry.name} unfolds from the stonework, radiating calm.`);
      for (const member of this.party.alive) {
        if (member.conditions.length > 0) member.conditions = [];
        this.hud.addCombatMessage(member.heal(rollDice(2, 8)), '#8cf');
      }
    } else {
      this.proclaim(`A dark altar to ${entry.name} heaves up from the floor \u2014 and its guardians wake.`);
      const guards = ['zombie', 'skeleton'];
      if (this.dungeonLevel >= 4) guards.push('wight');
      const templates = guards.map(id => getMonsterTemplate(id)).filter((t): t is NonNullable<typeof t> => Boolean(t));
      this.spawnEncounter(templates);
    }
  }

  proclaim(message: string): void {
    this.hud.addCombatMessage(`\ud83d\udcd6 ${message}`, '#c9b8ff');
  }

  /** Spawn conjured monsters near the party; joins an ongoing battle seamlessly. */
  spawnEncounter(templates: MonsterTemplate[]): void {
    if (this.mode !== GameMode.Dungeon) {
      this.hud.addCombatMessage('The summoning needs the threshold of a dungeon — the surface world refuses it.', '#886');
      return;
    }
    const leader = this.party.leader;
    const room = this.rooms.find(r =>
      leader.tile.x >= r.x && leader.tile.x < r.x + r.width &&
      leader.tile.y >= r.y && leader.tile.y < r.y + r.height
    ) || this.rooms[0];
    if (!room) return;

    const spawned: Monster[] = [];
    for (const template of templates) {
      const pos = findEmptyTile(this.map, room, this.monsters);
      if (!pos) break;
      const monster = this.spawnMonster(template, pos);
      monster.alertLevel = 2;
      spawned.push(monster);
    }
    if (spawned.length === 0) {
      this.hud.addCombatMessage('No space remains for them to appear.', '#888');
      return;
    }

    if (this.phase !== GamePhase.Exploration) {
      for (const monster of spawned) {
        this.combatEngine.monsters.push(monster);
        this.combatEngine.initiativeOrder.push(monster);
      }
      this.hud.addCombatMessage('\u2694\ufe0f They crash into the ongoing battle!', '#c84');
    }
  }

  // ── DM command panel ────────────────────────────

  /** Browsable expedition codex — 'journal', 'journal moon', 'journal 2', etc. */
  journalCodex(raw: string): void {
    const text = raw.toLowerCase();
    // Optional page: a trailing number or the word "page N".
    let page = 1;
    const pageMatch = text.replace(/journal/, '').match(/(?:page)?[^0-9]*(\d{1,3})\s*$/);
    if (pageMatch) page = Math.max(1, parseInt(pageMatch[1], 10));

    // Pick a filter from the inquired theme, defaulting to everything.
    const has = (re: RegExp) => re.test(text);
    const mood = (words: string[]) => (line: string) => words.some(w => line.toLowerCase().includes(w));
    let include: (line: string) => boolean = () => true;
    if (has(/moon|hunt|pack|were|lycanthrope|forge|silver/) && !has(/all/)) include = mood(['moon','hunt','pack','were','lycanthrope','forge','silver']);
    else if (has(/poi|ruins|landmark|place|shrine|tower|camp|grove|mine|tomb/)) include = mood(['ruins','shrine','tower','camp','grove','mine','tomb','battlefield']);
    else if (has(/quest|job|bounty/)) include = mood(['quest','bounty']);
    else if (has(/loot|treasure|gold|coin|gem|vault|cache/)) include = mood(['loot','treasure','gold','coin','gem','vault','cache']);
    else if (has(/combat|victory|defeat|ambush|slay|kill|cleared/)) include = mood(['ambush','slay','defeat','victory','cleared','battle']);
    else if (has(/spell|scroll|magic|arcane|learned/)) include = mood(['spell','scroll','magic','arcane','learned']);

    const all = [...this.storyController.journalLines().map(l => `Tale: ${l}`), ...this.expeditionJournal].filter(include);
    // Whether a theme actually narrowed the listing. This used to be written as
    // `include !== (() => true)`, comparing a function against a freshly made
    // arrow, which is never equal — so every listing claimed to be filtered.
    const filtered = all.length !== this.expeditionJournal.length;
    if (all.length === 0) {
      this.hud.addCombatMessage('The journal has nothing matching that inquiry.', '#886');
      return;
    }
    const perPage = 14;
    const maxPage = Math.max(1, Math.ceil(all.length / perPage));
    page = Math.min(page, maxPage);
    const entries = [...all].reverse().slice((page - 1) * perPage, page * perPage);
    const rangeStart = (page - 1) * perPage + 1;
    const rangeEnd = (page - 1) * perPage + entries.length;
    this.hud.addCombatMessage(`📖 ${all.length} deed${all.length === 1 ? '' : 's'}${filtered ? ' matched' : ''} — showing ${rangeStart}–${rangeEnd} (page ${page}/${maxPage}).`, '#ffd700');
    for (const line of entries) this.hud.addCombatMessage(`  • ${line}`, '#9aa');
    if (page < maxPage) this.hud.addCombatMessage(`  … “journal page ${page + 1}” for the next page.`, '#666');
  }

  /** The slice of live state the DM understanders may consult. */
  private dmContext(): DMContext {
    return {
      featureKind: this.currentRoom()?.feature?.kind ?? null,
      inCombat: this.phase !== GamePhase.Exploration,
      mode: this.mode === GameMode.Dungeon ? 'dungeon' : this.mode === GameMode.Town ? 'town' : 'overworld',
    };
  }

  /** The trained intent model, once loaded and enabled (null = regex only). */
  public intentPredictor: IntentPredictor | null = null;
  /** Echo which understander handled each order (toggled with "model status"). */
  private dmModelDebug: boolean = false;

  private handleDMCommand(raw: string): void {
    const text = raw.trim();
    if (!text) return;
    this.hud.addCombatMessage(`\u276f ${text}`, '#6fd');
    sfx.order();
    // A riddle door listens first: the right word opens it before any order is parsed.
    if (this.pendingRiddle && answersRiddle(this.pendingRiddle.riddle, text)) {
      this.solveRiddle('dm');
      return;
    }
    // "narrate: ..." adds a line to the log as the world itself.
    const narrated = /^(?:narrate|narration|the world|say)\s*[:\-]\s*(.+)$/i.exec(text);
    if (narrated) {
      this.hud.addCombatMessage(`\ud83d\udcdc ${narrated[1].trim()}`, '#d8c88a');
      this.expeditionJournal.push(`The DM: ${narrated[1].trim()}`);
      return;
    }
    // "note: ..." goes in the DM's notebook, shown in the Chronicle.
    const noted = /^(?:note|notebook|remember)\s*[:\-]\s*(.+)$/i.exec(text);
    if (noted) {
      this.notes.push(noted[1].trim());
      if (this.notes.length > 50) this.notes.shift();
      this.hud.addCombatMessage(`\ud83d\udcd3 Noted: ${noted[1].trim()}`, '#8cf');
      return;
    }
    if (/^(?:notes|notebook)$/i.test(text)) { this.hud.showChronicle(); return; }
    // "export": the run as text, on the clipboard.
    if (/^(?:export|share)(?: the)?(?: run| chronicle| story)?$/i.test(text)) {
      const body = exportRun({
        partyName: this.party.partyName,
        members: this.party.members.map(m => `${m.name}, level ${m.level} ${m.race.name} ${m.charClass.name}`),
        day: Math.floor(this.clock.elapsed / DAY_MS) + 1,
        acts: this.storyController.chronicle().acts,
        roads: this.personalQuests.map(q => `${q.memberName}: ${q.title}${q.done ? ' (done)' : ''}`),
        deeds: this.expeditionJournal,
        notes: this.notes,
        fallen: this.fallen.map(f => `${f.name}, ${f.className} ${f.level}, fell ${f.where} on day ${f.day}`),
        titles: this.achievements.map(id => achievementById(id)?.title ?? id),
        numbers: summarizeRun(this),
      });
      void navigator.clipboard?.writeText(body).then(
        () => this.hud.addCombatMessage('\ud83d\udccb The run is on the clipboard, as text: paste it anywhere.', '#8cf'),
        () => { this.hud.addCombatMessage('The clipboard refused. The chronicle follows in the log instead.', '#886'); for (const line of body.split('\n').slice(0, 80)) this.hud.addCombatMessage(line || ' ', '#9aa'); },
      );
      this.hud.showStoryCard({ kicker: 'The run, as text', title: this.party.partyName, body: body.split('\n').slice(0, 14).join('\n').replace(/\n\n+/g, '\n\n') + '\n\n(the whole of it is on the clipboard)' }, () => {}, { seconds: 20 });
      return;
    }
    // "hold Ana" / "release Ana": a member waits, weapon ready, until told otherwise.
    const holdOrder = /^(?:hold|wait),?\s+(\w+)$/i.exec(text);
    const releaseOrder = /^(?:release|loose|unhold),?\s+(\w+)$/i.exec(text);
    if (holdOrder || releaseOrder) {
      const who = (holdOrder ?? releaseOrder)![1].toLowerCase();
      const all = who === 'all' || who === 'everyone' || who === 'party';
      const members = all ? this.party.members : this.party.members.filter(m => m.name.toLowerCase().split(' ')[0] === who || m.name.toLowerCase() === who);
      if (members.length === 0) { this.hud.addCombatMessage(`No one in the party answers to "${who}".`, '#886'); return; }
      for (const m of members) { if (holdOrder) this.combatEngine.held.add(m.id); else this.combatEngine.held.delete(m.id); }
      this.hud.addCombatMessage(holdOrder
        ? `\u23f8 ${members.map(m => m.name).join(', ')} will hold and wait for the word.`
        : `\u25b6 ${members.map(m => m.name).join(', ')} may act again.`, '#8cf');
      return;
    }
    // "dice bone": the tray's material. "photo": the map alone.
    const diceOrder = /^dice\s+(classic|bone|brass|obsidian)$/i.exec(text);
    if (diceOrder) { setDiceTheme(diceOrder[1].toLowerCase() as DiceTheme); this.hud.addCombatMessage(`\ud83c\udfb2 The dice are ${diceOrder[1].toLowerCase()} now.`, '#8cf'); return; }
    if (/^(?:photo|photo mode|screenshot mode)$/i.test(text)) { this.hud.enterPhotoMode(); return; }
    // "set a trap" / "caltrops": the next fight in this room opens on the party's terms.
    if (/^(?:set (?:a )?trap|caltrops|tripwire|lay (?:a )?trap)$/i.test(text)) { this.setPartyTrap(); return; }
    // "new game plus": a finished tale reseeds, harder, with the party as it stands.
    if (/^new game plus$/i.test(text)) {
      if (!this.story?.complete) { this.hud.addCombatMessage('The tale is not told yet. New Game Plus waits for the die to be made whole.', '#886'); return; }
      this.storyController.beginNewRun();
      if (this.story) this.story.difficultyShift += 2;
      this.tally('ngplus');
      this.hud.addCombatMessage(`\u2726 The die shatters again, and the party \u2014 ${this.party.partyName}, with every title it earned \u2014 hears the first rumour of a new tale. Harder this time.`, '#ffd700');
      this.storyController.afterStart();
      return;
    }
    // "map": the world as seen. "claim the ruins": a base. "track": where the beast is.
    if (/^(?:map|world map|show (?:the )?map)$/i.test(text)) { this.hud.showWorldMap(); return; }
    if (/^claim(?: the)? (?:ruins?|keep|tower)$/i.test(text)) { this.claimRuins(); return; }
    if (/^track(?:(?: the)? (?:beast|roamer|it))?$/i.test(text)) { this.trackRoamer(); return; }
    // "new name": the party takes a name from the generator.
    if (/^(?:new|another|fresh) (?:party )?name$/i.test(text)) {
      this.party.partyName = randomPartyName();
      this.hud.addCombatMessage(`\u2726 From here they are ${this.party.partyName}.`, '#ffd700');
      this.hud.setDungeonTitle(`${this.party.partyName} \u2014 ${this.mode === GameMode.Town ? (this.currentTown?.name ?? 'town') : this.mode === GameMode.Dungeon ? this.dungeonName : 'the road'}`);
      this.hud.setParty(this.party);
      return;
    }
    // "stats": the run in numbers.
    if (/^(?:stats|statistics|numbers|the numbers)$/i.test(text)) {
      this.hud.showStatistics();
      return;
    }
    // Standing orders: "never pay tolls", "always parley", "loot everything".
    const policy = parsePolicyOrder(text);
    if (policy) {
      this.dmPolicies = { ...this.dmPolicies, ...policy.change };
      this.hud.addCombatMessage(`\ud83d\udccc ${policy.line}`, '#8cf');
      return;
    }
    const result = understand(text, this.dmContext(), this.intentPredictor);
    if (this.dmModelDebug && result.source !== 'none') {
      const p = result.prob !== undefined ? ` ${result.prob.toFixed(2)}` : '';
      this.hud.addCombatMessage(`   (${result.source}: ${result.cmd.intent}${p})`, '#555');
    }
    this.dispatchDMCommand(result.cmd, text);
  }

  /** Every typed order, once understood, is acted on here. */
  private readonly dmCommands = new DMCommandDispatcher(this);

  private dispatchDMCommand(cmd: DMCommand, text: string): void {
    this.dmCommands.dispatch(cmd, text);
  }

  /**
   * Speak to a quest giver: their line, whatever they have posted, and how
   * they rate the party. Shared by the "talk to" order and by clicking their
   * row in the town panel, which looked clickable and did nothing because
   * `onVisitNPC` was declared, dispatched, and never assigned.
   */
  greetQuestGiver(npc: QuestGiver): void {
    this.hud.addCombatMessage(`${npc.portrait} ${npc.name} — ${npc.title}:`, '#ca8');
    // Show quest-specific dialogue if this NPC has posted quests
    const npcQuests = this.quests.filter(q => q.giverNpcId === npc.id && !q.turnedIn);
    if (npcQuests.length > 0) {
      const quest = npcQuests[0];
      this.hud.addCombatMessage(`   "${getQuestDialogue(npc, quest.kind)}"`, '#a89');
      this.hud.addCombatMessage(`   [${quest.title} — ${quest.completed ? '✔ Ready to report' : 'In progress'}]`, '#8cf');
    } else {
      this.hud.addCombatMessage(`   "${getDialogue(npc)}"`, '#a89');
    }
    this.hud.addCombatMessage(`   [Reputation: ${getReputationTier(npc)}]`, '#888');
  }

  /** The loaded weights, kept so "model on" can re-arm without re-fetching. */
  public loadedIntentModel: IntentModel | null = null;

  /**
   * Hand the game its trained understander. Called once at start-up; the
   * player's stored preference decides whether it is armed.
   */
  public attachIntentModel(model: IntentModel | null): void {
    this.loadedIntentModel = model;
    const on = model !== null && intentModelEnabled();
    this.intentPredictor = on ? model : null;
    this.hud.setModelChip(model === null ? 'regex' : on ? 'model' : 'off');
  }

  /** "model on / off / status" — arm, disarm, or describe the intent model. */
  handleModelToggle(state: 'on' | 'off' | 'status'): void {
    if (state === 'status') {
      this.dmModelDebug = !this.dmModelDebug;
      if (!this.loadedIntentModel) {
        this.hud.addCombatMessage('DM orders are read by the regex parser — the trained model did not load.', '#8cf');
      } else {
        const m = this.loadedIntentModel;
        this.hud.addCombatMessage(
          `DM intent model v${m.version}: ${this.intentPredictor ? 'on' : 'off'} — ${m.intents.length} intents, ` +
          `${m.buckets} buckets, accepts at ${(m.threshold * 100).toFixed(0)}% confidence.`,
          '#8cf'
        );
      }
      this.hud.addCombatMessage(`Understander echo ${this.dmModelDebug ? 'on' : 'off'}.`, '#888');
      return;
    }

    const want = state === 'on';
    if (want && !this.loadedIntentModel) {
      this.hud.addCombatMessage('The trained model did not load — orders stay with the regex parser.', '#c88');
      return;
    }
    setIntentModelEnabled(want);
    this.intentPredictor = want ? this.loadedIntentModel : null;
    this.hud.setModelChip(want ? 'model' : 'off');
    this.hud.addCombatMessage(
      want
        ? 'The party listens more closely — free-form orders go through the trained model.'
        : 'The party goes by the book — only the written orders are understood.',
      '#8cf'
    );
  }

}

// ── Utility ──────────────────────────────────────────

function findEmptyTile(map: TileMap, room: Room, monsters: Monster[]): Vector2 | null {
  const occupied = new Set(monsters.map(m => `${m.tile.x},${m.tile.y}`));

  for (let attempt = 0; attempt < 20; attempt++) {
    const x = room.x + 1 + Math.floor(Math.random() * (room.width - 2));
    const y = room.y + 1 + Math.floor(Math.random() * (room.height - 2));
    if (map.isWalkable(x, y) && !occupied.has(`${x},${y}`)) {
      return { x, y };
    }
  }
  return null;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Startup ──────────────────────────────────────────

/**
 * What the desktop shell puts on the window before the game's first script
 * runs (see electron/preload.cjs). Its absence is how a plain browser is told
 * apart from the app.
 */
interface FatefallShell {
  app: boolean;
  version: string;
  platform: string;
  update: { status: 'current' | 'available' | 'unknown'; latest?: string; url?: string | null; notes?: string; reason?: string };
  openUpdate: () => void;
}

function shell(): FatefallShell | null {
  const s = (window as unknown as { fatefall?: FatefallShell }).fatefall;
  return s && s.app ? s : null;
}

/**
 * Fatefall is a desktop game. A production build that finds itself in a plain
 * browser stops here and says so, in place of the title screen. The dev
 * server is exempt, since that is where the game is worked on, and so is a
 * local preview asked for with ?debug.
 */
function refuseBrowser(): void {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  box.id = 'desktop-only';
  box.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:14px', 'background:radial-gradient(ellipse at 50% 30%, #2a1e14 0%, #14100c 60%, #0b0d12 100%)',
    "font-family:Georgia,'Palatino Linotype',serif", 'color:#ddd5c4', 'text-align:center', 'padding:24px',
  ].join(';');
  box.innerHTML = `
    <svg width="96" height="96" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <polygon points="16,2 29,9 29,23 16,30 3,23 3,9" fill="#8c2b2b" stroke="#e8c46a" stroke-width="2" stroke-linejoin="round"/>
      <polygon points="16,9 23,20 9,20" fill="#c4483f" stroke="#e8c46a" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>
    <div style="font-family:'Palatino Linotype','Book Antiqua',Palatino,Georgia,serif;font-size:32px;letter-spacing:0.22em;color:#e8c56a;">FATEFALL</div>
    <div style="font-style:italic;color:#968e7e;max-width:460px;line-height:1.5;">
      Fatefall is a desktop game and does not run in a browser.<br>
      Install or open the Fatefall app to play.
    </div>`;
  document.body.appendChild(box);
}

function startGame() {
  const env = (import.meta as { env?: { DEV?: boolean } }).env;
  // A built copy served from this machine with ?debug is the other exemption:
  // that is how the game is inspected without the dev server's reloads. A
  // player with the installer never has a local server to point at.
  const inspecting = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
    && new URLSearchParams(location.search).has('debug');
  if (!env?.DEV && !inspecting && !shell()) {
    refuseBrowser();
    return;
  }
  const game = new Game();
  // A handle for driving the game from the console. Dev builds always have
  // it; a production build only when asked for with ?debug, since a global
  // that reaches every piece of state is not something to ship by default.
  // `import.meta.env` is Vite's, and the tests project compiles this file too,
  // so it is read through a local shape rather than Vite's ambient types.
  if (env?.DEV || new URLSearchParams(location.search).has('debug')) {
    (window as any).__game = game;
    (window as any).__audio = getAudio();
  }

  // The player picks a slot: continue a saved run there or begin a new one.
  const saves = listSaves();
  game.hud.onStartChoice = (choice, slot) => game.handleStartChoice(choice, slot);
  game.hud.onMainMenu = () => game.returnToMainMenu();
  game.hud.worldMapProvider = () => {
    const ow = game.overworld;
    if (!ow || game.mode === GameMode.Dungeon) return null;
    const active = game.quests.find(q => q.id === game.activeQuestId);
    const target = active ? ow.entrances.find(e => e.id === active.entranceId) : undefined;
    return {
      width: ow.map.width, height: ow.map.height,
      tile: (x, y) => ow.map.getTile(x, y),
      explored: (x, y) => ow.map.explored[y]?.[x] ?? false,
      towns: ow.towns.map(t => ({ name: t.name, x: t.tile.x, y: t.tile.y, capital: t.id === ow.spawnTownId })),
      entrances: ow.entrances.map(e => ({ name: e.name, x: e.tile.x, y: e.tile.y })),
      pois: game.pois.filter(p => p.discovered).map(p => ({ name: p.name, x: p.tile.x, y: p.tile.y, cleared: p.cleared })),
      party: { x: game.party.leader.tile.x, y: game.party.leader.tile.y },
      target: target ? { name: target.name, x: target.tile.x, y: target.tile.y } : null,
      roamer: game.roamer ? { name: game.roamer.name, x: game.roamer.x, y: game.roamer.y } : null,
      base: game.base ? { x: game.base.x, y: game.base.y } : null,
    };
  };
  game.hud.statisticsProvider = () => ({
    kills: game.history.kills,
    victories: game.history.victories,
    defeats: game.history.defeats,
    rooms: game.history.roomsVisited,
    deepest: game.history.deepestLevel,
    gold: game.partyGold(),
    days: Math.floor(game.clock.elapsed / DAY_MS) + 1,
    ledger: game.history.killLedger,
    levels: game.party.members.map(m => `${m.name} Lv${m.level}`),
  });
  game.hud.chronicleProvider = () => ({
    notes: game.notes.slice(-12).reverse(),
    titles: game.achievements.map(id => achievementById(id)?.epithet ?? id),
    ...game.storyController.chronicle(),
    roads: game.personalQuests.map(q => `${q.memberName} \u2014 ${q.title.toLowerCase()}${q.done ? `, done: now ${q.memberName} ${q.perk.title}` : q.kind === 'pilgrimage' ? ` (${q.progress}/${q.target} towns)` : ''}`),
    orders: describePolicies(game.dmPolicies),
    deeds: game.expeditionJournal.slice(-12).reverse(),
  });
  game.hud.onRendererChange = (id) => {
    void game.useBackend(id).catch(err => {
      console.warn('[render] backend switch failed, staying put.', err);
      game.hud.addCombatMessage('That renderer could not start here; staying on the current one.', '#c66');
    });
  };
  game.hud.showStartScreen(saves);

  const app = shell();
  if (app?.update.status === 'available') {
    game.hud.addCombatMessage(
      `⬆ Fatefall ${app.update.latest} is available (you have ${app.version}). Open the download page from the Sound drawer.`,
      '#e8b45a',
    );
    game.hud.updateAvailable = { version: app.update.latest ?? '', open: () => app.openUpdate() };
  }

  // The title theme waits for the first touch, since the browser will not
  // let a page make a sound before one. By then the player may already be
  // starting a run, in which case the game's own step takes the music over
  // on its next tick and the theme is a two-second overture.
  const titleTheme = () => {
    if (!game.runStarted) getMusic().play('title');
    window.removeEventListener('pointerdown', titleTheme);
    window.removeEventListener('keydown', titleTheme);
  };
  window.addEventListener('pointerdown', titleTheme, { once: true });
  window.addEventListener('keydown', titleTheme, { once: true });

  // Bring the renderer up before the first frame. A backend that fails to
  // start is not fatal: the game falls back to the canvas it has always used.
  void game.useBackend(pickBackend()).catch(err => {
    console.warn('[render] backend failed to start, staying on canvas.', err);
  });

  // The DM intent model loads alongside the start screen, so it is ready long
  // before the first order. A failure here is not fatal: the regex parser
  // understands every documented order on its own.
  game.hud.setModelChip('loading');
  void loadIntentModel().then(model => game.attachIntentModel(model));

  // Persist when the tab hides or closes (only once a run has actually begun).
  window.addEventListener('beforeunload', () => { if (game.runStarted) game.saveGame(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (game.runStarted) game.saveGame();
      return;
    }
    // Coming back into view. The world pauses while hidden, and in a window
    // that is visible but never painted there is no animation frame to wake
    // it, so the loop is nudged explicitly rather than left waiting.
    game.resumeLoop();
  });
}

/**
 * Which renderer to use.
 *
 * Pixi is the default because it is the only one that lights the scene: the
 * map renderer paints the same tiles at noon and at midnight, and everything
 * that makes a dungeon feel like a dungeon is composited on top of it there.
 * Canvas 2D remains the fallback, taken automatically whenever WebGL is
 * missing or Pixi fails to start, and choosable outright for a comparison.
 */
function pickBackend(): RenderBackendId {
  try {
    const stored = localStorage.getItem('fatefall.renderer');
    if (stored === 'pixi' || stored === 'phaser' || stored === 'canvas') return stored;
  } catch {
    /* private mode: fall through to the default */
  }
  return 'pixi';
}

/**
 * What a blow looked like, from how the log describes it.
 *
 * The party's spells reach the screen the same way their damage does — through
 * the text — so the flash is chosen from the words the narration already uses.
 * Anything unrecognised is a weapon, which is the common case and the right
 * default: a sword hit gets a spark rather than nothing.
 */
/** The element a damage line carries, for the colour of its number, or null for plain steel. */
function damageTint(line: string): FloaterKind | null {
  if (/fire|flame|burn|scorch|ember|searing|inferno/i.test(line)) return 'fire';
  if (/cold|frost|ice|freez|chill|rime/i.test(line)) return 'cold';
  if (/lightning|shock|thunder|electric|storm/i.test(line)) return 'shock';
  if (/radiant|holy|sacred|smite|sunlight/i.test(line)) return 'radiant';
  if (/necrotic|drain|wither|grave/i.test(line)) return 'necrotic';
  if (/poison|venom|acid|toxic/i.test(line)) return 'poison';
  if (/magic missile|arcane|eldritch|force|psychic|witch bolt/i.test(line)) return 'arcane';
  return null;
}

/** The sound of the element, when the line has one the strike sound would not cover. */
function elementSound(line: string): void {
  const t = damageTint(line);
  if (t === 'cold') sfx.cold();
  else if (t === 'radiant') sfx.radiant();
  else if (t === 'necrotic') sfx.necrotic();
  else if (t === 'poison') sfx.poison();
}

function effectFor(line: string): EffectKind {
  if (/fire|flame|burn|scorch|ember|searing|inferno/i.test(line)) return 'fire';
  if (/lightning|shock|thunder|electric|storm|arc/i.test(line)) return 'shock';
  if (/magic missile|arcane|eldritch|force|psychic|necrotic|radiant|witch bolt/i.test(line)) return 'arcane';
  return 'strike';
}

/**
 * The number written straight after `marker` in a log line, or null.
 *
 * Used to lift damage and healing out of the combat log for the floating
 * numbers. Substring-and-digits rather than a regex, because creature names
 * are data and would have to be escaped before they could be a pattern.
 */
function amountAfter(line: string, marker: string): string | null {
  const at = line.indexOf(marker);
  if (at < 0) return null;
  const digits = /^\d+/.exec(line.slice(at + marker.length));
  return digits ? digits[0] : null;
}

/** Parse '2d4+2' style healing dice out of an item description. */
function parseHealDice(description: string): { count: number; size: number; bonus: number } {
  const m = description.match(/(\d+)d(\d+)(?:\+(\d+))?/);
  return m
    ? { count: Number(m[1]), size: Number(m[2]), bonus: Number(m[3] || 0) }
    : { count: 1, size: 4, bonus: 0 };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startGame);
} else {
  startGame();
}

/** The run's headline numbers, for the text export. */
function summarizeRun(g: Game): string[] {
  const d = getDiceStats();
  return [
    `${g.history.kills} foes slain, ${g.history.victories} fights won, ${g.history.defeats} lost`,
    `${g.history.roomsVisited} rooms seen, deepest floor ${g.history.deepestLevel}`,
    `${d.rolls} dice rolled: ${d.crits} natural 20s, ${d.fumbles} natural 1s`,
    `${g.partyGold()} gold in hand`,
  ];
}

/** The four tiles around one. */
function dirsAround(t: Vector2): Vector2[] {
  return [{ x: t.x + 1, y: t.y }, { x: t.x - 1, y: t.y }, { x: t.x, y: t.y + 1 }, { x: t.x, y: t.y - 1 }];
}

/** A pair's key, whichever way round. */
function bondKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Parts worth keeping from a body, by what it was. Roughly two in five bodies yield one. */
function monsterParts(slain: Monster[]): InventoryItem[] {
  const out: InventoryItem[] = [];
  const by: Record<string, [string, string]> = {
    beast: ['Hide', 'a hide, scraped and rolled'], dragon: ['Scale', 'a scale the size of a plate'], undead: ['Grave Dust', 'a pinch of what it was'],
    fiend: ['Horn', 'a horn, still warm'], giant: ['Tooth', 'a tooth like a spearhead'], monstrosity: ['Fang', 'a fang as long as a finger'],
    ooze: ['Gland', 'a gland, kept in a jar'], construct: ['Cog', 'a cog with no rust on it'], fey: ['Wing', 'a wing that weighs nothing'],
    plant: ['Root', 'a root that twitches'], elemental: ['Mote', 'a mote that will not go out'], aberration: ['Eye', 'an eye that does not close'],
    insect: ['Chitin', 'a plate of chitin'], arachnid: ['Silk', 'a skein of silk'], reptile: ['Scale', 'a scale'], dinosaur: ['Claw', 'a claw'],
    fungus: ['Spore Cap', 'a cap, dried'], crystal: ['Shard', 'a shard that hums'], automaton: ['Cog', 'a cog'], vampire: ['Fang', 'a fang'],
  };
  for (const m of slain) {
    if (m.fled || Math.random() > 0.4) continue;
    const [part, desc] = by[m.template.type] ?? ['Trophy', 'a piece of it'];
    const base = m.template.name.replace(/^\ud83d\udc80 /, '').replace(/ \(Boss\)$/, '');
    out.push({ id: `part_${m.template.id}_${Math.random().toString(36).slice(2, 7)}`, name: `${base} ${part}`, type: 'treasure', description: `From a ${base}: ${desc}. An artisan can make something of three such.`, value: 8 + Math.round(m.template.cr * 6) });
  }
  return out;
}

/** The counting-house ledger lives outside any save, so a lost party's gold outlives it. */
function readBank(): number {
  try { return Math.max(0, parseInt(localStorage.getItem('fatefall.bank') ?? '0', 10) || 0); } catch { return 0; }
}
function setBank(n: number): void {
  try { localStorage.setItem('fatefall.bank', String(Math.max(0, Math.round(n)))); } catch { /* no storage, no bank */ }
}

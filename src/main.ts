import { Renderer } from './engine/Renderer';
import { Camera } from './engine/Camera';
import { TileMap } from './world/TileMap';
import { generateDungeon, hashSeed, Room } from './world/DungeonGenerator';
import { assignFeature, assignFeaturesToRooms, RoomFeature } from './world/RoomFeatures';
import { DMCommand, DMContext, DMIntent, FEATURE_INTENT_KIND } from './ai/DMCommand';
import { understand, IntentPredictor } from './ai/DMCommandParser';
import { Overworld, OverworldEntrance, OverworldTown, entranceAt, generateOverworld, getEntranceById, getTownById, nearestWalkable, ringOverworld, townAt } from './world/Overworld';
import { OverworldPOI, createMoonForgePOI, discoverNearbyPOIs, poiIcon } from './world/OverworldPOI';
import { WeatherState, rollWeather, tickWeather } from './world/WeatherSystem';
import { ClockState, TimeOfDay, NIGHT_VISIBILITY_LIGHT, createClock, dayChangeNarration, tickClock, timeOfDayFromPhase } from './world/DayNightSystem';
import { CalendarDay, calendarFromElapsed } from './world/CalendarSystem';
import { BIOME_EVENTS, Wanderer, isWildlife, randomTravelEvent, scatterWildlife, spawnOverworldLife, stepWanderers } from './world/OverworldLife';
import { FESTIVAL_FLAVOR, TownLifeState, initTownLife, isCaravanWanderer, sanitizeTownLife, tickTownLife, rollArrivalEvent, eventFor, townPriceModifier, rollTavernBuff, getTavernBuffNarration, refreshBulletinBoard } from './world/TownLife';
import { TOWN_ARCHETYPES, TownServiceId, ReputationShopItem } from './world/TownTypes';
import { Ambush, findAmbushTiles, getAmbushChance, rollAmbush } from './world/Ambushes';
import { Quest, QuestState, checkQuestProgress, generateQuests, questProgressText, questTargetEntrance } from './quests/Quests';
import { QuestGiver, getReputationTier, getDialogue, getQuestDialogue, awardReputation } from './quests/QuestGivers';
import { BanditCampState, BanditClue, rollBanditClue, raidCamp, reportCamp } from './quests/BanditCamps';
import { MARKET_POTIONS, MARKET_SCROLLS } from './loot/LootTables';
import { Party } from './entities/Party';
import { GameCharacter, InventoryItem, EquipSlot, slotForItem, magicBonusOf } from './entities/Character';
import { BulletinTask } from './quests/BulletinBoard';
import { Monster, MonsterTemplate, getMonsterTemplate, getRandomMonster, MONSTER_TEMPLATES, THEME_MONSTERS, isUnseeableMonster } from './entities/Monster';
import { SpriteRenderer } from './entities/Sprites';
import { MapRenderer } from './rendering/MapRenderer';
import { CombatEngine } from './combat/CombatEngine';
import type { PartyCommand } from './combat/CombatEngine';
import type { MenuConsumable } from './ui/BattleView';
import { AIDirector } from './ai/AIDirector';
import { HUD, GameSpeed } from './ui/HUD';
import { createParty, createCharacter } from './game/CharacterFactory';
import { Direction, TILE_SIZE, Vector2, manhattan, vec2 } from './engine/types';
import { TileType } from './world/TileMap';
import { rollDice, abilityModifier, getSpellById, isCaster, ordinal, CLASSES, RACES, SPELLS } from './data/gameData';
import { CompendiumEntry } from './ui/DnDCompendium';
import { CONDITION_META, rollD20, savingThrow } from './rules/Rules';
import { pushDiceRoll, getDiceStats, parseDiceExpr, setDiceFloor } from './rules/DiceEvents';
import { grantLuckDie, getLuckDie, onLuckDieSpent } from './rules/LuckDie';
import { SAVE_VERSION, SaveData, clearSlot, listSaves, loadFromSlot, saveToSlot } from './save/SaveManager';
import { rollCombatLoot, LootSource, LootResult, EMPTY_PURSE } from './loot/LootTables';
import {
  PlacedTrap, getTrapKind, placeTraps, rollDisarm, rollPerception, sweepDetection, triggerTrap,
} from './traps/Traps';

const DM_DIR_NAMES: Record<Direction, string> = { up: 'north', down: 'south', left: 'west', right: 'east' };

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
  getMonsterBestiaryEntry,
  PartyHistory,
} from './ai/LoreGenerator';
import { LOCATIONS, getRandomElement, LocationTemplate, getLocation, MAGIC_ITEMS } from './ai/DnDKnowledge';
import { getLLM } from './ai/LLMService';

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
  public combatEngine: CombatEngine;
  public aiDirector: AIDirector;
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
  public wanderers: Wanderer[] = [];
  public quests: Quest[] = [];
  public activeQuestId: string | null = null;
  public dungeonEntranceId: string | null = null;
  public currentTown: OverworldTown | null = null;
  /** The living pulse of towns: rumors, festivals, caravans (v5+). */
  private townLife: TownLifeState | null = null;
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
  private banditCamps: BanditCampState = { camps: [], clues: [] };
  private entranceBaseName: string = '';
  /** Points of Interest scattered across the overworld. */
  public pois: OverworldPOI[] = [];
  private expeditionJournal: string[] = [];
  private activePOI: OverworldPOI | null = null;
  private weather: WeatherState | null = null;
  /** Persistent day/night clock over the overworld. */
  private clock: ClockState = createClock();
  private lastClockStage: TimeOfDay = 'dawn';
  /** The named calendar day (weekday + moon) derived from the clock. */
  private calendar: CalendarDay = calendarFromElapsed(this.clock.elapsed);
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
  private bossSlainThisFloor: boolean = false;

  /** A running account of what this party has done — feeds room narration. */
  private history: PartyHistory = { kills: 0, victories: 0, defeats: 0, roomsVisited: 0, deepestLevel: 1, killLedger: {} };
  private visitedRooms: Set<number> = new Set();

  private tickTimer: number = 0;
  private tickInterval: number = 800; // ms between AI actions
  private combatTickTimer: number = 0;
  private combatTickInterval: number = 150; // ms between combat steps
  private monsterIdCounter: number = 0;
  private stuckDirCount: number = 0;
  private lastActionDir: string = '';
  private overworldStuckCount: number = 0;
  /** Consecutive ticks the party tried to flee but couldn't move (deadlock breaker). */
  private fleeStuckCount: number = 0;
  /** Rolling recent leader tiles (overworld) for square-loop detection. */
  private overworldRecentTiles: { x: number; y: number }[] = [];
  /** Rolling recent leader tiles (dungeon) for square-loop detection. */
  private dungeonRecentTiles: { x: number; y: number }[] = [];

  // Live DM orders from the command panel
  private dmDirection?: Direction;
  private dmStance: 'auto' | 'aggressive' | 'cautious' = 'auto';

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
    this.mapRenderer = new MapRenderer(this.renderer.ctx, this.sprites);

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
      return this.townLife.byTown[this.currentTown.id]?.bulletinTasks ?? [];
    };
    this.hud.townPanel.onBulletinComplete = this.guard((task) => this.completeBulletinTask(task));

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
      // Boss is 1 level above current dungeon — and answers to the theme.
      const bossCr = Math.min(5, this.dungeonLevel);
      const themeId = this.dungeonTheme?.id;
      const bossTemplates = MONSTER_TEMPLATES.filter(m => m.cr >= bossCr - 0.5 && m.cr <= bossCr + 0.5 && !isUnseeableMonster(m.id));
      const themedBosses = themeId && THEME_MONSTERS[themeId]
        ? bossTemplates.filter(m => THEME_MONSTERS[themeId].includes(m.id))
        : [];
      const bossTemplate = themedBosses.length > 0
        ? themedBosses[Math.floor(Math.random() * themedBosses.length)]
        : bossTemplates.length > 0
          ? bossTemplates[Math.floor(Math.random() * bossTemplates.length)]
          : getRandomMonster(bossCr, themeId);

      const boss = this.spawnMonster(bossTemplate, { x: bossRoom.cx, y: bossRoom.cy });
      boss.maxHp = Math.floor(boss.maxHp * 1.5);
      boss.hp = boss.maxHp;
      boss.template = { ...boss.template, name: `💀 ${boss.template.name} (Boss)`, xp: boss.template.xp * 3 };

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
  private ensureNavigableDungeon(): void {
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
    // Fresh floor — the breadcrumb trail resets.
    this.dungeonRecentTiles = [];
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
    this.rooms = generateDungeon(this.map, 14 + Math.min(6, this.dungeonLevel), 4, 10, this.dungeonSeed());
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
    this.populateDungeonFloor();
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
    }

    this.phase = GamePhase.Exploration;
    this.descending = false; // The new floor is ready — descents may queue again.
    this.hud.addCombatMessage(`Welcome to ${this.dungeonName}!`, '#ffd700');
    // A quest that cares about depth may complete the moment this floor lands.
    this.checkActiveQuestProgress();
    this.hud.addCombatMessage(generateDungeonLore(this.dungeonLevel), '#a8a');
    if (this.dungeonLevel > this.history.deepestLevel) this.history.deepestLevel = this.dungeonLevel;
    // Rumors travel with adventurers
    if (Math.random() < 0.4) {
      this.hud.addCombatMessage(getLLM().tellRumor(this.dungeonName), '#a97');
    }
    this.visitedRooms = this.rooms.length > 0 ? new Set([0]) : new Set();
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

  spawnMonster(template: MonsterTemplate, pos: Vector2): Monster {
    const id = `monster_${++this.monsterIdCounter}`;
    // The party must never fight what it cannot see: if a template is
    // unseeable by nature, fall back to a visible monster of the same CR.
    if (isUnseeableMonster(template.id)) {
      const visible = getRandomMonster(Math.max(0.25, template.cr));
      template = visible ?? template;
    }
    const monster = new Monster(id, template, pos);
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
    if (this.running && this.rafId !== null) return;
    this.lastTimestamp = performance.now();
    this.accumulator = 0;
    this.consecutiveErrors = 0;
    this.errorHalt = false;
    this.running = true;
    this.runStarted = true;
    this.rafId = requestAnimationFrame(this.gameStep);
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
    this.watchdogId = setTimeout(() => {
      this.watchdogId = null;
      if (this.running && document.visibilityState === 'visible') this.gameStep(performance.now());
    }, Game.WATCHDOG_MS);
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

    this.camera.update();

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
        if (this.tickTimer >= this.tickInterval) {
          this.tickTimer = 0;
          this.aiTick();
          // Occasionally the sky you descended under closes in: a howling pack
          // corners the party, shadows pool at a shaft, or a boon finds them.
          this.maybeDungeonMoodEvent();
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
        const available = this.quests.find(q => !q.accepted && !q.turnedIn);
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
    const lootNearby: Vector2[] = []; // Future: treasure chests
    const doorsNearby = this.getNearbyTilesByType(TileType.Door, leader.tile, 2);
    const stairsNearby = this.getNearbyTilesByType(TileType.StairsDown, leader.tile, 1);

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
          this.hud.addCombatMessage(action.message, '#c84');
          this.startCombat(visibleMonsters);
        } else if (action.target) {
          this.hud.addCombatMessage(`${leader.name} holds the party back \u2014 caution was ordered.`, '#886');
        }
        break;
      }
      case 'rest': {
        this.hud.addCombatMessage(action.message, '#8cf');
        // Short rest: heal 1 hit die per member.
        for (const member of this.party.alive) {
          const heal = rollDice(1, member.charClass.hitDie) + member.conMod;
          this.hud.addCombatMessage(member.heal(heal), '#8cf');
        }
        // Tend the fallen: dead allies are revived at 1 HP so the party never
        // pushes deeper with a crippled team.
        for (const member of this.party.members) {
          if (member.isDead) {
            member.revive(1);
            this.hud.addCombatMessage(`${member.name} is tended to and brought back at 1 HP.`, '#f88');
          }
        }
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
      case 'retreat': {
        const rmoved = this.moveParty(action.direction);
        if (rmoved) {
          this.hud.addCombatMessage(action.message, '#c88');
        }
        break;
      }
      case 'idle': {
        // When idle, try to find stairs to descend or doors to explore.
        const idleStairs = this.getNearbyTilesByType(TileType.StairsDown, leader.tile, 10);
        if (idleStairs.length > 0) {
          const s = idleStairs[0];
          const dx = Math.sign(s.x - leader.tile.x);
          const dy = Math.sign(s.y - leader.tile.y);
          const dir = dx === 1 ? Direction.Right : dx === -1 ? Direction.Left : dy === 1 ? Direction.Down : Direction.Up;
          if (this.moveParty(dir)) {
            this.hud.addCombatMessage(`${leader.name} heads for the stairwell...`, '#cc8');
          } else {
            this.hud.addCombatMessage(action.message, '#888');
          }
        } else {
          // Wander a random direction.
          const wanderDir = pick([Direction.Right, Direction.Left, Direction.Up, Direction.Down]);
          if (this.moveParty(wanderDir)) {
            this.hud.addCombatMessage(`${leader.name} wanders onward, searching for a way forward...`, '#888');
          } else {
            this.hud.addCombatMessage(action.message, '#888');
          }
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
      case 'heal':
      case 'regroup':
      case 'loot': {
        this.hud.addCombatMessage(action.message, '#a86');
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
      this.history.roomsVisited = this.visitedRooms.size;
      this.hud.addCombatMessage(this.describeCurrentRoom(), '#8aa');
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
  private syncKnownFoes(): void {
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
    this.combatEngine.defenseBonus = 0;
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
    // FF command menu: Manual mode pauses every hero's turn until the DM
    // picks; Auto lets the AI resolve. The toggle lives in the battle window.
    this.combatEngine.decisionPause = this.hud.battleView.getMode() === 'manual';
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
    this.phase = GamePhase.Combat;
    this.combatTickTimer = 0;
    this.refreshBossBar();
    // Bring up the Final-Fantasy-style battle window for the fight.
    // Its in-window speed control rescales the combat tick directly.
    this.hud.battleView.onSpeedChange = (speed) => { this.combatTickInterval = 150 / speed; };
    this.hud.battleView.syncSpeedFromInterval(this.combatTickInterval);
    this.hud.battleView.open(this.party, this.combatEngine.monsters, this.sprites);
    this.hud.battleView.update({
      round: this.combatEngine.log.round,
      actors: this.combatEngine.initiativeOrder,
      currentActorId: this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex]?.id ?? null,
      messages: ['⚔️ A battle begins!'],
    });

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
          this.hud.battleView.showCommandMenu(decider, this.combatEngine.getDecisionSpells(decider), this.buildMenuConsumables());
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

  private updateCombat() {
    // FF command menu: when a hero awaits the DM's order, hold the tick
    // clock — the fight literally waits for the menu pick, then resumes.
    if (this.combatEngine.decisionActor) return;
    if (this.combatTickTimer >= this.combatTickInterval) {
      this.combatTickTimer = 0;

      const log = this.combatEngine.step();
      this.hud.addCombatLogBatch(log);
      this.hud.setParty(this.party);
      this.refreshBossBar();
      // Keep the FF-style battle window in sync with each combat tick.
      this.hud.battleView.update({
        round: this.combatEngine.log.round,
        actors: this.combatEngine.initiativeOrder,
        currentActorId: this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex]?.id ?? null,
        messages: log.messages,
        over: log.isOver,
        winner: log.winner,
      });

      // FF command menu: the engine paused on a conscious hero's turn —
      // surface the Attack/Spell/Item/Flee menu and wait for the DM.
      const decider = this.combatEngine.decisionActor;
      if (decider) {
        this.hud.battleView.showCommandMenu(
          decider,
          this.combatEngine.getDecisionSpells(decider),
          this.buildMenuConsumables(),
        );
      }

      if (log.isOver) {
        // Combat over — make sure the menu can't linger over the aftermath.
        this.combatEngine.decisionPause = false;
        this.hud.battleView.hideCommandMenu();
        if (log.winner === 'party') {
          // Remove dead monsters — but keep their stats for the loot roll first.
          const slainMonsters = this.monsters.filter(m => !m.isAlive);
          this.history.kills += slainMonsters.length;
          this.history.victories++;
          this.monsters = this.monsters.filter(m => m.isAlive);

          // Bestiary ledger — tally per monster kind and sing out first-time kills.
          const firstKills: string[] = [];
          for (const m of slainMonsters) {
            const prev = this.history.killLedger[m.template.id] ?? 0;
            this.history.killLedger[m.template.id] = prev + 1;
            if (prev === 0) firstKills.push(m.template.id);
            if (m.template.name.includes('(Boss)')) this.bossSlainThisFloor = true;
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
          const loot = this.rollAndGrantLoot(slainMonsters);
          // Victory fanfare + loot summary panel over the battle window.
          const xpEach = Math.ceil(slainMonsters.reduce((s, m) => s + m.template.xp, 0) / Math.max(1, this.party.alive.length));
          const kindOf = (i: InventoryItem): 'magic' | 'potion' | 'scroll' | 'treasure' | 'other' =>
            i.type === 'potion' ? 'potion' : i.type === 'scroll' ? 'scroll' : i.type === 'treasure' ? 'treasure' : 'other';
          const tally = new Map<string, number>();
          for (const m of slainMonsters) tally.set(m.template.name, (tally.get(m.template.name) ?? 0) + 1);
          this.hud.battleView.showSpoils({
            xpEach,
            gold: loot.goldValue,
            items: loot.items.map(i => ({ name: i.name, kind: kindOf(i) })),
            kills: Array.from(tally.entries()).map(([name, count]) => ({ name, count })),
            boss: slainMonsters.some(m => /boss/i.test(m.template.name) || m.isBoss),
          });
          // A full-moon hunt leaves trophies the smith will pay or forge for.
          const packSlain = slainMonsters.filter(m => m.moonPack);
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
            this.hud.addCombatMessage(`${poiIcon(this.activePOI.kind)} ${this.activePOI.name} has been cleared!`, '#8f8');
            this.expeditionJournal.push(`Cleared ${this.activePOI.name}`);
            this.activePOI = null;
          }
        } else {
          // Party overwhelmed — a harrowing retreat, not a free resurrection.
          this.history.defeats++;
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

  private render() {
    this.renderer.clear();
    const moveMs = Math.max(140, Math.min(600, this.tickInterval * 0.55));
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
        this.weather?.type ?? null,
        this.clock.light
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
  }

  // ── Helpers ─────────────────────────────────────

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
    this.combatTickInterval = 150 / speed;
  }

  /**
   * FF command menu: run one full combat tick while the command menu is open.
   * Returns true if a hero's turn is now paused awaiting a decision.
   */
  private stepCombatOnce(): boolean {
    const log = this.combatEngine.step();
    this.hud.addCombatLogBatch(log);
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

  private togglePause() {
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
  private describeOverworldHere(): string {
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
  private currentRoom(): Room | undefined {
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
  private describeCurrentRoom(): string {
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
  private static readonly FEATURE_HINT: Record<RoomFeature['kind'], string> = {
    altar: 'pray at the altar',
    vault: 'search the vault',
    prison: 'free the prisoners',
    chokepoint: 'barricade the chokepoint',
    forge: 'use the forge',
    library: 'read the tomes',
    fountain: 'drink from the fountain',
    sarcophagus: 'open the sarcophagus',
    throne: 'approach the throne',
    trapped_corridor: 'disarm the traps',
    treasure_room: 'search the treasure room',
    merchant_camp: 'talk to the merchant',
    puzzle_room: 'solve the puzzle',
    ritual_chamber: 'examine the ritual circle',
    war_room: 'study the war table',
  };

  /**
   * Act on a room-feature intent for the room the party stands in. Returns
   * true when the feature consumed the order (even a "nothing left" one),
   * false when the room has no such feature.
   */
  private performFeatureIntent(intent: DMIntent): boolean {
    const say = (line: string, color = '#ca8') => this.hud.addCombatMessage(line, color);
    const feature = this.currentRoom()?.feature;

    if (intent === 'search_room') {
      if (feature) return false;
      say('The room holds nothing of note \u2014 only stone, dust, and silence.', '#888');
      return true;
    }
    if (!feature) return false;
    const f = feature;

    if (intent === 'feature_inspect') {
      // Generic search narrates the feature without spending it.
      this.hud.addCombatMessage(
        f.used ? f.inspect : `${f.inspect} Try \u201c${Game.FEATURE_HINT[f.kind]}\u201d.`,
        '#8aa'
      );
      return true;
    }
    if (FEATURE_INTENT_KIND[intent] !== f.kind) return false;

    switch (intent) {
      case 'feature_altar': return this.featureAltar(f, say);
      case 'feature_vault': return this.featureVault(f, say);
      case 'feature_prison': return this.featurePrison(f, say);
      case 'feature_chokepoint': return this.featureChokepoint(f, say);
      case 'feature_forge': return this.featureForge(f, say);
      case 'feature_library': return this.featureLibrary(f, say);
      case 'feature_fountain': return this.featureFountain(f, say);
      case 'feature_sarcophagus': return this.featureSarcophagus(f, say);
      case 'feature_throne': return this.featureThrone(f, say);
      case 'feature_trapped_search':
        say('The corridor is rigged with traps! Use \"search for traps\" to detect them safely.', '#c66');
        return true;
      case 'feature_trapped_disarm':
        say('The traps are complex — use \"disarm trap\" after detecting them.', '#8a8');
        return true;
      case 'feature_treasure': {
        if (f.used) { say('The treasure room has already been looted.', '#888'); return true; }
        f.used = true;
        const goldFound = 20 + Math.floor(Math.random() * 80);
        this.addGold(goldFound);
        say('You search the treasure room and find ' + goldFound + ' gp in scattered coins and gems!', '#ffd700');
        // Chance for a magic item
        if (Math.random() < 0.25) {
          const items = ['Potion of Healing', 'Scroll of Fireball', 'Scroll of Shield', 'Antidote'];
          const item = items[Math.floor(Math.random() * items.length)];
          this.party.leader.inventory.push({
            id: 'treasure_' + Date.now(), name: item, type: 'potion',
            value: 30, description: 'Found in a treasure room.',
          });
          say('Among the coins you find a ' + item + '!', '#8cf');
        }
        return true;
      }
      case 'feature_merchant_talk': {
        if (f.used) { say('The merchant has packed up and left.', '#888'); return true; }
        say('The weary merchant looks up. \"I have potions, scrolls, and odds and ends. Take a look at the town shops — they have better prices.\"', '#a89');
        say('Tip: Buy something from the merchant for a discount? He sells Healing Potions for 20 gp and Scrolls for 30 gp.', '#8cf');
        return true;
      }
      case 'feature_merchant_rob': {
        if (f.used) { say('The merchant already fled.', '#888'); return true; }
        f.used = true;
        say('You attack the merchant! He screams and drops his goods before fleeing.', '#c44');
        const haul = 15 + Math.floor(Math.random() * 30);
        this.addGold(haul);
        say('Loot: ' + haul + ' gp from his abandoned cart.', '#ffd700');
        // Lose reputation
        if (this.currentTown && this.townLife) {
          const tl = this.townLife.byTown[this.currentTown.id];
          if (tl) tl.townReputation = Math.max(0, tl.townReputation - 5);
          say('Your reputation with the town drops.', '#c66');
        }
        return true;
      }
      case 'feature_puzzle': {
        if (f.used) { say('The puzzle has already been solved.', '#888'); return true; }
        f.used = true;
        const solved = Math.random() < 0.6; // 60% success chance
        if (solved) {
          say('You study the puzzle carefully and align the pieces correctly. A hidden door slides open!', '#ffd700');
          const bonus = 30 + Math.floor(Math.random() * 50);
          this.addGold(bonus);
          say('Behind the door: a cache with ' + bonus + ' gp!', '#8cf');
        } else {
          const coin = 5 + Math.floor(Math.random() * 10);
          say('You attempt the puzzle but fail. The mechanism locks — but you spot a ' + coin + ' gp coin that fell out.', '#a89');
          this.addGold(coin);
        }
        return true;
      }
      case 'feature_ritual': {
        if (f.used) { say('The ritual chamber has already been used.', '#888'); return true; }
        f.used = true;
        const blessing = Math.random();
        if (blessing < 0.5) {
          // Restore some HP
          for (const m of this.party.members) {
            const heal = 5 + Math.floor(Math.random() * 15);
            m.hp = Math.min(m.maxHp, m.hp + heal);
          }
          say('The ritual chamber bathes the party in warm light. Each member recovers 5-20 HP.', '#8cf');
        } else if (blessing < 0.8) {
          // Restore a spell slot
          say('Arcane energy flows through the chamber. The casters feel their magic renewed.', '#a8f');
          for (const m of this.party.members) {
            if (m.charClass.id === 'wizard' || m.charClass.id === 'cleric' || m.charClass.id === 'sorcerer' || m.charClass.id === 'warlock') {
              // Add a spell slot (simplified: just note it)
              say(m.name + ' feels a spell slot restored.', '#a8f');
            }
          }
        } else {
          // Bonus XP
          const xp = 20 + Math.floor(Math.random() * 40);
          for (const m of this.party.members) m.xp += xp;
          say('Ancient knowledge floods your mind. Each member gains ' + xp + ' XP.', '#ffd700');
        }
        return true;
      }
      case 'feature_war_room': {
        if (f.used) { say('You have already studied the war room thoroughly.', '#888'); return true; }
        f.used = true;
        // Reveals info about the dungeon
        say('The maps reveal hidden passages and monster patrol routes. You gain tactical advantage.', '#8cf');
        // Bonus: +2 to next attack rolls
        say('Your party gains +2 to attack rolls for the next battle (tactical knowledge).', '#a89');
        // Small gold find
        const gold = 10 + Math.floor(Math.random() * 25);
        this.addGold(gold);
        say('Hidden in a map case: ' + gold + ' gp.', '#ffd700');
        return true;
      }
    }
    return false;
  }

  private featureAltar(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say(`The ${f.name} is spent \u2014 the candle gutters out.`, '#888'); return true; }
    f.used = true;
    const deity = this.party.leader.deity;
    const heal = rollDice(1, 4) + 2;
    let healed = 0;
    for (const m of this.party.members) {
      if (!m.isDead && m.hp > 0 && m.hp < m.maxHp) { m.heal(heal); healed++; }
    }
    say(deity
      ? `\u2726 ${deity} accepts the offering! ${healed ? `${healed} wounded ${healed === 1 ? 'companion is' : 'companions are'} mended (+${heal} HP).` : 'The blessing settles over the party, unneeded.'}`
      : `\u2726 Something answers the prayer \u2014 ${healed ? `${healed} of the party feel their wounds close (+${heal} HP).` : 'a presence passes through and the air grows warm.'}`);
    return true;
  }

  private featureVault(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The vault has been picked clean.', '#888'); return true; }
    f.used = true;
    const searcher = this.bestScout();
    const dc = 12 + Math.floor(this.dungeonLevel / 2);
    if (rollD20() + searcher.wisMod >= dc) {
      const gp = rollDice(2, 6) * this.dungeonLevel;
      this.party.leader.gold += gp;
      let extra = '';
      if (Math.random() < 0.4) {
        const gems = ['a chip of azurite', 'a banded agate', 'a fire-red garnet', 'a perfect pearl', 'a star sapphire', 'a flawless ruby'];
        const gem = gems[Math.floor(Math.random() * gems.length)];
        const value = rollDice(1, 6) * 100;
        this.party.leader.addToInventory({
          id: `gem_${Math.floor(Math.random() * 1e6)}`,
          name: gem.charAt(0).toUpperCase() + gem.slice(1),
          type: 'treasure',
          description: `A gem worth ${value} gp.`,
          value,
        });
        extra = ` Among the coins: ${gem} worth ${value} gp.`;
      }
      say(`\ud83d\udcb0 ${searcher.name} cracks the vault! ${gp} gp recovered.${extra}`, '#ffd700');
    } else {
      const dmg = rollDice(1, 4);
      searcher.takeDamage(dmg);
      say(`\u2620 A dart whips out of the lock \u2014 ${searcher.name} takes ${dmg} damage wrenching clear.`, '#c66');
    }
    return true;
  }

  private featurePrison(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The cells are empty \u2014 whoever was here is long gone.', '#888'); return true; }
    f.used = true;
    const gp = rollDice(2, 6) * this.dungeonLevel;
    this.party.leader.gold += gp;
    say(`\u26d1 ${this.bestScout().name} works the lock on the deepest cell and finds a prisoner \u2014 a gaunt scribe who presses ${gp} gp into their hands and whispers of what waits on the next floor.`, '#8cf');
    return true;
  }

  private featureChokepoint(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.barricaded) { say('The gap is already braced \u2014 nothing gets through that line easily.', '#888'); return true; }
    f.barricaded = true;
    say('\u2694 The party braces the chokepoint with fallen timber. Foes who come through here will fight at a disadvantage (+1 AC while this room is held).', '#8a8');
    return true;
  }

  private featureForge(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The forge is cold \u2014 nothing left to work here.', '#888'); return true; }
    f.used = true;
    const leader = this.party.leader;
    leader.bonusAttackBonus += 1;
    say(`\u2699 ${leader.name} hones a blade at the anvil \u2014 a keen edge gleams. ${leader.name}\u2019s attack bonus is now +${leader.attackBonus}.`, '#fd8');
    return true;
  }

  private featureLibrary(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The tomes have been read \u2014 the shelves hold only rot now.', '#888'); return true; }
    f.used = true;
    const scholar = this.bestScout();
    if (rollD20() + scholar.intMod >= 14) {
      const cantrips = SPELLS.filter(s => s.level <= 0);
      const learner = this.party.members.find(m => isCaster(m.charClass.id) && cantrips.some(c => !m.knownSpells.includes(c.id)));
      if (learner) {
        const spell = cantrips.find(c => !learner.knownSpells.includes(c.id))!;
        learner.knownSpells.push(spell.id);
        say(`\ud83d\udcda ${scholar.name} deciphers a diagram \u2014 ${learner.name} commits ${spell.name} to memory!`, '#8cf');
      } else {
        for (const m of this.party.members) if (!m.isDead) m.addXp(50);
        say('\ud83d\udcda The diagrams are dense but rewarding \u2014 the party lingers, sharpening their understanding (+50 XP each).', '#8cf');
      }
    } else {
      say(`\ud83d\udcda The script resists ${scholar.name}\u2019s translation \u2014 only fragments of meaning surface.`, '#888');
    }
    return true;
  }

  private featureFountain(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The fountain is dry \u2014 its basin holds only a film of dust.', '#888'); return true; }
    f.used = true;
    const drinker = this.party.members.find(m => !m.isDead && m.hp < m.maxHp) ?? this.party.leader;
    if (Math.random() < 0.5) {
      const heal = rollDice(2, 4) + 2;
      drinker.heal(heal);
      say(`\ud83d\udca7 ${drinker.name} drinks deep \u2014 cool water washes through them (+${heal} HP).`, '#4c4');
    } else {
      const dmg = rollDice(1, 6);
      drinker.takeDamage(dmg);
      if (drinker.makeSavingThrow('con', 10).success) {
        say(`\u2620 The water turns brackish! ${drinker.name} gags but shakes off the worst (${dmg} damage).`, '#c66');
      } else {
        drinker.applyCondition('poisoned', 2, 'Foul fountain');
        say(`\u2620 The water is poisoned! ${drinker.name} fails a CON save, takes ${dmg} damage, and is poisoned for 2 turns.`, '#c66');
      }
    }
    return true;
  }

  private featureSarcophagus(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The lid lies askew \u2014 nothing left to disturb.', '#888'); return true; }
    f.used = true;
    const roll = rollD20();
    const opener = this.bestScout();
    if (roll <= 4) {
      const dmg = rollDice(1, 6);
      opener.takeDamage(dmg);
      const saved = opener.makeSavingThrow('con', 11).success;
      if (!saved) opener.applyCondition('poisoned', 2, 'Tomb gas');
      say(`\u2620 Foul gas hisses from the seal! ${opener.name} takes ${dmg} damage${saved ? '' : ' and is poisoned (2 turns)'}.`, '#c66');
    } else if (roll <= 14) {
      const gp = rollDice(2, 6) * this.dungeonLevel;
      this.party.leader.gold += gp;
      say(`\ud83d\udc8e ${opener.name} eases the lid aside \u2014 grave goods! ${gp} gp recovered.`, '#ffd700');
    } else if (roll <= 19) {
      say(`\ud83d\udcdc The tomb holds only dust and a name in an unknown alphabet \u2014 but a cold draft seems to whisper \u201cleave\u201d.`, '#9aa');
    } else {
      const spirit = getMonsterTemplate('wight') ?? getRandomMonster(3);
      say(`\u2620 The lid SHATTERS outward \u2014 the occupant was never resting! A ${spirit.name} claws free of the tomb!`, '#c44');
      this.spawnEncounter([spirit]);
    }
    return true;
  }

  private featureThrone(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The throne holds nothing new \u2014 the crown is long gone.', '#888'); return true; }
    f.used = true;
    const gp = rollDice(1, 6) * this.dungeonLevel;
    this.party.leader.gold += gp;
    say(`\ud83d\udc51 ${this.party.leader.name} approaches the throne \u2014 loose coins spill from the cushions (${gp} gp). The seat is cold, but for a moment it feels\u2026 heavy.`, '#ffd700');
    return true;
  }

  // ── Traps & hazards ────────────────────────────

  /** Passive detection: mark nearby undetected traps the party can notice. */
  private sweepTraps(): string[] {
    if (this.traps.length === 0) return [];
    return sweepDetection(this.traps, this.party.members, this.party.leader.tile, 2);
  }

  /** Best member for trap work: a rogue if possible, else highest dexterity. */
  private bestDisarmer(): GameCharacter {
    const alive = this.party.alive;
    if (alive.length === 0) return this.party.leader;
    const rogues = alive.filter(m => m.charClass.id === 'rogue');
    const pool = rogues.length > 0 ? rogues : alive;
    return pool.reduce((best, m) => (m.dexMod > best.dexMod ? m : best), pool[0]);
  }

  /** Best scout for active searches: rogues/rangers, else highest wisdom. */
  private bestScout(): GameCharacter {
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
  private checkTrapDisarm(maxDist: number = 1): boolean {
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

  private toSaveData(): SaveData {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      mode: this.mode,
      dungeonLevel: this.dungeonLevel,
      dungeonName: this.dungeonName,
      dungeonThemeId: this.dungeonTheme?.id ?? undefined,
      history: { ...this.history },
      luckDie: getLuckDie(),
      phase: this.phase,
      quests: this.quests.map(q => ({ ...q })),
      activeQuestId: this.activeQuestId,
      dungeonEntranceId: this.dungeonEntranceId,
      partyName: this.party.partyName,
      silveredWeapon: this.silveredWeapon,
      moonForgeLevel: this.moonForgeLevel,
      moonForgeBlade: this.moonForgeBlade,
      overworld: this.overworld ? {
        width: this.overworld.map.width,
        height: this.overworld.map.height,
        tiles: this.overworld.map.tiles,
        explored: this.overworld.map.explored,
        towns: this.overworld.towns,
        entrances: this.overworld.entrances,
        spawnTownId: this.overworld.spawnTownId,
      } : null,
      wanderers: this.wanderers.map(w => ({ ...w, tile: { ...w.tile }, target: { ...w.target } })),
      townLife: this.townLife,
      banditCamps: this.banditCamps,
      pois: this.pois.map(p => ({ ...p, tile: { ...p.tile } })),
      expeditionJournal: this.expeditionJournal,
      weather: this.weather ?? undefined,
      clockPhase: this.clock.phase,
      clockElapsed: this.clock.elapsed,
      monsterIdCounter: this.monsterIdCounter,
      dmStance: this.dmStance,
      dmDirection: this.dmDirection ?? null,
      speed: 800 / this.tickInterval,
      camera: {
        x: this.camera.x,
        y: this.camera.y,
        targetX: this.camera.targetX,
        targetY: this.camera.targetY,
      },
      map: {
        width: this.map.width,
        height: this.map.height,
        tiles: this.map.tiles,
        explored: this.map.explored,
      },
      rooms: this.mode === GameMode.Dungeon ? this.rooms : [],
      traps: this.traps.map(t => ({ ...t, tile: { ...t.tile } })),
      party: {
        leaderIndex: this.party.leaderIndex,
        formation: this.party.formation,
        members: this.party.members.map(m => ({
          id: m.id,
          name: m.name,
          classId: m.charClass.id,
          raceId: m.race.id,
          abilities: m.abilities,
          level: m.level,
          xp: m.xp,
          hp: m.hp,
          maxHp: m.maxHp,
          ac: m.ac,
          speed: m.speed,
          tile: m.tile,
          direction: m.direction,
          inventory: m.inventory,
          gold: m.gold,
          isDead: m.isDead,
          stabilized: m.stabilized,
          deathSaveSuccesses: m.deathSaveSuccesses,
          deathSaveFailures: m.deathSaveFailures,
          exhaustion: m.exhaustion,
          baseMaxHp: m.baseMaxHp,
          conditions: m.conditions,
          concentration: m.concentration ?? null,
          maxHitDice: m.maxHitDice,
          hitDiceRemaining: m.hitDiceRemaining,
          maxSpellSlots: m.maxSpellSlots,
          spellSlots: m.spellSlots,
          knownSpells: m.knownSpells,
          pendingConcentrationBreak: m.pendingConcentrationBreak,
          bonusAttackBonus: m.bonusAttackBonus,
          equipment: m.equipment,
          personality: m.personality,
          subclass: m.subclass,
          deity: m.deity,
          background: m.background,
          alignment: m.alignment,
        })),
      },
      monsters: this.monsters.map(m => ({
        id: m.id,
        templateId: m.template.id,
        tile: m.tile,
        hp: m.hp,
        maxHp: m.maxHp,
        isAlive: m.isAlive,
        alertLevel: m.alertLevel,
        patrolPoints: m.patrolPoints,
        patrolIndex: m.patrolIndex,
        conditions: m.conditions,
      })),
      combat: this.phase === GamePhase.Combat && this.combatEngine.isActive
        ? {
            isActive: true,
            currentTurnIndex: this.combatEngine.currentTurnIndex,
            partyBlessRounds: this.combatEngine.partyBlessRounds,
            blessSourceId: this.combatEngine.blessSourceId,
            initiative: this.combatEngine.initiativeOrder.map(e =>
              e instanceof GameCharacter
                ? { kind: 'char' as const, id: e.id }
                : { kind: 'monster' as const, id: e.id }
            ),
            legendary: Object.fromEntries(
              this.combatEngine.getBosses().map(b => [b.id, b.legendaryActions])
            ),
          }
        : null,
    };
  }

  /** Apply a saved snapshot to this running game, in place. */
  restore(save: SaveData) {
    // v4+: the overworld, quests, and mode. Older saves stay in their dungeon
    // (the surface world is generated lazily the first time they climb out).
    this.overworld = null;
    this.wanderers = [];
    this.quests = [];
    this.activeQuestId = null;
    this.dungeonEntranceId = save.dungeonEntranceId ?? null;
    this.party.partyName = save.partyName ?? 'The Unnamed Party';
    this.currentTown = null;
    this.townLife = null;
    this.banditCamps = save.banditCamps ?? { camps: [], clues: [] };
    this.pois = (save.pois ?? []).map(p => ({ ...p, tile: { ...p.tile } }));
    this.expeditionJournal = save.expeditionJournal ?? [];
    this.weather = (save as any).weather ?? null;
    this.silveredWeapon = (save as any).silveredWeapon ?? false;
    this.moonForgeLevel = (save as any).moonForgeLevel ?? 0;
    this.moonForgeBlade = (save as any).moonForgeBlade ?? false;
    if (typeof (save as any).clockPhase === 'number') {
      this.clock = { ...createClock(), phase: (save as any).clockPhase, elapsed: (save as any).clockElapsed ?? (save as any).clockPhase * 180_000, timeOfDay: timeOfDayFromPhase((save as any).clockPhase), light: 0.5 - 0.55 * Math.cos((save as any).clockPhase * Math.PI * 2) };
    } else {
      this.clock = createClock();
    }
    this.lastClockStage = this.clock.timeOfDay;
    if (save.overworld) {
      const owMap = new TileMap(save.overworld.width, save.overworld.height);
      owMap.tiles = save.overworld.tiles;
      owMap.explored = save.overworld.explored;
      this.overworld = {
        map: owMap,
        towns: save.overworld.towns,
        entrances: save.overworld.entrances,
        spawnTownId: save.overworld.spawnTownId,
        pois: this.pois,
      };
      this.map = owMap;
      // Old saves predate the mountain ring at the world's edge — apply it so
      // a restored party can't march into the void.
      ringOverworld(this.map);
      this.camera.setBounds(this.map.width, this.map.height);
      // In-flight caravans don't survive a save (their wanderers would linger
      // as ghosts) — town rumors and festival clocks do.
      this.wanderers = (save.wanderers ?? [])
        .filter(w => !isCaravanWanderer(w))
        .map(w => ({ ...w, tile: { ...w.tile }, target: { ...w.target }, recent: w.recent ?? [] }));
      this.townLife = sanitizeTownLife(save.townLife ?? undefined, this.overworld);
      this.quests = (save.quests ?? []).map(q => ({ ...q }));
      this.activeQuestId = save.activeQuestId ?? null;
      this.mode = (save.mode as GameMode) ?? GameMode.Overworld;
      const giver = this.quests[0] ? getTownById(this.overworld, this.quests[0].giverTownId) : undefined;
      this.currentTown = giver ?? getTownById(this.overworld, this.overworld.spawnTownId) ?? null;
    } else {
      this.mode = GameMode.Dungeon;

      // Map (dungeon saves only — the overworld map above wins otherwise)
      const map = new TileMap(save.map.width, save.map.height);
      map.tiles = save.map.tiles;
      map.explored = save.map.explored;
      this.map = map;
      this.camera.setBounds(this.map.width, this.map.height);
    }

    // Dungeon / world state
    this.rooms = save.rooms;
    // Old saves predate room features — give their rooms features too.
    for (const room of this.rooms) {
      if (!room.feature) assignFeature(room, save.dungeonLevel ?? 1, { force: true });
    }
    this.traps = (save.traps ?? []).map(t => ({ ...t, tile: { ...t.tile } }));
    this.dungeonLevel = save.dungeonLevel;
    this.dungeonName = save.dungeonName;
    this.dungeonTheme = save.dungeonThemeId
      ? (getLocation(save.dungeonThemeId) ?? getRandomElement(LOCATIONS))
      : getRandomElement(LOCATIONS);
    this.history = save.history
      ? { ...save.history, killLedger: save.history.killLedger ?? {} }
      : { kills: 0, victories: 0, defeats: 0, roomsVisited: 0, deepestLevel: this.dungeonLevel, killLedger: {} };
    this.syncKnownFoes();
    grantLuckDie(save.luckDie ?? null);
    setDiceFloor(this.dungeonLevel);
    this.phase = save.phase;
    this.monsterIdCounter = save.monsterIdCounter;
    this.dmStance = save.dmStance;
    this.dmDirection = save.dmDirection ?? undefined;
    this.paused = false;
    this.clearErrorHalt();

    // Party (mutated in place so engine/AI references stay valid)
    this.party.members.length = 0;
    this.party.leaderIndex = save.party.leaderIndex;
    // Rebuild the formation from the saved tiles so the leader anchors at
    // (0,0) — pre-fix saves stored leader-shifted offsets that broke movement.
    const savedLeaderTile = save.party.members[0]?.tile ?? { x: 0, y: 0 };
    this.party.formation = save.party.members.map((s) => ({
      x: s.tile.x - savedLeaderTile.x,
      y: s.tile.y - savedLeaderTile.y,
    }));
    this.party.formation[0] = { x: 0, y: 0 };
    for (const s of save.party.members) {
      const charClass = CLASSES.find(c => c.id === s.classId) || CLASSES[0];
      const race = RACES.find(r => r.id === s.raceId) || RACES[0];
      const char = new GameCharacter(s.id, s.name, charClass, race, s.abilities);
      char.level = s.level;
      char.xp = s.xp;
      char.hp = s.hp;
      char.ac = s.ac;
      char.speed = s.speed;
      char.bonusAttackBonus = s.bonusAttackBonus ?? 0;
      char.equipment = {
        weapon: s.equipment?.weapon ? { ...s.equipment.weapon } : undefined,
        armor: s.equipment?.armor ? { ...s.equipment.armor } : undefined,
        shield: s.equipment?.shield ? { ...s.equipment.shield } : undefined,
        trinket: s.equipment?.trinket ? { ...s.equipment.trinket } : undefined,
      };
      char.recomputeAC();
      char.tile = { ...s.tile };
      char.direction = s.direction as 'down' | 'left' | 'right' | 'up';
      char.inventory = s.inventory.map(i => ({ ...i }));
      char.gold = s.gold;
      char.isDead = s.isDead;
      char.stabilized = s.stabilized;
      char.deathSaveSuccesses = s.deathSaveSuccesses;
      char.deathSaveFailures = s.deathSaveFailures;
      char.exhaustion = s.exhaustion;
      char.baseMaxHp = s.baseMaxHp;
      char.conditions = s.conditions.map(c => ({ ...c }));
      char.concentration = s.concentration ?? undefined;
      char.maxHitDice = s.maxHitDice;
      char.hitDiceRemaining = s.hitDiceRemaining;
      char.maxSpellSlots = { ...s.maxSpellSlots } as Record<number, number>;
      char.spellSlots = { ...s.spellSlots } as Record<number, number>;
      char.knownSpells = [...s.knownSpells];
      char.pendingConcentrationBreak = s.pendingConcentrationBreak;
      char.personality = { ...s.personality };
      char.subclass = s.subclass;
      char.deity = s.deity;
      char.background = s.background;
      char.alignment = s.alignment;
      this.party.members.push(char);
    }

    // Monsters
    this.monsters = [];
    for (const s of save.monsters) {
      const template = getMonsterTemplate(s.templateId);
      if (!template) continue;
      const monster = new Monster(s.id, template, s.tile);
      monster.hp = s.hp;
      monster.maxHp = s.maxHp;
      monster.isAlive = s.isAlive;
      monster.alertLevel = s.alertLevel;
      monster.patrolPoints = s.patrolPoints.map(p => ({ ...p }));
      monster.patrolIndex = s.patrolIndex;
      // Never restore an invisible monster — the party must always be able
      // to see what it fights.
      monster.conditions = s.conditions
        .map(c => ({ ...c }))
        .filter(c => c.id !== 'invisible');
      this.monsters.push(monster);
    }

    // Combat engine
    this.combatEngine.monsters = this.monsters;
    this.combatEngine.isActive = false;
    this.combatEngine.log = { round: 0, messages: [], isOver: false, winner: null };
    this.combatEngine.initiativeOrder = [];
    this.combatEngine.currentTurnIndex = 0;
    this.combatEngine.partyBlessRounds = 0;
    this.combatEngine.blessSourceId = '';
    if (save.combat && save.combat.isActive && this.phase === GamePhase.Combat) {
      this.combatEngine.isActive = true;
      this.combatEngine.currentTurnIndex = save.combat.currentTurnIndex;
      this.combatEngine.partyBlessRounds = save.combat.partyBlessRounds;
      this.combatEngine.blessSourceId = save.combat.blessSourceId;
      if (save.combat.legendary) {
        for (const [id, actions] of Object.entries(save.combat.legendary)) {
          const monster = this.monsters.find(m => m.id === id);
          if (monster) monster.legendaryActions = actions;
        }
      }
      for (const entry of save.combat.initiative) {
        if (entry.kind === 'char') {
          const member = this.party.members.find(m => m.id === entry.id);
          if (member) this.combatEngine.initiativeOrder.push(member);
        } else {
          const monster = this.monsters.find(m => m.id === entry.id);
          if (monster) this.combatEngine.initiativeOrder.push(monster);
        }
      }
      // Re-open the battle window for a restored in-combat save.
      this.hud.battleView.onSpeedChange = (speed) => { this.combatTickInterval = 150 / speed; };
      this.hud.battleView.onCommand = this.guard(this.handleBattleCommand);
      this.combatEngine.decisionPause = this.hud.battleView.getMode() === 'manual';
      this.hud.battleView.syncSpeedFromInterval(this.combatTickInterval);
      this.hud.battleView.open(this.party, this.combatEngine.monsters, this.sprites);
      this.hud.battleView.update({
        round: this.combatEngine.log.round,
        actors: this.combatEngine.initiativeOrder,
        currentActorId: this.combatEngine.initiativeOrder[this.combatEngine.currentTurnIndex]?.id ?? null,
        messages: ['⏳ Battle restored.'],
      });
    }

    // If an old save parked the party on the (now impassable) border ring,
    // pull them back onto walkable ground before anything moves.
    if (this.mode === GameMode.Overworld) {
      const l = this.party.leader;
      if (!this.map.isWalkable(l.tile.x, l.tile.y)) {
        const safe = nearestWalkable(this.map, l.tile.x, l.tile.y);
        this.party.setPosition(safe);
      }
    }

    // Camera
    this.camera.x = save.camera.x;
    this.camera.y = save.camera.y;
    this.camera.targetX = save.camera.targetX;
    this.camera.targetY = save.camera.targetY;

    // Speed (derives tick intervals via the HUD hook)
    this.hud.setSpeed(save.speed as GameSpeed);

    // Reset transient timers
    this.tickTimer = 0;
    this.combatTickTimer = 0;
    this.saveTimer = 0;
    this.stuckDirCount = 0;
    this.lastActionDir = '';

    // Saves from before 2-wide corridors trap the formation in the first
    // room — rebuild such floors so continued runs can navigate again.
    this.ensureNavigableDungeon();

    // A dungeon save that somehow lost its layout (rooms empty, or the saved
    // map is the overworld-sized surface rather than a dungeon map) would
    // strand the party in a layoutless void. Regenerate the floor from the
    // fixed-map seed — same layout as the original delve.
    if (this.mode === GameMode.Dungeon && this.rooms.length === 0) {
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

    // Don't re-narrate the room we stand in after a restore.
    const here = this.currentRoomIndex();
    this.visitedRooms = here === -1 ? new Set() : new Set([here]);
    this.history.roomsVisited = Math.max(this.history.roomsVisited, this.visitedRooms.size);

    // HUD
    this.hud.setDungeonLevel(this.dungeonLevel);
    const locationName = this.mode === GameMode.Dungeon ? this.dungeonName : (this.currentTown?.name ?? 'The Wilderlands');
    this.hud.setDungeonTitle(`${this.party.partyName} \u2014 ${locationName}`);
    this.hud.setParty(this.party);
    this.townWaitTimer = 0;
    this.overworldDestination = null;
    this.overworldPath = [];
    // Coming back to a town (or an old save that reaches one) opens the panel.
    if (this.mode === GameMode.Town) this.hud.townPanel.show();
  }

  /**
   * Save the run, close every panel, stop the loop, and show the start
   * screen again — the world freezes behind the menu until a slot is chosen.
   */
  returnToMainMenu(): void {
    this.saveGame();
    this.hud.closeOverlays();
    this.running = false;
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
        this.hud.addCombatMessage(
          `\u23f3 Run restored \u2014 ${saved.dungeonName} (slot ${slot + 1}), saved ${new Date(saved.savedAt).toLocaleString()}.`,
          '#ffd700'
        );
      }
    } else if (choice === 'new') {
      // A brand-new run: fresh party, fresh overworld, empty slot.
      this.startFreshRun();
    }

    this.start();
  }

  /** Rebuild the party from scratch (a brand-new run). */
  private rebuildPartyFromScratch(): void {
    const members = createParty(4);
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

  /** DM "roll <expr>" — parse and roll dice for the party, feeding the dice tray. */
  private rollDiceForParty(expr: string): void {
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

    // Tavern rumor buff: bonus gold find.
    const tavernGoldBonus = this.combatEngine.getTavernGoldFindBonus();
    if (tavernGoldBonus > 0) {
      loot.goldValue += tavernGoldBonus;
      this.hud.addCombatMessage(`Your tavern contacts tip you off to extra loot: +${tavernGoldBonus} gp!`, '#a89');
    }

    for (const line of loot.narration) {
      this.hud.addCombatMessage(line, '#dd0');
    }

    // Split the coin value among the living members.
    const living = this.party.alive;
    if (loot.goldValue > 0 && living.length > 0) {
      const each = Math.floor(loot.goldValue / living.length);
      const remainder = loot.goldValue - each * living.length;
      for (let i = 0; i < living.length; i++) {
        living[i].gold += each + (i === 0 ? remainder : 0);
      }
      this.hud.addCombatMessage(
        `\ud83d\udcb0 ${loot.goldValue} gp in coin split among the party (${each} gp each${remainder > 0 ? `, +${remainder} to ${living[0].name}` : ''}).`,
        '#fd8'
      );
    }

    // Items go to the leader's pack.
    const leader = this.party.leader;
    for (const item of loot.items) {
      leader.addToInventory(item);
      if (item.type === 'treasure') {
        this.hud.addCombatMessage(`${leader.name} stows ${item.name}.`, '#ca8');
      } else {
        this.hud.addCombatMessage(`${leader.name} stows ${item.name}.`, '#a9f');
      }
    }
    if (loot.items.length === 0 && loot.goldValue === 0) {
      this.hud.addCombatMessage('The corpses yield nothing but dust.', '#888');
    }

    // After the haul lands, everyone re-kits: any looted gear that beats
    // what a member currently wears is swapped on and narrated.
    this.autoEquipUpgrades();

    this.hud.setParty(this.party);
    return loot;
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
  private handleLootedItemUse(raw: string): void {
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
    const inCombat = this.phase === GamePhase.Combat && this.combatEngine.isActive;
    const say = (msg: string, color = '#9c6') => this.hud.addCombatMessage(msg, color);

    if (item.type === 'potion') {
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
      } else {
        say(`${target.name} drinks ${item.name}. ${item.description}`);
      }
    } else if (item.type === 'scroll') {
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
  private findItemOwner(nameQuery: string): GameCharacter | null {
    const q = nameQuery.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!q) return null;
    for (const m of this.party.members) {
      if (m.inventory.some(i => i.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(q))) return m;
    }
    return null;
  }

  private mostInjuredMember(): GameCharacter | null {
    const candidates = this.party.members.filter(m => !m.isDead);
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
  }

  /** Wipe the active slot and start over: fresh party, fresh floor 1. */
  private startFreshRun(): void {
    clearSlot(this.activeSlot);
    this.dungeonLevel = 0;
    this.history = { kills: 0, victories: 0, defeats: 0, roomsVisited: 0, deepestLevel: 1, killLedger: {} };
    this.dungeonTheme = null;
    grantLuckDie(null);
    this.rebuildPartyFromScratch();
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

  private activeQuest(): Quest | undefined {
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
    };
  }

  private checkActiveQuestProgress(): void {
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
      Math.round(2 / (this.weather?.moveCostMultiplier ?? 1))
    );
    let moved = 0;
    for (let step = 0; step < paceSteps; step++) {
      if (this.overworldPath.length === 0) {
        this.overworldPath = this.bfsOverworldPath(leader.tile, target);
      }
      if (this.overworldPath.length === 0) break;
      const next = this.overworldPath[this.overworldPath.length - 1];
      const dx = Math.sign(next.x - leader.tile.x);
      const dy = Math.sign(next.y - leader.tile.y);
      const dir = dx === 1 ? Direction.Right : dx === -1 ? Direction.Left : dy === 1 ? Direction.Down : Direction.Up;
      if (this.moveParty(dir)) {
        this.overworldPath.pop();
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
          const next = this.overworldPath[this.overworldPath.length - 1];
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
  private calendarDesc(): string {
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
  private bfsOverworldPath(from: Vector2, to: Vector2): Vector2[] {
    const w = this.map.width;
    const h = this.map.height;
    const prev = new Int32Array(w * h).fill(-1);
    const startIdx = from.y * w + from.x;
    const targetIdx = to.y * w + to.x;
    if (startIdx < 0 || startIdx >= w * h || targetIdx < 0 || targetIdx >= w * h) return [];
    const q: number[] = [startIdx];
    prev[startIdx] = startIdx;
    let head = 0;
    let found = false;
    while (head < q.length) {
      const cur = q[head++];
      if (cur === targetIdx) { found = true; break; }
      const cx = cur % w;
      const cy = (cur / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (prev[ni] !== -1) continue;
        if (!this.map.isWalkable(nx, ny)) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (!found) return [];
    const path: Vector2[] = [];
    let cur = targetIdx;
    let guard = 0;
    while (cur !== startIdx && guard++ < 10000) {
      path.push({ x: cur % w, y: (cur / w) | 0 });
      cur = prev[cur];
    }
    return path;
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
    this.mode = GameMode.Town;
    this.currentTown = town;
    this.overworldDestination = null;
    this.overworldPath = [];
    this.hud.setDungeonTitle(`${this.party.partyName} — ${town.name}`);
    this.hud.addCombatMessage(`The party reaches ${town.name} — ${town.description}.`, '#ffd700');

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
            for (const m of this.party.members) m.xp += evt.effect.value;
            this.hud.addCombatMessage(`⬆️ +${evt.effect.value} XP per member from the event!`, '#8cf');
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
      case 'train_combat': {
        const cost = 50;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        for (const m of this.party.members) { m.xp += 30; }
        this.hud.addCombatMessage(`⚔️ Combat training complete — each member gains 30 XP.`, '#8cf');
        break;
      }
      case 'train_magic': {
        const cost = 75;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        for (const m of this.party.members) { if (m.charClass.id === 'wizard' || m.charClass.id === 'cleric') m.xp += 40; else m.xp += 15; }
        this.hud.addCombatMessage(`📖 Arcane study complete — casters gain 40 XP, others 15 XP.`, '#8cf');
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
        const cost = 15;
        if (this.partyGold() < cost) { this.hud.addCombatMessage('Not enough gold.', '#c66'); return; }
        this.addGold(-cost);
        const roll = Math.floor(Math.random() * 20) + 1;
        if (roll === 20) {
          const winnings = 90;
          this.addGold(winnings);
          this.hud.addCombatMessage('NATURAL 20! The dice gods smile! You win ' + winnings + ' gp!', '#ffd700');
        } else if (roll >= 15) {
          const winnings = 45;
          this.addGold(winnings);
          this.hud.addCombatMessage('A strong roll! You win ' + winnings + ' gp.', '#8cf');
        } else if (roll >= 10) {
          this.hud.addCombatMessage('A push. You break even.', '#8a8');
          this.addGold(cost); // refund
        } else if (roll === 1) {
          this.hud.addCombatMessage('NATURAL 1! The house takes everything... and your boots.', '#c44');
        } else {
          this.hud.addCombatMessage('A poor showing. The house takes your ' + cost + ' gp.', '#c66');
        }
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
      const available = this.quests.find(q => !q.accepted && !q.turnedIn);
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

  private departTown(): void {
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

  private acceptQuest(q: Quest): void {
    if (q.accepted) return;
    q.accepted = true;
    this.activeQuestId = q.id;
    this.hud.addCombatMessage(`📜 The party accepts the posting: ${q.title}`, '#ffd700');
    this.hud.townPanel.refresh();
    // A quest is a reason to leave — the party sets out at once.
    this.departTown();
  }

  private reportQuest(q: Quest): void {
    if (q.turnedIn) return;
    q.turnedIn = true;
    if (this.activeQuestId === q.id) this.activeQuestId = null;
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

  private listQuests(): void {
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

  private enterDungeonFromEntrance(e: OverworldEntrance): void {
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
  private exitDungeonToOverworld(): void {
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

  private partyGold(): number {
    return this.party.members.reduce((s, m) => s + m.gold, 0);
  }

  private addGold(n: number): void {
    this.party.leader.gold += n;
  }

  /** Spend gold across the party, richest first. True if fully paid. */
  private spendGold(n: number): boolean {
    let remaining = n;
    const sorted = [...this.party.members].sort((a, b) => b.gold - a.gold);
    for (const m of sorted) {
      if (remaining <= 0) break;
      const take = Math.min(m.gold, remaining);
      m.gold -= take;
      remaining -= take;
    }
    return remaining <= 0;
  }

  private partyInventory(): InventoryItem[] {
    return this.party.members.flatMap(m => m.inventory);
  }

  private addItemToParty(item: InventoryItem): void {
    this.party.leader.inventory.push({ ...item });
  }

  private marketStock(): InventoryItem[] {
    return [...MARKET_POTIONS, ...MARKET_SCROLLS];
  }

  private buyItem(item: InventoryItem): void {
    if (this.mode !== GameMode.Town) return;
    const baseCost = item.value ?? 0;
    // Apply dynamic pricing from archetype + prosperity + festival + caravan.
    let cost = baseCost;
    if (this.currentTown && this.townLife) {
      const archetype = TOWN_ARCHETYPES[this.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
      const dynamicMod = townPriceModifier(this.townLife, this.currentTown.id, archetype?.priceModifier ?? 1);
      // Market day: goods are abundant and the squares are thronged — 10% off.
      const marketMod = this.calendar.isMarketday ? 0.9 : 1;
      cost = Math.max(1, Math.floor(baseCost * dynamicMod * marketMod));
    }
    if (!this.spendGold(cost)) {
      this.hud.addCombatMessage(`Not enough gold for ${item.name} (${cost} gp).`, '#c66');
      this.hud.townPanel.refresh();
      return;
    }
    // Track prosperity for future discounts.
    if (this.currentTown && this.townLife) {
      this.townLife.byTown[this.currentTown.id].prosperitySpent += cost;
    }
    this.addItemToParty(item);
    this.hud.addCombatMessage(`🛒 ${this.party.leader.name} buys ${item.name} for ${cost} gp.`, '#ffd700');
    this.hud.townPanel.refresh();
  }

  private sellItem(item: InventoryItem): void {
    if (this.mode !== GameMode.Town) return;
    const member = this.party.members.find(m => m.inventory.includes(item));
    if (!member) return;
    let price = Math.floor((item.value ?? 0) / 2);
    // Apply dynamic pricing (sell price also affected).
    if (this.currentTown && this.townLife) {
      const archetype = TOWN_ARCHETYPES[this.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
      const dynamicMod = townPriceModifier(this.townLife, this.currentTown.id, archetype?.priceModifier ?? 1);
      // Market day: buyers are plenty and ready — wares fetch 25% more.
      const marketMod = this.calendar.isMarketday ? 1.25 : 1;
      price = Math.max(1, Math.floor(price * dynamicMod * marketMod));
    }
    member.gold += price;
    member.inventory = member.inventory.filter(i => i !== item);
    this.hud.addCombatMessage(`⚖ ${member.name} sells ${item.name} for ${price} gp.`, '#ca8');
    this.hud.townPanel.refresh();
  }

  private buyRepItem(repItem: ReputationShopItem): void {
    if (this.mode !== GameMode.Town || !this.currentTown || !this.townLife) return;
    const rep = this.townLife.byTown[this.currentTown.id]?.townReputation ?? 0;
    if (rep < repItem.repRequired) {
      this.hud.addCombatMessage(`Reputation too low. Need ${repItem.repRequired}, have ${rep}.`, '#c66');
      this.hud.townPanel.refresh();
      return;
    }
    let cost = repItem.value;
    if (this.currentTown && this.townLife) {
      const archetype = TOWN_ARCHETYPES[this.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
      const dynamicMod = townPriceModifier(this.townLife, this.currentTown.id, archetype?.priceModifier ?? 1);
      cost = Math.max(1, Math.floor(cost * dynamicMod));
    }
    if (!this.spendGold(cost)) {
      this.hud.addCombatMessage(`Not enough gold for ${repItem.name} (${cost} gp).`, '#c66');
      this.hud.townPanel.refresh();
      return;
    }
    const item: InventoryItem = {
      id: `rep_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      name: repItem.name,
      type: repItem.type === 'ring' || repItem.type === 'wondrous' ? 'treasure' : repItem.type as any,
      value: repItem.value,
      description: repItem.description,
      power: repItem.power,
    };
    this.party.leader.inventory.push(item);
    this.hud.addCombatMessage(`${this.party.leader.name} acquires ${repItem.name} from the reputation shop for ${cost} gp!`, '#ffd700');
    this.hud.townPanel.refresh();
  }

  private completeBulletinTask(task: BulletinTask): void {
    if (this.mode !== GameMode.Town) return;
    if (task.completed) {
      this.hud.addCombatMessage('That task is already completed.', '#8a8');
      return;
    }

    switch (task.kind) {
      case 'slay':
      case 'collect':
      case 'escort':
      case 'deliver':
      case 'scout':
        // Auto-complete for now — the party just finished the task
        task.completed = true;
        task.progress = task.targetCount;
        break;
    }

    // Grant rewards
    this.addGold(task.rewardGold);
    for (const m of this.party.members) {
      m.xp += task.rewardXp;
    }
    // Reputation reward
    if (this.currentTown && this.townLife) {
      const tl = this.townLife.byTown[this.currentTown.id];
      if (tl) {
        tl.townReputation = Math.min(100, tl.townReputation + task.repReward);
      }
    }

    this.hud.addCombatMessage(`📋 Task complete: ${task.title}`, '#ffd700');
    this.hud.addCombatMessage(`   +${task.rewardGold} gp, +${task.rewardXp} XP, +${task.repReward} reputation`, '#8cf');
    this.hud.townPanel.refresh();
  }


  private restAtInn(): void {
    if (this.mode !== GameMode.Town) return;
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

  private proclaim(message: string): void {
    this.hud.addCombatMessage(`\ud83d\udcd6 ${message}`, '#c9b8ff');
  }

  /** Spawn conjured monsters near the party; joins an ongoing battle seamlessly. */
  private spawnEncounter(templates: MonsterTemplate[]): void {
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
  private journalCodex(raw: string): void {
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

    const all = this.expeditionJournal.filter(include);
    if (all.length === 0) {
      this.hud.addCombatMessage('The journal has nothing matching that inquiry.', '#886');
      return;
    }
    const perPage = 14;
    const maxPage = Math.max(1, Math.ceil(all.length / perPage));
    page = Math.min(page, maxPage);
    const entries = [...all].reverse().slice((page - 1) * perPage, page * perPage);
    const filtered = include !== (() => true);
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
    const result = understand(text, this.dmContext(), this.intentPredictor);
    if (this.dmModelDebug && result.source !== 'none') {
      const p = result.prob !== undefined ? ` ${result.prob.toFixed(2)}` : '';
      this.hud.addCombatMessage(`   (${result.source}: ${result.cmd.intent}${p})`, '#555');
    }
    this.dispatchDMCommand(result.cmd, text);
  }

  private confusedGlances(): void {
    this.hud.addCombatMessage('The party exchanges confused glances. Type "help" for orders they understand.', '#888');
  }

  /** Act on one understood order. Bodies are the original command handlers, keyed by intent. */
  private dispatchDMCommand(cmd: DMCommand, text: string): void {
    const leader = this.party.leader;
    const inCombat = this.phase !== GamePhase.Exploration;

    switch (cmd.intent) {
      case 'help': {
        for (const line of [
          '\u2022 go / head + north, south, east, west \u2014 march that way',
          '\u2022 attack / charge \u2014 hunt nearby foes   |   flee / cautious \u2014 avoid fights',
          '\u2022 "as you were" \u2014 resume normal exploring',
          '\u2022 rest (short) or camp / long rest   |   descend / deeper \u2014 next floor',
          '\u2022 wait until dawn / night \u2014 bide your time and let the sky turn',
          '\u2022 calendar / what day is it \u2014 the weekday, moon, and today\u2019s festivals',
          '\u2022 journal / chronicle \u2014 read the party\u2019s deeds back',
          '\u2022 summon <monster> e.g. "summon owlbear"   |   report \u2014 party status',
          '\u2022 roll d20 / 2d6+3 / "roll d20 adv" \u2014 roll the dice (d20 banks a fated Luck die)',
          '\u2022 look / examine / describe \u2014 narrate the room around you',
          '\u2022 talk to <npc> / list npcs \u2014 visit townsfolk for quests and gossip',
          '\u2022 raid camp / report camp / list clues \u2014 deal with bandit hideouts',
          '\u2022 pray at the altar / search the vault / free prisoners / barricade \u2014 use the room\u2019s feature',
          '\u2022 search for traps / disarm trap \u2014 find and defuse dungeon hazards',
          '\u2022 loot / inventory / pack \u2014 show what the party is carrying',
          '\u2022 equip <item> / unequip <item> / gear \u2014 manage weapons and armor',
          '\u2022 upcast always / never / auto \u2014 how aggressively casters spend higher slots',
          '\u2022 save \u2014 persist to the active slot | "save to slot 1/2/3" \u2014 pick a slot | "new game" \u2014 wipe it',
          '\u2022 rename party <name> \u2014 give your party a custom name',
          '\u2022 rename <character> to <new name> \u2014 rename a party member',
          '\u2022 model on / off / status \u2014 the DM intent model that reads free-form orders',
          '\u2022 pause / resume',
        ]) this.hud.addCombatMessage(line, '#8a8');
        return;
      }

      case 'model_toggle': {
        this.handleModelToggle(cmd.state);
        return;
      }

      case 'pause': {
        if (!this.paused) this.togglePause();
        this.hud.addCombatMessage('Time holds its breath.', '#8cf');
        return;
      }
      case 'resume': {
        this.dmStance = 'auto';
        this.dmDirection = undefined;
        if (this.paused) this.togglePause();
        this.hud.addCombatMessage('The party resumes exploring at its own judgment.', '#8cf');
        return;
      }

      case 'save': {
        if (cmd.slot) {
          this.activeSlot = cmd.slot - 1;
          this.hud.addCombatMessage(`The party inks the ledger \u2014 future saves go to slot ${this.activeSlot + 1}.`, '#8cf');
        }
        this.saveGame(false);
        return;
      }
      case 'new_game': {
        this.startFreshRun();
        return;
      }

      case 'rename_party': {
        const placeName = this.mode === GameMode.Dungeon
          ? this.dungeonName
          : (this.currentTown?.name ?? 'The Wilderlands');
        if (cmd.name) {
          const chosen = this.party.setName(cmd.name);
          this.hud.addCombatMessage(`\u2726 The party is now known as \u201c${chosen}\u201d.`, '#ffd700');
          this.hud.setDungeonTitle(`${chosen} \u2014 ${placeName}`);
        } else {
          this.party.generateDefaultName();
          this.hud.addCombatMessage(`\u2726 The party is now known as \u201c${this.party.partyName}\u201d.`, '#ffd700');
          this.hud.setDungeonTitle(`${this.party.partyName} \u2014 ${placeName}`);
        }
        this.hud.setParty(this.party);
        return;
      }

      case 'rename_member': {
        if (cmd.oldName) {
          const member = this.party.members.find(m => m.name.toLowerCase() === cmd.oldName.toLowerCase());
          if (member) {
            const cleaned = cmd.newName.replace(/[^a-zA-Z0-9\s'\-]/g, '').trim().slice(0, 30);
            if (cleaned.length > 0) {
              const old = member.name;
              member.name = cleaned;
              this.hud.addCombatMessage(`\u2726 ${old} is now known as \u201c${cleaned}\u201d.`, '#ffd700');
            } else {
              this.hud.addCombatMessage(`\u26a0 The name \u201c${cmd.newName}\u201d is not valid.`, '#c88');
            }
          } else {
            this.hud.addCombatMessage(`\u26a0 No party member named \u201c${cmd.oldName}\u201d found.`, '#c88');
          }
        } else {
          this.hud.addCombatMessage(`\u26a0 Usage: rename <character> to <new name>  (e.g. \u201crename Grom to Gandalf\u201d)`, '#c88');
        }
        this.hud.setParty(this.party);
        return;
      }

      case 'look': {
        this.hud.addCombatMessage(this.mode === GameMode.Dungeon ? this.describeCurrentRoom() : this.describeOverworldHere(), '#8aa');
        return;
      }

      case 'feature_altar': case 'feature_vault': case 'feature_prison': case 'feature_chokepoint':
      case 'feature_forge': case 'feature_library': case 'feature_fountain': case 'feature_sarcophagus':
      case 'feature_throne': case 'feature_trapped_search': case 'feature_trapped_disarm':
      case 'feature_treasure': case 'feature_merchant_talk': case 'feature_merchant_rob':
      case 'feature_puzzle': case 'feature_ritual': case 'feature_war_room':
      case 'feature_inspect': case 'search_room': {
        if (!inCombat && this.performFeatureIntent(cmd.intent)) {
          this.hud.setParty(this.party);
        } else {
          this.confusedGlances();
        }
        return;
      }

      case 'roll': {
        this.rollDiceForParty(cmd.expr);
        return;
      }

      case 'upcast': {
        this.party.upcastPolicy = cmd.policy;
        const doctrine = this.party.upcastPolicy === 'always'
          ? 'Casters spend the highest slot they can \u2014 maximum upcast!'
          : this.party.upcastPolicy === 'never'
            ? 'Casters always use the lowest usable slot \u2014 no upcasting.'
            : 'Casters upcast when the fight calls for it \u2014 otherwise lowest slot.';
        this.hud.addCombatMessage(`\u2726 Casting doctrine set: ${doctrine}`, '#8cf');
        return;
      }

      case 'move': {
        if (inCombat) { this.hud.addCombatMessage('They cannot reposition mid-melee!', '#c66'); return; }
        this.dmDirection = cmd.direction;
        this.dmStance = 'auto';
        this.hud.addCombatMessage(`${leader.name} nods \u2014 the party sets off ${DM_DIR_NAMES[cmd.direction]}.`, '#6a8');
        return;
      }

      case 'descend': {
        if (this.mode !== GameMode.Dungeon) {
          this.hud.addCombatMessage('There are no stairs here — the dungeon is underground.', '#886');
          return;
        }
        if (inCombat) { this.hud.addCombatMessage('Not with swords still drawn!', '#c66'); return; }
        if (this.descending) { this.hud.addCombatMessage('The party is already on its way down...', '#cc8'); return; }
        this.hud.addCombatMessage('\u2b07 The party seeks the stairwell downward...', '#cc8');
        this.descending = true;
        setTimeout(() => this.generateNewDungeon(), 400);
        return;
      }

      case 'wait_until': {
        if (inCombat) { this.hud.addCombatMessage('Not while blades are drawn!', '#c66'); return; }
        // Fast-forward the clock to the next desired stage of the day.
        const want = cmd.time === 'dusk' ? 0.5 : cmd.time === 'night' ? 0.75 : 0.08; // dawn / morning / day / default
        const STAMP = 180_000;
        const cur = this.clock.phase;
        let delta = want - cur;
        if (delta < 0) delta += 1;
        if (delta < 0.02) delta = 1; // already there — a full day passes
        const newPhase = ((cur + delta) % 1 + 1) % 1;
        const fromStage = this.clock.timeOfDay;
        this.clock = {
          phase: newPhase,
          elapsed: this.clock.elapsed + delta * STAMP,
          timeOfDay: timeOfDayFromPhase(newPhase),
          light: 0.5 - 0.55 * Math.cos(newPhase * Math.PI * 2),
        };
        this.lastClockStage = this.clock.timeOfDay;
        const line = dayChangeNarration(fromStage, this.clock.timeOfDay) ?? 'The campfire crackles and the hours turn. When the party opens their eyes, the world has moved on.';
        this.hud.addCombatMessage(`🏕 The party settles in to wait out the hours.`, '#8cf');
        this.hud.addCombatMessage(`${this.clock.light < NIGHT_VISIBILITY_LIGHT ? '🌙' : '🌤'} ${this.clock.timeOfDay.toUpperCase()} — ${line}`, '#7ca');
        return;
      }
      case 'long_rest': {
        if (inCombat) { this.hud.addCombatMessage('Not mid-melee!', '#c66'); return; }
        this.hud.addCombatMessage('\ud83d\udee1 The party makes camp right here \u2014 long rest.', '#8cf');
        for (const msg of this.party.longRest()) this.hud.addCombatMessage(msg, '#7c7');
        this.hud.setParty(this.party);
        return;
      }
      case 'short_rest': {
        if (inCombat) { this.hud.addCombatMessage('No rest mid-fight \u2014 win first!', '#c66'); return; }
        this.hud.addCombatMessage('The party pauses for a short rest.', '#8cf');
        for (const msg of this.party.shortRest()) this.hud.addCombatMessage(msg, '#8cf');
        this.hud.setParty(this.party);
        return;
      }

      case 'stance': {
        this.dmDirection = undefined;
        if (cmd.stance === 'aggressive') {
          this.dmStance = 'aggressive';
          this.hud.addCombatMessage('\u2694 Weapons up \u2014 the party will hunt anything that moves.', '#c84');
        } else {
          this.dmStance = 'cautious';
          this.hud.addCombatMessage('The party tightens formation \u2014 discretion over valor.', '#886');
        }
        return;
      }

      case 'formation_help': {
        this.hud.addCombatMessage(
          `Formations: \u201cformation 2x2\u201d (block), \u201cformation 1x4\u201d (single file), \u201cformation 2x3\u201d (loose), \u201cformation line\u201d.`,
          '#8cf'
        );
        return;
      }
      case 'formation': {
        const { rows, cols } = cmd;
        this.party.setFormation(rows, cols);
        const shape =
          rows === 1 && cols === 4 ? 'a single-file line, four deep'
          : rows === 4 && cols === 1 ? 'a single-file line, four deep'
          : `${cols}\u00d7${rows}`;
        this.hud.addCombatMessage(`The party reforms into ${shape}${rows > 1 && cols > 1 ? ' block' : ''} \u2014 they\u2019ll spread out where space allows and squeeze single-file through tight spots.`, '#8cf');
        return;
      }

      case 'search_traps': {
        if (inCombat) { this.hud.addCombatMessage('Not mid-melee!', '#c66'); return; }
        const searcher = this.bestScout();
        const { total } = rollPerception(searcher);
        const radius = 3;
        let found = 0;
        for (const t of this.traps) {
          if (t.detected || t.disarmed) continue;
          const d = Math.max(Math.abs(t.tile.x - leader.tile.x), Math.abs(t.tile.y - leader.tile.y));
          if (d <= radius) {
            t.detected = true;
            found++;
            this.hud.addCombatMessage(`${searcher.name} spots a ${getTrapKind(t.kindId)!.name} at (${t.tile.x}, ${t.tile.y}).`, '#a86');
          }
        }
        if (found === 0) {
          this.hud.addCombatMessage(`${searcher.name} scans the stone (Perception ${total}) but finds no traps nearby.`, '#888');
        } else {
          this.hud.addCombatMessage(`${searcher.name} reveals ${found} hidden hazard${found === 1 ? '' : 's'}!`, '#6c6');
        }
        return;
      }

      case 'disarm_trap': {
        if (inCombat) { this.hud.addCombatMessage('Not mid-melee!', '#c66'); return; }
        if (!this.checkTrapDisarm(3)) {
          this.hud.addCombatMessage('There is no detected trap within reach to disarm. Try "search for traps".', '#888');
        }
        return;
      }

      // ── Use a looted potion or scroll (works mid-combat) ──
      case 'use_item': {
        this.handleLootedItemUse(cmd.arg);
        return;
      }

      case 'inventory': {
        const carriers = this.party.members.filter(m => m.inventory.length > 0);
        if (carriers.length === 0) {
          this.hud.addCombatMessage('The party carries nothing but weapons, wounds, and determination.', '#888');
          return;
        }
        let totalItemValue = 0;
        for (const m of carriers) {
          this.hud.addCombatMessage(`\ud83c\udfa5 ${m.name}'s pack:`, '#ca8');
          for (const item of m.inventory) {
            const value = item.value ?? 0;
            totalItemValue += value;
            this.hud.addCombatMessage(
              `  ${inventoryItemEmoji(item)} ${item.name}${value > 0 ? ` (${value.toLocaleString()} gp)` : ''}`,
              '#ca8'
            );
          }
        }
        const coin = this.party.members.reduce((s, m) => s + m.gold, 0);
        this.hud.addCombatMessage(
          `\ud83d\udcb0 Combined wealth: ${coin.toLocaleString()} gp in coin + ${totalItemValue.toLocaleString()} gp in carried items.`,
          '#fd8'
        );
        return;
      }

      case 'summon': {
        const query = cmd.monster.toLowerCase();
        const candidates = MONSTER_TEMPLATES
          .filter(t => t.name.toLowerCase().includes(query) || query.includes(t.name.toLowerCase()))
          .sort((a, b) => a.name.length - b.name.length);
        if (candidates.length === 0) {
          this.hud.addCombatMessage(`Nothing in the bestiary answers to "${query}".`, '#888');
          return;
        }
        const template = candidates[0];
        this.proclaim(`At your word, a ${template.name} manifests!`);
        this.spawnEncounter([template]);
        this.hud.setParty(this.party);
        return;
      }

      case 'calendar': {
        const c = this.calendar;
        const phaseLabel = c.moonPhase.replace(/_/g, ' ');
        const alt = this.clock.light < NIGHT_VISIBILITY_LIGHT ? 'night' : this.clock.light > 0.85 ? 'day' : this.clock.timeOfDay;
        this.hud.addCombatMessage(`📅 ${this.calendarDesc()}.`, '#7aa');
        this.hud.addCombatMessage(`The sun is ${alt}.${this.calendar.isGloomDay ? ' Old tales say the dead walk a Gloom day.' : ''}${this.calendar.isSacredDay ? ' Hearth blesses the faithful — the temple is open to all.' : ''}`, '#9aa');
        if (this.calendar.moonLight > 0.86) this.hud.addCombatMessage(`🌕 The ${phaseLabel} rides high — a hunting pack is abroad tonight, and werecreatures answer its call.`, '#c86');
        else if (this.calendar.moonLight < 0.14) this.hud.addCombatMessage(`🌑 The ${phaseLabel} blots the sky — the dark opens vaults the light has kept shut for a thousand years.`, '#8cf');
        else this.hud.addCombatMessage(`The ${phaseLabel} sits midway through its cycle.`, '#9aa');
        if (this.moonForgeBlade) {
          this.hud.addCombatMessage(`⚔ The party wields the legendary Moonfall — silver that sings on every stroke and thunders on a critical.`, '#ffd700');
        } else if (this.silveredWeapon && this.moonForgeLevel < 3) {
          this.hud.addCombatMessage(`⚔ The moon-forge contract stands at tier ${this.moonForgeLevel} of 3 — temper the blade further with moon-fangs and a were-pelt at any smith.`, '#ca8');
        } else if (this.moonForgeLevel >= 3) {
          this.hud.addCombatMessage(`⚔ The moon-forge blade is complete — nothing mortal can temper it further. Seek the forge it spoke of to finish it.`, '#ffd700');
        }
        return;
      }
      case 'journal': {
        this.journalCodex(cmd.raw);
        return;
      }
      case 'report': {
        const foes = this.monsters.filter(m => m.isAlive).length;
        const armedTraps = this.traps.filter(t => !t.disarmed).length;
        const detectedTraps = this.traps.filter(t => t.detected && !t.disarmed).length;
        const trapNote = armedTraps > 0
          ? ` | traps: ${detectedTraps}/${armedTraps} visible`
          : ' | traps: none';
        const placeLabel = this.mode === GameMode.Dungeon
          ? this.dungeonName
          : this.mode === GameMode.Town && this.currentTown
            ? `${this.currentTown.name} (town)`
            : 'The Wilderlands (surface)';
        this.hud.addCombatMessage(`\ud83d\udccd ${placeLabel} \u2014 ${foes} foe${foes === 1 ? '' : 's'} remain. Orders: ${this.dmStance}${this.dmDirection ? ` (marching ${DM_DIR_NAMES[this.dmDirection]})` : ''} | casting: ${this.party.upcastPolicy}${trapNote}.`, '#ffd700');
        this.hud.addCombatMessage(`📅 ${this.calendarDesc()} — the ${this.clock.timeOfDay}, weather ${this.weather?.type.replace(/_/g, ' ') ?? 'fair'}.`, '#7aa');
        for (const m of this.party.members) {
          const conds = m.conditions.map(c => CONDITION_META[c.id].label).join(', ');
          const pct = Math.round((m.hp / m.maxHp) * 100);
          const state = m.isConscious ? '' : m.isDead ? 'DEAD ' : m.stabilized ? 'STABILIZED ' : 'DYING ';
          this.hud.addCombatMessage(`${m.isConscious ? '' : '\u2620 '}${state}${m.name}: ${pct}% HP${conds ? ` [${conds}]` : ''}${m.concentration ? ` (concentrating)` : ''}${m.exhaustion > 0 ? ` [Exhaustion ${m.exhaustion}]` : ''}`, m.isConscious ? '#ccc' : '#c44');
        }
        this.hud.addCombatMessage(`Gold carried: ${this.party.members.reduce((s, m) => s + m.gold, 0)}.`, '#ca8');
        const h = this.history;
        this.hud.addCombatMessage(
          `\ud83d\udcdc Chronicle: ${h.kills} slain, ${h.victories} victor${h.victories === 1 ? 'y' : 'ies'}, ${h.defeats} retreat${h.defeats === 1 ? '' : 's'}, ${h.roomsVisited} room${h.roomsVisited === 1 ? '' : 's'} explored, deepest level ${h.deepestLevel}.`,
          '#9aa'
        );
        // Bestiary kill ledger — per-kind totals, most slain first.
        const ledger = Object.entries(h.killLedger)
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1]);
        if (ledger.length > 0) {
          const kinds = ledger.length === 1 ? 'kind' : 'kinds';
          const top = ledger.slice(0, 5).map(([id, n]) => {
            const entry = getMonsterBestiaryEntry(id);
            return `${entry ? entry.name : id} \u00d7${n}`;
          }).join(', ');
          const extra = ledger.length > 5 ? ` (+${ledger.length - 5} more)` : '';
          this.hud.addCombatMessage(`\ud83d\udcd6 Bestiary: ${ledger.length} ${kinds} slain${extra} \u2014 ${top}.`, '#7bd');
        }
        const dice = getDiceStats();
        const byType = Object.entries(dice.byType).filter(([, n]) => n > 0).map(([t, n]) => `${n}×${t}`).join(', ');
        this.hud.addCombatMessage(`\ud83c\udfb2 ${dice.rolls} rolls this session \u2014 ${dice.crits} natural 20s, ${dice.fumbles} natural 1s.`, '#fd8');
        const floorDice = dice.byFloor[this.dungeonLevel] ?? { rolls: 0, crits: 0, fumbles: 0 };
        this.hud.addCombatMessage(
          `\ud83d\uddfa Floor ${this.dungeonLevel}: ${floorDice.rolls} rolls \u2014 ${floorDice.crits} natural 20s, ${floorDice.fumbles} natural 1s.`,
          '#fd8'
        );
        if (dice.critStreak >= 2) {
          this.hud.addCombatMessage(`\ud83d\udd25 ${dice.critStreak} crits in a row (best ${dice.bestCritStreak})!`, '#ffd700');
        } else if (dice.fumbleStreak >= 2) {
          this.hud.addCombatMessage(`\ud83d\udc80 ${dice.fumbleStreak} fumbles in a row (best ${dice.bestFumbleStreak})\u2026`, '#c66');
        } else if (dice.bestCritStreak >= 2 || dice.bestFumbleStreak >= 2) {
          this.hud.addCombatMessage(`Streaks: best ${dice.bestCritStreak} crits, worst ${dice.bestFumbleStreak} fumbles in a row.`, '#aa8');
        }
        const luck = getLuckDie();
        if (luck) this.hud.addCombatMessage(`\u26a1 Fated Luck die pending: ${luck.value} (from "${luck.source}") \u2014 spent on the next party d20 roll.`, '#fd8');
        if (byType) this.hud.addCombatMessage(`  Breakdown: ${byType}`, '#aa8');
        return;
      }

      // ── Equipment ──
      case 'equip': {
        const itemName = cmd.item;
        const owner = cmd.member
          ? this.party.members.find(m => m.name.toLowerCase().includes(cmd.member!)) ?? leader
          : this.findItemOwner(itemName) ?? leader;
        const item = [...owner.inventory, ...Object.values(owner.equipment)]
          .find(i => i && i.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(itemName.replace(/[^a-z0-9]+/g, ' ').trim()));
        if (!item) {
          this.hud.addCombatMessage(`No one carries a "${itemName}" — try "gear" to see what's held.`, '#886');
          return;
        }
        if (Object.values(owner.equipment).some(e => e?.id === item.id)) {
          this.hud.addCombatMessage(`${owner.name} is already using the ${item.name}.`, '#886');
          return;
        }
        const line = owner.equip(item.id);
        this.hud.addCombatMessage(line ? `⚔ ${line} (AC ${owner.ac})` : `The ${item.name} can't be equipped.`, line ? '#8cf' : '#c66');
        this.hud.setParty(this.party);
        return;
      }
      case 'unequip': {
        const arg = cmd.arg;
        const SLOT_WORDS: Record<string, EquipSlot> = { weapon: 'weapon', armor: 'armor', shield: 'shield', trinket: 'trinket', ring: 'trinket', amulet: 'trinket', cloak: 'trinket' };
        let done = false;
        for (const m of this.party.members) {
          for (const slot of ['weapon', 'armor', 'shield', 'trinket'] as EquipSlot[]) {
            const it = m.equipment[slot];
            if (!it) continue;
            const hit = SLOT_WORDS[arg] === slot ||
              it.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(arg.replace(/[^a-z0-9]+/g, ' ').trim());
            if (hit && arg.length > 0) {
              const line = m.unequip(slot);
              this.hud.addCombatMessage(`🎒 ${line} (AC ${m.ac})`, '#8cf');
              done = true;
            }
          }
        }
        if (!done) this.hud.addCombatMessage('Nothing like that is equipped — try "gear" to see worn items.', '#886');
        this.hud.setParty(this.party);
        return;
      }
      case 'gear': {
        this.hud.addCombatMessage('⚔ Equipped gear:', '#ffd700');
        for (const m of this.party.members) {
          this.hud.addCombatMessage(`${m.name} (AC ${m.ac}, +${m.attackBonus} to hit, +${m.damageBonus} dmg): ${m.gearSummary()}`, '#ccc');
        }
        return;
      }

      // ── Overworld, town, quest & commerce ──
      case 'quests': {
        this.listQuests();
        return;
      }
      case 'accept_quest': {
        if (this.activeQuest()) {
          this.hud.addCombatMessage('A quest is already accepted — finish it before taking another.', '#886');
          return;
        }
        const pool = this.quests.filter(q => !q.accepted && !q.turnedIn);
        const q = pool[Math.max(0, (cmd.index ?? 1) - 1)];
        if (!q) {
          this.hud.addCombatMessage('There is nothing to accept right now — try "quests".', '#886');
          return;
        }
        this.acceptQuest(q);
        return;
      }
      case 'turn_in_quest': {
        const active = this.activeQuest();
        if (!active || !active.completed) {
          this.hud.addCombatMessage('No quest is ready to report — finish the objective first.', '#886');
          return;
        }
        if (this.mode !== GameMode.Town) {
          this.hud.addCombatMessage('Quest rewards are claimed in town — head back and report there.', '#886');
          return;
        }
        this.reportQuest(active);
        return;
      }
      case 'depart_town': {
        this.departTown();
        return;
      }
      case 'go_to_town': {
        if (this.mode === GameMode.Overworld) {
          this.overworldDestination = { kind: 'town', id: this.currentTown?.id ?? this.overworld?.spawnTownId ?? '' };
          this.overworldPath = [];
          this.hud.addCombatMessage('The party turns its steps toward town.', '#6a8');
        } else {
          this.hud.addCombatMessage(this.mode === GameMode.Town ? 'The party is already in town.' : 'The party is underground — climb out first ("leave").', '#886');
        }
        return;
      }
      case 'shop': case 'buy': case 'sell': {
        if (this.mode !== GameMode.Town) {
          this.hud.addCombatMessage('No merchants here — the market is in town.', '#886');
          return;
        }
        this.hud.townPanel.show();
        if (cmd.intent !== 'shop') {
          const query = cmd.item.toLowerCase();
          const item = [...this.marketStock(), ...this.partyInventory()].find(i => i.name.toLowerCase().includes(query));
          if (item) {
            if (cmd.intent === 'buy') this.buyItem(item);
            else this.sellItem(item);
          } else {
            this.hud.addCombatMessage(`No ${cmd.intent === 'buy' ? 'stock' : 'item'} matching "${query}".`, '#888');
          }
        }
        return;
      }
      case 'leave_dungeon': {
        if (this.mode === GameMode.Dungeon) {
          this.hud.addCombatMessage('The party turns back and climbs toward the light.', '#ca8');
          this.exitDungeonToOverworld();
        } else if (this.mode === GameMode.Overworld) {
          this.hud.addCombatMessage('The party is already on the surface.', '#888');
        } else {
          this.hud.addCombatMessage('The party is in town — try "depart" to leave.', '#888');
        }
        return;
      }
      case 'enter_dungeon': {
        const e = this.overworld ? entranceAt(this.overworld, leader.tile.x, leader.tile.y) : undefined;
        if (this.mode === GameMode.Overworld && e) {
          this.enterDungeonFromEntrance(e);
        } else if (this.mode === GameMode.Dungeon) {
          this.hud.addCombatMessage('The party is already underground.', '#888');
        } else {
          this.hud.addCombatMessage('There is no dungeon entrance here.', '#888');
        }
        return;
      }
      case 'travel_to': {
        const query = cmd.destination.toLowerCase();
        if (this.mode === GameMode.Overworld && this.overworld) {
          const town = this.overworld.towns.find(t => t.name.toLowerCase().includes(query));
          const entrance = this.overworld.entrances.find(e => e.name.toLowerCase().includes(query));
          if (town) {
            this.overworldDestination = { kind: 'town', id: town.id };
            this.overworldPath = [];
            this.hud.addCombatMessage(`The party sets course for ${town.name}.`, '#6a8');
          } else if (entrance) {
            this.overworldDestination = { kind: 'entrance', id: entrance.id };
            this.overworldPath = [];
            this.hud.addCombatMessage(`The party sets course for ${entrance.name}.`, '#6a8');
          } else {
            this.hud.addCombatMessage(`No town or dungeon named "${query}" on the maps.`, '#888');
          }
        } else {
          this.hud.addCombatMessage('Travel orders only make sense on the surface.', '#886');
        }
        return;
      }

      // ── Bandit camps ──
      case 'raid_camp': {
        if (inCombat) { this.hud.addCombatMessage('Not mid-melee!', '#c66'); return; }
        if (this.mode === GameMode.Town) { this.hud.addCombatMessage('There are no camps in town — head to the overworld.', '#886'); return; }
        const pendingClue = this.banditCamps.clues.find(c => !c.resolved);
        if (!pendingClue) {
          this.hud.addCombatMessage('You have no camp clues to act on. Defeat bandits on the road to find their hideouts.', '#888');
          return;
        }
        this.hud.addCombatMessage('⚔️ The party moves to assault the bandit camp!', '#c84');
        // Spawn a combat encounter scaled to the camp tier
        const templates = [];
        for (let i = 0; i < 2 + pendingClue.tier; i++) {
          templates.push(getMonsterTemplate('bandit') ?? getMonsterTemplate('goblin')!);
        }
        if (pendingClue.tier >= 2) templates.push(getMonsterTemplate('highwayman') ?? getMonsterTemplate('bandit')!);
        if (pendingClue.tier >= 3) templates.push(getMonsterTemplate('bandit_captain') ?? getMonsterTemplate('orc')!);
        this.spawnEncounter(templates);
        pendingClue.resolved = true;
        return;
      }
      case 'report_camp': {
        if (this.mode !== GameMode.Town) {
          this.hud.addCombatMessage('You must be in town to report a camp location.', '#886');
          return;
        }
        const pendingClue = this.banditCamps.clues.find(c => !c.resolved);
        if (!pendingClue) {
          this.hud.addCombatMessage('You have no camp clues to report.', '#888');
          return;
        }
        this.hud.addCombatMessage(`🗺️ The constable studies the map and nods grimly.`, '#ca8');
        this.hud.addCombatMessage(`"Good work. The guard will handle the rest. Here's your reward — ${pendingClue.reportReward} gold, as promised."`, '#888');
        // Award gold to the party
        const living = this.party.members.filter(m => m.isAlive);
        if (living.length > 0) {
          const each = Math.floor(pendingClue.reportReward / living.length);
          living.forEach(m => m.gold += each);
        }
        pendingClue.resolved = true;
        return;
      }
      case 'list_clues': {
        const pending = this.banditCamps.clues.filter(c => !c.resolved);
        if (pending.length === 0) {
          this.hud.addCombatMessage('No bandit camp clues in hand. Defeat bandits on the road to find their hideouts.', '#888');
          return;
        }
        this.hud.addCombatMessage('🗺️ Bandit Camp Clues:', '#ca8');
        pending.forEach((c, i) => {
          this.hud.addCombatMessage(`  ${i + 1}. ${c.description} (Tier ${c.tier})`, '#a89');
          this.hud.addCombatMessage(`     Report for ${c.reportReward} gp or "raid camp" to assault it.`, '#888');
        });
        return;
      }

      // ── Townsfolk ──
      case 'talk_to': {
        const query = cmd.npc.toLowerCase();
        if (!query) { this.hud.addCombatMessage('Who do you want to talk to?', '#888'); return; }
        if (this.mode !== GameMode.Town || !this.currentTown) {
          this.hud.addCombatMessage('You must be in town to visit NPCs.', '#886');
          return;
        }
        const tl = this.townLife?.byTown[this.currentTown.id];
        if (!tl?.questGivers) { this.hud.addCombatMessage('No one of note is around right now.', '#888'); return; }
        const npc = tl.questGivers.find(g => g.name.toLowerCase().includes(query));
        if (!npc) { this.hud.addCombatMessage(`No one named "${query}" is around right now.`, '#888'); return; }
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
        return;
      }
      case 'list_npcs': {
        if (this.mode !== GameMode.Town || !this.currentTown) {
          this.hud.addCombatMessage('You must be in town to see the locals.', '#886');
          return;
        }
        const tl = this.townLife?.byTown[this.currentTown.id];
        if (!tl?.questGivers) { this.hud.addCombatMessage('No one of note is around.', '#888'); return; }
        this.hud.addCombatMessage('👥 Notable NPCs in town:', '#ca8');
        tl.questGivers.forEach(g => {
          this.hud.addCombatMessage(`  ${g.portrait} ${g.name} — ${g.title} [${getReputationTier(g)}]`, '#a89');
        });
        return;
      }

      case 'unknown': {
        void text;
        this.confusedGlances();
        return;
      }
    }
  }

  /** "model on / off / status" — the DM intent model is wired up by the LLM service. */
  private handleModelToggle(state: 'on' | 'off' | 'status'): void {
    if (state === 'status') {
      this.dmModelDebug = !this.dmModelDebug;
      this.hud.addCombatMessage(
        `DM intent model: ${this.intentPredictor ? 'loaded' : 'not loaded (regex only)'}. Understander echo ${this.dmModelDebug ? 'on' : 'off'}.`,
        '#8cf'
      );
      return;
    }
    this.hud.addCombatMessage(`The DM intent model cannot be switched ${state} in this build yet.`, '#888');
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

function startGame() {
  const game = new Game();
  (window as any).__game = game;

  // The player picks a slot: continue a saved run there or begin a new one.
  const saves = listSaves();
  game.hud.onStartChoice = (choice, slot) => game.handleStartChoice(choice, slot);
  game.hud.onMainMenu = () => game.returnToMainMenu();
  game.hud.showStartScreen(saves);

  // Persist when the tab hides or closes (only once a run has actually begun).
  window.addEventListener('beforeunload', () => { if (game.runStarted) game.saveGame(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && game.runStarted) game.saveGame();
  });
}

/** Parse '2d4+2' style healing dice out of an item description. */
function parseHealDice(description: string): { count: number; size: number; bonus: number } {
  const m = description.match(/(\d+)d(\d+)(?:\+(\d+))?/);
  return m
    ? { count: Number(m[1]), size: Number(m[2]), bonus: Number(m[3] || 0) }
    : { count: 1, size: 4, bonus: 0 };
}

/** Pick a fitting glyph for a carried item in the loot listing. */
function inventoryItemEmoji(item: InventoryItem): string {
  if (item.id === 'ration') return '\ud83c\udf5e';
  if (item.type === 'potion') return '\ud83e\uddea';
  if (item.type === 'scroll') return '\ud83d\udcdc';
  if (item.type === 'weapon') return '\u2694\ufe0f';
  if (item.type === 'armor') return '\ud83d\udee1\ufe0f';
  if (item.type === 'treasure') {
    if (item.id.startsWith('gem_')) return '\ud83d\udc8e';
    if (item.id.startsWith('art_')) return '\ud83d\uddbc\ufe0f';
    return '\u2728'; // magic item
  }
  return '\ud83d\udce6';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startGame);
} else {
  startGame();
}
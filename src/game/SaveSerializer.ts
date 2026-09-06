/**
 * Reading the run out to a save slot, and writing one back in.
 *
 * The schema, the version guard and the migration ladder all live in
 * save/SaveManager; this is only the Game-side half — which field of the run
 * goes into which field of a `SaveData`, and in what order they come back.
 *
 * A word on `SaveHost`, because it is much wider than the hosts the other
 * slices take. A save is, by definition, everything mutable about a run, so
 * "the slice of the game serialization may touch" is close to "the run". A
 * narrower interface here would be a lie told with extra steps. What the host
 * does buy is honesty in two directions:
 *
 *   - It is an itemised list of what a save actually carries. If a field is
 *     not named here it is not persisted, and that is now readable in one
 *     place instead of inferred from six hundred lines of assignments.
 *   - It stops at state. Restoring also has *effects* — the battle window
 *     re-opens, a floor that lost its layout is rebuilt, transient timers go
 *     back to zero — and those are Game's own business, interleaved at points
 *     where their order matters. Rather than reach into the machinery, the
 *     host names each one as a question the serializer asks Game to answer at
 *     exactly the moment restore always asked it. Those are the methods at the
 *     bottom of the interface, and they are why `Game` did not have to make
 *     its dungeon generator, its battle wiring or its loop timers public.
 *
 * The alternative considered and rejected was passing `Game` itself under an
 * alias. It is shorter, but it documents nothing and quietly grants the
 * serializer the whole class forever.
 */

import type { Camera } from '../engine/Camera';
import type { Direction } from '../engine/types';
import type { Party } from '../entities/Party';
import type { CombatEngine } from '../combat/CombatEngine';
import type { HUD } from '../ui/HUD';
import type { GameSpeed } from '../ui/HUD';
import type { Room } from '../world/DungeonGenerator';
import type { PlacedTrap } from '../traps/Traps';
import type { Overworld, OverworldTown } from '../world/Overworld';
import type { OverworldPOI } from '../world/OverworldPOI';
import type { Wanderer } from '../world/OverworldLife';
import type { WorldRegion } from '../world/WorldRegions';
import type { TownLifeState } from '../world/TownLife';
import type { BanditCampState } from '../quests/BanditCamps';
import type { Quest } from '../quests/Quests';
import type { WeatherState } from '../world/WeatherSystem';
import type { ClockState, TimeOfDay } from '../world/DayNightSystem';
import type { LocationTemplate } from '../ai/DnDKnowledge';
import type { PartyHistory } from '../ai/LoreGenerator';
import type { SaveData } from '../save/SaveManager';

import { SAVE_VERSION } from '../save/SaveManager';
import { TileMap } from '../world/TileMap';
import { GameCharacter } from '../entities/Character';
import { Monster, getMonsterTemplate } from '../entities/Monster';
import { CLASSES, RACES } from '../data/gameData';
import { getTownById, nearestWalkable, ringOverworld } from '../world/Overworld';
import { generateWorldRegions } from '../world/WorldRegions';
import { isCaravanWanderer, sanitizeTownLife } from '../world/TownLife';
import { assignFeature } from '../world/RoomFeatures';
import { createClock, timeOfDayFromPhase } from '../world/DayNightSystem';
import { getLocation, getRandomElement, LOCATIONS } from '../ai/DnDKnowledge';
import { setDiceFloor } from '../rules/DiceEvents';
import { getLuckDie, grantLuckDie } from '../rules/LuckDie';
import type { StoryState } from '../story/Story';
import type { PersonalQuest } from '../events/PersonalQuests';

/**
 * Everything a save reads or writes. The state half is the run itself; the
 * method half is the handful of things only Game can do, asked for at the
 * point in a restore where Game has always done them.
 */
export interface SaveHost {
  // ── Where the party is ──
  /**
   * Raw `GameMode` ordinal, which is the shape a save carries it in (0
   * overworld, 1 town, 2 dungeon). The serializer writes it back untouched
   * and otherwise asks the questions below rather than naming the enum.
   */
  mode: number;
  /** Raw `GamePhase` ordinal, likewise. */
  phase: number;
  readonly inOverworld: boolean;
  readonly inTown: boolean;
  readonly inDungeon: boolean;
  readonly inCombat: boolean;

  // ── The delve ──
  dungeonLevel: number;
  dungeonName: string;
  dungeonTheme: LocationTemplate | null;
  dungeonEntranceId: string | null;
  bossSlainThisFloor: boolean;
  delveMood: { icon: string; label: string; effects: string[] } | null;
  map: TileMap;
  rooms: Room[];
  traps: PlacedTrap[];
  monsters: Monster[];
  monsterIdCounter: number;

  // ── The surface ──
  overworld: Overworld | null;
  worldRegions: WorldRegion[];
  wanderers: Wanderer[];
  pois: OverworldPOI[];
  currentTown: OverworldTown | null;
  townLife: TownLifeState | null;
  banditCamps: BanditCampState;
  weather: WeatherState | null;
  clock: ClockState;
  lastClockStage: TimeOfDay;

  // ── The party and its chronicle ──
  readonly party: Party;
  history: PartyHistory;
  quests: Quest[];
  activeQuestId: string | null;
  expeditionJournal: string[];
  treasuresFound: number;
  silveredWeapon: boolean;
  moonForgeLevel: number;
  moonForgeBlade: boolean;

  // ── Live machinery ──
  readonly combatEngine: CombatEngine;
  readonly camera: Camera;
  readonly hud: HUD;
  /** Milliseconds between AI actions; a save stores the speed multiplier. */
  readonly tickInterval: number;

  // ── Live DM orders ──
  dmStance: 'auto' | 'aggressive' | 'cautious';
  dmDirection?: Direction;
  runMode: 'auto' | 'manual';
  hardcore: boolean;
  story: StoryState | null;
  personalQuests: PersonalQuest[];

  // ── Effects a restore has, which belong to Game ──
  /** Put the party underground; the surface world is not what was saved. */
  enterDungeonMode(): void;
  /** Put the party on the surface, the default for a save that names no mode. */
  enterOverworldMode(): void;
  /** Re-read the bestiary after the kill ledger changes under it. */
  syncKnownFoes(): void;
  /** Lift the pause and any error halt the previous run left behind. */
  resumeRun(): void;
  /** Re-open the battle window for a save taken mid-fight. */
  reopenBattleView(): void;
  /** Zero the loop's tick, combat and autosave timers and the stuck counters. */
  resetTransientTimers(): void;
  /** Rebuild a floor whose corridors predate the two-wide passages. */
  ensureNavigableDungeon(): void;
  /** Regenerate a dungeon floor that came back without a layout. */
  rebuildLostDungeonFloor(): void;
  /** Count the room the party is standing in as seen, so it is not re-narrated. */
  markRestoredRoomVisited(): void;
  /** Forget where the party was walking to; a restored run stands still. */
  clearTravelPlans(): void;
}

export class SaveSerializer {
  constructor(private game: SaveHost) {}

  /** The whole run, as a slot-ready snapshot. */
  capture(): SaveData {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      mode: this.game.mode,
      dungeonLevel: this.game.dungeonLevel,
      dungeonName: this.game.dungeonName,
      dungeonThemeId: this.game.dungeonTheme?.id ?? undefined,
      history: { ...this.game.history },
      luckDie: getLuckDie(),
      phase: this.game.phase,
      quests: this.game.quests.map(q => ({ ...q })),
      activeQuestId: this.game.activeQuestId,
      dungeonEntranceId: this.game.dungeonEntranceId,
      partyName: this.game.party.partyName,
      silveredWeapon: this.game.silveredWeapon,
      moonForgeLevel: this.game.moonForgeLevel,
      moonForgeBlade: this.game.moonForgeBlade,
      overworld: this.game.overworld ? {
        width: this.game.overworld.map.width,
        height: this.game.overworld.map.height,
        tiles: this.game.overworld.map.tiles,
        explored: this.game.overworld.map.explored,
        towns: this.game.overworld.towns,
        entrances: this.game.overworld.entrances,
        spawnTownId: this.game.overworld.spawnTownId,
        regions: this.game.worldRegions,
      } : null,
      wanderers: this.game.wanderers.map(w => ({ ...w, tile: { ...w.tile }, target: { ...w.target } })),
      townLife: this.game.townLife,
      banditCamps: this.game.banditCamps,
      pois: this.game.pois.map(p => ({ ...p, tile: { ...p.tile } })),
      expeditionJournal: this.game.expeditionJournal,
      weather: this.game.weather ?? undefined,
      clockPhase: this.game.clock.phase,
      clockElapsed: this.game.clock.elapsed,
      treasuresFound: this.game.treasuresFound,
      // The delve mood carries real combat effects, the town is where the
      // party is actually standing, and the floor's boss does not come back
      // to life on reload. All three used to be dropped and re-guessed.
      delveMood: this.game.delveMood,
      currentTownId: this.game.currentTown?.id ?? null,
      bossSlainThisFloor: this.game.bossSlainThisFloor,
      monsterIdCounter: this.game.monsterIdCounter,
      dmStance: this.game.dmStance,
      runMode: this.game.runMode,
      story: this.game.story,
      personalQuests: this.game.personalQuests,
      hardcore: this.game.hardcore,
      dmDirection: this.game.dmDirection ?? null,
      speed: 800 / this.game.tickInterval,
      camera: {
        x: this.game.camera.x,
        y: this.game.camera.y,
        targetX: this.game.camera.targetX,
        targetY: this.game.camera.targetY,
      },
      map: {
        width: this.game.map.width,
        height: this.game.map.height,
        tiles: this.game.map.tiles,
        explored: this.game.map.explored,
      },
      rooms: this.game.inDungeon ? this.game.rooms : [],
      traps: this.game.traps.map(t => ({ ...t, tile: { ...t.tile } })),
      party: {
        leaderIndex: this.game.party.leaderIndex,
        formation: this.game.party.formation,
        members: this.game.party.members.map(m => ({
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
          vendettas: m.vendettas,
          abilityUses: m.abilityUses,
          resource: m.resource,
          bonusAttackBonus: m.bonusAttackBonus,
          equipment: m.equipment,
          personality: m.personality,
          subclass: m.subclass,
          deity: m.deity,
          background: m.background,
          alignment: m.alignment,
        })),
      },
      monsters: this.game.monsters.map(m => ({
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
      combat: this.game.inCombat && this.game.combatEngine.isActive
        ? {
            isActive: true,
            currentTurnIndex: this.game.combatEngine.currentTurnIndex,
            partyBlessRounds: this.game.combatEngine.partyBlessRounds,
            blessSourceId: this.game.combatEngine.blessSourceId,
            initiative: this.game.combatEngine.initiativeOrder.map(e =>
              e instanceof GameCharacter
                ? { kind: 'char' as const, id: e.id }
                : { kind: 'monster' as const, id: e.id }
            ),
            legendary: Object.fromEntries(
              this.game.combatEngine.getBosses().map(b => [b.id, b.legendaryActions])
            ),
          }
        : null,
    };
  }

  /** Apply a saved snapshot to the running game, in place. */
  apply(save: SaveData): void {
    // v4+: the overworld, quests, and mode. Older saves stay in their dungeon
    // (the surface world is generated lazily the first time they climb out).
    this.game.overworld = null;
    this.game.wanderers = [];
    this.game.quests = [];
    this.game.activeQuestId = null;
    this.game.dungeonEntranceId = save.dungeonEntranceId ?? null;
    this.game.party.partyName = save.partyName ?? 'The Unnamed Party';
    this.game.currentTown = null;
    this.game.townLife = null;
    this.game.banditCamps = save.banditCamps ?? { camps: [], clues: [] };
    this.game.pois = (save.pois ?? []).map(p => ({ ...p, tile: { ...p.tile } }));
    this.game.expeditionJournal = save.expeditionJournal ?? [];
    this.game.weather = (save as any).weather ?? null;
    this.game.silveredWeapon = (save as any).silveredWeapon ?? false;
    this.game.moonForgeLevel = (save as any).moonForgeLevel ?? 0;
    this.game.moonForgeBlade = (save as any).moonForgeBlade ?? false;
    if (typeof (save as any).clockPhase === 'number') {
      this.game.clock = { ...createClock(), phase: (save as any).clockPhase, elapsed: (save as any).clockElapsed ?? (save as any).clockPhase * 180_000, timeOfDay: timeOfDayFromPhase((save as any).clockPhase), light: 0.5 - 0.55 * Math.cos((save as any).clockPhase * Math.PI * 2) };
    } else {
      this.game.clock = createClock();
    }
    this.game.treasuresFound = save.treasuresFound ?? 0;
    // Older saves carry neither, and behave as they always did: no mood, and
    // the floor's boss treated as still standing.
    this.game.delveMood = save.delveMood ?? null;
    this.game.bossSlainThisFloor = save.bossSlainThisFloor ?? false;
    this.game.hud.setDelveMoodChip(this.game.delveMood);
    this.game.lastClockStage = this.game.clock.timeOfDay;
    if (save.overworld) {
      const owMap = new TileMap(save.overworld.width, save.overworld.height);
      owMap.tiles = save.overworld.tiles;
      owMap.explored = save.overworld.explored;
      this.game.overworld = {
        map: owMap,
        towns: save.overworld.towns,
        entrances: save.overworld.entrances,
        spawnTownId: save.overworld.spawnTownId,
        pois: this.game.pois,
        regions: save.overworld.regions ?? generateWorldRegions(owMap, save.overworld.towns, save.overworld.entrances),
      };
      this.game.worldRegions = this.game.overworld.regions;
      this.game.map = owMap;
      // Old saves predate the mountain ring at the world's edge — apply it so
      // a restored party can't march into the void.
      ringOverworld(this.game.map);
      this.game.camera.setBounds(this.game.map.width, this.game.map.height);
      // In-flight caravans don't survive a save (their wanderers would linger
      // as ghosts) — town rumors and festival clocks do.
      this.game.wanderers = (save.wanderers ?? [])
        .filter(w => !isCaravanWanderer(w))
        .map(w => ({ ...w, tile: { ...w.tile }, target: { ...w.target }, recent: w.recent ?? [] }));
      this.game.townLife = sanitizeTownLife(save.townLife ?? undefined, this.game.overworld);
      this.game.quests = (save.quests ?? []).map(q => ({ ...q }));
      this.game.activeQuestId = save.activeQuestId ?? null;
      if (typeof save.mode === 'number') this.game.mode = save.mode;
      else this.game.enterOverworldMode();
      // Saves from v10 on record where the party actually is. Older ones do
      // not, so fall back to the old guess: the first quest giver's town.
      const saved = save.currentTownId ? getTownById(this.game.overworld, save.currentTownId) : undefined;
      const giver = this.game.quests[0] ? getTownById(this.game.overworld, this.game.quests[0].giverTownId) : undefined;
      this.game.currentTown = saved ?? giver ?? getTownById(this.game.overworld, this.game.overworld.spawnTownId) ?? null;
    } else {
      this.game.enterDungeonMode();

      // Map (dungeon saves only — the overworld map above wins otherwise)
      const map = new TileMap(save.map.width, save.map.height);
      map.tiles = save.map.tiles;
      map.explored = save.map.explored;
      this.game.map = map;
      this.game.camera.setBounds(this.game.map.width, this.game.map.height);
    }

    // Dungeon / world state
    this.game.rooms = save.rooms;
    // Old saves predate room features — give their rooms features too.
    for (const room of this.game.rooms) {
      if (!room.feature) assignFeature(room, save.dungeonLevel ?? 1, { force: true });
    }
    this.game.traps = (save.traps ?? []).map(t => ({ ...t, tile: { ...t.tile } }));
    this.game.dungeonLevel = save.dungeonLevel;
    this.game.dungeonName = save.dungeonName;
    this.game.dungeonTheme = save.dungeonThemeId
      ? (getLocation(save.dungeonThemeId) ?? getRandomElement(LOCATIONS))
      : getRandomElement(LOCATIONS);
    this.game.history = save.history
      ? { ...save.history, killLedger: save.history.killLedger ?? {} }
      : { kills: 0, victories: 0, defeats: 0, roomsVisited: 0, deepestLevel: this.game.dungeonLevel, killLedger: {} };
    this.game.syncKnownFoes();
    grantLuckDie(save.luckDie ?? null);
    setDiceFloor(this.game.dungeonLevel);
    this.game.phase = save.phase;
    this.game.monsterIdCounter = save.monsterIdCounter;
    this.game.dmStance = save.dmStance;
    this.game.runMode = save.runMode ?? 'auto';
    this.game.story = save.story ?? null;
    this.game.personalQuests = save.personalQuests ?? [];
    this.game.hardcore = save.hardcore ?? false;
    this.game.dmDirection = save.dmDirection ?? undefined;
    this.game.resumeRun();

    // Party (mutated in place so engine/AI references stay valid)
    this.game.party.members.length = 0;
    this.game.party.leaderIndex = save.party.leaderIndex;
    // Rebuild the formation from the saved tiles so the leader anchors at
    // (0,0) — pre-fix saves stored leader-shifted offsets that broke movement.
    const savedLeaderTile = save.party.members[0]?.tile ?? { x: 0, y: 0 };
    this.game.party.formation = save.party.members.map((s) => ({
      x: s.tile.x - savedLeaderTile.x,
      y: s.tile.y - savedLeaderTile.y,
    }));
    this.game.party.formation[0] = { x: 0, y: 0 };
    for (const s of save.party.members) {
      const charClass = CLASSES.find(c => c.id === s.classId) || CLASSES[0];
      const race = RACES.find(r => r.id === s.raceId) || RACES[0];
      const char = new GameCharacter(s.id, s.name, charClass, race, s.abilities);
      char.level = s.level;
      char.xp = s.xp;
      char.hp = s.hp;
      // AC is not restored: it is derived from DEX, equipment and a heavy
      // curse, and `recomputeAC()` below rebuilds it from the equipment this
      // loop is about to set. Assigning the saved value here was overwritten
      // three lines later by an identical one. It stays in the save file as a
      // record of what the character had, not as something read back.
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
      char.vendettas = { ...(s.vendettas ?? {}) };
      char.abilityUses = { ...(s.abilityUses ?? {}) };
      if (typeof s.resource === 'number') char.resource = s.resource;
      char.personality = { ...s.personality };
      char.subclass = s.subclass;
      char.deity = s.deity;
      char.background = s.background;
      char.alignment = s.alignment;
      this.game.party.members.push(char);
    }

    // Monsters
    this.game.monsters = [];
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
      this.game.monsters.push(monster);
    }

    // Combat engine
    this.game.combatEngine.monsters = this.game.monsters;
    this.game.combatEngine.isActive = false;
    this.game.combatEngine.log = { round: 0, messages: [], isOver: false, winner: null };
    this.game.combatEngine.initiativeOrder = [];
    this.game.combatEngine.currentTurnIndex = 0;
    this.game.combatEngine.partyBlessRounds = 0;
    this.game.combatEngine.blessSourceId = '';
    if (save.combat && save.combat.isActive && this.game.inCombat) {
      this.game.combatEngine.isActive = true;
      this.game.combatEngine.currentTurnIndex = save.combat.currentTurnIndex;
      this.game.combatEngine.partyBlessRounds = save.combat.partyBlessRounds;
      this.game.combatEngine.blessSourceId = save.combat.blessSourceId;
      if (save.combat.legendary) {
        for (const [id, actions] of Object.entries(save.combat.legendary)) {
          const monster = this.game.monsters.find(m => m.id === id);
          if (monster) monster.legendaryActions = actions;
        }
      }
      for (const entry of save.combat.initiative) {
        if (entry.kind === 'char') {
          const member = this.game.party.members.find(m => m.id === entry.id);
          if (member) this.game.combatEngine.initiativeOrder.push(member);
        } else {
          const monster = this.game.monsters.find(m => m.id === entry.id);
          if (monster) this.game.combatEngine.initiativeOrder.push(monster);
        }
      }
      // Re-open the battle window for a restored in-combat save.
      this.game.reopenBattleView();
    }

    // If an old save parked the party on the (now impassable) border ring,
    // pull them back onto walkable ground before anything moves.
    if (this.game.inOverworld) {
      const l = this.game.party.leader;
      if (!this.game.map.isWalkable(l.tile.x, l.tile.y)) {
        const safe = nearestWalkable(this.game.map, l.tile.x, l.tile.y);
        this.game.party.setPosition(safe);
      }
    }

    // Camera
    this.game.camera.x = save.camera.x;
    this.game.camera.y = save.camera.y;
    this.game.camera.targetX = save.camera.targetX;
    this.game.camera.targetY = save.camera.targetY;

    // Speed (derives tick intervals via the HUD hook)
    this.game.hud.setSpeed(save.speed as GameSpeed);

    // Reset transient timers
    this.game.resetTransientTimers();

    // Saves from before 2-wide corridors trap the formation in the first
    // room — rebuild such floors so continued runs can navigate again.
    this.game.ensureNavigableDungeon();

    // A dungeon save that somehow lost its layout (rooms empty, or the saved
    // map is the overworld-sized surface rather than a dungeon map) would
    // strand the party in a layoutless void. Regenerate the floor from the
    // fixed-map seed — same layout as the original delve.
    if (this.game.inDungeon && this.game.rooms.length === 0) {
      this.game.rebuildLostDungeonFloor();
    }

    // Don't re-narrate the room we stand in after a restore.
    this.game.markRestoredRoomVisited();

    // HUD
    this.game.hud.setDungeonLevel(this.game.dungeonLevel);
    const locationName = this.game.inDungeon ? this.game.dungeonName : (this.game.currentTown?.name ?? 'The Wilderlands');
    this.game.hud.setDungeonTitle(`${this.game.party.partyName} — ${locationName}`);
    this.game.hud.setParty(this.game.party);
    this.game.clearTravelPlans();
    // Coming back to a town (or an old save that reaches one) opens the panel.
    if (this.game.inTown) this.game.hud.townPanel.show();
  }
}

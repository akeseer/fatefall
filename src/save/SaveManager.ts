import type { StoryState } from '../story/Story';
import type { PersonalQuest } from '../events/PersonalQuests';
import type { DmPolicies } from '../ai/DmPolicies';
/**
 * Save / load — persists runs between sessions in up to three named slots.
 *
 * Each slot is a plain-JSON-safe description of everything mutable in the
 * game: the tile map, rooms, party members, monsters, dungeon state, camera,
 * DM orders, and live combat engine state. Class/race/template references are
 * stored by id and re-resolved on load. The `version` field guards the schema
 * so future rule changes (e.g. real spell slots, death saves) can migrate or
 * invalidate old saves instead of corrupting them.
 */

import { TileType } from '../world/TileMap';
import { Room } from '../world/DungeonGenerator';
import { InventoryItem, Personality } from '../entities/Character';
import { ActiveCondition } from '../rules/Rules';
import { Direction, Vector2 } from '../engine/types';
import { Ability, maxSlotsFor } from '../data/gameData';
import { SavedTrap } from '../traps/Traps';
import { OverworldEntrance, OverworldTown } from '../world/Overworld';
import { WorldRegion } from '../world/WorldRegions';
import { Wanderer } from '../world/OverworldLife';
import { OverworldPOI } from '../world/OverworldPOI';
import { Quest } from '../quests/Quests';
import { TownLifeState } from '../world/TownLife';
import { BanditCampState } from '../quests/BanditCamps';

export const SAVE_SLOT_COUNT = 3;
/** Key used by the original single-slot implementation; migrated to slot 1. */
export const LEGACY_SAVE_KEY = 'rpg-ai-party-save-v1';
export const SAVE_VERSION = 17;

export interface SavedCharacter {
  id: string;
  name: string;
  classId: string;
  raceId: string;
  abilities: Record<Ability, number>;
  level: number;
  xp: number;
  hp: number;
  ac: number;
  speed: number;
  tile: Vector2;
  direction: string;
  inventory: InventoryItem[];
  gold: number;
  isDead: boolean;
  stabilized: boolean;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  exhaustion: number;
  baseMaxHp: number;
  conditions: ActiveCondition[];
  concentration?: { spellName: string; sourceId: string } | null;
  maxHitDice: number;
  hitDiceRemaining: number;
  maxSpellSlots: Record<number, number>;
  spellSlots: Record<number, number>;
  knownSpells: string[];
  pendingConcentrationBreak: boolean;
  /** Vendetta ledger (v6+): monster template ids this hero was downed by → times. */
  vendettas?: Record<string, number>;
  /** Combat-ability uses remaining this rest (v6+). */
  abilityUses?: Record<string, number>;
  /** The class resource pool (mana, stamina, ki, focus). Absent means full. v14+. */
  resource?: number;
  personality: Personality;
  subclass?: string;
  deity?: string;
  background?: string;
  alignment?: string;
  bonusAttackBonus?: number;
  /** Equipped gear (v8+). Items are out of the inventory while equipped. */
  equipment?: {
    weapon?: InventoryItem;
    armor?: InventoryItem;
    shield?: InventoryItem;
    trinket?: InventoryItem;
  };
}

export interface SavedMonster {
  id: string;
  templateId: string;
  tile: Vector2;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  alertLevel: number;
  patrolPoints: Vector2[];
  patrolIndex: number;
  conditions: ActiveCondition[];
}

export interface SavedCombat {
  isActive: boolean;
  currentTurnIndex: number;
  partyBlessRounds: number;
  blessSourceId: string;
  initiative: { kind: 'char' | 'monster'; id: string }[];
  /** Boss legendary actions left this round — monster id → actions (optional, v3+). */
  legendary?: Record<string, number>;
}

export interface SaveData {
  version: number;
  savedAt: number;
  dungeonLevel: number;
  dungeonName: string;
  /** The dungeon's location theme id (re-resolved on load). */
  dungeonThemeId?: string;
  /** Optional: the party's accumulated chronicle for atmospheric narration. */
  history?: {
    kills: number;
    victories: number;
    defeats: number;
    roomsVisited: number;
    deepestLevel: number;
    /** Bestiary ledger — monster template id → lifetime kills of that kind. */
    killLedger?: Record<string, number>;
  };
  /** Optional: a fated Luck die banked by a DM roll, spent on the next party d20 roll. */
  luckDie?: { value: number; source: string } | null;
  /** Numeric GameMode value (0 overworld, 1 town, 2 dungeon) — v4+. */
  mode?: number;
  /** Numeric GamePhase value. */
  phase: number;
  monsterIdCounter: number;
  dmStance: 'auto' | 'aggressive' | 'cautious';
  dmDirection: Direction | null;
  /** How the run is played: the party runs itself, or the player commands each fight and each room. v12+. */
  runMode?: 'auto' | 'manual';
  /** Hardcore: a dead adventurer is gone for good, and a dead party ends the run. v12+. */
  hardcore?: boolean;
  /** The main quest: seed, act, flags and journal. Absent on older runs, which begin the tale on load. v13+. */
  story?: StoryState | null;
  /** Each member's own road (debt, rival, heirloom, pilgrimage). Absent on older runs, which are dealt theirs on load. v15+. */
  personalQuests?: PersonalQuest[];
  /** Standing orders: how the party answers tolls and parleys without being asked. v16+. */
  dmPolicies?: DmPolicies;
  /** Named tallies of things done (riddles, parleys, bosses...), for achievements. v17+. */
  counters?: Record<string, number>;
  /** Achievement ids earned. v17+. */
  achievements?: string[];
  /** The DM's notebook. v17+. */
  notes?: string[];
  /** Members lost for good, for the epitaphs on the title. v17+. */
  fallen?: { name: string; className: string; level: number; where: string; day: number }[];
  /** GameSpeed value (0.25 | 0.5 | 1 | 2 | 4). */
  speed: number;
  camera: { x: number; y: number; targetX: number; targetY: number };
  map: {
    width: number;
    height: number;
    tiles: TileType[][];
    explored: boolean[][];
  };
  rooms: Room[];
  traps: SavedTrap[];
  party: {
    leaderIndex: number;
    formation: Vector2[];
    members: SavedCharacter[];
  };
  monsters: SavedMonster[];
  combat: SavedCombat | null;
  /** The overworld world state (v4+). */
  overworld?: {
    width: number;
    height: number;
    tiles: TileType[][];
    explored: boolean[][];
    towns: OverworldTown[];
    entrances: OverworldEntrance[];
    spawnTownId: string;
    /** Named regional atlas (v11+); older saves regenerate it on load. */
    regions?: WorldRegion[];
  } | null;
  /** Wandering life on the overworld (v4+). */
  wanderers?: Wanderer[];
  /** The town's quest board (v4+). */
  quests?: Quest[];
  /** Currently accepted quest (v4+). */
  activeQuestId?: string | null;
  /** Custom name for the adventuring party. */
  partyName?: string;
  /** Which dungeon entrance the party is currently inside (v4+). */
  dungeonEntranceId?: string | null;
  /** The living pulse of towns: rumors, festivals, caravans (v5+). */
  townLife?: TownLifeState | null;
  /** Discovered bandit camps and pending clues (v6+). */
  banditCamps?: BanditCampState | null;
  /** Points of Interest on the overworld (v7+). */
  pois?: OverworldPOI[];
  /** Expedition journal entries (v7+). */
  expeditionJournal?: string[];
  /** Current weather state (v7+). */
  weather?: import('../world/WeatherSystem').WeatherState;
  /** Whether the party forged a silvered weapon (v7+). */
  silveredWeapon?: boolean;
  /** Smith moon-contract tier, 0 = none (v7+). */
  moonForgeLevel?: number;
  /** Whether the hidden moon-forge remade the blade legendary (v7+). */
  moonForgeBlade?: boolean;
  /** Day/night clock phase in [0,1) (v8+). */
  clockPhase?: number;
  /** Day/night clock continuous elapsed ms (v8+). */
  clockElapsed?: number;
  /** Treasures hauled out this run, for fetch quests (v9+). */
  treasuresFound?: number;
  /** The floor's delve mood and its live effects (v10+). */
  delveMood?: { icon: string; label: string; effects: string[] } | null;
  /** Which town the party is standing in (v10+); guessed from quests before that. */
  currentTownId?: string | null;
  /** Whether this floor's boss is already dead, for slay-boss quests (v10+). */
  bossSlainThisFloor?: boolean;
}

function slotKey(slot: number): string {
  return `${LEGACY_SAVE_KEY}-slot-${slot}`;
}

export function saveToSlot(slot: number, data: SaveData): boolean {
  try {
    localStorage.setItem(slotKey(slot), JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('Failed to save game:', err);
    return false;
  }
}

export function loadFromSlot(slot: number): SaveData | null {
  try {
    const raw = localStorage.getItem(slotKey(slot));
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    return migrateSave(data);
  } catch (err) {
    console.error('Failed to load game:', err);
    return null;
  }
}

/** The pre-death-save schema (plain HP, no death state or exhaustion). */
interface SavedCharacterV1 {
  id: string;
  name: string;
  classId: string;
  raceId: string;
  abilities: Record<Ability, number>;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  ac: number;
  speed: number;
  tile: Vector2;
  direction: string;
  inventory: InventoryItem[];
  gold: number;
  isAlive: boolean;
  conditions: ActiveCondition[];
  concentration?: { spellName: string; sourceId: string } | null;
  maxHitDice: number;
  hitDiceRemaining: number;
  maxSpellUses: number;
  spellUsesRemaining: number;
  spellSlots: Record<number, number>;
  knownSpells: string[];
  pendingConcentrationBreak: boolean;
  /** Vendetta ledger (v6+): monster template ids this hero was downed by → times. */
  vendettas?: Record<string, number>;
  /** Combat-ability uses remaining this rest (v6+). */
  abilityUses?: Record<string, number>;
  personality: Personality;
  subclass?: string;
  deity?: string;
  background?: string;
  alignment?: string;
}

interface SaveDataV1 {
  version: 1;
  savedAt: number;
  dungeonLevel: number;
  dungeonName: string;
  phase: number;
  monsterIdCounter: number;
  dmStance: 'auto' | 'aggressive' | 'cautious';
  dmDirection: Direction | null;
  speed: number;
  camera: { x: number; y: number; targetX: number; targetY: number };
  map: { width: number; height: number; tiles: TileType[][]; explored: boolean[][] };
  rooms: Room[];
  party: { leaderIndex: number; formation: Vector2[]; members: SavedCharacterV1[] };
  monsters: SavedMonster[];
  combat: SavedCombat | null;
}

/** Upgrade older save schemas to the current version, or reject unknown ones. */
export function migrateSave(data: SaveData): SaveData | null {
  if (!data || typeof data.version !== 'number') return null;
  if (data.version === SAVE_VERSION) return data;

  let current: SaveData | null = data;
  if (current.version === 1) current = migrateV1toV2(current);
  if (!current) return null;
  if (current.version === 2) current = migrateV2toV3(current);
  if (!current) return null;
  if (current.version === 3) current = migrateV3toV4(current);
  if (!current) return null;
  if (current.version === 4) current = migrateV4toV5(current);
  if (!current) return null;
  if (current.version === 5) current = migrateV5toV6(current);
  if (!current) return null;
  if (current.version === 6) current = migrateV6toV7(current);
  if (!current) return null;
  if (current.version === 7) current = migrateV7toV8(current);
  if (!current) return null;
  if (current.version === 8) current = migrateV8toV9(current);
  if (!current) return null;
  if (current.version === 9) current = migrateV9toV10(current);
  if (!current) return null;
  if (current.version === 10) current = migrateV10toV11(current);
  if (!current) return null;
  if (current.version === 11) current = migrateV11toV12(current);
  if (!current) return null;
  if (current.version === 12) current = migrateV12toV13(current);
  if (!current) return null;
  if (current.version === 13) current = migrateV13toV14(current);
  if (!current) return null;
  if (current.version === 14) current = migrateV14toV15(current);
  if (!current) return null;
  if (current.version === 15) current = migrateV15toV16(current);
  if (!current) return null;
  if (current.version === 16) current = migrateV16toV17(current);
  return current;
}

/** v16 → v17: tallies, achievements, the notebook and the fallen. Absent means empty. */
function migrateV16toV17(data: SaveData): SaveData | null {
  return { ...data, version: 17 };
}

/** v15 → v16: standing orders. Absent means the party decides each time, as before. */
function migrateV15toV16(data: SaveData): SaveData | null {
  return { ...data, version: 16 };
}

/** v14 → v15: personal quests. An older run has none yet; restore deals them. */
function migrateV14toV15(data: SaveData): SaveData | null {
  return { ...data, version: 15 };
}

/** v13 → v14: skill resource pools. Absent means full, which is what a rest would give. */
function migrateV13toV14(data: SaveData): SaveData | null {
  return { ...data, version: 14 };
}

/** v12 → v13: the story. An older run has none, and begins the tale where it stands. */
function migrateV12toV13(data: SaveData): SaveData | null {
  return { ...data, version: 13 };
}

/** v11 → v12: the run mode and hardcore flag. Older runs were auto and forgiving, which is what the absent fields mean. */
function migrateV11toV12(data: SaveData): SaveData | null {
  return { ...data, version: 12 };
}

/** v6 → v7: seed the day/night clock for older saves. */
function migrateV6toV7(data: SaveData): SaveData | null {
  const STAMP = 180_000;
  const s: SaveData = { ...data, version: 7 };
  if (typeof s.clockPhase !== 'number') s.clockPhase = 0.3; // late morning
  if (typeof s.clockElapsed !== 'number') s.clockElapsed = 0.3 * STAMP;
  return s as SaveData;
}

/** v10 → v11: named overworld regions are regenerated when absent. */
function migrateV10toV11(data: SaveData): SaveData | null {
  return { ...data, version: 11 };
}

/**
 * v9 → v10: the delve mood, the town the party stands in, and whether this
 * floor's boss is dead are now persisted. Older saves simply restore without
 * them, exactly as they behaved before: no mood, the town re-guessed from the
 * quest giver, and the floor's boss assumed still alive.
 */
function migrateV9toV10(data: SaveData): SaveData | null {
  return { ...data, version: 10 };
}

/**
 * v8 → v9: bulletin tasks must be taken on before they track progress. Older
 * saves have boards full of tasks with no `accepted` flag; they read as not
 * taken, which is the correct starting state.
 */
function migrateV8toV9(data: SaveData): SaveData | null {
  const s: SaveData = { ...data, version: 9 };
  const townLife = s.townLife as any;
  if (townLife?.byTown) {
    for (const entry of Object.values(townLife.byTown) as any[]) {
      for (const task of entry?.bulletinTasks ?? []) {
        if (typeof task.accepted !== 'boolean') task.accepted = false;
      }
    }
  }
  return s;
}

/** v7 → v8: equipment system. Older saves simply start with empty gear. */
function migrateV7toV8(data: SaveData): SaveData | null {
  const s: SaveData = { ...data, version: 8 };
  return s as SaveData;
}

function migrateV3toV4(data: SaveData): SaveData | null {
  // v3 dungeon-only saves: the surface world is generated lazily on restore
  // (restore() stays in the dungeon when `overworld` is absent).
  return { ...data, version: 4 };
}

function migrateV4toV5(data: SaveData): SaveData | null {
  // v4 saves predate town life — restore() seeds fresh rumors/festivals.
  return { ...data, version: 5 };
}

function migrateV5toV6(data: SaveData): SaveData | null {
  // v5 saves predate bandit camps and quest-giver reputation.
  return { ...data, version: 6 };
}

function migrateV1toV2(data: SaveData): SaveData | null {
  if (data.version !== 1) return data;
  const v1 = data as unknown as SaveDataV1;
  return {
    ...v1,
    version: 2,
    traps: (v1 as any).traps ?? [],
    party: {
      ...v1.party,
      members: v1.party.members.map(m => ({
        ...m,
        isDead: !m.isAlive,
        stabilized: false,
        deathSaveSuccesses: 0,
        deathSaveFailures: 0,
        exhaustion: 0,
        baseMaxHp: m.maxHp,
      })),
    },
  } as unknown as SaveData;
}

function migrateV2toV3(data: SaveData): SaveData {
  return {
    ...data,
    version: 3,
    traps: data.traps ?? [],
    party: {
      ...data.party,
      members: data.party.members.map(m => {
        // v2 tracked pooled spell uses; grant full per-level slots based on
        // class and level so migrated casters can actually cast.
        const table = maxSlotsFor(m.classId, m.level);
        const maxSpellSlots: Record<number, number> = {};
        for (let lvl = 1; lvl <= 9; lvl++) {
          if (table[lvl - 1] > 0) maxSpellSlots[lvl] = table[lvl - 1];
        }
        return {
          ...m,
          maxSpellSlots,
          spellSlots: { ...maxSpellSlots },
        };
      }),
    },
  } as SaveData;
}

export function clearSlot(slot: number): void {
  try {
    localStorage.removeItem(slotKey(slot));
  } catch (err) {
    console.error('Failed to clear save:', err);
  }
}

/** All slots in order; null means empty. Migrates the legacy single save into slot 1. */
export function listSaves(): (SaveData | null)[] {
  try {
    const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
    if (legacy && !localStorage.getItem(slotKey(0))) {
      localStorage.setItem(slotKey(0), legacy);
      localStorage.removeItem(LEGACY_SAVE_KEY);
    }
  } catch (err) {
    console.error('Failed to migrate legacy save:', err);
  }
  return [0, 1, 2].map(slot => loadFromSlot(slot));
}

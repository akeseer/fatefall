/**
 * Trap and dungeon-hazard system — D&D-style detection, disarming, and
 * triggering, wired into real ability checks and saving throws.
 *
 * A trap lives on a single tile. It can be hidden (undetected), detected
 * (the party can see it and try to disarm it), or disarmed/spent (harmless).
 * Stepping onto an armed trap forces a saving throw from whoever triggers it.
 */

import { Ability, rollDice } from '../data/gameData';
import { GameCharacter } from '../entities/Character';
import { consumeLuckDieIfAny } from '../rules/LuckDie';
import { Monster } from '../entities/Monster';
import { pushDiceRoll } from '../rules/DiceEvents';
import { Room } from '../world/DungeonGenerator';
import { TileMap, TileType } from '../world/TileMap';
import { Vector2 } from '../engine/types';

// ── Trap kinds ───────────────────────────────────────

export type TrapEffect = {
  /** Saving throw ability used to resist (or reduce) the trap. */
  ability: Ability;
  /** Damage dice rolled on a failed save. 0 = no direct damage. */
  dice: string; // e.g. "2d10"
  /** Damage type for narration. */
  damageType: string;
  /** Condition applied on a failed save, if any. */
  condition?: { id: Parameters<GameCharacter['applyCondition']>[0]; name: string; turns: number };
};

export interface TrapKind {
  id: string;
  name: string;
  /** Perception DC to notice the trap before stepping on it. */
  detectDc: number;
  /** Thieves' tools / Dexterity DC to safely disable it. */
  disarmDc: number;
  /** Saving throw DC against the trap's effect. */
  saveDc: number;
  effect: TrapEffect;
  /** Flavor line shown when it goes off. */
  triggerText: string;
}

export const TRAP_KINDS: TrapKind[] = [
  {
    id: 'spiked_pit', name: 'Spiked Pit', detectDc: 15, disarmDc: 13, saveDc: 12,
    effect: { ability: 'dex', dice: '2d10', damageType: 'piercing' },
    triggerText: 'the floor gives way beneath a spiked pit!',
  },
  {
    id: 'poison_dart', name: 'Poison Dart Trap', detectDc: 13, disarmDc: 13, saveDc: 12,
    effect: { ability: 'dex', dice: '1d4+2', damageType: 'piercing', condition: { id: 'poisoned', name: 'Poisoned', turns: 2 } },
    triggerText: 'a poisoned dart whistles from a seam in the wall!',
  },
  {
    id: 'crushing_wall', name: 'Crushing Wall', detectDc: 12, disarmDc: 14, saveDc: 13,
    effect: { ability: 'dex', dice: '4d6', damageType: 'bludgeoning' },
    triggerText: 'stone slabs slam together from either side!',
  },
  {
    id: 'lightning_glyph', name: 'Lightning Glyph', detectDc: 14, disarmDc: 14, saveDc: 13,
    effect: { ability: 'dex', dice: '4d8', damageType: 'lightning' },
    triggerText: 'a rune flares and lightning scorches the corridor!',
  },
  {
    id: 'collapsing_ceiling', name: 'Collapsing Ceiling', detectDc: 12, disarmDc: 12, saveDc: 13,
    effect: { ability: 'dex', dice: '3d10', damageType: 'bludgeoning' },
    triggerText: 'the ceiling buckles and comes down in a roar of stone!',
  },
  {
    id: 'scything_blade', name: 'Scything Blade', detectDc: 13, disarmDc: 13, saveDc: 12,
    effect: { ability: 'dex', dice: '3d6', damageType: 'slashing' },
    triggerText: 'a crescent blade sweeps out of the wall at waist height!',
  },
  {
    id: 'acid_spray', name: 'Acid Spray', detectDc: 13, disarmDc: 13, saveDc: 12,
    effect: { ability: 'dex', dice: '3d6', damageType: 'acid' },
    triggerText: 'a brass nozzle hisses and douses the path in acid!',
  },
  {
    id: 'sleep_gas', name: 'Sleep Gas Chamber', detectDc: 14, disarmDc: 14, saveDc: 12,
    effect: { ability: 'con', dice: '0', damageType: 'none', condition: { id: 'unconscious', name: 'Unconscious', turns: 2 } },
    triggerText: 'sweet-smelling gas floods the chamber!',
  },
  {
    id: 'rolling_boulder', name: 'Rolling Boulder', detectDc: 12, disarmDc: 12, saveDc: 13,
    effect: { ability: 'dex', dice: '4d10', damageType: 'bludgeoning' },
    triggerText: 'a stone boulder rumbles down the passage!',
  },
  {
    id: 'teleport_circle', name: 'Teleportation Circle', detectDc: 15, disarmDc: 14, saveDc: 13,
    effect: { ability: 'wis', dice: '2d6', damageType: 'psychic', condition: { id: 'stunned', name: 'Stunned', turns: 1 } },
    triggerText: 'the floor glyphs blaze and space itself folds around the party!',
  },
];

export function getTrapKind(id: string): TrapKind | undefined {
  return TRAP_KINDS.find(k => k.id === id);
}

// ── Placed traps ─────────────────────────────────────

export interface PlacedTrap {
  id: string;
  kindId: string;
  tile: Vector2;
  /** The party has noticed it (visible marker, can be disarmed). */
  detected: boolean;
  /** Disarmed or already spent — no longer dangerous. */
  disarmed: boolean;
}

/** Serialisable form (persisted to the save). */
export type SavedTrap = PlacedTrap;

// ── Placement ────────────────────────────────────────

function tileInRoom(tile: Vector2, rooms: Room[]): boolean {
  return rooms.some(r =>
    tile.x >= r.x && tile.x < r.x + r.width &&
    tile.y >= r.y && tile.y < r.y + r.height
  );
}

/**
 * Seed the map with traps: corridors are the classic ambush spots, with a
 * few hidden inside rooms. Count scales with dungeon depth.
 */
export function placeTraps(
  map: TileMap,
  rooms: Room[],
  monsters: Monster[],
  dungeonLevel: number,
): PlacedTrap[] {
  const traps: PlacedTrap[] = [];
  if (rooms.length < 2) return traps;

  const occupied = new Set(monsters.map(m => `${m.tile.x},${m.tile.y}`));
  const startRoom = rooms[0];

  // Corridor tiles (not inside any room) are prime trap real estate.
  const corridorTiles: Vector2[] = [];
  const roomTiles: Vector2[] = [];
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (map.getTile(x, y) !== TileType.Floor) continue;
      const inStart = x >= startRoom.x && x < startRoom.x + startRoom.width &&
                      y >= startRoom.y && y < startRoom.y + startRoom.height;
      if (inStart || occupied.has(`${x},${y}`)) continue;
      const pos = { x, y };
      if (tileInRoom(pos, rooms)) roomTiles.push(pos);
      else corridorTiles.push(pos);
    }
  }

  const count = Math.min(12, 2 + Math.floor(dungeonLevel * 1.5));
  let idCounter = 0;
  const pickSpot = () => {
    // ~70% corridors, ~30% rooms (when available).
    if (corridorTiles.length > 0 && (roomTiles.length === 0 || Math.random() < 0.7)) {
      const idx = Math.floor(Math.random() * corridorTiles.length);
      return corridorTiles.splice(idx, 1)[0];
    }
    if (roomTiles.length > 0) {
      const idx = Math.floor(Math.random() * roomTiles.length);
      return roomTiles.splice(idx, 1)[0];
    }
    return null;
  };

  for (let i = 0; i < count; i++) {
    const spot = pickSpot();
    if (!spot) break;
    const kind = TRAP_KINDS[Math.floor(Math.random() * TRAP_KINDS.length)];
    traps.push({
      id: `trap_${++idCounter}`,
      kindId: kind.id,
      tile: spot,
      detected: false,
      disarmed: false,
    });
  }

  return traps;
}

// ── Detection ────────────────────────────────────────

/**
 * Passive Perception: 10 + WIS modifier (scouts — rogues/rangers — add
 * their proficiency bonus). Returns the party's best passive score.
 */
export function bestPassivePerception(members: GameCharacter[]): { member: GameCharacter; score: number } | null {
  let best: { member: GameCharacter; score: number } | null = null;
  for (const m of members) {
    if (!m.isAlive) continue;
    let score = 10 + m.wisMod;
    if (['rogue', 'ranger'].includes(m.charClass.id)) score += m.profBonus;
    if (!best || score > best.score) best = { member: m, score };
  }
  // Null when nobody can look: the old fallback handed back members[0] even if
  // that member was a corpse, or undefined for an empty party, which callers
  // then read straight through.
  return best;
}

/** A member rolls a Wisdom (Perception) check to actively search. */
export function rollPerception(member: GameCharacter): { natural: number; total: number } {
  const natural = consumeLuckDieIfAny(member.name)?.value ?? Math.floor(Math.random() * 20) + 1;
  let mod = member.wisMod;
  if (['rogue', 'ranger'].includes(member.charClass.id)) mod += member.profBonus;
  const total = natural + mod;
  pushDiceRoll({
    kind: 'check',
    diceType: 'd20',
    label: `${member.name} searches for traps`,
    expression: `d20${mod >= 0 ? '+' : ''}${mod}`,
    rolls: [natural],
    total,
    outcome: natural === 20 ? 'crit' : natural === 1 ? 'fumble' : total >= 15 ? 'success' : 'neutral',
  });
  return { natural, total };
}

/** A member attempts to disable a trap with Dexterity (Thieves' tools). */
export function rollDisarm(member: GameCharacter, trap: PlacedTrap, kind: TrapKind): {
  success: boolean;
  criticalFailure: boolean;
  natural: number;
  total: number;
} {
  const natural = consumeLuckDieIfAny(member.name)?.value ?? Math.floor(Math.random() * 20) + 1;
  let mod = member.dexMod;
  if (member.charClass.id === 'rogue') mod += member.profBonus;
  const total = natural + mod;
  pushDiceRoll({
    kind: 'check',
    diceType: 'd20',
    label: `${member.name} disarms ${kind.name} (DC ${kind.disarmDc})`,
    expression: `d20${mod >= 0 ? '+' : ''}${mod}`,
    rolls: [natural],
    total,
    outcome: natural === 20 ? 'crit' : natural === 1 ? 'fumble' : total >= kind.disarmDc ? 'success' : 'failure',
  });
  return {
    success: total >= kind.disarmDc,
    criticalFailure: natural === 1 || total < kind.disarmDc - 5,
    natural,
    total,
  };
}

// ── Triggering ───────────────────────────────────────

export interface TrapTriggerResult {
  /** Narrative lines describing what happened. */
  messages: string[];
  /** Members hurt or affected. */
  casualties: string[];
}

function parseDice(expr: string): { count: number; sides: number; bonus: number } {
  const m = expr.match(/(\d+)d(\d+)([+-]\d+)?/);
  if (!m) return { count: 0, sides: 0, bonus: 0 };
  return { count: parseInt(m[1]), sides: parseInt(m[2]), bonus: parseInt(m[3] || '0') };
}

/**
 * A member steps on an armed trap. Roll the trap's saving throw; on a
 * failure apply full damage (and any condition), on a success half damage.
 */
export function triggerTrap(trap: PlacedTrap, victim: GameCharacter): TrapTriggerResult {
  const kind = getTrapKind(trap.kindId)!;
  const messages: string[] = [];
  const casualties: string[] = [];

  messages.push(`${victim.name} triggers the ${kind.name} — ${kind.triggerText}`);

  const save = victim.makeSavingThrow(kind.effect.ability, kind.saveDc);
  const { count, sides, bonus } = parseDice(kind.effect.dice);
  const damage = count > 0 ? rollDice(count, sides) + bonus : 0;

  let took = 0;
  if (save.success) {
    took = Math.max(0, Math.floor(damage / 2));
    messages.push(
      `${victim.name} throws themselves clear of the worst of it (${kind.effect.ability.toUpperCase()} ${save.total} vs DC ${kind.saveDc}), taking ${took} ${kind.effect.damageType} damage.`
    );
  } else {
    took = damage;
    messages.push(
      `${victim.name} fails to escape (${kind.effect.ability.toUpperCase()} ${save.total} vs DC ${kind.saveDc}) and takes ${took} ${kind.effect.damageType} damage.`
    );
  }

  if (took > 0) {
    messages.push(victim.takeDamage(took));
    casualties.push(victim.name);
  }

  if (kind.effect.condition && !save.success) {
    victim.applyCondition(kind.effect.condition.id, kind.effect.condition.turns, kind.effect.condition.name, trap.id);
    messages.push(`${victim.name} is ${kind.effect.condition.name.toLowerCase()}!`);
  }

  // The trap is spent.
  trap.disarmed = true;
  trap.detected = true;

  return { messages, casualties };
}

// ── Passive detection sweep ──────────────────────────

/**
 * Mark any undetected trap within `radius` of the leader whose detect DC the
 * party's best passive Perception meets or beats. Returns narration lines.
 */
export function sweepDetection(
  traps: PlacedTrap[],
  members: GameCharacter[],
  origin: Vector2,
  radius: number,
): string[] {
  const best = bestPassivePerception(members);
  // A party with nobody conscious spots nothing.
  if (!best) return [];
  const messages: string[] = [];
  for (const trap of traps) {
    if (trap.detected || trap.disarmed) continue;
    const dist = Math.max(Math.abs(trap.tile.x - origin.x), Math.abs(trap.tile.y - origin.y));
    if (dist > radius) continue;
    const kind = getTrapKind(trap.kindId)!;
    if (best.score >= kind.detectDc) {
      trap.detected = true;
      messages.push(`${best.member.name} spots a ${kind.name} lurking at (${trap.tile.x}, ${trap.tile.y})!`);
    }
  }
  return messages;
}

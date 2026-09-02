/**
 * BanditCamps — after defeating bandits on the overworld, there's a chance
 * they drop a "clue" (a map, a letter, a confession) that reveals a hidden
 * bandit camp nearby. The party can then raid it (combat encounter with bonus
 * loot) or report it to a town for a guaranteed gold reward and reputation.
 *
 * Camps are generated on the overworld near roads, hidden until discovered.
 */

import { Vector2 } from '../engine/types';
import { Overworld, OverworldTown } from '../world/Overworld';
import { TileMap, TileType } from '../world/TileMap';

export interface BanditCamp {
  id: string;
  /** Where the camp sits on the overworld (near a road). */
  tile: Vector2;
  /** The town it's closest to (for reporting). */
  nearestTownId: string;
  /** Whether the party has found the camp. */
  discovered: boolean;
  /** Whether the camp has been raided or reported (exhausted). */
  resolved: boolean;
  /** Loot quality tier based on the bandit captain's CR that dropped the clue. */
  tier: 1 | 2 | 3;
  /** How the camp was discovered. */
  discoveryMethod: 'clue' | 'rumor';
  /** Flavor text for the camp. */
  description: string;
  /** Gold reward for reporting the camp to authorities. */
  reportReward: number;
}

export interface BanditCampState {
  camps: BanditCamp[];
  /** Accumulated clue drops — the party's current clue inventory. */
  clues: BanditClue[];
}

export interface BanditClue {
  id: string;
  /** The camp this clue points to. */
  campId: string;
  /** The bandit captain's name who dropped it. */
  sourceName: string;
  /** Gold reward for reporting the camp. */
  reportReward: number;
  /** Tier of the camp (affects raid difficulty and loot). */
  tier: 1 | 2 | 3;
  /** Description of the clue item. */
  description: string;
  /** Whether this clue has been acted upon (raid or report). */
  resolved: boolean;
}

const CLUE_DESCRIPTIONS: Record<number, string[]> = {
  1: [
    'A crumpled map scrawled in charcoal — someone marked a camp in the {biome}.',
    'A torn note: "Meet at the camp. Bring the goods." A crude X marks a spot in the {biome}.',
    'A bandit\'s belt pouch contains a folded map to a hideout in the {biome}.',
  ],
  2: [
    'A leather-bound ledger listing goods stolen and hidden at a camp in the {biome}.',
    'A silver signet ring engraved with a camp symbol — it hums faintly, pointing toward the {biome}.',
    'A captured bandit whispers the location of their camp in the {biome} before expiring.',
  ],
  3: [
    'A captain\'s journal details a major operation — a fortified camp in the {biome} with significant treasure.',
    'A blood-stained map with military precision — the camp layout, guard rotations, and a vault location in the {biome}.',
    'A dying bandit captain gasps coordinates: "The camp... in the {biome}... gold beyond your wildest dreams..."',
  ],
};

const CAMP_DESCRIPTIONS: Record<number, string[]> = {
  1: [
    'A rough clearing with three lean-tos and a smoldering fire. Scraps of stolen goods litter the ground.',
    'A dilapidated shelter hidden behind a fallen tree. Bandit supplies are stacked in oilskin bundles.',
    'A temporary camp — bedrolls, rusted weapons, and a half-eaten meal. The bandits fled in a hurry.',
  ],
  2: [
    'A well-organized camp with watch posts and a supply cache. These bandits meant business.',
    'A stone-walled shelter with iron-bound chests and a weapons rack. The captain\'s tent has a map table.',
    'A hidden cave entrance with a timber door. Inside: stolen goods, coin pouches, and a locked strongbox.',
  ],
  3: [
    'A fortified camp with wooden palisades, watchtowers, and a central stronghold. This was no mere bandit gang.',
    'A sprawling hideout built into the hillside. Multiple tunnels, a mess hall, and a vault sealed with iron chains.',
    'A hidden fortress — the bandits built something permanent here. The vault contains accumulated plunder.',
  ],
};

/**
 * Find a walkable tile near a road for a bandit camp.
 */
function findCampTile(map: TileMap, overworld: Overworld, partyTile?: Vector2): Vector2 | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    // Start near a random road tile
    const rx = Math.floor(Math.random() * map.width);
    const ry = Math.floor(Math.random() * map.height);
    if (map.getTile(rx, ry) !== TileType.Road) continue;

    // Scatter 3-8 tiles away from the road
    const angle = Math.random() * Math.PI * 2;
    const dist = 3 + Math.floor(Math.random() * 6);
    const cx = Math.round(rx + Math.cos(angle) * dist);
    const cy = Math.round(ry + Math.sin(angle) * dist);

    if (cx < 2 || cy < 2 || cx >= map.width - 2 || cy >= map.height - 2) continue;
    if (!map.isWalkable(cx, cy)) continue;
    // Don't place on roads or towns
    const t = map.getTile(cx, cy);
    if (t === TileType.Road || t === TileType.Bridge || t === TileType.Town) continue;
    // Don't place too close to any town
    if (overworld.towns.some(tn => Math.abs(tn.tile.x - cx) + Math.abs(tn.tile.y - cy) < 15)) continue;
    // Don't place too close to the party
    if (partyTile && Math.abs(partyTile.x - cx) + Math.abs(partyTile.y - cy) < 10) continue;

    return { x: cx, y: cy };
  }
  return null;
}

/**
 * Find the nearest town to a position.
 */
function nearestTownTo(overworld: Overworld, pos: Vector2): OverworldTown {
  let best = overworld.towns[0];
  let bestD = Infinity;
  for (const town of overworld.towns) {
    const d = Math.abs(town.tile.x - pos.x) + Math.abs(town.tile.y - pos.y);
    if (d < bestD) { bestD = d; best = town; }
  }
  return best;
}

/**
 * Generate a clue from a bandit victory. Called after a bandit ambush is won.
 * Returns null if no clue drops (based on chance + whether a captain was slain).
 */
export function rollBanditClue(
  slainIds: string[],
  partyLevel: number,
  map: TileMap,
  overworld: Overworld,
  state: BanditCampState,
  partyTile: Vector2,
): { clue: BanditClue; camp: BanditCamp } | null {
  // Higher chance: always if a captain was slain, otherwise 15% base
  const hadCaptain = slainIds.includes('bandit_captain');
  const chance = hadCaptain ? 1.0 : 0.15 + partyLevel * 0.02;
  if (Math.random() > chance) return null;

  // Find a camp location
  const tile = findCampTile(map, overworld, partyTile);
  if (!tile) return null;

  const tier: 1 | 2 | 3 = hadCaptain ? (partyLevel >= 5 ? 3 : 2) : 1;
  const nearest = nearestTownTo(overworld, tile);
  const biome = getBiomeName(map.getTile(tile.x, tile.y));

  const campId = `camp_${Math.random().toString(36).slice(2, 8)}`;
  const reportReward = tier === 1 ? 30 + Math.floor(Math.random() * 20)
    : tier === 2 ? 80 + Math.floor(Math.random() * 40)
    : 150 + Math.floor(Math.random() * 60);

  const camp: BanditCamp = {
    id: campId,
    tile,
    nearestTownId: nearest.id,
    discovered: true,
    resolved: false,
    tier,
    discoveryMethod: 'clue',
    description: pickRandom(CAMP_DESCRIPTIONS[tier]).replace('{biome}', biome),
    reportReward,
  };

  const clue: BanditClue = {
    id: `clue_${Math.random().toString(36).slice(2, 8)}`,
    campId,
    sourceName: hadCaptain ? 'a bandit captain' : 'a highwayman',
    reportReward,
    tier,
    description: pickRandom(CLUE_DESCRIPTIONS[tier]).replace('{biome}', biome),
    resolved: false,
  };

  state.camps.push(camp);
  state.clues.push(clue);
  return { clue, camp };
}

/**
 * Raid a bandit camp — returns the encounter difficulty and loot bonus.
 */
export function raidCamp(camp: BanditCamp, partyLevel: number): { monsterCount: number; maxCr: number; bonusLoot: number; narration: string } {
  const tierMul = camp.tier;
  const baseCount = tierMul === 1 ? 2 : tierMul === 2 ? 3 : 4;
  const monsterCount = baseCount + Math.floor(partyLevel / 3);
  const maxCr = tierMul * 1.5 + partyLevel * 0.4;
  const bonusLoot = camp.tier * 40 + Math.floor(Math.random() * camp.tier * 30);

  const narrations = [
    `The party storms the hidden camp — bandits scramble for weapons as the attack begins!`,
    `Arrows fly as the party charges into the camp — the bandits weren't expecting company.`,
    `The camp's watchman shouts a warning, but the party is already inside — steel meets steel.`,
  ];

  return { monsterCount, maxCr, bonusLoot, narration: pickRandom(narrations) };
}

/**
 * Report a camp to town — returns gold reward and reputation gains.
 */
export function reportCamp(
  camp: BanditCamp,
  overworld: Overworld,
): { gold: number; reputationBonus: number; narration: string } {
  const town = overworld.towns.find(t => t.id === camp.nearestTownId) ?? overworld.towns[0];
  const gold = camp.reportReward;
  const reputationBonus = camp.tier * 10;

  const narrations = [
    `The constable studies the map and nods grimly. "${gold} gold for the information — and the town's gratitude."`,
    `"Good work. The guard will handle the rest. Here's your reward — ${gold} gold, as promised."`,
    `The town guard mobilizes. The constable hands you a pouch: "${gold} gold. You've earned this."`,
  ];

  return { gold, reputationBonus, narration: pickRandom(narrations) };
}

function getBiomeName(tile: TileType): string {
  switch (tile) {
    case TileType.Forest: return 'the deep forest';
    case TileType.Swamp: return 'the marshlands';
    case TileType.Mountain: return 'the mountain foothills';
    case TileType.Desert: return 'the desert wastes';
    case TileType.Snow: return 'the frozen north';
    case TileType.Sand: return 'the shoreline';
    default: return 'the open plains';
  }
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

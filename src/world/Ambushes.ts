/**
 * Ambushes — the danger of the open road. While the party marches the
 * overworld, bandits waylay them on roads and bridges while the wilds hold
 * their own predators (wolf packs in the forest, marsh ghouls, mountain
 * orc-raiders, snow yeti…). Chance scales with how wild the terrain is, and
 * nothing stirs within a town's shadow.
 */

import { TileMap, TileType } from './TileMap';
import { MonsterTemplate, getMonsterTemplate } from '../entities/Monster';
import { Vector2 } from '../engine/types';

/** Per-tile-type chance (per overworld tick) that an ambush springs. */
const TERRAIN_RISK: Partial<Record<TileType, number>> = {
  [TileType.Road]: 0.012,
  [TileType.Bridge]: 0.01,
  [TileType.Grass]: 0.02,
  [TileType.Forest]: 0.035,
  [TileType.Swamp]: 0.04,
  [TileType.Desert]: 0.025,
  [TileType.Snow]: 0.03,
  [TileType.Sand]: 0.02,
};

/** Which encounter key the terrain maps to (roads → bandits). */
export function terrainKey(tile: TileType): string {
  if (tile === TileType.Road || tile === TileType.Bridge) return 'road';
  return tile === TileType.Forest ? 'forest'
    : tile === TileType.Swamp ? 'swamp'
    : tile === TileType.Desert ? 'desert'
    : tile === TileType.Snow ? 'snow'
    : tile === TileType.Sand ? 'sand'
    : 'grass';
}

/** True when a tile of the given type sits within `range` of the position. */
export function nearTileType(map: TileMap, pos: Vector2, type: TileType, range: number): boolean {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const x = pos.x + dx;
      const y = pos.y + dy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (map.getTile(x, y) === type) return true;
    }
  }
  return false;
}

/** A bandit gang for the roads. The captain shows up for tougher parties. */
export function banditGang(partyLevel: number): MonsterTemplate[] {
  const gang: MonsterTemplate[] = [bandit(), bandit()];
  if (partyLevel >= 2 && Math.random() < 0.6) gang.push(highwayman());
  if (partyLevel >= 3) gang.push(highwayman());
  if (partyLevel >= 4 && Math.random() < 0.7) gang.push(banditCaptain());
  else if (partyLevel >= 5) gang.push(banditCaptain());
  return gang;
}

function bandit(): MonsterTemplate { return getMonsterTemplate('bandit') ?? getMonsterTemplate('goblin')!; }
function highwayman(): MonsterTemplate { return getMonsterTemplate('highwayman') ?? bandit(); }
function banditCaptain(): MonsterTemplate { return getMonsterTemplate('bandit_captain') ?? getMonsterTemplate('orc')!; }

/** Wilds predators by terrain — classic monsters for each biome. */
const WILD_POOL: Record<string, string[]> = {
  grass: ['dire_wolf', 'giant_rat', 'gnoll', 'orc', 'goblin'],
  forest: ['dire_wolf', 'giant_spider', 'owlbear', 'displacer_beast', 'gnoll'],
  swamp: ['giant_spider', 'lizardfolk', 'ghoul', 'green_hag', 'shambling_mound'],
  mountain: ['orc', 'hobgoblin', 'harpy', 'griffon', 'wyvern'],
  desert: ['ankheg', 'giant_spider', 'mummy', 'basilisk'],
  snow: ['yeti', 'dire_wolf', 'remorhaz', 'young_white_dragon_monster'],
  sand: ['giant_spider', 'ankheg', 'giant_rat'],
};

function wildsEncounter(tile: TileType, partyLevel: number): MonsterTemplate[] {
  const key =
    tile === TileType.Forest ? 'forest'
    : tile === TileType.Swamp ? 'swamp'
    : tile === TileType.Mountain ? 'mountain'
    : tile === TileType.Desert ? 'desert'
    : tile === TileType.Snow ? 'snow'
    : tile === TileType.Sand ? 'sand'
    : 'grass';
  const pool = WILD_POOL[key];
  const maxCr = Math.max(0.25, partyLevel * 0.6);
  const candidates = pool
    .map(id => getMonsterTemplate(id))
    .filter((t): t is MonsterTemplate => !!t && t.cr <= maxCr + 0.5);
  const list = candidates.length > 0 ? candidates : pool.map(id => getMonsterTemplate(id)).filter((t): t is MonsterTemplate => !!t);
  const count = 1 + Math.floor(Math.random() * Math.min(3, 1 + Math.floor(partyLevel / 2)));
  const foes: MonsterTemplate[] = [];
  for (let i = 0; i < count; i++) {
    foes.push(list[Math.floor(Math.random() * list.length)]);
  }
  return foes;
}

export interface Ambush {
  templates: MonsterTemplate[];
  /** Line shouted as the trap springs — flavored by terrain and foes. */
  narration: string;
  kind: 'bandits' | 'wilds';
}

const BANDIT_NARRATIONS = [
  'Bandits burst from the roadside brush, blades drawn — “Your coin or your lives!”',
  'A rope snaps taut across the road and masked figures close in, cudgels swinging.',
  'Ragged highwaymen drop from the treeline, grinning — they have done this a hundred times.',
  'A shout rings out and a gang of cutthroats surrounds the party, demanding every last gold piece.',
];

const WILD_NARRATIONS: Record<string, string[]> = {
  forest: [
    'The trees come alive with snarls — a wolf pack has been shadowing the party, and now it strikes.',
    'Something huge crashes through the undergrowth: the forest has teeth.',
    'Eyes gleam between the trunks — the wilds do not welcome travelers.',
  ],
  swamp: [
    'The marsh erupts around them — the party is not alone in the mire.',
    'Bubbling mud parts and horrors rise from the reeds, drawn by the scent of warm blood.',
    'Croaking shapes lunge out of the fog — the swamp claims what wanders in.',
  ],
  mountain: [
    'Rocks clatter overhead and raiders pour down the scree, screaming war cries.',
    'The mountain pass narrows — and something has been waiting in the rocks.',
    'A shriek echoes off the crags as winged shapes wheel down toward the party.',
  ],
  desert: [
    'The dunes shift and burrowing things erupt from the sand around the party.',
    'Heat shimmers — and shapes detach from the mirage, closing in fast.',
    'A dry rasping hiss answers from the ruins: something old hunts the wastes.',
  ],
  snow: [
    'The white wastes are not empty — pale shapes lope out of the blizzard.',
    'Frost cracks underfoot as huge, shaggy forms rise from the snowdrifts.',
    'The wind carries a howl that is not the wind. The cold has teeth.',
  ],
  sand: [
    'Wet sand explodes as creatures surge from the shallows.',
    'Slick shapes slide out of the surf, chittering and hungry.',
  ],
  grass: [
    'The tall grass parts — predators have been stalking the party across the open land.',
    'A hunting pack breaks from the meadow cover with a chorus of snarls.',
    'Bones crunch underfoot: something has been feeding here, and it is not finished.',
  ],
};

/** Per-tick ambush chance for the leader's terrain, 0 inside town's shadow. */
export function getAmbushChance(
  map: TileMap,
  tile: TileType,
  pos: Vector2,
  nearTown: boolean,
): number {
  if (nearTown) return 0;
  const base = TERRAIN_RISK[tile] ?? 0.015;
  // Skirt the mountains and the wilds are wilder still.
  const extra = nearTileType(map, pos, TileType.Mountain, 3) ? 0.015 : 0;
  return base + extra;
}

/** Roll an ambush for where the leader stands. Null = clear road. */
export function rollAmbush(
  map: TileMap,
  tile: TileType,
  pos: Vector2,
  partyLevel: number,
): Ambush | null {
  const key = terrainKey(tile);
  // The mountains aren't walkable, but lurking near them is its own danger.
  const effectiveKey = key === 'grass' && nearTileType(map, pos, TileType.Mountain, 3) ? 'mountain' : key;
  const isRoad = effectiveKey === 'road';
  const kind: 'bandits' | 'wilds' = isRoad ? 'bandits' : 'wilds';
  const templates = isRoad ? banditGang(partyLevel) : wildsEncounterKey(effectiveKey, partyLevel);
  if (templates.length === 0) return null;

  let narration: string;
  if (kind === 'bandits') {
    narration = BANDIT_NARRATIONS[Math.floor(Math.random() * BANDIT_NARRATIONS.length)];
  } else {
    const lines = WILD_NARRATIONS[effectiveKey] ?? WILD_NARRATIONS.grass;
    narration = lines[Math.floor(Math.random() * lines.length)];
  }
  return { templates, narration, kind };
}

function wildsEncounterKey(key: string, partyLevel: number): MonsterTemplate[] {
  const pool = WILD_POOL[key] ?? WILD_POOL.grass;
  const maxCr = Math.max(0.25, partyLevel * 0.6);
  const candidates = pool
    .map(id => getMonsterTemplate(id))
    .filter((t): t is MonsterTemplate => !!t && t.cr <= maxCr + 0.5);
  const list = candidates.length > 0 ? candidates : pool.map(id => getMonsterTemplate(id)).filter((t): t is MonsterTemplate => !!t);
  const count = 1 + Math.floor(Math.random() * Math.min(3, 1 + Math.floor(partyLevel / 2)));
  const foes: MonsterTemplate[] = [];
  for (let i = 0; i < count; i++) {
    foes.push(list[Math.floor(Math.random() * list.length)]);
  }
  return foes;
}

/** Find an open tile near the party for an ambusher to stand on. */
export function findAmbushTiles(map: TileMap, leaderTile: Vector2, count: number): Vector2[] {
  const results: Vector2[] = [];
  const candidates: Vector2[] = [];
  for (let r = 2; r <= 4 && results.length < count; r++) {
    for (let dy = -r; dy <= r && results.length < count; dy++) {
      for (let dx = -r; dx <= r && results.length < count; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = leaderTile.x + dx;
        const y = leaderTile.y + dy;
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
        if (!map.isWalkable(x, y)) continue;
        const nearAnother = results.some(p => Math.abs(p.x - x) + Math.abs(p.y - y) < 2);
        if (!nearAnother) results.push({ x, y });
      }
    }
  }
  return results.slice(0, count);
}

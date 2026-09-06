/**
 * Overworld — the massive open world the party starts in.
 *
 * A large procedural continent (240×160 tiles) with biomes (forests,
 * mountains, lakes/rivers, deserts, swamps, arctic snow), a network of
 * towns connected by roads (bridges crossing water, passes through
 * mountains), and scattered dungeon entrances. Generation guarantees every
 * town and entrance is reachable from the spawn town by walkable tiles.
 */

import { pickPrebuilt } from './Prebuilt';
import { TileMap, TileType } from './TileMap';
import { OVERWORLD_WIDTH, OVERWORLD_HEIGHT, Vector2, manhattan } from '../engine/types';
import { archetypeForTown, TOWN_ARCHETYPES, TownArchetypeId } from './TownTypes';
import { OverworldPOI, generatePOIs } from './OverworldPOI';
import { WorldRegion, generateWorldRegions } from './WorldRegions';

export interface OverworldTown {
  id: string;
  name: string;
  /** Center tile of the town's built-up area. */
  tile: Vector2;
  /** Number of tiles around center that count as "in town". */
  radius: number;
  population: number;
  description: string;
  /** Town archetype that determines buildings, shops, and services. */
  archetypeId: string;
  /** Buildings available in this town (derived from archetype). */
  buildingIds: string[];
}

export interface OverworldEntrance {
  id: string;
  name: string;
  tile: Vector2;
  /** The dungeon theme id for this delve (optional — random if unset). */
  themeId?: string;
  /** How deep this delve goes, in floors. Drives quest difficulty. */
  depth: number;
  description: string;
  /** The pre-built dungeon behind this gate: fixed floors, monsters and bosses. Absent on older worlds. */
  prebuiltId?: string;
}

export interface Overworld {
  map: TileMap;
  towns: OverworldTown[];
  entrances: OverworldEntrance[];
  spawnTownId: string;
  /** Discoverable points of interest on the overworld. */
  pois: OverworldPOI[];
  /** Named territories used by narration and destination scoring. */
  regions: WorldRegion[];
}

export const TOWN_NAMES = [
  'Emberwatch', 'Duskhollow', 'Silverbark', 'Ravenmere', 'Stonebridge',
  'Greymarch', 'Frosthaven', 'Thornwick', 'Highwater', 'Mistfeld',
  'Oakshade', 'Brimstone', 'Willowrun', 'Ashvale', 'Corvusport',
  'Saltmarrow', 'Kingsfold', 'Hollowbrook', 'Ironmoor', 'Larkspire',
  'Wyndmere', 'Bittercross', 'Gallowsend', 'Fennick', 'Stormreach',
  'Copperdown', 'Vesperhold', 'Marrowgate', 'Thistlecombe', 'Old Harrow',
];

export const ENTRANCE_NAMES = [
  'The Sunken Crypts', 'Barrowmoor Depths', 'Wyrmfang Warrens', 'The Hollow Catacombs',
  'Gloomhollow Keep', 'The Serpent Maws', 'Ashen Spire', 'The Drowned Chapel',
  'Cinderfen Ruins', 'The Frozen Vaults', 'Obsidian Delve', 'The Whispering Labyrinth',
  'The Bone Galleries', 'Vermilion Catacombs', 'The Shattered Sanctum', 'Murkdeep Fane',
  'The Salt Deeps', 'Lantern Reach', 'The Hospice of Saint Wren', 'The Giants\' Stair',
  'Hollowcrown Barrow', 'The Weeping Foundry', 'Nightjar Warrens', 'The Bellows Below',
  'Kingsgrave', 'The Whitewater Sepulchre', 'Thornhollow Delve', 'The Glass Cathedral',
  'Ravensfall Oubliette', 'The Rimewell', 'Sorrowgate', 'The Undercroft of Aldric',
];

const TOWN_DESCRIPTIONS = [
  'a bustling market town where every guild has a stall and every rumor has a price',
  'a walled burg that has weathered a hundred sieges, its keep scarred but unbowed',
  'a sleepy village of thatched roofs, temple bells, and farmers who lock their doors at dusk',
  'a trade hub where the roads meet and the inns never sleep',
  'a grim frontier outpost on the edge of the wilds, where adventurers are welcome and questions are not',
  'a river port of tarred piers and shouting fishwives, where every third building is a chandler and every fourth a tavern',
  'a hill town built in rings up a crag, each ring older and stranger than the one below',
  'a mining town of soot and lamplight whose bells ring shifts, not hours',
  'a pilgrim town grown around a shrine, its streets lined with hostels and relic-sellers of doubtful honesty',
  'a crossroads garrison gone half to seed, its walls patched with old gravestones',
  'a marsh town on stilts where the roads are planks and the dead are buried in boats',
];

const ENTRANCE_DESCRIPTIONS = [
  'a yawning maw in the earth, ringed by moss-eaten stones that hum with old magic',
  'a stairway swallowed by darkness, its arch carved with warnings no one can read',
  'a collapsed tower whose basement still breathes cold air, as if something below keeps the door',
  'a cave mouth choked with roots, and a draft that smells of dust and coin',
  'an iron gate half-rusted open, its hinges groaning with every gust',
  'a well whose rope goes down further than any rope should, and comes up wet with something that is not water',
  'a shrine sunk into the hillside, its door an altar tipped on its side',
  'a mine head with the winding gear still greased, as though the last shift meant to come back',
  'a cleft in a cliff face marked with a hundred hand-prints in old ochre, all pointing down',
  'a barrow mound split open by a fallen oak, breathing cold from the gap',
];

/** Flavor for entrances, keyed by the dungeon theme the land gave them. */
const THEMED_ENTRANCE_DESCRIPTIONS: Record<string, string[]> = {
  clockwork_foundry: ['a brass door in a hillside, warm to the touch, ticking', 'a chimney of black iron rising from the turf, and stairs down inside it'],
  jungle_ziggurat: ['a stepped stone rising out of the trees, its stair choked with vines and its top lost in canopy', 'a carved mouth in a moss-eaten wall, insects pouring out of it in a slow tide'],
  frozen_necropolis: ['a crack in a glacier with a street visible inside it, and doors along the street', 'an arch of blue ice with names cut into it, thousands of names'],
  sky_citadel: ['a stair cut into a mountain that does not stop at the top of the mountain', 'a rope bridge that starts on a crag and ends in cloud'],
  fungal_grotto: ['a sinkhole ringed with caps the size of cartwheels, glowing faintly blue', 'a cave mouth breathing spores like slow snow'],
  pirate_cove: ['a sea-cave under a headland, with a ship\'s bell hung at the mouth and a skull on the bell', 'a smugglers\' stair down a cliff to a cave the tide leaves open twice a day'],
  astral_wreck: ['a silver hull half-buried in a hillside, its planks humming', 'a hole in the ground with stars at the bottom of it'],
  desert_tomb: ['a stone door in a dune, its seals broken and re-set and broken again', 'a sphinx\'s head rising from the sand, and a stair between its paws'],
  haunted_theatre: ['a theatre facade with the doors chained and the lamps lit', 'a stage door down an alley, a bill for tonight\'s performance still pasted beside it'],
  dream_labyrinth: ['a door standing alone in a field, ajar, with a corridor behind it', 'a well whose water shows a ceiling'],
  salt_mine_deeps: [
    'a mine head of white stone, its rails vanishing down into a glitter that is not quite light',
    'a salt-crusted adit propped with timber gone to white, the air out of it dry as a tomb',
  ],
  drowned_lighthouse: [
    'a sea-cave at the foot of a broken lighthouse, a slow light turning somewhere under the water',
    'a stair cut into the cliff that goes down to the tide-line and then, somehow, further',
  ],
  plague_hospice: [
    'a hospice gate chained shut from the outside, the bell-rope still hanging within reach',
    'a walled house of the sick, every window bricked but one, and that one lit',
  ],
  giants_causeway: [
    'a stair of stones each the height of a man, climbing into cloud toward a door built for something taller',
    'a causeway of giant-cut slabs that leads not along the land but down into it',
  ],
  sunken_temple: [
    'a waterlogged stairway swallowed by reeds, exhaling damp rot and old prayers',
    'a stone arch half-drowned in the mire, its carvings worn smooth by centuries of murk',
  ],
  feywild_glade: [
    'a mossy hollow beneath silver-rooted trees, where the air shimmers with unearned sweetness',
    'a ring of toadstools hiding a root-choked well that breathes faint, wrong music',
  ],
  goblin_warren: [
    'a low, reeking burrow braced with stolen timber, the packed dirt loud with scuttling',
    'a warren mouth stitched with traps and crude spikes, hung with warning bones',
  ],
  ancient_dwarven_hall: [
    'a monumental gate carved into the mountain, runes cold and hinges immovable',
    'a dwarven door of black stone, its lintel inscribed with a single word: below',
  ],
  royal_crypt: [
    'a desert necropolis gate, its seal cracked and sand pouring into the dark beyond',
    'a sun-bleached tomb entrance standing open in the wastes, as if waiting',
  ],
  celestial_observatory: [
    'a frozen stair spiraling into a glacier, lit from within by a cold blue star-light',
    'a brass door set in the ice, frosted with constellations no sky has ever shown',
  ],
  wizards_tower_lore_loc: [
    'a leaning tower ruin whose basement door glows with a slow, patient sigil',
    'a collapsed spire whose cellar hums with half-forgotten cantrips',
  ],
  thieves_guild_den: [
    'a false-fronted cellar beneath a boarded house, its lock picked from the inside',
    'a sewer grate propped open, chalk marks on the wall spelling welcome and warning',
  ],
  shadowfell_crossing: [
    'a rent in the ground where the light itself seems to drain, sound deadening at its edge',
    'a stair that descends into a darkness too complete, swallowing even the echoes',
  ],
  dragon_graveyard: [
    'a scorched cleft in the earth, faint heat wafting up between cracked ribs of bone',
    'a tunnel mouth ringed with the marks of great claws, warm as a hearth',
  ],
  illithid_colony: [
    'a smooth, wet shaft descending into stone that seems to breathe, faint violet light pulsing below',
    'an arch of fused, organic-looking rock, its edges glistening and strangely warm',
  ],
  abyssal_rift: [
    'a split in the ground with red light bleeding up through the cracks, distant screams faint below',
    'a rift ringed by scorched earth, its depths glowing like embers in a furnace',
  ],
  elemental_node_fire: [
    'a vent in the earth steaming with heat, the stone around it fused to glass',
    'a crack that exhales furnace air, embers spiraling up on the current',
  ],
  vampire_castle: [
    'a rusted crypt door beneath a dead manor, its hinges weeping black iron tears',
    'a stairwell behind a shattered chapel altar, cold as a grave even in summer',
  ],
};

/** Pick a dungeon theme that matches the land an entrance stands in. */
function themeForEntrance(map: TileMap, x: number, y: number, towns: OverworldTown[]): string {
  // Sample a 5×5 area (the 3×3 clearing is already grass by now).
  let forest = 0, mountain = 0, water = 0, swamp = 0, snow = 0, desert = 0, sand = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const t = map.getTile(x + dx, y + dy);
      if (t === TileType.Forest) forest++;
      else if (t === TileType.Mountain) mountain++;
      else if (t === TileType.Water) water++;
      else if (t === TileType.Swamp) swamp++;
      else if (t === TileType.Snow) snow++;
      else if (t === TileType.Desert) desert++;
      else if (t === TileType.Sand) sand++;
    }
  }
  // Gates right under a town are cellar crypts and guild dens.
  if (towns.some(tn => manhattan(tn.tile, { x, y }) <= 8)) return 'thieves_guild_den';
  if (swamp >= 2 || water >= 2) return 'sunken_temple';
  if (mountain >= 3) return 'ancient_dwarven_hall';
  if (snow >= 3) return Math.random() < 0.6 ? 'celestial_observatory' : 'wizards_tower_lore_loc';
  if (desert >= 3) return 'royal_crypt';
  if (sand >= 3) return 'sunken_temple';
  if (forest >= 3) return Math.random() < 0.65 ? 'feywild_glade' : 'goblin_warren';
  const surfacePool = [
    'goblin_warren', 'thieves_guild_den', 'vampire_castle', 'wizards_tower_lore_loc',
    'illithid_colony', 'abyssal_rift', 'royal_crypt', 'shadowfell_crossing',
    'dragon_graveyard', 'elemental_node_fire',
  ];
  return surfacePool[Math.floor(Math.random() * surfacePool.length)];
}

interface Blob { cx: number; cy: number; r: number }

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Paint a circular-ish blob of `type` where `apply` returns true. */
function paintBlob(
  map: TileMap, cx: number, cy: number, r: number, type: TileType,
  apply: (x: number, y: number) => boolean,
): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = Math.round(cx + dx);
      const y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      // Blobby edge: corners less likely to be filled.
      if (dx * dx + dy * dy > r * r * 1.1) continue;
      if (Math.random() < 0.08) continue;
      if (apply(x, y)) map.setTile(x, y, type);
    }
  }
}

/** Set a tile as road, bridging water and punching passes through mountains. */
function setRoad(map: TileMap, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return;
  const t = map.getTile(x, y);
  if (t === TileType.Town || t === TileType.DungeonEntrance) return;
  if (t === TileType.Water) map.setTile(x, y, TileType.Bridge);
  else map.setTile(x, y, TileType.Road);
}

/** Carve a meandering road segment from a to b (straight-ish with jitter). */
function carveRoad(map: TileMap, a: Vector2, b: Vector2): void {
  const steps = 2 + randInt(1, 3);
  const pts: Vector2[] = [{ x: a.x, y: a.y }];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    pts.push({
      x: Math.round(a.x + (b.x - a.x) * t + (Math.random() - 0.5) * 9),
      y: Math.round(a.y + (b.y - a.y) * t + (Math.random() - 0.5) * 9),
    });
  }
  pts.push({ x: b.x, y: b.y });
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    let x = p.x;
    let y = p.y;
    let guard = 0;
    while ((x !== q.x || y !== q.y) && guard++ < 600) {
      if (Math.abs(q.x - x) >= Math.abs(q.y - y) && x !== q.x) x += Math.sign(q.x - x);
      else if (y !== q.y) y += Math.sign(q.y - y);
      else x += Math.sign(q.x - x);
      setRoad(map, x, y);
    }
    setRoad(map, q.x, q.y);
  }
}

/** Straight L-shaped corridor (used to rescue disconnected places). */
function carveCorridor(map: TileMap, a: Vector2, b: Vector2): void {
  let x = a.x;
  let y = a.y;
  while (x !== b.x) { x += Math.sign(b.x - x); setRoad(map, x, y); }
  while (y !== b.y) { y += Math.sign(b.y - y); setRoad(map, x, y); }
}

/** BFS reachability from a seed tile; returns the reachable tile set. */
function floodReachable(map: TileMap, seed: Vector2): Uint8Array {
  const w = map.width;
  const h = map.height;
  const seen = new Uint8Array(w * h);
  const q: number[] = [seed.y * w + seed.x];
  seen[seed.y * w + seed.x] = 1;
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
      if (!map.isWalkable(nx, ny)) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return seen;
}

export function nearestWalkable(map: TileMap, x: number, y: number): Vector2 {
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (map.isWalkable(nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x, y };
}

/**
 * The world's edge: an impassable mountain ring so nothing (the party, BFS
 * pathing, wanderers, or ambush spawns) can step off the map into the void.
 * Mountains are not walkable, so every movement rule respects the border.
 */
export function ringOverworld(map: TileMap): void {
  const RING = 8;
  const w = map.width;
  const h = map.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < RING || y < RING || x >= w - RING || y >= h - RING) {
        map.setTile(x, y, TileType.Mountain);
      }
    }
  }
}

function pickName(list: string[], used: Set<string>): string {
  const pool = list.filter(n => !used.has(n));
  const name = pool.length > 0 ? pool[randInt(0, pool.length - 1)] : `${list[0]} ${used.size + 1}`;
  used.add(name);
  return name;
}

export function generateOverworld(): Overworld {
  const w = OVERWORLD_WIDTH;
  const h = OVERWORLD_HEIGHT;
  const map = new TileMap(w, h);

  // ── 1. Base terrain: grass everywhere, arctic band at the north ──
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      map.setTile(x, y, y < 10 ? TileType.Snow : TileType.Grass);
    }
  }

  // ── 2. Biome blobs ──
  // Forests
  for (let i = 0; i < 30; i++) {
    paintBlob(map, randInt(15, w - 15), randInt(14, h - 20), randInt(4, 12), TileType.Forest, (x, y) => {
      const t = map.getTile(x, y);
      return t === TileType.Grass && y >= 10;
    });
  }
  // Mountains — ranges
  for (let i = 0; i < 14; i++) {
    const cx = randInt(20, w - 20);
    const cy = randInt(14, h - 20);
    const r = randInt(4, 10);
    paintBlob(map, cx, cy, r, TileType.Mountain, (x, y) => {
      const t = map.getTile(x, y);
      return (t === TileType.Grass || t === TileType.Forest || t === TileType.Desert) && y >= 8;
    });
  }
  // Lakes
  for (let i = 0; i < 10; i++) {
    paintBlob(map, randInt(15, w - 15), randInt(14, h - 20), randInt(4, 12), TileType.Water, (x, y) => {
      const t = map.getTile(x, y);
      return (t === TileType.Grass || t === TileType.Forest) && y >= 12;
    });
  }
  // Rivers — meander from a random lake-ish start to a map edge
  for (let i = 0; i < 4; i++) {
    let x = randInt(10, w - 10);
    let y = randInt(20, h - 20);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const vertical = Math.random() < 0.5;
    let guard = 0;
    while ((vertical ? y : x) > 5 && (vertical ? y : x) < (vertical ? h - 5 : w - 5) && guard++ < 260) {
      if (map.getTile(x, y) === TileType.Grass) map.setTile(x, y, TileType.Water);
      if (vertical) {
        y += dir;
        if (Math.random() < 0.35) x += Math.random() < 0.5 ? 1 : -1;
      } else {
        x += dir;
        if (Math.random() < 0.35) y += Math.random() < 0.5 ? 1 : -1;
      }
      if (x < 6 || x > w - 6 || y < 6 || y > h - 6) break;
    }
  }
  // Sand shores around water
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (map.getTile(x, y) !== TileType.Water) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (map.getTile(x + dx, y + dy) === TileType.Grass) map.setTile(x + dx, y + dy, TileType.Sand);
      }
    }
  }
  // Deserts
  for (let i = 0; i < 7; i++) {
    paintBlob(map, randInt(20, w - 20), randInt(16, h - 24), randInt(5, 11), TileType.Desert, (x, y) => {
      const t = map.getTile(x, y);
      return (t === TileType.Grass || t === TileType.Sand) && y >= 16;
    });
  }
  // Swamps — near water
  for (let i = 0; i < 9; i++) {
    paintBlob(map, randInt(18, w - 18), randInt(16, h - 24), randInt(4, 9), TileType.Swamp, (x, y) => {
      const t = map.getTile(x, y);
      if (t !== TileType.Grass && t !== TileType.Forest && t !== TileType.Sand) return false;
      // Bias toward water
      let nearWater = false;
      for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
        if (map.getTile(x + dx, y + dy) === TileType.Water) nearWater = true;
      }
      return nearWater || Math.random() < 0.3;
    });
  }

  // ── 3. Towns ──
  const towns: OverworldTown[] = [];
  const usedTownNames = new Set<string>();
  const townCount = 10;
  let attempts = 0;
  while (towns.length < townCount && attempts++ < 500) {
    const x = randInt(16, w - 16);
    const y = randInt(16, h - 20);
    const t = map.getTile(x, y);
    if (!map.isWalkable(x, y)) continue;
    if (t === TileType.Forest || t === TileType.Swamp || t === TileType.Desert) continue;
    if (towns.some(town => manhattan(town.tile, { x, y }) < 34)) continue;
    // Clear a building plot
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (map.getTile(nx, ny) === TileType.Water || map.getTile(nx, ny) === TileType.Mountain) continue;
        map.setTile(nx, ny, TileType.Grass);
      }
    }
    // Built-up core: 3×3 of Town tiles
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        map.setTile(x + dx, y + dy, TileType.Town);
      }
    }
    const tid = `town_${towns.length + 1}`;
    const archetype = archetypeForTown(tid);
    towns.push({
      id: tid,
      name: pickName(TOWN_NAMES, usedTownNames),
      tile: { x, y },
      radius: 4,
      population: randInt(600, 14000),
      description: TOWN_DESCRIPTIONS[randInt(0, TOWN_DESCRIPTIONS.length - 1)] + ', ' + archetype.bonusDescription,
      archetypeId: archetype.id,
      buildingIds: archetype.buildings.map(b => b.id),
    });
  }

  // ── 4. Roads: connect every town to its nearest two (union-find → tree) ──
  const parent: number[] = towns.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  const connectPairs: [number, number][] = [];
  const pairsAdded = new Set<string>();
  for (let i = 0; i < towns.length; i++) {
    const dists = towns
      .map((t, j) => ({ j, d: manhattan(towns[i].tile, t.tile) }))
      .filter(p => p.j !== i)
      .sort((a, b) => a.d - b.d);
    for (const { j } of dists.slice(0, 2)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (pairsAdded.has(key)) continue;
      pairsAdded.add(key);
      connectPairs.push([i, j]);
      union(i, j);
    }
  }
  // Ensure full connectivity: connect remaining components to nearest other.
  for (let i = 0; i < towns.length; i++) {
    for (let j = i + 1; j < towns.length; j++) {
      if (find(i) === find(j)) continue;
      union(i, j);
      connectPairs.push([i, j]);
    }
  }
  for (const [i, j] of connectPairs) {
    carveRoad(map, towns[i].tile, towns[j].tile);
  }

  // ── 5. Dungeon entrances: 1–2 per town, path to the nearest road ──
  const entrances: OverworldEntrance[] = [];
  const usedEntranceNames = new Set<string>();
  const usedPrebuilt = new Set<string>();
  let entranceId = 1;
  for (const town of towns) {
    const perTown = 1 + (Math.random() < 0.6 ? 1 : 0);
    for (let k = 0; k < perTown && entrances.length < 20; k++) {
      attempts = 0;
      let placed = false;
      while (!placed && attempts++ < 120) {
        const dx = randInt(9, 22) * (Math.random() < 0.5 ? -1 : 1);
        const dy = randInt(9, 22) * (Math.random() < 0.5 ? -1 : 1);
        const x = town.tile.x + dx;
        const y = town.tile.y + dy;
        if (x < 8 || y < 10 || x >= w - 8 || y >= h - 8) continue;
        const t = map.getTile(x, y);
        if (t !== TileType.Grass && t !== TileType.Forest && t !== TileType.Sand && t !== TileType.Desert && t !== TileType.Swamp && t !== TileType.Snow) continue;
        if (towns.some(tn => manhattan(tn.tile, { x, y }) < 6)) continue;
        if (entrances.some(e => manhattan(e.tile, { x, y }) < 8)) continue;
        // Clear a small patch
        for (let dy2 = -1; dy2 <= 1; dy2++) {
          for (let dx2 = -1; dx2 <= 1; dx2++) {
            map.setTile(x + dx2, y + dy2, TileType.Grass);
          }
        }
        map.setTile(x, y, TileType.DungeonEntrance);
        // The land decides what lies beneath — a swamp gate sinks, a peak gate bores deep.
        const themeId = themeForEntrance(map, x, y, towns);
        // Path from the entrance to the nearest road tile
        let best: Vector2 | null = null;
        let bestD = Infinity;
        for (let sy = Math.max(0, y - 14); sy <= Math.min(h - 1, y + 14); sy++) {
          for (let sx = Math.max(0, x - 14); sx <= Math.min(w - 1, x + 14); sx++) {
            const tt = map.getTile(sx, sy);
            if (tt === TileType.Road || tt === TileType.Bridge || tt === TileType.Town) {
              const d = manhattan({ x, y }, { x: sx, y: sy });
              if (d < bestD) { bestD = d; best = { x: sx, y: sy }; }
            }
          }
        }
        if (best) carveRoad(map, { x, y }, best);
        const themed = THEMED_ENTRANCE_DESCRIPTIONS[themeId];
        const description = themed && themed.length > 0
          ? themed[randInt(0, themed.length - 1)]
          : ENTRANCE_DESCRIPTIONS[randInt(0, ENTRANCE_DESCRIPTIONS.length - 1)];
        // Every gate leads to one of the hundred pre-built dungeons: fixed
        // floors, fixed monsters, a boss in its hall. The land picks the
        // theme; the theme picks the dungeon.
        const prebuilt = pickPrebuilt(themeId, usedPrebuilt);
        if (prebuilt) usedPrebuilt.add(prebuilt.id);
        entrances.push({
          id: `entrance_${entranceId++}`,
          name: prebuilt?.name ?? pickName(ENTRANCE_NAMES, usedEntranceNames),
          tile: { x, y },
          themeId: prebuilt?.themeId ?? themeId,
          depth: prebuilt?.floors.length ?? randInt(2, 5),
          description: prebuilt ? `${description} \u2014 ${prebuilt.description}` : description,
          prebuiltId: prebuilt?.id,
        });
        placed = true;
      }
    }
  }

  // ── 6. Connectivity guarantee: rescue any place BFS can't reach ──
  const spawnTown = towns[0];
  const spawnSeed = nearestWalkable(map, spawnTown.tile.x, spawnTown.tile.y);
  for (let pass = 0; pass < 24; pass++) {
    const reach = floodReachable(map, spawnSeed);
    const places = [
      ...towns.map(t => ({ p: t.tile, name: t.name })),
      ...entrances.map(e => ({ p: e.tile, name: e.name })),
    ];
    const stranded = places.find(pl => !reach[pl.p.y * w + pl.p.x]);
    if (!stranded) break;
    const start = nearestWalkable(map, stranded.p.x, stranded.p.y);
    carveCorridor(map, start, spawnSeed);
  }

  // ── 7. The whole world is open (no fog on the surface) ──
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      map.explored[y][x] = true;
    }
  }

  // ── 8. The world's edge: an impassable mountain ring ──
  // Without a border, the entire map is walkable grass and the party can
  // march straight off the edge into the black void. Mountains are not
  // walkable, so BFS pathing, moveParty, wanderers, and ambush spawns all
  // respect the ring — the realm simply ends at the peaks.
  ringOverworld(map);

  // Generate points of interest
  const pois = generatePOIs(map, towns, 'overworld_pois', 40);
  // Give the huge coordinate field a readable geography the AI can remember.
  const regions = generateWorldRegions(map, towns, entrances);

  return { map, towns, entrances, spawnTownId: towns[0]?.id ?? '', pois, regions };
}

export function getTownById(overworld: Overworld, id: string): OverworldTown | undefined {
  return overworld.towns.find(t => t.id === id);
}

export function getEntranceById(overworld: Overworld, id: string): OverworldEntrance | undefined {
  return overworld.entrances.find(e => e.id === id);
}

/** The entrance at (or nearest to) a tile, within 2 tiles. */
export function entranceAt(overworld: Overworld, x: number, y: number): OverworldEntrance | undefined {
  return overworld.entrances.find(e => manhattan(e.tile, { x, y }) <= 1);
}

export function townAt(overworld: Overworld, x: number, y: number): OverworldTown | undefined {
  return overworld.towns.find(t => manhattan(t.tile, { x, y }) <= t.radius);
}

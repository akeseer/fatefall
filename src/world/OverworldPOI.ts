/**
 * OverworldPOI — Points of Interest on the overworld map.
 * While the party travels, they may discover ancient ruins, abandoned mines,
 * witch huts, dragon lairs, and battlefields. Each POI has unique encounters,
 * loot, and lore. POIs are scattered during world generation and revealed
 * when the party enters an adjacent tile.
 */

import { TileMap, TileType } from './TileMap';
import { Vector2, manhattan } from '../engine/types';

export type POIKind =
  | 'ancient_ruins'
  | 'abandoned_mine'
  | 'witch_hut'
  | 'dragon_lair'
  | 'ancient_battlefield'
  | 'hidden_shrine'
  | 'crystal_cave'
  | 'bandit_outpost'
  | 'lost_tomb'
  | 'enchanted_grove'
  | 'watchtower'
  | 'wizard_tower'
  | 'haunted_forest'
  | 'mineral_spring'
  | 'failed_settlement'
  | 'goblin_camp'
  | 'moon_forge';

export interface OverworldPOI {
  id: string;
  kind: POIKind;
  name: string;
  description: string;
  tile: Vector2;
  /** Whether the party has discovered this POI. */
  discovered: boolean;
  /** Whether the party has explored/cleared this POI. */
  cleared: boolean;
}

// ── POI Templates ──────────────────────────────────────────────────────────

interface POITemplate {
  kind: POIKind;
  names: string[];
  descriptions: string[];
  /** Tile types where this POI can spawn. */
  validTiles: TileType[];
}

const POI_TEMPLATES: POITemplate[] = [
  {
    kind: 'ancient_ruins',
    names: ['The Shattered Halls', 'Ruins of Aethermere', 'Crumbling Bastion', 'Forgotten Gatehouse', 'Ruin of the Old Kingdom'],
    descriptions: [
      'Crumbling stone walls jut from the earth like broken teeth. Ancient magic still hums in the mortar.',
      'A once-grand structure reduced to rubble. Statues of forgotten heroes stand guard over nothing.',
      'Ivy-choked pillars mark what was once a palace. Treasure hunters have picked it clean — mostly.',
    ],
    validTiles: [TileType.Grass, TileType.Forest],
  },
  {
    kind: 'abandoned_mine',
    names: ['The Hollow Depths', 'Shadow Shaft Mine', 'The Abandoned Dig', 'Rustpick Mine', 'The Deep Cut', 'The Kneeling Colonnade', 'Hall of the Last Census', 'The Sunken Amphitheatre'],
    descriptions: [
      'A collapsed mine entrance, timbers rotting. A draft from below suggests it goes deeper than anyone knows.',
      'Old mining equipment litters the entrance. Someone left in a hurry — and left their pickaxe behind.',
      'The mine shaft descends into darkness. Rail tracks disappear into the black, and something echoes below.',
    ],
    validTiles: [TileType.Mountain, TileType.Grass],
  },
  {
    kind: 'witch_hut',
    names: ['The Crooked House', 'Granny Moss\'s Hollow', 'The Hag\'s Perch', 'Bramble Rest', 'The Thorn Cottage', 'The Choir Shaft', 'Widowmaker Level', 'The Salt Gallery'],
    descriptions: [
      'A leaning hut made of twisted branches and old bones. Smoke curls from a chimney made of stacked skulls.',
      'A cottage surrounded by a garden of strange plants. Some of them appear to be watching you.',
      'A hut perched on a massive tree stump. The door is made of a single slab of darkwood, carved with faces.',
    ],
    validTiles: [TileType.Forest, TileType.Swamp],
  },
  {
    kind: 'dragon_lair',
    names: ['The Scorched Cavern', 'Wyrm\'s Roost', 'The Ember Maw', 'Dragon\'s Tooth Lair', 'The Flame Den', 'The House That Turns', 'Mother Nettle\'s', 'The Loom Cottage'],
    descriptions: [
      'The ground is scorched black for a hundred yards. Claw marks gouge the rock, and the air shimmers with heat.',
      'A massive cave mouth, ringed with the bones of livestock and the occasional adventurer.',
      'The smell of sulfur is overwhelming. Great wing-prints are pressed into the ash around the entrance.',
    ],
    validTiles: [TileType.Mountain, TileType.Desert],
  },
  {
    kind: 'ancient_battlefield',
    names: ['The Fields of Sorrow', 'The Bone Garden', 'The Bloodied Meadow', 'The War Scar', 'Fallen Glory', 'The Amber Hollow', 'The Cinder Throat', 'Old Rust\'s Den'],
    descriptions: [
      'Rusted weapons and shattered shields litter the field. The grass grows red here, even in spring.',
      'Bones protrude from the earth in every direction. Something about them suggests they were arranged.',
      'A field of ancient conflict — the dead still wear their armor, and some of them still grip their blades.',
    ],
    validTiles: [TileType.Grass, TileType.Desert],
  },
  {
    kind: 'hidden_shrine',
    names: ['The Silent Chapel', 'The Whispering Stone', 'The Hidden Altar', 'The Unmarked Shrine', 'The Forgotten Holy Place', 'The Field of Broken Banners', 'Widow\'s Furrow', 'The Standing Dead'],
    descriptions: [
      'A small stone shrine, almost invisible behind overgrown vines. A faint golden light pulses within.',
      'A circle of standing stones with a single altar at the center. The air feels sacred here.',
      'A weathered statue of a forgotten deity, still radiating a faint warmth. Offerings of flowers lie at its feet.',
    ],
    validTiles: [TileType.Forest, TileType.Grass, TileType.Snow],
  },
  {
    kind: 'crystal_cave',
    names: ['The Prismatic Grotto', 'Crystal Depths', 'The Shimmering Cavern', 'Gemheart Cave', 'The Crystal Hollow', 'The Shrine of the Turned Face', 'The Well of Small Mercies', 'The Nine Candles'],
    descriptions: [
      'A cave mouth glittering with reflected light. Inside, crystals the size of a man jut from every surface.',
      'The entrance is framed by massive quartz formations. A faint hum emanates from deep within.',
      'A cavern where the walls themselves are made of crystal. The light plays tricks with your eyes.',
    ],
    validTiles: [TileType.Mountain, TileType.Snow],
  },
  {
    kind: 'bandit_outpost',
    names: ['The Black Camp', 'Thieves\' Roost', 'The Outlaw Den', 'Bandit\'s Rest', 'The Stolen Ground', 'The Chiming Deep', 'The Glass Orchard', 'Mirrorroot Cavern'],
    descriptions: [
      'A crude camp with sharpened stakes and watchtowers. Stolen goods are piled under tarps.',
      'A fortified hideout with makeshift walls. The smell of cookfire and unwashed bodies drifts on the wind.',
      'A camp of rough-looking individuals who eye travelers with open greed.',
    ],
    validTiles: [TileType.Forest, TileType.Grass],
  },
  {
    kind: 'lost_tomb',
    names: ['The Sealed Barrow', 'The King\'s Rest', 'The Mound of Whispers', 'The Eternal Dormitory', 'The Silent Vault', 'The Toll Gallows', 'Halfway House', 'The Hanging Lantern'],
    descriptions: [
      'A massive burial mound with a sealed stone door. Runes glow faintly around the frame.',
      'An underground tomb entrance, its door decorated with funerary art. The dead here were important.',
      'A barrow hill with a single entrance. Cold air flows outward, carrying the scent of old dust.',
    ],
    validTiles: [TileType.Grass, TileType.Snow, TileType.Desert],
  },
  {
    kind: 'enchanted_grove',
    names: ['The Fey Circle', 'The Moonlit Glade', 'The Dancing Trees', 'The Whispering Wood', 'The Fairy Ring', 'The Tomb of the Unnamed Queen', 'The Salt King\'s Rest', 'The Barrow of Nine Doors'],
    descriptions: [
      'A perfect circle of mushrooms surrounds a clearing where the fireflies never stop dancing.',
      'Trees with silver bark grow in a spiral. The air shimmers with faerie dust and faint music.',
      'A grove where the trees sway to a rhythm only they can hear. Tiny lights flit between the branches.',
    ],
    validTiles: [TileType.Forest],
  },
  {
    kind: 'watchtower',
    names: ['The Old Watchtower', 'Rook\'s Perch', 'The Border Spire', 'The Sentinel Tower', 'The Farsight Keep', 'The Court of Thorns', 'The Singing Copse', 'Hollowheart Grove'],
    descriptions: [
      'A lonely watchtower on a hill, its beacon long cold. The view from the top would be extraordinary — if the stairs held.',
      'A dwarven-built tower of black stone, still standing after centuries. Its door groans when the wind blows.',
      'A crumbling watchtower with a single intact room at the top. Someone has been keeping a signal fire recently.',
    ],
    validTiles: [TileType.Grass, TileType.Mountain, TileType.Desert],
  },
  {
    kind: 'wizard_tower',
    names: ['The Spire of Whispers', 'Mage\'s Bastion', 'The Arcanum Tower', 'The Black Spire', 'The Floating Needle', 'The Bell Tower of Fennick', 'Crow\'s Rest', 'The Beacon of the Downs'],
    descriptions: [
      'A tower too tall for its footprint, leaning slightly as if the wind is holding it up. Faint lights move behind the windows.',
      'A wizard\'s tower wrapped in scaffolding that was never removed. Runes crawl across its stones.',
      'A spire of fused glass and stone, humming with stored magic. The door is unlocked, which is somehow worse.',
    ],
    validTiles: [TileType.Grass, TileType.Mountain, TileType.Snow],
  },
  {
    kind: 'haunted_forest',
    names: ['The Dreadwood', 'The Whispering Pines', 'Gallow\'s Grove', 'The Moaning Thicket', 'The Pale Copse', 'The Tower of Seven Doors', 'Vesper\'s Folly', 'The Inkwell Spire'],
    descriptions: [
      'The trees here grow in grasping shapes, and the air is several degrees colder than the surrounding land.',
      'A wood where fog pools between the trunks even at noon. Something calls your name in a voice you almost recognize.',
      'An ancient forest soaked in sorrow. The leaves are gray-green, and nothing birdsong ever rises from the canopy.',
    ],
    validTiles: [TileType.Forest, TileType.Swamp],
  },
  {
    kind: 'mineral_spring',
    names: ['The Bubbling Pools', 'Crystal Spring', 'The Warm Waters', 'The Miner\'s Blessing', 'The Fizzing Grotto', 'The Widow\'s Weald', 'The Wood of Turned Backs', 'Lanternless Wood'],
    descriptions: [
      'A spring bubbling with mineral-rich water that sparkles like gemstones. Locals swear it heals aches and mends bones.',
      'Warm water pools in terraces of smooth stone. Steam rises in columns, and the water tastes of iron and gold.',
      'A hot spring ringed with blue-green minerals. Tiny fish glow faintly beneath the surface.',
    ],
    validTiles: [TileType.Mountain, TileType.Grass, TileType.Snow],
  },
  {
    kind: 'failed_settlement',
    names: ['The Ruined Hamlet', 'Dead Man\'s Village', 'The Empty Commons', 'The Burnt Township', 'The Hollow Steading', 'The Copper Pools', 'Saint Wren\'s Bath', 'The Steaming Stair'],
    descriptions: [
      'A village that failed: collapsed houses, an overgrown well, and a bell that rings itself in the wind.',
      'Rows of empty cottages with doors left open. A single chair still sits on a porch, facing the road as if waiting.',
      'A burned-out settlement. The blackened frame of a tavern still stands, and the cellar door is slightly ajar.',
    ],
    validTiles: [TileType.Grass, TileType.Desert, TileType.Snow],
  },
  {
    kind: 'goblin_camp',
    names: ['The Scrag Pile', 'Snagtooth Camp', 'The Trash Midden', 'Wilgebog\'s Den', 'The Gutter Camp', 'Thistlecombe Rest', 'The Half-Built Church', 'Sorrowgate Steading', 'The Stinkpot', 'Old Gutter\'s Hole', 'The Bone Kite Camp'],
    descriptions: [
      'A ramshackle camp of scrap wood and stolen banners. Something in a cage is being very loudly unhappy about it.',
      'A goblin camp reeking of rot and bad decisions. Trash is stacked in tottering heaps, and the guards are fighting each other.',
      'A den of goblins under a snapped tree. The cooking pot is suspiciously large, and the smell is worse.',
    ],
    validTiles: [TileType.Forest, TileType.Grass, TileType.Swamp],
  },
];

// ── Generation ─────────────────────────────────────────────────────────────

function seededRng(seed: string): () => number {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
  return () => { s = (s * 16807 + 0) & 0x7fffffff; return (s & 0x7fffffff) / 0x7fffffff; };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate POIs for an overworld map. POIs are placed away from towns
 * and roads, in appropriate biomes.
 */
export function generatePOIs(
  map: TileMap,
  towns: { tile: Vector2 }[],
  seed: string,
  count: number = 15,
): OverworldPOI[] {
  const rng = seededRng(seed);
  const pois: OverworldPOI[] = [];
  const used = new Set<string>();

  let attempts = 0;
  while (pois.length < count && attempts < 1500) {
    attempts++;
    // Keep POIs clear of the impassable mountain ring at the world's edge
    // (the border is RING=8 tiles deep), so they never spawn unreachable.
    const RING = 8;
    const x = RING + 4 + Math.floor(rng() * (map.width - 2 * RING - 8));
    const y = RING + 4 + Math.floor(rng() * (map.height - 2 * RING - 8));
    const tile = map.getTile(x, y);
    const key = `${x},${y}`;

    // Must be on valid terrain for some POI
    const validTemplates = POI_TEMPLATES.filter(t => t.validTiles.includes(tile));
    if (validTemplates.length === 0) continue;

    // Must not be too close to a town (min 20 tiles)
    if (towns.some(t => manhattan(t.tile, { x, y }) < 20)) continue;

    // Must not be on a road or water
    if (tile === TileType.Road || tile === TileType.Bridge || tile === TileType.Water) continue;

    // Must not overlap another POI
    if (used.has(key)) continue;

    used.add(key);
    const tpl = pick(validTemplates, rng);
    const name = pick(tpl.names, rng);
    const desc = pick(tpl.descriptions, rng);

    pois.push({
      id: `poi_${pois.length + 1}`,
      kind: tpl.kind,
      name,
      description: desc,
      tile: { x, y },
      discovered: false,
      cleared: false,
    });
  }
  return pois;
}

/**
 * Check if the party is near a POI and discover it.
 * Returns newly discovered POIs.
 */
export function discoverNearbyPOIs(
  pois: OverworldPOI[],
  partyTile: Vector2,
  range: number = 3,
): OverworldPOI[] {
  const newlyDiscovered: OverworldPOI[] = [];
  for (const poi of pois) {
    if (poi.discovered) continue;
    if (manhattan(poi.tile, partyTile) <= range) {
      poi.discovered = true;
      newlyDiscovered.push(poi);
    }
  }
  return newlyDiscovered;
}

/**
 * Get the icon for a POI kind.
 */
export function poiIcon(kind: POIKind): string {
  switch (kind) {
    case 'ancient_ruins': return '🏚️';
    case 'abandoned_mine': return '⛏️';
    case 'witch_hut': return '🧙';
    case 'dragon_lair': return '🐉';
    case 'ancient_battlefield': return '⚔️';
    case 'hidden_shrine': return '✨';
    case 'crystal_cave': return '💎';
    case 'bandit_outpost': return '🏴';
    case 'lost_tomb': return '⚰️';
    case 'enchanted_grove': return '🌳';
    case 'watchtower': return '🏰';
    case 'wizard_tower': return '🔮';
    case 'haunted_forest': return '👻';
    case 'mineral_spring': return '♨️';
    case 'failed_settlement': return '🏚️';
    case 'goblin_camp': return '👺';
    case 'moon_forge': return '🌙';
  }
}

/**
 * Spawn the hidden moon-forge — revealed only by the smith at moon-contract
 * tier 3. Placed at a walkable tile away from town lights, pre-discovered so
 * the drawn marker leads the party straight to it.
 */
export function createMoonForgePOI(map: TileMap, towns: { tile: Vector2 }[]): OverworldPOI | null {
  const RING = 8;
  const attempts = 900;
  for (let i = 0; i < attempts; i++) {
    const x = RING + 4 + Math.floor(Math.random() * (map.width - 2 * RING - 8));
    const y = RING + 4 + Math.floor(Math.random() * (map.height - 2 * RING - 8));
    const tile = map.getTile(x, y);
    if (tile !== TileType.Grass && tile !== TileType.Forest && tile !== TileType.Desert) continue;
    if (towns.some(t => manhattan(t.tile, { x, y }) < 20)) continue;
    return {
      id: `moon_forge_${Date.now()}`,
      kind: 'moon_forge',
      name: 'The Moon-Forge of Corund',
      description: 'A half-buried forge where the light of the full moon pools like water. Its anvil still rings with the hammer-work of a smith who was never quite human.',
      tile: { x, y },
      discovered: true,
      cleared: false,
    };
  }
  return null;
}

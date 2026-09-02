import { TileMap, TileType } from './TileMap';
import { Vector2 } from '../engine/types';

export type RegionBiome = 'grassland' | 'forest' | 'mountain' | 'swamp' | 'desert' | 'snow' | 'coast';

export interface WorldRegion {
  id: string;
  name: string;
  biome: RegionBiome;
  description: string;
  travelAdvice: string;
  /** Threat rating used by map AI when choosing optional destinations. */
  danger: number;
  center: Vector2;
  bounds: { x: number; y: number; width: number; height: number };
  /** Named places inside this territory, supplied by the overworld generator. */
  landmarks: string[];
}

const REGION_NAMES = [
  'The Frostline Reach', 'The Crown of Pines', 'The Glasswind Expanse', 'The Greenmantle',
  'The Old Kings Road', 'The Shale Coast', 'The Mireward', 'The Ember Sands',
  'The Sunken Fen', 'The Saltwind Coast', 'The Far Marches', 'The Starfall Vale',
];

const BIOME_INFO: Record<RegionBiome, { description: string; advice: string; danger: number }> = {
  grassland: {
    description: 'Open country of long grass, farm tracks, low hills, and old stone mileposts.',
    advice: 'Stay near the roads when possible; the open ground gives scouts the best sightlines.',
    danger: 1,
  },
  forest: {
    description: 'Dense woodland where the canopy breaks the road into pools of green light and shadow.',
    advice: 'Keep a tight formation and check the tree line; packs and bandits own the cover.',
    danger: 3,
  },
  mountain: {
    description: 'Broken highland of scree slopes, narrow passes, and cold wind pouring from the peaks.',
    advice: 'Follow marked passes and bridges. A short road detour is safer than a blind climb.',
    danger: 5,
  },
  swamp: {
    description: 'Low wetland of black pools, reed beds, half-sunken roads, and ground that shifts underfoot.',
    advice: 'Use causeways and keep an escape route; the shortest line is rarely the safest line here.',
    danger: 4,
  },
  desert: {
    description: 'A sun-struck waste of red stone and pale sand, crossed by caravan trails and dry riverbeds.',
    advice: 'Favor settlements and caravan roads; conserve supplies before leaving a known route.',
    danger: 3,
  },
  snow: {
    description: 'A northern expanse of snowfields, frozen streams, and watchtowers swallowed by white.',
    advice: 'Avoid exposed shortcuts during bad weather and use the slow, visible road through the drifts.',
    danger: 4,
  },
  coast: {
    description: 'A water-marked frontier of dunes, rocky shore, marshy inlets, and weather-beaten trails.',
    advice: 'Bridge crossings are valuable waypoints; watch for ambushes where the road narrows beside water.',
    danger: 2,
  },
};

function biomeFor(map: TileMap, x: number, y: number, width: number, height: number): RegionBiome {
  const counts: Record<RegionBiome, number> = {
    grassland: 0, forest: 0, mountain: 0, swamp: 0, desert: 0, snow: 0, coast: 0,
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 18));
  for (let yy = y; yy < y + height; yy += step) {
    for (let xx = x; xx < x + width; xx += step) {
      switch (map.getTile(xx, yy)) {
        case TileType.Forest: counts.forest++; break;
        case TileType.Mountain: counts.mountain++; break;
        case TileType.Swamp: counts.swamp++; break;
        case TileType.Desert: counts.desert++; break;
        case TileType.Snow: counts.snow++; break;
        case TileType.Water:
        case TileType.Sand: counts.coast++; break;
        default: counts.grassland++; break;
      }
    }
  }
  return (Object.keys(counts) as RegionBiome[]).sort((a, b) => counts[b] - counts[a])[0];
}

/** Build a stable 4x3 atlas of named territories over the generated surface. */
export function generateWorldRegions(
  map: TileMap,
  towns: { tile: Vector2; name: string }[] = [],
  entrances: { tile: Vector2; name: string }[] = [],
): WorldRegion[] {
  const columns = 4;
  const rows = 3;
  const regions: WorldRegion[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = Math.floor(column * map.width / columns);
      const y = Math.floor(row * map.height / rows);
      const right = Math.floor((column + 1) * map.width / columns);
      const bottom = Math.floor((row + 1) * map.height / rows);
      const width = right - x;
      const height = bottom - y;
      const biome = biomeFor(map, x, y, width, height);
      const info = BIOME_INFO[biome];
      const landmarks = [
        ...towns.filter(t => t.tile.x >= x && t.tile.x < right && t.tile.y >= y && t.tile.y < bottom).map(t => t.name),
        ...entrances.filter(e => e.tile.x >= x && e.tile.x < right && e.tile.y >= y && e.tile.y < bottom).map(e => e.name),
      ];
      if (landmarks.length === 0) landmarks.push('unmapped country');
      regions.push({
        id: `region_${row * columns + column + 1}`,
        name: REGION_NAMES[row * columns + column],
        biome,
        description: info.description,
        travelAdvice: info.advice,
        danger: info.danger,
        center: { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) },
        bounds: { x, y, width, height },
        landmarks,
      });
    }
  }
  return regions;
}

export function regionAt(regions: WorldRegion[], tile: Vector2): WorldRegion | undefined {
  return regions.find(r => tile.x >= r.bounds.x && tile.x < r.bounds.x + r.bounds.width
    && tile.y >= r.bounds.y && tile.y < r.bounds.y + r.bounds.height);
}

export function regionSummary(region: WorldRegion): string {
  const places = region.landmarks.slice(0, 3).join(', ');
  return `${region.name}: ${region.description} ${region.travelAdvice} Landmarks: ${places}.`;
}

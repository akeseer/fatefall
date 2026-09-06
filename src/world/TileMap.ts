import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, Vector2 } from '../engine/types';

export enum TileType {
  Void = 0,
  Floor = 1,
  Wall = 2,
  Door = 3,
  StairsDown = 4,
  StairsUp = 5,
  Water = 6,
  Lava = 7,
  // ── Overworld tiles ──
  Grass = 8,
  Forest = 9,
  Mountain = 10,
  Road = 11,
  Town = 12,
  DungeonEntrance = 13,
  Bridge = 14,
  Sand = 15,
  Snow = 16,
  Desert = 17,
  Swamp = 18,
  // ── Dungeon doors that are not simply open ──
  LockedDoor = 19,
  SecretDoor = 20,
}

const TILE_COLORS: Record<TileType, string> = {
  [TileType.Void]: '#000000',
  [TileType.Floor]: '#2a2a35',
  [TileType.Wall]: '#4a4a5a',
  [TileType.Door]: '#8b6914',
  [TileType.StairsDown]: '#882222',
  [TileType.StairsUp]: '#228822',
  [TileType.Water]: '#224488',
  [TileType.Lava]: '#aa3300',
  [TileType.Grass]: '#2d5a2d',
  [TileType.Forest]: '#1e4024',
  [TileType.Mountain]: '#6a6a72',
  [TileType.Road]: '#8a7a5a',
  [TileType.Town]: '#5a4a3a',
  [TileType.DungeonEntrance]: '#332233',
  [TileType.Bridge]: '#7a6240',
  [TileType.Sand]: '#b0a060',
  [TileType.Snow]: '#d8dce0',
  [TileType.Desert]: '#a08040',
  [TileType.Swamp]: '#2a4a2e',
  [TileType.LockedDoor]: '#a08020',
  [TileType.SecretDoor]: '#4a4a5a',
};

const TILE_LIGHT: Record<TileType, number> = {
  [TileType.Void]: 0,
  [TileType.Floor]: 0.3,
  [TileType.LockedDoor]: 0.2,
  [TileType.SecretDoor]: 0,
  [TileType.Wall]: 0.1,
  [TileType.Door]: 0.35,
  [TileType.StairsDown]: 0.3,
  [TileType.StairsUp]: 0.3,
  [TileType.Water]: 0.25,
  [TileType.Lava]: 0.5,
  [TileType.Grass]: 0.55,
  [TileType.Forest]: 0.35,
  [TileType.Mountain]: 0.5,
  [TileType.Road]: 0.55,
  [TileType.Town]: 0.6,
  [TileType.DungeonEntrance]: 0.3,
  [TileType.Bridge]: 0.55,
  [TileType.Sand]: 0.65,
  [TileType.Snow]: 0.75,
  [TileType.Desert]: 0.65,
  [TileType.Swamp]: 0.35,
};

export class TileMap {
  public tiles: TileType[][] = [];
  public explored: boolean[][] = [];
  public width: number;
  public height: number;

  constructor(width: number = MAP_WIDTH, height: number = MAP_HEIGHT) {
    this.width = width;
    this.height = height;
    this.tiles = Array.from({ length: height }, () =>
      Array(width).fill(TileType.Void)
    );
    this.explored = Array.from({ length: height }, () =>
      Array(width).fill(false)
    );
  }

  getTile(x: number, y: number): TileType {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return TileType.Void;
    return this.tiles[y][x];
  }

  setTile(x: number, y: number, type: TileType) {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
      this.tiles[y][x] = type;
    }
  }

  isWalkable(x: number, y: number): boolean {
    const t = this.getTile(x, y);
    return t === TileType.Floor || t === TileType.Door || t === TileType.StairsDown || t === TileType.StairsUp
      || t === TileType.Grass || t === TileType.Forest || t === TileType.Road || t === TileType.Town
      || t === TileType.DungeonEntrance || t === TileType.Bridge || t === TileType.Sand
      || t === TileType.Snow || t === TileType.Desert || t === TileType.Swamp;
  }

  reveal(x: number, y: number, radius: number = 7) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < this.width && ny < this.height) {
          if (dx * dx + dy * dy <= radius * radius) {
            this.explored[ny][nx] = true;
          }
        }
      }
    }
  }

  /** Simple BFS-driven dungeon: carve rooms and corridors */
  fillRect(x: number, y: number, w: number, h: number, type: TileType) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.setTile(x + dx, y + dy, type);
      }
    }
  }

  carveHCorridor(x1: number, x2: number, y: number) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      this.setTile(x, y, TileType.Floor);
    }
  }

  carveVCorridor(y1: number, y2: number, x: number) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      this.setTile(x, y, TileType.Floor);
    }
  }
}
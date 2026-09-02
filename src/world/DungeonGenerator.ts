import { TileMap, TileType } from './TileMap';
import { MAP_WIDTH, MAP_HEIGHT } from '../engine/types';
import type { RoomFeature } from './RoomFeatures';

export interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** A distinct feature/object in this room (altar, vault, chokepoint...). */
  feature?: RoomFeature;
}

export function generateDungeon(
  map: TileMap,
  numRooms: number = 12,
  minSize: number = 4,
  maxSize: number = 10,
  seed?: number
): Room[] {
  // A seeded run produces the SAME layout every time (fixed maps per dungeon);
  // unseeded runs fall back to plain Math.random as before.
  const rng = seed === undefined ? Math.random : mulberry32(seed);
  const randInt = (min: number, max: number): number =>
    Math.floor(rng() * (max - min + 1)) + min;

  // Start blank
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      map.setTile(x, y, TileType.Void);
    }
  }

  // Fill border
  for (let x = 0; x < MAP_WIDTH; x++) {
    map.setTile(x, 0, TileType.Void);
    map.setTile(x, MAP_HEIGHT - 1, TileType.Void);
  }
  for (let y = 0; y < MAP_HEIGHT; y++) {
    map.setTile(0, y, TileType.Void);
    map.setTile(MAP_WIDTH - 1, y, TileType.Void);
  }

  const rooms: Room[] = [];
  const margin = 3;

  for (let attempt = 0; attempt < 200 && rooms.length < numRooms; attempt++) {
    const w = randInt(minSize, maxSize);
    const h = randInt(minSize, maxSize);
    const x = randInt(margin, MAP_WIDTH - w - margin);
    const y = randInt(margin, MAP_HEIGHT - h - margin);

    // Check overlap
    let overlaps = false;
    for (const r of rooms) {
      if (
        x < r.x + r.width + 1 &&
        x + w + 1 > r.x &&
        y < r.y + r.height + 1 &&
        y + h + 1 > r.y
      ) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    // Carve room
    map.fillRect(x, y, w, h, TileType.Floor);

    // Walls around room
    for (let dx = -1; dx <= w; dx++) {
      if (map.getTile(x + dx, y - 1) === TileType.Void) map.setTile(x + dx, y - 1, TileType.Wall);
      if (map.getTile(x + dx, y + h) === TileType.Void) map.setTile(x + dx, y + h, TileType.Wall);
    }
    for (let dy = -1; dy <= h; dy++) {
      if (map.getTile(x - 1, y + dy) === TileType.Void) map.setTile(x - 1, y + dy, TileType.Wall);
      if (map.getTile(x + w, y + dy) === TileType.Void) map.setTile(x + w, y + dy, TileType.Wall);
    }

    const room: Room = {
      x,
      y,
      width: w,
      height: h,
      cx: x + Math.floor(w / 2),
      cy: y + Math.floor(h / 2),
    };
    rooms.push(room);
  }

  // Connect rooms with 1-wide corridors. The party is a flexible formation
  // (2×2 in open space, single-file in tight passages), so narrow corridors
  // are no obstacle — and they make for classic dungeon crawling.
  for (let i = 1; i < rooms.length; i++) {
    const prev = rooms[i - 1];
    const curr = rooms[i];

    if (randInt(0, 1) === 0) {
      map.carveHCorridor(prev.cx, curr.cx, prev.cy);
      map.carveVCorridor(prev.cy, curr.cy, curr.cx);
    } else {
      map.carveVCorridor(prev.cy, curr.cy, prev.cx);
      map.carveHCorridor(prev.cx, curr.cx, curr.cy);
    }
  }

  // Loop corridors: connect a few non-adjacent rooms so the dungeon has
  // shortcuts and alternate routes — real dungeons aren't a single chain.
  const loopCount = Math.max(2, Math.floor(rooms.length / 4));
  for (let i = 0; i < loopCount; i++) {
    const a = rooms[randInt(0, rooms.length - 1)];
    const b = rooms[randInt(0, rooms.length - 1)];
    if (a === b) continue;
    if (randInt(0, 1) === 0) {
      map.carveHCorridor(a.cx, b.cx, a.cy);
      map.carveVCorridor(a.cy, b.cy, b.cx);
    } else {
      map.carveVCorridor(a.cy, b.cy, a.cx);
      map.carveHCorridor(a.cx, b.cx, b.cy);
    }
  }

  // Water features: some rooms flood with shallow water — hazards and
  // flavor. Roughly one in six rooms, never the first (entrance) room.
  for (let i = 1; i < rooms.length; i++) {
    if (rng() < 0.16) {
      const r = rooms[i];
      const pw = Math.max(2, Math.floor(r.width / 2));
      const ph = Math.max(2, Math.floor(r.height / 2));
      const px = r.x + randInt(0, Math.max(0, r.width - pw));
      const py = r.y + randInt(0, Math.max(0, r.height - ph));
      map.fillRect(px, py, pw, ph, TileType.Water);
    }
  }

  // Second pass: ensure all void cells next to floor become walls
  for (let y = 1; y < MAP_HEIGHT - 1; y++) {
    for (let x = 1; x < MAP_WIDTH - 1; x++) {
      if (map.getTile(x, y) === TileType.Void) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (map.getTile(x + dx, y + dy) === TileType.Floor) {
              map.setTile(x, y, TileType.Wall);
            }
          }
        }
      }
    }
  }

  // Place stairs down in the last room
  if (rooms.length > 0) {
    const last = rooms[rooms.length - 1];
    map.setTile(last.cx, last.cy, TileType.StairsDown);
  }

  // Place a door in the first room entrance
  if (rooms.length > 0) {
    const first = rooms[0];
    map.setTile(first.x - 1, first.cy, TileType.Door);
  }

  return rooms;
}

/** FNV-1a string hash — turns a stable id like 'gate_7' into a 32-bit seed. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tiny fast seeded PRNG (mulberry32) — deterministic per seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
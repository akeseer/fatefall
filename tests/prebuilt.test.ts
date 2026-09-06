import { describe, it, expect } from 'vitest';
import { PREBUILT_DUNGEONS } from '../src/data/PrebuiltDungeons';
import { decodeRow, loadPrebuiltFloor, pickPrebuilt, getPrebuilt } from '../src/world/Prebuilt';
import { TileMap, TileType } from '../src/world/TileMap';
import { getMonsterTemplate } from '../src/entities/Monster';
import { LOCATIONS } from '../src/ai/DnDKnowledge';

function reachable(map: TileMap, sx: number, sy: number): Set<string> {
  const seen = new Set<string>([`${sx},${sy}`]);
  const q: [number, number][] = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (!seen.has(k) && map.isWalkable(nx, ny)) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen;
}

describe('the hundred pre-built dungeons', () => {
  it('are a hundred, uniquely named, each on a real theme, two to six floors deep', () => {
    expect(PREBUILT_DUNGEONS.length).toBe(100);
    expect(new Set(PREBUILT_DUNGEONS.map(d => d.id)).size).toBe(100);
    expect(new Set(PREBUILT_DUNGEONS.map(d => d.name)).size).toBe(100);
    for (const d of PREBUILT_DUNGEONS) {
      expect(LOCATIONS.some(l => l.id === d.themeId), d.themeId).toBe(true);
      expect(d.floors.length).toBeGreaterThanOrEqual(2);
      expect(d.floors.length).toBeLessThanOrEqual(6);
      expect(d.description.length).toBeGreaterThan(20);
    }
    const themes = new Set(PREBUILT_DUNGEONS.map(d => d.themeId));
    expect(themes.size).toBeGreaterThanOrEqual(28);
  });

  it('decodes run-length rows', () => {
    expect(decodeRow('3#4.3#')).toBe('###....###');
    expect(decodeRow('#.#')).toBe('#.#');
    expect(decodeRow('12 ')).toBe(' '.repeat(12));
  });

  it('every floor loads, connects its start to its boss hall, and stairs go down except at the bottom', () => {
    for (const d of PREBUILT_DUNGEONS) {
      d.floors.forEach((floor, i) => {
        const map = new TileMap();
        const rooms = loadPrebuiltFloor(map, floor);
        const label = `${d.id} floor ${i + 1}`;
        expect(rooms.length, label).toBeGreaterThanOrEqual(4);
        const start = rooms[0];
        expect(map.isWalkable(start.cx, start.cy), label).toBe(true);
        const seen = reachable(map, start.cx, start.cy);
        const hall = rooms[rooms.length - 1];
        expect(seen.has(`${hall.cx},${hall.cy}`), label).toBe(true);
        for (const r of rooms) expect(seen.has(`${r.cx},${r.cy}`), `${label} room`).toBe(true);
        const [, bx, by] = floor.boss;
        expect(map.isWalkable(bx, by), `${label} boss tile`).toBe(true);
        expect(seen.has(`${bx},${by}`), `${label} boss reachable`).toBe(true);
        expect(bx >= hall.x && bx < hall.x + hall.width && by >= hall.y && by < hall.y + hall.height, `${label} boss in hall`).toBe(true);
        let stairs = 0;
        for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.getTile(x, y) === TileType.StairsDown) stairs++;
        expect(stairs, `${label} stairs`).toBe(i === d.floors.length - 1 ? 0 : 1);
      });
    }
  });

  it('every creature is real, stands on a walkable tile inside a room, and no two share a tile', () => {
    let total = 0;
    for (const d of PREBUILT_DUNGEONS) {
      d.floors.forEach((floor, i) => {
        const map = new TileMap();
        const rooms = loadPrebuiltFloor(map, floor);
        const label = `${d.id} floor ${i + 1}`;
        const tiles = new Set<string>();
        const inRoom = (x: number, y: number) => rooms.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
        for (const [id, x, y] of [...floor.monsters, floor.boss]) {
          expect(getMonsterTemplate(id), `${label} ${id}`).toBeDefined();
          expect(map.isWalkable(x, y), `${label} ${id} at ${x},${y}`).toBe(true);
          expect(inRoom(x, y), `${label} ${id} in a room`).toBe(true);
          expect(tiles.has(`${x},${y}`), `${label} shared tile`).toBe(false);
          tiles.add(`${x},${y}`);
          total++;
        }
        // Nothing in the start room.
        const s = rooms[0];
        for (const [, x, y] of floor.monsters) {
          expect(x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height, `${label} monster in start room`).toBe(false);
        }
      });
    }
    expect(total).toBeGreaterThan(4000);
  });

  it('bosses grow with depth', () => {
    for (const d of PREBUILT_DUNGEONS) {
      const first = getMonsterTemplate(d.floors[0].boss[0])!;
      const last = getMonsterTemplate(d.floors[d.floors.length - 1].boss[0])!;
      expect(last.cr, d.id).toBeGreaterThanOrEqual(first.cr);
    }
  });

  it('picks by theme first, then anything unused, and runs out honestly', () => {
    const used = new Set<string>();
    const a = pickPrebuilt('royal_crypt', used, () => 0)!;
    expect(a.themeId).toBe('royal_crypt');
    used.add(a.id);
    const b = pickPrebuilt('royal_crypt', used, () => 0)!;
    expect(b.id).not.toBe(a.id);
    const everything = new Set(PREBUILT_DUNGEONS.map(d => d.id));
    expect(pickPrebuilt('royal_crypt', everything)).toBeUndefined();
    expect(getPrebuilt('prebuilt_001')?.id).toBe('prebuilt_001');
    expect(getPrebuilt(undefined)).toBeUndefined();
  });
});

/**
 * Pathfinding — one navigation brain for everything that moves on a TileMap.
 *
 * A* with per-terrain movement costs: the party prefers roads and open grass,
 * balks at mountains and swamps, and wades water only when it must. A binary
 * heap keeps the open set fast on the 320×220 overworld, and a node budget
 * with greedy-nearest fallback means even pathological maps return a useful
 * path (toward the goal) instead of hanging or giving up.
 */
import { TileMap, TileType } from './TileMap';
import { Vector2 } from '../engine/types';

/** Movement cost of stepping onto each walkable tile. Higher = slower. */
const TERRAIN_COST: Partial<Record<TileType, number>> = {
  // Dungeons: even footing.
  [TileType.Floor]: 1,
  [TileType.Door]: 1,
  [TileType.StairsDown]: 1,
  [TileType.StairsUp]: 1,
  // Overworld: roads and bridges are the fast lanes of the realm.
  [TileType.Road]: 0.6,
  [TileType.Bridge]: 0.7,
  [TileType.Town]: 1,
  [TileType.DungeonEntrance]: 1,
  [TileType.Grass]: 1,
  // Wilds: undergrowth, heat, powder and mire slow the march.
  [TileType.Sand]: 1.2,
  [TileType.Snow]: 1.3,
  [TileType.Desert]: 1.4,
  [TileType.Forest]: 1.7,
  [TileType.Swamp]: 2.2,
  [TileType.Mountain]: 2.6,
  [TileType.Water]: 3, // shallow wading — possible, never welcome
};

function costOf(map: TileMap, x: number, y: number): number {
  return TERRAIN_COST[map.getTile(x, y)] ?? 1;
}

export interface PathOptions {
  /** Cap on expanded nodes; on exhaustion the best partial path is returned. */
  maxNodes?: number;
  /** Extra tiles to treat as blocked (e.g. occupied by another creature). */
  blocked?: (x: number, y: number) => boolean;
}

interface HeapNode {
  idx: number;      // y * width + x
  f: number;        // estimated total cost
}

/** Minimal binary min-heap keyed on f. */
class MinHeap {
  private a: HeapNode[] = [];

  get size(): number { return this.a.length; }

  push(n: HeapNode): void {
    this.a.push(n);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].f <= this.a[i].f) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }

  pop(): HeapNode | undefined {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length > 0 && last) {
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && this.a[l].f < this.a[m].f) m = l;
        if (r < this.a.length && this.a[r].f < this.a[m].f) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * A* over the tile map. Returns the path EXCLUDING the start tile, in walking
 * order (path[0] is the first step, last element is the goal), or [] when the
 * goal is truly unreachable. With a node budget hit, returns the best partial
 * path — as close to the goal as the budget allowed.
 */
export function astarPath(
  map: TileMap,
  from: Vector2,
  to: Vector2,
  opts: PathOptions = {}
): Vector2[] {
  const w = map.width;
  const h = map.height;
  if (from.x < 0 || from.y < 0 || from.x >= w || from.y >= h) return [];
  if (to.x < 0 || to.y < 0 || to.x >= w || to.y >= h) return [];
  if (from.x === to.x && from.y === to.y) return [];

  const maxNodes = opts.maxNodes ?? 24000;
  const startIdx = from.y * w + from.x;
  const goalIdx = to.y * w + to.x;

  const g = new Float32Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);

  const hDist = (idx: number): number => {
    const x = idx % w;
    const y = (idx / w) | 0;
    // Roads cost 0.6, so scale the Manhattan lower bound by the cheapest
    // possible step. This keeps A* admissible while still guiding long routes.
    return (Math.abs(x - to.x) + Math.abs(y - to.y)) * 0.6;
  };

  g[startIdx] = 0;
  const open = new MinHeap();
  open.push({ idx: startIdx, f: hDist(startIdx) });

  let expanded = 0;
  let bestIdx = startIdx;
  let bestH = hDist(startIdx);

  while (open.size > 0 && expanded < maxNodes) {
    const cur = open.pop()!;
    if (closed[cur.idx]) continue;
    closed[cur.idx] = 1;
    expanded++;

    const ch = hDist(cur.idx);
    if (ch < bestH) { bestH = ch; bestIdx = cur.idx; }

    if (cur.idx === goalIdx) {
      return reconstruct(prev, goalIdx, w);
    }

    const cx = cur.idx % w;
    const cy = (cur.idx / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      if (!map.isWalkable(nx, ny)) continue;
      if (opts.blocked && opts.blocked(nx, ny) && ni !== goalIdx) continue;
      const ng = g[cur.idx] + costOf(map, nx, ny);
      if (ng < g[ni]) {
        g[ni] = ng;
        prev[ni] = cur.idx;
        open.push({ idx: ni, f: ng + hDist(ni) });
      }
    }
  }

  // Only return a partial route when the explicit safety budget was reached.
  // If the open set drained naturally, the goal is genuinely unreachable;
  // pretending otherwise makes callers repeatedly walk toward a dead end.
  if (expanded >= maxNodes && bestIdx !== startIdx) {
    return reconstruct(prev, bestIdx, w);
  }
  return [];
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function reconstruct(prev: Int32Array, goalIdx: number, w: number): Vector2[] {
  const path: Vector2[] = [];
  let cur = goalIdx;
  let guard = 0;
  while (cur !== -1 && guard++ < 100000) {
    path.push({ x: cur % w, y: (cur / w) | 0 });
    cur = prev[cur];
  }
  path.reverse();
  path.shift(); // drop the start tile — callers want steps
  return path;
}

/**
 * Cheapest-cost BFS (Dijkstra with early exit) — same costs as A* without the
 * heuristic. Kept for callers that want the optimal path to MANY goals at
 * once (one flood, many extractions), e.g. picking the nearest unexplored room.
 */
export function dijkstraField(
  map: TileMap,
  from: Vector2,
  maxNodes: number = 24000
): { dist: Float32Array; prev: Int32Array } {
  const w = map.width;
  const h = map.height;
  const dist = new Float32Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  if (from.x < 0 || from.y < 0 || from.x >= w || from.y >= h) return { dist, prev };
  const startIdx = from.y * w + from.x;
  dist[startIdx] = 0;
  const open = new MinHeap();
  open.push({ idx: startIdx, f: 0 });
  let expanded = 0;
  while (open.size > 0 && expanded < maxNodes) {
    const cur = open.pop()!;
    if (closed[cur.idx]) continue; // stale heap entry
    closed[cur.idx] = 1;
    expanded++;
    const cx = cur.idx % w;
    const cy = (cur.idx / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!map.isWalkable(nx, ny)) continue;
      const nd = dist[cur.idx] + costOf(map, nx, ny);
      if (nd < dist[ni]) {
        dist[ni] = nd;
        prev[ni] = cur.idx;
        open.push({ idx: ni, f: nd });
      }
    }
  }
  return { dist, prev };
}

/** True when a walkable route exists (cheap A* with a tiny budget). */
export function isReachable(map: TileMap, from: Vector2, to: Vector2): boolean {
  if (from.x === to.x && from.y === to.y) return true;
  return astarPath(map, from, to, { maxNodes: 6000 }).length > 0
    ? true
    : astarPath(map, from, to, { maxNodes: 30000 }).length > 0;
}

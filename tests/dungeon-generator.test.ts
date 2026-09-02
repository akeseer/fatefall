import { describe, it, expect } from 'vitest';
import { generateDungeon, hashSeed } from '../src/world/DungeonGenerator';
import { TileMap } from '../src/world/TileMap';

// Ported from scripts/audit_seeded.mjs: seeded delves must be reproducible.
const run = (seed: number | undefined) => {
  const map = new TileMap();
  const rooms = generateDungeon(map, 14, 4, 10, seed);
  return { rooms: rooms.length, tiles: JSON.stringify(map.tiles) };
};

describe('generateDungeon (seeded)', () => {
  it('hashSeed is deterministic and distinguishes inputs', () => {
    expect(hashSeed('gate_7::floor-3')).toBe(hashSeed('gate_7::floor-3'));
    expect(hashSeed('gate_7::floor-3')).not.toBe(hashSeed('gate_7::floor-4'));
  });

  it('same seed gives an identical map and room count', () => {
    const a = run(hashSeed('gate_7::floor-3'));
    const b = run(hashSeed('gate_7::floor-3'));
    expect(a.tiles).toBe(b.tiles);
    expect(a.rooms).toBe(b.rooms);
  });

  it('a different floor or dungeon gives a different map', () => {
    const a = run(hashSeed('gate_7::floor-3'));
    expect(run(hashSeed('gate_7::floor-4')).tiles).not.toBe(a.tiles);
    expect(run(hashSeed('gate_12::floor-3')).tiles).not.toBe(a.tiles);
  });

  it('unseeded runs still vary', () => {
    expect(run(undefined).tiles).not.toBe(run(undefined).tiles);
  });

  it('produces between 4 and 14 rooms', () => {
    const r = run(hashSeed('x')).rooms;
    expect(r).toBeGreaterThanOrEqual(4);
    expect(r).toBeLessThanOrEqual(14);
  });
});

import { generateDungeon, hashSeed } from '../src/world/DungeonGenerator.ts';
import { TileMap } from '../src/world/TileMap.ts';

// Same entrance id + floor must give byte-identical maps.
const seed1 = hashSeed('gate_7::floor-3');
const seed2 = hashSeed('gate_7::floor-3');
const seedOther = hashSeed('gate_7::floor-4');
const seedOtherDungeon = hashSeed('gate_12::floor-3');

const run = (seed) => {
  const map = new TileMap();
  const rooms = generateDungeon(map, 14, 4, 10, seed);
  return { rooms: rooms.length, tiles: JSON.stringify(map.tiles) };
};

const a = run(seed1), b = run(seed2), c = run(seedOther), d = run(seedOtherDungeon);
// Unseeded runs must still vary (randomness preserved for unthemed delves).
const r1 = run(undefined), r2 = run(undefined);

console.log('same seed identical:', a.tiles === b.tiles && a.rooms === b.rooms ? 'PASS' : 'FAIL');
console.log('different floor differs:', a.tiles !== c.tiles ? 'PASS' : 'FAIL');
console.log('different dungeon differs:', a.tiles !== d.tiles ? 'PASS' : 'FAIL');
console.log('unseeded still random:', r1.tiles !== r2.tiles ? 'PASS' : 'FAIL');
console.log('rooms per seeded run:', a.rooms, b.rooms, c.rooms, d.rooms);

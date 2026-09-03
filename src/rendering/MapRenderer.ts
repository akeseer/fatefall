import { Camera } from '../engine/Camera';
import { TileMap, TileType } from '../world/TileMap';
import { GameCharacter } from '../entities/Character';
import { Monster } from '../entities/Monster';
import { SpriteRenderer } from '../entities/Sprites';
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, GAME_WIDTH, GAME_HEIGHT } from '../engine/types';
import { ActiveCondition, CONDITION_META } from '../rules/Rules';
import { PlacedTrap, getTrapKind } from '../traps/Traps';
import type { Room } from '../world/DungeonGenerator';
import type { RoomFeatureKind } from '../world/RoomFeatures';
import type { Wanderer } from '../world/OverworldLife';
import type { OverworldEntrance, OverworldTown } from '../world/Overworld';

const FOG_COLOR = '#0a0a12';

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
};

/**
 * ── Overworld terrain transitions ──
 *
 * Two terrains that meet on a 32 px grid otherwise show a perfectly straight
 * staircase, which is the single thing that makes a tile map read as a
 * spreadsheet rather than a drawn map. Every overworld tile therefore paints a
 * broken band of its *stronger* neighbours over its own edge, so the seam is
 * settled once, in one direction, by rank:
 *
 *   water < swamp < grass < forest < desert < sand < snow < mountain
 *          < town < road/bridge < dungeon entrance
 *
 * Sand spills onto grass, snow creeps over forest, scree tumbles off the
 * mountains, road dirt feathers into the verge. The recessive tile does all the
 * work, so no two tiles ever fight over the same boundary and nothing has to be
 * drawn twice.
 *
 * Water is the exception, and gets a real coast instead of a bleed: the land
 * tile lays down a damp-sand fringe on its side and the water tile lays down a
 * band of shallows with a little foam on its own. Each half is drawn by the
 * tile it belongs to, so a shoreline is still decided by rank, not contested.
 */
const TERRAIN_RANK: Partial<Record<TileType, number>> = {
  [TileType.Water]: 0,
  [TileType.Swamp]: 1,
  [TileType.Grass]: 2,
  [TileType.Forest]: 3,
  [TileType.Desert]: 4,
  [TileType.Sand]: 5,
  [TileType.Snow]: 6,
  [TileType.Mountain]: 7,
  [TileType.Town]: 8,
  [TileType.Road]: 9,
  [TileType.Bridge]: 9,
  [TileType.DungeonEntrance]: 10,
};

/** The two tones a terrain bleeds with, light first. */
const BLEND_TONES: Partial<Record<TileType, [string, string]>> = {
  [TileType.Swamp]: ['#31563a', '#284a30'],
  [TileType.Grass]: ['#2f5f2f', '#2a542a'],
  [TileType.Forest]: ['#2a5730', '#1f4325'],
  [TileType.Desert]: ['#a4843f', '#95773a'],
  [TileType.Sand]: ['#b6a768', '#a89854'],
  [TileType.Snow]: ['#d8dce0', '#c6ccd4'],
  [TileType.Mountain]: ['#71717c', '#5c5c67'],
  [TileType.Town]: ['#5f5140', '#524534'],
  [TileType.Road]: ['#8a7a5a', '#7b6b4c'],
  [TileType.Bridge]: ['#7a6240', '#69543a'],
  [TileType.DungeonEntrance]: ['#4a4a42', '#3a3a30'],
};

/** Damp sand on the land side of a coast, then the pale line right on the water. */
const SHORE_DAMP: [string, string] = ['#97895e', '#867950'];
const SHORE_RIM = '#bcae80';
/** Shallows on the water side, and the foam that catches on the bank. */
const SHALLOW: [string, string] = ['#3a72b4', '#31679f'];
const FOAM = 'rgba(206,232,255,0.42)';

/** Edge offsets in draw order: north, east, south, west. */
const EDGE_STEPS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** Diagonal offsets plus which corner of the tile each one owns. */
const CORNER_STEPS: readonly (readonly [number, number, number, number])[] = [
  [-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1],
];

/**
 * A stable 0..96 value for one cell of one tile. Position-derived, never
 * random: a shoreline that re-rolled itself every frame would shimmer, which
 * is far worse than a hard edge.
 */
function cellHash(x: number, y: number, k: number): number {
  const h = (x * 7 + y * 13 + k * 29) * (x * 3 + y * 11 + 7);
  return (h < 0 ? -h : h) % 97;
}

/**
 * Lay a flat terrain tile and mottle it.
 *
 * What this replaces is why it exists: every one of these terrains chose its
 * shade with `(x + y) % 2`, a literal checkerboard, and grass picked one of
 * three tones for the whole tile. Either way the variation had a thirty-two
 * pixel period aligned to the lattice, and the eye finds that instantly — the
 * ground read as tiles no matter how good the seams between them were.
 *
 * So the base is one flat colour, and the only variation is a patch smaller
 * than a tile, sized and placed off a hash, on roughly a third of them. It
 * costs a third of a rectangle per tile and has no period to lock onto.
 */
function mottledTile(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, x: number, y: number,
  base: string, patch: string, seed: number,
): void {
  const f = Math.floor;
  ctx.fillStyle = base;
  ctx.fillRect(f(sx), f(sy), TILE_SIZE, TILE_SIZE);
  const h = cellHash(x, y, seed);
  if (h % 3 !== 0) return;
  const w = 9 + (h % 4) * 4;
  const ht = 7 + ((h >> 2) % 4) * 3;
  const px = (h * 5) % (TILE_SIZE - w);
  const py = (h * 11) % (TILE_SIZE - ht);
  ctx.fillStyle = patch;
  ctx.fillRect(f(sx) + px, f(sy) + py, w, ht);
}

/** True where a road may run straight through into the next tile. */
function joinsRoad(map: TileMap, x: number, y: number): boolean {
  const t = map.tiles[y]?.[x];
  return t === TileType.Road || t === TileType.Bridge || t === TileType.Town
    || t === TileType.DungeonEntrance;
}

/** N/E/S/W bitmask of the neighbours a road or bridge carries traffic to. */
function roadLinks(map: TileMap, x: number, y: number): number {
  return (joinsRoad(map, x, y - 1) ? 1 : 0)
    | (joinsRoad(map, x + 1, y) ? 2 : 0)
    | (joinsRoad(map, x, y + 1) ? 4 : 0)
    | (joinsRoad(map, x - 1, y) ? 8 : 0);
}

/**
 * Per-dungeon-theme palettes. Every theme in the game gets its own floor /
 * wall / accent colors so a Feywild Glade reads purple and glowing while an
 * Abyssal Rift reads red and scorched.
 */
interface DungeonPalette {
  floor: string;
  wall: string;
  wallDark: string;
  accent: string; // primary dressing color (moss, runes, crystals...)
  decor: string;  // secondary dressing color
  glow: string;   // magical light color
}

const DEFAULT_PALETTE: DungeonPalette = {
  floor: '#2a2a35',
  wall: '#4a4a5a',
  wallDark: '#3a3a48',
  accent: '#8a8a9a',
  decor: '#5c5c6e',
  glow: '#ffd700',
};

const THEME_PALETTES: Record<string, DungeonPalette> = {
  ancient_dwarven_hall: { floor: '#2a2a35', wall: '#4a4a5a', wallDark: '#3a3a48', accent: '#9a8a5a', decor: '#6a6a7a', glow: '#ffb44a' },
  feywild_glade: { floor: '#2a2038', wall: '#4a3a58', wallDark: '#3a2c46', accent: '#c46ad4', decor: '#6ad48a', glow: '#e0a0ff' },
  shadowfell_crossing: { floor: '#1c1c26', wall: '#36364a', wallDark: '#282838', accent: '#5c6a8a', decor: '#3c4658', glow: '#8ab0e8' },
  thieves_guild_den: { floor: '#2e2618', wall: '#4a3f2a', wallDark: '#3a3220', accent: '#c8a04a', decor: '#7a5c30', glow: '#ffd27a' },
  dragon_graveyard: { floor: '#241a1a', wall: '#3d2c26', wallDark: '#2e201c', accent: '#e06028', decor: '#9a6a44', glow: '#ff9a4a' },
  illithid_colony: { floor: '#221a30', wall: '#3a2c50', wallDark: '#2c203c', accent: '#8a5ce0', decor: '#4ad4c4', glow: '#c0a0ff' },
  sunken_temple: { floor: '#1c2a30', wall: '#2e3f4a', wallDark: '#223038', accent: '#4ad4a4', decor: '#5c8a9a', glow: '#7affd4' },
  wizards_tower_lore_loc: { floor: '#241c38', wall: '#3a3058', wallDark: '#2c2444', accent: '#8a6ae8', decor: '#d4c46a', glow: '#b48aff' },
  goblin_warren: { floor: '#2a2418', wall: '#453a28', wallDark: '#352c1e', accent: '#9a8a4a', decor: '#6a5a3a', glow: '#d4c05a' },
  royal_crypt: { floor: '#26262e', wall: '#45454f', wallDark: '#35353e', accent: '#d4b84a', decor: '#8a8a9a', glow: '#ffe08a' },
  abyssal_rift: { floor: '#241414', wall: '#3d1f1f', wallDark: '#2e1616', accent: '#e03c2a', decor: '#8a2020', glow: '#ff6040' },
  elemental_node_fire: { floor: '#2a1810', wall: '#452a1a', wallDark: '#351f12', accent: '#ff8a30', decor: '#d45820', glow: '#ffb060' },
  vampire_castle: { floor: '#1e1e28', wall: '#383846', wallDark: '#2a2a36', accent: '#c44a6a', decor: '#6a4a7a', glow: '#ff7a9a' },
  celestial_observatory: { floor: '#141828', wall: '#2a3450', wallDark: '#1e2440', accent: '#4a8ae8', decor: '#d4d46a', glow: '#9ac0ff' },
};

function getPalette(themeId?: string): DungeonPalette {
  return (themeId && THEME_PALETTES[themeId]) || DEFAULT_PALETTE;
}

/** Animated world-pixel position of a sprite gliding between tiles. */
interface VisualSprite {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  moveStart: number;
  moveDuration: number;
  progress: number;
  moving: boolean;
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private sprites: SpriteRenderer;
  private time: number = 0;
  private renderTime: number = 0;

  /**
   * Smoothly-animated world positions (px) per party member. The game snaps
   * `member.tile` each AI tick; this lets the sprite glide tile-to-tile so
   * the party visibly marches instead of teleporting.
   */
  private visuals = new WeakMap<GameCharacter, VisualSprite>();

  constructor(ctx: CanvasRenderingContext2D, sprites: SpriteRenderer) {
    this.ctx = ctx;
    this.sprites = sprites;
  }

  render(
    map: TileMap,
    camera: Camera,
    party: GameCharacter[],
    monsters: Monster[],
    traps: PlacedTrap[] = [],
    rooms: Room[] = [],
    themeId?: string,
    dt: number = 16,
    moveMs: number = 400,
    trail: { x: number; y: number }[] = []
  ) {
    this.time += 0.016; // ~60fps increment
    this.renderTime += dt;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const pal = getPalette(themeId);

    // Calculate visible tile range
    const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
    const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
    const endX = Math.min(MAP_WIDTH, startX + Math.ceil(GAME_WIDTH / TILE_SIZE) + 3);
    const endY = Math.min(MAP_HEIGHT, startY + Math.ceil(GAME_HEIGHT / TILE_SIZE) + 3);

    // Draw terrain
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = map.tiles[y]?.[x] ?? TileType.Void;
        const explored = map.explored[y]?.[x] ?? false;

        const sx = x * TILE_SIZE - camera.x;
        const sy = y * TILE_SIZE - camera.y;

        if (explored) {
          // Draw base tile (theme-colored with subtle per-tile variation)
          const vhash = ((x * 31 + y * 57) % 9) - 4; // -4..4 brightness jitter
          if (tile === TileType.Floor || tile === TileType.Wall) {
            ctx.fillStyle = tile === TileType.Wall ? pal.wall : pal.floor;
            ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
            if (vhash > 0) {
              ctx.fillStyle = `rgba(255,255,255,${0.018 * vhash})`;
              ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
            } else if (vhash < 0) {
              ctx.fillStyle = `rgba(0,0,0,${0.022 * -vhash})`;
              ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
            }
          } else {
            ctx.fillStyle = TILE_COLORS[tile] || '#000';
            ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
          }

          // ── Wall: stone block pattern + moss / cracks / runes ──
          if (tile === TileType.Wall) {
            // Mortar lines
            ctx.fillStyle = 'rgba(0,0,0,0.18)';
            const blockH = Math.floor(TILE_SIZE / 3);
            for (let row = 0; row < 3; row++) {
              const offset = row % 2 === 0 ? 0 : Math.floor(TILE_SIZE / 2);
              ctx.fillRect(Math.floor(sx), Math.floor(sy + row * blockH), TILE_SIZE, 1);
              ctx.fillRect(Math.floor(sx + offset), Math.floor(sy + row * blockH), 1, blockH);
              ctx.fillRect(Math.floor(sx + offset + Math.floor(TILE_SIZE / 2)), Math.floor(sy + row * blockH), 1, blockH);
            }
            // Top highlight on each block
            ctx.fillStyle = 'rgba(255,255,255,0.07)';
            for (let row = 0; row < 3; row++) {
              const offset = row % 2 === 0 ? 0 : Math.floor(TILE_SIZE / 2);
              ctx.fillRect(Math.floor(sx + offset + 2), Math.floor(sy + row * blockH + 1), Math.floor(TILE_SIZE / 2) - 4, 1);
            }
            // Bottom shadow on each block
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            for (let row = 0; row < 3; row++) {
              ctx.fillRect(Math.floor(sx + 1), Math.floor(sy + (row + 1) * blockH - 1), TILE_SIZE - 2, 1);
            }

            // Wall dressing
            const whash = (x * 17 + y * 29) % 24;
            if (whash === 0) {
              // Cracked block
              ctx.fillStyle = 'rgba(0,0,0,0.25)';
              ctx.fillRect(Math.floor(sx) + 12, Math.floor(sy) + 4, 8, 1);
              ctx.fillRect(Math.floor(sx) + 16, Math.floor(sy) + 4, 1, 10);
              ctx.fillRect(Math.floor(sx) + 8, Math.floor(sy) + 14, 8, 1);
            } else if (whash === 1) {
              // Moss / lichen patch at the base
              ctx.fillStyle = `${pal.accent}55`;
              ctx.fillRect(Math.floor(sx) + 3, Math.floor(sy) + TILE_SIZE - 6, 10, 4);
              ctx.fillRect(Math.floor(sx) + 16, Math.floor(sy) + TILE_SIZE - 4, 8, 3);
            } else if (whash === 2) {
              // Faint glowing rune
              const runePulse = Math.sin(this.time * 2 + x * 0.7 + y) * 0.2 + 0.5;
              ctx.fillStyle = `${pal.glow}${Math.floor(20 + runePulse * 30).toString(16)}`;
              ctx.fillRect(Math.floor(sx) + 12, Math.floor(sy) + 10, 8, 2);
              ctx.fillRect(Math.floor(sx) + 15, Math.floor(sy) + 12, 2, 8);
            } else if (whash === 3) {
              // Wall sconce (bracket + flame)
              ctx.fillStyle = 'rgba(60,50,30,0.8)';
              ctx.fillRect(Math.floor(sx) + 26, Math.floor(sy) + 12, 4, 2);
              ctx.fillRect(Math.floor(sx) + 27, Math.floor(sy) + 8, 2, 4);
              const flame = Math.sin(this.time * 9 + x) * 0.5 + 1.5;
              ctx.fillStyle = `rgba(255,170,60,${0.5 + Math.sin(this.time * 9 + x) * 0.2})`;
              ctx.fillRect(Math.floor(sx) + 27, Math.floor(sy) + 6, 2, 2);
              ctx.fillRect(Math.floor(sx) + 26, Math.floor(sy) + 5, 4, 1);
            }
          }

          // ── Floor: cobblestone, cracks, and theme dressing ──
          if (tile === TileType.Floor) {
            const hash = (x * 7 + y * 13) % 80;
            // Stone slab edges
            ctx.fillStyle = 'rgba(255,255,255,0.03)';
            ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, 1);
            ctx.fillRect(Math.floor(sx), Math.floor(sy), 1, TILE_SIZE);
            ctx.fillStyle = 'rgba(0,0,0,0.08)';
            ctx.fillRect(Math.floor(sx) + TILE_SIZE - 1, Math.floor(sy), 1, TILE_SIZE);
            ctx.fillRect(Math.floor(sx), Math.floor(sy) + TILE_SIZE - 1, TILE_SIZE, 1);

            // Crack pattern
            if (hash < 4) {
              ctx.fillStyle = 'rgba(0,0,0,0.15)';
              ctx.fillRect(Math.floor(sx) + 8, Math.floor(sy) + 12, 10, 1);
              ctx.fillRect(Math.floor(sx) + 15, Math.floor(sy) + 12, 1, 8);
            }
            // Pebble scatter
            if (hash >= 4 && hash < 6) {
              ctx.fillStyle = 'rgba(180,175,165,0.14)';
              ctx.fillRect(Math.floor(sx) + 6, Math.floor(sy) + 20, 3, 2);
              ctx.fillRect(Math.floor(sx) + 18, Math.floor(sy) + 8, 2, 2);
            }
            // Scattered bones (D&D classic)
            if (hash >= 6 && hash < 8) {
              ctx.fillStyle = 'rgba(216,208,184,0.2)';
              ctx.fillRect(Math.floor(sx) + 5, Math.floor(sy) + 18, 16, 2);
              ctx.fillRect(Math.floor(sx) + 5, Math.floor(sy) + 16, 2, 6);
              ctx.fillRect(Math.floor(sx) + 19, Math.floor(sy) + 16, 2, 6);
              ctx.fillStyle = 'rgba(0,0,0,0.15)';
              ctx.fillRect(Math.floor(sx) + 22, Math.floor(sy) + 14, 4, 4);
            }
            // Bloodstain (darker in bloody themes)
            if (hash >= 8 && hash < 10) {
              ctx.fillStyle = 'rgba(120,20,20,0.18)';
              ctx.fillRect(Math.floor(sx) + 10, Math.floor(sy) + 14, 8, 6);
              ctx.fillStyle = 'rgba(80,10,10,0.12)';
              ctx.fillRect(Math.floor(sx) + 12, Math.floor(sy) + 18, 4, 4);
            }
            // Gold coin glint (sparkles in treasure themes)
            if (hash >= 10 && hash < 12) {
              const sparkle = Math.sin(this.time * 3 + x + y) * 0.3 + 0.5;
              ctx.fillStyle = `${pal.glow}${Math.floor(18 + sparkle * 20).toString(16)}`;
              ctx.fillRect(Math.floor(sx) + 14, Math.floor(sy) + 10, 3, 3);
            }
            // Moss tuft
            if (hash >= 12 && hash < 14) {
              ctx.fillStyle = `${pal.accent}44`;
              ctx.fillRect(Math.floor(sx) + 5, Math.floor(sy) + 22, 6, 3);
              ctx.fillRect(Math.floor(sx) + 13, Math.floor(sy) + 24, 8, 2);
            }
            // Glowing mushroom cluster (fey / underdark)
            if (hash >= 14 && hash < 16) {
              const glow = Math.sin(this.time * 2.5 + x + y) * 0.2 + 0.4;
              ctx.fillStyle = 'rgba(160,160,170,0.4)';
              ctx.fillRect(Math.floor(sx) + 10, Math.floor(sy) + 20, 2, 6);
              ctx.fillRect(Math.floor(sx) + 18, Math.floor(sy) + 22, 2, 4);
              ctx.fillStyle = `${pal.glow}${Math.floor(30 + glow * 40).toString(16)}`;
              ctx.fillRect(Math.floor(sx) + 8, Math.floor(sy) + 18, 6, 3);
              ctx.fillRect(Math.floor(sx) + 17, Math.floor(sy) + 20, 5, 3);
            }
            // Frost crystals (cold themes)
            if (hash >= 16 && hash < 18) {
              ctx.fillStyle = 'rgba(200,230,255,0.35)';
              ctx.fillRect(Math.floor(sx) + 12, Math.floor(sy) + 14, 2, 8);
              ctx.fillRect(Math.floor(sx) + 17, Math.floor(sy) + 16, 2, 6);
              ctx.fillRect(Math.floor(sx) + 14, Math.floor(sy) + 12, 2, 2);
            }
            // Scorch mark (fiery themes)
            if (hash >= 18 && hash < 20) {
              ctx.fillStyle = 'rgba(20,8,4,0.5)';
              ctx.fillRect(Math.floor(sx) + 8, Math.floor(sy) + 16, 16, 10);
              ctx.fillStyle = 'rgba(120,60,20,0.3)';
              ctx.fillRect(Math.floor(sx) + 11, Math.floor(sy) + 19, 10, 5);
            }
            // Puddle / water stain
            if (hash >= 20 && hash < 22) {
              ctx.fillStyle = 'rgba(90,140,190,0.18)';
              ctx.fillRect(Math.floor(sx) + 8, Math.floor(sy) + 14, 14, 9);
              ctx.fillStyle = 'rgba(160,200,230,0.12)';
              ctx.fillRect(Math.floor(sx) + 10, Math.floor(sy) + 16, 6, 3);
            }
            // Dried blood streaks (violent themes)
            if (hash >= 22 && hash < 24) {
              ctx.fillStyle = 'rgba(100,16,16,0.22)';
              ctx.fillRect(Math.floor(sx) + 6, Math.floor(sy) + 10, 3, 12);
              ctx.fillRect(Math.floor(sx) + 20, Math.floor(sy) + 8, 2, 10);
            }
            // Cobweb in corner
            if (hash >= 24 && hash < 25) {
              ctx.fillStyle = 'rgba(200,200,210,0.08)';
              ctx.fillRect(Math.floor(sx), Math.floor(sy), 8, 1);
              ctx.fillRect(Math.floor(sx), Math.floor(sy), 1, 8);
              ctx.fillRect(Math.floor(sx) + 1, Math.floor(sy) + 1, 6, 1);
              ctx.fillRect(Math.floor(sx) + 1, Math.floor(sy) + 1, 1, 6);
            }
          }

          // ── Door: wooden frame with iron bands ──
          if (tile === TileType.Door) {
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(Math.floor(sx), Math.floor(sy), 2, TILE_SIZE);
            ctx.fillRect(Math.floor(sx) + TILE_SIZE - 2, Math.floor(sy), 2, TILE_SIZE);
            // Wood grain
            ctx.fillStyle = 'rgba(139,105,20,0.3)';
            for (let i = 0; i < 4; i++) {
              ctx.fillRect(Math.floor(sx) + 4 + i * 5, Math.floor(sy) + 3, 2, TILE_SIZE - 6);
            }
            // Iron bands
            ctx.fillStyle = 'rgba(100,100,110,0.4)';
            ctx.fillRect(Math.floor(sx) + 2, Math.floor(sy) + 4, TILE_SIZE - 4, 2);
            ctx.fillRect(Math.floor(sx) + 2, Math.floor(sy) + TILE_SIZE - 6, TILE_SIZE - 4, 2);
            // Handle
            ctx.fillStyle = 'rgba(180,160,100,0.5)';
            ctx.fillRect(Math.floor(sx) + TILE_SIZE - 8, Math.floor(sy) + Math.floor(TILE_SIZE / 2) - 2, 3, 4);
          }

          // ── Stairs: engraved steps with glow ──
          if (tile === TileType.StairsDown || tile === TileType.StairsUp) {
            const down = tile === TileType.StairsDown;
            const glow = Math.sin(this.time * 2) * 0.1 + 0.4;
            ctx.fillStyle = down ? `rgba(255,122,74,${glow * 0.3})` : `rgba(90,255,138,${glow * 0.3})`;
            ctx.fillRect(Math.floor(sx) + 2, Math.floor(sy) + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            ctx.fillStyle = down ? '#ff7a4a' : '#5aff8a';
            const bars = down ? [14, 10, 6] : [6, 10, 14];
            for (let i = 0; i < bars.length; i++) {
              ctx.fillRect(
                Math.floor(sx) + (TILE_SIZE - bars[i]) / 2,
                Math.floor(sy) + 6 + i * 7,
                bars[i],
                3
              );
            }
            ctx.fillStyle = down ? '#ffa' : '#afa';
            const ax = Math.floor(sx) + TILE_SIZE / 2;
            const ay = down ? Math.floor(sy) + 3 : Math.floor(sy) + TILE_SIZE - 5;
            ctx.fillRect(ax - 1, ay, 3, 2);
            if (down) {
              ctx.fillRect(ax - 2, ay - 1, 1, 1);
              ctx.fillRect(ax + 2, ay - 1, 1, 1);
            } else {
              ctx.fillRect(ax - 2, ay + 2, 1, 1);
              ctx.fillRect(ax + 2, ay + 2, 1, 1);
            }
          }

          // ── Water: animated ripples and reflections ──
          if (tile === TileType.Water) {
            const wave1 = Math.sin(this.time * 2 + x * 0.8) * 0.15;
            const wave2 = Math.cos(this.time * 1.5 + y * 0.6) * 0.1;
            ctx.fillStyle = `rgba(100,160,220,${0.15 + wave1})`;
            ctx.fillRect(Math.floor(sx) + 4, Math.floor(sy) + 10 + Math.sin(this.time + x) * 2, TILE_SIZE - 8, 2);
            ctx.fillStyle = `rgba(140,190,240,${0.12 + wave2})`;
            ctx.fillRect(Math.floor(sx) + 8, Math.floor(sy) + 20 + Math.cos(this.time + y) * 1.5, TILE_SIZE - 16, 1);
            ctx.fillStyle = `rgba(200,220,255,${0.08 + wave1 * 0.3})`;
            ctx.fillRect(Math.floor(sx) + 6, Math.floor(sy) + 4, 6, 1);
          }

          // ── Lava: pulsing glow, cracks, ember particles ──
          if (tile === TileType.Lava) {
            const pulse = Math.sin(this.time * 3 + x + y) * 0.15;
            ctx.fillStyle = `rgba(255,175,60,${0.3 + pulse})`;
            ctx.fillRect(Math.floor(sx) + 4, Math.floor(sy) + 4, TILE_SIZE - 8, TILE_SIZE - 8);
            ctx.fillStyle = 'rgba(60,10,0,0.3)';
            ctx.fillRect(Math.floor(sx) + 8, Math.floor(sy) + 12, 12, 1);
            ctx.fillRect(Math.floor(sx) + 14, Math.floor(sy) + 8, 1, 10);
            const ember = Math.sin(this.time * 5 + x * 3) > 0.7;
            if (ember) {
              ctx.fillStyle = 'rgba(255,200,50,0.5)';
              ctx.fillRect(Math.floor(sx) + 10 + (x % 5) * 3, Math.floor(sy) + 6, 2, 2);
            }
          }
        } else {
          // Unexplored fog
          ctx.fillStyle = FOG_COLOR;
          ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // ── Fog of war edge gradient ──
    // Darken tiles at the edge of explored territory
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const explored = map.explored[y]?.[x] ?? false;
        if (!explored) continue;
        const sx = x * TILE_SIZE - camera.x;
        const sy = y * TILE_SIZE - camera.y;
        // Check if any neighbor is unexplored
        const hasUnexploredNeighbor = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
        ].some(([nx, ny]) => !(map.explored[ny]?.[nx] ?? false));
        if (hasUnexploredNeighbor) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // ── Room features: altars, vaults, thrones... drawn as map objects ──
    for (const room of rooms) {
      const feat = room.feature;
      if (!feat) continue;
      if (!map.explored[room.cy]?.[room.cx]) continue;
      const fx = room.cx * TILE_SIZE - camera.x;
      const fy = room.cy * TILE_SIZE - camera.y;
      this.drawFeature(ctx, fx, fy, feat.kind, pal, feat.used);
    }

    // ── Detected traps: a pulsing hazard marker ──
    for (const trap of traps) {
      if (!trap.detected || trap.disarmed) continue;
      if (!map.explored[trap.tile.y]?.[trap.tile.x]) continue;
      const kind = getTrapKind(trap.kindId);
      const sx = trap.tile.x * TILE_SIZE - camera.x;
      const sy = trap.tile.y * TILE_SIZE - camera.y;
      const pulse = Math.sin(this.time * 6) * 0.25 + 0.5;
      const color = kind?.effect.damageType === 'lightning' ? '#6cf' : '#fa4';

      // Soft glow
      ctx.fillStyle = `rgba(255,150,50,${0.15 + pulse * 0.15})`;
      ctx.fillRect(Math.floor(sx) - 1, Math.floor(sy) - 1, TILE_SIZE + 2, TILE_SIZE + 2);

      // Diamond outline (classic trap marker)
      const cx = Math.floor(sx) + TILE_SIZE / 2;
      const cy = Math.floor(sy) + TILE_SIZE / 2;
      const r = Math.floor(TILE_SIZE / 2) - 3;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.stroke();

      // Inner dot
      ctx.fillStyle = color;
      ctx.fillRect(cx - 1, cy - 1, 3, 3);

      // Label above
      if (kind) {
        ctx.fillStyle = `rgba(255,220,150,${0.6 + pulse * 0.4})`;
        ctx.font = '8px monospace';
        ctx.fillText('⚑', Math.floor(sx) + 2, Math.floor(sy) - 3);
      }
    }

    // ── Torch glow around the party leader ──
    if (party.length > 0 && party[0].isAlive) {
      const leader = party[0];
      const leaderVisual = this.getVisual(leader, dt, moveMs);
      const lx = leaderVisual.x + TILE_SIZE / 2 - camera.x;
      const ly = leaderVisual.y + TILE_SIZE / 2 - camera.y;
      const flicker = Math.sin(this.time * 8) * 3 + Math.sin(this.time * 13) * 2;
      const radius = 80 + flicker;
      const gradient = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
      gradient.addColorStop(0, 'rgba(255,200,100,0.08)');
      gradient.addColorStop(0.5, 'rgba(255,160,60,0.04)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(lx - radius, ly - radius, radius * 2, radius * 2);
    }

    // Draw monsters (only if on explored tile)
    for (const monster of monsters) {
      if (!monster.isAlive) continue;
      if (!map.explored[monster.tile.y]?.[monster.tile.x]) continue;

      const phase = (monster.id.length * 37 + monster.id.charCodeAt(0) * 13) % 100 / 100 * Math.PI * 2;
      const bob = Math.sin(this.time * 2.2 + phase) * 1.5;
      const sx = monster.tile.x * TILE_SIZE - camera.x + 2;
      const sy = monster.tile.y * TILE_SIZE - camera.y + 2 - bob;

      // Soft shadow under the monster's feet
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(
        Math.floor(monster.tile.x * TILE_SIZE - camera.x + 2),
        Math.floor(monster.tile.y * TILE_SIZE - camera.y + TILE_SIZE - 2),
        TILE_SIZE - 4,
        3
      );

      // Alert glow: hostile monsters throb red, suspicious ones yellow
      if (monster.alertLevel >= 2) {
        const pulse = Math.sin(this.time * 5 + phase) * 0.2 + 0.5;
        ctx.fillStyle = `rgba(255,60,40,${0.08 + pulse * 0.1})`;
        ctx.fillRect(Math.floor(sx) - 2, Math.floor(sy) - 2, TILE_SIZE + 4, TILE_SIZE + 4);
      } else if (monster.alertLevel === 1) {
        const pulse = Math.sin(this.time * 4 + phase) * 0.2 + 0.4;
        ctx.fillStyle = `rgba(255,220,80,${0.05 + pulse * 0.08})`;
        ctx.fillRect(Math.floor(sx) - 2, Math.floor(sy) - 2, TILE_SIZE + 4, TILE_SIZE + 4);
      }

      const sprite = this.sprites.getMonsterSprite(monster);
      ctx.putImageData(sprite, Math.floor(sx), Math.floor(sy));

      // Condition glow + status dots
      if (monster.conditions.length > 0) {
        const cond = monster.conditions[0];
        const meta = CONDITION_META[cond.id];
        if (meta) {
          ctx.fillStyle = meta.color + '30';
          ctx.fillRect(Math.floor(sx) - 1, Math.floor(sy) - 1, TILE_SIZE + 2, TILE_SIZE + 2);
        }
        this.drawConditionDots(ctx, sx, sy, monster.conditions);
      }

      // HP bar above monster
      this.drawHpBar(ctx, sx, sy - 4, TILE_SIZE - 4, monster.hp, monster.maxHp, '#c33');

      // Name tag
      ctx.fillStyle = '#faa';
      ctx.font = '9px monospace';
      ctx.fillText(monster.template.name, Math.floor(sx - 2), Math.floor(sy - 6));
    }

    // Breadcrumb trail of the party's recent steps, then the party on top.
    this.drawBreadcrumbTrail(ctx, camera, trail);

    // Draw party members
    this.drawPartyMembers(ctx, camera, party, dt, moveMs);
  }

  /**
   * Fading breadcrumb dots for the party's recent tiles — newest brightest,
   * oldest nearly invisible. A square loop shows up instantly as a ring of
   * dots retracing itself.
   */
  private drawBreadcrumbTrail(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    trail: { x: number; y: number }[]
  ) {
    const n = trail.length;
    for (let i = 0; i < n; i++) {
      const t = trail[i];
      const sx = t.x * TILE_SIZE - camera.x;
      const sy = t.y * TILE_SIZE - camera.y;
      if (sx < -20 || sy < -20 || sx > GAME_WIDTH + 20 || sy > GAME_HEIGHT + 20) continue;
      // i/n: 0 = oldest, 1 = newest.
      const fade = n === 1 ? 0.7 : 0.12 + (i / (n - 1)) * 0.6;
      const cx = Math.floor(sx) + TILE_SIZE / 2;
      const cy = Math.floor(sy) + TILE_SIZE / 2;
      ctx.fillStyle = `rgba(120,200,255,${fade})`;
      ctx.fillRect(cx - 2, cy - 2, 5, 5);
      // Newest step gets a small bright ring so the trail's head is obvious.
      if (i === n - 1 && n > 1) {
        ctx.strokeStyle = `rgba(150,220,255,${0.5 + Math.sin(this.time * 4) * 0.25})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** Shared party drawing (dungeon + overworld): glide, bob, status glows. */
  private drawPartyMembers(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    party: GameCharacter[],
    dt: number,
    moveMs: number
  ) {
    for (const member of party) {
      if (!member.isAlive) continue;

      const visual = this.getVisual(member, dt, moveMs);
      const sx = visual.x - camera.x + 2;
      // A gentle bob while a step is in progress sells the walk.
      const step = visual.moving ? Math.sin(visual.progress * Math.PI) : 0;
      const sy = visual.y - camera.y + 2 - step * 2;

      // Soft shadow under the feet so the glide reads as walking.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.floor(sx), Math.floor(visual.y - camera.y + TILE_SIZE - 2), TILE_SIZE - 4, 3);

      // Selection ring around leader (animated pulse)
      if (member === party[0]) {
        const pulse = Math.sin(this.time * 4) * 0.2 + 0.8;
        ctx.strokeStyle = `rgba(255,215,0,${pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.floor(sx) - 2, Math.floor(sy) - 2, TILE_SIZE + 2, TILE_SIZE + 2);
      }

      const sprite = this.sprites.getCharSprite(member);
      ctx.putImageData(sprite, Math.floor(sx), Math.floor(sy));

      // Little dust puff at the start of each step.
      if (step > 0.75) {
        ctx.fillStyle = `rgba(160,150,140,${(step - 0.75) * 0.5})`;
        ctx.fillRect(Math.floor(sx) - 2, Math.floor(visual.y - camera.y + TILE_SIZE - 2), 2, 2);
        ctx.fillRect(Math.floor(sx) + TILE_SIZE - 2, Math.floor(visual.y - camera.y + TILE_SIZE - 2), 2, 2);
      }

      // Condition indicators: colored glow plus a dot per active condition
      if (member.conditions.length > 0) {
        for (const cond of member.conditions) {
          const meta = CONDITION_META[cond.id];
          if (meta) {
            ctx.fillStyle = meta.color + '40';
            ctx.fillRect(Math.floor(sx) - 1, Math.floor(sy) - 1, TILE_SIZE + 2, TILE_SIZE + 2);
          }
        }
        this.drawConditionDots(ctx, sx, sy, member.conditions);
      }

      // Concentration glow
      if (member.concentration) {
        const pulse = Math.sin(this.time * 3) * 0.15 + 0.2;
        ctx.fillStyle = `rgba(100,200,255,${pulse})`;
        ctx.fillRect(Math.floor(sx) - 2, Math.floor(sy) - 2, TILE_SIZE + 4, TILE_SIZE + 4);
      }

      // Exhaustion indicator
      if (member.exhaustion > 0) {
        const exhaustColor = member.exhaustion >= 4 ? '#f44' : member.exhaustion >= 2 ? '#fa0' : '#ff0';
        ctx.fillStyle = exhaustColor;
        for (let i = 0; i < member.exhaustion; i++) {
          ctx.fillRect(Math.floor(sx) + i * 3, Math.floor(sy) + TILE_SIZE + 1, 2, 2);
        }
      }

      // Death state overlay
      if (member.isDead) {
        ctx.fillStyle = 'rgba(100,0,0,0.4)';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#f44';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('☠', Math.floor(sx) + 2, Math.floor(sy) + 12);
      } else if (!member.isConscious) {
        ctx.fillStyle = 'rgba(50,0,80,0.3)';
        ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_SIZE, TILE_SIZE);
      }

      // HP bar above character
      this.drawHpBar(ctx, sx, sy - 4, TILE_SIZE - 4, member.hp, member.maxHp, '#4c4');
    }
  }

  /**
   * One rectangle measured inward from a tile edge.
   *
   * `dir` is 0 north, 1 east, 2 south, 3 west; `off` and `len` run along the
   * edge and `depth` bites into the tile. Every transition is expressed through
   * this so the four directions share one body instead of four.
   */
  private edgeRect(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number, dir: number,
    off: number, len: number, depth: number,
  ): void {
    const T = TILE_SIZE;
    if (dir === 0) ctx.fillRect(sx + off, sy, len, depth);
    else if (dir === 1) ctx.fillRect(sx + T - depth, sy + off, depth, len);
    else if (dir === 2) ctx.fillRect(sx + off, sy + T - depth, len, depth);
    else ctx.fillRect(sx, sy + off, depth, len);
  }

  /**
   * A stronger neighbour's colour broken along one edge of this tile.
   *
   * Four 8 px cells, each at one of three depths picked from the tile hash, so
   * the boundary steps in and out instead of ruling a line; one cell then gets
   * a narrower tongue pushed further in, which is what stops the result reading
   * as a scalloped border. Cells are drawn a tone at a time because the Pixi
   * backend batches runs of same-coloured rectangles and a per-cell colour
   * change would break the run four times an edge.
   *
   * Five rectangles.
   */
  private blendEdge(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, sx: number, sy: number, dir: number,
    toneA: string, toneB: string, minDepth: number, spread: number,
  ): void {
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? toneA : toneB;
      for (let i = 0; i < 4; i++) {
        const h = cellHash(x, y, dir * 7 + i);
        if (h % 2 !== pass) continue;
        this.edgeRect(ctx, sx, sy, dir, i * 8, 8, minDepth + (h % 3) * spread);
      }
    }
    const t = cellHash(x, y, dir * 7 + 11);
    ctx.fillStyle = toneA;
    this.edgeRect(ctx, sx, sy, dir, (t % 4) * 8 + 2, 4, minDepth + spread * 3 + (t % 2) * 2);
  }

  /** A stepped nub of a stronger diagonal neighbour, so corners are not square. */
  private blendCorner(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, sx: number, sy: number,
    cx: number, cy: number, tone: string, base = 5,
  ): void {
    const s = base + (cellHash(x, y, 53 + cx * 3 + cy * 5) % 3) * 2;
    ctx.fillStyle = tone;
    ctx.fillRect(cx === 0 ? sx : sx + TILE_SIZE - s, cy === 0 ? sy : sy + TILE_SIZE - s, s, s);
  }

  /** The land half of a coast: damp sand, then a bleached rim on the waterline. */
  private shoreLand(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, sx: number, sy: number, dir: number,
  ): void {
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = SHORE_DAMP[pass];
      for (let i = 0; i < 4; i++) {
        const h = cellHash(x, y, 60 + dir * 7 + i);
        if (h % 2 !== pass) continue;
        this.edgeRect(ctx, sx, sy, dir, i * 8, 8, 2 + (h % 4) * 2);
      }
    }
    // The bleached rim skips a cell here and there, so a headland is not traced
    // in one even stroke the way an outline would be.
    ctx.fillStyle = SHORE_RIM;
    for (let i = 0; i < 4; i++) {
      const h = cellHash(x, y, 60 + dir * 7 + i);
      if (h % 5 === 0) continue;
      this.edgeRect(ctx, sx, sy, dir, i * 8 + (h % 3), 8 - (h % 3), 1 + (h % 3));
    }
  }

  /** The water half of a coast: a band of shallows with foam on the bank. */
  private shoreWater(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, sx: number, sy: number, dir: number,
  ): void {
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = SHALLOW[pass];
      for (let i = 0; i < 4; i++) {
        const h = cellHash(x, y, 80 + dir * 7 + i);
        if (h % 2 !== pass) continue;
        this.edgeRect(ctx, sx, sy, dir, i * 8, 8, 5 + (h % 3) * 3);
      }
    }
    ctx.fillStyle = FOAM;
    for (let i = 0; i < 4; i++) {
      const h = cellHash(x, y, 80 + dir * 7 + i);
      if (h % 3 === 0) continue;
      this.edgeRect(ctx, sx, sy, dir, i * 8 + 1, 6, 2);
    }
  }

  /**
   * Everything a tile owes its neighbours: bleeds from stronger terrain on the
   * four edges, nubs on the four diagonals, a coast where it meets water, and
   * the shadow any mountain to the north or west throws across it.
   *
   * A tile in the middle of a biome costs nothing at all — every branch is
   * gated on the neighbour actually differing.
   */
  private blendOverworldTile(
    ctx: CanvasRenderingContext2D, map: TileMap,
    x: number, y: number, sx: number, sy: number, tile: TileType,
  ): void {
    const rank = TERRAIN_RANK[tile];
    if (rank === undefined) return;
    const isWater = tile === TileType.Water;
    // A bridge is a structure standing in the water, not a beach.
    const spanning = tile === TileType.Bridge;

    for (let d = 0; d < 4; d++) {
      const step = EDGE_STEPS[d];
      const n = map.tiles[y + step[1]]?.[x + step[0]] ?? TileType.Void;
      if (n === tile) continue;
      const nr = TERRAIN_RANK[n];
      if (nr === undefined) continue;
      if (isWater) {
        if (n !== TileType.Bridge) this.shoreWater(ctx, x, y, sx, sy, d);
        continue;
      }
      if (n === TileType.Water) {
        if (!spanning) this.shoreLand(ctx, x, y, sx, sy, d);
        continue;
      }
      if (nr <= rank) continue;
      const tones = BLEND_TONES[n];
      if (tones) this.blendEdge(ctx, x, y, sx, sy, d, tones[0], tones[1], 4, 2);
    }

    for (const [dx, dy, cx, cy] of CORNER_STEPS) {
      const n = map.tiles[y + dy]?.[x + dx] ?? TileType.Void;
      if (n === tile) continue;
      const nr = TERRAIN_RANK[n];
      if (nr === undefined) continue;
      if (isWater) {
        if (n !== TileType.Bridge) this.blendCorner(ctx, x, y, sx, sy, cx, cy, SHALLOW[0], 3);
        continue;
      }
      if (n === TileType.Water) {
        // Banks are kept tighter at the corners than an inland blend: a river
        // one tile wide otherwise disappears under its own beaches.
        if (!spanning) this.blendCorner(ctx, x, y, sx, sy, cx, cy, SHORE_DAMP[0], 3);
        continue;
      }
      if (nr <= rank) continue;
      const tones = BLEND_TONES[n];
      if (tones) this.blendCorner(ctx, x, y, sx, sy, cx, cy, tones[1]);
    }

    // Mountains are lit from the north-west throughout, so the ground below and
    // east of one sits in its shadow. This is form, not time of day — the
    // backend's own lighting pass still grades the whole scene on top. Peaks
    // themselves are exempt: they already overlap each other, and a band across
    // every one of them would put the grid straight back.
    if (tile === TileType.Mountain) return;
    if ((map.tiles[y - 1]?.[x] ?? TileType.Void) === TileType.Mountain) {
      ctx.fillStyle = 'rgba(16,16,26,0.30)';
      ctx.fillRect(sx, sy, TILE_SIZE, 6 + (cellHash(x, y, 91) % 3));
    }
    if ((map.tiles[y]?.[x - 1] ?? TileType.Void) === TileType.Mountain) {
      ctx.fillStyle = 'rgba(16,16,26,0.20)';
      ctx.fillRect(sx, sy, 4, TILE_SIZE);
    }
  }

  /**
   * Overworld rendering — the massive open world. Grass, forests, mountains,
   * animated water, roads/bridges, biome floors, town buildings, dungeon
   * entrances, wandering NPCs, wildlife, and the party.
   */
  renderOverworld(
    map: TileMap,
    camera: Camera,
    party: GameCharacter[],
    wanderers: Wanderer[] = [],
    towns: OverworldTown[] = [],
    entrances: OverworldEntrance[] = [],
    dt: number = 16,
    moveMs: number = 400,
    festivals: Record<string, string> = {},
    monsters: Monster[] = [],
    campTiles: { x: number; y: number }[] = [],
    pois: { tile: { x: number; y: number }; kind: string; discovered: boolean; name: string }[] = [],
    questTile: { x: number; y: number } | null = null,
    trail: { x: number; y: number }[] = []
  ) {
    this.time += 0.016;
    this.renderTime += dt;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;

    const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
    const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
    const endX = Math.min(map.width, startX + Math.ceil(GAME_WIDTH / TILE_SIZE) + 3);
    const endY = Math.min(map.height, startY + Math.ceil(GAME_HEIGHT / TILE_SIZE) + 3);

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = map.tiles[y]?.[x] ?? TileType.Void;
        const sx = x * TILE_SIZE - camera.x;
        const sy = y * TILE_SIZE - camera.y;
        const hash = (x * 7 + y * 13) % 97;
        const f = Math.floor;

        switch (tile) {
          case TileType.Grass: {
            mottledTile(ctx, sx, sy, x, y, '#2d5a2d', '#2a552a', 5);
            if (hash % 19 === 0) {
              ctx.fillStyle = 'rgba(120,200,90,0.5)';
              ctx.fillRect(f(sx) + 8, f(sy) + 6, 2, 4);
              ctx.fillRect(f(sx) + 10, f(sy) + 4, 2, 2);
            } else if (hash % 23 === 0) {
              ctx.fillStyle = 'rgba(200,180,120,0.5)';
              ctx.fillRect(f(sx) + 16, f(sy) + 18, 3, 3);
            } else if (hash % 31 === 0) {
              ctx.fillStyle = 'rgba(40,30,20,0.25)';
              ctx.fillRect(f(sx) + 6, f(sy) + 20, 8, 4);
            }
            break;
          }
          case TileType.Forest: {
            ctx.fillStyle = '#1e4024';
            ctx.fillRect(f(sx), f(sy), TILE_SIZE, TILE_SIZE);
            // Canopy, nudged and sized by a scattered hash so a wood is not a
            // wallpaper of one identical tree. Where the wood continues north
            // or west the crown overhangs into that tile — those were drawn
            // first, so the overlap sticks and the canopies close up instead of
            // leaving a dark grid line between every pair of trees.
            const fh = cellHash(x, y, 23);
            const jx = (fh % 7) - 3;
            const jy = (cellHash(x, y, 41) % 7) - 3;
            const northWood = (map.tiles[y - 1]?.[x] ?? TileType.Void) === TileType.Forest;
            const westWood = (map.tiles[y]?.[x - 1] ?? TileType.Void) === TileType.Forest;
            const cl = f(sx) + (westWood ? -7 : 3) + jx;
            const ct = f(sy) + (northWood ? -7 : 3) + jy;
            const cw = (westWood ? 33 : 24) + (fh % 4) * 2;
            const ch = (northWood ? 32 : 22);
            ctx.fillStyle = fh % 3 === 0 ? '#2f6033' : '#2c5a30';
            ctx.fillRect(cl, ct, cw, ch);
            // Sunlit crown to the north-west, matching the mountains' light.
            ctx.fillStyle = '#3d7a41';
            ctx.fillRect(f(sx) + 6 + jx, f(sy) + 6 + jy, 10, 6);
            ctx.fillStyle = '#36703a';
            ctx.fillRect(f(sx) + 18 + jx, f(sy) + 12 + jy, 6, 5);
            // Trunk
            ctx.fillStyle = '#5a4024';
            ctx.fillRect(f(sx) + 14 + jx, f(sy) + 24, 4, 6);
            // Shade under the crown, only where the wood actually ends.
            if ((map.tiles[y + 1]?.[x] ?? TileType.Void) !== TileType.Forest) {
              ctx.fillStyle = 'rgba(0,0,0,0.2)';
              ctx.fillRect(f(sx) + 2, f(sy) + 28, 28, 2);
            }
            break;
          }
          case TileType.Mountain: {
            // Peaks are silhouettes, not stacked boxes: each is a triangle lit
            // from the north-west and standing on the bottom edge of its tile,
            // and where there is more mountain to the north it rises well into
            // that tile. Neighbouring peaks therefore overlap, which is the only
            // thing that makes a range read as ridges one behind another rather
            // than as a wallpaper of identical pyramids.
            const px = f(sx);
            const py = f(sy);
            const h1 = cellHash(x, y, 3);
            const h2 = cellHash(x, y, 17);
            const northward = (map.tiles[y - 1]?.[x] ?? TileType.Void) === TileType.Mountain;
            const rise = northward ? 9 + (h1 % 8) : 0;
            const apexX = px + 9 + (h1 % 15);
            const apexY = py + 1 + (h2 % 8) - rise;
            const baseY = py + TILE_SIZE;
            // Three depth tones, so some ridges sit back behind others; and one
            // tile in four is a saddle with no near peak at all, which is what
            // puts passes and valleys into a range instead of an even comb.
            const far = h1 % 3;
            const shade = far === 0 ? '#5b5b66' : far === 1 ? '#64646f' : '#6c6c78';
            const lit = far === 0 ? '#82828e' : far === 1 ? '#90909d' : '#9b9ba7';
            const saddle = h2 % 4 === 0;
            // Scree the range stands on.
            ctx.fillStyle = h2 % 2 === 0 ? '#4c4c57' : '#464651';
            ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            // A lower shoulder to the east, drawn first so the peak overlaps it.
            ctx.fillStyle = '#55555f';
            ctx.beginPath();
            ctx.moveTo(px + 19 + (h2 % 9), py + 7 + (h1 % 7) - rise);
            ctx.lineTo(px + TILE_SIZE, baseY);
            ctx.lineTo(px + 6, baseY);
            ctx.closePath();
            ctx.fill();
            if (!saddle) {
              // The shaded eastern flank of the near peak.
              ctx.fillStyle = shade;
              ctx.beginPath();
              ctx.moveTo(apexX, apexY);
              ctx.lineTo(apexX + 15 + (h1 % 7), baseY);
              ctx.lineTo(apexX - 15 - (h2 % 7), baseY);
              ctx.closePath();
              ctx.fill();
              // The lit north-western flank, a good third of the peak.
              ctx.fillStyle = lit;
              ctx.beginPath();
              ctx.moveTo(apexX, apexY);
              ctx.lineTo(apexX - 15 - (h2 % 7), baseY);
              ctx.lineTo(apexX - 3, baseY);
              ctx.closePath();
              ctx.fill();
              // Snow only on the summits that actually stand above the range.
              if (y < map.height * 0.34 && apexY < py) {
                ctx.fillStyle = '#e8ecf0';
                ctx.beginPath();
                ctx.moveTo(apexX, apexY);
                ctx.lineTo(apexX + 7, apexY + 10);
                ctx.lineTo(apexX - 7, apexY + 10);
                ctx.closePath();
                ctx.fill();
              }
            }
            break;
          }
          case TileType.Water: {
            const shimmer = Math.sin(this.time * 2 + x * 0.6 + y * 0.4) * 0.5 + 0.5;
            ctx.fillStyle = `rgb(${Math.floor(34 + shimmer * 10)},${Math.floor(68 + shimmer * 14)},${Math.floor(136 + shimmer * 22)})`;
            ctx.fillRect(f(sx), f(sy), TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = `rgba(190,220,255,${0.12 + shimmer * 0.16})`;
            ctx.fillRect(f(sx) + ((x * 13 + y * 7) % 20), f(sy) + 8, 6, 1);
            ctx.fillRect(f(sx) + ((x * 7 + y * 11) % 20), f(sy) + 20, 8, 1);
            break;
          }
          case TileType.Sand: {
            mottledTile(ctx, sx, sy, x, y, '#b0a060', '#a89854', 41);
            ctx.fillStyle = 'rgba(255,240,200,0.35)';
            ctx.fillRect(f(sx) + 6, f(sy) + 8, 3, 2);
            ctx.fillRect(f(sx) + 18, f(sy) + 22, 3, 2);
            break;
          }
          case TileType.Snow: {
            mottledTile(ctx, sx, sy, x, y, '#d8dce0', '#ccd2d8', 43);
            ctx.fillStyle = 'rgba(180,200,230,0.4)';
            ctx.fillRect(f(sx) + 8, f(sy) + 6, 4, 3);
            ctx.fillRect(f(sx) + 20, f(sy) + 18, 4, 3);
            break;
          }
          case TileType.Desert: {
            mottledTile(ctx, sx, sy, x, y, '#a08040', '#967a3a', 47);
            ctx.fillStyle = 'rgba(200,180,110,0.4)';
            ctx.fillRect(f(sx) + 2, f(sy) + 16, 14, 3);
            ctx.fillStyle = 'rgba(60,40,10,0.25)';
            ctx.fillRect(f(sx) + 16, f(sy) + 22, 12, 2);
            break;
          }
          case TileType.Swamp: {
            mottledTile(ctx, sx, sy, x, y, '#2a4a2e', '#25452a', 53);
            // Murky pool
            ctx.fillStyle = 'rgba(40,90,50,0.6)';
            ctx.fillRect(f(sx) + 8, f(sy) + 10, 16, 12);
            // Lily pad
            ctx.fillStyle = '#3f7a3a';
            ctx.fillRect(f(sx) + 12, f(sy) + 16, 8, 3);
            // Bubbles
            ctx.fillStyle = 'rgba(160,220,160,0.4)';
            ctx.fillRect(f(sx) + 18, f(sy) + 8, 2, 2);
            break;
          }
          case TileType.Road: {
            // Ruts and verges follow where the road actually goes, so a run of
            // road reads as one continuous track instead of thirty-two-pixel
            // segments each capped with its own kerb.
            const link = roadLinks(map, x, y);
            mottledTile(ctx, sx, sy, x, y, '#8a7a5a', '#847452', 59);
            ctx.fillStyle = 'rgba(60,45,25,0.35)';
            if (link & 0b0101) {
              ctx.fillRect(f(sx) + 8, f(sy), 3, TILE_SIZE);
              ctx.fillRect(f(sx) + 21, f(sy), 3, TILE_SIZE);
            }
            if (link & 0b1010) {
              ctx.fillRect(f(sx), f(sy) + 8, TILE_SIZE, 3);
              ctx.fillRect(f(sx), f(sy) + 21, TILE_SIZE, 3);
            }
            if (link === 0) ctx.fillRect(f(sx) + 10, f(sy) + 10, 12, 12);
            // Pale grit kerbs only where the road genuinely ends.
            ctx.fillStyle = 'rgba(204,194,164,0.30)';
            if (!(link & 0b0001)) ctx.fillRect(f(sx), f(sy), TILE_SIZE, 2);
            if (!(link & 0b0010)) ctx.fillRect(f(sx) + TILE_SIZE - 2, f(sy), 2, TILE_SIZE);
            if (!(link & 0b0100)) ctx.fillRect(f(sx), f(sy) + TILE_SIZE - 2, TILE_SIZE, 2);
            if (!(link & 0b1000)) ctx.fillRect(f(sx), f(sy), 2, TILE_SIZE);
            break;
          }
          case TileType.Bridge: {
            // Planks lie across the traffic and the rails run with it, so which
            // way the span points has to be worked out before anything is drawn.
            const link = roadLinks(map, x, y);
            const ew = ((link & 0b0010) ? 1 : 0) + ((link & 0b1000) ? 1 : 0);
            const ns = ((link & 0b0001) ? 1 : 0) + ((link & 0b0100) ? 1 : 0);
            const across = ew > ns;
            ctx.fillStyle = '#6a5434';
            ctx.fillRect(f(sx), f(sy), TILE_SIZE, TILE_SIZE);
            for (let p = 0; p < 4; p++) {
              ctx.fillStyle = p % 2 === 0 ? '#7a6240' : '#6e5838';
              if (across) ctx.fillRect(f(sx) + p * 8, f(sy), 8, TILE_SIZE);
              else ctx.fillRect(f(sx), f(sy) + p * 8, TILE_SIZE, 8);
            }
            ctx.fillStyle = '#4a3a22';
            if (across) {
              ctx.fillRect(f(sx), f(sy), TILE_SIZE, 3);
              ctx.fillRect(f(sx), f(sy) + TILE_SIZE - 3, TILE_SIZE, 3);
            } else {
              ctx.fillRect(f(sx), f(sy), 3, TILE_SIZE);
              ctx.fillRect(f(sx) + TILE_SIZE - 3, f(sy), 3, TILE_SIZE);
            }
            // The dark of the water showing under the deck beside each rail.
            ctx.fillStyle = 'rgba(20,38,74,0.55)';
            if (across) {
              ctx.fillRect(f(sx), f(sy) + 3, TILE_SIZE, 2);
              ctx.fillRect(f(sx), f(sy) + TILE_SIZE - 5, TILE_SIZE, 2);
            } else {
              ctx.fillRect(f(sx) + 3, f(sy), 2, TILE_SIZE);
              ctx.fillRect(f(sx) + TILE_SIZE - 5, f(sy), 2, TILE_SIZE);
            }
            // Stone abutments where the span comes ashore.
            ctx.fillStyle = '#8a8276';
            const lands = (nx: number, ny: number) => {
              const t = map.tiles[ny]?.[nx] ?? TileType.Void;
              return t !== TileType.Bridge && t !== TileType.Water && t !== TileType.Void;
            };
            if (across) {
              if (lands(x - 1, y)) ctx.fillRect(f(sx), f(sy), 4, TILE_SIZE);
              if (lands(x + 1, y)) ctx.fillRect(f(sx) + TILE_SIZE - 4, f(sy), 4, TILE_SIZE);
            } else {
              if (lands(x, y - 1)) ctx.fillRect(f(sx), f(sy), TILE_SIZE, 4);
              if (lands(x, y + 1)) ctx.fillRect(f(sx), f(sy) + TILE_SIZE - 4, TILE_SIZE, 4);
            }
            break;
          }
          case TileType.Town: {
            ctx.fillStyle = '#3a5a2e';
            ctx.fillRect(f(sx), f(sy), TILE_SIZE, TILE_SIZE);
            // Buildings arranged by hash so the 3×3 core reads as a village
            const b = (x * 5 + y * 3) % 6;
            if (b === 0 || b === 1) {
              // Big hall with peaked roof
              ctx.fillStyle = '#8a7a5a';
              ctx.fillRect(f(sx) + 4, f(sy) + 10, 24, 16);
              ctx.fillStyle = '#a84830';
              ctx.fillRect(f(sx) + 2, f(sy) + 4, 28, 8);
              ctx.fillStyle = '#5a3a22';
              ctx.fillRect(f(sx) + 12, f(sy) + 20, 6, 6);
              ctx.fillStyle = 'rgba(255,220,140,0.8)';
              ctx.fillRect(f(sx) + 8, f(sy) + 8, 4, 3);
            } else if (b === 2 || b === 3) {
              // Small cottage
              ctx.fillStyle = '#7a6a4a';
              ctx.fillRect(f(sx) + 6, f(sy) + 14, 20, 12);
              ctx.fillStyle = '#6a4a2a';
              ctx.fillRect(f(sx) + 4, f(sy) + 8, 24, 8);
              ctx.fillStyle = '#4a2e18';
              ctx.fillRect(f(sx) + 13, f(sy) + 20, 5, 6);
            } else if (b === 4) {
              // Market stall
              ctx.fillStyle = '#9a8a5a';
              ctx.fillRect(f(sx) + 4, f(sy) + 12, 24, 6);
              ctx.fillStyle = '#5a4a3a';
              ctx.fillRect(f(sx) + 6, f(sy) + 18, 20, 8);
              ctx.fillStyle = '#b04830';
              ctx.fillRect(f(sx) + 6, f(sy) + 6, 20, 6);
            } else {
              // Well or shrine in the square
              ctx.fillStyle = '#8a8a94';
              ctx.fillRect(f(sx) + 10, f(sy) + 10, 12, 10);
              ctx.fillStyle = '#444';
              ctx.fillRect(f(sx) + 13, f(sy) + 14, 6, 6);
              ctx.fillStyle = '#7a5a34';
              ctx.fillRect(f(sx) + 8, f(sy) + 6, 16, 4);
            }
            break;
          }
          case TileType.DungeonEntrance: {
            ctx.fillStyle = '#3a3a30';
            ctx.fillRect(f(sx), f(sy), TILE_SIZE, TILE_SIZE);
            // Stone ring
            ctx.fillStyle = '#7a7a84';
            ctx.fillRect(f(sx) + 2, f(sy) + 2, 28, 4);
            ctx.fillRect(f(sx) + 2, f(sy) + 26, 28, 4);
            ctx.fillRect(f(sx) + 2, f(sy) + 2, 4, 28);
            ctx.fillRect(f(sx) + 26, f(sy) + 2, 4, 28);
            // The dark maw
            ctx.fillStyle = '#0a0a10';
            ctx.fillRect(f(sx) + 8, f(sy) + 12, 16, 12);
            // Eerie glow
            const glow = Math.sin(this.time * 2.4 + x) * 0.3 + 0.5;
            ctx.fillStyle = `rgba(120,80,220,${0.15 + glow * 0.2})`;
            ctx.fillRect(f(sx) + 6, f(sy) + 10, 20, 16);
            // Steps down
            ctx.fillStyle = '#5a5a64';
            ctx.fillRect(f(sx) + 10, f(sy) + 20, 12, 3);
            break;
          }
          default: {
            ctx.fillStyle = TILE_COLORS[tile] || '#000';
            ctx.fillRect(f(sx), f(sy), TILE_SIZE, TILE_SIZE);
            break;
          }
        }

        // Soften every seam this tile is the weaker half of, on top of the
        // terrain it has just laid down.
        this.blendOverworldTile(ctx, map, x, y, f(sx), f(sy), tile);
      }
    }

    // Entrance markers: a small sign flag next to each entrance
    for (const e of entrances) {
      const sx = e.tile.x * TILE_SIZE - camera.x;
      const sy = e.tile.y * TILE_SIZE - camera.y;
      if (sx < -40 || sy < -40 || sx > GAME_WIDTH + 40 || sy > GAME_HEIGHT + 40) continue;
      ctx.fillStyle = '#5a3a22';
      ctx.fillRect(Math.floor(sx) + 26, Math.floor(sy) - 12, 2, 12);
      const wave = Math.sin(this.time * 3 + e.tile.x) * 2;
      ctx.fillStyle = '#c44';
      ctx.beginPath();
      ctx.moveTo(Math.floor(sx) + 28, Math.floor(sy) - 12);
      ctx.lineTo(Math.floor(sx) + 36 + wave, Math.floor(sy) - 9);
      ctx.lineTo(Math.floor(sx) + 28, Math.floor(sy) - 6);
      ctx.closePath();
      ctx.fill();
    }

    // Active quest destination: a pulsing golden beacon + column of light on the target tile.
    if (questTile) {
      const sx = questTile.x * TILE_SIZE - camera.x;
      const sy = questTile.y * TILE_SIZE - camera.y;
      if (sx > -80 && sy > -80 && sx < GAME_WIDTH + 80 && sy < GAME_HEIGHT + 80) {
        const pulse = Math.sin(this.time * 3) * 0.5 + 0.5; // 0..1
        const cx = Math.floor(sx) + TILE_SIZE / 2;
        const cy = Math.floor(sy) + TILE_SIZE / 2;
        // Expanding rings
        for (let r = 1; r <= 3; r++) {
          ctx.strokeStyle = `rgba(255,215,0,${0.4 - r * 0.09})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 12 + r * 7 + pulse * 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Column of light rising from the entrance
        const beam = ctx.createLinearGradient(0, Math.floor(sy) - 34, 0, Math.floor(sy) + TILE_SIZE);
        beam.addColorStop(0, `rgba(255,230,120,0)`);
        beam.addColorStop(1, `rgba(255,215,0,${0.22 + pulse * 0.18})`);
        ctx.fillStyle = beam;
        ctx.fillRect(Math.floor(sx) + 4, Math.floor(sy) - 34, TILE_SIZE - 8, TILE_SIZE + 34);
        // Bright core on the ground
        ctx.fillStyle = `rgba(255,240,160,${0.5 + pulse * 0.4})`;
        ctx.fillRect(Math.floor(sx) + 6, Math.floor(sy) + 4, TILE_SIZE - 12, 8);
        ctx.fillStyle = 'rgba(255,215,0,0.9)';
        ctx.font = 'bold 9px monospace';
        ctx.fillText('QUEST', Math.floor(sx) + 2, Math.floor(sy) - 38);
      }
    }

    // Bandit camp markers: a small skull icon for discovered camps.
    for (const c of campTiles) {
      const sx = c.x * TILE_SIZE - camera.x;
      const sy = c.y * TILE_SIZE - camera.y;
      if (sx < -40 || sy < -40 || sx > GAME_WIDTH + 40 || sy > GAME_HEIGHT + 40) continue;
      // Campfire glow
      const flicker = Math.sin(this.time * 4 + c.x) * 0.2 + 0.6;
      ctx.fillStyle = `rgba(255,120,40,${flicker * 0.3})`;
      ctx.fillRect(Math.floor(sx) + 8, Math.floor(sy) + 8, 16, 16);
      // Skull icon
      ctx.fillStyle = '#c44';
      ctx.fillRect(Math.floor(sx) + 12, Math.floor(sy) + 6, 8, 6);
      ctx.fillRect(Math.floor(sx) + 14, Math.floor(sy) + 4, 4, 2);
      // Eyes
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.floor(sx) + 13, Math.floor(sy) + 8, 2, 2);
      ctx.fillRect(Math.floor(sx) + 17, Math.floor(sy) + 8, 2, 2);
    }

    // Points of Interest: discovered POIs get a glowing icon.
    for (const poi of pois) {
      if (!poi.discovered) continue;
      const sx = poi.tile.x * TILE_SIZE - camera.x;
      const sy = poi.tile.y * TILE_SIZE - camera.y;
      if (sx < -40 || sy < -40 || sx > GAME_WIDTH + 40 || sy > GAME_HEIGHT + 40) continue;
      // Glow pulse
      const glow = Math.sin(this.time * 2 + poi.tile.x * 0.5) * 0.3 + 0.7;
      const color = poi.kind === 'dragon_lair' ? 'rgba(255,80,20,' : poi.kind === 'crystal_cave' ? 'rgba(100,200,255,' : poi.kind === 'enchanted_grove' ? 'rgba(100,255,150,' : poi.kind === 'wizard_tower' ? 'rgba(180,120,255,' : poi.kind === 'haunted_forest' ? 'rgba(120,255,180,' : poi.kind === 'mineral_spring' ? 'rgba(80,200,255,' : poi.kind === 'moon_forge' ? 'rgba(190,150,255,' : 'rgba(255,215,0,';
      ctx.fillStyle = color + (glow * 0.4) + ')';
      ctx.fillRect(Math.floor(sx) + 4, Math.floor(sy) + 4, 24, 24);
      // Icon based on kind
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      const icons: Record<string, string> = {
        ancient_ruins: '\u{1f3da}', abandoned_mine: '\u{26cf}', witch_hut: '\u{1f9d9}',
        dragon_lair: '\u{1f409}', ancient_battlefield: '\u{2694}', hidden_shrine: '\u2728',
        crystal_cave: '\u{1f48e}', bandit_outpost: '\u{1f3f4}', lost_tomb: '\u{26b1}',
        enchanted_grove: '\u{1f333}', watchtower: '\u{1f3ef}', wizard_tower: '\u{1f52e}',
        haunted_forest: '\u{1f47b}', mineral_spring: '\u2668', failed_settlement: '\u{1f3da}', goblin_camp: '\u{1f47a}',
        moon_forge: '\u{1f319}',
      };
      ctx.fillText(icons[poi.kind] || '?', Math.floor(sx) + 8, Math.floor(sy) + 20);
      // Name label if close
      if (poi.tile.x * TILE_SIZE - camera.x > -10 && poi.tile.x * TILE_SIZE - camera.x < GAME_WIDTH + 10) {
        ctx.fillStyle = '#fff';
        ctx.font = '9px monospace';
        ctx.fillText(poi.name, Math.floor(sx) + 2, Math.floor(sy) - 4);
      }
    }

    // Wanderers: people get a name + bob; wildlife just bobs.
    for (const w of wanderers) {
      const bob = Math.sin(this.time * 2.4 + w.phase) * 1.4;
      const sx = w.tile.x * TILE_SIZE - camera.x + 2;
      const sy = w.tile.y * TILE_SIZE - camera.y + 2 - bob;
      if (sx < -20 || sy < -20 || sx > GAME_WIDTH + 20 || sy > GAME_HEIGHT + 20) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.floor(sx), Math.floor(w.tile.y * TILE_SIZE - camera.y + TILE_SIZE - 2), TILE_SIZE - 4, 3);
      const sprite = this.sprites.getWandererSprite(w.kind, w.id.length + w.tile.x);
      ctx.putImageData(sprite, Math.floor(sx), Math.floor(sy));
      const isPerson = w.kind !== 'deer' && w.kind !== 'rabbit' && w.kind !== 'wolf' && w.kind !== 'heron';
      if (isPerson) {
        ctx.fillStyle = 'rgba(230,220,200,0.85)';
        ctx.font = '8px monospace';
        ctx.fillText(w.name, Math.floor(sx - 4), Math.floor(sy - 3));
      }
    }

    // Ambushers on the surface — bandits and beasts springing at the party.
    for (const monster of monsters) {
      if (!monster.isAlive) continue;
      const bob = Math.sin(this.time * 2.6 + monster.tile.x * 1.7 + monster.tile.y) * 1.2;
      const sx = monster.tile.x * TILE_SIZE - camera.x + 2;
      const sy = monster.tile.y * TILE_SIZE - camera.y + 2 - bob;
      if (sx < -20 || sy < -20 || sx > GAME_WIDTH + 20 || sy > GAME_HEIGHT + 20) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.floor(sx), Math.floor(monster.tile.y * TILE_SIZE - camera.y + TILE_SIZE - 2), TILE_SIZE - 4, 3);
      const pulse = Math.sin(this.time * 5 + monster.tile.x) * 0.2 + 0.5;
      ctx.fillStyle = `rgba(255,60,40,${0.08 + pulse * 0.1})`;
      ctx.fillRect(Math.floor(sx) - 2, Math.floor(sy) - 2, TILE_SIZE + 4, TILE_SIZE + 4);
      const sprite = this.sprites.getMonsterSprite(monster);
      ctx.putImageData(sprite, Math.floor(sx), Math.floor(sy));
      this.drawHpBar(ctx, sx, sy - 4, TILE_SIZE - 4, monster.hp, monster.maxHp, '#c33');
      ctx.fillStyle = '#faa';
      ctx.font = '8px monospace';
      ctx.fillText(monster.template.name, Math.floor(sx - 2), Math.floor(sy - 6));
    }

    // Breadcrumb trail of the party's recent steps, then the party on top.
    this.drawBreadcrumbTrail(ctx, camera, trail);

    // The party
    this.drawPartyMembers(ctx, camera, party, dt, moveMs);

    // Off-screen quest indicator: an arrow clamped to the screen edge, always
    // pointing at the active quest's destination so the party's goal is
    // visible even when the camera is nowhere near it.
    if (questTile) {
      const tx = questTile.x * TILE_SIZE + TILE_SIZE / 2;
      const ty = questTile.y * TILE_SIZE + TILE_SIZE / 2;
      const sx = tx - camera.x;
      const sy = ty - camera.y;
      if (sx < -4 || sy < -4 || sx > GAME_WIDTH + 4 || sy > GAME_HEIGHT + 4) {
        const cx = GAME_WIDTH / 2;
        const cy = GAME_HEIGHT / 2;
        const dx = sx - cx;
        const dy = sy - cy;
        const len = Math.hypot(dx, dy) || 1;
        const inset = Math.min(GAME_WIDTH, GAME_HEIGHT) / 2 - 26;
        let ax = cx + (dx / len) * inset;
        let ay = cy + (dy / len) * inset;
        ax = Math.max(24, Math.min(GAME_WIDTH - 24, ax));
        ay = Math.max(40, Math.min(GAME_HEIGHT - 24, ay));
        const angle = Math.atan2(dy, dx);
        const pulse = Math.sin(this.time * 5) * 0.15 + 0.85;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(angle);
        ctx.fillStyle = `rgba(255,215,0,${pulse})`;
        ctx.beginPath();
        ctx.moveTo(11, 0);
        ctx.lineTo(-7, -8);
        ctx.lineTo(-3, 0);
        ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = `rgba(255,215,0,${pulse})`;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('QUEST', ax, ay + 17);
        ctx.textAlign = 'left';
      }
    }

    // Festival bunting strung across celebrating town squares — drawn last so
    // wanderers and the party pass beneath it like under a canopy.
    for (const town of towns) {
      if (!festivals[town.id]) continue;
      const fsx = town.tile.x * TILE_SIZE - camera.x;
      const fsy = town.tile.y * TILE_SIZE - camera.y;
      if (fsx < -40 || fsy < -40 || fsx > GAME_WIDTH + 40 || fsy > GAME_HEIGHT + 40) continue;
      const sway = Math.sin(this.time * 2 + town.tile.x * 0.7 + town.tile.y * 0.3) * 1.5;
      const colors = ['#e04040', '#e0c040', '#40a0e0', '#80e060', '#e060a0'];
      for (let i = 0; i < 6; i++) {
        const bx = Math.floor(fsx) + 2 + i * 4;
        const by = Math.floor(fsy) + 6 + Math.abs(i - 2.5) * 3 + sway * (i % 2 === 0 ? 1 : -0.5);
        ctx.fillStyle = colors[(i + town.tile.x) % colors.length];
        ctx.fillRect(bx, by, 3, 3);
        ctx.fillStyle = 'rgba(230,220,190,0.7)';
        ctx.fillRect(Math.floor(fsx) + 2 + i * 4, Math.floor(fsy) + 3, 3, 1);
      }
    }

    // Map legend: compact overlay of landmark kinds + icons, top-right.
    // Only kinds actually present on the map are listed, so it stays short.
    const legendRows: [string, string][] = [
      ['\u{1F3DA}', 'ruins'], ['\u26CF', 'mine'], ['\u{1F9D9}', 'witch hut'],
      ['\u{1F409}', 'dragon lair'], ['\u2694', 'battlefield'], ['\u2728', 'shrine'],
      ['\u{1F48E}', 'crystal cave'], ['\u{1F3F4}', 'bandits'], ['\u26B0', 'tomb'],
      ['\u{1F333}', 'fey grove'], ['\u{1F3EF}', 'watchtower'], ['\u{1F52E}', 'wizard tower'],
      ['\u{1F47B}', 'haunted wood'], ['\u2668', 'hot spring'], ['\u{1F47A}', 'goblin camp'],
      ['\u{1F319}', 'moon forge'],
      ['\u{1F6AA}', 'dungeon'], ['\u{1F3D8}', 'town'],
    ];
    const present = new Set<string>();
    for (const p of pois) if (p.discovered) present.add(p.kind);
    if (entrances.length > 0) present.add('__dungeon');
    if (towns.length > 0) present.add('__town');
    const rows = legendRows.filter(([icon, label]) => {
      const kindMap: Record<string, string> = {
        ruins: 'ancient_ruins', mine: 'abandoned_mine', 'witch hut': 'witch_hut',
        'dragon lair': 'dragon_lair', battlefield: 'ancient_battlefield', shrine: 'hidden_shrine',
        'crystal cave': 'crystal_cave', bandits: 'bandit_outpost', tomb: 'lost_tomb',
        'fey grove': 'enchanted_grove', watchtower: 'watchtower', 'wizard tower': 'wizard_tower',
        'haunted wood': 'haunted_forest', 'hot spring': 'mineral_spring', 'goblin camp': 'goblin_camp',
        'moon forge': 'moon_forge',
      };
      const mapped = kindMap[label];
      if (mapped) return present.has(mapped);
      if (label === 'dungeon') return present.has('__dungeon');
      if (label === 'town') return present.has('__town');
      return false;
    });
    if (rows.length > 0) {
      const lh = 13;
      const boxW = 108;
      const boxH = rows.length * lh + 18;
      const bx = GAME_WIDTH - boxW - 8;
      const by = 44;
      ctx.fillStyle = 'rgba(8,10,18,0.72)';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = 'rgba(160,140,90,0.5)';
      ctx.strokeRect(bx + 0.5, by + 0.5, boxW - 1, boxH - 1);
      ctx.fillStyle = '#ffd76a';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('LANDMARKS', bx + 8, by + 12);
      ctx.font = '9px monospace';
      rows.forEach(([icon, label], i) => {
        const ry = by + 24 + i * lh;
        ctx.fillStyle = '#fff';
        ctx.fillText(icon, bx + 8, ry);
        ctx.fillStyle = '#b8b09a';
        ctx.fillText(label, bx + 26, ry);
      });
    }

    // Weather and nightfall are deliberately absent: this draws the world at
    // noon under a clear sky, and the backend lights and grades it from the
    // SceneMood attached to the frame. Both used to be painted here as well,
    // which meant a night was darkened twice — once to 28% here and again by
    // the lighting pass — leaving about an eighth of the picture visible, and
    // a snowfall was tinted three times over.
  }

  private getVisual(member: GameCharacter, dt: number, moveMs: number): VisualSprite {
    const targetX = member.tile.x * TILE_SIZE;
    const targetY = member.tile.y * TILE_SIZE;

    let v = this.visuals.get(member);
    if (!v) {
      v = {
        x: targetX,
        y: targetY,
        fromX: targetX,
        fromY: targetY,
        moveStart: 0,
        moveDuration: moveMs,
        progress: 1,
        moving: false,
      };
      this.visuals.set(member, v);
      return v;
    }

    const dist = Math.hypot(targetX - v.x, targetY - v.y);
    if (dist > TILE_SIZE * 1.5) {
      // Teleport (new floor, respawn, formation warp) — snap, don't glide.
      v.x = targetX;
      v.y = targetY;
      v.fromX = targetX;
      v.fromY = targetY;
      v.progress = 1;
      v.moving = false;
      return v;
    }

    if (dist > 0.5) {
      if (!v.moving) {
        v.fromX = v.x;
        v.fromY = v.y;
        v.moveStart = this.renderTime;
        v.moveDuration = moveMs;
        v.progress = 0;
        v.moving = true;
      }
      // Advance the step (supports mid-step retarget if the tick is faster).
      const raw = Math.min(1, (this.renderTime - v.moveStart) / v.moveDuration);
      const e = raw * raw * (3 - 2 * raw); // smoothstep
      v.progress = raw;
      v.x = v.fromX + (targetX - v.fromX) * e;
      v.y = v.fromY + (targetY - v.fromY) * e;
      if (raw >= 1) v.moving = false;
    } else {
      v.x = targetX;
      v.y = targetY;
      v.progress = 1;
      v.moving = false;
    }
    return v;
  }

  /** Draw a room feature (altar, vault, throne...) as a small map object. */
  private drawFeature(
    ctx: CanvasRenderingContext2D,
    fx: number,
    fy: number,
    kind: RoomFeatureKind,
    pal: DungeonPalette,
    used: boolean = false
  ) {
    const sx = Math.floor(fx) + 4;
    const sy = Math.floor(fy) + 4;
    const t = this.time;

    // Soft grounding shadow under every feature
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(sx, sy + TILE_SIZE - 8, TILE_SIZE - 8, 4);

    switch (kind) {
      case 'altar': {
        // Stone block with a candle flame
        ctx.fillStyle = pal.wallDark;
        ctx.fillRect(sx + 6, sy + 14, 16, 10);
        ctx.fillStyle = pal.wall;
        ctx.fillRect(sx + 8, sy + 12, 12, 3);
        ctx.fillStyle = 'rgba(120,110,90,0.9)';
        ctx.fillRect(sx + 12, sy + 8, 4, 4);
        const fl = Math.sin(t * 9) * 0.5 + 1.2;
        ctx.fillStyle = `rgba(255,190,80,${0.5 + fl * 0.2})`;
        ctx.fillRect(sx + 13, sy + 5, 2, 3);
        break;
      }
      case 'vault': {
        // Iron door with a corroded lock
        ctx.fillStyle = '#4a4248';
        ctx.fillRect(sx + 4, sy + 4, 20, 24);
        ctx.fillStyle = '#33303a';
        ctx.fillRect(sx + 6, sy + 6, 16, 20);
        ctx.fillStyle = '#8a7a5a';
        ctx.fillRect(sx + 10, sy + 12, 8, 8);
        ctx.fillStyle = '#5a4a3a';
        ctx.fillRect(sx + 13, sy + 14, 2, 4);
        break;
      }
      case 'prison': {
        // Iron bars
        ctx.fillStyle = '#3a3a42';
        ctx.fillRect(sx + 2, sy + 2, 24, 26);
        ctx.fillStyle = '#1a1a22';
        ctx.fillRect(sx + 4, sy + 4, 20, 22);
        ctx.fillStyle = '#7a7a8a';
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(sx + 6 + i * 6, sy + 4, 2, 22);
        }
        ctx.fillRect(sx + 4, sy + 8, 20, 2);
        ctx.fillRect(sx + 4, sy + 20, 20, 2);
        break;
      }
      case 'chokepoint': {
        // Rubble heap
        ctx.fillStyle = pal.wallDark;
        ctx.fillRect(sx + 4, sy + 18, 20, 8);
        ctx.fillRect(sx + 6, sy + 14, 16, 6);
        ctx.fillStyle = pal.wall;
        ctx.fillRect(sx + 8, sy + 10, 12, 5);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(sx + 11, sy + 7, 6, 4);
        break;
      }
      case 'forge': {
        // Anvil + embers
        ctx.fillStyle = '#4a4a52';
        ctx.fillRect(sx + 6, sy + 16, 16, 4);
        ctx.fillRect(sx + 10, sy + 12, 8, 5);
        ctx.fillRect(sx + 8, sy + 20, 4, 4);
        const em = Math.sin(t * 6) > 0;
        if (em) {
          ctx.fillStyle = `${pal.glow}${Math.floor(60 + Math.sin(t * 8) * 30).toString(16)}`;
          ctx.fillRect(sx + 16, sy + 8, 3, 2);
          ctx.fillRect(sx + 20, sy + 5, 2, 2);
        }
        break;
      }
      case 'library': {
        // Shelves with books
        ctx.fillStyle = '#5a4230';
        ctx.fillRect(sx + 4, sy + 6, 20, 20);
        ctx.fillStyle = pal.decor;
        ctx.fillRect(sx + 6, sy + 8, 16, 4);
        ctx.fillRect(sx + 6, sy + 14, 16, 4);
        ctx.fillRect(sx + 6, sy + 20, 16, 4);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(sx + 7, sy + 9, 3, 2);
        ctx.fillRect(sx + 12, sy + 9, 3, 2);
        ctx.fillRect(sx + 17, sy + 9, 3, 2);
        ctx.fillRect(sx + 7, sy + 15, 4, 2);
        ctx.fillRect(sx + 13, sy + 15, 3, 2);
        break;
      }
      case 'fountain': {
        // Stone basin with water
        ctx.fillStyle = pal.wallDark;
        ctx.fillRect(sx + 2, sy + 14, 24, 10);
        ctx.fillStyle = '#3a6a8a';
        ctx.fillRect(sx + 4, sy + 16, 20, 6);
        ctx.fillStyle = '#7ac0e0';
        ctx.fillRect(sx + 7, sy + 17 + Math.sin(t * 2) * 1, 8, 2);
        ctx.fillStyle = pal.wall;
        ctx.fillRect(sx + 13, sy + 6, 2, 10);
        ctx.fillStyle = 'rgba(180,220,255,0.5)';
        ctx.fillRect(sx + 14, sy + 2, 1, 5);
        break;
      }
      case 'sarcophagus': {
        // Stone coffin
        ctx.fillStyle = pal.wallDark;
        ctx.fillRect(sx + 3, sy + 8, 22, 18);
        ctx.fillStyle = pal.wall;
        ctx.fillRect(sx + 5, sy + 6, 18, 4);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(sx + 5, sy + 10, 2, 12);
        ctx.fillRect(sx + 21, sy + 10, 2, 12);
        ctx.fillRect(sx + 10, sy + 12, 8, 2);
        break;
      }
      case 'throne': {
        // Seat with arms
        ctx.fillStyle = pal.wallDark;
        ctx.fillRect(sx + 8, sy + 14, 12, 12);
        ctx.fillStyle = pal.wall;
        ctx.fillRect(sx + 6, sy + 8, 16, 7);
        ctx.fillStyle = pal.accent;
        ctx.fillRect(sx + 4, sy + 14, 4, 10);
        ctx.fillRect(sx + 20, sy + 14, 4, 10);
        ctx.fillRect(sx + 11, sy + 4, 6, 5);
        break;
      }
      case 'chest': {
        // A closed chest sits shut with a glinting lock; an opened one has its
        // lid tipped back so the party can see at a glance what is left to loot.
        ctx.fillStyle = pal.wallDark;
        ctx.fillRect(sx + 5, sy + 13, 18, 12);
        ctx.fillStyle = pal.wall;
        ctx.fillRect(sx + 5, sy + 13, 18, 3);
        if (used) {
          // Lid thrown back against the wall, interior in shadow.
          ctx.fillStyle = pal.wallDark;
          ctx.fillRect(sx + 5, sy + 5, 18, 5);
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(sx + 7, sy + 15, 14, 8);
        } else {
          // Domed lid, iron bands, and a lock that catches the torchlight.
          ctx.fillStyle = pal.wall;
          ctx.fillRect(sx + 5, sy + 8, 18, 6);
          ctx.fillStyle = pal.wallDark;
          ctx.fillRect(sx + 9, sy + 8, 2, 17);
          ctx.fillRect(sx + 17, sy + 8, 2, 17);
          const glint = 0.55 + 0.45 * Math.sin(t * 2.2);
          ctx.fillStyle = `rgba(255, 215, 0, ${glint.toFixed(3)})`;
          ctx.fillRect(sx + 12, sy + 14, 4, 4);
        }
        break;
      }
      default: {
        // Generic marker
        ctx.fillStyle = pal.accent;
        ctx.fillRect(sx + 10, sy + 8, 8, 14);
        break;
      }
    }
  }

  /** Draw a colored square per active condition along the bottom of a tile. */
  private drawConditionDots(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    conditions: ActiveCondition[]
  ) {
    const x0 = Math.floor(sx) + 2;
    const y0 = Math.floor(sy) + TILE_SIZE - 5;
    conditions.slice(0, 6).forEach((cond, i) => {
      const meta = CONDITION_META[cond.id];
      ctx.fillStyle = meta?.color ?? '#fff';
      ctx.fillRect(x0 + i * 4, y0, 3, 3);
    });
  }

  private drawHpBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    hp: number,
    maxHp: number,
    color: string
  ) {
    const ratio = Math.max(0, hp / maxHp);
    // Background
    ctx.fillStyle = '#222';
    ctx.fillRect(Math.floor(x), Math.floor(y), width, 3);
    // Border
    ctx.fillStyle = '#444';
    ctx.fillRect(Math.floor(x), Math.floor(y), width, 1);
    // HP fill
    ctx.fillStyle = color;
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(width * ratio), 3);
    // Highlight on fill
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(width * ratio), 1);
  }
}

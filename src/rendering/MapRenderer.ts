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
  [TileType.LockedDoor]: '#a08020',
  [TileType.SecretDoor]: '#4a4a5a',
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

/**
 * What a town's roofs are made of, by the kind of town it is.
 *
 * A farming village is thatch, a port is slate, a mine is the same dark stone
 * it digs. The banner over the hall takes the same colour, so a town reads as
 * one place from a distance and its kind is legible before the name is.
 * Unknown archetypes get red tile, which is what every town was before.
 */
interface TownRoofs { roof: string; roofDark: string; banner: string; }
const TOWN_ROOFS: Record<string, TownRoofs> = {
  farming_village: { roof: '#b09040', roofDark: '#8a6c2c', banner: '#5aa04a' },
  port_town: { roof: '#4a6a88', roofDark: '#34506a', banner: '#4a8ad0' },
  mining_settlement: { roof: '#5a5058', roofDark: '#403840', banner: '#c06a30' },
  wizard_college: { roof: '#6a5a90', roofDark: '#4c4070', banner: '#b080f0' },
  desert_oasis: { roof: '#c8a068', roofDark: '#a0804c', banner: '#e8c040' },
  forest_hold: { roof: '#4a7a48', roofDark: '#345834', banner: '#70c050' },
  frontier_outpost: { roof: '#7a5a34', roofDark: '#58401e', banner: '#d04030' },
};
const DEFAULT_ROOFS: TownRoofs = { roof: '#a84830', roofDark: '#7a3020', banner: '#e8c040' };
function roofsFor(archetypeId: string | undefined): TownRoofs {
  return (archetypeId && TOWN_ROOFS[archetypeId]) || DEFAULT_ROOFS;
}

/** A tile key for the per-frame town lookup; the map is far narrower than this. */
function tileKey(x: number, y: number): number { return y * 4096 + x; }

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

/**
 * ── Dungeon interiors ──
 *
 * The whole interior is lit from directly above and a little from the
 * north-west — the same direction the overworld's peaks and canopies are lit
 * from — and every shadow below follows from that one decision:
 *
 *   • A wall tile with open ground to its *south* is the one whose face the
 *     player sees. It gets a lit crown along its top edge, a coursed face
 *     beneath it, and a dark foot where the face meets the floor. Every other
 *     wall tile is a top surface: rough rock seen from above.
 *   • The floor takes the contact shadow. A wall to the north throws the
 *     deepest band, one to the west a narrower one, east narrower still, and
 *     south only a contact line. That asymmetry is what stops a room from
 *     looking like a hole cut in paper.
 *   • Nothing here is time of day or torchlight. The backend still lights and
 *     grades the scene from the frame's SceneMood; this is form only.
 *
 * As on the overworld, every tone that varies does so at a scale smaller than
 * a tile and off a position hash — see `mottledTile` for why a per-tile tint
 * is the one thing guaranteed to make the ground read as a grid.
 */

/** Ground a creature can stand on, or see across. */
function isOpenTile(t: TileType): boolean {
  return t === TileType.Floor || t === TileType.Door || t === TileType.StairsDown
    || t === TileType.StairsUp || t === TileType.Water || t === TileType.Lava;
}

/** Rock: a wall, or the unquarried dark behind it. */
function isSolidTile(t: TileType): boolean {
  return t === TileType.SecretDoor || t === TileType.Wall || t === TileType.Void;
}

function tileAt(map: TileMap, x: number, y: number): TileType {
  return map.tiles[y]?.[x] ?? TileType.Void;
}

/** One channel of a `#rrggbb`, 0..255. */
function chan(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}

/** Blend two `#rrggbb` colours. Used to derive a theme's tones once, not per tile. */
function mix(a: string, b: string, t: number): string {
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const v = Math.round(chan(a, i) * (1 - t) + chan(b, i) * t);
    out += (v < 16 ? '0' : '') + v.toString(16);
  }
  return out;
}
const lighten = (h: string, t: number) => mix(h, '#ffffff', t);
const darken = (h: string, t: number) => mix(h, '#000000', t);

/**
 * Every shade a dungeon theme needs, derived from its three base colours.
 *
 * Derived once per palette and cached: the alternative is parsing hex and
 * blending fourteen colours for each of the six hundred-odd tiles on screen,
 * every frame, to arrive at the same fourteen answers.
 */
interface DungeonTones {
  floor: string;
  floorPatch: string;
  joint: string;
  relief: string;
  wallTop: string;
  facetLit: string;
  facetDark: string;
  crown: string;
  face: string;
  faceLit: string;
  mortar: string;
  foot: string;
  side: string;
  water: string;
  waterDeep: string;
  waterLip: string;
}

const TONE_CACHE = new WeakMap<DungeonPalette, DungeonTones>();

/** A hex colour at a given opacity, for the burst passes. */
function withAlpha(hex: string, a: number): string {
  const v = Math.max(0, Math.min(1, a));
  return `rgba(${chan(hex, 0)},${chan(hex, 1)},${chan(hex, 2)},${v.toFixed(3)})`;
}

function tonesFor(pal: DungeonPalette): DungeonTones {
  const hit = TONE_CACHE.get(pal);
  if (hit) return hit;
  const tones: DungeonTones = {
    floor: pal.floor,
    floorPatch: lighten(pal.floor, 0.07),
    joint: darken(pal.floor, 0.45),
    relief: lighten(pal.floor, 0.14),
    // The top of a wall is the plane the light falls on, so it sits a shade
    // above the palette's nominal wall colour and the face sits well below it.
    wallTop: lighten(pal.wall, 0.08),
    facetLit: lighten(pal.wall, 0.13),
    facetDark: darken(pal.wall, 0.07),
    crown: lighten(pal.wall, 0.36),
    face: lighten(pal.wallDark, 0.04),
    faceLit: lighten(pal.wallDark, 0.20),
    mortar: darken(pal.wallDark, 0.42),
    foot: darken(pal.wallDark, 0.66),
    side: darken(pal.wall, 0.34),
    water: mix('#2c5f92', pal.floor, 0.30),
    waterDeep: mix('#12304e', pal.floor, 0.40),
    waterLip: mix('#7fb4dc', pal.floor, 0.15),
  };
  TONE_CACHE.set(pal, tones);
  return tones;
}

/**
 * What a floating combat number is saying.
 *
 * `hit` and `hurt` are the same event seen from the two sides of the fight —
 * the party landing a blow and the party taking one — and they are coloured
 * apart because at a glance that is the only thing about a number that
 * matters: whose hit points just moved.
 */
export type EffectKind = 'strike' | 'fire' | 'shock' | 'arcane' | 'heal';

/**
 * A burst on a creature. Colours are given as a lit core and a cooler edge,
 * because a spell that is one flat colour reads as a decal; every real flash
 * is brightest at its heart and cools outward.
 */
const EFFECT_STYLE: Record<EffectKind, { core: string; edge: string; ms: number; reach: number; spokes: number }> = {
  strike: { core: '#fff6d8', edge: '#e0a850', ms: 260, reach: 15, spokes: 5 },
  fire: { core: '#fff0b0', edge: '#e0521c', ms: 520, reach: 24, spokes: 7 },
  shock: { core: '#ffffff', edge: '#7fc8ff', ms: 300, reach: 26, spokes: 4 },
  arcane: { core: '#f0e0ff', edge: '#9a5ce0', ms: 460, reach: 20, spokes: 6 },
  heal: { core: '#e8ffe8', edge: '#4bd479', ms: 660, reach: 16, spokes: 5 },
};

/** How long a bolt takes to cross, whatever the distance. A spell that crawls over a long room reads as a thrown rock. */
const BOLT_MS = 200;

/** A spell in flight, from the caster to whatever it is about to hit. */
interface Bolt {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: EffectKind;
  born: number;
}

/** How long a body takes to go. Long enough to see, short enough not to litter a fight. */
const CORPSE_MS = 620;

/** A creature that has just died, still on the floor while it fades. */
interface Corpse {
  x: number;
  y: number;
  sprite: ImageData;
  born: number;
}

/** One burst. World pixels, like the floaters; the camera is applied late. */
interface Effect {
  x: number;
  y: number;
  kind: EffectKind;
  born: number;
  seed: number;
}

export type FloaterKind = 'hit' | 'crit' | 'hurt' | 'heal' | 'slain' | 'down' | 'fire' | 'cold' | 'shock' | 'radiant' | 'necrotic' | 'poison' | 'arcane';

const FLOATER_STYLE: Record<FloaterKind, { color: string; size: number }> = {
  hit: { color: '#ffe9a8', size: 13 },
  crit: { color: '#ffcc3a', size: 18 },
  hurt: { color: '#ff6252', size: 14 },
  heal: { color: '#6dea84', size: 13 },
  slain: { color: '#ff8a5a', size: 11 },
  down: { color: '#e05a7a', size: 11 },
  // The element the blow carried: the number wears its colour.
  fire: { color: '#ff9a3c', size: 14 },
  cold: { color: '#9fe0ff', size: 14 },
  shock: { color: '#ffe95c', size: 14 },
  radiant: { color: '#ffe08a', size: 14 },
  necrotic: { color: '#b48cff', size: 14 },
  poison: { color: '#8ae06a', size: 14 },
  arcane: { color: '#c9a6ff', size: 14 },
};

/** One number rising off a creature. World pixels; the camera is applied late. */
interface Floater {
  x: number;
  y: number;
  text: string;
  kind: FloaterKind;
  born: number;
  /** Extra height given at birth so a flurry stacks instead of overlapping. */
  lift: number;
  drift: number;
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
  /** True after a step to the left; the sprite is mirrored so the held hand leads. */
  faceLeft: boolean;
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  /** The sprite bank; the party builder asks it for class portraits. */
  readonly sprites: SpriteRenderer;
  private time: number = 0;
  private renderTime: number = 0;

  /**
   * Smoothly-animated world positions (px) per party member. The game snaps
   * `member.tile` each AI tick; this lets the sprite glide tile-to-tile so
   * the party visibly marches instead of teleporting.
   */
  private visuals = new WeakMap<GameCharacter, VisualSprite>();

  /**
   * Numbers currently rising off creatures. Bounded twice over: each expires
   * on its own after `FLOATER_MS`, and the list is trimmed to `FLOATER_CAP`
   * whichever way a round goes, so a fight nobody is watching cannot pile up.
   */
  private floaters: Floater[] = [];
  private effects: Effect[] = [];
  private corpses: Corpse[] = [];
  private bolts: Bolt[] = [];
  private static readonly BOLT_CAP = 10;
  private static readonly CORPSE_CAP = 12;
  private static readonly EFFECT_CAP = 16;
  private effectSeed = 0;
  private static readonly FLOATER_MS = 1050;
  private static readonly FLOATER_CAP = 24;

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
    const tn = tonesFor(pal);
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = map.tiles[y]?.[x] ?? TileType.Void;
        const explored = map.explored[y]?.[x] ?? false;

        const sx = Math.floor(x * TILE_SIZE - camera.x);
        const sy = Math.floor(y * TILE_SIZE - camera.y);

        if (!explored) {
          ctx.fillStyle = FOG_COLOR;
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
          continue;
        }

        switch (tile) {
          case TileType.Wall:
            this.dungeonWall(ctx, map, x, y, sx, sy, tn, pal);
            break;
          case TileType.Floor:
            this.dungeonFloor(ctx, map, x, y, sx, sy, tn, pal);
            break;
          case TileType.Door:
            this.dungeonDoor(ctx, map, x, y, sx, sy, tn);
            break;
          case TileType.LockedDoor: {
            // A door with a padlock the size of a fist on it.
            this.dungeonDoor(ctx, map, x, y, sx, sy, tn);
            ctx.fillStyle = '#d8b040';
            ctx.fillRect(sx + 12, sy + 13, 8, 7);
            ctx.fillStyle = '#7a5a10';
            ctx.fillRect(sx + 13, sy + 9, 6, 5);
            ctx.fillStyle = '#d8b040';
            ctx.fillRect(sx + 14, sy + 10, 4, 3);
            ctx.fillStyle = '#3a2a08';
            ctx.fillRect(sx + 15, sy + 15, 2, 3);
            break;
          }
          case TileType.SecretDoor:
            // Indistinguishable from the wall until it is found.
            this.dungeonWall(ctx, map, x, y, sx, sy, tn, pal);
            break;
          case TileType.StairsDown:
          case TileType.StairsUp:
            this.dungeonStairs(ctx, map, x, y, sx, sy, tn, tile === TileType.StairsDown);
            break;
          case TileType.Water:
            this.dungeonWater(ctx, map, x, y, sx, sy, tn);
            break;
          case TileType.Lava:
            this.dungeonLava(ctx, map, x, y, sx, sy);
            break;
          default:
            ctx.fillStyle = TILE_COLORS[tile] || '#000';
            ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
            break;
        }
      }
    }


    // ── The edge of what has been seen ──
    // This used to drop a flat 30% black over any tile touching the unknown,
    // which drew the frontier as a row of thirty-two-pixel squares. It is now
    // banded inward from the side the dark is actually on, so the map fades
    // into it rather than ending on a kerb.
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        if (!(map.explored[y]?.[x] ?? false)) continue;
        const sx = Math.floor(x * TILE_SIZE - camera.x);
        const sy = Math.floor(y * TILE_SIZE - camera.y);
        let touched = false;
        for (let d = 0; d < 4; d++) {
          const step = EDGE_STEPS[d];
          if (map.explored[y + step[1]]?.[x + step[0]] ?? false) continue;
          touched = true;
          ctx.fillStyle = 'rgba(0,0,0,0.34)';
          this.edgeRect(ctx, sx, sy, d, 0, TILE_SIZE, 12);
          ctx.fillStyle = 'rgba(0,0,0,0.30)';
          this.edgeRect(ctx, sx, sy, d, 0, TILE_SIZE, 7);
          ctx.fillStyle = 'rgba(0,0,0,0.34)';
          this.edgeRect(ctx, sx, sy, d, 0, TILE_SIZE, 3);
        }
        if (touched) {
          ctx.fillStyle = 'rgba(0,0,0,0.14)';
          ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
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

    // The party's torch used to be painted here as a radial wash. It is gone
    // for the same reason the nightfall tint is: the backend's lighting pass
    // already puts a flickering torch on the SceneMood's focus, and two
    // torches over one party is one torch too many.

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

      // Side-view monsters are drawn facing left; one with the party on its
      // right turns to face them.
      const leader = party[0];
      const sprite = this.sprites.getMonsterSprite(monster, !!leader && leader.tile.x > monster.tile.x);
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

    this.drawCorpses(ctx, camera);

    // Breadcrumb trail of the party's recent steps, then the party on top.
    this.drawBreadcrumbTrail(ctx, camera, trail);

    // Draw party members
    this.drawPartyMembers(ctx, camera, party, dt, moveMs);

    // Damage and healing, over everything they belong to.
    this.drawBolts(ctx, camera);
    this.drawEffects(ctx, camera);
    this.drawFloaters(ctx, camera);
  }

  // ── Dungeon interiors ─────────────────────────────────────────────────
  // See the note above `isOpenTile`: light from above and a shade from the
  // north-west, wall faces to the south, and the floor carrying the shadows.

  /**
   * A wall: a rough top surface, and — where there is open ground to the
   * south — the face the player actually sees, crowned with light and dark at
   * the foot.
   *
   * What this replaces was a full mortar grid on every wall tile: three
   * courses at fixed heights with the joints in fixed places, so a wall ten
   * tiles long was the same block stamped ten times. The courses here are
   * placed off `cellHash`, and only on the face, where coursing is something
   * you could actually see.
   *
   * Five rectangles for a wall buried in rock, about fifteen for one facing a
   * room — against seventeen for every wall before.
   */
  private dungeonWall(
    ctx: CanvasRenderingContext2D, map: TileMap,
    x: number, y: number, sx: number, sy: number,
    tn: DungeonTones, pal: DungeonPalette,
  ): void {
    const T = TILE_SIZE;
    const faceH = isOpenTile(tileAt(map, x, y + 1)) ? 12 : 0;
    const topH = T - faceH;

    // The top surface: flat rock, broken by two facets whose size and place
    // come off the hash, so no two wall tops are the same and none of the
    // variation has the tile's period.
    ctx.fillStyle = tn.wallTop;
    ctx.fillRect(sx, sy, T, topH);
    const h = cellHash(x, y, 71);
    const fw = 9 + (h % 5) * 3;
    const fh = Math.max(3, Math.min(topH - 2, 5 + ((h >> 2) % 4) * 3));
    ctx.fillStyle = h % 2 === 0 ? tn.facetLit : tn.facetDark;
    ctx.fillRect(sx + (h * 5) % (T - fw), sy + (h * 3) % Math.max(1, topH - fh), fw, fh);
    const h2 = cellHash(x, y, 37);
    if (h2 % 3 !== 0) {
      const gw = 6 + (h2 % 4) * 3;
      const gh = Math.max(3, Math.min(topH - 2, 4 + ((h2 >> 3) % 3) * 3));
      ctx.fillStyle = h2 % 2 === 0 ? tn.facetDark : tn.facetLit;
      ctx.fillRect(sx + (h2 * 7) % (T - gw), sy + (h2 * 5) % Math.max(1, topH - gh), gw, gh);
    }

    // Thin sides where a corridor runs past: the wall block is cut, and the
    // cut catches no light.
    if (isOpenTile(tileAt(map, x - 1, y))) {
      ctx.fillStyle = tn.side;
      ctx.fillRect(sx, sy, 2, topH);
    }
    if (isOpenTile(tileAt(map, x + 1, y))) {
      ctx.fillStyle = tn.side;
      ctx.fillRect(sx + T - 2, sy, 2, topH);
    }
    if (isOpenTile(tileAt(map, x, y - 1))) {
      ctx.fillStyle = tn.crown;
      ctx.fillRect(sx, sy, T, 1);
    }

    if (faceH > 0) {
      // The crown: the wall's top edge, nearest the light.
      ctx.fillStyle = tn.crown;
      ctx.fillRect(sx, sy + topH, T, 2);
      ctx.fillStyle = tn.face;
      ctx.fillRect(sx, sy + topH + 2, T, faceH - 2);
      // Two courses, joints staggered by the tile's own hash so a long wall
      // does not repeat.
      const courseY = sy + topH + 2 + 4 + (h % 2);
      ctx.fillStyle = tn.mortar;
      ctx.fillRect(sx, courseY, T, 1);
      const jA = 6 + (cellHash(x, y, 19) % 20);
      const jB = 4 + (cellHash(x, y, 23) % 22);
      ctx.fillRect(sx + jA, sy + topH + 2, 1, courseY - (sy + topH + 2));
      ctx.fillRect(sx + jB, courseY + 1, 1, sy + T - courseY - 3);
      // A lit nose on the upper course, and the dark where the wall meets the
      // ground. Between them they are most of what reads as height.
      ctx.fillStyle = tn.faceLit;
      ctx.fillRect(sx + 1, sy + topH + 2, jA - 2, 1);
      ctx.fillStyle = tn.foot;
      ctx.fillRect(sx, sy + T - 2, T, 2);
    }

    // Wall dressing, on the face where there is one and on the top otherwise.
    const whash = (x * 17 + y * 29) % 24;
    const dy = faceH > 0 ? topH : 8;
    if (whash === 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(sx + 12, sy + dy + 2, 7, 1);
      ctx.fillRect(sx + 16, sy + dy + 2, 1, 7);
      ctx.fillRect(sx + 8, sy + dy + 8, 7, 1);
    } else if (whash === 1) {
      ctx.fillStyle = `${pal.accent}55`;
      ctx.fillRect(sx + 3, sy + T - 5, 9, 3);
      ctx.fillRect(sx + 16, sy + T - 4, 7, 2);
    } else if (whash === 2) {
      const runePulse = Math.sin(this.time * 2 + x * 0.7 + y) * 0.2 + 0.5;
      ctx.fillStyle = `${pal.glow}${Math.floor(20 + runePulse * 30).toString(16)}`;
      ctx.fillRect(sx + 12, sy + dy + 1, 8, 2);
      ctx.fillRect(sx + 15, sy + dy + 3, 2, 6);
    } else if (whash === 3 && faceH > 0) {
      // A sconce only ever hangs on a face — a torch on top of a wall, seen
      // from above, was one of the odder things in the old dungeon.
      ctx.fillStyle = 'rgba(50,42,26,0.9)';
      ctx.fillRect(sx + 25, sy + topH + 4, 4, 2);
      ctx.fillRect(sx + 26, sy + topH + 1, 2, 4);
      ctx.fillStyle = `rgba(255,170,60,${0.55 + Math.sin(this.time * 9 + x) * 0.2})`;
      ctx.fillRect(sx + 26, sy + topH - 2, 2, 3);
      ctx.fillStyle = `rgba(255,225,150,${0.4 + Math.sin(this.time * 13 + x) * 0.2})`;
      ctx.fillRect(sx + 26, sy + topH - 3, 2, 1);
    }
  }

  /**
   * The shadow a wall throws on the ground beside it.
   *
   * All four sides are shaded, but not equally: the light is above and to the
   * north-west, so a wall to the north stands between the floor and the light
   * and casts the deep band, the west casts a narrower one, and the east and
   * south get little more than a contact line. Getting that asymmetry right is
   * most of what makes a room read as a room rather than as a hole in paper.
   *
   * Depth is jittered a pixel off the hash so the band is not a ruled line.
   */
  private wallShadow(
    ctx: CanvasRenderingContext2D, map: TileMap,
    x: number, y: number, sx: number, sy: number,
  ): void {
    const j = cellHash(x, y, 61) % 2;
    if (isSolidTile(tileAt(map, x, y - 1))) {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fillRect(sx, sy, TILE_SIZE, 3 + j);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(sx, sy + 3 + j, TILE_SIZE, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(sx, sy + 6 + j, TILE_SIZE, 4);
    }
    if (isSolidTile(tileAt(map, x - 1, y))) {
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      ctx.fillRect(sx, sy, 3, TILE_SIZE);
      ctx.fillStyle = 'rgba(0,0,0,0.11)';
      ctx.fillRect(sx + 3, sy, 3 - j, TILE_SIZE);
    }
    if (isSolidTile(tileAt(map, x + 1, y))) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(sx + TILE_SIZE - 3, sy, 3, TILE_SIZE);
    }
    if (isSolidTile(tileAt(map, x, y + 1))) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(sx, sy + TILE_SIZE - 3, TILE_SIZE, 3);
    }
    // An outside corner, where the two edges beside it are open: without this
    // the diagonal reads as a notch of bare floor.
    for (const [dx, dy, cx, cy] of CORNER_STEPS) {
      if (!isSolidTile(tileAt(map, x + dx, y + dy))) continue;
      if (isSolidTile(tileAt(map, x + dx, y)) || isSolidTile(tileAt(map, x, y + dy))) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(cx === 0 ? sx : sx + TILE_SIZE - 5, cy === 0 ? sy : sy + TILE_SIZE - 5, 5, 5);
    }
  }

  /**
   * A floor tile: flagstone, its joints, the dressing that has collected on
   * it, and whatever the walls around it are keeping the light off.
   *
   * The old floor drew a light line down its north and west edges and a dark
   * one down its south and east, on every tile — a thirty-two pixel lattice
   * ruled over the whole dungeon. The joints here are placed off the hash
   * instead, so no two tiles break in the same place and the flags read as
   * flags rather than as a grid.
   */
  private dungeonFloor(
    ctx: CanvasRenderingContext2D, map: TileMap,
    x: number, y: number, sx: number, sy: number,
    tn: DungeonTones, pal: DungeonPalette,
  ): void {
    const T = TILE_SIZE;
    ctx.fillStyle = tn.floor;
    ctx.fillRect(sx, sy, T, T);

    // One sub-tile patch of tone on roughly a third of tiles — the same trick
    // and the same reasoning as `mottledTile` on the surface.
    const h = cellHash(x, y, 67);
    if (h % 3 === 0) {
      const w = 10 + (h % 4) * 4;
      const ht = 8 + ((h >> 2) % 4) * 3;
      ctx.fillStyle = tn.floorPatch;
      ctx.fillRect(sx + (h * 5) % (T - w), sy + (h * 11) % (T - ht), w, ht);
    }

    // Flagstone joints. They stop short of the tile's edges on purpose: a
    // joint that ran the full width would meet its neighbour's and the floor
    // would course like brickwork, which is what a floor must not look like.
    const hj = cellHash(x, y, 11);
    const jy = 8 + (hj % 16);
    const jx = 8 + (cellHash(x, y, 17) % 15);
    const jw = 12 + (hj % 12);
    ctx.fillStyle = tn.joint;
    ctx.fillRect(sx + (hj * 3) % (T - jw), sy + jy, jw, 1);
    ctx.fillRect(sx + jx, sy + jy + 1, 1, 6 + (hj % 9));
    ctx.fillStyle = tn.relief;
    ctx.fillRect(sx + (hj * 3) % (T - jw), sy + jy + 1, jw, 1);

    // Floor dressing — bones, blood, mushrooms, frost. Cheap and thematic;
    // the hash bands are unchanged from before.
    const hash = (x * 7 + y * 13) % 80;
    if (hash < 4) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(sx + 8, sy + 12, 10, 1);
      ctx.fillRect(sx + 15, sy + 12, 1, 8);
    } else if (hash < 6) {
      ctx.fillStyle = 'rgba(180,175,165,0.14)';
      ctx.fillRect(sx + 6, sy + 20, 3, 2);
      ctx.fillRect(sx + 18, sy + 8, 2, 2);
    } else if (hash < 8) {
      ctx.fillStyle = 'rgba(216,208,184,0.22)';
      ctx.fillRect(sx + 5, sy + 18, 16, 2);
      ctx.fillRect(sx + 5, sy + 16, 2, 6);
      ctx.fillRect(sx + 19, sy + 16, 2, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(sx + 5, sy + 20, 16, 1);
    } else if (hash < 10) {
      ctx.fillStyle = 'rgba(120,20,20,0.18)';
      ctx.fillRect(sx + 10, sy + 14, 8, 6);
      ctx.fillStyle = 'rgba(80,10,10,0.12)';
      ctx.fillRect(sx + 12, sy + 18, 4, 4);
    } else if (hash < 12) {
      const sparkle = Math.sin(this.time * 3 + x + y) * 0.3 + 0.5;
      ctx.fillStyle = `${pal.glow}${Math.floor(18 + sparkle * 20).toString(16)}`;
      ctx.fillRect(sx + 14, sy + 10, 3, 3);
    } else if (hash < 14) {
      ctx.fillStyle = `${pal.accent}44`;
      ctx.fillRect(sx + 5, sy + 22, 6, 3);
      ctx.fillRect(sx + 13, sy + 24, 8, 2);
    } else if (hash < 16) {
      const glow = Math.sin(this.time * 2.5 + x + y) * 0.2 + 0.4;
      ctx.fillStyle = 'rgba(160,160,170,0.4)';
      ctx.fillRect(sx + 10, sy + 20, 2, 6);
      ctx.fillRect(sx + 18, sy + 22, 2, 4);
      ctx.fillStyle = `${pal.glow}${Math.floor(30 + glow * 40).toString(16)}`;
      ctx.fillRect(sx + 8, sy + 18, 6, 3);
      ctx.fillRect(sx + 17, sy + 20, 5, 3);
    } else if (hash < 18) {
      ctx.fillStyle = 'rgba(200,230,255,0.35)';
      ctx.fillRect(sx + 12, sy + 14, 2, 8);
      ctx.fillRect(sx + 17, sy + 16, 2, 6);
      ctx.fillRect(sx + 14, sy + 12, 2, 2);
    } else if (hash < 20) {
      ctx.fillStyle = 'rgba(20,8,4,0.5)';
      ctx.fillRect(sx + 8, sy + 16, 16, 10);
      ctx.fillStyle = 'rgba(120,60,20,0.3)';
      ctx.fillRect(sx + 11, sy + 19, 10, 5);
    } else if (hash < 22) {
      ctx.fillStyle = 'rgba(90,140,190,0.18)';
      ctx.fillRect(sx + 8, sy + 14, 14, 9);
      ctx.fillStyle = 'rgba(160,200,230,0.12)';
      ctx.fillRect(sx + 10, sy + 16, 6, 3);
    } else if (hash < 24) {
      ctx.fillStyle = 'rgba(100,16,16,0.22)';
      ctx.fillRect(sx + 6, sy + 10, 3, 12);
      ctx.fillRect(sx + 20, sy + 8, 2, 10);
    }

    // Damp where the floor runs down to standing water.
    for (let d = 0; d < 4; d++) {
      const step = EDGE_STEPS[d];
      if (tileAt(map, x + step[0], y + step[1]) !== TileType.Water) continue;
      ctx.fillStyle = 'rgba(30,54,80,0.35)';
      this.edgeRect(ctx, sx, sy, d, 0, T, 4);
    }

    this.wallShadow(ctx, map, x, y, sx, sy);
  }

  /**
   * A door, hung in whichever way the wall it interrupts runs.
   *
   * The old one was a plank rectangle filling the tile in the same orientation
   * wherever it stood, which meant half of them lay flat across the corridor
   * they were supposed to close.
   */
  private dungeonDoor(
    ctx: CanvasRenderingContext2D, map: TileMap,
    x: number, y: number, sx: number, sy: number,
    tn: DungeonTones,
  ): void {
    const T = TILE_SIZE;
    // The wall run is whichever axis has rock on it; the leaf spans that run.
    const acrossX = isSolidTile(tileAt(map, x - 1, y)) || isSolidTile(tileAt(map, x + 1, y));

    ctx.fillStyle = tn.floor;
    ctx.fillRect(sx, sy, T, T);
    // Jambs of cut stone at the two ends of the run.
    ctx.fillStyle = tn.wallTop;
    if (acrossX) {
      ctx.fillRect(sx, sy, 4, T);
      ctx.fillRect(sx + T - 4, sy, 4, T);
      ctx.fillStyle = tn.foot;
      ctx.fillRect(sx + 4, sy + T - 3, T - 8, 3);
    } else {
      ctx.fillRect(sx, sy, T, 4);
      ctx.fillRect(sx, sy + T - 4, T, 4);
      ctx.fillStyle = tn.foot;
      ctx.fillRect(sx, sy + 4, 3, T - 8);
    }

    // The leaf: planks running with the door, iron bands across them.
    const lx = acrossX ? sx + 5 : sx + 3;
    const ly = acrossX ? sy + 3 : sy + 5;
    const lw = acrossX ? T - 10 : T - 6;
    const lh = acrossX ? T - 6 : T - 10;
    ctx.fillStyle = '#4a3517';
    ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = '#6b4d1e';
    for (let i = 0; i < 4; i++) {
      if (acrossX) ctx.fillRect(lx + 1 + i * 6, ly + 1, 4, lh - 3);
      else ctx.fillRect(lx + 1, ly + 1 + i * 6, lw - 3, 4);
    }
    ctx.fillStyle = '#8b6914';
    if (acrossX) ctx.fillRect(lx, ly, lw, 1);
    else ctx.fillRect(lx, ly, 1, lh);
    ctx.fillStyle = 'rgba(120,124,136,0.75)';
    if (acrossX) {
      ctx.fillRect(lx, ly + 4, lw, 2);
      ctx.fillRect(lx, ly + lh - 7, lw, 2);
    } else {
      ctx.fillRect(lx + 4, ly, 2, lh);
      ctx.fillRect(lx + lw - 7, ly, 2, lh);
    }
    // Ring handle, catching what light there is.
    ctx.fillStyle = '#c8ab5e';
    ctx.fillRect(sx + T / 2 - 2, sy + T / 2 - 2, 4, 4);
    ctx.fillStyle = '#5a4620';
    ctx.fillRect(sx + T / 2 - 1, sy + T / 2 - 1, 2, 2);

    this.wallShadow(ctx, map, x, y, sx, sy);
  }

  /**
   * A stairwell, cut into the floor rather than painted on it.
   *
   * Four treads recede toward the dark (down) or the light (up), each with a
   * lit nose and a shadowed riser, inside a frame of cut stone. The old stairs
   * were three coloured bars and an arrow; the colour is kept — the party has
   * to be able to spot the way down across a room — but it now sits on
   * something with a shape.
   */
  private dungeonStairs(
    ctx: CanvasRenderingContext2D, map: TileMap,
    x: number, y: number, sx: number, sy: number,
    tn: DungeonTones, down: boolean,
  ): void {
    const T = TILE_SIZE;
    ctx.fillStyle = tn.floor;
    ctx.fillRect(sx, sy, T, T);
    // The cut: a frame of dressed stone around a shaft.
    ctx.fillStyle = tn.wallTop;
    ctx.fillRect(sx + 1, sy + 1, T - 2, T - 2);
    ctx.fillStyle = '#08080c';
    ctx.fillRect(sx + 3, sy + 3, T - 6, T - 6);

    // Treads. Going down they narrow into the shaft and darken; going up they
    // widen toward the light and brighten.
    for (let i = 0; i < 4; i++) {
      const k = down ? i : 3 - i;
      const inset = 3 + k * 2;
      const ty = sy + 4 + i * 6;
      const shade = down ? 0.62 - i * 0.13 : 0.24 + i * 0.13;
      ctx.fillStyle = mix('#101018', tn.wallTop, shade);
      ctx.fillRect(sx + inset, ty, T - inset * 2, 5);
      ctx.fillStyle = mix('#101018', tn.crown, Math.min(1, shade + 0.28));
      ctx.fillRect(sx + inset, ty, T - inset * 2, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(sx + inset, ty + 5, T - inset * 2, 1);
    }

    // The way on, glowing faintly out of the stone.
    const glow = Math.sin(this.time * 2) * 0.12 + 0.34;
    ctx.fillStyle = down ? `rgba(255,110,70,${glow})` : `rgba(110,255,150,${glow})`;
    ctx.fillRect(sx + 3, down ? sy + T - 6 : sy + 3, T - 6, 3);
    ctx.fillStyle = down ? '#ff9a6a' : '#7affa0';
    const ax = sx + T / 2;
    const ay = down ? sy + T - 9 : sy + 8;
    ctx.fillRect(ax - 3, down ? ay : ay + 2, 6, 2);
    ctx.fillRect(ax - 1, down ? ay + 2 : ay, 2, 2);

    this.wallShadow(ctx, map, x, y, sx, sy);
  }

  /** Standing water: dark in the middle, lipped in stone where it meets the floor. */
  private dungeonWater(
    ctx: CanvasRenderingContext2D, map: TileMap,
    x: number, y: number, sx: number, sy: number,
    tn: DungeonTones,
  ): void {
    const T = TILE_SIZE;
    ctx.fillStyle = tn.waterDeep;
    ctx.fillRect(sx, sy, T, T);
    // A pool is shallower at its rim, so the deep tone is only the middle of
    // a tile with water on every side.
    const h = cellHash(x, y, 83);
    ctx.fillStyle = tn.water;
    ctx.fillRect(sx + (h % 3), sy + 2 + (h % 4), T - (h % 3) * 2, T - 6);

    // Where the floor comes down to the water it throws a shadow onto it, and
    // the waterline itself catches a pale lip. Each half is drawn by the tile
    // it belongs to, exactly as a coast is on the surface.
    for (let d = 0; d < 4; d++) {
      const step = EDGE_STEPS[d];
      if (tileAt(map, x + step[0], y + step[1]) === TileType.Water) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.34)';
      this.edgeRect(ctx, sx, sy, d, 0, T, 3);
      ctx.fillStyle = tn.waterLip;
      for (let i = 0; i < 4; i++) {
        const c = cellHash(x, y, 90 + d * 5 + i);
        if (c % 3 === 0) continue;
        this.edgeRect(ctx, sx, sy, d, i * 8 + (c % 3), 7 - (c % 3), 3 + (c % 2));
      }
    }

    // Two slow highlights riding the surface.
    const wave = Math.sin(this.time * 1.6 + x * 0.7 + y * 0.4);
    ctx.fillStyle = `rgba(190,222,255,${0.10 + wave * 0.06})`;
    ctx.fillRect(sx + 5, sy + 11 + Math.round(wave * 2), T - 12, 1);
    ctx.fillStyle = `rgba(160,200,240,${0.09 - wave * 0.05})`;
    ctx.fillRect(sx + 10, sy + 22 - Math.round(wave * 2), T - 18, 1);
  }

  /** Lava: a cooled crust with the heat showing through its cracks. */
  private dungeonLava(
    ctx: CanvasRenderingContext2D, map: TileMap,
    x: number, y: number, sx: number, sy: number,
  ): void {
    const T = TILE_SIZE;
    ctx.fillStyle = '#2a1208';
    ctx.fillRect(sx, sy, T, T);
    const h = cellHash(x, y, 87);
    ctx.fillStyle = '#3d1c0c';
    ctx.fillRect(sx + (h % 4), sy + (h % 5), T - 8, T - 10);
    // Cracks, placed off the hash, pulsing with the heat below.
    const pulse = Math.sin(this.time * 2.6 + x + y) * 0.2 + 0.6;
    ctx.fillStyle = `rgba(255,120,30,${pulse})`;
    ctx.fillRect(sx + 3, sy + 6 + (h % 6), T - 8, 2);
    ctx.fillRect(sx + 9 + (h % 8), sy + 6, 2, T - 12);
    ctx.fillStyle = `rgba(255,224,120,${pulse * 0.7})`;
    ctx.fillRect(sx + 5, sy + 7 + (h % 6), 8, 1);
    // The floor around a lava pool is scorched and lit from below.
    for (let d = 0; d < 4; d++) {
      const step = EDGE_STEPS[d];
      if (tileAt(map, x + step[0], y + step[1]) === TileType.Lava) continue;
      ctx.fillStyle = `rgba(255,140,40,${0.20 + pulse * 0.18})`;
      this.edgeRect(ctx, sx, sy, d, 0, T, 2);
    }
  }

  // ── Floating combat numbers ───────────────────────────────────────────

  /**
   * Push a number over a creature. `wx`/`wy` are the top-left of its tile in
   * world pixels; the camera is applied when it is drawn, so the number stays
   * put on the ground while the view moves.
   *
   * Several numbers landing on one creature in a round are stacked upward as
   * they arrive rather than drawn on top of each other, which is the whole
   * point of a multiattack being visible.
   */
  popNumber(wx: number, wy: number, text: string, kind: FloaterKind): void {
    let lift = 0;
    for (const f of this.floaters) {
      if (this.renderTime - f.born > 420) continue;
      if (Math.abs(f.x - wx) > 24 || Math.abs(f.y - wy) > 24) continue;
      lift = Math.min(lift - 11, f.lift - 11);
    }
    this.floaters.push({
      x: wx + TILE_SIZE / 2,
      y: wy,
      text,
      kind,
      born: this.renderTime,
      lift,
      drift: ((this.floaters.length * 37) % 7) - 3,
    });
    // Anything past the cap is older than everything kept, so the oldest go.
    if (this.floaters.length > MapRenderer.FLOATER_CAP) {
      this.floaters.splice(0, this.floaters.length - MapRenderer.FLOATER_CAP);
    }
  }

  /**
   * Burst on a creature. `wx`/`wy` are the top-left of its tile in world
   * pixels, as with `popNumber`.
   *
   * A spell used to be a line in the log and nothing else: the party threw
   * fire at something and the screen did not change. This is what the fire
   * looks like.
   */
  popEffect(wx: number, wy: number, kind: EffectKind): void {
    this.effects.push({
      x: wx + TILE_SIZE / 2,
      y: wy + TILE_SIZE / 2,
      kind,
      born: this.renderTime,
      seed: this.effectSeed++,
    });
    if (this.effects.length > MapRenderer.EFFECT_CAP) {
      this.effects.splice(0, this.effects.length - MapRenderer.EFFECT_CAP);
    }
  }

  /**
   * Send a spell across the room. Coordinates are tile top-left in world pixels.
   *
   * Only magic flies — a sword swing gets the burst at the far end and nothing
   * in between, because a streak of light crossing the floor to represent a
   * man stepping forward and hitting someone reads as nonsense.
   */
  popBolt(fromX: number, fromY: number, toX: number, toY: number, kind: EffectKind): void {
    const half = TILE_SIZE / 2;
    this.bolts.push({
      x0: fromX + half, y0: fromY + half,
      x1: toX + half, y1: toY + half,
      kind, born: this.renderTime,
    });
    if (this.bolts.length > MapRenderer.BOLT_CAP) {
      this.bolts.splice(0, this.bolts.length - MapRenderer.BOLT_CAP);
    }
  }

  /**
   * Draw and expire the spells in flight.
   *
   * A bright head with a short tail behind it, the tail drawn as a few
   * squares along the path it has already covered rather than as a line, so it
   * stays pixel art. Fixed duration rather than fixed speed: across a whole
   * room a constant-speed bolt is slow enough to look thrown.
   */
  private drawBolts(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.bolts.length === 0) return;
    let live = 0;
    for (const b of this.bolts) {
      const age = this.renderTime - b.born;
      if (age >= BOLT_MS) continue;
      this.bolts[live++] = b;
      const style = EFFECT_STYLE[b.kind];
      const t = age / BOLT_MS;

      const TAIL = 5;
      for (let i = 0; i < TAIL; i++) {
        const at = Math.max(0, t - i * 0.055);
        const x = Math.round(b.x0 + (b.x1 - b.x0) * at - camera.x);
        const y = Math.round(b.y0 + (b.y1 - b.y0) * at - camera.y);
        if (x < -20 || y < -20 || x > GAME_WIDTH + 20 || y > GAME_HEIGHT + 20) continue;
        const near = 1 - i / TAIL;
        const size = Math.max(1, Math.round(5 * near));
        ctx.fillStyle = withAlpha(i === 0 ? style.core : style.edge, near * (1 - t * 0.35));
        ctx.fillRect(x - (size >> 1), y - (size >> 1), size, size);
      }
    }
    this.bolts.length = live;
  }

  /**
   * Lay a body down. `wx`/`wy` are the top-left of its tile in world pixels.
   *
   * A monster used to be there and then simply not be there: it was drawn
   * while `isAlive` and gone on the frame that stopped being true, which in a
   * busy fight reads as things blinking out rather than dying. The sprite is
   * held here and faded instead. The cache hands back the same ImageData for a
   * template, so this holds a reference and copies nothing.
   */
  popDeath(wx: number, wy: number, monster: Monster): void {
    this.corpses.push({
      x: wx,
      y: wy,
      sprite: this.sprites.getMonsterSprite(monster),
      born: this.renderTime,
    });
    if (this.corpses.length > MapRenderer.CORPSE_CAP) {
      this.corpses.splice(0, this.corpses.length - MapRenderer.CORPSE_CAP);
    }
  }

  /**
   * Draw and expire the bodies.
   *
   * They sink as they go, which is most of what makes it read as collapsing
   * rather than as a sprite being turned down, and they leave a dark mark on
   * the floor that outlives the body by a moment.
   */
  private drawCorpses(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.corpses.length === 0) return;
    let live = 0;
    for (const c of this.corpses) {
      const age = this.renderTime - c.born;
      if (age >= CORPSE_MS) continue;
      this.corpses[live++] = c;
      const t = age / CORPSE_MS;
      const sx = Math.floor(c.x - camera.x + 2);
      const sy = Math.floor(c.y - camera.y + 2);
      if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > GAME_WIDTH || sy > GAME_HEIGHT) continue;

      ctx.fillStyle = `rgba(20,10,10,${(0.45 * (1 - t)).toFixed(3)})`;
      ctx.fillRect(sx, sy + TILE_SIZE - 7, TILE_SIZE - 4, 4);

      // Holding for a moment, then going quickly.
      const alpha = t < 0.3 ? 1 : 1 - (t - 0.3) / 0.7;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.putImageData(c.sprite, sx, sy + Math.round(t * 5));
      ctx.globalAlpha = 1;
    }
    this.corpses.length = live;
  }

  /** Forget every number in flight — combat over, floor changed, run reloaded. */
  clearNumbers(): void {
    this.floaters.length = 0;
    this.effects.length = 0;
    this.corpses.length = 0;
    this.bolts.length = 0;
  }

  /**
   * Draw and expire the bursts in flight.
   *
   * Each is a ring that opens and fades, a core that flares and dies first,
   * and a handful of shards thrown outward along fixed bearings. The bearings
   * come from the effect's own seed rather than a clock, so a burst is the
   * same shape every frame of its life and only its size and alpha move —
   * anything else reads as static rather than as a flash.
   */
  private drawEffects(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.effects.length === 0) return;
    let live = 0;
    for (const e of this.effects) {
      const style = EFFECT_STYLE[e.kind];
      const age = this.renderTime - e.born;
      if (age >= style.ms) continue;
      this.effects[live++] = e;

      const t = age / style.ms;
      const sx = Math.round(e.x - camera.x);
      const sy = Math.round(e.y - camera.y);
      if (sx < -60 || sy < -60 || sx > GAME_WIDTH + 60 || sy > GAME_HEIGHT + 60) continue;

      // Out fast then easing, so the flash has a snap to it.
      const spread = style.reach * (1 - (1 - t) * (1 - t) * (1 - t));
      const fade = 1 - t;

      // Shards, thrown along bearings fixed by the seed.
      ctx.fillStyle = withAlpha(style.edge, fade * 0.9);
      for (let i = 0; i < style.spokes; i++) {
        const a = ((e.seed * 37 + i * 97) % 360) * (Math.PI / 180);
        // Healing rises rather than scattering: the same machinery, biased up.
        const lift = e.kind === 'heal' ? -spread * 1.4 : 0;
        const px = Math.round(sx + Math.cos(a) * spread);
        const py = Math.round(sy + Math.sin(a) * spread * (e.kind === 'heal' ? 0.35 : 1) + lift);
        const size = Math.max(1, Math.round(3 * fade) + 1);
        ctx.fillRect(px - (size >> 1), py - (size >> 1), size, size);
      }

      // The ring: opening and thinning.
      if (t < 0.85 && e.kind !== 'heal') {
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1, spread), 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(style.edge, fade * 0.75);
        ctx.lineWidth = Math.max(1, Math.round(3 * fade));
        ctx.stroke();
      }

      // The core, gone before the rest so the flash has a hot centre.
      if (t < 0.45) {
        const heat = 1 - t / 0.45;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1, Math.round(7 * heat)), 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(style.core, heat);
        ctx.fill();
      }
    }
    this.effects.length = live;
    ctx.lineWidth = 1;
  }

  /**
   * Draw and expire the numbers in flight.
   *
   * There is no strokeText on a RecordingContext, so the outline that keeps a
   * number legible over a lit sprite is four offset copies of the text in
   * black. That is five text commands each, which is why the cap is small.
   */
  private drawFloaters(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.floaters.length === 0) return;
    let live = 0;
    for (const f of this.floaters) {
      const age = this.renderTime - f.born;
      if (age >= MapRenderer.FLOATER_MS) continue;
      this.floaters[live++] = f;
      const t = age / MapRenderer.FLOATER_MS;
      // Out fast, then hanging: a number that rises linearly reads as a
      // balloon, one that decelerates reads as a hit.
      const rise = 30 * (1 - (1 - t) * (1 - t));
      const alpha = t < 0.65 ? 1 : (1 - t) / 0.35;
      const sx = Math.round(f.x - camera.x + f.drift * t * 3);
      const sy = Math.round(f.y - camera.y + 4 + f.lift - rise);
      if (sx < -40 || sy < -20 || sx > GAME_WIDTH + 40 || sy > GAME_HEIGHT + 20) continue;
      const style = FLOATER_STYLE[f.kind];
      // A crit also lands: it starts a little larger and settles back.
      const grow = f.kind === 'crit' ? Math.round(4 * Math.max(0, 1 - t * 4)) : 0;
      ctx.font = `bold ${style.size + grow}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(0,0,0,${(alpha * 0.8).toFixed(3)})`;
      ctx.fillText(f.text, sx - 1, sy);
      ctx.fillText(f.text, sx + 1, sy);
      ctx.fillText(f.text, sx, sy - 1);
      ctx.fillText(f.text, sx, sy + 1);
      ctx.fillStyle = alpha >= 1 ? style.color : `${style.color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
      ctx.fillText(f.text, sx, sy);
    }
    this.floaters.length = live;
    ctx.textAlign = 'left';
    ctx.font = '10px monospace';
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
      // Two footfalls per tile: the sprite rises on each stride and lands
      // between them, which reads as walking rather than sliding.
      const stride = visual.moving ? Math.abs(Math.sin(visual.progress * Math.PI * 2)) : 0;
      const step = visual.moving ? Math.sin(visual.progress * Math.PI) : 0;
      const sy = visual.y - camera.y + 2 - stride * 2;

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

      const sprite = this.sprites.getCharSprite(member, visual.faceLeft);
      ctx.putImageData(sprite, Math.floor(sx), Math.floor(sy));
      // The familiar keeps to its master's heel: a few pixels of the right colour, with an eye.
      if (member.familiar) {
        const colors: Record<string, string> = { cat: '#3a3a44', owl: '#a89468', raven: '#1e1e28', hound: '#8a6a4a', hawk: '#b08a52', fox: '#c8602a', imp: '#7a2a3a', toad: '#5c7d3c', weasel: '#c9a56a' };
        const fx = Math.floor(sx) + (visual.faceLeft ? TILE_SIZE - 7 : 1);
        const fy = Math.floor(sy) + TILE_SIZE - 7;
        ctx.fillStyle = colors[member.familiar.kind] ?? '#6a6a6a';
        ctx.fillRect(fx, fy + 1, 5, 4);
        ctx.fillRect(fx + (visual.faceLeft ? 3 : 0), fy, 2, 2);
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(fx + (visual.faceLeft ? 3 : 1), fy, 1, 1);
      }

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
   * How far above its tile each landmark's drawing reaches, so its name can
   * sit above the tallest thing instead of across it. Towers go a tile and
   * a half up; most things only clear the top edge by a few pixels.
   */
  private static readonly LANDMARK_RISE: Record<string, number> = {
    ancient_ruins: 3, abandoned_mine: 0, witch_hut: 8, dragon_lair: 3,
    ancient_battlefield: 4, hidden_shrine: 3, crystal_cave: 6, bandit_outpost: 4,
    lost_tomb: 5, enchanted_grove: 1, watchtower: 25, wizard_tower: 27,
    haunted_forest: 8, mineral_spring: 4, failed_settlement: 2, goblin_camp: 8,
    moon_forge: 14,
  };

  /**
   * One overworld landmark, drawn in the hand of the terrain around it.
   *
   * These replace a table of emoji glyphs on coloured squares, which were the
   * one thing on a hand-drawn map that looked pasted on. Each is drawn to
   * fill its tile and to rise above it where the real thing would — the
   * towers go well up into the tile to the north — lit from the north-west
   * like the mountains and the towns, with its shadow on the ground to the
   * south-east. Anything that burns, glows or floats breathes off
   * `this.time`; everything else holds still, so the map does not shimmer.
   *
   * Sixteen kinds and a fallback; between twenty and fifty rectangles each.
   */
  private drawLandmark(ctx: CanvasRenderingContext2D, kind: string, X: number, Y: number, tx: number, ty: number): void {
    const t = this.time;
    const f = Math.floor;
    const r = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    const a = (rgb: string, alpha: number) => 'rgba(' + rgb + ',' + alpha.toFixed(3) + ')';
    const sh = 'rgba(0,0,0,0.25)';
    // Three puffs climbing and thinning, as the town chimneys do.
    const puffs = (px: number, py: number, seed: number, rgb: string, spread = 1.5) => {
      for (let i = 0; i < 3; i++) {
        const ph = (t * 0.6 + seed * 0.37 + i * 0.33) % 1;
        r(px + Math.round(Math.sin(ph * 6.28 + seed) * spread), py - 2 - f(ph * 12), i === 2 ? 3 : 2, i === 2 ? 3 : 2, a(rgb, 0.55 * (1 - ph)));
      }
    };
    // A fire: light on the ground, a body of flame licking up, a hot core.
    const fire = (px: number, py: number, seed: number) => {
      const lick = Math.sin(t * 9 + seed) * 0.5 + 0.5;
      const lick2 = Math.sin(t * 13 + seed * 1.7) * 0.5 + 0.5;
      r(px - 5, py - 1, 14, 5, a('255,120,40', 0.16 + lick * 0.10));
      r(px, py - 4 - f(lick * 2), 4, 4 + f(lick * 2), a('255,140,40', 0.85));
      r(px + 1, py - 6 - f(lick2 * 2), 2, 3, a('255,220,120', 0.8));
    };

    switch (kind) {
      case 'ancient_ruins': {
        // A plinth with three columns on it, two of them broken, and the
        // lintel they once carried lying across the front. Ivy on the ones
        // still standing.
        r(X + 2, Y + 20, 28, 9, '#6e6a76'); r(X + 2, Y + 20, 28, 1, '#8a8694'); r(X + 2, Y + 28, 28, 1, '#3a3640');
        r(X + 5, Y - 1, 5, 21, '#8a8694'); r(X + 8, Y - 1, 2, 21, '#5e5a64');
        r(X + 4, Y - 3, 7, 2, '#9c98a6'); r(X + 4, Y + 19, 7, 2, '#5e5a64');
        r(X + 14, Y + 10, 5, 10, '#8a8694'); r(X + 17, Y + 10, 2, 10, '#5e5a64');
        r(X + 14, Y + 8, 2, 2, '#8a8694'); r(X + 17, Y + 9, 2, 1, '#5e5a64');
        r(X + 23, Y + 4, 5, 16, '#8a8694'); r(X + 26, Y + 4, 2, 16, '#5e5a64');
        r(X + 23, Y + 2, 2, 2, '#8a8694'); r(X + 25, Y + 3, 3, 1, '#5e5a64');
        r(X + 9, Y + 24, 9, 4, '#7e7a88'); r(X + 17, Y + 22, 9, 4, '#7e7a88');
        r(X + 9, Y + 24, 9, 1, '#9c98a6'); r(X + 17, Y + 22, 9, 1, '#9c98a6');
        r(X + 9, Y + 27, 9, 1, '#4e4a52'); r(X + 17, Y + 25, 9, 1, '#4e4a52');
        r(X + 1, Y + 27, 3, 2, '#5e5a64'); r(X + 28, Y + 26, 3, 2, '#5e5a64');
        r(X + 5, Y + 8, 2, 6, '#3d7a41'); r(X + 6, Y + 13, 3, 3, '#2f6033');
        r(X + 25, Y + 11, 2, 5, '#3d7a41'); r(X + 24, Y + 15, 3, 2, '#2f6033');
        r(X + 12, Y + 28, 3, 2, '#3d7a41'); r(X + 21, Y + 27, 3, 2, '#3d7a41');
        r(X + 4, Y + 29, 28, 2, sh);
        break;
      }
      case 'abandoned_mine': {
        // A hillside with a timbered adit cut into it; rails run out of the
        // dark and a loaded cart stands in the mouth. A pick leans by the post.
        r(X, Y + 8, 32, 20, '#585048'); r(X + 2, Y + 3, 26, 6, '#6a6058'); r(X + 7, Y, 14, 4, '#7a7068');
        r(X + 7, Y, 5, 1, '#8e8478'); r(X + 2, Y + 3, 5, 1, '#8e8478'); r(X, Y + 8, 4, 2, '#7a7068');
        r(X + 27, Y + 8, 5, 20, '#3e3630'); r(X + 22, Y + 3, 6, 3, '#4e4640');
        r(X + 4, Y + 2, 6, 1, '#3d7a41'); r(X + 24, Y + 6, 5, 1, '#3d7a41');
        r(X + 7, Y + 10, 18, 3, '#7a5a34'); r(X + 7, Y + 10, 18, 1, '#8e6c40');
        r(X + 8, Y + 12, 3, 16, '#6a4a2a'); r(X + 21, Y + 12, 3, 16, '#6a4a2a');
        r(X + 10, Y + 13, 1, 15, '#4a3018'); r(X + 23, Y + 13, 1, 15, '#4a3018');
        r(X + 11, Y + 13, 10, 15, '#0a0a10'); r(X + 11, Y + 13, 10, 1, '#1e1a1a');
        r(X + 12, Y + 25, 8, 1, '#5a4024'); r(X + 12, Y + 29, 8, 1, '#5a4024');
        r(X + 13, Y + 22, 1, 9, '#8a8a90'); r(X + 18, Y + 22, 1, 9, '#8a8a90');
        r(X + 12, Y + 24, 8, 5, '#5a3a22'); r(X + 12, Y + 24, 8, 1, '#7a5a34');
        r(X + 13, Y + 22, 6, 2, '#8a8aa0'); r(X + 14, Y + 22, 2, 1, '#b0b0c0');
        r(X + 12, Y + 29, 2, 2, '#2a2018'); r(X + 18, Y + 29, 2, 2, '#2a2018');
        r(X + 4, Y + 20, 1, 8, '#6a4a2a'); r(X + 2, Y + 19, 5, 1, '#8a8a90');
        r(X + 2, Y + 28, 30, 2, sh);
        break;
      }
      case 'witch_hut': {
        // A hut on stilts that leans east under a roof that comes to a
        // crooked, curling point. One window lit green, a ladder down, and a
        // cauldron going under the floor.
        r(X + 8, Y + 29, 22, 2, sh);
        r(X + 6, Y + 20, 2, 10, '#4a3020'); r(X + 13, Y + 21, 2, 9, '#4a3020');
        r(X + 20, Y + 21, 2, 9, '#4a3020'); r(X + 26, Y + 19, 2, 11, '#4a3020');
        r(X + 8, Y + 25, 5, 1, '#5a4024'); r(X + 22, Y + 24, 4, 1, '#5a4024');
        r(X + 8, Y + 24, 5, 5, '#2a2a30'); r(X + 7, Y + 24, 6, 1, '#3a3a44');
        r(X + 9, Y + 23, 3, 1, a('120,255,120', 0.6 + Math.sin(t * 5 + tx) * 0.3));
        r(X + 5, Y + 9, 20, 6, '#6a5236'); r(X + 7, Y + 15, 20, 6, '#62492e');
        r(X + 5, Y + 12, 20, 1, '#54402a'); r(X + 7, Y + 18, 20, 1, '#54402a');
        r(X + 24, Y + 9, 1, 6, '#3e2e1c'); r(X + 26, Y + 15, 1, 6, '#3e2e1c');
        r(X + 19, Y + 13, 5, 8, '#2a2018');
        r(X + 8, Y + 10, 6, 6, '#2a2018');
        r(X + 9, Y + 11, 4, 4, a('170,255,120', 0.7 + Math.sin(t * 3 + ty) * 0.2));
        r(X + 2, Y + 6, 26, 4, '#3a3028'); r(X + 5, Y + 3, 18, 3, '#433830');
        r(X + 8, Y, 12, 3, '#4a3e36'); r(X + 11, Y - 3, 7, 3, '#4a3e36');
        r(X + 14, Y - 6, 4, 3, '#4a3e36'); r(X + 17, Y - 8, 3, 2, '#4a3e36');
        r(X + 5, Y + 3, 3, 1, '#6a5a50'); r(X + 8, Y, 3, 1, '#6a5a50'); r(X + 11, Y - 3, 2, 1, '#6a5a50');
        r(X + 22, Y - 2, 3, 6, '#4a4048');
        puffs(X + 23, Y - 3, tx + ty, '190,210,170');
        r(X + 16, Y + 21, 1, 9, '#5a4024'); r(X + 19, Y + 21, 1, 9, '#5a4024');
        r(X + 16, Y + 23, 4, 1, '#6a4a2a'); r(X + 16, Y + 26, 4, 1, '#6a4a2a'); r(X + 16, Y + 29, 4, 1, '#6a4a2a');
        break;
      }
      case 'dragon_lair': {
        // Dark red rock with a wide mouth scorched black around it, embers
        // deep inside breathing like something asleep, and what the dragon
        // has eaten lying at the threshold.
        r(X, Y + 6, 32, 24, '#3e2e2e'); r(X + 3, Y + 1, 26, 6, '#4e3a3a'); r(X + 8, Y - 3, 16, 5, '#5a4444');
        r(X + 8, Y - 3, 6, 2, '#6e5656'); r(X + 3, Y + 1, 6, 2, '#6e5656'); r(X, Y + 6, 5, 2, '#5a4444');
        r(X + 27, Y + 6, 5, 24, '#2a1e1e'); r(X + 22, Y + 1, 7, 4, '#3a2a2a');
        r(X + 5, Y + 9, 22, 4, '#1e1414'); r(X + 3, Y + 12, 4, 12, '#2a1a1a'); r(X + 25, Y + 12, 4, 10, '#1e1414');
        r(X + 8, Y + 11, 16, 17, '#0a0606'); r(X + 6, Y + 15, 20, 13, '#0a0606');
        r(X + 9, Y + 11, 2, 3, '#5a4444'); r(X + 14, Y + 11, 2, 4, '#5a4444'); r(X + 19, Y + 11, 2, 3, '#5a4444');
        const ember = Math.sin(t * 1.3 + tx) * 0.5 + 0.5;
        r(X + 9, Y + 18, 14, 10, a('255,80,20', 0.18 + ember * 0.22));
        r(X + 12, Y + 22, 8, 5, a('255,160,50', 0.15 + ember * 0.25));
        r(X + 14, Y + 25, 3, 1, a('255,230,150', 0.3 + ember * 0.5));
        r(X + 1, Y + 24, 5, 4, '#e8e0d0'); r(X + 2, Y + 25, 1, 1, '#1a1010'); r(X + 4, Y + 25, 1, 1, '#1a1010'); r(X + 1, Y + 28, 5, 1, '#c8c0b0');
        r(X + 26, Y + 24, 1, 5, '#d8d0c0'); r(X + 28, Y + 23, 1, 6, '#d8d0c0'); r(X + 30, Y + 25, 1, 4, '#d8d0c0');
        r(X + 8, Y + 29, 8, 1, '#d8d0c0'); r(X + 7, Y + 28, 2, 2, '#e8e0d0'); r(X + 15, Y + 28, 2, 2, '#e8e0d0');
        puffs(X + 15, Y + 10, tx, '70,50,50', 2.5);
        r(X + 2, Y + 30, 30, 1, sh);
        break;
      }
      case 'ancient_battlefield': {
        // Churned ground, two standards on broken poles, a sword driven in
        // to the guard, a spear, a shield, a helm, and a crow that has not
        // left.
        r(X + 2, Y + 17, 28, 12, '#5a4e3c'); r(X + 6, Y + 22, 8, 3, '#4c4232'); r(X + 18, Y + 20, 7, 4, '#4c4232');
        r(X + 4, Y + 29, 26, 2, sh);
        const wave = Math.round(Math.sin(t * 3 + tx) * 1.2);
        r(X + 6, Y - 2, 2, 30, '#5a4024'); r(X + 6, Y - 2, 1, 30, '#7a5a34');
        r(X + 8, Y - 1 + wave, 10, 7, '#a03030'); r(X + 8, Y - 1 + wave, 10, 1, '#c04848');
        r(X + 16, Y + 6 + wave, 2, 2, '#a03030'); r(X + 12, Y + 6 + wave, 2, 3, '#a03030');
        r(X + 11, Y + 1 + wave, 3, 3, '#e8d070');
        r(X + 24, Y + 8, 2, 20, '#5a4024'); r(X + 23, Y + 7, 1, 2, '#5a4024');
        r(X + 18, Y + 9, 6, 8, '#3a4a80'); r(X + 18, Y + 17, 2, 2, '#3a4a80'); r(X + 21, Y + 17, 2, 3, '#3a4a80');
        r(X + 23, Y + 5, 3, 2, '#141418'); r(X + 25, Y + 4, 1, 1, '#141418');
        r(X + 13, Y + 9, 2, 2, '#8a6a30'); r(X + 13, Y + 11, 2, 4, '#5a3a22'); r(X + 11, Y + 15, 6, 1, '#c0c4cc');
        r(X + 13, Y + 16, 2, 10, '#c0c4cc'); r(X + 14, Y + 16, 1, 10, '#8a8e96');
        r(X + 29, Y + 10, 1, 17, '#6a4a2a'); r(X + 28, Y + 7, 3, 3, '#a0a4ac');
        r(X + 2, Y + 24, 6, 5, '#6a4a2a'); r(X + 2, Y + 24, 6, 1, '#8a6a40'); r(X + 4, Y + 26, 2, 2, '#a0a4ac');
        r(X + 19, Y + 25, 5, 3, '#8a8e96'); r(X + 20, Y + 24, 3, 1, '#a0a4ac'); r(X + 19, Y + 27, 5, 1, '#5e6068');
        r(X + 26, Y + 27, 3, 2, '#e8e0d0');
        break;
      }
      case 'hidden_shrine': {
        // A little stone shrine: two steps, two pillars, a roof with turned
        // up ends, an idol in the niche and a flame in a bowl before it.
        // Lanterns either side, moss on the steps.
        r(X + 5, Y + 29, 26, 2, sh);
        r(X + 3, Y + 22, 26, 7, '#7e7a88'); r(X + 3, Y + 22, 26, 1, '#9c98a6'); r(X + 3, Y + 28, 26, 1, '#4e4a52');
        r(X + 6, Y + 19, 20, 4, '#8a8694'); r(X + 6, Y + 22, 20, 1, '#5e5a64');
        r(X + 8, Y + 6, 4, 13, '#8a8694'); r(X + 11, Y + 6, 1, 13, '#5e5a64');
        r(X + 20, Y + 6, 4, 13, '#8a8694'); r(X + 23, Y + 6, 1, 13, '#5e5a64');
        r(X + 13, Y + 8, 6, 11, '#2a262e');
        r(X + 15, Y + 10, 2, 4, '#a49cac'); r(X + 14, Y + 14, 4, 3, '#8a8694');
        r(X + 4, Y + 3, 24, 3, '#4e4854'); r(X + 6, Y, 20, 3, '#5e5a64'); r(X + 10, Y - 3, 12, 3, '#6e6a76');
        r(X + 10, Y - 3, 12, 1, '#9c98a6'); r(X + 3, Y + 1, 2, 2, '#5e5a64'); r(X + 27, Y + 1, 2, 2, '#5e5a64');
        r(X, Y + 13, 5, 2, '#5e5a64'); r(X + 1, Y + 15, 3, 7, '#7e7a88');
        r(X + 27, Y + 13, 5, 2, '#5e5a64'); r(X + 28, Y + 15, 3, 7, '#7e7a88');
        r(X + 3, Y + 24, 3, 2, '#3d7a41'); r(X + 26, Y + 26, 3, 2, '#3d7a41');
        const fl = Math.sin(t * 7 + tx) * 0.5 + 0.5;
        r(X + 14, Y + 20, 4, 2, '#5a4024');
        r(X + 11, Y + 17, 10, 5, a('255,200,100', 0.12 + fl * 0.12));
        r(X + 15, Y + 17 - f(fl * 1.5), 2, 3 + f(fl * 1.5), a('255,200,80', 0.9));
        r(X + 15, Y + 16 - f(fl * 1.5), 2, 1, a('255,240,180', 0.9));
        break;
      }
      case 'crystal_cave': {
        // Blue-grey rock with a dark mouth, and crystals growing out of it
        // in clusters: inside, where the light barely reaches them, and out
        // on the faces where it catches their tips one at a time.
        r(X, Y + 8, 32, 21, '#4a5262'); r(X + 3, Y + 3, 26, 6, '#5a6474'); r(X + 9, Y - 1, 14, 5, '#6a7686');
        r(X + 9, Y - 1, 5, 2, '#8a96a6'); r(X + 3, Y + 3, 5, 2, '#8a96a6'); r(X, Y + 8, 5, 2, '#6a7686');
        r(X + 26, Y + 8, 6, 21, '#343c4a'); r(X + 23, Y + 3, 6, 4, '#4a5262');
        r(X + 9, Y + 13, 14, 15, '#0e1420'); r(X + 11, Y + 11, 10, 2, '#0e1420');
        const gl = Math.sin(t * 2 + tx) * 0.5 + 0.5;
        r(X + 10, Y + 18, 12, 10, a('100,200,255', 0.10 + gl * 0.16));
        r(X + 12, Y + 20, 2, 8, '#5ac8ff'); r(X + 14, Y + 17, 2, 11, '#8ae0ff'); r(X + 17, Y + 22, 2, 6, '#5ac8ff');
        r(X + 2, Y + 18, 2, 7, '#5ac8ff'); r(X + 4, Y + 15, 3, 10, '#8ae0ff');
        r(X + 25, Y + 16, 3, 9, '#6ad0ff'); r(X + 28, Y + 19, 2, 6, '#5ac8ff');
        r(X + 15, Y - 5, 2, 5, '#8ae0ff'); r(X + 13, Y - 2, 2, 3, '#6ad0ff'); r(X + 22, Y + 2, 2, 4, '#6ad0ff');
        r(X + 4, Y + 27, 2, 2, '#5ac8ff'); r(X + 22, Y + 26, 3, 2, '#5ac8ff');
        r(X + 5, Y + 14, 1, 1, a('255,255,255', 0.6 + Math.sin(t * 4 + tx) * 0.4));
        r(X + 15, Y - 6, 1, 1, a('255,255,255', 0.6 + Math.sin(t * 4 + ty + 2) * 0.4));
        r(X + 26, Y + 15, 1, 1, a('255,255,255', 0.6 + Math.sin(t * 4 + tx + 4) * 0.4));
        r(X + 14, Y + 16, 2, 1, a('224,248,255', 0.5 + gl * 0.5));
        r(X + 2, Y + 29, 30, 2, sh);
        break;
      }
      case 'bandit_outpost': {
        // Two tents and a fire behind a palisade of sharpened stakes, a
        // black flag over the lot.
        r(X + 2, Y + 30, 30, 1, sh);
        r(X + 3, Y + 8, 26, 16, '#5a4e3c');
        r(X + 10, Y + 5, 2, 2, '#a08860'); r(X + 8, Y + 7, 6, 2, '#a08860'); r(X + 6, Y + 9, 10, 3, '#a08860'); r(X + 4, Y + 12, 14, 5, '#a08860');
        r(X + 11, Y + 7, 3, 2, '#7c6848'); r(X + 11, Y + 9, 5, 3, '#7c6848'); r(X + 11, Y + 12, 7, 5, '#7c6848');
        r(X + 10, Y + 13, 3, 4, '#2a2018');
        r(X + 24, Y + 8, 2, 2, '#98805a'); r(X + 22, Y + 10, 6, 3, '#98805a'); r(X + 20, Y + 13, 10, 4, '#98805a');
        r(X + 25, Y + 10, 3, 3, '#746040'); r(X + 25, Y + 13, 5, 4, '#746040'); r(X + 24, Y + 14, 2, 3, '#2a2018');
        r(X + 13, Y + 20, 7, 2, '#5e5a64'); r(X + 14, Y + 19, 5, 1, '#5a3a22');
        fire(X + 14, Y + 19, tx);
        r(X, Y + 22, 32, 9, '#6a4a2a'); r(X, Y + 22, 32, 1, '#8a6a40');
        for (let i = 0; i < 7; i++) r(X + 3 + i * 4, Y + 22, 1, 9, '#2a2018');
        for (let i = 0; i < 8; i++) r(X + 1 + i * 4, Y + 20, 2, 2, '#7a5a34');
        r(X, Y + 6, 4, 16, '#6a4a2a'); r(X, Y + 5, 3, 1, '#7a5a34');
        r(X, Y + 10, 4, 1, '#2a2018'); r(X, Y + 14, 4, 1, '#2a2018'); r(X, Y + 18, 4, 1, '#2a2018');
        const fw = Math.round(Math.sin(t * 3 + ty) * 0.8);
        r(X + 27, Y - 4, 1, 12, '#3a2a18'); r(X + 28, Y - 3 + fw, 4, 4, '#1a1a1e'); r(X + 29, Y - 2 + fw, 2, 2, '#e0d8c8');
        break;
      }
      case 'lost_tomb': {
        // A barrow with a stone face set into it: pillars, a lintel, a
        // sealed door with iron bands and something pale showing at the
        // seam, and a standing stone on the crown of the mound.
        r(X + 2, Y + 30, 30, 1, sh);
        r(X, Y + 10, 32, 19, '#3a5a32'); r(X + 3, Y + 5, 26, 6, '#4a6a3a'); r(X + 8, Y + 1, 16, 5, '#557a44');
        r(X + 8, Y + 1, 6, 2, '#6a8e54'); r(X + 3, Y + 5, 6, 2, '#6a8e54'); r(X, Y + 10, 5, 2, '#557a44');
        r(X + 26, Y + 10, 6, 19, '#2c4626'); r(X + 23, Y + 5, 6, 4, '#3a5a32');
        r(X + 15, Y - 5, 2, 7, '#8a8694'); r(X + 15, Y - 5, 1, 7, '#a49cac'); r(X + 13, Y - 3, 6, 1, '#8a8694');
        r(X + 8, Y + 12, 16, 16, '#7e7a88'); r(X + 8, Y + 12, 16, 1, '#a49cac'); r(X + 22, Y + 13, 2, 15, '#4e4854');
        r(X + 7, Y + 11, 18, 2, '#8a8694'); r(X + 9, Y + 13, 2, 15, '#9c98a6'); r(X + 21, Y + 13, 2, 15, '#5e5a64');
        r(X + 12, Y + 15, 8, 13, '#3a3640'); r(X + 12, Y + 18, 8, 1, '#5a5a64'); r(X + 12, Y + 23, 8, 1, '#5a5a64');
        r(X + 16, Y + 15, 1, 13, a('120,200,140', 0.25 + (Math.sin(t * 1.5 + tx) * 0.5 + 0.5) * 0.35));
        r(X + 2, Y + 19, 3, 9, '#6e6a76'); r(X + 2, Y + 19, 3, 1, '#8a8694'); r(X + 27, Y + 19, 3, 9, '#6e6a76'); r(X + 27, Y + 19, 3, 1, '#8a8694');
        r(X + 11, Y + 28, 10, 1, '#8a8694'); r(X + 10, Y + 29, 12, 1, '#5e5a64');
        break;
      }
      case 'enchanted_grove': {
        // Pale-barked trees in a ring around a light that should not be
        // there, with mushrooms in a ring of their own and motes drifting up
        // through it.
        r(X + 3, Y + 29, 26, 2, 'rgba(0,0,0,0.15)');
        const gg = Math.sin(t * 1.6 + tx) * 0.5 + 0.5;
        r(X + 9, Y + 12, 14, 12, a('120,255,160', 0.18 + gg * 0.18));
        r(X + 12, Y + 15, 8, 6, a('220,255,230', 0.25 + gg * 0.3));
        r(X + 13, Y + 17, 6, 3, a('255,255,255', 0.3 + gg * 0.4));
        const tree = (px: number, py: number) => {
          r(px + 3, py + 7, 2, 8, '#e0d8cc'); r(px + 4, py + 7, 1, 8, '#a09888');
          r(px, py + 1, 8, 7, '#9ad0a0'); r(px + 1, py, 6, 2, '#9ad0a0'); r(px + 1, py + 1, 3, 3, '#c8f0c8');
        };
        tree(X + 1, Y - 1); tree(X + 23, Y - 1);
        tree(X - 1, Y + 12); tree(X + 25, Y + 12);
        tree(X + 5, Y + 17); tree(X + 19, Y + 17);
        r(X + 10, Y + 24, 3, 2, '#e05060'); r(X + 11, Y + 26, 1, 2, '#f0e8e0');
        r(X + 20, Y + 25, 3, 2, '#e05060'); r(X + 21, Y + 27, 1, 2, '#f0e8e0');
        r(X + 15, Y + 8, 3, 2, '#e05060'); r(X + 16, Y + 10, 1, 2, '#f0e8e0');
        for (let i = 0; i < 3; i++) {
          const ph = (t * 0.4 + i * 0.33 + tx * 0.1) % 1;
          r(X + 8 + i * 7 + Math.round(Math.sin(t * 2 + i) * 2), Y + 22 - f(ph * 16), 1, 1, a('220,255,220', 0.9 * (1 - ph)));
        }
        break;
      }
      case 'watchtower': {
        // A round stone tower a tile and a half tall, crenellated, with a
        // brazier burning on top and a pennant above that.
        r(X + 12, Y + 29, 18, 2, 'rgba(0,0,0,0.3)'); r(X + 23, Y + 18, 5, 11, 'rgba(16,16,26,0.22)');
        r(X + 6, Y + 26, 20, 3, '#5e5a64'); r(X + 3, Y + 27, 4, 2, '#6e6a76'); r(X + 26, Y + 26, 4, 3, '#6e6a76');
        r(X + 9, Y - 10, 14, 37, '#7a7280'); r(X + 9, Y - 10, 4, 37, '#a49cac'); r(X + 20, Y - 10, 3, 37, '#4e4854');
        r(X + 9, Y - 2, 14, 1, '#5e5a64'); r(X + 9, Y + 6, 14, 1, '#5e5a64'); r(X + 9, Y + 14, 14, 1, '#5e5a64');
        r(X + 7, Y - 14, 18, 4, '#7a7280'); r(X + 7, Y - 14, 18, 1, '#a49cac'); r(X + 7, Y - 11, 18, 1, '#4e4854');
        r(X + 7, Y - 16, 3, 2, '#a49cac'); r(X + 12, Y - 16, 3, 2, '#a49cac'); r(X + 17, Y - 16, 3, 2, '#a49cac'); r(X + 22, Y - 16, 3, 2, '#8a8694');
        r(X + 15, Y + 3, 2, 4, '#2a262e'); r(X + 15, Y + 16, 2, 4, '#2a262e');
        r(X + 15, Y - 6, 2, 3, a('255,220,140', 0.85));
        r(X + 13, Y + 21, 6, 7, '#2a262e'); r(X + 14, Y + 20, 4, 1, '#2a262e');
        fire(X + 14, Y - 16, tx + 3);
        const pw = Math.round(Math.sin(t * 3 + tx) * 0.8);
        r(X + 22, Y - 23, 1, 8, '#3a2a18'); r(X + 23, Y - 22 + pw, 6, 3, '#c04040');
        break;
      }
      case 'wizard_tower': {
        // Taller and thinner than the watchtower, in violet stone under a
        // steep indigo cap, one window always lit, and a light that circles
        // the top and is not a bird. It passes behind the tower on the far
        // half of its orbit.
        const orbit = t * 1.4 + tx;
        const ox = X + 16 + Math.round(Math.cos(orbit) * 11);
        const oy = Y - 10 + Math.round(Math.sin(orbit) * 4);
        const orb = () => { r(ox - 2, oy - 2, 5, 5, a('180,120,255', 0.3)); r(ox - 1, oy - 1, 3, 3, a('220,190,255', 0.95)); };
        if (Math.sin(orbit) < 0) orb();
        r(X + 14, Y + 29, 16, 2, 'rgba(0,0,0,0.3)'); r(X + 20, Y + 14, 4, 15, 'rgba(16,16,26,0.22)');
        r(X + 9, Y + 25, 14, 4, '#4e4854'); r(X + 13, Y + 28, 6, 1, '#8a8694');
        r(X + 3, Y + 23, 3, 6, '#6a5a8a'); r(X + 26, Y + 22, 3, 7, '#6a5a8a');
        r(X + 4, Y + 25, 1, 1, a('190,140,255', 0.5 + Math.sin(t * 2 + tx) * 0.4));
        r(X + 27, Y + 24, 1, 1, a('190,140,255', 0.5 + Math.sin(t * 2 + ty + 1.5) * 0.4));
        r(X + 12, Y - 16, 8, 42, '#5a4a7a'); r(X + 12, Y - 16, 2, 42, '#8a7aaa'); r(X + 18, Y - 16, 2, 42, '#3a2e52');
        r(X + 12, Y - 8, 8, 1, '#463a5e'); r(X + 12, Y + 14, 8, 1, '#463a5e');
        r(X + 10, Y + 2, 12, 2, '#6a5a8a'); r(X + 10, Y + 4, 12, 1, '#3a2e52');
        r(X + 10, Y - 18, 12, 3, '#3a3060'); r(X + 12, Y - 21, 8, 3, '#443878'); r(X + 14, Y - 24, 4, 3, '#4c4088');
        r(X + 15, Y - 27, 2, 3, '#a0a0c0'); r(X + 10, Y - 18, 3, 1, '#7a70b0'); r(X + 12, Y - 21, 2, 1, '#7a70b0');
        r(X + 15, Y - 13, 2, 3, a('190,140,255', 0.6 + Math.sin(t * 2.5 + tx) * 0.3));
        r(X + 15, Y + 8, 2, 3, a('255,220,140', 0.85));
        r(X + 14, Y + 22, 4, 6, '#2a1e3a');
        if (Math.sin(orbit) >= 0) orb();
        break;
      }
      case 'haunted_forest': {
        // Three dead trees, a grave among the roots, mist at their feet, and
        // a light that wanders between them.
        const deadTree = (px: number, py: number, h: number) => {
          r(px, py, 3, h, '#3a3230'); r(px, py, 1, h, '#544a46');
          r(px - 4, py + 4, 4, 1, '#3a3230'); r(px - 5, py + 2, 1, 3, '#3a3230');
          r(px + 3, py + 7, 5, 1, '#3a3230'); r(px + 7, py + 4, 1, 4, '#3a3230');
          r(px + 1, py - 3, 1, 3, '#3a3230');
          r(px - 2, py + h - 1, 7, 1, '#2e2826');
        };
        deadTree(X + 6, Y + 3, 24); deadTree(X + 17, Y - 5, 32); deadTree(X + 26, Y + 8, 19);
        r(X + 23, Y - 2, 3, 2, '#141418'); r(X + 25, Y - 3, 1, 1, '#141418');
        r(X + 1, Y + 22, 4, 6, '#6e6a76'); r(X + 1, Y + 21, 4, 1, '#8a8694'); r(X + 2, Y + 24, 2, 1, '#4e4a52');
        r(X + 9, Y + 9, 1, 5, '#4a5a48'); r(X + 20, Y + 3, 1, 6, '#4a5a48');
        const mist = Math.sin(t * 0.8 + tx) * 0.5 + 0.5;
        r(X, Y + 23, 32, 6, a('160,180,170', 0.12 + mist * 0.10));
        r(X + 4, Y + 20, 20, 3, a('160,180,170', 0.06 + mist * 0.08));
        const wx = X + 14 + Math.round(Math.sin(t * 1.1 + tx) * 9);
        const wy = Y + 12 + Math.round(Math.sin(t * 1.7 + ty) * 5);
        r(wx - 2, wy - 2, 7, 7, a('120,255,180', 0.22));
        r(wx, wy, 3, 3, a('160,255,210', 0.9));
        r(wx - Math.round(Math.cos(t * 1.1 + tx) * 3), wy + 1, 1, 1, a('160,255,210', 0.5));
        break;
      }
      case 'mineral_spring': {
        // A pool of hot mineral water in a rim of rock, crusted pale where
        // it has dried, with steam coming off it.
        r(X + 4, Y + 29, 26, 2, sh);
        r(X + 4, Y + 6, 24, 2, '#6e6a76'); r(X + 2, Y + 8, 28, 20, '#6e6a76'); r(X + 4, Y + 28, 24, 1, '#5e5a64');
        r(X + 4, Y + 6, 10, 2, '#8a8694'); r(X + 2, Y + 8, 3, 8, '#8a8694');
        r(X + 27, Y + 12, 3, 16, '#4e4a52'); r(X + 8, Y + 26, 20, 2, '#4e4a52');
        r(X, Y + 18, 4, 4, '#5e5a64'); r(X + 28, Y + 5, 4, 4, '#5e5a64'); r(X + 12, Y + 27, 5, 3, '#5e5a64');
        const sw = Math.sin(t * 2 + tx * 0.6 + ty * 0.4) * 0.5 + 0.5;
        r(X + 6, Y + 11, 20, 14, `rgb(${f(50 + sw * 12)},${f(160 + sw * 16)},${f(150 + sw * 20)})`);
        r(X + 6, Y + 11, 20, 1, '#d8e8d0'); r(X + 6, Y + 11, 1, 14, '#d8e8d0'); r(X + 7, Y + 24, 19, 1, '#a8c8b8'); r(X + 25, Y + 12, 1, 12, '#8ab8a8');
        r(X + 8 + f((t * 3 + tx) % 14), Y + 15, 4, 1, a('220,255,250', 0.5));
        r(X + 8 + f((t * 2 + ty + 7) % 12), Y + 20, 6, 1, a('220,255,250', 0.4));
        for (let i = 0; i < 4; i++) {
          const ph = (t * 0.35 + i * 0.25 + tx * 0.13) % 1;
          const px = X + 8 + i * 5 + Math.round(Math.sin(t * 1.5 + i * 2) * 2);
          r(px, Y + 16 - f(ph * 20), 3 + (i & 1), 2 + (i & 1), a('240,250,250', 0.5 * (1 - ph)));
        }
        break;
      }
      case 'goblin_camp': {
        // Two hide huts, a totem with a skull on it, a fire, and a spear
        // stuck in the ground where the last one fell.
        r(X + 3, Y + 30, 26, 1, sh);
        r(X + 2, Y + 10, 28, 18, '#5a4e3c');
        r(X + 3, Y + 14, 12, 10, '#7a6a3c'); r(X + 5, Y + 11, 8, 3, '#7a6a3c'); r(X + 7, Y + 9, 4, 2, '#7a6a3c');
        r(X + 12, Y + 14, 3, 10, '#5a4c2a'); r(X + 5, Y + 17, 8, 1, '#8c7c4c'); r(X + 7, Y + 19, 4, 5, '#2a2018');
        r(X + 19, Y + 16, 10, 8, '#6e5e36'); r(X + 21, Y + 13, 6, 3, '#6e5e36'); r(X + 26, Y + 16, 3, 8, '#4e4224'); r(X + 22, Y + 20, 3, 4, '#2a2018');
        r(X + 15, Y - 4, 4, 17, '#6a4a2a');
        r(X + 15, Y - 8, 4, 4, '#e8e0d0'); r(X + 16, Y - 7, 1, 1, '#1a1010'); r(X + 18, Y - 7, 1, 1, '#1a1010');
        r(X + 13, Y - 6, 2, 3, '#e0e0e0'); r(X + 19, Y - 6, 2, 3, '#e0e0e0');
        r(X + 15, Y - 3, 4, 3, '#c04040'); r(X + 16, Y - 2, 1, 1, '#fff'); r(X + 18, Y - 2, 1, 1, '#fff');
        r(X + 15, Y + 2, 4, 3, '#d0a030'); r(X + 16, Y + 3, 1, 1, '#1a1010'); r(X + 18, Y + 3, 1, 1, '#1a1010');
        r(X + 15, Y + 7, 4, 3, '#4080c0'); r(X + 15, Y + 10, 4, 1, '#fff');
        r(X + 13, Y + 25, 8, 2, '#5e5a64'); fire(X + 15, Y + 24, ty + 1);
        r(X + 1, Y + 26, 3, 3, '#e8e0d0'); r(X + 28, Y + 26, 3, 2, '#e8e0d0');
        r(X + 30, Y + 8, 1, 12, '#6a4a2a'); r(X + 29, Y + 6, 3, 2, '#a0a4ac');
        break;
      }
      case 'moon_forge': {
        // An anvil on a ring of stone between two rune-stones, with a
        // crescent hanging above it that gives the only light: silver and
        // cold. Sparks rise off the anvil though nobody is working it.
        r(X + 4, Y + 29, 26, 2, sh);
        r(X + 2, Y + 18, 28, 11, '#4e4a52'); r(X + 2, Y + 18, 28, 1, '#8a8694'); r(X + 4, Y + 16, 24, 2, '#6e6a76');
        const ms = Math.sin(t * 1.2 + tx) * 0.5 + 0.5;
        r(X + 1, Y + 8, 4, 10, '#5e5a64'); r(X + 1, Y + 8, 4, 1, '#8a8694'); r(X + 2, Y + 11, 2, 1, a('200,170,255', 0.4 + ms * 0.5));
        r(X + 27, Y + 8, 4, 10, '#5e5a64'); r(X + 27, Y + 8, 4, 1, '#8a8694'); r(X + 28, Y + 12, 2, 1, a('200,170,255', 0.4 + ms * 0.5));
        r(X + 12, Y + 16, 8, 5, '#3a3a44'); r(X + 13, Y + 14, 6, 2, '#4a4a56'); r(X + 8, Y + 11, 16, 3, '#6a6a78');
        r(X + 5, Y + 11, 3, 2, '#6a6a78'); r(X + 8, Y + 11, 16, 1, '#a0a0b0'); r(X + 22, Y + 12, 2, 2, '#3a3a44');
        r(X + 16, Y + 7, 2, 4, '#5a3a22'); r(X + 15, Y + 5, 4, 2, '#8a8a98');
        r(X + 8, Y + 10, 16, 1, a('220,220,255', 0.2 + ms * 0.4));
        const my = Y - 11 + Math.round(Math.sin(t * 1.2 + tx) * 1.5);
        r(X + 8, my - 2, 14, 15, a('190,150,255', 0.10 + ms * 0.12));
        r(X + 13, my, 7, 2, '#e8e8f8'); r(X + 11, my + 2, 3, 2, '#e8e8f8'); r(X + 10, my + 4, 2, 5, '#e8e8f8');
        r(X + 11, my + 9, 3, 2, '#e8e8f8'); r(X + 13, my + 11, 7, 2, '#e8e8f8');
        r(X + 10, my + 4, 1, 5, '#ffffff');
        for (let i = 0; i < 3; i++) {
          const ph = (t * 0.9 + i * 0.33 + tx * 0.1) % 1;
          r(X + 12 + i * 4 + Math.round(Math.sin(t * 3 + i) * 1.5), Y + 10 - f(ph * 9), 1, 1, a('230,230,255', 0.9 * (1 - ph)));
        }
        break;
      }
      case 'failed_settlement': {
        // What is left of a village: a cottage with its roof fallen in,
        // another burnt to its beams, the well between them, a dead tree,
        // and weeds through everything.
        r(X + 3, Y + 29, 28, 2, sh);
        r(X + 2, Y + 14, 13, 10, '#7c6c50'); r(X + 2, Y + 23, 13, 1, '#5a4a34');
        r(X + 1, Y + 11, 15, 3, '#4a3a2a'); r(X + 2, Y + 9, 6, 2, '#4a3a2a'); r(X + 3, Y + 8, 3, 1, '#5a4a36');
        r(X + 9, Y + 9, 6, 3, '#2a2018'); r(X + 7, Y + 18, 3, 6, '#2a2018'); r(X + 3, Y + 17, 3, 3, '#2a2018');
        r(X + 19, Y + 16, 11, 8, '#5a4a3a'); r(X + 19, Y + 16, 11, 2, '#2a2018'); r(X + 28, Y + 18, 2, 6, '#3e3228');
        r(X + 20, Y + 11, 1, 5, '#3a2a1a'); r(X + 27, Y + 10, 1, 6, '#3a2a1a'); r(X + 20, Y + 11, 8, 1, '#3a2a1a');
        r(X + 13, Y + 24, 6, 4, '#6e6a76'); r(X + 12, Y + 23, 8, 1, '#8a8694'); r(X + 13, Y + 20, 1, 3, '#5a3a22'); r(X + 18, Y + 20, 1, 3, '#5a3a22'); r(X + 12, Y + 19, 8, 1, '#4a3a2a');
        r(X + 27, Y - 2, 2, 12, '#3a3230'); r(X + 24, Y + 2, 3, 1, '#3a3230'); r(X + 29, Y, 3, 1, '#3a3230'); r(X + 23, Y, 1, 2, '#3a3230');
        r(X + 4, Y + 26, 3, 2, '#3d7a41'); r(X + 22, Y + 26, 4, 2, '#3d7a41'); r(X + 16, Y + 12, 2, 3, '#3d7a41'); r(X + 12, Y + 15, 2, 2, '#3d7a41');
        r(X + 1, Y + 27, 6, 1, '#5a4024'); r(X + 2, Y + 25, 1, 3, '#5a4024'); r(X + 6, Y + 25, 1, 3, '#5a4024');
        break;
      }
      default: {
        // A kind this renderer has not met: a signpost, so it is at least
        // clearly a place.
        r(X + 14, Y + 8, 3, 21, '#6a4a2a'); r(X + 8, Y + 6, 16, 6, '#8a6a40'); r(X + 8, Y + 6, 16, 1, '#a08050');
        r(X + 12, Y + 29, 10, 2, sh);
        break;
      }
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

    // Which town a tile belongs to, so a Town tile can take its roofs from
    // the kind of town it is. Nine entries per town; rebuilt each frame because
    // it is cheaper than keeping it in step with a world that regenerates.
    const townByTile = new Map<number, OverworldTown>();
    for (const t of towns) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        townByTile.set(tileKey(t.tile.x + dx, t.tile.y + dy), t);
      }
    }

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
            // A settlement, not a scatter of buildings. Each tile knows where it
            // sits in the three-by-three from its neighbours, the same way the
            // terrain knows its seams: the centre is the hall, the edges carry
            // the wall with a gatehouse wherever a road comes in, the corners
            // carry a tower. Roofs take their colour from the kind of town.
            //
            // Everything here is drawn large. The first draft put a fourteen
            // pixel cottage on a thirty-two pixel tile and a ten pixel gate in a
            // grey wall, and at map scale both vanished — nine tan blocks in a
            // grid, and roads that stopped dead at the wall.
            const X = f(sx), Y = f(sy);
            const roofs = roofsFor(townByTile.get(tileKey(x, y))?.archetypeId);
            const ridge = lighten(roofs.roof, 0.28);
            const inTown = (dx: number, dy: number) => tileAt(map, x + dx, y + dy) === TileType.Town;
            const nT = inTown(0, -1), sT = inTown(0, 1), wT = inTown(-1, 0), eT = inTown(1, 0);
            const edges = (nT ? 0 : 1) + (sT ? 0 : 1) + (wT ? 0 : 1) + (eT ? 0 : 1);
            const h = cellHash(x, y, 67);

            // Cobbled square: a warm ground with lighter sets scattered over it.
            ctx.fillStyle = '#6a5c4c';
            ctx.fillRect(X, Y, TILE_SIZE, TILE_SIZE);
            ctx.fillStyle = '#7a6c5a';
            for (let i = 0; i < 6; i++) {
              const q = cellHash(x, y, 71 + i);
              ctx.fillRect(X + (q % 14) * 2, Y + ((q >> 2) % 14) * 2, 2, 2);
            }
            ctx.fillStyle = '#5c4e40';
            ctx.fillRect(X + (h % 5) * 4, Y + ((h >> 3) % 6) * 4, 6, 3);

            const wallLight = '#a49cac', wall = '#7a7280', wallDark = '#4e4854';
            const road = '#8a7a5a', roadDark = '#6e6046';
            // The wall, six deep, crenellated along its outer edge.
            if (!nT) {
              ctx.fillStyle = wall; ctx.fillRect(X, Y, TILE_SIZE, 6);
              ctx.fillStyle = wallLight; for (let i = 0; i < TILE_SIZE; i += 6) ctx.fillRect(X + i, Y, 3, 2);
              ctx.fillStyle = wallDark; ctx.fillRect(X, Y + 6, TILE_SIZE, 1);
            }
            if (!sT) {
              ctx.fillStyle = wall; ctx.fillRect(X, Y + TILE_SIZE - 6, TILE_SIZE, 6);
              ctx.fillStyle = wallLight; for (let i = 0; i < TILE_SIZE; i += 6) ctx.fillRect(X + i, Y + TILE_SIZE - 6, 3, 2);
              ctx.fillStyle = wallDark; ctx.fillRect(X, Y + TILE_SIZE - 7, TILE_SIZE, 1);
            }
            if (!wT) {
              ctx.fillStyle = wall; ctx.fillRect(X, Y, 6, TILE_SIZE);
              ctx.fillStyle = wallLight; for (let i = 0; i < TILE_SIZE; i += 6) ctx.fillRect(X, Y + i, 2, 3);
              ctx.fillStyle = wallDark; ctx.fillRect(X + 6, Y, 1, TILE_SIZE);
            }
            if (!eT) {
              ctx.fillStyle = wall; ctx.fillRect(X + TILE_SIZE - 6, Y, 6, TILE_SIZE);
              ctx.fillStyle = wallLight; for (let i = 0; i < TILE_SIZE; i += 6) ctx.fillRect(X + TILE_SIZE - 2, Y + i, 2, 3);
              ctx.fillStyle = wallDark; ctx.fillRect(X + TILE_SIZE - 7, Y, 1, TILE_SIZE);
            }

            // A gatehouse where a road meets the wall. The road itself runs
            // through the band and on to the square, so the way in reads from
            // across the map; two posts rise above the wall either side of a
            // dark arch.
            const gateN = !nT && joinsRoad(map, x, y - 1);
            const gateS = !sT && joinsRoad(map, x, y + 1);
            const gateW = !wT && joinsRoad(map, x - 1, y);
            const gateE = !eT && joinsRoad(map, x + 1, y);
            const gated = gateN || gateS || gateW || gateE;
            if (gateN || gateS) {
              const gy = gateN ? Y : Y + TILE_SIZE - 8;
              ctx.fillStyle = road; ctx.fillRect(X + 12, gateN ? Y : Y + 8, 8, TILE_SIZE - 8);
              ctx.fillStyle = roadDark; ctx.fillRect(X + 12, gateN ? Y : Y + 8, 1, TILE_SIZE - 8); ctx.fillRect(X + 19, gateN ? Y : Y + 8, 1, TILE_SIZE - 8);
              ctx.fillStyle = wallDark; ctx.fillRect(X + 7, gy - (gateN ? 0 : 2), 5, 10); ctx.fillRect(X + 20, gy - (gateN ? 0 : 2), 5, 10);
              ctx.fillStyle = wall; ctx.fillRect(X + 8, gy - (gateN ? 0 : 2) + 1, 3, 8); ctx.fillRect(X + 21, gy - (gateN ? 0 : 2) + 1, 3, 8);
              ctx.fillStyle = wallLight; ctx.fillRect(X + 8, gy - (gateN ? 0 : 2) + 1, 3, 1); ctx.fillRect(X + 21, gy - (gateN ? 0 : 2) + 1, 3, 1);
              ctx.fillStyle = '#2a2018'; ctx.fillRect(X + 13, gateN ? Y + 1 : Y + TILE_SIZE - 8, 6, 7);
            }
            if (gateW || gateE) {
              const gx = gateW ? X : X + TILE_SIZE - 8;
              ctx.fillStyle = road; ctx.fillRect(gateW ? X : X + 8, Y + 12, TILE_SIZE - 8, 8);
              ctx.fillStyle = roadDark; ctx.fillRect(gateW ? X : X + 8, Y + 12, TILE_SIZE - 8, 1); ctx.fillRect(gateW ? X : X + 8, Y + 19, TILE_SIZE - 8, 1);
              ctx.fillStyle = wallDark; ctx.fillRect(gx - (gateW ? 0 : 2), Y + 7, 10, 5); ctx.fillRect(gx - (gateW ? 0 : 2), Y + 20, 10, 5);
              ctx.fillStyle = wall; ctx.fillRect(gx - (gateW ? 0 : 2) + 1, Y + 8, 8, 3); ctx.fillRect(gx - (gateW ? 0 : 2) + 1, Y + 21, 8, 3);
              ctx.fillStyle = wallLight; ctx.fillRect(gx - (gateW ? 0 : 2) + 1, Y + 8, 8, 1); ctx.fillRect(gx - (gateW ? 0 : 2) + 1, Y + 21, 8, 1);
              ctx.fillStyle = '#2a2018'; ctx.fillRect(gateW ? X + 1 : X + TILE_SIZE - 8, Y + 13, 7, 6);
            }

            // Corner towers where two walls meet.
            if (edges >= 2) {
              const cx = wT ? X + TILE_SIZE - 10 : X;
              const cy = nT ? Y + TILE_SIZE - 10 : Y;
              ctx.fillStyle = wallDark; ctx.fillRect(cx, cy, 10, 10);
              ctx.fillStyle = wall; ctx.fillRect(cx + 1, cy + 1, 8, 8);
              ctx.fillStyle = wallLight; ctx.fillRect(cx + 1, cy + 1, 8, 2);
              ctx.fillStyle = roofs.roofDark; ctx.fillRect(cx + 1, cy - 3, 8, 4);
              ctx.fillStyle = roofs.roof; ctx.fillRect(cx + 3, cy - 5, 4, 3);
            }

            // Three puffs climbing and thinning, phased by the seed so a town's
            // chimneys do not all breathe together.
            const chimneyPuffs = (px: number, py: number, seed: number) => {
              for (let i = 0; i < 3; i++) {
                const ph = ((this.time * 0.7 + seed * 0.37 + i * 0.33) % 1);
                const py2 = py - 3 - Math.floor(ph * 11);
                const px2 = px + Math.round(Math.sin(ph * 6.28 + seed) * 1.5);
                const size = 2 + (i === 2 ? 1 : 0);
                ctx.fillStyle = 'rgba(220,214,200,' + (0.55 * (1 - ph)).toFixed(3) + ')';
                ctx.fillRect(px2, py2, size, size);
              }
            };

            if (edges === 0) {
              // The hall: it fills its tile and rises above it. Wide body, a
              // roof in three courses ending in a lighter ridge, a bell tower
              // above the roofline with the banner flying beside it.
              ctx.fillStyle = '#8a7a5a'; ctx.fillRect(X + 2, Y + 15, 28, 13);
              ctx.fillStyle = '#6a5a40'; ctx.fillRect(X + 2, Y + 27, 28, 1);
              ctx.fillStyle = roofs.roofDark; ctx.fillRect(X, Y + 11, 32, 5);
              ctx.fillStyle = roofs.roof; ctx.fillRect(X + 3, Y + 7, 26, 4); ctx.fillRect(X + 7, Y + 4, 18, 3);
              ctx.fillStyle = ridge; ctx.fillRect(X + 9, Y + 4, 14, 1);
              ctx.fillStyle = '#5a3a22'; ctx.fillRect(X + 13, Y + 21, 6, 7);
              ctx.fillStyle = '#3a2412'; ctx.fillRect(X + 13, Y + 21, 6, 1);
              ctx.fillStyle = 'rgba(255,220,140,0.9)'; ctx.fillRect(X + 5, Y + 18, 4, 3); ctx.fillRect(X + 23, Y + 18, 4, 3);
              ctx.fillStyle = wallDark; ctx.fillRect(X + 12, Y - 5, 6, 10);
              ctx.fillStyle = wall; ctx.fillRect(X + 13, Y - 4, 4, 8);
              ctx.fillStyle = roofs.roofDark; ctx.fillRect(X + 11, Y - 7, 8, 3);
              const wave = Math.round(Math.sin(this.time * 3 + x) * 0.6);
              ctx.fillStyle = roofs.banner; ctx.fillRect(X + 18, Y - 4 + wave, 8, 4);
              ctx.fillStyle = wallDark; ctx.fillRect(X + 18, Y - 6, 1, 8);
              chimneyPuffs(X + 27, Y + 9, h);
            } else if (gated) {
              // A gate tile is the road and the gatehouse; a cottage in front
              // of the gate would block the way it exists to open.
            } else {
              // A house. Two kinds by the hash — a wide low cottage and a tall
              // narrow one — so a row of them is not a row of the same thing.
              // Pushed away from whichever wall the tile carries.
              const tall = h % 2 === 1;
              const bw = tall ? 15 : 23, bh = tall ? 13 : 10;
              const bx = X + (wT ? 1 : 7) + (tall ? (h >> 2) % 6 : (h >> 2) % 2);
              const by = Y + (nT ? 2 : 8) + (tall ? 1 : 5);
              ctx.fillStyle = h % 4 < 2 ? '#8a7a5a' : '#7c6c50'; ctx.fillRect(bx, by + 5, bw, bh);
              ctx.fillStyle = '#5a4a34'; ctx.fillRect(bx, by + 5 + bh - 1, bw, 1);
              ctx.fillStyle = roofs.roofDark; ctx.fillRect(bx - 1, by + 2, bw + 2, 4);
              ctx.fillStyle = roofs.roof; ctx.fillRect(bx + 1, by - 1, bw - 2, 3);
              ctx.fillStyle = ridge; ctx.fillRect(bx + 3, by - 1, bw - 6, 1);
              const door = bx + (bw >> 1) - 2;
              ctx.fillStyle = '#4a2e18'; ctx.fillRect(door, by + bh - 1, 4, 6);
              ctx.fillStyle = 'rgba(255,220,140,0.85)';
              if (tall) { ctx.fillRect(bx + 3, by + 8, 3, 3); }
              else { ctx.fillRect(bx + 3, by + 8, 3, 2); ctx.fillRect(bx + bw - 6, by + 8, 3, 2); }
              if (h % 3 !== 0) chimneyPuffs(bx + bw - 4, by + 1, h);
            }
            break;
          }
          case TileType.DungeonEntrance: {
            // A cave mouth in a rocky mound rather than a square ring on the
            // ground: a hill, lit from the north-west like the mountains, with
            // a dark arch at its foot, steps going in, and something glowing
            // a little way down.
            const X = f(sx), Y = f(sy);
            ctx.fillStyle = '#3a4a2e';
            ctx.fillRect(X, Y, TILE_SIZE, TILE_SIZE);
            // The mound, as stacked courses narrowing upward.
            ctx.fillStyle = '#4e4a52'; ctx.fillRect(X + 1, Y + 14, 30, 14);
            ctx.fillStyle = '#5e5a64'; ctx.fillRect(X + 4, Y + 8, 24, 7);
            ctx.fillStyle = '#6e6a76'; ctx.fillRect(X + 9, Y + 4, 14, 5);
            ctx.fillStyle = '#7e7a88'; ctx.fillRect(X + 12, Y + 2, 8, 3);
            // Lit faces on the north-west, shadow to the south-east.
            ctx.fillStyle = '#8a8694'; ctx.fillRect(X + 9, Y + 4, 4, 2); ctx.fillRect(X + 4, Y + 8, 5, 2); ctx.fillRect(X + 1, Y + 14, 6, 2);
            ctx.fillStyle = '#34303a'; ctx.fillRect(X + 24, Y + 12, 4, 3); ctx.fillRect(X + 27, Y + 20, 4, 8);
            // Scattered boulders at the foot.
            ctx.fillStyle = '#5e5a64'; ctx.fillRect(X + 1, Y + 26, 5, 4); ctx.fillRect(X + 26, Y + 27, 5, 3);
            // The arch and the dark under it.
            ctx.fillStyle = '#2a262e'; ctx.fillRect(X + 9, Y + 15, 14, 13);
            ctx.fillStyle = '#0a0a10'; ctx.fillRect(X + 11, Y + 17, 10, 11); ctx.fillRect(X + 12, Y + 15, 8, 2);
            // Steps going down, catching what light there is.
            ctx.fillStyle = '#3e3a44'; ctx.fillRect(X + 12, Y + 24, 8, 2); ctx.fillRect(X + 13, Y + 21, 6, 1);
            // The glow from below, breathing.
            const glow = Math.sin(this.time * 2.4 + x) * 0.3 + 0.5;
            ctx.fillStyle = 'rgba(120,80,220,' + (0.18 + glow * 0.22).toFixed(3) + ')';
            ctx.fillRect(X + 12, Y + 19, 8, 8);
            ctx.fillStyle = 'rgba(200,160,255,' + (0.10 + glow * 0.15).toFixed(3) + ')';
            ctx.fillRect(X + 14, Y + 22, 4, 3);
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

    // Points of interest: discovered ones are drawn as landmarks. Under each
    // is a soft wash on the ground in the kind's own colour, in three steps
    // so it has no hard edge — kept from the old glyph markers because it is
    // how a magical place tells itself apart from a mundane one from across
    // the map — and on top of that the landmark itself, in pixels.
    for (const poi of pois) {
      if (!poi.discovered) continue;
      const sx = poi.tile.x * TILE_SIZE - camera.x;
      const sy = poi.tile.y * TILE_SIZE - camera.y;
      if (sx < -40 || sy < -40 || sx > GAME_WIDTH + 40 || sy > GAME_HEIGHT + 40) continue;
      const X = Math.floor(sx), Y = Math.floor(sy);
      const glow = Math.sin(this.time * 2 + poi.tile.x * 0.5) * 0.3 + 0.7;
      const color = poi.kind === 'dragon_lair' ? 'rgba(255,80,20,' : poi.kind === 'crystal_cave' ? 'rgba(100,200,255,' : poi.kind === 'enchanted_grove' ? 'rgba(100,255,150,' : poi.kind === 'wizard_tower' ? 'rgba(180,120,255,' : poi.kind === 'haunted_forest' ? 'rgba(120,255,180,' : poi.kind === 'mineral_spring' ? 'rgba(80,200,255,' : poi.kind === 'moon_forge' ? 'rgba(190,150,255,' : 'rgba(255,215,0,';
      ctx.fillStyle = color + (glow * 0.05).toFixed(3) + ')';
      ctx.fillRect(X - 2, Y - 2, 36, 36);
      ctx.fillRect(X + 3, Y + 3, 26, 26);
      ctx.fillRect(X + 8, Y + 8, 16, 16);
      this.drawLandmark(ctx, poi.kind, X, Y, poi.tile.x, poi.tile.y);
      // Name label if close, above whatever the landmark raises.
      if (sx > -10 && sx < GAME_WIDTH + 10) {
        ctx.fillStyle = '#fff';
        ctx.font = '9px monospace';
        ctx.fillText(poi.name, X + 2, Y - 4 - (MapRenderer.LANDMARK_RISE[poi.kind] ?? 0));
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
      const leader = party[0];
      const sprite = this.sprites.getMonsterSprite(monster, !!leader && leader.tile.x > monster.tile.x);
      ctx.putImageData(sprite, Math.floor(sx), Math.floor(sy));
      this.drawHpBar(ctx, sx, sy - 4, TILE_SIZE - 4, monster.hp, monster.maxHp, '#c33');
      ctx.fillStyle = '#faa';
      ctx.font = '8px monospace';
      ctx.fillText(monster.template.name, Math.floor(sx - 2), Math.floor(sy - 6));
    }

    this.drawCorpses(ctx, camera);

    // Breadcrumb trail of the party's recent steps, then the party on top.
    this.drawBreadcrumbTrail(ctx, camera, trail);

    // The party
    this.drawPartyMembers(ctx, camera, party, dt, moveMs);

    // Damage and healing from a roadside ambush, over the creature it hit.
    this.drawBolts(ctx, camera);
    this.drawEffects(ctx, camera);
    this.drawFloaters(ctx, camera);

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
        faceLeft: false,
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
      // Face the way the step is going, re-read every frame so a retarget
      // mid-step turns the sprite too.
      if (Math.abs(targetX - v.x) > 0.5) v.faceLeft = targetX < v.x;
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

import { TILE_SIZE } from '../engine/types';
import { GameCharacter } from './Character';
import { Monster } from './Monster';
import { TileMap, TileType } from '../world/TileMap';

/**
 * Programmatic sprite drawing — D&D Monster Manual / Player's Handbook inspired.
 * Uses canvas 2D to draw pixel-art-style sprites with vivid colors.
 */

const ENTITY_SIZE = TILE_SIZE - 4;

/**
 * The drawings below are written in fractions of the 28 px box — `s * 0.06` is
 * 1.68 px — and canvas happily antialiases a rect onto fractional pixel
 * boundaries. Every edge in the set was therefore a smear of half-alpha pixels
 * a third of a pixel wide, which is what made the art look soft and muddy
 * rather than like pixel art, and which the silhouette and rim passes below
 * cannot make sense of.
 *
 * Rather than rewrite seven thousand `fillRect` calls, the drawing functions
 * are handed a context that snaps every rect to the pixel grid. A rect that
 * rounds away to nothing keeps a single pixel: the author asked for a line
 * there and a thin line is the intent. Paths (a couple of dozen wings and
 * fins) are left alone — those curves want their antialiasing.
 */
function pixelSnapped(ctx: CanvasRenderingContext2D): CanvasRenderingContext2D {
  const fillRect = (x: number, y: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    ctx.fillRect(x0, y0, Math.max(1, Math.round(x + w) - x0), Math.max(1, Math.round(y + h) - y0));
  };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'fillRect') return fillRect;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

/** The same pixels, right to left. */
function mirrorImageData(ctx: CanvasRenderingContext2D, src: ImageData): ImageData {
  const { width: w, height: h } = src;
  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = (y * w + x) * 4;
      const to = (y * w + (w - 1 - x)) * 4;
      out.data[to] = src.data[from];
      out.data[to + 1] = src.data[from + 1];
      out.data[to + 2] = src.data[from + 2];
      out.data[to + 3] = src.data[from + 3];
    }
  }
  return out;
}

export class SpriteRenderer {
  private charCanvas: HTMLCanvasElement;
  private charCtx: CanvasRenderingContext2D;
  private monsterCanvas: HTMLCanvasElement;
  private monsterCtx: CanvasRenderingContext2D;

  // Cache sprites by class id and monster id
  private cache: Map<string, ImageData> = new Map();

  constructor() {
    this.charCanvas = document.createElement('canvas');
    this.charCanvas.width = ENTITY_SIZE;
    this.charCanvas.height = ENTITY_SIZE;
    this.charCtx = this.charCanvas.getContext('2d', { willReadFrequently: true })!;

    this.monsterCanvas = document.createElement('canvas');
    this.monsterCanvas.width = ENTITY_SIZE;
    this.monsterCanvas.height = ENTITY_SIZE;
    this.monsterCtx = this.monsterCanvas.getContext('2d', { willReadFrequently: true })!;
  }

  /**
   * A character's sprite, mirrored when asked so a party walking left leads
   * with the held hand. The mirror is cached beside the original; the
   * sprites face the viewer, so a flip changes only which side the weapon is on.
   */
  getCharSprite(character: GameCharacter, mirrored = false): ImageData {
    if (mirrored) {
      const mkey = `${character.charClass.id}\u0000mirror`;
      const hit = this.cache.get(mkey);
      if (hit) return hit;
      const flipped = mirrorImageData(this.charCtx, this.getCharSprite(character));
      this.cache.set(mkey, flipped);
      return flipped;
    }
    const key = character.charClass.id;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const ctx = this.charCtx;
    ctx.clearRect(0, 0, ENTITY_SIZE, ENTITY_SIZE);
    ctx.imageSmoothingEnabled = false;

    this.drawCharacter(pixelSnapped(ctx), character.charClass.id);
    this.applySpriteEffects(ctx, ENTITY_SIZE);

    const data = ctx.getImageData(0, 0, ENTITY_SIZE, ENTITY_SIZE);
    this.cache.set(key, data);
    return data;
  }

  /**
   * A monster's sprite, mirrored when asked so it faces the party. Side-view
   * monsters are drawn facing left; the mirror is cached beside the original
   * under its own key, flash and all.
   */
  getMonsterSprite(monster: Monster, mirrored = false): ImageData {
    if (mirrored) {
      const flash = monster.flashTimer > 0;
      const mkey = `${monster.template.id}\u0000${flash ? 'hit' : ''}\u0000mirror`;
      const hit = this.cache.get(mkey);
      if (hit) return hit;
      const flipped = mirrorImageData(this.monsterCtx, this.getMonsterSprite(monster));
      this.cache.set(mkey, flipped);
      return flipped;
    }
    // The struck monster is drawn white, so the flash has to be part of the
    // key. Keyed on the template alone, the first goblin ever drawn decided
    // for every goblin after it: the hit flash the combat code has always set
    // either never appeared, or — if that first draw happened to catch one
    // mid-flash — never went away.
    const flash = monster.flashTimer > 0;
    const key = flash ? `${monster.template.id}\u0000hit` : monster.template.id;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const ctx = this.monsterCtx;
    ctx.clearRect(0, 0, ENTITY_SIZE, ENTITY_SIZE);
    ctx.imageSmoothingEnabled = false;

    this.drawMonster(pixelSnapped(ctx), monster.template.id, flash);
    this.applySpriteEffects(ctx, ENTITY_SIZE);

    const data = ctx.getImageData(0, 0, ENTITY_SIZE, ENTITY_SIZE);
    this.cache.set(key, data);
    return data;
  }

  /**
   * Return the sprite for an entity as a data-URL (for <img> display in UI
   * panels like the battle window). Accepts either a GameCharacter or Monster.
   */
  getSpriteCanvas(entity: GameCharacter | Monster): string {
    const data = (entity as Monster).template
      ? this.getMonsterSprite(entity as Monster)
      : this.getCharSprite(entity as GameCharacter);
    const c = document.createElement('canvas');
    c.width = ENTITY_SIZE;
    c.height = ENTITY_SIZE;
    const ctx = c.getContext('2d');
    if (ctx) ctx.putImageData(data, 0, 0);
    try {
      return c.toDataURL();
    } catch {
      return '';
    }
  }

  /** A pixel counts as part of the silhouette from this alpha up. */
  private static readonly SOLID = 96;

  /**
   * Shared finishing pass: form shading, a rim outline drawn *outside* the
   * silhouette, and a drop shadow. Everything here keys off the silhouette
   * that was actually drawn rather than the ENTITY_SIZE box, because the box
   * is identical for a rat and a dragon and lighting a rat as if it were
   * dragon-tall is what made the small sprites read flat.
   *
   * Order matters: shade the art, then grow the rim into the transparent
   * pixels around it, then cast the shadow from the grown shape. The rim is
   * clipped at the canvas edge — art that runs to the border simply gets no
   * rim on that side, which is preferable to reserving a margin the existing
   * drawings do not leave.
   */
  private applySpriteEffects(ctx: CanvasRenderingContext2D, size: number) {
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    const n = size * size;
    const SOLID = SpriteRenderer.SOLID;

    // 1) Silhouette mask.
    const solid = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      if (d[i * 4 + 3] >= SOLID) {
        solid[i] = 1;
        any = true;
      }
    }
    if (!any) {
      ctx.putImageData(img, 0, 0);
      return;
    }

    // 2) Per-column top and bottom of the silhouette. Smoothed over a few
    //    columns so one raised weapon does not carve a bright stripe beside
    //    the head it is held next to.
    const top = new Int16Array(size).fill(-1);
    const bot = new Int16Array(size).fill(-1);
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (solid[y * size + x]) { top[x] = y; break; }
      }
      for (let y = size - 1; y >= 0; y--) {
        if (solid[y * size + x]) { bot[x] = y; break; }
      }
    }
    const topS = new Float32Array(size);
    const botS = new Float32Array(size);
    for (let x = 0; x < size; x++) {
      let ts = 0, bs = 0, k = 0;
      for (let o = -2; o <= 2; o++) {
        const c = x + o;
        if (c < 0 || c >= size || top[c] < 0) continue;
        ts += top[c];
        bs += bot[c];
        k++;
      }
      topS[x] = k ? ts / k : 0;
      botS[x] = k ? bs / k : size - 1;
    }

    // 3) Shade the art. Two terms: a soft vertical gradient down each column's
    //    own extent, and a hard facet light on pixels that face open air —
    //    lit where the sky is above them, shaded where the ground is below.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = y * size + x;
        if (!solid[p]) continue;
        const i = p * 4;
        const span = Math.max(1, botS[x] - topS[x]);
        const t = Math.min(1, Math.max(0, (y - topS[x]) / span));

        let amt = 0;
        if (t < 0.34) amt += ((0.34 - t) / 0.34) * 22;
        else if (t > 0.62) amt -= ((t - 0.62) / 0.38) * 26;

        // Facet light: the top surface of every form catches the light and
        // its underside falls away. This is what gives the flat rectangles
        // some thickness instead of reading as coloured paper.
        const up = y > 0 ? solid[p - size] : 0;
        const down = y < size - 1 ? solid[p + size] : 0;
        if (!up) amt += 16;
        else if (!down) amt -= 14;

        const a = Math.round(amt);
        if (a === 0) continue;
        d[i] = Math.min(255, Math.max(0, d[i] + a));
        d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + a));
        d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + a));
      }
    }

    // 4) Rim outline, one pixel *outside* the silhouette. The old pass merely
    //    darkened the sprite's own edge by 30/255, which vanished against
    //    grass and dungeon floor alike; a real rim is what separates a sprite
    //    from busy terrain. Its colour is drawn down from the pixels it hugs,
    //    so it stays in the creature's own palette instead of stamping black
    //    around everything, and its alpha follows theirs so ghosts and oozes
    //    keep their translucency.
    const rim = new Uint8Array(n);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = y * size + x;
        // Only genuinely empty pixels take a rim: the faint half-alpha glows
        // some sprites paint around themselves are art, not background.
        if (solid[p] || d[p * 4 + 3] > 24) continue;
        let r = 0, g = 0, b = 0, a = 0, k = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const ny = y + oy;
          if (ny < 0 || ny >= size) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            if (nx < 0 || nx >= size || (ox === 0 && oy === 0)) continue;
            const q = ny * size + nx;
            if (!solid[q]) continue;
            const j = q * 4;
            r += d[j]; g += d[j + 1]; b += d[j + 2];
            a = Math.max(a, d[j + 3]);
            k++;
          }
        }
        if (!k) continue;
        rim[p] = 1;
        const i = p * 4;
        d[i] = Math.round((r / k) * 0.24);
        d[i + 1] = Math.round((g / k) * 0.24);
        d[i + 2] = Math.round((b / k) * 0.27) + 6;
        d[i + 3] = Math.round(a * 0.88);
      }
    }

    // 5) Drop shadow from the grown shape, two pixels down-right, laid only
    //    into pixels still untouched so it never eats the rim.
    const src = new Uint8Array(n);
    for (let i = 0; i < n; i++) src[i] = solid[i] || rim[i] ? d[i * 4 + 3] : 0;
    for (let y = size - 1; y >= 0; y--) {
      for (let x = size - 1; x >= 0; x--) {
        const p = y * size + x;
        if (d[p * 4 + 3] > 0) continue;
        if (y < 2 || x < 2) continue;
        const sa = src[(y - 2) * size + (x - 2)];
        if (!sa) continue;
        const i = p * 4;
        d[i] = 4;
        d[i + 1] = 4;
        d[i + 2] = 8;
        d[i + 3] = Math.round(sa * 0.38);
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  /**
   * A painter on the 28-unit grid the sprite box actually is, so the party
   * drawings below can be written in whole pixels instead of fractions that
   * land between them. `r('#888', 8, 12, 12, 10)` is a torso.
   */
  private grid(ctx: CanvasRenderingContext2D, s: number) {
    const u = s / 28;
    return (color: string, x: number, y: number, w: number, h: number) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * u, y * u, w * u, h * u);
    };
  }

  /**
   * The party shares one anatomy so the six of them read as a company rather
   * than as six unrelated blobs: head 8 wide at y4, shoulders at y12, arms
   * outside the torso, legs from y21. Eyes are the point — until they had
   * them every class was a coloured box with a skin-coloured box on top, and
   * the party is the one thing always on screen and always in the battle
   * window at more than twice this size.
   */
  private heroHead(
    ctx: CanvasRenderingContext2D,
    s: number,
    skin: string,
    shade: string,
    eye: string = '#20242c'
  ) {
    const r = this.grid(ctx, s);
    r(skin, 9, 4, 10, 8);
    r(shade, 9, 10, 10, 2); // jaw in shadow
    r(shade, 9, 4, 1, 8); // left cheek turned from the light
    r(shade, 11, 6, 2, 1); // brows
    r(shade, 15, 6, 2, 1);
    // Whites behind the pupils: two dark dots alone read as holes at 28 px,
    // and this is the sprite that shows at 64 px in the battle window.
    r('#efe9dc', 11, 7, 2, 2);
    r('#efe9dc', 15, 7, 2, 2);
    r(eye, 12, 7, 1, 2);
    r(eye, 15, 7, 1, 2);
    r(shade, 13, 8, 2, 1); // nose
  }

  private drawCharacter(ctx: CanvasRenderingContext2D, classId: string) {
    const s = ENTITY_SIZE;
    const cs = 2; // pixel scale

    switch (classId) {
      case 'fighter':
        this.drawFighter(ctx, s, cs);
        break;
      case 'wizard':
        this.drawWizard(ctx, s, cs);
        break;
      case 'cleric':
        this.drawCleric(ctx, s, cs);
        break;
      case 'rogue':
        this.drawRogue(ctx, s, cs);
        break;
      case 'ranger':
        this.drawRanger(ctx, s, cs);
        break;
      case 'paladin':
        this.drawPaladin(ctx, s, cs);
        break;
      case 'barbarian':
        this.drawBarbarian(ctx, s, cs);
        break;
      case 'druid':
        this.drawDruid(ctx, s, cs);
        break;
      case 'bard':
        this.drawBard(ctx, s, cs);
        break;
      case 'sorcerer':
        this.drawSorcerer(ctx, s, cs);
        break;
      case 'warlock':
        this.drawWarlock(ctx, s, cs);
        break;
      case 'monk':
        this.drawMonk(ctx, s, cs);
        break;
      default:
        this.drawFighter(ctx, s, cs);
    }
  }

  // Each class gets a unique visual: body shape, colors, weapon, hat/helm.
  // All eight share the anatomy in `heroHead` so the party reads as a company.

  private drawFighter(ctx: CanvasRenderingContext2D, s: number, cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#c8a882';
    // Legs and boots
    r('#4a4034', 9, 21, 4, 5);
    r('#4a4034', 15, 21, 4, 5);
    r('#2b2620', 8, 25, 6, 3);
    r('#2b2620', 14, 25, 6, 3);
    // Mail skirt and hauberk
    r('#7b8190', 8, 19, 12, 3);
    r('#8d94a2', 8, 12, 12, 7);
    r('#787f8c', 8, 14, 12, 1);
    r('#787f8c', 8, 17, 12, 1);
    // Belt
    r('#54402a', 8, 18, 12, 2);
    r('#c9a94c', 13, 18, 3, 2);
    // Arms and hands
    r('#7b8190', 5, 13, 3, 6);
    r('#7b8190', 20, 13, 3, 6);
    r(skin, 5, 19, 3, 2);
    r(skin, 20, 19, 3, 2);
    // Head under an open helm — the eyes are what make him a person
    this.heroHead(ctx, s, skin, '#9e8058');
    r('#6b7280', 8, 2, 12, 4);
    r('#89909e', 8, 2, 12, 1);
    r('#6b7280', 8, 6, 1, 5);
    r('#6b7280', 19, 6, 1, 5);
    r('#6b7280', 13, 5, 2, 4);
    r('#89909e', 13, 5, 1, 4);
    // Kite shield
    r('#33417d', 2, 12, 5, 9);
    r('#4a5a9c', 2, 12, 5, 1);
    r('#222c54', 2, 20, 5, 1);
    r('#c9a94c', 4, 15, 1, 4);
    r('#c9a94c', 3, 16, 3, 1);
    // Longsword
    r('#d9dee6', 23, 6, 2, 12);
    r('#f2f5fa', 23, 6, 1, 12);
    r('#c9a94c', 21, 18, 6, 1);
    r('#4a3722', 23, 19, 2, 4);
  }

  private drawWizard(ctx: CanvasRenderingContext2D, s: number, cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#c8a882';
    // Robe, flaring to a hem rather than ending in a straight box
    r('#3b4a8e', 9, 12, 10, 8);
    r('#33427e', 8, 20, 12, 6);
    r('#2a3668', 7, 25, 14, 3);
    r('#4c5da5', 12, 13, 2, 12);
    r('#c9a94c', 9, 18, 10, 1);
    // Sleeves
    r('#33427e', 5, 13, 4, 7);
    r('#33427e', 19, 13, 4, 6);
    r(skin, 5, 19, 3, 2);
    // Head, then a beard over the jaw
    this.heroHead(ctx, s, skin, '#9e8058');
    r('#dcd6c8', 11, 10, 6, 1);
    r('#dcd6c8', 10, 11, 8, 4);
    r('#eee8da', 12, 11, 2, 3);
    // Pointed hat
    r('#2b3a72', 5, 4, 18, 2);
    r('#33427e', 10, 2, 8, 2);
    r('#3d4d92', 12, 1, 4, 1);
    r('#e6c84a', 6, 4, 2, 2);
    // Staff with a crystal
    r('#7a5a30', 23, 4, 2, 22);
    r('#8f6c3c', 23, 4, 1, 22);
    r('#3fb6dc', 22, 1, 4, 3);
    r('#bff0ff', 23, 1, 2, 1);
  }

  private drawCleric(ctx: CanvasRenderingContext2D, s: number, cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#d4b896';
    // Vestments. The old cleric was a single white slab; the gold orphrey and
    // the shaded fold are what keep the white from flattening out.
    r('#e6e2d6', 9, 12, 10, 9);
    r('#dcd7c8', 8, 20, 12, 6);
    r('#cfc9b6', 7, 25, 14, 3);
    r('#c6c1ae', 16, 13, 3, 13);
    r('#c9a94c', 13, 12, 2, 14);
    r('#c9a94c', 8, 23, 12, 1);
    // Sleeves
    r('#dcd7c8', 5, 13, 4, 7);
    r('#dcd7c8', 19, 13, 4, 6);
    r(skin, 5, 19, 3, 2);
    r(skin, 20, 19, 3, 2);
    // Head under a coif
    this.heroHead(ctx, s, skin, '#a98a68');
    r('#e6e2d6', 8, 3, 12, 3);
    r('#f2efe6', 8, 3, 12, 1);
    r('#c9a94c', 8, 6, 12, 1);
    r('#e6e2d6', 8, 7, 1, 5);
    r('#e6e2d6', 19, 7, 1, 5);
    // Holy symbol
    r('#e6c84a', 13, 15, 2, 5);
    r('#e6c84a', 11, 16, 6, 2);
    r('#fff0b0', 13, 15, 1, 5);
    // Mace
    r('#4a4438', 23, 13, 2, 9);
    r('#9aa0aa', 21, 8, 6, 5);
    r('#c2c8d2', 21, 8, 6, 1);
    r('#7a808a', 23, 9, 2, 3);
  }

  private drawRogue(ctx: CanvasRenderingContext2D, s: number, cs: number) {
    const r = this.grid(ctx, s);
    // The old rogue drew a cloak last, over the whole figure, and came out a
    // featureless black slab. Cloak first, then the figure on top of it.
    r('#232a3c', 5, 10, 18, 15);
    r('#1b2131', 5, 22, 18, 3);
    // Legs and boots
    r('#2c2f38', 9, 21, 4, 5);
    r('#2c2f38', 15, 21, 4, 5);
    r('#191b21', 8, 25, 6, 3);
    r('#191b21', 14, 25, 6, 3);
    // Studded leather
    r('#3b4150', 9, 12, 10, 9);
    r('#4a5163', 9, 12, 10, 1);
    r('#2f3542', 9, 15, 10, 1);
    r('#2f3542', 9, 18, 10, 2);
    r('#8a6a3a', 12, 18, 4, 2);
    // Arms
    r('#333944', 6, 13, 3, 7);
    r('#333944', 19, 13, 3, 7);
    // Deep hood: no face, two glints and a mask line
    r('#2b3346', 9, 3, 10, 9);
    r('#374057', 9, 3, 10, 1);
    r('#181218', 11, 6, 6, 4);
    r('#c8b070', 11, 7, 2, 2);
    r('#c8b070', 15, 7, 2, 2);
    r('#5c5548', 11, 9, 6, 1);
    // Paired daggers, held clear of the cloak so they read
    r('#c8cdd6', 3, 14, 2, 6);
    r('#eef2f8', 3, 14, 1, 6);
    r('#3a2a1a', 3, 20, 2, 3);
    r('#c8cdd6', 23, 14, 2, 6);
    r('#eef2f8', 23, 14, 1, 6);
    r('#3a2a1a', 23, 20, 2, 3);
  }

  private drawRanger(ctx: CanvasRenderingContext2D, s: number, cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#c8a882';
    // Legs and boots
    r('#3d4a33', 9, 21, 4, 5);
    r('#3d4a33', 15, 21, 4, 5);
    r('#2a3323', 8, 25, 6, 3);
    r('#2a3323', 14, 25, 6, 3);
    // Tunic, baldric, belt
    r('#4a6b3c', 9, 12, 10, 9);
    r('#5a7f49', 9, 12, 10, 1);
    r('#6b4a2a', 10, 12, 2, 7);
    r('#6b4a2a', 9, 18, 10, 2);
    // Shoulder cloak
    r('#3a5230', 7, 11, 14, 4);
    r('#48633c', 7, 11, 14, 1);
    // Arms and hands
    r('#40593a', 6, 14, 3, 6);
    r('#40593a', 19, 14, 3, 6);
    r(skin, 6, 20, 3, 2);
    r(skin, 19, 20, 3, 2);
    // Head under a cowl
    this.heroHead(ctx, s, skin, '#9e8058');
    r('#33492b', 8, 3, 12, 4);
    r('#425c37', 8, 3, 12, 1);
    r('#33492b', 8, 7, 1, 5);
    r('#33492b', 19, 7, 1, 5);
    // Quiver over the shoulder
    r('#6b4a2a', 20, 8, 3, 7);
    r('#d8d0b8', 20, 5, 1, 4);
    r('#c04a3a', 20, 4, 1, 2);
    r('#d8d0b8', 22, 5, 1, 4);
    r('#c04a3a', 22, 4, 1, 2);
    // Bow, stepped into a curve instead of a straight stick
    r('#7a5630', 4, 6, 2, 3);
    r('#7a5630', 3, 9, 2, 9);
    r('#7a5630', 4, 18, 2, 3);
    r('#e8e0c8', 5, 6, 1, 15);
  }

  private drawPaladin(ctx: CanvasRenderingContext2D, s: number, cs: number) {
    const r = this.grid(ctx, s);
    // Greaves and sabatons
    r('#9aa2ae', 9, 21, 4, 5);
    r('#9aa2ae', 15, 21, 4, 5);
    r('#6f7682', 8, 25, 6, 3);
    r('#6f7682', 14, 25, 6, 3);
    // Plate cuirass
    r('#b7bec9', 8, 12, 12, 9);
    r('#d3dae4', 8, 12, 12, 1);
    r('#98a0ac', 8, 20, 12, 1);
    // Tabard with a sun sigil
    r('#2f4a9c', 12, 12, 4, 13);
    r('#3c5cba', 12, 12, 4, 1);
    r('#e6c84a', 13, 15, 2, 5);
    r('#e6c84a', 11, 16, 6, 2);
    // Pauldrons and vambraces
    r('#cfd6e0', 5, 11, 4, 3);
    r('#cfd6e0', 19, 11, 4, 3);
    r('#a7aeb9', 5, 14, 3, 6);
    r('#a7aeb9', 20, 14, 3, 6);
    // Great helm, closed. No face: the visor glow is the paladin's tell, and
    // it is what tells him apart from the fighter at a glance.
    r('#b7bec9', 9, 2, 10, 10);
    r('#d4dbe5', 9, 2, 10, 1);
    r('#3a4048', 10, 7, 8, 2);
    r('#7fd8ff', 11, 7, 2, 1);
    r('#7fd8ff', 15, 7, 2, 1);
    r('#98a0ac', 10, 10, 8, 1);
    r('#e6c84a', 13, 0, 2, 3);
    // Longsword
    r('#e8edf4', 23, 5, 2, 13);
    r('#f7fbff', 23, 5, 1, 13);
    r('#e6c84a', 21, 18, 6, 1);
    r('#4a3722', 23, 19, 2, 4);
  }

  private drawBarbarian(ctx: CanvasRenderingContext2D, s: number, cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#c8a070';
    // Legs and fur boots
    r(skin, 9, 21, 4, 4);
    r(skin, 15, 21, 4, 4);
    r('#5a4430', 8, 24, 6, 4);
    r('#5a4430', 14, 24, 6, 4);
    // Fur kilt
    r('#8a6a45', 8, 18, 12, 4);
    r('#a0805a', 8, 18, 12, 1);
    // Bare chest, broader at the shoulder than any other class
    r(skin, 7, 12, 14, 6);
    r('#dbb684', 7, 12, 14, 1);
    r('#a8825a', 13, 13, 2, 5);
    r('#a8825a', 7, 16, 14, 1);
    // Arms
    r(skin, 4, 13, 3, 7);
    r(skin, 21, 13, 3, 7);
    // Head, wild hair and beard
    this.heroHead(ctx, s, skin, '#9c7448');
    r('#a03a1a', 9, 2, 10, 4);
    r('#c04a22', 9, 2, 10, 1);
    r('#a03a1a', 8, 5, 2, 7);
    r('#a03a1a', 18, 5, 2, 7);
    r('#a03a1a', 11, 10, 6, 4);
    r('#8a2e14', 12, 12, 4, 2);
    r('#b03020', 10, 6, 8, 1);
    // Greataxe
    r('#6a4a2a', 24, 6, 2, 19);
    r('#aab2be', 20, 3, 6, 6);
    r('#cdd4de', 20, 3, 6, 1);
    r('#8a919c', 22, 4, 2, 4);
  }

  private drawDruid(ctx: CanvasRenderingContext2D, s: number, cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#c8a882';
    // Robe
    r('#6a4a2c', 9, 12, 10, 8);
    r('#5c3f24', 8, 19, 12, 7);
    r('#4a3220', 7, 25, 14, 3);
    // Mantle of leaves
    r('#3f6b34', 7, 11, 14, 4);
    r('#4f8340', 7, 11, 14, 1);
    r('#3f6b34', 12, 15, 3, 3);
    // Sleeves
    r('#5c3f24', 5, 14, 4, 6);
    r('#5c3f24', 19, 14, 4, 6);
    r(skin, 5, 19, 3, 2);
    // Head, grey beard
    this.heroHead(ctx, s, skin, '#9e8058');
    r('#cfc6b2', 10, 11, 8, 4);
    r('#cfc6b2', 11, 14, 6, 1);
    r('#e2dccb', 12, 11, 2, 3);
    // Antlers
    r('#9c7a50', 9, 2, 2, 4);
    r('#9c7a50', 6, 3, 3, 1);
    r('#9c7a50', 6, 1, 1, 3);
    r('#9c7a50', 17, 2, 2, 4);
    r('#9c7a50', 19, 3, 3, 1);
    r('#9c7a50', 21, 1, 1, 3);
    // Quarterstaff with a living sprout
    r('#7a5a34', 24, 5, 2, 21);
    r('#8d6b3e', 24, 5, 1, 21);
    r('#3f8a35', 23, 2, 4, 3);
    r('#5fb04a', 24, 2, 2, 1);
  }

  // ── Monster sprites ──────────────────────────────

  private drawMonster(ctx: CanvasRenderingContext2D, monsterId: string, flash: boolean) {
    const s = ENTITY_SIZE;
    const baseColor = flash ? '#fff' : undefined;

    switch (monsterId) {
      case 'goblin': this.drawGoblin(ctx, s, baseColor); break;
      case 'skeleton': this.drawSkeleton(ctx, s, baseColor); break;
      case 'giant_rat': this.drawGiantRat(ctx, s, baseColor); break;
      case 'orc': this.drawOrc(ctx, s, baseColor); break;
      case 'bandit': this.drawBandit(ctx, s, baseColor, 'bandit'); break;
      case 'highwayman': this.drawBandit(ctx, s, baseColor, 'highwayman'); break;
      case 'bandit_captain': this.drawBandit(ctx, s, baseColor, 'captain'); break;
      case 'ghoul': this.drawGhoul(ctx, s, baseColor); break;
      case 'owlbear': this.drawOwlbear(ctx, s, baseColor); break;
      case 'gelatinous_cube': this.drawCube(ctx, s, baseColor); break;
      case 'mind_flayer': this.drawMindFlayer(ctx, s, baseColor); break;
      case 'young_dragon': this.drawDragon(ctx, s, baseColor); break;
      case 'beholder': this.drawBeholder(ctx, s, baseColor); break;
      case 'kobold': this.drawKobold(ctx, s, baseColor); break;
      case 'zombie': this.drawZombie(ctx, s, baseColor); break;
      case 'gnoll': this.drawGnoll(ctx, s, baseColor); break;
      case 'giant_spider': this.drawGiantSpider(ctx, s, baseColor); break;
      case 'dire_wolf': this.drawDireWolf(ctx, s, baseColor); break;
      case 'drow_elite': this.drawDrow(ctx, s, baseColor, 'elite'); break;
      case 'will_o_wisp_monster': this.drawWisp(ctx, s, baseColor); break;
      case 'ogre': this.drawOgre(ctx, s, baseColor); break;
      case 'manticore': this.drawManticore(ctx, s, baseColor); break;
      case 'wight': this.drawWight(ctx, s, baseColor); break;
      case 'werewolf': this.drawLycanthrope(ctx, s, baseColor, 'wolf'); break;
      case 'minotaur': this.drawMinotaur(ctx, s, baseColor); break;
      case 'banshee': this.drawBanshee(ctx, s, baseColor); break;
      case 'ettin': this.drawEttin(ctx, s, baseColor); break;
      case 'hill_giant_monster': this.drawHillGiant(ctx, s, baseColor); break;
      case 'troll': this.drawTroll(ctx, s, baseColor); break;
      case 'young_white_dragon_monster': this.drawYoungWhiteDragon(ctx, s, baseColor); break;
      case 'chimera_monster': this.drawChimera(ctx, s, baseColor); break;
      case 'medusa_monster': this.drawMedusa(ctx, s, baseColor); break;
      case 'vrock_monster': this.drawVrock(ctx, s, baseColor); break;
      case 'oni_monster': this.drawOni(ctx, s, baseColor); break;
      case 'stone_giant_monster': this.drawStoneGiant(ctx, s, baseColor); break;
      case 'black_pudding_monster': this.drawBlackPudding(ctx, s, baseColor); break;
      case 'frost_giant_monster': this.drawFrostGiant(ctx, s, baseColor); break;
      case 'bone_devil_monster': this.drawBoneDevil(ctx, s, baseColor); break;
      case 'fire_giant_monster': this.drawFireGiant(ctx, s, baseColor); break;
      case 'horned_devil_monster': this.drawHornedDevil(ctx, s, baseColor); break;
      case 'erinyes_monster': this.drawErinyes(ctx, s, baseColor); break;
      case 'storm_giant_monster': this.drawStormGiant(ctx, s, baseColor); break;
      case 'rakshasa_monster': this.drawRakshasa(ctx, s, baseColor); break;
      case 'marilith_monster': this.drawMarilith(ctx, s, baseColor); break;
      case 'adult_red_dragon_monster': this.drawAdultRedDragon(ctx, s, baseColor); break;
      case 'balor_monster': this.drawBalor(ctx, s, baseColor); break;
      case 'duergar': this.drawDuergar(ctx, s, baseColor); break;
      case 'rust_monster': this.drawRustMonster(ctx, s, baseColor); break;
      case 'stone_golem': this.drawStoneGolem(ctx, s, baseColor); break;
      case 'shadow': this.drawShadow(ctx, s, baseColor); break;
      case 'wraith': this.drawWraith(ctx, s, baseColor); break;
      case 'giant_bat': this.drawGiantBat(ctx, s, baseColor); break;
      case 'dretch': this.drawDretch(ctx, s, baseColor); break;
      case 'kenku': this.drawKenku(ctx, s, baseColor); break;
      case 'pixie': this.drawPixie(ctx, s, baseColor); break;
      case 'sprite': this.drawSprite(ctx, s, baseColor); break;
      case 'lizardfolk': this.drawLizardfolk(ctx, s, baseColor); break;
      case 'satyr': this.drawSatyr(ctx, s, baseColor); break;
      case 'troglodyte': this.drawTroglodyte(ctx, s, baseColor); break;
      case 'hobgoblin': this.drawHobgoblin(ctx, s, baseColor); break;
      case 'myconid': this.drawMyconid(ctx, s, baseColor); break;
      case 'dryad': this.drawDryad(ctx, s, baseColor); break;
      case 'imp': this.drawImp(ctx, s, baseColor); break;
      case 'quasit': this.drawQuasit(ctx, s, baseColor); break;
      case 'harpy': this.drawHarpy(ctx, s, baseColor); break;
      case 'hippogriff': this.drawHippogriff(ctx, s, baseColor); break;
      case 'bugbear': this.drawBugbear(ctx, s, baseColor); break;
      case 'wererat': this.drawLycanthrope(ctx, s, baseColor, 'rat'); break;
      case 'ankheg': this.drawAnkheg(ctx, s, baseColor); break;
      case 'ghast': this.drawGhast(ctx, s, baseColor); break;
      case 'gargoyle': this.drawGargoyle(ctx, s, baseColor); break;
      case 'griffon': this.drawGriffon(ctx, s, baseColor); break;
      case 'carrion_crawler': this.drawCarrionCrawler(ctx, s, baseColor); break;
      case 'pegasus': this.drawPegasus(ctx, s, baseColor); break;
      case 'centaur': this.drawCentaur(ctx, s, baseColor); break;
      case 'sea_hag': this.drawSeaHag(ctx, s, baseColor); break;
      case 'ochre_jelly': this.drawOchreJelly(ctx, s, baseColor); break;
      case 'phase_spider': this.drawPhaseSpider(ctx, s, baseColor); break;
      case 'hell_hound': this.drawHellHound(ctx, s, baseColor); break;
      case 'displacer_beast': this.drawDisplacerBeast(ctx, s, baseColor); break;
      case 'basilisk': this.drawBasilisk(ctx, s, baseColor); break;
      case 'green_hag': this.drawGreenHag(ctx, s, baseColor); break;
      case 'doppelganger': this.drawDoppelganger(ctx, s, baseColor); break;
      case 'yeti': this.drawYeti(ctx, s, baseColor); break;
      case 'mummy': this.drawMummy(ctx, s, baseColor); break;
      case 'specter': this.drawSpecter(ctx, s, baseColor); break;
      case 'water_weird': this.drawWaterWeird(ctx, s, baseColor); break;
      case 'lamia': this.drawLamia(ctx, s, baseColor); break;
      case 'wereboar': this.drawLycanthrope(ctx, s, baseColor, 'boar'); break;
      case 'weretiger': this.drawLycanthrope(ctx, s, baseColor, 'tiger'); break;
      case 'couatl': this.drawCouatl(ctx, s, baseColor); break;
      case 'night_hag': this.drawNightHag(ctx, s, baseColor); break;
      case 'shambling_mound': this.drawShamblingMound(ctx, s, baseColor); break;
      case 'unicorn': this.drawUnicorn(ctx, s, baseColor); break;
      case 'flesh_golem': this.drawFleshGolem(ctx, s, baseColor); break;
      case 'xorn': this.drawXorn(ctx, s, baseColor); break;
      case 'salamander': this.drawSalamander(ctx, s, baseColor); break;
      case 'ghost': this.drawGhost(ctx, s, baseColor); break;
      case 'air_elemental': this.drawAirElemental(ctx, s, baseColor); break;
      case 'earth_elemental': this.drawEarthElemental(ctx, s, baseColor); break;
      case 'fire_elemental': this.drawFireElemental(ctx, s, baseColor); break;
      case 'water_elemental': this.drawWaterElemental(ctx, s, baseColor); break;
      case 'vampire_spawn': this.drawVampireSpawn(ctx, s, baseColor); break;
      case 'umber_hulk': this.drawUmberHulk(ctx, s, baseColor); break;
      case 'otyugh': this.drawOtyugh(ctx, s, baseColor); break;
      case 'gorgon': this.drawGorgon(ctx, s, baseColor); break;
      case 'bullette': this.drawBullette(ctx, s, baseColor); break;
      case 'wyvern': this.drawWyvern(ctx, s, baseColor); break;
      case 'drider': this.drawDrider(ctx, s, baseColor); break;
      case 'invisible_stalker': this.drawInvisibleStalker(ctx, s, baseColor); break;
      case 'hezrou': this.drawHezrou(ctx, s, baseColor); break;
      case 'glabrezu': this.drawGlabrezu(ctx, s, baseColor); break;
      case 'hydra': this.drawHydra(ctx, s, baseColor); break;
      case 'clay_golem': this.drawClayGolem(ctx, s, baseColor); break;
      case 'cloud_giant': this.drawCloudGiant(ctx, s, baseColor); break;
      case 'treant': this.drawTreant(ctx, s, baseColor); break;
      case 'guardian_naga': this.drawGuardianNaga(ctx, s, baseColor); break;
      case 'iron_golem': this.drawIronGolem(ctx, s, baseColor); break;
      case 'ice_devil': this.drawIceDevil(ctx, s, baseColor); break;
      case 'vampire': this.drawVampire(ctx, s, baseColor); break;
      case 'roc': this.drawRoc(ctx, s, baseColor); break;
      case 'remorhaz': this.drawRemorhaz(ctx, s, baseColor); break;
      case 'purple_worm': this.drawPurpleWorm(ctx, s, baseColor); break;
      case 'death_knight': this.drawDeathKnight(ctx, s, baseColor); break;
      case 'lich': this.drawLich(ctx, s, baseColor); break;
      case 'dragon_turtle': this.drawDragonTurtle(ctx, s, baseColor); break;
      case 'pit_fiend': this.drawPitFiend(ctx, s, baseColor); break;
      case 'mimic': this.drawMimic(ctx, s, baseColor); break;
      case 'cockatrice': this.drawCockatrice(ctx, s, baseColor); break;
      case 'worg': this.drawWorg(ctx, s, baseColor); break;
      case 'aarakocra': this.drawAarakocra(ctx, s, baseColor); break;
      case 'grick': this.drawGrick(ctx, s, baseColor); break;
      case 'djinni': this.drawDjinni(ctx, s, baseColor); break;
      case 'efreeti': this.drawEfreeti(ctx, s, baseColor); break;
      case 'scarecrow': this.drawScarecrow(ctx, s, baseColor); break;
      case 'death_dog': this.drawDeathDog(ctx, s, baseColor); break;
      case 'giant_goat': this.drawGiantGoat(ctx, s, baseColor); break;
      case 'thug': this.drawThug(ctx, s, baseColor); break;
      case 'swarm_of_bats': this.drawSwarmOfBats(ctx, s, baseColor); break;
      case 'merfolk': this.drawMerfolk(ctx, s, baseColor); break;
      case 'sahuagin': this.drawSahuagin(ctx, s, baseColor); break;
      case 'gibbering_mouther': this.drawGibberingMouther(ctx, s, baseColor); break;
      case 'flameskull': this.drawFlameskull(ctx, s, baseColor); break;
      case 'yuan_ti_malison': this.drawYuanTi(ctx, s, baseColor); break;
      case 'githyanki_warrior': this.drawGithyanki(ctx, s, baseColor); break;
      case 'fomorian': this.drawFomorian(ctx, s, baseColor); break;
      case 'blink_dog': this.drawBlinkDog(ctx, s, baseColor); break;
      case 'pseudodragon': this.drawPseudodragon(ctx, s, baseColor); break;
      case 'roper': this.drawRoper(ctx, s, baseColor); break;
      case 'red_slaad': this.drawRedSlaad(ctx, s, baseColor); break;
      case 'animated_armor': this.drawAnimatedArmor(ctx, s, baseColor); break;
      case 'needle_blight': this.drawNeedleBlight(ctx, s, baseColor); break;
      case 'twig_blight': this.drawTwigBlight(ctx, s, baseColor); break;
      case 'vine_blight': this.drawVineBlight(ctx, s, baseColor); break;
      case 'gas_spore': this.drawGasSpore(ctx, s, baseColor); break;
      case 'allosaurus': this.drawAllosaurus(ctx, s, baseColor); break;
      case 'warhorse': this.drawWarhorse(ctx, s, baseColor); break;
      case 'meenlock': this.drawMeenlock(ctx, s, baseColor); break;
      case 'redcap': this.drawRedcap(ctx, s, baseColor); break;
      case 'githzerai_monk': this.drawGithzerai(ctx, s, baseColor); break;
      case 'intellect_devourer': this.drawIntellectDevourer(ctx, s, baseColor); break;
      case 'nothic': this.drawNothic(ctx, s, baseColor); break;
      case 'shadow_demon': this.drawShadowDemon(ctx, s, baseColor); break;
      case 'swarm_of_wasps': this.drawSwarmOfWasps(ctx, s, baseColor); break;
      case 'lion': this.drawLion(ctx, s, baseColor); break;
      case 'tiger': this.drawTiger(ctx, s, baseColor); break;
      case 'giant_scorpion': this.drawGiantScorpion(ctx, s, baseColor); break;
      case 'ankylosaurus': this.drawAnkylosaurus(ctx, s, baseColor); break;
      case 'giant_crocodile': this.drawGiantCrocodile(ctx, s, baseColor); break;
      case 'priest': this.drawPriest(ctx, s, baseColor); break;
      case 'assassin': this.drawAssassin(ctx, s, baseColor); break;
      case 'drow_mage': this.drawDrow(ctx, s, baseColor, 'mage'); break;
      case 'grell': this.drawGrell(ctx, s, baseColor); break;
      case 'young_green_dragon': this.drawYoungGreenDragon(ctx, s, baseColor); break;
      case 'young_black_dragon': this.drawYoungBlackDragon(ctx, s, baseColor); break;
      case 'guard_drake': this.drawGuardDrake(ctx, s, baseColor); break;
      case 'magma_mephit': this.drawMagmaMephit(ctx, s, baseColor); break;
      case 'quickling': this.drawQuickling(ctx, s, baseColor); break;
      case 'nightmare': this.drawNightmare(ctx, s, baseColor); break;
      case 'spectator': this.drawSpectator(ctx, s, baseColor); break;
      case 'chuul': this.drawChuul(ctx, s, baseColor); break;
      case 'babau': this.drawBabau(ctx, s, baseColor); break;
      case 'cambion': this.drawCambion(ctx, s, baseColor); break;
      case 'cyclops': this.drawCyclops(ctx, s, baseColor); break;
      case 'slaad_blue': this.drawSlaadBlue(ctx, s, baseColor); break;
      case 'leucrotta': this.drawLeucrotta(ctx, s, baseColor); break;
      case 'giant_ape': this.drawGiantApe(ctx, s, baseColor); break;
      case 'ulitharid': this.drawUlitharid(ctx, s, baseColor); break;
      case 'death_tyrant': this.drawDeathTyrant(ctx, s, baseColor); break;
      case 'wild_boar': this.drawWildBoar(ctx, s, baseColor); break;
      case 'giant_wasp': this.drawGiantWasp(ctx, s, baseColor); break;
      case 'kuo_toa': this.drawKuoToa(ctx, s, baseColor); break;
      case 'saber_toothed_tiger': this.drawSaberToothedTiger(ctx, s, baseColor); break;
      case 'merrow': this.drawMerrow(ctx, s, baseColor); break;
      case 'drow_fighter': this.drawDrow(ctx, s, baseColor, 'fighter'); break;
      case 'mezzoloth': this.drawMezzoloth(ctx, s, baseColor); break;
      case 'annis_hag': this.drawAnnisHag(ctx, s, baseColor); break;
      case 'drow_priestess': this.drawDrow(ctx, s, baseColor, 'priestess'); break;
      case 'flind': this.drawFlind(ctx, s, baseColor); break;
      case 'nycaloth': this.drawNycaloth(ctx, s, baseColor); break;
      case 'slaad_void': this.drawSlaadVoid(ctx, s, baseColor); break;
      case 'adult_white_dragon': this.drawAdultWhiteDragon(ctx, s, baseColor); break;
      case 'adult_black_dragon': this.drawAdultBlackDragon(ctx, s, baseColor); break;
      case 'adult_green_dragon': this.drawAdultGreenDragon(ctx, s, baseColor); break;
      case 'adult_blue_dragon': this.drawAdultBlueDragon(ctx, s, baseColor); break;
      case 'slaad_tadpole': this.drawSlaadTadpole(ctx, s, baseColor); break;
      case 'giant_octopus': this.drawGiantOctopus(ctx, s, baseColor); break;
      case 'sword_wraith_warrior': this.drawSwordWraith(ctx, s, baseColor); break;
      case 'deathlock': this.drawDeathlock(ctx, s, baseColor); break;
      case 'bone_naga': this.drawBoneNaga(ctx, s, baseColor); break;
      case 'gauth': this.drawGauth(ctx, s, baseColor); break;
      case 'yuan_ti_abomination': this.drawYuanTiAbomination(ctx, s, baseColor); break;
      case 'bheur_hag': this.drawBheurHag(ctx, s, baseColor); break;
      case 'githyanki_knight': this.drawGithyankiKnight(ctx, s, baseColor); break;
      case 'frost_worm': this.drawFrostWorm(ctx, s, baseColor); break;
      case 'yuan_ti_anathema': this.drawYuanTiAnathema(ctx, s, baseColor); break;
      case 'goristro': this.drawGoristro(ctx, s, baseColor); break;
      case 'ancient_white_dragon': this.drawAncientWhiteDragon(ctx, s, baseColor); break;
      case 'ancient_black_dragon': this.drawAncientBlackDragon(ctx, s, baseColor); break;
      case 'ancient_green_dragon': this.drawAncientGreenDragon(ctx, s, baseColor); break;
      case 'ancient_blue_dragon': this.drawAncientBlueDragon(ctx, s, baseColor); break;
      case 'ancient_red_dragon': this.drawAncientRedDragon(ctx, s, baseColor); break;
      case 'vulture': this.drawVulture(ctx, s, baseColor); break;
      case 'blood_hawk': this.drawBloodHawk(ctx, s, baseColor); break;
      case 'constrictor_snake': this.drawConstrictorSnake(ctx, s, baseColor); break;
      case 'giant_frog': this.drawGiantFrog(ctx, s, baseColor); break;
      case 'gray_ooze': this.drawGrayOoze(ctx, s, baseColor); break;
      case 'thorn_slinger': this.drawThornSlinger(ctx, s, baseColor); break;
      case 'wood_woad': this.drawWoodWoad(ctx, s, baseColor); break;
      case 'fire_mephit': this.drawFireMephit(ctx, s, baseColor); break;
      case 'rug_of_smothering': this.drawRugOfSmothering(ctx, s, baseColor); break;
      case 'verbeeg': this.drawVerbeeg(ctx, s, baseColor); break;
      case 'firbolg': this.drawFirbolg(ctx, s, baseColor); break;
      case 'slithering_tracker': this.drawSlitheringTracker(ctx, s, baseColor); break;
      case 'helmed_horror': this.drawHelmedHorror(ctx, s, baseColor); break;
      case 'barlgura': this.drawBarlgura(ctx, s, baseColor); break;
      case 'shield_guardian': this.drawShieldGuardian(ctx, s, baseColor); break;
      case 'yochlol': this.drawYochlol(ctx, s, baseColor); break;
      case 'nalfeshnee': this.drawNalfeshnee(ctx, s, baseColor); break;
      case 'molydeus': this.drawMolydeus(ctx, s, baseColor); break;
      case 'drow_warrior': this.drawDrowWarrior(ctx, s, baseColor); break;
      case 'drow_house_guard': this.drawDrow(ctx, s, baseColor, 'house_guard'); break;
      case 'drow_scout': this.drawDrow(ctx, s, baseColor, 'scout'); break;
      case 'drow_assassin': this.drawDrow(ctx, s, baseColor, 'assassin'); break;
      case 'drow_archmage': this.drawDrow(ctx, s, baseColor, 'archmage'); break;
      case 'drow_matron': this.drawDrow(ctx, s, baseColor, 'matron'); break;
      case 'vrock_warlord': this.drawVrockWarlord(ctx, s, baseColor); break;
      case 'maurezhi': this.drawMaurezhi(ctx, s, baseColor); break;
      case 'izzru': this.drawIzzru(ctx, s, baseColor); break;
      case 'oonga': this.drawOonga(ctx, s, baseColor); break;
      case 'proto_red_dragon': this.drawProtoRedDragon(ctx, s, baseColor); break;
      case 'sang_dragon': this.drawSangDragon(ctx, s, baseColor); break;
      case 'asteri': this.drawAsteri(ctx, s, baseColor); break;
      case 'titan_celestial': this.drawTitanCelestial(ctx, s, baseColor); break;
      case 'dust_mephit': this.drawDustMephit(ctx, s, baseColor); break;
      case 'magmin': this.drawMagmin(ctx, s, baseColor); break;
      case 'giant_eagle': this.drawGiantEagle(ctx, s, baseColor); break;
      case 'crocodile': this.drawCrocodile(ctx, s, baseColor); break;
      case 'minotaur_skeleton': this.drawMinotaurSkeleton(ctx, s, baseColor); break;
      case 'azer': this.drawAzer(ctx, s, baseColor); break;
      case 'rhinoceros': this.drawRhinoceros(ctx, s, baseColor); break;
      case 'hobgoblin_captain': this.drawHobgoblinCaptain(ctx, s, baseColor); break;
      case 'elephant': this.drawElephant(ctx, s, baseColor); break;
      case 'revenant': this.drawRevenant(ctx, s, baseColor); break;
      case 'triceratops': this.drawTriceratops(ctx, s, baseColor); break;
      case 'chasme': this.drawChasme(ctx, s, baseColor); break;
      case 'young_emerald_dragon': this.drawYoungEmeraldDragon(ctx, s, baseColor); break;
      case 'deva': this.drawDeva(ctx, s, baseColor); break;
      case 'retriever': this.drawRetriever(ctx, s, baseColor); break;
      case 'planetar': this.drawPlanetar(ctx, s, baseColor); break;
      case 'adult_amethyst_dragon': this.drawAdultAmethystDragon(ctx, s, baseColor); break;
      case 'solar': this.drawSolar(ctx, s, baseColor); break;
      case 'empyrean': this.drawEmpyrean(ctx, s, baseColor); break;
      case 'mastiff': this.drawMastiff(ctx, s, baseColor); break;
      case 'giant_weasel': this.drawGiantWeasel(ctx, s, baseColor); break;
      case 'hawk': this.drawHawk(ctx, s, baseColor); break;
      case 'crawling_claw': this.drawCrawlingClaw(ctx, s, baseColor); break;
      case 'skeleton_archer': this.drawSkeletonArcher(ctx, s, baseColor); break;
      case 'giant_badger': this.drawGiantBadger(ctx, s, baseColor); break;
      case 'riding_horse': this.drawRidingHorse(ctx, s, baseColor); break;
      case 'giant_owl': this.drawGiantOwl(ctx, s, baseColor); break;
      case 'giant_elk': this.drawGiantElk(ctx, s, baseColor); break;
      case 'giant_boar': this.drawGiantBoar(ctx, s, baseColor); break;
      case 'sword_wraith_commander': this.drawSwordWraithCommander(ctx, s, baseColor); break;
      case 'young_sapphire_dragon': this.drawYoungSapphireDragon(ctx, s, baseColor); break;
      case 'aboleth': this.drawAboleth(ctx, s, baseColor); break;
      case 'mummy_lord': this.drawMummyLord(ctx, s, baseColor); break;
      case 'dracolich': this.drawDracolich(ctx, s, baseColor); break;
      case 'adult_topaz_dragon': this.drawAdultTopazDragon(ctx, s, baseColor); break;
      case 'astral_dreadnought': this.drawAstralDreadnought(ctx, s, baseColor); break;
      case 'kraken': this.drawKraken(ctx, s, baseColor); break;
      case 'marut': this.drawMarut(ctx, s, baseColor); break;
      case 'tarrasque': this.drawTarrasque(ctx, s, baseColor); break;
      case 'flumph': this.drawFlumph(ctx, s, baseColor); break;
      case 'giant_crab': this.drawGiantCrab(ctx, s, baseColor); break;
      case 'giant_vulture': this.drawGiantVulture(ctx, s, baseColor); break;
      case 'ogre_zombie': this.drawOgreZombie(ctx, s, baseColor); break;
      case 'flail_snail': this.drawFlailSnail(ctx, s, baseColor); break;
      case 'ettercap': this.drawEttercap(ctx, s, baseColor); break;
      case 'spirit_naga': this.drawSpiritNaga(ctx, s, baseColor); break;
      case 'wyrmling_white': this.drawWyrmlingWhite(ctx, s, baseColor); break;
      case 'yeth_hound': this.drawYethHound(ctx, s, baseColor); break;
      case 'skeleton_knight': this.drawSkeletonKnight(ctx, s, baseColor); break;
      case 'grick_alpha': this.drawGrickAlpha(ctx, s, baseColor); break;
      case 'tyrannosaurus_rex': this.drawTyrannosaurusRex(ctx, s, baseColor); break;
      case 'young_blue_dragon': this.drawYoungBlueDragon(ctx, s, baseColor); break;
      case 'death_slaad': this.drawDeathSlaad(ctx, s, baseColor); break;
      case 'exarch_air': this.drawAirMyrmidon(ctx, s, baseColor); break;
      case 'exarch_earth': this.drawEarthMyrmidon(ctx, s, baseColor); break;
      case 'exarch_fire': this.drawFireMyrmidon(ctx, s, baseColor); break;
      case 'exarch_water': this.drawWaterMyrmidon(ctx, s, baseColor); break;
      case 'wyrmling_red': this.drawWyrmlingRed(ctx, s, baseColor); break;
      case 'korred': this.drawKorred(ctx, s, baseColor); break;
      case 'darkmantle': this.drawDarkmantle(ctx, s, baseColor); break;
      case 'piercer': this.drawPiercer(ctx, s, baseColor); break;
      case 'bullywug': this.drawBullywug(ctx, s, baseColor); break;
      case 'goblin_boss': this.drawGoblinBoss(ctx, s, baseColor); break;
      case 'goblin_warlord': this.drawGoblinWarlord(ctx, s, baseColor); break;
      case 'nilbog': this.drawNilbog(ctx, s, baseColor); break;
      case 'grung': this.drawGrung(ctx, s, baseColor); break;
      case 'flying_sword': this.drawFlyingSword(ctx, s, baseColor); break;
      case 'giant_centipede': this.drawGiantCentipede(ctx, s, baseColor); break;
      case 'giant_poisonous_snake': this.drawGiantPoisonSnake(ctx, s, baseColor); break;
      case 'giant_lizard': this.drawGiantLizard(ctx, s, baseColor); break;
      case 'axe_beak': this.drawAxeBeak(ctx, s, baseColor); break;
      case 'stirge': this.drawStirge(ctx, s, baseColor); break;
      case 'manes': this.drawManes(ctx, s, baseColor); break;
      case 'lemure': this.drawLemure(ctx, s, baseColor); break;
      case 'giant_fire_beetle': this.drawGiantFireBeetle(ctx, s, baseColor); break;
      case 'spider_swarm': this.drawSpiderSwarm(ctx, s, baseColor); break;
      case 'mammoth': this.drawMammoth(ctx, s, baseColor); break;
      case 'giant_tiger': this.drawGiantTiger(ctx, s, baseColor); break;
      case 'dire_badger': this.drawDireBadger(ctx, s, baseColor); break;
      case 'horse_pony': this.drawHorsePony(ctx, s, baseColor); break;
      case 'swarm_of_insects': this.drawSwarmInsects(ctx, s, baseColor); break;
      case 'swarm_of_quippers': this.drawSwarmQuippers(ctx, s, baseColor); break;
      case 'shark': this.drawShark(ctx, s, baseColor); break;
      case 'hunter_shark': this.drawHunterShark(ctx, s, baseColor); break;
      case 'killer_whale': this.drawKillerWhale(ctx, s, baseColor); break;
      case 'giant_strider': this.drawGiantStrider(ctx, s, baseColor); break;
      case 'great_horned_owl': this.drawGreatHornedOwl(ctx, s, baseColor); break;
      case 'viper': this.drawViper(ctx, s, baseColor); break;
      case 'steam_mephit': this.drawSteamMephit(ctx, s, baseColor); break;
      case 'mud_mephit': this.drawMudMephit(ctx, s, baseColor); break;
      case 'ice_mephit': this.drawIceMephit(ctx, s, baseColor); break;
      case 'salt_mephit': this.drawSaltMephit(ctx, s, baseColor); break;
      case 'goblin_shaman': this.drawGoblinShaman(ctx, s, baseColor); break;
      case 'hobgoblin_devastator': this.drawHobgoblinDevastator(ctx, s, baseColor); break;
      case 'gnoll_warden': this.drawGnollWarden(ctx, s, baseColor); break;
      case 'kobold_inventor': this.drawKoboldInventor(ctx, s, baseColor); break;
      case 'lizardfolk_baron': this.drawLizardfolk(ctx, s, baseColor, 'baron'); break;
      case 'merrow_champ': this.drawMerrowChamp(ctx, s, baseColor); break;
      case 'fallen_aasimar': this.drawFallenAasimar(ctx, s, baseColor); break;
      case 'frost_devil': this.drawFrostDevil(ctx, s, baseColor); break;
      case 'deep_one_priest': this.drawDeepOnePriest(ctx, s, baseColor); break;
      case 'fire_giant_dreadnought': this.drawFireGiantDreadnought(ctx, s, baseColor); break;
      case 'androsphinx': this.drawAndrosphinx(ctx, s, baseColor); break;
      case 'gynosphinx': this.drawGynosphinx(ctx, s, baseColor); break;
      case 'swamp_wight': this.drawSwampWight(ctx, s, baseColor); break;
      case 'griffin_royal': this.drawGriffinRoyal(ctx, s, baseColor); break;
      case 'wraith_lord': this.drawWraithLord(ctx, s, baseColor); break;
      case 'skeleton_legionnaire': this.drawSkeletonLegionnaire(ctx, s, baseColor); break;
      case 'dire_boar': this.drawDireBoar(ctx, s, baseColor); break;
      case 'swarm_of_rats': this.drawSwarmRats(ctx, s, baseColor); break;
      case 'giant_scorpion_matriarch': this.drawGiantScorpionMatriarch(ctx, s, baseColor); break;
      case 'hill_giant_eldest': this.drawHillGiantEldest(ctx, s, baseColor); break;
      case 'conjurer_arcanist': this.drawConjurerArcanist(ctx, s, baseColor); break;
      case 'succubus': this.drawSuccubus(ctx, s, baseColor); break;
      case 'incubus': this.drawIncubus(ctx, s, baseColor); break;
      case 'merrenoloth': this.drawMerrenoloth(ctx, s, baseColor); break;
      case 'cloaker': this.drawCloaker(ctx, s, baseColor); break;
      case 'choker': this.drawChoker(ctx, s, baseColor); break;
      case 'behir': this.drawBehir(ctx, s, baseColor); break;
      case 'cu_sith': this.drawCuSith(ctx, s, baseColor); break;
      case 'treant_ancient': this.drawTreantAncient(ctx, s, baseColor); break;
      case 'sea_spawn': this.drawSeaSpawn(ctx, s, baseColor); break;
      case 'sahuagin_baron': this.drawSahuaginBaron(ctx, s, baseColor); break;
      case 'roc_ancient': this.drawRocAncient(ctx, s, baseColor); break;
      case 'giant_bombardier_beetle': this.drawGiantBombardierBeetle(ctx, s, baseColor); break;
      case 'werebear': this.drawLycanthrope(ctx, s, baseColor, 'bear'); break;
      case 'wereraven': this.drawWereraven(ctx, s, baseColor); break;
      case 'hobgoblin_iron_shadow': this.drawHobgoblinIronShadow(ctx, s, baseColor); break;
      case 'flying_snake': this.drawFlyingSnake(ctx, s, baseColor); break;
      case 'giant_frilled_lizard': this.drawGiantFrilledLizard(ctx, s, baseColor); break;
      case 'gloom_weaver': this.drawGloomWeaver(ctx, s, baseColor); break;
      case 'dire_wasp': this.drawDireWasp(ctx, s, baseColor); break;
      case 'gazer': this.drawGazer(ctx, s, baseColor); break;
      case 'wyrmling_green': this.drawWyrmlingGreen(ctx, s, baseColor); break;
      case 'wyrmling_black': this.drawWyrmlingBlack(ctx, s, baseColor); break;
      case 'wyrmling_blue': this.drawWyrmlingBlue(ctx, s, baseColor); break;
      case 'wyrmling_emerald': this.drawWyrmlingEmerald(ctx, s, baseColor); break;
      case 'wyrmling_sapphire': this.drawWyrmlingSapphire(ctx, s, baseColor); break;
      case 'wyrmling_topaz': this.drawWyrmlingTopaz(ctx, s, baseColor); break;
      case 'young_brass_dragon': this.drawYoungBrassDragon(ctx, s, baseColor); break;
      case 'young_bronze_dragon': this.drawYoungBronzeDragon(ctx, s, baseColor); break;
      case 'young_silver_dragon': this.drawYoungSilverDragon(ctx, s, baseColor); break;
      case 'young_gold_dragon': this.drawYoungGoldDragon(ctx, s, baseColor); break;
      case 'adult_crystal_dragon': this.drawAdultCrystalDragon(ctx, s, baseColor); break;
      case 'adult_brass_dragon': this.drawAdultBrassDragon(ctx, s, baseColor); break;
      case 'adult_copper_dragon': this.drawAdultCopperDragon(ctx, s, baseColor); break;
      case 'arcanaloth': this.drawArcanaloth(ctx, s, baseColor); break;
      case 'ultroloth': this.drawUltroloth(ctx, s, baseColor); break;
      case 'orc_warchief': this.drawOrcWarchief(ctx, s, baseColor); break;
      case 'alpha_wolf': this.drawAlphaWolf(ctx, s, baseColor); break;
      case 'giant_boa_constrictor': this.drawGiantBoaConstrictor(ctx, s, baseColor); break;
      case 'velociraptor_pack': this.drawVelociraptor(ctx, s, baseColor); break;
      case 'pteranodon_wild': this.drawPteranodon(ctx, s, baseColor); break;
      case 'spined_devil': this.drawSpinedDevil(ctx, s, baseColor); break;
      case 'yuan_ti_pit_master': this.drawYuanTiPitMaster(ctx, s, baseColor); break;
      case 'shadar_kai': this.drawShadarKai(ctx, s, baseColor); break;
      case 'necromancer': this.drawNecromancer(ctx, s, baseColor); break;
      case 'gargoyle_lord': this.drawGargoyleLord(ctx, s, baseColor); break;
      case 'deinonychus': this.drawDeinonychus(ctx, s, baseColor); break;
      case 'dimetrodon': this.drawDimetrodon(ctx, s, baseColor); break;
      case 'plesiosaurus': this.drawPlesiosaurus(ctx, s, baseColor); break;
      case 'dire_crocodile': this.drawDireCrocodile(ctx, s, baseColor); break;
      case 'quetzalcoatlus': this.drawQuetzalcoatlus(ctx, s, baseColor); break;
      case 'stegosaurus': this.drawStegosaurus(ctx, s, baseColor); break;
      case 'deep_dragon': this.drawDeepDragon(ctx, s, baseColor); break;
      case 'clockwork_dragon': this.drawClockworkDragon(ctx, s, baseColor); break;
      case 'ghost_dragon': this.drawGhostDragon(ctx, s, baseColor); break;
      case 'baphomet': this.drawBaphomet(ctx, s, baseColor); break;
      case 'juiblex': this.drawJuiblex(ctx, s, baseColor); break;
      case 'zuggtmoy': this.drawZuggtmoy(ctx, s, baseColor); break;
      case 'grazzt': this.drawGrazzt(ctx, s, baseColor); break;
      case 'fraz_urbluu': this.drawFrazUrbluu(ctx, s, baseColor); break;
      case 'malcanthet': this.drawMalcanthet(ctx, s, baseColor); break;
      case 'kostchtchie': this.drawKostchtchie(ctx, s, baseColor); break;
      case 'yeenoghu': this.drawYeenoghu(ctx, s, baseColor); break;
      case 'demogorgon': this.drawDemogorgon(ctx, s, baseColor); break;
      case 'orcus': this.drawOrcus(ctx, s, baseColor); break;
      case 'abishai_red': this.drawAbishaiRed(ctx, s, baseColor); break;
      case 'abishai_blue': this.drawAbishaiBlue(ctx, s, baseColor); break;
      case 'abishai_black': this.drawAbishaiBlack(ctx, s, baseColor); break;
      case 'abishai_green': this.drawAbishaiGreen(ctx, s, baseColor); break;
      case 'abishai_white': this.drawAbishaiWhite(ctx, s, baseColor); break;
      case 'zariel': this.drawZariel(ctx, s, baseColor); break;
      case 'bel': this.drawBel(ctx, s, baseColor); break;
      case 'dispater': this.drawDispater(ctx, s, baseColor); break;
      case 'mammon': this.drawMammon(ctx, s, baseColor); break;
      case 'levistus': this.drawLevistus(ctx, s, baseColor); break;
      case 'asmodeus': this.drawAsmodeus(ctx, s, baseColor); break;
      case 'tiamat': this.drawTiamat(ctx, s, baseColor); break;
      case 'bahamut': this.drawBahamut(ctx, s, baseColor); break;
      case 'pazuzu': this.drawPazuzu(ctx, s, baseColor); break;
      case 'oboxob': this.drawOboxob(ctx, s, baseColor); break;
      case 'azaezel': this.drawAzaezel(ctx, s, baseColor); break;
      case 'heavenly_champion': this.drawHeavenlyChampion(ctx, s, baseColor); break;
      case 'horned_serpent_queen': this.drawHornedSerpentQueen(ctx, s, baseColor); break;
      case 'formian_warrior': this.drawFormianWarrior(ctx, s, baseColor); break;
      case 'centaur_storm': this.drawCentaurStorm(ctx, s, baseColor); break;
      case 'centaur_queen': this.drawCentaurQueen(ctx, s, baseColor); break;
      case 'formian_myrmarch': this.drawFormianMyrmarch(ctx, s, baseColor); break;
      case 'eladrin_summer': this.drawEladrinSummer(ctx, s, baseColor); break;
      case 'eladrin_autumn': this.drawEladrinAutumn(ctx, s, baseColor); break;
      case 'eladrin_winter': this.drawEladrinWinter(ctx, s, baseColor); break;
      case 'eladrin_spring': this.drawEladrinSpring(ctx, s, baseColor); break;
      case 'modron_monodrone': this.drawModronMonodrone(ctx, s, baseColor); break;
      case 'modron_duodrone': this.drawModronDuodrone(ctx, s, baseColor); break;
      case 'modron_tridrone': this.drawModronTridrone(ctx, s, baseColor); break;
      case 'modron_quadrone': this.drawModronQuadrone(ctx, s, baseColor); break;
      case 'modron_pentadrone': this.drawModronPentadrone(ctx, s, baseColor); break;
      case 'modron_hexton': this.drawModronHexton(ctx, s, baseColor); break;
      case 'modron_septon': this.drawModronSepton(ctx, s, baseColor); break;
      case 'modron_octon': this.drawModronOcton(ctx, s, baseColor); break;
      case 'modron_nonomron': this.drawModronNonomron(ctx, s, baseColor); break;
      case 'modron_decan': this.drawModronDecan(ctx, s, baseColor); break;
      case 'formian_queen': this.drawFormianQueen(ctx, s, baseColor); break;
      case 'modron_primus': this.drawModronPrimus(ctx, s, baseColor); break;
      case 'werebat': this.drawWerebat(ctx, s, baseColor); break;
      case 'wererat_king': this.drawLycanthrope(ctx, s, baseColor, 'rat', true); break;
      case 'werewolf_alpha': this.drawLycanthrope(ctx, s, baseColor, 'wolf', true); break;
      case 'wereshark': this.drawLycanthrope(ctx, s, baseColor, 'shark'); break;
      case 'weretiger_alpha': this.drawLycanthrope(ctx, s, baseColor, 'tiger', true); break;
      case 'beetle_king': this.drawBeetleKing(ctx, s, baseColor); break;
      case 'owlbear_alpha': this.drawOwlbearAlpha(ctx, s, baseColor); break;
      case 'ghast_matriarch': this.drawGhastMatriarch(ctx, s, baseColor); break;
      case 'skeleton_firelord': this.drawSkeletonFirelord(ctx, s, baseColor); break;
      case 'bronze_scout': this.drawBronzeScout(ctx, s, baseColor); break;
      case 'clay_guardian': this.drawClayGuardian(ctx, s, baseColor); break;
      case 'clockwork_hound': this.drawClockworkHound(ctx, s, baseColor); break;
      case 'iron_cobra': this.drawIronCobra(ctx, s, baseColor); break;
      case 'stone_defender': this.drawStoneDefender(ctx, s, baseColor); break;
      case 'force_column': this.drawForceColumn(ctx, s, baseColor); break;
      case 'nimblewright': this.drawNimblewright(ctx, s, baseColor); break;
      case 'sculpture_guard': this.drawSculptureGuard(ctx, s, baseColor); break;
      case 'rune_guardian': this.drawRuneGuardian(ctx, s, baseColor); break;
      case 'golem_battle': this.drawGolemBattle(ctx, s, baseColor); break;
      case 'ghoul_king': this.drawGhoulKing(ctx, s, baseColor); break;
      case 'banshee_matriarch': this.drawBansheeMatriarch(ctx, s, baseColor); break;
      case 'zombie_empress': this.drawZombieEmpress(ctx, s, baseColor); break;
      case 'mummy_firelord': this.drawMummyFirelord(ctx, s, baseColor); break;
      case 'barrow_mound_king': this.drawBarrowMoundKing(ctx, s, baseColor); break;
      case 'hollow_dragon_skeleton': this.drawHollowDragon(ctx, s, baseColor); break;
      case 'wood_colossus': this.drawWoodColossus(ctx, s, baseColor); break;
      case 'treant_king': this.drawTreantKing(ctx, s, baseColor); break;
      case 'lich_archmage_queen': this.drawLichArchmageQueen(ctx, s, baseColor); break;
      case 'dire_wolf_wyrm': this.drawDireWolfWyrm(ctx, s, baseColor); break;
      case 'boggle': this.drawBoggle(ctx, s, baseColor); break;
      case 'quickling_warband': this.drawQuickling(ctx, s, baseColor); break;
      case 'redcap_brute': this.drawRedcap(ctx, s, baseColor); break;
      case 'treant_sapling': this.drawTreantSapling(ctx, s, baseColor); break;
      case 'boggart': this.drawBoggart(ctx, s, baseColor); break;
      case 'salamander_spawn': this.drawSalamanderSpawn(ctx, s, baseColor); break;
      case 'vrock_lord': this.drawVrockLord(ctx, s, baseColor); break;
      case 'chasme_queen': this.drawChasmeQueen(ctx, s, baseColor); break;
      case 'maw_demon': this.drawMawDemon(ctx, s, baseColor); break;
      case 'goristro_alpha': this.drawGoristroAlpha(ctx, s, baseColor); break;
      case 'death_dog_packmaster': this.drawDeathDogPackmaster(ctx, s, baseColor); break;
      case 'giant_slaad_lord': this.drawGiantSlaadLord(ctx, s, baseColor); break;
      case 'wyrmrock': this.drawWyrmrock(ctx, s, baseColor); break;
      case 'balhannoth_lurker': this.drawBalhannothLurker(ctx, s, baseColor); break;
      case 'glimmerscale_drake': this.drawGlimmerscaleDrake(ctx, s, baseColor); break;
      case 'candle_wisp': this.drawCandleWisp(ctx, s, baseColor); break;
      case 'forest_witch': this.drawForestWitch(ctx, s, baseColor); break;
      case 'lunar_revenant': this.drawLunarRevenant(ctx, s, baseColor); break;
      case 'jackalwere': this.drawJackalwere(ctx, s, baseColor); break;
      case 'stone_cursed': this.drawStoneCursed(ctx, s, baseColor); break;
      case 'girallon': this.drawGirallon(ctx, s, baseColor); break;
      case 'mindwitness': this.drawMindwitness(ctx, s, baseColor); break;
      case 'abominable_yeti': this.drawAbominableYeti(ctx, s, baseColor); break;
      case 'warlock_of_the_great_old_one': this.drawWarlockGreatOld(ctx, s, baseColor); break;
      case 'fire_azer': this.drawFireAzer(ctx, s, baseColor); break;
      case 'boneclaw': this.drawBoneclaw(ctx, s, baseColor); break;
      case 'shadow_mastiff': this.drawShadowMastiff(ctx, s, baseColor); break;
      case 'crawling_hand': this.drawCrawlingHand(ctx, s, baseColor); break;
      case 'swarm_of_sword_spiders': this.drawSwordSpiderSwarm(ctx, s, baseColor); break;
      case 'needlelord': this.drawNeedlelord(ctx, s, baseColor); break;
      case 'fir_darrig': this.drawFirDarrig(ctx, s, baseColor); break;
      case 'nightmare_rider': this.drawNightmareRider(ctx, s, baseColor); break;
      case 'drow_arachnomancer': this.drawDrow(ctx, s, baseColor, 'arachnomancer'); break;
      case 'elder_temple_dog': this.drawElderTempleDog(ctx, s, baseColor); break;
      case 'phoenix_lesser': this.drawPhoenixLesser(ctx, s, baseColor); break;
      case 'ogre_thundermace': this.drawOgreThundermace(ctx, s, baseColor); break;
      case 'ghoul_flesh_baron': this.drawGhoulFleshBaron(ctx, s, baseColor); break;
      case 'shadow_angel': this.drawShadowAngel(ctx, s, baseColor); break;
      case 'demon_toad': this.drawDemonToad(ctx, s, baseColor); break;
      case 'spider_lord': this.drawSpiderLord(ctx, s, baseColor); break;
      case 'tomb_herald': this.drawTombHerald(ctx, s, baseColor); break;
      case 'svirfneblin': this.drawSvirfneblin(ctx, s, baseColor); break;
      case 'neothelid': this.drawNeothelid(ctx, s, baseColor); break;
      case 'rakshasa_noble': this.drawRakshasaNoble(ctx, s, baseColor); break;
      case 'oni_chieftain': this.drawOniChieftain(ctx, s, baseColor); break;
      case 'spirit_troll': this.drawSpiritTroll(ctx, s, baseColor); break;
      case 'elder_umber_hulk': this.drawElderUmberHulk(ctx, s, baseColor); break;
      case 'ooze_mephit': this.drawOozeMephit(ctx, s, baseColor); break;
      case 'void_dragon': this.drawVoidDragon(ctx, s, baseColor); break;
      case 'moon_dragon': this.drawMoonDragon(ctx, s, baseColor); break;
      case 'sun_dragon': this.drawSunDragon(ctx, s, baseColor); break;
      case 'bone_swarm': this.drawBoneSwarm(ctx, s, baseColor); break;
      case 'gloom_widow': this.drawGloomWidow(ctx, s, baseColor); break;
      case 'fire_snake': this.drawFireSnake(ctx, s, baseColor); break;
      case 'giant_anaconda': this.drawGiantAnaconda(ctx, s, baseColor); break;
      case 'orc_blade_of_ilneval': this.drawOrcBladeIlneval(ctx, s, baseColor); break;
      case 'gnoll_witherling': this.drawGnollWitherling(ctx, s, baseColor); break;
      case 'worg_rider': this.drawWorgRider(ctx, s, baseColor); break;
      case 'kobold_dragonshield': this.drawKoboldDragonshield(ctx, s, baseColor); break;
      case 'troglodyte_shaman': this.drawTroglodyteShaman(ctx, s, baseColor); break;
      case 'black_pudding_lord': this.drawBlackPuddingLord(ctx, s, baseColor); break;
      case 'grimlock': this.drawGrimlock(ctx, s, baseColor); break;
      case 'quaggoth': this.drawQuaggoth(ctx, s, baseColor); break;
      case 'xill': this.drawXill(ctx, s, baseColor); break;
      case 'rast': this.drawRast(ctx, s, baseColor); break;
      case 'morkoth': this.drawMorkoth(ctx, s, baseColor); break;
      case 'skulk': this.drawSkulk(ctx, s, baseColor); break;
      case 'darkling': this.drawDarkling(ctx, s, baseColor); break;
      case 'steel_predator': this.drawSteelPredator(ctx, s, baseColor); break;
      case 'enveloper': this.drawEnveloper(ctx, s, baseColor); break;
      case 'adamantine_golem': this.drawAdamantineGolem(ctx, s, baseColor); break;
      case 'mithral_golem': this.drawMithralGolem(ctx, s, baseColor); break;
      case 'brainstealer': this.drawBrainstealer(ctx, s, baseColor); break;
      case 'half_dragon_veteran': this.drawHalfDragonVeteran(ctx, s, baseColor); break;
      case 'berbalang': this.drawBerbalang(ctx, s, baseColor); break;
      case 'guardian_serpent': this.drawGuardianSerpent(ctx, s, baseColor); break;
      case 'marid': this.drawMarid(ctx, s, baseColor); break;
      case 'leonal': this.drawLeonal(ctx, s, baseColor); break;
      case 'avoral': this.drawAvoral(ctx, s, baseColor); break;
      case 'guardinal_lord': this.drawGuardinalLord(ctx, s, baseColor); break;
      case 'foo_lion': this.drawFooLion(ctx, s, baseColor); break;
      case 'kirin': this.drawKirin(ctx, s, baseColor); break;
      case 'hell_knight': this.drawHellKnight(ctx, s, baseColor); break;
      case 'iron_marshal': this.drawIronMarshal(ctx, s, baseColor); break;
      case 'death_knight_captain': this.drawDeathKnightCaptain(ctx, s, baseColor); break;
      case 'antipaladin': this.drawAntipaladin(ctx, s, baseColor); break;
      case 'horned_devil_captain': this.drawHornedDevilCaptain(ctx, s, baseColor); break;
      case 'chain_devil': this.drawChainDevil(ctx, s, baseColor); break;
      case 'vampire_lord_spawn': this.drawVampireLordSpawn(ctx, s, baseColor); break;
      case 'green_slaad': this.drawGreenSlaad(ctx, s, baseColor); break;
      case 'gray_slaad': this.drawGraySlaad(ctx, s, baseColor); break;
      case 'storm_giant_elder': this.drawStormGiantElder(ctx, s, baseColor); break;
      case 'cloud_giant_smiling': this.drawCloudGiantSmiling(ctx, s, baseColor); break;
      case 'solar_captain': this.drawSolarCaptain(ctx, s, baseColor); break;
      case 'planetar_warden': this.drawPlanetarWarden(ctx, s, baseColor); break;
      case 'deva_lieutenant': this.drawDevaLieutenant(ctx, s, baseColor); break;
      case 'seraph_watcher': this.drawSeraphWatcher(ctx, s, baseColor); break;
      case 'duergar_soulblade': this.drawDuergarSoulblade(ctx, s, baseColor); break;
      case 'duergar_warlord': this.drawDuergarWarlord(ctx, s, baseColor); break;
      case 'oni_nightmare': this.drawOniNightmare(ctx, s, baseColor); break;
      case 'banshee_queen': this.drawBansheeQueen(ctx, s, baseColor); break;
      case 'grave_wight': this.drawGraveWight(ctx, s, baseColor); break;
      case 'barrow_warden': this.drawBarrowWarden(ctx, s, baseColor); break;
      case 'crypt_thing': this.drawCryptThing(ctx, s, baseColor); break;
      case 'mohrg': this.drawMohrg(ctx, s, baseColor); break;
      case 'devourer': this.drawDevourer(ctx, s, baseColor); break;
      case 'nightwalker': this.drawNightwalker(ctx, s, baseColor); break;
      case 'phantom_lord': this.drawPhantomLord(ctx, s, baseColor); break;
      case 'githyanki_gish': this.drawGithyankiGish(ctx, s, baseColor); break;
      case 'githzerai_zerth': this.drawGithzeraiZerth(ctx, s, baseColor); break;
      case 'elder_tempest': this.drawElderTempest(ctx, s, baseColor); break;
      case 'kraken_priest': this.drawKrakenPriest(ctx, s, baseColor); break;
      case 'chuul_elder': this.drawChuul(ctx, s, baseColor); break;
      case 'chuul_matriarch': this.drawChuul(ctx, s, baseColor); break;
      case 'ulitharid_high_priest': this.drawUlitharid(ctx, s, baseColor); break;
      case 'neothelid_worm': this.drawNeothelid(ctx, s, baseColor); break;
      case 'grell_matriarch': this.drawGrell(ctx, s, baseColor); break;
      case 'spectator_elder': this.drawSpectator(ctx, s, baseColor, true); break;
      case 'gauth_tyrant': this.drawGauth(ctx, s, baseColor, true); break;
      case 'death_kiss_bloodmage': this.drawDeathKissBloodmage(ctx, s, baseColor); break;
      case 'flesh_golem_grave': this.drawFleshGolem(ctx, s, baseColor); break;
      case 'bone_naga_boss': this.drawBoneNaga(ctx, s, baseColor); break;
      case 'iron_golem_juggernaut': this.drawIronGolem(ctx, s, baseColor); break;
      case 'stone_golem_elder': this.drawStoneGolem(ctx, s, baseColor); break;
      case 'clay_golem_colossus': this.drawClayGolem(ctx, s, baseColor); break;
      case 'ooze_lord_elder': this.drawBlackPudding(ctx, s, baseColor); break;
      case 'purple_worm_ancient': this.drawPurpleWorm(ctx, s, baseColor); break;
      case 'roper_ancient': this.drawRoper(ctx, s, baseColor); break;
      case 'otyugh_matriarch': this.drawOtyugh(ctx, s, baseColor); break;
      case 'carrion_crawler_king': this.drawCarrionCrawler(ctx, s, baseColor); break;
      case 'mind_flayer_archmage': this.drawMindFlayerArchmage(ctx, s, baseColor); break;
      case 'elder_brain': this.drawElderBrain(ctx, s, baseColor); break;
      case 'vampire_lord': this.drawVampireLord(ctx, s, baseColor); break;
      case 'demilich': this.drawDemilich(ctx, s, baseColor); break;
      case 'atropal': this.drawAtropal(ctx, s, baseColor); break;
      case 'lich_king': this.drawLichKing(ctx, s, baseColor); break;
      case 'death_titan': this.drawDeathTitan(ctx, s, baseColor); break;
      case 'forge_golem': this.drawForgeGolem(ctx, s, baseColor); break;
      case 'rune_golem': this.drawRuneGolem(ctx, s, baseColor); break;
      case 'brass_dragon_elder': this.drawBrassDragonElder(ctx, s, baseColor); break;
      case 'copper_dragon_elder': this.drawCopperDragonElder(ctx, s, baseColor); break;
      case 'crystal_dragon_elder': this.drawCrystalDragonElder(ctx, s, baseColor); break;
      case 'obsidian_dragon': this.drawObsidianDragon(ctx, s, baseColor); break;
      case 'storm_dragon': this.drawStormDragon(ctx, s, baseColor); break;
      case 'poison_dragon': this.drawPoisonDragon(ctx, s, baseColor); break;
      case 'zariel_boss': this.drawZarielBoss(ctx, s, baseColor); break;
      case 'tiamat_avatar': this.drawTiamatAvatar(ctx, s, baseColor); break;
      case 'bahamut_aspect': this.drawBahamutAspect(ctx, s, baseColor); break;
      default: this.drawGoblin(ctx, s, baseColor);
    }
  }

  /**
   * The goblin is both the first thing most parties fight and the fallback for
   * any id without a case, so it is on screen more than any other monster. It
   * used to be a green rectangle with two dots and two ear tabs — no body, no
   * limbs, no weapon. Its silhouette is now the ear span: a wide flare either
   * side of an oversized head on a small hunched body, which is what tells it
   * apart from the kobold (horns up, spear tall) at 28 px.
   */
  private drawGoblin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#5f8a3a';
    const dark = flash || '#3d5c22';
    const lit = flash || '#7cab4e';
    // Bandy legs and splayed bare feet
    r(dark, 9, 22, 3, 4);
    r(dark, 16, 22, 3, 4);
    r(skin, 7, 26, 5, 2);
    r(skin, 16, 26, 5, 2);
    // Small pot-bellied torso
    r(skin, 9, 16, 10, 5);
    r(lit, 9, 16, 10, 1);
    r(dark, 10, 19, 8, 1);
    // Loincloth
    r(flash || '#6b4a2a', 9, 20, 10, 3);
    r(flash || '#54381e', 9, 22, 10, 1);
    // Spindly arms
    r(skin, 6, 16, 3, 6);
    r(dark, 6, 16, 1, 6);
    r(skin, 19, 16, 3, 5);
    // Head, set straight on the shoulders with no neck
    r(skin, 8, 6, 12, 10);
    r(lit, 8, 6, 12, 1);
    r(dark, 8, 6, 1, 10);
    r(dark, 8, 14, 12, 2);
    // Ears, stepped out to a point rather than left as square tabs
    r(skin, 5, 9, 3, 4);
    r(skin, 3, 8, 2, 4);
    r(skin, 1, 7, 2, 3);
    r(dark, 1, 10, 4, 1);
    r(skin, 20, 9, 3, 4);
    r(skin, 23, 8, 2, 4);
    r(skin, 25, 7, 2, 3);
    r(dark, 23, 10, 4, 1);
    // Yellow eyes in a sunken socket, so they are not two dots on a flat face
    r(flash || '#2b2410', 10, 8, 4, 4);
    r(flash || '#2b2410', 15, 8, 4, 4);
    r('#ffd23a', 10, 9, 4, 2);
    r('#ffd23a', 15, 9, 4, 2);
    r('#241a06', 12, 9, 1, 2);
    r('#241a06', 17, 9, 1, 2);
    // Snout and a crooked grin
    r(dark, 12, 12, 4, 1);
    r(flash || '#3a1610', 10, 13, 8, 2);
    r('#efe6cc', 11, 13, 1, 2);
    r('#efe6cc', 13, 13, 1, 1);
    r('#efe6cc', 15, 13, 1, 2);
    // Crude notched cleaver, held out at hip height so it clears the ears
    r(skin, 19, 19, 3, 3);
    r(flash || '#5a3f22', 21, 17, 2, 5);
    r(flash || '#aab3bf', 21, 13, 6, 4);
    r(flash || '#dde4ec', 21, 13, 6, 1);
    r(flash || '#7f868e', 21, 16, 6, 1);
    r(flash || '#3d4550', 24, 13, 1, 2);
  }

  /**
   * A skeleton reads by its gaps, not its mass: the old one was a solid slab
   * of ribcage under a solid skull, which is a snowman. Ribs are drawn as
   * separate bars with the dark of the body cavity between them, and the limbs
   * are bones with joints rather than stubs.
   */
  private drawSkeleton(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const bone = flash || '#d8d2c0';
    const lit = flash || '#efeade';
    const shade = flash || '#a49c8a';
    const gap = flash || '#1c1a1e';
    // Leg bones, knee knuckles and splayed feet
    r(bone, 11, 20, 2, 5);
    r(bone, 16, 20, 2, 5);
    r(shade, 10, 22, 4, 1);
    r(shade, 15, 22, 4, 1);
    r(bone, 9, 25, 5, 2);
    r(bone, 15, 25, 5, 2);
    // Pelvis
    r(bone, 10, 17, 9, 3);
    r(gap, 12, 18, 2, 2);
    r(gap, 15, 18, 2, 2);
    // Spine and ribs, the cavity showing between them
    r(gap, 9, 9, 11, 8);
    r(bone, 13, 9, 2, 8);
    r(bone, 9, 9, 11, 1);
    r(bone, 9, 11, 11, 1);
    r(bone, 10, 13, 9, 1);
    r(bone, 11, 15, 7, 1);
    r(shade, 9, 12, 11, 1);
    // Collarbone and shoulders
    r(bone, 8, 8, 13, 2);
    r(lit, 8, 8, 13, 1);
    // Arm bones with an elbow, the left hand raised
    r(bone, 6, 9, 2, 6);
    r(shade, 5, 14, 4, 1);
    r(bone, 4, 15, 2, 5);
    r(bone, 3, 19, 4, 2);
    r(bone, 21, 9, 2, 5);
    r(shade, 20, 13, 4, 1);
    r(bone, 22, 14, 2, 5);
    r(bone, 21, 18, 4, 2);
    // Skull: cranium, brow, sockets, and a hanging jaw
    r(bone, 10, 1, 9, 6);
    r(lit, 10, 1, 9, 1);
    r(shade, 10, 1, 1, 6);
    r(gap, 11, 3, 3, 3);
    r(gap, 15, 3, 3, 3);
    if (!flash) {
      r('#ff8a2a', 12, 4, 2, 2);
      r('#ff8a2a', 16, 4, 2, 2);
    }
    r(gap, 14, 5, 1, 2);
    r(bone, 11, 7, 7, 2);
    r(gap, 12, 8, 1, 1);
    r(gap, 14, 8, 1, 1);
    r(gap, 16, 8, 1, 1);
    // Notched blade in the right hand
    r(flash || '#8e9098', 25, 6, 2, 12);
    r(flash || '#c2c6cf', 25, 6, 1, 12);
    r(flash || '#6b5a3a', 23, 18, 5, 1);
  }

  /**
   * The old rat was a single capsule with a hairline tail — a loaf of bread,
   * and indistinguishable from the gray ooze and the boar. What makes a rat a
   * rat is the profile: hunched back, round ear, pointed snout with incisors,
   * four thin legs off the ground, and a long naked tail with a kink in it.
   */
  private drawGiantRat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#7d6f5e';
    const lit = flash || '#9a8b76';
    const dark = flash || '#584d40';
    const skinPink = flash || '#b98d84';
    // Long naked tail, kinked so it is not a ruler
    r(skinPink, 24, 15, 4, 2);
    r(skinPink, 25, 11, 2, 5);
    r(skinPink, 22, 10, 4, 2);
    // Legs — front pair planted, hind pair drawn up under the haunch
    r(dark, 8, 20, 3, 5);
    r(dark, 12, 21, 2, 4);
    r(dark, 18, 20, 3, 5);
    r(dark, 21, 21, 2, 4);
    r(skinPink, 7, 24, 4, 2);
    r(skinPink, 18, 24, 4, 2);
    // Hunched body: haunch high at the back, shoulders low at the front
    r(fur, 15, 12, 9, 9);
    r(fur, 7, 15, 9, 7);
    r(lit, 16, 12, 7, 1);
    r(lit, 8, 15, 8, 1);
    r(dark, 7, 20, 17, 2);
    // Head, low and forward
    r(fur, 3, 16, 6, 6);
    r(lit, 3, 16, 6, 1);
    // Pointed snout and gnawing incisors
    r(fur, 0, 18, 4, 3);
    r(skinPink, 0, 19, 2, 2);
    r('#efe6cc', 1, 21, 2, 2);
    // Round ear, the shape that says rodent at a glance
    r(fur, 5, 12, 5, 5);
    r(skinPink, 6, 13, 3, 3);
    // Beady eye
    r('#1c1410', 4, 17, 3, 3);
    r('#e04a3a', 5, 18, 2, 2);
    r('#ffd0c0', 5, 18, 1, 1);
  }

  /**
   * The orc is the party's first real brawler and was a featureless olive slab
   * with a white bar for a mouth. It is now the broadest humanoid silhouette in
   * the set — shoulders wider than the head is tall, no neck, arms hanging past
   * the hip — which is the read that separates it from the bandit and the
   * hobgoblin without needing to see a single interior detail.
   */
  private drawOrc(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#6f7a4a';
    const dark = flash || '#4d5730';
    const lit = flash || '#8c9760';
    // Tree-trunk legs and heavy boots
    r(dark, 8, 21, 5, 5);
    r(dark, 16, 21, 5, 5);
    r(flash || '#3a2f22', 7, 25, 6, 3);
    r(flash || '#3a2f22', 15, 25, 6, 3);
    // Fur kilt, kept a value above the legs so the two do not merge
    r(flash || '#7a6144', 7, 18, 15, 4);
    r(flash || '#8f7554', 7, 18, 15, 1);
    r(flash || '#5f4b34', 7, 21, 15, 1);
    // Slabbed torso, broadest at the shoulder
    r(hide, 6, 10, 16, 9);
    r(lit, 6, 10, 16, 1);
    r(dark, 6, 16, 16, 1);
    r(dark, 13, 11, 2, 8);
    // Crossed leather strap
    r(flash || '#4a3826', 9, 11, 3, 8);
    r(flash || '#5c4832', 9, 11, 1, 8);
    // Thick arms hanging to the hip
    r(hide, 3, 11, 4, 9);
    r(dark, 3, 11, 1, 9);
    r(hide, 22, 11, 4, 9);
    r(lit, 22, 11, 4, 1);
    // Head sunk between the shoulders
    r(hide, 9, 2, 10, 9);
    r(lit, 9, 2, 10, 1);
    r(dark, 9, 2, 1, 9);
    r(dark, 9, 5, 10, 1);
    // Small eyes deep under the brow ridge
    r(flash || '#2a1c10', 10, 6, 3, 3);
    r(flash || '#2a1c10', 15, 6, 3, 3);
    r('#ff6a28', 11, 6, 2, 2);
    r('#ff6a28', 15, 6, 2, 2);
    // Underbite: dark mouth line with two tusks pushing up out of it
    r(flash || '#39241a', 10, 9, 8, 2);
    r('#efe8d2', 10, 8, 2, 3);
    r('#efe8d2', 16, 8, 2, 3);
    // Topknot
    r(flash || '#2a2018', 12, 0, 4, 3);
    // Greataxe: a bearded head with a socket, not a grey box on a stick
    r(flash || '#5c3f22', 24, 5, 2, 17);
    r(flash || '#71502e', 24, 5, 1, 17);
    r(flash || '#a9b1bc', 20, 2, 7, 5);
    r(flash || '#a9b1bc', 21, 1, 5, 1);
    r(flash || '#a9b1bc', 19, 3, 1, 3);
    r(flash || '#d6dde6', 21, 1, 5, 1);
    r(flash || '#868d97', 20, 6, 7, 1);
    r(flash || '#7c838d', 23, 2, 2, 5);
  }

  /**
   * Road robbers. The old one was a tan rectangle with a lighter rectangle on
   * top and a white bar across it: no head, no legs, and identical for all
   * three ids that route here. They now share an anatomy — hooded human under a
   * cloak, blade drawn — and separate on headgear and weapon, so a highwayman
   * on the road is not a bandit wearing a different palette.
   */
  private drawBandit(
    ctx: CanvasRenderingContext2D,
    s: number,
    flash: string | undefined,
    kind: 'bandit' | 'highwayman' | 'captain' = 'bandit'
  ) {
    const r = this.grid(ctx, s);
    const captain = kind === 'captain';
    // The cloak sits a clear value below the jerkin and well below the scarf;
    // when all three were the same tan the whole figure read as one brown lump.
    const cloak = flash || (captain ? '#5e2925' : kind === 'highwayman' ? '#2e3243' : '#3b3730');
    const cloakLit = flash || (captain ? '#7a3832' : kind === 'highwayman' ? '#434a5e' : '#524c41');
    const cloakDark = flash || (captain ? '#3f1a17' : kind === 'highwayman' ? '#1f2231' : '#282520');
    const skin = flash || '#b08a62';
    // Cloak behind the figure, flaring to a ragged hem
    r(cloak, 5, 11, 18, 13);
    r(cloakLit, 5, 11, 18, 1);
    r(cloakDark, 5, 22, 18, 2);
    r(cloakDark, 5, 15, 2, 9);
    // Legs and boots
    r(flash || '#3b3128', 10, 21, 3, 5);
    r(flash || '#3b3128', 15, 21, 3, 5);
    r(flash || '#241d16', 9, 25, 5, 3);
    r(flash || '#241d16', 14, 25, 5, 3);
    // Jerkin, bandolier and belt
    r(flash || '#6b5a3f', 10, 13, 8, 8);
    r(flash || '#7d6b4c', 10, 13, 8, 1);
    r(flash || '#3a2c1c', 11, 13, 2, 6);
    r(flash || '#3a2c1c', 10, 19, 8, 2);
    r(flash || (captain ? '#c9a94c' : '#8a7a54'), 13, 19, 2, 2);
    // Arms, the right one reaching across to the grip
    r(cloak, 7, 13, 3, 7);
    r(skin, 7, 19, 3, 2);
    r(cloak, 18, 14, 3, 5);
    r(skin, 19, 18, 4, 3);
    // Head under the hood, eyes above a scarf
    r(skin, 10, 6, 8, 7);
    r(flash || '#8f6a46', 10, 6, 1, 7);
    r('#efe9dc', 11, 8, 2, 2);
    r('#efe9dc', 15, 8, 2, 2);
    r('#20242c', 12, 8, 1, 2);
    r('#20242c', 15, 8, 1, 2);
    r(flash || (captain ? '#efe6d6' : '#e6ddcc'), 10, 10, 8, 3);
    r(flash || (captain ? '#cec4b2' : '#c5bba7'), 10, 12, 8, 1);
    if (kind === 'highwayman') {
      // Wide-brimmed hat: a horizontal silhouette no other humanoid has
      r(cloak, 4, 5, 20, 2);
      r(cloakLit, 4, 5, 20, 1);
      r(cloak, 9, 1, 10, 4);
      r(cloakLit, 9, 1, 10, 1);
      r(flash || '#8a7a54', 9, 4, 10, 1);
    } else {
      // Peaked hood falling to the shoulders
      r(cloak, 9, 3, 10, 4);
      r(cloakLit, 9, 3, 10, 1);
      r(cloak, 8, 6, 12, 2);
      r(cloak, 8, 8, 2, 5);
      r(cloak, 18, 8, 2, 5);
      r(cloakDark, 8, 11, 2, 2);
      r(cloakDark, 18, 11, 2, 2);
    }
    if (captain) {
      r(flash || '#d24a3a', 15, 0, 3, 4);
      r(flash || '#f06a52', 15, 0, 1, 3);
    }
    // Drawn blade — a curved sabre for the highwayman, a straight one for the rest
    if (kind === 'highwayman') {
      r(flash || '#c4ccd6', 22, 9, 2, 3);
      r(flash || '#c4ccd6', 23, 12, 2, 4);
      r(flash || '#c4ccd6', 22, 16, 2, 3);
      r(flash || '#eef3fa', 22, 9, 1, 3);
      r(flash || '#eef3fa', 23, 12, 1, 4);
      r(flash || '#8a8f98', 21, 19, 4, 1);
      r(flash || '#3f2f1e', 22, 20, 2, 3);
    } else {
      r(flash || '#c4ccd6', 22, 7, 2, 12);
      r(flash || '#eef3fa', 22, 7, 1, 12);
      r(flash || (captain ? '#c9a94c' : '#8a8f98'), 20, 19, 6, 1);
      r(flash || '#3f2f1e', 22, 20, 2, 3);
    }
  }

  /**
   * Ghoul and zombie were the same drawing in different colours: a torso rect,
   * a head rect, two eyes. The ghoul is now the crouched one — knees folded,
   * head thrust low and forward, long arms braced on the ground ahead of it —
   * while the zombie stands upright and lopsided. That difference is legible in
   * outline alone, which is the whole point.
   */
  private drawGhoul(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#8a7a62';
    const pale = flash || '#a4947a';
    const dark = flash || '#5e5241';
    // Folded haunches and clawed feet
    r(hide, 12, 18, 5, 6);
    r(dark, 12, 22, 5, 2);
    r(hide, 10, 23, 4, 3);
    r(hide, 17, 23, 4, 3);
    r('#d8cfb4', 9, 25, 2, 2);
    r('#d8cfb4', 20, 25, 2, 2);
    // Hunched back, spine ridged through the skin
    r(hide, 10, 10, 10, 9);
    r(pale, 10, 10, 10, 1);
    r(dark, 11, 12, 8, 1);
    r(dark, 11, 15, 8, 1);
    r(dark, 14, 10, 2, 9);
    // Long arms braced forward, elbows above the shoulder line
    r(hide, 5, 11, 4, 5);
    r(hide, 3, 15, 3, 7);
    r(dark, 3, 15, 1, 7);
    r(hide, 20, 11, 4, 5);
    r(hide, 23, 15, 3, 7);
    // Hooked claws
    r('#d8cfb4', 2, 21, 2, 4);
    r('#d8cfb4', 5, 21, 1, 4);
    r('#d8cfb4', 23, 21, 1, 4);
    r('#d8cfb4', 25, 21, 2, 4);
    // Head thrust low and forward off the shoulders
    r(hide, 8, 3, 10, 8);
    r(pale, 8, 3, 10, 1);
    r(dark, 8, 3, 1, 8);
    // Sunken sockets with a sick green light in them
    r(flash || '#2a2a1c', 9, 5, 4, 3);
    r(flash || '#2a2a1c', 14, 5, 4, 3);
    r('#7cf05a', 10, 6, 2, 2);
    r('#7cf05a', 15, 6, 2, 2);
    // Distended jaw hanging open, needle teeth
    r(flash || '#39281c', 9, 8, 9, 3);
    r('#e6dcc0', 9, 8, 1, 2);
    r('#e6dcc0', 11, 8, 1, 3);
    r('#e6dcc0', 13, 8, 1, 2);
    r('#e6dcc0', 15, 8, 1, 3);
    r('#e6dcc0', 17, 8, 1, 2);
    r('#a8484c', 12, 10, 4, 2);
  }

  /**
   * An owlbear is a bear that lost an argument with an owl, and the read is the
   * join: a wide feathered facial disc with ear tufts sitting on a bear's mass,
   * with the shoulders humped above the head. The old one was a brown box with
   * a smaller brown box on top and yellow squares for eyes.
   */
  private drawOwlbear(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#6b4423';
    const lit = flash || '#8a5c33';
    const dark = flash || '#4a2d16';
    const plume = flash || '#a58a5c';
    // Hind legs and heavy black claws
    r(fur, 4, 20, 7, 6);
    r(fur, 17, 20, 7, 6);
    r(dark, 4, 24, 7, 1);
    r(dark, 17, 24, 7, 1);
    r(flash || '#eae2cc', 3, 25, 2, 3);
    r(flash || '#eae2cc', 6, 25, 2, 3);
    r(flash || '#eae2cc', 20, 25, 2, 3);
    r(flash || '#eae2cc', 23, 25, 2, 3);
    // Humped bear shoulders, wider than anything else in the low bestiary
    r(fur, 2, 12, 24, 10);
    r(lit, 3, 12, 22, 1);
    r(dark, 2, 12, 2, 10);
    r(dark, 2, 20, 24, 2);
    r(lit, 10, 15, 8, 5);
    // Forelimbs reaching forward, claws out
    r(fur, 0, 16, 4, 7);
    r(fur, 24, 16, 4, 7);
    r(flash || '#eae2cc', 0, 22, 2, 4);
    r(flash || '#eae2cc', 3, 22, 1, 4);
    r(flash || '#eae2cc', 24, 22, 1, 4);
    r(flash || '#eae2cc', 26, 22, 2, 4);
    // Owl facial disc, set low between the shoulders
    r(plume, 7, 2, 14, 11);
    r(flash || '#c2a97a', 7, 2, 14, 1);
    r(flash || '#836b45', 7, 2, 1, 11);
    r(fur, 7, 2, 3, 3);
    r(fur, 18, 2, 3, 3);
    // Ear tufts
    r(fur, 7, 0, 3, 3);
    r(fur, 18, 0, 3, 3);
    r(dark, 8, 0, 1, 3);
    r(dark, 19, 0, 1, 3);
    // Huge forward-facing eyes with a ring of dark feather around each
    r(dark, 8, 4, 6, 6);
    r(dark, 15, 4, 6, 6);
    r('#ffd83a', 9, 5, 4, 4);
    r('#ffd83a', 16, 5, 4, 4);
    r('#120e08', 10, 6, 2, 3);
    r('#120e08', 17, 6, 2, 3);
    r('#fff6d0', 10, 6, 1, 1);
    r('#fff6d0', 17, 6, 1, 1);
    // Hooked beak
    r(flash || '#e8a020', 12, 9, 5, 3);
    r(flash || '#ffc850', 12, 9, 5, 1);
    r(flash || '#b06c10', 13, 12, 3, 2);
  }

  /**
   * The cube is the joke of the dungeon and it should land: what sells it is
   * not the green rectangle but what is suspended in it — a half-digested
   * adventurer, his shield, and the coins he was carrying, hanging at
   * different depths. The jelly is kept above the 96/255 the effects pass
   * calls solid so the block still gets its rim and its shading; the corners
   * are stepped in a pixel so it reads as a body of jelly rather than a poster.
   */
  private drawCube(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const body = flash || 'rgba(146, 226, 150, 0.55)';
    const deep = flash || 'rgba(74, 156, 90, 0.55)';
    const bodyLit = flash || 'rgba(196, 250, 196, 0.62)';
    const edge = flash || 'rgba(220, 255, 220, 0.85)';
    const bone = flash || 'rgba(242, 240, 226, 0.94)';
    const boneDim = flash || 'rgba(196, 192, 170, 0.88)';
    const socket = flash || 'rgba(38, 70, 44, 0.9)';
    const metal = flash || 'rgba(148, 158, 175, 0.9)';
    const gold = flash || 'rgba(228, 192, 72, 0.92)';
    // The block, corners stepped in
    r(body, 3, 1, 22, 26);
    r(body, 1, 3, 26, 22);
    r(deep, 5, 7, 18, 15);
    // Light coming through the top face and running down the near edges
    r(bodyLit, 3, 1, 22, 4);
    r(edge, 4, 1, 20, 1);
    r(edge, 1, 4, 1, 20);
    r(edge, 26, 4, 1, 20);
    r(edge, 4, 26, 20, 1);
    r(edge, 5, 4, 3, 2); // specular
    r(edge, 7, 6, 2, 2);
    // The last adventurer, hanging where the jelly stopped him
    r(bone, 10, 7, 7, 6);
    r(socket, 11, 9, 2, 2);
    r(socket, 14, 9, 2, 2);
    r(socket, 13, 11, 1, 2);
    r(boneDim, 11, 13, 5, 1); // jaw
    r(boneDim, 12, 14, 3, 8); // spine
    r(boneDim, 9, 16, 9, 1); // ribs
    r(boneDim, 10, 19, 7, 1);
    r(boneDim, 6, 12, 2, 7); // an arm bone drifted loose
    r(boneDim, 5, 18, 4, 2);
    r(boneDim, 18, 20, 2, 5);
    // His shield and his purse, still going down
    r(metal, 17, 13, 6, 6);
    r(flash || 'rgba(196, 206, 222, 0.9)', 17, 13, 6, 1);
    r(flash || 'rgba(104, 112, 128, 0.9)', 19, 15, 2, 2);
    r(gold, 7, 22, 2, 2);
    r(gold, 11, 23, 2, 2);
    r(gold, 21, 21, 2, 2);
  }

  /**
   * The illithid is a set-piece the party meets once and remembers, and it was
   * a purple rectangle with a magenta stripe. Everything memorable about it is
   * anatomy: the bulbous swept-back cranium, the four tentacles hanging past
   * the collarbone and curling out at the tips, milk-white eyes with no pupils,
   * and the high-collared robe that says this thing is a scholar rather than a
   * beast. The head is deliberately too big for the shoulders.
   */
  private drawMindFlayer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#8f6fb0';
    const lit = flash || '#b895d4';
    const dark = flash || '#583f73';
    const robe = flash || '#1f2a3f';
    const robeLit = flash || '#354661';
    const robeDark = flash || '#111826';
    const trim = flash || '#a58a3c';
    // Robe: narrow at the waist, flaring to a hem on the floor
    r(robe, 9, 15, 10, 8);
    r(robe, 7, 20, 14, 7);
    r(robeLit, 9, 15, 10, 1);
    r(robeDark, 7, 25, 14, 2);
    r(robeDark, 11, 20, 1, 6);
    r(robeDark, 16, 20, 1, 6);
    // Shoulders and the high collar standing behind the head
    r(robe, 5, 11, 18, 5);
    r(robeLit, 5, 11, 18, 1);
    r(trim, 5, 15, 18, 1);
    r(robe, 4, 5, 4, 7);
    r(robe, 20, 5, 4, 7);
    r(robeLit, 4, 5, 1, 7);
    r(robeLit, 23, 5, 1, 7);
    // Long arms, long fingers
    r(robe, 3, 13, 4, 7);
    r(robe, 21, 13, 4, 7);
    r(skin, 2, 19, 4, 3);
    r(skin, 22, 19, 4, 3);
    r(dark, 2, 22, 1, 3);
    r(dark, 4, 22, 1, 3);
    r(dark, 23, 22, 1, 3);
    r(dark, 25, 22, 1, 3);
    // Cranium, swept back and too heavy for the neck
    r(skin, 9, 0, 11, 9);
    r(lit, 9, 0, 11, 1);
    r(dark, 9, 0, 1, 9);
    r(skin, 10, 9, 9, 3);
    r(dark, 9, 4, 11, 1); // brow
    r(lit, 11, 1, 6, 1);
    // Milk-white eyes, no pupils
    r('#e9f3ff', 10, 5, 4, 2);
    r('#e9f3ff', 16, 5, 3, 2);
    r(flash || '#93aac6', 10, 6, 4, 1);
    r(flash || '#93aac6', 16, 6, 3, 1);
    // Four tentacles falling over the chest, curling out at the tips
    r(skin, 10, 11, 2, 5);
    r(skin, 9, 15, 2, 3);
    r(dark, 7, 17, 3, 2);
    r(skin, 12, 11, 2, 8);
    r(skin, 12, 18, 2, 3);
    r(dark, 10, 20, 3, 2);
    r(skin, 15, 11, 2, 8);
    r(skin, 15, 18, 2, 3);
    r(dark, 16, 20, 3, 2);
    r(skin, 17, 11, 2, 5);
    r(skin, 18, 15, 2, 3);
    r(dark, 19, 17, 3, 2);
    r(lit, 10, 11, 1, 4);
    r(lit, 12, 11, 1, 6);
    r(lit, 15, 11, 1, 6);
    r(lit, 17, 11, 1, 4);
  }

  /**
   * The one dragon drawing, wearing whatever palette it is handed. A dragon is
   * the set-piece of a campaign and every one of them was five flat rectangles
   * in a different colour, so this is the piece of the bestiary worth drawing
   * properly once and reusing: rearing side-on, one wing spread over the back,
   * the neck in an S, jaws open on the breath, tail sweeping behind.
   *
   * `age` is what separates the wyrmlings from the great wyrms at a size where
   * nothing can actually get bigger — an ancient gets a crown of horns, a full
   * row of back spines and a second wing behind the first; an adult gets the
   * spines; a young dragon gets neither and reads as a lean animal.
   */
  private drawDragonPalette(
    ctx: CanvasRenderingContext2D,
    s: number,
    flash?: string,
    body = '#cc2222',
    wing = '#aa0000',
    breath = '#ff8800',
    horn = '#e8dcc0',
    age: 'young' | 'adult' | 'ancient' = 'adult',
  ) {
    const r = this.grid(ctx, s);
    const c = flash || body;
    const memb = flash || wing;
    const hornC = flash || horn;
    const dark = flash || this.shade(body, -0.38);
    const lit = flash || this.shade(body, 0.28);
    const belly = flash || this.shade(body, 0.52);
    // A second wing showing behind the first, for the oldest only
    if (age === 'ancient') {
      r(dark, 0, 0, 9, 5);
      r(dark, 6, 2, 8, 5);
    }
    // Wing spread over the back
    r(memb, 1, 2, 8, 7);
    r(memb, 7, 4, 7, 8);
    r(memb, 12, 6, 6, 7);
    r(dark, 1, 2, 8, 1);
    r(dark, 7, 4, 7, 1);
    r(dark, 12, 6, 6, 1);
    r(dark, 6, 4, 1, 7); // wing struts
    r(dark, 11, 6, 1, 6);
    r(hornC, 0, 1, 2, 2); // wing claw
    // Tail sweeping out behind
    r(c, 0, 21, 8, 3);
    r(c, 5, 17, 8, 5);
    r(lit, 5, 17, 8, 1);
    if (age !== 'young') {
      r(hornC, 1, 19, 2, 2);
      r(hornC, 4, 17, 2, 2);
    }
    // Barrel body and pale belly plates
    r(c, 9, 13, 12, 9);
    r(lit, 9, 13, 12, 1);
    r(dark, 9, 20, 12, 2);
    r(belly, 11, 18, 9, 3);
    r(dark, 13, 18, 1, 3);
    r(dark, 17, 18, 1, 3);
    // Legs, clawed
    r(c, 9, 20, 6, 5);
    r(dark, 10, 24, 5, 2);
    r(c, 8, 25, 7, 2);
    r(c, 16, 19, 5, 6);
    r(dark, 16, 24, 5, 2);
    r(c, 15, 25, 7, 2);
    r(hornC, 8, 26, 1, 1);
    r(hornC, 12, 26, 1, 1);
    r(hornC, 15, 26, 1, 1);
    r(hornC, 20, 26, 1, 1);
    // Back spines
    if (age !== 'young') {
      r(hornC, 10, 11, 2, 3);
      r(hornC, 14, 10, 2, 4);
      r(hornC, 18, 10, 2, 4);
    }
    // Neck rising in an S to the head
    r(c, 17, 7, 5, 8);
    r(lit, 17, 7, 1, 8);
    r(c, 19, 3, 8, 5);
    r(lit, 19, 3, 8, 1);
    r(dark, 19, 3, 1, 5);
    // Jaws open on the breath
    r(dark, 21, 8, 7, 2);
    r(c, 25, 5, 3, 3);
    r(flash || breath, 22, 8, 5, 1);
    r('#f8f2e0', 22, 7, 1, 1);
    r('#f8f2e0', 25, 7, 1, 1);
    r('#f8f2e0', 23, 9, 1, 1);
    r('#f8f2e0', 26, 9, 1, 1);
    // Eye
    r('#ffd23a', 22, 4, 3, 2);
    r('#20140a', 23, 4, 1, 2);
    // Horns, swept back off the skull
    r(hornC, 15, 1, 5, 2);
    r(hornC, 18, 2, 3, 2);
    if (age === 'ancient') {
      r(hornC, 14, 4, 5, 2);
      r(hornC, 17, 0, 3, 2);
      r(hornC, 21, 0, 2, 3);
      r(hornC, 24, 1, 2, 2);
    } else if (age === 'adult') {
      r(hornC, 15, 4, 4, 2);
    }
  }

  /**
   * Lighten or darken a hex colour, so a dragon can be described by one body
   * colour and still get a lit edge, a shadowed underside and a pale belly
   * that all belong to the same hide.
   */
  private shade(hex: string, amount: number): string {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v =>
      Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)),
    );
    return '#' + ch.map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, '0')).join('');
  }

  private drawDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#b02424', '#7d1616', '#ff8c1a', '#e8dcc0', 'young');
  }

  /**
   * The most recognisable monster in the game had the least drawing in it: a
   * purple square, a cyan square, and six eyestalks placed by trigonometry
   * that landed on fractional pixels and blurred. It is rebuilt from the three
   * things everybody knows about a beholder — the sphere, the enormous central
   * eye, the crescent of teeth under it — with the stalks drawn as jointed
   * stems fanning off the crown rather than laid around the equator.
   */
  private drawBeholder(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7a4a72';
    const lit = flash || '#a06f96';
    const dark = flash || '#452643';
    const pod = flash || '#c9a2bd';
    // Eyestalks first, so the sphere sits in front of where they root
    const stalk = (pts: [number, number][], ex: number, ey: number) => {
      for (const [x, y] of pts) r(hide, x, y, 2, 3);
      r(pod, ex, ey, 4, 3);
      r(flash || '#ffe14a', ex + 1, ey + 1, 3, 2);
      r(flash || '#1c1004', ex + 2, ey + 1, 1, 2);
    };
    stalk([[7, 8], [5, 6], [3, 4]], 0, 2);
    stalk([[9, 5], [7, 3]], 4, 0);
    stalk([[12, 3], [11, 1]], 9, 0);
    stalk([[16, 3], [17, 1]], 15, 0);
    stalk([[19, 5], [21, 3]], 20, 0);
    stalk([[21, 8], [23, 6], [25, 4]], 24, 2);
    // The sphere, corners stepped off
    r(hide, 7, 7, 15, 19);
    r(hide, 5, 10, 19, 13);
    r(lit, 8, 7, 13, 1);
    r(lit, 5, 11, 1, 10);
    r(dark, 8, 24, 13, 2);
    r(dark, 23, 12, 1, 9);
    r(dark, 18, 9, 3, 2); // hide blotches
    r(dark, 7, 20, 3, 2);
    // The central eye, lidded above and below
    r(dark, 8, 8, 13, 2);
    r(flash || '#f2f5ff', 8, 10, 13, 7);
    r(flash || '#b9c4d8', 8, 10, 13, 1);
    r(flash || '#3fd4e8', 10, 11, 9, 5);
    r(flash || '#0b1d28', 12, 12, 5, 4);
    r('#ffffff', 13, 12, 1, 1);
    r(dark, 8, 17, 13, 1);
    // The maw, a crescent of uneven teeth
    r(flash || '#2c0e24', 8, 19, 13, 6);
    r(lit, 8, 18, 13, 1);
    r('#efe6cc', 9, 19, 2, 3);
    r('#efe6cc', 12, 19, 2, 4);
    r('#efe6cc', 16, 19, 2, 3);
    r('#efe6cc', 19, 19, 2, 4);
    r('#d8ceb2', 10, 22, 2, 3);
    r('#d8ceb2', 14, 22, 3, 3);
    r('#d8ceb2', 18, 22, 2, 3);
  }

  // ── Shared giant silhouette ──────────────────────

  private drawGiantFrame(ctx: CanvasRenderingContext2D, s: number, flash: string | undefined, skin: string, hair: string, weapon: 'club' | 'axe' | 'sword') {
    const c = flash || skin;
    // Body + head
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.5, s * 0.48);
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.34, s * 0.22);
    // Hair + beard
    ctx.fillStyle = hair;
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.38, s * 0.07);
    ctx.fillRect(s * 0.34, s * 0.26, s * 0.28, s * 0.1);
    // Eyes
    ctx.fillStyle = '#2a2118';
    ctx.fillRect(s * 0.39, s * 0.15, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.55, s * 0.15, s * 0.05, s * 0.04);
    // Weapon
    if (weapon === 'club') {
      ctx.fillStyle = '#6b5a44';
      ctx.fillRect(s * 0.78, s * 0.14, s * 0.08, s * 0.64);
    } else if (weapon === 'axe') {
      ctx.fillStyle = '#5c4a38';
      ctx.fillRect(s * 0.79, s * 0.12, s * 0.05, s * 0.68);
      ctx.fillStyle = '#9aa4ad';
      ctx.fillRect(s * 0.72, s * 0.1, s * 0.16, s * 0.12);
    } else {
      ctx.fillStyle = '#c7ccd4';
      ctx.fillRect(s * 0.78, s * 0.08, s * 0.06, s * 0.7);
      ctx.fillStyle = '#6b5a44';
      ctx.fillRect(s * 0.76, s * 0.72, s * 0.1, s * 0.05);
    }
    // Legs
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.76, s * 0.16, s * 0.22);
    ctx.fillRect(s * 0.56, s * 0.76, s * 0.16, s * 0.22);
  }

  private drawHillGiant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawGiantFrame(ctx, s, flash, '#a58d63', '#6d5a3a', 'club');
    if (!flash) {
      // Mud patches
      ctx.fillStyle = '#7d6844';
      ctx.fillRect(s * 0.3, s * 0.42, s * 0.14, s * 0.1);
      ctx.fillRect(s * 0.56, s * 0.58, s * 0.12, s * 0.09);
    }
  }

  private drawStoneGiant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawGiantFrame(ctx, s, flash, '#8d8d95', '#5c5c66', 'club');
    if (!flash) {
      // Ritual tattoos
      ctx.fillStyle = '#4a4a55';
      ctx.fillRect(s * 0.34, s * 0.38, s * 0.06, s * 0.2);
      ctx.fillRect(s * 0.58, s * 0.44, s * 0.08, s * 0.04);
      ctx.fillRect(s * 0.46, s * 0.62, s * 0.12, s * 0.03);
    }
  }

  private drawFrostGiant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawGiantFrame(ctx, s, flash, '#9fc4de', '#eef6fb', 'axe');
    if (!flash) {
      // Ice pauldrons
      ctx.fillStyle = '#dff2fc';
      ctx.fillRect(s * 0.2, s * 0.26, s * 0.12, s * 0.1);
      ctx.fillRect(s * 0.66, s * 0.26, s * 0.12, s * 0.1);
    }
  }

  private drawFireGiant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawGiantFrame(ctx, s, flash, '#4a3f41', '#ff7a1f', 'sword');
    if (!flash) {
      // Obsidian plate
      ctx.fillStyle = '#2f2a33';
      ctx.fillRect(s * 0.28, s * 0.32, s * 0.42, s * 0.22);
      ctx.fillStyle = '#ff9a3d';
      ctx.fillRect(s * 0.36, s * 0.4, s * 0.06, s * 0.03);
    }
  }

  private drawStormGiant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawGiantFrame(ctx, s, flash, '#8fa8e8', '#dfe8ff', 'sword');
    if (!flash) {
      // Lightning zigzag
      ctx.fillStyle = '#ffe95c';
      ctx.fillRect(s * 0.1, s * 0.3, s * 0.07, s * 0.1);
      ctx.fillRect(s * 0.16, s * 0.4, s * 0.07, s * 0.1);
      ctx.fillRect(s * 0.1, s * 0.5, s * 0.07, s * 0.1);
    }
  }

  /**
   * The ogre's read against the orc is proportion, not palette: a head barely
   * wider than its own jaw sunk into a body that fills the box, a gut that
   * overhangs the loincloth, and a tree-trunk club. The old one drew the belly
   * as a lighter rectangle inside a bigger rectangle and called it a body.
   */
  private drawOgre(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#b99a6b';
    const lit = flash || '#d0b083';
    const dark = flash || '#8f7350';
    // Thick legs and flat bare feet
    r(hide, 7, 22, 6, 4);
    r(hide, 15, 22, 6, 4);
    r(dark, 7, 25, 6, 1);
    r(dark, 15, 25, 6, 1);
    r(hide, 5, 26, 8, 2);
    r(hide, 15, 26, 8, 2);
    // Loincloth
    r(flash || '#5a4632', 6, 19, 16, 4);
    r(flash || '#6d5740', 6, 19, 16, 1);
    r(flash || '#463724', 6, 22, 16, 1);
    // Torso: shoulders wide, gut wider, overhanging the belt
    r(hide, 5, 8, 18, 7);
    r(hide, 4, 14, 20, 6);
    r(lit, 6, 8, 16, 1);
    r(dark, 4, 14, 2, 6);
    r(lit, 8, 15, 12, 4);
    r(dark, 6, 18, 16, 2);
    r(dark, 13, 9, 2, 5);
    // Arms, hanging heavy
    r(hide, 1, 9, 4, 10);
    r(dark, 1, 9, 1, 10);
    r(hide, 1, 18, 4, 4);
    r(hide, 23, 9, 4, 10);
    r(lit, 23, 9, 4, 1);
    // Small head sunk between the shoulders
    r(hide, 10, 2, 8, 7);
    r(lit, 10, 2, 8, 1);
    r(dark, 10, 2, 1, 7);
    r(flash || '#4a3520', 10, 1, 8, 2);
    // Dull little eyes under a heavy brow
    r(dark, 10, 4, 8, 1);
    r(flash || '#2a1c10', 11, 5, 2, 2);
    r(flash || '#2a1c10', 15, 5, 2, 2);
    r('#c8b48a', 11, 5, 1, 1);
    r('#c8b48a', 15, 5, 1, 1);
    // Slack mouth and two blunt tusks
    r(flash || '#3d2818', 11, 7, 6, 2);
    r('#efe6c8', 11, 6, 2, 3);
    r('#efe6c8', 16, 6, 2, 3);
    // Nail-studded tree-trunk club
    r(flash || '#6b4b2a', 24, 12, 3, 10);
    r(flash || '#7e5b34', 24, 12, 1, 10);
    r(flash || '#7a5730', 22, 2, 6, 10);
    r(flash || '#8d6a3d', 22, 2, 6, 1);
    r(flash || '#5b3f22', 22, 10, 6, 2);
    r('#b6bcc4', 21, 4, 2, 2);
    r('#b6bcc4', 26, 7, 2, 2);
    r('#b6bcc4', 23, 8, 2, 2);
  }

  private drawEttin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8f9a6a';
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.32, s * 0.6, s * 0.48);
    // Two heads
    ctx.fillRect(s * 0.22, s * 0.06, s * 0.26, s * 0.24);
    ctx.fillRect(s * 0.52, s * 0.06, s * 0.26, s * 0.24);
    // Faces
    ctx.fillStyle = '#331a10';
    ctx.fillRect(s * 0.28, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillStyle = '#f5edd6';
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.12, s * 0.03);
    ctx.fillRect(s * 0.6, s * 0.24, s * 0.12, s * 0.03);
    // Two clubs
    ctx.fillStyle = '#6b4b2a';
    ctx.fillRect(s * 0.06, s * 0.2, s * 0.07, s * 0.6);
    ctx.fillRect(s * 0.87, s * 0.2, s * 0.07, s * 0.6);
    ctx.fillStyle = '#55432a';
    ctx.fillRect(s * 0.04, s * 0.16, s * 0.11, s * 0.08);
    ctx.fillRect(s * 0.85, s * 0.16, s * 0.11, s * 0.08);
  }

  private drawOni(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5f7fd9';
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.5, s * 0.46);
    // Patterned silk loincloth
    ctx.fillStyle = flash || '#e8d44d';
    ctx.fillRect(s * 0.26, s * 0.72, s * 0.46, s * 0.1);
    // Head
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.36, s * 0.24);
    // Horns
    ctx.fillStyle = '#f5edd6';
    ctx.fillRect(s * 0.28, s * 0.0, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.0, s * 0.06, s * 0.1);
    // Wide grin
    ctx.fillStyle = '#fff';
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.2, s * 0.04);
    // Kanabo
    ctx.fillStyle = '#6b4b2a';
    ctx.fillRect(s * 0.76, s * 0.14, s * 0.08, s * 0.64);
    ctx.fillStyle = '#888';
    ctx.fillRect(s * 0.75, s * 0.12, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.75, s * 0.26, s * 0.1, s * 0.06);
  }

  private drawTroll(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5f7a3f';
    ctx.fillStyle = c;
    // Gaunt hunched torso
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.4, s * 0.4);
    // Long arms to the ground
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.12, s * 0.5);
    ctx.fillRect(s * 0.72, s * 0.34, s * 0.12, s * 0.5);
    // Claws
    ctx.fillStyle = '#dedac8';
    ctx.fillRect(s * 0.1, s * 0.82, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.72, s * 0.82, s * 0.14, s * 0.04);
    // Head with underbite
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.28, s * 0.2);
    ctx.fillStyle = '#eee';
    ctx.fillRect(s * 0.36, s * 0.25, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.25, s * 0.06, s * 0.05);
    // Mossy hair
    ctx.fillStyle = '#2f4a22';
    ctx.fillRect(s * 0.32, s * 0.04, s * 0.32, s * 0.06);
    // Regenerating wound
    if (!flash) {
      ctx.fillStyle = '#7a2a2a';
      ctx.fillRect(s * 0.44, s * 0.4, s * 0.1, s * 0.08);
    }
    // Bent legs
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.66, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.3);
  }

  private drawKobold(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c96a2a';
    // Small body
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.42, s * 0.28, s * 0.3);
    // Snouted head
    ctx.fillRect(s * 0.34, s * 0.22, s * 0.26, s * 0.2);
    ctx.fillStyle = flash || '#a34e1c';
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.14, s * 0.08);
    // Horns
    ctx.fillStyle = '#e8d9b0';
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.58, s * 0.16, s * 0.05, s * 0.08);
    // Red eyes
    ctx.fillStyle = '#f22';
    ctx.fillRect(s * 0.38, s * 0.28, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.48, s * 0.28, s * 0.06, s * 0.05);
    // Tail + spear
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.62, s * 0.62, s * 0.2, s * 0.05);
    ctx.fillStyle = '#76543c';
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.04, s * 0.55);
    ctx.fillStyle = '#ccc';
    ctx.fillRect(s * 0.73, s * 0.14, s * 0.06, s * 0.08);
    // Legs
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.38, s * 0.72, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.72, s * 0.1, s * 0.2);
  }

  /**
   * The zombie's read is asymmetry: the head lolls off one shoulder, one arm is
   * out straight and the other hangs dead, and it stands on a stiff leg and a
   * dragging one. A symmetrical zombie is just a green man, which is what this
   * used to be.
   */
  private drawZombie(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#7d9464';
    const lit = flash || '#94a97a';
    const dark = flash || '#59704a';
    const rot = flash || '#4a5a3a';
    // A stiff leg planted, the other dragging behind
    r(flash || '#43473a', 10, 20, 4, 6);
    r(flash || '#43473a', 16, 20, 4, 5);
    r(skin, 10, 25, 4, 2);
    r(skin, 16, 24, 5, 2);
    r(dark, 16, 24, 5, 1);
    // Torso, ribs showing through torn flesh
    r(skin, 9, 10, 11, 10);
    r(lit, 9, 10, 11, 1);
    r(rot, 9, 13, 11, 1);
    r(rot, 10, 16, 10, 1);
    r(dark, 9, 19, 11, 1);
    if (!flash) {
      r('#5a2020', 11, 14, 4, 4);
      r('#8a3028', 11, 14, 4, 1);
      r('#d8cfb4', 12, 15, 1, 3);
    }
    // One arm out straight, the other hanging limp and longer
    r(skin, 20, 11, 6, 3);
    r(lit, 20, 11, 6, 1);
    r(dark, 25, 11, 2, 3);
    r(skin, 6, 11, 3, 9);
    r(dark, 6, 11, 1, 9);
    r(skin, 6, 20, 3, 2);
    // Head lolling off the left shoulder
    r(skin, 8, 2, 9, 8);
    r(lit, 8, 2, 9, 1);
    r(dark, 8, 2, 1, 8);
    r(flash || '#3c3226', 8, 1, 9, 2);
    // Dead white eyes, one half shut
    r('#dcd8c8', 10, 4, 3, 3);
    r('#dcd8c8', 14, 5, 3, 2);
    r('#1e2418', 11, 5, 1, 2);
    r('#1e2418', 15, 5, 1, 1);
    // Slack jaw
    r(flash || '#3a2020', 10, 8, 6, 2);
    r('#c8bfa4', 11, 8, 1, 1);
    r('#c8bfa4', 14, 8, 1, 1);
  }

  private drawGnoll(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const fur = flash || '#a8894a';
    ctx.fillStyle = fur;
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.4);
    // Hyena head + muzzle
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.36, s * 0.24);
    ctx.fillStyle = flash || '#8a7038';
    ctx.fillRect(s * 0.6, s * 0.18, s * 0.16, s * 0.12);
    // Mane
    ctx.fillStyle = flash || '#6e5426';
    ctx.fillRect(s * 0.24, s * 0.08, s * 0.1, s * 0.3);
    // Eyes + teeth
    ctx.fillStyle = '#ff4020';
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.48, s * 0.18, s * 0.05, s * 0.05);
    ctx.fillStyle = '#eee';
    ctx.fillRect(s * 0.64, s * 0.27, s * 0.1, s * 0.03);
    // Glaive
    ctx.fillStyle = '#665c50';
    ctx.fillRect(s * 0.76, s * 0.15, s * 0.04, s * 0.65);
    ctx.fillStyle = '#aab0bb';
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.12, s * 0.07);
    // Legs
    ctx.fillStyle = fur;
    ctx.fillRect(s * 0.32, s * 0.74, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.74, s * 0.12, s * 0.2);
  }

  /**
   * The legs were eight horizontal bars off one side of a lump; from the front
   * the spider read as a dark brick with red dots. Legs now rise to a knee and
   * fall to a foot, four to a side, and the body is a small cephalothorax in
   * front of a big marked abdomen, seen from above.
   */
  private drawGiantSpider(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const chitin = flash || '#241f2c';
    const lit = flash || '#3b3348';
    const dark = flash || '#15121c';
    // Eight legs, each a femur out to a knee that stands above the body and a
    // tibia falling back to the floor. Drawn as a mirrored pair so the animal
    // is symmetrical about the spine; `m` reflects an x across the box.
    const m = (x: number, w: number) => 28 - x - w;
    const legs: [number, number, number, number][][] = [
      [[7, 4, 3, 2], [4, 2, 3, 2], [2, 0, 3, 2], [1, 2, 2, 5]],
      [[6, 9, 4, 2], [3, 7, 3, 2], [1, 8, 2, 6]],
      [[6, 14, 4, 2], [3, 13, 3, 2], [1, 14, 2, 6]],
      [[6, 19, 4, 2], [3, 20, 3, 2], [1, 21, 2, 6]],
    ];
    for (const limb of legs) {
      for (const [x, y, w, h] of limb) {
        r(chitin, x, y, w, h);
        r(chitin, m(x, w), y, w, h);
      }
      const [fx, fy, fw] = limb[limb.length - 1];
      r(dark, fx, fy + 4, fw, 2);
      r(dark, m(fx, fw), fy + 4, fw, 2);
    }
    // Abdomen, the bulk of the animal, behind
    r(chitin, 9, 13, 10, 12);
    r(lit, 10, 13, 8, 1);
    r(dark, 9, 13, 1, 12);
    r(dark, 10, 24, 8, 1);
    if (!flash) {
      r('#7a4dbf', 12, 16, 4, 7);
      r('#a06ee0', 12, 16, 4, 1);
      r('#3d2262', 13, 18, 2, 3);
    }
    // Cephalothorax in front
    r(chitin, 10, 6, 8, 8);
    r(lit, 11, 6, 6, 1);
    r(dark, 10, 6, 1, 8);
    // Eight eyes: two large in front, six small above
    r('#ff3a3a', 11, 9, 3, 3);
    r('#ff3a3a', 15, 9, 3, 3);
    r('#7c0e10', 11, 11, 3, 1);
    r('#7c0e10', 15, 11, 3, 1);
    r('#ff8a6a', 12, 9, 1, 1);
    r('#ff8a6a', 16, 9, 1, 1);
    r('#c22626', 11, 7, 2, 1);
    r('#c22626', 14, 7, 2, 1);
    r('#c22626', 17, 7, 2, 1);
    // Chelicerae and fangs
    r(dark, 11, 12, 7, 3);
    r('#ded6c0', 11, 14, 2, 3);
    r('#ded6c0', 16, 14, 2, 3);
  }

  private drawDireWolf(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5a5f68';
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.38, s * 0.55, s * 0.32);
    // Head + snout
    ctx.fillRect(s * 0.04, s * 0.26, s * 0.24, s * 0.24);
    ctx.fillRect(s * 0.0, s * 0.36, s * 0.1, s * 0.1);
    // Ears
    ctx.fillRect(s * 0.06, s * 0.18, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.16, s * 0.18, s * 0.06, s * 0.1);
    // Eye + fangs
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.14, s * 0.32, s * 0.06, s * 0.05);
    ctx.fillStyle = '#fff';
    ctx.fillRect(s * 0.02, s * 0.44, s * 0.06, s * 0.03);
    // Legs
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.7, s * 0.09, s * 0.26);
    ctx.fillRect(s * 0.38, s * 0.7, s * 0.09, s * 0.26);
    ctx.fillRect(s * 0.52, s * 0.7, s * 0.09, s * 0.26);
    ctx.fillRect(s * 0.64, s * 0.7, s * 0.09, s * 0.26);
    // Bushy tail
    ctx.fillRect(s * 0.74, s * 0.3, s * 0.2, s * 0.1);
  }


  /**
   * The wisp was a blue box with a paler box in it — the same silhouette as
   * the spectator and the gauth. It is a floating orb now, solid to its edge
   * so the rim can find it, with three strands trailing off it and a few
   * sparks about, and nothing square anywhere.
   */
  private drawWisp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const glow = flash || '#9fe8ff';
    const hot = flash || '#ffffff';
    const mid = flash || '#5fc4ee';
    const tail = flash || '#3a8ab0';
    // The orb
    r(mid, 10, 5, 8, 8);
    r(mid, 8, 7, 12, 4);
    r(glow, 11, 6, 6, 6);
    r(glow, 9, 8, 10, 2);
    r(hot, 12, 7, 4, 4);
    r(hot, 11, 8, 6, 2);
    // Strands trailing off it
    r(mid, 8, 12, 3, 3);
    r(tail, 6, 14, 3, 3);
    r(tail, 4, 17, 2, 3);
    r(tail, 3, 20, 2, 2);
    r(mid, 16, 12, 3, 3);
    r(tail, 18, 15, 3, 2);
    r(tail, 21, 17, 2, 3);
    r(tail, 22, 20, 2, 2);
    r(mid, 13, 13, 2, 3);
    r(tail, 13, 17, 2, 3);
    r(tail, 12, 21, 2, 2);
    r(tail, 13, 24, 2, 2);
    // Sparks
    r(glow, 6, 4, 1, 1);
    r(glow, 21, 6, 1, 1);
    r(glow, 19, 2, 1, 1);
    r(glow, 5, 10, 1, 1);
  }

  private drawManticore(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const body = flash || '#c19a52';
    // Bat wings raised
    ctx.fillStyle = flash || '#6d3a6d';
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.4, s * 0.16);
    ctx.fillRect(s * 0.26, s * 0.04, s * 0.48, s * 0.06);
    // Lion body
    ctx.fillStyle = body;
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.55, s * 0.34);
    // Man-face head
    ctx.fillRect(s * 0.08, s * 0.24, s * 0.24, s * 0.22);
    ctx.fillStyle = '#20140a';
    ctx.fillRect(s * 0.12, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.22, s * 0.3, s * 0.05, s * 0.05);
    // Dark mane
    ctx.fillStyle = flash || '#3a2412';
    ctx.fillRect(s * 0.06, s * 0.18, s * 0.28, s * 0.07);
    // Spiked tail
    ctx.fillStyle = body;
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.06, s * 0.24);
    ctx.fillStyle = '#dd3333';
    ctx.fillRect(s * 0.64, s * 0.12, s * 0.05, s * 0.09);
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.05, s * 0.09);
    ctx.fillRect(s * 0.8, s * 0.13, s * 0.05, s * 0.09);
    // Paws
    ctx.fillStyle = body;
    ctx.fillRect(s * 0.2, s * 0.72, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.72, s * 0.12, s * 0.16);
  }

  private drawWight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Rotted finery
    ctx.fillStyle = flash || '#2a2438';
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.4, s * 0.5);
    // Skull-pale face
    ctx.fillStyle = '#cfc7b8';
    ctx.fillRect(s * 0.35, s * 0.1, s * 0.3, s * 0.2);
    // Burning blue eyes
    ctx.fillStyle = '#44aaff';
    ctx.fillRect(s * 0.39, s * 0.17, s * 0.07, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.17, s * 0.07, s * 0.05);
    // Rusted crown scrap
    ctx.fillStyle = '#776650';
    ctx.fillRect(s * 0.33, s * 0.06, s * 0.34, s * 0.05);
    // Cold greatsword
    ctx.fillStyle = '#bbcddd';
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.06, s * 0.6);
    ctx.fillStyle = '#5599ff';
    ctx.fillRect(s * 0.73, s * 0.12, s * 0.08, s * 0.05);
    // Gauntlet
    ctx.fillStyle = flash || '#3a3348';
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.1, s * 0.3);
  }

  private drawMinotaur(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7a4c2c';
    const lit = flash || '#9a6740';
    const dark = flash || '#4f2f18';
    const bone = flash || '#e8dcc0';
    const boneDk = flash || '#b8a888';
    const steel = flash || '#a9b1bc';
    const steelLit = flash || '#d6dde6';
    const steelDk = flash || '#7c838d';
    // Greataxe haft, held low in the left hand
    r(flash || '#5c3f22', 2, 5, 2, 20);
    r(flash || '#71502e', 2, 5, 1, 20);
    // Legs and hooves
    r(hide, 8, 19, 5, 5);
    r(hide, 16, 19, 5, 5);
    r(dark, 8, 22, 5, 1);
    r(dark, 16, 22, 5, 1);
    r(flash || '#2c1c10', 7, 24, 6, 3);
    r(flash || '#2c1c10', 16, 24, 6, 3);
    // Loincloth and belt
    r(flash || '#5a2a22', 7, 16, 15, 4);
    r(flash || '#7a3a2e', 7, 16, 15, 1);
    r(flash || '#3a1a14', 7, 19, 15, 1);
    r(flash || '#b08a30', 7, 15, 15, 1);
    // Torso: massive, the chest split down the middle
    r(hide, 5, 8, 19, 8);
    r(lit, 5, 8, 19, 1);
    r(dark, 5, 14, 19, 1);
    r(dark, 14, 9, 1, 6);
    r(lit, 7, 10, 6, 1);
    r(lit, 16, 10, 6, 1);
    // Arms: left down to the axe grip, right hanging to a fist
    r(hide, 4, 11, 3, 7);
    r(dark, 4, 11, 1, 7);
    r(hide, 2, 17, 4, 3);
    r(hide, 24, 9, 3, 9);
    r(lit, 24, 9, 3, 1);
    r(hide, 23, 18, 4, 3);
    // Axe head: two bearded bits either side of the socket
    r(steel, 0, 6, 3, 5);
    r(steel, 4, 6, 3, 5);
    r(steelLit, 0, 6, 7, 1);
    r(steelDk, 0, 10, 3, 1);
    r(steelDk, 4, 10, 3, 1);
    r(steelDk, 2, 5, 2, 7);
    // Head, brow heavy, red eyes deep in it
    r(hide, 9, 1, 10, 8);
    r(lit, 9, 1, 10, 1);
    r(dark, 9, 1, 1, 8);
    r(dark, 9, 3, 10, 1);
    r(flash || '#2a1208', 10, 4, 3, 2);
    r(flash || '#2a1208', 15, 4, 3, 2);
    r(flash || '#ff3a1a', 11, 4, 2, 2);
    r(flash || '#ff3a1a', 15, 4, 2, 2);
    // Pale muzzle overhanging the chest, nostrils, the ring
    r(flash || '#a88462', 10, 6, 8, 4);
    r(dark, 11, 7, 2, 1);
    r(dark, 15, 7, 2, 1);
    r(flash || '#d8a838', 12, 8, 1, 2);
    r(flash || '#d8a838', 15, 8, 1, 2);
    r(flash || '#d8a838', 13, 9, 2, 1);
    // Horns from the temples, out and up; ears beneath them
    r(hide, 7, 4, 2, 2);
    r(hide, 19, 4, 2, 2);
    r(bone, 7, 2, 2, 2);
    r(bone, 5, 1, 3, 2);
    r(bone, 4, 0, 2, 2);
    r(boneDk, 7, 3, 2, 1);
    r(boneDk, 5, 2, 3, 1);
    r(bone, 19, 2, 2, 2);
    r(bone, 20, 1, 3, 2);
    r(bone, 22, 0, 2, 2);
    r(boneDk, 19, 3, 2, 1);
    r(boneDk, 20, 2, 3, 1);
    // Mane between the horns
    r(dark, 11, 0, 6, 2);
  }

  private drawBanshee(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const pale = flash || '#e8ecf2';
    // Floating gown tapering to a wisp
    ctx.fillStyle = pale;
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.34);
    ctx.fillStyle = 'rgba(220,228,240,0.75)';
    ctx.fillRect(s * 0.36, s * 0.64, s * 0.28, s * 0.16);
    ctx.fillStyle = 'rgba(220,228,240,0.4)';
    ctx.fillRect(s * 0.42, s * 0.8, s * 0.16, s * 0.14);
    // Head + streaming hair
    ctx.fillStyle = pale;
    ctx.fillRect(s * 0.36, s * 0.12, s * 0.28, s * 0.2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.4, s * 0.07);
    ctx.fillRect(s * 0.26, s * 0.14, s * 0.06, s * 0.24);
    ctx.fillRect(s * 0.68, s * 0.14, s * 0.06, s * 0.24);
    // Weeping glowing eyes
    ctx.fillStyle = '#66ccff';
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillStyle = 'rgba(110,210,255,0.6)';
    ctx.fillRect(s * 0.41, s * 0.26, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.55, s * 0.26, s * 0.04, s * 0.08);
  }

  private drawYoungWhiteDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#cfe0ea', '#9fbcd0', '#bff3ff', '#e8f4ff', 'young');
  }

  private drawAdultRedDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#a8231c', '#741612', '#ff9420', '#e8dcc0', 'adult');
  }

  private drawChimera(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const lion = flash || '#c9973f';
    // Goat hindquarters
    ctx.fillStyle = flash || '#b9b2a4';
    ctx.fillRect(s * 0.5, s * 0.4, s * 0.34, s * 0.32);
    // Dragon wing
    ctx.fillStyle = flash || '#8c1f1f';
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.42, s * 0.16);
    // Lion forequarters
    ctx.fillStyle = lion;
    ctx.fillRect(s * 0.14, s * 0.36, s * 0.4, s * 0.36);
    // Lion head + mane
    ctx.fillRect(s * 0.04, s * 0.2, s * 0.22, s * 0.22);
    ctx.fillStyle = flash || '#3a2412';
    ctx.fillRect(s * 0.02, s * 0.16, s * 0.26, s * 0.07);
    // Goat head + horn
    ctx.fillStyle = flash || '#b9b2a4';
    ctx.fillRect(s * 0.3, s * 0.16, s * 0.18, s * 0.2);
    ctx.fillRect(s * 0.28, s * 0.08, s * 0.05, s * 0.1);
    // Dragon head
    ctx.fillStyle = flash || '#a01818';
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.2, s * 0.2);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.6, s * 0.17, s * 0.05, s * 0.05);
    ctx.fillStyle = '#ff8833';
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.06, s * 0.05);
    // Paws and hooves
    ctx.fillStyle = lion;
    ctx.fillRect(s * 0.16, s * 0.72, s * 0.12, s * 0.16);
    ctx.fillStyle = flash || '#8f887b';
    ctx.fillRect(s * 0.56, s * 0.72, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.72, s * 0.72, s * 0.1, s * 0.16);
  }

  private drawMedusa(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const skin = flash || '#7fae6a';
    // Robe
    ctx.fillStyle = flash || '#5c4a7a';
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.44);
    // Green head and shoulders
    ctx.fillStyle = skin;
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.3, s * 0.2);
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.46, s * 0.06);
    // Serpent hair
    if (!flash) {
      const snakes = ['#3faf6a', '#c9a227', '#b04ab0', '#3f8faf'];
      for (let i = 0; i < 8; i++) {
        const hx = 0.28 + (i % 4) * 0.12;
        const hy = 0.04 + Math.floor(i / 4) * 0.08;
        ctx.fillStyle = snakes[i % snakes.length];
        ctx.fillRect(s * hx, s * hy, s * 0.05, s * 0.1);
      }
    }
    // Golden glowing eyes
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.39, s * 0.23, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.23, s * 0.06, s * 0.05);
  }

  private drawVrock(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#b0453a';
    // Spread wings
    ctx.fillStyle = flash || '#5e2a24';
    ctx.fillRect(s * 0.02, s * 0.14, s * 0.3, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.14, s * 0.3, s * 0.12);
    ctx.fillRect(s * 0.0, s * 0.24, s * 0.24, s * 0.08);
    ctx.fillRect(s * 0.76, s * 0.24, s * 0.24, s * 0.08);
    // Torso
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.44, s * 0.4);
    // Vulture head + beak
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.24);
    ctx.fillStyle = '#e0c26a';
    ctx.fillRect(s * 0.44, s * 0.27, s * 0.12, s * 0.11);
    // Eyes
    ctx.fillStyle = '#ffdf3f';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Talons
    ctx.fillStyle = '#d8c98a';
    ctx.fillRect(s * 0.3, s * 0.78, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.78, s * 0.14, s * 0.08);
  }

  private drawBlackPudding(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const body = flash || '#221e2b';
    const lit = flash || '#3d3549';
    const dark = flash || '#12101a';
    const sheen = flash || '#5b5470';
    // The pudding is the ooze that rears: a tall sagging mound with an
    // overhang, and strands running off its lip. Kept a shade above black
    // so it still has an edge to find on a dark floor.
    r(body, 3, 8, 22, 16);
    r(body, 6, 4, 16, 5);
    r(body, 9, 1, 10, 4);
    r(lit, 9, 1, 10, 1);
    r(lit, 6, 4, 3, 1);
    r(lit, 19, 4, 3, 1);
    r(dark, 3, 21, 22, 3);
    // Overhanging lobes, and the strands dripping off them
    r(body, 1, 12, 4, 6);
    r(body, 23, 11, 4, 7);
    r(dark, 1, 16, 4, 2);
    r(dark, 23, 16, 4, 2);
    r(body, 2, 18, 2, 5);
    r(body, 7, 24, 2, 4);
    r(body, 13, 24, 2, 3);
    r(body, 19, 24, 2, 4);
    r(body, 24, 18, 2, 4);
    // Glossy specks, solid and held off the edge so the rim survives
    r(sheen, 8, 6, 4, 2);
    r(sheen, 16, 9, 3, 2);
    r(sheen, 5, 14, 3, 2);
    r(sheen, 19, 17, 3, 2);
    // A shield it is halfway through
    r(flash || '#6a6f7a', 10, 13, 7, 7);
    r(flash || '#8d939e', 10, 13, 7, 1);
    r(flash || '#3f4048', 11, 16, 5, 4);
    r(body, 12, 18, 4, 3);
  }

  private drawBoneDevil(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const bone = flash || '#ded6bd';
    // Ribcage mass + gaps
    ctx.fillStyle = bone;
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.32, s * 0.34);
    ctx.fillStyle = '#8a8470';
    ctx.fillRect(s * 0.34, s * 0.36, s * 0.28, s * 0.03);
    ctx.fillRect(s * 0.34, s * 0.44, s * 0.28, s * 0.03);
    ctx.fillRect(s * 0.34, s * 0.52, s * 0.28, s * 0.03);
    // Skull + green hell-eyes
    ctx.fillStyle = bone;
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.26, s * 0.2);
    ctx.fillStyle = '#3adf6a';
    ctx.fillRect(s * 0.4, s * 0.15, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.15, s * 0.06, s * 0.05);
    // Hooked tail
    ctx.fillStyle = bone;
    ctx.fillRect(s * 0.66, s * 0.5, s * 0.2, s * 0.05);
    ctx.fillRect(s * 0.82, s * 0.56, s * 0.05, s * 0.14);
    // Polearm
    ctx.fillStyle = '#5c4a38';
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.04, s * 0.7);
    ctx.fillStyle = '#b9bec6';
    ctx.fillRect(s * 0.74, s * 0.06, s * 0.12, s * 0.08);
    // Legs
    ctx.fillStyle = bone;
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.07, s * 0.32);
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.07, s * 0.32);
  }

  private drawHornedDevil(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#a12517';
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.48, s * 0.46);
    // Ram horns
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(s * 0.18, s * 0.06, s * 0.14, s * 0.07);
    ctx.fillRect(s * 0.14, s * 0.11, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.68, s * 0.06, s * 0.14, s * 0.07);
    ctx.fillRect(s * 0.78, s * 0.11, s * 0.08, s * 0.06);
    // Head + burning eyes
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.4, s * 0.22);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.36, s * 0.15, s * 0.07, s * 0.05);
    ctx.fillRect(s * 0.57, s * 0.15, s * 0.07, s * 0.05);
    // Pitchfork
    ctx.fillStyle = '#4a3b2c';
    ctx.fillRect(s * 0.8, s * 0.1, s * 0.05, s * 0.7);
    ctx.fillStyle = '#cc9944';
    ctx.fillRect(s * 0.72, s * 0.04, s * 0.05, s * 0.1);
    ctx.fillRect(s * 0.8, s * 0.02, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.88, s * 0.04, s * 0.05, s * 0.1);
    // Ember cracks
    if (!flash) {
      ctx.fillStyle = '#ff7a1f';
      ctx.fillRect(s * 0.34, s * 0.4, s * 0.08, s * 0.04);
      ctx.fillRect(s * 0.56, s * 0.52, s * 0.1, s * 0.04);
    }
  }

  private drawErinyes(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Black wings behind
    ctx.fillStyle = flash || '#17151d';
    ctx.fillRect(s * 0.06, s * 0.16, s * 0.26, s * 0.34);
    ctx.fillRect(s * 0.68, s * 0.16, s * 0.26, s * 0.34);
    // War skirt + armored bodice
    ctx.fillStyle = flash || '#5a1f2e';
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.44);
    ctx.fillStyle = '#8a8f9c';
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.14);
    // Head
    ctx.fillStyle = '#e8d8ce';
    ctx.fillRect(s * 0.36, s * 0.12, s * 0.28, s * 0.2);
    ctx.fillStyle = '#2a2226';
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.06);
    // Longsword
    ctx.fillStyle = '#dfe4ea';
    ctx.fillRect(s * 0.76, s * 0.12, s * 0.05, s * 0.58);
    ctx.fillStyle = '#b98a2f';
    ctx.fillRect(s * 0.73, s * 0.68, s * 0.11, s * 0.04);
  }

  private drawRakshasa(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const fur = flash || '#d98a2b';
    // Ornate robes
    ctx.fillStyle = flash || '#7a1622';
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.44);
    ctx.fillStyle = '#d9b23f';
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.06);
    // Tiger head + stripes
    ctx.fillStyle = fur;
    ctx.fillRect(s * 0.32, s * 0.1, s * 0.36, s * 0.24);
    if (!flash) {
      ctx.fillStyle = '#3a2410';
      ctx.fillRect(s * 0.34, s * 0.12, s * 0.05, s * 0.2);
      ctx.fillRect(s * 0.61, s * 0.12, s * 0.05, s * 0.2);
      ctx.fillRect(s * 0.44, s * 0.08, s * 0.12, s * 0.05);
    }
    // Backward hands
    ctx.fillStyle = fur;
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.7, s * 0.42, s * 0.1, s * 0.12);
    ctx.fillStyle = '#e8d5b8';
    ctx.fillRect(s * 0.18, s * 0.42, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.78, s * 0.42, s * 0.04, s * 0.12);
    // Green eyes
    ctx.fillStyle = '#3fdf5f';
    ctx.fillRect(s * 0.39, s * 0.19, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.55, s * 0.19, s * 0.06, s * 0.05);
  }

  private drawMarilith(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Coiled serpent tail base
    ctx.fillStyle = flash || '#3f8f5a';
    ctx.fillRect(s * 0.14, s * 0.72, s * 0.72, s * 0.14);
    ctx.fillStyle = flash || '#2f7a48';
    ctx.fillRect(s * 0.22, s * 0.6, s * 0.56, s * 0.12);
    // Humanoid torso + head
    ctx.fillStyle = flash || '#c2453a';
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.32);
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.2);
    // Six blades fanned wide
    ctx.fillStyle = '#cdd3da';
    for (let i = 0; i < 6; i++) {
      const bx = Math.min(Math.max(0.06 + i * 0.155, 0.02), 0.92);
      ctx.fillRect(s * bx, s * (i % 2 === 0 ? 0.18 : 0.3), s * 0.035, s * 0.34);
    }
    // Eyes
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.55, s * 0.16, s * 0.05, s * 0.05);
  }

  /**
   * The balor's translucent flame aura was laid over the whole box, which put
   * half-alpha in every pixel around the sprite and so cost it its rim: it had
   * no outline against anything. The fire is drawn as solid tongues licking up
   * off the shoulders and horns instead, and the demon underneath is given the
   * two things the monster is remembered for — the lightning-forged sword and
   * the flaming whip — held out to either side.
   */
  private drawBalor(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7d1a14';
    const lit = flash || '#a83226';
    const dark = flash || '#3f0c09';
    const horn = flash || '#3a2018';
    const fire = flash || '#ff7a1f';
    const hot = flash || '#ffd54a';
    // Wings thrown wide behind the shoulders
    r(dark, 0, 2, 9, 5);
    r(dark, 1, 6, 7, 5);
    r(dark, 3, 10, 5, 4);
    r(hide, 0, 2, 9, 1);
    r(horn, 3, 3, 1, 8);
    r(dark, 19, 2, 9, 5);
    r(dark, 20, 6, 7, 5);
    r(dark, 20, 10, 5, 4);
    r(hide, 19, 2, 9, 1);
    r(horn, 24, 3, 1, 8);
    // Heavy torso and cloven legs
    r(hide, 8, 11, 12, 9);
    r(lit, 8, 11, 12, 1);
    r(dark, 8, 18, 12, 2);
    r(lit, 10, 13, 3, 5);
    r(hide, 8, 19, 5, 5);
    r(hide, 15, 19, 5, 5);
    r(horn, 7, 24, 6, 3);
    r(horn, 15, 24, 6, 3);
    // Arms out to the weapons
    r(hide, 4, 12, 5, 5);
    r(hide, 19, 12, 5, 5);
    r(dark, 3, 16, 4, 3);
    r(dark, 21, 16, 4, 3);
    // Bull head, sunk between the shoulders
    r(hide, 9, 4, 10, 8);
    r(lit, 9, 4, 10, 1);
    r(dark, 9, 4, 1, 8);
    r('#ffe95c', 10, 6, 3, 2);
    r('#ffe95c', 15, 6, 3, 2);
    r(dark, 11, 9, 6, 3);
    r('#f0e6cc', 11, 9, 1, 3);
    r('#f0e6cc', 14, 9, 1, 3);
    r('#f0e6cc', 16, 9, 1, 3);
    // Great horns
    r(horn, 6, 2, 4, 3);
    r(horn, 5, 0, 3, 3);
    r(horn, 18, 2, 4, 3);
    r(horn, 20, 0, 3, 3);
    // Fire licking off it — solid tongues, kept off the outline
    r(fire, 10, 1, 2, 4);
    r(hot, 10, 1, 1, 2);
    r(fire, 13, 0, 2, 5);
    r(hot, 13, 0, 1, 2);
    r(fire, 16, 1, 2, 4);
    r(hot, 16, 1, 1, 2);
    // Lightning sword in the right hand, flaming whip in the left
    r(flash || '#c9d4e8', 25, 5, 2, 12);
    r(flash || '#f2f7ff', 25, 5, 1, 12);
    r(flash || '#7fd8ff', 24, 3, 3, 3);
    r(horn, 24, 17, 4, 2);
    r(fire, 0, 17, 5, 2);
    r(hot, 0, 17, 5, 1);
    r(fire, 3, 19, 4, 2);
    r(fire, 1, 21, 4, 2);
    r(hot, 1, 21, 3, 1);
  }

  private drawDuergar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Stocky gray body + iron armor
    ctx.fillStyle = flash || '#6b6f76';
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.44, s * 0.44);
    // Head (pale gray, heavy brow)
    ctx.fillStyle = flash || '#9aa0a8';
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.26);
    // Flat-top helmet
    ctx.fillStyle = '#55585e';
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.4, s * 0.06);
    // Pale cavefish eyes
    ctx.fillStyle = '#e8f4ff';
    ctx.fillRect(s * 0.38, s * 0.15, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.15, s * 0.06, s * 0.05);
    // Beard
    ctx.fillStyle = flash || '#8a9099';
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.28, s * 0.08);
    // War pick + shield
    ctx.fillStyle = '#777';
    ctx.fillRect(s * 0.72, s * 0.18, s * 0.06, s * 0.5);
    ctx.fillStyle = '#999';
    ctx.fillRect(s * 0.68, s * 0.14, s * 0.14, s * 0.08);
    ctx.fillStyle = '#4a4d52';
    ctx.fillRect(s * 0.16, s * 0.36, s * 0.12, s * 0.3);
  }

  private drawRustMonster(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Segmented armored body
    ctx.fillStyle = flash || '#b07040';
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.56, s * 0.32);
    // Legs
    ctx.fillStyle = '#8a5430';
    ctx.fillRect(s * 0.24, s * 0.68, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.4, s * 0.68, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.68, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.68, s * 0.68, s * 0.06, s * 0.1);
    // Down-curved head
    ctx.fillStyle = flash || '#c08050';
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.18, s * 0.14);
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.14, s * 0.06);
    // Feathery antennae
    ctx.fillStyle = '#e0a860';
    ctx.fillRect(s * 0.32, s * 0.18, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.04, s * 0.12);
    // Glowing eye
    ctx.fillStyle = '#ffe066';
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.05, s * 0.05);
    // Rust-crusted tail
    ctx.fillStyle = '#a06038';
    ctx.fillRect(s * 0.74, s * 0.46, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.88, s * 0.5, s * 0.04, s * 0.12);
  }

  private drawStoneGolem(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Carved granite body
    ctx.fillStyle = flash || '#8f8f92';
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.48, s * 0.48);
    // Blocky head
    ctx.fillStyle = flash || '#7d7d80';
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.4, s * 0.24);
    // Runic brow and chiseled eyes
    ctx.fillStyle = '#4a6aff';
    ctx.fillRect(s * 0.36, s * 0.12, s * 0.28, s * 0.04);
    ctx.fillRect(s * 0.38, s * 0.18, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.06, s * 0.05);
    // Chest runes
    ctx.fillStyle = '#4a6aff';
    ctx.fillRect(s * 0.38, s * 0.36, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.36, s * 0.06, s * 0.06);
    // Boulder fists
    ctx.fillStyle = flash || '#7d7d80';
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.16, s * 0.2);
    // Slow-glow core
    ctx.fillStyle = '#39427a';
    ctx.fillRect(s * 0.44, s * 0.42, s * 0.12, s * 0.12);
  }

  private drawShadow(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Amorphous darkness
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : '#0c0c14';
    ctx.fillRect(s * 0.16, s * 0.22, s * 0.68, s * 0.56);
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.4, s * 0.16);
    // Wispy edges
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.3)' : '#1c1c2c';
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.82, s * 0.4, s * 0.1, s * 0.14);
    // Hollow pale eyes
    ctx.fillStyle = '#dfe6ff';
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.08, s * 0.06);
    // Grasping hand
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.45)' : '#0c0c14';
    ctx.fillRect(s * 0.66, s * 0.5, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.42, s * 0.05, s * 0.12);
  }

  private drawWraith(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Translucent shroud
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.45)' : 'rgba(22,26,44,0.85)';
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.64);
    ctx.fillRect(s * 0.24, s * 0.64, s * 0.52, s * 0.16);
    // Tattered tail
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.3)' : 'rgba(22,26,44,0.6)';
    ctx.fillRect(s * 0.2, s * 0.76, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.78, s * 0.14, s * 0.08);
    // Red pinprick eyes
    ctx.fillStyle = '#ff2244';
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.06, s * 0.06);
    // Crowned by shadow
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.35)' : 'rgba(14,16,30,0.9)';
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.32, s * 0.1);
    // Claw reaching out
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.4)' : 'rgba(30,34,56,0.9)';
    ctx.fillRect(s * 0.62, s * 0.42, s * 0.16, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.05, s * 0.12);
  }

  private drawGiantBat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Wide leathery wings
    ctx.fillStyle = flash || '#4a3b52';
    ctx.fillRect(s * 0.04, s * 0.3, s * 0.28, s * 0.22);
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.28, s * 0.22);
    // Wing membranes
    ctx.fillStyle = '#382c3f';
    ctx.fillRect(s * 0.04, s * 0.48, s * 0.28, s * 0.08);
    ctx.fillRect(s * 0.68, s * 0.48, s * 0.28, s * 0.08);
    // Hanging body
    ctx.fillStyle = flash || '#6a5a72';
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.28, s * 0.4);
    // Head with radar ears
    ctx.fillStyle = flash || '#5a4a62';
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.24, s * 0.18);
    ctx.fillRect(s * 0.34, s * 0.02, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.58, s * 0.02, s * 0.08, s * 0.14);
    // Glowing eyes + fangs
    ctx.fillStyle = '#ffcf40';
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.18, s * 0.06, s * 0.05);
    ctx.fillStyle = '#eee';
    ctx.fillRect(s * 0.46, s * 0.28, s * 0.1, s * 0.03);
    // Clawed feet
    ctx.fillStyle = flash || '#4a3b52';
    ctx.fillRect(s * 0.4, s * 0.66, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.06, s * 0.1);
  }

  private drawDretch(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#6a7a52';
    const lit = flash || '#849464';
    const dark = flash || '#4c593a';
    // Tiny bandy legs under a body far too heavy for them
    r(dark, 10, 22, 3, 4);
    r(dark, 16, 22, 3, 4);
    r(hide, 8, 25, 5, 3);
    r(hide, 16, 25, 5, 3);
    // Sagging pot belly, widest low down
    r(hide, 9, 12, 11, 4);
    r(hide, 7, 15, 15, 8);
    r(lit, 9, 12, 11, 1);
    r(dark, 7, 15, 1, 8);
    r(dark, 8, 21, 13, 2);
    r(lit, 10, 17, 9, 3);
    // Overlong flabby arms hanging past the feet
    r(hide, 3, 13, 4, 7);
    r(dark, 3, 13, 1, 7);
    r(hide, 2, 19, 4, 6);
    r(hide, 22, 13, 4, 7);
    r(hide, 23, 19, 4, 6);
    r(flash || '#241f16', 2, 24, 4, 3);
    r(flash || '#241f16', 23, 24, 4, 3);
    // Head sunk into the shoulders, no neck at all
    r(hide, 9, 4, 11, 8);
    r(lit, 9, 4, 11, 1);
    r(dark, 9, 4, 1, 8);
    // Tiny red eyes set wide
    r(flash || '#241f16', 10, 6, 3, 3);
    r(flash || '#241f16', 16, 6, 3, 3);
    r('#ff4a2a', 10, 7, 2, 2);
    r('#ff4a2a', 17, 7, 2, 2);
    // Ring of needle teeth around a lamprey maw
    r(flash || '#2c1c1c', 11, 9, 7, 4);
    r('#e8d8a0', 11, 9, 7, 1);
    r('#e8d8a0', 11, 12, 7, 1);
    r('#e8d8a0', 12, 10, 1, 2);
    r('#e8d8a0', 15, 10, 1, 2);
  }

  /**
   * The kenku was a featureless brown lozenge — the beak was six pixels wide
   * and buried under the head. It is a crow now: hooked beak jutting clear of
   * the skull, a feather ruff at the neck, and ragged wing-arms whose trailing
   * primaries break the outline.
   */
  private drawKenku(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const feather = flash || '#2f2a2c';
    const lit = flash || '#464044';
    const dark = flash || '#1c191b';
    const beak = flash || '#c9a24a';
    // Scaly bird feet
    r(dark, 10, 20, 3, 5);
    r(dark, 16, 20, 3, 5);
    r(flash || '#8f6f27', 9, 25, 5, 2);
    r(flash || '#8f6f27', 15, 25, 5, 2);
    r(flash || '#8f6f27', 9, 27, 2, 1);
    r(flash || '#8f6f27', 13, 27, 1, 1);
    r(flash || '#8f6f27', 15, 27, 1, 1);
    r(flash || '#8f6f27', 18, 27, 2, 1);
    // Body
    r(feather, 9, 11, 11, 10);
    r(lit, 9, 11, 11, 1);
    r(dark, 9, 11, 1, 10);
    r(dark, 10, 15, 9, 1);
    r(dark, 10, 18, 9, 1);
    // Wing-arms, primaries splitting into separate feathers
    r(feather, 5, 11, 4, 8);
    r(dark, 4, 18, 4, 4);
    r(dark, 3, 17, 2, 4);
    r(feather, 20, 11, 4, 8);
    r(dark, 21, 18, 4, 4);
    r(dark, 24, 17, 2, 4);
    // Feather ruff at the neck
    r(dark, 7, 9, 15, 3);
    r(lit, 8, 9, 13, 1);
    // Skull
    r(feather, 9, 2, 10, 8);
    r(lit, 9, 2, 10, 1);
    r(dark, 9, 2, 1, 8);
    // Heavy beak, tapering to a hooked tip clear of the head
    r(beak, 5, 4, 5, 5);
    r(beak, 3, 5, 2, 4);
    r(beak, 1, 6, 2, 3);
    r(flash || '#e0bd63', 5, 4, 5, 1);
    r(flash || '#8f6f27', 3, 8, 7, 1);
    r(beak, 1, 8, 2, 2);
    // Flat black eye with a single glint
    r('#d8d0c0', 11, 4, 4, 3);
    r('#0c0a0c', 11, 4, 3, 3);
    r('#d8d0c0', 12, 5, 1, 1);
  }

  /**
   * The pixie and the sprite were the same three rectangles in two palettes.
   * They are separated here by build: the pixie is broad butterfly wings
   * filling the frame with a small figure hung in the middle of them, and the
   * sprite is a much smaller creature on narrow dragonfly wings with a bow.
   */
  private drawPixie(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#f0d8bc';
    const cloth = flash || '#9fdcb6';
    const clothDark = flash || '#5fa87c';
    const wing = flash || '#d7f0ff';
    const vein = flash || '#7cc0dc';
    // Butterfly wings, upper pair broad and lower pair tapered
    r(wing, 0, 1, 10, 9);
    r(wing, 2, 10, 8, 7);
    r(wing, 18, 1, 10, 9);
    r(wing, 18, 10, 8, 7);
    r(vein, 0, 1, 10, 1);
    r(vein, 18, 1, 10, 1);
    r(vein, 4, 2, 1, 14);
    r(vein, 23, 2, 1, 14);
    r(vein, 0, 9, 10, 1);
    r(vein, 18, 9, 10, 1);
    r(flash || '#ffe99a', 2, 4, 2, 2); // wing spots
    r(flash || '#ffe99a', 24, 4, 2, 2);
    // Small figure hung between them
    r(cloth, 11, 13, 6, 7);
    r(clothDark, 11, 18, 6, 2);
    r(cloth, 10, 13, 8, 2);
    r(skin, 9, 14, 2, 5); // arms
    r(skin, 17, 14, 2, 5);
    r(skin, 11, 20, 2, 4); // legs
    r(skin, 15, 20, 2, 4);
    r(skin, 11, 24, 3, 2);
    r(skin, 14, 24, 3, 2);
    // Head with a fall of pale hair
    r(skin, 11, 7, 6, 6);
    r(flash || '#ffe6a2', 10, 5, 8, 4);
    r(flash || '#ffe6a2', 10, 8, 2, 6);
    r(flash || '#ffe6a2', 16, 8, 2, 6);
    r('#2b1f3a', 12, 10, 1, 2);
    r('#2b1f3a', 15, 10, 1, 2);
    r(flash || '#c88a80', 13, 12, 2, 1);
  }

  /** See drawPixie: this is the small, narrow-winged archer of the pair. */
  private drawSprite(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#d8c39c';
    const cloth = flash || '#3f7a3c';
    const clothLit = flash || '#5da155';
    const wing = flash || '#a8d8ff';
    const wingEdge = flash || '#5f96c8';
    // Four narrow dragonfly wings, held back and shivering
    r(wing, 3, 6, 9, 2);
    r(wing, 1, 9, 10, 2);
    r(wingEdge, 3, 6, 9, 1);
    r(wingEdge, 1, 9, 10, 1);
    r(wing, 16, 6, 9, 2);
    r(wing, 17, 9, 10, 2);
    r(wingEdge, 16, 6, 9, 1);
    r(wingEdge, 17, 9, 10, 1);
    // A deliberately small figure, side-on, at full draw
    r(cloth, 12, 12, 5, 7);
    r(clothLit, 12, 12, 5, 1);
    r(cloth, 11, 19, 6, 2);
    r(skin, 12, 21, 2, 4);
    r(skin, 15, 21, 2, 4);
    r(skin, 11, 25, 3, 2);
    r(skin, 15, 25, 3, 2);
    r(skin, 12, 7, 5, 5); // head
    r(flash || '#c8a24a', 11, 6, 7, 3); // hair
    r(flash || '#c8a24a', 17, 8, 2, 3);
    r('#22301c', 15, 9, 1, 2);
    r(skin, 9, 13, 4, 2); // bow arm out
    r(skin, 16, 13, 3, 2); // string hand back
    // Bow, drawn
    r(flash || '#6a4a2a', 8, 8, 2, 3);
    r(flash || '#6a4a2a', 7, 11, 2, 5);
    r(flash || '#6a4a2a', 8, 16, 2, 3);
    r(flash || '#e8e2d2', 10, 9, 1, 4);
    r(flash || '#e8e2d2', 10, 15, 1, 4);
    r(flash || '#dcd0a8', 8, 13, 10, 1); // arrow
    r('#c8ccd4', 17, 13, 2, 1);
  }

  /**
   * Lizardfolk, sahuagin and troglodyte were three copies of the same green
   * rectangle with a head on it — the worst silhouette collision in the set,
   * and all three are common at the CR the party spends longest at. Each now
   * owns one strong outline feature: the lizardfolk a long snout and a raised
   * tail, the sahuagin a dorsal crest and a trident, the troglodyte a wide neck
   * frill over a hunched back.
   *
   * The baron is the same body in darker scale, so the two read as one
   * people: what marks the chief is a red-tipped crest, a bone pauldron and
   * a necklace of teeth, and a stone greataxe where the warrior has a spear.
   */
  private drawLizardfolk(
    ctx: CanvasRenderingContext2D,
    s: number,
    flash?: string,
    kind: 'lizardfolk' | 'baron' = 'lizardfolk'
  ) {
    const r = this.grid(ctx, s);
    const baron = kind === 'baron';
    const scale = flash || (baron ? '#356b45' : '#3f7a4a');
    const lit = flash || (baron ? '#4d8c58' : '#569a5e');
    const dark = flash || (baron ? '#22492c' : '#2b5635');
    const belly = flash || (baron ? '#9db070' : '#93b06a');
    // Tail sweeping up and out behind
    r(scale, 19, 20, 5, 3);
    r(scale, 23, 17, 4, 3);
    r(dark, 19, 22, 5, 1);
    r(dark, 23, 19, 4, 1);
    // Digitigrade legs, clawed feet
    r(scale, 10, 20, 4, 4);
    r(scale, 15, 20, 4, 4);
    r(dark, 10, 23, 9, 1);
    r(scale, 9, 24, 6, 3);
    r(scale, 15, 24, 6, 3);
    r(flash || '#e6dcbc', 9, 26, 1, 2);
    r(flash || '#e6dcbc', 20, 26, 1, 2);
    // Torso with a pale scute belly
    r(scale, 9, 10, 11, 10);
    r(lit, 9, 10, 11, 1);
    r(dark, 9, 10, 1, 10);
    r(belly, 12, 13, 5, 7);
    r(dark, 12, 15, 5, 1);
    r(dark, 12, 18, 5, 1);
    // Arms
    r(scale, 6, 11, 3, 7);
    r(dark, 6, 11, 1, 7);
    r(scale, 20, 11, 3, 6);
    // Skull with a long snout pushed out to the left
    r(scale, 9, 2, 9, 8);
    r(lit, 9, 2, 9, 1);
    r(scale, 2, 5, 8, 4);
    r(belly, 2, 8, 8, 1);
    r(dark, 2, 5, 8, 1);
    r(flash || '#e6dcbc', 3, 8, 1, 2);
    r(flash || '#e6dcbc', 6, 8, 1, 2);
    // Slit eye
    r(flash || '#101c12', 10, 4, 4, 3);
    r(flash || '#ffe44a', 10, 5, 4, 2);
    r(flash || '#101c12', 12, 5, 1, 2);
    if (baron) {
      const bone = flash || '#e2dac0';
      const boneDk = flash || '#a89c80';
      const red = flash || '#d84a2a';
      // Crest: taller, more of it, tipped red
      r(dark, 15, 0, 2, 2);
      r(dark, 17, 0, 2, 4);
      r(dark, 19, 1, 2, 3);
      r(red, 15, 0, 2, 1);
      r(red, 17, 0, 2, 1);
      r(red, 19, 1, 2, 1);
      // Bone pauldron over the near shoulder, a necklace of teeth
      r(bone, 5, 9, 5, 3);
      r(boneDk, 5, 11, 5, 1);
      r(boneDk, 6, 10, 1, 1);
      r(boneDk, 8, 10, 1, 1);
      r(bone, 10, 11, 9, 1);
      for (const x of [11, 13, 15, 17]) r(dark, x, 11, 1, 1);
      // Stone greataxe raised on the far arm
      r(flash || '#6f5433', 23, 4, 2, 13);
      r(flash || '#8a6a48', 23, 4, 1, 13);
      r(flash || '#8a9098', 21, 1, 6, 4);
      r(flash || '#b8bec6', 22, 0, 4, 1);
      r(flash || '#5a6068', 21, 4, 6, 1);
      r(flash || '#6f5433', 23, 1, 2, 4);
    } else {
      // Crest spines off the back of the skull
      r(dark, 17, 0, 2, 4);
      r(dark, 19, 2, 2, 3);
      // Bone-tipped spear held upright
      r(flash || '#6f5433', 23, 4, 2, 12);
      r(flash || '#e2dac0', 23, 0, 2, 5);
      r(flash || '#f4eedc', 23, 0, 1, 5);
    }
  }

  private drawSatyr(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Furry lower body
    ctx.fillStyle = flash || '#8a6a3a';
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.26);
    // Human torso
    ctx.fillStyle = '#c8a878';
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.24);
    // Head with horns
    ctx.fillStyle = '#c8a878';
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.28, s * 0.24);
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(s * 0.32, s * 0.0, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.0, s * 0.08, s * 0.12);
    // Hooves
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(s * 0.34, s * 0.74, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.74, s * 0.1, s * 0.05);
    // Pipes
    ctx.fillStyle = '#caa860';
    ctx.fillRect(s * 0.6, s * 0.36, s * 0.12, s * 0.06);
  }

  private drawTroglodyte(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#78854a';
    const lit = flash || '#93a05f';
    const dark = flash || '#565f31';
    // Two puffs of the stench it fights with, kept clear of the body: the rim
    // pass skips any pixel already carrying alpha, so a haze laid over the
    // whole box would cost the troglodyte its outline against the floor.
    if (!flash) {
      r('rgba(168, 204, 100, 0.34)', 0, 9, 3, 4);
      r('rgba(168, 204, 100, 0.26)', 25, 8, 3, 5);
    }
    // Squat bowed legs, low tail behind
    r(hide, 9, 20, 5, 5);
    r(hide, 15, 20, 5, 5);
    r(dark, 9, 23, 11, 1);
    r(hide, 7, 25, 7, 3);
    r(hide, 15, 25, 7, 3);
    r(hide, 20, 19, 5, 3);
    r(hide, 24, 20, 4, 3);
    r(dark, 20, 21, 8, 1);
    // Hunched barrel body, back higher than the shoulders
    r(hide, 8, 11, 12, 10);
    r(lit, 9, 11, 11, 1);
    r(dark, 8, 11, 1, 10);
    r(dark, 9, 15, 11, 1);
    r(dark, 9, 18, 11, 1);
    // Long arms hanging past the knee, black claws
    r(hide, 5, 12, 3, 9);
    r(hide, 20, 12, 3, 9);
    r(flash || '#2a2a1c', 4, 21, 4, 3);
    r(flash || '#2a2a1c', 20, 21, 4, 3);
    // Head pushed forward and down
    r(hide, 9, 4, 10, 8);
    r(lit, 9, 4, 10, 1);
    r(dark, 9, 4, 1, 8);
    // Neck frill fanning out behind the skull — the troglodyte's outline
    r(dark, 5, 1, 18, 4);
    r(lit, 5, 1, 18, 1);
    r(dark, 3, 3, 3, 4);
    r(dark, 22, 3, 3, 4);
    r(flash || '#4a5a2a', 8, 2, 1, 3);
    r(flash || '#4a5a2a', 13, 1, 1, 4);
    r(flash || '#4a5a2a', 19, 2, 1, 3);
    // Sullen red eyes and a lipless mouth
    r(flash || '#231f12', 10, 6, 3, 3);
    r(flash || '#231f12', 15, 6, 3, 3);
    r('#ff4a2a', 10, 7, 3, 2);
    r('#ff4a2a', 15, 7, 3, 2);
    r(flash || '#2c2618', 10, 10, 8, 2);
    r('#ddd4b0', 11, 10, 1, 2);
    r('#ddd4b0', 14, 10, 1, 2);
    r('#ddd4b0', 17, 10, 1, 2);
  }

  private drawHobgoblin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Iron armor
    ctx.fillStyle = flash || '#5a6068';
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.48, s * 0.46);
    // Ruddy head
    ctx.fillStyle = '#b07050';
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.24);
    // Helmet
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(s * 0.3, s * 0.02, s * 0.4, s * 0.08);
    // Yellow eyes
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Longsword
    ctx.fillStyle = '#c8d8e8';
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.05, s * 0.5);
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.09, s * 0.05);
  }

  private drawMyconid(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Mushroom cap
    ctx.fillStyle = flash || '#c878a8';
    ctx.fillRect(s * 0.26, s * 0.1, s * 0.48, s * 0.28);
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.4, s * 0.06);
    // Pale stem body
    ctx.fillStyle = '#e8dcc8';
    ctx.fillRect(s * 0.36, s * 0.34, s * 0.28, s * 0.4);
    // Placmid eyes
    ctx.fillStyle = '#8a4a6a';
    ctx.fillRect(s * 0.4, s * 0.4, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.4, s * 0.06, s * 0.05);
    // Spores
    ctx.fillStyle = '#f8d8e8';
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.76, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.04, s * 0.04);
  }

  private drawDryad(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Bark skin body
    ctx.fillStyle = flash || '#7a5a3a';
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.32, s * 0.44);
    // Leaf-dressed head
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.24);
    // Leafy hair
    ctx.fillStyle = '#4a9a4a';
    ctx.fillRect(s * 0.32, s * 0.04, s * 0.36, s * 0.08);
    ctx.fillRect(s * 0.28, s * 0.1, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.64, s * 0.1, s * 0.08, s * 0.1);
    // Green glowing eyes
    ctx.fillStyle = '#66ff88';
    ctx.fillRect(s * 0.4, s * 0.18, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.18, s * 0.06, s * 0.05);
  }

  private drawImp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Red body
    ctx.fillStyle = flash || '#c03020';
    ctx.fillRect(s * 0.38, s * 0.36, s * 0.24, s * 0.3);
    // Head with horns
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.24);
    ctx.fillStyle = '#e8d8a0';
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.58, s * 0.08, s * 0.08, s * 0.1);
    // Bat wings
    ctx.fillStyle = '#6a1610';
    ctx.fillRect(s * 0.14, s * 0.26, s * 0.24, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.26, s * 0.24, s * 0.14);
    // Grin + eyes
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillStyle = '#e8e0c8';
    ctx.fillRect(s * 0.44, s * 0.28, s * 0.12, s * 0.04);
    // Needle tail
    ctx.fillStyle = flash || '#c03020';
    ctx.fillRect(s * 0.58, s * 0.62, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.72, s * 0.56, s * 0.05, s * 0.12);
  }

  private drawQuasit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Small green body
    ctx.fillStyle = flash || '#3a8a4a';
    ctx.fillRect(s * 0.4, s * 0.38, s * 0.2, s * 0.28);
    // Head
    ctx.fillRect(s * 0.4, s * 0.18, s * 0.2, s * 0.22);
    // Goat horns
    ctx.fillStyle = '#d8d8c8';
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.08, s * 0.08, s * 0.12);
    // Grinning teeth
    ctx.fillStyle = '#e8e0c8';
    ctx.fillRect(s * 0.42, s * 0.3, s * 0.16, s * 0.04);
    // Spindly arms
    ctx.fillStyle = flash || '#3a7a44';
    ctx.fillRect(s * 0.28, s * 0.42, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.6, s * 0.42, s * 0.12, s * 0.06);
  }

  private drawHarpy(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Vulture wings
    ctx.fillStyle = flash || '#6a5a4a';
    ctx.fillRect(s * 0.08, s * 0.2, s * 0.28, s * 0.24);
    ctx.fillRect(s * 0.64, s * 0.2, s * 0.28, s * 0.24);
    // Feathery lower body
    ctx.fillStyle = flash || '#8a7a6a';
    ctx.fillRect(s * 0.36, s * 0.5, s * 0.28, s * 0.28);
    // Pale torso
    ctx.fillStyle = '#d8c8b8';
    ctx.fillRect(s * 0.38, s * 0.34, s * 0.24, s * 0.2);
    // Hag head
    ctx.fillStyle = '#c8b8a8';
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.26);
    // Dark hair
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.06);
    // Red eyes + cruel smile
    ctx.fillStyle = '#ff4a2a';
    ctx.fillRect(s * 0.43, s * 0.18, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.52, s * 0.18, s * 0.05, s * 0.05);
  }

  private drawHippogriff(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Horse body
    ctx.fillStyle = flash || '#b8a888';
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.26);
    // Eagle head
    ctx.fillStyle = '#8a7a6a';
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.16, s * 0.14);
    // Hooked beak
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(s * 0.74, s * 0.36, s * 0.08, s * 0.05);
    // Eagle wings
    ctx.fillStyle = flash || '#9a8a78';
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.26, s * 0.2);
    ctx.fillRect(s * 0.64, s * 0.14, s * 0.26, s * 0.2);
    // Fierce eye
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.66, s * 0.32, s * 0.04, s * 0.04);
    // Legs
    ctx.fillStyle = '#a89878';
    ctx.fillRect(s * 0.3, s * 0.64, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.64, s * 0.08, s * 0.12);
  }

  private drawBugbear(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Hairy body
    ctx.fillStyle = flash || '#8a6a4a';
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.46);
    // Head with pointy ears
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.4, s * 0.26);
    ctx.fillRect(s * 0.24, s * 0.0, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.0, s * 0.1, s * 0.14);
    // Long arms
    ctx.fillStyle = flash || '#7a5c3e';
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.76, s * 0.34, s * 0.14, s * 0.3);
    // Glowing eyes + teeth
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillStyle = '#e8e0c8';
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.16, s * 0.04);
    // Morningstar
    ctx.fillStyle = '#888';
    ctx.fillRect(s * 0.84, s * 0.3, s * 0.04, s * 0.34);
    ctx.fillRect(s * 0.8, s * 0.26, s * 0.12, s * 0.08);
  }

  private drawAnkheg(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Armored insect body
    ctx.fillStyle = flash || '#6a6a4a';
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.6, s * 0.3);
    // Head
    ctx.fillRect(s * 0.1, s * 0.28, s * 0.2, s * 0.2);
    // Scything mandibles
    ctx.fillStyle = '#d8d0b8';
    ctx.fillRect(s * 0.04, s * 0.3, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.08, s * 0.04);
    // Red eye
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.14, s * 0.32, s * 0.04, s * 0.04);
    // Legs
    ctx.fillStyle = '#5a5a3e';
    ctx.fillRect(s * 0.26, s * 0.66, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.42, s * 0.66, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.58, s * 0.66, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.66, s * 0.06, s * 0.1);
    // Acid drip
    ctx.fillStyle = '#9a4';
    ctx.fillRect(s * 0.14, s * 0.44, s * 0.04, s * 0.08);
  }

  private drawGhast(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Bloated grey body
    ctx.fillStyle = flash || '#8a9a8a';
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.48, s * 0.46);
    // Gaunt head
    ctx.fillStyle = '#a8b8a8';
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.24);
    // Sunken red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Rotten teeth
    ctx.fillStyle = '#e8d8a0';
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.2, s * 0.04);
    // Clawed hands
    ctx.fillStyle = flash || '#8a9a8a';
    ctx.fillRect(s * 0.14, s * 0.36, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.36, s * 0.12, s * 0.2);
    // Stench wisps
    ctx.fillStyle = '#6a7a5a';
    ctx.fillRect(s * 0.2, s * 0.16, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.76, s * 0.18, s * 0.05, s * 0.08);
  }

  /**
   * A gargoyle crouches: knees drawn up, knuckles on the ledge, wings up
   * and out behind, horns and a heavy brow. The lord is darker stone with
   * a second pair of horns and fire showing in the cracks.
   */
  private drawGargoyle(ctx: CanvasRenderingContext2D, s: number, flash?: string, lord = false) {
    const r = this.grid(ctx, s);
    const stone = flash || (lord ? '#5e5a58' : '#7a7d82');
    const lit = flash || (lord ? '#807b78' : '#9ea2a8');
    const dark = flash || (lord ? '#3a3735' : '#4e5156');
    const eye = flash || '#ff3020';
    // Wings
    r(dark, 1, 3, 8, 6);
    r(dark, 2, 9, 6, 4);
    r(dark, 3, 13, 3, 3);
    r(stone, 1, 3, 8, 1);
    r(stone, 4, 4, 1, 9);
    r(dark, 19, 3, 8, 6);
    r(dark, 20, 9, 6, 4);
    r(dark, 22, 13, 3, 3);
    r(stone, 19, 3, 8, 1);
    r(stone, 23, 4, 1, 9);
    r(lit, 0, 2, 2, 2);
    r(lit, 26, 2, 2, 2);
    // Crouched body, knees drawn up
    r(stone, 8, 11, 12, 8);
    r(lit, 8, 11, 12, 1);
    r(dark, 8, 17, 12, 2);
    r(stone, 5, 16, 5, 7);
    r(stone, 18, 16, 5, 7);
    r(lit, 5, 16, 5, 1);
    r(lit, 18, 16, 5, 1);
    r(dark, 5, 22, 5, 2);
    r(dark, 18, 22, 5, 2);
    r(stone, 6, 24, 4, 2);
    r(stone, 18, 24, 4, 2);
    r(dark, 5, 26, 2, 1);
    r(dark, 8, 26, 2, 1);
    r(dark, 18, 26, 2, 1);
    r(dark, 21, 26, 2, 1);
    // Arms down between the knees
    r(stone, 10, 18, 3, 6);
    r(stone, 15, 18, 3, 6);
    r(dark, 9, 23, 4, 2);
    r(dark, 15, 23, 4, 2);
    // Head, brow heavy, horns
    r(stone, 9, 4, 10, 8);
    r(lit, 9, 4, 10, 1);
    r(dark, 9, 4, 1, 8);
    r(dark, 10, 6, 8, 1);
    r(eye, 11, 7, 2, 1);
    r(eye, 15, 7, 2, 1);
    r(dark, 11, 10, 6, 1);
    r(flash || '#d8d4c8', 12, 10, 1, 1);
    r(flash || '#d8d4c8', 15, 10, 1, 1);
    r(dark, 8, 1, 3, 3);
    r(dark, 7, 0, 2, 2);
    r(dark, 17, 1, 3, 3);
    r(dark, 19, 0, 2, 2);
    if (lord) {
      r(dark, 11, 0, 2, 4);
      r(dark, 15, 0, 2, 4);
      r(eye, 12, 13, 1, 4);
      r(eye, 16, 14, 1, 2);
    }
  }

  private drawGriffon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Lion body
    ctx.fillStyle = flash || '#c8a878';
    ctx.fillRect(s * 0.22, s * 0.44, s * 0.56, s * 0.26);
    // Eagle head
    ctx.fillStyle = '#8a7a5a';
    ctx.fillRect(s * 0.58, s * 0.3, s * 0.18, s * 0.16);
    // Beak
    ctx.fillStyle = '#e8d0a0';
    ctx.fillRect(s * 0.72, s * 0.36, s * 0.08, s * 0.06);
    // Huge wings
    ctx.fillStyle = flash || '#b8a878';
    ctx.fillRect(s * 0.06, s * 0.28, s * 0.3, s * 0.22);
    ctx.fillRect(s * 0.64, s * 0.1, s * 0.3, s * 0.24);
    // Fierce eye
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.62, s * 0.34, s * 0.04, s * 0.04);
    // Lion legs
    ctx.fillStyle = '#c8a878';
    ctx.fillRect(s * 0.28, s * 0.66, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.66, s * 0.08, s * 0.1);
  }

  private drawCarrionCrawler(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Segmented body
    ctx.fillStyle = flash || '#7a5a4a';
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.6, s * 0.22);
    ctx.fillRect(s * 0.16, s * 0.5, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.78, s * 0.5, s * 0.1, s * 0.12);
    // Head
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.2, s * 0.2);
    // Feathery tentacles
    ctx.fillStyle = '#e8d0b8';
    ctx.fillRect(s * 0.22, s * 0.16, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.32, s * 0.14, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.06, s * 0.12);
    // Legs
    ctx.fillStyle = '#6a4e3e';
    ctx.fillRect(s * 0.28, s * 0.64, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.44, s * 0.64, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.64, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.64, s * 0.06, s * 0.1);
  }


  private drawCentaur(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Horse body
    ctx.fillStyle = flash || '#a88868';
    ctx.fillRect(s * 0.22, s * 0.44, s * 0.56, s * 0.24);
    // Human torso
    ctx.fillStyle = '#c8a878';
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.3, s * 0.22);
    // Head
    ctx.fillRect(s * 0.44, s * 0.06, s * 0.22, s * 0.22);
    // Hair
    ctx.fillStyle = '#4a3420';
    ctx.fillRect(s * 0.42, s * 0.02, s * 0.26, s * 0.06);
    // Spear
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.05, s * 0.5);
    ctx.fillStyle = '#c8d0d8';
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.09, s * 0.06);
    // Hooves
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(s * 0.26, s * 0.66, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.6, s * 0.66, s * 0.08, s * 0.04);
  }

  private drawSeaHag(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Fish-bellied body
    ctx.fillStyle = flash || '#7a9a7a';
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.44);
    // Crone head
    ctx.fillStyle = '#b8c8a8';
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.24);
    // Seaweed hair
    ctx.fillStyle = '#3a6a3a';
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.4, s * 0.08);
    ctx.fillRect(s * 0.26, s * 0.1, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.1, s * 0.08, s * 0.14);
    // Dead-fish eyes
    ctx.fillStyle = '#e8f0e8';
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.06, s * 0.04);
    // Claws
    ctx.fillStyle = flash || '#7a9a7a';
    ctx.fillRect(s * 0.16, s * 0.38, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.72, s * 0.38, s * 0.12, s * 0.22);
  }

  private drawOchreJelly(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const body = flash || '#c9a53c';
    const lit = flash || '#f0d670';
    const dark = flash || '#8a6d1c';
    const deep = flash || '#5e4a12';
    // A jelly is always mid-split: one rounded mass with a cleft started
    // down through the crown. That notch is what tells it from the flat
    // gray ooze and the tall black pudding at 28 px.
    r(body, 3, 12, 22, 12);
    r(body, 4, 8, 9, 6);
    r(body, 15, 8, 9, 6);
    r(body, 6, 6, 5, 3);
    r(body, 17, 6, 5, 3);
    r(lit, 6, 6, 5, 1);
    r(lit, 17, 6, 5, 1);
    r(lit, 3, 13, 2, 9);
    r(lit, 4, 9, 2, 4);
    r(dark, 3, 22, 22, 2);
    r(dark, 12, 8, 1, 5);
    r(dark, 15, 8, 1, 5);
    // Thin edges where the light comes through
    r(lit, 5, 18, 3, 2);
    r(lit, 19, 19, 3, 2);
    // A ribcage still suspended in it, half eaten away
    r(flash || '#e8e2cc', 8, 13, 2, 8);
    r(flash || '#e8e2cc', 6, 14, 5, 1);
    r(flash || '#e8e2cc', 6, 17, 5, 1);
    r(flash || '#cfc7ab', 18, 13, 4, 2);
    r(flash || '#cfc7ab', 19, 16, 3, 2);
    // Runoff, and the pitting where it has already eaten through
    r(dark, 6, 24, 4, 2);
    r(dark, 18, 24, 4, 2);
    r(deep, 9, 20, 3, 2);
    r(deep, 20, 21, 3, 2);
  }

  private drawPhaseSpider(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Dark body
    ctx.fillStyle = flash || '#3a3a4a';
    ctx.fillRect(s * 0.32, s * 0.34, s * 0.36, s * 0.3);
    // Head
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.2);
    // Flickering phase glow
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : '#7a8aff';
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.06);
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.06);
    // Red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.42, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.22, s * 0.05, s * 0.05);
    // Legs
    ctx.fillStyle = flash || '#3a3a4a';
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.24, s * 0.62, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.68, s * 0.62, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.78, s * 0.4, s * 0.08, s * 0.04);
  }


  /**
   * A displacer beast is a panther with two extra pairs of legs and a pair of
   * tentacles off its shoulders, and those are the only things that keep it
   * from being a black cat: it is drawn side-on and low so all six legs show,
   * with the tentacles reared up and apart to spiked pads. The old
   * "displacement afterimage" was a translucent smear, which the rim pass
   * cannot outline; the effect is left to the pale green eyes.
   */
  private drawDisplacerBeast(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const coat = flash || '#2e3358';
    const lit = flash || '#474d80';
    const dark = flash || '#1a1d38';
    const pad = flash || '#4a4f7c';
    const spike = flash || '#b8bcd8';
    const eye = flash || '#9cf05a';
    // Tentacles from the shoulders, leaning apart, ending in spiked pads
    r(coat, 9, 9, 2, 4);
    r(coat, 8, 6, 2, 3);
    r(coat, 7, 3, 2, 3);
    r(pad, 4, 1, 6, 3);
    r(spike, 3, 1, 1, 2);
    r(spike, 5, 4, 1, 1);
    r(spike, 8, 4, 1, 1);
    r(coat, 13, 9, 2, 4);
    r(coat, 14, 6, 2, 3);
    r(coat, 15, 3, 2, 3);
    r(pad, 14, 1, 6, 3);
    r(spike, 20, 1, 1, 2);
    r(spike, 15, 4, 1, 1);
    r(spike, 18, 4, 1, 1);
    // Six legs as three near/far pairs, the far leg a step behind, with
    // enough floor between the pairs that the rim does not fuse them
    for (const x of [4, 11, 18]) {
      r(dark, x + 2, 18, 1, 6);
      r(coat, x, 19, 2, 5);
      r(dark, x, 24, 3, 2);
    }
    // Body, low and long, tail whipping up behind
    r(coat, 5, 12, 18, 7);
    r(lit, 5, 12, 18, 1);
    r(dark, 5, 17, 18, 2);
    r(coat, 22, 11, 3, 2);
    r(coat, 24, 8, 2, 4);
    r(coat, 25, 5, 2, 3);
    // Head forward and low, ears up, jaw shadowed
    r(coat, 1, 9, 8, 6);
    r(lit, 1, 9, 8, 1);
    r(coat, 2, 7, 2, 2);
    r(coat, 6, 7, 2, 2);
    r(dark, 1, 13, 5, 2);
    r(eye, 2, 10, 2, 2);
    r(eye, 6, 10, 2, 2);
    r(dark, 3, 10, 1, 2);
    r(dark, 7, 10, 1, 2);
    r(flash || '#e8e4d8', 2, 15, 1, 1);
    r(flash || '#e8e4d8', 4, 15, 1, 1);
  }


  private drawGreenHag(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Moss-green body
    ctx.fillStyle = flash || '#3a6a3a';
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.44, s * 0.44);
    // Warty head
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.26);
    // Long stringy hair
    ctx.fillStyle = '#2a4a2a';
    ctx.fillRect(s * 0.28, s * 0.04, s * 0.44, s * 0.06);
    // Needle teeth
    ctx.fillStyle = '#e8e0b8';
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.24, s * 0.04);
    // Yellow eyes
    ctx.fillStyle = '#ffe44a';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Bone necklace
    ctx.fillStyle = '#e8e0c8';
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.03);
  }

  private drawDoppelganger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Featureless gray body
    ctx.fillStyle = flash || '#8a8d92';
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.44);
    // Blank head
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.24);
    // Shifting face — warped mask lines
    ctx.fillStyle = '#6a6d72';
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.28, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.2, s * 0.04);
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.16, s * 0.04);
    // Eyes where a face should be
    ctx.fillStyle = '#d8dce4';
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.55, s * 0.14, s * 0.05, s * 0.05);
  }

  private drawYeti(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // White fur body
    ctx.fillStyle = flash || '#e8ece8';
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.46);
    // Head
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.4, s * 0.26);
    // Pale blue eyes
    ctx.fillStyle = '#7ab8ff';
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.06, s * 0.05);
    // Fangs
    ctx.fillStyle = '#c8d0c8';
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.16, s * 0.04);
    // Long arms
    ctx.fillStyle = flash || '#dcdedc';
    ctx.fillRect(s * 0.1, s * 0.36, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.76, s * 0.36, s * 0.14, s * 0.28);
  }

  private drawMummy(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Wrapped body
    ctx.fillStyle = flash || '#b8ac90';
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.46);
    // Wrap lines
    ctx.fillStyle = '#9a8e74';
    ctx.fillRect(s * 0.32, s * 0.38, s * 0.36, s * 0.03);
    ctx.fillRect(s * 0.32, s * 0.5, s * 0.36, s * 0.03);
    ctx.fillRect(s * 0.32, s * 0.62, s * 0.36, s * 0.03);
    // Wrapped head
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.22);
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.03);
    // Burning red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.06, s * 0.04);
    // Dangling wrap
    ctx.fillStyle = flash || '#c8bc9e';
    ctx.fillRect(s * 0.62, s * 0.6, s * 0.08, s * 0.12);
  }

  private drawSpecter(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Translucent shroud
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.45)' : 'rgba(160,170,200,0.55)';
    ctx.fillRect(s * 0.32, s * 0.18, s * 0.36, s * 0.56);
    ctx.fillRect(s * 0.26, s * 0.6, s * 0.48, s * 0.14);
    // Tattered bottom
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.3)' : 'rgba(140,150,180,0.45)';
    ctx.fillRect(s * 0.22, s * 0.7, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.46, s * 0.72, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.7, s * 0.12, s * 0.08);
    // Hollow eyes
    ctx.fillStyle = '#000';
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.24, s * 0.06, s * 0.06);
  }

  private drawWaterWeird(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Column of water
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : '#3a7ab8';
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.32, s * 0.56);
    // Serpentine head
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.14);
    // Curling arms
    ctx.fillStyle = '#4a8ac8';
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.34, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.4, s * 0.08, s * 0.14);
    // Gleaming eyes
    ctx.fillStyle = '#a8e0ff';
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.12, s * 0.05, s * 0.04);
  }

  /**
   * A lamia is a woman from the waist up on a lion from the waist down:
   * the lion in profile on four legs with the tail up, the torso rising
   * from its shoulders, long hair, and a golden dagger held out.
   */
  private drawLamia(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#c8a060';
    const furLit = flash || '#e2c088';
    const furDark = flash || '#8a6a38';
    const skin = flash || '#e8c8a8';
    const hair = flash || '#3a2a20';
    const gold = flash || '#e0b040';
    // Lion body
    r(fur, 4, 14, 20, 8);
    r(furLit, 4, 14, 20, 1);
    r(furDark, 4, 20, 20, 2);
    r(fur, 5, 22, 3, 5);
    r(fur, 10, 22, 3, 5);
    r(fur, 17, 22, 3, 5);
    r(fur, 22, 22, 3, 5);
    r(furDark, 4, 26, 4, 1);
    r(furDark, 9, 26, 4, 1);
    r(furDark, 16, 26, 4, 1);
    r(furDark, 21, 26, 4, 1);
    r(fur, 1, 9, 3, 6);
    r(fur, 2, 15, 2, 2);
    r(hair, 1, 7, 3, 3);
    r(furDark, 6, 16, 2, 1);
    r(furDark, 12, 17, 2, 1);
    r(furDark, 18, 16, 2, 1);
    // Torso
    r(skin, 15, 6, 6, 9);
    r(flash || '#f4dcc0', 15, 6, 6, 1);
    r(flash || '#c8a888', 15, 6, 1, 9);
    r(gold, 15, 11, 6, 1);
    r(skin, 9, 8, 6, 2);
    r(skin, 21, 7, 3, 6);
    r(skin, 22, 13, 2, 2);
    // Head and hair
    r(skin, 15, 1, 6, 6);
    r(flash || '#f4dcc0', 15, 1, 6, 1);
    r(hair, 14, 0, 8, 2);
    r(hair, 14, 2, 1, 7);
    r(hair, 21, 2, 1, 5);
    r(flash || '#caa860', 16, 3, 1, 1);
    r(flash || '#caa860', 19, 3, 1, 1);
    r(flash || '#b06050', 17, 5, 2, 1);
    // The dagger
    r(flash || '#d8dce4', 8, 3, 1, 6);
    r(gold, 7, 9, 3, 1);
    r(skin, 8, 8, 2, 2);
  }

  /**
   * The were-creatures share one frame: a hunched humanoid on digitigrade
   * legs, arms hanging long past the hip and ending in claws, the animal's
   * head sat forward on the shoulders. Boar, bear and shark were three
   * unrelated boxes; the body now says "lycanthrope" before the head and
   * hide say which one — tusks and a bristle crest, round ears and a blunt
   * pale muzzle, or a dorsal fin and a mouthful of teeth.
   */
  private drawLycanthrope(
    ctx: CanvasRenderingContext2D,
    s: number,
    flash: string | undefined,
    kind: 'boar' | 'bear' | 'shark' | 'wolf' | 'rat' | 'tiger',
    // The pack leaders: a broader torso and one mark of rank on the head.
    alpha: boolean = false
  ) {
    const r = this.grid(ctx, s);
    const P = {
      boar: { fur: '#6e5847', lit: '#8d7461', dark: '#473627', belly: '#8a7362' },
      bear: { fur: '#6d4a30', lit: '#8e6746', dark: '#47301c', belly: '#8f6f4e' },
      shark: { fur: '#4f6478', lit: '#6f8699', dark: '#33424f', belly: '#cfd8e0' },
      wolf: { fur: '#5a5560', lit: '#7c7785', dark: '#38343c', belly: '#9a96a0' },
      rat: { fur: '#6f6259', lit: '#8c7f75', dark: '#4a3f38', belly: '#d8a0a0' },
      tiger: { fur: '#c8792a', lit: '#e39a45', dark: '#7a4416', belly: '#efe1c3' },
    }[kind];
    const fur = flash || P.fur;
    const lit = flash || P.lit;
    const dark = flash || P.dark;
    const belly = flash || P.belly;
    const claw = flash || '#e9e2d2';
    const bear = kind === 'bear';
    const broad = bear || alpha;

    // Digitigrade legs: thigh forward, hock back, paw flat with claws
    r(fur, 9, 18, 4, 4);
    r(fur, 16, 18, 4, 4);
    r(dark, 8, 21, 4, 3);
    r(dark, 17, 21, 4, 3);
    r(dark, 7, 24, 5, 3);
    r(dark, 17, 24, 5, 3);
    for (const x of [7, 9, 11, 17, 19, 21]) r(claw, x, 26, 1, 1);

    // Torso, hunched: the shoulders rise to the ears
    const tx = broad ? 5 : 6;
    const tw = broad ? 19 : 17;
    r(fur, tx, 9, tw, 10);
    r(lit, tx, 9, tw, 1);
    r(dark, tx, 18, tw, 1);
    r(dark, tx, 10, 1, 8);
    r(belly, 11, 12, 7, 6);

    // Arms out past the hip, clawed hands
    r(fur, 3, 10, 4, 9);
    r(dark, 3, 10, 1, 9);
    r(fur, 2, 19, 4, 3);
    r(fur, 22, 10, 4, 9);
    r(lit, 22, 10, 4, 1);
    r(fur, 23, 19, 4, 3);
    const ch = bear ? 2 : 1;
    r(claw, 2, 22, 1, ch);
    r(claw, 4, 22, 1, ch);
    r(claw, 23, 22, 1, ch);
    r(claw, 25, 22, 1, ch);

    switch (kind) {
      case 'boar': {
        // Skull, round ears, bristle crest over the crown
        r(fur, 9, 2, 10, 8);
        r(lit, 9, 2, 10, 1);
        r(dark, 9, 2, 1, 8);
        r(fur, 7, 1, 3, 3);
        r(fur, 18, 1, 3, 3);
        r(dark, 8, 2, 1, 1);
        r(dark, 19, 2, 1, 1);
        r(dark, 11, 0, 6, 2);
        r(dark, 9, 4, 10, 1);
        // Small red eyes tight against the brow
        r(flash || '#ff3a20', 11, 5, 2, 2);
        r(flash || '#ff3a20', 15, 5, 2, 2);
        r(flash || '#3a0806', 12, 5, 1, 2);
        r(flash || '#3a0806', 15, 5, 1, 2);
        // Snout disc dropping past the jaw, tusks curling up beside it
        r(flash || '#8f6f6a', 11, 7, 6, 4);
        r(flash || '#6a4c48', 11, 10, 6, 1);
        r(dark, 12, 9, 1, 1);
        r(dark, 15, 9, 1, 1);
        r(claw, 10, 8, 1, 3);
        r(claw, 17, 8, 1, 3);
        break;
      }
      case 'bear': {
        // Broad skull, round ears, blunt pale muzzle with a black nose
        r(fur, 8, 2, 12, 8);
        r(lit, 8, 2, 12, 1);
        r(dark, 8, 2, 1, 8);
        r(fur, 7, 0, 3, 3);
        r(fur, 18, 0, 3, 3);
        r(belly, 8, 1, 1, 1);
        r(belly, 19, 1, 1, 1);
        r(dark, 8, 4, 12, 1);
        r(flash || '#1c120a', 10, 5, 3, 2);
        r(flash || '#1c120a', 15, 5, 3, 2);
        r(flash || '#e8d8b0', 11, 5, 1, 1);
        r(flash || '#e8d8b0', 16, 5, 1, 1);
        r(flash || '#b08a5c', 11, 7, 6, 4);
        r(flash || '#1a1210', 13, 7, 2, 2);
        r(dark, 12, 10, 4, 1);
        break;
      }
      case 'shark': {
        // Dorsal fin rising off the back behind the shoulder
        r(dark, 23, 1, 2, 3);
        r(dark, 22, 3, 4, 3);
        r(dark, 21, 6, 6, 3);
        r(lit, 23, 1, 1, 5);
        // Gill slits on the chest
        r(dark, 7, 11, 1, 3);
        r(dark, 9, 11, 1, 3);
        // Wedge head, pale below, eyes black and wide-set
        r(fur, 8, 2, 12, 8);
        r(lit, 8, 2, 12, 1);
        r(dark, 8, 2, 1, 8);
        r(belly, 8, 7, 12, 3);
        r(flash || '#0a0e12', 10, 4, 2, 2);
        r(flash || '#0a0e12', 16, 4, 2, 2);
        // The mouth: a gum line with teeth above and below it
        r(flash || '#4a1a22', 9, 7, 10, 3);
        for (const x of [10, 12, 14, 16, 18]) r(flash || '#f2f4f6', x, 7, 1, 1);
        for (const x of [9, 11, 13, 15, 17]) r(flash || '#f2f4f6', x, 9, 1, 1);
        break;
      }
      case 'wolf': {
        // Long muzzle thrust forward and low, ears pricked, yellow eyes
        r(fur, 8, 2, 12, 7);
        r(lit, 8, 2, 12, 1);
        r(dark, 8, 2, 1, 7);
        r(dark, 8, 0, 3, 3);
        r(dark, 17, 0, 3, 3);
        r(lit, 9, 1, 1, 1);
        r(lit, 18, 1, 1, 1);
        if (alpha) { r(dark, 7, 0, 1, 2); r(dark, 20, 0, 1, 2); }
        r(flash || '#f0c020', 11, 5, 2, 2);
        r(flash || '#f0c020', 15, 5, 2, 2);
        r(fur, 5, 6, 7, 4);
        r(belly, 5, 8, 7, 2);
        r(flash || '#16120f', 5, 6, 2, 2);
        for (const x of [7, 9, 11]) r(claw, x, 9, 1, 1);
        if (alpha) { r(belly, 14, 3, 1, 1); r(belly, 15, 4, 1, 1); r(belly, 16, 5, 1, 1); }
        break;
      }
      case 'rat': {
        // Narrow skull between two round ears, pink snout, whiskers, a tail
        r(fur, 10, 3, 9, 7);
        r(lit, 10, 3, 9, 1);
        r(dark, 10, 3, 1, 7);
        r(fur, 7, 1, 4, 4);
        r(fur, 17, 1, 4, 4);
        r(belly, 8, 2, 2, 2);
        r(belly, 18, 2, 2, 2);
        r(flash || '#0e0a0a', 12, 5, 2, 2);
        r(flash || '#0e0a0a', 16, 5, 2, 2);
        r(belly, 9, 7, 5, 3);
        r(flash || '#3a1818', 9, 8, 1, 1);
        r(claw, 5, 8, 4, 1);
        r(claw, 19, 8, 4, 1);
        r(dark, 22, 20, 5, 1);
        r(dark, 26, 16, 1, 5);
        if (alpha) {
          // A crown, sat on the brow between the ears
          r(flash || '#e8c040', 11, 1, 7, 2);
          r(flash || '#e8c040', 11, 0, 1, 1);
          r(flash || '#e8c040', 14, 0, 1, 1);
          r(flash || '#e8c040', 17, 0, 1, 1);
        }
        break;
      }
      case 'tiger': {
        // Broad striped skull, round ears, amber eyes, pale muzzle with fangs
        r(fur, 8, 2, 12, 8);
        r(lit, 8, 2, 12, 1);
        r(dark, 8, 2, 1, 8);
        r(fur, 7, 0, 3, 3);
        r(fur, 18, 0, 3, 3);
        r(dark, 10, 3, 1, 6);
        r(dark, 14, 2, 1, 3);
        r(dark, 17, 3, 1, 6);
        r(flash || '#ffb020', 11, 5, 2, 2);
        r(flash || '#ffb020', 16, 5, 2, 2);
        r(flash || '#1a1008', 12, 5, 1, 1);
        r(flash || '#1a1008', 17, 5, 1, 1);
        r(belly, 11, 7, 6, 3);
        r(flash || '#1a1210', 13, 7, 2, 1);
        r(claw, 12, 10, 1, 1);
        r(claw, 16, 10, 1, 1);
        // Stripes down the torso, doubled on the alpha
        r(dark, 8, 12, 1, 5);
        r(dark, 20, 12, 1, 5);
        if (alpha) { r(dark, 10, 11, 1, 6); r(dark, 18, 11, 1, 6); r(dark, 18, 0, 1, 1); }
        break;
      }
    }
  }

  private drawCouatl(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Radiant serpentine body
    ctx.fillStyle = flash || '#2a8a8a';
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.14);
    ctx.fillRect(s * 0.2, s * 0.52, s * 0.12, s * 0.1);
    // Golden head
    ctx.fillStyle = '#caa860';
    ctx.fillRect(s * 0.66, s * 0.28, s * 0.16, s * 0.16);
    // Radiant wings
    ctx.fillStyle = '#f8f4e8';
    ctx.fillRect(s * 0.08, s * 0.3, s * 0.24, s * 0.18);
    ctx.fillRect(s * 0.68, s * 0.1, s * 0.24, s * 0.2);
    // Glowing eye
    ctx.fillStyle = '#8a4aff';
    ctx.fillRect(s * 0.72, s * 0.32, s * 0.04, s * 0.04);
    // Feather crest
    ctx.fillStyle = '#ff6a8a';
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.08, s * 0.1);
  }

  private drawNightHag(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Violet skin body
    ctx.fillStyle = flash || '#7a5a9a';
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.44, s * 0.44);
    // Withered head
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.26);
    // Ram horns
    ctx.fillStyle = '#d8d0c0';
    ctx.fillRect(s * 0.3, s * 0.0, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.6, s * 0.0, s * 0.1, s * 0.14);
    // Burning yellow eyes
    ctx.fillStyle = '#ffe44a';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Heartstone glow
    ctx.fillStyle = '#ff6a8a';
    ctx.fillRect(s * 0.44, s * 0.42, s * 0.12, s * 0.12);
    // Soul bag
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(s * 0.66, s * 0.5, s * 0.12, s * 0.16);
  }

  private drawShamblingMound(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Heap of vines
    ctx.fillStyle = flash || '#3a5a2a';
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.6, s * 0.44);
    ctx.fillRect(s * 0.14, s * 0.44, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.76, s * 0.4, s * 0.12, s * 0.24);
    // Mossy top
    ctx.fillStyle = '#2a4a1a';
    ctx.fillRect(s * 0.26, s * 0.22, s * 0.48, s * 0.12);
    // Vine tendrils
    ctx.fillStyle = '#4a7a34';
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.05, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.08, s * 0.05, s * 0.16);
    ctx.fillRect(s * 0.6, s * 0.12, s * 0.05, s * 0.12);
    // Dull eyes in the rot
    ctx.fillStyle = '#8a6a2a';
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.3, s * 0.06, s * 0.05);
    // Lightning scar
    ctx.fillStyle = '#9ad86a';
    ctx.fillRect(s * 0.5, s * 0.2, s * 0.03, s * 0.14);
  }

  private drawUnicorn(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // White body
    ctx.fillStyle = flash || '#f0ece8';
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.24);
    // Head + neck
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.16, s * 0.18);
    // Spiraling horn
    ctx.fillStyle = '#ffd76a';
    ctx.fillRect(s * 0.62, s * 0.08, s * 0.05, s * 0.2);
    ctx.fillRect(s * 0.6, s * 0.06, s * 0.09, s * 0.04);
    // Silver mane
    ctx.fillStyle = '#d8d8e8';
    ctx.fillRect(s * 0.5, s * 0.2, s * 0.1, s * 0.16);
    // Deep blue eyes
    ctx.fillStyle = '#7a8aff';
    ctx.fillRect(s * 0.64, s * 0.3, s * 0.04, s * 0.04);
    // Legs
    ctx.fillStyle = '#e8e4e0';
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.6, s * 0.62, s * 0.08, s * 0.14);
  }

  private drawFleshGolem(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Patchwork body
    ctx.fillStyle = flash || '#9a7a6a';
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.46);
    // Stitch lines
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(s * 0.3, s * 0.38, s * 0.4, s * 0.03);
    ctx.fillRect(s * 0.44, s * 0.3, s * 0.03, s * 0.2);
    ctx.fillRect(s * 0.3, s * 0.56, s * 0.4, s * 0.03);
    // Head
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.24);
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.24, s * 0.03);
    // Dull red eyes
    ctx.fillStyle = '#b04030';
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.06, s * 0.04);
    // Heavy arms
    ctx.fillStyle = '#8a6c5e';
    ctx.fillRect(s * 0.14, s * 0.34, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.72, s * 0.34, s * 0.14, s * 0.28);
  }

  private drawXorn(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Rocky body
    ctx.fillStyle = flash || '#8a7a5a';
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.52, s * 0.34);
    // Circular maw
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.14);
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.12, s * 0.06);
    // Three eyes around the maw
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.6, s * 0.28, s * 0.05, s * 0.05);
    // Three arms
    ctx.fillStyle = '#7a6c50';
    ctx.fillRect(s * 0.16, s * 0.5, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.46, s * 0.5, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.76, s * 0.5, s * 0.08, s * 0.2);
    // Gem glint
    ctx.fillStyle = '#66e0ff';
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.05, s * 0.05);
  }

  private drawSalamander(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Serpent body
    ctx.fillStyle = flash || '#b0482a';
    ctx.fillRect(s * 0.2, s * 0.46, s * 0.6, s * 0.14);
    ctx.fillRect(s * 0.74, s * 0.4, s * 0.12, s * 0.12);
    // Humanoid torso
    ctx.fillStyle = '#c8583a';
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.24, s * 0.24);
    // Head
    ctx.fillRect(s * 0.4, s * 0.06, s * 0.2, s * 0.22);
    // Heat glow
    ctx.fillStyle = '#ff8a3a';
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.08);
    // Ember eyes
    ctx.fillStyle = '#ffe99a';
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.12, s * 0.05, s * 0.04);
    // Spear
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(s * 0.64, s * 0.3, s * 0.04, s * 0.3);
  }

  private drawGhost(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Translucent figure
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : 'rgba(200,215,235,0.5)';
    ctx.fillRect(s * 0.32, s * 0.14, s * 0.36, s * 0.6);
    ctx.fillRect(s * 0.26, s * 0.6, s * 0.48, s * 0.16);
    // Tattered ends
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.35)' : 'rgba(180,195,220,0.4)';
    ctx.fillRect(s * 0.2, s * 0.72, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.44, s * 0.74, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.72, s * 0.14, s * 0.08);
    // Hollow dark eyes
    ctx.fillStyle = '#0a1420';
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.07, s * 0.06);
    ctx.fillRect(s * 0.53, s * 0.22, s * 0.07, s * 0.06);
    // Wailing mouth
    ctx.fillRect(s * 0.46, s * 0.3, s * 0.08, s * 0.08);
  }


  private drawEarthElemental(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Mountainous rock body
    ctx.fillStyle = flash || '#8a7a5a';
    ctx.fillRect(s * 0.22, s * 0.28, s * 0.56, s * 0.48);
    // Boulders
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.2, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.36, s * 0.22, s * 0.18);
    // Crack lines
    ctx.fillStyle = '#5a4a34';
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.03);
    ctx.fillRect(s * 0.4, s * 0.56, s * 0.03, s * 0.12);
    // Molten core glow
    ctx.fillStyle = '#ff8a3a';
    ctx.fillRect(s * 0.44, s * 0.4, s * 0.12, s * 0.12);
    // Stone fists
    ctx.fillStyle = '#7a6c50';
    ctx.fillRect(s * 0.08, s * 0.36, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.78, s * 0.36, s * 0.14, s * 0.2);
  }

  private drawFireElemental(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Flame body
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : '#ff7a1f';
    ctx.fillRect(s * 0.26, s * 0.24, s * 0.48, s * 0.5);
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.16);
    // Inner flame
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.7)' : '#ffcf40';
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.28);
    // Flickering tips
    ctx.fillStyle = '#ff6a1f';
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.46, s * 0.0, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.62, s * 0.06, s * 0.08, s * 0.1);
    // Ember eyes
    ctx.fillStyle = '#fff0c0';
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.34, s * 0.06, s * 0.06);
    // Ash drift
    ctx.fillStyle = 'rgba(60,40,30,0.6)';
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.78, s * 0.5, s * 0.08, s * 0.04);
  }

  private drawWaterElemental(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Towering wave body
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : '#3a7ab8';
    ctx.fillRect(s * 0.24, s * 0.2, s * 0.52, s * 0.56);
    // Foam crest
    ctx.fillStyle = '#c8e8f8';
    ctx.fillRect(s * 0.28, s * 0.14, s * 0.44, s * 0.08);
    // Curling arms
    ctx.fillStyle = '#4a8ac8';
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.06, s * 0.42, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.76, s * 0.34, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.86, s * 0.42, s * 0.08, s * 0.14);
    // Bright eyes
    ctx.fillStyle = '#e0f4ff';
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.06, s * 0.05);
    // Drips
    ctx.fillStyle = '#6aa8e0';
    ctx.fillRect(s * 0.3, s * 0.74, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.76, s * 0.05, s * 0.06);
  }

  private drawVampireSpawn(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Pale body
    ctx.fillStyle = flash || '#c8b8a8';
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.44);
    // Head
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.26);
    // Dark hair
    ctx.fillStyle = '#2a2420';
    ctx.fillRect(s * 0.32, s * 0.04, s * 0.36, s * 0.06);
    // Red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.06, s * 0.04);
    // Fangs
    ctx.fillStyle = '#e8e0d8';
    ctx.fillRect(s * 0.44, s * 0.24, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.51, s * 0.24, s * 0.05, s * 0.06);
    // Claws
    ctx.fillStyle = '#d8c8b8';
    ctx.fillRect(s * 0.16, s * 0.38, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.72, s * 0.38, s * 0.12, s * 0.22);
  }

  private drawUmberHulk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Beetle body
    ctx.fillStyle = flash || '#8a7a4a';
    ctx.fillRect(s * 0.18, s * 0.36, s * 0.64, s * 0.34);
    // Carapace plates
    ctx.fillStyle = '#6a5c36';
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.08);
    // Head
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.36, s * 0.16);
    // Four confusing eyes
    ctx.fillStyle = '#ffe99a';
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.06, s * 0.06);
    // Mandibles
    ctx.fillStyle = '#5a4e2e';
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.52, s * 0.1, s * 0.14, s * 0.08);
    // Clawed arms
    ctx.fillStyle = flash || '#7a6c40';
    ctx.fillRect(s * 0.08, s * 0.44, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.8, s * 0.44, s * 0.12, s * 0.2);
  }

  private drawOtyugh(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Rotund body
    ctx.fillStyle = flash || '#8a6a4a';
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.52, s * 0.34);
    // Three eyes on stalks
    ctx.fillStyle = '#5a4630';
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.06, s * 0.12);
    // Red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.04, s * 0.04);
    // Tentacles
    ctx.fillStyle = '#7a5c40';
    ctx.fillRect(s * 0.12, s * 0.44, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.08, s * 0.5, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.76, s * 0.44, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.86, s * 0.5, s * 0.06, s * 0.14);
    // Tooth-ringed maw
    ctx.fillStyle = '#e8dcc8';
    ctx.fillRect(s * 0.38, s * 0.5, s * 0.24, s * 0.06);
  }

  private drawGorgon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Iron-plated bull body
    ctx.fillStyle = flash || '#6a6d74';
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.6, s * 0.26);
    // Plate seams
    ctx.fillStyle = '#54575e';
    ctx.fillRect(s * 0.28, s * 0.48, s * 0.44, s * 0.03);
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.52, s * 0.03);
    // Bull head + horns
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.32, s * 0.22);
    ctx.fillStyle = '#8a8d94';
    ctx.fillRect(s * 0.2, s * 0.16, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.16, s * 0.1, s * 0.14);
    // Furnace-red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.28, s * 0.06, s * 0.04);
    // Green vapor breath
    ctx.fillStyle = '#9ad86a';
    ctx.fillRect(s * 0.58, s * 0.3, s * 0.14, s * 0.06);
    // Hooves
    ctx.fillStyle = '#54575e';
    ctx.fillRect(s * 0.26, s * 0.66, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.6, s * 0.66, s * 0.08, s * 0.05);
  }

  private drawBullette(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Torpedo body
    ctx.fillStyle = flash || '#6a7a8a';
    ctx.fillRect(s * 0.16, s * 0.42, s * 0.68, s * 0.24);
    // Armor plates
    ctx.fillStyle = '#5a6a7a';
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.52, s * 0.08);
    // Shark-like head
    ctx.fillRect(s * 0.12, s * 0.3, s * 0.2, s * 0.18);
    // Fin ridge
    ctx.fillStyle = '#4a5a6a';
    ctx.fillRect(s * 0.44, s * 0.28, s * 0.08, s * 0.12);
    // Cold eye
    ctx.fillStyle = '#d8e8f8';
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.04, s * 0.04);
    // Jaw teeth
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(s * 0.14, s * 0.44, s * 0.16, s * 0.04);
    // Flipper legs
    ctx.fillStyle = '#5a6a7a';
    ctx.fillRect(s * 0.28, s * 0.64, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.64, s * 0.08, s * 0.06);
  }


  private drawDrider(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Spider body
    ctx.fillStyle = flash || '#4a3a5a';
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.6, s * 0.28);
    // Spider legs
    ctx.fillStyle = '#3a2c4a';
    ctx.fillRect(s * 0.1, s * 0.46, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.18, s * 0.68, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.68, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.78, s * 0.46, s * 0.12, s * 0.04);
    // Drow torso
    ctx.fillStyle = '#6a5a8a';
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.24, s * 0.24);
    // Head
    ctx.fillRect(s * 0.4, s * 0.04, s * 0.2, s * 0.22);
    // White hair
    ctx.fillStyle = '#d8dce8';
    ctx.fillRect(s * 0.38, s * 0.0, s * 0.24, s * 0.06);
    // Red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.1, s * 0.05, s * 0.04);
    // Dagger
    ctx.fillStyle = '#c8d8e8';
    ctx.fillRect(s * 0.62, s * 0.28, s * 0.04, s * 0.18);
  }

  private drawInvisibleStalker(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Barely-there wind form
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : 'rgba(200,225,245,0.3)';
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.54);
    // Swirling air lines
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.6)' : 'rgba(230,245,255,0.5)';
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.05);
    ctx.fillRect(s * 0.38, s * 0.44, s * 0.24, s * 0.05);
    ctx.fillRect(s * 0.34, s * 0.56, s * 0.32, s * 0.05);
    // Two hollow eye holes
    ctx.fillStyle = 'rgba(60,80,110,0.8)';
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.06, s * 0.05);
  }

  private drawHezrou(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Toad-demon body
    ctx.fillStyle = flash || '#4a6a3a';
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.52, s * 0.42);
    // Bulbous head
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.4, s * 0.26);
    // Lamprey mouth ring
    ctx.fillStyle = '#e8d8c8';
    ctx.fillRect(s * 0.36, s * 0.24, s * 0.28, s * 0.06);
    // Warty eyes
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.06, s * 0.05);
    // Stench miasma
    ctx.fillStyle = 'rgba(120,170,90,0.4)';
    ctx.fillRect(s * 0.12, s * 0.2, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.8, s * 0.24, s * 0.08, s * 0.1);
    // Clawed arms
    ctx.fillStyle = flash || '#3a5a2e';
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.76, s * 0.4, s * 0.14, s * 0.24);
  }

  private drawGlabrezu(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Dog-faced demon body
    ctx.fillStyle = flash || '#8a4a3a';
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.52, s * 0.42);
    // Dog head
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.28);
    // Snout
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.2, s * 0.12);
    // Crab pincers
    ctx.fillStyle = '#b8684a';
    ctx.fillRect(s * 0.06, s * 0.3, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.02, s * 0.36, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.3, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.88, s * 0.36, s * 0.1, s * 0.08);
    // Burning eyes
    ctx.fillStyle = '#ff7a2a';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Temptation glow
    ctx.fillStyle = '#ffd76a';
    ctx.fillRect(s * 0.44, s * 0.42, s * 0.12, s * 0.06);
  }

  private drawHydra(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Serpent body
    ctx.fillStyle = flash || '#3a7a4a';
    ctx.fillRect(s * 0.22, s * 0.5, s * 0.56, s * 0.2);
    // Five heads on necks
    ctx.fillStyle = '#2a6a3a';
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.38, s * 0.34, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.06, s * 0.22);
    ctx.fillRect(s * 0.58, s * 0.34, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.68, s * 0.4, s * 0.06, s * 0.12);
    // Head shapes
    ctx.fillStyle = '#3a8a4a';
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.36, s * 0.22, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.46, s * 0.18, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.28, s * 0.1, s * 0.14);
    // Red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.6, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.04, s * 0.04);
  }

  private drawClayGolem(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Clay body
    ctx.fillStyle = flash || '#9a6a4a';
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.48, s * 0.46);
    // Rough texture patches
    ctx.fillStyle = '#7a4e34';
    ctx.fillRect(s * 0.32, s * 0.38, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.5, s * 0.14, s * 0.08);
    // Head
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.24);
    // Cursed rune eyes
    ctx.fillStyle = '#ff4a2a';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Chest rune
    ctx.fillStyle = '#ff4a2a';
    ctx.fillRect(s * 0.44, s * 0.4, s * 0.12, s * 0.12);
    // Heavy fists
    ctx.fillStyle = '#8a5c40';
    ctx.fillRect(s * 0.1, s * 0.36, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.36, s * 0.16, s * 0.2);
  }

  private drawCloudGiant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Pale giant body
    ctx.fillStyle = flash || '#d8d4cc';
    ctx.fillRect(s * 0.22, s * 0.28, s * 0.56, s * 0.48);
    // Head
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.4, s * 0.26);
    // Dreamy white hair
    ctx.fillStyle = '#f0ece4';
    ctx.fillRect(s * 0.28, s * 0.0, s * 0.44, s * 0.06);
    // Pale eyes
    ctx.fillStyle = '#7a8aff';
    ctx.fillRect(s * 0.36, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.12, s * 0.06, s * 0.05);
    // Gold-trimmed tunic
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.52, s * 0.08);
    // Cloud wisps
    ctx.fillStyle = '#e8f0f8';
    ctx.fillRect(s * 0.12, s * 0.2, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.26, s * 0.12, s * 0.08);
  }

  private drawTreant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Massive oak trunk
    ctx.fillStyle = flash || '#5a4a34';
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.46);
    // Bark texture
    ctx.fillStyle = '#4a3c2a';
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.52, s * 0.14, s * 0.1);
    // Head with branch antlers
    ctx.fillStyle = '#4a3c2a';
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.22);
    ctx.fillRect(s * 0.28, s * 0.02, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.34, s * 0.0, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.02, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.58, s * 0.0, s * 0.06, s * 0.1);
    // Green glowing eyes
    ctx.fillStyle = '#6ad86a';
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.06, s * 0.05);
    // Leafy crown
    ctx.fillStyle = '#3a7a2a';
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.4, s * 0.06);
    // Root feet
    ctx.fillStyle = '#4a3c2a';
    ctx.fillRect(s * 0.28, s * 0.72, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.6, s * 0.72, s * 0.12, s * 0.06);
  }

  private drawGuardianNaga(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Coiled serpent body
    ctx.fillStyle = flash || '#3a8a8a';
    ctx.fillRect(s * 0.2, s * 0.5, s * 0.6, s * 0.22);
    ctx.fillRect(s * 0.16, s * 0.58, s * 0.12, s * 0.14);
    // Golden humanoid head
    ctx.fillStyle = '#caa860';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.28);
    // Winged crest
    ctx.fillStyle = '#f8e8c8';
    ctx.fillRect(s * 0.32, s * 0.04, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.04, s * 0.14, s * 0.14);
    // Wise eyes
    ctx.fillStyle = '#8a4aff';
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.2, s * 0.05, s * 0.04);
    // Scales shimmer
    ctx.fillStyle = '#5aa8a8';
    ctx.fillRect(s * 0.26, s * 0.54, s * 0.48, s * 0.04);
  }

  private drawIronGolem(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Black iron body
    ctx.fillStyle = flash || '#3a3d44';
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.46);
    // Armor rivets
    ctx.fillStyle = '#6a6d74';
    ctx.fillRect(s * 0.3, s * 0.38, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.4, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.46, s * 0.56, s * 0.08, s * 0.08);
    // Head
    ctx.fillRect(s * 0.32, s * 0.06, s * 0.36, s * 0.26);
    // Red furnace eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Chest furnace glow
    ctx.fillStyle = '#ff6a2a';
    ctx.fillRect(s * 0.42, s * 0.4, s * 0.16, s * 0.16);
    // Iron fists
    ctx.fillStyle = '#2e3138';
    ctx.fillRect(s * 0.08, s * 0.34, s * 0.16, s * 0.22);
    ctx.fillRect(s * 0.76, s * 0.34, s * 0.16, s * 0.22);
  }

  private drawIceDevil(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Pale armored body
    ctx.fillStyle = flash || '#9ab8d8';
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.44);
    // Frost armor plates
    ctx.fillStyle = '#c8dcec';
    ctx.fillRect(s * 0.28, s * 0.36, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.36, s * 0.16, s * 0.1);
    // Head with horns
    ctx.fillRect(s * 0.32, s * 0.06, s * 0.36, s * 0.26);
    ctx.fillStyle = '#d8e8f4';
    ctx.fillRect(s * 0.28, s * 0.0, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.64, s * 0.0, s * 0.08, s * 0.1);
    // Cold eyes
    ctx.fillStyle = '#e0f4ff';
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.06, s * 0.05);
    // Barbed tail
    ctx.fillStyle = flash || '#9ab8d8';
    ctx.fillRect(s * 0.66, s * 0.62, s * 0.18, s * 0.04);
    ctx.fillStyle = '#e0f4ff';
    ctx.fillRect(s * 0.82, s * 0.58, s * 0.06, s * 0.1);
    // Glaive
    ctx.fillStyle = '#d8e8f4';
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.05, s * 0.3);
  }

  /**
   * The cape does all the work: a high pointed collar standing behind the head
   * and the hem swept out wide is a silhouette everyone reads instantly, and
   * it is what the old drawing — a dark box with a face on it — was missing.
   * Underneath, the vampire is deliberately a nobleman rather than a monster.
   */
  private drawVampire(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const cape = flash || '#2a0d16';
    const capeLit = flash || '#4a1a28';
    const lining = flash || '#7a1424';
    const dress = flash || '#191620';
    const skin = flash || '#e8dcd6';
    const skinDark = flash || '#b6a6a2';
    // Cape swept wide, its red lining showing at the leading edge
    r(cape, 2, 10, 24, 14);
    r(cape, 0, 16, 28, 9);
    r(capeLit, 2, 10, 24, 1);
    r(flash || '#160610', 0, 23, 28, 2);
    r(lining, 6, 12, 3, 12);
    r(lining, 19, 12, 3, 12);
    r(flash || '#160610', 3, 25, 4, 2);
    r(flash || '#160610', 12, 25, 5, 2);
    r(flash || '#160610', 21, 25, 4, 2);
    // Frock coat and waistcoat between the cape's wings
    r(dress, 9, 11, 10, 14);
    r(flash || '#2b2634', 9, 11, 10, 1);
    r(flash || '#c9c2b4', 12, 13, 4, 8);
    r(lining, 13, 14, 2, 5);
    r(dress, 11, 21, 3, 6);
    r(dress, 15, 21, 3, 6);
    // Pale hands, claws out
    r(skin, 5, 15, 4, 4);
    r(skin, 19, 15, 4, 4);
    r(skinDark, 4, 18, 1, 3);
    r(skinDark, 6, 19, 1, 3);
    r(skinDark, 8, 18, 1, 3);
    r(skinDark, 19, 18, 1, 3);
    r(skinDark, 21, 19, 1, 3);
    r(skinDark, 23, 18, 1, 3);
    // The standing collar, rising past the head
    r(cape, 5, 3, 4, 9);
    r(cape, 19, 3, 4, 9);
    r(lining, 8, 4, 2, 8);
    r(lining, 18, 4, 2, 8);
    r(capeLit, 5, 3, 4, 1);
    r(capeLit, 19, 3, 4, 1);
    // Head: widow's peak, red eyes, fangs
    r(skin, 10, 3, 8, 8);
    r(flash || '#f4ece6', 10, 3, 8, 1);
    r(skinDark, 10, 3, 1, 8);
    r(flash || '#141018', 10, 1, 8, 3);
    r(flash || '#141018', 13, 3, 2, 2);
    r(flash || '#141018', 10, 3, 1, 5);
    r(flash || '#141018', 17, 3, 1, 5);
    r('#ff3020', 11, 6, 2, 2);
    r('#ff3020', 15, 6, 2, 2);
    r(skinDark, 13, 7, 2, 1);
    r(flash || '#4a1018', 12, 9, 5, 2);
    r('#f8f0e8', 12, 9, 1, 2);
    r('#f8f0e8', 16, 9, 1, 2);
  }

  private drawRoc(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Vast bird body
    ctx.fillStyle = flash || '#8a7a6a';
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.52, s * 0.34);
    // Head
    ctx.fillRect(s * 0.28, s * 0.16, s * 0.26, s * 0.22);
    // Hooked beak
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(s * 0.48, s * 0.22, s * 0.12, s * 0.08);
    // Massive wings
    ctx.fillStyle = '#7a6c5e';
    ctx.fillRect(s * 0.0, s * 0.24, s * 0.28, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.24, s * 0.28, s * 0.2);
    // Golden eye
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.32, s * 0.2, s * 0.05, s * 0.05);
    // Talons
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.66, s * 0.06, s * 0.1);
  }

  private drawRemorhaz(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Icy segmented body
    ctx.fillStyle = flash || '#8ab8d8';
    ctx.fillRect(s * 0.14, s * 0.44, s * 0.72, s * 0.2);
    // Back plates
    ctx.fillStyle = '#6a98b8';
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.42, s * 0.36, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.64, s * 0.36, s * 0.16, s * 0.1);
    // White-hot back
    ctx.fillStyle = '#ffcf40';
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.34, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.68, s * 0.34, s * 0.08, s * 0.04);
    // Head + mandibles
    ctx.fillStyle = '#7aa8c8';
    ctx.fillRect(s * 0.08, s * 0.3, s * 0.14, s * 0.16);
    ctx.fillStyle = '#e8d8b8';
    ctx.fillRect(s * 0.04, s * 0.36, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.1, s * 0.44, s * 0.1, s * 0.05);
    // Red eye
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.04, s * 0.04);
  }

  private drawPurpleWorm(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Massive purple body
    ctx.fillStyle = flash || '#7a4a8a';
    ctx.fillRect(s * 0.12, s * 0.4, s * 0.76, s * 0.26);
    // Segments
    ctx.fillStyle = '#5a3468';
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.38, s * 0.44, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.44, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.74, s * 0.44, s * 0.1, s * 0.06);
    // Head with ringed maw
    ctx.fillStyle = '#8a5a9a';
    ctx.fillRect(s * 0.04, s * 0.28, s * 0.16, s * 0.22);
    // Ringed teeth
    ctx.fillStyle = '#e8dcc8';
    ctx.fillRect(s * 0.08, s * 0.34, s * 0.1, s * 0.04);
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.1, s * 0.04);
    // Stinger tail
    ctx.fillStyle = '#5a3468';
    ctx.fillRect(s * 0.84, s * 0.34, s * 0.08, s * 0.12);
    // Pale eye
    ctx.fillStyle = '#d8c8e8';
    ctx.fillRect(s * 0.08, s * 0.3, s * 0.04, s * 0.04);
  }

  private drawDeathKnight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Black plate armor
    ctx.fillStyle = flash || '#2a2d34';
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.46);
    // Helmet with horns
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.4, s * 0.26);
    ctx.fillStyle = '#1a1c22';
    ctx.fillRect(s * 0.26, s * 0.0, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.64, s * 0.0, s * 0.1, s * 0.1);
    // Hellfire eyes
    ctx.fillStyle = '#ff7a1f';
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.06, s * 0.04);
    // Skull emblem
    ctx.fillStyle = '#c8c8d0';
    ctx.fillRect(s * 0.44, s * 0.38, s * 0.12, s * 0.12);
    // Hellfire greatsword
    ctx.fillStyle = '#ff6a2a';
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.06, s * 0.5);
    ctx.fillStyle = '#ffcf40';
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.1, s * 0.06);
  }

  /**
   * A lich is a skull in a crown at the top of a column of rags, and the rags
   * are what makes it: a tattered hem that never reaches the floor evenly, a
   * hood collapsed around a face that is only bone and two points of soul
   * light. The old translucent wisps also cost it its rim, so the necromancy
   * is carried instead by the staff gem and the light in the sockets.
   */
  private drawLich(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const robe = flash || '#332a4a';
    const robeLit = flash || '#4c4069';
    const robeDark = flash || '#1c1730';
    const bone = flash || '#d8d4c4';
    const boneDark = flash || '#9b968a';
    const gold = flash || '#a98a3c';
    // Robe, hanging to a ragged hem
    r(robe, 8, 13, 12, 11);
    r(robe, 6, 18, 16, 6);
    r(robeLit, 8, 13, 12, 1);
    r(robeDark, 6, 22, 16, 2);
    r(robeDark, 7, 24, 3, 3); // torn hem points
    r(robeDark, 11, 24, 4, 2);
    r(robeDark, 16, 24, 3, 3);
    r(robeDark, 11, 18, 1, 6);
    r(robeDark, 16, 18, 1, 6);
    r(gold, 6, 21, 16, 1);
    // Shoulders and a hood collapsed around the skull
    r(robe, 5, 9, 18, 5);
    r(robeLit, 5, 9, 18, 1);
    r(robe, 6, 4, 4, 7);
    r(robe, 18, 4, 4, 7);
    r(robeDark, 9, 5, 10, 4);
    // Casting hand raised, the other on the staff
    r(robe, 3, 11, 4, 6);
    r(bone, 2, 8, 4, 4);
    r(boneDark, 1, 6, 1, 3);
    r(boneDark, 3, 5, 1, 4);
    r(boneDark, 5, 6, 1, 3);
    r(robe, 21, 12, 4, 6);
    r(bone, 22, 17, 4, 3);
    // Staff with a soul gem
    r(flash || '#5f4c2c', 24, 5, 2, 20);
    r(flash || '#7c6539', 24, 5, 1, 20);
    r(flash || '#9a4aff', 22, 1, 6, 5);
    r(flash || '#d8b0ff', 23, 2, 2, 2);
    // Skull
    r(bone, 10, 3, 9, 7);
    r(flash || '#efeade', 10, 3, 9, 1);
    r(boneDark, 10, 3, 1, 7);
    r(flash || '#171223', 11, 5, 3, 3);
    r(flash || '#171223', 15, 5, 3, 3);
    if (!flash) {
      r('#9a6aff', 12, 6, 2, 2);
      r('#9a6aff', 16, 6, 2, 2);
    }
    r(bone, 11, 10, 7, 2);
    r(flash || '#171223', 12, 11, 1, 1);
    r(flash || '#171223', 14, 11, 1, 1);
    r(flash || '#171223', 16, 11, 1, 1);
    // Crown of iron points
    r(gold, 9, 1, 11, 2);
    r(gold, 9, 0, 2, 2);
    r(gold, 13, 0, 2, 2);
    r(gold, 18, 0, 2, 2);
    r(flash || '#e0c060', 9, 1, 11, 1);
  }

  private drawDragonTurtle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Mountainous shell
    ctx.fillStyle = flash || '#5a7a5a';
    ctx.fillRect(s * 0.1, s * 0.36, s * 0.8, s * 0.34);
    // Shell plates
    ctx.fillStyle = '#4a6a4a';
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.2, s * 0.1);
    ctx.fillRect(s * 0.42, s * 0.28, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.18, s * 0.1);
    // Dragon head
    ctx.fillStyle = '#3a8a5a';
    ctx.fillRect(s * 0.16, s * 0.12, s * 0.3, s * 0.2);
    // Snout + teeth
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.12, s * 0.1);
    ctx.fillStyle = '#e8e0c8';
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.12, s * 0.04);
    // Golden eyes
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.2, s * 0.16, s * 0.05, s * 0.04);
    // Steam jets
    ctx.fillStyle = '#d8e8e8';
    ctx.fillRect(s * 0.12, s * 0.04, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.28, s * 0.0, s * 0.06, s * 0.08);
    // Flippers
    ctx.fillStyle = '#4a6a4a';
    ctx.fillRect(s * 0.18, s * 0.68, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.68, s * 0.68, s * 0.14, s * 0.06);
  }

  /**
   * The pit fiend and the balor were the same red box with the same horns.
   * They are separated by how they wear their wings: the balor throws its
   * wings wide and burns, and the pit fiend furls its around itself like a
   * cloak, showing only the shoulder spurs — a narrow, upright, armoured
   * column with a spiked mace and a serpent's tail, rather than a wide blaze.
   */
  private drawPitFiend(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#a83a2a';
    const lit = flash || '#d15c42';
    const dark = flash || '#5c1a12';
    const horn = flash || '#d8d0b8';
    const iron = flash || '#6a6f78';
    // Wings furled forward, closing round the body like a cloak
    r(dark, 4, 8, 7, 16);
    r(dark, 17, 8, 7, 16);
    r(flash || '#3a0f0a', 4, 8, 7, 1);
    r(flash || '#3a0f0a', 17, 8, 7, 1);
    r(flash || '#3a0f0a', 7, 9, 1, 14);
    r(flash || '#3a0f0a', 20, 9, 1, 14);
    r(horn, 3, 4, 3, 5); // wing spurs above the shoulders
    r(horn, 22, 4, 3, 5);
    r(dark, 4, 22, 7, 3);
    r(dark, 17, 22, 7, 3);
    // Armoured torso showing between them
    r(hide, 10, 10, 8, 13);
    r(lit, 10, 10, 8, 1);
    r(dark, 10, 21, 8, 2);
    r(iron, 11, 12, 6, 3); // breastplate
    r(flash || '#8c929c', 11, 12, 6, 1);
    r(dark, 12, 16, 4, 5);
    // Hooved legs
    r(hide, 10, 22, 4, 4);
    r(hide, 15, 22, 4, 4);
    r(flash || '#2c1810', 9, 25, 5, 2);
    r(flash || '#2c1810', 15, 25, 5, 2);
    // Head with hellfire eyes and a heavy jaw
    r(hide, 10, 3, 8, 8);
    r(lit, 10, 3, 8, 1);
    r(dark, 10, 3, 1, 8);
    r('#ff9a2f', 11, 5, 2, 2);
    r('#ff9a2f', 15, 5, 2, 2);
    r(dark, 11, 8, 6, 3);
    r('#e8dcc4', 11, 8, 1, 3);
    r('#e8dcc4', 14, 8, 1, 3);
    r('#e8dcc4', 16, 8, 1, 3);
    // Great horns, sweeping up and out
    r(horn, 8, 0, 3, 5);
    r(horn, 6, 0, 2, 3);
    r(horn, 17, 0, 3, 5);
    r(horn, 20, 0, 2, 3);
    // Spiked mace held upright
    r(flash || '#5f4c2c', 25, 8, 2, 15);
    r(iron, 23, 2, 5, 5);
    r(flash || '#8c929c', 23, 2, 5, 1);
    r(iron, 22, 4, 2, 2);
    r(iron, 25, 0, 2, 2);
    // Serpent tail slipping out from under the wing
    r(hide, 0, 20, 5, 3);
    r(hide, 0, 23, 3, 4);
    r(horn, 0, 26, 2, 1);
  }

  // ── Additional class sprites ──────────────────────

  private drawBard(ctx: CanvasRenderingContext2D, s: number, _cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#c8a882';
    // Hose and shoes
    r('#4a3a68', 9, 21, 4, 5);
    r('#4a3a68', 15, 21, 4, 5);
    r('#2e2440', 8, 25, 6, 3);
    r('#2e2440', 14, 25, 6, 3);
    // Doublet with a gold placket
    r('#8a3aa8', 9, 12, 10, 9);
    r('#a04ac0', 9, 12, 10, 1);
    r('#e6c84a', 13, 12, 2, 9);
    r('#e6c84a', 9, 19, 10, 1);
    // Puffed sleeves
    r('#9a45b8', 5, 12, 4, 4);
    r('#9a45b8', 19, 12, 4, 4);
    r('#8a3aa8', 6, 16, 3, 5);
    r('#8a3aa8', 19, 16, 3, 5);
    r(skin, 6, 20, 3, 2);
    // Head under a feathered cap
    this.heroHead(ctx, s, skin, '#9e8058');
    r('#5a2a72', 7, 3, 14, 3);
    r('#6e3a8a', 7, 3, 14, 1);
    r('#3fa8e6', 19, 1, 2, 3);
    r('#8ad4ff', 19, 1, 1, 3);
    // Lute, held across the body
    r('#5a3a18', 21, 12, 2, 7);
    r('#8a5a2b', 17, 18, 8, 8);
    r('#a86f38', 17, 18, 8, 1);
    r('#3a2410', 20, 20, 3, 3);
    r('#e8e0c8', 18, 23, 6, 1);
  }

  private drawSorcerer(ctx: CanvasRenderingContext2D, s: number, _cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#c8a882';
    // Crimson robe
    r('#8e2028', 9, 12, 10, 8);
    r('#a1252f', 8, 19, 12, 7);
    r('#7a1a22', 7, 25, 14, 3);
    r('#c03038', 13, 13, 2, 12);
    r('#d9b23f', 8, 19, 12, 1);
    // Sleeves
    r('#8e2028', 5, 13, 4, 7);
    r('#8e2028', 19, 13, 4, 6);
    r(skin, 19, 19, 3, 2);
    // Head, wild dark mane
    this.heroHead(ctx, s, skin, '#9e8058');
    r('#241610', 8, 2, 12, 3);
    r('#3a241a', 8, 2, 12, 1);
    r('#241610', 8, 5, 1, 7);
    r('#241610', 19, 5, 1, 7);
    // Sorcery gathering at the free hand
    r(skin, 5, 20, 3, 2);
    r('#ffd24a', 3, 15, 4, 4);
    r('#fff0a8', 4, 16, 2, 2);
    r('#ff8a2a', 6, 11, 2, 2);
    r('#ff8a2a', 1, 20, 2, 2);
    r('#ffd24a', 2, 11, 2, 2);
  }

  private drawWarlock(ctx: CanvasRenderingContext2D, s: number, _cs: number) {
    const r = this.grid(ctx, s);
    // Robe with a torn hem — the one class whose silhouette should not end
    // in a clean straight line.
    r('#2c2440', 9, 11, 10, 9);
    r('#221c36', 8, 19, 12, 6);
    r('#221c36', 8, 25, 3, 3);
    r('#221c36', 12, 25, 3, 2);
    r('#221c36', 17, 25, 3, 3);
    r('#5a3a8a', 9, 11, 10, 1);
    r('#5a3a8a', 13, 12, 2, 12);
    // Sleeves
    r('#2c2440', 5, 13, 4, 7);
    r('#2c2440', 19, 13, 4, 6);
    // Hood over a face that is only two eldritch eyes
    r('#221c36', 8, 2, 12, 10);
    r('#332a4e', 8, 2, 12, 1);
    r('#08060e', 10, 5, 8, 6);
    r('#4df07a', 11, 6, 2, 2);
    r('#4df07a', 15, 6, 2, 2);
    r('#bfffd0', 11, 6, 1, 1);
    r('#bfffd0', 15, 6, 1, 1);
    // Pact tome
    r('#5a3a8a', 20, 15, 6, 6);
    r('#7a52b0', 20, 15, 6, 1);
    r('#c9b8ff', 21, 17, 4, 1);
    r('#c9b8ff', 21, 19, 4, 1);
    // Sigil burning at the off hand
    ctx.globalAlpha = 0.45;
    r('#4df07a', 2, 14, 6, 6);
    ctx.globalAlpha = 1;
    r('#2b7a44', 3, 15, 4, 4);
    r('#4df07a', 4, 16, 2, 2);
  }

  private drawMonk(ctx: CanvasRenderingContext2D, s: number, _cs: number) {
    const r = this.grid(ctx, s);
    const skin = '#c8a882';
    // Legs and sandals
    r('#b0a480', 9, 21, 4, 4);
    r('#b0a480', 15, 21, 4, 4);
    r('#4a4234', 8, 25, 6, 3);
    r('#4a4234', 14, 25, 6, 3);
    // Gi with a crossed lapel
    r('#cabb95', 9, 12, 10, 9);
    r('#ded2b0', 9, 12, 10, 1);
    r('#b3a682', 12, 12, 2, 9);
    r('#e2d8bc', 14, 12, 2, 9);
    // Red sash
    r('#b03030', 8, 18, 12, 2);
    r('#d04a4a', 8, 18, 12, 1);
    // Bare arms, wrapped fists
    r(skin, 5, 13, 3, 6);
    r(skin, 20, 13, 3, 6);
    r('#ded6c2', 5, 19, 3, 3);
    r('#ded6c2', 20, 19, 3, 3);
    // Shaved head, headband with a trailing tie
    this.heroHead(ctx, s, skin, '#9e8058');
    r('#b03030', 8, 4, 12, 2);
    r('#d04a4a', 8, 4, 12, 1);
    r('#b03030', 5, 5, 3, 4);
  }

  /** Overworld life: townsfolk, travelers, merchants, and wildlife. */
  getWandererSprite(kind: string, variant: number): ImageData {
    const key = `wanderer_${kind}_${variant % 3}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const raw = this.monsterCtx;
    raw.clearRect(0, 0, ENTITY_SIZE, ENTITY_SIZE);
    raw.imageSmoothingEnabled = false;
    const ctx = pixelSnapped(raw);

    const s = ENTITY_SIZE;
    const v = variant % 3;
    switch (kind) {
      case 'traveler': this.drawTraveler(ctx, s, v); break;
      case 'merchant': this.drawMerchant(ctx, s); break;
      case 'guard': this.drawGuard(ctx, s, v); break;
      case 'pilgrim': this.drawPilgrim(ctx, s, v); break;
      case 'scout': this.drawScout(ctx, s, v); break;
      case 'deer': this.drawDeer(ctx, s); break;
      case 'rabbit': this.drawRabbit(ctx, s); break;
      case 'wolf': this.drawWolf(ctx, s); break;
      case 'heron': this.drawHeron(ctx, s); break;
      default: this.drawTraveler(ctx, s, v); break;
    }
    this.applySpriteEffects(raw, ENTITY_SIZE);

    const data = raw.getImageData(0, 0, ENTITY_SIZE, ENTITY_SIZE);
    this.cache.set(key, data);
    return data;
  }

  private drawTraveler(ctx: CanvasRenderingContext2D, s: number, v: number) {
    const cloak = ['#6b4f3f', '#3f5a6b', '#5a6b3f'][v];
    ctx.fillStyle = '#c8a882'; // face
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.18);
    ctx.fillStyle = '#2a2018'; // hair/hood
    ctx.fillRect(s * 0.36, s * 0.04, s * 0.28, s * 0.08);
    ctx.fillStyle = cloak;
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.52);
    ctx.fillStyle = '#1c140e';
    ctx.fillRect(s * 0.24, s * 0.24, s * 0.08, s * 0.4); // walking stick
    ctx.fillStyle = '#3a2c22';
    ctx.fillRect(s * 0.32, s * 0.76, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.76, s * 0.14, s * 0.2);
  }

  private drawMerchant(ctx: CanvasRenderingContext2D, s: number) {
    // Person behind a cart
    ctx.fillStyle = '#c8a882';
    ctx.fillRect(s * 0.44, s * 0.08, s * 0.2, s * 0.16);
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.28, s * 0.34);
    // Cart bed
    ctx.fillStyle = '#7a5a34';
    ctx.fillRect(s * 0.04, s * 0.4, s * 0.4, s * 0.18);
    ctx.fillStyle = '#5a4024';
    ctx.fillRect(s * 0.04, s * 0.5, s * 0.4, s * 0.08);
    // Cargo
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(s * 0.08, s * 0.28, s * 0.12, s * 0.12);
    ctx.fillStyle = '#6a8a3a';
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.12, s * 0.1);
    // Wheels
    ctx.fillStyle = '#241a10';
    ctx.fillRect(s * 0.1, s * 0.58, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.3, s * 0.58, s * 0.1, s * 0.1);
    ctx.fillStyle = '#3a2c1c';
    ctx.fillRect(s * 0.66, s * 0.78, s * 0.12, s * 0.18);
    ctx.fillRect(s * 0.84, s * 0.78, s * 0.12, s * 0.18);
  }

  private drawGuard(ctx: CanvasRenderingContext2D, s: number, v: number) {
    const tabard = ['#7a2a2a', '#2a4a7a', '#4a7a2a'][v];
    ctx.fillStyle = '#c8a882';
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.16);
    ctx.fillStyle = '#9a9aa4'; // helm
    ctx.fillRect(s * 0.36, s * 0.04, s * 0.28, s * 0.1);
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.1, s * 0.04, s * 0.06);
    ctx.fillStyle = '#5a5a64'; // mail
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.34);
    ctx.fillStyle = tabard;
    ctx.fillRect(s * 0.36, s * 0.26, s * 0.28, s * 0.3);
    ctx.fillStyle = '#3a3a44'; // spear
    ctx.fillRect(s * 0.78, s * 0.06, s * 0.05, s * 0.7);
    ctx.fillStyle = '#c8ccd4';
    ctx.fillRect(s * 0.76, s * 0.02, s * 0.09, s * 0.07);
    ctx.fillStyle = '#2a2a34';
    ctx.fillRect(s * 0.34, s * 0.76, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.76, s * 0.14, s * 0.2);
  }

  private drawPilgrim(ctx: CanvasRenderingContext2D, s: number, v: number) {
    const robe = ['#b8b0a0', '#8a90a0', '#a0908a'][v];
    ctx.fillStyle = '#c8a882';
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.14);
    ctx.fillStyle = '#241c14'; // hood
    ctx.fillRect(s * 0.36, s * 0.04, s * 0.28, s * 0.1);
    ctx.fillStyle = robe;
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.4, s * 0.56);
    ctx.fillStyle = '#7a2a2a'; // holy symbol
    ctx.fillRect(s * 0.45, s * 0.4, s * 0.1, s * 0.12);
    ctx.fillStyle = '#1c1610';
    ctx.fillRect(s * 0.36, s * 0.78, s * 0.12, s * 0.18);
    ctx.fillRect(s * 0.52, s * 0.78, s * 0.12, s * 0.18);
  }

  private drawScout(ctx: CanvasRenderingContext2D, s: number, v: number) {
    const tunic = ['#3f5a2a', '#2a4a3f', '#4a3f2a'][v];
    ctx.fillStyle = '#c8a882';
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.14);
    ctx.fillStyle = '#1a2412'; // hood
    ctx.fillRect(s * 0.36, s * 0.04, s * 0.28, s * 0.1);
    ctx.fillStyle = tunic;
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.4, s * 0.34);
    ctx.fillStyle = '#2a2a1c'; // bow
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.06, s * 0.4);
    ctx.fillStyle = '#6a6a4a';
    ctx.fillRect(s * 0.68, s * 0.2, s * 0.02, s * 0.4);
    ctx.fillStyle = '#241c12';
    ctx.fillRect(s * 0.32, s * 0.76, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.76, s * 0.14, s * 0.2);
  }

  private drawDeer(ctx: CanvasRenderingContext2D, s: number) {
    ctx.fillStyle = '#a07048'; // body
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.5, s * 0.22);
    ctx.fillStyle = '#8a5c38'; // head/neck
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.16, s * 0.16);
    ctx.fillStyle = '#5a3c24'; // antlers
    ctx.fillRect(s * 0.64, s * 0.1, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.08, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.06, s * 0.03);
    ctx.fillStyle = '#8a5c38'; // legs
    ctx.fillRect(s * 0.24, s * 0.52, s * 0.08, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.52, s * 0.08, s * 0.24);
    ctx.fillRect(s * 0.56, s * 0.52, s * 0.08, s * 0.24);
    ctx.fillStyle = '#2a1c10';
    ctx.fillRect(s * 0.24, s * 0.7, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.7, s * 0.08, s * 0.06);
  }

  private drawRabbit(ctx: CanvasRenderingContext2D, s: number) {
    ctx.fillStyle = '#b8b8c0'; // body
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.2);
    ctx.fillStyle = '#c8c8d0'; // head
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.2, s * 0.16);
    ctx.fillStyle = '#e8e8f0'; // ears
    ctx.fillRect(s * 0.62, s * 0.06, s * 0.05, s * 0.16);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.05, s * 0.14);
    ctx.fillStyle = '#8a8a94';
    ctx.fillRect(s * 0.66, s * 0.06, s * 0.03, s * 0.14);
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(s * 0.66, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillStyle = '#b8b8c0'; // legs
    ctx.fillRect(s * 0.32, s * 0.5, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.5, s * 0.14, s * 0.16);
    ctx.fillStyle = '#f0f0f8';
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.08, s * 0.05);
  }

  private drawWolf(ctx: CanvasRenderingContext2D, s: number) {
    ctx.fillStyle = '#3a3a44'; // body
    ctx.fillRect(s * 0.14, s * 0.34, s * 0.56, s * 0.2);
    ctx.fillStyle = '#4a4a56'; // head
    ctx.fillRect(s * 0.64, s * 0.26, s * 0.2, s * 0.16);
    ctx.fillStyle = '#2a2a34'; // ears
    ctx.fillRect(s * 0.68, s * 0.18, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.76, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillStyle = '#c8c830'; // eyes
    ctx.fillRect(s * 0.7, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.78, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillStyle = '#3a3a44'; // legs + tail
    ctx.fillRect(s * 0.18, s * 0.54, s * 0.08, s * 0.22);
    ctx.fillRect(s * 0.34, s * 0.54, s * 0.08, s * 0.22);
    ctx.fillRect(s * 0.5, s * 0.54, s * 0.08, s * 0.22);
    ctx.fillRect(s * 0.06, s * 0.4, s * 0.08, s * 0.1);
  }

  private drawHeron(ctx: CanvasRenderingContext2D, s: number) {
    ctx.fillStyle = '#e8e8ec'; // body
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.3, s * 0.26);
    ctx.fillStyle = '#c0c0cc'; // wing
    ctx.fillRect(s * 0.34, s * 0.26, s * 0.22, s * 0.16);
    ctx.fillStyle = '#e8e8ec'; // neck + head
    ctx.fillRect(s * 0.52, s * 0.06, s * 0.08, s * 0.18);
    ctx.fillRect(s * 0.56, s * 0.02, s * 0.1, s * 0.08);
    ctx.fillStyle = '#d8a020'; // beak
    ctx.fillRect(s * 0.66, s * 0.04, s * 0.12, s * 0.03);
    ctx.fillStyle = '#e8e8ec'; // legs
    ctx.fillRect(s * 0.36, s * 0.46, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.5, s * 0.46, s * 0.05, s * 0.3);
  }

  private drawMimic(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a4526'; // chest body
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.34);
    ctx.fillStyle = flash || '#54402a'; // chest lid
    ctx.fillRect(s * 0.22, s * 0.2, s * 0.56, s * 0.12);
    ctx.fillStyle = flash || '#d8b86a'; // iron bands
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.08, s * 0.44);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.08, s * 0.44);
    ctx.fillStyle = flash || '#3a2a18'; // open mouth
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.08);
    ctx.fillStyle = '#f0f0ec'; // teeth
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.3, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.36, s * 0.04, s * 0.06);
    ctx.fillStyle = flash || '#e0b040'; // lock
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.08, s * 0.1);
    ctx.fillStyle = flash || '#8a5c34'; // pseudopod arms
    ctx.fillRect(s * 0.14, s * 0.42, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.76, s * 0.42, s * 0.1, s * 0.06);
  }

  /**
   * Half rooster, half lizard, and the joke only lands if both halves are
   * legible: a scruffy bird front with a red comb and wattle and scaly bird
   * legs, and a long reptilian tail behind it, plus a leathery bat wing rather
   * than a feathered one.
   */
  private drawCockatrice(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const plume = flash || '#b8ac48';
    const lit = flash || '#e0d472';
    const dark = flash || '#7c7226';
    const scale = flash || '#7a4098';
    const comb = flash || '#e03220';
    // Reptilian tail, tapering back and up
    r(scale, 0, 8, 5, 3);
    r(scale, 3, 11, 5, 4);
    r(scale, 6, 14, 5, 4);
    r(flash || '#54246c', 0, 10, 5, 1);
    r(flash || '#54246c', 3, 14, 5, 1);
    // Plump feathered body
    r(plume, 9, 12, 11, 9);
    r(lit, 9, 12, 11, 1);
    r(dark, 9, 19, 11, 2);
    // Leathery wing folded on the shoulder
    r(scale, 9, 10, 9, 7);
    r(flash || '#54246c', 9, 10, 9, 1);
    r(flash || '#54246c', 12, 11, 1, 6);
    r(flash || '#54246c', 15, 11, 1, 6);
    // Scaly bird legs and clawed feet
    r(dark, 11, 21, 3, 4);
    r(dark, 16, 21, 3, 4);
    r(plume, 9, 25, 6, 2);
    r(plume, 15, 25, 6, 2);
    r(flash || '#2a2418', 9, 26, 1, 1);
    r(flash || '#2a2418', 13, 26, 1, 1);
    r(flash || '#2a2418', 20, 26, 1, 1);
    // Neck and head
    r(plume, 18, 6, 5, 8);
    r(lit, 18, 6, 1, 8);
    r(plume, 19, 2, 7, 6);
    r(lit, 19, 2, 7, 1);
    r(comb, 19, 0, 2, 3); // comb
    r(comb, 22, 0, 2, 3);
    r(comb, 25, 1, 2, 2);
    r(comb, 21, 8, 3, 4); // wattle
    r(flash || '#e8b820', 25, 4, 3, 3); // beak
    r(flash || '#b88a10', 25, 6, 3, 2);
    r('#2a2a30', 22, 4, 2, 2);
    r('#f0e8d8', 22, 4, 1, 1);
  }

  private drawWorg(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#2a2a34'; // body
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.5, s * 0.2);
    ctx.fillStyle = flash || '#3a3a46'; // head
    ctx.fillRect(s * 0.58, s * 0.28, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#c83030'; // eyes
    ctx.fillRect(s * 0.62, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.72, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#2a2a34'; // ears
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.06, s * 0.08);
    ctx.fillStyle = '#f0f0f4'; // fangs
    ctx.fillRect(s * 0.62, s * 0.42, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.42, s * 0.04, s * 0.05);
    ctx.fillStyle = flash || '#2a2a34'; // legs + tail
    ctx.fillRect(s * 0.16, s * 0.56, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.48, s * 0.56, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.04, s * 0.42, s * 0.08, s * 0.08);
  }

  private drawAarakocra(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const feather = flash || '#3f5273';
    const lit = flash || '#5d739a';
    const dark = flash || '#26324a';
    const skin = flash || '#c9b48a';
    const beak = flash || '#e0b52c';
    // Wings for arms, held out wide, primaries stepping at the tips
    r(feather, 0, 6, 10, 5);
    r(dark, 0, 6, 10, 1);
    r(feather, 1, 11, 8, 3);
    r(dark, 3, 10, 1, 4);
    r(dark, 6, 10, 1, 4);
    r(feather, 18, 6, 10, 5);
    r(dark, 18, 6, 10, 1);
    r(feather, 19, 11, 8, 3);
    r(dark, 21, 10, 1, 4);
    r(dark, 24, 10, 1, 4);
    // Torso and the pale breast down its front
    r(feather, 10, 8, 8, 11);
    r(lit, 10, 8, 8, 1);
    r(flash || '#8b9cbb', 12, 12, 4, 7);
    r(dark, 10, 17, 8, 2);
    // Bird legs and talons
    r(skin, 11, 19, 2, 5);
    r(skin, 15, 19, 2, 5);
    r(beak, 9, 24, 5, 2);
    r(beak, 14, 24, 5, 2);
    // Head, crest and hooked beak
    r(skin, 11, 1, 7, 7);
    r(flash || '#a8946e', 11, 6, 7, 2);
    r(feather, 10, 0, 8, 2);
    r(dark, 13, 0, 3, 1);
    r(beak, 17, 3, 5, 3);
    r(flash || '#b08a18', 17, 5, 5, 1);
    r(flash || '#f0f0f4', 12, 3, 3, 2);
    r(flash || '#171b26', 13, 3, 2, 2);
    // Javelin held across the body
    r(flash || '#7a5730', 4, 14, 2, 13);
    r(flash || '#c3c8d2', 3, 10, 4, 5);
  }

  /**
   * A grick is a worm that rears its head, with four tentacles fanned round
   * a beak. The body coils off to the right; the head comes up on the left
   * with the beak open. The alpha is the same animal in mauve with yellow
   * eyes.
   */
  private drawGrick(ctx: CanvasRenderingContext2D, s: number, flash?: string, alpha = false) {
    const r = this.grid(ctx, s);
    const hide = flash || (alpha ? '#6a5a6a' : '#4a4a56');
    const lit = flash || (alpha ? '#8e7a8e' : '#6a6a78');
    const dark = flash || (alpha ? '#3e3240' : '#2a2a34');
    const beak = flash || (alpha ? '#c8b070' : '#a89a70');
    // Body coiling off behind
    r(hide, 14, 18, 8, 6);
    r(lit, 14, 18, 8, 1);
    r(hide, 20, 13, 6, 6);
    r(lit, 20, 13, 6, 1);
    r(hide, 23, 8, 4, 6);
    r(lit, 23, 8, 4, 1);
    r(hide, 24, 5, 3, 4);
    r(dark, 14, 22, 8, 2);
    r(dark, 20, 17, 6, 2);
    r(dark, 16, 20, 1, 1);
    r(dark, 19, 19, 1, 1);
    r(dark, 22, 15, 1, 1);
    // Head reared up, tentacles fanning round the beak
    r(hide, 1, 4, 3, 7);
    r(hide, 2, 2, 2, 3);
    r(hide, 6, 3, 3, 7);
    r(hide, 7, 0, 2, 4);
    r(hide, 12, 3, 3, 7);
    r(hide, 13, 0, 2, 4);
    r(hide, 1, 13, 4, 3);
    r(hide, 0, 16, 3, 4);
    r(dark, 2, 4, 1, 6);
    r(dark, 7, 3, 1, 7);
    r(dark, 13, 3, 1, 7);
    r(hide, 5, 10, 11, 10);
    r(lit, 5, 10, 11, 1);
    r(dark, 5, 18, 11, 2);
    r(lit, 5, 11, 1, 7);
    // The beak, open
    r(beak, 4, 12, 7, 3);
    r(dark, 4, 12, 7, 1);
    r(flash || '#141014', 5, 15, 6, 2);
    r(beak, 5, 17, 5, 2);
    // Eyes
    r(flash || (alpha ? '#e0c000' : '#9aa0b0'), 12, 13, 2, 2);
    r(flash || '#141014', 13, 13, 1, 2);
  }

  private drawDjinni(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3870b8'; // torso
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.34);
    ctx.fillStyle = flash || '#4a90d8'; // arms
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.34, s * 0.1, s * 0.12);
    ctx.fillStyle = flash || '#2a4a78'; // head
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#3a6aa8'; // whiskers
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.03);
    ctx.fillStyle = flash || '#6ab0f0'; // swirling smoke tail
    ctx.fillRect(s * 0.32, s * 0.64, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.42, s * 0.7, s * 0.08, s * 0.08);
    ctx.fillStyle = '#c8d8f0'; // eyes
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.18, s * 0.04, s * 0.04);
  }

  private drawEfreeti(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#b83018'; // torso
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.4);
    ctx.fillStyle = flash || '#d84a20'; // arms
    ctx.fillRect(s * 0.22, s * 0.28, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.68, s * 0.28, s * 0.1, s * 0.14);
    ctx.fillStyle = flash || '#a82a10'; // head
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#e8e000'; // burning plume
    ctx.fillRect(s * 0.42, s * 0.02, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.04, s * 0.04, s * 0.08);
    ctx.fillStyle = '#e8e000'; // eyes
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.04, s * 0.05);
    ctx.fillStyle = flash || '#d84a20'; // legs
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.12, s * 0.14);
  }

  private drawScarecrow(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a6a3c'; // crossed post
    ctx.fillRect(s * 0.46, s * 0.06, s * 0.08, s * 0.74);
    ctx.fillRect(s * 0.14, s * 0.16, s * 0.62, s * 0.06);
    ctx.fillStyle = flash || '#e8d8b0'; // burlap head
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.2, s * 0.18);
    ctx.fillStyle = '#241c10'; // stitched eyes + mouth
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.22, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.42, s * 0.3, s * 0.14, s * 0.04);
    ctx.fillStyle = flash || '#3a2a18'; // dangling straw sleeves
    ctx.fillRect(s * 0.2, s * 0.22, s * 0.08, s * 0.34);
    ctx.fillRect(s * 0.72, s * 0.22, s * 0.08, s * 0.34);
    ctx.fillStyle = flash || '#7a5c2e'; // frayed coat
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.32, s * 0.3);
    ctx.fillRect(s * 0.42, s * 0.58, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.58, s * 0.04, s * 0.2);
  }

  private drawDeathDog(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a6a4a'; // body
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.5, s * 0.18);
    ctx.fillStyle = flash || '#5a5a3c'; // neck(s)
    ctx.fillRect(s * 0.6, s * 0.18, s * 0.08, s * 0.18);
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.08, s * 0.16);
    ctx.fillStyle = flash || '#4a4a2e'; // two heads
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.68, s * 0.14, s * 0.12, s * 0.1);
    ctx.fillStyle = '#a82a10'; // eyes + gums
    ctx.fillRect(s * 0.66, s * 0.15, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.72, s * 0.17, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#6a6a4a'; // legs + tail
    ctx.fillRect(s * 0.24, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.1, s * 0.06);
  }

  /**
   * A goat is its horns: one sweep curling back over the neck, and a beard.
   * Drawn in profile like the other animals, on four legs with the hocks
   * marked, so it is not another beige box.
   */
  private drawGiantGoat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const wool = flash || '#cbbf9f';
    const lit = flash || '#e9e0c5';
    const dark = flash || '#8f8468';
    const horn = flash || '#3b3530';
    const hoof = flash || '#2c2a2e';
    // Two pairs of legs
    r(wool, 5, 17, 3, 7);
    r(wool, 9, 17, 3, 7);
    r(wool, 17, 17, 3, 7);
    r(wool, 21, 17, 3, 7);
    r(dark, 5, 21, 3, 1);
    r(dark, 9, 21, 3, 1);
    r(dark, 17, 21, 3, 1);
    r(dark, 21, 21, 3, 1);
    r(hoof, 5, 24, 3, 2);
    r(hoof, 9, 24, 3, 2);
    r(hoof, 17, 24, 3, 2);
    r(hoof, 21, 24, 3, 2);
    // Shaggy barrel, the fleece hanging ragged under it
    r(wool, 3, 9, 22, 9);
    r(lit, 3, 9, 22, 1);
    r(dark, 3, 16, 22, 2);
    r(wool, 4, 18, 3, 1);
    r(wool, 13, 18, 3, 1);
    r(dark, 6, 12, 1, 3);
    r(dark, 15, 13, 1, 3);
    // Stub tail
    r(wool, 1, 8, 3, 3);
    r(lit, 1, 8, 3, 1);
    // Neck, long face, beard off the chin
    r(wool, 19, 5, 5, 6);
    r(wool, 20, 3, 7, 4);
    r(lit, 20, 3, 7, 1);
    r(wool, 23, 7, 5, 4);
    r(dark, 23, 10, 5, 1);
    r(flash || '#eae4d2', 23, 11, 2, 3);
    r(flash || '#ffd23a', 24, 4, 2, 1);
    r(flash || '#1c1a1e', 24, 5, 2, 1);
    r(dark, 26, 8, 1, 1);
    // Horn curling back over the neck, and the ear under it
    r(horn, 20, 1, 4, 2);
    r(horn, 17, 0, 4, 2);
    r(horn, 15, 1, 3, 2);
    r(horn, 14, 3, 2, 2);
    r(dark, 19, 3, 2, 2);
  }

  /**
   * A thug is a bandit without the cloak: bare arms, bald head, a shoulder line
   * as wide as the orc's but a human head on it. Drawn against the hooded
   * bandit that shares its haunts, the difference has to be in the outline —
   * no hood, no cape, bare biceps, a heavy cudgel over the shoulder.
   */
  private drawThug(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#bd9066';
    const lit = flash || '#d4a87e';
    const dark = flash || '#8d6844';
    // Legs and boots
    r(flash || '#43392c', 9, 20, 4, 5);
    r(flash || '#43392c', 15, 20, 4, 5);
    r(flash || '#26201a', 8, 24, 6, 4);
    r(flash || '#26201a', 14, 24, 6, 4);
    // Broad barrel chest under a sleeveless jerkin
    r(flash || '#6a5f4c', 8, 11, 12, 9);
    r(flash || '#7d7159', 8, 11, 12, 1);
    r(flash || '#544b3c', 8, 17, 12, 1);
    r(skin, 11, 11, 6, 4);
    r(dark, 13, 11, 2, 4);
    // Belt
    r(flash || '#3b3025', 8, 18, 12, 2);
    r(flash || '#9a8a54', 13, 18, 2, 2);
    // Bare arms, heavy at the shoulder
    r(skin, 4, 11, 4, 6);
    r(lit, 4, 11, 4, 1);
    r(dark, 4, 15, 4, 1);
    r(skin, 5, 17, 3, 5);
    r(skin, 20, 11, 4, 6);
    r(lit, 20, 11, 4, 1);
    r(dark, 20, 15, 4, 1);
    r(skin, 20, 17, 3, 4);
    // Bald head, no neck, a stubbled jaw
    r(skin, 10, 3, 8, 8);
    r(lit, 10, 3, 8, 1);
    r(dark, 10, 3, 1, 8);
    r(dark, 10, 9, 8, 2);
    r('#efe9dc', 11, 6, 2, 2);
    r('#efe9dc', 15, 6, 2, 2);
    r('#20242c', 12, 6, 1, 2);
    r('#20242c', 15, 6, 1, 2);
    r(dark, 11, 5, 2, 1);
    r(dark, 15, 5, 2, 1);
    r(flash || '#4a2f1e', 13, 7, 2, 2);
    // Broken nose and a scar
    r(dark, 13, 8, 2, 1);
    if (!flash) r('#8c4a3e', 17, 4, 1, 4);
    // Studded cudgel shouldered
    r(flash || '#5a3d20', 22, 13, 3, 8);
    r(flash || '#6f4e2c', 22, 13, 1, 8);
    r(flash || '#6a4726', 21, 5, 5, 8);
    r(flash || '#7f5931', 21, 5, 5, 1);
    r(flash || '#adb3bb', 20, 7, 2, 2);
    r(flash || '#adb3bb', 25, 10, 2, 2);
  }

  /**
   * Eight bats drawn one at a time, each with the notched wing outline that
   * says bat and a pair of red eyes, scattered across the whole box at
   * different sizes. Three stacked bricks with specks on them read as a rock;
   * the ragged edge of a real flock is the entire sprite.
   */
  private drawSwarmOfBats(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const memb = flash || '#2c2038';
    const fur = flash || '#4a3760';
    const dark = flash || '#150f1c';
    const bat = (x: number, y: number, tone: string) => {
      r(tone, x, y + 1, 3, 2); // wings
      r(tone, x + 8, y + 1, 3, 2);
      r(tone, x + 2, y + 1, 7, 3);
      r(dark, x, y + 3, 3, 1); // notched trailing edge
      r(dark, x + 8, y + 3, 3, 1);
      r(fur, x + 4, y + 1, 3, 4); // body
      r(dark, x + 4, y, 1, 1); // ears
      r(dark, x + 6, y, 1, 1);
      r('#d03838', x + 4, y + 2, 1, 1);
      r('#d03838', x + 6, y + 2, 1, 1);
    };
    bat(1, 1, memb);
    bat(14, 0, fur);
    bat(8, 6, memb);
    bat(17, 8, memb);
    bat(0, 10, fur);
    bat(11, 14, fur);
    bat(2, 18, memb);
    bat(16, 20, memb);
  }

  /**
   * The old merfolk stood on a green rectangle and was one more humanoid in a
   * bestiary full of them. The tail is the creature: it curls to one side and
   * ends in a broad fluke, so the outline is an S with a fan at the bottom and
   * nothing else in the sunken temple resembles it.
   */
  private drawMerfolk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#c8a882';
    const skinDark = flash || '#9a7d5c';
    const scale = flash || '#2f8a63';
    const scaleLit = flash || '#4fb98a';
    const scaleDark = flash || '#1c5c40';
    const fin = flash || '#5fc8b0';
    // Tail curling away to the left and ending in a broad fluke
    r(scale, 10, 14, 9, 7);
    r(scaleLit, 10, 14, 9, 1);
    r(scale, 5, 18, 10, 6);
    r(scaleDark, 5, 22, 10, 2);
    r(scaleDark, 12, 16, 1, 5);
    r(scaleDark, 15, 15, 1, 6);
    r(scaleDark, 8, 19, 1, 5);
    r(fin, 0, 19, 6, 4);
    r(fin, 1, 15, 4, 5);
    r(fin, 1, 22, 5, 5);
    r(scaleDark, 1, 15, 4, 1);
    r(scaleDark, 1, 26, 5, 1);
    r(fin, 17, 18, 4, 5); // dorsal fin off the hip
    // Human torso rising out of the scales
    r(skin, 10, 6, 9, 9);
    r(flash || '#e0c39a', 10, 6, 9, 1);
    r(skinDark, 10, 6, 1, 9);
    r(skinDark, 11, 11, 7, 1);
    r(scale, 10, 13, 9, 2);
    // Arms, one holding a trident
    r(skin, 7, 7, 3, 6);
    r(skin, 19, 7, 3, 6);
    r(skin, 19, 12, 4, 3);
    // Head, with a green sweep of hair
    r(skin, 11, 0, 7, 7);
    r(skinDark, 11, 0, 1, 7);
    r(flash || '#1f4a38', 10, 0, 9, 3);
    r(flash || '#1f4a38', 10, 2, 2, 6);
    r(flash || '#1f4a38', 17, 2, 2, 6);
    r('#24362e', 12, 4, 2, 1);
    r('#24362e', 15, 4, 2, 1);
    // Trident
    r(flash || '#6a5836', 23, 6, 2, 20);
    r(flash || '#8a7448', 23, 6, 1, 20);
    r(flash || '#b8c0cc', 21, 2, 2, 5);
    r(flash || '#b8c0cc', 24, 2, 2, 5);
    r(flash || '#b8c0cc', 27, 2, 1, 5);
    r(flash || '#b8c0cc', 21, 5, 7, 2);
  }

  private drawSahuagin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#3c6a63';
    const lit = flash || '#54897f';
    const dark = flash || '#27494a';
    const belly = flash || '#9fb08a';
    // Splayed webbed feet and legs
    r(hide, 10, 20, 4, 5);
    r(hide, 15, 20, 4, 5);
    r(dark, 10, 23, 9, 1);
    r(lit, 7, 25, 8, 3);
    r(lit, 14, 25, 8, 3);
    r(dark, 7, 27, 15, 1);
    // Torso, pale gullet down the front
    r(hide, 9, 10, 11, 10);
    r(lit, 9, 10, 11, 1);
    r(dark, 9, 10, 1, 10);
    r(belly, 12, 12, 5, 8);
    // Gill slits
    r(dark, 10, 12, 2, 1);
    r(dark, 10, 14, 2, 1);
    r(dark, 10, 16, 2, 1);
    // Arms ending in webbed claws
    r(hide, 6, 11, 3, 7);
    r(hide, 20, 11, 3, 7);
    r('#e8ddc4', 5, 17, 2, 3);
    r('#e8ddc4', 8, 17, 1, 3);
    // Blunt shark head
    r(hide, 9, 3, 10, 8);
    r(lit, 9, 3, 10, 1);
    r(dark, 9, 3, 1, 8);
    // Dorsal crest running up over the skull — the sahuagin's outline
    r(dark, 13, 0, 3, 4);
    r(dark, 11, 1, 2, 3);
    r(dark, 16, 1, 2, 3);
    // Wide toothed grin
    r(flash || '#1c2c26', 9, 8, 10, 3);
    r('#e8ddc4', 10, 8, 1, 3);
    r('#e8ddc4', 12, 8, 1, 2);
    r('#e8ddc4', 14, 8, 1, 3);
    r('#e8ddc4', 16, 8, 1, 2);
    r('#e8ddc4', 18, 8, 1, 3);
    // Lidless black eyes with a pinprick of light
    r('#d8d2b8', 10, 5, 3, 2);
    r('#d8d2b8', 15, 5, 3, 2);
    r('#0e1a18', 11, 5, 2, 2);
    r('#0e1a18', 15, 5, 2, 2);
    // Barbed trident
    r(flash || '#6f5433', 23, 8, 2, 18);
    r(flash || '#b9c2c8', 21, 1, 1, 8);
    r(flash || '#b9c2c8', 23, 0, 2, 9);
    r(flash || '#b9c2c8', 26, 1, 1, 8);
    r(flash || '#b9c2c8', 21, 7, 6, 2);
  }

  private drawGibberingMouther(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a5a6a'; // wet fleshy mound
    ctx.fillRect(s * 0.22, s * 0.26, s * 0.56, s * 0.5);
    ctx.fillStyle = flash || '#6a4a58'; // lumps
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.5, s * 0.22, s * 0.24, s * 0.12);
    ctx.fillRect(s * 0.26, s * 0.52, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#b08a3a'; // teeth around maws
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.6, s * 0.12, s * 0.04);
    ctx.fillStyle = flash || '#2a2a4a'; // staring eyes
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.48, s * 0.34, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.46, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.56, s * 0.06, s * 0.06);
    ctx.fillStyle = flash || '#c84a3a'; // drooling tongues
    ctx.fillRect(s * 0.38, s * 0.44, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.62, s * 0.34, s * 0.04, s * 0.1);
  }

  private drawFlameskull(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8b8a8'; // skull face
    ctx.fillRect(s * 0.36, s * 0.22, s * 0.28, s * 0.24);
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.08, s * 0.14);
    ctx.fillStyle = flash || '#6a5a4a'; // eye sockets + jaw
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.42, s * 0.4, s * 0.16, s * 0.05);
    ctx.fillStyle = flash || '#3a8af0'; // arcane fire
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.44, s * 0.02, s * 0.12, s * 0.1);
    ctx.fillStyle = '#0a2850'; // retina
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.06, s * 0.06);
  }

  private drawYuanTi(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a6a2a'; // serpent body
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.3);
    ctx.fillStyle = flash || '#4a8a3a'; // scales /
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.1);
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.36, s * 0.06);
    ctx.fillStyle = flash || '#3a6a2a'; // arms
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.34, s * 0.12, s * 0.12);
    ctx.fillStyle = flash || '#4a8a3a'; // hooded head
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#2a4a1a'; // serpent eyes
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.54, s * 0.18, s * 0.04, s * 0.03);
    ctx.fillStyle = '#e0d8d0'; // fangs
    ctx.fillRect(s * 0.44, s * 0.28, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.53, s * 0.28, s * 0.03, s * 0.06);
  }

  private drawGithyanki(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8c8a8'; // head
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#2a2a3a'; // silver hair
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.08);
    ctx.fillStyle = flash || '#a8a8c0'; // plate armor body
    ctx.fillRect(s * 0.32, s * 0.26, s * 0.36, s * 0.34);
    ctx.fillStyle = flash || '#8890c0'; // shoulders / pauldrons
    ctx.fillRect(s * 0.2, s * 0.26, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.26, s * 0.14, s * 0.12);
    ctx.fillStyle = flash || '#c0c8e0'; // silver greatsword
    ctx.fillRect(s * 0.7, s * 0.1, s * 0.06, s * 0.5);
    ctx.fillStyle = flash || '#e8e0c8'; // helm visor
    ctx.fillRect(s * 0.42, s * 0.22, s * 0.16, s * 0.04);
    ctx.fillStyle = flash || '#6a5c3a'; // legs
    ctx.fillRect(s * 0.38, s * 0.6, s * 0.1, s * 0.18);
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.1, s * 0.18);
  }

  private drawFomorian(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a6a5a'; // great stooped body
    ctx.fillRect(s * 0.26, s * 0.22, s * 0.48, s * 0.4);
    ctx.fillStyle = flash || '#8a7a68'; // head
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.16);
    ctx.fillStyle = flash || '#5a4a3a'; // hulking arms
    ctx.fillRect(s * 0.14, s * 0.28, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.72, s * 0.28, s * 0.14, s * 0.3);
    ctx.fillStyle = flash || '#c8c840'; // single baleful eye
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.12, s * 0.08);
    ctx.fillStyle = '#54320a';
    ctx.fillRect(s * 0.48, s * 0.14, s * 0.06, s * 0.04);
    ctx.fillStyle = flash || '#7a6a5a'; // legs
    ctx.fillRect(s * 0.32, s * 0.62, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.62, s * 0.14, s * 0.2);
    ctx.fillStyle = flash || '#4a3a2a'; // club
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.06, s * 0.34);
  }

  private drawBlinkDog(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a6a52'; // body
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.5, s * 0.2);
    ctx.fillStyle = flash || '#8a7a5e'; // head
    ctx.fillRect(s * 0.6, s * 0.24, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#5a4a36'; // ears
    ctx.fillRect(s * 0.62, s * 0.16, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.18, s * 0.06, s * 0.08);
    ctx.fillStyle = '#6a48e8'; // fey glowing eyes
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#7a6a52'; // legs + tail
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.36, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.08, s * 0.4, s * 0.08, s * 0.08);
  }

  /**
   * The whole point of a pseudodragon is that it is a dragon in miniature, so
   * it is drawn as one: perched on four legs, wing folded on the shoulder,
   * horned head on a raised neck — and the barbed tail carried up over its own
   * back, which is the one line no other small sprite in the set has.
   */
  private drawPseudodragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#8a3f2c';
    const lit = flash || '#c06a48';
    const dark = flash || '#571f14';
    const memb = flash || '#6d3324';
    // One wing thrown up and open on the left — a folded wing simply merged
    // into the body and left a lump, and the open triangle is what says dragon
    r(memb, 3, 3, 4, 7);
    r(memb, 7, 5, 4, 8);
    r(memb, 11, 8, 3, 6);
    r(lit, 3, 3, 4, 1);
    r(lit, 7, 5, 4, 1);
    r(lit, 11, 8, 3, 1);
    r(dark, 6, 5, 1, 5); // wing struts
    r(dark, 10, 8, 1, 5);
    r(lit, 2, 2, 2, 2); // wing claw at the elbow
    // Small barrel body, chest out
    r(hide, 12, 13, 9, 8);
    r(lit, 12, 13, 9, 1);
    r(dark, 12, 19, 9, 2);
    r(flash || '#d8a071', 15, 16, 5, 4); // pale belly
    // Legs and splayed claws
    r(dark, 12, 21, 4, 4);
    r(dark, 17, 21, 4, 4);
    r(hide, 11, 25, 6, 2);
    r(hide, 17, 25, 6, 2);
    r('#e6ddc6', 11, 26, 1, 1);
    r('#e6ddc6', 15, 26, 1, 1);
    r('#e6ddc6', 22, 26, 1, 1);
    // Neck and horned head
    r(hide, 19, 9, 5, 5);
    r(hide, 20, 4, 7, 6);
    r(lit, 20, 4, 7, 1);
    r(dark, 21, 9, 7, 2); // jaw
    r(hide, 26, 6, 2, 3); // snout
    r(dark, 16, 2, 4, 2); // back-swept horns
    r(dark, 18, 3, 3, 2);
    r(dark, 17, 5, 4, 2);
    r('#ffd23a', 22, 6, 3, 2);
    r('#20140a', 23, 6, 1, 2);
    // Tail sweeping out low and hooking up into the sting
    r(hide, 7, 19, 6, 3);
    r(hide, 3, 21, 5, 3);
    r(hide, 1, 20, 3, 4);
    r(lit, 7, 19, 6, 1);
    r(dark, 0, 16, 3, 5);
    r(dark, 1, 13, 2, 4); // sting cocked upward
  }

  private drawRoper(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a6a6e'; // columnar stone body
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.5);
    ctx.fillStyle = flash || '#8a8a90'; // rocky cap
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.4, s * 0.14);
    ctx.fillStyle = flash || '#4a4a4e'; // tendrils
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.24, s * 0.06);
    ctx.fillRect(s * 0.66, s * 0.36, s * 0.24, s * 0.06);
    ctx.fillRect(s * 0.06, s * 0.4, s * 0.28, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.22, s * 0.05);
    ctx.fillStyle = flash || '#c8c820'; // looker eyes
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.22, s * 0.08, s * 0.08);
    ctx.fillStyle = '#2a2a10';
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.36, s * 0.04, s * 0.04);
  }

  private drawRedSlaad(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#a82a2a'; // fat toad body
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.48, s * 0.36);
    ctx.fillStyle = flash || '#c84040'; // wide mouth head
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.4, s * 0.2);
    ctx.fillStyle = flash || '#e8c0b0'; // protruding teeth
    ctx.fillRect(s * 0.34, s * 0.26, s * 0.32, s * 0.05);
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.3, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.03, s * 0.06);
    ctx.fillStyle = flash || '#c84040'; // claws
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.72, s * 0.36, s * 0.08, s * 0.16);
    ctx.fillStyle = flash || '#a82a2a'; // legs
    ctx.fillRect(s * 0.3, s * 0.64, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.14, s * 0.14);
    ctx.fillStyle = '#f0e010'; // eyes
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.06);
  }

  private drawAnimatedArmor(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#a8b0c8'; // plate torso
    ctx.fillRect(s * 0.32, s * 0.26, s * 0.36, s * 0.34);
    ctx.fillStyle = flash || '#8890b0'; // helm (empty)
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.18);
    ctx.fillStyle = '#14181e'; // empty helm visor
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.16, s * 0.06);
    ctx.fillStyle = flash || '#b8c0d8'; // shoulders
    ctx.fillRect(s * 0.18, s * 0.26, s * 0.16, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.26, s * 0.16, s * 0.12);
    ctx.fillStyle = flash || '#a8b0c8'; // arms + sword
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.78, s * 0.34, s * 0.1, s * 0.2);
    ctx.fillStyle = flash || '#e8c860'; // sword blade
    ctx.fillRect(s * 0.8, s * 0.1, s * 0.04, s * 0.24);
    ctx.fillStyle = flash || '#a8b0c8'; // legs
    ctx.fillRect(s * 0.36, s * 0.6, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.1, s * 0.2);
  }

  /**
   * The needle blight is a porcupine of a tree: a hunched trunk with branch
   * arms, and needles fanned off the back, shoulders and crown so the whole
   * outline bristles. The needles go down first, so the body sits on them.
   */
  private drawNeedleBlight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const bark = flash || '#4a5a2a';
    const lit = flash || '#6f8440';
    const dark = flash || '#2b3618';
    const needle = flash || '#a8c454';
    const spikes: [number, number, number, number][] = [
      [2, 8, 5, 1], [1, 11, 6, 1], [2, 14, 5, 1], [3, 5, 4, 1],
      [21, 6, 5, 1], [22, 9, 5, 1], [21, 12, 5, 1], [23, 15, 4, 1],
      [9, 2, 1, 4], [12, 1, 1, 4], [15, 1, 1, 4], [18, 2, 1, 4],
      [6, 19, 3, 1], [20, 20, 3, 1],
    ];
    for (const [x, y, w, h] of spikes) r(needle, x, y, w, h);
    // Bent trunk of a body
    r(bark, 9, 6, 11, 14);
    r(lit, 9, 6, 11, 1);
    r(lit, 9, 7, 1, 12);
    r(dark, 9, 18, 11, 2);
    r(dark, 13, 9, 1, 8);
    // Branch arms, hanging to the knee, ending in twig claws
    r(bark, 5, 9, 4, 3);
    r(bark, 5, 12, 3, 7);
    r(dark, 4, 18, 2, 3);
    r(dark, 6, 18, 2, 2);
    r(bark, 20, 8, 4, 3);
    r(bark, 21, 11, 3, 7);
    r(dark, 21, 17, 2, 3);
    r(dark, 23, 17, 2, 2);
    // Root legs
    r(bark, 10, 20, 3, 5);
    r(bark, 16, 20, 3, 5);
    r(dark, 8, 25, 6, 2);
    r(dark, 15, 25, 6, 2);
    // Two hollows for eyes and a crack of a mouth
    r(flash || '#f0e060', 11, 9, 2, 2);
    r(flash || '#f0e060', 16, 9, 2, 2);
    r(dark, 12, 13, 5, 1);
  }

  /**
   * Everything on the twig blight is two pixels wide with air between: a
   * bundle of sticks that has stood up. The one burning eye in the knot is
   * the only thing on it that is not brown.
   */
  private drawTwigBlight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const twig = flash || '#7a6a44';
    const lit = flash || '#a08c5c';
    const dark = flash || '#4a3e26';
    // Legs, forked at the foot
    r(twig, 10, 18, 2, 6);
    r(twig, 16, 18, 2, 6);
    r(dark, 8, 24, 4, 2);
    r(dark, 11, 24, 2, 3);
    r(dark, 16, 24, 2, 3);
    r(dark, 17, 24, 4, 2);
    // Trunk, a few sticks bound together
    r(twig, 11, 9, 6, 9);
    r(lit, 11, 9, 1, 9);
    r(dark, 13, 10, 1, 7);
    r(dark, 15, 11, 1, 5);
    // Arms: long, thin, fingered, reaching
    r(twig, 5, 11, 6, 2);
    r(twig, 3, 8, 3, 4);
    r(dark, 1, 6, 3, 2);
    r(dark, 3, 6, 1, 3);
    r(dark, 4, 5, 2, 2);
    r(twig, 17, 10, 6, 2);
    r(twig, 22, 11, 3, 5);
    r(dark, 24, 15, 3, 2);
    r(dark, 25, 12, 2, 3);
    r(dark, 22, 16, 1, 3);
    // Knot of a head, twigs sprouting from it, and the eye
    r(twig, 11, 4, 6, 5);
    r(lit, 11, 4, 6, 1);
    r(dark, 11, 7, 6, 1);
    r(dark, 10, 1, 1, 3);
    r(dark, 13, 0, 1, 4);
    r(dark, 17, 1, 1, 3);
    r(twig, 12, 3, 4, 1);
    r(flash || '#ffb830', 13, 5, 3, 2);
    r(flash || '#ff5a1a', 14, 5, 1, 2);
  }

  /**
   * The needle blight is a trunk and the twig blight a bundle of sticks;
   * the vine blight is a knot — a rounded mass of coiled creeper with
   * leaves sprouting from it, a face sunk into the tangle, and a tendril
   * reaching out either side. Round where its cousins are straight.
   */
  private drawVineBlight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const vine = flash || '#3f6a2e';
    const lit = flash || '#5f8e44';
    const dark = flash || '#26421c';
    const leaf = flash || '#8ac04a';
    const eye = flash || '#f0e060';
    // Tendrils reaching out either side, hooking up at the tips
    r(vine, 2, 12, 6, 2);
    r(vine, 1, 8, 2, 5);
    r(vine, 1, 6, 3, 2);
    r(leaf, 3, 4, 2, 2);
    r(vine, 20, 14, 6, 2);
    r(vine, 25, 10, 2, 5);
    r(leaf, 24, 8, 3, 2);
    // Root legs, twisted
    r(vine, 9, 19, 4, 6);
    r(vine, 15, 19, 4, 6);
    r(dark, 10, 20, 1, 4);
    r(dark, 17, 20, 1, 4);
    r(dark, 8, 24, 5, 2);
    r(dark, 15, 24, 5, 2);
    // Body: a knotted mass of vine, the coils showing as bands
    r(vine, 7, 8, 14, 12);
    r(vine, 6, 10, 16, 8);
    r(lit, 8, 8, 12, 1);
    r(dark, 7, 19, 14, 1);
    r(dark, 6, 10, 1, 8);
    r(dark, 7, 11, 5, 1);
    r(dark, 15, 10, 6, 1);
    r(dark, 6, 15, 5, 1);
    r(dark, 17, 15, 5, 1);
    r(dark, 8, 18, 12, 1);
    r(lit, 8, 10, 3, 1);
    r(lit, 16, 13, 4, 1);
    r(lit, 9, 16, 4, 1);
    // Leaves sprouting from the knot
    r(leaf, 9, 6, 3, 2);
    r(leaf, 16, 5, 3, 3);
    r(leaf, 17, 5, 1, 1);
    r(leaf, 5, 12, 2, 2);
    r(leaf, 19, 17, 3, 2);
    // The face knotted into it: two hollows with a glint in each, a crack
    r(dark, 10, 12, 3, 3);
    r(dark, 15, 12, 3, 3);
    r(eye, 11, 13, 2, 1);
    r(eye, 15, 13, 2, 1);
    r(dark, 11, 16, 6, 1);
    r(dark, 13, 17, 2, 1);
  }

  /**
   * The whole joke of a gas spore is that from across a dark room it looks
   * like a beholder, so it is drawn as one that has gone wrong: the same
   * floating sphere, a blotch on the front that reads as a central eye until
   * you are close, and limp root-tendrils where the eyestalks should be. It
   * is deliberately built on the beholder's silhouette rather than away from
   * it, which is the one place in the set where a collision is the point.
   */
  private drawGasSpore(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#c4d59a';
    const lit = flash || '#e2eec2';
    const dark = flash || '#7e9059';
    const rot = flash || '#5d6b3c';
    // Limp tendrils where a beholder would have eyestalks
    r(rot, 6, 4, 2, 5);
    r(rot, 4, 1, 2, 4);
    r(rot, 12, 2, 2, 5);
    r(rot, 11, 0, 2, 3);
    r(rot, 18, 3, 2, 5);
    r(rot, 20, 0, 2, 4);
    r(rot, 22, 6, 2, 4);
    r(rot, 24, 4, 2, 3);
    // The bladder, corners stepped off
    r(skin, 7, 6, 15, 18);
    r(skin, 5, 9, 19, 12);
    r(lit, 8, 6, 12, 1);
    r(lit, 5, 10, 1, 9);
    r(dark, 8, 22, 12, 2);
    r(dark, 22, 11, 2, 8);
    // The blotch that passes for an eye at a distance
    r(dark, 9, 10, 11, 8);
    r(rot, 11, 11, 8, 6);
    r(flash || '#3f4a26', 13, 12, 4, 4);
    r(lit, 8, 9, 4, 3); // wet sheen
    // Spore pores and the rot spreading up from below
    r(rot, 8, 19, 3, 2);
    r(rot, 13, 20, 4, 2);
    r(rot, 18, 18, 3, 2);
    r(dark, 10, 7, 2, 2);
    r(dark, 17, 7, 2, 2);
    // The stalk it hangs from
    r(rot, 12, 24, 3, 4);
    r(dark, 10, 26, 8, 2);
  }

  private drawAllosaurus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a8a4a'; // bulky torso
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.42, s * 0.24);
    ctx.fillStyle = flash || '#7a9a58'; // belly
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.34, s * 0.1);
    ctx.fillStyle = flash || '#6a8a4a'; // tail
    ctx.fillRect(s * 0.06, s * 0.3, s * 0.2, s * 0.12);
    ctx.fillStyle = flash || '#7a9a58'; // neck + big head
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.18, s * 0.2);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.18, s * 0.2);
    ctx.fillStyle = flash || '#e8e4dc'; // teeth
    ctx.fillRect(s * 0.72, s * 0.26, s * 0.1, s * 0.04);
    ctx.fillStyle = '#241c10'; // eye
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#4a6832'; // tiny arms + legs
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.44, s * 0.5, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.5, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.08, s * 0.1);
  }

  private drawWarhorse(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a6840'; // sturdy body
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.46, s * 0.22);
    ctx.fillStyle = flash || '#a88058'; // head + neck
    ctx.fillRect(s * 0.6, s * 0.12, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.06, s * 0.12, s * 0.14);
    ctx.fillStyle = flash || '#c8a870'; // mane
    ctx.fillRect(s * 0.64, s * 0.16, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.2, s * 0.04, s * 0.12);
    ctx.fillStyle = flash || '#d8b88a'; // lower legs
    ctx.fillRect(s * 0.24, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.36, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.48, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.6, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillStyle = '#2a1c10'; // hooves
    ctx.fillRect(s * 0.24, s * 0.7, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.36, s * 0.7, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.7, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.6, s * 0.7, s * 0.08, s * 0.04);
    ctx.fillStyle = '#24180c';
    ctx.fillRect(s * 0.76, s * 0.12, s * 0.04, s * 0.04);
  }

  private drawMeenlock(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#b8c0e8'; // spectral-pale body
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.28, s * 0.26);
    ctx.fillStyle = flash || '#c8d0f0'; // head
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.16);
    ctx.fillStyle = flash || '#8a90c0'; // twitching antennae
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.1, s * 0.08, s * 0.08);
    ctx.fillStyle = '#2430ff'; // psionic eyes
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.32, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.32, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.44, s * 0.54, s * 0.12, s * 0.16);
    ctx.fillStyle = flash || '#c8d0f0'; // tail
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.1, s * 0.05);
  }

  private drawRedcap(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a2a18'; // blood-soaked cap
    ctx.fillRect(s * 0.36, s * 0.06, s * 0.28, s * 0.14);
    ctx.fillStyle = flash || '#c8b48a'; // wrinkled face
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.24, s * 0.16);
    ctx.fillStyle = flash || '#6a4a2a'; // lean body
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.2, s * 0.28);
    ctx.fillStyle = flash || '#4a6a8a'; // sickle in hand
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.06, s * 0.28);
    ctx.fillRect(s * 0.7, s * 0.1, s * 0.14, s * 0.06);
    ctx.fillStyle = '#2a1c10';
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#6a4a2a'; // legs + steel boots
    ctx.fillRect(s * 0.42, s * 0.6, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.5, s * 0.6, s * 0.08, s * 0.14);
    ctx.fillStyle = '#b8c0d0';
    ctx.fillRect(s * 0.4, s * 0.72, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.72, s * 0.12, s * 0.04);
  }

  private drawGithzerai(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8c8a8'; // shaved head
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#3a4a70'; // yellow focus robes
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.4);
    ctx.fillStyle = flash || '#5a6a90'; // arms folded
    ctx.fillRect(s * 0.2, s * 0.28, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.28, s * 0.14, s * 0.14);
    ctx.fillStyle = '#1a2030';
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#3a4a70'; // legs
    ctx.fillRect(s * 0.38, s * 0.64, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.64, s * 0.1, s * 0.16);
    ctx.fillStyle = flash || '#e8d830'; // psychic belt
    ctx.fillRect(s * 0.34, s * 0.46, s * 0.32, s * 0.04);
  }

  private drawIntellectDevourer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c86a4a'; // exposed brain body
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.3);
    ctx.fillStyle = flash || '#d88a6a'; // brain lobes
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.52, s * 0.18, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.08, s * 0.08);
    ctx.fillStyle = '#3040e0'; // psionic brain-stems
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.12, s * 0.08);
    ctx.fillStyle = flash || '#c86a4a'; // four legs
    ctx.fillRect(s * 0.22, s * 0.42, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.38, s * 0.44, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.56, s * 0.44, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.7, s * 0.42, s * 0.08, s * 0.1);
    ctx.fillStyle = '#1440ff';
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.04, s * 0.04);
  }

  private drawNothic(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#a86a8a'; // bloated, hunched body
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.48, s * 0.4);
    ctx.fillStyle = flash || '#c88a9a'; // paunch
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.18);
    ctx.fillStyle = flash || '#a86a8a'; // single great eye
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.2, s * 0.2);
    ctx.fillStyle = flash || '#e8e030'; // Weirding Eye iris
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.12, s * 0.12);
    ctx.fillStyle = '#241010';
    ctx.fillRect(s * 0.48, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#a86a8a'; // long arms
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#d8b8b0'; // claws
    ctx.fillRect(s * 0.12, s * 0.5, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.5, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.34, s * 0.68, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.56, s * 0.68, s * 0.1, s * 0.12);
  }


  /**
   * Like the rat swarm, this has to be many animals rather than a coloured
   * cloud: seven wasps drawn individually, banded, each with a pale wing blur
   * above it and a stinger behind, scattered up the whole box so the ragged
   * outline is the sprite. Airborne and gold — the insect swarm is the same
   * idea kept on the ground and beetle-dark, so the two never trade places.
   */
  private drawSwarmOfWasps(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const gold = flash || '#e0ab21';
    const dark = flash || '#241a06';
    const wing = flash || '#cfd8e8';
    const wasp = (x: number, y: number, dir: 1 | -1) => {
      const f = (dx: number, w: number) => (dir === 1 ? x + dx : x + 8 - dx - w);
      r(wing, f(1, 6), y, 6, 2); // wing blur
      r(dark, f(6, 2), y + 2, 2, 3); // head
      r(gold, f(3, 3), y + 2, 3, 3); // thorax
      r(dark, f(4, 1), y + 2, 1, 3);
      r(gold, f(0, 3), y + 3, 3, 2); // abdomen
      r(dark, f(1, 1), y + 3, 1, 2);
      r(dark, f(-1, 1), y + 4, 1, 1); // sting
      r('#150e02', f(7, 1), y + 3, 1, 1); // eye
    };
    wasp(3, 1, 1);
    wasp(16, 3, -1);
    wasp(0, 8, -1);
    wasp(11, 9, 1);
    wasp(19, 13, -1);
    wasp(4, 16, 1);
    wasp(15, 21, -1);
  }

  private drawLion(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8b060'; // tawny body
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.46, s * 0.2);
    ctx.fillStyle = flash || '#f0d080'; // mane
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.24, s * 0.24);
    ctx.fillStyle = flash || '#d8b060'; // head inside mane
    ctx.fillRect(s * 0.6, s * 0.22, s * 0.16, s * 0.14);
    ctx.fillStyle = flash || '#d8b060'; // tawny tail
    ctx.fillRect(s * 0.08, s * 0.4, s * 0.12, s * 0.06);
    ctx.fillStyle = flash || '#7a5c20'; // mane clumps
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.24, s * 0.05);
    ctx.fillStyle = flash || '#d8b060'; // legs
    ctx.fillRect(s * 0.24, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.64, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.68, s * 0.28, s * 0.04, s * 0.04);
  }

  private drawTiger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#e8a030'; // striped orange body
    ctx.fillRect(s * 0.18, s * 0.32, s * 0.5, s * 0.2);
    ctx.fillStyle = flash || '#241a08'; // black stripes
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.32, s * 0.04, s * 0.2);
    ctx.fillStyle = flash || '#e8a030'; // head
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#d88820'; // ears
    ctx.fillRect(s * 0.64, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.06, s * 0.06);
    ctx.fillStyle = '#f0f0e8'; // fangs
    ctx.fillRect(s * 0.68, s * 0.34, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#e8a030'; // legs + tail
    ctx.fillRect(s * 0.22, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.38, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.06, s * 0.4, s * 0.12, s * 0.06);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.76, s * 0.26, s * 0.04, s * 0.04);
  }

  private drawGiantScorpion(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8a04a'; // segmented body
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.22);
    ctx.fillStyle = flash || '#a0803a'; // plating bands
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.06, s * 0.24);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.06, s * 0.24);
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.06, s * 0.24);
    ctx.fillStyle = flash || '#c8a04a'; // pincers
    ctx.fillRect(s * 0.18, s * 0.28, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.68, s * 0.28, s * 0.14, s * 0.1);
    ctx.fillStyle = flash || '#a0803a'; // curling tail over back
    ctx.fillRect(s * 0.32, s * 0.1, s * 0.08, s * 0.22);
    ctx.fillRect(s * 0.2, s * 0.04, s * 0.12, s * 0.08);
    ctx.fillStyle = flash || '#e8e818'; // poison stinger
    ctx.fillRect(s * 0.24, s * 0.06, s * 0.06, s * 0.05);
    ctx.fillStyle = flash || '#6a5418'; // legs
    ctx.fillRect(s * 0.16, s * 0.54, s * 0.05, s * 0.18);
    ctx.fillRect(s * 0.26, s * 0.54, s * 0.05, s * 0.18);
    ctx.fillRect(s * 0.46, s * 0.54, s * 0.05, s * 0.18);
    ctx.fillRect(s * 0.56, s * 0.54, s * 0.05, s * 0.18);
  }

  private drawAnkylosaurus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a8a5e'; // armored body
    ctx.fillRect(s * 0.22, s * 0.26, s * 0.52, s * 0.24);
    ctx.fillStyle = flash || '#5a683e'; // dorsal plates
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.52, s * 0.22, s * 0.06, s * 0.06);
    ctx.fillStyle = flash || '#5a683e'; // armored tail + club
    ctx.fillRect(s * 0.06, s * 0.3, s * 0.18, s * 0.14);
    ctx.fillRect(s * 0.02, s * 0.28, s * 0.08, s * 0.18);
    ctx.fillStyle = flash || '#7a8a5e'; // head + beak
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.14, s * 0.12);
    ctx.fillStyle = flash || '#a8bc84'; // beak
    ctx.fillRect(s * 0.8, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillStyle = flash || '#5a683e'; // legs
    ctx.fillRect(s * 0.26, s * 0.5, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.44, s * 0.5, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.62, s * 0.5, s * 0.1, s * 0.2);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.03, s * 0.03);
  }


  private drawPriest(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8a882'; // head
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#f0f0e8'; // high collar
    ctx.fillRect(s * 0.42, s * 0.08, s * 0.16, s * 0.04);
    ctx.fillStyle = flash || '#8a90a8'; // flowing robes
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.4);
    ctx.fillStyle = flash || '#6a7288'; // robe shading
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.06, s * 0.3);
    ctx.fillStyle = flash || '#d8b83a'; // holy symbol
    ctx.fillRect(s * 0.46, s * 0.34, s * 0.08, s * 0.1);
    ctx.fillStyle = flash || '#c8b89a'; // mace in hand
    ctx.fillRect(s * 0.66, s * 0.28, s * 0.06, s * 0.2);
    ctx.fillStyle = flash || '#b8c8d8'; // mace head
    ctx.fillRect(s * 0.62, s * 0.22, s * 0.14, s * 0.06);
    ctx.fillStyle = flash || '#8a90a8'; // legs
    ctx.fillRect(s * 0.38, s * 0.64, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.64, s * 0.1, s * 0.16);
  }

  private drawAssassin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8a882'; // face
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#1a1a22'; // cowl + mask
    ctx.fillRect(s * 0.36, s * 0.06, s * 0.28, s * 0.12);
    ctx.fillRect(s * 0.4, s * 0.18, s * 0.2, s * 0.05);
    ctx.fillStyle = flash || '#2a2a36'; // black garb
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.4);
    ctx.fillStyle = flash || '#3a3a48'; // trailing cloak
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.12, s * 0.34);
    ctx.fillStyle = flash || '#3a3a48'; // trailing cape shadow
    ctx.fillRect(s * 0.16, s * 0.32, s * 0.08, s * 0.28);
    ctx.fillStyle = flash || '#c0c8d8'; // dagger
    ctx.fillRect(s * 0.7, s * 0.26, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#2a2a36'; // legs
    ctx.fillRect(s * 0.38, s * 0.64, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.64, s * 0.1, s * 0.16);
  }



  private drawYoungGreenDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3f6b34', '#2b4d24', '#9ada58', '#ddd6b8', 'young');
  }

  private drawYoungBlackDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3a3a42', '#24242c', '#7ee06a', '#c8c2b0', 'young');
  }


  private drawMagmaMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c85418'; // little impish body
    ctx.fillRect(s * 0.38, s * 0.3, s * 0.24, s * 0.28);
    ctx.fillStyle = flash || '#e87820'; // belly lava glow
    ctx.fillRect(s * 0.42, s * 0.38, s * 0.16, s * 0.14);
    ctx.fillStyle = flash || '#d86a20'; // head + stubby horns
    ctx.fillRect(s * 0.4, s * 0.18, s * 0.2, s * 0.14);
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.06, s * 0.06);
    ctx.fillStyle = flash || '#e8e000'; // burning eyes
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#a83a10'; // bat wings
    ctx.fillRect(s * 0.24, s * 0.2, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.62, s * 0.22, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.44, s * 0.58, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.2, s * 0.24, s * 0.04, s * 0.1); // smoke wisps
    ctx.fillStyle = flash || '#e8a040'; // ember flecks
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.03, s * 0.03);
  }

  private drawQuickling(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a98d8'; // lithe blurred body
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.2, s * 0.3);
    ctx.fillStyle = flash || '#a8b4ea'; // speed blur streak
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.16, s * 0.24);
    ctx.fillRect(s * 0.58, s * 0.3, s * 0.16, s * 0.22);
    ctx.fillStyle = flash || '#88c0c0'; // pointed ears
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.08, s * 0.12);
    ctx.fillStyle = flash || '#2a2040';
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#98a4e8'; // legs in motion
    ctx.fillRect(s * 0.32, s * 0.54, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.6, s * 0.54, s * 0.08, s * 0.16);
    ctx.fillStyle = flash || '#6a7ac0'; // scimitar
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.04, s * 0.22);
  }


  /**
   * The spectator on the beholder's own build at a smaller size: four
   * stalks rising off the crown, one eye that is nearly the whole face, and
   * a small mouth. The elder gets two more stalks, low on the sides, and a
   * darker hide.
   */
  private drawSpectator(ctx: CanvasRenderingContext2D, s: number, flash?: string, elder = false) {
    const r = this.grid(ctx, s);
    const hide = flash || (elder ? '#3f6f80' : '#4a8a9a');
    const lit = flash || (elder ? '#5f96aa' : '#6fb1c0');
    const dark = flash || (elder ? '#23414c' : '#2a5260');
    const pod = flash || '#a8dce6';
    const stalk = (pts: [number, number][], ex: number, ey: number) => {
      for (const [x, y] of pts) r(hide, x, y, 2, 2);
      r(pod, ex, ey, 3, 3);
      r(flash || '#1c1004', ex + 1, ey + 1, 1, 1);
    };
    stalk([[8, 8], [6, 6]], 3, 3);
    stalk([[11, 6], [10, 4]], 8, 1);
    stalk([[15, 6], [16, 4]], 17, 1);
    stalk([[18, 8], [20, 6]], 22, 3);
    if (elder) {
      stalk([[6, 11], [4, 10]], 1, 8);
      stalk([[20, 11], [22, 10]], 24, 8);
    }
    // Sphere
    r(hide, 8, 9, 12, 15);
    r(hide, 6, 12, 16, 9);
    r(lit, 9, 9, 10, 1);
    r(lit, 6, 13, 1, 7);
    r(dark, 9, 22, 10, 2);
    r(dark, 21, 13, 1, 7);
    // One big eye
    r(dark, 8, 11, 12, 1);
    r(flash || '#f4f7ff', 8, 12, 12, 7);
    r(flash || '#f0e060', 10, 13, 8, 5);
    r(flash || '#1c1004', 12, 14, 4, 3);
    r(flash || '#ffffff', 13, 14, 1, 1);
    r(dark, 8, 19, 12, 1);
    // Small mouth
    r(flash || '#1c2a30', 10, 21, 8, 2);
    r(flash || '#e8f0e0', 11, 21, 1, 1);
    r(flash || '#e8f0e0', 14, 21, 1, 1);
    r(flash || '#e8f0e0', 17, 21, 1, 1);
  }

  private drawChuul(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#b8583a'; // lobster shell body
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.48, s * 0.28);
    ctx.fillStyle = flash || '#8a4024'; // shell banding
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.06, s * 0.3);
    ctx.fillRect(s * 0.44, s * 0.26, s * 0.06, s * 0.3);
    ctx.fillRect(s * 0.58, s * 0.26, s * 0.06, s * 0.3);
    ctx.fillStyle = flash || '#d87a58'; // huge claws
    ctx.fillRect(s * 0.08, s * 0.34, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.72, s * 0.34, s * 0.2, s * 0.12);
    ctx.fillStyle = flash || '#7a3a20'; // claw pincers
    ctx.fillRect(s * 0.08, s * 0.42, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.42, s * 0.14, s * 0.06);
    ctx.fillStyle = flash || '#b8583a'; // tail curl
    ctx.fillRect(s * 0.2, s * 0.5, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.3, s * 0.58, s * 0.14, s * 0.1);
    ctx.fillStyle = '#e0b040'; // eyes on stalks
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.16, s * 0.06, s * 0.06);
    ctx.fillStyle = flash || '#4a4a4e'; // tail slaps ground
    ctx.fillRect(s * 0.16, s * 0.66, s * 0.2, s * 0.04);
  }

  private drawBabau(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a4036'; // skeletal black-red body
    ctx.fillRect(s * 0.26, s * 0.24, s * 0.48, s * 0.4);
    ctx.fillStyle = flash || '#4a3228'; // ribs visible
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.42, s * 0.32, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.32, s * 0.12, s * 0.2);
    ctx.fillStyle = flash || '#3a2820'; // slavering head + horns
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.18);
    ctx.fillRect(s * 0.38, s * 0.02, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.04, s * 0.08, s * 0.06);
    ctx.fillStyle = '#e03030'; // dripping red eyes
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#3a2820'; // long arms with claws
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.14, s * 0.16);
    ctx.fillStyle = '#e0c8b8'; // claws
    ctx.fillRect(s * 0.12, s * 0.52, s * 0.1, s * 0.03);
    ctx.fillRect(s * 0.78, s * 0.52, s * 0.1, s * 0.03);
    ctx.fillRect(s * 0.38, s * 0.64, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.64, s * 0.1, s * 0.12);
  }


  private drawCyclops(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a8068'; // brawny giant torso
    ctx.fillRect(s * 0.26, s * 0.22, s * 0.48, s * 0.42);
    ctx.fillStyle = flash || '#a89a80'; // shaggy pelt
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.4, s * 0.08);
    ctx.fillStyle = flash || '#8a8068'; // blunt head
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.32, s * 0.16);
    ctx.fillStyle = flash || '#c8b89a'; // single eye mounted high
    ctx.fillRect(s * 0.42, s * 0.08, s * 0.16, s * 0.1);
    ctx.fillStyle = '#241c10';
    ctx.fillRect(s * 0.48, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#8a8068'; // huge arms + tree club
    ctx.fillRect(s * 0.12, s * 0.28, s * 0.16, s * 0.3);
    ctx.fillRect(s * 0.72, s * 0.28, s * 0.16, s * 0.3);
    ctx.fillStyle = flash || '#5a4a32'; // club
    ctx.fillRect(s * 0.78, s * 0.14, s * 0.08, s * 0.4);
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.64, s * 0.14, s * 0.2);
  }

  private drawSlaadBlue(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5878c8'; // hulking frog-blue body
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.32);
    ctx.fillStyle = flash || '#6a88dc'; // broad warty head
    ctx.fillRect(s * 0.28, s * 0.14, s * 0.44, s * 0.2);
    ctx.fillStyle = flash || '#38489a'; // horny ridges
    ctx.fillRect(s * 0.32, s * 0.1, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.58, s * 0.12, s * 0.1, s * 0.06);
    ctx.fillStyle = '#e8e020'; // wide frog eyes
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.58, s * 0.18, s * 0.08, s * 0.06);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.6, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#38489a'; // enormous claws
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.36, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.14, s * 0.14);
  }

  private drawLeucrotta(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a4a3a'; // heavy hyena wolf body
    ctx.fillRect(s * 0.16, s * 0.32, s * 0.5, s * 0.2);
    ctx.fillStyle = flash || '#6a5a46'; // striped haunches
    ctx.fillRect(s * 0.24, s * 0.32, s * 0.2, s * 0.2);
    ctx.fillStyle = flash || '#4a3a2c'; // stripes
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.04, s * 0.22);
    ctx.fillStyle = flash || '#6a5a46'; // huge hyena head
    ctx.fillRect(s * 0.6, s * 0.14, s * 0.24, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.22, s * 0.1, s * 0.12);
    ctx.fillStyle = flash || '#4a3a2c'; // giant ears
    ctx.fillRect(s * 0.62, s * 0.06, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.76, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillStyle = '#2a1c10';
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.76, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = '#54320a'; // hooves
    ctx.fillRect(s * 0.2, s * 0.52, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.36, s * 0.52, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.52, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.66, s * 0.52, s * 0.08, s * 0.16);
  }

  private drawGiantApe(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a5646'; // bulky gorilla body
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.52, s * 0.34);
    ctx.fillStyle = flash || '#7a6550'; // chest
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.2);
    ctx.fillStyle = flash || '#4a3c30'; // long arms
    ctx.fillRect(s * 0.06, s * 0.32, s * 0.2, s * 0.16);
    ctx.fillRect(s * 0.74, s * 0.32, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#3a2e24'; // fists
    ctx.fillRect(s * 0.06, s * 0.48, s * 0.16, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.48, s * 0.16, s * 0.08);
    ctx.fillStyle = flash || '#7a6550'; // low browed face
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#8a7560'; // brow ridge
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.05);
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(s * 0.46, s * 0.2, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.53, s * 0.2, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#6a5646'; // thick legs
    ctx.fillRect(s * 0.3, s * 0.6, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.6, s * 0.14, s * 0.2);
  }

  private drawUlitharid(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#9a72b8';
    const lit = flash || '#c39fdc';
    const dark = flash || '#5f4179';
    const robe = flash || '#2a1d3d';
    const robeLit = flash || '#453059';
    const robeDark = flash || '#150e20';
    const trim = flash || '#b89a44';
    // An ulitharid is a mind flayer that kept growing: taller cranium,
    // wider robe, and six tentacles instead of four — the outer pair
    // long enough to reach the floor, which is the tell at this size.
    r(robe, 8, 16, 12, 8);
    r(robe, 5, 21, 18, 6);
    r(robeLit, 8, 16, 12, 1);
    r(robeDark, 5, 25, 18, 2);
    r(robeDark, 10, 21, 1, 6);
    r(robeDark, 17, 21, 1, 6);
    r(robe, 4, 12, 20, 5);
    r(robeLit, 4, 12, 20, 1);
    r(trim, 4, 16, 20, 1);
    r(robe, 2, 4, 4, 9);
    r(robe, 22, 4, 4, 9);
    r(robeLit, 2, 4, 1, 9);
    r(robeLit, 25, 4, 1, 9);
    r(trim, 2, 4, 4, 1);
    r(trim, 22, 4, 4, 1);
    // Arms held wide, long fingers
    r(robe, 1, 14, 4, 7);
    r(robe, 23, 14, 4, 7);
    r(skin, 0, 20, 4, 3);
    r(skin, 24, 20, 4, 3);
    r(dark, 0, 23, 1, 3);
    r(dark, 2, 23, 1, 3);
    r(dark, 25, 23, 1, 3);
    r(dark, 27, 23, 1, 3);
    // Cranium, ridged and half again the flayer's height
    r(skin, 9, 0, 11, 10);
    r(lit, 9, 0, 11, 1);
    r(dark, 9, 0, 1, 10);
    r(skin, 10, 10, 9, 3);
    r(dark, 9, 5, 11, 1);
    r(dark, 12, 1, 1, 4);
    r(dark, 16, 1, 1, 4);
    r(lit, 13, 1, 3, 1);
    // Six tentacles
    r(skin, 8, 12, 2, 10); r(skin, 6, 21, 2, 4); r(dark, 4, 24, 3, 2);
    r(skin, 10, 12, 2, 6); r(skin, 10, 18, 2, 3); r(dark, 8, 20, 3, 2);
    r(skin, 13, 12, 2, 7); r(dark, 13, 19, 2, 2);
    r(skin, 16, 12, 2, 7); r(dark, 16, 19, 2, 2);
    r(skin, 18, 12, 2, 6); r(skin, 18, 18, 2, 3); r(dark, 18, 20, 3, 2);
    r(skin, 20, 12, 2, 10); r(skin, 21, 21, 2, 4); r(dark, 21, 24, 3, 2);
    r(lit, 8, 12, 1, 9);
    r(lit, 13, 12, 1, 6);
    r(lit, 20, 12, 1, 9);
    // Eyes: the ulitharid's burn instead of being merely blind
    r(flash || '#f2d6ff', 10, 6, 4, 2);
    r(flash || '#f2d6ff', 16, 6, 3, 2);
    r(flash || '#a05ad0', 10, 7, 4, 1);
    r(flash || '#a05ad0', 16, 7, 3, 1);
  }

  /**
   * The beholder's own build, dried to a skull: what eyestalks are left are
   * bare bone with a will-o-light at the end of each, the great eye is an
   * empty socket with a spark burning at the back of it, and the grin has
   * every tooth still in it.
   */
  private drawDeathTyrant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const bone = flash || '#a89c8e';
    const lit = flash || '#cfc4b4';
    const dark = flash || '#5e554c';
    const gap = flash || '#1c1a1e';
    const necro = flash || '#3ddc5a';
    const necroDark = flash || '#0f5a22';
    const stalk = (pts: [number, number][], ex: number, ey: number) => {
      for (const [x, y] of pts) r(bone, x, y, 2, 3);
      r(dark, ex, ey, 3, 3);
      r(necro, ex + 1, ey + 1, 1, 1);
    };
    stalk([[7, 8], [5, 6], [3, 4]], 1, 2);
    stalk([[10, 5], [9, 2]], 8, 0);
    stalk([[17, 5], [18, 2]], 18, 0);
    stalk([[21, 8], [23, 6], [25, 4]], 24, 2);
    // The sphere, cracked across and sunken at the cheeks
    r(bone, 7, 7, 15, 19);
    r(bone, 5, 10, 19, 13);
    r(lit, 8, 7, 13, 1);
    r(lit, 5, 11, 1, 10);
    r(dark, 8, 24, 13, 2);
    r(dark, 23, 12, 1, 9);
    r(dark, 6, 19, 3, 3);
    r(dark, 20, 20, 3, 2);
    r(gap, 18, 8, 1, 3);
    r(gap, 19, 10, 1, 2);
    r(gap, 20, 12, 1, 2);
    r(gap, 9, 22, 2, 1);
    r(gap, 11, 23, 2, 1);
    // The socket
    r(gap, 8, 9, 13, 8);
    r(dark, 8, 9, 13, 1);
    r(necroDark, 10, 11, 9, 5);
    r(necro, 12, 12, 5, 3);
    r(flash || '#dfffe4', 14, 13, 1, 1);
    // The grin
    r(gap, 8, 19, 13, 5);
    r(lit, 8, 18, 13, 1);
    r(bone, 9, 19, 2, 2);
    r(bone, 12, 19, 2, 3);
    r(bone, 15, 19, 2, 2);
    r(bone, 18, 19, 2, 3);
    r(dark, 10, 22, 2, 2);
    r(dark, 14, 22, 2, 2);
    r(dark, 18, 22, 2, 2);
  }

  /**
   * A boar is front-heavy: the shoulder hump is the highest point, the hind
   * quarters fall away behind it, and the head runs straight off the shoulder
   * into the snout with no neck. Drawn as an even rectangle it was a loaf of
   * bread with legs, and read the same as the rat and the gray ooze.
   */
  private drawWildBoar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#6a4a32';
    const lit = flash || '#88603f';
    const dark = flash || '#452e1e';
    // Curly tail
    r(dark, 1, 12, 3, 2);
    r(dark, 0, 13, 2, 3);
    // Hindquarters, low
    r(hide, 3, 14, 8, 8);
    r(lit, 4, 14, 7, 1);
    // Shoulder hump, the tallest point of the animal
    r(hide, 10, 9, 9, 13);
    r(lit, 11, 9, 8, 2);
    r(dark, 3, 20, 16, 2);
    // Bristle mane along the ridge
    r(dark, 10, 7, 2, 3);
    r(dark, 12, 6, 2, 4);
    r(dark, 14, 6, 2, 4);
    r(dark, 16, 7, 2, 3);
    // Short legs and cloven hooves
    r(dark, 4, 22, 3, 4);
    r(dark, 8, 22, 3, 4);
    r(dark, 13, 22, 3, 4);
    r(dark, 17, 22, 3, 4);
    r(flash || '#1e1810', 4, 26, 3, 2);
    r(flash || '#1e1810', 8, 26, 3, 2);
    r(flash || '#1e1810', 13, 26, 3, 2);
    r(flash || '#1e1810', 17, 26, 3, 2);
    // Head running straight off the shoulder into a blunt snout
    r(hide, 18, 11, 7, 9);
    r(lit, 18, 11, 7, 1);
    r(hide, 24, 14, 4, 5);
    r(flash || '#8f6a5a', 26, 15, 2, 3);
    r(dark, 18, 19, 10, 1);
    // Ear laid back
    r(dark, 17, 9, 3, 4);
    // Upcurved tusks
    r('#efe6cc', 24, 12, 2, 3);
    r('#efe6cc', 23, 11, 1, 2);
    r('#efe6cc', 25, 18, 2, 2);
    // Small mean eye
    r(flash || '#241a08', 20, 13, 3, 2);
    r('#e8b03a', 21, 13, 2, 1);
  }

  /**
   * In profile and in the air, which is what keeps it off the dire wasp:
   * that one is pinned flat and seen from above. Two narrow wings raised
   * over the back, the banded abdomen hanging back to the sting, legs
   * dangling.
   */
  private drawGiantWasp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const chitin = flash || '#2a2a34';
    const lit = flash || '#4a4a5a';
    const stripe = flash || '#e8c02c';
    const memb = flash || '#c9cfe0';
    const vein = flash || '#7a80a0';
    // Wings, one seen behind the other
    r(memb, 8, 1, 11, 3);
    r(vein, 8, 1, 11, 1);
    r(memb, 4, 4, 12, 4);
    r(vein, 4, 4, 12, 1);
    r(vein, 9, 5, 1, 3);
    // Abdomen hanging back and down, banded, ending in the sting
    r(chitin, 1, 12, 12, 8);
    r(stripe, 1, 13, 12, 2);
    r(stripe, 1, 17, 12, 2);
    r(lit, 2, 12, 11, 1);
    r(chitin, 0, 15, 2, 3);
    r(flash || '#1a1a22', 0, 18, 1, 3);
    // Thorax, and the legs dangling under it
    r(chitin, 11, 8, 9, 9);
    r(lit, 11, 8, 9, 1);
    r(chitin, 12, 17, 2, 5);
    r(chitin, 15, 17, 2, 6);
    r(chitin, 18, 17, 2, 4);
    r(chitin, 10, 21, 3, 1);
    r(chitin, 16, 22, 3, 1);
    // Head with the compound eye, antennae forward, mandibles under
    r(chitin, 19, 8, 7, 7);
    r(lit, 19, 8, 7, 1);
    r(flash || '#d0342c', 22, 9, 3, 4);
    r(flash || '#f0705a', 22, 9, 3, 1);
    r(flash || '#e8dcc0', 21, 15, 1, 2);
    r(flash || '#e8dcc0', 24, 15, 1, 2);
    r(chitin, 24, 5, 1, 3);
    r(chitin, 25, 3, 2, 2);
    r(chitin, 26, 6, 1, 2);
    r(chitin, 27, 4, 1, 2);
  }

  private drawKuoToa(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#98946e';
    const lit = flash || '#b2ad86';
    const dark = flash || '#6d6a4c';
    // Splayed webbed feet
    r(hide, 10, 20, 4, 4);
    r(hide, 15, 20, 4, 4);
    r(lit, 7, 24, 8, 3);
    r(lit, 14, 24, 8, 3);
    r(dark, 7, 26, 15, 1);
    // Sagging pot belly — wider at the waist than at the shoulder
    r(hide, 10, 11, 9, 4);
    r(hide, 8, 14, 13, 7);
    r(lit, 10, 11, 9, 1);
    r(dark, 8, 14, 1, 7);
    r(lit, 11, 16, 7, 4);
    // Arms with webbed hands
    r(hide, 5, 12, 3, 7);
    r(hide, 21, 12, 3, 7);
    r(lit, 3, 18, 4, 3);
    r(lit, 22, 18, 4, 3);
    // Bulbous head
    r(hide, 10, 4, 9, 7);
    r(lit, 10, 4, 9, 1);
    r(dark, 10, 4, 1, 7);
    // Eyes bulging clear of the skull on either side — the kuo-toa's outline
    r(lit, 6, 3, 5, 5);
    r(lit, 18, 3, 5, 5);
    r('#f2eedc', 6, 3, 5, 1);
    r('#f2eedc', 18, 3, 5, 1);
    r('#16161e', 7, 4, 3, 3);
    r('#16161e', 19, 4, 3, 3);
    r('#8ad8e8', 8, 5, 1, 1);
    r('#8ad8e8', 20, 5, 1, 1);
    // Gaping lamprey mouth
    r(flash || '#2a2418', 11, 8, 7, 3);
    r('#e2dcbe', 11, 8, 7, 1);
    r('#e2dcbe', 12, 9, 1, 2);
    r('#e2dcbe', 15, 9, 1, 2);
    // Head spines
    r(dark, 13, 1, 2, 3);
    r(dark, 11, 2, 1, 3);
    r(dark, 16, 2, 1, 3);
    // Barbed harpoon
    r(flash || '#6a7a54', 25, 6, 2, 20);
    r(flash || '#e2dcbe', 25, 1, 2, 6);
    r(flash || '#e2dcbe', 23, 4, 2, 2);
  }

  private drawSaberToothedTiger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8d8c8'; // pale shaggy body
    ctx.fillRect(s * 0.16, s * 0.32, s * 0.52, s * 0.2);
    ctx.fillStyle = flash || '#a8a890'; // icy shading
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.44, s * 0.1);
    ctx.fillStyle = flash || '#d8d8c8'; // massive head + jaw
    ctx.fillRect(s * 0.62, s * 0.16, s * 0.24, s * 0.24);
    ctx.fillStyle = '#f0f0e8'; // giant saber fangs
    ctx.fillRect(s * 0.68, s * 0.36, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.36, s * 0.05, s * 0.1);
    ctx.fillStyle = flash || '#a8a890'; // stubby ears
    ctx.fillRect(s * 0.66, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.68, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.76, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#d8d8c8'; // legs + darts tail
    ctx.fillRect(s * 0.2, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.36, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.52, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.06, s * 0.4, s * 0.1, s * 0.06);
  }

  private drawMerrow(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a8a6a'; // slimy ogre-webbed body
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.44, s * 0.3);
    ctx.fillStyle = flash || '#4a7860'; // fish scale belly
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.14);
    ctx.fillStyle = flash || '#6a9a78'; // wide fish head
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.18);
    ctx.fillStyle = flash || '#4a6040'; // bottom jaw fins
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.2, s * 0.04);
    ctx.fillStyle = '#e8d8c8'; // sharp teeth
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.04);
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillStyle = flash || '#5a8a6a'; // legs + webbed arms
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.72, s * 0.34, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.56, s * 0.14, s * 0.16);
    ctx.fillStyle = flash || '#7ab894'; // dorsal fin
    ctx.fillRect(s * 0.42, s * 0.06, s * 0.16, s * 0.08);
  }


  private drawMezzoloth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a4a3a'; // insectoid body
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.34);
    ctx.fillStyle = flash || '#4a3c2e'; // carapace banding
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.06, s * 0.36);
    ctx.fillRect(s * 0.58, s * 0.24, s * 0.06, s * 0.36);
    ctx.fillStyle = flash || '#5a4a3a'; // insectoid head + mandibles
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#3a2e22'; // mandibles
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillStyle = '#e88a20'; // insect eyes
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#c0c8d8'; // smoking greatsword
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.7, s * 0.44, s * 0.05, s * 0.1);
    ctx.fillStyle = flash || '#a09080'; // wispy smoke
    ctx.fillRect(s * 0.76, s * 0.2, s * 0.04, s * 0.08);
    ctx.fillStyle = flash || '#5a4a3a'; // legs
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.6, s * 0.1, s * 0.14);
  }

  private drawAnnisHag(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a4848'; // jagged iron-blue skin
    ctx.fillRect(s * 0.26, s * 0.24, s * 0.48, s * 0.34);
    ctx.fillStyle = flash || '#2c3838'; // wicker and iron armor bits
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.1);
    ctx.fillStyle = flash || '#3a4848'; // crooked head + jagged teeth
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.16);
    ctx.fillStyle = '#f0f0e8'; // iron mouthful of teeth
    ctx.fillRect(s * 0.36, s * 0.22, s * 0.28, s * 0.04);
    ctx.fillStyle = '#e8e020'; // hungry eye
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillStyle = '#241c10';
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.56, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#3a4848'; // iron-clawed arms
    ctx.fillRect(s * 0.12, s * 0.32, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.32, s * 0.14, s * 0.2);
    ctx.fillStyle = '#c0c0c8'; // claws
    ctx.fillRect(s * 0.12, s * 0.52, s * 0.1, s * 0.03);
    ctx.fillRect(s * 0.78, s * 0.52, s * 0.1, s * 0.03);
    ctx.fillRect(s * 0.34, s * 0.58, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.58, s * 0.12, s * 0.16);
  }


  private drawFlind(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a6a48'; // hulking gnoll body
    ctx.fillRect(s * 0.24, s * 0.24, s * 0.52, s * 0.34);
    ctx.fillStyle = flash || '#6a4c30'; // matted fur shading
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.16);
    ctx.fillStyle = flash || '#8a6a48'; // hyena head + muzzle
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.18);
    ctx.fillStyle = flash || '#6a4c30'; // big ears
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.06, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.38, s * 0.18, s * 0.24, s * 0.05);
    ctx.fillRect(s * 0.42, s * 0.22, s * 0.04, s * 0.03);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#6a4c30'; // flail with chains
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.06, s * 0.24);
    ctx.fillRect(s * 0.68, s * 0.44, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.66, s * 0.44, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.3, s * 0.58, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.58, s * 0.14, s * 0.16);
  }

  private drawNycaloth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a4a48'; // storm-hued metal skin
    ctx.fillRect(s * 0.26, s * 0.26, s * 0.48, s * 0.32);
    ctx.fillStyle = flash || '#2c3a3a'; // armor plating
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.4, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.46, s * 0.4, s * 0.05);
    ctx.fillStyle = flash || '#4a6a68'; // massive wings
    ctx.fillRect(s * 0.08, s * 0.14, s * 0.2, s * 0.26);
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.2, s * 0.2);
    ctx.fillStyle = flash || '#3a4a48'; // blocky head
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.18);
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(s * 0.46, s * 0.18, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.53, s * 0.18, s * 0.03, s * 0.03);
    ctx.fillStyle = '#f0f0e8';
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.2, s * 0.03);
    ctx.fillRect(s * 0.34, s * 0.58, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.58, s * 0.14, s * 0.16);
  }

  private drawSlaadVoid(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#2a2838'; // inky huge toad body
    ctx.fillRect(s * 0.2, s * 0.28, s * 0.6, s * 0.34);
    ctx.fillStyle = flash || '#16141f'; // void shading
    ctx.fillRect(s * 0.26, s * 0.36, s * 0.48, s * 0.2);
    ctx.fillStyle = flash || '#2a2838'; // massive head
    ctx.fillRect(s * 0.26, s * 0.12, s * 0.48, s * 0.2);
    ctx.fillStyle = '#f0f0ff'; // star-flecked void eyes
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.46, s * 0.2, s * 0.08, s * 0.05);
    ctx.fillStyle = '#14121c';
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.62, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = '#6a50ff'; // negative energy crackle
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.03, s * 0.12);
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.03, s * 0.1);
    ctx.fillStyle = flash || '#2a2838'; // claws + legs
    ctx.fillRect(s * 0.24, s * 0.62, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.4, s * 0.62, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.58, s * 0.62, s * 0.14, s * 0.14);
  }

  private drawAdultWhiteDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#cfe0ea', '#9fbcd0', '#bff3ff', '#e8f4ff', 'adult');
  }

  private drawAdultBlackDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3a3a42', '#24242c', '#7ee06a', '#c8c2b0', 'adult');
  }

  private drawAdultGreenDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3f6b34', '#2b4d24', '#9ada58', '#ddd6b8', 'adult');
  }

  private drawAdultBlueDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#2f5fa8', '#22467c', '#7fd8ff', '#e4ecf4', 'adult');
  }

  /**
   * Nothing but head and tail yet: a fat lump of a skull with goggle eyes
   * standing proud of it, a slit of teeth, and a tail whipping off behind.
   */
  private drawSlaadTadpole(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7d8c9c';
    const lit = flash || '#a5b3c2';
    const dark = flash || '#4d5967';
    const belly = flash || '#c5cfd8';
    // Tail
    r(hide, 16, 15, 6, 3);
    r(hide, 20, 12, 5, 3);
    r(hide, 23, 8, 3, 4);
    r(hide, 24, 5, 2, 3);
    r(dark, 16, 17, 6, 1);
    r(lit, 20, 12, 5, 1);
    // Head, wider than it is tall
    r(hide, 3, 9, 14, 11);
    r(hide, 5, 7, 10, 2);
    r(lit, 5, 7, 10, 1);
    r(lit, 3, 10, 1, 8);
    r(dark, 3, 18, 14, 2);
    r(belly, 6, 16, 9, 3);
    // Goggle eyes on top of the crown
    r(hide, 5, 4, 4, 4);
    r(hide, 11, 4, 4, 4);
    r(flash || '#ffe14a', 5, 4, 4, 3);
    r(flash || '#ffe14a', 11, 4, 4, 3);
    r(flash || '#1c1004', 6, 5, 2, 2);
    r(flash || '#1c1004', 12, 5, 2, 2);
    // Toothy slit of a mouth
    r(dark, 3, 14, 12, 2);
    r(flash || '#f0ece0', 4, 14, 1, 1);
    r(flash || '#f0ece0', 7, 14, 1, 1);
    r(flash || '#f0ece0', 10, 14, 1, 1);
    r(flash || '#f0ece0', 13, 14, 1, 1);
    // Forelimb buds, the first sign of what it will become
    r(hide, 4, 20, 3, 4);
    r(hide, 12, 20, 3, 4);
    r(dark, 4, 23, 3, 1);
    r(dark, 12, 23, 3, 1);
    r(dark, 8, 24, 4, 2);
  }

  private drawGiantOctopus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#a05a6a'; // mottled mantle
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.3);
    ctx.fillStyle = flash || '#b86a7a'; // wet blotches
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.12, s * 0.14);
    ctx.fillStyle = flash || '#8a4a58'; // eight writhing arms
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.2, s * 0.08);
    ctx.fillRect(s * 0.24, s * 0.48, s * 0.18, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.4, s * 0.2, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.5, s * 0.18, s * 0.08);
    ctx.fillRect(s * 0.12, s * 0.56, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.74, s * 0.56, s * 0.14, s * 0.06);
    ctx.fillStyle = '#243030';
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.46, s * 0.12, s * 0.1, s * 0.08);
    ctx.fillStyle = '#e0d8c0'; // ink-spit mouth
    ctx.fillRect(s * 0.42, s * 0.28, s * 0.1, s * 0.06);
  }

  private drawSwordWraith(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4a58'; // fading spectral body
    ctx.fillRect(s * 0.32, s * 0.22, s * 0.36, s * 0.26);
    ctx.fillStyle = flash || '#5a5a6c'; // translucent edges
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.14, s * 0.22);
    ctx.fillRect(s * 0.6, s * 0.34, s * 0.14, s * 0.18);
    ctx.fillStyle = flash || '#6a88a0'; // dim helmet armor
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.28, s * 0.16);
    ctx.fillStyle = flash || '#7a9ab8'; // glowing rune helm
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.12, s * 0.06);
    ctx.fillStyle = '#a0c8ea'; // burning eyes
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#5a5a6c'; // spectral greatsword
    ctx.fillRect(s * 0.7, s * 0.18, s * 0.05, s * 0.32);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.05, s * 0.28);
    ctx.fillRect(s * 0.12, s * 0.32, s * 0.14, s * 0.08); // tattered shroud
    ctx.fillRect(s * 0.4, s * 0.48, s * 0.2, s * 0.16);
  }

  /**
   * A warlock who died still owing: a hooded corpse in a tattered robe,
   * eyes and chest-rune burning the green of its patron, one bony hand
   * raised with an eldritch bolt crackling off it. The bolt is solid paint
   * held clear of the edge so the rim pass can outline it.
   */
  private drawDeathlock(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const robe = flash || '#33303f';
    const robeLit = flash || '#4c4859';
    const robeDk = flash || '#1f1d28';
    const skin = flash || '#6e7370';
    const skinDk = flash || '#4a4f4d';
    const bone = flash || '#9aa094';
    const eye = flash || '#20f0a0';
    const bolt = flash || '#1adc90';
    const boltLit = flash || '#a0ffd8';
    // Tattered hem, strips of different lengths
    r(robe, 7, 21, 3, 4);
    r(robe, 11, 21, 3, 6);
    r(robe, 15, 21, 4, 5);
    r(robe, 20, 21, 2, 3);
    r(robeDk, 7, 24, 3, 1);
    r(robeDk, 11, 26, 3, 1);
    r(robeDk, 15, 25, 4, 1);
    // Robe, a belt of bone charms across it, the rune burning on the chest
    r(robe, 7, 11, 15, 10);
    r(robeLit, 7, 11, 15, 1);
    r(robeDk, 7, 11, 1, 10);
    r(robeDk, 7, 20, 15, 1);
    r(bone, 9, 16, 11, 1);
    for (const x of [10, 13, 16, 19]) r(robeDk, x, 16, 1, 1);
    r(bolt, 13, 13, 3, 1);
    r(bolt, 14, 12, 1, 3);
    // Left arm hanging, a bony hand at the end of it
    r(robe, 4, 12, 3, 7);
    r(robeDk, 4, 12, 1, 7);
    r(bone, 4, 19, 3, 2);
    r(bone, 4, 21, 1, 1);
    r(bone, 6, 21, 1, 1);
    // Right arm raised, hand open, the bolt off the fingers
    r(robe, 21, 11, 3, 4);
    r(robe, 22, 8, 3, 4);
    r(bone, 23, 5, 3, 3);
    r(bolt, 24, 1, 2, 4);
    r(bolt, 26, 2, 1, 2);
    r(bolt, 23, 1, 1, 1);
    r(boltLit, 24, 2, 1, 3);
    // Hood, and the shrivelled face deep inside it
    r(robe, 8, 1, 12, 4);
    r(robeLit, 9, 1, 10, 1);
    r(robe, 7, 4, 2, 8);
    r(robe, 19, 4, 2, 8);
    r(robeDk, 7, 9, 2, 3);
    r(robeDk, 19, 9, 2, 3);
    r(skinDk, 9, 4, 10, 8);
    r(skin, 10, 5, 8, 6);
    r(skinDk, 10, 5, 1, 6);
    r(eye, 11, 6, 2, 2);
    r(eye, 15, 6, 2, 2);
    r(boltLit, 11, 6, 1, 1);
    r(boltLit, 15, 6, 1, 1);
    r(skinDk, 13, 8, 2, 1);
    r(skinDk, 11, 10, 6, 1);
    r(bone, 12, 10, 1, 1);
    r(bone, 14, 10, 1, 1);
    r(bone, 16, 10, 1, 1);
  }

  private drawBoneNaga(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8c8c0'; // skeletal serpent coils
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.34, s * 0.2);
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.2, s * 0.22);
    ctx.fillStyle = flash || '#b0b0a8'; // rib segments
    ctx.fillRect(s * 0.32, s * 0.32, s * 0.24, s * 0.04);
    ctx.fillRect(s * 0.38, s * 0.4, s * 0.2, s * 0.04);
    ctx.fillStyle = flash || '#c8c8c0'; // snake skull head
    ctx.fillRect(s * 0.62, s * 0.26, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.1, s * 0.1);
    ctx.fillStyle = flash || '#e8e8e0'; // fangs + eye sockets
    ctx.fillRect(s * 0.74, s * 0.28, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.66, s * 0.28, s * 0.03, s * 0.04);
    ctx.fillStyle = '#10a0ff'; // necrotic eye gleam
    ctx.fillRect(s * 0.72, s * 0.24, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#c8c8c0'; // tail rattle
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.1, s * 0.44, s * 0.08, s * 0.04);
  }

  /**
   * The gauth: six stalks, the sphere set high, the crackling eye, a wide
   * maw of teeth under it and feeder tendrils hanging below — which is what
   * separates its outline from the spectator's. The tyrant is darker and its
   * eye burns red.
   */
  private drawGauth(ctx: CanvasRenderingContext2D, s: number, flash?: string, tyrant = false) {
    const r = this.grid(ctx, s);
    const hide = flash || (tyrant ? '#4e3060' : '#6a4a7a');
    const lit = flash || (tyrant ? '#6f4a86' : '#8e6aa0');
    const dark = flash || (tyrant ? '#2c1836' : '#3c2846');
    const pod = flash || '#d8c8e8';
    const stalk = (pts: [number, number][], ex: number, ey: number) => {
      for (const [x, y] of pts) r(hide, x, y, 2, 2);
      r(pod, ex, ey, 3, 3);
      r(flash || '#c02020', ex + 1, ey + 1, 1, 1);
    };
    stalk([[6, 9], [4, 7]], 1, 4);
    stalk([[8, 6], [7, 4]], 5, 1);
    stalk([[12, 4], [12, 2]], 11, 0);
    stalk([[15, 4], [15, 2]], 15, 0);
    stalk([[18, 6], [19, 4]], 20, 1);
    stalk([[20, 9], [22, 7]], 24, 4);
    // Sphere
    r(hide, 8, 7, 12, 12);
    r(hide, 6, 10, 16, 6);
    r(lit, 9, 7, 10, 1);
    r(lit, 6, 11, 1, 4);
    r(dark, 21, 11, 1, 4);
    // The eye
    r(dark, 8, 9, 12, 1);
    r(flash || '#f4f7ff', 8, 10, 12, 5);
    r(flash || (tyrant ? '#ff5030' : '#c8e830'), 10, 11, 8, 3);
    r(flash || '#1c2004', 12, 11, 4, 3);
    r(flash || '#ffffff', 13, 11, 1, 1);
    // The maw
    r(lit, 8, 15, 12, 1);
    r(flash || '#2c0e24', 8, 16, 12, 3);
    r(flash || '#efe6cc', 9, 16, 1, 2);
    r(flash || '#efe6cc', 11, 16, 1, 1);
    r(flash || '#efe6cc', 13, 16, 1, 2);
    r(flash || '#efe6cc', 15, 16, 1, 1);
    r(flash || '#efe6cc', 17, 16, 1, 2);
    // Feeder tendrils
    r(hide, 7, 19, 2, 4);
    r(hide, 6, 22, 2, 3);
    r(hide, 11, 19, 2, 5);
    r(hide, 15, 19, 2, 5);
    r(hide, 16, 23, 2, 3);
    r(hide, 19, 19, 2, 4);
    r(hide, 20, 22, 2, 3);
  }

  private drawYuanTiAbomination(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a7a44'; // massive serpent body
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.44, s * 0.32);
    ctx.fillStyle = flash || '#5a8a54'; // diamond scale bands
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.36, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.36, s * 0.06);
    ctx.fillStyle = flash || '#4a7a44'; // viper-maw head
    ctx.fillRect(s * 0.34, s * 0.14, s * 0.32, s * 0.18);
    ctx.fillStyle = flash || '#3a6836'; // hood + horns
    ctx.fillRect(s * 0.32, s * 0.1, s * 0.36, s * 0.08);
    ctx.fillRect(s * 0.34, s * 0.04, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.58, s * 0.06, s * 0.08, s * 0.06);
    ctx.fillStyle = '#e8d8a8';
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.04);
    ctx.fillStyle = '#e8e000'; // serpent slit eyes
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.56, s * 0.16, s * 0.04, s * 0.03);
    ctx.fillStyle = flash || '#4a7a44'; // scaled arms
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.16, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.62, s * 0.16, s * 0.12);
  }

  private drawBheurHag(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8ab0d8'; // frost-blue crone robes
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.42);
    ctx.fillStyle = flash || '#6a90bc'; // icy robe pleats
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.08);
    ctx.fillStyle = flash || '#a8c8e8'; // wizened pale face
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.16);
    ctx.fillStyle = flash || '#e8f0f8'; // hoarfrost hair
    ctx.fillRect(s * 0.34, s * 0.02, s * 0.32, s * 0.1);
    ctx.fillStyle = '#2a4a6a'; // winter-cold eyes
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#c8e8f8'; // blizzard breath
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.04, s * 0.02);
    ctx.fillStyle = flash || '#8ee'; // drifting snow flecks
    ctx.fillRect(s * 0.2, s * 0.08, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.76, s * 0.06, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#6a90bc'; // ragged sleeves + staff
    ctx.fillRect(s * 0.12, s * 0.3, s * 0.18, s * 0.14);
    ctx.fillRect(s * 0.76, s * 0.28, s * 0.05, s * 0.4);
  }

  private drawGithyankiKnight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8c8a8'; // stern face
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#2a2a36'; // austere hair + headband
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.08);
    ctx.fillStyle = flash || '#5a6050'; // yellow-gold dragon plate
    ctx.fillRect(s * 0.32, s * 0.26, s * 0.36, s * 0.36);
    ctx.fillStyle = flash || '#6a7060'; // pauldrons
    ctx.fillRect(s * 0.2, s * 0.26, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.26, s * 0.14, s * 0.12);
    ctx.fillStyle = flash || '#c8c8e0'; // silver greatsword
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.05, s * 0.32);
    ctx.fillRect(s * 0.74, s * 0.1, s * 0.12, s * 0.06);
    ctx.fillStyle = '#141418';
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#5a6050'; // legs
    ctx.fillRect(s * 0.38, s * 0.62, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.62, s * 0.1, s * 0.14);
  }

  private drawFrostWorm(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#a8c8d8'; // ivory segmented body
    ctx.fillRect(s * 0.14, s * 0.34, s * 0.72, s * 0.2);
    ctx.fillStyle = flash || '#88a8bc'; // scale bands
    ctx.fillRect(s * 0.22, s * 0.32, s * 0.08, s * 0.24);
    ctx.fillRect(s * 0.42, s * 0.32, s * 0.08, s * 0.24);
    ctx.fillRect(s * 0.62, s * 0.32, s * 0.08, s * 0.24);
    ctx.fillStyle = flash || '#b8d8e8'; // frosted belly
    ctx.fillRect(s * 0.2, s * 0.48, s * 0.6, s * 0.04);
    ctx.fillStyle = flash || '#a8c8d8'; // toothy head
    ctx.fillRect(s * 0.82, s * 0.28, s * 0.14, s * 0.16);
    ctx.fillStyle = flash || '#e0f0f8'; // ice fangs
    ctx.fillRect(s * 0.84, s * 0.4, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.9, s * 0.38, s * 0.04, s * 0.05);
    ctx.fillStyle = '#e8f0ff'; // frost breath plume
    ctx.fillRect(s * 0.9, s * 0.32, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.94, s * 0.28, s * 0.04, s * 0.03);
    ctx.fillStyle = '#2a4050';
    ctx.fillRect(s * 0.86, s * 0.32, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.14, s * 0.54, s * 0.06, s * 0.06); // tail barb
  }

  private drawYuanTiAnathema(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a4a30'; // god-temple of serpent flesh
    ctx.fillRect(s * 0.2, s * 0.24, s * 0.6, s * 0.4);
    ctx.fillStyle = flash || '#2c3a24'; // writhing coils along body
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.08);
    ctx.fillRect(s * 0.24, s * 0.5, s * 0.52, s * 0.06);
    ctx.fillStyle = flash || '#4a5c3a'; // serpent-maws in bulk
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.36, s * 0.14, s * 0.1);
    ctx.fillStyle = flash || '#202a18'; // gnashing teeth
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.08, s * 0.03);
    ctx.fillRect(s * 0.6, s * 0.42, s * 0.08, s * 0.03);
    ctx.fillStyle = flash || '#3a4a30'; // crowned head high
    ctx.fillRect(s * 0.42, s * 0.1, s * 0.16, s * 0.16);
    ctx.fillStyle = flash || '#2c3a24'; // ritual horns
    ctx.fillRect(s * 0.36, s * 0.04, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.06, s * 0.1, s * 0.06);
    ctx.fillStyle = '#e8c830'; // many cold eyes
    ctx.fillRect(s * 0.46, s * 0.14, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.5, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.62, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.24, s * 0.64, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.64, s * 0.64, s * 0.12, s * 0.12);
  }

  private drawGoristro(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a6a7e'; // sub-titan bull-colossus
    ctx.fillRect(s * 0.22, s * 0.24, s * 0.56, s * 0.38);
    ctx.fillStyle = flash || '#5a4e60'; // armor plating
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.48, s * 0.06);
    ctx.fillRect(s * 0.26, s * 0.46, s * 0.48, s * 0.06);
    ctx.fillStyle = flash || '#5a4e60'; // great bull head
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.18);
    ctx.fillStyle = flash || '#4a3e54'; // sweeping horns
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.58, s * 0.06, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.08, s * 0.1, s * 0.12);
    ctx.fillStyle = '#e83030'; // bloodshot eyes
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillStyle = '#f0d8c0';
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.2, s * 0.03);
    ctx.fillStyle = flash || '#7a6a7e'; // fists + legs
    ctx.fillRect(s * 0.12, s * 0.3, s * 0.12, s * 0.26);
    ctx.fillRect(s * 0.76, s * 0.3, s * 0.12, s * 0.26);
    ctx.fillRect(s * 0.28, s * 0.62, s * 0.16, s * 0.14);
    ctx.fillRect(s * 0.58, s * 0.62, s * 0.16, s * 0.14);
    ctx.fillStyle = '#4a3e54'; // demon runes
    ctx.fillRect(s * 0.44, s * 0.52, s * 0.12, s * 0.04);
  }

  private drawAncientWhiteDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#cfe0ea', '#9fbcd0', '#bff3ff', '#e8f4ff', 'ancient');
  }

  private drawAncientBlackDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3a3a42', '#24242c', '#7ee06a', '#c8c2b0', 'ancient');
  }

  private drawAncientGreenDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3f6b34', '#2b4d24', '#9ada58', '#ddd6b8', 'ancient');
  }

  private drawAncientBlueDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#2f5fa8', '#22467c', '#7fd8ff', '#e4ecf4', 'ancient');
  }

  private drawAncientRedDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#a8231c', '#741612', '#ff9420', '#e8dcc0', 'ancient');
  }

  /**
   * Spread wings made this indistinguishable from the giant bat and the hawk.
   * A vulture is unmistakable perched instead: shoulders hunched up past the
   * head, wings folded into a hump, a naked pink neck sunk into a ruff, and
   * that heavy hooked bill.
   */
  private drawVulture(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const feather = flash || '#33333a';
    const lit = flash || '#54545e';
    const dark = flash || '#1b1b21';
    const neck = flash || '#b07a72';
    // Scaly feet gripping something
    r(flash || '#8a7250', 8, 24, 6, 3);
    r(flash || '#8a7250', 15, 24, 6, 3);
    r(dark, 8, 26, 2, 1);
    r(dark, 12, 26, 2, 1);
    r(dark, 19, 26, 2, 1);
    // Body, wings folded into a high hump over the shoulders
    r(feather, 6, 12, 17, 13);
    r(lit, 6, 12, 17, 1);
    r(dark, 6, 22, 17, 3);
    r(feather, 3, 8, 9, 9); // near wing shoulder
    r(lit, 3, 8, 9, 1);
    r(dark, 3, 15, 9, 2);
    r(dark, 5, 17, 2, 7); // folded primaries
    r(dark, 8, 18, 2, 7);
    r(dark, 11, 19, 2, 6);
    r(feather, 20, 9, 7, 8);
    r(lit, 20, 9, 7, 1);
    r(dark, 20, 16, 7, 2);
    // Ruff of pale down at the neck
    r(flash || '#a89c8c', 12, 9, 8, 4);
    r(flash || '#c8bcaa', 12, 9, 8, 1);
    // Bald neck and small head
    r(neck, 14, 4, 4, 6);
    r(neck, 13, 1, 7, 4);
    r(flash || '#8a5a54', 13, 4, 7, 1);
    r('#e0d020', 14, 2, 2, 2);
    r('#1a1206', 15, 2, 1, 2);
    // Heavy hooked bill
    r(flash || '#d8cba8', 19, 2, 6, 3);
    r(flash || '#f0e6c8', 19, 2, 6, 1);
    r(flash || '#9c8f70', 22, 4, 3, 3);
  }

  /**
   * The hawk stoops with its wings swept back; the blood hawk hangs with
   * them spread the full width of the box, crimson breast to the viewer.
   * The old one was a dark red smear a few pixels tall.
   */
  private drawBloodHawk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const feather = flash || '#7c3636';
    const lit = flash || '#a84e4e';
    const dark = flash || '#451a1a';
    const breast = flash || '#d03a3a';
    const eye = flash || '#ffe040';
    // Wings spread wide, tips raised, primaries splayed below
    r(feather, 1, 4, 4, 3);
    r(feather, 1, 7, 10, 4);
    r(lit, 1, 7, 10, 1);
    r(dark, 1, 11, 9, 1);
    r(feather, 2, 12, 2, 2);
    r(feather, 5, 12, 2, 2);
    r(feather, 8, 12, 2, 2);
    r(feather, 23, 4, 4, 3);
    r(feather, 17, 7, 10, 4);
    r(lit, 17, 7, 10, 1);
    r(dark, 18, 11, 9, 1);
    r(feather, 24, 12, 2, 2);
    r(feather, 21, 12, 2, 2);
    r(feather, 18, 12, 2, 2);
    // Body and the blood-red barred breast
    r(feather, 10, 6, 8, 10);
    r(breast, 12, 9, 4, 7);
    r(dark, 12, 11, 4, 1);
    r(dark, 12, 13, 4, 1);
    // Tail fanned below, barred
    r(feather, 11, 16, 6, 4);
    r(feather, 10, 19, 8, 2);
    r(dark, 11, 18, 6, 1);
    r(dark, 10, 20, 8, 1);
    // Head, hooked beak down, fierce eyes
    r(feather, 11, 1, 6, 5);
    r(lit, 11, 1, 6, 1);
    r(dark, 11, 1, 1, 5);
    r(eye, 12, 2, 2, 2);
    r(eye, 15, 2, 2, 2);
    r(flash || '#1a0e04', 13, 2, 1, 2);
    r(flash || '#1a0e04', 15, 2, 1, 2);
    r(flash || '#e8c020', 13, 4, 2, 2);
    r(flash || '#a88420', 13, 6, 2, 1);
    // Talons tucked under the tail
    r(flash || '#e8c860', 11, 21, 2, 2);
    r(flash || '#e8c860', 15, 21, 2, 2);
    r(dark, 10, 23, 1, 1);
    r(dark, 12, 23, 1, 1);
    r(dark, 15, 23, 1, 1);
    r(dark, 17, 23, 1, 1);
  }

  /**
   * A constrictor is bulk, not venom: stacked coils filling the floor with the
   * neck rising out of them. Drawing it as one horizontal worm made it read as
   * the same creature as every other snake in the bestiary; the piled loops are
   * the whole difference.
   */
  private drawConstrictorSnake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const scale = flash || '#5f7a2e';
    const lit = flash || '#89a94a';
    const dark = flash || '#33471a';
    const belly = flash || '#c8bd7a';
    // Tail tip escaping the pile
    r(scale, 0, 17, 4, 2);
    r(scale, 2, 15, 5, 3);
    // Bottom coil resting on the ground
    r(scale, 3, 19, 22, 6);
    r(lit, 3, 19, 22, 1);
    r(belly, 5, 23, 18, 2);
    r(dark, 3, 24, 2, 1);
    // Second coil stacked on it
    r(scale, 5, 13, 19, 6);
    r(lit, 5, 13, 19, 1);
    r(dark, 5, 18, 19, 1);
    // Neck rising off the left of the pile and running right
    r(scale, 5, 8, 6, 6);
    r(lit, 5, 8, 6, 1);
    r(scale, 9, 8, 11, 5);
    r(lit, 9, 8, 11, 1);
    // Saddle blotches — a python, not a stripe of green
    r(dark, 8, 19, 4, 6);
    r(dark, 16, 19, 5, 6);
    r(dark, 9, 13, 4, 5);
    r(dark, 18, 13, 4, 5);
    r(dark, 12, 8, 3, 5);
    // Flat wedge head with the jaw slung under it
    r(scale, 18, 4, 8, 6);
    r(lit, 18, 4, 8, 1);
    r(dark, 19, 9, 8, 2);
    r(dark, 20, 5, 3, 2);
    r(dark, 24, 5, 2, 2);
    r('#e8c840', 20, 6, 2, 2);
    r('#e8c840', 24, 6, 2, 2);
    r('#150f04', 20, 6, 1, 2);
    r('#150f04', 24, 6, 1, 2);
    r('#e03040', 26, 8, 2, 1); // flicking tongue
    r('#e03040', 26, 11, 2, 1);
  }

  private drawGiantFrog(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a6a3a'; // squat frog body
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.24);
    ctx.fillStyle = flash || '#7a9a3a'; // mottled flecks
    ctx.fillRect(s * 0.32, s * 0.32, s * 0.16, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.36, s * 0.12, s * 0.12);
    ctx.fillStyle = flash || '#4a7a48'; // wide warty head
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.4, s * 0.14);
    ctx.fillStyle = flash || '#5a8a58'; // bulging eyes on top
    ctx.fillRect(s * 0.32, s * 0.12, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.12, s * 0.1, s * 0.08);
    ctx.fillStyle = '#141414';
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#8a3a2a'; // huge gullet tongue flick
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.22, s * 0.03);
    ctx.fillStyle = flash || '#3a6a3a'; // springing legs
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.66, s * 0.54, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.24, s * 0.72, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.64, s * 0.72, s * 0.12, s * 0.04);
  }

  /**
   * Every ooze in the set was the same low smear in a different colour. The
   * gray ooze gets a story instead: it hugs the ground like wet stone, throws
   * one pseudopod up on the right, and has a half-eaten sword standing in it,
   * corroded to the hilt — which is both what the creature does and a
   * silhouette no other blob has.
   */
  private drawGrayOoze(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const body = flash || '#6e727a';
    const lit = flash || '#9aa1ac';
    const dark = flash || '#42454c';
    // Pool spread flat along the floor
    r(body, 1, 18, 25, 7);
    r(lit, 1, 18, 25, 1);
    r(dark, 1, 23, 25, 2);
    r(body, 3, 14, 19, 5);
    r(lit, 3, 14, 19, 1);
    // Lumps in the surface so the top edge is not a ruled line
    r(body, 5, 12, 6, 3);
    r(lit, 5, 12, 6, 1);
    r(body, 13, 11, 6, 4);
    r(lit, 13, 11, 6, 1);
    // Pseudopod rearing on the right
    r(body, 18, 7, 6, 8);
    r(body, 20, 3, 5, 5);
    r(lit, 20, 3, 5, 1);
    r(dark, 18, 12, 6, 2);
    // Pitting where it has already eaten through something
    r(dark, 6, 19, 4, 2);
    r(dark, 13, 20, 5, 2);
    r(dark, 21, 19, 3, 2);
    // A blade standing in the mass, dissolved down to the crossguard
    r(flash || '#8f959e', 8, 6, 2, 9);
    r(flash || '#c3cad4', 8, 6, 1, 7);
    r(flash || '#6b5432', 6, 4, 6, 2);
    r(flash || '#8a6f46', 6, 4, 6, 1);
    r(flash || '#4a3a22', 8, 1, 2, 3);
    r(dark, 8, 12, 2, 3); // corroded where the ooze has it
    // Runoff at the leading edge
    r(dark, 24, 24, 3, 3);
    r(dark, 3, 25, 3, 2);
  }

  /**
   * The thorn slinger was a green man; it is a plant. A knotted seed pod of
   * a body, rooted, with four vines whipping out wide of it and thorns
   * standing off them — wide and low where the blights are tall and thin.
   */
  private drawThornSlinger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const wood = flash || '#5a5426';
    const lit = flash || '#7d7538';
    const dark = flash || '#332f14';
    const vine = flash || '#3f8a3a';
    const vineLit = flash || '#6ab55c';
    const thorn = flash || '#d6e06a';
    // Vines first, the pod sits in front of where they root
    r(vine, 1, 9, 9, 2);
    r(vineLit, 1, 9, 9, 1);
    r(vine, 1, 5, 2, 5);
    r(thorn, 0, 4, 1, 2);
    r(thorn, 4, 7, 1, 2);
    r(thorn, 7, 7, 1, 2);
    r(vine, 2, 16, 8, 2);
    r(vineLit, 2, 16, 8, 1);
    r(vine, 1, 18, 2, 4);
    r(thorn, 4, 18, 1, 2);
    r(thorn, 7, 18, 1, 2);
    r(thorn, 0, 21, 1, 2);
    r(vine, 18, 7, 9, 2);
    r(vineLit, 18, 7, 9, 1);
    r(vine, 25, 3, 2, 5);
    r(thorn, 20, 5, 1, 2);
    r(thorn, 23, 5, 1, 2);
    r(thorn, 27, 2, 1, 2);
    r(vine, 18, 15, 8, 2);
    r(vineLit, 18, 15, 8, 1);
    r(vine, 25, 17, 2, 4);
    r(thorn, 20, 17, 1, 2);
    r(thorn, 23, 17, 1, 2);
    r(thorn, 27, 20, 1, 2);
    // The pod
    r(wood, 8, 5, 12, 16);
    r(wood, 10, 3, 8, 3);
    r(lit, 10, 3, 8, 1);
    r(lit, 8, 6, 1, 13);
    r(dark, 8, 18, 12, 3);
    r(dark, 11, 8, 1, 8);
    r(dark, 16, 9, 1, 7);
    // Knot-face: two hollows and the puckered mouth it slings from
    r(dark, 10, 8, 3, 2);
    r(dark, 15, 8, 3, 2);
    r(flash || '#ffcc3a', 11, 8, 1, 1);
    r(flash || '#ffcc3a', 16, 8, 1, 1);
    r(dark, 11, 13, 6, 3);
    r(thorn, 13, 13, 2, 1);
    // Roots gripping the ground
    r(dark, 5, 21, 5, 2);
    r(dark, 4, 23, 3, 2);
    r(dark, 11, 21, 3, 4);
    r(dark, 18, 21, 5, 2);
    r(dark, 21, 23, 3, 2);
    r(dark, 15, 21, 2, 3);
  }

  private drawWoodWoad(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a3a1e'; // living bark body
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.36);
    ctx.fillStyle = flash || '#6a4a28'; // bark plates
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.32, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.32, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.5, s * 0.32, s * 0.04);
    ctx.fillStyle = flash || '#4a2c16'; // tree-figure head
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#3a2410'; // moss-horn twigs
    ctx.fillRect(s * 0.34, s * 0.02, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.04, s * 0.1, s * 0.08);
    ctx.fillStyle = '#2a5a2a'; // glowing rune eyes
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#6a4a28'; // leafy shoulder guards
    ctx.fillRect(s * 0.2, s * 0.26, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.68, s * 0.26, s * 0.12, s * 0.16);
    ctx.fillStyle = '#3a6a2a'; // moss patches
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.68, s * 0.42, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.38, s * 0.6, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.1, s * 0.16);
  }

  private drawFireMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c85a18'; // snickering little body
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.26);
    ctx.fillStyle = flash || '#e87828'; // molten belly
    ctx.fillRect(s * 0.4, s * 0.38, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#d86a20'; // head + sneer
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.24, s * 0.16);
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.52, s * 0.16, s * 0.08, s * 0.08);
    ctx.fillStyle = flash || '#f0e020'; // sparking eyes
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#a83a0a'; // bat wings
    ctx.fillRect(s * 0.22, s * 0.18, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.64, s * 0.2, s * 0.14, s * 0.14);
    ctx.fillStyle = flash || '#e8a040'; // wispy flames
    ctx.fillRect(s * 0.2, s * 0.1, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.66, s * 0.06, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.42, s * 0.56, s * 0.16, s * 0.1);
  }

  private drawRugOfSmothering(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a1620'; // deep red blood-rug
    ctx.fillRect(s * 0.16, s * 0.22, s * 0.68, s * 0.44);
    ctx.fillStyle = flash || '#8a2430'; // woven pattern
    ctx.fillRect(s * 0.22, s * 0.28, s * 0.56, s * 0.06);
    ctx.fillRect(s * 0.22, s * 0.52, s * 0.56, s * 0.06);
    ctx.fillStyle = flash || '#5c101a'; // tasseled fringes
    ctx.fillRect(s * 0.16, s * 0.18, s * 0.68, s * 0.04);
    ctx.fillRect(s * 0.16, s * 0.64, s * 0.68, s * 0.04);
    ctx.fillStyle = flash || '#8a2430'; // sucked-in face crease
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.2, s * 0.1);
    ctx.fillStyle = '#1a0410'; // smothering darkness mouth
    ctx.fillRect(s * 0.44, s * 0.38, s * 0.12, s * 0.05);
    ctx.fillStyle = flash || '#b0404a'; // damp blood stains
    ctx.fillRect(s * 0.28, s * 0.42, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.42, s * 0.08, s * 0.06);
  }

  private drawVerbeeg(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8c090'; // flaxen giant skin
    ctx.fillRect(s * 0.26, s * 0.22, s * 0.48, s * 0.36);
    ctx.fillStyle = flash || '#a0805a'; // weathered tunic
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.2);
    ctx.fillStyle = flash || '#e8d0a8'; // bearded face
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.16);
    ctx.fillStyle = flash || '#c8a878'; // shaggy beard + hair
    ctx.fillRect(s * 0.34, s * 0.04, s * 0.32, s * 0.08);
    ctx.fillRect(s * 0.36, s * 0.24, s * 0.28, s * 0.06);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(s * 0.42, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#a0805a'; // thong-lashed club
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.08, s * 0.3);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.38, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.58, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.56, s * 0.58, s * 0.14, s * 0.18);
  }

  private drawFirbolg(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a9a78'; // moss-green giant skin
    ctx.fillRect(s * 0.24, s * 0.22, s * 0.52, s * 0.38);
    ctx.fillStyle = flash || '#6a7a58'; // lichen garment
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.2);
    ctx.fillStyle = flash || '#9aaa84'; // broad kindly face
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.14);
    ctx.fillStyle = flash || '#8a9a68'; // thick red-blond hair
    ctx.fillRect(s * 0.36, s * 0.02, s * 0.28, s * 0.1);
    ctx.fillStyle = flash || '#7a8a5a'; // fern crown
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.14, s * 0.08, s * 0.08);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#6a7a58'; // great flat-headed axe
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.72, s * 0.12, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.6, s * 0.16, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.16, s * 0.16);
    ctx.fillStyle = '#3a5a2a'; // earth-friend moss
    ctx.fillRect(s * 0.2, s * 0.28, s * 0.06, s * 0.06);
  }

  private drawSlitheringTracker(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8e0e8'; // quicksilver gelatin
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.44, s * 0.34);
    ctx.fillStyle = flash || '#f0f4f8'; // molten shine
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.18, s * 0.24);
    ctx.fillStyle = flash || '#c0ccd8'; // dark drips
    ctx.fillRect(s * 0.5, s * 0.4, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.28, s * 0.52, s * 0.2, s * 0.06);
    ctx.fillRect(s * 0.48, s * 0.58, s * 0.2, s * 0.06);
    ctx.fillStyle = flash || '#e8f0f6'; // clinging edge seams
    ctx.fillRect(s * 0.16, s * 0.32, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.34, s * 0.12, s * 0.2);
    ctx.fillStyle = '#9aa8b4'; // liquid eye-bubble
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.3, s * 0.08, s * 0.08);
  }

  private drawHelmedHorror(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a6070'; // mage-forged plate
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.38);
    ctx.fillStyle = flash || '#6a7080'; // armor banding
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.46, s * 0.32, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.56, s * 0.32, s * 0.04);
    ctx.fillStyle = flash || '#4a4f5c'; // closed great helm
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#5aa0d8'; // glowing visor arcane
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.16, s * 0.05);
    ctx.fillStyle = flash || '#3a3f4a'; // pauldrons
    ctx.fillRect(s * 0.2, s * 0.24, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.12, s * 0.12);
    ctx.fillStyle = flash || '#5a6070'; // gauntlets + blade
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.34, s * 0.08, s * 0.16);
    ctx.fillStyle = '#c0c8d8'; // longsword
    ctx.fillRect(s * 0.78, s * 0.14, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.62, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.62, s * 0.08, s * 0.14);
  }

  private drawBarlgura(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a3a22'; // knuckle-walking demon ape
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.52, s * 0.3);
    ctx.fillStyle = flash || '#8a4a2c'; // mottled hide
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.14);
    ctx.fillStyle = flash || '#5a2a16'; // jutting demon head
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.2);
    ctx.fillStyle = flash || '#4a1e10'; // heavy brow + horns
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.06);
    ctx.fillRect(s * 0.36, s * 0.0, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.58, s * 0.0, s * 0.06, s * 0.08);
    ctx.fillStyle = '#e83030'; // baleful eyes
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillStyle = '#e8c8a0';
    ctx.fillRect(s * 0.42, s * 0.22, s * 0.16, s * 0.03);
    ctx.fillStyle = flash || '#7a3a22'; // huge swinging arms
    ctx.fillRect(s * 0.1, s * 0.32, s * 0.16, s * 0.22);
    ctx.fillRect(s * 0.74, s * 0.32, s * 0.16, s * 0.22);
    ctx.fillRect(s * 0.28, s * 0.58, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.58, s * 0.58, s * 0.14, s * 0.18);
  }

  private drawShieldGuardian(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a9064'; // drab enchanted plate
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.44, s * 0.4);
    ctx.fillStyle = flash || '#6a7048'; // plate seams
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.36, s * 0.03);
    ctx.fillRect(s * 0.32, s * 0.5, s * 0.36, s * 0.03);
    ctx.fillStyle = flash || '#7a8258'; // guardian helm
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.28, s * 0.16);
    ctx.fillStyle = flash || '#4a5060'; // rune-etched face
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.16, s * 0.04);
    ctx.fillStyle = '#00b0e0'; // arcane amber heart
    ctx.fillRect(s * 0.44, s * 0.32, s * 0.12, s * 0.1);
    ctx.fillStyle = '#0080b0';
    ctx.fillRect(s * 0.46, s * 0.34, s * 0.08, s * 0.06);
    ctx.fillStyle = flash || '#8a9064'; // heavy arms
    ctx.fillRect(s * 0.16, s * 0.28, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.28, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.04, s * 0.12); // shield to side
    ctx.fillRect(s * 0.32, s * 0.62, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.12, s * 0.16);
  }

  private drawYochlol(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a5660'; // spider-mist column
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.4);
    ctx.fillStyle = flash || '#7a6474'; // dripping webbing
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.16, s * 0.28);
    ctx.fillRect(s * 0.58, s * 0.34, s * 0.16, s * 0.24);
    ctx.fillStyle = flash || '#5a485a'; // spider legs melding
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.18, s * 0.5, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.7, s * 0.42, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.68, s * 0.52, s * 0.14, s * 0.06);
    ctx.fillStyle = flash || '#6a5660'; // spider-female face
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.16);
    ctx.fillStyle = '#e830e0'; // hypnotic spider eyes
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.62, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.2, s * 0.03); // fang bite line
    ctx.fillRect(s * 0.42, s * 0.64, s * 0.16, s * 0.12);
  }

  private drawNalfeshnee(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a6a3a'; // ponderous apish body
    ctx.fillRect(s * 0.22, s * 0.24, s * 0.56, s * 0.36);
    ctx.fillStyle = flash || '#9a7a44'; // bloated paunch
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.48, s * 0.14);
    ctx.fillStyle = flash || '#6a4e28'; // jagged brute head
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.18);
    ctx.fillStyle = flash || '#56370e'; // tusks
    ctx.fillRect(s * 0.38, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.36, s * 0.04, s * 0.08, s * 0.06); // horns
    ctx.fillRect(s * 0.56, s * 0.06, s * 0.08, s * 0.04);
    ctx.fillStyle = '#f0c020'; // piggy glowing eyes
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillStyle = '#c8a468'; // feathered tusks
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.5, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.26, s * 0.58, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.62, s * 0.58, s * 0.12, s * 0.16);
  }

  private drawMolydeus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a4a2a'; // wolf-headed colossus
    ctx.fillRect(s * 0.22, s * 0.22, s * 0.56, s * 0.36);
    ctx.fillStyle = flash || '#4a3c20'; // rippling muscle plates
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.48, s * 0.06);
    ctx.fillRect(s * 0.26, s * 0.44, s * 0.48, s * 0.06);
    ctx.fillStyle = flash || '#6a5a36'; // twin wolf heads
    ctx.fillRect(s * 0.22, s * 0.1, s * 0.2, s * 0.14);
    ctx.fillRect(s * 0.58, s * 0.1, s * 0.2, s * 0.14);
    ctx.fillStyle = '#f0e020'; // many burning eyes
    ctx.fillRect(s * 0.26, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.62, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f0d0c0';
    ctx.fillRect(s * 0.24, s * 0.2, s * 0.16, s * 0.03);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.16, s * 0.03);
    ctx.fillStyle = '#4a3c20'; // fanged jaw lash
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#5a4a2a'; // demonic greatsword + arm fringe
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.05, s * 0.34);
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.12, s * 0.26, s * 0.1, s * 0.26);
    ctx.fillRect(s * 0.28, s * 0.58, s * 0.12, s * 0.18);
    ctx.fillRect(s * 0.56, s * 0.58, s * 0.12, s * 0.18);
  }

  /**
   * The old drow warrior had no head worth the name — a dusk-coloured tab over
   * a slab, with the eyes drawn as a single dark bar, so at 28 px it read as a
   * headless torso. Now: white hair falling either side of a dark face with red
   * eyes, and paired scimitars held out from the body on both sides.
   */
  private drawDrowWarrior(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#4b4655';
    const lit = flash || '#615b6d';
    const dark = flash || '#332f3c';
    const mail = flash || '#3b5a63';
    // Legs and low boots
    r(dark, 10, 20, 3, 5);
    r(dark, 16, 20, 3, 5);
    r(flash || '#1e1c24', 9, 24, 5, 3);
    r(flash || '#1e1c24', 15, 24, 5, 3);
    // Chain shirt over a narrow, upright frame
    r(mail, 10, 11, 9, 9);
    r(flash || '#4d717a', 10, 11, 9, 1);
    r(flash || '#2c454c', 10, 14, 9, 1);
    r(flash || '#2c454c', 10, 17, 9, 1);
    r(flash || '#7a3a52', 12, 11, 2, 9);
    // Arms held out to both sides
    r(skin, 6, 12, 4, 7);
    r(dark, 6, 12, 1, 7);
    r(skin, 19, 12, 4, 7);
    // Head
    r(skin, 11, 4, 7, 7);
    r(lit, 11, 4, 7, 1);
    r(dark, 11, 4, 1, 7);
    // Red eyes under a heavy brow
    r(dark, 11, 6, 7, 1);
    r('#ff3a4a', 12, 7, 2, 2);
    r('#ff3a4a', 16, 7, 2, 2);
    r(flash || '#5a1418', 12, 7, 1, 2);
    r(flash || '#5a1418', 16, 7, 1, 2);
    // White hair falling either side of the face and long down the back
    r(flash || '#ddd6e2', 9, 2, 11, 3);
    r(flash || '#f2edf6', 9, 2, 11, 1);
    r(flash || '#c6bed0', 9, 5, 2, 8);
    r(flash || '#c6bed0', 18, 5, 2, 8);
    // Long ears
    r(skin, 8, 6, 2, 2);
    r(skin, 19, 6, 2, 2);
    // Paired scimitars, curved out from each hand
    r(flash || '#b8bfcd', 3, 8, 2, 3);
    r(flash || '#b8bfcd', 2, 11, 2, 4);
    r(flash || '#b8bfcd', 3, 15, 2, 3);
    r(flash || '#e6ecf6', 3, 8, 1, 3);
    r(flash || '#2a2230', 4, 18, 3, 2);
    r(flash || '#b8bfcd', 24, 8, 2, 3);
    r(flash || '#b8bfcd', 25, 11, 2, 4);
    r(flash || '#b8bfcd', 24, 15, 2, 3);
    r(flash || '#e6ecf6', 24, 8, 1, 3);
    r(flash || '#2a2230', 22, 18, 3, 2);
  }

  private drawDustMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8b890'; // gritty dun body
    ctx.fillRect(s * 0.36, s * 0.32, s * 0.28, s * 0.26);
    ctx.fillStyle = flash || '#d8caa0'; // dusty highlight
    ctx.fillRect(s * 0.4, s * 0.38, s * 0.2, s * 0.12);
    ctx.fillStyle = flash || '#c8b890'; // head + snouty grin
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.24, s * 0.18);
    ctx.fillStyle = '#c84830'; // a pair of little eyes
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.42, s * 0.28, s * 0.16, s * 0.03);
    ctx.fillStyle = flash || '#a09070'; // bat wings
    ctx.fillRect(s * 0.22, s * 0.2, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.64, s * 0.22, s * 0.14, s * 0.14);
    ctx.fillStyle = flash || '#e8d8b0'; // puffing dust
    ctx.fillRect(s * 0.2, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.68, s * 0.08, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.42, s * 0.58, s * 0.16, s * 0.1);
  }

  private drawMagmin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c85a14'; // molten little furnace-man
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.26);
    ctx.fillStyle = flash || '#e88028'; // roiling magma cracks
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.2, s * 0.06);
    ctx.fillRect(s * 0.42, s * 0.48, s * 0.16, s * 0.05);
    ctx.fillStyle = flash || '#d86a18'; // crackling head
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.24, s * 0.16);
    ctx.fillStyle = '#f8e060'; // ember eyes
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#a24a10'; // small furnace wings
    ctx.fillRect(s * 0.22, s * 0.18, s * 0.16, s * 0.12);
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.16, s * 0.12);
    ctx.fillStyle = '#f8b020'; // floating cinders
    ctx.fillRect(s * 0.2, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.66, s * 0.06, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.42, s * 0.56, s * 0.16, s * 0.1);
  }

  private drawGiantEagle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a4a2a'; // great brown eagle body
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.22);
    ctx.fillStyle = flash || '#7a5a36'; // feathered chest
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.12);
    ctx.fillStyle = flash || '#f0e0c0'; // white head
    ctx.fillRect(s * 0.64, s * 0.12, s * 0.16, s * 0.14);
    ctx.fillStyle = flash || '#e8c820'; // golden hooked beak
    ctx.fillRect(s * 0.76, s * 0.16, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.76, s * 0.2, s * 0.08, s * 0.04);
    ctx.fillStyle = flash || '#5a3a1e'; // spread wings
    ctx.fillRect(s * 0.06, s * 0.18, s * 0.26, s * 0.2);
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.28, s * 0.2);
    ctx.fillStyle = flash || '#4a3015'; // wing tips
    ctx.fillRect(s * 0.06, s * 0.34, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.86, s * 0.4, s * 0.1, s * 0.08);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.68, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#6a4a2a'; // talons
    ctx.fillRect(s * 0.36, s * 0.48, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.5, s * 0.48, s * 0.06, s * 0.16);
  }

  /**
   * A crocodile is low and long or it is a lizard. It runs the full width of
   * the box: tail curling up at the left, a ridge of scutes down the spine,
   * legs sprawled out sideways, and a snout longer than the skull with the
   * eye up on top and the teeth showing along the jaw line.
   */
  private drawCrocodile(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#556b34';
    const lit = flash || '#7a9450';
    const dark = flash || '#33421e';
    const belly = flash || '#a4a86e';
    const tooth = flash || '#f0ece0';
    // Tail
    r(hide, 0, 12, 4, 3);
    r(hide, 2, 14, 6, 4);
    r(dark, 0, 12, 4, 1);
    r(dark, 1, 10, 2, 3);
    r(dark, 3, 14, 1, 1);
    r(dark, 5, 15, 1, 1);
    // Body with the scutes along the spine
    r(hide, 7, 14, 14, 8);
    r(dark, 7, 13, 14, 1);
    r(dark, 8, 12, 2, 1);
    r(dark, 11, 12, 2, 1);
    r(dark, 14, 12, 2, 1);
    r(dark, 17, 12, 2, 1);
    r(lit, 7, 15, 14, 1);
    r(belly, 7, 20, 14, 2);
    r(dark, 10, 17, 2, 1);
    r(dark, 15, 17, 2, 1);
    // Legs sprawled out to the sides
    r(hide, 6, 21, 4, 4);
    r(hide, 12, 21, 4, 4);
    r(hide, 18, 21, 4, 4);
    r(dark, 5, 24, 5, 2);
    r(dark, 11, 24, 5, 2);
    r(dark, 17, 24, 5, 2);
    // Head: flat, the snout longer than the skull, the eye up on top
    r(hide, 20, 13, 5, 6);
    r(hide, 23, 15, 5, 5);
    r(lit, 20, 13, 5, 1);
    r(dark, 20, 12, 3, 1);
    r(flash || '#ffd23a', 21, 13, 2, 1);
    r(flash || '#141008', 22, 13, 1, 1);
    r(dark, 23, 18, 5, 1);
    r(tooth, 24, 18, 1, 1);
    r(tooth, 26, 18, 1, 1);
    r(belly, 23, 19, 5, 1);
    r(dark, 27, 16, 1, 1);
  }

  private drawMinotaurSkeleton(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8c0b0'; // bone-white body
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.44, s * 0.3);
    ctx.fillStyle = '#a89080'; // rib gaps
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.46, s * 0.32, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.58, s * 0.32, s * 0.06, s * 0.18);
    ctx.fillStyle = flash || '#b8ae9c'; // bull skull head
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.18);
    ctx.fillStyle = flash || '#a89c88'; // curved bone horns
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.06, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.58, s * 0.1, s * 0.08, s * 0.08);
    ctx.fillStyle = '#241a10'; // empty sockets
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillStyle = '#141414';
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.2, s * 0.03);
    ctx.fillStyle = flash || '#b8ae9c'; // big greataxe
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.06, s * 0.28);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.2, s * 0.08);
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.12, s * 0.18);
    ctx.fillRect(s * 0.56, s * 0.56, s * 0.12, s * 0.18);
  }

  private drawAzer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8a050'; // living brass dwarf
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.36);
    ctx.fillStyle = flash || '#d8b060'; // brass plate armor
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.04);
    ctx.fillRect(s * 0.36, s * 0.44, s * 0.28, s * 0.04);
    ctx.fillStyle = flash || '#e8c878'; // bald brass head
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#c8a050'; // braided fiery beard
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.2, s * 0.06);
    ctx.fillStyle = '#e88a20';
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.2, s * 0.04);
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#d8b060'; // glowing warhammer
    ctx.fillRect(s * 0.7, s * 0.18, s * 0.05, s * 0.28);
    ctx.fillRect(s * 0.66, s * 0.12, s * 0.14, s * 0.08);
    ctx.fillStyle = '#e8a020';
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.02, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.52, s * 0.02, s * 0.05);
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.12, s * 0.14);
  }

  private drawRhinoceros(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a7a7e'; // heavy grey body
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.56, s * 0.22);
    ctx.fillStyle = flash || '#8a8a90'; // armored hide
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.48, s * 0.1);
    ctx.fillStyle = flash || '#6a6a70'; // folded plate ridges
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.42, s * 0.28, s * 0.08, s * 0.06);
    ctx.fillStyle = flash || '#7a7a7e'; // blunt head + two horns
    ctx.fillRect(s * 0.62, s * 0.18, s * 0.24, s * 0.16);
    ctx.fillStyle = flash || '#6a6a70';
    ctx.fillRect(s * 0.78, s * 0.14, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.82, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.72, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#7a7a7e'; // thick legs
    ctx.fillRect(s * 0.22, s * 0.52, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.42, s * 0.52, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.6, s * 0.52, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.08, s * 0.38, s * 0.08, s * 0.08); // tail
  }


  private drawElephant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a8a8e'; // mountain-grey body
    ctx.fillRect(s * 0.14, s * 0.28, s * 0.56, s * 0.26);
    ctx.fillStyle = flash || '#6a6a6e'; // folded ear
    ctx.fillRect(s * 0.2, s * 0.12, s * 0.32, s * 0.22);
    ctx.fillStyle = flash || '#9a9aa0'; // trunk
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.74, s * 0.42, s * 0.1, s * 0.06);
    ctx.fillStyle = flash || '#f0f0e8'; // ivory tusks
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.04, s * 0.16);
    ctx.fillRect(s * 0.78, s * 0.3, s * 0.04, s * 0.16);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.8, s * 0.22, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#8a8a8e'; // heavy legs
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.54, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.6, s * 0.54, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.04, s * 0.4, s * 0.1, s * 0.06); // tail
  }

  private drawRevenant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a5a62'; // livid corpse-flesh
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.34);
    ctx.fillStyle = flash || '#4a4a52'; // frozen war-armor
    ctx.fillRect(s * 0.36, s * 0.36, s * 0.28, s * 0.04);
    ctx.fillStyle = flash || '#6a6a74'; // hollow-eyed face
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#8a8a96'; // mad-strands hair
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.06);
    ctx.fillStyle = '#e83030'; // burning vengeance eyes
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#9aa0b0'; // gleaming greatsword
    ctx.fillRect(s * 0.7, s * 0.18, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.12, s * 0.28, s * 0.14, s * 0.12); // wispy shroud
    ctx.fillRect(s * 0.3, s * 0.58, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.5, s * 0.58, s * 0.1, s * 0.16);
  }

  private drawTriceratops(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a7a68'; // bulky herd body
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.52, s * 0.24);
    ctx.fillStyle = flash || '#9a8a76'; // light scales
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.44, s * 0.1);
    ctx.fillStyle = flash || '#7a6a58'; // huge neck frill
    ctx.fillRect(s * 0.6, s * 0.08, s * 0.3, s * 0.26);
    ctx.fillStyle = flash || '#8a7a68'; // three great horns
    ctx.fillRect(s * 0.62, s * 0.0, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.74, s * 0.0, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.86, s * 0.1, s * 0.05, s * 0.1);
    ctx.fillStyle = flash || '#7a6a58'; // frill edge spikes
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.2, s * 0.06, s * 0.04);
    ctx.fillStyle = '#241a08'; // horned beak + eye
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.14, s * 0.05);
    ctx.fillRect(s * 0.68, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#8a7a68'; // legs
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.42, s * 0.54, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.6, s * 0.54, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.04, s * 0.34, s * 0.12, s * 0.1); // tail
  }

  private drawChasme(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a4a3a'; // bulbous droning body
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.52, s * 0.34);
    ctx.fillStyle = flash || '#6a5a46'; // carapace sheen
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.22, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.34, s * 0.16, s * 0.16);
    ctx.fillStyle = flash || '#7a6a56'; // dangling proboscis
    ctx.fillRect(s * 0.44, s * 0.56, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.46, s * 0.64, s * 0.08, s * 0.06);
    ctx.fillStyle = flash || '#4a3a2c'; // wide buzz wings
    ctx.fillRect(s * 0.06, s * 0.18, s * 0.2, s * 0.34);
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.2, s * 0.34);
    ctx.fillStyle = '#e8d070'; // compound eyes
    ctx.fillRect(s * 0.26, s * 0.2, s * 0.08, s * 0.07);
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.08, s * 0.07);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.68, s * 0.22, s * 0.04, s * 0.03);
    ctx.fillStyle = '#1c1208'; // mouth-fangs
    ctx.fillRect(s * 0.34, s * 0.44, s * 0.32, s * 0.03);
    ctx.fillRect(s * 0.36, s * 0.46, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.6, s * 0.46, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.38, s * 0.6, s * 0.1, s * 0.14); // legs
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.1, s * 0.14);
  }

  private drawYoungEmeraldDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#1f7a55', '#14563b', '#6ff0b0', '#d8f0e0', 'young');
  }

  private drawDeva(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#e8e0d0'; // fair seraphic face
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.16);
    ctx.fillStyle = flash || '#d8a050'; // golden halo hair
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.32, s * 0.08);
    ctx.fillStyle = '#f0e860'; // halo disc
    ctx.fillRect(s * 0.26, s * 0.0, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.66, s * 0.04, s * 0.08, s * 0.07);
    ctx.fillStyle = flash || '#c0d8e8'; // feathered armor
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.34);
    ctx.fillStyle = flash || '#d8ecf8'; // wing-rim gauntlets
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.12, s * 0.12);
    ctx.fillStyle = flash || '#f0f0f8'; // great white wings
    ctx.fillRect(s * 0.1, s * 0.16, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.18, s * 0.14, s * 0.16);
    ctx.fillStyle = flash || '#0a8ab0'; // radiant mace
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.04, s * 0.22);
    ctx.fillRect(s * 0.66, s * 0.12, s * 0.16, s * 0.07);
    ctx.fillStyle = '#20304a';
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.36, s * 0.6, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.1, s * 0.16);
  }

  private drawRetriever(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a3a4a'; // abyssal iron body
    ctx.fillRect(s * 0.26, s * 0.24, s * 0.48, s * 0.34);
    ctx.fillStyle = flash || '#5a4a5e'; // arcane wound-plates
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.48, s * 0.4, s * 0.04);
    ctx.fillStyle = flash || '#6a5a78'; // eight waving legs
    ctx.fillRect(s * 0.12, s * 0.4, s * 0.2, s * 0.05);
    ctx.fillRect(s * 0.18, s * 0.5, s * 0.18, s * 0.05);
    ctx.fillRect(s * 0.24, s * 0.58, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.64, s * 0.4, s * 0.22, s * 0.05);
    ctx.fillRect(s * 0.64, s * 0.5, s * 0.2, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.58, s * 0.18, s * 0.06);
    ctx.fillStyle = '#e02020'; // tracker core eye
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.2, s * 0.14);
    ctx.fillStyle = '#a01010';
    ctx.fillRect(s * 0.46, s * 0.34, s * 0.08, s * 0.07);
    ctx.fillStyle = flash || '#5a4a5e'; // fanged maw below
    ctx.fillRect(s * 0.38, s * 0.48, s * 0.24, s * 0.05);
    ctx.fillStyle = '#d0c0c0';
    ctx.fillRect(s * 0.4, s * 0.52, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.48, s * 0.52, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.56, s * 0.52, s * 0.04, s * 0.03);
  }

  private drawPlanetar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#e8e0d8'; // heavenly gold-touched skin
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.28, s * 0.18);
    ctx.fillStyle = flash || '#d8c070'; // radiant curling hair
    ctx.fillRect(s * 0.32, s * 0.04, s * 0.36, s * 0.08);
    ctx.fillStyle = '#f0e860'; // halo arcs
    ctx.fillRect(s * 0.2, s * 0.0, s * 0.1, s * 0.09);
    ctx.fillRect(s * 0.7, s * 0.03, s * 0.1, s * 0.08);
    ctx.fillStyle = flash || '#c8e0d0'; // gleaming plate + pauldrons
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.44, s * 0.36);
    ctx.fillStyle = flash || '#8a90a8'; // raised greatsword
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.06, s * 0.36);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.16, s * 0.06);
    ctx.fillStyle = flash || '#f0f4f8'; // azure-fire wings
    ctx.fillRect(s * 0.08, s * 0.14, s * 0.18, s * 0.18);
    ctx.fillRect(s * 0.74, s * 0.22, s * 0.18, s * 0.2);
    ctx.fillStyle = '#00a0e0';
    ctx.fillRect(s * 0.1, s * 0.12, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.82, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillStyle = '#14284a';
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.62, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.62, s * 0.12, s * 0.16);
  }

  private drawAdultAmethystDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#7a4aa8', '#573378', '#d69cff', '#e8dcf4', 'adult');
  }

  private drawSolar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#e8e4de'; // luminous seraphic face
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.28, s * 0.16);
    ctx.fillStyle = flash || '#e8c850'; // radiant flowing hair
    ctx.fillRect(s * 0.32, s * 0.02, s * 0.36, s * 0.08);
    ctx.fillStyle = '#f8ee60'; // great halo
    ctx.fillRect(s * 0.26, s * 0.0, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.76, s * 0.0, s * 0.1, s * 0.07);
    ctx.fillStyle = flash || '#c8d8f0'; // golden-washed armor
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.44, s * 0.38);
    ctx.fillStyle = flash || '#8a9ab0'; // longbow of morning light
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.24, s * 0.05);
    ctx.fillRect(s * 0.8, s * 0.2, s * 0.04, s * 0.22);
    ctx.fillStyle = '#f0f0f8'; // illumination-feathered wings
    ctx.fillRect(s * 0.08, s * 0.12, s * 0.2, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.26, s * 0.2, s * 0.2);
    ctx.fillStyle = '#d0d8e8';
    ctx.fillRect(s * 0.06, s * 0.28, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.86, s * 0.42, s * 0.1, s * 0.08);
    ctx.fillStyle = '#0a1a30';
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.62, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.62, s * 0.12, s * 0.14);
  }

  private drawEmpyrean(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d0b8c8'; // divine titan skin
    ctx.fillRect(s * 0.24, s * 0.18, s * 0.52, s * 0.36);
    ctx.fillStyle = flash || '#b89aa8'; // god-born musculature
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.44, s * 0.08);
    ctx.fillStyle = flash || '#8a90a8'; // gleaming pauldrons + plate
    ctx.fillRect(s * 0.18, s * 0.16, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.1, s * 0.14);
    ctx.fillStyle = flash || '#d8c0d0'; // majestic face + framed crown
    ctx.fillRect(s * 0.38, s * 0.02, s * 0.24, s * 0.14);
    ctx.fillStyle = flash || '#c8a0b8';
    ctx.fillRect(s * 0.32, s * 0.06, s * 0.36, s * 0.04);
    ctx.fillStyle = flash || '#8a4aa8'; // war-scepter
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.05, s * 0.28);
    ctx.fillRect(s * 0.66, s * 0.18, s * 0.14, s * 0.08);
    ctx.fillStyle = '#d8d8e0'; // titan wings
    ctx.fillRect(s * 0.04, s * 0.12, s * 0.18, s * 0.2);
    ctx.fillRect(s * 0.78, s * 0.16, s * 0.18, s * 0.2);
    ctx.fillStyle = '#2a0e4a';
    ctx.fillRect(s * 0.42, s * 0.06, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.06, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.16, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.62, s * 0.16, s * 0.16);
  }

  private drawMastiff(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#b8a080'; // sturdy tan guard dog
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.46, s * 0.2);
    ctx.fillStyle = flash || '#6a4a2c'; // saddle-mask face
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#8a6a44'; // perky ears
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.07, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.07, s * 0.08);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.66, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#b8a080'; // legs + tail
    ctx.fillRect(s * 0.26, s * 0.54, s * 0.08, s * 0.18);
    ctx.fillRect(s * 0.42, s * 0.54, s * 0.08, s * 0.18);
    ctx.fillRect(s * 0.58, s * 0.54, s * 0.08, s * 0.18);
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.12, s * 0.06);
  }

  private drawGiantWeasel(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#9a6a3a'; // sinuous dun fur
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.52, s * 0.16);
    ctx.fillStyle = flash || '#c89050'; // cream belly
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.44, s * 0.06);
    ctx.fillStyle = flash || '#9a6a3a'; // long neck + narrow head
    ctx.fillRect(s * 0.64, s * 0.18, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.1, s * 0.1, s * 0.08);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.18, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#9a6a3a'; // stubby legs + blink tail
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.42, s * 0.46, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.6, s * 0.46, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.08, s * 0.32, s * 0.1, s * 0.1);
  }

  /**
   * The blood hawk already owns the spread-wing pose, so this one stoops:
   * wings swept back into a teardrop, talons thrown forward, head down. Read
   * as a diving arrowhead rather than a cross, which is what the old one was.
   */
  private drawHawk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const feather = flash || '#7a5630';
    const lit = flash || '#a67a45';
    const dark = flash || '#432c15';
    const pale = flash || '#e8dcc0';
    // Wings swept back and up into the stoop
    r(feather, 1, 1, 8, 4);
    r(feather, 4, 4, 8, 4);
    r(feather, 8, 7, 6, 4);
    r(dark, 1, 4, 8, 1);
    r(dark, 4, 7, 8, 1);
    r(feather, 19, 1, 8, 4);
    r(feather, 16, 4, 8, 4);
    r(feather, 14, 7, 6, 4);
    r(dark, 19, 4, 8, 1);
    r(dark, 16, 7, 8, 1);
    // Tail closed behind, body driving forward
    r(feather, 11, 3, 6, 8);
    r(dark, 11, 3, 6, 1);
    r(feather, 10, 10, 8, 8);
    r(lit, 10, 10, 8, 1);
    r(pale, 12, 12, 4, 6); // barred breast
    r(dark, 12, 14, 4, 1);
    r(dark, 12, 16, 4, 1);
    // Head down, hooked bill leading
    r(dark, 11, 17, 6, 4);
    r(lit, 11, 17, 6, 1);
    r('#e8c020', 12, 18, 2, 2);
    r('#e8c020', 15, 18, 2, 2);
    r('#140e04', 12, 19, 2, 1);
    r('#140e04', 15, 19, 2, 1);
    r(flash || '#e8b830', 13, 21, 3, 2);
    r(flash || '#a88420', 13, 23, 2, 2);
    // Talons thrown forward
    r(flash || '#e8c860', 8, 19, 3, 4);
    r(flash || '#e8c860', 17, 19, 3, 4);
    r(dark, 7, 22, 2, 3);
    r(dark, 10, 22, 2, 3);
    r(dark, 16, 22, 2, 3);
    r(dark, 19, 22, 2, 3);
  }

  /**
   * The crawling hand is drawn palm-up with its fingers splayed toward the
   * viewer; this one had the same outline and the two were interchangeable.
   * The claw is skeletal and seen from the side instead — arched up on its
   * fingertips like a spider, dragging a torn wrist behind it.
   */
  private drawCrawlingClaw(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const bone = flash || '#cfc7b4';
    const lit = flash || '#eae3d2';
    const shade = flash || '#8d8676';
    const gap = flash || '#241f1a';
    // Knuckles arched over, back of the hand catching the light
    r(bone, 6, 9, 14, 5);
    r(lit, 6, 9, 14, 1);
    r(shade, 6, 13, 14, 1);
    r(gap, 10, 9, 1, 5);
    r(gap, 14, 9, 1, 5);
    r(gap, 17, 9, 1, 5);
    // Fingers dropping to the floor, jointed
    r(bone, 18, 13, 3, 5);
    r(bone, 20, 17, 4, 3);
    r(gap, 23, 19, 3, 2); // black nail
    r(bone, 14, 14, 3, 6);
    r(bone, 15, 19, 4, 3);
    r(gap, 18, 21, 3, 2);
    r(bone, 10, 14, 3, 7);
    r(bone, 10, 20, 4, 3);
    r(gap, 13, 22, 3, 2);
    r(bone, 7, 13, 3, 6);
    r(bone, 5, 18, 4, 4);
    r(gap, 3, 20, 3, 2);
    // Thumb hooked forward
    r(bone, 18, 6, 5, 4);
    r(gap, 22, 5, 3, 2);
    // Torn wrist dragging behind
    r(shade, 1, 8, 6, 4);
    r(gap, 0, 8, 3, 4);
    r('#8a1c1c', 1, 12, 2, 3);
  }

  /**
   * Built out of the same bones-and-gaps language as the plain skeleton so the
   * two read as the same kind of thing, but posed at full draw: bow arm out
   * straight, string back at the jaw, arrow nocked. The drawn bow is the whole
   * silhouette — nothing else in the crypt has that long vertical arc.
   */
  private drawSkeletonArcher(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const bone = flash || '#d8d2c0';
    const lit = flash || '#efeade';
    const shade = flash || '#a49c8a';
    const gap = flash || '#1c1a1e';
    const wood = flash || '#7a5730';
    // Bow: a long arc down the left, string drawn back to the jaw
    r(wood, 6, 2, 2, 3);
    r(wood, 5, 5, 2, 6);
    r(wood, 4, 11, 2, 6);
    r(wood, 5, 17, 2, 6);
    r(wood, 6, 23, 2, 3);
    r(flash || '#e8e2d2', 7, 3, 1, 5); // string
    r(flash || '#e8e2d2', 8, 8, 1, 3);
    r(flash || '#e8e2d2', 9, 11, 6, 1);
    r(flash || '#e8e2d2', 8, 12, 1, 4);
    r(flash || '#e8e2d2', 7, 16, 1, 7);
    r(flash || '#cbb27a', 6, 10, 14, 2); // nocked arrow
    r(flash || '#9aa3af', 19, 10, 3, 2);
    // Legs and feet
    r(bone, 13, 20, 2, 5);
    r(bone, 18, 20, 2, 5);
    r(shade, 12, 22, 4, 1);
    r(shade, 17, 22, 4, 1);
    r(bone, 11, 25, 5, 2);
    r(bone, 17, 25, 5, 2);
    // Pelvis, ribs and spine, turned side-on
    r(bone, 12, 17, 8, 3);
    r(gap, 14, 18, 2, 2);
    r(gap, 17, 18, 2, 2);
    r(gap, 12, 9, 8, 8);
    r(bone, 15, 9, 2, 8);
    r(bone, 12, 9, 8, 1);
    r(bone, 12, 12, 8, 1);
    r(bone, 13, 15, 6, 1);
    // Shoulders, bow arm out straight, string hand at the jaw
    r(bone, 11, 7, 10, 2);
    r(lit, 11, 7, 10, 1);
    r(bone, 9, 8, 3, 3);
    r(bone, 20, 8, 3, 4);
    r(bone, 21, 11, 3, 2);
    // Skull, turned to sight down the arrow
    r(bone, 13, 0, 9, 6);
    r(lit, 13, 0, 9, 1);
    r(shade, 13, 0, 1, 6);
    r(gap, 14, 2, 3, 3);
    r(gap, 18, 2, 3, 3);
    if (!flash) {
      r('#ff8a2a', 15, 3, 2, 2);
      r('#ff8a2a', 19, 3, 2, 2);
    }
    r(bone, 14, 6, 7, 2);
    r(gap, 15, 7, 1, 1);
    r(gap, 17, 7, 1, 1);
    r(gap, 19, 7, 1, 1);
  }

  /**
   * Badger and dire badger were the same pale slab with a dark block for a
   * head. This one is the ordinary animal: long and low to the ground, three
   * pairs of stubby legs under it, and the striped mask read across the head
   * rather than painted as a bar above it.
   */
  private drawGiantBadger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#8e8e99';
    const lit = flash || '#b6b6c2';
    const dark = flash || '#43434e';
    const white = flash || '#ece9e2';
    // Stubby tail
    r(fur, 0, 13, 4, 4);
    r(dark, 0, 15, 4, 1);
    // Long low body, back almost flat
    r(fur, 3, 11, 18, 10);
    r(lit, 4, 11, 17, 2);
    r(dark, 3, 19, 18, 2);
    r(lit, 5, 13, 14, 1);
    r(dark, 4, 17, 16, 1);
    // Short legs and pale digging claws
    r(dark, 5, 21, 4, 3);
    r(dark, 11, 21, 4, 3);
    r(dark, 17, 21, 4, 3);
    r(white, 5, 24, 4, 2);
    r(white, 11, 24, 4, 2);
    r(white, 17, 24, 4, 2);
    // Wedge head carried low
    r(fur, 19, 11, 8, 9);
    r(lit, 19, 11, 8, 1);
    r(dark, 19, 18, 8, 2);
    // The mask: a white blaze up the middle with a dark band either side
    r(white, 22, 11, 3, 9);
    r(dark, 20, 12, 2, 7);
    r(dark, 25, 12, 2, 7);
    // Blunt snout
    r(flash || '#2a242c', 25, 16, 3, 3);
    // Round ear and a bead eye in the dark band
    r(fur, 19, 9, 3, 3);
    r(white, 20, 10, 1, 1);
    r('#efe7d2', 25, 13, 2, 2);
    r('#1b1b21', 26, 13, 1, 2);
  }

  private drawRidingHorse(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8a878'; // light bay saddle-horse
    ctx.fillRect(s * 0.18, s * 0.32, s * 0.5, s * 0.2);
    ctx.fillStyle = flash || '#8a6a44'; // arched neck + dark mane
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.62, s * 0.18, s * 0.06, s * 0.12);
    ctx.fillStyle = flash || '#d8b890'; // thin elegant head
    ctx.fillRect(s * 0.72, s * 0.08, s * 0.14, s * 0.1);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.74, s * 0.1, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.8, s * 0.1, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#d8b890'; // legs
    ctx.fillRect(s * 0.22, s * 0.52, s * 0.06, s * 0.22);
    ctx.fillRect(s * 0.34, s * 0.52, s * 0.06, s * 0.22);
    ctx.fillRect(s * 0.46, s * 0.52, s * 0.06, s * 0.22);
    ctx.fillRect(s * 0.58, s * 0.52, s * 0.06, s * 0.22);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.22, s * 0.74, s * 0.06, s * 0.02);
    ctx.fillRect(s * 0.34, s * 0.74, s * 0.06, s * 0.02);
    ctx.fillRect(s * 0.46, s * 0.74, s * 0.06, s * 0.02);
    ctx.fillRect(s * 0.58, s * 0.74, s * 0.06, s * 0.02);
    ctx.fillRect(s * 0.06, s * 0.4, s * 0.12, s * 0.05);
  }

  private drawGiantOwl(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const feather = flash || '#a5794a';
    const lit = flash || '#c99c68';
    const dark = flash || '#6d4c28';
    const pale = flash || '#e6d4b4';
    // In flight, wings out to the full width with the primaries stepping
    // down at the tips
    r(feather, 0, 8, 9, 5);
    r(dark, 0, 8, 9, 1);
    r(feather, 1, 13, 7, 3);
    r(dark, 2, 12, 1, 4);
    r(dark, 5, 12, 1, 4);
    r(feather, 19, 8, 9, 5);
    r(dark, 19, 8, 9, 1);
    r(feather, 20, 13, 7, 3);
    r(dark, 22, 12, 1, 4);
    r(dark, 25, 12, 1, 4);
    // Body, barred breast, fanned tail
    r(feather, 9, 6, 10, 14);
    r(lit, 9, 6, 10, 1);
    r(pale, 11, 10, 6, 10);
    r(dark, 11, 12, 6, 1);
    r(dark, 11, 15, 6, 1);
    r(dark, 11, 18, 6, 1);
    r(feather, 10, 20, 8, 5);
    r(dark, 12, 20, 1, 5);
    r(dark, 15, 20, 1, 5);
    // Head, disc and tufts
    r(feather, 9, 0, 10, 8);
    r(lit, 9, 0, 10, 1);
    r(pale, 10, 2, 8, 6);
    r(feather, 7, 0, 3, 3);
    r(feather, 18, 0, 3, 3);
    r(flash || '#f2c026', 10, 3, 3, 3);
    r(flash || '#f2c026', 15, 3, 3, 3);
    r(flash || '#140c02', 11, 4, 2, 2);
    r(flash || '#140c02', 15, 4, 2, 2);
    r(flash || '#d8b040', 13, 6, 2, 3);
    // Talons hanging under it
    r(flash || '#e8c860', 8, 20, 3, 3);
    r(flash || '#e8c860', 17, 20, 3, 3);
  }

  private drawGiantElk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a6a4a'; // proud high-plains elk
    ctx.fillRect(s * 0.2, s * 0.32, s * 0.48, s * 0.22);
    ctx.fillStyle = flash || '#9a7a58'; // lighter chest mane
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.4, s * 0.1);
    ctx.fillStyle = flash || '#6a4a2c'; // thick neck + head
    ctx.fillRect(s * 0.64, s * 0.12, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.08, s * 0.16, s * 0.14);
    ctx.fillStyle = flash || '#c8b89a'; // great antlered crown
    ctx.fillRect(s * 0.64, s * 0.02, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.0, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.8, s * 0.02, s * 0.06, s * 0.09);
    ctx.fillRect(s * 0.62, s * 0.08, s * 0.04, s * 0.06);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.78, s * 0.14, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#8a6a4a'; // long legs
    ctx.fillRect(s * 0.24, s * 0.54, s * 0.07, s * 0.22);
    ctx.fillRect(s * 0.38, s * 0.54, s * 0.07, s * 0.22);
    ctx.fillRect(s * 0.52, s * 0.54, s * 0.07, s * 0.22);
    ctx.fillRect(s * 0.66, s * 0.54, s * 0.07, s * 0.22);
    ctx.fillRect(s * 0.06, s * 0.4, s * 0.14, s * 0.06);
  }


  private drawSwordWraithCommander(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4a56'; // commanding spectral lord
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.3);
    ctx.fillStyle = flash || '#5a5a68'; // coronet vapors
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.14, s * 0.26);
    ctx.fillRect(s * 0.62, s * 0.34, s * 0.14, s * 0.2);
    ctx.fillStyle = flash || '#5a5a68'; // spectral war-helm
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.14);
    ctx.fillStyle = flash || '#6a86a8'; // banner plume + glinting visor
    ctx.fillRect(s * 0.44, s * 0.02, s * 0.12, s * 0.07);
    ctx.fillStyle = '#88c8f0'; // commander's burning gaze
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#a8b8cc'
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.05, s * 0.1); // gauntlet
    ctx.fillStyle = flash || '#4a4a56';
    ctx.fillRect(s * 0.1, s * 0.24, s * 0.16, s * 0.3); // sweeping cape
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.06, s * 0.32); // stormblade
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.34, s * 0.5, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.5, s * 0.1, s * 0.16);
  }

  private drawYoungSapphireDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#2a4fa8', '#1c3777', '#86b6ff', '#dfe8ff', 'young');
  }

  private drawAboleth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a9ac0'; // slimy eel-like horror
    ctx.fillRect(s * 0.14, s * 0.32, s * 0.56, s * 0.2);
    ctx.fillStyle = flash || '#7aaad0'; // glistening oily highlights
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.22, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.14, s * 0.1);
    ctx.fillStyle = flash || '#5a8ab0'; // three-fanned tail fin
    ctx.fillRect(s * 0.06, s * 0.36, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.04, s * 0.3, s * 0.08, s * 0.1);
    ctx.fillStyle = flash || '#6a9ac0'; // sinister curved head
    ctx.fillRect(s * 0.64, s * 0.24, s * 0.24, s * 0.14);
    ctx.fillRect(s * 0.84, s * 0.3, s * 0.1, s * 0.05);
    ctx.fillStyle = flash || '#0a2030';
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.2, s * 0.02); // maw
    ctx.fillStyle = '#e0f0ff'; // ageless milky eyes
    ctx.fillRect(s * 0.68, s * 0.14, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.14, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.04, s * 0.04); // dead pupil
    ctx.fillRect(s * 0.8, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#7aaad0'; // slimy tendril arms
    ctx.fillRect(s * 0.2, s * 0.14, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.06, s * 0.1);
    ctx.fillStyle = flash || '#5a8ab0'; // lower tail slide
    ctx.fillRect(s * 0.2, s * 0.5, s * 0.56, s * 0.1);
  }

  private drawMummyLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8b888'; // desiccated wrapped monarch
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.44, s * 0.34);
    ctx.fillStyle = flash || '#e8caa0'; // burnished linen
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.3, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.46, s * 0.38, s * 0.06);
    ctx.fillStyle = flash || '#b89868'; // hollow wrapped head
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#8a6a40'; // ritual uraeus crown
    ctx.fillRect(s * 0.42, s * 0.02, s * 0.16, s * 0.08);
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.12, s * 0.03);
    ctx.fillStyle = '#e0c020'; // undeath embers eyes
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.52, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#c0a878'; // gilded staff of rot
    ctx.fillRect(s * 0.74, s * 0.1, s * 0.05, s * 0.34);
    ctx.fillRect(s * 0.7, s * 0.06, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.36, s * 0.58, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.58, s * 0.1, s * 0.16);
  }

  private drawDracolich(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a3a3e'; // undead dragon scales
    ctx.fillRect(s * 0.18, s * 0.26, s * 0.6, s * 0.22);
    ctx.fillStyle = flash || '#4a4a50'; // tattered rags of old hide
    ctx.fillRect(s * 0.22, s * 0.36, s * 0.52, s * 0.06);
    ctx.fillStyle = flash || '#2a2a2e'; // gaunt crowned skull
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.04, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#1a1a1e'; // broken horn crown + jaw
    ctx.fillRect(s * 0.66, s * 0.0, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.84, s * 0.02, s * 0.1, s * 0.07);
    ctx.fillRect(s * 0.7, s * 0.18, s * 0.2, s * 0.05);
    ctx.fillStyle = '#00e0a0'; // necrotic soul-light eyes
    ctx.fillRect(s * 0.8, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.9, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#4a4a50'; // ripped leather wings
    ctx.fillRect(s * 0.06, s * 0.16, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.16, s * 0.26);
    ctx.fillStyle = '#a0c830'; // poison breath plume
    ctx.fillRect(s * 0.9, s * 0.2, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.92, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#3a3a3e'; // legs
    ctx.fillRect(s * 0.24, s * 0.48, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.48, s * 0.12, s * 0.2);
  }

  private drawAdultTopazDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#c89a2e', '#9a731c', '#ffe27a', '#f6e8bc', 'adult');
  }

  private drawAstralDreadnought(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4438'; // vast blind colossus
    ctx.fillRect(s * 0.14, s * 0.22, s * 0.72, s * 0.34);
    ctx.fillStyle = flash || '#5a5244'; // craggy god-stuff plates
    ctx.fillRect(s * 0.2, s * 0.28, s * 0.6, s * 0.06);
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.6, s * 0.06);
    ctx.fillStyle = flash || '#3a342a'; // creviced angular head
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.4, s * 0.2);
    ctx.fillStyle = '#14144a'; // star-vault gaze cavities
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.1, s * 0.12, s * 0.08);
    ctx.fillStyle = '#6a70ff'; // drifting astral light
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.6, s * 0.12, s * 0.04, s * 0.03);
    ctx.fillStyle = flash || '#5a5244'; // splitting maw
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.05);
    ctx.fillStyle = '#c8c0b0';
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.48, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.62, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillStyle = flash || '#4a4438'; // colossal clawed arms
    ctx.fillRect(s * 0.02, s * 0.28, s * 0.12, s * 0.26);
    ctx.fillRect(s * 0.86, s * 0.28, s * 0.12, s * 0.26);
    ctx.fillRect(s * 0.36, s * 0.56, s * 0.12, s * 0.18);
    ctx.fillRect(s * 0.52, s * 0.56, s * 0.12, s * 0.18);
  }

  /**
   * A kraken is a pointed mantle over a crown of arms, and none of that was in
   * the old rectangle. The mantle is drawn tapering to a point at the top, the
   * huge eye set where the mantle meets the head, and the arms drawn as
   * tapering tentacles that curl away in different directions with suckers
   * showing on the inner edge — a ragged fringe is the whole read.
   */
  private drawKraken(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#4a5a6a';
    const lit = flash || '#6d8093';
    const dark = flash || '#2c3846';
    const sucker = flash || '#a8bcc8';
    // Arms curling out and down, thinning as they go
    const arm = (pts: [number, number, number][]) => {
      for (const [x, y, w] of pts) {
        r(hide, x, y, w, w);
        r(dark, x, y + w - 1, w, 1);
      }
    };
    arm([[6, 17, 5], [3, 20, 4], [0, 23, 3]]);
    arm([[8, 20, 4], [6, 24, 3]]);
    arm([[12, 21, 5], [11, 25, 3]]);
    arm([[16, 20, 4], [17, 24, 3]]);
    arm([[18, 17, 5], [21, 20, 4], [24, 23, 3]]);
    arm([[2, 12, 4], [0, 8, 3]]);
    arm([[22, 12, 4], [25, 8, 3]]);
    r(sucker, 1, 24, 1, 1);
    r(sucker, 7, 25, 1, 1);
    r(sucker, 12, 26, 1, 1);
    r(sucker, 18, 25, 1, 1);
    r(sucker, 25, 24, 1, 1);
    // Mantle, tapering to a point
    r(hide, 11, 0, 6, 5);
    r(hide, 9, 3, 10, 6);
    r(hide, 7, 8, 14, 8);
    r(lit, 11, 0, 6, 1);
    r(lit, 9, 3, 2, 6);
    r(dark, 7, 14, 14, 2);
    r(dark, 10, 6, 3, 2); // barnacle plating
    r(dark, 16, 5, 3, 2);
    r(dark, 8, 11, 4, 2);
    r(dark, 17, 11, 3, 2);
    // Head band and the single furious eye
    r(hide, 6, 15, 16, 4);
    r(lit, 6, 15, 16, 1);
    r(flash || '#e8e420', 8, 16, 5, 3);
    r(flash || '#181408', 10, 16, 2, 3);
    r(flash || '#e8e420', 16, 16, 5, 3);
    r(flash || '#181408', 18, 16, 2, 3);
    // Beak
    r(flash || '#1a1410', 12, 18, 5, 3);
    r(flash || '#d8d0b8', 13, 18, 1, 2);
    r(flash || '#d8d0b8', 15, 18, 1, 2);
    // Storm light along the mantle
    r('#3fc8ff', 13, 4, 2, 1);
    r('#3fc8ff', 12, 10, 4, 1);
  }

  private drawMarut(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a5048'; // iron-clad inevitability
    ctx.fillRect(s * 0.24, s * 0.2, s * 0.52, s * 0.4);
    ctx.fillStyle = flash || '#5a6058'; // adamant plates
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.44, s * 0.04);
    ctx.fillRect(s * 0.28, s * 0.46, s * 0.44, s * 0.04);
    ctx.fillStyle = flash || '#3a4038'; // faceless judge helm
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.16);
    ctx.fillStyle = flash || '#484e46'; // square vox-lantern face
    ctx.fillRect(s * 0.42, s * 0.1, s * 0.16, s * 0.07);
    ctx.fillStyle = '#e0e0e8';
    ctx.fillRect(s * 0.46, s * 0.12, s * 0.08, s * 0.04);
    ctx.fillStyle = flash || '#5a6058'; // rune-shouldered pauldrons
    ctx.fillRect(s * 0.14, s * 0.22, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.74, s * 0.22, s * 0.12, s * 0.16);
    ctx.fillStyle = '#d85820'; // floating orrery-arm gauntlet
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.1, s * 0.18);
    ctx.fillRect(s * 0.7, s * 0.36, s * 0.14, s * 0.1);
    ctx.fillStyle = flash || '#3a4038';
    ctx.fillRect(s * 0.3, s * 0.6, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.56, s * 0.6, s * 0.14, s * 0.18);
  }

  /**
   * The tarrasque is the end of the world and read as a coffee table. Drawn
   * side-on instead, as a low armoured mountain: a carapace ridged with plates
   * that rises higher than its own head, two horns raked forward, a spiked
   * tail, and a jaw open wide enough to take a cart.
   */
  private drawTarrasque(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const shell = flash || '#7a6a48';
    const lit = flash || '#a4906a';
    const dark = flash || '#463c26';
    const plate = flash || '#5f5133';
    const claw = flash || '#e0d2b4';
    // Spiked tail lashing out behind
    r(shell, 0, 17, 8, 4);
    r(shell, 5, 14, 8, 6);
    r(dark, 0, 20, 8, 1);
    r(plate, 1, 14, 2, 3);
    r(plate, 4, 12, 2, 3);
    r(plate, 8, 11, 2, 3);
    // The carapace, humped higher than the skull
    r(shell, 6, 10, 16, 12);
    r(lit, 8, 9, 12, 2);
    r(dark, 6, 20, 16, 2);
    r(plate, 8, 12, 12, 2);
    r(plate, 8, 16, 12, 2);
    r(plate, 12, 6, 3, 5); // ridge spines
    r(plate, 16, 5, 3, 6);
    r(plate, 19, 7, 3, 4);
    // Four trunk legs, clawed
    r(dark, 6, 20, 5, 5);
    r(shell, 4, 24, 8, 3);
    r(dark, 14, 20, 5, 5);
    r(shell, 13, 24, 8, 3);
    r(claw, 4, 25, 1, 2);
    r(claw, 7, 25, 1, 2);
    r(claw, 13, 25, 1, 2);
    r(claw, 16, 25, 1, 2);
    r(claw, 19, 25, 1, 2);
    // Blunt head, thrust forward and low
    r(shell, 20, 12, 8, 6);
    r(lit, 20, 12, 8, 1);
    r(flash || '#2a1408', 21, 17, 7, 3); // gaping maw
    r(claw, 21, 17, 1, 3);
    r(claw, 23, 17, 1, 2);
    r(claw, 25, 18, 1, 2);
    r(claw, 27, 17, 1, 3);
    r('#e83030', 22, 13, 3, 2);
    r('#e83030', 26, 13, 2, 2);
    r('#3a0808', 23, 13, 1, 2);
    // The two forward-raked horns
    r(plate, 19, 3, 3, 8);
    r(plate, 21, 1, 4, 3);
    r(claw, 24, 0, 3, 3);
    r(plate, 23, 8, 4, 3);
    r(claw, 26, 6, 2, 3);
  }

  private drawFlumph(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#a0d8e8'; // translucent jellyfish dome
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.44, s * 0.3);
    ctx.fillStyle = flash || '#bceaf4'; // soft glow highlight
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.14);
    ctx.fillStyle = flash || '#88c8dc'; // four little dangling claws
    ctx.fillRect(s * 0.24, s * 0.54, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.42, s * 0.54, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.54, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.5, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.24, s * 0.22, s * 0.08, s * 0.08); // wing-flaps
    ctx.fillRect(s * 0.68, s * 0.22, s * 0.08, s * 0.08);
    ctx.fillStyle = '#12204a'; // tiny friendly eyes
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.42, s * 0.42, s * 0.16, s * 0.04); // soft hum mouth
  }

  private drawGiantCrab(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c85a30'; // barnacled shell
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.4, s * 0.28);
    ctx.fillStyle = flash || '#a84822'; // shell banding
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.5, s * 0.32, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.62, s * 0.32, s * 0.06, s * 0.2);
    ctx.fillStyle = flash || '#d87040'; // huge clamping claws
    ctx.fillRect(s * 0.08, s * 0.3, s * 0.24, s * 0.1);
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.24, s * 0.1);
    ctx.fillRect(s * 0.1, s * 0.38, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.38, s * 0.16, s * 0.04);
    ctx.fillStyle = flash || '#c85a30'; // scuttling legs
    ctx.fillRect(s * 0.22, s * 0.56, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.38, s * 0.56, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.56, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.7, s * 0.56, s * 0.06, s * 0.14);
    ctx.fillStyle = '#241a08'; // small stalk eyes
    ctx.fillRect(s * 0.32, s * 0.14, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.04, s * 0.06);
    ctx.fillStyle = '#f0f0e8';
    ctx.fillRect(s * 0.32, s * 0.18, s * 0.04, s * 0.02);
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.04, s * 0.02);
  }

  private drawGiantVulture(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a5a46'; // grim feathered scavenger
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.36, s * 0.22);
    ctx.fillStyle = flash || '#7a6a54'; // chest feathers
    ctx.fillRect(s * 0.32, s * 0.32, s * 0.26, s * 0.12);
    ctx.fillStyle = flash || '#8a7860'; // bald wrinkled head
    ctx.fillRect(s * 0.6, s * 0.12, s * 0.16, s * 0.12);
    ctx.fillStyle = flash || '#5a4a38'; // meat-hooked beak
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.08, s * 0.04);
    ctx.fillStyle = flash || '#5a4a36'; // wide dark wings
    ctx.fillRect(s * 0.06, s * 0.2, s * 0.24, s * 0.18);
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.26, s * 0.18);
    ctx.fillRect(s * 0.1, s * 0.36, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.82, s * 0.38, s * 0.1, s * 0.08);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.64, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.5, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.48, s * 0.5, s * 0.05, s * 0.14);
  }

  private drawOgreZombie(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a6a5c'; // mouldering ogre flesh
    ctx.fillRect(s * 0.22, s * 0.24, s * 0.56, s * 0.36);
    ctx.fillStyle = flash || '#5a5a4e'; // rot-dark patches
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.08);
    ctx.fillRect(s * 0.3, s * 0.48, s * 0.4, s * 0.06);
    ctx.fillStyle = flash || '#7a7a6a'; // slack dead face
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.28, s * 0.18);
    ctx.fillStyle = flash || '#4a4a40'; // shambling horns/brow
    ctx.fillRect(s * 0.34, s * 0.02, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.02, s * 0.08, s * 0.06);
    ctx.fillStyle = '#94802a'; // dim unseeing eyes
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.55, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = flash || '#6a6a5c'; // huge grasping arms + cleaver
    ctx.fillRect(s * 0.08, s * 0.28, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.78, s * 0.28, s * 0.14, s * 0.28);
    ctx.fillStyle = '#c0c0c8'; // rusting greataxe
    ctx.fillRect(s * 0.8, s * 0.12, s * 0.08, s * 0.26);
    ctx.fillRect(s * 0.8, s * 0.08, s * 0.18, s * 0.06);
    ctx.fillRect(s * 0.28, s * 0.62, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.58, s * 0.62, s * 0.14, s * 0.14);
  }

  private drawFlailSnail(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a90a8'; // shield-laden shell
    ctx.fillRect(s * 0.26, s * 0.22, s * 0.48, s * 0.36);
    ctx.fillStyle = flash || '#98a0b8'; // dim shield plates
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.52, s * 0.3, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.36, s * 0.42, s * 0.28, s * 0.08);
    ctx.fillStyle = flash || '#5a6a5a'; // soft slug body
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.62, s * 0.36, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#4a5450'; // four flail eye-stalks
    ctx.fillRect(s * 0.22, s * 0.12, s * 0.05, s * 0.16);
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.05, s * 0.16);
    ctx.fillStyle = '#d8d8e0'; // flail-heads (shiny)
    ctx.fillRect(s * 0.22, s * 0.08, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#5a6a5a';
    ctx.fillRect(s * 0.58, s * 0.12, s * 0.05, s * 0.16);
    ctx.fillRect(s * 0.5, s * 0.52, s * 0.44, s * 0.08); // slimy trail
  }

  private drawEttercap(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a4a78'; // bloated spider-kin body
    ctx.fillRect(s * 0.26, s * 0.26, s * 0.48, s * 0.28);
    ctx.fillStyle = flash || '#7a5a88'; // glossy abdomen
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.18);
    ctx.fillStyle = flash || '#5a3e68'; // wide bug-eyed head
    ctx.fillRect(s * 0.34, s * 0.12, s * 0.32, s * 0.16);
    ctx.fillStyle = flash || '#483052'; // writhing fangs
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.56, s * 0.28, s * 0.04, s * 0.03);
    ctx.fillStyle = '#b03030'; // glinting eyes
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#6a4a78'; // eight hairy legs
    ctx.fillRect(s * 0.1, s * 0.36, s * 0.18, s * 0.05);
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.18, s * 0.05);
    ctx.fillRect(s * 0.72, s * 0.36, s * 0.18, s * 0.05);
    ctx.fillRect(s * 0.62, s * 0.44, s * 0.18, s * 0.05);
    ctx.fillRect(s * 0.18, s * 0.54, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.54, s * 0.14, s * 0.12);
    ctx.fillStyle = '#c8d0d8'; // sticky silk strand
    ctx.fillRect(s * 0.5, s * 0.58, s * 0.2, s * 0.04);
  }

  private drawSpiritNaga(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a7a8a'; // venom-hearted serpent
    ctx.fillRect(s * 0.22, s * 0.32, s * 0.5, s * 0.16);
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.34, s * 0.14);
    ctx.fillStyle = flash || '#4a8a9a'; // scale diamonds
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.42, s * 0.04);
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.42, s * 0.04);
    ctx.fillStyle = flash || '#6a9a8a'; // pale hooded head
    ctx.fillRect(s * 0.58, s * 0.1, s * 0.24, s * 0.14);
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.16, s * 0.1);
    ctx.fillStyle = flash || '#f0f0e8'; // pale serpent slits
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.72, s * 0.12, s * 0.04, s * 0.03);
    ctx.fillStyle = '#e8d020'; // venom-drip fangs
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.03, s * 0.06);
    ctx.fillStyle = flash || '#3a7a8a'; // coiling tail from below
    ctx.fillRect(s * 0.5, s * 0.44, s * 0.28, s * 0.1);
    ctx.fillRect(s * 0.66, s * 0.5, s * 0.22, s * 0.08);
    ctx.fillRect(s * 0.3, s * 0.46, s * 0.14, s * 0.1);
  }

  private drawWyrmlingWhite(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#cfe0ea', '#9fbcd0', '#bff3ff', '#e8f4ff', 'young');
  }


  private drawSkeletonKnight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8c0b0'; // bare-bone champion
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.32);
    ctx.fillStyle = '#a89884'; // rib cage
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.28, s * 0.2);
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.48, s * 0.28, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.6, s * 0.28, s * 0.04, s * 0.2);
    ctx.fillStyle = flash || '#8a90a8'; // dented knight helm
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.16);
    ctx.fillStyle = flash || '#a8b0c4'; // visor slit
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.16, s * 0.05);
    ctx.fillStyle = '#101418';
    ctx.fillRect(s * 0.44, s * 0.15, s * 0.12, s * 0.03);
    ctx.fillStyle = flash || '#8a90a8'; // plate pauldrons + blade
    ctx.fillRect(s * 0.18, s * 0.24, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.12, s * 0.14);
    ctx.fillStyle = '#c0c8d8'; // gleaming longsword
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.74, s * 0.1, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.34, s * 0.56, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.56, s * 0.1, s * 0.16);
  }

  private drawGrickAlpha(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawGrick(ctx, s, flash, true);
  }

  private drawTyrannosaurusRex(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a6a52'; // two-legged leaf-muncher king
    ctx.fillRect(s * 0.2, s * 0.26, s * 0.5, s * 0.24);
    ctx.fillStyle = flash || '#8a7a5e'; // scaly breast
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.38, s * 0.12);
    ctx.fillStyle = flash || '#6a5840'; // heavy tail
    ctx.fillRect(s * 0.04, s * 0.32, s * 0.16, s * 0.14);
    ctx.fillStyle = flash || '#7a6a52'; // huge armored head
    ctx.fillRect(s * 0.68, s * 0.14, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.78, s * 0.06, s * 0.18, s * 0.22);
    ctx.fillStyle = flash || '#8a7a5e'; // brow ridges
    ctx.fillRect(s * 0.7, s * 0.1, s * 0.12, s * 0.04);
    ctx.fillStyle = '#f0e8dc'; // serrated fangs
    ctx.fillRect(s * 0.8, s * 0.26, s * 0.08, s * 0.03);
    ctx.fillRect(s * 0.82, s * 0.28, s * 0.05, s * 0.04);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.76, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.86, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#6a5840'; // tiny arms + powerful legs
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.2, s * 0.5, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.44, s * 0.5, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.62, s * 0.5, s * 0.14, s * 0.24);
  }

  private drawYoungBlueDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#2f5fa8', '#22467c', '#7fd8ff', '#e4ecf4', 'young');
  }

  private drawDeathSlaad(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a4a52'; // chitinous silent horror
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.52, s * 0.3);
    ctx.fillStyle = flash || '#2a3840'; // plate seams
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.48, s * 0.44, s * 0.05);
    ctx.fillStyle = flash || '#4a5c66'; // cold crowned head
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.2);
    ctx.fillStyle = flash || '#3a4a52'; // high crown spikes
    ctx.fillRect(s * 0.32, s * 0.02, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.58, s * 0.04, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.44, s * 0.0, s * 0.12, s * 0.08);
    ctx.fillStyle = '#f0e058'; // cold slit eyes
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.36, s * 0.22, s * 0.28, s * 0.05); // lipless maw
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.76, s * 0.34, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.3, s * 0.58, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.58, s * 0.14, s * 0.14);
  }

  private drawAirMyrmidon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8d8d8'; // half-corporeal gale-lord
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.34);
    ctx.fillStyle = flash || '#e0ecec'; // translucent gusts
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.58, s * 0.34, s * 0.16, s * 0.16);
    ctx.fillRect(s * 0.2, s * 0.16, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.18, s * 0.12, s * 0.12);
    ctx.fillStyle = flash || '#b8cccc'; // slick whirling helm
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.16);
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.16, s * 0.05); // face slot
    ctx.fillStyle = '#202828';
    ctx.fillRect(s * 0.44, s * 0.15, s * 0.12, s * 0.03);
    ctx.fillStyle = flash || '#e0ecec'; // spear of living wind
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.04, s * 0.34);
    ctx.fillRect(s * 0.76, s * 0.08, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.36, s * 0.58, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.58, s * 0.1, s * 0.16);
  }

  private drawEarthMyrmidon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a5a40'; // stone-girdled knight
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.44, s * 0.38);
    ctx.fillStyle = flash || '#7a6a4c'; // cracked rock plates
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.46, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.14, s * 0.1); // craggy pauldron
    ctx.fillStyle = flash || '#5a4c34'; // rough-hewn visor helm
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.14);
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.16, s * 0.04);
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(s * 0.44, s * 0.15, s * 0.12, s * 0.02);
    ctx.fillStyle = flash || '#6a5a40'; // hammer + legs
    ctx.fillRect(s * 0.72, s * 0.18, s * 0.06, s * 0.28);
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.16, s * 0.08);
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.12, s * 0.16);
    ctx.fillStyle = '#8a7a58'; // rune-light cracks
    ctx.fillRect(s * 0.36, s * 0.34, s * 0.02, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.4, s * 0.02, s * 0.06);
  }

  private drawFireMyrmidon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c85a14'; // living-flame knight
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.44, s * 0.38);
    ctx.fillStyle = flash || '#e07a28'; // scorched metal plates
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.28, s * 0.2, s * 0.14, s * 0.12); // flame pauldron
    ctx.fillStyle = flash || '#d8681c'; // glowing helm
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.14);
    ctx.fillRect(s * 0.42, s * 0.13, s * 0.16, s * 0.04); // fire-gaze slit
    ctx.fillStyle = '#f8d030';
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.12, s * 0.02);
    ctx.fillStyle = '#e8a028'; // dancing flames off body
    ctx.fillRect(s * 0.12, s * 0.18, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.82, s * 0.14, s * 0.06, s * 0.2);
    ctx.fillStyle = flash || '#c85a14'; // burning greatsword
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.66, s * 0.12, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.1, s * 0.14);
    ctx.fillStyle = '#f8a020'; // ember flecks
    ctx.fillRect(s * 0.26, s * 0.5, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.68, s * 0.5, s * 0.03, s * 0.03);
  }

  private drawWaterMyrmidon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a7a9a'; // deep-sea-pressure knight
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.44, s * 0.38);
    ctx.fillStyle = flash || '#4a8ab0'; // wet shimmer plates
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.28, s * 0.2, s * 0.14, s * 0.12); // wave-deflect pauldron
    ctx.fillRect(s * 0.68, s * 0.22, s * 0.12, s * 0.12);
    ctx.fillStyle = flash || '#4a8ab0'; // dappled helm
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.14);
    ctx.fillRect(s * 0.42, s * 0.13, s * 0.16, s * 0.04);
    ctx.fillStyle = '#0a2030';
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.12, s * 0.02);
    ctx.fillStyle = flash || '#c8e8f0'; // darting water spray
    ctx.fillRect(s * 0.12, s * 0.2, s * 0.04, s * 0.16);
    ctx.fillRect(s * 0.84, s * 0.16, s * 0.04, s * 0.18);
    ctx.fillStyle = flash || '#4a8ab0'; // ocean-weight trident
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.04, s * 0.34);
    ctx.fillRect(s * 0.74, s * 0.06, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.7, s * 0.02, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.78, s * 0.04, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.1, s * 0.14);
  }

  private drawWyrmlingRed(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#a8231c', '#741612', '#ff9420', '#e8dcc0', 'young');
  }

  private drawKorred(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#9a8a5a'; // wiry storm-stone guardian
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.32, s * 0.34);
    ctx.fillStyle = flash || '#8a7a4c'; // moss-flecked tunic
    ctx.fillRect(s * 0.38, s * 0.34, s * 0.24, s * 0.14);
    ctx.fillStyle = flash || '#8a7a4c'; // hairy knotted head
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#6a5a38'; // flowing stone-binding hair
    ctx.fillRect(s * 0.32, s * 0.04, s * 0.36, s * 0.06);
    ctx.fillRect(s * 0.44, s * 0.02, s * 0.12, s * 0.04);
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = '#c8b04a'; // whetstone glow runes
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.12, s * 0.03);
    ctx.fillStyle = flash || '#8a7a4c'; // wrenching arms + iron whetstone
    ctx.fillRect(s * 0.14, s * 0.28, s * 0.2, s * 0.16);
    ctx.fillRect(s * 0.66, s * 0.28, s * 0.2, s * 0.16);
    ctx.fillStyle = '#5a4e9a'; // summoned iron whetstone
    ctx.fillRect(s * 0.68, s * 0.18, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.38, s * 0.58, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.58, s * 0.1, s * 0.14);
  }

  /**
   * A darkmantle hangs from the cavern roof by a stalk: a small dome, a
   * fanged mouth on its underside and a fringe of tentacles below. Half its
   * size and twice as tall as the cloaker, which is a flat sheet. The old
   * one was a filled path whose antialiased edge blocked the rim pass.
   */
  private drawDarkmantle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const body = flash || '#3c3d4c';
    const lit = flash || '#5a5c74';
    const dark = flash || '#252630';
    const eye = flash || '#6a5aff';
    const maw = flash || '#4a1a24';
    const tooth = flash || '#dcdce4';
    // Stalk to the ceiling
    r(dark, 12, 0, 4, 3);
    // The mantle, a dome with stepped shoulders
    r(body, 9, 2, 10, 2);
    r(body, 7, 4, 14, 3);
    r(body, 5, 7, 18, 5);
    r(lit, 9, 2, 10, 1);
    r(lit, 7, 4, 2, 1);
    r(lit, 19, 4, 2, 1);
    r(dark, 5, 11, 18, 1);
    // Eye-spots along the rim
    r(eye, 8, 8, 2, 2);
    r(eye, 18, 8, 2, 2);
    r(eye, 13, 5, 2, 1);
    // Underside: the fanged maw, tentacles hanging from the rim
    r(maw, 10, 12, 8, 3);
    for (const x of [11, 13, 15, 17]) r(tooth, x, 12, 1, 2);
    for (const x of [12, 14, 16]) r(tooth, x, 14, 1, 1);
    r(body, 5, 12, 2, 7);
    r(body, 8, 13, 2, 8);
    r(body, 11, 15, 1, 6);
    r(body, 13, 15, 2, 9);
    r(body, 16, 15, 1, 6);
    r(body, 18, 13, 2, 8);
    r(body, 21, 12, 2, 7);
    r(dark, 5, 18, 2, 1);
    r(dark, 8, 20, 2, 1);
    r(dark, 13, 23, 2, 1);
    r(dark, 18, 20, 2, 1);
    r(dark, 21, 18, 2, 1);
  }

  private drawPiercer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // deadly hanging stalactite with an open starved mouth
    ctx.fillStyle = flash || '#8d6240'; // tapering stone shaft
    ctx.beginPath();
    ctx.moveTo(s * 0.44, s * 0.06);
    ctx.lineTo(s * 0.56, s * 0.06);
    ctx.lineTo(s * 0.62, s * 0.5);
    ctx.lineTo(s * 0.5, s * 0.84);
    ctx.lineTo(s * 0.38, s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6a49ad'; // jagged hollow mouth
    ctx.beginPath();
    ctx.moveTo(s * 0.44, s * 0.64);
    ctx.lineTo(s * 0.56, s * 0.64);
    ctx.lineTo(s * 0.58, s * 0.78);
    ctx.lineTo(s * 0.5, s * 0.74);
    ctx.lineTo(s * 0.42, s * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8e0f8'; // hungry needle teeth
    ctx.fillRect(s * 0.44, s * 0.64, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.51, s * 0.64, s * 0.03, s * 0.06);
  }

  private drawBullywug(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // swamp-frog raider in greasy leather with a spear
    ctx.fillStyle = flash || '#3e8f4e'; // frog head
    ctx.fillRect(s * 0.36, s * 0.22, s * 0.28, s * 0.22);
    ctx.fillStyle = '#f0e6c0'; // bulging eyes on stalks
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.12, s * 0.12);
    ctx.fillStyle = '#111'; // eye pupils
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.16, s * 0.04, s * 0.06);
    ctx.fillStyle = '#2a6a35'; // wide warty body
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.3);
    ctx.fillStyle = '#1c3218'; // leather kilt and legs
    ctx.fillRect(s * 0.34, s * 0.74, s * 0.32, s * 0.2);
    ctx.fillStyle = '#6a4420'; // grimy spear haft
    ctx.fillRect(s * 0.8, s * 0.28, s * 0.04, s * 0.5);
    ctx.fillStyle = '#aab'; // bronze leaf blade
    ctx.fillRect(s * 0.78, s * 0.18, s * 0.08, s * 0.1);
  }

  private drawGoblinBoss(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // scarred chieftain with a crown of trophies and a long knife
    ctx.fillStyle = flash || '#56a53c'; // head
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.22);
    ctx.fillStyle = '#d8d8a0'; // ears
    ctx.fillRect(s * 0.26, s * 0.2, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.2, s * 0.1, s * 0.08);
    ctx.fillStyle = '#c03030'; // battle-scar eye
    ctx.fillRect(s * 0.5, s * 0.48, s * 0.14, s * 0.08);
    ctx.fillStyle = '#b98f2e'; // tooth trophy crown
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.06);
    ctx.fillStyle = '#dcdcdc'; // trophies
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.06, s * 0.06);
    ctx.fillStyle = '#5a3a22'; // hunched leather hulk
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.3);
    ctx.fillStyle = '#8a7050'; // furs and spiked pauldron
    ctx.fillRect(s * 0.28, s * 0.38, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.62, s * 0.38, s * 0.1, s * 0.16);
    ctx.fillStyle = '#c8c8d8'; // curved long knife
    ctx.fillRect(s * 0.7, s * 0.5, s * 0.14, s * 0.04);
  }

  private drawGoblinWarlord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // nail-crowned goblin king in battered plate, brandishing twin cleavers
    ctx.fillStyle = flash || '#4f9a38'; // face
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.24);
    ctx.fillStyle = '#20252d'; // iron crown of nails
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.32, s * 0.06);
    ctx.fillStyle = '#e0e0e0'; // nail points
    ctx.fillRect(s * 0.36, s * 0.06, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.06, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.62, s * 0.06, s * 0.04, s * 0.05);
    ctx.fillStyle = '#c03838'; // scar and cruel snarl mouth
    ctx.fillRect(s * 0.46, s * 0.4, s * 0.12, s * 0.04);
    ctx.fillStyle = '#8b96b5'; // battered plate pauldrons
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.62, s * 0.4, s * 0.14, s * 0.2);
    ctx.fillStyle = '#5a6478'; // plate breastplate
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.32, s * 0.32);
    ctx.fillStyle = '#b8c4d8'; // polished double cleavers
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.3, s * 0.1);
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.3, s * 0.1);
  }

  private drawNilbog(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // mischief-crowned goblin shimmering with inverted glamour
    ctx.fillStyle = flash || '#d8a8e8'; // upside-glamour pink face
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.22);
    ctx.fillStyle = '#f0d870'; // crossed stick-crown
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.06);
    ctx.fillStyle = '#20a0c0'; // sparkling chaotic eyes
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.36, s * 0.06, s * 0.1);
    ctx.fillStyle = '#a06ac0'; // giggling body
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.32, s * 0.3);
    ctx.fillStyle = '#c0c0f0'; // motley patch coat
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.6, s * 0.4, s * 0.1, s * 0.2);
    ctx.fillStyle = '#f2f2ff'; // topsy-turvy glow sparks
    ctx.fillRect(s * 0.46, s * 0.52, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.06, s * 0.06);
  }

  /**
   * A grung is a frog first and a person second, so it squats: knees up beside
   * the body, splayed webbed feet, eyes domed on top of the skull rather than
   * set in the face. That crouch is what keeps it from reading as another
   * bullywug — the bullywug stands with a spear, this one hunkers behind a
   * blowpipe.
   */
  private drawGrung(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#1c62c8';
    const lit = flash || '#4a90ee';
    const dark = flash || '#123f80';
    const head = flash || '#e0561f';
    const headLit = flash || '#f8873a';
    const headDark = flash || '#a03410';
    // Squatting hind legs, knees riding up outside the body
    r(lit, 3, 15, 5, 9);
    r(lit, 20, 15, 5, 9);
    r(flash || '#6fadf6', 3, 15, 5, 2);
    r(flash || '#6fadf6', 20, 15, 5, 2);
    r(dark, 3, 22, 5, 2);
    r(dark, 20, 22, 5, 2);
    // Splayed webbed feet, toes cut in with the darker skin
    r(skin, 1, 23, 8, 3);
    r(skin, 19, 23, 8, 3);
    r(dark, 3, 24, 1, 2);
    r(dark, 6, 24, 1, 2);
    r(dark, 21, 24, 1, 2);
    r(dark, 24, 24, 1, 2);
    // Round azure body, seamed off from the thighs so the crouch reads
    r(skin, 8, 14, 12, 10);
    r(flash || '#3f86e4', 8, 14, 12, 1);
    r(dark, 8, 14, 1, 10);
    r(dark, 19, 14, 1, 10);
    r(dark, 8, 22, 12, 2);
    r(flash || '#0e2f60', 10, 15, 3, 3); // poison blotches
    r(flash || '#0e2f60', 15, 16, 3, 3);
    r(flash || '#e6d8a4', 10, 19, 8, 4); // pale throat
    // Head running straight into the shoulders, no neck
    r(head, 7, 7, 14, 8);
    r(headLit, 7, 7, 14, 1);
    r(headDark, 7, 13, 14, 2);
    // Wide frog mouth, the corners hooked up
    r(flash || '#4e1606', 8, 11, 12, 2);
    r(headDark, 8, 10, 1, 2);
    r(headDark, 19, 10, 1, 2);
    r(headLit, 9, 13, 10, 1);
    // Eyes domed on top of the skull
    r(head, 5, 3, 5, 5);
    r(head, 18, 3, 5, 5);
    r(headLit, 5, 3, 5, 1);
    r(headLit, 18, 3, 5, 1);
    r('#ffd24a', 6, 4, 4, 3);
    r('#ffd24a', 19, 4, 4, 3);
    r('#140c04', 6, 5, 4, 1);
    r('#140c04', 19, 5, 4, 1);
    // Arm holding the blowpipe level at the mouth
    r(skin, 18, 13, 4, 5);
    r(dark, 20, 15, 2, 3);
    r(flash || '#b8a878', 19, 10, 9, 3);
    r(flash || '#d3c69a', 19, 10, 9, 1);
    r(flash || '#7d7050', 19, 12, 9, 1);
  }

  private drawFlyingSword(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // hovering dancing blade with a glittering edge
    ctx.save();
    ctx.translate(s * 0.5, s * 0.5);
    ctx.rotate(-0.5);
    ctx.fillStyle = flash || '#c8d2e0'; // polished steel width
    ctx.fillRect(-s * 0.05, -s * 0.34, s * 0.1, s * 0.66);
    ctx.fillStyle = '#e6ecf5'; // flashing cutting edge
    ctx.fillRect(-s * 0.05, -s * 0.34, s * 0.03, s * 0.66);
    ctx.fillStyle = '#a08010'; // gilded guard
    ctx.fillRect(-s * 0.12, s * 0.12, s * 0.24, s * 0.05);
    ctx.fillStyle = '#4a3020'; // leather-wrapped hilt
    ctx.fillRect(-s * 0.05, s * 0.17, s * 0.1, s * 0.14);
    ctx.fillStyle = '#d8b43a'; // pommel spark
    ctx.fillRect(-s * 0.03, s * 0.31, s * 0.06, s * 0.04);
    ctx.restore();
    // magic trail
    ctx.fillStyle = 'rgba(210,220,140,0.7)';
    ctx.fillRect(s * 0.5, s * 0.08, s * 0.03, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.04, s * 0.03, s * 0.04);
    ctx.fillRect(s * 0.44, s * 0.02, s * 0.03, s * 0.04);
  }

  /**
   * A centipede is length and legs. It is drawn as a chain of plated segments
   * curving down the box, every segment sprouting a pair of legs, so what the
   * eye gets is a long fringed ribbon rather than the four floating bricks
   * that were there before.
   */
  private drawGiantCentipede(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const shell = flash || '#7a4f2a';
    const lit = flash || '#a87042';
    const dark = flash || '#3d2612';
    const path: [number, number][] = [
      [20, 2], [15, 4], [10, 6], [6, 9], [4, 13], [6, 17], [11, 20], [16, 22], [21, 23],
    ];
    for (const [x, y] of path) {
      r(dark, x + 1, y - 2, 1, 2);
      r(dark, x + 4, y - 2, 1, 2);
      r(dark, x + 1, y + 4, 1, 2);
      r(dark, x + 4, y + 4, 1, 2);
    }
    for (const [x, y] of path) {
      r(shell, x, y, 6, 4);
      r(lit, x, y, 6, 1);
      r(dark, x, y + 3, 6, 1);
    }
    // Head at the leading end: mandibles and one lantern-pale eye
    r(shell, 21, 0, 6, 4);
    r(lit, 21, 0, 6, 1);
    r('#a8d8b8', 24, 1, 2, 2);
    r('#1d1409', 25, 1, 1, 2);
    r(dark, 26, 3, 2, 2);
    r(dark, 23, 4, 2, 2);
    r(dark, 25, 0, 3, 1); // antennae
    r(dark, 20, 0, 2, 1);
  }

  /**
   * Reared into an S to strike, tall and narrow, where the constrictor is a
   * flat stack of coils on the floor. Two snakes at 28 px will trade places
   * unless one of them stands up, so this one does — and shows its fangs.
   */
  private drawGiantPoisonSnake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const scale = flash || '#3e8a52';
    const lit = flash || '#5fb474';
    const dark = flash || '#245c33';
    const band = flash || '#f0e2a2';
    // Body lying along the ground, tail out to the left
    r(scale, 0, 22, 8, 3);
    r(scale, 5, 20, 12, 5);
    r(lit, 5, 20, 12, 1);
    r(dark, 5, 24, 12, 1);
    r(band, 7, 20, 2, 5);
    r(band, 13, 20, 2, 5);
    // The S rising out of it
    r(scale, 13, 14, 6, 7);
    r(lit, 13, 14, 6, 1);
    r(dark, 13, 14, 1, 7);
    r(scale, 8, 9, 8, 6);
    r(lit, 8, 9, 8, 1);
    r(band, 9, 9, 2, 6);
    r(scale, 8, 4, 6, 6);
    r(lit, 8, 4, 6, 1);
    // Neck cocked back and the wedge head thrown forward
    r(scale, 13, 3, 6, 4);
    r(scale, 18, 2, 8, 5);
    r(lit, 18, 2, 8, 1);
    r(band, 20, 2, 2, 5); // pale arrow mark
    r(band, 24, 2, 2, 5);
    r(dark, 19, 3, 2, 2);
    r(dark, 22, 3, 2, 2);
    r('#f0d030', 19, 4, 2, 1);
    r('#f0d030', 22, 4, 2, 1);
    r(flash || '#3a1410', 19, 7, 8, 2); // gaping jaw
    r('#ffffff', 20, 8, 1, 3); // fangs
    r('#ffffff', 24, 8, 1, 3);
    r('#111111', 26, 9, 2, 1); // forked tongue
    r('#111111', 26, 11, 2, 1);
    r('#111111', 25, 9, 1, 3);
  }

  /**
   * A monitor lizard sprawls: belly near the floor, elbows and knees turned
   * out above the line of the spine, and a tail as long again as the body.
   * Everything about that outline is horizontal, which is what tells it apart
   * from the upright drakes and the coiled snakes at a glance.
   */
  private drawGiantLizard(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#4d6b3d';
    const lit = flash || '#74975c';
    const dark = flash || '#2c3f21';
    const belly = flash || '#c0c48a';
    // Whipping tail
    r(hide, 0, 20, 6, 2);
    r(hide, 3, 18, 6, 3);
    r(lit, 3, 18, 6, 1);
    // Low slung body
    r(hide, 7, 14, 13, 7);
    r(lit, 7, 14, 13, 1);
    r(belly, 9, 19, 10, 2);
    r(dark, 9, 16, 3, 2); // scale mottling
    r(dark, 15, 15, 3, 2);
    // Sprawled legs, elbows above the spine line
    r(dark, 6, 12, 4, 5);
    r(dark, 5, 20, 4, 4);
    r(hide, 4, 23, 6, 2);
    r(dark, 16, 12, 4, 5);
    r(dark, 16, 20, 4, 4);
    r(hide, 15, 23, 6, 2);
    r('#e6dcc2', 4, 24, 1, 1);
    r('#e6dcc2', 7, 24, 1, 1);
    r('#e6dcc2', 15, 24, 1, 1);
    r('#e6dcc2', 18, 24, 1, 1);
    // Blunt head on a short neck, tongue out
    r(hide, 19, 12, 5, 5);
    r(hide, 22, 9, 6, 5);
    r(lit, 22, 9, 6, 1);
    r(dark, 23, 13, 5, 1);
    r('#f0e8d0', 24, 10, 2, 2);
    r('#1a1408', 25, 10, 1, 2);
    r('#d8404c', 26, 14, 2, 1);
    // Spine crest
    r(dark, 9, 13, 1, 2);
    r(dark, 12, 13, 1, 2);
    r(dark, 15, 13, 1, 2);
  }

  private drawAxeBeak(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // feathered terror with a hatchet-beak shearing forward
    ctx.fillStyle = flash || '#6a5a4a'; // feathered body
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.34, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.2, s * 0.34);
    ctx.fillStyle = '#8a7a6a'; // wings
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.18, s * 0.14);
    ctx.fillStyle = '#2a2018'; // hatchet beak
    ctx.beginPath();
    ctx.moveTo(s * 0.62, s * 0.3);
    ctx.lineTo(s * 0.9, s * 0.42);
    ctx.lineTo(s * 0.64, s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c03030'; // blazing eye
    ctx.fillRect(s * 0.64, s * 0.32, s * 0.06, s * 0.06);
    ctx.fillStyle = '#4a3a2a'; // sturdy legs
    ctx.fillRect(s * 0.4, s * 0.64, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.1, s * 0.2);
  }

  /**
   * The stirge is a flying hypodermic and should look like one: wings spread
   * across the top of the box, a blood-fat abdomen hanging from them, and a
   * needle proboscis pointed straight down at whatever it has landed on. It
   * hangs nose-down, which is a shape nothing else in the set has.
   */
  private drawStirge(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const body = flash || '#7d3450';
    const lit = flash || '#ac5474';
    const dark = flash || '#421c34';
    const wing = flash || '#c6b6d4';
    // Wings held out flat
    r(wing, 0, 1, 11, 5);
    r(wing, 2, 6, 8, 3);
    r(dark, 0, 1, 11, 1);
    r(dark, 3, 2, 1, 7);
    r(dark, 6, 2, 1, 7);
    r(wing, 17, 1, 11, 5);
    r(wing, 18, 6, 8, 3);
    r(dark, 17, 1, 11, 1);
    r(dark, 21, 2, 1, 7);
    r(dark, 24, 2, 1, 7);
    // Gorged abdomen slung under them
    r(body, 9, 5, 10, 12);
    r(lit, 9, 5, 10, 1);
    r(dark, 9, 14, 10, 3);
    r(lit, 11, 7, 3, 4);
    r(dark, 12, 8, 1, 5);
    r(dark, 15, 7, 1, 6);
    // Four legs trailing
    r(dark, 7, 15, 2, 6);
    r(dark, 5, 20, 2, 3);
    r(dark, 19, 15, 2, 6);
    r(dark, 21, 20, 2, 3);
    // Head slung under, red eyes, needle down
    r(dark, 11, 17, 6, 4);
    r('#e04a3a', 12, 18, 2, 2);
    r('#e04a3a', 15, 18, 2, 2);
    r(flash || '#ded6c6', 13, 21, 2, 6);
    r(flash || '#8a8274', 14, 21, 1, 6);
  }

  /**
   * The manes is the Abyss's lowest infantry and it stands, unlike the lemure
   * it is always found beside: a stooped, pot-bellied little demon on bandy
   * legs, ringed with too many small horns, arms hanging past its knees and
   * ending in claws. Standing, horned and clawed is the whole difference.
   */
  private drawManes(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#8a5a3a';
    const lit = flash || '#b07a52';
    const dark = flash || '#4e3020';
    const claw = flash || '#2b1c10';
    // Bandy legs and splayed feet
    r(dark, 8, 20, 4, 5);
    r(dark, 16, 20, 4, 5);
    r(hide, 6, 25, 7, 2);
    r(hide, 15, 25, 7, 2);
    r(claw, 6, 26, 1, 1);
    r(claw, 9, 26, 1, 1);
    r(claw, 18, 26, 1, 1);
    r(claw, 21, 26, 1, 1);
    // Pot belly
    r(hide, 8, 12, 12, 9);
    r(lit, 8, 12, 12, 1);
    r(dark, 8, 19, 12, 2);
    r(lit, 10, 15, 3, 4);
    // Long arms hanging past the knees
    r(hide, 4, 12, 4, 8);
    r(hide, 20, 12, 4, 8);
    r(dark, 4, 19, 4, 3);
    r(dark, 20, 19, 4, 3);
    r(claw, 3, 22, 2, 3);
    r(claw, 6, 22, 2, 3);
    r(claw, 20, 22, 2, 3);
    r(claw, 23, 22, 2, 3);
    // Neckless head
    r(hide, 9, 5, 10, 7);
    r(lit, 9, 5, 10, 1);
    r(dark, 9, 5, 1, 7);
    // A crown of small crooked horns
    r(claw, 8, 2, 2, 4);
    r(claw, 11, 1, 2, 4);
    r(claw, 15, 1, 2, 4);
    r(claw, 18, 2, 2, 4);
    r(claw, 6, 6, 3, 2);
    r(claw, 19, 6, 3, 2);
    // Weeping eyes and a slack mouth
    r(dark, 10, 7, 3, 3);
    r(dark, 15, 7, 3, 3);
    r('#c85040', 10, 8, 3, 2);
    r('#c85040', 15, 8, 3, 2);
    r(dark, 11, 10, 6, 2);
    r('#e6dcc4', 12, 10, 1, 2);
    r('#e6dcc4', 15, 10, 1, 2);
  }

  /**
   * A lemure is a damned soul rendered down to a lump of animate wax, so it is
   * drawn as a melting mound with a face pushing out of the front of it, no
   * neck, no proper limbs — only two stubs and a puddle where its legs should
   * be. Squat and formless, against the manes standing upright beside it.
   */
  private drawLemure(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const wax = flash || '#b06a2c';
    const lit = flash || '#e09a4a';
    const dark = flash || '#6f3714';
    const hot = flash || '#ffcf6a';
    // Puddle it is dragging itself out of
    r(dark, 2, 23, 24, 4);
    r(wax, 4, 22, 20, 2);
    // Sagging mound, widest at the base
    r(wax, 8, 8, 12, 8);
    r(wax, 5, 14, 18, 10);
    r(lit, 8, 8, 12, 1);
    r(dark, 5, 21, 18, 3);
    r(hot, 12, 16, 4, 5); // the ember still in it
    r(lit, 13, 17, 2, 3);
    // Stub arms half reabsorbed
    r(wax, 1, 15, 5, 5);
    r(wax, 22, 15, 5, 5);
    r(dark, 1, 18, 5, 2);
    r(dark, 22, 18, 5, 2);
    // The face pressed out of the wax
    r(dark, 9, 9, 4, 4);
    r(dark, 15, 9, 4, 4);
    r(hot, 10, 10, 2, 2);
    r(hot, 16, 10, 2, 2);
    r(dark, 11, 13, 6, 4); // a mouth stretched open in a howl
    r(lit, 11, 13, 6, 1);
    // Wax running off the sides
    r(dark, 6, 17, 2, 6);
    r(dark, 20, 16, 2, 7);
  }

  /**
   * Drawn from above, which is how a beetle reads instantly: split wing cases
   * down a central seam, a pronotum, six legs jointed out to the sides, and
   * the two lantern glands the party actually loots it for burning on the
   * head. From the side it was an anonymous black brick.
   */
  private drawGiantFireBeetle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const shell = flash || '#2e2e1c';
    const lit = flash || '#4c4c30';
    const dark = flash || '#14140b';
    // Legs, jointed out and forward
    for (const [y, len] of [[8, 6], [14, 7], [20, 6]] as [number, number][]) {
      r(dark, 7 - len, y, len, 2);
      r(dark, 7 - len, y - 2, 2, 3);
      r(dark, 21, y, len, 2);
      r(dark, 19 + len, y - 2, 2, 3);
    }
    // Elytra, seamed down the middle
    r(shell, 7, 8, 14, 16);
    r(lit, 7, 8, 14, 1);
    r(dark, 13, 8, 2, 16);
    r(dark, 7, 22, 14, 2);
    r(lit, 8, 10, 2, 8);
    // Pronotum and head
    r(shell, 8, 3, 12, 6);
    r(lit, 8, 3, 12, 1);
    r(dark, 11, 0, 6, 4);
    // Lantern glands
    r(flash || '#ff9c28', 5, 1, 5, 5);
    r(flash || '#ff9c28', 18, 1, 5, 5);
    r('#ffe6a8', 6, 2, 2, 2);
    r('#ffe6a8', 19, 2, 2, 2);
    // Antennae
    r(dark, 10, 0, 1, 2);
    r(dark, 17, 0, 1, 2);
  }

  /**
   * The third of the swarms, and drawn the same way as the rats, the bats and
   * the wasps: individual animals, not a coloured tide. A spider here is a
   * round body with legs bracketing it on both sides, which is what makes the
   * group's outline spiky rather than lumpy.
   */
  private drawSpiderSwarm(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const bodyA = flash || '#221d24';
    const bodyB = flash || '#3b3038';
    const leg = flash || '#0e0b10';
    const spider = (x: number, y: number, tone: string) => {
      r(leg, x - 2, y, 2, 1);
      r(leg, x - 2, y + 2, 2, 1);
      r(leg, x + 4, y, 2, 1);
      r(leg, x + 4, y + 2, 2, 1);
      r(leg, x - 1, y - 1, 1, 1);
      r(leg, x + 4, y - 1, 1, 1);
      r(leg, x - 1, y + 3, 1, 1);
      r(leg, x + 4, y + 3, 1, 1);
      r(tone, x, y, 4, 3);
      r(flash || '#584a54', x, y, 4, 1);
      r('#c03028', x + 1, y + 1, 1, 1);
      r('#c03028', x + 2, y + 1, 1, 1);
    };
    spider(4, 21, bodyA);
    spider(12, 22, bodyB);
    spider(20, 21, bodyA);
    spider(8, 16, bodyB);
    spider(16, 17, bodyA);
    spider(2, 12, bodyB);
    spider(12, 11, bodyA);
    spider(21, 12, bodyB);
    spider(6, 6, bodyA);
    spider(16, 5, bodyB);
    spider(11, 1, bodyB);
  }

  private drawMammoth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // shaggy woolly mountain with sweeping tusks
    ctx.fillStyle = flash || '#6a5440'; // shaggy hide dome
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.6, s * 0.34);
    ctx.fillStyle = '#4a3a2a'; // shoulder hump
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.2, s * 0.12);
    ctx.fillStyle = '#5a4632'; // head
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.24, s * 0.24);
    ctx.fillStyle = '#2c2418'; // great sweeping tusks
    ctx.fillRect(s * 0.7, s * 0.5, s * 0.2, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.5, s * 0.08, s * 0.1);
    ctx.fillStyle = '#d8d0b8'; // trunk
    ctx.fillRect(s * 0.88, s * 0.42, s * 0.04, s * 0.18);
    ctx.fillStyle = '#3a2c1e'; // pillar legs
    ctx.fillRect(s * 0.26, s * 0.68, s * 0.14, s * 0.26);
    ctx.fillRect(s * 0.62, s * 0.68, s * 0.14, s * 0.26);
    ctx.fillStyle = '#1e180e'; // small furious eye
    ctx.fillRect(s * 0.84, s * 0.36, s * 0.04, s * 0.04);
  }

  private drawGiantTiger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // huge striped predator instead of a cat
    ctx.fillStyle = flash || '#8a4a20'; // haunched body
    ctx.fillRect(s * 0.16, s * 0.42, s * 0.5, s * 0.26);
    ctx.fillStyle = '#5a2c10'; // tiger stripes
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.06, s * 0.22);
    ctx.fillRect(s * 0.34, s * 0.44, s * 0.06, s * 0.22);
    ctx.fillRect(s * 0.48, s * 0.44, s * 0.06, s * 0.22);
    ctx.fillStyle = '#a85c26'; // lowered head
    ctx.fillRect(s * 0.66, s * 0.34, s * 0.24, s * 0.2);
    ctx.fillStyle = '#e0e0e0'; // jowls
    ctx.fillRect(s * 0.7, s * 0.5, s * 0.16, s * 0.04);
    ctx.fillStyle = '#f0e86a'; // amber eyes
    ctx.fillRect(s * 0.82, s * 0.36, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.36, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f2f2e8'; // white fangs
    ctx.fillRect(s * 0.8, s * 0.5, s * 0.03, s * 0.04);
    ctx.fillRect(s * 0.86, s * 0.5, s * 0.03, s * 0.04);
    ctx.fillStyle = '#5a2c10'; // legs
    ctx.fillRect(s * 0.4, s * 0.68, s * 0.1, s * 0.24);
    ctx.fillRect(s * 0.58, s * 0.68, s * 0.1, s * 0.24);
  }

  /**
   * The dire badger is the same animal gone wrong, and it has to say so in
   * outline: hackles raised in a ridge along the spine, head lifted with the
   * teeth showing, and claws long enough to break the line of the feet.
   */
  private drawDireBadger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#5c5c68';
    const lit = flash || '#7d7d8b';
    const dark = flash || '#2a2a33';
    const white = flash || '#dedbd4';
    // Thick tail
    r(fur, 0, 14, 5, 5);
    r(dark, 0, 17, 5, 1);
    // Heavy body
    r(fur, 3, 12, 17, 9);
    r(lit, 4, 12, 16, 2);
    r(dark, 3, 19, 17, 2);
    // Raised hackles along the spine
    r(dark, 5, 9, 2, 4);
    r(dark, 8, 8, 2, 5);
    r(dark, 11, 7, 2, 6);
    r(dark, 14, 8, 2, 5);
    r(dark, 17, 9, 2, 4);
    // Braced legs, oversized chisel claws breaking the foot line
    r(dark, 4, 21, 5, 3);
    r(dark, 11, 21, 5, 3);
    r(dark, 16, 21, 5, 3);
    r(white, 3, 24, 3, 4);
    r(white, 7, 24, 2, 3);
    r(white, 10, 24, 3, 4);
    r(white, 14, 24, 2, 3);
    r(white, 16, 24, 3, 4);
    r(white, 20, 24, 1, 3);
    // Head raised, not carried low like its lesser cousin
    r(fur, 19, 8, 8, 10);
    r(lit, 19, 8, 8, 1);
    r(white, 22, 8, 3, 10);
    r(dark, 20, 9, 2, 8);
    r(dark, 25, 9, 2, 8);
    // Snarling jaw
    r(flash || '#1d1a20', 23, 16, 5, 3);
    r('#efe7d2', 24, 16, 1, 3);
    r('#efe7d2', 26, 16, 1, 3);
    // Red bead eye
    r('#3a0e0e', 25, 11, 2, 3);
    r('#e83028', 25, 11, 2, 2);
  }

  private drawHorsePony(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sturdy little pack pony with a tufted mane
    ctx.fillStyle = flash || '#b88a4a'; // barrel body
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.46, s * 0.22);
    ctx.fillStyle = '#8a6434'; // arched neck
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.14, s * 0.3);
    ctx.fillStyle = '#c8a05e'; // face
    ctx.fillRect(s * 0.7, s * 0.28, s * 0.2, s * 0.22);
    ctx.fillStyle = '#4a3418'; // tufted mane + forelock
    ctx.fillRect(s * 0.6, s * 0.28, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillStyle = '#24180c'; // hooves
    ctx.fillRect(s * 0.26, s * 0.64, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.48, s * 0.64, s * 0.1, s * 0.1);
    ctx.fillStyle = '#24180c'; // eye
    ctx.fillRect(s * 0.84, s * 0.34, s * 0.04, s * 0.04);
  }

  /**
   * A crawling carpet rather than a cloud: individual beetles with split wing
   * cases and legs sticking out, piled thickest along the ground and thinning
   * as it climbs, so the outline is bumpy with backs and legs. Deliberately
   * earthbound and dark against the airborne gold of the wasp swarm.
   */
  private drawSwarmInsects(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const shellA = flash || '#3b2f16';
    const shellB = flash || '#22301c';
    const lit = flash || '#6d5a2a';
    const leg = flash || '#120e06';
    const bug = (x: number, y: number, shell: string) => {
      r(leg, x - 1, y + 1, 1, 1);
      r(leg, x + 5, y + 1, 1, 1);
      r(leg, x, y - 1, 1, 1);
      r(leg, x + 4, y - 1, 1, 1);
      r(leg, x + 1, y + 3, 1, 1);
      r(leg, x + 3, y + 3, 1, 1);
      r(shell, x, y, 5, 3);
      r(lit, x, y, 5, 1);
      r(leg, x + 2, y, 1, 3); // wing-case seam
      r('#d8b845', x + 1, y + 1, 1, 1); // eye spark
    };
    bug(2, 21, shellA);
    bug(9, 22, shellB);
    bug(16, 21, shellA);
    bug(22, 22, shellB);
    bug(5, 17, shellB);
    bug(12, 18, shellA);
    bug(19, 17, shellB);
    bug(2, 13, shellA);
    bug(9, 13, shellB);
    bug(17, 12, shellA);
    bug(6, 8, shellB);
    bug(13, 7, shellA);
    bug(20, 8, shellB);
    bug(10, 3, shellA);
    bug(17, 2, shellB);
  }

  private drawSwarmQuippers(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // seething paddle of razor-toothed fish
    ctx.fillStyle = flash || '#1c4a4a'; // boiling school base
    ctx.fillRect(s * 0.16, s * 0.42, s * 0.68, s * 0.2);
    ctx.fillStyle = '#0e2c30'; // surge wave
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.3, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.56, s * 0.3, s * 0.12);
    ctx.fillStyle = '#3a8a8a'; // flashing bodies
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.06, s * 0.1);
    ctx.fillStyle = '#f2f2e8'; // needle teeth gaps
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.02, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.42, s * 0.02, s * 0.06);
    ctx.fillStyle = '#c02020'; // hungry eyes
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.5, s * 0.4, s * 0.03, s * 0.03);
  }

  private drawShark(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // grey sickle-finned hunter
    ctx.fillStyle = flash || '#4a4f59'; // torpedo body
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.68, s * 0.2);
    ctx.fillStyle = '#b8c4d0'; // paler belly
    ctx.fillRect(s * 0.14, s * 0.54, s * 0.68, s * 0.06);
    ctx.fillStyle = '#2c3038'; // dorsal fin
    ctx.beginPath();
    ctx.moveTo(s * 0.4, s * 0.4);
    ctx.lineTo(s * 0.5, s * 0.22);
    ctx.lineTo(s * 0.6, s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2c3038'; // tail fin
    ctx.beginPath();
    ctx.moveTo(s * 0.16, s * 0.4);
    ctx.lineTo(s * 0.1, s * 0.26);
    ctx.lineTo(s * 0.06, s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#14181e'; // grim eye
    ctx.fillRect(s * 0.74, s * 0.42, s * 0.04, s * 0.05);
    ctx.fillStyle = '#d8d8d8'; // gill slits
    ctx.fillRect(s * 0.64, s * 0.4, s * 0.02, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.4, s * 0.02, s * 0.12);
  }

  private drawHunterShark(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // bullet-bodied man-eater
    ctx.fillStyle = flash || '#3a4657'; // heavier body
    ctx.fillRect(s * 0.12, s * 0.38, s * 0.72, s * 0.26);
    ctx.fillStyle = '#161c26'; // bronze-gray back shading
    ctx.fillRect(s * 0.12, s * 0.38, s * 0.72, s * 0.08);
    ctx.fillStyle = '#c8d2de'; // belly
    ctx.fillRect(s * 0.12, s * 0.56, s * 0.72, s * 0.08);
    ctx.fillStyle = '#1a202c'; // big dorsal
    ctx.beginPath();
    ctx.moveTo(s * 0.38, s * 0.38);
    ctx.lineTo(s * 0.48, s * 0.18);
    ctx.lineTo(s * 0.58, s * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a202c'; // crescent tail
    ctx.beginPath();
    ctx.moveTo(s * 0.14, s * 0.38);
    ctx.lineTo(s * 0.06, s * 0.22);
    ctx.lineTo(s * 0.02, s * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c8d2de'; // lower jaw teeth
    ctx.fillRect(s * 0.76, s * 0.5, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.8, s * 0.5, s * 0.03, s * 0.08);
    ctx.fillStyle = '#0a0e14'; // cold hunter eye
    ctx.fillRect(s * 0.78, s * 0.4, s * 0.04, s * 0.05);
  }

  /**
   * An orca is its markings: black over white, the eye patch, the grey
   * saddle behind a dorsal fin taller than any shark's. Drawn side-on with
   * the flukes turned to the viewer, which is the one pose the sharks do
   * not use.
   */
  private drawKillerWhale(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const blk = flash || '#171c24';
    const lit = flash || '#2f3844';
    const white = flash || '#eef0f2';
    const grey = flash || '#8d97a3';
    // Flukes and tail stock
    r(blk, 1, 10, 2, 3);
    r(blk, 1, 18, 2, 3);
    r(blk, 2, 13, 3, 5);
    r(lit, 1, 10, 2, 1);
    // Body: a torpedo, the belly white, the snout rounded off
    r(blk, 5, 11, 20, 9);
    r(blk, 24, 12, 3, 5);
    r(lit, 6, 11, 18, 1);
    r(white, 8, 17, 17, 3);
    r(white, 24, 17, 3, 2);
    r(grey, 20, 16, 7, 1);
    // Eye patch, the eye a glint ahead of it; saddle behind the fin
    r(white, 19, 13, 4, 2);
    r(grey, 23, 14, 1, 1);
    r(grey, 7, 12, 4, 1);
    r(grey, 17, 12, 3, 1);
    // Dorsal fin, tall and leaning back
    r(blk, 11, 2, 2, 3);
    r(blk, 11, 5, 4, 3);
    r(blk, 11, 8, 6, 3);
    r(lit, 11, 2, 1, 9);
    // Pectoral fin, a paddle out below the chest
    r(blk, 17, 19, 5, 2);
    r(blk, 18, 21, 3, 2);
  }

  private drawGiantStrider(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // smoking ostrich running on clinging fire
    ctx.fillStyle = flash || '#d04a20'; // flame legs
    ctx.fillRect(s * 0.2, s * 0.58, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.34, s * 0.58, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.62, s * 0.58, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.76, s * 0.58, s * 0.06, s * 0.2);
    ctx.fillStyle = flash || '#8a4a20'; // smoking feathered body
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.44, s * 0.3);
    ctx.fillRect(s * 0.5, s * 0.2, s * 0.3, s * 0.4);
    ctx.fillStyle = '#f0a040'; // flaming plume crest
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.12, s * 0.08);
    ctx.fillStyle = '#c03010'; // ember tail
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.14, s * 0.08);
    ctx.fillStyle = '#e0e0e0'; // wicked beak
    ctx.beginPath();
    ctx.moveTo(s * 0.7, s * 0.32);
    ctx.lineTo(s * 0.94, s * 0.44);
    ctx.lineTo(s * 0.72, s * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f0e86a'; // heat-glare eye
    ctx.fillRect(s * 0.62, s * 0.28, s * 0.04, s * 0.04);
  }

  private drawGreatHornedOwl(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const feather = flash || '#6b543a';
    const lit = flash || '#8f7350';
    const dark = flash || '#3f3020';
    const pale = flash || '#cfc0a2';
    // Perched and facing front, wings folded — the giant owl is the one
    // drawn in flight, so this one keeps its wings in.
    r(feather, 7, 8, 14, 15);
    r(lit, 7, 8, 14, 1);
    r(dark, 7, 8, 2, 15);
    r(dark, 19, 8, 2, 15);
    r(pale, 10, 13, 8, 10);
    r(dark, 10, 15, 8, 1);
    r(dark, 10, 18, 8, 1);
    r(dark, 10, 21, 8, 1);
    // The disc, and the ear tufts that name it
    r(feather, 5, 1, 18, 9);
    r(lit, 5, 1, 18, 1);
    r(pale, 7, 3, 14, 7);
    r(dark, 13, 3, 2, 7);
    r(feather, 3, 0, 4, 5);
    r(feather, 21, 0, 4, 5);
    r(dark, 3, 0, 1, 5);
    r(dark, 24, 0, 1, 5);
    // Eyes: the whole point of an owl
    r(flash || '#f2c026', 7, 4, 5, 5);
    r(flash || '#f2c026', 16, 4, 5, 5);
    r(flash || '#140c02', 9, 5, 3, 3);
    r(flash || '#140c02', 16, 5, 3, 3);
    r(flash || '#fff6d8', 9, 5, 1, 1);
    r(flash || '#fff6d8', 16, 5, 1, 1);
    // Beak, and the talons under it
    r(flash || '#d8b040', 13, 9, 2, 4);
    r(flash || '#e8c860', 8, 23, 4, 3);
    r(flash || '#e8c860', 16, 23, 4, 3);
    r(dark, 9, 25, 1, 1);
    r(dark, 18, 25, 1, 1);
  }

  private drawViper(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const scale = flash || '#9a8f76';
    const lit = flash || '#c4b99c';
    const dark = flash || '#5f5640';
    const belly = flash || '#e3dcc4';
    // Wound into a flat spiral, three coils stacked, with the head laid
    // over the top of them. It is a tiny snake and is drawn as one: it
    // never leaves the bottom two thirds of the box.
    r(scale, 3, 17, 21, 7);
    r(lit, 3, 17, 21, 1);
    r(belly, 5, 22, 17, 2);
    r(dark, 3, 23, 21, 1);
    r(scale, 6, 13, 15, 5);
    r(lit, 6, 13, 15, 1);
    r(scale, 9, 10, 10, 4);
    r(lit, 9, 10, 10, 1);
    // Diamond banding across every coil
    r(dark, 5, 17, 3, 7);
    r(dark, 11, 17, 3, 7);
    r(dark, 17, 17, 3, 7);
    r(dark, 8, 13, 2, 5);
    r(dark, 14, 13, 2, 5);
    r(dark, 11, 10, 2, 4);
    r(dark, 16, 10, 2, 4);
    // Wedge head resting on the top coil, tongue out
    r(scale, 14, 5, 9, 5);
    r(lit, 14, 5, 9, 1);
    r(dark, 15, 9, 8, 1);
    r(dark, 16, 6, 2, 2);
    r(flash || '#e8c840', 18, 6, 2, 2);
    r(flash || '#150f04', 18, 6, 1, 2);
    r(flash || '#e03040', 23, 6, 3, 1);
    r(flash || '#e03040', 23, 8, 3, 1);
    r(flash || '#e03040', 22, 6, 1, 3);
  }

  /**
   * The mephits share one small bat-winged frame; what tells them apart is
   * what the body is made of. Steam is stacked billows sagging fatter toward
   * the floor, with solid puffs escaping the crown, held clear of the edge.
   */
  private drawSteamMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const cloud = flash || '#c4d0dc';
    const lit = flash || '#eef3f8';
    const dark = flash || '#8797a8';
    const wing = flash || '#a2b1c1';
    // Bat wings behind the body
    r(wing, 1, 8, 8, 5);
    r(wing, 2, 13, 6, 3);
    r(dark, 1, 8, 8, 1);
    r(dark, 4, 9, 1, 6);
    r(wing, 19, 8, 8, 5);
    r(wing, 20, 13, 6, 3);
    r(dark, 19, 8, 8, 1);
    r(dark, 23, 9, 1, 6);
    // Body of stacked billows
    r(cloud, 9, 6, 10, 6);
    r(cloud, 8, 11, 12, 7);
    r(cloud, 7, 17, 14, 6);
    r(lit, 9, 6, 10, 1);
    r(lit, 8, 11, 2, 1);
    r(lit, 18, 11, 2, 1);
    r(lit, 7, 17, 2, 1);
    r(lit, 19, 17, 2, 1);
    r(dark, 7, 21, 14, 2);
    // Wisps trailing off the bottom instead of legs
    r(cloud, 9, 23, 3, 3);
    r(cloud, 16, 23, 3, 2);
    r(dark, 9, 25, 3, 1);
    // Puffs escaping the crown
    r(cloud, 11, 2, 3, 4);
    r(lit, 11, 2, 3, 1);
    r(cloud, 16, 3, 3, 3);
    r(lit, 16, 3, 3, 1);
    // Needle eyes and a hissing mouth
    r(flash || '#2a3340', 11, 8, 1, 2);
    r(flash || '#2a3340', 16, 8, 1, 2);
    r(flash || '#4a5866', 12, 13, 5, 2);
    r(flash || '#eef3f8', 13, 13, 1, 1);
    r(flash || '#eef3f8', 15, 13, 1, 1);
    // Claws hooked at the sides
    r(dark, 6, 15, 2, 3);
    r(dark, 20, 15, 2, 3);
  }

  /**
   * Every mephit is the same imp under a different element, so the element has
   * to be in the silhouette rather than only in the palette. Mud's is weight:
   * a pear-shaped body sagging over its own feet and wings that droop instead
   * of spreading, where the fire and dust mephits hold theirs out.
   */
  private drawMudMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const mud = flash || '#6b5334';
    const lit = flash || '#94764a';
    const dark = flash || '#42311b';
    const wet = flash || '#241a0d';
    // Wings held out and hanging, with clear air under them so the creature
    // does not fuse into one wide trapezoid the way the old lump did
    r(dark, 0, 1, 3, 4);
    r(dark, 1, 4, 5, 4);
    r(dark, 2, 8, 5, 4);
    r(mud, 0, 1, 3, 1);
    r(mud, 1, 4, 5, 1);
    r(wet, 3, 5, 1, 7); // wing struts
    r(wet, 5, 8, 1, 4);
    r(dark, 2, 12, 2, 2); // scalloped trailing points
    r(dark, 5, 12, 2, 1);
    r(dark, 25, 1, 3, 4);
    r(dark, 22, 4, 5, 4);
    r(dark, 21, 8, 5, 4);
    r(mud, 25, 1, 3, 1);
    r(mud, 22, 4, 5, 1);
    r(wet, 24, 5, 1, 7);
    r(wet, 22, 8, 1, 4);
    r(dark, 24, 12, 2, 2);
    r(dark, 21, 12, 2, 1);
    // Pear body, all its weight in the belly
    r(mud, 8, 12, 12, 6);
    r(mud, 6, 16, 16, 8);
    r(lit, 8, 12, 12, 1);
    r(dark, 6, 22, 16, 2);
    r(wet, 10, 19, 4, 3); // wet runnels down the gut
    r(wet, 16, 18, 3, 4);
    // Head slumped into the shoulders
    r(mud, 9, 4, 10, 9);
    r(lit, 9, 4, 10, 1);
    r(dark, 9, 4, 1, 9);
    r(dark, 9, 11, 10, 2); // sagging jowls
    // Sunken eyes and a slack mouth
    r(wet, 10, 6, 4, 3);
    r(wet, 15, 6, 4, 3);
    r(flash || '#c8b070', 11, 7, 2, 1);
    r(flash || '#c8b070', 16, 7, 2, 1);
    r(wet, 11, 10, 7, 2);
    r(lit, 11, 10, 7, 1);
    // Stubby arms and flat clay feet
    r(mud, 4, 15, 4, 5);
    r(mud, 20, 15, 4, 5);
    r(mud, 5, 24, 7, 3);
    r(mud, 16, 24, 7, 3);
    r(dark, 5, 26, 7, 1);
    r(dark, 16, 26, 7, 1);
    // Mud shed between its feet
    r(dark, 13, 25, 2, 2);
  }

  private drawIceMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // chittering shard-dragon of frozen vapor
    ctx.fillStyle = flash || '#bfe4ef'; // glittering torso
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.24);
    ctx.fillStyle = '#7fd0e0'; // icy belly plates
    ctx.fillRect(s * 0.34, s * 0.48, s * 0.32, s * 0.06);
    ctx.fillStyle = '#a8d4e0'; // folded ice wings
    ctx.fillRect(s * 0.12, s * 0.28, s * 0.18, s * 0.16);
    ctx.fillRect(s * 0.7, s * 0.28, s * 0.18, s * 0.16);
    ctx.fillStyle = '#46808a'; // crystal horns
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.58, s * 0.18, s * 0.06, s * 0.12);
    ctx.fillStyle = '#e0f0fa'; // buzzing mouth
    ctx.fillRect(s * 0.44, s * 0.46, s * 0.12, s * 0.04);
  }

  private drawSaltMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // shrivelling dust-spirit that dries the living
    ctx.fillStyle = flash || '#e0dcc8'; // chalky body
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.28);
    ctx.fillStyle = '#c4b894'; // cracked salt plates
    ctx.fillRect(s * 0.38, s * 0.4, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.5, s * 0.1, s * 0.06);
    ctx.fillStyle = '#aaa07e'; // dessicated wing
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.18, s * 0.1);
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.18, s * 0.1);
    ctx.fillStyle = '#141410'; // sunken eyes
    ctx.fillRect(s * 0.36, s * 0.32, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.32, s * 0.06, s * 0.05);
    ctx.fillStyle = '#2c2820'; // brittle beak
    ctx.fillRect(s * 0.46, s * 0.42, s * 0.08, s * 0.06);
  }

  private drawGoblinShaman(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // cackling little hex-maker wreathed in unctuous smoke
    ctx.fillStyle = flash || '#4f9a38'; // face
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.22);
    ctx.fillStyle = '#d8d8a0'; // long ears
    ctx.fillRect(s * 0.28, s * 0.2, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.64, s * 0.2, s * 0.08, s * 0.12);
    ctx.fillStyle = '#c8c8d8'; // leftover dead bone-crown
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.28, s * 0.06);
    ctx.fillStyle = '#8a6a4a'; // gribbly robe
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.3);
    ctx.fillStyle = '#5a442e'; // grime patch
    ctx.fillRect(s * 0.38, s * 0.54, s * 0.16, s * 0.08);
    ctx.fillStyle = '#28282a'; // glittering mad eyes
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.05, s * 0.04);
    ctx.fillStyle = '#c8d848'; // hex-green sparks floating
    ctx.fillRect(s * 0.2, s * 0.28, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.7, s * 0.34, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.03, s * 0.03);
  }

  private drawHobgoblinDevastator(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // crimson-robed war-caster summoning fire-scrolls
    ctx.fillStyle = flash || '#8a1c1c'; // dark red hood
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.36, s * 0.24);
    ctx.fillStyle = '#c04018'; // flickering scroll-fire
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.2, s * 0.16);
    ctx.fillStyle = '#f0a020'; // fire-script runes
    ctx.fillRect(s * 0.44, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.28, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillStyle = '#5a1010'; // billowing long robe
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.34);
    ctx.fillStyle = '#7a1414'; // sash sash
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.04);
    ctx.fillStyle = '#d0a050'; // crackling staves at both hands
    ctx.fillRect(s * 0.22, s * 0.5, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.5, s * 0.08, s * 0.04);
    ctx.fillStyle = '#28282a'; // burning eyes inside hood
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.28, s * 0.05, s * 0.05);
  }

  private drawGnollWarden(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // scarred sergeant who baits traps and springs ambushes
    ctx.fillStyle = flash || '#b07a40'; // shaggy hyena-head
    ctx.fillRect(s * 0.32, s * 0.18, s * 0.36, s * 0.26);
    ctx.fillStyle = '#8a5c2c'; // spotted muzzle
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.2, s * 0.12);
    ctx.fillStyle = '#2c1c0a'; // evil eye
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#d8d0c0'; // bone trophy armor
    ctx.fillRect(s * 0.28, s * 0.44, s * 0.5, s * 0.3);
    ctx.fillStyle = '#e0e0e0'; // skull pauldrons
    ctx.fillRect(s * 0.24, s * 0.44, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.44, s * 0.1, s * 0.12);
    ctx.fillStyle = '#8a2c14'; // blood-rust great huntspear
    ctx.fillRect(s * 0.14, s * 0.14, s * 0.04, s * 0.6);
    ctx.fillStyle = '#d8d8d8'; // iron spear head
    ctx.fillRect(s * 0.12, s * 0.08, s * 0.08, s * 0.08);
  }

  /**
   * Built on the dragonshield's kobold — same snout, tail and stance — with
   * the gear doing the telling: brass goggles pushed up on the brow, a
   * leather apron with a pocket of tools, a wrench in one hand and a
   * sparking rod held out in the other. Sparks are solid pixels kept inside
   * the box so the rim can find them.
   */
  private drawKoboldInventor(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const scale = flash || '#9a5030';
    const lit = flash || '#bd6c46';
    const dark = flash || '#5e2c18';
    const brass = flash || '#c8a040';
    const brassDk = flash || '#8a6a20';
    const lens = flash || '#7ad8e0';
    const apron = flash || '#5a4030';
    const apronLit = flash || '#7a5a44';
    const steel = flash || '#b0b8c0';
    const spark = flash || '#ffe040';
    // Tail out behind, legs planted
    r(scale, 19, 19, 5, 2);
    r(scale, 23, 17, 3, 2);
    r(scale, 11, 19, 3, 6);
    r(scale, 16, 19, 3, 6);
    r(dark, 10, 24, 4, 2);
    r(dark, 16, 24, 4, 2);
    // Body under a leather apron with a tool pocket
    r(scale, 10, 11, 10, 9);
    r(lit, 10, 11, 10, 1);
    r(apron, 11, 13, 8, 7);
    r(apronLit, 11, 13, 8, 1);
    r(dark, 12, 16, 2, 2);
    r(dark, 16, 16, 2, 2);
    r(steel, 13, 15, 1, 2);
    // Left arm with a wrench
    r(scale, 7, 12, 3, 6);
    r(dark, 7, 12, 1, 6);
    r(scale, 6, 17, 3, 2);
    r(steel, 4, 15, 2, 5);
    r(steel, 3, 14, 4, 2);
    r(dark, 4, 14, 2, 1);
    // Right arm out with the sparking rod
    r(scale, 20, 12, 3, 5);
    r(scale, 22, 15, 3, 2);
    r(brass, 24, 8, 2, 8);
    r(brassDk, 25, 8, 1, 8);
    r(flash || '#d06a30', 23, 6, 4, 3);
    r(flash || '#f0a060', 23, 6, 4, 1);
    r(spark, 22, 4, 1, 1);
    r(spark, 25, 4, 1, 1);
    r(spark, 21, 7, 1, 1);
    r(spark, 26, 10, 1, 1);
    // Head, snout to the right, eyes lit
    r(scale, 10, 4, 9, 7);
    r(lit, 10, 4, 9, 1);
    r(dark, 10, 4, 1, 7);
    r(scale, 17, 7, 5, 3);
    r(dark, 17, 9, 5, 1);
    r(dark, 20, 7, 1, 1);
    r(flash || '#f0ece0', 20, 9, 1, 1);
    r(flash || '#ff5a1a', 12, 6, 2, 2);
    r(flash || '#ff5a1a', 15, 6, 2, 2);
    r(flash || '#2a0a04', 13, 6, 1, 2);
    r(flash || '#2a0a04', 15, 6, 1, 2);
    // Goggles pushed up on the brow: brass rims, glass, a strap
    r(brassDk, 10, 3, 9, 1);
    r(brass, 10, 0, 4, 4);
    r(brass, 15, 0, 4, 4);
    r(lens, 11, 1, 2, 2);
    r(lens, 16, 1, 2, 2);
    r(brassDk, 14, 2, 1, 1);
  }

  private drawMerrowChamp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // bloated sea-warrior wreathed in barnacle-chain
    ctx.fillStyle = flash || '#5a7a82'; // bulbous fish-crushed head
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.26);
    ctx.fillStyle = '#3d5b63'; // gill slits + dorsal frill
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.05, s * 0.16);
    ctx.fillRect(s * 0.65, s * 0.2, s * 0.05, s * 0.16);
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.4, s * 0.06);
    ctx.fillStyle = '#101820'; // gaping fanged maw
    ctx.fillRect(s * 0.42, s * 0.36, s * 0.16, s * 0.08);
    ctx.fillStyle = '#e8e8e8'; // needle teeth
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.36, s * 0.03, s * 0.06);
    ctx.fillStyle = '#46626a'; // ponderous torso
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.28);
    ctx.fillStyle = '#2a3a40'; // barnacle-chain straps
    ctx.fillRect(s * 0.32, s * 0.48, s * 0.36, s * 0.04);
    ctx.fillStyle = '#8a8a9a'; // coral javelin
    ctx.fillRect(s * 0.76, s * 0.22, s * 0.04, s * 0.5);
    ctx.fillStyle = '#c45858'; // black-coral tip
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.08, s * 0.08);
  }

  private drawFallenAasimar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // radiant being haloed in gray guttering ash
    ctx.fillStyle = flash || '#6a5a50'; // long coat
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.34);
    ctx.fillStyle = '#8a7a70'; // pale face beneath cowl
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.22);
    ctx.fillStyle = '#3a2c26'; // shadowed hood
    ctx.fillRect(s * 0.3, s * 0.16, s * 0.4, s * 0.14);
    ctx.fillStyle = '#4a3a2e'; // guttering halo
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.44, s * 0.06);
    ctx.fillStyle = '#a09488'; // ashen second wings
    ctx.fillRect(s * 0.2, s * 0.24, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.12, s * 0.2);
    ctx.fillStyle = '#c58a70'; // bitter pale eyes
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.28, s * 0.06, s * 0.05);
    ctx.fillStyle = '#b0a496'; // light-rope gauntlet
    ctx.fillRect(s * 0.66, s * 0.5, s * 0.08, s * 0.16);
    ctx.fillStyle = '#f0e8d8'; // glowing stolen light
    ctx.fillRect(s * 0.68, s * 0.46, s * 0.06, s * 0.06);
  }

  private drawFrostDevil(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // glacial fiend wreathed in barbed hoar-frost chains
    ctx.fillStyle = flash || '#a8c8dc'; // icy barbed body
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.34);
    ctx.fillStyle = '#d6ecf5'; // frosted rub-ribs
    ctx.fillRect(s * 0.34, s * 0.44, s * 0.32, s * 0.06);
    ctx.fillStyle = '#e0f0fa'; // horned skull
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.22);
    ctx.fillStyle = '#80b4cc'; // sweeping horns
    ctx.fillRect(s * 0.28, s * 0.12, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.1, s * 0.1);
    ctx.fillStyle = '#0a1418'; // pit-deep frozen eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillStyle = '#9cc4d8'; // trailing frost chains
    ctx.fillRect(s * 0.16, s * 0.42, s * 0.12, s * 0.03);
    ctx.fillRect(s * 0.16, s * 0.5, s * 0.12, s * 0.03);
    ctx.fillRect(s * 0.72, s * 0.42, s * 0.12, s * 0.03);
    ctx.fillStyle = '#f2fafc'; // black-rime breath vapor
    ctx.fillRect(s * 0.5, s * 0.12, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.08, s * 0.03, s * 0.04);
  }

  private drawDeepOnePriest(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // chanting creature of the sunken faith
    ctx.fillStyle = flash || '#5a7a82'; // fish-slick head
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.26);
    ctx.fillStyle = '#8ac8d8'; // bulging seeing eyes
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.2, s * 0.14, s * 0.14);
    ctx.fillStyle = '#1a2028'; // drowned-star pupils
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#22343a'; // gill frills
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.04, s * 0.18);
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.04, s * 0.18);
    ctx.fillStyle = '#4a6a72'; // barnacle-woven vestments
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.32);
    ctx.fillStyle = '#2c444c'; // rope of teeth around waist
    ctx.fillRect(s * 0.3, s * 0.56, s * 0.4, s * 0.04);
    ctx.fillStyle = '#9ac4cc'; // murmured bubbles
    ctx.fillRect(s * 0.46, s * 0.12, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.04, s * 0.04);
  }

  private drawFireGiantDreadnought(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // armor-plated engine of the forge-folk with a flaming maul
    ctx.fillStyle = flash || '#8a5a2a'; // great armored head
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.28);
    ctx.fillStyle = '#c08a2a'; // forge-glow eyes
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillStyle = '#6a4420'; // iron helm rim
    ctx.fillRect(s * 0.28, s * 0.12, s * 0.44, s * 0.06);
    ctx.fillStyle = '#7a4a26'; // riveted iron breastplate
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.48, s * 0.32);
    ctx.fillStyle = '#b8c0cc'; // shining rivets
    ctx.fillRect(s * 0.3, s * 0.46, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.44, s * 0.5, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.46, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a6a3a'; // colossal flaming maul shaft
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.08, s * 0.6);
    ctx.fillStyle = '#c03010'; // burning maul head
    ctx.fillRect(s * 0.6, s * 0.14, s * 0.2, s * 0.12);
    ctx.fillStyle = '#f0a020'; // licking flames
    ctx.fillRect(s * 0.58, s * 0.08, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.7, s * 0.06, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.04, s * 0.08);
  }

  private drawAndrosphinx(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // great winged riddle guardian with a bearded human face
    ctx.fillStyle = flash || '#d8b448'; // golden mane + leonine body
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.48, s * 0.3);
    ctx.fillStyle = '#a8842c'; // pelt shading
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.54, s * 0.5, s * 0.16, s * 0.18);
    ctx.fillStyle = '#c8a878'; // noble bearded face
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.22);
    ctx.fillStyle = '#6a542c'; // gold-coiled beard
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.2, s * 0.08);
    ctx.fillStyle = '#152a36'; // penetrating eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.55, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#c8b46a'; // great feathered wings raised
    ctx.fillRect(s * 0.18, s * 0.18, s * 0.18, s * 0.28);
    ctx.fillRect(s * 0.64, s * 0.18, s * 0.18, s * 0.28);
    ctx.fillStyle = '#e0d098'; // wing feather tips
    ctx.fillRect(s * 0.16, s * 0.16, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.16, s * 0.06, s * 0.06);
  }

  private drawGynosphinx(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // keen-eyed riddle guardian with jeweled headdress
    ctx.fillStyle = flash || '#d8b448'; // sleek leonine body
    ctx.fillRect(s * 0.28, s * 0.42, s * 0.44, s * 0.28);
    ctx.fillStyle = '#a8842c'; // pelt shading
    ctx.fillRect(s * 0.32, s * 0.5, s * 0.1, s * 0.14);
    ctx.fillStyle = '#c8a878'; // fine-featured face
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.2, s * 0.22);
    ctx.fillStyle = '#3a2c5a'; // jeweled brow band
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.2, s * 0.06);
    ctx.fillStyle = '#a040c0'; // gem stones
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.04, s * 0.06);
    ctx.fillStyle = '#1a2c3a'; // wise unblinking eyes
    ctx.fillRect(s * 0.44, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillStyle = '#b49e5c'; // closed elegant wings
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.68, s * 0.34, s * 0.12, s * 0.28);
  }


  private drawGriffinRoyal(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // gold-crested royal griffin wheeling high
    ctx.fillStyle = flash || '#d8b060'; // leonine golden body
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.44, s * 0.26);
    ctx.fillStyle = '#f0e0b0'; // fringed chest hackles
    ctx.fillRect(s * 0.28, s * 0.5, s * 0.16, s * 0.06);
    ctx.fillStyle = '#e8d088'; // noble eagle head curved
    ctx.fillRect(s * 0.6, s * 0.26, s * 0.24, s * 0.2);
    ctx.fillStyle = '#eef0d8'; // hooked ivory beak
    ctx.fillRect(s * 0.78, s * 0.3, s * 0.08, s * 0.08);
    ctx.fillStyle = '#c03030'; // piercing red eye
    ctx.fillRect(s * 0.7, s * 0.28, s * 0.04, s * 0.04);
    ctx.fillStyle = '#d8c88a'; // spread majestic wings
    ctx.fillRect(s * 0.08, s * 0.28, s * 0.18, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.28, s * 0.18, s * 0.2);
    ctx.fillStyle = '#f2ecc0'; // wing finger-feathers
    ctx.fillRect(s * 0.08, s * 0.24, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.82, s * 0.24, s * 0.04, s * 0.1);
  }

  private drawWraithLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // armor-girt tyrant ghost, shadow-wrought
    ctx.fillStyle = flash || '#26262e'; // spectral-cut armor
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.34);
    ctx.fillStyle = '#383844'; // ethereal plate bands
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.32, s * 0.06);
    ctx.fillRect(s * 0.34, s * 0.54, s * 0.32, s * 0.06);
    ctx.fillStyle = '#32323e'; // crowned visage
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.2);
    ctx.fillStyle = '#454554'; // rust-crown spikes
    ctx.fillRect(s * 0.36, s * 0.12, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.48, s * 0.1, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.12, s * 0.04, s * 0.06);
    ctx.fillStyle = '#a03040'; // withering eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.55, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#1c1c22'; // greatsword of shadow
    ctx.fillRect(s * 0.66, s * 0.16, s * 0.04, s * 0.52);
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.16, s * 0.06);
    ctx.fillStyle = '#3a3a4c'; // shadow-trailing sword
    ctx.fillRect(s * 0.66, s * 0.08, s * 0.06, s * 0.06);
  }

  /**
   * The legionnaire was a grey slab with a red dot: nothing on it said
   * skeleton. It is the skeleton's own anatomy — ribs with the cavity showing
   * between them, jointed bones, the hanging jaw — under a crested helm, with
   * a scutum on the left arm and a spear stood upright on the right.
   */
  private drawSkeletonLegionnaire(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const bone = flash || '#d8d2c0';
    const lit = flash || '#efeade';
    const shade = flash || '#a49c8a';
    const gap = flash || '#1c1a1e';
    const iron = flash || '#6f7480';
    const ironLit = flash || '#9aa0ad';
    const ironDark = flash || '#474b55';
    const red = flash || '#8e2a2a';
    const redLit = flash || '#b84040';
    const brass = flash || '#c9a24a';
    // Legs, knee knuckles, splayed feet
    r(bone, 11, 20, 2, 5);
    r(bone, 16, 20, 2, 5);
    r(shade, 10, 22, 4, 1);
    r(shade, 15, 22, 4, 1);
    r(bone, 9, 25, 5, 2);
    r(bone, 15, 25, 5, 2);
    // Pelvis
    r(bone, 10, 17, 9, 3);
    r(gap, 12, 18, 2, 2);
    r(gap, 15, 18, 2, 2);
    // Spine and ribs, the cavity showing between them
    r(gap, 9, 9, 11, 8);
    r(bone, 13, 9, 2, 8);
    r(bone, 9, 9, 11, 1);
    r(bone, 9, 11, 11, 1);
    r(bone, 10, 13, 9, 1);
    r(bone, 11, 15, 7, 1);
    r(shade, 9, 12, 11, 1);
    // Collarbone
    r(bone, 8, 8, 13, 2);
    r(lit, 8, 8, 13, 1);
    // Right arm, and the spear it holds upright
    r(flash || '#5a4630', 24, 5, 2, 21);
    r(flash || '#7a6244', 24, 5, 1, 21);
    r(iron, 23, 0, 4, 6);
    r(ironLit, 24, 0, 1, 6);
    r(ironDark, 26, 2, 1, 4);
    r(bone, 21, 9, 2, 5);
    r(shade, 20, 13, 4, 1);
    r(bone, 22, 14, 2, 5);
    r(bone, 21, 18, 5, 2);
    // Skull under the helm: sockets, nose, hanging jaw
    r(bone, 10, 3, 9, 4);
    r(shade, 10, 3, 1, 4);
    r(gap, 11, 4, 3, 2);
    r(gap, 15, 4, 3, 2);
    if (!flash) {
      r('#ff8a2a', 12, 4, 2, 2);
      r('#ff8a2a', 16, 4, 2, 2);
    }
    r(gap, 14, 6, 1, 1);
    r(bone, 11, 7, 7, 2);
    r(gap, 12, 8, 1, 1);
    r(gap, 14, 8, 1, 1);
    r(gap, 16, 8, 1, 1);
    // Legion helm: brow band, cheek guards, and the crest
    r(iron, 9, 1, 11, 3);
    r(ironLit, 9, 1, 11, 1);
    r(ironDark, 9, 3, 11, 1);
    r(iron, 9, 4, 1, 3);
    r(iron, 19, 4, 1, 3);
    r(red, 11, 0, 7, 1);
    r(redLit, 11, 0, 3, 1);
    r(red, 8, 1, 3, 1);
    // Scutum on the left, covering that arm entirely
    r(red, 1, 8, 8, 15);
    r(redLit, 1, 8, 8, 1);
    r(flash || '#5e1c1c', 1, 21, 8, 2);
    r(brass, 1, 8, 1, 15);
    r(brass, 8, 8, 1, 15);
    r(brass, 4, 13, 2, 3);
    r(flash || '#f0d890', 4, 13, 1, 1);
  }


  /**
   * A swarm has to read as many small animals, not as a mound. The old one was
   * three stacked bricks with a few specks on them. Six individual rats are
   * drawn instead, at different heights and both facings, each with a snout, an
   * eye and a tail — the ragged outline of the group is the whole sprite.
   */
  private drawSwarmRats(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#6b5b52';
    const lit = flash || '#8a7a6e';
    const dark = flash || '#3a2e28';
    const tail = flash || '#a4807a';
    // One rat: body, head thrust forward, ear, eye, and a tail behind.
    const rat = (x: number, y: number, dir: 1 | -1, shade: string) => {
      const f = dir === 1 ? (dx: number, w: number) => x + dx : (dx: number, w: number) => x + 8 - dx - w;
      r(tail, f(-3, 4), y + 3, 4, 1);
      r(shade, f(0, 6), y + 1, 6, 4);
      r(lit, f(0, 6), y + 1, 6, 1);
      r(shade, f(5, 3), y + 2, 3, 3);
      r(shade, f(4, 2), y, 2, 2);
      r(tail, f(8, 2), y + 3, 2, 2);
      r('#1a1410', f(6, 1), y + 3, 1, 1);
    };
    rat(2, 18, 1, fur);
    rat(13, 19, -1, fur);
    rat(6, 13, -1, dark);
    rat(16, 12, 1, fur);
    rat(1, 8, 1, dark);
    rat(18, 6, -1, dark);
    rat(9, 3, 1, fur);
  }

  private drawGiantScorpionMatriarch(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // colossal brooding scorpion with armored pincers
    ctx.fillStyle = flash || '#8a4a2a'; // segmented armored body
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.42, s * 0.26);
    ctx.fillStyle = '#6a3418'; // overlapping plate grooves
    ctx.fillRect(s * 0.28, s * 0.44, s * 0.3, s * 0.05);
    ctx.fillRect(s * 0.24, s * 0.52, s * 0.34, s * 0.05);
    ctx.fillStyle = '#a8603a'; // gnarled claw arms
    ctx.fillRect(s * 0.12, s * 0.44, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.18, s * 0.36, s * 0.12, s * 0.1);
    ctx.fillStyle = '#a8603a'; // raised tail segment
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.12, s * 0.1);
    ctx.fillStyle = '#d0d8b0'; // wickedly curved stinger
    ctx.beginPath();
    ctx.moveTo(s * 0.62, s * 0.22);
    ctx.lineTo(s * 0.44, s * 0.14);
    ctx.lineTo(s * 0.56, s * 0.18);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6a3418'; // scuttling legs
    ctx.fillRect(s * 0.26, s * 0.66, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.38, s * 0.66, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.5, s * 0.66, s * 0.04, s * 0.12);
  }

  private drawHillGiantEldest(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // hundred-year patriarch with gray beard and boulder club
    ctx.fillStyle = flash || '#9c7c5a'; // stooped mighty bulk
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.52, s * 0.34);
    ctx.fillStyle = '#7c6246'; // thick hide sash + grime
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.08);
    ctx.fillStyle = '#b09070'; // weathered great head
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.28);
    ctx.fillStyle = '#e8e4d8'; // long gray beard
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.32, s * 0.1);
    ctx.fillStyle = '#5a462e'; // heavy brows
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.05);
    ctx.fillStyle = '#2c2010'; // small shrewd eyes
    ctx.fillRect(s * 0.36, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillStyle = '#6a4e2c'; // ruddy massive club
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.1, s * 0.56);
    ctx.fillStyle = '#8c7048'; // boulder-cacked knob
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.18, s * 0.12);
    ctx.fillStyle = '#9c9cac'; // bone-clatter talisman
    ctx.fillRect(s * 0.4, s * 0.4, s * 0.04, s * 0.08);
  }

  private drawConjurerArcanist(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // robed spellcrafter bending rock and fire to its designs
    ctx.fillStyle = flash || '#4a3868'; // deep violet robe
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.34);
    ctx.fillStyle = '#6a5288'; // arcane robe trim
    ctx.fillRect(s * 0.32, s * 0.44, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.58, s * 0.36, s * 0.04);
    ctx.fillStyle = '#3a2c58'; // hooded face
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.22);
    ctx.fillStyle = '#1c1426'; // shadow gap under hood
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.2, s * 0.12);
    ctx.fillStyle = '#c860e0'; // glowing rune-fire eyes
    ctx.fillRect(s * 0.42, s * 0.28, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.28, s * 0.05, s * 0.05);
    ctx.fillStyle = '#c04818'; // conjured blaze at one hand
    ctx.fillRect(s * 0.7, s * 0.34, s * 0.08, s * 0.12);
    ctx.fillStyle = '#f0a020'; // dancing fire
    ctx.fillRect(s * 0.72, s * 0.28, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.04, s * 0.06);
    ctx.fillStyle = '#8a7a4a'; // levitating grimoire
    ctx.fillRect(s * 0.14, s * 0.42, s * 0.1, s * 0.14);
    ctx.fillStyle = '#c8b46a'; // glowing cover runes
    ctx.fillRect(s * 0.16, s * 0.46, s * 0.06, s * 0.03);
  }

  private drawSuccubus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // beguiling fiend with wide feathered wings and a sly crown
    ctx.fillStyle = flash || '#7a4a6a'; // glossy body gown
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.34);
    ctx.fillStyle = '#a06a90'; // skirt sheen
    ctx.fillRect(s * 0.34, s * 0.44, s * 0.32, s * 0.04);
    ctx.fillStyle = '#d8c8d0'; // smooth face
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.22);
    ctx.fillStyle = '#a0308a'; // smoldering violet eyes
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.05, s * 0.04);
    ctx.fillStyle = '#70305a'; // smile of guile
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.12, s * 0.03);
    ctx.fillStyle = '#5a3a52'; // small curling horns
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.06, s * 0.08);
    ctx.fillStyle = '#8a5a7a'; // great feathered wings
    ctx.fillRect(s * 0.16, s * 0.24, s * 0.18, s * 0.24);
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.18, s * 0.24);
    ctx.fillStyle = '#c39'; // heart-shaped sting tail
    ctx.fillRect(s * 0.66, s * 0.6, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.08, s * 0.04);
  }


  private drawMerrenoloth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // hooded captain of the Styx with a lighthouse lantern
    ctx.fillStyle = flash || '#2c4054'; // flowing mottled cloak
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.4);
    ctx.fillStyle = '#406a80'; // lap rime
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.05);
    ctx.fillStyle = '#1c2c3a'; // deep-cowled face
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.2);
    ctx.fillStyle = '#0e1620'; // hood shadow
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.4, s * 0.12);
    ctx.fillStyle = '#c05830'; // lighthouse lantern glow
    ctx.fillRect(s * 0.72, s * 0.28, s * 0.1, s * 0.14);
    ctx.fillStyle = '#f0a050'; // warm flame
    ctx.fillRect(s * 0.74, s * 0.3, s * 0.06, s * 0.08);
    ctx.fillStyle = '#8a3a20'; // brass lantern handle
    ctx.fillRect(s * 0.68, s * 0.22, s * 0.04, s * 0.08);
    ctx.fillStyle = '#6a7a84'; // spectral ship oar
    ctx.fillRect(s * 0.62, s * 0.6, s * 0.24, s * 0.04);
  }

  private drawCloaker(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // tattered ceiling-hugging leather shroud
    ctx.fillStyle = flash || '#5a4632'; // wide ragged mantle
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.1);
    ctx.lineTo(s * 0.8, s * 0.1);
    ctx.lineTo(s * 0.86, s * 0.6);
    ctx.lineTo(s * 0.5, s * 0.52);
    ctx.lineTo(s * 0.14, s * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3a2c1e'; // dangling tail tatters
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.05, s * 0.2);
    ctx.fillRect(s * 0.5, s * 0.66, s * 0.05, s * 0.2);
    ctx.fillRect(s * 0.68, s * 0.62, s * 0.05, s * 0.2);
    ctx.fillStyle = '#7a6242'; // leather ridge spine
    ctx.fillRect(s * 0.42, s * 0.52, s * 0.16, s * 0.08);
    ctx.fillStyle = '#c03020'; // burning baleful eyes
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.05, s * 0.05);
  }

  private drawChoker(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // spindly noose-armed cave horror
    ctx.fillStyle = flash || '#b8a080'; // pale writhing torso
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.2, s * 0.28);
    ctx.fillStyle = '#8a6a50'; // pinched ribs
    ctx.fillRect(s * 0.42, s * 0.34, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.42, s * 0.44, s * 0.16, s * 0.04);
    ctx.fillStyle = '#8a6a50'; // impossibly long arms
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.2, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.2, s * 0.06);
    ctx.fillStyle = '#2c2010'; // strangling claws
    ctx.fillRect(s * 0.14, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.8, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillStyle = '#a08060'; // small bald head low
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.16, s * 0.12);
    ctx.fillStyle = '#2c2010'; // malice-black eyes
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.22, s * 0.04, s * 0.04);
  }

  private drawBehir(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // twelve-legged lightning serpent
    ctx.fillStyle = flash || '#4a6a5a'; // long serpentine coils
    ctx.fillRect(s * 0.12, s * 0.4, s * 0.34, s * 0.2);
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.3, s * 0.2);
    ctx.fillRect(s * 0.68, s * 0.36, s * 0.22, s * 0.18);
    ctx.fillStyle = '#2c4438'; // overlapping plate rings
    ctx.fillRect(s * 0.18, s * 0.42, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.48, s * 0.28, s * 0.06, s * 0.16);
    ctx.fillStyle = '#5a7a6a'; // broad horned head
    ctx.fillRect(s * 0.84, s * 0.28, s * 0.16, s * 0.18);
    ctx.fillStyle = '#3a5a4a'; // horns
    ctx.fillRect(s * 0.86, s * 0.2, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.94, s * 0.2, s * 0.05, s * 0.08);
    ctx.fillStyle = '#f0d030'; // crackling storm eyes
    ctx.fillRect(s * 0.88, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillStyle = '#a0b090'; // scuttling legs down
    ctx.fillRect(s * 0.2, s * 0.6, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.4, s * 0.6, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.6, s * 0.6, s * 0.05, s * 0.14);
    ctx.fillStyle = '#f0e040'; // lightning breath crackle
    ctx.fillRect(s * 0.9, s * 0.08, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.98, s * 0.04, s * 0.03, s * 0.1);
  }

  private drawCuSith(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // great green fairy-hound, larger than a horse
    ctx.fillStyle = flash || '#3a7a4a'; // shaggy great hound body
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.44, s * 0.24);
    ctx.fillStyle = '#2c5c38'; // long green mane
    ctx.fillRect(s * 0.14, s * 0.34, s * 0.26, s * 0.1);
    ctx.fillStyle = '#3a8a52'; // sharp lupine head
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.26, s * 0.2);
    ctx.fillStyle = '#1a3a26'; // alert pointed ears
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.68, s * 0.2, s * 0.06, s * 0.08);
    ctx.fillStyle = '#f0d030'; // pale luminous eyes
    ctx.fillRect(s * 0.64, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillStyle = '#e8e8e8'; // glinting fangs
    ctx.fillRect(s * 0.66, s * 0.4, s * 0.03, s * 0.04);
    ctx.fillRect(s * 0.72, s * 0.4, s * 0.03, s * 0.04);
    ctx.fillStyle = '#2c5c38'; // strong legs
    ctx.fillRect(s * 0.3, s * 0.64, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.48, s * 0.64, s * 0.1, s * 0.2);
  }

  private drawTreantAncient(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // root-bound elder of the deepwood
    ctx.fillStyle = flash || '#5a4a30'; // gnarled bark torso
    ctx.fillRect(s * 0.28, s * 0.36, s * 0.44, s * 0.34);
    ctx.fillStyle = '#3a2c18'; // root ridges and cuts
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.5, s * 0.14, s * 0.05);
    ctx.fillStyle = '#6a5438'; // massive branching crown
    ctx.fillRect(s * 0.24, s * 0.18, s * 0.52, s * 0.12);
    ctx.fillStyle = '#8a7048'; // leafy canopy moss
    ctx.fillRect(s * 0.16, s * 0.1, s * 0.16, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.1, s * 0.16, s * 0.12);
    ctx.fillStyle = '#141010'; // deep furrow eyes
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.58, s * 0.4, s * 0.06, s * 0.06);
    ctx.fillStyle = '#2c2c18'; // moss beard roots
    ctx.fillRect(s * 0.4, s * 0.58, s * 0.2, s * 0.1);
    ctx.fillStyle = '#3a2c18'; // stump-ankle legs
    ctx.fillRect(s * 0.36, s * 0.7, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.7, s * 0.14, s * 0.2);
  }

  private drawSeaSpawn(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // dripping half-flensed thing of spawn and brine
    ctx.fillStyle = flash || '#4a6a72'; // bloated brine body
    ctx.fillRect(s * 0.32, s * 0.34, s * 0.36, s * 0.34);
    ctx.fillStyle = '#33525a'; // slick webbing folds
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.32, s * 0.1);
    ctx.fillStyle = '#5a7a82'; // eyeless pulp head
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.18);
    ctx.fillStyle = '#23343a'; // wet mewling mouth-tunnel
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.12, s * 0.05);
    ctx.fillStyle = '#e8e8e8'; // small barnacle nubs
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.65, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillStyle = '#2c3c42'; // grasping fin arms
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.08, s * 0.18);
    ctx.fillRect(s * 0.68, s * 0.4, s * 0.08, s * 0.18);
    ctx.fillStyle = '#8ad0d8'; // brine drips
    ctx.fillRect(s * 0.3, s * 0.72, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.74, s * 0.04, s * 0.08);
  }

  private drawSahuaginBaron(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // scaled sea-raider baron with a shark-tooth crown
    ctx.fillStyle = flash || '#3a6a5a'; // scaled shark head
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.24);
    ctx.fillStyle = '#2c5446'; // gill slits
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.05, s * 0.14);
    ctx.fillStyle = '#e8e8e8'; // shark-tooth crown
    ctx.fillRect(s * 0.34, s * 0.12, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.1, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.04, s * 0.06);
    ctx.fillStyle = '#f0d030'; // ruthless slit eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#2a5444'; // scaled chest + belt
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.28);
    ctx.fillStyle = '#1c3a2c'; // shark-bone belt
    ctx.fillRect(s * 0.3, s * 0.54, s * 0.4, s * 0.04);
    ctx.fillStyle = '#c8d0b8'; // a barbed trident of bone
    ctx.fillRect(s * 0.78, s * 0.2, s * 0.04, s * 0.5);
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.82, s * 0.14, s * 0.06, s * 0.06);
  }

  private drawRocAncient(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // mountain-winged king of the sky, beak like a keel
    ctx.fillStyle = flash || '#3a3028'; // vast feathered body
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.3);
    ctx.fillStyle = '#241c14'; // feather striping
    ctx.fillRect(s * 0.3, s * 0.38, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.4, s * 0.05);
    ctx.fillStyle = '#4a3c30'; // great flat head
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.28, s * 0.2);
    ctx.fillStyle = '#1c1410'; // cold hunter eye
    ctx.fillRect(s * 0.76, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#c8b898'; // huge hooked beak
    ctx.fillRect(s * 0.84, s * 0.24, s * 0.1, s * 0.1);
    ctx.fillStyle = '#2a221a'; // colossal spread wings
    ctx.fillRect(s * 0.04, s * 0.3, s * 0.2, s * 0.3);
    ctx.fillRect(s * 0.76, s * 0.3, s * 0.2, s * 0.3);
    ctx.fillStyle = '#3a3026'; // wing notch feathers
    ctx.fillRect(s * 0.06, s * 0.42, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.88, s * 0.42, s * 0.06, s * 0.14);
    ctx.fillStyle = '#241c14'; // massive talons
    ctx.fillRect(s * 0.36, s * 0.64, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.08, s * 0.14);
  }

  private drawGiantBombardierBeetle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const shell = flash || '#7a3a1c';
    const lit = flash || '#a85c30';
    const dark = flash || '#46200e';
    const chitin = flash || '#241208';
    const vent = flash || '#ffe25a';
    // Six legs under a heavy domed carapace
    r(chitin, 4, 20, 2, 5);
    r(chitin, 3, 24, 4, 2);
    r(chitin, 10, 21, 2, 5);
    r(chitin, 9, 25, 4, 2);
    r(chitin, 16, 21, 2, 5);
    r(chitin, 15, 25, 4, 2);
    // Carapace, split down the elytra seam
    r(shell, 2, 8, 20, 13);
    r(lit, 2, 8, 20, 2);
    r(dark, 2, 18, 20, 3);
    r(dark, 11, 8, 2, 13);
    r(lit, 4, 11, 5, 3);
    r(shell, 5, 5, 14, 4);
    r(lit, 5, 5, 14, 1);
    r(dark, 5, 8, 14, 1);
    // Head and jaws down at the front, antenna up
    r(chitin, 0, 10, 6, 6);
    r(lit, 0, 10, 6, 1);
    r(flash || '#e8b52c', 1, 12, 2, 2);
    r(flash || '#c9b48a', 0, 16, 4, 2);
    r(chitin, 2, 3, 2, 4);
    r(chitin, 0, 1, 3, 2);
    // The vent, and the scalding jet coming out of it
    r(vent, 21, 12, 3, 4);
    r(flash || '#fff0b0', 24, 10, 3, 3);
    r(flash || '#d9e6ee', 25, 14, 3, 3);
    r(flash || '#fff0b0', 24, 18, 2, 2);
  }


  private drawHobgoblinIronShadow(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // silent martial shadow of the legions, shortsword glided
    ctx.fillStyle = flash || '#2a3038'; // sinewy dark armor
    ctx.fillRect(s * 0.32, s * 0.34, s * 0.36, s * 0.32);
    ctx.fillStyle = '#434a54'; // iron plate bands
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.32, s * 0.05);
    ctx.fillRect(s * 0.34, s * 0.56, s * 0.32, s * 0.05);
    ctx.fillStyle = '#b8c4d0'; // cleft horned helm
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.26);
    ctx.fillStyle = '#0a0e14'; // visor shadow
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.16, s * 0.12);
    ctx.fillStyle = '#c85830'; // smoldering eye slits
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.24, s * 0.06, s * 0.04);
    ctx.fillStyle = '#8a9aa8'; // precise shortsword
    ctx.fillRect(s * 0.72, s * 0.34, s * 0.04, s * 0.36);
    ctx.fillStyle = '#10141a'; // wrapped hilt
    ctx.fillRect(s * 0.7, s * 0.66, s * 0.06, s * 0.06);
    ctx.fillStyle = '#3a4048'; // long flowing tail-cloak
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.1, s * 0.26);
  }

  private drawFlyingSnake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const scale = flash || '#2f8a4a';
    const lit = flash || '#57bb72';
    const dark = flash || '#1a5c30';
    const band = flash || '#d8402e';
    const memb = flash || '#c8a83c';
    const vein = flash || '#8a6c18';
    // Airborne, with a ribbed pair of wings halfway down the body — the
    // wings are the whole silhouette, since a snake alone would read as
    // any of the other three serpents in the bestiary.
    r(memb, 1, 7, 11, 5);
    r(vein, 1, 7, 11, 1);
    r(memb, 2, 12, 8, 3);
    r(vein, 4, 8, 1, 6);
    r(vein, 8, 8, 1, 6);
    r(memb, 16, 7, 11, 5);
    r(vein, 16, 7, 11, 1);
    r(memb, 18, 12, 8, 3);
    r(vein, 19, 8, 1, 6);
    r(vein, 23, 8, 1, 6);
    // Head thrown up between the wings, jaw open
    r(scale, 10, 0, 9, 6);
    r(lit, 10, 0, 9, 1);
    r(dark, 10, 0, 1, 6);
    r(flash || '#3a1410', 11, 5, 8, 2);
    r(flash || '#f4eddc', 12, 6, 1, 2);
    r(flash || '#f4eddc', 17, 6, 1, 2);
    r(flash || '#f0d030', 12, 2, 2, 2);
    r(flash || '#f0d030', 16, 2, 2, 2);
    r(flash || '#140b04', 12, 2, 1, 2);
    r(flash || '#140b04', 17, 2, 1, 2);
    // Body running down from the neck in an S, tail whipping left
    r(scale, 12, 7, 5, 8);
    r(lit, 12, 7, 1, 8);
    r(scale, 8, 14, 12, 5);
    r(lit, 8, 14, 12, 1);
    r(scale, 4, 18, 12, 4);
    r(lit, 4, 18, 12, 1);
    r(scale, 1, 21, 7, 3);
    r(scale, 0, 23, 4, 2);
    r(band, 13, 8, 2, 7);
    r(band, 10, 14, 2, 5);
    r(band, 16, 14, 2, 5);
    r(band, 6, 18, 2, 4);
    r(band, 12, 18, 2, 4);
  }

  private drawGiantFrilledLizard(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#5b7f36';
    const lit = flash || '#83a852';
    const dark = flash || '#35501d';
    const frill = flash || '#c2571f';
    const frillLit = flash || '#e5843f';
    const frillDark = flash || '#8a3610';
    // Whipping tail and a body slung low between running legs
    r(hide, 0, 16, 7, 2);
    r(hide, 4, 14, 7, 4);
    r(lit, 4, 14, 7, 1);
    r(hide, 8, 12, 11, 7);
    r(lit, 8, 12, 11, 1);
    r(dark, 8, 17, 11, 2);
    r(dark, 6, 18, 3, 5);
    r(hide, 4, 22, 6, 2);
    r(dark, 15, 18, 3, 6);
    r(hide, 14, 23, 6, 2);
    r(dark, 11, 19, 3, 4);
    r(hide, 10, 22, 5, 2);
    // The frill: a ribbed fan of skin thrown open around the neck, which
    // is the only thing anyone remembers about this animal.
    r(frill, 14, 1, 13, 15);
    r(frillLit, 14, 1, 13, 1);
    r(frillDark, 14, 15, 13, 1);
    r(frillDark, 17, 2, 1, 13);
    r(frillDark, 20, 2, 1, 13);
    r(frillDark, 23, 2, 1, 13);
    r(frillLit, 15, 5, 1, 8);
    // Head in front of it, jaw open
    r(hide, 19, 6, 9, 5);
    r(lit, 19, 6, 9, 1);
    r(flash || '#3a1008', 21, 10, 7, 2);
    r(flash || '#f0e8d0', 22, 11, 1, 1);
    r(flash || '#f0e8d0', 26, 11, 1, 1);
    r(flash || '#ffd24a', 22, 7, 2, 2);
    r(flash || '#160c04', 23, 7, 1, 2);
  }

  /**
   * The gloom weaver is not a spider — it is the thing that spins the web
   * the spiders live in: a gaunt, bald figure with two pairs of arms, the
   * upper pair reaching up and out, the lower pair holding a strand of
   * solid gloom-silk between the hands. Tall and thin where the spider lord
   * beside it is squat on eight legs.
   */
  private drawGloomWeaver(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#43325a';
    const lit = flash || '#614c7e';
    const dark = flash || '#281d38';
    const eye = flash || '#d060ff';
    const silk = flash || '#a48cc4';
    const silkLit = flash || '#d0c0e8';
    // Lower arms out and down, the strand hung between the hands
    r(skin, 6, 13, 5, 2);
    r(skin, 3, 15, 3, 3);
    r(skin, 1, 18, 2, 5);
    r(skin, 17, 13, 5, 2);
    r(skin, 22, 15, 3, 3);
    r(skin, 25, 18, 2, 5);
    r(silk, 3, 22, 22, 1);
    r(silkLit, 8, 22, 1, 1);
    r(silkLit, 19, 22, 1, 1);
    r(silk, 6, 23, 1, 2);
    r(silk, 13, 23, 1, 3);
    r(silk, 20, 23, 1, 2);
    // Upper arms reaching up and out, clawed
    r(skin, 7, 8, 4, 2);
    r(skin, 4, 5, 3, 3);
    r(skin, 2, 1, 2, 4);
    r(dark, 1, 1, 1, 2);
    r(skin, 17, 8, 4, 2);
    r(skin, 21, 5, 3, 3);
    r(skin, 24, 1, 2, 4);
    r(dark, 26, 1, 1, 2);
    // Legs, thin, feet splayed
    r(skin, 11, 17, 2, 8);
    r(skin, 15, 17, 2, 8);
    r(dark, 10, 25, 3, 2);
    r(dark, 15, 25, 3, 2);
    // Torso, hunched, ribs showing through
    r(skin, 10, 7, 8, 10);
    r(lit, 10, 7, 8, 1);
    r(dark, 10, 7, 1, 10);
    r(dark, 11, 10, 6, 1);
    r(dark, 11, 12, 6, 1);
    r(dark, 11, 14, 6, 1);
    // Bald head, eyes glaring violet, a lipless mouth
    r(skin, 11, 0, 6, 7);
    r(lit, 11, 0, 6, 1);
    r(dark, 11, 0, 1, 7);
    r(eye, 12, 2, 2, 2);
    r(eye, 15, 2, 2, 2);
    r(dark, 12, 5, 4, 1);
    r(silkLit, 13, 5, 1, 1);
    r(silkLit, 15, 5, 1, 1);
  }

  private drawDireWasp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const chitin = flash || '#241f2c';
    const lit = flash || '#463d54';
    const stripe = flash || '#e8b52c';
    const memb = flash || '#9aa1c2';
    const vein = flash || '#4c5273';
    // Drawn from above with the wings out flat. Nothing else in the
    // bestiary is dorsal, and that is exactly what keeps it off the
    // giant wasp, which shares its colours and its CR.
    r(memb, 0, 5, 11, 5);
    r(vein, 0, 5, 11, 1);
    r(vein, 3, 6, 1, 4);
    r(memb, 2, 10, 8, 3);
    r(memb, 17, 5, 11, 5);
    r(vein, 17, 5, 11, 1);
    r(vein, 24, 6, 1, 4);
    r(memb, 18, 10, 8, 3);
    // Legs braced out either side
    r(chitin, 5, 12, 5, 2);
    r(chitin, 4, 14, 2, 5);
    r(chitin, 18, 12, 5, 2);
    r(chitin, 22, 14, 2, 5);
    r(chitin, 6, 9, 4, 2);
    r(chitin, 18, 9, 4, 2);
    // Head, thorax, and the abdomen tapering to a sting
    r(chitin, 10, 1, 8, 6);
    r(lit, 10, 1, 8, 1);
    r(chitin, 9, 7, 10, 7);
    r(lit, 9, 7, 10, 1);
    r(chitin, 10, 14, 8, 8);
    r(stripe, 10, 15, 8, 2);
    r(stripe, 10, 19, 8, 2);
    r(chitin, 12, 22, 4, 3);
    r(chitin, 13, 25, 2, 3);
    // Compound eyes and the mandibles under them
    r(flash || '#d0342c', 10, 2, 3, 3);
    r(flash || '#d0342c', 15, 2, 3, 3);
    r(flash || '#f0705a', 10, 2, 3, 1);
    r(flash || '#f0705a', 15, 2, 3, 1);
    r(flash || '#e8dcc0', 11, 6, 1, 2);
    r(flash || '#e8dcc0', 16, 6, 1, 2);
  }

  private drawGazer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7d6a52';
    const lit = flash || '#a08a6c';
    const dark = flash || '#4c3f2e';
    // Four short stalks off the crown, each with its own eye. The
    // beholder gets six long jointed ones and twice the sphere; the
    // gazer is meant to read as the small mean copy of it.
    const stalk = (px: number[][], ex: number, ey: number) => {
      for (const p of px) r(hide, p[0], p[1], 2, 3);
      r(lit, ex, ey, 3, 3);
      r(flash || '#ffd83a', ex, ey, 3, 2);
      r(flash || '#20140a', ex + 1, ey, 1, 2);
    };
    stalk([[9, 8], [7, 5]], 4, 2);
    stalk([[11, 6], [11, 3]], 10, 0);
    stalk([[16, 6], [16, 3]], 15, 0);
    stalk([[18, 8], [20, 5]], 21, 2);
    // The little sphere
    r(hide, 5, 9, 18, 14);
    r(lit, 5, 9, 18, 2);
    r(dark, 5, 20, 18, 3);
    r(dark, 5, 9, 1, 14);
    // One eye taking up most of the front of it
    r(flash || '#f2ece0', 8, 11, 12, 8);
    r(flash || '#b8dcea', 9, 12, 10, 6);
    r(flash || '#150c14', 11, 13, 6, 5);
    r(flash || '#ffffff', 12, 14, 2, 2);
    // Needle teeth grinning under it
    r(dark, 8, 20, 12, 3);
    r(flash || '#efe6d2', 9, 20, 1, 3);
    r(flash || '#efe6d2', 12, 20, 1, 3);
    r(flash || '#efe6d2', 15, 20, 1, 3);
    r(flash || '#efe6d2', 18, 20, 1, 3);
  }

  private drawWyrmlingGreen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3f6b34', '#2b4d24', '#9ada58', '#ddd6b8', 'young');
  }

  private drawWyrmlingBlack(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3a3a42', '#24242c', '#7ee06a', '#c8c2b0', 'young');
  }

  private drawWyrmlingBlue(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#2f5fa8', '#22467c', '#7fd8ff', '#e4ecf4', 'young');
  }

  private drawWyrmlingEmerald(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#1f7a55', '#14563b', '#6ff0b0', '#d8f0e0', 'young');
  }

  private drawWyrmlingSapphire(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#2a4fa8', '#1c3777', '#86b6ff', '#dfe8ff', 'young');
  }

  private drawWyrmlingTopaz(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#c89a2e', '#9a731c', '#ffe27a', '#f6e8bc', 'young');
  }

  private drawYoungBrassDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#b78a3c', '#8b6626', '#ffcc55', '#f0e2b4', 'young');
  }

  private drawYoungBronzeDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#9a6b34', '#74501f', '#ffd88a', '#ecdcb0', 'young');
  }

  private drawYoungSilverDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#b8c2cc', '#8e98a6', '#dff4ff', '#f2f7ff', 'young');
  }

  private drawYoungGoldDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#c8a032', '#9c7a1c', '#ffe066', '#fff0b8', 'young');
  }

  private drawAdultCrystalDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#cfd8e8', '#a8b2c8', '#ecf4ff', '#f4f8ff', 'adult');
  }

  private drawAdultBrassDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#b78a3c', '#8b6626', '#ffcc55', '#f0e2b4', 'adult');
  }

  private drawAdultCopperDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#a1552c', '#7a3d1c', '#ffb060', '#efdcb8', 'adult');
  }

  private drawArcanaloth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // vulture-faced sage of secrets peddled in souls
    ctx.fillStyle = flash || '#8a6a4a'; // stooped robed frame
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.4);
    ctx.fillStyle = '#a87e58'; // burnished scale-robe sheen
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.05);
    ctx.fillStyle = '#5a442e'; // coiled hood
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.4, s * 0.2);
    ctx.fillStyle = '#6a5436'; // vulture-gray face
    ctx.fillRect(s * 0.34, s * 0.22, s * 0.32, s * 0.14);
    ctx.fillStyle = '#c05040'; // sharp predatory red eyes
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e0d0b0'; // hooked vulture beak
    ctx.fillRect(s * 0.46, s * 0.34, s * 0.08, s * 0.06);
    ctx.fillStyle = '#4a3a28'; // arcane quill in claw
    ctx.fillRect(s * 0.7, s * 0.46, s * 0.04, s * 0.14);
    ctx.fillStyle = '#c09a40'; // gilded contract feather
    ctx.fillRect(s * 0.7, s * 0.36, s * 0.04, s * 0.12);
  }

  private drawUltroloth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // tall hypnotic yugoloth commander
    ctx.fillStyle = flash || '#5d425d'; // fitted iron robe
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.4);
    ctx.fillStyle = '#7a547a'; // severe collar piping
    ctx.fillRect(s * 0.32, s * 0.38, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.04);
    ctx.fillStyle = '#3a2c3a'; // stern featureless head
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.2);
    ctx.fillStyle = '#c04040'; // hypnotic burning-red eyes
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.24, s * 0.05, s * 0.06);
    ctx.fillStyle = '#2a1e2a'; // thin cruel smile
    ctx.fillRect(s * 0.44, s * 0.32, s * 0.12, s * 0.02);
    ctx.fillStyle = '#4a344a'; // grasping shadow claw
    ctx.fillRect(s * 0.7, s * 0.46, s * 0.08, s * 0.12);
    ctx.fillStyle = '#241824'; // trailing ambition cape
    ctx.fillRect(s * 0.28, s * 0.62, s * 0.44, s * 0.1);
  }

  private drawOrcWarchief(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // howling warband-leader with a great totem banner
    ctx.fillStyle = flash || '#6a5240'; // muscular hide torso
    ctx.fillRect(s * 0.28, s * 0.36, s * 0.44, s * 0.32);
    ctx.fillStyle = '#4a3828'; // gash of hide scarring
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.52, s * 0.12, s * 0.04);
    ctx.fillStyle = '#7a5c44'; // snarling broad head
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.4, s * 0.24);
    ctx.fillStyle = '#b8b898'; // huge lower tusks
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.36, s * 0.05, s * 0.06);
    ctx.fillStyle = '#c03020'; // blood-tilted rage eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillStyle = '#4a3828'; // ragged great hide-shoulder
    ctx.fillRect(s * 0.22, s * 0.3, s * 0.08, s * 0.2);
    ctx.fillStyle = '#7a4a24'; // totem-standard haft
    ctx.fillRect(s * 0.78, s * 0.12, s * 0.05, s * 0.56);
    ctx.fillStyle = '#c8b458'; // gilded severed-head totem
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.14, s * 0.1);
  }

  private drawAlphaWolf(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // silver-maned prime of the bitter packs
    ctx.fillStyle = flash || '#8a8a96'; // pale gray leading body
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.44, s * 0.22);
    ctx.fillStyle = '#6a6a78'; // saddle shade
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.4, s * 0.06);
    ctx.fillStyle = '#a8a8b8'; // proud silver hackles
    ctx.fillRect(s * 0.18, s * 0.34, s * 0.26, s * 0.08);
    ctx.fillStyle = '#8a8a96'; // long bold head down
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.24, s * 0.18);
    ctx.fillStyle = '#5a5a6a'; // alert forward ears
    ctx.fillRect(s * 0.6, s * 0.24, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.06, s * 0.08);
    ctx.fillStyle = '#f0e8c0'; // pale commanding eyes
    ctx.fillRect(s * 0.66, s * 0.32, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.32, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e8e8e8'; // long canine fangs
    ctx.fillRect(s * 0.68, s * 0.4, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.76, s * 0.4, s * 0.03, s * 0.05);
    ctx.fillStyle = '#6a6a78'; // driving legs
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.46, s * 0.62, s * 0.08, s * 0.14);
  }

  private drawGiantBoaConstrictor(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // yard-thick serpent muscling in a great loop
    ctx.fillStyle = flash || '#6a542e'; // thick section coils
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.28, s * 0.26);
    ctx.fillRect(s * 0.4, s * 0.48, s * 0.24, s * 0.18);
    ctx.fillRect(s * 0.6, s * 0.34, s * 0.22, s * 0.26);
    ctx.fillStyle = '#4a3a1e'; // saddle blotches
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.5, s * 0.52, s * 0.08, s * 0.1);
    ctx.fillStyle = '#8a7048'; // blunt heavy arrow head
    ctx.fillRect(s * 0.8, s * 0.28, s * 0.16, s * 0.16);
    ctx.fillStyle = '#4a3a1e'; // head stripe
    ctx.fillRect(s * 0.84, s * 0.32, s * 0.08, s * 0.03);
    ctx.fillStyle = '#1a1208'; // placement cold eyes
    ctx.fillRect(s * 0.84, s * 0.3, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.9, s * 0.3, s * 0.03, s * 0.03);
    ctx.fillStyle = '#c03030'; // flicking forked tongue
    ctx.fillRect(s * 0.94, s * 0.34, s * 0.04, s * 0.02);
  }

  /**
   * The raptor's line is horizontal — spine level, head thrust out low, stiff
   * tail held straight back as a counterweight — which is the opposite of the
   * allosaurus's head-up column and is what keeps the two dinosaurs apart at
   * this size. The raised sickle claw is the second read.
   */
  private drawVelociraptor(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7c5a34';
    const lit = flash || '#a8814e';
    const dark = flash || '#48331c';
    const plume = flash || '#a8412a';
    const claw = flash || '#e8dfc6';
    // Stiff tail, tapering away behind
    r(hide, 0, 13, 6, 2);
    r(hide, 4, 12, 6, 3);
    r(lit, 4, 12, 6, 1);
    // Level body
    r(hide, 9, 10, 9, 7);
    r(lit, 9, 10, 9, 1);
    r(dark, 9, 15, 9, 2);
    r(dark, 12, 11, 1, 5); // feather bars
    r(dark, 15, 11, 1, 5);
    // Neck lifting to a low, forward head
    r(hide, 16, 7, 5, 5);
    r(hide, 19, 5, 6, 4);
    r(lit, 19, 5, 6, 1);
    r(hide, 24, 6, 4, 3); // narrow snout
    r(dark, 20, 8, 8, 1); // jawline
    r(claw, 24, 8, 1, 1);
    r(claw, 26, 8, 1, 1);
    r('#e8d84a', 21, 6, 3, 2);
    r('#1c1408', 22, 6, 1, 2);
    // Rust quill crest and arm feathers
    r(plume, 17, 4, 4, 2);
    r(plume, 10, 8, 7, 2);
    // Far leg, kept dark so it sits behind
    r(dark, 8, 16, 5, 5);
    r(dark, 9, 20, 2, 5);
    r(dark, 7, 25, 5, 2);
    // Near leg: heavy drumstick, thin shin, foot with the sickle up
    r(hide, 12, 15, 6, 7);
    r(lit, 12, 15, 6, 1);
    r(dark, 14, 21, 3, 4);
    r(dark, 12, 25, 7, 2);
    r(claw, 12, 26, 1, 1);
    r(claw, 15, 26, 1, 1);
    r(claw, 18, 21, 2, 3);
    r(claw, 19, 20, 2, 2);
    // Clawed forelimb tucked under the chest
    r(hide, 17, 12, 4, 2);
    r(dark, 20, 13, 3, 2);
  }

  private drawPteranodon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#8a8291';
    const lit = flash || '#aca4b3';
    const dark = flash || '#514a59';
    const memb = flash || '#6f6675';
    const crest = flash || '#c98a3a';
    // Membrane wings on a long finger bone, not feathers — that and the
    // backswept crest are what keep it off the eagles and the roc.
    r(memb, 0, 7, 11, 5);
    r(dark, 0, 6, 11, 1);
    r(memb, 2, 12, 8, 3);
    r(dark, 4, 7, 1, 7);
    r(memb, 17, 7, 11, 5);
    r(dark, 17, 6, 11, 1);
    r(memb, 18, 12, 8, 3);
    r(dark, 23, 7, 1, 7);
    // Body, and the legs trailing behind it
    r(hide, 11, 6, 6, 11);
    r(lit, 11, 6, 6, 1);
    r(dark, 11, 15, 6, 2);
    r(hide, 12, 17, 2, 6);
    r(hide, 15, 17, 2, 6);
    r(dark, 12, 22, 2, 2);
    r(dark, 15, 22, 2, 2);
    // Skull, long toothless beak, and the crest sweeping back off it
    r(hide, 12, 3, 5, 4);
    r(hide, 9, 0, 8, 4);
    r(lit, 9, 0, 8, 1);
    r(crest, 16, 0, 9, 3);
    r(flash || '#e8ab55', 16, 0, 9, 1);
    r(crest, 21, 2, 4, 2);
    r(flash || '#d8cdb0', 2, 1, 8, 3);
    r(flash || '#b3a888', 2, 3, 8, 1);
    r(flash || '#f0f0f4', 11, 1, 2, 2);
    r(flash || '#161016', 11, 1, 1, 2);
  }

  private drawSpinedDevil(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // tiny impish devil bristling with flickering spine-quills
    ctx.fillStyle = flash || '#8a5a3a'; // scaly little body
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.32, s * 0.26);
    ctx.fillStyle = '#6a4028'; // leathery folded wings
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.16, s * 0.16);
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.16, s * 0.16);
    ctx.fillStyle = '#5a3a28'; // tired little horns
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.06, s * 0.1);
    ctx.fillStyle = '#8a5a3a'; // compact head
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.2, s * 0.14);
    ctx.fillStyle = '#c85830'; // glittering sneering eyes
    ctx.fillRect(s * 0.44, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillStyle = '#d8d8d8'; // raised cold-iron spine-quills
    ctx.fillRect(s * 0.42, s * 0.6, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.6, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.58, s * 0.6, s * 0.03, s * 0.08);
    ctx.fillStyle = '#c8d8e8'; // trailing tail quills
    ctx.fillRect(s * 0.66, s * 0.5, s * 0.08, s * 0.03);
  }

  private drawYuanTiPitMaster(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // coiled serpent-tongued overlord of the scaly kindred
    ctx.fillStyle = flash || '#6a5a2e'; // commanding scale-torso
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.28);
    ctx.fillStyle = '#4a3e1e'; // scaled mail bands
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.04);
    ctx.fillStyle = '#6a5a2e'; // high serpent head
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.2);
    ctx.fillStyle = '#8a783e'; // hypnotic hooded hood-fan
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.06);
    ctx.fillStyle = '#c0b048'; // serpent-lined slit eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.22, s * 0.06, s * 0.04);
    ctx.fillStyle = '#c03030'; // forked tongue whispering
    ctx.fillRect(s * 0.44, s * 0.38, s * 0.12, s * 0.02);
    ctx.fillRect(s * 0.5, s * 0.4, s * 0.06, s * 0.02);
    ctx.fillStyle = '#3a3018'; // coiled serpent tail
    ctx.fillRect(s * 0.34, s * 0.62, s * 0.32, s * 0.1);
    ctx.fillStyle = '#8a783e'; // venerated ritual staff
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.04, s * 0.4);
    ctx.fillStyle = '#c8b868'; // serpent-emblemed staff head
    ctx.fillRect(s * 0.68, s * 0.1, s * 0.1, s * 0.08);
  }

  private drawShadarKai(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // shadow-mantled envoy flickering with moonlight eyes
    ctx.fillStyle = flash || '#2a2e38'; // lank shadow-mantle coat
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.36);
    ctx.fillStyle = '#3d4350'; // feather-cut armor trim
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.36, s * 0.04);
    ctx.fillStyle = '#3a2c2c'; // pale pale-pale face
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillStyle = '#d8d8e8'; // moonlight-bright eyes
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillStyle = '#4a5568'; // dark raven-fast hair
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.2, s * 0.1);
    ctx.fillStyle = '#353b48'; // razor serrated blade
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.04, s * 0.4);
    ctx.fillStyle = '#0e1218'; // shadow-trailing blade edge
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.06, s * 0.08);
    ctx.fillStyle = '#232a34'; // brief shadow flicker
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.08, s * 0.12);
  }


  private drawGargoyleLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawGargoyle(ctx, s, flash, true);
  }

  private drawDeinonychus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // pack-hunting sickle-claw raptor tearing through scrub
    ctx.fillStyle = flash || '#7a4a30'; // lean feathered bound body
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.44, s * 0.24);
    ctx.fillStyle = '#5a341e'; // streaked feather flanks
    ctx.fillRect(s * 0.24, s * 0.44, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.4, s * 0.44, s * 0.06, s * 0.16);
    ctx.fillStyle = '#5d3a24'; // keeled forward head
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.26, s * 0.2);
    ctx.fillStyle = '#d8d860'; // fierce watchful eye
    ctx.fillRect(s * 0.68, s * 0.34, s * 0.04, s * 0.04);
    ctx.fillStyle = '#3a2412'; // narrow stabbing snout
    ctx.fillRect(s * 0.72, s * 0.42, s * 0.12, s * 0.04);
    ctx.fillStyle = '#241808'; // great double sickle claw
    ctx.fillRect(s * 0.48, s * 0.62, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.52, s * 0.68, s * 0.05, s * 0.12);
    ctx.fillStyle = '#3a2412'; // long sprinting legs
    ctx.fillRect(s * 0.3, s * 0.64, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.46, s * 0.64, s * 0.05, s * 0.14);
  }

  private drawDimetrodon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7a6136';
    const lit = flash || '#9e8250';
    const dark = flash || '#4d3c1e';
    const sail = flash || '#b8532a';
    const sailLit = flash || '#dd7a45';
    const spine = flash || '#e0d3ae';
    // The sail: a half-disc of skin stretched on bone spines, which is
    // the entire animal as far as anyone is concerned
    r(sail, 4, 3, 17, 12);
    r(sailLit, 4, 3, 17, 1);
    r(flash || '#8c3a18', 4, 12, 17, 2);
    r(spine, 6, 2, 1, 13);
    r(spine, 9, 1, 1, 14);
    r(spine, 12, 1, 1, 14);
    r(spine, 15, 1, 1, 14);
    r(spine, 18, 2, 1, 13);
    // Body slung low under it, tail out behind
    r(hide, 2, 14, 21, 6);
    r(lit, 2, 14, 21, 1);
    r(dark, 2, 19, 21, 1);
    r(hide, 0, 16, 4, 3);
    // Sprawled legs
    r(dark, 3, 20, 4, 4);
    r(hide, 1, 23, 6, 2);
    r(dark, 15, 20, 4, 4);
    r(hide, 14, 23, 6, 2);
    // Long crocodilian head
    r(hide, 21, 13, 7, 6);
    r(lit, 21, 13, 7, 1);
    r(flash || '#2c1c08', 22, 17, 6, 2);
    r(flash || '#f0e8d0', 23, 18, 1, 1);
    r(flash || '#f0e8d0', 26, 18, 1, 1);
    r(flash || '#e0c040', 23, 14, 2, 2);
    r(flash || '#140c02', 24, 14, 1, 2);
  }

  /**
   * The plesiosaur is the neck: an S rising out of a barrel body to a small
   * head held high, four paddles below. The old one lay flat and read as a
   * fish with a lump on it.
   */
  private drawPlesiosaurus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#5b7d8c';
    const lit = flash || '#7fa0ac';
    const dark = flash || '#3c5460';
    const belly = flash || '#aabfc6';
    // Tail
    r(hide, 2, 17, 4, 3);
    r(hide, 1, 16, 2, 2);
    // Body, an oval hull with a pale keel
    r(hide, 5, 15, 15, 8);
    r(hide, 4, 17, 17, 4);
    r(lit, 6, 15, 13, 1);
    r(dark, 5, 16, 1, 6);
    r(belly, 6, 21, 13, 2);
    // Paddles, the near pair angled down and away
    r(hide, 6, 22, 4, 2);
    r(hide, 3, 24, 5, 2);
    r(dark, 3, 25, 5, 1);
    r(hide, 15, 22, 4, 2);
    r(hide, 17, 24, 5, 2);
    r(dark, 17, 25, 5, 1);
    // Neck rising in an S
    r(hide, 17, 12, 4, 4);
    r(hide, 19, 8, 4, 4);
    r(hide, 20, 4, 3, 4);
    r(dark, 17, 12, 1, 4);
    r(dark, 19, 8, 1, 4);
    r(dark, 20, 4, 1, 4);
    r(lit, 20, 12, 1, 3);
    r(lit, 22, 8, 1, 4);
    // Small head, jaw line, a dark eye
    r(hide, 20, 1, 7, 4);
    r(lit, 20, 1, 7, 1);
    r(dark, 23, 4, 4, 1);
    r(flash || '#e8e4d8', 24, 4, 1, 1);
    r(flash || '#e8e4d8', 26, 4, 1, 1);
    r(flash || '#101c20', 22, 2, 2, 2);
    r(flash || '#e0e8e0', 22, 2, 1, 1);
  }


  private drawQuetzalcoatlus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // largest creature ever to fly, a stork-god of bone
    ctx.fillStyle = flash || '#cfc8b8'; // stilt-thin body
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.2, s * 0.18);
    ctx.fillStyle = '#a8a294'; // keel and breast
    ctx.fillRect(s * 0.4, s * 0.4, s * 0.2, s * 0.08);
    ctx.fillStyle = '#d8d2c4'; // colossal flying membrane wings
    ctx.fillRect(s * 0.04, s * 0.26, s * 0.32, s * 0.16);
    ctx.fillRect(s * 0.64, s * 0.26, s * 0.32, s * 0.16);
    ctx.fillStyle = '#e8e4d8'; // wing bone sheen
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.78, s * 0.3, s * 0.08, s * 0.04);
    ctx.fillStyle = '#c8c0ae'; // stilt-beaked head
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.22, s * 0.1);
    ctx.fillStyle = '#c05030'; // long pointed beak
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.14, s * 0.05);
    ctx.fillStyle = '#746f62'; // huge talon stance
    ctx.fillRect(s * 0.46, s * 0.48, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.58, s * 0.48, s * 0.04, s * 0.12);
  }

  private drawStegosaurus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // plated fortress of ancient herbivore-poise
    ctx.fillStyle = flash || '#6a6a56'; // low broad herbivore body
    ctx.fillRect(s * 0.18, s * 0.38, s * 0.56, s * 0.26);
    ctx.fillStyle = '#4f4f3f'; // coarse hide fold
    ctx.fillRect(s * 0.22, s * 0.44, s * 0.48, s * 0.05);
    ctx.fillStyle = '#c08a40'; // great enamel back-plates
    ctx.beginPath();
    ctx.moveTo(s * 0.28, s * 0.38);
    ctx.lineTo(s * 0.34, s * 0.18);
    ctx.lineTo(s * 0.4, s * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.46, s * 0.38);
    ctx.lineTo(s * 0.52, s * 0.16);
    ctx.lineTo(s * 0.58, s * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c88a48'; // smaller neck plates
    ctx.beginPath();
    ctx.moveTo(s * 0.64, s * 0.36);
    ctx.lineTo(s * 0.68, s * 0.24);
    ctx.lineTo(s * 0.74, s * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d8c8a8'; // skewering thagomizer spikes
    ctx.fillRect(s * 0.72, s * 0.5, s * 0.03, s * 0.16);
    ctx.fillRect(s * 0.78, s * 0.5, s * 0.03, s * 0.16);
    ctx.fillStyle = '#4f4f3f'; // patient head down
    ctx.fillRect(s * 0.74, s * 0.5, s * 0.14, s * 0.1);
  }

  private drawDeepDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#3a3050', '#251e36', '#c060ff', '#d6cadd', 'adult');
  }

  private drawClockworkDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // whistling brass-and-gears mechanical dragon
    ctx.fillStyle = flash || '#b08a30'; // brass plate body
    ctx.fillRect(s * 0.22, s * 0.32, s * 0.46, s * 0.32);
    ctx.fillStyle = '#8a6a20'; // gear-riveted belly
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.38, s * 0.05);
    ctx.fillRect(s * 0.26, s * 0.54, s * 0.38, s * 0.05);
    ctx.fillStyle = '#8a6a20'; // rivet dots
    ctx.fillRect(s * 0.28, s * 0.36, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.5, s * 0.36, s * 0.03, s * 0.03);
    ctx.fillStyle = '#c89a3a'; // hinged mechanical neck
    ctx.fillRect(s * 0.62, s * 0.18, s * 0.22, s * 0.16);
    ctx.fillStyle = '#c8a23a'; // piston-jaw head
    ctx.fillRect(s * 0.78, s * 0.12, s * 0.2, s * 0.16);
    ctx.fillStyle = '#f0d060'; // ticking clockwork eyes
    ctx.fillRect(s * 0.84, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#6a5220'; // brass exhaust vents
    ctx.fillRect(s * 0.9, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillStyle = '#f0f0a0'; // screaming arcane exhaust
    ctx.fillRect(s * 0.92, s * 0.04, s * 0.04, s * 0.08);
    ctx.fillStyle = '#8a6a20'; // crank-gear wings
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.3, s * 0.1, s * 0.12);
  }

  private drawGhostDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // translucent malice of a once-scaled tyrant
    ctx.fillStyle = flash || '#b8c4cc'; // pale spectral coils
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.46, s * 0.32);
    ctx.fillStyle = '#9aadb8'; // fading plate seams
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.38, s * 0.05);
    ctx.fillRect(s * 0.26, s * 0.56, s * 0.38, s * 0.05);
    ctx.fillStyle = '#a8b8c4'; // ethereal long neck
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.22, s * 0.18);
    ctx.fillStyle = '#c8d4dc'; // ghostly crowned head
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.24, s * 0.2);
    ctx.fillStyle = '#7a90a0'; // spectral horn ridges
    ctx.fillRect(s * 0.72, s * 0.06, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.86, s * 0.06, s * 0.05, s * 0.08);
    ctx.fillStyle = '#d02030'; // burning undead eyes
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillStyle = '#dce6ee'; // cold un-life breath mist
    ctx.fillRect(s * 0.9, s * 0.04, s * 0.06, s * 0.1);
  }

  /**
   * Baphomet is the minotaur with the horns that keep going: a crown of
   * tines off both temples, a beard down the chest, and the glaive upright
   * at his right.
   */
  private drawBaphomet(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#5e4a66';
    const lit = flash || '#7f6a88';
    const dark = flash || '#36283c';
    const horn = flash || '#e2d4b0';
    const hornDark = flash || '#a8987a';
    // The glaive
    r(flash || '#3a2a1c', 26, 6, 2, 20);
    r(flash || '#5a4630', 26, 6, 1, 20);
    r(flash || '#b8bcc8', 25, 0, 3, 7);
    r(flash || '#e6e8ee', 25, 0, 1, 7);
    // Hooved legs
    r(hide, 8, 19, 5, 4);
    r(hide, 7, 22, 5, 3);
    r(flash || '#1c1420', 6, 25, 6, 2);
    r(hide, 16, 19, 5, 4);
    r(hide, 17, 22, 5, 3);
    r(flash || '#1c1420', 17, 25, 6, 2);
    // Torso
    r(hide, 6, 9, 17, 11);
    r(lit, 6, 9, 17, 1);
    r(dark, 6, 18, 17, 2);
    r(lit, 8, 11, 3, 6);
    r(dark, 12, 12, 5, 1);
    r(dark, 12, 15, 5, 1);
    r(flash || '#c8a04a', 12, 13, 5, 2);
    // Arms
    r(hide, 2, 10, 4, 6);
    r(dark, 2, 15, 4, 3);
    r(hide, 23, 10, 3, 5);
    r(dark, 23, 15, 4, 3);
    // Bull head sunk into the shoulders, beard down the chest
    r(hide, 9, 2, 11, 8);
    r(lit, 9, 2, 11, 1);
    r(dark, 9, 2, 1, 8);
    r(flash || '#4a3a50', 10, 7, 9, 3);
    r(flash || '#ffd23a', 11, 8, 1, 1);
    r(flash || '#ffd23a', 17, 8, 1, 1);
    r(flash || '#ff3a1a', 11, 4, 2, 2);
    r(flash || '#ff3a1a', 16, 4, 2, 2);
    r(flash || '#3a1a10', 11, 10, 7, 3);
    // The antler crown
    r(horn, 6, 3, 3, 3);
    r(horn, 4, 1, 3, 3);
    r(horn, 2, 0, 3, 2);
    r(hornDark, 5, 5, 1, 2);
    r(horn, 7, 0, 2, 2);
    r(horn, 19, 3, 3, 3);
    r(horn, 21, 1, 3, 3);
    r(horn, 22, 0, 2, 1);
    r(hornDark, 22, 5, 1, 2);
    r(horn, 19, 0, 2, 2);
  }

  /**
   * Juiblex is a tide, not a blob: it fills the floor edge to edge, heaves
   * up in pseudopods of different heights, and has eyes and toothed mouths
   * opening all over it.
   */
  private drawJuiblex(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const slime = flash || '#2e4a22';
    const lit = flash || '#4f7a3a';
    const dark = flash || '#16260f';
    const eye = flash || '#ff3a2a';
    const teeth = flash || '#e6e0c8';
    r(slime, 0, 16, 28, 9);
    r(lit, 0, 16, 28, 1);
    r(dark, 0, 23, 28, 2);
    // Pseudopods
    r(slime, 2, 9, 6, 8);
    r(lit, 2, 9, 6, 1);
    r(slime, 3, 5, 4, 5);
    r(lit, 3, 5, 4, 1);
    r(slime, 10, 3, 9, 14);
    r(lit, 10, 3, 9, 1);
    r(lit, 10, 4, 1, 12);
    r(slime, 13, 0, 4, 4);
    r(lit, 13, 0, 4, 1);
    r(slime, 20, 8, 7, 9);
    r(lit, 20, 8, 7, 1);
    r(slime, 23, 4, 3, 5);
    r(lit, 23, 4, 3, 1);
    // Eyes
    const e = (x: number, y: number) => {
      r(dark, x, y, 3, 2);
      r(eye, x + 1, y, 1, 2);
    };
    e(4, 11);
    e(12, 6);
    e(15, 9);
    e(11, 12);
    e(22, 10);
    e(3, 18);
    e(8, 17);
    e(19, 19);
    e(24, 18);
    e(14, 1);
    // Mouths
    r(dark, 12, 14, 6, 3);
    r(teeth, 13, 14, 1, 1);
    r(teeth, 15, 14, 1, 1);
    r(teeth, 17, 14, 1, 1);
    r(teeth, 14, 16, 1, 1);
    r(teeth, 16, 16, 1, 1);
    r(dark, 20, 13, 5, 2);
    r(teeth, 21, 13, 1, 1);
    r(teeth, 23, 13, 1, 1);
    r(dark, 4, 20, 8, 2);
    r(teeth, 5, 20, 1, 1);
    r(teeth, 7, 20, 1, 1);
    r(teeth, 9, 20, 1, 1);
    r(teeth, 6, 21, 1, 1);
    r(teeth, 8, 21, 1, 1);
    // Runoff
    r(dark, 6, 25, 5, 2);
    r(dark, 17, 25, 6, 2);
  }

  /**
   * Zuggtmoy wears a toadstool for a crown — a cap as wide as the box with
   * gills under it and spots on top — over a pale face and a gown of
   * mycelium with little mushrooms sprouting from the hem.
   */
  private drawZuggtmoy(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const cap = flash || '#9a3458';
    const capLit = flash || '#c85a80';
    const capDark = flash || '#5e1c34';
    const flesh = flash || '#d8b8c4';
    const gown = flash || '#6a2a44';
    const gownLit = flash || '#8e4060';
    const gownDark = flash || '#3e1428';
    const spore = flash || '#e8c8ea';
    // The gown
    r(gown, 6, 15, 16, 11);
    r(gown, 3, 21, 22, 5);
    r(gownLit, 6, 15, 1, 11);
    r(gownDark, 3, 24, 22, 2);
    r(gownDark, 12, 16, 1, 9);
    r(gownDark, 17, 18, 1, 7);
    const shroom = (x: number, y: number) => {
      r(cap, x, y, 3, 2);
      r(capLit, x, y, 3, 1);
      r(flesh, x + 1, y + 2, 1, 2);
    };
    shroom(3, 18);
    shroom(22, 19);
    shroom(1, 22);
    shroom(24, 22);
    shroom(8, 22);
    shroom(17, 23);
    // Arms held out in welcome
    r(flesh, 2, 13, 5, 2);
    r(flesh, 1, 14, 2, 4);
    r(flesh, 21, 13, 5, 2);
    r(flesh, 25, 14, 2, 4);
    // Face
    r(flesh, 10, 9, 8, 7);
    r(flash || '#f0dbe4', 10, 9, 8, 1);
    r(flash || '#b899a8', 10, 9, 1, 7);
    r(flash || '#1c0a14', 11, 11, 2, 2);
    r(flash || '#1c0a14', 15, 11, 2, 2);
    r(flash || '#7a3050', 13, 14, 2, 1);
    // The cap
    r(cap, 2, 3, 24, 5);
    r(cap, 5, 1, 18, 3);
    r(cap, 9, 0, 10, 2);
    r(capLit, 5, 1, 18, 1);
    r(capLit, 9, 0, 10, 1);
    r(capDark, 2, 7, 24, 1);
    r(flash || '#e9c9d6', 3, 8, 22, 1);
    r(spore, 6, 3, 2, 2);
    r(spore, 12, 2, 3, 2);
    r(spore, 19, 3, 2, 2);
    r(spore, 23, 5, 2, 1);
    r(spore, 4, 11, 1, 1);
    r(spore, 23, 11, 1, 1);
  }

  /**
   * Graz'zt is the handsome one: ebon skin, silver hair, small curled horns,
   * a long coat cut close, one six-fingered hand open toward you and the
   * other on a greatsword longer than he is tall.
   */
  private drawGrazzt(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#3a444c';
    const skinLit = flash || '#5a6670';
    const coat = flash || '#1d2226';
    const coatLit = flash || '#343c42';
    const trim = flash || '#b03a7a';
    const horn = flash || '#0e1012';
    const steel = flash || '#c9d4e8';
    // The greatsword, point down at his side
    r(steel, 23, 2, 2, 20);
    r(flash || '#f2f7ff', 23, 2, 1, 20);
    r(flash || '#8a2e60', 21, 10, 6, 1);
    r(flash || '#3a1028', 23, 11, 2, 3);
    // Coat
    r(coat, 8, 10, 12, 15);
    r(coatLit, 8, 10, 12, 1);
    r(coatLit, 8, 11, 1, 13);
    r(trim, 13, 11, 2, 12);
    r(coat, 6, 22, 3, 4);
    r(coat, 19, 22, 3, 4);
    r(horn, 10, 24, 3, 3);
    r(horn, 15, 24, 3, 3);
    // Hands
    r(skin, 5, 11, 3, 6);
    r(skinLit, 5, 11, 1, 6);
    r(skin, 3, 16, 5, 2);
    r(skin, 2, 15, 1, 1);
    r(skin, 3, 14, 1, 1);
    r(skin, 5, 13, 1, 1);
    r(skin, 20, 11, 3, 6);
    r(skin, 21, 17, 4, 2);
    // Face, collar, hair, horns
    r(trim, 9, 8, 10, 2);
    r(skin, 10, 2, 8, 7);
    r(skinLit, 10, 2, 8, 1);
    r(flash || '#e8e8f0', 9, 1, 10, 2);
    r(flash || '#e8e8f0', 9, 3, 1, 4);
    r(flash || '#c8d8ff', 11, 4, 2, 2);
    r(flash || '#c8d8ff', 15, 4, 2, 2);
    r(flash || '#0a0c10', 12, 4, 1, 2);
    r(flash || '#0a0c10', 16, 4, 1, 2);
    r(trim, 12, 7, 4, 1);
    r(horn, 8, 0, 2, 3);
    r(horn, 18, 0, 2, 3);
    r(horn, 7, 2, 1, 2);
    r(horn, 20, 2, 1, 2);
  }

  /**
   * Fraz-Urb'luu: a hood of bat wings wrapped high around the shoulders,
   * the long bearded grinning face with the ears that give him away, a
   * crown of mirror shards, and one shard held out that shows you something
   * else.
   */
  private drawFrazUrbluu(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#6a4a86';
    const skinLit = flash || '#8e6cae';
    const dark = flash || '#3c2650';
    const wing = flash || '#4a2e60';
    const wingLine = flash || '#2a1638';
    const mirror = flash || '#b9e6f2';
    // Wings
    r(wing, 0, 2, 10, 8);
    r(wing, 1, 10, 7, 6);
    r(wing, 2, 16, 4, 5);
    r(wingLine, 0, 2, 10, 1);
    r(wingLine, 3, 3, 1, 14);
    r(wingLine, 6, 3, 1, 10);
    r(wing, 18, 2, 10, 8);
    r(wing, 20, 10, 7, 6);
    r(wing, 22, 16, 4, 5);
    r(wingLine, 18, 2, 10, 1);
    r(wingLine, 24, 3, 1, 14);
    r(wingLine, 21, 3, 1, 10);
    // Body in a mantle
    r(dark, 9, 11, 10, 12);
    r(skin, 9, 11, 10, 1);
    r(dark, 8, 23, 4, 4);
    r(dark, 16, 23, 4, 4);
    r(skin, 10, 12, 8, 3);
    // Face and ears
    r(skin, 10, 3, 8, 8);
    r(skinLit, 10, 3, 8, 1);
    r(dark, 10, 3, 1, 8);
    r(skin, 7, 3, 3, 5);
    r(skin, 18, 3, 3, 5);
    r(dark, 7, 7, 3, 1);
    r(dark, 18, 7, 3, 1);
    r(flash || '#ff4a7a', 11, 5, 2, 2);
    r(flash || '#ff4a7a', 15, 5, 2, 2);
    r(flash || '#2a0a14', 12, 5, 1, 2);
    r(flash || '#2a0a14', 16, 5, 1, 2);
    r(dark, 12, 8, 4, 1);
    r(flash || '#e8e0d0', 12, 8, 1, 1);
    r(flash || '#e8e0d0', 15, 8, 1, 1);
    r(dark, 11, 9, 6, 3);
    r(dark, 13, 12, 2, 2);
    // Mirror crown, and the shard held out
    r(mirror, 10, 1, 2, 2);
    r(mirror, 13, 0, 2, 3);
    r(mirror, 16, 1, 2, 2);
    r(flash || '#e8f8ff', 13, 0, 1, 1);
    r(skin, 5, 14, 4, 2);
    r(skin, 3, 12, 3, 4);
    r(mirror, 1, 9, 4, 5);
    r(flash || '#e8f8ff', 1, 9, 1, 5);
    r(flash || '#7ab8cc', 3, 12, 2, 2);
  }

  /**
   * Malcanthet: feathered wings opened wide and low, a gown pooled at the
   * floor, black hair past the shoulders, small horns, and a halo held
   * above the head.
   */
  private drawMalcanthet(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const wing = flash || '#4a2a5a';
    const wingLit = flash || '#6e4484';
    const wingDark = flash || '#2c1638';
    const gown = flash || '#7a2c6a';
    const gownLit = flash || '#a44890';
    const gownDark = flash || '#4a1840';
    const skin = flash || '#e8cfe0';
    const hair = flash || '#1a0e1e';
    const halo = flash || '#ffcf5a';
    const wingSide = (x0: number, dir: 1 | -1) => {
      const px = (x: number, w: number) => (dir === 1 ? x0 + x : x0 - x - w + 1);
      r(wing, px(0, 9), 6, 9, 5);
      r(wing, px(1, 8), 11, 8, 4);
      r(wing, px(3, 6), 15, 6, 3);
      r(wing, px(5, 4), 18, 4, 3);
      r(wingLit, px(0, 9), 6, 9, 1);
      r(wingDark, px(2, 1), 7, 1, 9);
      r(wingDark, px(5, 1), 7, 1, 12);
    };
    wingSide(8, -1);
    wingSide(19, 1);
    // The gown
    r(gown, 9, 11, 10, 11);
    r(gown, 6, 20, 16, 6);
    r(gownLit, 9, 11, 10, 1);
    r(gownLit, 9, 12, 1, 12);
    r(gownDark, 6, 24, 16, 2);
    r(gownDark, 13, 13, 1, 10);
    // Arms, one hand raised
    r(skin, 6, 11, 3, 5);
    r(skin, 5, 8, 2, 4);
    r(skin, 19, 11, 3, 6);
    // Face and hair
    r(hair, 9, 2, 10, 10);
    r(skin, 10, 3, 8, 7);
    r(flash || '#f6e6f0', 10, 3, 8, 1);
    r(flash || '#c8a8c0', 10, 3, 1, 7);
    r(flash || '#ff5a9a', 11, 5, 2, 2);
    r(flash || '#ff5a9a', 15, 5, 2, 2);
    r(flash || '#2a0a1e', 12, 5, 1, 2);
    r(flash || '#2a0a1e', 16, 5, 1, 2);
    r(flash || '#c03060', 12, 8, 4, 1);
    r(hair, 8, 5, 2, 8);
    r(hair, 18, 5, 2, 8);
    r(flash || '#3a1a3e', 9, 1, 2, 2);
    r(flash || '#3a1a3e', 17, 1, 2, 2);
    // The halo
    r(halo, 10, 0, 8, 1);
    r(halo, 9, 1, 1, 1);
    r(halo, 18, 1, 1, 1);
  }

  /**
   * Kostchtchie: a mountain of a torso bare under a fur mantle, a frozen
   * beard, a crown of ice antlers, and a hammer with an anvil for a head
   * rimed with frost.
   */
  private drawKostchtchie(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#8e93a8';
    const lit = flash || '#b6bbcd';
    const dark = flash || '#575b6e';
    const fur = flash || '#e4e8f0';
    const furDark = flash || '#aeb4c4';
    const ice = flash || '#cfeeff';
    const iron = flash || '#4a4c58';
    // The hammer
    r(flash || '#3e2c1c', 23, 6, 2, 18);
    r(iron, 20, 0, 8, 7);
    r(flash || '#6c6e7c', 20, 0, 8, 1);
    r(flash || '#26272e', 20, 6, 8, 1);
    r(ice, 21, 1, 1, 4);
    r(ice, 26, 2, 1, 3);
    // Legs bound in furs
    r(fur, 7, 18, 5, 6);
    r(fur, 15, 18, 5, 6);
    r(furDark, 7, 21, 5, 1);
    r(furDark, 15, 21, 5, 1);
    r(dark, 6, 24, 6, 3);
    r(dark, 15, 24, 6, 3);
    // Torso and mantle
    r(skin, 6, 8, 16, 11);
    r(lit, 6, 8, 16, 1);
    r(dark, 6, 17, 16, 2);
    r(lit, 8, 10, 3, 5);
    r(dark, 13, 11, 4, 1);
    r(dark, 12, 14, 5, 1);
    r(fur, 4, 6, 6, 4);
    r(fur, 18, 6, 6, 4);
    r(furDark, 4, 9, 6, 1);
    r(furDark, 18, 9, 6, 1);
    // Fists like boulders
    r(skin, 2, 10, 4, 6);
    r(dark, 2, 15, 4, 3);
    r(skin, 22, 10, 4, 6);
    r(dark, 22, 15, 4, 3);
    // Head, frozen beard, ice crown
    r(skin, 10, 2, 8, 7);
    r(lit, 10, 2, 8, 1);
    r(dark, 10, 2, 1, 7);
    r(flash || '#ff5a2a', 11, 4, 2, 2);
    r(flash || '#ff5a2a', 15, 4, 2, 2);
    r(flash || '#3a1008', 12, 4, 1, 2);
    r(flash || '#3a1008', 16, 4, 1, 2);
    r(dark, 13, 6, 2, 1);
    r(fur, 10, 7, 8, 3);
    r(furDark, 10, 9, 8, 1);
    r(ice, 8, 0, 2, 3);
    r(ice, 7, 0, 1, 1);
    r(ice, 11, 0, 1, 2);
    r(ice, 18, 0, 2, 3);
    r(ice, 16, 0, 1, 2);
    r(ice, 9, 1, 10, 1);
  }

  /**
   * Yeenoghu: a starved, hulking gnoll on hyena legs, mane bristling down
   * the spine, jaws hanging open, and the triple flail raised behind him
   * with its three heads flung wide.
   */
  private drawYeenoghu(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#a6743c';
    const lit = flash || '#c9955a';
    const dark = flash || '#6a4422';
    const mane = flash || '#3e2410';
    const iron = flash || '#6c6f78';
    const spike = flash || '#a0a4ae';
    const chain = flash || '#4a4c55';
    // The flail: haft, three chains, three spiked heads
    r(flash || '#4a3520', 3, 9, 2, 8);
    r(chain, 2, 7, 1, 2);
    r(chain, 1, 6, 1, 1);
    r(chain, 4, 4, 1, 5);
    r(chain, 5, 7, 1, 2);
    r(chain, 6, 6, 1, 1);
    r(chain, 7, 5, 1, 1);
    const ball = (x: number, y: number) => {
      r(iron, x, y, 3, 3);
      r(spike, x + 1, y - 1, 1, 1);
      r(spike, x - 1, y + 1, 1, 1);
      r(spike, x + 3, y + 1, 1, 1);
      r(spike, x + 1, y + 3, 1, 1);
    };
    ball(0, 3);
    ball(3, 1);
    ball(7, 2);
    // Legs, hocks bent back the way a hyena's are
    r(fur, 9, 20, 4, 3);
    r(fur, 8, 22, 4, 4);
    r(dark, 7, 25, 5, 2);
    r(fur, 17, 20, 4, 3);
    r(fur, 18, 22, 4, 4);
    r(dark, 18, 25, 5, 2);
    // Torso, mane down the back
    r(fur, 8, 9, 14, 12);
    r(lit, 8, 9, 14, 1);
    r(dark, 8, 19, 14, 2);
    r(lit, 12, 11, 3, 6);
    r(mane, 7, 8, 3, 12);
    r(mane, 6, 6, 3, 3);
    r(dark, 13, 14, 6, 1);
    r(dark, 14, 16, 5, 1);
    // Arms: left up on the flail, right hanging with the claws open
    r(fur, 5, 10, 4, 4);
    r(fur, 4, 13, 3, 4);
    r(dark, 3, 16, 3, 2);
    r(fur, 21, 10, 4, 5);
    r(fur, 22, 14, 3, 6);
    r(dark, 22, 20, 4, 2);
    // Head: hyena, muzzle out, ears up, jaws open
    r(fur, 9, 2, 10, 8);
    r(lit, 9, 2, 10, 1);
    r(fur, 17, 5, 6, 4);
    r(dark, 17, 8, 6, 1);
    r(flash || '#1c0e04', 17, 9, 6, 2);
    r(flash || '#f0ece0', 18, 8, 1, 1);
    r(flash || '#f0ece0', 21, 8, 1, 1);
    r(flash || '#f0ece0', 19, 10, 1, 1);
    r(flash || '#f4e04a', 12, 4, 2, 2);
    r(flash || '#f4e04a', 15, 4, 2, 2);
    r(flash || '#1c0e04', 13, 4, 1, 2);
    r(flash || '#1c0e04', 16, 4, 1, 2);
    r(dark, 22, 6, 1, 1);
    r(mane, 9, 0, 3, 3);
    r(mane, 14, 0, 3, 3);
    r(dark, 10, 1, 1, 2);
    r(dark, 15, 1, 1, 2);
  }

  /**
   * Demogorgon is two heads or he is nothing: two baboon skulls side by side
   * on a scaled body, the mandrill colours on the faces, and tentacles for
   * arms curling up either side.
   */
  private drawDemogorgon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#3f6b5e';
    const lit = flash || '#5f9382';
    const dark = flash || '#233d35';
    const fur = flash || '#6e5a3a';
    const furDark = flash || '#4a3b24';
    const face = flash || '#c8422e';
    const cheek = flash || '#3a63c4';
    const teeth = flash || '#f0ece0';
    // Tentacle arms, curling out and up
    r(hide, 2, 12, 5, 4);
    r(hide, 1, 8, 3, 5);
    r(hide, 2, 5, 3, 4);
    r(hide, 4, 4, 3, 2);
    r(dark, 2, 12, 5, 1);
    r(lit, 1, 8, 1, 5);
    r(hide, 21, 12, 5, 4);
    r(hide, 24, 8, 3, 5);
    r(hide, 23, 5, 3, 4);
    r(hide, 21, 4, 3, 2);
    r(dark, 21, 12, 5, 1);
    r(lit, 26, 8, 1, 5);
    // Scaled body, forked tail behind the legs
    r(hide, 7, 10, 14, 11);
    r(lit, 7, 10, 14, 1);
    r(dark, 7, 19, 14, 2);
    r(lit, 9, 12, 2, 6);
    r(dark, 15, 13, 3, 1);
    r(dark, 14, 16, 3, 1);
    r(hide, 8, 21, 5, 5);
    r(hide, 15, 21, 5, 5);
    r(dark, 8, 25, 5, 1);
    r(dark, 15, 25, 5, 1);
    r(flash || '#d8cca8', 7, 26, 2, 1);
    r(flash || '#d8cca8', 11, 26, 2, 1);
    r(flash || '#d8cca8', 15, 26, 2, 1);
    r(flash || '#d8cca8', 19, 26, 2, 1);
    r(hide, 20, 22, 6, 2);
    r(hide, 25, 19, 2, 4);
    // Two baboon heads, the manes meeting at the shoulders
    const head = (x: number) => {
      r(furDark, x - 1, 3, 9, 8);
      r(fur, x, 2, 7, 8);
      r(flash || '#8a7550', x, 2, 7, 1);
      r(cheek, x, 5, 2, 4);
      r(cheek, x + 5, 5, 2, 4);
      r(face, x + 2, 4, 3, 5);
      r(flash || '#ffe14a', x + 1, 4, 1, 1);
      r(flash || '#ffe14a', x + 5, 4, 1, 1);
      r(dark, x + 2, 8, 3, 2);
      r(teeth, x + 2, 8, 1, 1);
      r(teeth, x + 4, 8, 1, 1);
    };
    head(5);
    head(16);
  }

  /**
   * Orcus: a bloated belly hanging over goat legs, tattered wings, the goat
   * skull of a head with ram horns coiled either side, and the wand held up
   * at his right — a rod topped with a skull that is not his own.
   */
  private drawOrcus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#5e5468';
    const lit = flash || '#7f7490';
    const dark = flash || '#332c3a';
    const skull = flash || '#dcd6cc';
    const horn = flash || '#b8ad9a';
    const wing = flash || '#2a2430';
    // Wings
    r(wing, 0, 3, 8, 6);
    r(wing, 1, 9, 6, 6);
    r(wing, 3, 15, 4, 4);
    r(dark, 0, 3, 8, 1);
    r(wing, 20, 3, 8, 6);
    r(wing, 21, 9, 6, 6);
    r(wing, 21, 15, 4, 4);
    r(dark, 20, 3, 8, 1);
    // The bloated body
    r(hide, 7, 11, 14, 12);
    r(hide, 6, 14, 16, 7);
    r(lit, 7, 11, 14, 1);
    r(lit, 6, 14, 1, 7);
    r(dark, 7, 21, 14, 2);
    r(flash || '#8a7f9c', 10, 15, 8, 5);
    r(dark, 13, 15, 1, 5);
    r(hide, 8, 23, 4, 3);
    r(hide, 16, 23, 4, 3);
    r(flash || '#1c1820', 7, 26, 5, 2);
    r(flash || '#1c1820', 16, 26, 5, 2);
    // Arms: one on the belly, one raised with the wand
    r(hide, 4, 12, 3, 6);
    r(dark, 4, 17, 3, 2);
    r(hide, 21, 11, 3, 5);
    r(dark, 22, 15, 3, 2);
    // The goat skull, ram horns coiled either side
    r(skull, 9, 3, 10, 8);
    r(flash || '#f2eee6', 9, 3, 10, 1);
    r(flash || '#aaa397', 9, 3, 1, 8);
    r(skull, 11, 10, 6, 2);
    r(dark, 10, 5, 3, 2);
    r(dark, 15, 5, 3, 2);
    r(flash || '#ff3a2a', 11, 5, 1, 2);
    r(flash || '#ff3a2a', 16, 5, 1, 2);
    r(dark, 13, 8, 2, 1);
    r(dark, 11, 11, 6, 1);
    r(horn, 6, 4, 3, 4);
    r(horn, 5, 2, 3, 3);
    r(horn, 7, 1, 3, 2);
    r(horn, 19, 4, 3, 4);
    r(horn, 20, 2, 3, 3);
    r(horn, 18, 1, 3, 2);
    // The Wand of Orcus
    r(flash || '#3a2a1c', 25, 6, 2, 12);
    r(flash || '#5a4630', 25, 6, 1, 12);
    r(skull, 24, 1, 4, 5);
    r(dark, 25, 2, 1, 2);
    r(dark, 27, 2, 1, 2);
    r(flash || '#c03040', 25, 2, 1, 1);
    r(flash || '#c03040', 27, 2, 1, 1);
  }

  private drawAbishaiRed(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // proud scorched dragonkin breathing flame glory
    ctx.fillStyle = flash || '#8a2020'; // proud crimson kes domain
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.32);
    ctx.fillStyle = '#631616'; // soot-scorched mail
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.05);
    ctx.fillStyle = '#a03020'; // burning dragonkin head
    ctx.fillRect(s * 0.32, s * 0.18, s * 0.36, s * 0.2);
    ctx.fillStyle = '#50100c'; // swept-back dread horns
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.1, s * 0.1, s * 0.1);
    ctx.fillStyle = '#f0c030'; // furnace-flame eyes
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillStyle = '#7a2418'; // fire-scale wings
    ctx.fillRect(s * 0.12, s * 0.3, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.16, s * 0.2);
    ctx.fillStyle = '#f08020'; // licking flame breath
    ctx.fillRect(s * 0.82, s * 0.24, s * 0.08, s * 0.04);
  }

  private drawAbishaiBlue(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // crackling azure dragonkin of the storm-necks
    ctx.fillStyle = flash || '#3a5aa0'; // azure scale bulk
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.32);
    ctx.fillStyle = '#293f78'; // plate seam
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.05);
    ctx.fillStyle = '#3a7ad0'; // angular storm-head
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.36, s * 0.22);
    ctx.fillStyle = '#182a50'; // crackle-spade crest
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.08);
    ctx.fillStyle = '#f0e000'; // sparkling lightning eyes
    ctx.fillRect(s * 0.38, s * 0.22, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.06, s * 0.04);
    ctx.fillStyle = '#5a8ae8'; // gloating thunder wings
    ctx.fillRect(s * 0.12, s * 0.3, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.16, s * 0.2);
    ctx.fillStyle = '#d0e8ff'; // branching denied bolt
    ctx.fillRect(s * 0.84, s * 0.2, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.9, s * 0.14, s * 0.04, s * 0.08);
  }

  private drawAbishaiBlack(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // corroding shadow-scale of the acid-lakes
    ctx.fillStyle = flash || '#1c1c22'; // oil-black scale body
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.3);
    ctx.fillStyle = '#101014'; // corroded mail
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.54, s * 0.36, s * 0.05);
    ctx.fillStyle = '#26262e'; // sleek sable head
    ctx.fillRect(s * 0.32, s * 0.2, s * 0.36, s * 0.2);
    ctx.fillStyle = '#0c0c10'; // hooked rem-veined horns
    ctx.fillRect(s * 0.36, s * 0.12, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.08, s * 0.1);
    ctx.fillStyle = '#c0cfe8'; // acid-pale unwelcome eyes
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillStyle = '#12101a'; // tattered eel wings
    ctx.fillRect(s * 0.12, s * 0.32, s * 0.16, s * 0.18);
    ctx.fillRect(s * 0.72, s * 0.32, s * 0.16, s * 0.18);
    ctx.fillStyle = '#202c14'; // dripping acid trail
    ctx.fillRect(s * 0.44, s * 0.64, s * 0.12, s * 0.06);
  }

  private drawAbishaiGreen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // spoiling verdant abishai of the fly-poison coats
    ctx.fillStyle = flash || '#2c5a2c'; // poison-green bulk
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.32);
    ctx.fillStyle = '#1e3f1e'; // veined mail
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.05);
    ctx.fillStyle = '#35702f'; // charming verdant head
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.36, s * 0.24);
    ctx.fillStyle = '#1a3a18'; // leaf-curled horns
    ctx.fillRect(s * 0.34, s * 0.1, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.1, s * 0.1, s * 0.08);
    ctx.fillStyle = '#d8e020'; // charming olive-fawn eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillStyle = '#244a1e'; // beguiling broad wings
    ctx.fillRect(s * 0.1, s * 0.28, s * 0.16, s * 0.22);
    ctx.fillRect(s * 0.74, s * 0.28, s * 0.16, s * 0.22);
    ctx.fillStyle = '#0e2010'; // hissing nervous tail tip
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.14, s * 0.05);
  }

  private drawAbishaiWhite(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // frigid pale abishai striking like falling frost
    ctx.fillStyle = flash || '#e8eef2'; // pale arctic form
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.3);
    ctx.fillStyle = '#c6d2d8'; // icy plate
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.54, s * 0.36, s * 0.05);
    ctx.fillStyle = '#f4f8fa'; // pale narrow head
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.32, s * 0.2);
    ctx.fillStyle = '#a0b2ba'; // glacier horns
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.08, s * 0.1);
    ctx.fillStyle = '#60c0d8'; // keen frost-slash eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.06, s * 0.04);
    ctx.fillStyle = '#d8e6ec'; // icy membrane wings
    ctx.fillRect(s * 0.12, s * 0.32, s * 0.16, s * 0.18);
    ctx.fillRect(s * 0.72, s * 0.32, s * 0.16, s * 0.18);
    ctx.fillStyle = '#b8d8e8'; // glittering rime breath
    ctx.fillRect(s * 0.86, s * 0.26, s * 0.08, s * 0.04);
  }

  /**
   * Zariel: an angel in scorched plate with a sword of fire held up beside
   * her. Fallen, both wings are burnt black; falling — the boss encounter —
   * one of them is still white.
   */
  private drawZariel(
    ctx: CanvasRenderingContext2D,
    s: number,
    flash?: string,
    variant: 'fallen' | 'falling' = 'fallen',
  ) {
    const r = this.grid(ctx, s);
    const plate = flash || '#8a3a1c';
    const plateLit = flash || '#b85a30';
    const plateDark = flash || '#4e1c0c';
    const gold = flash || '#f0d060';
    const skin = flash || '#e8c8a0';
    const hair = flash || '#f4f0dc';
    const fire = flash || '#ff7a1f';
    const hot = flash || '#ffd54a';
    const black = flash || '#2a2028';
    const blackLine = flash || '#4a3a44';
    const white = flash || '#eef0f4';
    const whiteLine = flash || '#b8bcc8';
    // Wings: the tip far out at the top, the trailing edge hugging the body
    const wing = (x0: number, dir: 1 | -1, col: string, line: string) => {
      const px = (x: number, w: number) => (dir === 1 ? x0 + x : x0 - x - w + 1);
      r(col, px(3, 5), 1, 5, 4);
      r(col, px(0, 8), 4, 8, 5);
      r(col, px(0, 6), 9, 6, 4);
      r(col, px(0, 4), 13, 4, 4);
      r(line, px(3, 5), 1, 5, 1);
      r(line, px(0, 8), 4, 8, 1);
      r(line, px(2, 1), 5, 1, 10);
    };
    if (variant === 'falling') wing(8, -1, white, whiteLine);
    else wing(8, -1, black, blackLine);
    wing(19, 1, black, blackLine);
    // Armoured body, gold-trimmed
    r(plate, 9, 10, 10, 10);
    r(plateLit, 9, 10, 10, 1);
    r(plateDark, 9, 18, 10, 2);
    r(gold, 9, 12, 10, 1);
    r(gold, 13, 13, 2, 5);
    r(plate, 7, 10, 3, 7);
    r(gold, 7, 10, 3, 1);
    r(skin, 7, 17, 3, 2);
    r(plate, 18, 10, 3, 5);
    r(gold, 18, 10, 3, 1);
    r(plate, 20, 13, 3, 4);
    r(plate, 9, 20, 4, 6);
    r(plate, 15, 20, 4, 6);
    r(plateDark, 9, 25, 4, 2);
    r(plateDark, 15, 25, 4, 2);
    // Face and the ash-white hair
    r(skin, 10, 3, 8, 7);
    r(hair, 9, 2, 10, 2);
    r(hair, 9, 4, 1, 6);
    r(hair, 18, 4, 1, 6);
    r(flash || '#ff5a2a', 11, 5, 2, 1);
    r(flash || '#ff5a2a', 15, 5, 2, 1);
    r(flash || '#b0806a', 12, 8, 4, 1);
    r(gold, 11, 1, 6, 1);
    // The greatsword, a blade of fire
    r(gold, 22, 14, 4, 1);
    r(flash || '#5a3a20', 23, 15, 2, 4);
    r(skin, 22, 16, 3, 2);
    r(fire, 23, 2, 2, 12);
    r(hot, 23, 2, 1, 12);
    r(hot, 22, 4, 1, 3);
    r(fire, 25, 6, 1, 4);
    r(hot, 23, 0, 2, 2);
  }

  /**
   * Bel, the armourer of the Blood War: a bull head between huge riveted
   * brass pauldrons, a smith's apron over the chest, and the war-mallet
   * resting head-down on the ground at his right.
   */
  private drawBel(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#5a3a2a';
    const lit = flash || '#7a5240';
    const dark = flash || '#2e1c14';
    const brass = flash || '#e0b860';
    const brassLit = flash || '#f6dc9a';
    const brassDark = flash || '#8a6a2a';
    const iron = flash || '#3a3a44';
    // Legs like pillars
    r(hide, 7, 18, 5, 6);
    r(hide, 15, 18, 5, 6);
    r(dark, 7, 23, 5, 1);
    r(dark, 15, 23, 5, 1);
    r(dark, 6, 24, 6, 3);
    r(dark, 15, 24, 6, 3);
    // Chest and apron
    r(hide, 6, 8, 16, 11);
    r(lit, 6, 8, 16, 1);
    r(flash || '#241c14', 9, 12, 10, 7);
    r(flash || '#3a3028', 9, 12, 10, 1);
    r(brassDark, 13, 11, 2, 1);
    // Pauldrons
    r(brass, 2, 7, 7, 5);
    r(brassLit, 2, 7, 7, 1);
    r(brassDark, 2, 11, 7, 1);
    r(brass, 19, 7, 7, 5);
    r(brassLit, 19, 7, 7, 1);
    r(brassDark, 19, 11, 7, 1);
    r(brassDark, 4, 9, 1, 1);
    r(brassDark, 7, 9, 1, 1);
    r(brassDark, 21, 9, 1, 1);
    r(brassDark, 24, 9, 1, 1);
    // Arms
    r(hide, 3, 12, 4, 6);
    r(dark, 3, 17, 4, 2);
    r(hide, 21, 12, 4, 6);
    // The mallet, in front of the right arm
    r(flash || '#4a3520', 22, 4, 2, 16);
    r(hide, 21, 14, 4, 2);
    r(iron, 19, 19, 8, 6);
    r(flash || '#5c5c68', 19, 19, 8, 1);
    r(flash || '#1c1c22', 19, 24, 8, 1);
    r(brass, 22, 20, 2, 4);
    // Bull head, brass horns
    r(hide, 9, 2, 10, 7);
    r(lit, 9, 2, 10, 1);
    r(dark, 9, 2, 1, 7);
    r(flash || '#4a2e22', 10, 6, 8, 3);
    r(dark, 11, 7, 1, 1);
    r(dark, 16, 7, 1, 1);
    r(flash || '#ff6a2a', 11, 3, 2, 2);
    r(flash || '#ff6a2a', 15, 3, 2, 2);
    r(brass, 6, 3, 3, 3);
    r(brass, 4, 1, 3, 3);
    r(brassLit, 4, 1, 3, 1);
    r(brass, 19, 3, 3, 3);
    r(brass, 21, 1, 3, 3);
    r(brassLit, 21, 1, 3, 1);
    r(brass, 12, 0, 4, 2);
  }

  /**
   * Dispater: a narrow coat buttoned to the throat, a cold face under a
   * bone brow, an iron crown, and the iron rod held out at arm's length —
   * taller than he is, with a perch forged at the top.
   */
  private drawDispater(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const coat = flash || '#3a3a48';
    const coatLit = flash || '#55556a';
    const coatDark = flash || '#22222c';
    const iron = flash || '#8a8c98';
    const ironLit = flash || '#c4c6d0';
    const skin = flash || '#b8b0b8';
    // The rod
    r(iron, 3, 1, 2, 24);
    r(ironLit, 3, 1, 1, 24);
    r(ironLit, 1, 0, 6, 2);
    r(iron, 1, 2, 1, 2);
    r(iron, 6, 2, 1, 2);
    // The coat
    r(coat, 9, 9, 10, 13);
    r(coat, 7, 20, 14, 6);
    r(coatLit, 9, 9, 10, 1);
    r(coatLit, 9, 10, 1, 15);
    r(coatDark, 7, 24, 14, 2);
    r(ironLit, 14, 10, 1, 1);
    r(ironLit, 14, 12, 1, 1);
    r(ironLit, 14, 14, 1, 1);
    r(ironLit, 14, 16, 1, 1);
    r(ironLit, 14, 18, 1, 1);
    r(coatDark, 12, 20, 1, 5);
    r(coatDark, 16, 20, 1, 5);
    // Arms: one out to the rod, one folded behind
    r(coat, 5, 10, 4, 4);
    r(skin, 5, 14, 3, 2);
    r(coat, 19, 10, 3, 6);
    // Face, bone brow, crown
    r(skin, 10, 3, 8, 6);
    r(flash || '#d8d0d8', 10, 3, 8, 1);
    r(flash || '#8a8290', 10, 3, 1, 6);
    r(flash || '#e6dcd0', 10, 4, 8, 1);
    r(flash || '#ff3a3a', 11, 5, 2, 1);
    r(flash || '#ff3a3a', 15, 5, 2, 1);
    r(coatDark, 12, 8, 4, 1);
    r(flash || '#1c1c24', 9, 8, 10, 2);
    r(iron, 9, 0, 10, 3);
    r(ironLit, 9, 0, 10, 1);
    r(iron, 9, 0, 1, 4);
    r(iron, 13, 0, 2, 4);
    r(iron, 18, 0, 1, 4);
    r(flash || '#5a5c68', 10, 2, 8, 1);
  }

  /**
   * Mammon: a serpent from the waist down, coiled under him and spilling
   * out either side, a hooded snake's head above with a coin crown on it,
   * gold rings round the torso and coins spilling from the coils.
   */
  private drawMammon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const scale = flash || '#6f6a2a';
    const lit = flash || '#9a9440';
    const dark = flash || '#3f3c16';
    const gold = flash || '#f0d050';
    const goldLit = flash || '#fff0a0';
    const goldDark = flash || '#a68a2a';
    const skin = flash || '#8a7a3a';
    // Coils
    r(scale, 2, 20, 24, 6);
    r(lit, 2, 20, 24, 1);
    r(dark, 2, 24, 24, 2);
    r(scale, 5, 16, 18, 5);
    r(lit, 5, 16, 18, 1);
    r(dark, 8, 18, 3, 1);
    r(dark, 14, 18, 3, 1);
    r(dark, 20, 18, 2, 1);
    r(dark, 4, 22, 3, 1);
    r(dark, 11, 22, 4, 1);
    r(dark, 19, 22, 4, 1);
    r(scale, 22, 12, 5, 5);
    r(scale, 25, 9, 3, 4);
    r(gold, 1, 24, 2, 1);
    r(gold, 24, 25, 3, 1);
    r(gold, 4, 26, 2, 1);
    // Torso ringed with gold
    r(skin, 9, 8, 10, 9);
    r(flash || '#a8965a', 9, 8, 10, 1);
    r(dark, 9, 15, 10, 2);
    r(gold, 9, 10, 10, 1);
    r(gold, 9, 13, 10, 1);
    r(skin, 5, 9, 4, 4);
    r(skin, 4, 12, 3, 4);
    r(gold, 4, 15, 3, 1);
    r(skin, 19, 9, 4, 4);
    r(skin, 21, 12, 3, 4);
    r(gold, 21, 15, 3, 1);
    // Hooded serpent's head
    r(scale, 8, 3, 12, 6);
    r(lit, 8, 3, 12, 1);
    r(dark, 8, 3, 1, 6);
    r(flash || '#c8d020', 10, 5, 3, 1);
    r(flash || '#c8d020', 15, 5, 3, 1);
    r(flash || '#1a1a06', 11, 5, 1, 1);
    r(flash || '#1a1a06', 16, 5, 1, 1);
    r(dark, 11, 7, 6, 1);
    r(flash || '#f0ece0', 11, 8, 1, 1);
    r(flash || '#f0ece0', 16, 8, 1, 1);
    r(flash || '#d8203a', 13, 8, 2, 2);
    // Coin crown
    r(gold, 8, 0, 12, 3);
    r(goldLit, 8, 0, 12, 1);
    r(goldDark, 8, 2, 12, 1);
    r(gold, 9, 0, 2, 4);
    r(gold, 13, 0, 2, 4);
    r(gold, 17, 0, 2, 4);
    r(flash || '#40c860', 13, 1, 2, 1);
  }

  /**
   * Levistus is sealed in a glacier, so that is the sprite: one faceted
   * block of ice with fractures through it, and the archdevil dim inside —
   * a tall figure in a court coat, arms at his sides, only the eyes still
   * burning. Nothing else in the bestiary is a block.
   */
  private drawLevistus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const ice = flash || '#8fc4de';
    const iceLit = flash || '#d6f0fb';
    const iceDark = flash || '#4f86a2';
    const deep = flash || '#2c5670';
    const body = flash || '#1e2a3a';
    const skin = flash || '#a9c4d2';
    // The block
    r(ice, 4, 2, 20, 24);
    r(ice, 2, 5, 24, 18);
    r(iceLit, 4, 2, 20, 1);
    r(iceLit, 2, 5, 2, 18);
    r(iceLit, 4, 3, 1, 2);
    r(iceDark, 4, 25, 20, 1);
    r(iceDark, 24, 5, 2, 18);
    r(iceDark, 22, 23, 2, 2);
    // Fractures
    r(iceLit, 7, 4, 1, 7);
    r(iceLit, 8, 10, 1, 4);
    r(iceLit, 19, 12, 1, 6);
    r(iceLit, 20, 8, 1, 4);
    r(iceDark, 12, 22, 4, 1);
    r(iceDark, 16, 21, 3, 1);
    // Levistus himself
    r(deep, 9, 7, 10, 16);
    r(body, 10, 8, 8, 14);
    r(deep, 13, 9, 2, 12);
    r(deep, 8, 9, 2, 10);
    r(deep, 18, 9, 2, 10);
    r(skin, 11, 5, 6, 5);
    r(flash || '#7fa8bc', 11, 5, 6, 1);
    r(body, 10, 3, 8, 3);
    r(flash || '#5cd8ff', 12, 7, 1, 1);
    r(flash || '#5cd8ff', 15, 7, 1, 1);
    // Ice spikes standing above the block
    r(iceLit, 10, 0, 2, 3);
    r(iceLit, 13, 0, 2, 2);
    r(iceLit, 16, 0, 2, 3);
    r(iceDark, 11, 3, 1, 1);
    r(iceDark, 17, 3, 1, 1);
  }

  /**
   * Asmodeus is composure: a cloak spread like a throne behind him from one
   * edge of the box to the other, a narrow black tunic inside it, red skin,
   * black beard and horns, and the Ruby Rod held upright at his right.
   */
  private drawAsmodeus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const robe = flash || '#4a1428';
    const robeLit = flash || '#6e2240';
    const robeDark = flash || '#2a0a16';
    const skin = flash || '#b8342a';
    const skinLit = flash || '#d9503f';
    const horn = flash || '#1c1216';
    const ruby = flash || '#ff2e4a';
    const gold = flash || '#e8c04a';
    // The cloak
    r(robe, 4, 9, 20, 4);
    r(robe, 1, 12, 26, 14);
    r(robeDark, 4, 9, 20, 1);
    r(robeDark, 1, 24, 26, 2);
    r(robeLit, 1, 12, 1, 12);
    r(robeLit, 26, 12, 1, 12);
    r(robeDark, 4, 13, 1, 11);
    r(robeDark, 23, 13, 1, 11);
    r(gold, 1, 23, 26, 1);
    // Tunic and sash, hands at the sides
    r(robeDark, 10, 10, 8, 14);
    r(flash || '#3a1020', 10, 10, 8, 1);
    r(ruby, 10, 16, 8, 1);
    r(skin, 8, 11, 2, 7);
    r(skin, 18, 11, 2, 7);
    // Head
    r(skin, 10, 2, 8, 8);
    r(skinLit, 10, 2, 8, 1);
    r(flash || '#8a2418', 10, 2, 1, 8);
    r(flash || '#ffe14a', 11, 4, 2, 2);
    r(flash || '#ffe14a', 15, 4, 2, 2);
    r(flash || '#1c0a06', 12, 4, 1, 2);
    r(flash || '#1c0a06', 16, 4, 1, 2);
    r(horn, 11, 8, 6, 3);
    r(horn, 13, 10, 2, 2);
    r(horn, 8, 1, 3, 3);
    r(horn, 7, 0, 2, 2);
    r(horn, 17, 1, 3, 3);
    r(horn, 19, 0, 2, 2);
    // The Ruby Rod
    r(gold, 22, 6, 2, 16);
    r(flash || '#fff0a0', 22, 6, 1, 16);
    r(ruby, 21, 1, 4, 5);
    r(flash || '#ff8090', 22, 2, 1, 2);
    // The crown
    r(gold, 11, 0, 6, 2);
    r(ruby, 13, 0, 2, 1);
  }

  private drawTiamat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const bulk = flash || '#7d1f1f';
    const bulkLit = flash || '#a53434';
    const bulkDark = flash || '#4a0f0f';
    const memb = flash || '#5c1616';
    const claw = flash || '#e8dcc0';
    // Wings mantled behind the bulk rather than spread, so nothing competes
    // with the five heads — which are the whole point of her.
    r(memb, 1, 12, 8, 6);
    r(memb, 2, 18, 7, 3);
    r(memb, 4, 21, 5, 2);
    r(bulkDark, 1, 12, 8, 1);
    r(memb, 19, 12, 8, 6);
    r(memb, 19, 18, 7, 3);
    r(memb, 19, 21, 5, 2);
    r(bulkDark, 19, 12, 8, 1);
    r(claw, 0, 10, 2, 3);
    r(claw, 26, 10, 2, 3);
    // Bulk, belly plates, and the legs under it
    r(bulk, 7, 15, 14, 9);
    r(bulkLit, 7, 15, 14, 1);
    r(bulkDark, 7, 22, 14, 2);
    r(flash || '#c08a5a', 10, 18, 8, 4);
    r(bulkDark, 13, 18, 1, 4);
    r(bulk, 5, 21, 5, 5);
    r(bulk, 18, 21, 5, 5);
    r(bulkDark, 5, 25, 5, 1);
    r(bulkDark, 18, 25, 5, 1);
    r(claw, 4, 26, 1, 1);
    r(claw, 8, 26, 1, 1);
    r(claw, 18, 26, 1, 1);
    r(claw, 22, 26, 1, 1);
    // Five necks fanning off the shoulders, one head each, in the five
    // chromatic colours — white, black, red, green, blue.
    const head = (col: string, hi: string, x: number, y: number) => {
      r(col, x, y, 5, 4);
      r(hi, x, y, 5, 1);
      r(flash || '#ffe14a', x + 1, y + 1, 3, 2);
      r(flash || '#1c1004', x + 2, y + 1, 1, 2);
      r(flash || '#f8f2e0', x + 1, y + 3, 1, 1);
      r(flash || '#f8f2e0', x + 3, y + 3, 1, 1);
    };
    const white = flash || '#dfe6ee', whiteL = flash || '#f6fbff';
    const black = flash || '#2c2c36', blackL = flash || '#4b4b59';
    const red = flash || '#a8231c', redL = flash || '#cf4436';
    const green = flash || '#3f6b34', greenL = flash || '#5f9450';
    const blue = flash || '#2f5fa8', blueL = flash || '#4d84d0';
    r(white, 1, 9, 3, 4); r(white, 3, 12, 3, 3); r(white, 5, 14, 4, 2);
    r(black, 6, 5, 3, 5); r(black, 8, 9, 3, 4); r(black, 9, 13, 3, 3);
    r(red, 12, 3, 4, 13);
    r(redL, 12, 3, 1, 13);
    r(green, 19, 5, 3, 5); r(green, 17, 9, 3, 4); r(green, 16, 13, 3, 3);
    r(blue, 24, 9, 3, 4); r(blue, 21, 12, 3, 3); r(blue, 19, 14, 4, 2);
    head(white, whiteL, 0, 5);
    head(black, blackL, 5, 1);
    head(red, redL, 11, 0);
    head(green, greenL, 18, 1);
    head(blue, blueL, 23, 5);
  }

  private drawBahamut(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const plate = flash || '#c2cede';
    const lit = flash || '#eef4fa';
    const memb = flash || '#8494ab';
    const strut = flash || '#5a6a80';
    const deep = flash || '#63758a';
    const gold = flash || '#ffd23a';
    // Bahamut is the one thing in the bestiary drawn head-on and
    // symmetrical, which is what makes him read as a judge rather than as
    // one more animal in profile — so the wings have to carry the
    // silhouette on their own: leading edge out to the corner, membrane
    // scalloped away beneath it, two struts each.
    r(memb, 0, 4, 8, 5);
    r(memb, 1, 9, 6, 3);
    r(memb, 3, 12, 4, 2);
    r(strut, 0, 4, 8, 1);
    r(strut, 2, 5, 1, 8);
    r(strut, 5, 5, 1, 9);
    r(plate, 0, 2, 2, 3);
    r(memb, 20, 4, 8, 5);
    r(memb, 21, 9, 6, 3);
    r(memb, 21, 12, 4, 2);
    r(strut, 20, 4, 8, 1);
    r(strut, 25, 5, 1, 8);
    r(strut, 22, 5, 1, 9);
    r(plate, 26, 2, 2, 3);
    // Chest and breast plates
    r(plate, 9, 11, 10, 10);
    r(lit, 9, 11, 10, 1);
    r(deep, 9, 19, 10, 2);
    r(flash || '#f2f7fb', 11, 14, 6, 6);
    r(deep, 13, 14, 1, 6);
    // Forelegs planted wide, gold talons
    r(plate, 6, 18, 5, 7);
    r(plate, 17, 18, 5, 7);
    r(deep, 6, 23, 5, 2);
    r(deep, 17, 23, 5, 2);
    r(gold, 6, 25, 1, 2);
    r(gold, 9, 25, 1, 2);
    r(gold, 18, 25, 1, 2);
    r(gold, 21, 25, 1, 2);
    // Tail out to one side so the pose is not a perfect mirror
    r(plate, 19, 21, 8, 3);
    r(deep, 19, 21, 8, 1);
    r(plate, 25, 18, 3, 4);
    // Neck, skull, and the muzzle jutting from it
    r(plate, 12, 8, 4, 4);
    r(plate, 10, 1, 8, 7);
    r(lit, 10, 1, 8, 1);
    r(deep, 10, 1, 1, 7);
    r(deep, 17, 1, 1, 7);
    r(deep, 10, 3, 8, 1);
    r(plate, 11, 8, 6, 3);
    r(deep, 11, 10, 6, 1);
    r(deep, 12, 8, 1, 1);
    r(deep, 15, 8, 1, 1);
    r(flash || '#f8fbff', 11, 11, 1, 1);
    r(flash || '#f8fbff', 13, 11, 1, 1);
    r(flash || '#f8fbff', 15, 11, 1, 1);
    // Horns swept back off the crown, barbels trailing off the jaw
    r(lit, 8, 0, 3, 3);
    r(lit, 17, 0, 3, 3);
    r(lit, 6, 1, 2, 2);
    r(lit, 20, 1, 2, 2);
    r(deep, 7, 6, 3, 1);
    r(deep, 18, 6, 3, 1);
    // Burning gold eyes: the one thing on him that is not platinum
    r(gold, 11, 4, 2, 2);
    r(gold, 15, 4, 2, 2);
    r(flash || '#3a2a08', 12, 4, 1, 2);
    r(flash || '#3a2a08', 15, 4, 1, 2);
    // The platinum crown between the horns, and the radiance off it: four
    // solid sparks, well inside the box so the rim is not spent on them
    r(gold, 11, 0, 6, 2);
    r(flash || '#fff6d0', 11, 0, 6, 1);
    r(flash || '#f8fbff', 13, 0, 2, 1);
    r(gold, 3, 0, 1, 3);
    r(gold, 2, 1, 3, 1);
    r(gold, 24, 0, 1, 3);
    r(gold, 23, 1, 3, 1);
  }

  /**
   * Pazuzu: four wings, two a side, stacked and fanned; a lean taloned body
   * with the tail down between the feet; a hawk's head with the hooked beak
   * open on the scream.
   */
  private drawPazuzu(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#4a3660';
    const lit = flash || '#6b5286';
    const dark = flash || '#2a1c3a';
    const feather = flash || '#8a6aa8';
    const featherDark = flash || '#563e70';
    const talon = flash || '#e2d4b0';
    const wingPair = (x0: number, dir: 1 | -1) => {
      const px = (x: number, w: number) => (dir === 1 ? x0 + x : x0 - x - w + 1);
      r(feather, px(0, 9), 1, 9, 4);
      r(featherDark, px(0, 9), 1, 9, 1);
      r(feather, px(1, 8), 5, 8, 3);
      r(hide, px(0, 9), 9, 9, 4);
      r(dark, px(0, 9), 9, 9, 1);
      r(hide, px(1, 8), 13, 8, 3);
      r(featherDark, px(3, 1), 2, 1, 6);
      r(dark, px(3, 1), 10, 1, 6);
    };
    wingPair(8, -1);
    wingPair(19, 1);
    // Body, feet, tail
    r(hide, 9, 8, 10, 12);
    r(lit, 9, 8, 10, 1);
    r(dark, 9, 18, 10, 2);
    r(lit, 11, 10, 2, 5);
    r(dark, 13, 20, 2, 5);
    r(dark, 12, 25, 4, 2);
    r(hide, 9, 20, 3, 5);
    r(hide, 16, 20, 3, 5);
    r(talon, 8, 25, 4, 2);
    r(talon, 16, 25, 4, 2);
    r(dark, 9, 26, 1, 1);
    r(dark, 18, 26, 1, 1);
    // Arms with talons
    r(hide, 6, 9, 3, 5);
    r(talon, 5, 14, 3, 2);
    r(hide, 19, 9, 3, 5);
    r(talon, 20, 14, 3, 2);
    // Head
    r(hide, 10, 2, 8, 6);
    r(lit, 10, 2, 8, 1);
    r(dark, 10, 2, 1, 6);
    r(flash || '#ff4a2a', 11, 4, 2, 1);
    r(flash || '#ff4a2a', 15, 4, 2, 1);
    r(talon, 12, 6, 4, 2);
    r(dark, 13, 7, 2, 1);
    r(talon, 13, 8, 2, 2);
    r(dark, 9, 0, 2, 3);
    r(dark, 17, 0, 2, 3);
  }

  /**
   * Oboxob is the insect lord: a beetle's head with the pincers thrown open
   * in front, six jointed legs braced out either side, a ridged abdomen
   * under a thorax plate, and a crown grown out of the carapace rather than
   * worn.
   */
  private drawOboxob(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const chitin = flash || '#6a3a1c';
    const lit = flash || '#95552c';
    const dark = flash || '#3a1e0c';
    const gloss = flash || '#c07a3a';
    const eye = flash || '#ff8a1a';
    const leg = (x: number, y: number, dir: 1 | -1) => {
      r(chitin, dir === 1 ? x : x - 4, y, 5, 2);
      r(chitin, dir === 1 ? x + 4 : x - 5, y - 3, 2, 4);
      r(dark, dir === 1 ? x + 5 : x - 6, y + 1, 2, 3);
    };
    leg(21, 12, 1);
    leg(21, 16, 1);
    leg(20, 20, 1);
    leg(6, 12, -1);
    leg(6, 16, -1);
    leg(7, 20, -1);
    // Abdomen and thorax
    r(chitin, 7, 14, 14, 11);
    r(lit, 7, 14, 1, 11);
    r(dark, 7, 23, 14, 2);
    r(dark, 8, 17, 12, 1);
    r(dark, 8, 20, 12, 1);
    r(chitin, 6, 8, 16, 7);
    r(lit, 6, 8, 16, 1);
    r(gloss, 8, 10, 4, 2);
    r(dark, 6, 13, 16, 1);
    // Head and pincers
    r(chitin, 9, 3, 10, 6);
    r(lit, 9, 3, 10, 1);
    r(eye, 10, 5, 3, 2);
    r(eye, 15, 5, 3, 2);
    r(flash || '#3a1000', 11, 5, 1, 2);
    r(flash || '#3a1000', 16, 5, 1, 2);
    r(dark, 12, 8, 4, 1);
    r(chitin, 5, 4, 4, 2);
    r(chitin, 3, 1, 3, 4);
    r(dark, 3, 0, 2, 2);
    r(chitin, 19, 4, 4, 2);
    r(chitin, 22, 1, 3, 4);
    r(dark, 23, 0, 2, 2);
    // The crown
    r(gloss, 11, 0, 2, 3);
    r(gloss, 13, 1, 2, 2);
    r(gloss, 15, 0, 2, 3);
    r(flash || '#e8a050', 11, 0, 1, 1);
    r(flash || '#e8a050', 15, 0, 1, 1);
  }

  /**
   * Azaezel is cooled crust over lava: a hunched mass with every seam
   * glowing, arms of the same stuff dragging on the floor, the core open in
   * the chest, and flame standing off the crown — solid, and inside the
   * box, so the rim survives.
   */
  private drawAzaezel(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const crust = flash || '#4a2418';
    const crustLit = flash || '#6e3a26';
    const lava = flash || '#e85a1c';
    const lavaHot = flash || '#ffb03a';
    const core = flash || '#fff3c0';
    // The mass
    r(crust, 3, 12, 22, 12);
    r(crust, 6, 7, 16, 6);
    r(crust, 9, 4, 10, 4);
    r(crustLit, 9, 4, 10, 1);
    r(crustLit, 6, 7, 3, 1);
    r(crustLit, 19, 7, 3, 1);
    r(crustLit, 3, 12, 3, 1);
    r(crustLit, 22, 12, 3, 1);
    r(flash || '#2a120a', 3, 22, 22, 2);
    // Lava veins
    r(lava, 5, 13, 1, 8);
    r(lava, 9, 8, 1, 12);
    r(lava, 14, 5, 1, 15);
    r(lava, 19, 8, 1, 12);
    r(lava, 23, 13, 1, 8);
    r(lava, 6, 16, 16, 1);
    r(lava, 4, 20, 20, 1);
    r(lava, 8, 11, 12, 1);
    r(lavaHot, 14, 5, 1, 4);
    r(lavaHot, 9, 8, 1, 3);
    r(lavaHot, 19, 8, 1, 3);
    // Arms dragging
    r(crust, 0, 14, 4, 8);
    r(lava, 1, 15, 1, 6);
    r(crust, 0, 22, 5, 3);
    r(crust, 24, 14, 4, 8);
    r(lava, 26, 15, 1, 6);
    r(crust, 23, 22, 5, 3);
    // The core, and the eyes
    r(lava, 11, 13, 6, 6);
    r(lavaHot, 12, 14, 4, 4);
    r(core, 13, 15, 2, 2);
    r(lavaHot, 10, 8, 3, 2);
    r(lavaHot, 15, 8, 3, 2);
    r(core, 11, 8, 1, 2);
    r(core, 16, 8, 1, 2);
    // Flame off the crown
    r(lava, 10, 1, 2, 4);
    r(lavaHot, 10, 1, 1, 2);
    r(lava, 13, 0, 2, 5);
    r(lavaHot, 13, 0, 1, 3);
    r(lava, 16, 1, 2, 4);
    r(lavaHot, 16, 1, 1, 2);
    r(lava, 7, 3, 2, 4);
    r(lava, 19, 3, 2, 4);
  }

  private drawHeavenlyChampion(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // paragon of the celestial host given heroic form
    ctx.fillStyle = flash || '#e8eee4'; // radiant gleaming mail
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.44, s * 0.38);
    ctx.fillStyle = '#c6d8b8'; // polished plate bands
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.4, s * 0.05);
    ctx.fillStyle = '#f0f6e8'; // serene heroic face
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.22);
    ctx.fillStyle = '#d8e6c8'; // golden heroic locks
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.1);
    ctx.fillStyle = '#38586a'; // calm law-bright eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillStyle = '#dce8d0'; // great white wings
    ctx.fillRect(s * 0.08, s * 0.3, s * 0.16, s * 0.3);
    ctx.fillRect(s * 0.76, s * 0.3, s * 0.16, s * 0.3);
    ctx.fillStyle = '#9ab860'; // blade of burning law
    ctx.fillRect(s * 0.72, s * 0.12, s * 0.05, s * 0.32);
    ctx.fillStyle = '#c8e090'; // lawlight edge shimmer
    ctx.fillRect(s * 0.74, s * 0.08, s * 0.03, s * 0.14);
  }

  private drawHornedSerpentQueen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // colossal stygian serpent-lord with a fan of horns
    ctx.fillStyle = flash || '#3a6a5a'; // heavy black-green coils
    ctx.fillRect(s * 0.14, s * 0.38, s * 0.34, s * 0.22);
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.3, s * 0.2);
    ctx.fillStyle = '#2e533f'; // plate seam
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.1, s * 0.14);
    ctx.fillStyle = '#3a7864'; // huge crowned serpent head
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.22, s * 0.18);
    ctx.fillStyle = '#c8b860'; // fan of turned gold horns
    ctx.fillRect(s * 0.66, s * 0.12, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.72, s * 0.08, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.78, s * 0.08, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.84, s * 0.12, s * 0.04, s * 0.08);
    ctx.fillStyle = '#e8d870'; // serpent-queen burning eyes
    ctx.fillRect(s * 0.72, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.8, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#c03040'; // dial-veined forked tongue
    ctx.fillRect(s * 0.86, s * 0.26, s * 0.08, s * 0.02);
    ctx.fillRect(s * 0.92, s * 0.28, s * 0.06, s * 0.02);
  }

  private drawFormianWarrior(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // barrel-chested ant-warrior with serrated saber
    ctx.fillStyle = flash || '#4a3424'; // chitin-brown ant bulk
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.32);
    ctx.fillStyle = '#3a2a1a'; // chitin plate seams
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.32, s * 0.05);
    ctx.fillRect(s * 0.34, s * 0.54, s * 0.32, s * 0.05);
    ctx.fillStyle = '#4a3424'; // blocky ant head
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.2);
    ctx.fillStyle = '#2a1e12'; // sharp saber-mandibles
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.36, s * 0.06, s * 0.06);
    ctx.fillStyle = '#c03020'; // single burning eye
    ctx.fillRect(s * 0.47, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillStyle = '#8a6a48'; // serrated chitin saber
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.06, s * 0.34);
    ctx.fillStyle = '#3a2a1a'; // six chitin legs
    ctx.fillRect(s * 0.32, s * 0.62, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.46, s * 0.62, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.62, s * 0.05, s * 0.12);
  }

  private drawFormianMyrmarch(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // great armored ant-lord straddling a lesser worker
    ctx.fillStyle = flash || '#5a3fde'; // royal red-brown armor
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.44, s * 0.34);
    ctx.fillStyle = '#472f0b'; // royal seam bands
    ctx.fillRect(s * 0.32, s * 0.36, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.05);
    ctx.fillStyle = '#6a4e2a'; // regal ant head
    ctx.fillRect(s * 0.32, s * 0.1, s * 0.36, s * 0.22);
    ctx.fillStyle = '#2a1e0c'; // great curved pincer mandibles
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.28, s * 0.08, s * 0.08);
    ctx.fillStyle = '#e0c030'; // blazing command eye
    ctx.fillRect(s * 0.47, s * 0.16, s * 0.06, s * 0.06);
    ctx.fillStyle = '#8a5a2a'; // geometric-law glaive
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.06, s * 0.44);
    ctx.fillStyle = '#f0d060'; // perfect glaive head
    ctx.fillRect(s * 0.66, s * 0.14, s * 0.18, s * 0.08);
    ctx.fillStyle = '#3a2a16'; // mount and legs
    ctx.fillRect(s * 0.18, s * 0.62, s * 0.64, s * 0.1);
  }

  private drawFormianQueen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // great fecund pillar of the hive
    ctx.fillStyle = flash || '#5a4424'; // vast husked queen-dozen
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.6, s * 0.34);
    ctx.fillStyle = '#44341c'; // vast waist plate
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.52, s * 0.06);
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.52, s * 0.06);
    ctx.fillStyle = '#6a5430'; // regal block head
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.28, s * 0.2);
    ctx.fillStyle = '#3a2a14'; // crystal egg-chamber glow
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.16, s * 0.1);
    ctx.fillStyle = '#d8d050'; // commanding queen eyes
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.04, s * 0.05);
    ctx.fillStyle = '#d0d8d0'; // pale laid egg cluster
    ctx.fillRect(s * 0.3, s * 0.56, s * 0.08, s * 0.06);
    ctx.fillStyle = '#9a9040'; // golden chambers
    ctx.fillRect(s * 0.5, s * 0.5, s * 0.12, s * 0.06);
    ctx.fillStyle = '#4a3418'; // broad anchoring legs
    ctx.fillRect(s * 0.28, s * 0.66, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.64, s * 0.66, s * 0.08, s * 0.12);
  }

  private drawCentaurStorm(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // tempest-charged centaur war-leader, haunches crackling
    ctx.fillStyle = flash || '#8a8a96'; // high pale horse-half
    ctx.fillRect(s * 0.18, s * 0.42, s * 0.4, s * 0.26);
    ctx.fillStyle = '#6a6a76'; // storm-gray mane
    ctx.fillRect(s * 0.18, s * 0.36, s * 0.26, s * 0.1);
    ctx.fillStyle = '#f0e060'; // crackling lightning veins
    ctx.fillRect(s * 0.22, s * 0.5, s * 0.03, s * 0.12);
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.03, s * 0.1);
    ctx.fillStyle = '#a0949e'; // warrior upper body
    ctx.fillRect(s * 0.52, s * 0.24, s * 0.26, s * 0.2);
    ctx.fillStyle = '#c03020'; // wild storm eye
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillStyle = '#6a6a76'; // leaping hooves
    ctx.fillRect(s * 0.26, s * 0.68, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.44, s * 0.68, s * 0.08, s * 0.1);
    ctx.fillStyle = '#c8b048'; // lightning lance
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.04, s * 0.2);
    ctx.fillStyle = '#f0f0a0'; // spark burst tip
    ctx.fillRect(s * 0.76, s * 0.04, s * 0.08, s * 0.08);
  }

  private drawCentaurQueen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // crown-browed matriarch with antlered wild memory
    ctx.fillStyle = flash || '#b08a4a'; // bay-goldhorse-half
    ctx.fillRect(s * 0.18, s * 0.42, s * 0.4, s * 0.26);
    ctx.fillStyle = '#8a6a32'; // deep bay shoulder shade
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.3, s * 0.08);
    ctx.fillStyle = '#c09a54'; // sovereign upper body
    ctx.fillRect(s * 0.52, s * 0.24, s * 0.26, s * 0.2);
    ctx.fillStyle = '#8a6a2e'; // great antler-brow crown
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.08, s * 0.12);
    ctx.fillStyle = '#e8d060'; // calm golden eyes
    ctx.fillRect(s * 0.7, s * 0.28, s * 0.04, s * 0.05);
    ctx.fillStyle = '#8a6a32'; // prancing hooves
    ctx.fillRect(s * 0.26, s * 0.68, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.44, s * 0.68, s * 0.08, s * 0.1);
    ctx.fillStyle = '#6a7a4a'; // wreath of autumn memory
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.06, s * 0.06);
  }

  private drawEladrinSummer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // radiant joy-soaked eladrin of green-and-gold
    ctx.fillStyle = flash || '#8a9a20'; // sun-warm robe
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.38);
    ctx.fillStyle = '#6a7820'; // harvest vine trim
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.36, s * 0.04);
    ctx.fillStyle = '#d8c8c5'; // warm elven face
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.28, s * 0.2);
    ctx.fillStyle = '#9ab020'; // green-gold hair
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.12);
    ctx.fillStyle = '#2a5a20'; // glad green eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillStyle = '#8a5a20'; // blade of harvest
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.04, s * 0.3);
    ctx.fillStyle = '#f0d860'; // golden gleam
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.04, s * 0.06);
  }

  private drawEladrinAutumn(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // melancholy courtier of the falling leaves
    ctx.fillStyle = flash || '#9a5a1e'; // russet coat
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.38);
    ctx.fillStyle = '#7a4014'; // deep-gold trim
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.36, s * 0.04);
    ctx.fillStyle = '#d8c0a8'; // gentle elven face
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.28, s * 0.2);
    ctx.fillStyle = '#8a4a14'; // amber falling-leaf hair
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.12);
    ctx.fillStyle = '#5a3a14'; // far-seeing amber eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillStyle = '#c88a3a'; // rusetting leaf scatter
    ctx.fillRect(s * 0.2, s * 0.66, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.64, s * 0.66, s * 0.05, s * 0.05);
  }

  private drawEladrinWinter(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // chill eladrin of deep frost and quiet iron
    ctx.fillStyle = flash || '#8ab0c8'; // ice-blue coat
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.38);
    ctx.fillStyle = '#6a90a8'; // rimed trim
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.36, s * 0.04);
    ctx.fillStyle = '#dce8ee'; // pale winter face
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.28, s * 0.2);
    ctx.fillStyle = '#5a7892'; // frosted pale hair
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.12);
    ctx.fillStyle = '#48a0c0'; // glacier-cold eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillStyle = '#d0e8f0'; // glittering frost mantle
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.7, s * 0.4, s * 0.06, s * 0.1);
  }

  private drawEladrinSpring(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // fey messenger of the greening world
    ctx.fillStyle = flash || '#9ad8a0'; // blossom-pale tunic
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.38);
    ctx.fillStyle = '#78b47e'; // new-leaf trim
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.36, s * 0.04);
    ctx.fillStyle = '#f0e8dc'; // bright spring face
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.28, s * 0.2);
    ctx.fillStyle = '#8ac99a'; // blossom-pink hair
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.12);
    ctx.fillStyle = '#5aa868'; // merry green eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e8a0c0'; // jangling blossom bracelets
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.4, s * 0.06, s * 0.06);
  }

  private drawModronMonodrone(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // humming polyhedral servitor with one unblinking eye
    ctx.fillStyle = flash || '#a86a30'; // single-piece brass polyhedron
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.3);
    ctx.lineTo(s * 0.7, s * 0.3);
    ctx.lineTo(s * 0.7, s * 0.62);
    ctx.lineTo(s * 0.5, s * 0.74);
    ctx.lineTo(s * 0.3, s * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c88a3a'; // polyhedral panel
    ctx.fillRect(s * 0.36, s * 0.34, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.34, s * 0.1, s * 0.08);
    ctx.fillStyle = '#f0d060'; // single owl-gaze eye
    ctx.fillRect(s * 0.46, s * 0.4, s * 0.08, s * 0.06);
    ctx.fillStyle = '#6a3a18'; // one tiny gear wheel
    ctx.fillRect(s * 0.5, s * 0.6, s * 0.06, s * 0.06);
    ctx.fillStyle = '#c88a3a'; // four folding wing-tips
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.7, s * 0.4, s * 0.08, s * 0.06);
  }

  private drawModronDuodrone(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // two-faced servitor clicking through infinite toil
    ctx.fillStyle = flash || '#a8752e'; // two-block brass body
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.36);
    ctx.fillStyle = '#8a5a1e'; // waist seam
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.05);
    ctx.fillStyle = '#c8903c'; // owl-face twin eyes
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.55, s * 0.36, s * 0.05, s * 0.05);
    ctx.fillStyle = '#f0d060'; // double-order glint
    ctx.fillRect(s * 0.42, s * 0.38, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.56, s * 0.38, s * 0.03, s * 0.03);
    ctx.fillStyle = '#6a3a18'; // two hammer hands
    ctx.fillRect(s * 0.16, s * 0.5, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.76, s * 0.5, s * 0.08, s * 0.06);
    ctx.fillStyle = '#c8903c'; // stubby twin legs
    ctx.fillRect(s * 0.34, s * 0.66, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.1, s * 0.1);
  }

  private drawModronTridrone(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // tireless three-faced worker sawing harmony
    ctx.fillStyle = flash || '#b07a2e'; // triple-block brass frame
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.48, s * 0.4);
    ctx.fillStyle = '#8f601e'; // tri-seam plates
    ctx.fillRect(s * 0.28, s * 0.36, s * 0.44, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.52, s * 0.44, s * 0.05);
    ctx.fillStyle = '#d8a246'; // three stacking faces
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.08);
    ctx.fillRect(s * 0.36, s * 0.58, s * 0.28, s * 0.06);
    ctx.fillStyle = '#f0d060'; // three gear-eyes
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.6, s * 0.04, s * 0.04);
    ctx.fillStyle = '#6a3a14'; // three folding arms
    ctx.fillRect(s * 0.12, s * 0.42, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.76, s * 0.42, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.44, s * 0.7, s * 0.12, s * 0.05);
  }

  private drawModronQuadrone(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // blocky four-faced soldier pivoting perfectly
    ctx.fillStyle = flash || '#b08030'; // squarish four-block brass
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.44, s * 0.42);
    ctx.fillStyle = '#8f6220'; // four panel seams
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.4, s * 0.05);
    ctx.fillStyle = '#d8a850'; // crossbow-clicking four-face
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.1);
    ctx.fillStyle = '#6a3a16'; // serious gear slot
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.08, s * 0.06);
    ctx.fillStyle = '#f0d060'; // four burning eyes
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.03, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.32, s * 0.03, s * 0.04);
    ctx.fillStyle = '#8a5a1e'; // crossbow of the phase
    ctx.fillRect(s * 0.7, s * 0.44, s * 0.14, s * 0.05);
    ctx.fillStyle = '#d8a850'; // four square legs
    ctx.fillRect(s * 0.32, s * 0.66, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.66, s * 0.06, s * 0.08);
  }

  private drawModronPentadrone(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // five-sided law-sergeant concussive-blasting
    ctx.fillStyle = flash || '#c0882e'; // five-wedge brass crown
    ctx.beginPath();
    ctx.moveTo(s * 0.28, s * 0.28);
    ctx.lineTo(s * 0.72, s * 0.28);
    ctx.lineTo(s * 0.78, s * 0.44);
    ctx.lineTo(s * 0.5, s * 0.6);
    ctx.lineTo(s * 0.22, s * 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#a06a1e'; // five panel seams
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.32, s * 0.05);
    ctx.fillStyle = '#e0b040'; // five-point face band
    ctx.fillRect(s * 0.4, s * 0.38, s * 0.2, s * 0.06);
    ctx.fillStyle = '#f0d060'; // starburst of eyes
    ctx.fillRect(s * 0.42, s * 0.4, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.4, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.5, s * 0.04, s * 0.03);
    ctx.fillStyle = '#8a5a1e'; // concussive blast cone
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.3, s * 0.08, s * 0.12);
  }

  private drawModronHexton(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // heavy thrice-shouldered tower-modron
    ctx.fillStyle = flash || '#b08030'; // heavy six-block frame
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.38);
    ctx.fillStyle = '#8f6220'; // heavy plate seams
    ctx.fillRect(s * 0.28, s * 0.38, s * 0.44, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.54, s * 0.44, s * 0.05);
    ctx.fillStyle = '#6a4018'; // stacked command planes
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.28, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.32, s * 0.44, s * 0.14, s * 0.06);
    ctx.fillStyle = '#f0d060'; // six-layer gear eyes
    ctx.fillRect(s * 0.44, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.36, s * 0.46, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a5a1e'; // triple arm-jade
    ctx.fillRect(s * 0.12, s * 0.4, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.4, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.44, s * 0.68, s * 0.14, s * 0.06);
  }

  private drawModronSepton(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // proud seven-planed overseer, psyche-ring glinting
    ctx.fillStyle = flash || '#c0882e'; // seven-segment brass
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.4);
    ctx.fillStyle = '#a06a1e'; // seven plate seams
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.54, s * 0.4, s * 0.05);
    ctx.fillStyle = '#d8d0e0'; // psyche-ring halo
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.1, s * 0.08, s * 0.08);
    ctx.fillStyle = '#f0d060'; // seven glittering eyes
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.34, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.34, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a5a1e'; // telekinetic command rings
    ctx.fillRect(s * 0.14, s * 0.44, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.78, s * 0.44, s * 0.08, s * 0.05);
  }

  private drawModronOcton(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // flickering eight-sided war-marshal
    ctx.fillStyle = flash || '#b08030'; // eight-facet cube about
    ctx.beginPath();
    ctx.moveTo(s * 0.24, s * 0.3);
    ctx.lineTo(s * 0.76, s * 0.3);
    ctx.lineTo(s * 0.76, s * 0.4);
    ctx.lineTo(s * 0.5, s * 0.62);
    ctx.lineTo(s * 0.24, s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#8f6220'; // oct-facet seams
    ctx.fillRect(s * 0.4, s * 0.44, s * 0.04, s * 0.16);
    ctx.fillStyle = '#f0d868'; // ordered light-array
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.4, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.66, s * 0.4, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.42, s * 0.52, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.52, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a5a1e'; // ordered light-spear
    ctx.fillRect(s * 0.88, s * 0.24, s * 0.04, s * 0.14);
    ctx.fillRect(s * 0.92, s * 0.16, s * 0.04, s * 0.08);
  }

  private drawModronNonomron(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // gliding nine-sided conservator with certainty
    ctx.fillStyle = flash || '#c0903a'; // nine-segment glider
    ctx.beginPath();
    ctx.moveTo(s * 0.24, s * 0.32);
    ctx.lineTo(s * 0.62, s * 0.3);
    ctx.lineTo(s * 0.64, s * 0.6);
    ctx.lineTo(s * 0.38, s * 0.7);
    ctx.lineTo(s * 0.3, s * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#a06e22'; // nine plate seams
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.2, s * 0.05);
    ctx.fillStyle = '#f0e0a0'; // precision no-blank glow
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.1, s * 0.04);
    ctx.fillStyle = '#f0d060'; // nine inlaid rune-eyes
    ctx.fillRect(s * 0.42, s * 0.38, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.38, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.44, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a5a1e'; // precision shears
    ctx.fillRect(s * 0.68, s * 0.44, s * 0.14, s * 0.04);
  }

  private drawModronDecan(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // vaulting ten-sided hierarch, stacked decks
    ctx.fillStyle = flash || '#c8903a'; // great ten-deck tower
    ctx.fillRect(s * 0.22, s * 0.24, s * 0.56, s * 0.46);
    ctx.fillStyle = '#a06e22'; // layered deck seams
    ctx.fillRect(s * 0.24, s * 0.32, s * 0.52, s * 0.05);
    ctx.fillRect(s * 0.24, s * 0.44, s * 0.52, s * 0.05);
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.52, s * 0.05);
    ctx.fillStyle = '#e0b048'; // ten arrayed eye-rows
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.34, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.46, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.46, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.46, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.58, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.58, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.58, s * 0.04, s * 0.05);
    ctx.fillStyle = '#f0d060'; // crown centroid of law
    ctx.fillRect(s * 0.46, s * 0.18, s * 0.08, s * 0.06);
  }


  private drawModronPrimus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // supreme hierarch of the gears, perfect polyhedral avatar
    ctx.fillStyle = flash || '#d8a040'; // great gleaming hierarch crown
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.26);
    ctx.lineTo(s * 0.8, s * 0.26);
    ctx.lineTo(s * 0.76, s * 0.42);
    ctx.lineTo(s * 0.5, s * 0.62);
    ctx.lineTo(s * 0.24, s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b07e26'; // perfect hierarch seams
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.48, s * 0.4, s * 0.05);
    ctx.fillStyle = '#e0b048'; // the thousand faces crown
    ctx.fillRect(s * 0.4, s * 0.6, s * 0.2, s * 0.06);
    ctx.fillStyle = '#f0f0c0'; // ordered composite-crown eyes
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a5a1e'; // grand floating gear-wings
    ctx.fillRect(s * 0.06, s * 0.36, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.84, s * 0.36, s * 0.1, s * 0.1);
    ctx.fillStyle = '#f0e080'; // ordered entropy-seal
    ctx.fillRect(s * 0.46, s * 0.66, s * 0.08, s * 0.08);
  }


  private drawBeetleKing(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // colossal horned insect-warlord of the cracked dunes
    ctx.fillStyle = flash || '#6a3418'; // vast scarab armor shell
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.6, s * 0.36);
    ctx.fillStyle = '#4a2210'; // grooved chieftain scar lines
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.52, s * 0.05);
    ctx.fillRect(s * 0.24, s * 0.54, s * 0.52, s * 0.05);
    ctx.fillStyle = '#8a4520'; // beetling royal head
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.2, s * 0.18);
    ctx.fillStyle = '#8a5a20'; // enormous curved horn
    ctx.fillRect(s * 0.12, s * 0.22, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.22, s * 0.18, s * 0.06, s * 0.16);
    ctx.fillStyle = '#c03020'; // burning warlord eye
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.05, s * 0.05);
    ctx.fillStyle = '#8a4520'; // armored pincers
    ctx.fillRect(s * 0.22, s * 0.3, s * 0.08, s * 0.08);
    ctx.fillStyle = '#4a2210'; // clacking gross legs
    ctx.fillRect(s * 0.26, s * 0.7, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.44, s * 0.7, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.7, s * 0.06, s * 0.08);
  }

  private drawOwlbearAlpha(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // towering king among owlbears, silver-feathered
    ctx.fillStyle = flash || '#8a6a44'; // massive ursine body
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.54, s * 0.34);
    ctx.fillStyle = '#6a4e2e'; // muscle-banded hide
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.46, s * 0.05);
    ctx.fillStyle = '#b8b8c0'; // great owlish head
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.26, s * 0.22);
    ctx.fillStyle = '#c8c8d0'; // feathered ear tufts
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.84, s * 0.12, s * 0.06, s * 0.1);
    ctx.fillStyle = '#f0c030'; // great luminous predator eyes
    ctx.fillRect(s * 0.7, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.82, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillStyle = '#241c10'; // huge hooked beak
    ctx.fillRect(s * 0.76, s * 0.32, s * 0.08, s * 0.06);
    ctx.fillStyle = '#6a4e2e'; // great tearing claws
    ctx.fillRect(s * 0.26, s * 0.68, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.68, s * 0.08, s * 0.1);
  }

  private drawGhastMatriarch(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // withered mother of the grave-feast
    ctx.fillStyle = flash || '#8a6a5a'; // rotting stalksh pale body
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.34);
    ctx.fillStyle = '#6a4c40'; // grave-rot folds
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.05);
    ctx.fillStyle = '#a89080'; // mummied gaunt head
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.22);
    ctx.fillStyle = '#4a2a20'; // hollow sockets
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.06);
    ctx.fillStyle = '#c03020'; // hungry pin-eye
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.58, s * 0.24, s * 0.03, s * 0.03);
    ctx.fillStyle = '#6a4c40'; // tatter grave-shawl
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.08, s * 0.18);
    ctx.fillRect(s * 0.68, s * 0.4, s * 0.08, s * 0.18);
    ctx.fillStyle = '#8a6a5a'; // clubbed claw-fingers
    ctx.fillRect(s * 0.32, s * 0.68, s * 0.08, s * 0.08);
  }

  private drawSkeletonFirelord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // crowned ash-king wreathed in withering embers
    ctx.fillStyle = flash || '#b8a898'; // crowned bare skeleton
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.32, s * 0.3);
    ctx.fillStyle = '#8a7a6a'; // ash-stained bones
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.28, s * 0.05);
    ctx.fillRect(s * 0.36, s * 0.5, s * 0.28, s * 0.05);
    ctx.fillStyle = '#e8e0d0'; // pale bare skull
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.24, s * 0.2);
    ctx.fillStyle = '#c05040'; // ember-burning eye sockets
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.05, s * 0.06);
    ctx.fillStyle = '#f0a030'; // fire-gilt crown
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.46, s * 0.06, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.58, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillStyle = '#c84828'; // fire-clad sword
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.04, s * 0.32);
    ctx.fillStyle = '#f08020'; // cot of embers
    ctx.fillRect(s * 0.74, s * 0.12, s * 0.04, s * 0.1);
  }

  private drawBronzeScout(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // segmented bronze serpent with a latch-jaw coil
    ctx.fillStyle = flash || '#8a6a3a'; // bronze segmented body
    ctx.fillRect(s * 0.2, s * 0.52, s * 0.5, s * 0.12);
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.36, s * 0.12);
    ctx.fillStyle = '#6a4e28'; // segment seams
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.03, s * 0.12);
    ctx.fillRect(s * 0.44, s * 0.52, s * 0.03, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.4, s * 0.03, s * 0.12);
    ctx.fillStyle = '#a8824a'; // head plate
    ctx.fillRect(s * 0.62, s * 0.34, s * 0.22, s * 0.2);
    ctx.fillStyle = '#d8a840'; // glowing sensor eyes
    ctx.fillRect(s * 0.7, s * 0.38, s * 0.05, s * 0.05);
    ctx.fillStyle = '#4a3620'; // latch jaw
    ctx.fillRect(s * 0.78, s * 0.46, s * 0.08, s * 0.05);
  }

  private drawClayGuardian(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // heavy clay sentinel with maker sigils
    ctx.fillStyle = flash || '#b09468'; // fired-clay body
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.42);
    ctx.fillStyle = '#8a7248'; // clay shading
    ctx.fillRect(s * 0.28, s * 0.56, s * 0.44, s * 0.04);
    ctx.fillStyle = '#c8b088'; // broad shoulders
    ctx.fillRect(s * 0.22, s * 0.3, s * 0.56, s * 0.08);
    ctx.fillStyle = '#5a4830'; // blank rune eyes
    ctx.fillRect(s * 0.36, s * 0.36, s * 0.07, s * 0.05);
    ctx.fillRect(s * 0.57, s * 0.36, s * 0.07, s * 0.05);
    ctx.fillStyle = '#e05050'; // burning maker sigil
    ctx.fillRect(s * 0.46, s * 0.46, s * 0.08, s * 0.08);
    ctx.fillStyle = '#8a7248'; // stub legs
    ctx.fillRect(s * 0.32, s * 0.72, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.72, s * 0.12, s * 0.14);
  }

  private drawClockworkHound(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // ticking brass hound mid-chase
    ctx.fillStyle = flash || '#b89a5a'; // brass body
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.18);
    ctx.fillStyle = '#8a7238'; // gear seams
    ctx.fillRect(s * 0.4, s * 0.52, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.52, s * 0.06, s * 0.06);
    ctx.fillStyle = '#b89a5a'; // head
    ctx.fillRect(s * 0.62, s * 0.42, s * 0.2, s * 0.14);
    ctx.fillStyle = '#ffd700'; // locked-on eyes
    ctx.fillRect(s * 0.72, s * 0.45, s * 0.04, s * 0.04);
    ctx.fillStyle = '#5a4820'; // muzzle
    ctx.fillRect(s * 0.78, s * 0.48, s * 0.08, s * 0.04);
    ctx.fillStyle = '#8a7238'; // legs mid-stride
    ctx.fillRect(s * 0.32, s * 0.68, s * 0.05, s * 0.16);
    ctx.fillRect(s * 0.62, s * 0.68, s * 0.05, s * 0.16);
    ctx.fillStyle = '#6a5628'; // raised tail
    ctx.fillRect(s * 0.22, s * 0.44, s * 0.08, s * 0.06);
  }

  private drawIronCobra(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // steel serpent coiled to strike
    ctx.fillStyle = flash || '#7a828c'; // steel coil
    ctx.fillRect(s * 0.3, s * 0.56, s * 0.4, s * 0.14);
    ctx.fillRect(s * 0.4, s * 0.44, s * 0.3, s * 0.12);
    ctx.fillStyle = '#5a626c'; // plate shading
    ctx.fillRect(s * 0.42, s * 0.56, s * 0.03, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.44, s * 0.03, s * 0.12);
    ctx.fillStyle = '#8a929c'; // raised head
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.2, s * 0.14);
    ctx.fillStyle = '#c0f040'; // venom-drip fangs
    ctx.fillRect(s * 0.72, s * 0.4, s * 0.04, s * 0.06);
    ctx.fillStyle = '#e0e8f0'; // cold glint eye
    ctx.fillRect(s * 0.68, s * 0.33, s * 0.04, s * 0.04);
    ctx.fillStyle = '#5a626c'; // tail tip
    ctx.fillRect(s * 0.24, s * 0.58, s * 0.06, s * 0.08);
  }

  private drawStoneDefender(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // crouching gargoyle statue coming alive
    ctx.fillStyle = flash || '#8a8a86'; // weathered stone
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.48, s * 0.32);
    ctx.fillStyle = '#6a6a66'; // stone shadow
    ctx.fillRect(s * 0.26, s * 0.62, s * 0.48, s * 0.04);
    ctx.fillStyle = '#8a8a86'; // crouched wings
    ctx.fillRect(s * 0.14, s * 0.34, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.12, s * 0.22);
    ctx.fillStyle = '#9a9a96'; // gargoyle head
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.2, s * 0.18);
    ctx.fillStyle = '#e0b040'; // waking amber eyes
    ctx.fillRect(s * 0.44, s * 0.27, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.27, s * 0.05, s * 0.05);
    ctx.fillStyle = '#5a5a56'; // grinding jaw
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.12, s * 0.04);
  }

  private drawForceColumn(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // whirling pillar of arcane force
    ctx.fillStyle = flash || '#7ab8f0'; // force core
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.2, s * 0.68);
    ctx.fillStyle = '#a8d8ff'; // inner glow
    ctx.fillRect(s * 0.46, s * 0.2, s * 0.08, s * 0.6);
    ctx.fillStyle = '#5a90c8'; // swirling bands
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.28, s * 0.05);
    ctx.fillRect(s * 0.36, s * 0.48, s * 0.28, s * 0.05);
    ctx.fillRect(s * 0.36, s * 0.66, s * 0.28, s * 0.05);
    ctx.fillStyle = '#d8f0ff'; // crackling tip
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.12, s * 0.06);
  }

  private drawNimblewright(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // slender clockwork duelist
    ctx.fillStyle = flash || '#c8c0a8'; // pale brass frame
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.2, s * 0.34);
    ctx.fillStyle = '#9a9278'; // joint shading
    ctx.fillRect(s * 0.4, s * 0.44, s * 0.2, s * 0.03);
    ctx.fillStyle = '#c8c0a8'; // narrow head
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.12, s * 0.12);
    ctx.fillStyle = '#40c0ff'; // focused optics
    ctx.fillRect(s * 0.46, s * 0.22, s * 0.08, s * 0.03);
    ctx.fillStyle = '#d8d0b8'; // rapier arm
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.04, s * 0.3);
    ctx.fillStyle = '#e8e0d0'; // blade point
    ctx.fillRect(s * 0.63, s * 0.22, s * 0.02, s * 0.08);
    ctx.fillStyle = '#9a9278'; // legs en garde
    ctx.fillRect(s * 0.4, s * 0.64, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.06, s * 0.2);
  }

  private drawSculptureGuard(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // marble warrior stepping from its plinth
    ctx.fillStyle = flash || '#d8d8dc'; // polished marble
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.4, s * 0.4);
    ctx.fillStyle = '#b0b0b8'; // carved drape folds
    ctx.fillRect(s * 0.3, s * 0.46, s * 0.4, s * 0.04);
    ctx.fillStyle = '#e8e8ec'; // classical head
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.16, s * 0.14);
    ctx.fillStyle = '#8a8a92'; // blank stone eyes
    ctx.fillRect(s * 0.45, s * 0.19, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.53, s * 0.19, s * 0.04, s * 0.03);
    ctx.fillStyle = '#c0c0c8'; // chisel-edged blade
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.05, s * 0.36);
    ctx.fillStyle = '#a8a8b0'; // plinth feet
    ctx.fillRect(s * 0.3, s * 0.68, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.68, s * 0.14, s * 0.1);
  }

  private drawRuneGuardian(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // glyph-etched automaton with self-rewriting runes
    ctx.fillStyle = flash || '#5a6a7a'; // dark alloy chassis
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.44, s * 0.42);
    ctx.fillStyle = '#3a4a5a'; // panel lines
    ctx.fillRect(s * 0.28, s * 0.48, s * 0.44, s * 0.03);
    ctx.fillStyle = '#50f0c0'; // burning runes
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.44, s * 0.38, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.36, s * 0.56, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.56, s * 0.05, s * 0.05);
    ctx.fillStyle = '#7ad8f0'; // rune-lit eyes
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.06, s * 0.04);
    ctx.fillStyle = '#5a6a7a'; // heavy legs
    ctx.fillRect(s * 0.32, s * 0.7, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.7, s * 0.12, s * 0.14);
  }

  private drawGolemBattle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // war-forged colossus with siege-ram fists
    ctx.fillStyle = flash || '#6a6f78'; // gunmetal plating
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.52, s * 0.44);
    ctx.fillStyle = '#4a4f58'; // armor seams
    ctx.fillRect(s * 0.24, s * 0.5, s * 0.52, s * 0.05);
    ctx.fillStyle = '#8a8f98'; // pauldrons
    ctx.fillRect(s * 0.16, s * 0.26, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.1, s * 0.12);
    ctx.fillStyle = '#f06040'; // war-fire eyes
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.06, s * 0.05);
    ctx.fillStyle = '#8a8f98'; // piston fists
    ctx.fillRect(s * 0.12, s * 0.42, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.76, s * 0.42, s * 0.12, s * 0.14);
    ctx.fillStyle = '#4a4f58'; // siege legs
    ctx.fillRect(s * 0.3, s * 0.7, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.7, s * 0.14, s * 0.16);
  }

  private drawGhoulKing(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // pale gaunt sovereign of the catacomb-seat
    ctx.fillStyle = flash || '#9a7a5a'; // gaunt hungry lich-form
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.34);
    ctx.fillStyle = '#7a5c3e'; // palatial grave-cloth
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.54, s * 0.36, s * 0.05);
    ctx.fillStyle = '#c8b090'; // pale kingly face
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.22);
    ctx.fillStyle = '#c03020'; // blood-hungry king eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillStyle = '#e8d8c0'; // long royal fangs
    ctx.fillRect(s * 0.46, s * 0.34, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.34, s * 0.03, s * 0.06);
    ctx.fillStyle = '#8a6a4a'; // bone-amber crown
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.46, s * 0.06, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.08, s * 0.08, s * 0.08);
    ctx.fillStyle = '#6a4c30'; // court scepter of bone
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.05, s * 0.3);
  }

  private drawBansheeMatriarch(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // spectral mother of a thousand wails
    ctx.fillStyle = flash || '#a8c0d0'; // streaming spectral gown
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.4);
    ctx.fillStyle = '#8098a8'; // falling-wail shawl
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillStyle = '#c8d8e4'; // pale unearthly face
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.2);
    ctx.fillStyle = '#e02830'; // eternally crying eyes
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.06, s * 0.06);
    ctx.fillStyle = '#10202a'; // open wailing mouth
    ctx.fillRect(s * 0.44, s * 0.3, s * 0.12, s * 0.04);
    ctx.fillStyle = '#8898a8'; // trailing hair veils
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.3, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.3, s * 0.3, s * 0.08);
    ctx.fillStyle = '#c02830'; // glowing scream threads
    ctx.fillRect(s * 0.2, s * 0.7, s * 0.5, s * 0.04);
  }

  private drawZombieEmpress(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // jewel-crowned horror ruling the risen horde
    ctx.fillStyle = flash || '#7a6a5a'; // regal rotting frame
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.34);
    ctx.fillStyle = '#5a4c3e'; // funeral-gold toad
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillStyle = '#a09080'; // decayed regal face
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.36, s * 0.22);
    ctx.fillStyle = '#3a2c20'; // dead serene sockets
    ctx.fillRect(s * 0.38, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillStyle = '#d8c048'; // jewel-gold empress crown
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.46, s * 0.06, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.08, s * 0.08, s * 0.08);
    ctx.fillStyle = '#c03048'; // ruby rising gem
    ctx.fillRect(s * 0.48, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillStyle = '#6a5a4e'; // swaying empress sleeves
    ctx.fillRect(s * 0.22, s * 0.42, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.72, s * 0.42, s * 0.06, s * 0.16);
  }

  private drawMummyFirelord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // desiccated sun-priest wrapped in scorching linen
    ctx.fillStyle = flash || '#c8b888'; // scorched linen body
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.36);
    ctx.fillStyle = '#a0906a'; // wrapped plank seam
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.4, s * 0.05);
    ctx.fillStyle = '#e0d4a8'; // wrapped sun-priest head
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.22);
    ctx.fillStyle = '#f06020'; // fire-curse sockets
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillStyle = '#c03020'; // ash gold sun-crown
    ctx.fillRect(s * 0.36, s * 0.08, s * 0.28, s * 0.05);
    ctx.fillStyle = '#f08020'; // scorching hand-flame
    ctx.fillRect(s * 0.7, s * 0.36, s * 0.06, s * 0.08);
    ctx.fillStyle = '#f08020'; // flaring sand-cry
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.08, s * 0.03);
  }

  private drawBarrowMoundKing(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // hollow barrow-lord antler-crowned from grave-goods
    ctx.fillStyle = flash || '#6a5a3a'; // burial-mound armor bulk
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.42);
    ctx.fillStyle = '#503f24'; // plated barrow-iron
    ctx.fillRect(s * 0.28, s * 0.38, s * 0.44, s * 0.06);
    ctx.fillRect(s * 0.28, s * 0.54, s * 0.44, s * 0.06);
    ctx.fillStyle = '#7a6844'; // earthen hollow head
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.24);
    ctx.fillStyle = '#d8c8a0'; // great antler crown
    ctx.fillRect(s * 0.24, s * 0.06, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.56, s * 0.06, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.4, s * 0.02, s * 0.12, s * 0.14);
    ctx.fillStyle = '#264050'; // grave-watch eye candles
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillStyle = '#c84828'; // crown of grave-fire
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.16, s * 0.04);
    ctx.fillStyle = '#8a3a1e'; // great spear of burial
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.05, s * 0.5);
  }

  private drawHollowDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // colossal draconic husk stripped to black bone
    ctx.fillStyle = flash || '#16181c'; // vast ossified skeleton
    ctx.fillRect(s * 0.16, s * 0.36, s * 0.68, s * 0.34);
    ctx.fillStyle = '#0a0c10'; // empty rib gaps
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.42, s * 0.24, s * 0.06);
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.2, s * 0.06);
    ctx.fillStyle = '#2c3238'; // colossal black-skull head
    ctx.fillRect(s * 0.62, s * 0.16, s * 0.3, s * 0.26);
    ctx.fillStyle = '#10141a'; // deep hollow sockets
    ctx.fillRect(s * 0.68, s * 0.2, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.8, s * 0.2, s * 0.06, s * 0.1);
    ctx.fillStyle = '#4860c8'; // cold un-righteous eye
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.82, s * 0.22, s * 0.03, s * 0.06);
    ctx.fillStyle = '#1a1e24'; // bone crown horns
    ctx.fillRect(s * 0.64, s * 0.08, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.84, s * 0.08, s * 0.06, s * 0.12);
    ctx.fillStyle = '#2c3238'; // great bone wings
    ctx.fillRect(s * 0.04, s * 0.3, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.82, s * 0.3, s * 0.14, s * 0.28);
  }

  private drawWoodColossus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // titan of braided oak and bronze root
    ctx.fillStyle = flash || '#5a4a30'; // vast braided wooden body
    ctx.fillRect(s * 0.22, s * 0.3, s * 0.56, s * 0.4);
    ctx.fillStyle = '#3a2e1e'; // packed bark seams
    ctx.fillRect(s * 0.26, s * 0.38, s * 0.48, s * 0.05);
    ctx.fillRect(s * 0.26, s * 0.54, s * 0.48, s * 0.05);
    ctx.fillStyle = '#7a5a30'; // bronze-root shoulder plates
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.16, s * 0.14);
    ctx.fillRect(s * 0.6, s * 0.26, s * 0.16, s * 0.14);
    ctx.fillStyle = '#6a5230'; // moss-crowned great head
    ctx.fillRect(s * 0.34, s * 0.14, s * 0.32, s * 0.2);
    ctx.fillStyle = '#8a7a3a'; // bronze-glow eye runes
    ctx.fillRect(s * 0.4, s * 0.18, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.18, s * 0.06, s * 0.06);
    ctx.fillStyle = '#3a2e1e'; // arboring arm-struts
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.4, s * 0.1, s * 0.2);
    ctx.fillStyle = '#2c2418'; // trunk-column legs
    ctx.fillRect(s * 0.3, s * 0.7, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.7, s * 0.14, s * 0.1);
  }

  private drawTreantKing(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // elder of elders throned in fable as a redwood
    ctx.fillStyle = flash || '#5a4030'; // colossal oak-trunk body
    ctx.fillRect(s * 0.24, s * 0.32, s * 0.52, s * 0.38);
    ctx.fillStyle = '#3e2c20'; // massive gnarled bark seams
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.44, s * 0.06);
    ctx.fillRect(s * 0.28, s * 0.56, s * 0.44, s * 0.06);
    ctx.fillStyle = '#4a3820'; // wild branching crown
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.18);
    ctx.fillStyle = '#245a24'; // deep living leaf-thicket
    ctx.fillRect(s * 0.12, s * 0.08, s * 0.2, s * 0.16);
    ctx.fillRect(s * 0.68, s * 0.08, s * 0.2, s * 0.16);
    ctx.fillStyle = '#102012'; // deep ageful furrow eyes
    ctx.fillRect(s * 0.36, s * 0.36, s * 0.07, s * 0.07);
    ctx.fillRect(s * 0.56, s * 0.36, s * 0.07, s * 0.07);
    ctx.fillStyle = '#245a24'; // moss beard-rivulets
    ctx.fillRect(s * 0.4, s * 0.56, s * 0.2, s * 0.1);
    ctx.fillStyle = '#3a2a1a'; // trunk-roots hooves
    ctx.fillRect(s * 0.3, s * 0.7, s * 0.16, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.7, s * 0.16, s * 0.12);
  }

  private drawLichArchmageQueen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sovereign lich fused her crown to her skull
    ctx.fillStyle = flash || '#3a2a4a'; // regal necrotic darkrobes
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.38);
    ctx.fillStyle = '#241830'; // gold-fused trim
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillStyle = '#d8dce0'; // unbitten skull-pale face
    ctx.fillRect(s * 0.32, s * 0.14, s * 0.36, s * 0.24);
    ctx.fillStyle = '#c8b448'; // fused golden arch-crown
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.4, s * 0.02, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.06, s * 0.1, s * 0.08);
    ctx.fillStyle = '#c03040'; // necromantic court fire
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillStyle = '#6a4a20'; // great queen's scepter
    ctx.fillRect(s * 0.76, s * 0.2, s * 0.05, s * 0.4);
    ctx.fillStyle = '#f0d060'; // scepter crown-gem
    ctx.fillRect(s * 0.72, s * 0.12, s * 0.12, s * 0.1);
  }

  private drawDireWolfWyrm(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // legendary scaled hound grown to dragon-size
    ctx.fillStyle = flash || '#5a5a6a'; // scaled wolf-dragon body
    ctx.fillRect(s * 0.18, s * 0.34, s * 0.4, s * 0.3);
    ctx.fillStyle = '#3c3c4c'; // scale-plate seams
    ctx.fillRect(s * 0.22, s * 0.42, s * 0.32, s * 0.05);
    ctx.fillRect(s * 0.22, s * 0.54, s * 0.32, s * 0.05);
    ctx.fillStyle = '#6a6a7a'; // great scaled wolf head
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.28, s * 0.22);
    ctx.fillStyle = '#4a4a5a'; // great antler-like wolf ears
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.08, s * 0.1);
    ctx.fillStyle = '#f0e0c0'; // cold pale feral eyes
    ctx.fillRect(s * 0.62, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e8e8e8'; // layered blade-fangs
    ctx.fillRect(s * 0.66, s * 0.36, s * 0.04, s * 0.07);
    ctx.fillRect(s * 0.78, s * 0.36, s * 0.04, s * 0.07);
    ctx.fillStyle = '#3c3c4c'; // scaled hunting haunches
    ctx.fillRect(s * 0.24, s * 0.64, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.46, s * 0.64, s * 0.12, s * 0.12);
    ctx.fillStyle = '#5a5a6a'; // spiked wyrm tail
    ctx.fillRect(s * 0.14, s * 0.56, s * 0.08, s * 0.08);
  }

  /**
   * A boggle is mostly head: a wide dome with the ears out flat, pale eyes
   * and a grin from one ear to the other, on a squat body whose arms are so
   * long the knuckles rest on the floor — in a puddle of its own oil.
   */
  private drawBoggle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#6f8a2c';
    const lit = flash || '#95b048';
    const dark = flash || '#3f5218';
    const oil = flash || '#1b1a22';
    // The puddle first, so the feet stand in it
    r(oil, 5, 24, 18, 3);
    r(flash || '#3a3848', 7, 24, 4, 1);
    // Overlong arms, knuckles on the floor
    r(skin, 3, 12, 3, 8);
    r(skin, 2, 19, 3, 5);
    r(dark, 1, 23, 4, 2);
    r(skin, 22, 12, 3, 8);
    r(skin, 23, 19, 3, 5);
    r(dark, 23, 23, 4, 2);
    // Squat body on bandy legs
    r(skin, 8, 13, 12, 8);
    r(lit, 8, 13, 12, 1);
    r(dark, 8, 19, 12, 2);
    r(skin, 9, 21, 3, 4);
    r(skin, 16, 21, 3, 4);
    // The head is most of the creature
    r(skin, 6, 3, 16, 10);
    r(lit, 6, 3, 16, 1);
    r(lit, 6, 4, 1, 8);
    r(dark, 6, 11, 16, 2);
    r(skin, 2, 6, 4, 3);
    r(skin, 22, 6, 4, 3);
    r(dark, 2, 8, 4, 1);
    r(dark, 22, 8, 4, 1);
    // Big pale eyes, and the grin
    r(flash || '#e8ffe8', 8, 5, 4, 3);
    r(flash || '#e8ffe8', 16, 5, 4, 3);
    r(flash || '#1c2a10', 10, 6, 2, 2);
    r(flash || '#1c2a10', 16, 6, 2, 2);
    r(dark, 8, 9, 12, 2);
    r(flash || '#f2f6e8', 9, 9, 1, 1);
    r(flash || '#f2f6e8', 12, 9, 1, 1);
    r(flash || '#f2f6e8', 15, 9, 1, 1);
    r(flash || '#f2f6e8', 18, 9, 1, 1);
    // Oil dripping off it
    r(oil, 5, 20, 1, 4);
    r(oil, 25, 21, 1, 3);
    r(oil, 13, 21, 2, 3);
  }

  private drawTreantSapling(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a9a4a'; // young leaf-bark green
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = '#5c3a20'; // trunk
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.2, s * 0.3);
    ctx.fillStyle = '#4a2e18';
    ctx.fillRect(s * 0.46, s * 0.38, s * 0.06, s * 0.06); // bark knot
    ctx.fillStyle = c; // leafy canopy
    ctx.fillRect(s * 0.28, s * 0.16, s * 0.44, s * 0.22);
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.2, s * 0.1);
    ctx.fillRect(s * 0.36, s * 0.36, s * 0.28, s * 0.04); // low branches
    ctx.fillStyle = '#4a2e18'; // branch arms
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.16, s * 0.42, s * 0.08, s * 0.06);
    ctx.fillStyle = '#e8e0a0'; // sapling eyes
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.3, s * 0.05, s * 0.05);
  }

  private drawBoggart(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5c6b4a'; // mossy house-fey
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.32, s * 0.2, s * 0.24); // body
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.1, s * 0.12); // arm
    ctx.fillRect(s * 0.52, s * 0.36, s * 0.1, s * 0.12); // arm
    ctx.fillRect(s * 0.36, s * 0.56, s * 0.08, s * 0.12); // leg
    ctx.fillRect(s * 0.48, s * 0.56, s * 0.08, s * 0.12); // leg
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.16, s * 0.18); // head
    ctx.fillStyle = '#f0c060'; // wide manic grin
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.12, s * 0.06);
    ctx.fillStyle = '#ff6a4a'; // wild eyes
    ctx.fillRect(s * 0.41, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.47, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = c; ctx.fillRect(s * 0.37, s * 0.06, s * 0.05, s * 0.06); // stray hair tuft
  }

  private drawSalamanderSpawn(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#e05a2a'; // molten fire-serpent
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.38, s * 0.4, s * 0.18); // coiled serpent torso
    ctx.fillRect(s * 0.68, s * 0.42, s * 0.12, s * 0.08); // tail
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.08, s * 0.06); // neck
    ctx.fillRect(s * 0.18, s * 0.22, s * 0.18, s * 0.2); // head
    ctx.fillRect(s * 0.08, s * 0.28, s * 0.1, s * 0.06); // snout
    ctx.fillStyle = '#ffd24a'; // molten cracks
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.52, s * 0.42, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.06, s * 0.04); // eye
    ctx.fillStyle = '#fff';
    ctx.fillRect(s * 0.2, s * 0.12, s * 0.1, s * 0.04); // rising heat wisp
  }

  private drawVrockLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a3a2a'; // huge vulture-fiend
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.22, s * 0.26); // body
    ctx.fillStyle = '#8a4a3a'; // feathered underbelly
    ctx.fillRect(s * 0.38, s * 0.42, s * 0.14, s * 0.14);
    ctx.fillStyle = '#4a2a20'; // wings
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.14, s * 0.3);
    ctx.fillStyle = c; ctx.fillRect(s * 0.4, s * 0.1, s * 0.12, s * 0.1); // head
    ctx.fillRect(s * 0.5, s * 0.14, s * 0.1, s * 0.06); // beak upper
    ctx.fillStyle = '#e0c060'; ctx.fillRect(s * 0.3, s * 0.28, s * 0.04, s * 0.04); // eye
    ctx.fillStyle = '#b04030'; // talon feet
    ctx.fillRect(s * 0.36, s * 0.56, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.48, s * 0.56, s * 0.08, s * 0.1);
    ctx.fillStyle = '#c0c060'; // spore motes
    ctx.fillRect(s * 0.64, s * 0.5, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.28, s * 0.52, s * 0.04, s * 0.04);
  }

  private drawChasmeQueen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#4a2a1a'; // bloated ruin-fly
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.34, s * 0.28, s * 0.22); // fat body
    ctx.fillStyle = '#7a4a2a'; // wing sheen
    ctx.fillRect(s * 0.16, s * 0.26, s * 0.2, s * 0.3);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.2, s * 0.3);
    ctx.fillStyle = c; ctx.fillRect(s * 0.4, s * 0.16, s * 0.12, s * 0.1); // head
    ctx.fillRect(s * 0.5, s * 0.2, s * 0.1, s * 0.04); // proboscis
    ctx.fillStyle = '#ff4040'; // compound eyes
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = '#e0d0a0'; // segmented stripes
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.2, s * 0.04);
    ctx.fillRect(s * 0.36, s * 0.48, s * 0.2, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.58, s * 0.1, s * 0.08); // feebly twitching leg
  }

  /**
   * A maw demon is a mouth that grew a body: a barrel on stubby legs whose
   * whole front is open jaws, two rows of teeth around a tongue, a pair of
   * pig eyes squeezed in above. It fills the box; the old one was nine
   * pixels of teeth in the middle of it.
   */
  private drawMawDemon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7c4a2c';
    const lit = flash || '#9e6640';
    const dark = flash || '#4e2c16';
    const maw = flash || '#4a1216';
    const tongue = flash || '#b0384a';
    const tooth = flash || '#f0ece0';
    const eye = flash || '#f0c040';
    // Stubby legs and claws, short arms at the sides
    r(hide, 6, 22, 5, 4);
    r(hide, 17, 22, 5, 4);
    r(dark, 6, 25, 5, 1);
    r(dark, 17, 25, 5, 1);
    for (const x of [6, 8, 10, 17, 19, 21]) r(tooth, x, 26, 1, 1);
    r(hide, 3, 14, 3, 6);
    r(hide, 22, 14, 3, 6);
    r(dark, 3, 14, 1, 6);
    for (const x of [3, 5, 22, 24]) r(tooth, x, 20, 1, 1);
    // Body: a barrel that is mostly mouth
    r(hide, 6, 5, 16, 17);
    r(hide, 5, 8, 18, 11);
    r(lit, 7, 5, 14, 1);
    r(dark, 6, 21, 16, 1);
    r(dark, 5, 9, 1, 9);
    // Spines on the crown
    r(dark, 7, 3, 2, 3);
    r(dark, 11, 2, 2, 3);
    r(dark, 15, 2, 2, 3);
    r(dark, 19, 3, 2, 3);
    // Pig eyes above the maw
    r(eye, 9, 7, 2, 2);
    r(eye, 17, 7, 2, 2);
    r(flash || '#2a1006', 10, 7, 1, 2);
    r(flash || '#2a1006', 17, 7, 1, 2);
    // The maw: gullet, tongue, teeth above and below
    r(maw, 7, 10, 14, 9);
    r(tongue, 11, 15, 6, 3);
    r(flash || '#7a2432', 11, 15, 6, 1);
    r(tooth, 8, 10, 2, 3);
    r(tooth, 11, 10, 2, 2);
    r(tooth, 14, 10, 2, 2);
    r(tooth, 17, 10, 2, 3);
    r(tooth, 8, 16, 2, 3);
    r(tooth, 12, 17, 2, 2);
    r(tooth, 15, 17, 2, 2);
    r(tooth, 19, 16, 2, 3);
  }

  private drawGoristroAlpha(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a4030'; // minotaur-god
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.28, s * 0.3); // bulk body
    ctx.fillRect(s * 0.36, s * 0.12, s * 0.18, s * 0.2); // head
    ctx.fillRect(s * 0.24, s * 0.18, s * 0.14, s * 0.1); // homle (left)
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.14, s * 0.1); // horn (right)
    ctx.fillRect(s * 0.2, s * 0.32, s * 0.1, s * 0.24); // left arm
    ctx.fillRect(s * 0.58, s * 0.32, s * 0.12, s * 0.24); // right arm
    ctx.fillStyle = '#f0c0a0'; // bone spear
    ctx.fillRect(s * 0.6, s * 0.34, s * 0.05, s * 0.24);
    ctx.fillStyle = '#2a2a3a'; // horns
    ctx.fillRect(s * 0.24, s * 0.18, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.08, s * 0.04);
    ctx.fillStyle = '#e00'; // burning eyes
    ctx.fillRect(s * 0.39, s * 0.18, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.18, s * 0.05, s * 0.04);
    ctx.fillStyle = c; ctx.fillRect(s * 0.34, s * 0.6, s * 0.12, s * 0.1); // leg
    ctx.fillRect(s * 0.48, s * 0.6, s * 0.12, s * 0.1); // leg
  }

  private drawDeathDogPackmaster(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a6a7a'; // two-headed plague hound
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.36, s * 0.16); // long body
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.16, s * 0.14); // head 1
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.16, s * 0.14); // head 2
    ctx.fillRect(s * 0.14, s * 0.34, s * 0.1, s * 0.04); // snout 1
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.1, s * 0.04); // snout 2
    ctx.fillRect(s * 0.26, s * 0.58, s * 0.08, s * 0.1); // foreleg
    ctx.fillRect(s * 0.62, s * 0.58, s * 0.08, s * 0.1); // hind leg
    ctx.fillRect(s * 0.6, s * 0.32, s * 0.24, s * 0.06); // body ridge
    ctx.fillStyle = '#f00'; // glowing plague eyes
    ctx.fillRect(s * 0.27, s * 0.38, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.27, s * 0.44, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.57, s * 0.38, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.57, s * 0.44, s * 0.04, s * 0.03);
  }

  private drawGiantSlaadLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a9a5a'; // Limbo toad-fiend
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.32, s * 0.3, s * 0.18); // squat body
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.2, s * 0.16); // head
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.08, s * 0.06); // crown of bone
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.14, s * 0.1); // foreleg
    ctx.fillRect(s * 0.5, s * 0.5, s * 0.14, s * 0.1); // foreleg
    ctx.fillStyle = '#8a5a2a'; // spores
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.42, s * 0.08, s * 0.08);
    ctx.fillStyle = '#ff4040'; // eyes
    ctx.fillRect(s * 0.37, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.47, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillStyle = c; ctx.fillRect(s * 0.36, s * 0.26, s * 0.16, s * 0.04); // wide mouth
  }

  private drawWyrmrock(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a5a3a'; // molten dragon-ooze
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = '#5a3a2a'; // encrusted rock
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.34, s * 0.24);
    ctx.fillStyle = c; // molten gut
    ctx.fillRect(s * 0.34, s * 0.38, s * 0.26, s * 0.16);
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.18, s * 0.2); // head dome
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.1, s * 0.08); // horn stub
    ctx.fillRect(s * 0.52, s * 0.22, s * 0.1, s * 0.08); // horn stub
    ctx.fillStyle = '#ff8a2a'; // glowing cracks
    ctx.fillRect(s * 0.38, s * 0.28, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.5, s * 0.4, s * 0.06, s * 0.16);
    ctx.fillStyle = '#ffe24a'; // molten eye
    ctx.fillRect(s * 0.44, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#2a1a0a'; // ooze drips
    ctx.fillRect(s * 0.4, s * 0.56, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.56, s * 0.06, s * 0.06);
  }

  /**
   * The balhannoth is a bell of a mantle hanging in the dark with a ring of
   * teeth open on the underside, four tentacles reaching down from it, and
   * a lure glowing under the maw.
   */
  private drawBalhannothLurker(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#3a3a5a';
    const lit = flash || '#56567a';
    const dark = flash || '#1e1e30';
    const teeth = flash || '#f0e8d0';
    // Mantle
    r(hide, 8, 2, 12, 6);
    r(hide, 5, 6, 18, 8);
    r(hide, 3, 12, 22, 7);
    r(lit, 9, 2, 10, 1);
    r(lit, 5, 7, 1, 6);
    r(lit, 3, 13, 1, 5);
    r(dark, 3, 17, 22, 2);
    r(flash || '#8a6a4a', 7, 9, 2, 1);
    r(flash || '#8a6a4a', 18, 7, 2, 1);
    r(flash || '#8a6a4a', 12, 5, 1, 1);
    // The maw
    r(dark, 5, 14, 18, 5);
    r(teeth, 6, 14, 1, 2);
    r(teeth, 9, 14, 1, 3);
    r(teeth, 12, 14, 1, 2);
    r(teeth, 15, 14, 1, 3);
    r(teeth, 18, 14, 1, 2);
    r(teeth, 21, 14, 1, 3);
    r(teeth, 7, 18, 1, 1);
    r(teeth, 11, 18, 1, 1);
    r(teeth, 16, 18, 1, 1);
    r(teeth, 20, 18, 1, 1);
    // Tentacles
    r(hide, 4, 19, 2, 5);
    r(hide, 3, 23, 2, 3);
    r(hide, 9, 19, 2, 6);
    r(hide, 10, 24, 2, 3);
    r(hide, 16, 19, 2, 6);
    r(hide, 15, 24, 2, 3);
    r(hide, 21, 19, 2, 5);
    r(hide, 22, 23, 2, 3);
    // The lure
    r(flash || '#40c0ff', 13, 20, 2, 3);
    r(flash || '#c8f0ff', 13, 20, 1, 1);
  }

  private drawGlimmerscaleDrake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#9ac0e0'; // mirror-bellied drake
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.26, s * 0.26); // body
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.14, s * 0.14); // head
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.06, s * 0.06); // crest
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.14, s * 0.2); // wing
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.16, s * 0.2); // wing
    ctx.fillRect(s * 0.58, s * 0.12, s * 0.16, s * 0.14); // raised tail
    ctx.fillStyle = '#e0f8ff'; // glimmering belly scales
    ctx.fillRect(s * 0.36, s * 0.42, s * 0.18, s * 0.1);
    ctx.fillRect(s * 0.36, s * 0.42, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.42, s * 0.04, s * 0.1);
    ctx.fillStyle = '#ff8a4a'; // drake eyes
    ctx.fillRect(s * 0.45, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.51, s * 0.22, s * 0.04, s * 0.04);
  }

  private drawCandleWisp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const wax = flash || '#e8dcc0';
    const waxLit = flash || '#fbf5e6';
    const waxDark = flash || '#b0a17c';
    const flame = flash || '#ffb02e';
    const core = flash || '#fff0a8';
    const hot = flash || '#ff6a1e';
    // A stub of candle that got up and walked. Wax runs down its sides
    // and hardens into the two little arms it drags along.
    r(wax, 10, 13, 8, 11);
    r(waxLit, 10, 13, 8, 1);
    r(waxDark, 16, 14, 2, 10);
    r(wax, 8, 16, 2, 7);
    r(wax, 18, 18, 2, 5);
    r(waxDark, 8, 22, 2, 2);
    r(waxDark, 18, 22, 2, 2);
    r(wax, 7, 23, 14, 3);
    r(waxDark, 7, 25, 14, 1);
    r(wax, 4, 17, 4, 2);
    r(wax, 20, 19, 4, 2);
    // The flame it wears for a head
    r(hot, 10, 4, 8, 10);
    r(flame, 11, 4, 6, 9);
    r(core, 12, 6, 4, 5);
    r(flame, 12, 0, 4, 5);
    r(core, 13, 1, 2, 4);
    r(waxLit, 13, 6, 2, 2);
    // Two dark eyes down in the wax
    r(flash || '#4a3a20', 11, 16, 2, 2);
    r(flash || '#4a3a20', 15, 16, 2, 2);
    r(waxDark, 12, 19, 4, 1);
    // Sparks it sheds as it drifts
    r(flame, 2, 9, 2, 2);
    r(core, 24, 7, 2, 2);
    r(flame, 25, 13, 2, 2);
  }

  /**
   * A crone under a wide pointed hat, in a robe belted with living vine,
   * leaning on a gnarled staff that has sprouted. The hat is the outline:
   * the hags beside her are bareheaded, and nothing else in the set wears
   * one.
   */
  private drawForestWitch(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const robe = flash || '#2f4a2c';
    const robeLit = flash || '#476a42';
    const robeDk = flash || '#1e321c';
    const skin = flash || '#a89060';
    const skinDk = flash || '#7c6a40';
    const hat = flash || '#3a2f22';
    const hatLit = flash || '#5a4a34';
    const hair = flash || '#b8b4a4';
    const leaf = flash || '#5fae3a';
    const leafLit = flash || '#8fd85a';
    const eye = flash || '#ffe040';
    // Gnarled staff with a living sprout, held out on the left
    r(flash || '#6a4a2a', 3, 5, 2, 21);
    r(flash || '#8a6a3e', 3, 5, 1, 21);
    r(flash || '#6a4a2a', 2, 9, 1, 3);
    r(leaf, 1, 2, 5, 3);
    r(leafLit, 2, 1, 3, 1);
    r(leafLit, 1, 2, 1, 1);
    // Robe, flaring to the hem, vine belt, leaves caught in it
    r(robe, 8, 14, 12, 8);
    r(robe, 6, 22, 16, 5);
    r(robeLit, 8, 14, 12, 1);
    r(robeDk, 6, 26, 16, 1);
    r(robeDk, 8, 14, 1, 8);
    r(robeDk, 6, 22, 1, 5);
    r(leaf, 8, 18, 12, 1);
    r(leafLit, 10, 18, 1, 1);
    r(leafLit, 15, 18, 1, 1);
    r(leaf, 9, 23, 2, 2);
    r(leaf, 17, 24, 2, 2);
    // Arms: left to the staff, right clutching a bundle of herbs
    r(robe, 5, 15, 3, 5);
    r(skin, 4, 20, 3, 2);
    r(robe, 20, 15, 3, 6);
    r(skin, 20, 21, 3, 2);
    r(leaf, 21, 23, 4, 2);
    r(flash || '#d05a8a', 22, 23, 1, 1);
    // Head: grey hair falling either side, hooked nose, yellow eyes
    r(hair, 9, 9, 10, 2);
    r(hair, 8, 10, 2, 7);
    r(hair, 18, 10, 2, 7);
    r(skin, 10, 10, 8, 5);
    r(skinDk, 10, 10, 1, 5);
    r(eye, 11, 11, 2, 2);
    r(eye, 15, 11, 2, 2);
    r(flash || '#1a1408', 12, 11, 1, 2);
    r(flash || '#1a1408', 15, 11, 1, 2);
    r(skinDk, 13, 12, 2, 2);
    r(skinDk, 12, 14, 4, 1);
    // Pointed hat with a wide brim and a band
    r(hat, 6, 7, 16, 2);
    r(hatLit, 6, 7, 16, 1);
    r(hat, 10, 4, 8, 3);
    r(hat, 11, 2, 5, 2);
    r(hat, 12, 0, 3, 2);
    r(hatLit, 10, 4, 1, 3);
    r(hatLit, 11, 2, 1, 2);
    r(hatLit, 12, 0, 1, 2);
    r(flash || '#8a6a2a', 10, 6, 8, 1);
  }

  private drawLunarRevenant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a9ab0'; // moon-ghost huntress
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.18, s * 0.28); // spectral cloak body
    ctx.fillStyle = '#b0c8e0'; // shimmer trim
    ctx.fillRect(s * 0.38, s * 0.46, s * 0.18, s * 0.08);
    ctx.fillStyle = c; ctx.fillRect(s * 0.4, s * 0.1, s * 0.14, s * 0.16); // head
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.08, s * 0.04); // bow shoulder
    ctx.fillRect(s * 0.6, s * 0.14, s * 0.05, s * 0.28); // bow string arm
    ctx.fillStyle = '#9ac0e0'; // nocked moonshine arrow
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.14, s * 0.03);
    ctx.fillStyle = '#fff'; // glowing eyes
    ctx.fillRect(s * 0.43, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.49, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#e0e8ff'; // cold lunar aura
    ctx.fillRect(s * 0.32, s * 0.06, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.06, s * 0.06, s * 0.06);
  }

  private drawJackalwere(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#a07840';
    const lit = flash || '#c69c60';
    const dark = flash || '#6d4f22';
    const cloth = flash || '#b8a179';
    // Lean and upright, digitigrade, in desert linen
    r(dark, 9, 21, 3, 4);
    r(dark, 16, 21, 3, 4);
    r(fur, 8, 24, 5, 3);
    r(fur, 16, 24, 5, 3);
    r(cloth, 8, 15, 12, 7);
    r(flash || '#d3c19c', 8, 15, 12, 1);
    r(flash || '#8f7c56', 8, 20, 12, 2);
    r(fur, 9, 11, 10, 5);
    r(lit, 9, 11, 10, 1);
    r(dark, 9, 15, 10, 1);
    // Arms, one holding a khopesh
    r(fur, 5, 12, 4, 7);
    r(fur, 19, 12, 4, 7);
    r(dark, 5, 18, 4, 2);
    r(dark, 19, 18, 4, 2);
    r(flash || '#cfa855', 22, 6, 3, 12);
    r(flash || '#efd489', 22, 6, 1, 12);
    r(flash || '#cfa855', 22, 4, 6, 3);
    r(flash || '#6b4a20', 21, 17, 5, 2);
    // Ruff, and the long jackal head above it
    r(dark, 7, 9, 14, 3);
    r(fur, 9, 3, 9, 7);
    r(lit, 9, 3, 9, 1);
    r(dark, 9, 3, 1, 7);
    r(dark, 17, 6, 8, 4);
    r(flash || '#7a5828', 17, 6, 8, 1);
    r(flash || '#f2ece0', 22, 9, 1, 1);
    r(flash || '#f2ece0', 24, 9, 1, 1);
    r(flash || '#241608', 24, 7, 1, 1);
    // Tall ears, one flicked back
    r(fur, 8, 0, 3, 5);
    r(fur, 14, 0, 3, 5);
    r(dark, 9, 1, 1, 3);
    r(dark, 15, 1, 1, 3);
    // Amber eyes
    r(flash || '#ffd24a', 12, 6, 3, 2);
    r(flash || '#ffd24a', 16, 5, 2, 2);
    r(flash || '#1c1004', 13, 6, 1, 2);
    r(flash || '#1c1004', 16, 5, 1, 2);
  }

  private drawStoneCursed(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7d7d76'; // grave-statue gray
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.26, s * 0.34); // blocky torso
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.12, s * 0.22); // slab legs
    ctx.fillRect(s * 0.52, s * 0.62, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.14, s * 0.18); // chiseled head
    ctx.fillStyle = '#5c5c56'; // cracked shadowing
    ctx.fillRect(s * 0.36, s * 0.44, s * 0.03, s * 0.14); // fissure
    ctx.fillRect(s * 0.55, s * 0.32, s * 0.02, s * 0.1);
    ctx.fillStyle = '#9a9a90'; // worn highlights
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.38, s * 0.34, s * 0.08, s * 0.04);
    ctx.fillStyle = '#3a6a4a'; // petrified moss patch
    ctx.fillRect(s * 0.52, s * 0.58, s * 0.08, s * 0.05);
    ctx.fillStyle = '#d8d8cc'; // faint petrified scream
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.02, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.02, s * 0.04);
  }

  private drawGirallon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d8cfc0'; // pale white ape fur
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.3, s * 0.26); // barrel chest
    ctx.fillRect(s * 0.36, s * 0.56, s * 0.1, s * 0.2); // bowed legs
    ctx.fillRect(s * 0.48, s * 0.56, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.18, s * 0.18); // apish head
    ctx.fillStyle = '#e8e2d4'; // brow ridge
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.14, s * 0.05);
    ctx.fillStyle = '#3a2a1a'; // dark face plate
    ctx.fillRect(s * 0.42, s * 0.19, s * 0.1, s * 0.09);
    ctx.fillStyle = '#e05050'; // red brow glow
    ctx.fillRect(s * 0.43, s * 0.2, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.49, s * 0.2, s * 0.03, s * 0.03);
    ctx.fillStyle = c; // four muscled arms — two visible raised
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.12, s * 0.1); // far arm
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.12, s * 0.1); // near arm
    ctx.fillRect(s * 0.16, s * 0.38, s * 0.08, s * 0.16); // lower far arm
    ctx.fillRect(s * 0.7, s * 0.38, s * 0.08, s * 0.16); // lower near arm
    ctx.fillStyle = '#2a2a2a'; // black claws
    ctx.fillRect(s * 0.14, s * 0.54, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.54, s * 0.06, s * 0.05);
  }

  private drawMindwitness(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#b48ad0'; // sickly brain-lilac
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.32); // floating brain dome
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.48, s * 0.12); // brain lobes
    ctx.fillStyle = '#8a5aa8'; // brain folds
    ctx.fillRect(s * 0.36, s * 0.24, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.46, s * 0.22, s * 0.04, s * 0.24);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.04, s * 0.2);
    ctx.fillStyle = '#2a1a3a'; // stalk sockets
    ctx.fillRect(s * 0.34, s * 0.46, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.58, s * 0.46, s * 0.08, s * 0.06);
    ctx.fillStyle = '#e8e0f0'; // four eyestalks
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.04, s * 0.14);
    ctx.fillRect(s * 0.42, s * 0.52, s * 0.04, s * 0.18);
    ctx.fillRect(s * 0.54, s * 0.52, s * 0.04, s * 0.18);
    ctx.fillRect(s * 0.66, s * 0.52, s * 0.04, s * 0.14);
    ctx.fillStyle = '#ff4a4a'; // stalked eyes
    ctx.fillRect(s * 0.29, s * 0.5, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.41, s * 0.68, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.68, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.65, s * 0.5, s * 0.05, s * 0.05);
    ctx.fillStyle = '#d0c8e8'; // beaked maw beneath
    ctx.fillRect(s * 0.44, s * 0.74, s * 0.12, s * 0.08);
    ctx.fillStyle = '#5a3a7a'; // anti-magic cone shimmer
    ctx.fillRect(s * 0.2, s * 0.1, s * 0.06, s * 0.06);
  }

  private drawAbominableYeti(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c8dce8'; // glacier-white pelt
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.52, s * 0.34); // massive shaggy torso
    ctx.fillRect(s * 0.3, s * 0.6, s * 0.16, s * 0.22); // thick legs
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.16, s * 0.22);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.22, s * 0.2); // low-slung ape head
    ctx.fillStyle = '#e8f4fa'; // frost-tipped highlights
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.28, s * 0.08, s * 0.1);
    ctx.fillStyle = '#8ab4cc'; // ice-blue maw
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.14, s * 0.08);
    ctx.fillStyle = '#fff'; // jagged fangs
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.2, s * 0.03, s * 0.05);
    ctx.fillStyle = '#4ac0ff'; // icy cold glare
    ctx.fillRect(s * 0.41, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.51, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = c; // hunched sweeping arms
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.34, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.06, s * 0.44, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.84, s * 0.44, s * 0.1, s * 0.2);
    ctx.fillStyle = '#1a2a3a'; // black claws
    ctx.fillRect(s * 0.04, s * 0.62, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.86, s * 0.62, s * 0.08, s * 0.06);
  }

  private drawWarlockGreatOld(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#2a8a7a'; // deep-sea cultist teal
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.26, s * 0.32); // robed torso
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.34, s * 0.2); // flared robe hem
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.14, s * 0.18); // hooded head
    ctx.fillStyle = '#1a5a4e'; // hood shadow
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.1, s * 0.08);
    ctx.fillStyle = '#7affd4'; // eldritch glowing eyes
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.49, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillStyle = '#c8a050'; // old brass talisman
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.06, s * 0.08);
    ctx.fillStyle = '#8a4adf'; // writhing tentacle arm
    ctx.fillRect(s * 0.62, s * 0.32, s * 0.05, s * 0.2);
    ctx.fillRect(s * 0.66, s * 0.28, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.04, s * 0.08);
    ctx.fillStyle = '#b48aff'; // pact sigils orbiting
    ctx.fillRect(s * 0.24, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.04, s * 0.04);
    ctx.fillStyle = '#4affc8'; // eldritch blast charge
    ctx.fillRect(s * 0.72, s * 0.44, s * 0.08, s * 0.08);
  }

  private drawFireAzer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c8781a'; // forge-brass body heat
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.26, s * 0.32); // armored torso
    ctx.fillRect(s * 0.3, s * 0.6, s * 0.12, s * 0.22); // legs
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.14, s * 0.18); // helm head
    ctx.fillStyle = '#e8a020'; // molten highlights on armor plates
    ctx.fillRect(s * 0.36, s * 0.34, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.52, s * 0.34, s * 0.06, s * 0.1);
    ctx.fillStyle = '#ff5a1a'; // forge-fire glow seams
    ctx.fillRect(s * 0.34, s * 0.48, s * 0.26, s * 0.04);
    ctx.fillRect(s * 0.44, s * 0.26, s * 0.06, s * 0.03);
    ctx.fillStyle = '#ffdc6a'; // white-hot eye slits
    ctx.fillRect(s * 0.43, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.49, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a5a2a'; // hammer handle
    ctx.fillRect(s * 0.6, s * 0.36, s * 0.04, s * 0.24);
    ctx.fillStyle = '#b06a10'; // hammer head
    ctx.fillRect(s * 0.56, s * 0.32, s * 0.12, s * 0.08);
    ctx.fillStyle = '#ff8a2a'; // heat shimmer rising
    ctx.fillRect(s * 0.36, s * 0.02, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.0, s * 0.05, s * 0.08);
  }

  private drawBoneclaw(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d8d0c0'; // bone-white plates
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.26, s * 0.3, s * 0.34); // spiked torso
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.12, s * 0.24); // legs
    ctx.fillRect(s * 0.5, s * 0.6, s * 0.12, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.16, s * 0.18); // helm
    ctx.fillStyle = '#8a8070'; // bone seams
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.04, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.36, s * 0.03, s * 0.12);
    ctx.fillStyle = '#c04040'; // hate-glow eyes
    ctx.fillRect(s * 0.43, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = c; // spine ridge
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.46, s * 0.16, s * 0.04, s * 0.05);
    ctx.fillStyle = '#e8e0d0'; // sword-length talons
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.12, s * 0.4, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.64, s * 0.34, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.74, s * 0.4, s * 0.1, s * 0.05);
    ctx.fillStyle = '#2a2a2a'; // claw points
    ctx.fillRect(s * 0.08, s * 0.44, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.82, s * 0.44, s * 0.05, s * 0.04);
  }


  private drawCrawlingHand(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#9a8a7a'; // grave-pale flesh
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.4, s * 0.5, s * 0.2, s * 0.18); // palm
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.04, s * 0.2); // finger 1
    ctx.fillRect(s * 0.46, s * 0.28, s * 0.04, s * 0.24); // finger 2
    ctx.fillRect(s * 0.52, s * 0.3, s * 0.04, s * 0.22); // finger 3
    ctx.fillRect(s * 0.58, s * 0.36, s * 0.04, s * 0.16); // pinky
    ctx.fillRect(s * 0.6, s * 0.56, s * 0.1, s * 0.05); // thumb
    ctx.fillStyle = '#6a5a4a'; // torn wrist stump
    ctx.fillRect(s * 0.42, s * 0.66, s * 0.16, s * 0.08);
    ctx.fillStyle = '#c04040'; // dripping ichor
    ctx.fillRect(s * 0.48, s * 0.74, s * 0.04, s * 0.1);
    ctx.fillStyle = '#2a1a1a'; // black nails
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.46, s * 0.24, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.52, s * 0.26, s * 0.04, s * 0.05);
  }

  private drawSwordSpiderSwarm(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#2a2a34'; // black chitin carpet
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.5, s * 0.6, s * 0.2); // swarm mass
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.12);
    ctx.fillStyle = '#c8c8d4'; // blade legs catching light
    ctx.fillRect(s * 0.22, s * 0.66, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.36, s * 0.68, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.5, s * 0.66, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.64, s * 0.68, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.05, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.32, s * 0.05, s * 0.1);
    ctx.fillStyle = '#ff3a3a'; // many glinting eyes
    ctx.fillRect(s * 0.34, s * 0.46, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.44, s * 0.44, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.54, s * 0.46, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.62, s * 0.44, s * 0.03, s * 0.03);
    ctx.fillStyle = '#e8e8f0'; // shearing fangs
    ctx.fillRect(s * 0.46, s * 0.56, s * 0.08, s * 0.04);
  }

  private drawNeedlelord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a7a5a'; // dried-quill tan
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.28, s * 0.36); // quill mass
    ctx.fillRect(s * 0.32, s * 0.66, s * 0.14, s * 0.18); // stilt legs
    ctx.fillRect(s * 0.52, s * 0.66, s * 0.14, s * 0.18);
    ctx.fillStyle = '#d8ccb0'; // pale needles bristling
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.04, s * 0.16);
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.04, s * 0.14);
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.04, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.22, s * 0.04, s * 0.14);
    ctx.fillRect(s * 0.68, s * 0.32, s * 0.04, s * 0.16);
    ctx.fillRect(s * 0.24, s * 0.38, s * 0.04, s * 0.16);
    ctx.fillStyle = '#4a3a26'; // dark maw between quills
    ctx.fillRect(s * 0.42, s * 0.44, s * 0.14, s * 0.1);
    ctx.fillStyle = '#b04040'; // venom-tipped quills
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.14, s * 0.04, s * 0.05);
    ctx.fillStyle = '#ff4040'; // malevolent eyes
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.51, s * 0.34, s * 0.03, s * 0.03);
  }

  private drawFirDarrig(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#a82828'; // tattered red coat
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.24, s * 0.3); // coat body
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.1, s * 0.2); // legs
    ctx.fillRect(s * 0.52, s * 0.62, s * 0.1, s * 0.2);
    ctx.fillStyle = '#8a6a4a'; // rat face
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.14, s * 0.18);
    ctx.fillStyle = c; // drooping hat feather
    ctx.fillRect(s * 0.5, s * 0.04, s * 0.06, s * 0.1);
    ctx.fillStyle = '#c8b090'; // pointed snout
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.08, s * 0.06);
    ctx.fillStyle = '#2a1a0a'; // whiskers
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.08, s * 0.02);
    ctx.fillStyle = '#ffd24a'; // cunning yellow eyes
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.48, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillStyle = '#5a4a2a'; // gnarled walking stick
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.04, s * 0.34);
    ctx.fillStyle = '#e8d8a8'; // stolen coin purse
    ctx.fillRect(s * 0.28, s * 0.46, s * 0.08, s * 0.08);
  }



  private drawElderTempleDog(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d8a83a'; // guardian gold
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.5, s * 0.26); // lion body
    ctx.fillRect(s * 0.28, s * 0.66, s * 0.1, s * 0.18); // legs
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.1, s * 0.18);
    ctx.fillRect(s * 0.62, s * 0.24, s * 0.18, s * 0.2); // noble head
    ctx.fillStyle = '#b8862a'; // curling mane
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.26, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.3, s * 0.06, s * 0.16);
    ctx.fillStyle = '#3a2a10'; // wise dark eyes
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.75, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f8e8c0'; // curled fangs
    ctx.fillRect(s * 0.66, s * 0.38, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.38, s * 0.03, s * 0.05);
    ctx.fillStyle = '#e8e0c8'; // ivory horn
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.05, s * 0.1);
    ctx.fillStyle = '#ffdf8a'; // aura of sanctity
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.82, s * 0.5, s * 0.08, s * 0.08);
  }

  private drawPhoenixLesser(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#ff7a1a'; // juvenile flame
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.38, s * 0.34, s * 0.22, s * 0.24); // firebird body
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.14, s * 0.18); // head
    ctx.fillStyle = '#ffbb2a'; // golden breast
    ctx.fillRect(s * 0.42, s * 0.44, s * 0.12, s * 0.12);
    ctx.fillStyle = c; // sweeping wings
    ctx.fillRect(s * 0.16, s * 0.26, s * 0.22, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.26, s * 0.22, s * 0.1);
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.14, s * 0.08);
    ctx.fillStyle = '#ffd88a'; // trailing ember tail
    ctx.fillRect(s * 0.4, s * 0.58, s * 0.18, s * 0.08);
    ctx.fillRect(s * 0.44, s * 0.66, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.47, s * 0.74, s * 0.05, s * 0.08);
    ctx.fillStyle = '#fff'; // bright eye
    ctx.fillRect(s * 0.5, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillStyle = '#ffbb2a'; // beak
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.06, s * 0.04);
    ctx.fillStyle = '#ff4a1a'; // shedding sparks
    ctx.fillRect(s * 0.2, s * 0.6, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.56, s * 0.04, s * 0.04);
  }

  private drawOgreThundermace(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a9a5a'; // ogre-hide green
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.4, s * 0.38); // massive torso
    ctx.fillRect(s * 0.32, s * 0.62, s * 0.14, s * 0.24); // tree-trunk legs
    ctx.fillRect(s * 0.52, s * 0.62, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.2, s * 0.18); // blunt head
    ctx.fillStyle = '#6a7a3a'; // leather straps
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.4, s * 0.06);
    ctx.fillStyle = '#e8c88a'; // tusks
    ctx.fillRect(s * 0.4, s * 0.18, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.53, s * 0.18, s * 0.03, s * 0.06);
    ctx.fillStyle = '#2a1a0a'; // small angry eyes
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.12, s * 0.04, s * 0.04);
    ctx.fillStyle = '#5a3a1a'; // thundermace haft
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.06, s * 0.44);
    ctx.fillStyle = '#4a4a52'; // iron mace head
    ctx.fillRect(s * 0.6, s * 0.12, s * 0.18, s * 0.14);
    ctx.fillStyle = '#8a8a94'; // craggy studs
    ctx.fillRect(s * 0.62, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillStyle = '#a8a8b4'; // impact shock ring
    ctx.fillRect(s * 0.56, s * 0.04, s * 0.06, s * 0.03);
    ctx.fillRect(s * 0.78, s * 0.04, s * 0.06, s * 0.03);
  }

  private drawGhoulFleshBaron(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a8a6a'; // grave-fed green-gray
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.28, s * 0.34); // bloated torso
    ctx.fillRect(s * 0.32, s * 0.62, s * 0.12, s * 0.22); // legs
    ctx.fillRect(s * 0.52, s * 0.62, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.16, s * 0.2); // head
    ctx.fillStyle = '#4a2a6a'; // stolen noble silks
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.28, s * 0.08);
    ctx.fillRect(s * 0.38, s * 0.02, s * 0.14, s * 0.08); // noble hat
    ctx.fillStyle = '#e8e0d0'; // long fangs
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.22, s * 0.03, s * 0.06);
    ctx.fillStyle = '#ffd24a'; // hunger-bright eyes
    ctx.fillRect(s * 0.43, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = c; // rending claws
    ctx.fillRect(s * 0.22, s * 0.36, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.36, s * 0.12, s * 0.06);
    ctx.fillStyle = '#e8e0d0'; // claw tips
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.4, s * 0.05, s * 0.04);
    ctx.fillStyle = '#c04040'; // fresh bloodstain
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.08, s * 0.04);
  }

  private drawShadowAngel(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#26262e'; // midnight flesh
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.4, s * 0.28, s * 0.16, s * 0.32); // slender torso
    ctx.fillRect(s * 0.42, s * 0.6, s * 0.05, s * 0.22); // legs
    ctx.fillRect(s * 0.5, s * 0.6, s * 0.05, s * 0.22);
    ctx.fillRect(s * 0.42, s * 0.1, s * 0.12, s * 0.18); // serene head
    ctx.fillStyle = '#0e0e14'; // cut-wings of midnight
    ctx.fillRect(s * 0.12, s * 0.22, s * 0.28, s * 0.12);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.28, s * 0.12);
    ctx.fillRect(s * 0.06, s * 0.32, s * 0.2, s * 0.1);
    ctx.fillRect(s * 0.7, s * 0.32, s * 0.2, s * 0.1);
    ctx.fillStyle = '#c0c0d0'; // tear tracks
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.02, s * 0.08);
    ctx.fillRect(s * 0.51, s * 0.16, s * 0.02, s * 0.08);
    ctx.fillStyle = '#e8e8ff'; // sorrowful glow eyes
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.5, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillStyle = '#8a8a9a'; // broken halo
    ctx.fillRect(s * 0.38, s * 0.04, s * 0.06, s * 0.03);
    ctx.fillRect(s * 0.52, s * 0.04, s * 0.06, s * 0.03);
    ctx.fillStyle = '#4a4a5a'; // falling black feather
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.7, s * 0.62, s * 0.04, s * 0.1);
  }

  private drawDemonToad(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5a6a2a'; // abyssal bile-green
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.6, s * 0.34); // bloated body
    ctx.fillRect(s * 0.28, s * 0.7, s * 0.12, s * 0.14); // splayed legs
    ctx.fillRect(s * 0.58, s * 0.7, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.3, s * 0.2); // wide head
    ctx.fillStyle = '#3a4a16'; // warty back ridges
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.6, s * 0.44, s * 0.1, s * 0.06);
    ctx.fillStyle = '#ffcf2a'; // huge toad eyes
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.08, s * 0.08);
    ctx.fillStyle = '#1a0a0a'; // slit pupils
    ctx.fillRect(s * 0.39, s * 0.14, s * 0.02, s * 0.08);
    ctx.fillRect(s * 0.59, s * 0.14, s * 0.02, s * 0.08);
    ctx.fillStyle = '#d8e0b0'; // vast mouth
    ctx.fillRect(s * 0.36, s * 0.32, s * 0.28, s * 0.06);
    ctx.fillStyle = '#f8f8e8'; // teeth in maw
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.03, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.32, s * 0.03, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.32, s * 0.03, s * 0.04);
    ctx.fillStyle = '#c8a0d8'; // croaking hell-aura
    ctx.fillRect(s * 0.1, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.84, s * 0.3, s * 0.06, s * 0.06);
  }

  private drawSpiderLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#2a1a3a'; // drider royalty
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.38, s * 0.18, s * 0.2, s * 0.3); // torso
    ctx.fillRect(s * 0.4, s * 0.02, s * 0.16, s * 0.16); // head
    ctx.fillStyle = '#4a3a6a'; // spider abdomen
    ctx.fillRect(s * 0.34, s * 0.48, s * 0.28, s * 0.2);
    ctx.fillStyle = '#1a1a1a'; // eight spider legs
    ctx.fillRect(s * 0.22, s * 0.44, s * 0.14, s * 0.05);
    ctx.fillRect(s * 0.18, s * 0.54, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.26, s * 0.62, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.6, s * 0.44, s * 0.14, s * 0.05);
    ctx.fillRect(s * 0.68, s * 0.54, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.6, s * 0.62, s * 0.1, s * 0.05);
    ctx.fillStyle = '#e8e0f0'; // pale drow face
    ctx.fillRect(s * 0.44, s * 0.06, s * 0.08, s * 0.08);
    ctx.fillStyle = '#ff2a2a'; // eight burning eyes
    ctx.fillRect(s * 0.42, s * 0.0, s * 0.02, s * 0.02);
    ctx.fillRect(s * 0.46, s * 0.0, s * 0.02, s * 0.02);
    ctx.fillRect(s * 0.5, s * 0.0, s * 0.02, s * 0.02);
    ctx.fillRect(s * 0.54, s * 0.0, s * 0.02, s * 0.02);
    ctx.fillRect(s * 0.44, s * 0.04, s * 0.02, s * 0.02);
    ctx.fillRect(s * 0.5, s * 0.04, s * 0.02, s * 0.02);
    ctx.fillStyle = '#c8a050'; // spider crown
    ctx.fillRect(s * 0.38, s * -0.04, s * 0.2, s * 0.04);
    ctx.fillStyle = '#e8e8f0'; // web sovereignty strands
    ctx.fillRect(s * 0.08, s * 0.3, s * 0.03, s * 0.24);
    ctx.fillRect(s * 0.86, s * 0.26, s * 0.03, s * 0.28);
  }

  private drawTombHerald(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a8272'; // grave-dust bone
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.26, s * 0.32); // warden torso
    ctx.fillRect(s * 0.32, s * 0.6, s * 0.12, s * 0.24); // legs
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.12, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.15, s * 0.2); // lantern-jaw head
    ctx.fillStyle = '#5a5244'; // burial wrappings
    ctx.fillRect(s * 0.34, s * 0.38, s * 0.26, s * 0.05);
    ctx.fillRect(s * 0.42, s * 0.04, s * 0.12, s * 0.06); // wrappa band
    ctx.fillStyle = '#ffcf2a'; // lantern glow eyes
    ctx.fillRect(s * 0.43, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.49, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#c8942a'; // bronze herald staff
    ctx.fillRect(s * 0.64, s * 0.16, s * 0.05, s * 0.5);
    ctx.fillStyle = '#ffdf6a'; // staff lantern
    ctx.fillRect(s * 0.6, s * 0.08, s * 0.12, s * 0.1);
    ctx.fillStyle = '#4a4034'; // stone tablet of dooms
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.1, s * 0.16);
  }

  private drawSvirfneblin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a8a94'; // deep-gray skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.34, s * 0.26, s * 0.3); // squat torso
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.1, s * 0.2); // legs
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.16, s * 0.2); // bald head
    ctx.fillStyle = '#a8b8c2'; // nose
    ctx.fillRect(s * 0.47, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillStyle = '#d4e4ee'; // pale blind-adapted eyes
    ctx.fillRect(s * 0.42, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a6a4a'; // leather harness
    ctx.fillRect(s * 0.36, s * 0.42, s * 0.26, s * 0.06);
    ctx.fillStyle = '#b0b8c0'; // pick
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.05, s * 0.36);
    ctx.fillStyle = '#c8d0d8'; // pick head
    ctx.fillRect(s * 0.6, s * 0.28, s * 0.14, s * 0.05);
  }

  private drawNeothelid(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c86ad4'; // psychic magenta flesh
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.36); // bloated worm body
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.08, s * 0.2); // side tendrils
    ctx.fillRect(s * 0.66, s * 0.42, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.36, s * 0.66, s * 0.28, s * 0.18); // tail taper
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.26); // massive head
    ctx.fillStyle = '#e8b0f0'; // brain ridge
    ctx.fillRect(s * 0.4, s * 0.04, s * 0.2, s * 0.08);
    ctx.fillStyle = '#2a0a2a'; // maw
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.2, s * 0.08);
    ctx.fillStyle = '#fff'; // teeth
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.48, s * 0.26, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.03, s * 0.05);
    ctx.fillStyle = '#ffd700'; // four glaring eyes
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.52, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillStyle = '#a040b0'; // psychic halo
    ctx.fillRect(s * 0.3, s * 0.0, s * 0.4, s * 0.03);
  }

  private drawRakshasaNoble(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d4884a'; // tiger-orange hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.32, s * 0.36); // broad torso
    ctx.fillRect(s * 0.32, s * 0.64, s * 0.12, s * 0.22); // legs
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.22); // tiger head
    ctx.fillStyle = '#8a4a20'; // backward hands hint
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.4, s * 0.08, s * 0.14);
    ctx.fillStyle = '#3a2a1a'; // stripes
    ctx.fillRect(s * 0.38, s * 0.36, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.42, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.06, s * 0.04);
    ctx.fillStyle = '#f0e0c0'; // muzzle
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.12, s * 0.08);
    ctx.fillStyle = '#d4af37'; // golden crown
    ctx.fillRect(s * 0.36, s * 0.02, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.4, s * -0.02, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * -0.02, s * 0.06, s * 0.05);
    ctx.fillStyle = '#ff4500'; // burning eyes
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.05, s * 0.04);
  }

  private drawOniChieftain(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a6a8a'; // blue oni hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.44, s * 0.4); // massive torso
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.14, s * 0.22); // legs
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.14, s * 0.22);
    ctx.fillRect(s * 0.36, s * 0.06, s * 0.28, s * 0.24); // horned head
    ctx.fillStyle = '#1a3a4a'; // tiger-skin loincloth
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.36, s * 0.1);
    ctx.fillStyle = '#f0e6d0'; // horns
    ctx.fillRect(s * 0.34, s * -0.02, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.6, s * -0.02, s * 0.06, s * 0.1);
    ctx.fillStyle = '#ff3300'; // furious eyes
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillStyle = '#e0d0b0'; // tusks
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.04, s * 0.06);
    ctx.fillStyle = '#8a7a5a'; // spiked tetsubo club
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.08, s * 0.5);
    ctx.fillStyle = '#d4c4a0'; // club studs
    ctx.fillRect(s * 0.7, s * 0.34, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.48, s * 0.08, s * 0.04);
  }

  private drawSpiritTroll(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8ad4c8'; // ghost-troll teal
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(s * 0.34, s * 0.26, s * 0.32, s * 0.38); // gaunt torso
    ctx.fillRect(s * 0.32, s * 0.64, s * 0.1, s * 0.24); // long legs
    ctx.fillRect(s * 0.58, s * 0.64, s * 0.1, s * 0.24);
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.1, s * 0.3); // overlong arms
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.1, s * 0.3);
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.2, s * 0.2); // narrow head
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#d4fff4'; // spectral highlights
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.04, s * 0.2);
    ctx.fillStyle = '#ff0'; // hungry eyes
    ctx.fillRect(s * 0.43, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillStyle = '#3a6a5a'; // claw tips
    ctx.fillRect(s * 0.2, s * 0.6, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.6, s * 0.1, s * 0.05);
  }

  private drawElderUmberHulk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a5a3a'; // ancient chitin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.6, s * 0.44); // huge bulk
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.4, s * 0.24); // armored head
    ctx.fillStyle = '#5a3a22'; // chitin plates
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.52, s * 0.06);
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.52, s * 0.06);
    ctx.fillStyle = '#e8d8a0'; // mandibles
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.32, s * 0.08, s * 0.14);
    ctx.fillStyle = '#ff2200'; // confusing eyes (4, spiral)
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.07, s * 0.07);
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.07, s * 0.07);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.07, s * 0.07);
    ctx.fillRect(s * 0.62, s * 0.16, s * 0.07, s * 0.07);
    ctx.fillStyle = '#c8a860'; // eye spiral centers
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.46, s * 0.18, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.64, s * 0.18, s * 0.03, s * 0.03);
  }

  /**
   * The ooze mephit on the same frame: head sagging into the shoulders, the
   * body sagging into the floor, wing nubs too wet to fly on, drips off
   * everything.
   */
  private drawOozeMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const slime = flash || '#7a9a44';
    const lit = flash || '#a9c86a';
    const dark = flash || '#47632a';
    const wing = flash || '#5b7a33';
    // Wing nubs
    r(wing, 3, 9, 6, 5);
    r(wing, 4, 14, 4, 2);
    r(dark, 3, 9, 6, 1);
    r(wing, 19, 9, 6, 5);
    r(wing, 20, 14, 4, 2);
    r(dark, 19, 9, 6, 1);
    // Head and body run together
    r(slime, 9, 3, 10, 8);
    r(lit, 9, 3, 10, 1);
    r(slime, 8, 11, 12, 8);
    r(lit, 8, 11, 1, 7);
    r(slime, 7, 18, 14, 5);
    r(dark, 7, 21, 14, 2);
    // Eyes swimming in it, a slack mouth
    r(flash || '#e6ff9a', 10, 5, 3, 2);
    r(flash || '#e6ff9a', 15, 5, 3, 2);
    r(flash || '#1c2a10', 11, 5, 1, 2);
    r(flash || '#1c2a10', 16, 5, 1, 2);
    r(dark, 11, 8, 6, 2);
    // Stubby legs, and drips running off everything
    r(slime, 9, 23, 3, 3);
    r(slime, 16, 23, 3, 3);
    r(dark, 9, 25, 3, 1);
    r(dark, 16, 25, 3, 1);
    r(slime, 5, 14, 2, 4);
    r(slime, 21, 15, 2, 3);
    r(slime, 13, 23, 2, 4);
    r(lit, 12, 12, 2, 3);
    r(lit, 17, 14, 2, 2);
    r(dark, 3, 25, 4, 2);
    r(dark, 20, 26, 5, 1);
  }

  private drawVoidDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#332444', '#1b132c', '#b08aff', '#e0c8ff', 'ancient');
  }

  private drawMoonDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#b6c4dc', '#8b99b4', '#dceaff', '#f4f8ff', 'ancient');
  }

  private drawSunDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#e6b62e', '#bb8b18', '#fff0a0', '#fff8d0', 'ancient');
  }

  private drawBoneSwarm(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d8d4c0'; // scattered bone
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.14, s * 0.05); // femur 1
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.12, s * 0.05); // rib 1
    ctx.fillRect(s * 0.58, s * 0.34, s * 0.14, s * 0.05); // femur 2
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.05, s * 0.16); // bone upright 1
    ctx.fillRect(s * 0.52, s * 0.44, s * 0.05, s * 0.18); // bone upright 2
    ctx.fillRect(s * 0.68, s * 0.56, s * 0.12, s * 0.05); // femur 3
    ctx.fillRect(s * 0.2, s * 0.62, s * 0.05, s * 0.14); // bone upright 3
    ctx.fillStyle = '#f4f0e0'; // skulls
    ctx.fillRect(s * 0.42, s * 0.3, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.08, s * 0.08);
    ctx.fillStyle = '#ff2200'; // swarm eye glints
    ctx.fillRect(s * 0.45, s * 0.34, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.65, s * 0.23, s * 0.03, s * 0.03);
  }

  /**
   * The giant spider faces the viewer with its legs bunched to the sides; the
   * widow is seen from above, the way you find one — a small head, thin legs
   * reaching fore and aft, and the great glossy abdomen behind with the
   * hourglass on it. Same animal, a different view, so the two never share
   * an outline.
   */
  private drawGloomWidow(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const chitin = flash || '#2a2238';
    const lit = flash || '#4c4066';
    const dark = flash || '#120e1a';
    const mark = flash || '#c040ff';
    const eye = flash || '#ff4aff';
    const fang = flash || '#cfc6dc';
    const m = (x: number, w: number) => 28 - x - w;
    // Four pairs of thin legs, five rows apart so the rim leaves floor
    // between them: two reaching forward off the head, two back off the
    // abdomen
    const legs: [number, number, number, number][][] = [
      [[8, 5, 3, 2], [5, 3, 3, 2], [3, 1, 2, 3]],
      [[3, 10, 8, 2], [1, 6, 2, 5]],
      [[3, 15, 8, 2], [1, 16, 2, 5]],
      [[8, 20, 3, 2], [5, 21, 3, 2], [3, 22, 2, 4]],
    ];
    for (const limb of legs) {
      for (const [x, y, w, h] of limb) {
        r(chitin, x, y, w, h);
        r(chitin, m(x, w), y, w, h);
      }
      const [fx, fy, fw, fh] = limb[limb.length - 1];
      r(dark, fx, fy + fh - 2, fw, 2);
      r(dark, m(fx, fw), fy + fh - 2, fw, 2);
    }
    // Abdomen, round and glossy, the hourglass on it
    r(chitin, 9, 14, 10, 11);
    r(chitin, 8, 16, 12, 7);
    r(lit, 10, 14, 8, 1);
    r(lit, 8, 16, 1, 7);
    r(dark, 9, 24, 10, 1);
    r(mark, 12, 16, 4, 2);
    r(mark, 13, 18, 2, 1);
    r(mark, 12, 19, 4, 2);
    // Cephalothorax and the head, fangs forward, eyes in a cluster
    r(chitin, 11, 8, 6, 6);
    r(lit, 11, 8, 6, 1);
    r(chitin, 11, 4, 6, 4);
    r(lit, 11, 4, 6, 1);
    r(eye, 12, 5, 2, 2);
    r(eye, 15, 5, 2, 2);
    r(dark, 13, 6, 1, 1);
    r(dark, 15, 6, 1, 1);
    r(eye, 13, 7, 1, 1);
    r(eye, 14, 7, 1, 1);
    r(fang, 12, 2, 1, 2);
    r(fang, 15, 2, 1, 2);
  }

  private drawFireSnake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const body = flash || '#c8341a';
    const lit = flash || '#ff7a2a';
    const dark = flash || '#6d1707';
    const glow = flash || '#ffd24a';
    // Coiled low and rearing. The body reads as a bed of coals: cracks of
    // heat between the scales and flame licking straight off the spine.
    r(body, 1, 21, 17, 5);
    r(lit, 1, 21, 17, 1);
    r(dark, 1, 25, 17, 1);
    r(body, 5, 16, 15, 6);
    r(lit, 5, 16, 15, 1);
    r(body, 12, 9, 7, 8);
    r(lit, 12, 9, 2, 8);
    r(body, 14, 4, 10, 6);
    r(lit, 14, 4, 10, 1);
    // Cracks where the coals show through
    r(glow, 3, 23, 3, 2);
    r(glow, 9, 23, 3, 2);
    r(glow, 14, 23, 3, 2);
    r(glow, 8, 18, 3, 2);
    r(glow, 15, 18, 3, 2);
    r(glow, 14, 12, 2, 3);
    // Flame off the spine, solid and held clear of the outline
    r(lit, 4, 13, 2, 4);
    r(glow, 4, 11, 2, 3);
    r(lit, 9, 12, 2, 5);
    r(glow, 9, 9, 2, 3);
    r(lit, 13, 6, 2, 4);
    r(glow, 13, 3, 2, 3);
    // Head with the mouth glowing open
    r(dark, 17, 8, 9, 2);
    r(glow, 18, 8, 7, 1);
    r(flash || '#fff3c0', 18, 7, 1, 1);
    r(flash || '#fff3c0', 23, 7, 1, 1);
    r(flash || '#ffe14a', 19, 5, 3, 2);
    r(flash || '#2a0a04', 20, 5, 1, 2);
  }

  private drawGiantAnaconda(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a6a3a'; // jungle-green scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.6, s * 0.18); // thick body
    ctx.fillRect(s * 0.06, s * 0.36, s * 0.18, s * 0.12); // tail coil
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.22, s * 0.2); // broad head
    ctx.fillStyle = '#2a4a2a'; // dark dorsal blotches
    ctx.fillRect(s * 0.26, s * 0.44, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.42, s * 0.44, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.44, s * 0.1, s * 0.06);
    ctx.fillStyle = '#c8d88a'; // pale belly
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.5, s * 0.05);
    ctx.fillStyle = '#ffd700'; // vertical-slit eyes
    ctx.fillRect(s * 0.76, s * 0.36, s * 0.05, s * 0.05);
    ctx.fillStyle = '#1a2a1a'; // gaping maw
    ctx.fillRect(s * 0.8, s * 0.44, s * 0.08, s * 0.06);
    ctx.fillStyle = '#fff'; // fang
    ctx.fillRect(s * 0.82, s * 0.44, s * 0.03, s * 0.05);
  }

  private drawOrcBladeIlneval(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5a7a3a'; // battle-green hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.36, s * 0.36); // armored torso
    ctx.fillRect(s * 0.32, s * 0.64, s * 0.13, s * 0.22); // legs
    ctx.fillRect(s * 0.55, s * 0.64, s * 0.13, s * 0.22);
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.2); // heavy jaw head
    ctx.fillStyle = '#3a4a2a'; // iron plate armor
    ctx.fillRect(s * 0.32, s * 0.34, s * 0.36, s * 0.1);
    ctx.fillStyle = '#c8c8d0'; // greatsword of Ilneval
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.06, s * 0.52);
    ctx.fillRect(s * 0.66, s * 0.66, s * 0.14, s * 0.05);
    ctx.fillStyle = '#8a2a2a'; // war-paint stripes
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.04, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.04, s * 0.14);
    ctx.fillStyle = '#ffd700'; // tactical eyes
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e8e0d0'; // tusks
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.04, s * 0.05);
  }

  private drawGnollWitherling(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#b8a888'; // dead hyena bone-hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.3, s * 0.28); // gaunt torso
    ctx.fillRect(s * 0.34, s * 0.62, s * 0.1, s * 0.22); // legs
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.1, s * 0.22);
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.26, s * 0.22); // hyena skull head
    ctx.fillStyle = '#8a7a5a'; // mangy patches
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.5, s * 0.1, s * 0.08);
    ctx.fillStyle = '#3a2a1a'; // torn ear
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.58, s * 0.06, s * 0.06, s * 0.08);
    ctx.fillStyle = '#a030ff'; // Yeenoghu's undead glow eyes
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.52, s * 0.18, s * 0.05, s * 0.05);
    ctx.fillStyle = '#e8e0d0'; // jagged teeth
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.03, s * 0.06);
  }

  private drawWorgRider(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a6a72'; // worg fur
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.14, s * 0.44, s * 0.5, s * 0.24); // worg body
    ctx.fillRect(s * 0.08, s * 0.62, s * 0.1, s * 0.18); // hind legs
    ctx.fillRect(s * 0.46, s * 0.62, s * 0.1, s * 0.18); // front legs
    ctx.fillRect(s * 0.54, s * 0.34, s * 0.2, s * 0.18); // wolf head
    ctx.fillStyle = '#4a4a52'; // saddle blanket
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.2, s * 0.08);
    ctx.fillStyle = '#5a7a3a'; // goblin rider
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.16, s * 0.24); // rider torso
    ctx.fillRect(s * 0.32, s * 0.04, s * 0.12, s * 0.14); // rider head
    ctx.fillStyle = '#c8c8d0'; // lance
    ctx.fillRect(s * 0.48, s * 0.14, s * 0.04, s * 0.34);
    ctx.fillStyle = '#ff3300'; // worg eyes
    ctx.fillRect(s * 0.6, s * 0.4, s * 0.04, s * 0.04);
    ctx.fillStyle = '#fff'; // fangs
    ctx.fillRect(s * 0.66, s * 0.48, s * 0.04, s * 0.05);
  }

  /**
   * The dragonshield is a kobold behind a round shield nearly as big as it
   * is, which is the whole silhouette: the plain kobold is horns up and a
   * tall spear, this one is a disc with a snout looking over it.
   */
  private drawKoboldDragonshield(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const scale = flash || '#a8452a';
    const lit = flash || '#cf6a44';
    const dark = flash || '#6b2a18';
    const horn = flash || '#e8d9b0';
    // The spear, upright behind the shield arm
    r(flash || '#6a4e34', 22, 4, 2, 20);
    r(flash || '#8a6a48', 22, 4, 1, 20);
    r(flash || '#c8ccd4', 21, 1, 4, 4);
    r(flash || '#eef0f4', 22, 1, 1, 4);
    // Legs, tail whipping out behind
    r(scale, 12, 19, 3, 6);
    r(scale, 17, 19, 3, 6);
    r(dark, 11, 24, 4, 2);
    r(dark, 17, 24, 4, 2);
    r(scale, 19, 16, 6, 2);
    r(scale, 24, 14, 3, 2);
    // Small body and the arm on the spear
    r(scale, 11, 11, 10, 9);
    r(lit, 11, 11, 10, 1);
    r(dark, 11, 18, 10, 2);
    r(scale, 20, 12, 3, 6);
    // Snouted head, horns up, eyes lit
    r(scale, 11, 4, 9, 7);
    r(lit, 11, 4, 9, 1);
    r(scale, 18, 7, 5, 3);
    r(dark, 18, 9, 5, 1);
    r(horn, 11, 1, 2, 3);
    r(horn, 16, 1, 2, 3);
    r(flash || '#ff5a1a', 13, 6, 2, 2);
    r(flash || '#ff5a1a', 17, 6, 2, 2);
    r(flash || '#2a0a04', 14, 6, 1, 2);
    r(flash || '#2a0a04', 18, 6, 1, 2);
    r(flash || '#f0ece0', 21, 9, 1, 1);
    // The dragon-scale shield
    const sh = flash || '#7a3a1c';
    const shLit = flash || '#a3512a';
    const shDark = flash || '#4a2010';
    const boss = flash || '#e0a040';
    r(sh, 3, 9, 10, 13);
    r(sh, 1, 12, 14, 7);
    r(shLit, 4, 9, 8, 1);
    r(shLit, 1, 13, 1, 5);
    r(shDark, 4, 21, 8, 1);
    r(shDark, 14, 13, 1, 5);
    r(shDark, 6, 13, 3, 1);
    r(shDark, 4, 16, 2, 1);
    r(shDark, 10, 17, 3, 1);
    r(boss, 6, 14, 4, 3);
    r(flash || '#fff0b0', 7, 14, 1, 1);
  }

  private drawTroglodyteShaman(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a8a5a'; // swamp-green hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.3, s * 0.3); // hunched torso
    ctx.fillRect(s * 0.34, s * 0.62, s * 0.1, s * 0.22); // legs
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.1, s * 0.22);
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.22, s * 0.2); // crested head
    ctx.fillStyle = '#4a6a3a'; // mottled stench patches
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.44, s * 0.08, s * 0.08);
    ctx.fillStyle = '#d4c47a'; // bone staff
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.05, s * 0.52);
    ctx.fillStyle = '#e8e0c0'; // skull totem
    ctx.fillRect(s * 0.66, s * 0.08, s * 0.12, s * 0.1);
    ctx.fillStyle = '#2a1a0a'; // skull eye sockets
    ctx.fillRect(s * 0.68, s * 0.11, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.73, s * 0.11, s * 0.03, s * 0.03);
    ctx.fillStyle = '#c0ff40'; // stench cloud
    ctx.globalAlpha = 0.4;
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.08, s * 0.16);
    ctx.globalAlpha = 1;
  }

  private drawBlackPuddingLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const body = flash || '#241e33';
    const lit = flash || '#42385b';
    const dark = flash || '#130f1d';
    const sheen = flash || '#655a83';
    const gold = flash || '#8d7a34';
    // The pudding that ate a king, still wearing what is left of him.
    r(body, 2, 10, 24, 15);
    r(body, 5, 6, 18, 5);
    r(body, 8, 4, 12, 3);
    r(lit, 8, 4, 12, 1);
    r(lit, 5, 6, 3, 1);
    r(lit, 20, 6, 3, 1);
    r(dark, 2, 22, 24, 3);
    r(body, 0, 14, 3, 7);
    r(body, 25, 13, 3, 8);
    r(body, 5, 25, 3, 3);
    r(body, 13, 25, 2, 3);
    r(body, 20, 25, 3, 3);
    r(sheen, 7, 8, 4, 2);
    r(sheen, 17, 11, 3, 2);
    r(sheen, 4, 16, 3, 2);
    r(sheen, 20, 18, 3, 2);
    // The crown, corroded down to a rim and three points
    r(gold, 8, 0, 12, 3);
    r(flash || '#c0a94c', 8, 0, 12, 1);
    r(gold, 8, 0, 2, 4);
    r(gold, 13, 0, 2, 4);
    r(gold, 18, 0, 2, 4);
    r(flash || '#e04a4a', 13, 1, 2, 2);
    // A core still burning somewhere inside the mass
    r(flash || '#7a2fd0', 11, 13, 7, 7);
    r(flash || '#b47cff', 12, 14, 5, 5);
    r(flash || '#eddaff', 14, 16, 2, 2);
  }

  /**
   * A grimlock has no eyes at all, and a blank face is worth more here than
   * any weapon: the head is drawn as a smooth dome with a heavy brow, a wide
   * flat nose and nothing above it but scar tissue, and the body is hunched
   * forward with its head lower than its shoulders, feeling its way.
   */
  private drawGrimlock(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#8a8a72';
    const lit = flash || '#b0b096';
    const dark = flash || '#525243';
    const bone = flash || '#ddd6c2';
    // Splayed feet and heavy legs
    r(dark, 8, 20, 5, 5);
    r(dark, 16, 20, 5, 5);
    r(hide, 6, 25, 8, 2);
    r(hide, 15, 25, 8, 2);
    // Barrel torso, hunched so the shoulders ride above the head
    r(hide, 7, 10, 15, 11);
    r(lit, 8, 9, 13, 2);
    r(dark, 7, 19, 15, 2);
    r(dark, 10, 13, 4, 4); // muscle shadow
    r(dark, 16, 14, 4, 3);
    r(flash || '#6b5a3c', 7, 17, 15, 2); // hide belt
    // Long arms hanging low
    r(hide, 3, 11, 5, 8);
    r(hide, 21, 11, 5, 8);
    r(dark, 3, 18, 5, 3);
    r(dark, 21, 18, 5, 3);
    // Head slung forward and down between the shoulders
    r(hide, 9, 2, 11, 9);
    r(lit, 9, 2, 11, 1);
    r(dark, 9, 2, 1, 9);
    r(bone, 9, 5, 11, 2); // the heavy brow, and nothing under it
    r(dark, 9, 7, 11, 1);
    r(dark, 12, 3, 2, 2); // scar tissue where eyes would be
    r(dark, 16, 3, 2, 2);
    r(dark, 13, 8, 3, 1); // flat nose
    r(flash || '#3a3226', 11, 9, 8, 2); // wide mouth
    r('#e8e0cc', 12, 9, 1, 2);
    r('#e8e0cc', 14, 9, 1, 2);
    r('#e8e0cc', 17, 9, 1, 2);
    // Stone-headed club dragged along
    r(flash || '#6a5334', 24, 12, 3, 12);
    r(flash || '#8a6f46', 24, 12, 1, 12);
    r(flash || '#7d8188', 22, 21, 6, 6);
    r(flash || '#9ba1a9', 22, 21, 6, 1);
  }

  private drawQuaggoth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c8b8a8'; // cave-ape hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.4); // broad shaggy torso
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.14, s * 0.2); // legs
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.2); // heavy head
    ctx.fillStyle = '#f0ece4'; // white mane
    ctx.fillRect(s * 0.32, s * 0.2, s * 0.36, s * 0.12);
    ctx.fillRect(s * 0.34, s * 0.04, s * 0.32, s * 0.08);
    ctx.fillStyle = '#8a7a6a'; // long climbing arms
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.1, s * 0.36);
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.1, s * 0.36);
    ctx.fillStyle = '#ff2200'; // rage eyes
    ctx.fillRect(s * 0.43, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillStyle = '#e8e0d0'; // fangs
    ctx.fillRect(s * 0.44, s * 0.24, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.24, s * 0.04, s * 0.05);
  }

  private drawXill(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c84a3a'; // red-planar chitin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.3, s * 0.34); // sleek torso
    ctx.fillRect(s * 0.36, s * 0.64, s * 0.1, s * 0.22); // legs
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.1, s * 0.22);
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.2); // wedge head
    ctx.fillStyle = '#8a2a1a'; // four arms (two pairs)
    ctx.fillRect(s * 0.22, s * 0.32, s * 0.1, s * 0.3);
    ctx.fillRect(s * 0.68, s * 0.32, s * 0.1, s * 0.3);
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.08, s * 0.28);
    ctx.fillRect(s * 0.68, s * 0.4, s * 0.08, s * 0.28);
    ctx.fillStyle = '#ffd700'; // psionic eyes
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.18, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e8d8c8'; // claw tips
    ctx.fillRect(s * 0.22, s * 0.62, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.68, s * 0.62, s * 0.1, s * 0.05);
    ctx.fillStyle = '#701810'; // mantis wing shells
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.24, s * 0.06);
  }

  /**
   * A rast is a floating stone sphere with one smouldering eye, a maw under
   * it, spurs on the crown, and spindly jointed talons hanging beneath —
   * the legs are what keep it off the beholder-kin.
   */
  private drawRast(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const stone = flash || '#b87848';
    const lit = flash || '#d89a68';
    const dark = flash || '#7a4a2a';
    const band = flash || '#8a5030';
    // Sphere
    r(stone, 8, 3, 12, 14);
    r(stone, 6, 6, 16, 8);
    r(lit, 9, 3, 10, 1);
    r(lit, 6, 7, 1, 6);
    r(dark, 9, 15, 10, 2);
    r(dark, 21, 7, 1, 6);
    r(band, 6, 9, 16, 1);
    r(band, 7, 12, 14, 1);
    // Spurs on the crown
    r(dark, 10, 1, 2, 3);
    r(dark, 13, 0, 2, 3);
    r(dark, 16, 1, 2, 3);
    // The eye and the maw
    r(dark, 10, 5, 8, 4);
    r(flash || '#ff8a20', 11, 6, 6, 2);
    r(flash || '#ffd700', 13, 6, 2, 2);
    r(flash || '#3a1808', 9, 13, 10, 2);
    r(flash || '#f0e0c8', 10, 13, 1, 1);
    r(flash || '#f0e0c8', 13, 13, 1, 1);
    r(flash || '#f0e0c8', 16, 13, 1, 1);
    // Talons hanging beneath
    const leg = (x: number, dx: number) => {
      r(dark, x, 17, 2, 4);
      r(dark, x + dx, 21, 2, 4);
      r(flash || '#4a2a18', x + dx * 2, 25, 2, 2);
    };
    leg(6, -1);
    leg(10, 0);
    leg(13, 0);
    leg(16, 0);
    leg(20, 1);
  }

  private drawMorkoth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a6a7a'; // deep-sea teal
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.3); // eel body
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.22, s * 0.14); // tail
    ctx.fillRect(s * 0.58, s * 0.22, s * 0.26, s * 0.2); // fanged head
    ctx.fillStyle = '#2a4a56'; // fin ridges
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.3, s * 0.05);
    ctx.fillStyle = '#c8dce4'; // pale belly
    ctx.fillRect(s * 0.34, s * 0.56, s * 0.32, s * 0.06);
    ctx.fillStyle = '#ff4400'; // spiral hypnotic eye
    ctx.fillRect(s * 0.68, s * 0.28, s * 0.08, s * 0.08);
    ctx.fillStyle = '#ffd700'; // spiral center
    ctx.fillRect(s * 0.71, s * 0.31, s * 0.03, s * 0.03);
    ctx.fillStyle = '#e8f0f4'; // needle teeth
    ctx.fillRect(s * 0.62, s * 0.38, s * 0.16, s * 0.03);
    ctx.fillStyle = '#1a2a30'; // lure tendrils
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.04, s * 0.1);
  }

  private drawSkulk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#b8b4c0'; // mirror-pale flesh
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.32, s * 0.26, s * 0.3); // slight torso
    ctx.fillRect(s * 0.36, s * 0.62, s * 0.09, s * 0.24); // legs
    ctx.fillRect(s * 0.55, s * 0.62, s * 0.09, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.18, s * 0.18); // smooth head
    ctx.fillStyle = '#8a8a96'; // cowl shadow
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.26, s * 0.08);
    ctx.fillStyle = '#302838'; // no-reflection eye pits
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillStyle = '#c0c8d0'; // curved knife
    ctx.fillRect(s * 0.66, s * 0.36, s * 0.05, s * 0.22);
    ctx.fillRect(s * 0.7, s * 0.32, s * 0.05, s * 0.06);
    ctx.fillStyle = '#5a4a3a'; // coin pouch
    ctx.fillRect(s * 0.28, s * 0.46, s * 0.08, s * 0.08);
  }

  /**
   * A darkling is its cloak: a hood coming to a point, spreading to the
   * floor, eaten through with moth holes, with nothing in the hood but two
   * eyes and a silver smile, and a knife out of one sleeve.
   */
  private drawDarkling(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const cloak = flash || '#3a2c4a';
    const cloakLit = flash || '#56446a';
    const cloakDark = flash || '#221a2e';
    const skin = flash || '#6a5a7a';
    const hole = flash || '#141020';
    // The cloak
    r(cloak, 12, 2, 4, 3);
    r(cloak, 10, 5, 8, 4);
    r(cloak, 8, 9, 12, 6);
    r(cloak, 6, 15, 16, 6);
    r(cloak, 4, 21, 20, 5);
    r(cloakLit, 12, 2, 1, 3);
    r(cloakLit, 10, 5, 1, 4);
    r(cloakLit, 8, 9, 1, 6);
    r(cloakLit, 6, 15, 1, 6);
    r(cloakLit, 4, 21, 1, 5);
    r(cloakDark, 4, 24, 20, 2);
    // Moth holes
    r(hole, 9, 12, 2, 2);
    r(hole, 17, 17, 2, 2);
    r(hole, 7, 22, 2, 2);
    r(hole, 13, 19, 1, 2);
    r(hole, 20, 23, 2, 1);
    // The face in the hood
    r(hole, 11, 6, 6, 4);
    r(flash || '#e8d84a', 12, 7, 1, 1);
    r(flash || '#e8d84a', 15, 7, 1, 1);
    r(flash || '#c8b86a', 12, 9, 4, 1);
    // Hands, a knife in one
    r(skin, 4, 17, 3, 2);
    r(skin, 21, 16, 3, 2);
    r(flash || '#c8ccd4', 2, 14, 2, 4);
    r(flash || '#5a4630', 2, 18, 2, 1);
    // Feet
    r(cloakDark, 8, 26, 4, 1);
    r(cloakDark, 16, 26, 4, 1);
  }

  private drawSteelPredator(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#a84830'; // rust-red alloy
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.4, s * 0.56, s * 0.26); // hound body
    ctx.fillRect(s * 0.06, s * 0.62, s * 0.1, s * 0.2); // hind legs
    ctx.fillRect(s * 0.5, s * 0.62, s * 0.1, s * 0.2); // fore legs
    ctx.fillRect(s * 0.58, s * 0.28, s * 0.24, s * 0.2); // plated head
    ctx.fillStyle = '#701810'; // armor seams
    ctx.fillRect(s * 0.18, s * 0.44, s * 0.4, s * 0.04);
    ctx.fillStyle = '#d8d0c0'; // riveted plates
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.36, s * 0.36, s * 0.1, s * 0.06);
    ctx.fillStyle = '#ffcc00'; // soul-tracking eyes
    ctx.fillRect(s * 0.64, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.73, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillStyle = '#e8e0d0'; // fangs
    ctx.fillRect(s * 0.62, s * 0.44, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.74, s * 0.44, s * 0.04, s * 0.06);
    ctx.fillStyle = '#5a1810'; // tail blade
    ctx.fillRect(s * 0.0, s * 0.36, s * 0.12, s * 0.05);
  }

  /**
   * The enveloper is a sheet of grey flesh hung from two points, folds
   * running down it and the hem ragged, with the face of the last thing it
   * took pressing through from the inside.
   */
  private drawEnveloper(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const flesh = flash || '#9a9a8a';
    const lit = flash || '#bcbcaa';
    const dark = flash || '#6a6a5c';
    const deep = flash || '#3e3e34';
    // The sheet
    r(flesh, 3, 3, 22, 4);
    r(lit, 3, 3, 22, 1);
    r(flesh, 4, 7, 20, 12);
    r(flesh, 5, 19, 6, 5);
    r(flesh, 12, 19, 5, 7);
    r(flesh, 18, 19, 6, 4);
    r(lit, 4, 8, 1, 10);
    r(dark, 5, 23, 6, 1);
    r(dark, 12, 25, 5, 1);
    r(dark, 18, 22, 6, 1);
    // Folds
    r(dark, 8, 7, 1, 13);
    r(dark, 14, 7, 1, 13);
    r(dark, 20, 7, 1, 13);
    r(lit, 9, 7, 1, 11);
    r(lit, 15, 7, 1, 11);
    // The corners it holds itself up by
    r(dark, 2, 1, 3, 3);
    r(dark, 23, 1, 3, 3);
    // The face pressing through
    r(flash || '#c8c0a8', 10, 9, 8, 7);
    r(deep, 11, 10, 2, 2);
    r(deep, 15, 10, 2, 2);
    r(deep, 11, 13, 6, 2);
    r(flash || '#c8c0a8', 13, 12, 2, 1);
  }

  private drawAdamantineGolem(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#2a2a34'; // black alloy
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.22, s * 0.52, s * 0.46); // colossal torso
    ctx.fillRect(s * 0.24, s * 0.68, s * 0.18, s * 0.22); // legs
    ctx.fillRect(s * 0.58, s * 0.68, s * 0.18, s * 0.22);
    ctx.fillRect(s * 0.34, s * 0.04, s * 0.32, s * 0.2); // slab head
    ctx.fillStyle = '#4a4a5c'; // polished sheen
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.06);
    ctx.fillStyle = '#14141c'; // joint shadows
    ctx.fillRect(s * 0.24, s * 0.52, s * 0.52, s * 0.05);
    ctx.fillStyle = '#8a8a9c'; // rune-glyphs of unmaking
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.36, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.36, s * 0.05, s * 0.08);
    ctx.fillStyle = '#ff3a00'; // forge-core eyes
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillStyle = '#3a3a48'; // siege fists
    ctx.fillRect(s * 0.08, s * 0.34, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.76, s * 0.34, s * 0.16, s * 0.2);
  }

  private drawMithralGolem(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d8e0e8'; // bright silver
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.42); // agile torso
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.15, s * 0.22); // legs
    ctx.fillRect(s * 0.55, s * 0.66, s * 0.15, s * 0.22);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.18); // sleek head
    ctx.fillStyle = '#f4f8fc'; // mirror polish
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.05);
    ctx.fillStyle = '#a8b4c0'; // panel lines
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.04);
    ctx.fillStyle = '#88d4ff'; // arcane reactor eyes
    ctx.fillRect(s * 0.43, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillStyle = '#c0ccd8'; // blade arms
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.16, s * 0.36, s * 0.05, s * 0.22);
    ctx.fillRect(s * 0.79, s * 0.36, s * 0.05, s * 0.22);
  }

  private drawBrainstealer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#a8b8d0'; // silver psionic scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.22, s * 0.32, s * 0.5, s * 0.32); // draconic body
    ctx.fillRect(s * 0.02, s * 0.38, s * 0.22, s * 0.16); // tail
    ctx.fillRect(s * 0.6, s * 0.18, s * 0.24, s * 0.22); // neck+head
    ctx.fillStyle = '#6a7a9a'; // scale shading
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillStyle = '#c8d4e8'; // wing membranes
    ctx.fillRect(s * 0.1, s * 0.18, s * 0.34, s * 0.16);
    ctx.fillRect(s * 0.54, s * 0.44, s * 0.34, s * 0.16);
    ctx.fillStyle = '#d4a0ff'; // exposed brain ridge
    ctx.fillRect(s * 0.66, s * 0.1, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.7, s * 0.06, s * 0.08, s * 0.06);
    ctx.fillStyle = '#ff4aff'; // psionic gaze eyes
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#2a0a2a'; // maw
    ctx.fillRect(s * 0.76, s * 0.3, s * 0.08, s * 0.06);
    ctx.fillStyle = '#fff'; // fangs
    ctx.fillRect(s * 0.78, s * 0.3, s * 0.03, s * 0.05);
  }

  private drawHalfDragonVeteran(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a8a5a'; // dragonblooded green
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.26, s * 0.36, s * 0.38); // armored torso
    ctx.fillRect(s * 0.32, s * 0.64, s * 0.13, s * 0.22); // legs
    ctx.fillRect(s * 0.55, s * 0.64, s * 0.13, s * 0.22);
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.24, s * 0.2); // scaled head
    ctx.fillStyle = '#5a6a3a'; // scale patches
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.58, s * 0.34, s * 0.08, s * 0.12);
    ctx.fillStyle = '#c8c8d0'; // half-plate
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.1);
    ctx.fillStyle = '#e8e0d0'; // horns
    ctx.fillRect(s * 0.38, s * 0.02, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.57, s * 0.02, s * 0.05, s * 0.08);
    ctx.fillStyle = '#ffcc00'; // draconic eyes
    ctx.fillRect(s * 0.43, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillStyle = '#c0ccd8'; // longsword
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.05, s * 0.5);
    ctx.fillStyle = '#8a6a3a'; // hilt
    ctx.fillRect(s * 0.69, s * 0.6, s * 0.11, s * 0.05);
  }

  /**
   * The berbalang is gaunt: ribs showing, stilt legs with knobbed knees,
   * arms hanging to the knee, ragged half-folded wings, and a long skull of
   * a head with the cheeks hollowed and the eyes burning.
   */
  private drawBerbalang(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#7a6a58';
    const lit = flash || '#9c8c78';
    const dark = flash || '#4a3e32';
    const wing = flash || '#3e3228';
    // Wings
    r(wing, 1, 6, 7, 8);
    r(wing, 2, 14, 5, 4);
    r(wing, 3, 18, 3, 3);
    r(dark, 1, 6, 7, 1);
    r(dark, 3, 7, 1, 12);
    r(wing, 20, 6, 7, 8);
    r(wing, 21, 14, 5, 4);
    r(wing, 22, 18, 3, 3);
    r(dark, 20, 6, 7, 1);
    r(dark, 24, 7, 1, 12);
    // Body
    r(skin, 10, 10, 8, 9);
    r(lit, 10, 10, 8, 1);
    r(dark, 10, 17, 8, 2);
    r(dark, 11, 12, 6, 1);
    r(dark, 11, 14, 6, 1);
    r(dark, 11, 16, 6, 1);
    r(skin, 10, 19, 2, 7);
    r(skin, 16, 19, 2, 7);
    r(lit, 10, 21, 2, 1);
    r(lit, 16, 21, 2, 1);
    r(dark, 8, 26, 4, 1);
    r(dark, 16, 26, 4, 1);
    // Arms
    r(skin, 7, 11, 3, 8);
    r(dark, 6, 19, 3, 3);
    r(skin, 18, 11, 3, 8);
    r(dark, 19, 19, 3, 3);
    // Head
    r(skin, 10, 2, 8, 8);
    r(lit, 10, 2, 8, 1);
    r(dark, 10, 2, 1, 8);
    r(dark, 11, 6, 2, 2);
    r(dark, 15, 6, 2, 2);
    r(flash || '#ff8800', 11, 4, 2, 2);
    r(flash || '#ff8800', 15, 4, 2, 2);
    r(dark, 12, 8, 4, 1);
    r(dark, 9, 0, 2, 3);
    r(dark, 17, 0, 2, 3);
  }

  private drawGuardianSerpent(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d4c47a'; // gilded scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.16); // coiled body
    ctx.fillRect(s * 0.3, s * 0.56, s * 0.4, s * 0.14); // coil base
    ctx.fillRect(s * 0.6, s * 0.22, s * 0.22, s * 0.2); // raised head
    ctx.fillStyle = '#b8a858'; // scale bands
    ctx.fillRect(s * 0.28, s * 0.46, s * 0.44, s * 0.04);
    ctx.fillStyle = '#fff8d0'; // ward inscriptions
    ctx.fillRect(s * 0.36, s * 0.48, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.48, s * 0.04, s * 0.06);
    ctx.fillStyle = '#4ac8ff'; // warding eyes
    ctx.fillRect(s * 0.7, s * 0.28, s * 0.05, s * 0.05);
    ctx.fillStyle = '#1a2a30'; // forked tongue
    ctx.fillRect(s * 0.78, s * 0.36, s * 0.08, s * 0.03);
    ctx.fillStyle = '#f0e6b0'; // crest
    ctx.fillRect(s * 0.66, s * 0.16, s * 0.08, s * 0.06);
  }

  private drawMarid(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3aa8d4'; // sea-genie blue
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.4); // powerful torso
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.12, s * 0.14); // tapering to vapor
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.18); // proud head
    ctx.fillStyle = '#78d8f0'; // flowing water sash
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.08, s * 0.34);
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.08, s * 0.34);
    ctx.fillStyle = '#f4e8c0'; // turban wrap
    ctx.fillRect(s * 0.36, s * 0.0, s * 0.28, s * 0.08);
    ctx.fillStyle = '#ffd700'; // turban jewel
    ctx.fillRect(s * 0.47, s * 0.02, s * 0.06, s * 0.05);
    ctx.fillStyle = '#ffffff'; // commanding eyes
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#a8e8f8'; // spray of brine
    ctx.globalAlpha = 0.5;
    ctx.fillRect(s * 0.2, s * 0.7, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.66, s * 0.7, s * 0.14, s * 0.08);
    ctx.globalAlpha = 1;
  }

  private drawLeonal(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d4a848'; // golden lion guardinal
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.48, s * 0.34); // leonine torso
    ctx.fillRect(s * 0.28, s * 0.64, s * 0.14, s * 0.22); // legs
    ctx.fillRect(s * 0.58, s * 0.64, s * 0.14, s * 0.22);
    ctx.fillRect(s * 0.36, s * 0.06, s * 0.28, s * 0.24); // noble head
    ctx.fillStyle = '#f0d888'; // radiant mane
    ctx.fillRect(s * 0.3, s * 0.0, s * 0.4, s * 0.12);
    ctx.fillRect(s * 0.28, s * 0.08, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.66, s * 0.08, s * 0.06, s * 0.16);
    ctx.fillStyle = '#8a6828'; // clawed arms
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.1, s * 0.28);
    ctx.fillRect(s * 0.74, s * 0.34, s * 0.1, s * 0.28);
    ctx.fillStyle = '#ffffff'; // righteous eyes
    ctx.fillRect(s * 0.43, s * 0.14, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.14, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e8d090'; // fangs
    ctx.fillRect(s * 0.44, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.26, s * 0.04, s * 0.04);
  }

  private drawAvoral(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c8d8e8'; // hawk-white guardinal
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.26, s * 0.36); // tall torso
    ctx.fillRect(s * 0.38, s * 0.66, s * 0.1, s * 0.2); // taloned legs
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.18, s * 0.2); // keen face
    ctx.fillStyle = '#8aa8c8'; // great wings spread
    ctx.fillRect(s * 0.06, s * 0.26, s * 0.3, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.26, s * 0.3, s * 0.08);
    ctx.fillRect(s * 0.08, s * 0.34, s * 0.24, s * 0.05);
    ctx.fillRect(s * 0.66, s * 0.34, s * 0.24, s * 0.05);
    ctx.fillStyle = '#ffd700'; // truth-piercing eyes
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = '#e8b830'; // hooked beak
    ctx.fillRect(s * 0.46, s * 0.24, s * 0.08, s * 0.06);
    ctx.fillStyle = '#f0e6c0'; // crest feathers
    ctx.fillRect(s * 0.42, s * 0.04, s * 0.14, s * 0.06);
  }

  private drawGuardinalLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#e8c860'; // blazing gold
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.2, s * 0.52, s * 0.46); // towering torso
    ctx.fillRect(s * 0.26, s * 0.66, s * 0.16, s * 0.24); // legs
    ctx.fillRect(s * 0.58, s * 0.66, s * 0.16, s * 0.24);
    ctx.fillRect(s * 0.34, s * 0.02, s * 0.32, s * 0.22); // crowned head
    ctx.fillStyle = '#fff4c0'; // radiant halo
    ctx.fillRect(s * 0.22, s * -0.02, s * 0.56, s * 0.05);
    ctx.fillStyle = '#d4a030'; // wing shadows
    ctx.fillRect(s * 0.04, s * 0.24, s * 0.2, s * 0.3);
    ctx.fillRect(s * 0.76, s * 0.24, s * 0.2, s * 0.3);
    ctx.fillStyle = '#ffffff'; // trumpet-bright eyes
    ctx.fillRect(s * 0.42, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillStyle = '#c88818'; // scepter of hosts
    ctx.fillRect(s * 0.78, s * 0.14, s * 0.05, s * 0.56);
    ctx.fillStyle = '#fff8d0'; // scepter star
    ctx.fillRect(s * 0.76, s * 0.06, s * 0.09, s * 0.09);
  }

  private drawFooLion(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5aa87a'; // carved jade
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.56, s * 0.28); // crouched body
    ctx.fillRect(s * 0.14, s * 0.64, s * 0.12, s * 0.18); // paws
    ctx.fillRect(s * 0.52, s * 0.64, s * 0.12, s * 0.18);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.24, s * 0.22); // mane-framed head
    ctx.fillStyle = '#3a7a56'; // carved mane curls
    ctx.fillRect(s * 0.5, s * 0.14, s * 0.34, s * 0.1);
    ctx.fillRect(s * 0.5, s * 0.24, s * 0.08, s * 0.18);
    ctx.fillRect(s * 0.78, s * 0.24, s * 0.08, s * 0.18);
    ctx.fillStyle = '#d4f4e0'; // polished highlights
    ctx.fillRect(s * 0.24, s * 0.44, s * 0.2, s * 0.04);
    ctx.fillStyle = '#ffd700'; // guardian eyes
    ctx.fillRect(s * 0.64, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillStyle = '#2a5a40'; // open warning maw
    ctx.fillRect(s * 0.68, s * 0.38, s * 0.1, s * 0.05);
  }

  private drawKirin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#e8d8a8'; // omen-gold hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.18, s * 0.36, s * 0.5, s * 0.24); // deer-like body
    ctx.fillRect(s * 0.2, s * 0.6, s * 0.1, s * 0.24); // hooved legs
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.1, s * 0.24);
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.2, s * 0.22); // noble head
    ctx.fillStyle = '#c8a850'; // dragon scales along spine
    ctx.fillRect(s * 0.22, s * 0.32, s * 0.42, s * 0.05);
    ctx.fillStyle = '#ff6a2a'; // flame mane and tail
    ctx.fillRect(s * 0.62, s * 0.06, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.04, s * 0.3, s * 0.14, s * 0.08);
    ctx.fillStyle = '#2a4a2a'; // branching antlers
    ctx.fillRect(s * 0.64, s * 0.0, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.0, s * 0.04, s * 0.1);
    ctx.fillStyle = '#ffd700'; // judgement eyes
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillStyle = '#fff'; // hooves of light
    ctx.fillRect(s * 0.2, s * 0.82, s * 0.1, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.82, s * 0.1, s * 0.04);
  }

  private drawHellKnight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a3a44'; // blackened iron plate
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.42); // armored torso
    ctx.fillRect(s * 0.32, s * 0.66, s * 0.12, s * 0.26); // legs
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.26);
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.22, s * 0.18); // great helm
    ctx.fillStyle = '#8a2020'; // crimson plume and tabard
    ctx.fillRect(s * 0.42, s * 0.02, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.44, s * 0.3, s * 0.1, s * 0.3);
    ctx.fillStyle = '#ff5522'; // burning signet glow
    ctx.fillRect(s * 0.66, s * 0.34, s * 0.08, s * 0.08);
    ctx.fillStyle = '#b8b8c0'; // sword edge
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.05, s * 0.5);
    ctx.fillStyle = '#ffd700'; // visor slit
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.14, s * 0.04);
  }

  private drawIronMarshal(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5a4a52'; // dusky iron
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.2, s * 0.48, s * 0.46); // broad armored mass
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.14, s * 0.28); // legs
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.4, s * 0.06, s * 0.24, s * 0.16); // crested helm
    ctx.fillStyle = '#d8d8e0'; // long halberd
    ctx.fillRect(s * 0.74, s * 0.1, s * 0.04, s * 0.72);
    ctx.fillRect(s * 0.68, s * 0.04, s * 0.16, s * 0.08);
    ctx.fillStyle = '#c03020'; // contract wax seal
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.1, s * 0.1);
    ctx.fillStyle = '#ff4422'; // burning eyes
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.05, s * 0.04);
  }

  private drawDeathKnightCaptain(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#2a2a34'; // tomb-black plate
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.4, s * 0.44); // torso
    ctx.fillRect(s * 0.32, s * 0.66, s * 0.12, s * 0.28); // legs
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.22, s * 0.18); // horned helm
    ctx.fillStyle = '#16161e'; // horn tips
    ctx.fillRect(s * 0.34, s * 0.0, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.58, s * 0.0, s * 0.06, s * 0.1);
    ctx.fillStyle = '#6a1a1a'; // tattered black banner cape
    ctx.fillRect(s * 0.24, s * 0.24, s * 0.08, s * 0.5);
    ctx.fillStyle = '#7fe8d8'; // cold soul-fire eyes
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.12, s * 0.06, s * 0.04);
    ctx.fillStyle = '#c8c8d8'; // runeblade
    ctx.fillRect(s * 0.72, s * 0.18, s * 0.05, s * 0.54);
    ctx.fillStyle = '#7fe8d8'; // rune glow
    ctx.fillRect(s * 0.72, s * 0.34, s * 0.05, s * 0.06);
  }

  private drawAntipaladin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#1e1e28'; // void-black armor
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.4, s * 0.44);
    ctx.fillRect(s * 0.32, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.22, s * 0.18);
    ctx.fillStyle = '#4a1a4a'; // withering aura cape
    ctx.fillRect(s * 0.24, s * 0.22, s * 0.08, s * 0.54);
    ctx.fillStyle = '#b030e0'; // dark patron glow
    ctx.fillRect(s * 0.46, s * 0.02, s * 0.06, s * 0.06);
    ctx.fillStyle = '#e0b040'; // oathbreaker sigil
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.12, s * 0.12);
    ctx.fillStyle = '#d84040'; // fell eyes
    ctx.fillRect(s * 0.42, s * 0.13, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.13, s * 0.06, s * 0.04);
  }

  private drawHornedDevilCaptain(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a2818'; // scorched crimson hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.26, s * 0.48, s * 0.4); // hulking torso
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.14, s * 0.28); // digitigrade legs
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.18); // horned head
    ctx.fillStyle = '#2a1a12'; // great horns
    ctx.fillRect(s * 0.3, s * 0.02, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.02, s * 0.08, s * 0.14);
    ctx.fillStyle = '#d8d8d8'; // infernal whip
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.04, s * 0.4);
    ctx.fillStyle = '#ffb020'; // whip tip ember
    ctx.fillRect(s * 0.72, s * 0.68, s * 0.04, s * 0.06);
    ctx.fillStyle = '#ffd020'; // burning eyes
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.05, s * 0.04);
  }

  private drawChainDevil(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a8a92'; // pale gaunt flesh
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.42);
    ctx.fillRect(s * 0.34, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.2, s * 0.18); // narrow skull head
    ctx.fillStyle = '#4a4a52'; // animated chains
    ctx.fillRect(s * 0.2, s * 0.14, s * 0.06, s * 0.56);
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.06, s * 0.56);
    ctx.fillRect(s * 0.2, s * 0.14, s * 0.6, s * 0.06);
    ctx.fillStyle = '#c0b0a0'; // prisoner faces on links
    ctx.fillRect(s * 0.21, s * 0.3, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.75, s * 0.44, s * 0.04, s * 0.06);
    ctx.fillStyle = '#e04040'; // hollow eyes
    ctx.fillRect(s * 0.43, s * 0.14, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.14, s * 0.05, s * 0.04);
  }

  private drawVampireLordSpawn(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c8b8c8'; // noble pale skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.22, s * 0.36, s * 0.44);
    ctx.fillRect(s * 0.34, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.22, s * 0.2); // aristocratic head
    ctx.fillStyle = '#5a1020'; // bloodline cape
    ctx.fillRect(s * 0.22, s * 0.24, s * 0.1, s * 0.56);
    ctx.fillStyle = '#e0e0f0'; // high collar
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.4, s * 0.06);
    ctx.fillStyle = '#d02020'; // blood thirst glow
    ctx.fillRect(s * 0.42, s * 0.13, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.13, s * 0.06, s * 0.04);
    ctx.fillStyle = '#f0f0f0'; // fangs
    ctx.fillRect(s * 0.44, s * 0.24, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.24, s * 0.03, s * 0.05);
  }

  private drawGreenSlaad(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a7a2a'; // mottled green hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.64, s * 0.36); // squat toad body
    ctx.fillRect(s * 0.22, s * 0.66, s * 0.12, s * 0.24); // bent legs
    ctx.fillRect(s * 0.6, s * 0.66, s * 0.12, s * 0.24);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.26, s * 0.2); // wide head
    ctx.fillStyle = '#d8e8a0'; // pale belly
    ctx.fillRect(s * 0.26, s * 0.5, s * 0.5, s * 0.14);
    ctx.fillStyle = '#e0e060'; // egg-spur claws
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.78, s * 0.4, s * 0.08, s * 0.1);
    ctx.fillStyle = '#ffd020'; // chaos eyes
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillStyle = '#5a2a2a'; // broad mouth
    ctx.fillRect(s * 0.58, s * 0.28, s * 0.2, s * 0.04);
  }

  private drawGraySlaad(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a6a7a'; // slate-gray hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.64, s * 0.36);
    ctx.fillRect(s * 0.22, s * 0.66, s * 0.12, s * 0.24);
    ctx.fillRect(s * 0.6, s * 0.66, s * 0.12, s * 0.24);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.26, s * 0.2);
    ctx.fillStyle = '#b0b0d0'; // spell-croak throat
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.14, s * 0.08);
    ctx.fillStyle = '#c060e0'; // arcane sparks
    ctx.fillRect(s * 0.14, s * 0.26, s * 0.07, s * 0.07);
    ctx.fillRect(s * 0.8, s * 0.26, s * 0.07, s * 0.07);
    ctx.fillStyle = '#ffe080'; // sorcerous eyes
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.06, s * 0.05);
  }

  private drawStormGiantElder(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a9ac8'; // storm-blue skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.22, s * 0.14, s * 0.56, s * 0.5); // titan torso
    ctx.fillRect(s * 0.26, s * 0.64, s * 0.18, s * 0.32); // massive legs
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.18, s * 0.32);
    ctx.fillRect(s * 0.38, s * 0.0, s * 0.24, s * 0.18); // head
    ctx.fillStyle = '#e8d878'; // braided storm hair
    ctx.fillRect(s * 0.34, s * 0.0, s * 0.32, s * 0.05);
    ctx.fillStyle = '#d8d8e8'; // great spear
    ctx.fillRect(s * 0.76, s * 0.02, s * 0.05, s * 0.86);
    ctx.fillStyle = '#a0d8ff'; // crackling lightning
    ctx.fillRect(s * 0.16, s * 0.2, s * 0.06, s * 0.3);
    ctx.fillStyle = '#fff'; // calm storm eyes
    ctx.fillRect(s * 0.42, s * 0.07, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.07, s * 0.05, s * 0.04);
  }

  private drawCloudGiantSmiling(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d8c8e8'; // pale cloud-lavender skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.16, s * 0.6, s * 0.48);
    ctx.fillRect(s * 0.26, s * 0.64, s * 0.2, s * 0.32);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.2, s * 0.32);
    ctx.fillRect(s * 0.36, s * 0.02, s * 0.28, s * 0.18); // noble head
    ctx.fillStyle = '#f0e8f8'; // cloud-white robe
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.14, s * 0.5);
    ctx.fillStyle = '#88a0d0'; // sky-silk sash
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.6, s * 0.06);
    ctx.fillStyle = '#ffd060'; // golden circlet
    ctx.fillRect(s * 0.38, s * 0.0, s * 0.24, s * 0.04);
    ctx.fillStyle = '#fff'; // courteous eyes
    ctx.fillRect(s * 0.42, s * 0.08, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.08, s * 0.05, s * 0.04);
  }

  private drawSolarCaptain(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#f0e0c0'; // radiant golden skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.2, s * 0.44, s * 0.44);
    ctx.fillRect(s * 0.32, s * 0.64, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.4, s * 0.04, s * 0.2, s * 0.18); // serene head
    ctx.fillStyle = '#fff8e0'; // four great wings
    ctx.fillRect(s * 0.06, s * 0.14, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.06, s * 0.3, s * 0.18, s * 0.1);
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.3, s * 0.18, s * 0.1);
    ctx.fillStyle = '#ffd700'; // halo of verdicts
    ctx.fillRect(s * 0.36, s * 0.0, s * 0.28, s * 0.04);
    ctx.fillStyle = '#d8d8e8'; // greatsword of verdict
    ctx.fillRect(s * 0.78, s * 0.24, s * 0.06, s * 0.56);
    ctx.fillStyle = '#ffe8a0'; // shining eyes
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.1, s * 0.05, s * 0.04);
  }

  private drawPlanetarWarden(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#a8d8b8'; // emerald celestial skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.4, s * 0.46);
    ctx.fillRect(s * 0.32, s * 0.64, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.4, s * 0.02, s * 0.2, s * 0.18);
    ctx.fillStyle = '#f0fff0'; // two great wings
    ctx.fillRect(s * 0.04, s * 0.16, s * 0.24, s * 0.14);
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.24, s * 0.14);
    ctx.fillStyle = '#ffe080'; // gate keys at belt
    ctx.fillRect(s * 0.44, s * 0.5, s * 0.12, s * 0.08);
    ctx.fillStyle = '#fff'; // unblinking eyes
    ctx.fillRect(s * 0.44, s * 0.08, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.08, s * 0.05, s * 0.04);
  }

  private drawDevaLieutenant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#e8e0d0'; // soft ivory skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.22, s * 0.36, s * 0.42);
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.4, s * 0.06, s * 0.2, s * 0.18);
    ctx.fillStyle = '#f8f4e8'; // graceful wings
    ctx.fillRect(s * 0.08, s * 0.2, s * 0.22, s * 0.12);
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.22, s * 0.12);
    ctx.fillStyle = '#ffd890'; // warm inner light
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.12, s * 0.12);
    ctx.fillStyle = '#fff'; // kind eyes
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.12, s * 0.05, s * 0.04);
  }

  private drawSeraphWatcher(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#f0e8f8'; // radiant white form
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.44);
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.4, s * 0.04, s * 0.2, s * 0.18);
    ctx.fillStyle = '#ffe8b0'; // six burning wings
    ctx.fillRect(s * 0.02, s * 0.12, s * 0.26, s * 0.1);
    ctx.fillRect(s * 0.02, s * 0.26, s * 0.24, s * 0.1);
    ctx.fillRect(s * 0.02, s * 0.4, s * 0.22, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.12, s * 0.26, s * 0.1);
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.24, s * 0.1);
    ctx.fillRect(s * 0.76, s * 0.4, s * 0.22, s * 0.1);
    ctx.fillStyle = '#ffd700'; // ring of eyes halo
    ctx.fillRect(s * 0.34, s * 0.0, s * 0.32, s * 0.04);
    ctx.fillStyle = '#ff8830'; // record-keeping gaze
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.1, s * 0.05, s * 0.04);
  }

  private drawDuergarSoulblade(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a7a82'; // gray dwarf skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.36, s * 0.42);
    ctx.fillRect(s * 0.34, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.16); // bald head
    ctx.fillStyle = '#3a3a44'; // stone-gray armor
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.4, s * 0.2);
    ctx.fillStyle = '#c8d8e8'; // soul-drinking blade
    ctx.fillRect(s * 0.72, s * 0.18, s * 0.05, s * 0.5);
    ctx.fillStyle = '#80c0ff'; // soul glow on blade
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.05, s * 0.08);
    ctx.fillStyle = '#e04040'; // murderer eyes
    ctx.fillRect(s * 0.44, s * 0.15, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.15, s * 0.05, s * 0.04);
    ctx.fillStyle = '#4a4a52'; // braided beard
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.16, s * 0.1);
  }

  private drawDuergarWarlord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a8a90'; // ashen skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.2, s * 0.44, s * 0.46); // broad torso
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.16, s * 0.28);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.16, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.16); // crowned head
    ctx.fillStyle = '#5a4a38'; // iron war-crown
    ctx.fillRect(s * 0.36, s * 0.02, s * 0.28, s * 0.06);
    ctx.fillStyle = '#3a3a42'; // heavy plate
    ctx.fillRect(s * 0.26, s * 0.26, s * 0.48, s * 0.24);
    ctx.fillStyle = '#b8b8c0'; // great hammer
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.05, s * 0.6);
    ctx.fillRect(s * 0.68, s * 0.08, s * 0.17, s * 0.12);
    ctx.fillStyle = '#d04040'; // wrathful eyes
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = '#4a4a50'; // war braids
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.32, s * 0.08);
  }

  private drawOniNightmare(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#4a5a7a'; // storm-cloud blue hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.22, s * 0.2, s * 0.56, s * 0.46); // ogre bulk
    ctx.fillRect(s * 0.26, s * 0.66, s * 0.16, s * 0.28);
    ctx.fillRect(s * 0.58, s * 0.66, s * 0.16, s * 0.28);
    ctx.fillRect(s * 0.36, s * 0.04, s * 0.28, s * 0.2); // horned head
    ctx.fillStyle = '#e8d860'; // twin horns
    ctx.fillRect(s * 0.32, s * 0.0, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.0, s * 0.06, s * 0.1);
    ctx.fillStyle = '#d84040'; // nightmare eyes
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.55, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = '#f0f0f0'; // tusks
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.04, s * 0.06);
    ctx.fillStyle = '#8a6a3a'; // iron kanabo club
    ctx.fillRect(s * 0.74, s * 0.24, s * 0.06, s * 0.5);
    ctx.fillStyle = '#2a3a5a'; // cloud wisps
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.4, s * 0.08, s * 0.06);
  }

  private drawBansheeQueen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d8e8e0'; // pale corpse-green skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.2, s * 0.36, s * 0.44);
    ctx.fillRect(s * 0.36, s * 0.64, s * 0.28, s * 0.3); // trailing wisp lower body
    ctx.fillRect(s * 0.38, s * 0.04, s * 0.24, s * 0.2); // long-haired head
    ctx.fillStyle = '#a8c8b8'; // drifting hair
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.08, s * 0.34);
    ctx.fillRect(s * 0.62, s * 0.04, s * 0.08, s * 0.34);
    ctx.fillStyle = '#f0f8f0'; // tattered grave shroud
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.24);
    ctx.fillStyle = '#40e0c0'; // wailing mouth glow
    ctx.fillRect(s * 0.45, s * 0.18, s * 0.1, s * 0.05);
    ctx.fillStyle = '#101810'; // hollow eye pits
    ctx.fillRect(s * 0.42, s * 0.11, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.11, s * 0.05, s * 0.04);
    ctx.fillStyle = '#b0e0d0'; // sound-wave ripple
    ctx.fillRect(s * 0.14, s * 0.14, s * 0.05, s * 0.2);
    ctx.fillRect(s * 0.82, s * 0.14, s * 0.05, s * 0.2);
  }

  private drawGraveWight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a6a5a'; // grave-mold gray-green
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.4, s * 0.44);
    ctx.fillRect(s * 0.32, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.08, s * 0.22, s * 0.16);
    ctx.fillStyle = '#4a4a3a'; // barrow rags
    ctx.fillRect(s * 0.26, s * 0.26, s * 0.1, s * 0.44);
    ctx.fillStyle = '#c0c8a0'; // life-drain talons
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.72, s * 0.4, s * 0.1, s * 0.08);
    ctx.fillStyle = '#ffd040'; // grave-gold hoard glint
    ctx.fillRect(s * 0.44, s * 0.38, s * 0.12, s * 0.06);
    ctx.fillStyle = '#ff5050'; // jealous ember eyes
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.14, s * 0.05, s * 0.04);
  }

  private drawBarrowWarden(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5a5a4a'; // rusted honor plate
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.2, s * 0.44, s * 0.46);
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.18); // great helm
    ctx.fillStyle = '#8a5a2a'; // rust streaks
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.62, s * 0.44, s * 0.06, s * 0.16);
    ctx.fillStyle = '#2a2a24'; // helm slit
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.16, s * 0.04);
    ctx.fillStyle = '#7ae0a0'; // undying oath glow
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = '#a8a89a'; // ceremonial halberd
    ctx.fillRect(s * 0.76, s * 0.1, s * 0.04, s * 0.72);
    ctx.fillRect(s * 0.7, s * 0.06, s * 0.16, s * 0.07);
  }

  private drawCryptThing(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c8b898'; // dry bone parchment
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.32, s * 0.42); // gaunt frame
    ctx.fillRect(s * 0.36, s * 0.66, s * 0.1, s * 0.28);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.1, s * 0.28);
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.16); // skull
    ctx.fillStyle = '#6a5a3a'; // hooded cloak
    ctx.fillRect(s * 0.28, s * 0.18, s * 0.44, s * 0.14);
    ctx.fillRect(s * 0.28, s * 0.18, s * 0.08, s * 0.5);
    ctx.fillRect(s * 0.64, s * 0.18, s * 0.08, s * 0.5);
    ctx.fillStyle = '#40c0e0'; // gaze-scatter eyes
    ctx.fillRect(s * 0.44, s * 0.15, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.15, s * 0.05, s * 0.04);
    ctx.fillStyle = '#a89878'; // skeletal fingers
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.64, s * 0.42, s * 0.06, s * 0.06);
  }

  private drawMohrg(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a7a5a'; // corpse-flesh tan
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.4, s * 0.44);
    ctx.fillRect(s * 0.32, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.14); // eyeless head
    ctx.fillStyle = '#5a4a34'; // wrappings
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.08, s * 0.36);
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.08, s * 0.36);
    ctx.fillStyle = '#d04070'; // grasping tongue-maw
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.47, s * 0.26, s * 0.06, s * 0.12);
    ctx.fillStyle = '#e8d8a0'; // paralytic claw
    ctx.fillRect(s * 0.2, s * 0.38, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.7, s * 0.38, s * 0.1, s * 0.1);
  }

  private drawDevourer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#4a4a52'; // husk void-gray
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.16, s * 0.52, s * 0.5); // floating husk
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.38, s * 0.02, s * 0.24, s * 0.16); // hollow crown head
    ctx.fillStyle = '#2a2a32'; // ribcage cage
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.06, s * 0.24);
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.06, s * 0.24);
    ctx.fillRect(s * 0.54, s * 0.34, s * 0.06, s * 0.24);
    ctx.fillRect(s * 0.64, s * 0.34, s * 0.06, s * 0.24);
    ctx.fillStyle = '#70e0ff'; // caged soul glow
    ctx.fillRect(s * 0.44, s * 0.4, s * 0.12, s * 0.12);
    ctx.fillStyle = '#a0e8ff'; // spirit scream wisps
    ctx.fillRect(s * 0.14, s * 0.24, s * 0.07, s * 0.05);
    ctx.fillRect(s * 0.8, s * 0.3, s * 0.07, s * 0.05);
    ctx.fillStyle = '#d0e8ff'; // hollow eyes
    ctx.fillRect(s * 0.42, s * 0.08, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.08, s * 0.05, s * 0.04);
  }

  private drawNightwalker(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#1a1a24'; // negative-energy void black
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.12, s * 0.6, s * 0.52); // colossus frame
    ctx.fillRect(s * 0.24, s * 0.64, s * 0.2, s * 0.34); // stilt legs
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.2, s * 0.34);
    ctx.fillRect(s * 0.36, s * 0.0, s * 0.28, s * 0.16); // eyeless skull
    ctx.fillStyle = '#3a3a4a'; // tattered void flesh
    ctx.fillRect(s * 0.12, s * 0.2, s * 0.1, s * 0.4);
    ctx.fillRect(s * 0.78, s * 0.2, s * 0.1, s * 0.4);
    ctx.fillStyle = '#b040ff'; // unmaking aura
    ctx.fillRect(s * 0.06, s * 0.32, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.88, s * 0.32, s * 0.06, s * 0.14);
    ctx.fillStyle = '#ff3050'; // annihilation maw
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.12, s * 0.04);
    ctx.fillStyle = '#7040a0'; // shadow drip
    ctx.fillRect(s * 0.3, s * 0.9, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.9, s * 0.06, s * 0.08);
  }

  private drawPhantomLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#b8c8d8'; // spectral aristocrat blue
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.2, s * 0.36, s * 0.44);
    ctx.fillRect(s * 0.38, s * 0.64, s * 0.24, s * 0.3); // fading tail
    ctx.fillRect(s * 0.38, s * 0.04, s * 0.24, s * 0.18); // noble head
    ctx.fillStyle = '#8a9ab0'; // high-collar cloak
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.44, s * 0.1);
    ctx.fillRect(s * 0.26, s * 0.28, s * 0.08, s * 0.4);
    ctx.fillRect(s * 0.66, s * 0.28, s * 0.08, s * 0.4);
    ctx.fillStyle = '#e0f0ff'; // ghostly lace cuffs
    ctx.fillRect(s * 0.28, s * 0.46, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.64, s * 0.46, s * 0.08, s * 0.06);
    ctx.fillStyle = '#40a0ff'; // commanding will-o-wisp eyes
    ctx.fillRect(s * 0.43, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillStyle = '#d0e0f0'; // lesser spirit attendants
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.84, s * 0.36, s * 0.06, s * 0.1);
  }

  private drawGithyankiGish(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#a8b868'; // gith yellow-green skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.2, s * 0.36, s * 0.44);
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.38, s * 0.04, s * 0.24, s * 0.18); // pointed-ear head
    ctx.fillStyle = '#3a3a2a'; // psionic focus robe
    ctx.fillRect(s * 0.28, s * 0.26, s * 0.44, s * 0.12);
    ctx.fillStyle = '#e0e0e8'; // silver greatsword
    ctx.fillRect(s * 0.74, s * 0.1, s * 0.06, s * 0.68);
    ctx.fillStyle = '#80d0ff'; // mind-blast glow
    ctx.fillRect(s * 0.16, s * 0.14, s * 0.08, s * 0.08);
    ctx.fillStyle = '#50c040'; // fierce eyes
    ctx.fillRect(s * 0.43, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillStyle = '#2a2a1a'; // topknot
    ctx.fillRect(s * 0.46, s * 0.0, s * 0.08, s * 0.05);
  }

  private drawGithzeraiZerth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#98a860'; // leaner gith green
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.32, s * 0.44);
    ctx.fillRect(s * 0.36, s * 0.64, s * 0.1, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.1, s * 0.3);
    ctx.fillRect(s * 0.4, s * 0.06, s * 0.2, s * 0.16);
    ctx.fillStyle = '#4a4a3a'; // monastic wrap
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.4, s * 0.1);
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.06);
    ctx.fillStyle = '#d8e8c0'; // shaped-chaos blade
    ctx.fillRect(s * 0.72, s * 0.24, s * 0.04, s * 0.44);
    ctx.fillStyle = '#c080ff'; // limbo stillness field
    ctx.fillRect(s * 0.12, s * 0.3, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.8, s * 0.3, s * 0.08, s * 0.2);
    ctx.fillStyle = '#3a5a2a'; // serene eyes
    ctx.fillRect(s * 0.44, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.12, s * 0.05, s * 0.04);
  }

  private drawElderTempest(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a8ab8'; // storm-front blue-gray
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.36); // serpentine core
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.24, s * 0.18); // rising neck
    ctx.fillRect(s * 0.68, s * 0.08, s * 0.2, s * 0.16); // head
    ctx.fillStyle = '#a8b8e0'; // cloud-wing spans
    ctx.fillRect(s * 0.04, s * 0.24, s * 0.26, s * 0.12);
    ctx.fillRect(s * 0.04, s * 0.4, s * 0.24, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.42, s * 0.24, s * 0.12);
    ctx.fillStyle = '#ffe840'; // lightning veins
    ctx.fillRect(s * 0.34, s * 0.36, s * 0.28, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.48, s * 0.16, s * 0.04);
    ctx.fillStyle = '#fff'; // storm eyes
    ctx.fillRect(s * 0.74, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.82, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillStyle = '#d0d8f0'; // rain-shed trail
    ctx.fillRect(s * 0.2, s * 0.62, s * 0.5, s * 0.05);
  }

  private drawKrakenPriest(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a8a7a'; // drowned sea-green skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.2, s * 0.36, s * 0.44);
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.64, s * 0.12, s * 0.3);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.18);
    ctx.fillStyle = '#3a5a4a'; // deep-vestment robe
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.44, s * 0.2);
    ctx.fillStyle = '#c04040'; // kraken-cult tentacle sigil
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.4, s * 0.4, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.4, s * 0.06, s * 0.06);
    ctx.fillStyle = '#a0d0e0'; // brine-drip beard
    ctx.fillRect(s * 0.42, s * 0.22, s * 0.16, s * 0.1);
    ctx.fillStyle = '#40e0a0'; // eldritch command eyes
    ctx.fillRect(s * 0.43, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = '#80b8c0'; // trident of the deep
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.04, s * 0.62);
    ctx.fillRect(s * 0.68, s * 0.08, s * 0.16, s * 0.05);
  }

  private drawMindFlayerArchmage(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#8f6fb0';
    const lit = flash || '#b895d4';
    const dark = flash || '#583f73';
    const robe = flash || '#241a3c';
    const robeLit = flash || '#3d2c60';
    const robeDark = flash || '#130d21';
    const arc = flash || '#59d8f2';
    // It hovers: the robe narrows to a point instead of standing on a hem,
    // and a staff runs the full height beside it. That, and the arcane
    // trim, is the whole difference from the mind flayer at this size.
    r(robe, 9, 14, 10, 8);
    r(robe, 10, 21, 8, 3);
    r(robe, 12, 24, 4, 3);
    r(robeLit, 9, 14, 10, 1);
    r(robeDark, 12, 24, 4, 1);
    r(robeDark, 11, 18, 1, 6);
    r(robeDark, 16, 18, 1, 6);
    r(arc, 10, 22, 8, 1);
    // Shoulders and the collar standing behind the head
    r(robe, 5, 10, 18, 5);
    r(robeLit, 5, 10, 18, 1);
    r(arc, 5, 14, 18, 1);
    r(robe, 4, 3, 4, 8);
    r(robe, 20, 3, 4, 8);
    r(robeLit, 4, 3, 1, 8);
    r(robeLit, 23, 3, 1, 8);
    r(arc, 4, 3, 4, 1);
    r(arc, 20, 3, 4, 1);
    // Arms
    r(robe, 2, 12, 4, 7);
    r(robe, 22, 12, 4, 7);
    r(skin, 1, 18, 4, 3);
    r(skin, 23, 18, 4, 3);
    r(dark, 1, 21, 1, 3);
    r(dark, 3, 21, 1, 3);
    // Staff, capped with a cold arcane light
    r(flash || '#4a3520', 25, 4, 2, 22);
    r(flash || '#6b4d2e', 25, 4, 1, 22);
    r(arc, 24, 0, 4, 4);
    r(flash || '#dff8ff', 25, 1, 2, 2);
    // Cranium and tentacles
    r(skin, 9, 0, 10, 9);
    r(lit, 9, 0, 10, 1);
    r(dark, 9, 0, 1, 9);
    r(skin, 10, 9, 8, 2);
    r(dark, 9, 4, 10, 1);
    r(skin, 10, 10, 2, 6); r(dark, 8, 15, 3, 2);
    r(skin, 12, 10, 2, 8); r(dark, 10, 17, 3, 2);
    r(skin, 15, 10, 2, 8); r(dark, 16, 17, 3, 2);
    r(skin, 17, 10, 2, 6); r(dark, 18, 15, 3, 2);
    r(lit, 10, 10, 1, 5);
    r(lit, 15, 10, 1, 7);
    // Eyes
    r(flash || '#e9f3ff', 10, 5, 4, 2);
    r(flash || '#e9f3ff', 15, 5, 3, 2);
    r(flash || '#7fb0d8', 10, 6, 4, 1);
    r(flash || '#7fb0d8', 15, 6, 3, 1);
  }

  private drawElderBrain(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const brain = flash || '#bc7ba4';
    const lit = flash || '#e2a5c9';
    const fold = flash || '#7f466a';
    const deep = flash || '#54293f';
    const brine = flash || '#2f6f86';
    // The brine pool it sits in
    r(brine, 1, 22, 26, 4);
    r(flash || '#4f9fb8', 1, 22, 26, 1);
    r(flash || '#1d4a5c', 1, 25, 26, 1);
    r(brine, 0, 24, 4, 2);
    r(brine, 24, 24, 4, 2);
    // Two hemispheres, split by a fissure and ridged all over. The folds
    // are the whole read at this size, so they are cut hard rather than
    // shaded — a smooth dome is just a pink rock.
    r(brain, 2, 6, 24, 17);
    r(brain, 5, 3, 18, 4);
    r(lit, 5, 3, 18, 1);
    r(deep, 2, 20, 24, 3);
    r(fold, 13, 3, 2, 20);
    r(deep, 13, 3, 1, 20);
    const gyrus = (x: number, y: number, w: number) => {
      r(fold, x, y, w, 2);
      r(deep, x, y + 1, w, 1);
      r(lit, x, y - 1, w, 1);
    };
    gyrus(3, 6, 9);
    gyrus(5, 10, 7);
    gyrus(3, 14, 9);
    gyrus(5, 18, 7);
    gyrus(16, 5, 9);
    gyrus(15, 9, 8);
    gyrus(16, 13, 9);
    gyrus(15, 17, 8);
    // Tentacles trailing down into the brine
    r(brain, 0, 15, 3, 9);
    r(brain, 25, 15, 3, 9);
    r(deep, 0, 22, 3, 2);
    r(deep, 25, 22, 3, 2);
    r(brain, 7, 22, 3, 4);
    r(brain, 18, 22, 3, 4);
    r(deep, 7, 25, 3, 1);
    r(deep, 18, 25, 3, 1);
    // The two small eyes it grows in order to look back at you
    r(deep, 8, 11, 4, 4);
    r(flash || '#f6e4ef', 8, 12, 4, 3);
    r(flash || '#2a0f22', 10, 13, 2, 2);
    r(deep, 16, 11, 4, 4);
    r(flash || '#f6e4ef', 16, 12, 4, 3);
    r(flash || '#2a0f22', 16, 13, 2, 2);
  }

  private drawVampireLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d0c0d0'; // ancient noble pallor
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.18, s * 0.44, s * 0.48); // regal frame
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.38, s * 0.04, s * 0.24, s * 0.18); // crowned head
    ctx.fillStyle = '#c02020'; // blood-line cape
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.1, s * 0.58);
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.1, s * 0.58);
    ctx.fillStyle = '#ffd700'; // iron crown of the bloodline
    ctx.fillRect(s * 0.38, s * 0.0, s * 0.24, s * 0.05);
    ctx.fillRect(s * 0.42, s * 0.03, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.03, s * 0.04, s * 0.05);
    ctx.fillStyle = '#e02020'; // burning predatory eyes
    ctx.fillRect(s * 0.43, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillStyle = '#f0f0f0'; // long fangs
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.53, s * 0.18, s * 0.03, s * 0.06);
  }

  private drawDemilich(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#d8d0b8'; // aged ivory skull
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.2, s * 0.44, s * 0.4); // floating skull
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.32, s * 0.16); // jaw
    ctx.fillStyle = '#3a3a30'; // nasal cavity
    ctx.fillRect(s * 0.46, s * 0.42, s * 0.08, s * 0.1);
    ctx.fillStyle = '#8020c0'; // soul-trap gem eyes
    ctx.fillRect(s * 0.36, s * 0.32, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.32, s * 0.1, s * 0.1);
    ctx.fillStyle = '#e080ff'; // gem inner glow
    ctx.fillRect(s * 0.38, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.34, s * 0.05, s * 0.05);
    ctx.fillStyle = '#b0a890'; // teeth gaps
    ctx.fillRect(s * 0.38, s * 0.62, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.46, s * 0.62, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.62, s * 0.04, s * 0.06);
    ctx.fillStyle = '#c0b0e0'; // dread aura
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.78, s * 0.3, s * 0.08, s * 0.16);
  }

  private drawAtropal(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#b8a8b0'; // corpse-gray godflesh
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.22, s * 0.2, s * 0.56, s * 0.5); // bloated frame
    ctx.fillRect(s * 0.3, s * 0.7, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.56, s * 0.7, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.36, s * 0.06, s * 0.28, s * 0.18); // distended head
    ctx.fillStyle = '#8a2020'; // sutures and seams
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.24, s * 0.04, s * 0.3);
    ctx.fillStyle = '#301030'; // void-black eye pits
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.52, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillStyle = '#a040ff'; // negative energy seep
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.8, s * 0.34, s * 0.08, s * 0.12);
    ctx.fillStyle = '#603070'; // umbilical shadow-tether
    ctx.fillRect(s * 0.46, s * 0.9, s * 0.08, s * 0.1);
  }

  private drawLichKing(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a3a44'; // royal death-plate
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.2, s * 0.44, s * 0.46);
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.18); // skull-face helm
    ctx.fillStyle = '#ffd700'; // phylactery crown
    ctx.fillRect(s * 0.36, s * 0.0, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.4, s * 0.04, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.55, s * 0.04, s * 0.05, s * 0.06);
    ctx.fillStyle = '#70e0d0'; // frozen soul-fire eyes
    ctx.fillRect(s * 0.43, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = '#b8c8d8'; // runeblade of dominion
    ctx.fillRect(s * 0.74, s * 0.12, s * 0.06, s * 0.66);
    ctx.fillStyle = '#70e0d0'; // blade runes
    ctx.fillRect(s * 0.74, s * 0.3, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.5, s * 0.06, s * 0.05);
  }

  private drawDeathTitan(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5a5a50'; // colossal bone-gray flesh
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.16, s * 0.1, s * 0.68, s * 0.54); // titan mass
    ctx.fillRect(s * 0.2, s * 0.64, s * 0.24, s * 0.36); // tree-trunk legs
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.24, s * 0.36);
    ctx.fillRect(s * 0.34, s * 0.0, s * 0.32, s * 0.14); // tiny skull head
    ctx.fillStyle = '#3a3a32'; // exposed ribs
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.3, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.64, s * 0.3, s * 0.06, s * 0.2);
    ctx.fillStyle = '#80ff60'; // necrotic marrow glow
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.12, s * 0.1);
    ctx.fillStyle = '#201a14'; // hollow sockets
    ctx.fillRect(s * 0.4, s * 0.04, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.04, s * 0.06, s * 0.04);
  }

  private drawForgeGolem(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#4a4038'; // dark iron plate
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.16, s * 0.6, s * 0.5); // blocky chassis
    ctx.fillRect(s * 0.24, s * 0.66, s * 0.2, s * 0.3);
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.2, s * 0.3);
    ctx.fillRect(s * 0.36, s * 0.04, s * 0.28, s * 0.14); // slit visor head
    ctx.fillStyle = '#ff6a20'; // molten veins
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.04);
    ctx.fillRect(s * 0.44, s * 0.38, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.38, s * 0.04, s * 0.2);
    ctx.fillStyle = '#b8b8c0'; // hammer-arm
    ctx.fillRect(s * 0.78, s * 0.2, s * 0.1, s * 0.3);
    ctx.fillRect(s * 0.72, s * 0.48, s * 0.22, s * 0.14);
    ctx.fillStyle = '#ffb020'; // visor furnace glow
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.2, s * 0.04);
  }

  private drawRuneGolem(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a6a62'; // weathered stone
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.22, s * 0.18, s * 0.56, s * 0.48);
    ctx.fillRect(s * 0.26, s * 0.66, s * 0.18, s * 0.3);
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.18, s * 0.3);
    ctx.fillRect(s * 0.38, s * 0.04, s * 0.24, s * 0.14);
    ctx.fillStyle = '#40d0ff'; // binding runes
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.47, s * 0.34, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.4, s * 0.52, s * 0.2, s * 0.04);
    ctx.fillStyle = '#c8c8c0'; // carved pauldrons
    ctx.fillRect(s * 0.16, s * 0.18, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.18, s * 0.08, s * 0.12);
    ctx.fillStyle = '#40d0ff'; // rune-lit eyes
    ctx.fillRect(s * 0.43, s * 0.08, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.53, s * 0.08, s * 0.05, s * 0.04);
  }

  private drawBrassDragonElder(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#c8a858', '#977a32', '#ff9020', '#f0e2b4', 'ancient');
  }

  private drawCopperDragonElder(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#b07040', '#824c24', '#ffb060', '#efdcb8', 'ancient');
  }

  private drawCrystalDragonElder(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#a6c6e8', '#7ba2c6', '#e0b0ff', '#f0f8ff', 'ancient');
  }

  private drawObsidianDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#26262e', '#141419', '#ff5a20', '#8c8c99', 'ancient');
  }

  private drawStormDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#5b6c9e', '#3b4870', '#ffe840', '#dfe6f4', 'ancient');
  }

  private drawPoisonDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#5c7c3a', '#3c5626', '#b8e844', '#d8dcb0', 'adult');
  }

  private drawZarielBoss(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawZariel(ctx, s, flash, 'falling');
  }

  private drawTiamatAvatar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawTiamat(ctx, s, flash);
  }

  private drawBahamutAspect(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawBahamut(ctx, s, flash);
  }

  private drawDeathKissBloodmage(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c04060'; // blood-drained flesh sphere
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.52, s * 0.44); // floating eye-sphere
    ctx.fillStyle = '#e08090'; // trailing blood-tendrils
    ctx.fillRect(s * 0.2, s * 0.6, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.38, s * 0.62, s * 0.08, s * 0.24);
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.08, s * 0.24);
    ctx.fillRect(s * 0.72, s * 0.6, s * 0.08, s * 0.2);
    ctx.fillStyle = '#e8d8d8'; // eyestalk cores
    ctx.fillRect(s * 0.16, s * 0.32, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.74, s * 0.36, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.26, s * 0.18, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.64, s * 0.18, s * 0.1, s * 0.1);
    ctx.fillStyle = '#fff'; // single blood-drinking central eye
    ctx.fillRect(s * 0.46, s * 0.4, s * 0.08, s * 0.08);
    ctx.fillStyle = '#600020'; // pupil
    ctx.fillRect(s * 0.49, s * 0.43, s * 0.03, s * 0.03);
    ctx.fillStyle = '#a01020'; // blood glow around maw
    ctx.fillRect(s * 0.42, s * 0.52, s * 0.16, s * 0.08);
    ctx.fillStyle = '#500000'; // fanged maw
    ctx.fillRect(s * 0.45, s * 0.55, s * 0.1, s * 0.04);
  }






  private drawVrockWarlord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a4a3a'; // warlord's dun hide
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.32, s * 0.3);
    ctx.fillStyle = '#8a6040'; // scarred chest
    ctx.fillRect(s * 0.38, s * 0.34, s * 0.24, s * 0.16);
    ctx.fillStyle = '#4a3020'; // vulture head
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.16);
    ctx.fillStyle = '#c8a030'; // warlord's war-crown
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.05);
    ctx.fillStyle = '#2a2a34'; // bat wings, tattered
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.14, s * 0.18);
    ctx.fillStyle = '#e8e830'; // crackling storm-spores
    ctx.fillRect(s * 0.24, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.48, s * 0.06, s * 0.05, s * 0.05);
    ctx.fillStyle = '#8a6040'; // talon legs
    ctx.fillRect(s * 0.4, s * 0.58, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.58, s * 0.08, s * 0.12);
  }

  private drawMaurezhi(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a4a3a'; // rotting demon flesh
    ctx.fillRect(s * 0.36, s * 0.26, s * 0.28, s * 0.3);
    ctx.fillStyle = '#8a6040'; // peeling skin patches
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.2, s * 0.1);
    ctx.fillStyle = '#4a3020'; // fanged head
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.24, s * 0.16);
    ctx.fillStyle = '#a03030'; // burning eyes
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#8a6040'; // stolen face mask (ghoul flesh)
    ctx.fillRect(s * 0.42, s * 0.1, s * 0.16, s * 0.06);
    ctx.fillStyle = '#6a4a3a'; // clawed arms
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.1, s * 0.14);
    ctx.fillStyle = '#8a6040'; // claws
    ctx.fillRect(s * 0.22, s * 0.26, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.04, s * 0.06);
    ctx.fillStyle = '#6a4a3a'; // legs
    ctx.fillRect(s * 0.4, s * 0.56, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.56, s * 0.08, s * 0.14);
  }

  private drawIzzru(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a2a1a'; // ash-cracked wyrm hide
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.32); // burrowing body
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.12); // neck
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.14); // head
    ctx.fillStyle = '#e8a030'; // lava cracks between scales
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.4, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.48, s * 0.12, s * 0.04);
    ctx.fillStyle = '#ffd040'; // furnace eyes
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillStyle = '#e8e8e8'; // ash-choked fangs
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.12, s * 0.04);
    ctx.fillStyle = '#7a2a1a'; // digging foreclaws (deliberately broken)
  }

  private drawOonga(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a5a3a'; // primordial ape pelt
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.34); // titan torso
    ctx.fillRect(s * 0.34, s * 0.12, s * 0.32, s * 0.16); // head
    ctx.fillStyle = '#5a3a22'; // heavy brow
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.24, s * 0.06);
    ctx.fillStyle = '#e8a030'; // molten eyes
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.05);
    ctx.fillStyle = '#5a3a22'; // stone-fist arms
    ctx.fillRect(s * 0.16, s * 0.28, s * 0.14, s * 0.26);
    ctx.fillRect(s * 0.7, s * 0.28, s * 0.14, s * 0.26);
    ctx.fillStyle = '#9a7a5a'; // granite knuckles
    ctx.fillRect(s * 0.14, s * 0.24, s * 0.18, s * 0.06);
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.18, s * 0.06);
    ctx.fillStyle = '#7a5a3a'; // legs
    ctx.fillRect(s * 0.36, s * 0.6, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.12, s * 0.16);
    ctx.fillStyle = '#e8e8e8'; // cracked ivory fangs
    ctx.fillRect(s * 0.46, s * 0.24, s * 0.08, s * 0.04);
  }

  private drawProtoRedDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#96341f', '#6a1f0f', '#ff8c1a', '#cbbfa0', 'young');
  }

  private drawSangDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#2b4c8c', '#1b3364', '#f2f24a', '#e0e8f4', 'adult');
  }

  private drawAsteri(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a3a5a'; // night-sky robe
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.32, s * 0.3); // herald's robes
    ctx.fillStyle = '#e8e8f0'; // radiant face
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.16);
    ctx.fillStyle = '#e8e830'; // halo of novas
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.65, s * 0.12, s * 0.05, s * 0.12);
    ctx.fillStyle = '#e8e8f0'; // star-sigils on robe
    ctx.fillRect(s * 0.42, s * 0.36, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.44, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.5, s * 0.04, s * 0.04);
    ctx.fillStyle = '#c8a030'; // constellation staff
    ctx.fillRect(s * 0.68, s * 0.1, s * 0.04, s * 0.32);
    ctx.fillStyle = '#e8e830'; // staff star
    ctx.fillRect(s * 0.66, s * 0.06, s * 0.08, s * 0.06);
    ctx.fillStyle = '#3a3a5a'; // robe hem
    ctx.fillRect(s * 0.36, s * 0.58, s * 0.28, s * 0.12);
  }

  private drawTitanCelestial(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c8a030'; // living gold armor
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.44, s * 0.36); // god-kin torso
    ctx.fillRect(s * 0.32, s * 0.1, s * 0.36, s * 0.16); // head
    ctx.fillStyle = '#e8e8f0'; // blazing eyes
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillStyle = '#e8e830'; // radiant halo
    ctx.fillRect(s * 0.28, s * 0.04, s * 0.44, s * 0.05);
    ctx.fillStyle = '#c8a030'; // golden pauldrons
    ctx.fillRect(s * 0.2, s * 0.24, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.12, s * 0.1);
    ctx.fillStyle = '#e8e8f0'; // greatsword of light
    ctx.fillRect(s * 0.72, s * 0.08, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.68, s * 0.04, s * 0.12, s * 0.04);
    ctx.fillStyle = '#c8a030'; // greaves
    ctx.fillRect(s * 0.36, s * 0.6, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.12, s * 0.16);
    ctx.fillStyle = '#e8e8f0'; // glowing chest sigil
    ctx.fillRect(s * 0.46, s * 0.38, s * 0.08, s * 0.08);
  }

  /**
   * The drow house shares one body — the warrior's anatomy above — so that a
   * scout, a priestess and an archmage read as one people wearing different
   * gear rather than as ten unrelated dark smudges. Silhouette does the
   * telling: the scout and assassin crouch, the guard carries a pike taller
   * than himself, the elite wears a cloak wider than his shoulders, the
   * clergy flare at the hem, the arachnomancer grows legs.
   */
  private drawDrow(
    ctx: CanvasRenderingContext2D,
    s: number,
    flash: string | undefined,
    kind:
      | 'elite'
      | 'fighter'
      | 'house_guard'
      | 'scout'
      | 'assassin'
      | 'priestess'
      | 'mage'
      | 'archmage'
      | 'matron'
      | 'arachnomancer'
  ) {
    const r = this.grid(ctx, s);
    const skin = flash || '#4b4655';
    const skinLit = flash || '#615b6d';
    const skinDk = flash || '#332f3c';
    const hair = flash || '#ddd6e2';
    const hairLit = flash || '#f2edf6';
    const hairDk = flash || '#c6bed0';
    const eye = flash || '#ff3a4a';
    const eyeDk = flash || '#5a1418';
    const boot = flash || '#1e1c24';
    const steel = flash || '#b8bfcd';
    const steelLit = flash || '#e6ecf6';
    const steelDk = flash || '#6a7080';
    const plum = flash || '#5a2a6a';
    const plumLit = flash || '#7a4090';
    const plumDk = flash || '#3a1a48';
    const gold = flash || '#c8a030';
    const violet = flash || '#a04adf';
    const violetLit = flash || '#d898ff';
    const wood = flash || '#6b4b2a';
    const blk = flash || '#1c1a22';
    const blkLit = flash || '#2e2b36';

    // The face is 7 wide with its top-left corner at (hx, hy); every variant
    // hangs its gear off that so a crouching scout keeps the guard's face.
    const face = (hx: number, hy: number) => {
      r(skin, hx, hy, 7, 7);
      r(skinLit, hx, hy, 7, 1);
      r(skinDk, hx, hy, 1, 7);
      r(skinDk, hx, hy + 2, 7, 1);
      r(eye, hx + 1, hy + 3, 2, 2);
      r(eye, hx + 5, hy + 3, 2, 2);
      r(eyeDk, hx + 1, hy + 3, 1, 2);
      r(eyeDk, hx + 5, hy + 3, 1, 2);
    };
    const ears = (hx: number, hy: number) => {
      r(skin, hx - 3, hy + 2, 3, 2);
      r(skin, hx + 7, hy + 2, 3, 2);
    };
    const hairFall = (hx: number, hy: number, len = 8) => {
      r(hair, hx - 2, hy - 2, 11, 3);
      r(hairLit, hx - 2, hy - 2, 11, 1);
      r(hairDk, hx - 2, hy + 1, 2, len);
      r(hairDk, hx + 7, hy + 1, 2, len);
    };
    const hood = (hx: number, hy: number, col: string, colDk: string) => {
      r(col, hx - 2, hy - 2, 11, 3);
      r(col, hx - 1, hy - 3, 9, 1);
      r(colDk, hx - 2, hy + 1, 2, 9);
      r(colDk, hx + 7, hy + 1, 2, 9);
    };
    const legs = (y: number) => {
      r(skinDk, 10, y, 3, 5);
      r(skinDk, 16, y, 3, 5);
      r(boot, 9, y + 4, 5, 3);
      r(boot, 15, y + 4, 5, 3);
    };
    const scourge = (x: number, y: number) => {
      // A handle with three snake-headed lashes rearing off it.
      r(wood, x, y, 2, 6);
      r(flash || '#3d7a4a', x, y - 6, 1, 6);
      r(flash || '#3d7a4a', x + 2, y - 4, 1, 4);
      r(flash || '#3d7a4a', x - 2, y - 4, 1, 4);
      r(eye, x, y - 7, 1, 1);
      r(eye, x + 2, y - 5, 1, 1);
      r(eye, x - 2, y - 5, 1, 1);
    };
    const robe = (col: string, lit: string, dk: string, trim: string) => {
      r(col, 9, 11, 11, 9);
      r(col, 7, 20, 15, 7);
      r(lit, 9, 11, 11, 1);
      r(dk, 7, 26, 15, 1);
      r(trim, 14, 12, 1, 14);
      r(col, 6, 12, 3, 7);
      r(col, 20, 12, 3, 7);
      r(skin, 6, 19, 3, 2);
      r(skin, 20, 19, 3, 2);
    };

    switch (kind) {
      case 'fighter': {
        legs(20);
        // Plate cuirass with a centre ridge
        r(steelDk, 10, 11, 9, 9);
        r(steel, 10, 11, 9, 1);
        r(flash || '#4e5462', 10, 15, 9, 1);
        r(flash || '#4e5462', 14, 11, 1, 9);
        r(steel, 8, 11, 3, 3);
        r(steel, 18, 11, 3, 3);
        r(skin, 7, 14, 3, 5);
        r(skin, 19, 13, 3, 3);
        r(skin, 21, 16, 3, 3);
        // Kite shield on the left arm, house spider on it
        r(plum, 2, 10, 7, 9);
        r(plumLit, 2, 10, 7, 1);
        r(plumDk, 2, 10, 1, 9);
        r(plum, 3, 19, 5, 3);
        r(plum, 4, 22, 3, 2);
        r(gold, 4, 13, 3, 3);
        r(gold, 3, 14, 5, 1);
        r(gold, 5, 12, 1, 5);
        // Longsword raised in the right hand
        r(steel, 23, 2, 2, 13);
        r(steelLit, 23, 2, 1, 13);
        r(gold, 21, 15, 6, 1);
        r(wood, 23, 16, 2, 3);
        face(11, 4);
        hairFall(11, 4);
        ears(11, 4);
        break;
      }
      case 'house_guard': {
        legs(20);
        // Mail under a house tabard
        r(flash || '#3b5a63', 10, 11, 9, 9);
        r(flash || '#4d717a', 10, 11, 9, 1);
        r(plum, 12, 11, 5, 9);
        r(plumLit, 12, 11, 5, 1);
        r(gold, 13, 14, 3, 1);
        r(gold, 14, 13, 1, 3);
        r(skin, 7, 12, 3, 6);
        r(skin, 19, 12, 3, 6);
        r(skin, 21, 14, 2, 3);
        // Halberd held upright, taller than the guard
        r(wood, 23, 5, 2, 22);
        r(flash || '#8d6a3d', 23, 5, 1, 22);
        r(steel, 21, 0, 6, 5);
        r(steelLit, 21, 0, 6, 1);
        r(steelDk, 21, 4, 6, 1);
        // Full helm with a house crest, face open between the cheek guards
        face(11, 4);
        r(steelDk, 9, 2, 11, 3);
        r(steel, 9, 2, 11, 1);
        r(steelDk, 9, 5, 2, 6);
        r(steelDk, 18, 5, 2, 6);
        r(plum, 12, 0, 5, 2);
        r(plumLit, 13, 0, 3, 1);
        break;
      }
      case 'scout': {
        const cloak = flash || '#3f4a44';
        const cloakLit = flash || '#55625a';
        const cloakDk = flash || '#28312c';
        // Crouched: legs bent out to the sides
        r(skinDk, 8, 21, 4, 4);
        r(skinDk, 17, 21, 4, 4);
        r(boot, 7, 24, 5, 3);
        r(boot, 17, 24, 5, 3);
        // Cloak wrapped round a low body
        r(cloak, 8, 14, 13, 8);
        r(cloakLit, 8, 14, 13, 1);
        r(cloakDk, 8, 20, 13, 2);
        r(skin, 6, 15, 3, 5);
        r(skin, 20, 15, 4, 3);
        // Hand crossbow levelled to the right
        r(wood, 21, 15, 6, 2);
        r(steel, 24, 12, 1, 8);
        r(steelLit, 20, 16, 7, 1);
        face(11, 7);
        hood(11, 7, cloak, cloakDk);
        break;
      }
      case 'assassin': {
        // Crouched wide, every inch of him black but the eyes
        r(blk, 7, 21, 4, 4);
        r(blk, 18, 21, 4, 4);
        r(boot, 6, 24, 5, 3);
        r(boot, 18, 24, 5, 3);
        r(blk, 9, 13, 11, 8);
        r(blkLit, 9, 13, 11, 1);
        // Belt of poison vials
        r(flash || '#3a3644', 9, 19, 11, 1);
        r(flash || '#4ee06a', 11, 18, 1, 3);
        r(gold, 14, 18, 1, 3);
        r(flash || '#4ee06a', 17, 18, 1, 3);
        // Arms out flat, daggers held low with poisoned tips
        r(blk, 5, 14, 4, 3);
        r(blk, 20, 14, 4, 3);
        r(steel, 2, 14, 3, 2);
        r(flash || '#4ee06a', 2, 14, 1, 2);
        r(steel, 24, 14, 3, 2);
        r(flash || '#4ee06a', 26, 14, 1, 2);
        face(11, 6);
        r(blk, 9, 4, 11, 3);
        r(blkLit, 10, 4, 9, 1);
        r(blk, 9, 7, 2, 8);
        r(blk, 18, 7, 2, 8);
        r(blk, 11, 11, 7, 2); // mask over the lower face
        break;
      }
      case 'elite': {
        // Cloak spread behind everything, wider than the shoulders
        r(plum, 5, 10, 19, 15);
        r(plumLit, 5, 10, 19, 1);
        r(plumDk, 5, 10, 1, 15);
        r(plumDk, 23, 10, 1, 15);
        r(plumDk, 5, 24, 19, 1);
        legs(20);
        r(steelDk, 10, 11, 9, 9);
        r(steel, 10, 11, 9, 1);
        r(gold, 13, 13, 3, 3);
        r(gold, 12, 14, 5, 1);
        r(steel, 8, 11, 3, 2);
        r(steel, 18, 11, 3, 2);
        r(skin, 7, 13, 3, 5);
        r(skin, 19, 13, 3, 5);
        // Longsword held point-down at the right, hand crossbow at the left
        r(wood, 22, 9, 2, 2);
        r(gold, 21, 11, 4, 1);
        r(steel, 22, 12, 2, 12);
        r(steelLit, 22, 12, 1, 12);
        r(wood, 3, 14, 5, 2);
        r(steel, 3, 12, 1, 6);
        face(11, 4);
        hairFall(11, 4);
        ears(11, 4);
        r(gold, 9, 3, 11, 1);
        break;
      }
      case 'priestess': {
        // Flared robe with a gold hem
        r(plum, 9, 11, 11, 8);
        r(plum, 8, 19, 13, 4);
        r(plum, 7, 23, 15, 4);
        r(plumLit, 9, 11, 11, 1);
        r(plumDk, 7, 26, 15, 1);
        r(gold, 7, 25, 15, 1);
        r(gold, 14, 11, 1, 14);
        r(plum, 5, 12, 4, 7);
        r(plum, 20, 12, 4, 7);
        r(skin, 5, 19, 3, 2);
        r(skin, 21, 19, 3, 2);
        // Spider on a gold disc at the breast
        r(gold, 11, 13, 7, 5);
        r(blk, 13, 14, 3, 3);
        r(blk, 12, 15, 1, 1);
        r(blk, 16, 15, 1, 1);
        scourge(24, 14);
        face(11, 4);
        hairFall(11, 4, 10);
        ears(11, 4);
        // Spider headdress
        r(blk, 11, 0, 7, 3);
        r(blk, 9, 1, 2, 1);
        r(blk, 18, 1, 2, 1);
        r(blk, 8, 0, 1, 1);
        r(blk, 20, 0, 1, 1);
        r(blk, 9, 3, 1, 1);
        r(blk, 19, 3, 1, 1);
        r(eye, 13, 1, 1, 1);
        r(eye, 15, 1, 1, 1);
        break;
      }
      case 'mage': {
        const rb = flash || '#2a2036';
        const rbLit = flash || '#3c3050';
        const rbDk = flash || '#1a1424';
        legs(20);
        robe(rb, rbLit, rbDk, violet);
        // Staff with a violet orb in the left hand
        r(wood, 3, 8, 2, 19);
        r(violet, 1, 3, 6, 5);
        r(violetLit, 2, 4, 3, 2);
        // Spellflame cupped in the right hand
        r(violet, 20, 14, 4, 4);
        r(violetLit, 21, 15, 2, 2);
        r(violet, 21, 12, 2, 2);
        face(11, 5);
        hood(11, 5, rb, rbDk);
        break;
      }
      case 'archmage': {
        const rb = flash || '#1c1430';
        const rbLit = flash || '#2c2048';
        legs(20);
        r(rb, 9, 11, 11, 9);
        r(rb, 7, 20, 15, 7);
        r(rbLit, 9, 11, 11, 1);
        r(gold, 9, 11, 11, 1);
        r(gold, 14, 12, 1, 14);
        r(gold, 7, 26, 15, 1);
        // Both arms raised, sleeves falling back
        r(rb, 5, 12, 4, 6);
        r(rb, 20, 12, 4, 6);
        r(skin, 5, 10, 3, 2);
        r(skin, 21, 10, 3, 2);
        // A tall staff standing beside, and sigils circling
        r(wood, 2, 6, 2, 21);
        r(violet, 1, 1, 5, 5);
        r(violetLit, 2, 2, 2, 2);
        r(violet, 24, 3, 3, 3);
        r(violetLit, 25, 4, 1, 1);
        r(violet, 23, 20, 2, 2);
        r(violet, 20, 6, 2, 2);
        face(11, 4);
        hairFall(11, 4, 12);
        ears(11, 4);
        r(gold, 9, 3, 11, 1);
        r(violet, 14, 2, 1, 2);
        break;
      }
      case 'matron': {
        // Gown with a train that fills the floor
        r(plum, 9, 11, 11, 7);
        r(plum, 7, 18, 15, 5);
        r(plum, 4, 23, 21, 4);
        r(plumLit, 9, 11, 11, 1);
        r(plumDk, 4, 26, 21, 1);
        r(gold, 4, 25, 21, 1);
        r(gold, 14, 12, 1, 14);
        r(plum, 6, 12, 3, 7);
        r(plum, 20, 12, 3, 7);
        r(skin, 6, 19, 3, 2);
        r(skin, 20, 19, 3, 2);
        // Spider brooch
        r(violet, 12, 13, 5, 4);
        r(violetLit, 13, 14, 3, 1);
        r(blk, 13, 15, 3, 2);
        scourge(23, 12);
        face(11, 4);
        hairFall(11, 4, 12);
        ears(11, 4);
        // Crown of house gold
        r(gold, 9, 1, 11, 2);
        r(gold, 9, 0, 1, 1);
        r(gold, 12, 0, 1, 1);
        r(gold, 14, 0, 1, 1);
        r(gold, 16, 0, 1, 1);
        r(gold, 19, 0, 1, 1);
        r(eye, 14, 1, 1, 1);
        break;
      }
      case 'arachnomancer': {
        const rb = flash || '#3a2a4a';
        const rbLit = flash || '#4e3a62';
        const rbDk = flash || '#26183a';
        // Four chitin legs sprouting from the back
        const spiderLeg = (pts: [number, number][]) => {
          for (const [x, y] of pts) r(blk, x, y, 1, 2);
        };
        spiderLeg([[8, 10], [7, 9], [6, 8], [5, 7], [4, 6], [3, 6], [2, 7], [1, 8], [1, 9], [1, 10]]);
        spiderLeg([[8, 14], [7, 14], [6, 13], [5, 12], [4, 12], [3, 13], [2, 14], [1, 15], [1, 16]]);
        spiderLeg([[19, 10], [20, 9], [21, 8], [22, 7], [23, 6], [24, 6], [25, 7], [26, 8], [26, 9], [26, 10]]);
        spiderLeg([[19, 14], [20, 14], [21, 13], [22, 12], [23, 12], [24, 13], [25, 14], [26, 15], [26, 16]]);
        legs(20);
        robe(rb, rbLit, rbDk, violet);
        r(blk, 8, 11, 4, 2);
        r(blk, 17, 11, 4, 2);
        // Violet flame in each raised palm
        r(violet, 4, 16, 3, 3);
        r(violetLit, 5, 17, 1, 1);
        r(violet, 21, 16, 3, 3);
        r(violetLit, 22, 17, 1, 1);
        face(11, 4);
        r(flash || '#ff2a6a', 12, 7, 2, 2);
        r(flash || '#ff2a6a', 16, 7, 2, 2);
        hairFall(11, 4);
        ears(11, 4);
        break;
      }
    }
  }

  /**
   * Three drakes that were all the same low blob. The guard drake stands
   * square and faces right with a crest and stub wings; the basilisk faces
   * left, flat and eight-legged, and is all eyes; the wyvern is upright on
   * two legs under a pair of bat wings, with the barbed tail out to the side.
   */
  private drawGuardDrake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#5c6a3a';
    const lit = flash || '#7c8a52';
    const dark = flash || '#3c4626';
    const belly = flash || '#a89a62';
    const crest = flash || '#8a3a2a';
    // Thick tail dragging to the left
    r(hide, 1, 16, 4, 2);
    r(hide, 3, 14, 5, 4);
    r(dark, 1, 17, 7, 1);
    // Stocky body
    r(hide, 7, 11, 13, 9);
    r(lit, 7, 11, 13, 1);
    r(belly, 8, 17, 12, 2);
    r(dark, 7, 19, 13, 1);
    // Crest of blunt spines along the spine
    r(crest, 8, 9, 2, 2);
    r(crest, 11, 8, 2, 3);
    r(crest, 14, 8, 2, 3);
    r(crest, 17, 9, 2, 2);
    // Stub wing folded on the flank
    r(dark, 9, 12, 8, 4);
    r(belly, 10, 13, 1, 1);
    r(belly, 11, 14, 1, 1);
    r(belly, 12, 15, 1, 1);
    // Four thick legs
    r(hide, 8, 20, 3, 5);
    r(hide, 12, 20, 3, 5);
    r(hide, 15, 20, 3, 5);
    r(hide, 18, 20, 3, 5);
    r(dark, 7, 25, 4, 2);
    r(dark, 12, 25, 3, 2);
    r(dark, 15, 25, 3, 2);
    r(dark, 18, 25, 4, 2);
    r(flash || '#e8e0d0', 7, 26, 1, 1);
    r(flash || '#e8e0d0', 12, 26, 1, 1);
    r(flash || '#e8e0d0', 15, 26, 1, 1);
    r(flash || '#e8e0d0', 18, 26, 1, 1);
    // Short neck and a blocky head, jaw slightly open
    r(hide, 19, 9, 4, 6);
    r(lit, 19, 9, 4, 1);
    r(hide, 21, 6, 6, 6);
    r(lit, 21, 6, 6, 1);
    r(dark, 21, 10, 6, 2);
    r(flash || '#e8e0d0', 22, 10, 1, 1);
    r(flash || '#e8e0d0', 25, 10, 1, 1);
    r(crest, 22, 4, 2, 2);
    r(flash || '#e83030', 24, 7, 2, 2);
    r(flash || '#1a0a0a', 25, 7, 1, 1);
  }
  private drawBasilisk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#5a6a58';
    const lit = flash || '#788a76';
    const dark = flash || '#3a4638';
    const spine = flash || '#2a3428';
    const eye = flash || '#e8e040';
    // Tail curling up to the right
    r(hide, 21, 14, 4, 3);
    r(hide, 24, 10, 3, 5);
    r(hide, 25, 7, 2, 4);
    r(dark, 24, 10, 1, 5);
    // Long, low body
    r(hide, 6, 11, 16, 9);
    r(lit, 6, 11, 16, 1);
    r(dark, 6, 18, 16, 2);
    for (let x = 7; x <= 19; x += 3) r(spine, x, 9, 2, 2);
    // Eight legs: the far row set higher and darker
    for (let x = 6; x <= 18; x += 4) r(dark, x, 17, 2, 5);
    for (let x = 8; x <= 20; x += 4) {
      r(hide, x, 19, 2, 6);
      r(dark, x - 1, 25, 4, 2);
    }
    // Wide flat head facing left
    r(hide, 1, 12, 7, 8);
    r(lit, 1, 12, 7, 1);
    r(spine, 1, 11, 7, 1);
    r(dark, 1, 17, 7, 2);
    r(flash || '#e8e0d0', 2, 17, 1, 1);
    r(flash || '#e8e0d0', 4, 17, 1, 1);
    r(flash || '#e8e0d0', 6, 17, 1, 1);
    // The eye is the whole creature
    r(eye, 2, 13, 3, 3);
    r(flash || '#2a2a10', 3, 14, 1, 1);
    r(flash || '#ffffa0', 2, 13, 1, 1);
  }
  private drawWyvern(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#7a4a3a';
    const lit = flash || '#9a6a52';
    const dark = flash || '#4a2a20';
    const mem = flash || '#5a3028';
    const memLit = flash || '#6e3c34';
    // Bat wings raised either side
    r(mem, 1, 4, 9, 10);
    r(mem, 2, 2, 7, 2);
    r(memLit, 2, 2, 7, 1);
    r(dark, 3, 2, 1, 12);
    r(dark, 6, 2, 1, 12);
    r(mem, 2, 14, 3, 2);
    r(mem, 6, 14, 3, 2);
    r(mem, 18, 4, 8, 10);
    r(mem, 19, 2, 7, 2);
    r(memLit, 19, 2, 7, 1);
    r(dark, 21, 2, 1, 12);
    r(dark, 24, 2, 1, 12);
    r(mem, 19, 14, 3, 2);
    // Upright body on two bird legs
    r(hide, 10, 9, 8, 11);
    r(lit, 10, 9, 8, 1);
    r(dark, 10, 17, 8, 3);
    r(flash || '#b89a70', 12, 11, 4, 8);
    r(hide, 9, 20, 3, 5);
    r(hide, 16, 20, 3, 5);
    r(dark, 8, 25, 4, 2);
    r(dark, 16, 25, 4, 2);
    r(flash || '#e8e0d0', 8, 26, 1, 1);
    r(flash || '#e8e0d0', 11, 26, 1, 1);
    r(flash || '#e8e0d0', 16, 26, 1, 1);
    r(flash || '#e8e0d0', 19, 26, 1, 1);
    // Tail sweeping out to the right, ending in the sting
    r(hide, 17, 20, 5, 2);
    r(hide, 21, 17, 3, 4);
    r(hide, 23, 14, 2, 4);
    r(dark, 24, 11, 3, 3);
    r(flash || '#e8e0d0', 25, 10, 2, 1);
    // Neck and a long head, snout to the left
    r(hide, 12, 4, 4, 6);
    r(lit, 12, 4, 1, 6);
    r(hide, 11, 1, 8, 4);
    r(lit, 11, 1, 8, 1);
    r(hide, 8, 2, 4, 3);
    r(dark, 8, 4, 7, 1);
    r(flash || '#e8e0d0', 9, 4, 1, 1);
    r(flash || '#e8e0d0', 11, 4, 1, 1);
    r(dark, 16, 0, 2, 2);
    r(flash || '#e8c030', 13, 2, 2, 1);
  }

  /**
   * Two boars that were the same flat blob: the dire boar is dark and lean,
   * caught mid-charge with its head lowered behind the tusks; the giant boar
   * is a pale, square-standing mountain wearing a ridge of mane.
   */
  private drawDireBoar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#3e2c22';
    const lit = flash || '#5a4232';
    const dark = flash || '#241812';
    const bristle = flash || '#161010';
    const tusk = flash || '#efe6cc';
    // Hind legs stretched back
    r(dark, 2, 19, 3, 5);
    r(dark, 5, 20, 3, 5);
    r(flash || '#0e0a08', 1, 24, 4, 2);
    r(flash || '#0e0a08', 5, 25, 3, 2);
    // Hindquarters and the tall shoulder hump
    r(hide, 3, 12, 8, 8);
    r(lit, 4, 12, 7, 1);
    r(hide, 9, 7, 10, 14);
    r(lit, 10, 7, 9, 2);
    r(dark, 3, 19, 16, 2);
    // Bristle ridge standing up along the hump
    r(bristle, 8, 5, 2, 3);
    r(bristle, 10, 4, 2, 4);
    r(bristle, 12, 3, 2, 5);
    r(bristle, 14, 4, 2, 4);
    r(bristle, 16, 5, 2, 3);
    // Front legs driving forward
    r(dark, 18, 20, 3, 4);
    r(dark, 22, 19, 3, 5);
    r(flash || '#0e0a08', 18, 24, 3, 2);
    r(flash || '#0e0a08', 22, 24, 4, 2);
    // Head lowered for the charge
    r(hide, 17, 12, 7, 9);
    r(dark, 17, 12, 1, 9);
    r(hide, 22, 16, 4, 6);
    r(flash || '#6a4a44', 24, 19, 2, 3);
    r(dark, 16, 9, 3, 4);
    // Tusks hooking up in front of the snout
    r(tusk, 25, 12, 2, 1);
    r(tusk, 25, 13, 1, 3);
    r(tusk, 26, 19, 1, 2);
    r(flash || '#e83020', 19, 14, 2, 2);
  }
  private drawGiantBoar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#8a6a4a';
    const lit = flash || '#a8886a';
    const dark = flash || '#5a4230';
    const mane = flash || '#3a2818';
    const tusk = flash || '#f4ecd8';
    r(dark, 1, 10, 2, 4);
    // Massive body
    r(hide, 3, 8, 18, 13);
    r(lit, 4, 8, 17, 2);
    r(dark, 3, 19, 18, 2);
    // Mane of stiff spikes the whole length of the back
    for (let x = 4; x <= 19; x += 3) {
      r(mane, x, 5, 2, 4);
      r(mane, x + 1, 4, 1, 1);
    }
    // Sturdy legs
    r(dark, 4, 21, 4, 4);
    r(dark, 9, 21, 4, 4);
    r(dark, 14, 21, 4, 4);
    r(dark, 19, 21, 4, 4);
    r(flash || '#241a10', 4, 25, 4, 2);
    r(flash || '#241a10', 9, 25, 4, 2);
    r(flash || '#241a10', 14, 25, 4, 2);
    r(flash || '#241a10', 19, 25, 4, 2);
    // Head carried level
    r(hide, 20, 9, 7, 10);
    r(lit, 20, 9, 7, 1);
    r(dark, 20, 9, 1, 10);
    r(flash || '#b08a80', 25, 14, 2, 4);
    r(dark, 19, 6, 3, 4);
    // Long tusks
    r(tusk, 24, 11, 2, 3);
    r(tusk, 25, 9, 2, 2);
    r(tusk, 23, 17, 2, 2);
    r(tusk, 22, 18, 1, 2);
    r(flash || '#241a08', 22, 12, 2, 2);
    r(flash || '#e8b03a', 23, 12, 1, 1);
  }

  /**
   * Three hounds that were three black blobs. The hell hound stands with its
   * head up and fire spilling from the jaws; the shadow mastiff crouches low
   * facing the other way with its hackles up and pale eyes; the yeth hound
   * is airborne, all head and ears, with nothing under its feet.
   */
  private drawHellHound(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const blk = flash || '#2a2222';
    const lit = flash || '#4a3e3c';
    const dark = flash || '#141010';
    const fire = flash || '#ff7a20';
    const fireLit = flash || '#ffd040';
    const ember = flash || '#c83010';
    // Tail up
    r(blk, 2, 9, 2, 4);
    r(blk, 3, 12, 3, 3);
    // Body with ember cracks in the hide
    r(blk, 5, 12, 14, 8);
    r(lit, 5, 12, 14, 1);
    r(dark, 5, 18, 14, 2);
    r(ember, 8, 15, 3, 1);
    r(ember, 12, 16, 2, 1);
    r(ember, 15, 14, 2, 1);
    // Legs
    r(blk, 5, 20, 3, 5);
    r(blk, 9, 20, 3, 5);
    r(blk, 14, 20, 3, 5);
    r(blk, 18, 20, 3, 5);
    r(dark, 4, 25, 4, 2);
    r(dark, 9, 25, 3, 2);
    r(dark, 14, 25, 3, 2);
    r(dark, 18, 25, 4, 2);
    // Neck and head raised, jaws open
    r(blk, 17, 8, 5, 6);
    r(blk, 19, 5, 7, 6);
    r(lit, 19, 5, 7, 1);
    r(blk, 19, 3, 2, 3);
    r(blk, 23, 3, 2, 3);
    r(dark, 22, 8, 4, 3);
    r(flash || '#e8e0d0', 22, 8, 1, 1);
    r(flash || '#e8e0d0', 25, 8, 1, 1);
    // Fire pouring from the mouth, solid and held off the edge
    r(fire, 24, 9, 3, 2);
    r(fire, 25, 7, 2, 2);
    r(fireLit, 25, 9, 1, 2);
    r(fireLit, 26, 7, 1, 1);
    r(flash || '#ff3020', 21, 6, 2, 2);
  }
  private drawShadowMastiff(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const shade = flash || '#2a2038';
    const lit = flash || '#443456';
    const dark = flash || '#1a1424';
    const eye = flash || '#e8e8ff';
    // Wisps of shadow trailing off the back
    r(dark, 22, 12, 4, 1);
    r(dark, 24, 15, 3, 1);
    r(dark, 21, 18, 3, 1);
    // Low body, hackles standing in spikes
    r(shade, 7, 13, 15, 7);
    r(lit, 7, 13, 15, 1);
    r(dark, 7, 18, 15, 2);
    r(dark, 8, 11, 2, 2);
    r(dark, 11, 10, 2, 3);
    r(dark, 14, 10, 2, 3);
    r(dark, 17, 11, 2, 2);
    r(dark, 20, 12, 2, 1);
    // Bent legs
    r(shade, 8, 20, 3, 4);
    r(shade, 12, 20, 3, 4);
    r(shade, 16, 20, 3, 4);
    r(shade, 19, 20, 3, 4);
    r(dark, 7, 24, 4, 2);
    r(dark, 12, 24, 3, 2);
    r(dark, 16, 24, 3, 2);
    r(dark, 19, 24, 4, 2);
    // Head low and forward, facing left
    r(shade, 1, 13, 7, 6);
    r(lit, 1, 13, 7, 1);
    r(dark, 1, 17, 7, 2);
    r(flash || '#c8c8d8', 2, 17, 1, 1);
    r(flash || '#c8c8d8', 4, 17, 1, 1);
    r(dark, 7, 11, 2, 3);
    r(eye, 3, 14, 2, 2);
  }
  private drawYethHound(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#4a2a2a';
    const lit = flash || '#6a3c3a';
    const dark = flash || '#2c1818';
    const fang = flash || '#e8e0d0';
    // Tail streaming behind
    r(hide, 1, 13, 4, 2);
    r(hide, 1, 11, 3, 2);
    // Body stretched in a leap, well clear of the ground
    r(hide, 5, 10, 13, 7);
    r(lit, 5, 10, 13, 1);
    r(dark, 5, 15, 13, 2);
    r(dark, 2, 17, 4, 2);
    r(dark, 1, 19, 2, 2);
    r(dark, 6, 17, 3, 3);
    r(dark, 17, 16, 4, 2);
    r(dark, 20, 18, 2, 2);
    // Oversized head with wide bat ears
    r(hide, 16, 3, 9, 9);
    r(lit, 16, 3, 9, 1);
    r(dark, 16, 3, 1, 9);
    r(dark, 15, 0, 3, 4);
    r(dark, 22, 0, 3, 4);
    r(flash || '#8a5050', 16, 1, 1, 2);
    r(flash || '#8a5050', 23, 1, 1, 2);
    // Gaping jaws
    r(dark, 21, 8, 5, 3);
    r(fang, 21, 8, 1, 2);
    r(fang, 25, 8, 1, 2);
    r(fang, 23, 10, 1, 1);
    r(flash || '#f0d020', 19, 5, 2, 2);
    r(dark, 20, 5, 1, 1);
  }

  private drawShadowDemon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const blk = flash || '#221c38';
    const lit = flash || '#3a305a';
    const eye = flash || '#c8f0ff';
    const eyeDk = flash || '#60a0c0';
    // Ragged wings
    r(blk, 1, 6, 8, 10);
    r(blk, 19, 6, 8, 10);
    r(lit, 1, 6, 8, 1);
    r(lit, 19, 6, 8, 1);
    r(blk, 2, 16, 2, 3);
    r(blk, 5, 16, 2, 2);
    r(blk, 24, 16, 2, 3);
    r(blk, 21, 16, 2, 2);
    // Thin body, legs tapering into smoke
    r(blk, 11, 8, 6, 12);
    r(lit, 11, 8, 6, 1);
    r(blk, 11, 20, 2, 5);
    r(blk, 15, 20, 2, 5);
    r(blk, 10, 25, 2, 2);
    r(blk, 16, 25, 2, 2);
    // Long arms ending in three-fingered claws
    r(blk, 7, 10, 4, 3);
    r(blk, 6, 12, 3, 7);
    r(blk, 4, 19, 1, 3);
    r(blk, 6, 19, 1, 3);
    r(blk, 8, 19, 1, 3);
    r(blk, 17, 10, 4, 3);
    r(blk, 19, 12, 3, 7);
    r(blk, 19, 19, 1, 3);
    r(blk, 21, 19, 1, 3);
    r(blk, 23, 19, 1, 3);
    // Horned head; the eyes are the only light on it
    r(blk, 11, 2, 6, 6);
    r(lit, 11, 2, 6, 1);
    r(blk, 9, 0, 2, 3);
    r(blk, 17, 0, 2, 3);
    r(eye, 12, 4, 2, 1);
    r(eye, 15, 4, 2, 1);
    r(eyeDk, 12, 5, 2, 1);
    r(eyeDk, 15, 5, 2, 1);
  }
  private drawNecromancer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const rb = flash || '#1e2a22';
    const rbLit = flash || '#2e4032';
    const rbDk = flash || '#121a16';
    const skin = flash || '#c8c0b8';
    const skinDk = flash || '#a09890';
    const glow = flash || '#40e080';
    const glowLit = flash || '#a0ffc0';
    const bone = flash || '#e8e0d0';
    const wood = flash || '#6b4b2a';
    // Wide robe
    r(rb, 9, 11, 11, 9);
    r(rb, 7, 20, 15, 7);
    r(rbLit, 9, 11, 11, 1);
    r(rbDk, 7, 26, 15, 1);
    r(flash || '#5a7a5a', 14, 12, 1, 14);
    r(rb, 6, 12, 3, 7);
    r(rb, 20, 12, 3, 7);
    r(skin, 6, 19, 3, 2);
    r(skin, 20, 19, 3, 2);
    r(rbLit, 9, 10, 3, 3);
    r(rbLit, 17, 10, 3, 3);
    // Skull-topped staff burning green
    r(wood, 3, 9, 2, 18);
    r(bone, 1, 4, 6, 5);
    r(flash || '#1a1a1a', 2, 6, 1, 1);
    r(flash || '#1a1a1a', 5, 6, 1, 1);
    r(skinDk, 2, 8, 4, 1);
    r(glow, 2, 1, 4, 3);
    r(glowLit, 3, 1, 2, 2);
    // Grimoire in the other hand
    r(flash || '#5a2a2a', 21, 15, 5, 4);
    r(flash || '#8a4a4a', 21, 15, 5, 1);
    r(bone, 22, 16, 3, 1);
    // Gaunt bald head, sockets lit from within
    r(skin, 11, 3, 7, 8);
    r(flash || '#ddd5cc', 11, 3, 7, 1);
    r(skinDk, 11, 3, 1, 8);
    r(skinDk, 11, 9, 7, 2);
    r(flash || '#101410', 12, 6, 2, 2);
    r(flash || '#101410', 16, 6, 2, 2);
    r(glow, 13, 7, 1, 1);
    r(glow, 16, 7, 1, 1);
  }
  private drawHobgoblinCaptain(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#c8703a';
    const skinLit = flash || '#dc8a52';
    const skinDk = flash || '#8a4a22';
    const plate = flash || '#6a6a78';
    const plateLit = flash || '#8c8c9a';
    const plateDk = flash || '#44444e';
    const red = flash || '#b02020';
    const redLit = flash || '#d84040';
    const steel = flash || '#b8bfcd';
    const steelLit = flash || '#e6ecf6';
    const gold = flash || '#c8a030';
    // Greaves
    r(plate, 10, 20, 3, 5);
    r(plate, 16, 20, 3, 5);
    r(plateDk, 9, 24, 5, 3);
    r(plateDk, 15, 24, 5, 3);
    // Banded cuirass with a red tabard stripe and pauldrons
    r(plate, 9, 11, 11, 9);
    r(plateLit, 9, 11, 11, 1);
    r(plateDk, 9, 14, 11, 1);
    r(plateDk, 9, 17, 11, 1);
    r(red, 13, 11, 3, 9);
    r(plateLit, 7, 10, 3, 3);
    r(plateLit, 19, 10, 3, 3);
    r(skin, 7, 13, 3, 5);
    r(skin, 19, 13, 3, 5);
    // Tower shield, taller than the arm that holds it
    r(plateDk, 1, 8, 7, 14);
    r(plate, 2, 9, 5, 12);
    r(red, 3, 11, 3, 7);
    r(gold, 3, 14, 3, 1);
    // Longsword raised
    r(steel, 23, 1, 2, 12);
    r(steelLit, 23, 1, 1, 12);
    r(gold, 21, 13, 6, 1);
    r(flash || '#6b4b2a', 23, 14, 2, 3);
    r(skin, 22, 15, 3, 2);
    // Head under a crested helm
    r(skin, 11, 4, 7, 7);
    r(skinLit, 11, 4, 7, 1);
    r(skinDk, 11, 4, 1, 7);
    r(skinDk, 11, 6, 7, 1);
    r(flash || '#f0d030', 12, 7, 2, 1);
    r(flash || '#f0d030', 16, 7, 2, 1);
    r(flash || '#1a1010', 13, 7, 1, 1);
    r(flash || '#1a1010', 16, 7, 1, 1);
    r(skinDk, 12, 9, 5, 1);
    r(flash || '#e8e0d0', 12, 9, 1, 1);
    r(flash || '#e8e0d0', 16, 9, 1, 1);
    r(plate, 10, 1, 9, 4);
    r(plateLit, 10, 1, 9, 1);
    r(plateDk, 10, 4, 9, 1);
    r(plate, 10, 5, 1, 5);
    r(plate, 18, 5, 1, 5);
    r(redLit, 12, 0, 6, 2);
    r(red, 18, 1, 3, 2);
    r(flash || '#701010', 20, 3, 2, 2);
  }
  private drawWereraven(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const blk = flash || '#1a1a22';
    const lit = flash || '#30303a';
    const dark = flash || '#0c0c12';
    const beak = flash || '#c8a030';
    const beakDk = flash || '#8a6a10';
    const cloth = flash || '#4a3a2a';
    // Breeches and clawed feet
    r(cloth, 10, 19, 3, 5);
    r(cloth, 16, 19, 3, 5);
    r(dark, 9, 23, 5, 3);
    r(dark, 15, 23, 5, 3);
    r(beakDk, 8, 25, 2, 1);
    r(beakDk, 19, 25, 2, 1);
    // Feathered torso
    r(blk, 9, 10, 11, 9);
    r(lit, 9, 10, 11, 1);
    r(dark, 9, 13, 11, 1);
    r(dark, 9, 16, 11, 1);
    // Wing-arms held half open
    r(blk, 2, 9, 7, 6);
    r(lit, 2, 9, 7, 1);
    r(blk, 1, 15, 6, 4);
    r(blk, 2, 19, 4, 2);
    r(dark, 3, 14, 4, 1);
    r(dark, 2, 18, 4, 1);
    r(blk, 20, 9, 7, 6);
    r(lit, 20, 9, 7, 1);
    r(blk, 21, 15, 6, 4);
    r(blk, 23, 19, 4, 2);
    r(dark, 22, 14, 4, 1);
    r(dark, 23, 18, 4, 1);
    // Raven head with a hooked beak
    r(blk, 11, 2, 8, 8);
    r(lit, 11, 2, 8, 1);
    r(dark, 11, 2, 1, 8);
    r(blk, 12, 0, 3, 2);
    r(blk, 16, 1, 2, 1);
    r(beak, 19, 5, 5, 2);
    r(beakDk, 19, 7, 4, 1);
    r(beakDk, 23, 7, 1, 2);
    r(flash || '#e8e040', 16, 4, 2, 2);
    r(dark, 17, 5, 1, 1);
  }

  /**
   * The winged horses. The pegasus stands square with one great feathered
   * wing raised over its back; the nightmare rears the other way with a mane
   * and tail of solid flame.
   */
  private drawPegasus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const white = flash || '#f0eef2';
    const lit = flash || '#ffffff';
    const dark = flash || '#c8c4d0';
    const wing = flash || '#d4d0e0';
    const wingDk = flash || '#9a94ac';
    const mane = flash || '#e8d890';
    const hoof = flash || '#c8a030';
    r(mane, 1, 10, 3, 2);
    r(mane, 1, 12, 2, 5);
    // Body
    r(white, 4, 11, 15, 8);
    r(lit, 4, 11, 15, 1);
    r(dark, 4, 17, 15, 2);
    // Wing sweeping up and back, joined to the body only at the shoulder
    r(wing, 9, 2, 11, 2);
    r(wing, 6, 4, 14, 2);
    r(wing, 3, 6, 15, 3);
    r(wing, 20, 1, 3, 2);
    r(wing, 15, 9, 4, 2);
    r(lit, 9, 2, 11, 1);
    r(wingDk, 5, 7, 1, 2);
    r(wingDk, 8, 6, 1, 3);
    r(wingDk, 11, 5, 1, 4);
    r(wingDk, 14, 4, 1, 5);
    r(wingDk, 17, 3, 1, 6);
    // Legs and gold hooves
    r(white, 5, 19, 3, 6);
    r(white, 9, 19, 3, 6);
    r(white, 14, 19, 3, 6);
    r(white, 18, 19, 3, 6);
    r(dark, 5, 19, 1, 6);
    r(dark, 14, 19, 1, 6);
    r(hoof, 5, 25, 3, 2);
    r(hoof, 9, 25, 3, 2);
    r(hoof, 14, 25, 3, 2);
    r(hoof, 18, 25, 3, 2);
    // Neck and head
    r(white, 17, 5, 5, 8);
    r(lit, 17, 5, 1, 8);
    r(white, 20, 3, 7, 5);
    r(lit, 20, 3, 7, 1);
    r(dark, 26, 6, 1, 1);
    r(white, 20, 1, 2, 2);
    r(white, 23, 1, 2, 2);
    r(mane, 15, 5, 2, 7);
    r(mane, 17, 2, 4, 3);
    r(flash || '#3a3a50', 22, 4, 2, 2);
    r(lit, 23, 4, 1, 1);
  }
  private drawNightmare(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const blk = flash || '#241c20';
    const lit = flash || '#3e3238';
    const fire = flash || '#ff7a20';
    const fireLit = flash || '#ffd040';
    const hoof = flash || '#ff7a20';
    // Hindquarters planted, hind legs down
    r(blk, 14, 12, 9, 8);
    r(lit, 14, 12, 9, 1);
    r(blk, 15, 20, 3, 6);
    r(blk, 20, 20, 3, 6);
    r(hoof, 15, 26, 3, 1);
    r(hoof, 20, 26, 3, 1);
    // Chest rising to the left, forelegs pawing the air
    r(blk, 8, 9, 8, 9);
    r(lit, 8, 9, 8, 1);
    r(blk, 5, 13, 3, 4);
    r(blk, 3, 15, 3, 2);
    r(hoof, 2, 15, 1, 2);
    r(blk, 8, 16, 2, 4);
    r(blk, 6, 19, 3, 2);
    r(hoof, 5, 19, 1, 2);
    // Neck and head thrown up
    r(blk, 6, 3, 5, 8);
    r(lit, 6, 3, 1, 8);
    r(blk, 2, 2, 6, 4);
    r(lit, 2, 2, 6, 1);
    r(blk, 7, 0, 2, 3);
    r(blk, 10, 1, 2, 2);
    r(flash || '#c83010', 2, 4, 1, 1);
    r(flash || '#ff3020', 4, 3, 2, 1);
    // Flame mane down the neck and a flame tail, all solid
    r(fire, 11, 3, 2, 8);
    r(fireLit, 11, 4, 1, 3);
    r(fire, 12, 1, 2, 3);
    r(fireLit, 13, 2, 1, 1);
    r(fire, 13, 7, 2, 3);
    r(fire, 23, 10, 3, 4);
    r(fire, 24, 7, 2, 4);
    r(fireLit, 24, 11, 1, 2);
    r(fire, 23, 14, 2, 3);
    r(fireLit, 25, 8, 1, 2);
  }
  private drawAirElemental(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const a = flash || '#d8dce8';
    const b = flash || '#b0b8c8';
    const c = flash || '#8890a4';
    const d = flash || '#6a7288';
    // A solid funnel, banded and offset row by row so it reads as spinning.
    // Solid on purpose: a translucent cloud loses its rim and vanishes.
    const bands: [number, number, number, string][] = [
      [2, 6, 16, b], [4, 3, 22, a], [6, 5, 19, c], [8, 4, 19, b], [10, 6, 16, a],
      [12, 7, 15, c], [14, 8, 12, b], [16, 9, 11, a], [18, 10, 8, c], [20, 11, 7, b],
      [22, 12, 4, a], [24, 13, 3, c], [26, 14, 1, d],
    ];
    for (const [y, x, w, col] of bands) r(col, x, y, w, 2);
    r(flash || '#4060a0', 10, 8, 2, 2);
    r(flash || '#4060a0', 16, 8, 2, 2);
    r(flash || '#7a6a50', 7, 11, 1, 1);
    r(flash || '#7a6a50', 19, 13, 1, 1);
    r(flash || '#7a6a50', 9, 17, 1, 1);
  }

  /**
   * Two crocodiles that were the same sliver. The giant crocodile lies flat
   * with its jaws thrown open; the dire crocodile stands high on its legs,
   * darker and spined, head raised with the teeth showing through a shut jaw.
   */
  private drawGiantCrocodile(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#4a6a3a';
    const lit = flash || '#6a8a4a';
    const dark = flash || '#2e4626';
    const belly = flash || '#a8a878';
    const scute = flash || '#1e3018';
    const tooth = flash || '#e8e0d0';
    // Tail curling up behind
    r(hide, 1, 15, 5, 3);
    r(hide, 1, 12, 3, 3);
    r(dark, 1, 17, 5, 1);
    // Body
    r(hide, 5, 13, 14, 7);
    r(lit, 5, 13, 14, 1);
    r(belly, 5, 18, 14, 2);
    for (let x = 6; x <= 18; x += 2) r(scute, x, 12, 1, 1);
    for (let x = 7; x <= 17; x += 2) r(scute, x, 15, 1, 1);
    // Splayed legs
    r(dark, 6, 20, 3, 3);
    r(dark, 4, 22, 4, 3);
    r(dark, 15, 20, 3, 3);
    r(dark, 16, 22, 4, 3);
    // Head with the jaws open: upper jaw stepped up, lower jaw flat
    r(hide, 19, 13, 4, 4);
    r(flash || '#6a2a2a', 22, 13, 5, 3);
    r(hide, 20, 11, 3, 2);
    r(hide, 21, 9, 4, 2);
    r(hide, 23, 7, 4, 2);
    r(tooth, 23, 11, 1, 1);
    r(tooth, 25, 9, 1, 1);
    r(hide, 21, 16, 6, 3);
    r(tooth, 22, 15, 1, 1);
    r(tooth, 24, 15, 1, 1);
    r(tooth, 26, 15, 1, 1);
    r(flash || '#e8c030', 20, 12, 2, 1);
  }
  private drawDireCrocodile(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const hide = flash || '#2e3a2e';
    const lit = flash || '#48584a';
    const dark = flash || '#1a241a';
    const belly = flash || '#7a8068';
    const spike = flash || '#101810';
    const tooth = flash || '#e8e0d0';
    // Thick tail
    r(hide, 1, 17, 6, 4);
    r(hide, 1, 14, 3, 3);
    r(dark, 1, 20, 6, 1);
    // Heavy body carried high
    r(hide, 6, 11, 14, 9);
    r(lit, 6, 11, 14, 1);
    r(belly, 6, 18, 14, 2);
    for (let x = 7; x <= 17; x += 3) {
      r(spike, x, 9, 2, 2);
      r(spike, x, 8, 1, 1);
    }
    r(dark, 6, 20, 3, 5);
    r(dark, 10, 20, 3, 5);
    r(dark, 15, 20, 3, 5);
    r(dark, 18, 20, 3, 5);
    r(dark, 5, 25, 4, 2);
    r(dark, 10, 25, 3, 2);
    r(dark, 15, 25, 3, 2);
    r(dark, 18, 25, 4, 2);
    // Neck rising into a raised head, teeth through a shut jaw
    r(hide, 19, 8, 4, 6);
    r(hide, 20, 3, 7, 6);
    r(lit, 20, 3, 7, 1);
    r(dark, 20, 7, 7, 2);
    r(tooth, 21, 8, 1, 1);
    r(tooth, 23, 8, 1, 1);
    r(tooth, 25, 8, 1, 1);
    r(spike, 20, 2, 2, 1);
    r(spike, 24, 2, 2, 1);
    r(flash || '#e83030', 22, 4, 2, 2);
  }
  private drawIncubus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#8a3a3a';
    const skinLit = flash || '#a85050';
    const skinDk = flash || '#5a2020';
    const wing = flash || '#2a1a22';
    const wingLit = flash || '#3e2a34';
    const hair = flash || '#1a1018';
    // Bat wings folded up behind the shoulders
    r(wing, 2, 3, 7, 14);
    r(wing, 19, 3, 7, 14);
    r(wingLit, 2, 3, 7, 1);
    r(wingLit, 19, 3, 7, 1);
    r(skinDk, 4, 3, 1, 14);
    r(skinDk, 7, 3, 1, 14);
    r(skinDk, 20, 3, 1, 14);
    r(skinDk, 23, 3, 1, 14);
    r(wing, 2, 17, 2, 2);
    r(wing, 6, 17, 2, 2);
    r(wing, 20, 17, 2, 2);
    r(wing, 24, 17, 2, 2);
    // Legs
    r(flash || '#22181e', 10, 19, 3, 6);
    r(flash || '#22181e', 16, 19, 3, 6);
    r(skinDk, 9, 24, 5, 3);
    r(skinDk, 15, 24, 5, 3);
    // Bare torso, arms folded
    r(skin, 9, 10, 11, 9);
    r(skinLit, 9, 10, 11, 1);
    r(skinDk, 14, 11, 1, 5);
    r(skin, 7, 12, 3, 4);
    r(skin, 19, 12, 3, 4);
    r(skin, 8, 15, 13, 3);
    r(skinDk, 8, 15, 13, 1);
    r(flash || '#c8a030', 9, 19, 11, 1);
    // Head with swept-back hair and small horns
    r(skin, 11, 3, 7, 7);
    r(skinLit, 11, 3, 7, 1);
    r(skinDk, 11, 3, 1, 7);
    r(hair, 10, 1, 9, 3);
    r(hair, 10, 4, 1, 3);
    r(flash || '#3a2a2a', 9, 0, 2, 3);
    r(flash || '#3a2a2a', 18, 0, 2, 3);
    r(flash || '#f0c020', 12, 6, 2, 1);
    r(flash || '#f0c020', 16, 6, 2, 1);
    r(skinDk, 13, 8, 4, 1);
  }
  private drawWerebat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const fur = flash || '#5a4a48';
    const furLit = flash || '#746260';
    const furDk = flash || '#3a2c2c';
    const mem = flash || '#3a2a30';
    const memLit = flash || '#4c3a40';
    const ear = flash || '#8a6a68';
    // Wings spread wide as arms
    r(mem, 1, 6, 9, 12);
    r(memLit, 1, 6, 9, 1);
    r(furDk, 3, 6, 1, 12);
    r(furDk, 6, 6, 1, 12);
    r(mem, 1, 18, 2, 2);
    r(mem, 5, 18, 2, 2);
    r(mem, 18, 6, 9, 12);
    r(memLit, 18, 6, 9, 1);
    r(furDk, 21, 6, 1, 12);
    r(furDk, 24, 6, 1, 12);
    r(mem, 21, 18, 2, 2);
    r(mem, 25, 18, 2, 2);
    // Hunched body on short bent legs
    r(fur, 9, 9, 10, 10);
    r(furLit, 9, 9, 10, 1);
    r(furDk, 9, 17, 10, 2);
    r(fur, 9, 19, 3, 5);
    r(fur, 16, 19, 3, 5);
    r(furDk, 8, 23, 4, 2);
    r(furDk, 16, 23, 4, 2);
    // Big-eared head sunk into the shoulders
    r(fur, 11, 3, 7, 7);
    r(furLit, 11, 3, 7, 1);
    r(fur, 8, 0, 3, 5);
    r(fur, 18, 0, 3, 5);
    r(ear, 9, 1, 1, 3);
    r(ear, 19, 1, 1, 3);
    r(furDk, 12, 7, 5, 2);
    r(ear, 14, 7, 1, 1);
    r(flash || '#e8e0d0', 12, 9, 1, 2);
    r(flash || '#e8e0d0', 16, 9, 1, 2);
    r(flash || '#e83020', 12, 5, 2, 1);
    r(flash || '#e83020', 16, 5, 2, 1);
  }
  private drawGrell(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const brain = flash || '#c89890';
    const lit = flash || '#e0b0a8';
    const fold = flash || '#7a4a4a';
    const beak = flash || '#e8c860';
    const beakDk = flash || '#a88830';
    const tent = flash || '#a87a78';
    const tentDk = flash || '#7a5050';
    const tip = flash || '#40e080';
    // Floating brain, two lobes
    r(brain, 6, 2, 16, 3);
    r(brain, 3, 5, 22, 7);
    r(brain, 5, 12, 18, 2);
    r(lit, 6, 2, 16, 1);
    r(lit, 3, 5, 1, 7);
    r(fold, 13, 2, 2, 12);
    r(fold, 6, 6, 3, 1);
    r(fold, 9, 8, 3, 1);
    r(fold, 16, 6, 3, 1);
    r(fold, 20, 9, 3, 1);
    r(fold, 8, 10, 3, 1);
    r(fold, 18, 11, 3, 1);
    // Beak pointing down
    r(beak, 12, 14, 4, 3);
    r(beakDk, 13, 17, 2, 2);
    // Ten tentacles of different lengths, paralysing tips
    const strands: [number, number, number][] = [
      [4, 13, 11], [6, 14, 9], [8, 14, 12], [10, 15, 8], [11, 17, 6],
      [16, 17, 8], [17, 15, 10], [19, 14, 12], [21, 14, 8], [23, 13, 11],
    ];
    strands.forEach(([x, y, len], i) => {
      r(i % 2 ? tentDk : tent, x, y, 1, len);
      r(tip, x, y + len, 1, 1);
    });
  }
  private drawSwampWight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#5a6a4a';
    const skinLit = flash || '#748a5e';
    const skinDk = flash || '#3a4a30';
    const mail = flash || '#4a3e30';
    const mailLit = flash || '#5e5040';
    const mailDk = flash || '#302818';
    const reed = flash || '#2c3a2c';
    const rust = flash || '#7a5a3a';
    const eye = flash || '#a0ff90';
    // Bent legs in bog-rotted boots
    r(skinDk, 9, 20, 4, 5);
    r(skinDk, 16, 20, 4, 5);
    r(flash || '#242a1c', 8, 24, 5, 3);
    r(flash || '#242a1c', 16, 24, 5, 3);
    // Hunched torso in rusting mail, shoulders up around where the head should be
    r(mail, 8, 11, 13, 10);
    r(mailLit, 8, 11, 13, 1);
    r(mailDk, 8, 14, 13, 1);
    r(mailDk, 8, 17, 13, 1);
    r(rust, 10, 15, 2, 2);
    r(rust, 16, 12, 3, 1);
    r(mail, 7, 10, 3, 4);
    r(mail, 19, 10, 3, 4);
    // Weed and reeds hanging off it, still dripping
    r(reed, 6, 13, 2, 8);
    r(reed, 21, 13, 2, 6);
    r(reed, 12, 21, 1, 4);
    r(reed, 17, 21, 1, 3);
    // Arms hanging low
    r(skin, 5, 14, 3, 7);
    r(skin, 20, 14, 3, 7);
    // Notched blade held low
    r(mailDk, 22, 17, 4, 1);
    r(flash || '#8a7a62', 23, 18, 2, 9);
    r(rust, 23, 20, 1, 1);
    r(rust, 24, 23, 1, 1);
    // Head thrust forward and down, jaw hanging
    r(skin, 10, 6, 8, 6);
    r(skinLit, 10, 6, 8, 1);
    r(skinDk, 10, 6, 1, 6);
    r(skinDk, 10, 10, 8, 2);
    r(eye, 11, 8, 2, 1);
    r(eye, 15, 8, 2, 1);
    r(flash || '#1a2010', 12, 10, 4, 1);
    // What is left of a helm, weed over the brow
    r(mailDk, 9, 4, 10, 3);
    r(mail, 9, 4, 10, 1);
    r(reed, 8, 5, 2, 4);
  }
  private drawCambion(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const skin = flash || '#b84050';
    const skinLit = flash || '#d05868';
    const skinDk = flash || '#802838';
    const plate = flash || '#3a3a4a';
    const plateLit = flash || '#54546a';
    const plateDk = flash || '#24242e';
    const wing = flash || '#5a1a22';
    const wingLit = flash || '#7a2a34';
    const wingDk = flash || '#3a1018';
    const gold = flash || '#c8a030';
    const fire = flash || '#ff7a20';
    const fireLit = flash || '#ffd040';
    // Bat wings folded up behind the shoulders
    r(wing, 3, 4, 6, 13);
    r(wing, 19, 4, 6, 13);
    r(wingLit, 3, 4, 6, 1);
    r(wingLit, 19, 4, 6, 1);
    r(wingDk, 5, 4, 1, 13);
    r(wingDk, 21, 4, 1, 13);
    r(wing, 3, 17, 2, 2);
    r(wing, 7, 17, 2, 2);
    r(wing, 19, 17, 2, 2);
    r(wing, 23, 17, 2, 2);
    // Greaves
    r(plate, 10, 20, 3, 5);
    r(plate, 16, 20, 3, 5);
    r(plateDk, 9, 24, 5, 3);
    r(plateDk, 15, 24, 5, 3);
    // Black plate with gold trim
    r(plate, 9, 11, 11, 9);
    r(plateLit, 9, 11, 11, 1);
    r(gold, 9, 15, 11, 1);
    r(gold, 14, 11, 1, 9);
    r(plateLit, 7, 10, 3, 3);
    r(plateLit, 19, 10, 3, 3);
    r(skin, 7, 13, 3, 5);
    r(skin, 19, 13, 3, 5);
    // Burning sword raised in the right hand
    r(flash || '#b8bfcd', 23, 3, 2, 11);
    r(flash || '#e6ecf6', 23, 3, 1, 11);
    r(fire, 25, 4, 1, 3);
    r(fireLit, 25, 6, 1, 1);
    r(fire, 22, 7, 1, 3);
    r(fire, 25, 10, 1, 2);
    r(fireLit, 22, 8, 1, 1);
    r(fire, 23, 1, 2, 2);
    r(gold, 21, 14, 6, 1);
    r(flash || '#6b4b2a', 23, 15, 2, 3);
    r(skin, 22, 15, 3, 2);
    // Head, slicked hair, small horns
    r(skin, 11, 4, 7, 7);
    r(skinLit, 11, 4, 7, 1);
    r(skinDk, 11, 4, 1, 7);
    r(skinDk, 11, 6, 7, 1);
    r(flash || '#f0d030', 12, 7, 2, 1);
    r(flash || '#f0d030', 16, 7, 2, 1);
    r(skinDk, 13, 9, 3, 1);
    r(flash || '#20242c', 10, 2, 9, 3);
    r(flash || '#20242c', 10, 5, 1, 3);
    r(flash || '#3a2a2a', 9, 0, 2, 3);
    r(flash || '#3a2a2a', 18, 0, 2, 3);
  }
  private drawNightmareRider(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const blk = flash || '#241c20';
    const lit = flash || '#3e3238';
    const armor = flash || '#2a2a3a';
    const armorLit = flash || '#44445a';
    const armorDk = flash || '#18181e';
    const fire = flash || '#ff7a20';
    const fireLit = flash || '#ffd040';
    // Flame tail
    r(fire, 1, 11, 3, 5);
    r(fireLit, 2, 12, 1, 2);
    r(fire, 2, 16, 2, 2);
    // The steed, standing, head to the right
    r(blk, 4, 14, 16, 6);
    r(lit, 4, 14, 16, 1);
    r(blk, 5, 20, 2, 6);
    r(blk, 9, 20, 2, 6);
    r(blk, 14, 20, 2, 6);
    r(blk, 18, 20, 2, 6);
    r(fire, 5, 26, 2, 1);
    r(fire, 9, 26, 2, 1);
    r(fire, 14, 26, 2, 1);
    r(fire, 18, 26, 2, 1);
    r(blk, 18, 9, 4, 6);
    r(lit, 18, 9, 1, 6);
    r(blk, 20, 7, 6, 4);
    r(lit, 20, 7, 6, 1);
    r(blk, 21, 5, 2, 2);
    r(flash || '#ff3020', 23, 8, 2, 1);
    r(fire, 16, 8, 2, 6);
    r(fireLit, 16, 9, 1, 3);
    r(fire, 17, 6, 2, 2);
    // The rider: black plate, nothing above the gorget but fire
    r(armor, 8, 14, 2, 5);
    r(armorDk, 8, 18, 2, 2);
    r(armor, 8, 6, 7, 8);
    r(armorLit, 8, 6, 7, 1);
    r(armorDk, 8, 10, 7, 1);
    r(armorLit, 7, 6, 2, 3);
    r(armorLit, 14, 6, 2, 3);
    r(flash || '#3a1a1a', 10, 4, 3, 2);
    r(fire, 9, 1, 5, 3);
    r(fireLit, 10, 1, 2, 2);
    r(fire, 11, 0, 2, 1);
    // Lance couched forward
    r(armor, 14, 9, 3, 3);
    r(flash || '#6b4b2a', 13, 10, 12, 2);
    r(flash || '#8a8a9a', 25, 10, 2, 2);
    r(flash || '#b8bfcd', 25, 10, 1, 1);
  }
}
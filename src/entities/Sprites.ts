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

  getCharSprite(character: GameCharacter): ImageData {
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

  getMonsterSprite(monster: Monster): ImageData {
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
      case 'drow_elite': this.drawDrowElite(ctx, s, baseColor); break;
      case 'will_o_wisp_monster': this.drawWisp(ctx, s, baseColor); break;
      case 'ogre': this.drawOgre(ctx, s, baseColor); break;
      case 'manticore': this.drawManticore(ctx, s, baseColor); break;
      case 'wight': this.drawWight(ctx, s, baseColor); break;
      case 'werewolf': this.drawWerewolf(ctx, s, baseColor); break;
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
      case 'wererat': this.drawWererat(ctx, s, baseColor); break;
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
      case 'wereboar': this.drawWereboar(ctx, s, baseColor); break;
      case 'weretiger': this.drawWeretiger(ctx, s, baseColor); break;
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
      case 'drow_mage': this.drawDrowMage(ctx, s, baseColor); break;
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
      case 'drow_fighter': this.drawDrowFighter(ctx, s, baseColor); break;
      case 'mezzoloth': this.drawMezzoloth(ctx, s, baseColor); break;
      case 'annis_hag': this.drawAnnisHag(ctx, s, baseColor); break;
      case 'drow_priestess': this.drawDrowPriestess(ctx, s, baseColor); break;
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
      case 'drow_house_guard': this.drawDrowHouseGuard(ctx, s, baseColor); break;
      case 'drow_scout': this.drawDrowScout(ctx, s, baseColor); break;
      case 'drow_assassin': this.drawDrowAssassin(ctx, s, baseColor); break;
      case 'drow_archmage': this.drawDrowArchmage(ctx, s, baseColor); break;
      case 'drow_matron': this.drawDrowMatron(ctx, s, baseColor); break;
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
      case 'lizardfolk_baron': this.drawLizardfolkBaron(ctx, s, baseColor); break;
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
      case 'werebear': this.drawWerebear(ctx, s, baseColor); break;
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
      case 'wererat_king': this.drawWereratKing(ctx, s, baseColor); break;
      case 'werewolf_alpha': this.drawWerewolfAlpha(ctx, s, baseColor); break;
      case 'wereshark': this.drawWereshark(ctx, s, baseColor); break;
      case 'weretiger_alpha': this.drawWeretigerAlpha(ctx, s, baseColor); break;
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
      case 'drow_arachnomancer': this.drawDrowArachnomancer(ctx, s, baseColor); break;
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
      case 'spectator_elder': this.drawSpectator(ctx, s, baseColor); break;
      case 'gauth_tyrant': this.drawGauth(ctx, s, baseColor); break;
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

  private drawCube(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const alpha = flash ? 0.8 : 0.4;
    ctx.fillStyle = `rgba(100, 255, 100, ${alpha})`;
    ctx.fillRect(s * 0.05, s * 0.1, s * 0.9, s * 0.8);
    // Outline / shimmer
    ctx.fillStyle = `rgba(150, 255, 150, ${alpha * 1.5})`;
    ctx.fillRect(s * 0.05, s * 0.1, s * 0.9, s * 0.04);
    ctx.fillRect(s * 0.05, s * 0.86, s * 0.9, s * 0.04);
    // Skeleton inside
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.6})`;
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.2, s * 0.4);
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.12);
  }

  private drawMindFlayer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8468a0';
    ctx.fillStyle = c;
    // Robe
    ctx.fillRect(s * 0.28, s * 0.35, s * 0.44, s * 0.5);
    // Head
    ctx.fillRect(s * 0.32, s * 0.05, s * 0.36, s * 0.32);
    // Tentacles
    ctx.fillStyle = '#6a5a8a';
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.54, s * 0.34, s * 0.06, s * 0.15);
    ctx.fillRect(s * 0.64, s * 0.34, s * 0.04, s * 0.12);
    // Glowing eyes
    ctx.fillStyle = '#f0f';
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.2, s * 0.06);
  }

  private drawDragonPalette(ctx: CanvasRenderingContext2D, s: number, flash?: string, body = '#c22', wing = '#a00', breath = '#f80') {
    const c = flash || body;
    ctx.fillStyle = c;
    // Body
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.4);
    // Head
    ctx.fillRect(s * 0.05, s * 0.1, s * 0.2, s * 0.25);
    // Belly scales
    ctx.fillStyle = 'rgba(255,235,180,0.35)';
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.12);
    // Eye
    ctx.fillStyle = '#ff0';
    ctx.fillRect(s * 0.08, s * 0.14, s * 0.06, s * 0.06);
    // Horns
    ctx.fillStyle = flash || '#800';
    ctx.fillRect(s * 0.02, s * 0.0, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.14, s * 0.0, s * 0.06, s * 0.12);
    // Wings
    ctx.fillStyle = flash || wing;
    ctx.fillRect(s * 0.1, s * 0.05, s * 0.5, s * 0.15);
    ctx.fillRect(s * 0.08, s * 0.02, s * 0.54, s * 0.04);
    // Tail
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.78, s * 0.25, s * 0.18, s * 0.06);
    // Breath hint
    ctx.fillStyle = breath;
    ctx.fillRect(s * 0.0, s * 0.2, s * 0.06, s * 0.06);
  }

  private drawDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#c22', '#a00', '#f80');
  }

  private drawBeholder(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a5a8a';
    ctx.fillStyle = c;
    // Main body sphere
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.6);
    // Central eye
    ctx.fillStyle = '#fff';
    ctx.fillRect(s * 0.35, s * 0.3, s * 0.3, s * 0.3);
    ctx.fillStyle = '#0ff';
    ctx.fillRect(s * 0.4, s * 0.35, s * 0.2, s * 0.2);
    ctx.fillStyle = '#000';
    ctx.fillRect(s * 0.46, s * 0.4, s * 0.08, s * 0.1);
    // Eyestalks
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const ex = 0.48 + Math.cos(angle) * 0.35;
      const ey = 0.48 + Math.sin(angle) * 0.35;
      ctx.fillStyle = c;
      ctx.fillRect(s * (ex - 0.01), s * (ey - 0.01), s * 0.02, s * 0.08);
      ctx.fillStyle = '#ff0';
      ctx.fillRect(s * (ex - 0.04), s * (ey - 0.06), s * 0.1, s * 0.06);
      ctx.fillStyle = '#000';
      ctx.fillRect(s * (ex), s * (ey - 0.04), s * 0.04, s * 0.04);
    }
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

  private drawDrowElite(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Adamantine mail
    ctx.fillStyle = flash || '#2c2c3c';
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.46);
    // Dark elf head
    ctx.fillStyle = '#3d2b4f';
    ctx.fillRect(s * 0.35, s * 0.12, s * 0.3, s * 0.2);
    // White hair
    ctx.fillStyle = '#eee';
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.05, s * 0.2);
    ctx.fillRect(s * 0.65, s * 0.12, s * 0.05, s * 0.2);
    // Violet eyes
    ctx.fillStyle = '#cc00ff';
    ctx.fillRect(s * 0.39, s * 0.19, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.55, s * 0.19, s * 0.06, s * 0.04);
    // Hand crossbow
    ctx.fillStyle = '#54382a';
    ctx.fillRect(s * 0.7, s * 0.34, s * 0.06, s * 0.24);
    ctx.fillStyle = '#998f80';
    ctx.fillRect(s * 0.64, s * 0.32, s * 0.18, s * 0.04);
    // Crimson cloak trim + legs
    ctx.fillStyle = '#7a1030';
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.06, s * 0.46);
    ctx.fillStyle = '#232333';
    ctx.fillRect(s * 0.33, s * 0.78, s * 0.13, s * 0.2);
    ctx.fillRect(s * 0.53, s * 0.78, s * 0.13, s * 0.2);
  }

  private drawWisp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Layered glow
    ctx.fillStyle = flash ? 'rgba(200,240,255,0.9)' : 'rgba(80,170,255,0.4)';
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.6);
    ctx.fillStyle = flash ? 'rgba(220,245,255,0.95)' : 'rgba(120,200,255,0.7)';
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.4);
    ctx.fillStyle = flash ? '#fff' : '#dff6ff';
    ctx.fillRect(s * 0.38, s * 0.38, s * 0.24, s * 0.24);
    // Flicker sparks
    ctx.fillRect(s * 0.12, s * 0.5, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.82, s * 0.34, s * 0.05, s * 0.05);
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

  private drawWerewolf(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const fur = flash || '#6e6a63';
    ctx.fillStyle = fur;
    // Hunched furry torso
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.46, s * 0.44);
    // Wolf head + snout
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.32, s * 0.24);
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.16, s * 0.1);
    // Ears
    ctx.fillRect(s * 0.3, s * 0.0, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.0, s * 0.08, s * 0.1);
    // Yellow eyes + jaws
    ctx.fillStyle = '#ffdd00';
    ctx.fillRect(s * 0.38, s * 0.15, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.15, s * 0.06, s * 0.05);
    ctx.fillStyle = '#fff';
    ctx.fillRect(s * 0.64, s * 0.24, s * 0.1, s * 0.03);
    // Clawed hand
    ctx.fillStyle = fur;
    ctx.fillRect(s * 0.14, s * 0.44, s * 0.14, s * 0.08);
    ctx.fillStyle = '#dddddd';
    ctx.fillRect(s * 0.1, s * 0.44, s * 0.05, s * 0.02);
    ctx.fillRect(s * 0.1, s * 0.48, s * 0.05, s * 0.02);
    // Digitigrade legs
    ctx.fillStyle = fur;
    ctx.fillRect(s * 0.3, s * 0.72, s * 0.13, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.72, s * 0.13, s * 0.16);
  }

  private drawMinotaur(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const hide = flash || '#7a4a26';
    ctx.fillStyle = hide;
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.48);
    // Head
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.36, s * 0.24);
    // Curving horns
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(s * 0.18, s * 0.06, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.14, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.66, s * 0.06, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.76, s * 0.1, s * 0.06, s * 0.06);
    // Eyes + nose ring
    ctx.fillStyle = '#ff3300';
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.06, s * 0.05);
    ctx.fillStyle = '#cc8800';
    ctx.fillRect(s * 0.44, s * 0.31, s * 0.1, s * 0.04);
    // Greataxe
    ctx.fillStyle = '#665c50';
    ctx.fillRect(s * 0.78, s * 0.14, s * 0.05, s * 0.66);
    ctx.fillStyle = '#9aa4ad';
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.16, s * 0.12);
    // Hooves
    ctx.fillStyle = '#2c1c10';
    ctx.fillRect(s * 0.28, s * 0.86, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.86, s * 0.16, s * 0.1);
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
    this.drawDragonPalette(ctx, s, flash, '#cfe9fa', '#9cc8e8', '#bff3ff');
  }

  private drawAdultRedDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    this.drawDragonPalette(ctx, s, flash, '#8f0f0f', '#650a0a', '#ffb347');
    if (!flash) {
      // Extra wing layer for sheer size
      ctx.fillStyle = 'rgba(101,10,10,0.7)';
      ctx.fillRect(s * 0.04, s * 0.08, s * 0.6, s * 0.05);
    }
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
    const c = flash || '#141218';
    // Wide low mass
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.08, s * 0.5, s * 0.84, s * 0.34);
    ctx.fillRect(s * 0.18, s * 0.38, s * 0.64, s * 0.16);
    // Glossy highlights
    if (!flash) {
      ctx.fillStyle = 'rgba(140,140,170,0.35)';
      ctx.fillRect(s * 0.22, s * 0.42, s * 0.16, s * 0.06);
      ctx.fillRect(s * 0.5, s * 0.56, s * 0.2, s * 0.05);
    }
    // Rising pseudopod
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.12, s * 0.2);
    // Half-dissolved blade
    ctx.fillStyle = 'rgba(150,150,160,0.5)';
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.18, s * 0.05);
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

  private drawBalor(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Flame aura
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.35)' : 'rgba(255,122,31,0.45)';
    ctx.fillRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : 'rgba(255,207,64,0.35)';
    ctx.fillRect(s * 0.16, s * 0.16, s * 0.68, s * 0.68);
    // Massive body
    ctx.fillStyle = flash || '#6e1210';
    ctx.fillRect(s * 0.24, s * 0.26, s * 0.52, s * 0.5);
    // Wings
    ctx.fillStyle = '#3a0d0b';
    ctx.fillRect(s * 0.02, s * 0.1, s * 0.26, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.26, s * 0.2);
    // Head + burning gaze
    ctx.fillStyle = flash || '#6e1210';
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.32, s * 0.22);
    ctx.fillStyle = '#ffe95c';
    ctx.fillRect(s * 0.39, s * 0.13, s * 0.07, s * 0.06);
    ctx.fillRect(s * 0.55, s * 0.13, s * 0.07, s * 0.06);
    // Flame crown
    ctx.fillStyle = '#ff7a1f';
    ctx.fillRect(s * 0.36, s * 0.0, s * 0.05, s * 0.07);
    ctx.fillRect(s * 0.48, s * 0.0, s * 0.05, s * 0.09);
    ctx.fillRect(s * 0.6, s * 0.0, s * 0.05, s * 0.07);
    // Flame whip
    ctx.fillStyle = '#ffcf40';
    ctx.fillRect(s * 0.78, s * 0.4, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.9, s * 0.46, s * 0.05, s * 0.14);
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

  private drawPixie(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Tiny body
    ctx.fillStyle = flash || '#b8e8c8';
    ctx.fillRect(s * 0.44, s * 0.4, s * 0.12, s * 0.2);
    // Head
    ctx.fillRect(s * 0.44, s * 0.28, s * 0.12, s * 0.14);
    // Shimmering wings
    ctx.fillStyle = '#d8f4ff';
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.14, s * 0.1);
    // Sparkle eyes
    ctx.fillStyle = '#204';
    ctx.fillRect(s * 0.46, s * 0.32, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.51, s * 0.32, s * 0.03, s * 0.03);
    // Light trail
    ctx.fillStyle = '#ffe99a';
    ctx.fillRect(s * 0.5, s * 0.6, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.68, s * 0.04, s * 0.08);
  }

  private drawSprite(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Tiny green-clad body
    ctx.fillStyle = flash || '#4a8a4a';
    ctx.fillRect(s * 0.44, s * 0.42, s * 0.12, s * 0.18);
    // Head
    ctx.fillStyle = '#d8c8a8';
    ctx.fillRect(s * 0.44, s * 0.3, s * 0.12, s * 0.14);
    // Dragonfly wings
    ctx.fillStyle = '#a8d8ff';
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.16, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.16, s * 0.08);
    // Tiny bow
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(s * 0.24, s * 0.44, s * 0.08, s * 0.04);
  }

  /**
   * Lizardfolk, sahuagin and troglodyte were three copies of the same green
   * rectangle with a head on it — the worst silhouette collision in the set,
   * and all three are common at the CR the party spends longest at. Each now
   * owns one strong outline feature: the lizardfolk a long snout and a raised
   * tail, the sahuagin a dorsal crest and a trident, the troglodyte a wide neck
   * frill over a hunched back.
   */
  private drawLizardfolk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const r = this.grid(ctx, s);
    const scale = flash || '#3f7a4a';
    const lit = flash || '#569a5e';
    const dark = flash || '#2b5635';
    const belly = flash || '#93b06a';
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
    r('#e6dcbc', 9, 26, 1, 2);
    r('#e6dcbc', 20, 26, 1, 2);
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
    r('#e6dcbc', 3, 8, 1, 2);
    r('#e6dcbc', 6, 8, 1, 2);
    // Crest spines off the back of the skull
    r(dark, 17, 0, 2, 4);
    r(dark, 19, 2, 2, 3);
    // Slit eye
    r(flash || '#101c12', 10, 4, 4, 3);
    r('#ffe44a', 10, 5, 4, 2);
    r('#101c12', 12, 5, 1, 2);
    // Bone-tipped spear held upright
    r(flash || '#6f5433', 23, 4, 2, 12);
    r(flash || '#e2dac0', 23, 0, 2, 5);
    r(flash || '#f4eedc', 23, 0, 1, 5);
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

  private drawWererat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Hunched rat body
    ctx.fillStyle = flash || '#6a5a52';
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.42);
    // Rat head
    ctx.fillRect(s * 0.32, s * 0.1, s * 0.36, s * 0.26);
    // Snout + whiskers
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.14, s * 0.1);
    // Pink nose
    ctx.fillStyle = '#e89090';
    ctx.fillRect(s * 0.7, s * 0.18, s * 0.04, s * 0.04);
    // Red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.05, s * 0.05);
    // Bare tail
    ctx.fillStyle = '#e8b0a0';
    ctx.fillRect(s * 0.2, s * 0.6, s * 0.1, s * 0.03);
    ctx.fillRect(s * 0.12, s * 0.64, s * 0.1, s * 0.03);
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

  private drawGargoyle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Stone body
    ctx.fillStyle = flash || '#7a7d82';
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.44, s * 0.44);
    // Stone head with horns
    ctx.fillRect(s * 0.32, s * 0.1, s * 0.36, s * 0.22);
    ctx.fillRect(s * 0.3, s * 0.02, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.02, s * 0.08, s * 0.1);
    // Bat wings
    ctx.fillStyle = flash || '#6a6d72';
    ctx.fillRect(s * 0.06, s * 0.22, s * 0.24, s * 0.16);
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.24, s * 0.16);
    // Red stone eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.16, s * 0.06, s * 0.05);
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

  private drawPegasus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // White body
    ctx.fillStyle = flash || '#f0ece4';
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.24);
    // Head + mane
    ctx.fillRect(s * 0.6, s * 0.28, s * 0.16, s * 0.16);
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.1, s * 0.1);
    // Moonlight wings
    ctx.fillStyle = '#f8f4ec';
    ctx.fillRect(s * 0.08, s * 0.26, s * 0.26, s * 0.2);
    ctx.fillRect(s * 0.66, s * 0.08, s * 0.26, s * 0.22);
    // Eye
    ctx.fillStyle = '#7a5a2a';
    ctx.fillRect(s * 0.68, s * 0.32, s * 0.04, s * 0.04);
    // Legs
    ctx.fillStyle = '#e8e4dc';
    ctx.fillRect(s * 0.3, s * 0.62, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.6, s * 0.62, s * 0.08, s * 0.14);
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
    // Translucent yellow ooze
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : '#d8b848';
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.64, s * 0.3);
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.12);
    ctx.fillRect(s * 0.24, s * 0.68, s * 0.16, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.68, s * 0.16, s * 0.08);
    // Inner shimmer
    ctx.fillStyle = '#f8e888';
    ctx.fillRect(s * 0.34, s * 0.44, s * 0.32, s * 0.12);
    // Dissolving specks
    ctx.fillStyle = '#8a7a2a';
    ctx.fillRect(s * 0.24, s * 0.5, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.6, s * 0.54, s * 0.05, s * 0.05);
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

  private drawHellHound(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Coal-black body
    ctx.fillStyle = flash || '#1a1a22';
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.52, s * 0.28);
    // Head + snout
    ctx.fillRect(s * 0.3, s * 0.16, s * 0.4, s * 0.26);
    ctx.fillRect(s * 0.64, s * 0.24, s * 0.14, s * 0.12);
    // Ember eyes
    ctx.fillStyle = '#ff7a1f';
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.06, s * 0.05);
    // Fiery breath
    ctx.fillStyle = '#ffcf40';
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.84, s * 0.3, s * 0.08, s * 0.04);
    // Heat shimmer on back
    ctx.fillStyle = '#ff9a2a';
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.4, s * 0.04);
  }

  private drawDisplacerBeast(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Blue-black panther body
    ctx.fillStyle = flash || '#2a2a4a';
    ctx.fillRect(s * 0.22, s * 0.42, s * 0.56, s * 0.26);
    // Head
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.34, s * 0.22);
    // Tentacles from shoulders
    ctx.fillStyle = '#3a3a5a';
    ctx.fillRect(s * 0.52, s * 0.1, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.6, s * 0.16, s * 0.08, s * 0.2);
    // Displacement afterimage
    ctx.fillStyle = 'rgba(90,90,160,0.35)';
    ctx.fillRect(s * 0.7, s * 0.46, s * 0.2, s * 0.16);
    // Pale eyes
    ctx.fillStyle = '#e0e8ff';
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.28, s * 0.05, s * 0.04);
  }

  private drawBasilisk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Gray lizard body
    ctx.fillStyle = flash || '#8a8d92';
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.6, s * 0.26);
    // Head
    ctx.fillRect(s * 0.26, s * 0.24, s * 0.34, s * 0.2);
    // Four petrifying eyes
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.38, s * 0.28, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.28, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.28, s * 0.05, s * 0.04);
    // Eight legs
    ctx.fillStyle = '#7a7d82';
    ctx.fillRect(s * 0.24, s * 0.64, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.38, s * 0.64, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.52, s * 0.64, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.66, s * 0.64, s * 0.06, s * 0.08);
    // Half-petrified rock patch
    ctx.fillStyle = '#b8bcc4';
    ctx.fillRect(s * 0.62, s * 0.46, s * 0.12, s * 0.08);
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

  private drawLamia(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Serpent tail
    ctx.fillStyle = flash || '#c8a870';
    ctx.fillRect(s * 0.2, s * 0.5, s * 0.6, s * 0.24);
    ctx.fillRect(s * 0.74, s * 0.44, s * 0.1, s * 0.12);
    // Human torso
    ctx.fillStyle = '#e8c8a8';
    ctx.fillRect(s * 0.38, s * 0.3, s * 0.24, s * 0.24);
    // Head
    ctx.fillRect(s * 0.4, s * 0.06, s * 0.2, s * 0.26);
    // Dark hair
    ctx.fillStyle = '#3a2a20';
    ctx.fillRect(s * 0.38, s * 0.02, s * 0.24, s * 0.06);
    // Golden eyes
    ctx.fillStyle = '#caa860';
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.14, s * 0.05, s * 0.04);
    // Staff
    ctx.fillStyle = '#8a5a30';
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.04, s * 0.34);
  }

  private drawWereboar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Bristly body
    ctx.fillStyle = flash || '#6a5a4a';
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.52, s * 0.42);
    // Boar head + snout
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.4, s * 0.26);
    ctx.fillRect(s * 0.6, s * 0.18, s * 0.16, s * 0.12);
    // Tusks
    ctx.fillStyle = '#e8e0c8';
    ctx.fillRect(s * 0.6, s * 0.26, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.66, s * 0.26, s * 0.06, s * 0.08);
    // Bristle ridge
    ctx.fillStyle = '#4a3e32';
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.4, s * 0.04);
    // Small red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.16, s * 0.05, s * 0.04);
  }

  private drawWeretiger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Orange body
    ctx.fillStyle = flash || '#d8802a';
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.48, s * 0.42);
    // Stripes
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.36, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.42, s * 0.08, s * 0.04);
    // Cat head
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.28);
    // Ears
    ctx.fillRect(s * 0.32, s * 0.0, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.0, s * 0.08, s * 0.1);
    // Pale eyes
    ctx.fillStyle = '#f8f0d8';
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.06, s * 0.05);
    // Fangs
    ctx.fillStyle = '#e8e0c8';
    ctx.fillRect(s * 0.46, s * 0.28, s * 0.08, s * 0.04);
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

  private drawAirElemental(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Whirling vortex
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.5)' : 'rgba(180,215,235,0.5)';
    ctx.fillRect(s * 0.22, s * 0.18, s * 0.56, s * 0.56);
    // Spiral bands
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.6)' : 'rgba(220,240,250,0.6)';
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.06);
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.32, s * 0.06);
    ctx.fillRect(s * 0.28, s * 0.54, s * 0.44, s * 0.06);
    // Gusting wisps
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.4)' : 'rgba(200,230,245,0.4)';
    ctx.fillRect(s * 0.08, s * 0.3, s * 0.14, s * 0.05);
    ctx.fillRect(s * 0.78, s * 0.44, s * 0.14, s * 0.05);
    ctx.fillRect(s * 0.12, s * 0.6, s * 0.12, s * 0.05);
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

  private drawWyvern(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Winged dragon body
    ctx.fillStyle = flash || '#5a8a4a';
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.48, s * 0.34);
    // Head + snout
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.34, s * 0.24);
    ctx.fillRect(s * 0.56, s * 0.16, s * 0.16, s * 0.12);
    // Leather wings
    ctx.fillStyle = '#3a5a32';
    ctx.fillRect(s * 0.04, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.24, s * 0.2);
    // Yellow eyes
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(s * 0.36, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.16, s * 0.05, s * 0.05);
    // Stinger tail
    ctx.fillStyle = flash || '#5a8a4a';
    ctx.fillRect(s * 0.66, s * 0.56, s * 0.16, s * 0.05);
    ctx.fillStyle = '#e8d0a0';
    ctx.fillRect(s * 0.8, s * 0.5, s * 0.06, s * 0.12);
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

  private drawVampire(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Aristocratic body
    ctx.fillStyle = flash || '#5a2430';
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.44, s * 0.44);
    // Cape
    ctx.fillStyle = '#3a141e';
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.68, s * 0.46);
    // Pale head
    ctx.fillStyle = '#e8d8d0';
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.32, s * 0.28);
    // Dark swept hair
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(s * 0.32, s * 0.02, s * 0.36, s * 0.06);
    // Red eyes
    ctx.fillStyle = '#ff3020';
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.06, s * 0.04);
    // Fangs
    ctx.fillStyle = '#f8f0e8';
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.51, s * 0.22, s * 0.05, s * 0.06);
    // High collar
    ctx.fillStyle = '#3a141e';
    ctx.fillRect(s * 0.38, s * 0.28, s * 0.24, s * 0.06);
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

  private drawLich(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Rotted robes
    ctx.fillStyle = flash || '#3a3050';
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.48, s * 0.44);
    // Skeletal head
    ctx.fillStyle = '#d8d4cc';
    ctx.fillRect(s * 0.32, s * 0.08, s * 0.36, s * 0.26);
    // Dark eye sockets
    ctx.fillStyle = '#1a1424';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.14, s * 0.06, s * 0.05);
    // Pinpoint soul-light
    ctx.fillStyle = '#7a4aff';
    ctx.fillRect(s * 0.4, s * 0.15, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.58, s * 0.15, s * 0.03, s * 0.03);
    // Crown
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.4, s * 0.06);
    // Staff with soul-gem
    ctx.fillStyle = '#6a5a30';
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.05, s * 0.52);
    ctx.fillStyle = '#9a4aff';
    ctx.fillRect(s * 0.68, s * 0.1, s * 0.12, s * 0.1);
    // Necrotic wisps
    ctx.fillStyle = 'rgba(120,90,200,0.4)';
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.5, s * 0.08, s * 0.08);
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

  private drawPitFiend(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // Massive devil body
    ctx.fillStyle = flash || '#a83a2a';
    ctx.fillRect(s * 0.2, s * 0.28, s * 0.6, s * 0.48);
    // Smoke-wreathed head
    ctx.fillRect(s * 0.28, s * 0.04, s * 0.44, s * 0.26);
    // Great horns
    ctx.fillStyle = '#d8d0b8';
    ctx.fillRect(s * 0.24, s * 0.0, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.0, s * 0.1, s * 0.12);
    // Hellfire eyes
    ctx.fillStyle = '#ff7a1f';
    ctx.fillRect(s * 0.34, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.6, s * 0.12, s * 0.06, s * 0.05);
    // Bat wings
    ctx.fillStyle = '#7a2418';
    ctx.fillRect(s * 0.0, s * 0.2, s * 0.22, s * 0.18);
    ctx.fillRect(s * 0.78, s * 0.2, s * 0.22, s * 0.18);
    // Flaming mace
    ctx.fillStyle = '#6a5a3a';
    ctx.fillRect(s * 0.76, s * 0.3, s * 0.05, s * 0.3);
    ctx.fillStyle = '#ff7a1f';
    ctx.fillRect(s * 0.72, s * 0.24, s * 0.13, s * 0.1);
    // Serpent tail
    ctx.fillStyle = '#8a2e20';
    ctx.fillRect(s * 0.56, s * 0.7, s * 0.2, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.68, s * 0.06, s * 0.1);
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

  private drawCockatrice(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#b8b04a'; // body (scaly chicken)
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.32, s * 0.22);
    ctx.fillStyle = flash || '#c8c05a'; // wing
    ctx.fillRect(s * 0.28, s * 0.28, s * 0.14, s * 0.2);
    ctx.fillStyle = flash || '#d8d06a'; // head + neck
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.12, s * 0.16);
    ctx.fillStyle = flash || '#e83220'; // wattles / comb
    ctx.fillRect(s * 0.6, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.04, s * 0.06);
    ctx.fillStyle = flash || '#8a40b0'; // basilisk reptilian tail
    ctx.fillRect(s * 0.18, s * 0.36, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.06, s * 0.08);
    ctx.fillStyle = '#2a2a30'; // eyes
    ctx.fillRect(s * 0.62, s * 0.24, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.5, s * 0.54, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.64, s * 0.54, s * 0.06, s * 0.12);
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
    ctx.fillStyle = flash || '#3a4a66'; // feathers
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.22, s * 0.4);
    ctx.fillStyle = flash || '#c8b48a'; // face
    ctx.fillRect(s * 0.52, s * 0.1, s * 0.18, s * 0.1);
    ctx.fillStyle = flash || '#d8c000'; // beak
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.1, s * 0.05);
    ctx.fillStyle = flash || '#2a2a48'; // eye
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#2a3a52'; // outstretched wings
    ctx.fillRect(s * 0.04, s * 0.14, s * 0.28, s * 0.22);
    ctx.fillRect(s * 0.64, s * 0.14, s * 0.32, s * 0.22);
    ctx.fillStyle = flash || '#8a5c34'; // legs + javelin
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.4, s * 0.04, s * 0.34);
    ctx.fillStyle = '#c0c0c8'; // javelin head
    ctx.fillRect(s * 0.62, s * 0.72, s * 0.04, s * 0.06);
  }

  private drawGrick(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4a56'; // worm body
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.2, s * 0.3);
    ctx.fillStyle = flash || '#5a5a68'; // beak + head
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.26, s * 0.12);
    ctx.fillStyle = flash || '#2a2a34'; // mouth
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.06, s * 0.04);
    ctx.fillStyle = flash || '#5a5a68'; // tentacles
    ctx.fillRect(s * 0.5, s * 0.22, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.05, s * 0.24);
    ctx.fillRect(s * 0.62, s * 0.22, s * 0.05, s * 0.2);
    ctx.fillStyle = flash || '#4a4a56'; // eyes
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.6, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.12, s * 0.12);
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

  private drawGiantGoat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8b89a'; // wooly body
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.4, s * 0.26);
    ctx.fillStyle = flash || '#b8a888'; // head
    ctx.fillRect(s * 0.58, s * 0.18, s * 0.14, s * 0.14);
    ctx.fillStyle = flash || '#e0d8c8'; // beard
    ctx.fillRect(s * 0.58, s * 0.26, s * 0.06, s * 0.12);
    ctx.fillStyle = flash || '#2a2a30'; // horns
    ctx.fillRect(s * 0.6, s * 0.06, s * 0.04, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.08, s * 0.04, s * 0.12);
    ctx.fillStyle = flash || '#6a4a32'; // legs
    ctx.fillRect(s * 0.28, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.44, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillRect(s * 0.58, s * 0.54, s * 0.08, s * 0.2);
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.04, s * 0.04);
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

  private drawSwarmOfBats(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#1c1620'; // cluster bodies
    ctx.fillRect(s * 0.2, s * 0.16, s * 0.3, s * 0.3);
    ctx.fillRect(s * 0.42, s * 0.28, s * 0.26, s * 0.26);
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.3, s * 0.24);
    ctx.fillStyle = flash || '#3a2a4e'; // spread wings
    ctx.fillRect(s * 0.1, s * 0.2, s * 0.32, s * 0.1);
    ctx.fillRect(s * 0.46, s * 0.3, s * 0.4, s * 0.1);
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.34, s * 0.08);
    ctx.fillStyle = '#c83030'; // eyes glinting
    ctx.fillRect(s * 0.26, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.36, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.52, s * 0.04, s * 0.04);
    ctx.fillStyle = '#e0d8d0'; // fangs
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.4, s * 0.03, s * 0.05);
  }

  private drawMerfolk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8a882'; // head
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#2a4a3a'; // hair / scales
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.08);
    ctx.fillStyle = flash || '#3a8a6a'; // torso (scaled skin)
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.2);
    ctx.fillStyle = flash || '#2a8a5a'; // fish tail
    ctx.fillRect(s * 0.36, s * 0.5, s * 0.28, s * 0.24);
    ctx.fillStyle = flash || '#1a6a3e'; // tail fin
    ctx.fillRect(s * 0.46, s * 0.74, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.3, s * 0.72, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.72, s * 0.16, s * 0.1);
    ctx.fillStyle = flash || '#c8a882'; // arms
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.66, s * 0.34, s * 0.12, s * 0.1);
    ctx.fillStyle = '#24362e';
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
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

  private drawPseudodragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a6aa8'; // coiled body
    ctx.fillRect(s * 0.22, s * 0.3, s * 0.3, s * 0.22);
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.16, s * 0.3);
    ctx.fillStyle = flash || '#5a7ac0'; // wings
    ctx.fillRect(s * 0.1, s * 0.2, s * 0.16, s * 0.22);
    ctx.fillRect(s * 0.62, s * 0.2, s * 0.16, s * 0.22);
    ctx.fillStyle = flash || '#4a6aa8'; // head + neck
    ctx.fillRect(s * 0.56, s * 0.16, s * 0.12, s * 0.14);
    ctx.fillStyle = flash || '#5a7ac0'; // scorpion tail
    ctx.fillRect(s * 0.1, s * 0.44, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.06, s * 0.52, s * 0.1, s * 0.04);
    ctx.fillRect(s * 0.06, s * 0.44, s * 0.04, s * 0.12);
    ctx.fillStyle = '#c8e0f0'; // eye
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.04, s * 0.04);
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

  private drawNeedleBlight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3f5a22'; // twisted trunk body
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.16, s * 0.5);
    ctx.fillStyle = flash || '#2a3c14'; // branch limbs
    ctx.fillRect(s * 0.16, s * 0.24, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.4, s * 0.14, s * 0.16);
    ctx.fillStyle = flash || '#7a9a3a'; // needle tufts
    ctx.fillRect(s * 0.1, s * 0.12, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.16, s * 0.12);
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.1, s * 0.12);
    ctx.fillStyle = flash || '#547a2a'; // needle spikes
    ctx.fillRect(s * 0.16, s * 0.24, s * 0.28, s * 0.02);
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.28, s * 0.02);
    ctx.fillStyle = flash || '#2a3c10'; // roots
    ctx.fillRect(s * 0.34, s * 0.66, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.66, s * 0.1, s * 0.14);
  }

  private drawTwigBlight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a5a38'; // spindly body
    ctx.fillRect(s * 0.46, s * 0.2, s * 0.1, s * 0.44);
    ctx.fillStyle = flash || '#54472c'; // gnarled arms
    ctx.fillRect(s * 0.18, s * 0.26, s * 0.3, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.3, s * 0.06);
    ctx.fillStyle = flash || '#3a2e18'; // claws
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.4, s * 0.08, s * 0.04);
    ctx.fillStyle = flash || '#8a7a50'; // grasping fingers
    ctx.fillRect(s * 0.26, s * 0.24, s * 0.1, s * 0.02);
    ctx.fillRect(s * 0.58, s * 0.32, s * 0.1, s * 0.02);
    ctx.fillStyle = flash || '#e8b83a'; // burning eye
    ctx.fillRect(s * 0.48, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.52, s * 0.08, s * 0.12);
  }

  private drawVineBlight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a5a28'; // mass of tangled vines
    ctx.fillRect(s * 0.28, s * 0.22, s * 0.44, s * 0.4);
    ctx.fillStyle = flash || '#2a4820'; // creeping tendrils
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.2, s * 0.05);
    ctx.fillRect(s * 0.72, s * 0.36, s * 0.18, s * 0.05);
    ctx.fillRect(s * 0.24, s * 0.58, s * 0.3, s * 0.04);
    ctx.fillStyle = flash || '#4a6e30'; // thorns
    ctx.fillRect(s * 0.32, s * 0.26, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.04, s * 0.1);
    ctx.fillStyle = flash || '#2a3a1a'; // staring face
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.52, s * 0.3, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.44, s * 0.46, s * 0.12, s * 0.04);
  }

  private drawGasSpore(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8e8b8'; // translucent balloon sphere
    ctx.fillRect(s * 0.24, s * 0.16, s * 0.52, s * 0.44);
    ctx.fillStyle = flash || '#c8dcac'; // highlight
    ctx.fillRect(s * 0.3, s * 0.22, s * 0.2, s * 0.2);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.2, s * 0.24);
    ctx.fillStyle = flash || '#9ac04a'; // fungal spores
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.48, s * 0.44, s * 0.06, s * 0.06);
    ctx.fillStyle = flash || '#d8f0b0'; // pitted orifices
    ctx.fillRect(s * 0.4, s * 0.5, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.52, s * 0.06, s * 0.04);
    ctx.fillStyle = flash || '#6a8050'; // stalk
    ctx.fillRect(s * 0.47, s * 0.6, s * 0.06, s * 0.2);
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

  private drawShadowDemon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#1c1620'; // smoky body
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.44);
    ctx.fillStyle = flash || '#2a2030'; // swirling edges
    ctx.fillRect(s * 0.22, s * 0.3, s * 0.08, s * 0.24);
    ctx.fillRect(s * 0.7, s * 0.32, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.44, s * 0.14, s * 0.08);
    ctx.fillStyle = flash || '#1c1620'; // head
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#2a2030'; // horns + haze
    ctx.fillRect(s * 0.34, s * 0.04, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.06, s * 0.1, s * 0.08);
    ctx.fillStyle = '#e02020'; // menacing red eyes
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.53, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#2a2030'; // clawed shadow arms
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.1, s * 0.18);
    ctx.fillRect(s * 0.66, s * 0.36, s * 0.1, s * 0.18);
  }

  private drawSwarmOfWasps(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8a020'; // wasp cluster bodies
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.3, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.26, s * 0.22);
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.3, s * 0.22);
    ctx.fillStyle = flash || '#241a08'; // stinging tails
    ctx.fillRect(s * 0.26, s * 0.2, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.14, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.34, s * 0.04, s * 0.08);
    ctx.fillStyle = flash || '#7a5c10'; // wings
    ctx.fillRect(s * 0.2, s * 0.16, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.42, s * 0.3, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.38, s * 0.14, s * 0.06);
    ctx.fillStyle = '#1a1204';
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.42, s * 0.05, s * 0.05);
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

  private drawGiantCrocodile(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a6e3a'; // armored body
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.5, s * 0.2);
    ctx.fillStyle = flash || '#4a5830'; // tail
    ctx.fillRect(s * 0.04, s * 0.34, s * 0.14, s * 0.1);
    ctx.fillStyle = flash || '#7a8e4e'; // belly
    ctx.fillRect(s * 0.2, s * 0.48, s * 0.42, s * 0.06);
    ctx.fillStyle = flash || '#5a6e3a'; // long snout + head
    ctx.fillRect(s * 0.6, s * 0.26, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#7a8e4e'; // snout top
    ctx.fillRect(s * 0.78, s * 0.28, s * 0.1, s * 0.05);
    ctx.fillStyle = flash || '#e8e0d8'; // teeth
    ctx.fillRect(s * 0.62, s * 0.4, s * 0.18, s * 0.04);
    ctx.fillRect(s * 0.7, s * 0.42, s * 0.04, s * 0.04);
    ctx.fillStyle = '#140a04';
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#5a6e3a'; // legs
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.44, s * 0.54, s * 0.1, s * 0.16);
    ctx.fillStyle = flash || '#4a5830'; // humped back ridges
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.04, s * 0.06);
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

  private drawDrowMage(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4a58'; // angular pale-dark face
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#d8d8e0'; // silver hair
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.06);
    ctx.fillStyle = flash || '#241824'; // black spiderweave robes
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.4);
    ctx.fillStyle = flash || '#3a2a3a'; // rune-light on robes
    ctx.fillRect(s * 0.32, s * 0.34, s * 0.36, s * 0.03);
    ctx.fillStyle = flash || '#e858c8'; // faerie fire glow hand
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.08, s * 0.14);
    ctx.fillStyle = '#c84ab0'; // spell sparks
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#e8d8f0';
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#241824'; // legs under robes
    ctx.fillRect(s * 0.42, s * 0.66, s * 0.16, s * 0.12);
  }

  private drawGrell(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a4838'; // dripping leather bell body
    ctx.fillRect(s * 0.3, s * 0.2, s * 0.4, s * 0.3);
    ctx.fillStyle = flash || '#6a5440'; // wet highlights
    ctx.fillRect(s * 0.36, s * 0.24, s * 0.28, s * 0.1);
    ctx.fillStyle = flash || '#3a2e22'; // hanging skirt of flesh
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.12);
    ctx.fillStyle = flash || '#5a4838'; // beak below
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.08);
    ctx.fillStyle = flash || '#e8c860'; // beak tip
    ctx.fillRect(s * 0.44, s * 0.56, s * 0.12, s * 0.04);
    ctx.fillStyle = flash || '#6a5440'; // tentacles with arc crackle
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.16, s * 0.38, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.7, s * 0.32, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.7, s * 0.4, s * 0.16, s * 0.06);
    ctx.fillStyle = '#14ff14'; // crackling paralysis light
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.78, s * 0.32, s * 0.03, s * 0.06);
    ctx.fillStyle = flash || '#e8e020'; // looker twin eyes
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.05, s * 0.05);
  }

  private drawYoungGreenDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a6a2a'; // serpentine green body
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.52, s * 0.2);
    ctx.fillStyle = flash || '#4a7a36'; // long neck
    ctx.fillRect(s * 0.66, s * 0.12, s * 0.1, s * 0.18);
    ctx.fillStyle = flash || '#3a6a2a'; // narrow head
    ctx.fillRect(s * 0.72, s * 0.04, s * 0.16, s * 0.12);
    ctx.fillStyle = flash || '#2a4a18'; // crest horn
    ctx.fillRect(s * 0.74, s * 0.0, s * 0.06, s * 0.06);
    ctx.fillStyle = flash || '#5a8a42'; // folded wings along back
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.16, s * 0.24);
    ctx.fillRect(s * 0.62, s * 0.22, s * 0.16, s * 0.22);
    ctx.fillStyle = flash || '#8ac86a'; // curving snout highlight
    ctx.fillRect(s * 0.78, s * 0.06, s * 0.1, s * 0.04);
    ctx.fillRect(s * 0.3, s * 0.48, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.48, s * 0.48, s * 0.12, s * 0.2);
    ctx.fillStyle = '#c83030'; // eye
    ctx.fillRect(s * 0.76, s * 0.1, s * 0.04, s * 0.04);
  }

  private drawYoungBlackDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#2a2a34'; // eel-like black body
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.5, s * 0.2);
    ctx.fillStyle = flash || '#3a3a46'; // angular head
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#1a1a22'; // curved acid horn
    ctx.fillRect(s * 0.72, s * 0.04, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.78, s * 0.06, s * 0.06, s * 0.08);
    ctx.fillStyle = flash || '#2a2a34'; // ragged wings
    ctx.fillRect(s * 0.16, s * 0.18, s * 0.14, s * 0.26);
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.14, s * 0.2);
    ctx.fillStyle = '#a0c830'; // corroding acid drip
    ctx.fillRect(s * 0.82, s * 0.22, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.28, s * 0.5, s * 0.12, s * 0.18);
    ctx.fillRect(s * 0.48, s * 0.5, s * 0.12, s * 0.18);
    ctx.fillStyle = '#d83030'; // eye
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.04, s * 0.04);
  }

  private drawGuardDrake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a4a3a'; // stocky drake body
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.48, s * 0.22);
    ctx.fillStyle = flash || '#4a3a2e'; // ridge plates on back
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillStyle = flash || '#5a4a3a'; // short neck + blocky head
    ctx.fillRect(s * 0.64, s * 0.18, s * 0.1, s * 0.14);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.12, s * 0.1);
    ctx.fillStyle = '#e8e0d0'; // fangs
    ctx.fillRect(s * 0.72, s * 0.22, s * 0.08, s * 0.03);
    ctx.fillStyle = flash || '#6a5a48'; // small wings
    ctx.fillRect(s * 0.14, s * 0.2, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.64, s * 0.26, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.26, s * 0.52, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.44, s * 0.52, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.62, s * 0.52, s * 0.1, s * 0.16);
    ctx.fillStyle = '#c84040'; // eye
    ctx.fillRect(s * 0.74, s * 0.18, s * 0.04, s * 0.04);
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

  private drawNightmare(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#201818'; // smoldering black body
    ctx.fillRect(s * 0.16, s * 0.32, s * 0.5, s * 0.2);
    ctx.fillStyle = flash || '#3a2a2a'; // neck + head
    ctx.fillRect(s * 0.6, s * 0.12, s * 0.16, s * 0.2);
    ctx.fillRect(s * 0.72, s * 0.06, s * 0.1, s * 0.14);
    ctx.fillStyle = flash || '#e85820'; // burning mane + flame eyes
    ctx.fillRect(s * 0.62, s * 0.14, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.04, s * 0.1);
    ctx.fillStyle = flash || '#e8e020'; // glowing eyes
    ctx.fillRect(s * 0.66, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#e8a020'; // flame edges on legs
    ctx.fillRect(s * 0.2, s * 0.52, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.34, s * 0.52, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.48, s * 0.52, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.52, s * 0.08, s * 0.14);
    ctx.fillStyle = flash || '#e85820'; // tail flame
    ctx.fillRect(s * 0.04, s * 0.36, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.02, s * 0.3, s * 0.08, s * 0.06);
  }

  private drawSpectator(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a8ad8'; // orbicular body
    ctx.fillRect(s * 0.24, s * 0.2, s * 0.52, s * 0.48);
    ctx.fillStyle = flash || '#8a9ae4'; // round highlights
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.2, s * 0.3);
    ctx.fillStyle = flash || '#c8d8f0'; // four eyestalks
    ctx.fillRect(s * 0.14, s * 0.16, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.78, s * 0.2, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.72, s * 0.42, s * 0.08, s * 0.16);
    ctx.fillStyle = flash || '#5a68b0'; // stalk tips
    ctx.fillRect(s * 0.14, s * 0.14, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.78, s * 0.18, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.2, s * 0.56, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.72, s * 0.58, s * 0.08, s * 0.05);
    ctx.fillStyle = '#2440f0'; // glaring central eye
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.2, s * 0.16);
    ctx.fillStyle = '#0a10a0';
    ctx.fillRect(s * 0.46, s * 0.34, s * 0.08, s * 0.08);
    ctx.fillStyle = '#e02020'; // small eyestalk pupils
    ctx.fillRect(s * 0.16, s * 0.28, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.8, s * 0.32, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.22, s * 0.52, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.74, s * 0.54, s * 0.03, s * 0.03);
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

  private drawCambion(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#b84050'; // handsome devil face
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#20242c'; // slicked hair
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.06);
    ctx.fillStyle = flash || '#3a3a4a'; // black plate armor
    ctx.fillRect(s * 0.32, s * 0.26, s * 0.36, s * 0.34);
    ctx.fillStyle = flash || '#5a5a70'; // red-gold trim
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.04);
    ctx.fillStyle = flash || '#8a2020'; // folded bat wings
    ctx.fillRect(s * 0.12, s * 0.22, s * 0.14, s * 0.2);
    ctx.fillRect(s * 0.58, s * 0.3, s * 0.16, s * 0.28);
    ctx.fillStyle = flash || '#e85820'; // burning blade
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.7, s * 0.44, s * 0.05, s * 0.1);
    ctx.fillStyle = flash || '#e8e000'; // embers
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.66, s * 0.26, s * 0.03, s * 0.08);
    ctx.fillStyle = flash || '#3a3a4a'; // legs
    ctx.fillRect(s * 0.38, s * 0.6, s * 0.1, s * 0.18);
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.1, s * 0.18);
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
    ctx.fillStyle = flash || '#7a6a8a'; // regal violet robe
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.4);
    ctx.fillStyle = flash || '#8a7a9a'; // long mantle
    ctx.fillRect(s * 0.22, s * 0.32, s * 0.1, s * 0.32);
    ctx.fillStyle = flash || '#6a5a7a'; // robe trim
    ctx.fillRect(s * 0.3, s * 0.46, s * 0.4, s * 0.05);
    ctx.fillStyle = flash || '#a08aa0'; // pale head
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#6a3a6a'; // crown of tentacles
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.44, s * 0.04, s * 0.12, s * 0.08);
    ctx.fillStyle = '#e83040'; // deep red eyes
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.16, s * 0.05, s * 0.05);
    ctx.fillStyle = flash || '#a08aa0'; // peeling fingers
    ctx.fillRect(s * 0.16, s * 0.36, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.76, s * 0.36, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.42, s * 0.66, s * 0.16, s * 0.12);
  }

  private drawDeathTyrant(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a3a4a'; // desiccated orb body
    ctx.fillRect(s * 0.2, s * 0.22, s * 0.6, s * 0.46);
    ctx.fillStyle = flash || '#3a2c3a'; // withered cracks
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.3, s * 0.1);
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.05);
    ctx.fillStyle = flash || '#5a485a'; // eyestalks
    ctx.fillRect(s * 0.1, s * 0.18, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.82, s * 0.2, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.14, s * 0.42, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.78, s * 0.42, s * 0.08, s * 0.16);
    ctx.fillStyle = '#e0e030'; // eyestalk pupils
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.82, s * 0.32, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.14, s * 0.54, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.78, s * 0.54, s * 0.03, s * 0.03);
    ctx.fillStyle = '#18a018'; // necrotic central eye
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.2, s * 0.18);
    ctx.fillStyle = '#0a4a0a';
    ctx.fillRect(s * 0.46, s * 0.4, s * 0.08, s * 0.08);
    ctx.fillStyle = flash || '#2a2030'; // skeletal spine ridge
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.12, s * 0.08);
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

  private drawGiantWasp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#d8c828'; // striped abdomen
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.34, s * 0.2);
    ctx.fillStyle = flash || '#1c2a3a'; // black stripes
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.06, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.06, s * 0.24);
    ctx.fillStyle = flash || '#283848'; // thorax
    ctx.fillRect(s * 0.52, s * 0.3, s * 0.18, s * 0.22);
    ctx.fillStyle = flash || '#d8c828'; // head
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.14, s * 0.16);
    ctx.fillStyle = flash || '#283848'; // folded wings
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.3, s * 0.14);
    ctx.fillRect(s * 0.24, s * 0.18, s * 0.14, s * 0.1);
    ctx.fillStyle = flash || '#1c2a3a'; // stinger
    ctx.fillRect(s * 0.14, s * 0.46, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.1, s * 0.48, s * 0.04, s * 0.03);
    ctx.fillStyle = flash || '#283848'; // legs
    ctx.fillRect(s * 0.3, s * 0.54, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.5, s * 0.54, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.4, s * 0.05, s * 0.14);
    ctx.fillStyle = '#c83030';
    ctx.fillRect(s * 0.72, s * 0.26, s * 0.03, s * 0.03);
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

  private drawDrowFighter(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a5a5e'; // dark elf skin
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.24, s * 0.3);
    ctx.fillStyle = flash || '#4a4a52'; // angular face
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.14);
    ctx.fillStyle = flash || '#1c1c24'; // slicked white-silver hair
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.06);
    ctx.fillStyle = flash || '#2a2a34'; // chain armor
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.32, s * 0.16);
    ctx.fillStyle = flash || '#3a3a46'; // twin blades
    ctx.fillRect(s * 0.18, s * 0.24, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.04, s * 0.2);
    ctx.fillStyle = flash || '#141418'; // blades tips
    ctx.fillRect(s * 0.18, s * 0.2, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.22, s * 0.04, s * 0.05);
    ctx.fillStyle = '#e83030'; // dark-vision eyes
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#2a2a34'; // legs
    ctx.fillRect(s * 0.4, s * 0.56, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.56, s * 0.08, s * 0.14);
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

  private drawDrowPriestess(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a5a5e'; // dusky skin
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#2a2a34'; // glossy hair
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.24, s * 0.08);
    ctx.fillStyle = flash || '#241824'; // black spider-robe
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.36, s * 0.4);
    ctx.fillStyle = flash || '#3a2a3a'; // spider web embroidery
    ctx.fillRect(s * 0.34, s * 0.36, s * 0.32, s * 0.03);
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.32, s * 0.03);
    ctx.fillStyle = flash || '#5040c8'; // faerie fire glow
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.14, s * 0.14);
    ctx.fillRect(s * 0.16, s * 0.36, s * 0.1, s * 0.14);
    ctx.fillStyle = '#e83030'; // dark-vision eyes
    ctx.fillRect(s * 0.44, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#8a2020'; // spiders crawling on robe
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.66, s * 0.52, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.46, s * 0.68, s * 0.08, s * 0.1);
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
    ctx.fillStyle = flash || '#dde6f0'; // frost-white body
    ctx.fillRect(s * 0.2, s * 0.26, s * 0.56, s * 0.2);
    ctx.fillStyle = flash || '#b8c8e0'; // ice plate belly
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.48, s * 0.06);
    ctx.fillStyle = flash || '#dde6f0'; // long neck
    ctx.fillRect(s * 0.68, s * 0.14, s * 0.12, s * 0.14);
    ctx.fillStyle = flash || '#eef4fc'; // wedge head
    ctx.fillRect(s * 0.76, s * 0.06, s * 0.16, s * 0.12);
    ctx.fillStyle = '#6a88b0'; // icy ridges + crest
    ctx.fillRect(s * 0.72, s * 0.12, s * 0.08, s * 0.03);
    ctx.fillRect(s * 0.82, s * 0.1, s * 0.05, s * 0.03);
    ctx.fillStyle = '#a0c0e8'; // wings
    ctx.fillRect(s * 0.1, s * 0.18, s * 0.12, s * 0.24);
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.12, s * 0.2);
    ctx.fillStyle = '#6a8ab0'; // white-out frost breath glow
    ctx.fillRect(s * 0.84, s * 0.1, s * 0.08, s * 0.03);
    ctx.fillStyle = '#2a3040';
    ctx.fillRect(s * 0.8, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.88, s * 0.08, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#dde6f0'; // legs
    ctx.fillRect(s * 0.26, s * 0.46, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.5, s * 0.46, s * 0.12, s * 0.2);
  }

  private drawAdultBlackDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#14141c'; // glossy black body
    ctx.fillRect(s * 0.2, s * 0.26, s * 0.58, s * 0.2);
    ctx.fillStyle = flash || '#2a2a34'; // horned plate belly
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.5, s * 0.06);
    ctx.fillStyle = flash || '#14141c'; // eel long neck
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.1, s * 0.14);
    ctx.fillStyle = flash || '#1c1c26'; // angular crowned head
    ctx.fillRect(s * 0.76, s * 0.04, s * 0.18, s * 0.14);
    ctx.fillStyle = '#06060a'; // cruel horns
    ctx.fillRect(s * 0.74, s * 0.0, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.84, s * 0.02, s * 0.06, s * 0.06);
    ctx.fillStyle = '#1c1c26'; // tattered wings
    ctx.fillRect(s * 0.08, s * 0.18, s * 0.14, s * 0.26);
    ctx.fillRect(s * 0.64, s * 0.24, s * 0.14, s * 0.2);
    ctx.fillStyle = '#9ac90a'; // caustic acid drip
    ctx.fillRect(s * 0.88, s * 0.18, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.2, s * 0.24, s * 0.03, s * 0.08);
    ctx.fillStyle = '#d83030';
    ctx.fillRect(s * 0.82, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.8, s * 0.06, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#14141c'; // legs
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.5, s * 0.46, s * 0.12, s * 0.2);
  }

  private drawAdultGreenDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#2a5a2e'; // forest-green serpentine body
    ctx.fillRect(s * 0.2, s * 0.26, s * 0.6, s * 0.2);
    ctx.fillStyle = flash || '#3a6a3e'; // scaled belly
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.52, s * 0.05);
    ctx.fillStyle = flash || '#2a5a2e'; // sinuous neck
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.1, s * 0.14);
    ctx.fillStyle = flash || '#2a5a2e'; // crowned chain head
    ctx.fillRect(s * 0.76, s * 0.04, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#1e441e'; // long curling crest
    ctx.fillRect(s * 0.74, s * 0.0, s * 0.16, s * 0.07);
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#3a8a3e'; // folded wings
    ctx.fillRect(s * 0.08, s * 0.16, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.62, s * 0.22, s * 0.14, s * 0.24);
    ctx.fillStyle = '#8aa02a'; // venomous vapor breath
    ctx.fillRect(s * 0.88, s * 0.08, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.9, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillStyle = '#d83030';
    ctx.fillRect(s * 0.8, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.9, s * 0.08, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#2a5a2e'; // legs
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.5, s * 0.46, s * 0.12, s * 0.2);
  }

  private drawAdultBlueDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a4a9a'; // deep azure body
    ctx.fillRect(s * 0.2, s * 0.26, s * 0.58, s * 0.2);
    ctx.fillStyle = flash || '#4a5ab0'; // desert-sand underbelly
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.5, s * 0.06);
    ctx.fillStyle = '#c8b878'; // sand belly line
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.5, s * 0.02);
    ctx.fillStyle = flash || '#3a4a9a'; // huge crowned neck + head
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.04, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#2a3880'; // sweeping horn crest
    ctx.fillRect(s * 0.72, s * 0.0, s * 0.18, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.06, s * 0.06, s * 0.08);
    ctx.fillStyle = flash || '#4a5ab0'; // broad wings
    ctx.fillRect(s * 0.08, s * 0.16, s * 0.14, s * 0.26);
    ctx.fillRect(s * 0.6, s * 0.24, s * 0.14, s * 0.22);
    ctx.fillStyle = '#6a9aff'; // lightning breath crackle
    ctx.fillRect(s * 0.9, s * 0.1, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.92, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = '#e8e858';
    ctx.fillRect(s * 0.82, s * 0.05, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.9, s * 0.05, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#3a4a9a'; // legs
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.5, s * 0.46, s * 0.12, s * 0.2);
  }

  private drawSlaadTadpole(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a8a9a'; // pale gangly body
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.3, s * 0.24);
    ctx.fillStyle = flash || '#9aaab8'; // wet belly
    ctx.fillRect(s * 0.4, s * 0.38, s * 0.22, s * 0.12);
    ctx.fillStyle = flash || '#7a8a9a'; // wide hatchling head
    ctx.fillRect(s * 0.32, s * 0.18, s * 0.36, s * 0.14);
    ctx.fillStyle = flash || '#8a9aa8'; // goggle eyes
    ctx.fillRect(s * 0.36, s * 0.12, s * 0.08, s * 0.07);
    ctx.fillRect(s * 0.56, s * 0.12, s * 0.08, s * 0.07);
    ctx.fillStyle = '#241a10';
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#7a8a9a'; // swimming tail
    ctx.fillRect(s * 0.1, s * 0.4, s * 0.28, s * 0.1);
    ctx.fillRect(s * 0.08, s * 0.44, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.42, s * 0.54, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.54, s * 0.1, s * 0.08);
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

  private drawDeathlock(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4a4e'; // shriveled robed corpse
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.32, s * 0.3);
    ctx.fillStyle = flash || '#3a3a40'; // sunken face
    ctx.fillRect(s * 0.38, s * 0.1, s * 0.24, s * 0.16);
    ctx.fillStyle = flash || '#2a2a30'; // hood
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.32, s * 0.08);
    ctx.fillStyle = '#00e0a0'; // necrotic green eyes
    ctx.fillRect(s * 0.42, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#00e0a0'; // crackling eldritch bolt
    ctx.fillRect(s * 0.72, s * 0.2, s * 0.04, s * 0.24);
    ctx.fillRect(s * 0.76, s * 0.16, s * 0.02, s * 0.1);
    ctx.fillRect(s * 0.14, s * 0.24, s * 0.04, s * 0.16);
    ctx.fillRect(s * 0.12, s * 0.22, s * 0.02, s * 0.08);
    ctx.fillStyle = flash || '#3a3a40'; // trailing robe
    ctx.fillRect(s * 0.3, s * 0.54, s * 0.4, s * 0.14);
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

  private drawGauth(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a5a8a'; // bloated orb body
    ctx.fillRect(s * 0.24, s * 0.22, s * 0.52, s * 0.46);
    ctx.fillStyle = flash || '#8a6a9a'; // warped surface
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.2, s * 0.32);
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.2, s * 0.24);
    ctx.fillStyle = flash || '#c8d8c8'; // five eyestalks
    ctx.fillRect(s * 0.14, s * 0.18, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.78, s * 0.2, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.18, s * 0.42, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.74, s * 0.44, s * 0.08, s * 0.16);
    ctx.fillStyle = '#404048';
    ctx.fillRect(s * 0.14, s * 0.16, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.78, s * 0.18, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.18, s * 0.58, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.6, s * 0.08, s * 0.05);
    ctx.fillStyle = '#c8e830'; // crackling central eye
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.2, s * 0.16);
    ctx.fillStyle = '#8a1010';
    ctx.fillRect(s * 0.46, s * 0.36, s * 0.08, s * 0.08);
    ctx.fillStyle = '#e83030'; // eyestalk pupils
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.8, s * 0.32, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.76, s * 0.56, s * 0.03, s * 0.03);
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
    ctx.fillStyle = flash || '#d8e4f0'; // glacier-white colossus body
    ctx.fillRect(s * 0.18, s * 0.24, s * 0.6, s * 0.22);
    ctx.fillStyle = flash || '#b8ccde'; // ice-crack belly
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.52, s * 0.06);
    ctx.fillStyle = flash || '#e0ecf8'; // looming crowned head
    ctx.fillRect(s * 0.7, s * 0.06, s * 0.26, s * 0.18);
    ctx.fillStyle = flash || '#c0d4e8'; // shining horn crest
    ctx.fillRect(s * 0.72, s * 0.0, s * 0.16, s * 0.08);
    ctx.fillRect(s * 0.66, s * 0.16, s * 0.08, s * 0.03);
    ctx.fillStyle = flash || '#c8dcf0'; // vast wings
    ctx.fillRect(s * 0.06, s * 0.16, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.72, s * 0.22, s * 0.2, s * 0.26);
    ctx.fillStyle = '#8cb8e8'; // blizzard breath veil
    ctx.fillRect(s * 0.9, s * 0.04, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.94, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillStyle = '#2040a0';
    ctx.fillRect(s * 0.78, s * 0.12, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.86, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#d8e4f0'; // legs
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.52, s * 0.46, s * 0.12, s * 0.22);
  }

  private drawAncientBlackDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#12121a'; // tarry black colossus
    ctx.fillRect(s * 0.18, s * 0.24, s * 0.6, s * 0.22);
    ctx.fillStyle = flash || '#24242e'; // acid-worn belly
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.52, s * 0.06);
    ctx.fillStyle = flash || '#181820'; // great crowned skull-head
    ctx.fillRect(s * 0.7, s * 0.04, s * 0.28, s * 0.2);
    ctx.fillStyle = flash || '#08080c'; // tyrant horn crown
    ctx.fillRect(s * 0.68, s * 0.0, s * 0.12, s * 0.09);
    ctx.fillRect(s * 0.84, s * 0.02, s * 0.1, s * 0.07);
    ctx.fillRect(s * 0.78, s * 0.02, s * 0.08, s * 0.04);
    ctx.fillStyle = flash || '#181820'; // torn night wings
    ctx.fillRect(s * 0.04, s * 0.16, s * 0.16, s * 0.3);
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.2, s * 0.26);
    ctx.fillStyle = '#8ab00a'; // rivers of acid
    ctx.fillRect(s * 0.88, s * 0.26, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.92, s * 0.34, s * 0.05, s * 0.07);
    ctx.fillStyle = '#d83030';
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.88, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#12121a'; // legs
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.52, s * 0.46, s * 0.12, s * 0.22);
  }

  private drawAncientGreenDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#1e4a22'; // deep forest-green colossus
    ctx.fillRect(s * 0.18, s * 0.24, s * 0.6, s * 0.22);
    ctx.fillStyle = flash || '#2c5a2c'; // jade-scale belly
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.52, s * 0.06);
    ctx.fillStyle = flash || '#1e4a22'; // crowned chain head
    ctx.fillRect(s * 0.68, s * 0.06, s * 0.28, s * 0.2);
    ctx.fillStyle = flash || '#163a18'; // sweeping crown-crest
    ctx.fillRect(s * 0.64, s * 0.0, s * 0.34, s * 0.09);
    ctx.fillRect(s * 0.68, s * 0.02, s * 0.1, s * 0.04);
    ctx.fillStyle = flash || '#163a18'; // crown barbs
    ctx.fillRect(s * 0.78, s * 0.04, s * 0.12, s * 0.04);
    ctx.fillStyle = flash || '#2c5a2c'; // leafy dark wings
    ctx.fillRect(s * 0.06, s * 0.16, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.68, s * 0.22, s * 0.2, s * 0.26);
    ctx.fillStyle = '#7a9a2a'; // venom cloud
    ctx.fillRect(s * 0.94, s * 0.1, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.9, s * 0.18, s * 0.05, s * 0.04);
    ctx.fillStyle = '#d83030';
    ctx.fillRect(s * 0.74, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.86, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#1e4a22'; // legs
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.52, s * 0.46, s * 0.12, s * 0.22);
  }

  private drawAncientBlueDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#2a3880'; // deep sapphire colossus
    ctx.fillRect(s * 0.18, s * 0.24, s * 0.6, s * 0.22);
    ctx.fillStyle = flash || '#3a489a'; // sand-underbelly
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.52, s * 0.06);
    ctx.fillStyle = '#c8b87a'; // sand line
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.52, s * 0.02);
    ctx.fillStyle = flash || '#2a3880'; // storm-wreathed crowned head
    ctx.fillRect(s * 0.68, s * 0.06, s * 0.28, s * 0.2);
    ctx.fillStyle = flash || '#202c68'; // sweeping horn-plumes
    ctx.fillRect(s * 0.64, s * 0.0, s * 0.16, s * 0.09);
    ctx.fillRect(s * 0.8, s * 0.0, s * 0.16, s * 0.08);
    ctx.fillStyle = flash || '#3a489a'; // vast storm wings
    ctx.fillRect(s * 0.06, s * 0.16, s * 0.14, s * 0.28);
    ctx.fillRect(s * 0.68, s * 0.22, s * 0.2, s * 0.26);
    ctx.fillStyle = '#6a9aff'; // forked lightning breath
    ctx.fillRect(s * 0.94, s * 0.08, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.9, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f0e860';
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.88, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#2a3880'; // legs
    ctx.fillRect(s * 0.24, s * 0.46, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.52, s * 0.46, s * 0.12, s * 0.22);
  }

  private drawAncientRedDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a1a10'; // volcano-crimson colossus
    ctx.fillRect(s * 0.16, s * 0.24, s * 0.62, s * 0.24);
    ctx.fillStyle = flash || '#8a2416'; // ember flecked scales
    ctx.fillRect(s * 0.2, s * 0.28, s * 0.54, s * 0.05);
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.54, s * 0.05);
    ctx.fillStyle = flash || '#8a2416'; // massive crowned skull
    ctx.fillRect(s * 0.68, s * 0.04, s * 0.3, s * 0.2);
    ctx.fillStyle = flash || '#64140a'; // spearhorn crown
    ctx.fillRect(s * 0.64, s * 0.0, s * 0.18, s * 0.1);
    ctx.fillRect(s * 0.8, s * 0.0, s * 0.16, s * 0.08);
    ctx.fillRect(s * 0.72, s * 0.0, s * 0.1, s * 0.04);
    ctx.fillStyle = flash || '#8a2416'; // titanic wings
    ctx.fillRect(s * 0.04, s * 0.14, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.2, s * 0.26);
    ctx.fillStyle = '#e8d020'; // furnace glow eyes
    ctx.fillRect(s * 0.76, s * 0.1, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.88, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f89010'; // molten breath
    ctx.fillRect(s * 0.94, s * 0.08, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.9, s * 0.16, s * 0.05, s * 0.04);
    ctx.fillStyle = '#f8a020'; // ember sparks
    ctx.fillRect(s * 0.2, s * 0.5, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.6, s * 0.5, s * 0.04, s * 0.03);
    ctx.fillStyle = flash || '#7a1a10'; // legs
    ctx.fillRect(s * 0.22, s * 0.48, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.5, s * 0.48, s * 0.12, s * 0.22);
  }

  private drawVulture(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3a3a3e'; // scrawny dark body
    ctx.fillRect(s * 0.34, s * 0.26, s * 0.32, s * 0.22);
    ctx.fillStyle = flash || '#2a2a2e'; // bald wrinkled head
    ctx.fillRect(s * 0.6, s * 0.14, s * 0.14, s * 0.12);
    ctx.fillStyle = flash || '#5a5a60'; // pink pate patch
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.08, s * 0.04);
    ctx.fillStyle = flash || '#4a4a50'; // hooked beak
    ctx.fillRect(s * 0.72, s * 0.18, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.72, s * 0.22, s * 0.05, s * 0.03);
    ctx.fillStyle = flash || '#3a3a3e'; // wide wings
    ctx.fillRect(s * 0.1, s * 0.22, s * 0.26, s * 0.16);
    ctx.fillRect(s * 0.64, s * 0.24, s * 0.26, s * 0.16);
    ctx.fillRect(s * 0.38, s * 0.48, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.48, s * 0.08, s * 0.12);
    ctx.fillStyle = '#c83030';
    ctx.fillRect(s * 0.64, s * 0.18, s * 0.03, s * 0.03);
  }

  private drawBloodHawk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a2222'; // crimson-breasted body
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.32, s * 0.2);
    ctx.fillStyle = flash || '#8a3030'; // blood chest
    ctx.fillRect(s * 0.38, s * 0.3, s * 0.2, s * 0.12);
    ctx.fillStyle = flash || '#6a2828'; // sleek raptor head
    ctx.fillRect(s * 0.58, s * 0.12, s * 0.14, s * 0.12);
    ctx.fillStyle = flash || '#d8c828'; // curved talon beak
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.08, s * 0.05);
    ctx.fillStyle = flash || '#6a2828'; // angry crest
    ctx.fillRect(s * 0.58, s * 0.08, s * 0.05, s * 0.04);
    ctx.fillStyle = flash || '#5a2222'; // wings
    ctx.fillRect(s * 0.12, s * 0.2, s * 0.22, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.22, s * 0.22, s * 0.14);
    ctx.fillRect(s * 0.36, s * 0.44, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.56, s * 0.44, s * 0.08, s * 0.12);
    ctx.fillStyle = '#f0d030'; // fierce eye
    ctx.fillRect(s * 0.62, s * 0.16, s * 0.04, s * 0.04);
  }

  private drawConstrictorSnake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a8a2a'; // coiled green body
    ctx.fillRect(s * 0.28, s * 0.3, s * 0.4, s * 0.2);
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.28, s * 0.16);
    ctx.fillStyle = flash || '#8a9a34'; // scale bands
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.36, s * 0.04);
    ctx.fillRect(s * 0.32, s * 0.44, s * 0.3, s * 0.04);
    ctx.fillStyle = flash || '#7a8a2a'; // flat head + long jaw
    ctx.fillRect(s * 0.6, s * 0.14, s * 0.24, s * 0.1);
    ctx.fillRect(s * 0.66, s * 0.1, s * 0.2, s * 0.06);
    ctx.fillStyle = flash || '#5a6a18'; // diamond head pattern
    ctx.fillRect(s * 0.66, s * 0.16, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.78, s * 0.16, s * 0.08, s * 0.04);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.64, s * 0.14, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.03, s * 0.03);
    ctx.fillStyle = '#e03030'; // tiny forked tongue
    ctx.fillRect(s * 0.86, s * 0.12, s * 0.04, s * 0.02);
    ctx.fillRect(s * 0.88, s * 0.1, s * 0.02, s * 0.03);
    ctx.fillStyle = flash || '#7a8a2a'; // tapering tail
    ctx.fillRect(s * 0.16, s * 0.42, s * 0.14, s * 0.08);
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

  private drawGrayOoze(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a8a90'; // seeping gray ooze mass
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.52, s * 0.2);
    ctx.fillStyle = flash || '#9a9aa2'; // wet surface glints
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.4, s * 0.14, s * 0.08);
    ctx.fillStyle = flash || '#74747c'; // dissolving edges
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.46, s * 0.5, s * 0.3, s * 0.06);
    ctx.fillStyle = flash || '#5a5a62'; // drips
    ctx.fillRect(s * 0.28, s * 0.54, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.56, s * 0.08, s * 0.06);
    ctx.fillStyle = flash || '#9a9aa2'; // ooze eyespots
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.32, s * 0.06, s * 0.06);
  }

  private drawThornSlinger(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4820'; // twisted woody body
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.42);
    ctx.fillStyle = flash || '#5a5a28'; // bark cracks
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.2, s * 0.03);
    ctx.fillRect(s * 0.4, s * 0.46, s * 0.2, s * 0.03);
    ctx.fillStyle = flash || '#3a8a3a'; // whipping vine arms
    ctx.fillRect(s * 0.14, s * 0.26, s * 0.22, s * 0.04);
    ctx.fillRect(s * 0.66, s * 0.32, s * 0.2, s * 0.04);
    ctx.fillRect(s * 0.1, s * 0.42, s * 0.24, s * 0.03);
    ctx.fillRect(s * 0.68, s * 0.5, s * 0.2, s * 0.03);
    ctx.fillStyle = '#b8c838'; // razor thorns
    ctx.fillRect(s * 0.16, s * 0.24, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.24, s * 0.18, s * 0.03, s * 0.1);
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.76, s * 0.22, s * 0.03, s * 0.1);
    ctx.fillStyle = flash || '#2a2810'; // knot-face eyes
    ctx.fillRect(s * 0.42, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.62, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.62, s * 0.12, s * 0.12);
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

  private drawCrocodile(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a6e3a'; // blunt scaled body
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.54, s * 0.18);
    ctx.fillStyle = flash || '#4a5830'; // ridge tail
    ctx.fillRect(s * 0.04, s * 0.34, s * 0.14, s * 0.1);
    ctx.fillStyle = flash || '#7a8e4e'; // lighter belly
    ctx.fillRect(s * 0.2, s * 0.46, s * 0.46, s * 0.05);
    ctx.fillStyle = flash || '#5a6e3a'; // broad flat snout
    ctx.fillRect(s * 0.64, s * 0.28, s * 0.26, s * 0.12);
    ctx.fillStyle = '#f0ece4'; // teeth rim
    ctx.fillRect(s * 0.66, s * 0.36, s * 0.2, s * 0.03);
    ctx.fillStyle = flash || '#4a5830'; // brow ridges
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.8, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillStyle = '#140a04';
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#5a6e3a'; // stubby legs
    ctx.fillRect(s * 0.24, s * 0.52, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.48, s * 0.52, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.52, s * 0.08, s * 0.14);
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

  private drawHobgoblinCaptain(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8a36a'; // ruddy hobgoblin face
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.14);
    ctx.fillStyle = flash || '#6a4a28'; // bristling bristle-hair
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.06);
    ctx.fillStyle = flash || '#b84030'; // crimson-striped leathers
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.36, s * 0.3);
    ctx.fillStyle = flash || '#8a2a20'; // red sashes + war paint
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.32, s * 0.03);
    ctx.fillStyle = '#141414';
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.04); // toothy sneer
    ctx.fillRect(s * 0.44, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.52, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillStyle = flash || '#b8b8c8'; // longsword
    ctx.fillRect(s * 0.7, s * 0.18, s * 0.05, s * 0.3);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.14, s * 0.06);
    ctx.fillRect(s * 0.38, s * 0.58, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.58, s * 0.1, s * 0.16);
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
    ctx.fillStyle = flash || '#2a9a6a'; // carved emerald scales
    ctx.fillRect(s * 0.22, s * 0.28, s * 0.56, s * 0.2);
    ctx.fillStyle = flash || '#34b87c'; // glowing green belly
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.48, s * 0.05);
    ctx.fillStyle = flash || '#2a9a6a'; // long sinuous neck
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.1, s * 0.16);
    ctx.fillStyle = flash || '#2a9a6a'; // elegant faceted head
    ctx.fillRect(s * 0.76, s * 0.04, s * 0.18, s * 0.14);
    ctx.fillStyle = flash || '#1a7a52'; // crystalline crest
    ctx.fillRect(s * 0.74, s * 0.0, s * 0.1, s * 0.07);
    ctx.fillRect(s * 0.8, s * 0.02, s * 0.06, s * 0.04);
    ctx.fillStyle = flash || '#34b87c'; // folded feathered wings
    ctx.fillRect(s * 0.1, s * 0.18, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.7, s * 0.22, s * 0.16, s * 0.24);
    ctx.fillStyle = flash || '#14e0a0'; // mind-glow eyes + spark
    ctx.fillRect(s * 0.8, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.8, s * 0.3, s * 0.03, s * 0.02);
    ctx.fillRect(s * 0.86, s * 0.28, s * 0.02, s * 0.02);
    ctx.fillStyle = flash || '#2a9a6a'; // legs
    ctx.fillRect(s * 0.26, s * 0.48, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.48, s * 0.12, s * 0.2);
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
    ctx.fillStyle = flash || '#6a4aa8'; // royal amethyst scale
    ctx.fillRect(s * 0.18, s * 0.26, s * 0.6, s * 0.22);
    ctx.fillStyle = flash || '#7a5ac0'; // faceted crystal belly
    ctx.fillRect(s * 0.22, s * 0.42, s * 0.52, s * 0.06);
    ctx.fillStyle = flash || '#6a4aa8'; // imperious neck + head
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.02, s * 0.22, s * 0.16);
    ctx.fillStyle = flash || '#5a3c92'; // crystal crown-frills
    ctx.fillRect(s * 0.7, s * 0.0, s * 0.12, s * 0.07);
    ctx.fillRect(s * 0.82, s * 0.0, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.76, s * 0.12, s * 0.06, s * 0.03);
    ctx.fillStyle = flash || '#8a6cc8'; // gem-shard wings
    ctx.fillRect(s * 0.06, s * 0.16, s * 0.14, s * 0.26);
    ctx.fillRect(s * 0.66, s * 0.22, s * 0.2, s * 0.26);
    ctx.fillStyle = '#c058ff'; // psionic force glow
    ctx.fillRect(s * 0.82, s * 0.08, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.0, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f0d8ff';
    ctx.fillRect(s * 0.8, s * 0.08, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.9, s * 0.06, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#6a4aa8'; // legs
    ctx.fillRect(s * 0.24, s * 0.48, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.5, s * 0.48, s * 0.12, s * 0.2);
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

  private drawHawk(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#6a4a2a'; // small compact hawk
    ctx.fillRect(s * 0.38, s * 0.3, s * 0.24, s * 0.2);
    ctx.fillStyle = flash || '#f0e0c0'; // white throat
    ctx.fillRect(s * 0.42, s * 0.34, s * 0.14, s * 0.08);
    ctx.fillStyle = flash || '#4a3015'; // head + short sharp beak
    ctx.fillRect(s * 0.54, s * 0.14, s * 0.16, s * 0.16);
    ctx.fillRect(s * 0.66, s * 0.16, s * 0.08, s * 0.06);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.58, s * 0.18, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.62, s * 0.18, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#5a3a1c'; // spread wings
    ctx.fillRect(s * 0.1, s * 0.28, s * 0.3, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.3, s * 0.12);
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.5, s * 0.04, s * 0.12);
  }

  private drawCrawlingClaw(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#8a8a92'; // severed pale hand
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.22, s * 0.28);
    ctx.fillStyle = flash || '#7a7a84'; // curled fingertips
    ctx.fillRect(s * 0.24, s * 0.28, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.14, s * 0.4, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.26, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.74, s * 0.36, s * 0.1, s * 0.08);
    ctx.fillStyle = '#241a10'; // horn-pale rais
    ctx.fillRect(s * 0.38, s * 0.28, s * 0.04, s * 0.04); // knuckle joint
    ctx.fillStyle = '#141410'; // ragged torn wrist
    ctx.fillRect(s * 0.34, s * 0.52, s * 0.32, s * 0.06);
    ctx.fillStyle = flash || '#6a6a74'; // scuttling shadow
    ctx.fillRect(s * 0.2, s * 0.56, s * 0.12, s * 0.03);
    ctx.fillRect(s * 0.64, s * 0.56, s * 0.12, s * 0.03);
  }

  private drawSkeletonArcher(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#c8c0b0'; // bare bone body
    ctx.fillRect(s * 0.32, s * 0.26, s * 0.36, s * 0.3);
    ctx.fillStyle = '#a89c88'; // rib cage
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.2);
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.3, s * 0.04, s * 0.2);
    ctx.fillStyle = flash || '#b8ae9c'; // bone skull
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.2, s * 0.16);
    ctx.fillStyle = '#a89c88'; // eye sockets + jaw
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.52, s * 0.14, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.46, s * 0.24, s * 0.1, s * 0.04);
    ctx.fillStyle = flash || '#8a6a44'; // strung bow
    ctx.fillRect(s * 0.16, s * 0.2, s * 0.05, s * 0.32);
    ctx.fillRect(s * 0.12, s * 0.34, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.04, s * 0.26);
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.3, s * 0.03);
    ctx.fillRect(s * 0.36, s * 0.56, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.56, s * 0.08, s * 0.16);
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
    ctx.fillStyle = flash || '#b08050'; // fey-brown giant owl
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.22);
    ctx.fillStyle = flash || '#e0c8a8'; // breast feather flow
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.34, s * 0.12, s * 0.12);
    ctx.fillStyle = flash || '#c89868'; // round facial disc
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.2, s * 0.18);
    ctx.fillStyle = flash || '#8a5a30'; // ear tufts
    ctx.fillRect(s * 0.42, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.52, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillStyle = flash || '#f8e860'; // huge golden eyes
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.18, s * 0.06, s * 0.06);
    ctx.fillStyle = '#141414';
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#b08050'; // silent wings
    ctx.fillRect(s * 0.1, s * 0.32, s * 0.24, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.34, s * 0.24, s * 0.12);
    ctx.fillRect(s * 0.36, s * 0.52, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.52, s * 0.06, s * 0.14);
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

  private drawGiantBoar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a4a30'; // bristling giant boar
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.56, s * 0.22);
    ctx.fillStyle = flash || '#6a3c24'; // wet foam flecks
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.16, s * 0.04);
    ctx.fillStyle = flash || '#7a4a30'; // massive tusked head
    ctx.fillRect(s * 0.68, s * 0.16, s * 0.22, s * 0.18);
    ctx.fillStyle = flash || '#f0e8d8'; // long curving tusks
    ctx.fillRect(s * 0.7, s * 0.32, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.78, s * 0.32, s * 0.06, s * 0.12);
    ctx.fillStyle = flash || '#6a3c24'; // ridge mane
    ctx.fillRect(s * 0.22, s * 0.24, s * 0.5, s * 0.08);
    ctx.fillStyle = '#241a08';
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.24, s * 0.5, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.44, s * 0.5, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.64, s * 0.5, s * 0.14, s * 0.18);
    ctx.fillStyle = flash || '#6a3c24'; // darting tail
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.08, s * 0.05);
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
    ctx.fillStyle = flash || '#2a4ac0'; // vivid sapphire body
    ctx.fillRect(s * 0.22, s * 0.28, s * 0.56, s * 0.2);
    ctx.fillStyle = flash || '#3a5ad8'; // shimmering facets
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.48, s * 0.08);
    ctx.fillStyle = flash || '#2a4ac0'; // arched neck + angular head
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.06, s * 0.2, s * 0.14);
    ctx.fillStyle = flash || '#1c34a0'; // ridged faceted crown
    ctx.fillRect(s * 0.72, s * 0.0, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.84, s * 0.02, s * 0.08, s * 0.06);
    ctx.fillStyle = flash || '#3a5ad8'; // folded crystal wings
    ctx.fillRect(s * 0.1, s * 0.18, s * 0.14, s * 0.24);
    ctx.fillRect(s * 0.66, s * 0.22, s * 0.18, s * 0.26);
    ctx.fillStyle = '#78c8ff'; // piercing psionic eye
    ctx.fillRect(s * 0.82, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.8, s * 0.28, s * 0.04, s * 0.02); // psychic spark
    ctx.fillStyle = flash || '#2a4ac0'; // legs
    ctx.fillRect(s * 0.26, s * 0.48, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.48, s * 0.12, s * 0.2);
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
    ctx.fillStyle = flash || '#c89a28'; // glinting amber scales
    ctx.fillRect(s * 0.18, s * 0.26, s * 0.6, s * 0.22);
    ctx.fillStyle = flash || '#d8ac38'; // refracting facets
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.52, s * 0.06);
    ctx.fillStyle = flash || '#e8c848'; // bright underbelly
    ctx.fillRect(s * 0.22, s * 0.42, s * 0.52, s * 0.05);
    ctx.fillStyle = flash || '#c89a28'; // long sea-drake neck + spined head
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.04, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#a87c18'; // spined crown frills
    ctx.fillRect(s * 0.72, s * 0.0, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.84, s * 0.02, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.06, s * 0.03);
    ctx.fillStyle = flash || '#d8ac38'; // salt-shimmer wings
    ctx.fillRect(s * 0.06, s * 0.16, s * 0.14, s * 0.26);
    ctx.fillRect(s * 0.66, s * 0.22, s * 0.18, s * 0.26);
    ctx.fillStyle = '#e8e080'; // petrifying breath light
    ctx.fillRect(s * 0.9, s * 0.08, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.92, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#803020';
    ctx.fillRect(s * 0.82, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.9, s * 0.1, s * 0.03, s * 0.03);
    ctx.fillStyle = flash || '#c89a28'; // legs
    ctx.fillRect(s * 0.24, s * 0.48, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.48, s * 0.12, s * 0.2);
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

  private drawKraken(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a5a6a'; // colossal sea-leviathan bulk
    ctx.fillRect(s * 0.18, s * 0.22, s * 0.64, s * 0.32);
    ctx.fillStyle = flash || '#3a4a58'; // barnacle-plated hide
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.07);
    ctx.fillRect(s * 0.24, s * 0.44, s * 0.52, s * 0.06);
    ctx.fillStyle = flash || '#5a6a7c'; // lightning-crown head
    ctx.fillRect(s * 0.34, s * 0.04, s * 0.32, s * 0.2);
    ctx.fillStyle = '#e0e020'; // cyclopean furious eye
    ctx.fillRect(s * 0.42, s * 0.1, s * 0.16, s * 0.08);
    ctx.fillStyle = '#181408';
    ctx.fillRect(s * 0.48, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = flash || '#5a6a7c'; // ten thrashing arms
    ctx.fillRect(s * 0.06, s * 0.3, s * 0.12, s * 0.22);
    ctx.fillRect(s * 0.12, s * 0.44, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.78, s * 0.3, s * 0.16, s * 0.22);
    ctx.fillRect(s * 0.74, s * 0.46, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.4, s * 0.54, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.54, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.14, s * 0.06, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.82, s * 0.1, s * 0.04, s * 0.14);
    ctx.fillStyle = '#00a0e0'; // storm-glow runes
    ctx.fillRect(s * 0.28, s * 0.38, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.66, s * 0.38, s * 0.06, s * 0.04);
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

  private drawTarrasque(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#7a6a48'; // armored mountain-god
    ctx.fillRect(s * 0.12, s * 0.24, s * 0.76, s * 0.34);
    ctx.fillStyle = flash || '#5a4c32'; // carapace plate ridges
    ctx.fillRect(s * 0.16, s * 0.28, s * 0.68, s * 0.07);
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.68, s * 0.05);
    ctx.fillStyle = flash || '#8a7a54'; // thick antlered-horned head
    ctx.fillRect(s * 0.3, s * 0.06, s * 0.34, s * 0.2);
    ctx.fillStyle = flash || '#5a4c32'; // immense sweeping horns
    ctx.fillRect(s * 0.24, s * 0.0, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.4, s * 0.0, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.0, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.05, s * 0.1, s * 0.08);
    ctx.fillStyle = '#e83030'; // doom-bright eyes
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.07, s * 0.06);
    ctx.fillRect(s * 0.6, s * 0.1, s * 0.07, s * 0.06);
    ctx.fillStyle = '#d8c0a8';
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.04); // fissured maw
    ctx.fillRect(s * 0.38, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#7a6a48'; // world-ending claws + legs
    ctx.fillRect(s * 0.04, s * 0.28, s * 0.1, s * 0.26);
    ctx.fillRect(s * 0.86, s * 0.28, s * 0.1, s * 0.26);
    ctx.fillRect(s * 0.2, s * 0.58, s * 0.16, s * 0.18);
    ctx.fillRect(s * 0.42, s * 0.58, s * 0.16, s * 0.18);
    ctx.fillRect(s * 0.62, s * 0.58, s * 0.16, s * 0.18);
    ctx.fillStyle = flash || '#5a4c32';
    ctx.fillRect(s * 0.02, s * 0.34, s * 0.1, s * 0.1); // armored tail
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
    ctx.fillStyle = flash || '#e0ecf4'; // tiny frost-fresh wyrm
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.18);
    ctx.fillStyle = flash || '#c0d4e4'; // ice-plate belly
    ctx.fillRect(s * 0.34, s * 0.44, s * 0.32, s * 0.04);
    ctx.fillStyle = flash || '#e8f2fa'; // stubby hatchling head
    ctx.fillRect(s * 0.62, s * 0.18, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#b0c8dc'; // budding horn knobs
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillStyle = flash || '#d8e6f0'; // folded baby wings
    ctx.fillRect(s * 0.16, s * 0.26, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.6, s * 0.34, s * 0.14, s * 0.16);
    ctx.fillStyle = '#a8c8e8'; // frost-breath wisp
    ctx.fillRect(s * 0.82, s * 0.24, s * 0.08, s * 0.03);
    ctx.fillStyle = '#24304a';
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.24, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.36, s * 0.52, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.52, s * 0.1, s * 0.12);
  }

  private drawYethHound(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#1c2028'; // shadow-coifed bale hound
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.5, s * 0.18);
    ctx.fillStyle = flash || '#283040'; // writhing shadow-mane
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.2, s * 0.2);
    ctx.fillRect(s * 0.22, s * 0.3, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.28, s * 0.1, s * 0.05);
    ctx.fillStyle = flash || '#1c2028'; // gaunt snouted head
    ctx.fillRect(s * 0.64, s * 0.24, s * 0.2, s * 0.14);
    ctx.fillRect(s * 0.78, s * 0.28, s * 0.12, s * 0.07);
    ctx.fillStyle = '#6a9aff'; // bale-fire eyes
    ctx.fillRect(s * 0.68, s * 0.28, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.76, s * 0.28, s * 0.04, s * 0.04);
    ctx.fillStyle = '#e0e0ea';
    ctx.fillRect(s * 0.7, s * 0.34, s * 0.06, s * 0.03);
    ctx.fillStyle = flash || '#1c2028'; // long legs + tail
    ctx.fillRect(s * 0.2, s * 0.52, s * 0.07, s * 0.2);
    ctx.fillRect(s * 0.34, s * 0.52, s * 0.07, s * 0.2);
    ctx.fillRect(s * 0.48, s * 0.52, s * 0.07, s * 0.2);
    ctx.fillRect(s * 0.04, s * 0.4, s * 0.12, s * 0.05);
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
    ctx.fillStyle = flash || '#6a5a6a'; // bulbous alpha worm
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.3, s * 0.28);
    ctx.fillStyle = flash || '#7a6a7c'; // mottled carapace ridges
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.22, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.22, s * 0.05);
    ctx.fillStyle = flash || '#5a4c5a'; // broad razor beak
    ctx.fillRect(s * 0.26, s * 0.1, s * 0.34, s * 0.18);
    ctx.fillStyle = '#141014'; // gaping beak mouth
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.18, s * 0.08);
    ctx.fillStyle = flash || '#6a5a6a'; // four thick tentacles
    ctx.fillRect(s * 0.5, s * 0.18, s * 0.06, s * 0.26);
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.06, s * 0.3);
    ctx.fillRect(s * 0.66, s * 0.2, s * 0.05, s * 0.24);
    ctx.fillRect(s * 0.72, s * 0.26, s * 0.05, s * 0.2);
    ctx.fillStyle = '#c0b000'; // narrowed eyes
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.5, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.16, s * 0.14);
    ctx.fillRect(s * 0.54, s * 0.52, s * 0.16, s * 0.14);
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
    ctx.fillStyle = flash || '#2a3a8a'; // spade-tip crest king
    ctx.fillRect(s * 0.22, s * 0.26, s * 0.56, s * 0.2);
    ctx.fillStyle = flash || '#3a4a9a'; // sand-hued underbelly
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.48, s * 0.05);
    ctx.fillStyle = '#c8b87a';
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.48, s * 0.02);
    ctx.fillStyle = flash || '#2a3a8a'; // crested neck + angular head
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.02, s * 0.2, s * 0.16);
    ctx.fillStyle = flash || '#1c2a6a'; // curved spade crest
    ctx.fillRect(s * 0.72, s * 0.0, s * 0.12, s * 0.07);
    ctx.fillRect(s * 0.84, s * 0.0, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.76, s * 0.12, s * 0.06, s * 0.04);
    ctx.fillStyle = flash || '#3a4a9a'; // folded storm wings
    ctx.fillRect(s * 0.08, s * 0.18, s * 0.16, s * 0.24);
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.16, s * 0.24);
    ctx.fillStyle = '#70a0ff'; // forked lightning breath
    ctx.fillRect(s * 0.92, s * 0.08, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.88, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f0e058';
    ctx.fillRect(s * 0.82, s * 0.1, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.9, s * 0.08, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.26, s * 0.46, s * 0.12, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.46, s * 0.12, s * 0.2);
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
    ctx.fillStyle = flash || '#9a1c10'; // coal-eye volcano whelp
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.18);
    ctx.fillStyle = flash || '#b02a18'; // ember ridged belly
    ctx.fillRect(s * 0.34, s * 0.44, s * 0.32, s * 0.04);
    ctx.fillStyle = flash || '#a82212'; // broad hatchling head
    ctx.fillRect(s * 0.62, s * 0.14, s * 0.24, s * 0.18);
    ctx.fillStyle = flash || '#821008'; // stubby horn buds
    ctx.fillRect(s * 0.62, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.72, s * 0.06, s * 0.06, s * 0.08);
    ctx.fillStyle = '#f8e020'; // smoking ember eyes
    ctx.fillRect(s * 0.68, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.76, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = flash || '#a82212'; // tucked baby wings
    ctx.fillRect(s * 0.16, s * 0.26, s * 0.14, s * 0.18);
    ctx.fillRect(s * 0.6, s * 0.34, s * 0.14, s * 0.16);
    ctx.fillStyle = '#f8a020'; // first lick of fiery breath
    ctx.fillRect(s * 0.86, s * 0.2, s * 0.08, s * 0.03);
    ctx.fillRect(s * 0.36, s * 0.52, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.52, s * 0.1, s * 0.12);
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

  private drawDarkmantle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // hooded diving cloak hung from the cavern roof
    ctx.fillStyle = flash || '#2a2b33'; // leather-black mantle body
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.06);
    ctx.lineTo(s * 0.6, s * 0.06);
    ctx.lineTo(s * 0.72, s * 0.42);
    ctx.lineTo(s * 0.5, s * 0.62);
    ctx.lineTo(s * 0.28, s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a3bdd'; // creepy glow eyes
    ctx.fillRect(s * 0.32, s * 0.12, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.12, s * 0.06, s * 0.06);
    ctx.fillStyle = '#181920'; // fanged under-maw
    ctx.fillRect(s * 0.42, s * 0.46, s * 0.16, s * 0.12);
    ctx.fillStyle = '#dcdcdc'; // needle teeth
    ctx.fillRect(s * 0.44, s * 0.46, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.46, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.46, s * 0.03, s * 0.06);
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

  private drawGrung(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // vivid poison-dart frog-kin with blowpipe
    ctx.fillStyle = flash || '#e04a2a'; // brilliant orange head
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.28, s * 0.2);
    ctx.fillStyle = '#151515'; // horizontal pupil eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.24, s * 0.08, s * 0.04);
    ctx.fillStyle = '#c02a1a'; // broad smile
    ctx.fillRect(s * 0.42, s * 0.36, s * 0.16, s * 0.04);
    ctx.fillStyle = '#1c4aa8'; // azure frog body
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.3);
    ctx.fillStyle = '#102a68'; // spotted band
    ctx.fillRect(s * 0.32, s * 0.56, s * 0.36, s * 0.08);
    ctx.fillStyle = '#c8c0a8'; // blowpipe
    ctx.fillRect(s * 0.74, s * 0.28, s * 0.06, s * 0.4);
    ctx.fillStyle = '#e8e8e8'; // tiny dart
    ctx.fillRect(s * 0.8, s * 0.64, s * 0.04, s * 0.06);
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

  private drawGiantCentipede(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // coiled chitin with a single lantern-glowing control eye
    ctx.fillStyle = flash || '#7a4f2a'; // armored segments
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.18, s * 0.14);
    ctx.fillRect(s * 0.32, s * 0.5, s * 0.18, s * 0.14);
    ctx.fillRect(s * 0.46, s * 0.4, s * 0.18, s * 0.14);
    ctx.fillRect(s * 0.6, s * 0.5, s * 0.18, s * 0.14);
    ctx.fillStyle = '#5a3a1c'; // under-plating
    ctx.fillRect(s * 0.24, s * 0.54, s * 0.48, s * 0.04);
    ctx.fillStyle = '#3a2614'; // skittering legs
    ctx.fillRect(s * 0.2, s * 0.6, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.36, s * 0.6, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.6, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.6, s * 0.04, s * 0.12);
    ctx.fillStyle = '#a0d0b0'; // glowing head eye
    ctx.fillRect(s * 0.16, s * 0.34, s * 0.08, s * 0.08);
    ctx.fillStyle = '#222'; // mandibles
    ctx.fillRect(s * 0.12, s * 0.4, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.2, s * 0.42, s * 0.04, s * 0.04);
  }

  private drawGiantPoisonSnake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // muscular serpent coiled mid-strike with a pale arrow head
    ctx.fillStyle = flash || '#3e8a52'; // coiled loops
    ctx.fillRect(s * 0.2, s * 0.5, s * 0.24, s * 0.22);
    ctx.fillRect(s * 0.4, s * 0.4, s * 0.22, s * 0.2);
    ctx.fillRect(s * 0.56, s * 0.56, s * 0.2, s * 0.18);
    ctx.fillStyle = '#2a643a'; // scale shadows
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.46, s * 0.46, s * 0.06, s * 0.06);
    ctx.fillStyle = flash || '#e8e4d0'; // wedge head
    ctx.beginPath();
    ctx.moveTo(s * 0.62, s * 0.52);
    ctx.lineTo(s * 0.86, s * 0.3);
    ctx.lineTo(s * 0.8, s * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111'; // fork tongue
    ctx.fillRect(s * 0.86, s * 0.26, s * 0.06, s * 0.03);
    ctx.fillRect(s * 0.8, s * 0.22, s * 0.03, s * 0.03);
  }

  private drawGiantLizard(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sprawling scaled mount with ear-tufts and swishing tail
    ctx.fillStyle = flash || '#5a7a4a'; // head
    ctx.fillRect(s * 0.62, s * 0.24, s * 0.24, s * 0.2);
    ctx.fillStyle = '#c8c8c8'; // eye glare
    ctx.fillRect(s * 0.8, s * 0.26, s * 0.04, s * 0.06);
    ctx.fillStyle = '#3a5230'; // long body arc
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.34, s * 0.22);
    ctx.fillRect(s * 0.12, s * 0.46, s * 0.2, s * 0.16);
    ctx.fillStyle = '#2a3a22'; // spine ridge + legs
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.26, s * 0.06);
    ctx.fillRect(s * 0.34, s * 0.62, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.62, s * 0.1, s * 0.12);
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

  private drawStirge(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // needle-nosed bug whining on translucent wings
    ctx.fillStyle = flash || '#7a6a8a'; // plump blood-gorged body
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.2, s * 0.22);
    ctx.fillStyle = '#c8bada'; // stretched membranous wings
    ctx.fillRect(s * 0.24, s * 0.16, s * 0.18, s * 0.2);
    ctx.fillRect(s * 0.58, s * 0.16, s * 0.18, s * 0.2);
    ctx.fillStyle = '#2a2432'; // fanning tail tufts
    ctx.fillRect(s * 0.58, s * 0.56, s * 0.02, s * 0.14);
    ctx.fillRect(s * 0.5, s * 0.58, s * 0.02, s * 0.12);
    ctx.fillStyle = '#d8d8d8'; // long proboscis
    ctx.fillRect(s * 0.56, s * 0.32, s * 0.26, s * 0.03);
    ctx.fillStyle = '#c02020'; // eye light
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.03, s * 0.03);
  }

  private drawManes(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // weeping misshapen soul of the Abyss
    ctx.fillStyle = flash || '#8a5a3a'; // plump despairing body
    ctx.fillRect(s * 0.32, s * 0.3, s * 0.36, s * 0.34);
    ctx.fillStyle = '#5a3a24'; // sunken eye pockets
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.28, s * 0.1, s * 0.1);
    ctx.fillStyle = '#c05040'; // weeping red eyes
    ctx.fillRect(s * 0.38, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.57, s * 0.3, s * 0.05, s * 0.05);
    ctx.fillStyle = '#3a2414'; // slack drooling mouth
    ctx.fillRect(s * 0.44, s * 0.48, s * 0.12, s * 0.04);
    ctx.fillStyle = '#4a3020'; // withered claws
    ctx.fillRect(s * 0.22, s * 0.62, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.7, s * 0.62, s * 0.08, s * 0.14);
  }

  private drawLemure(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // molten pinched husk, molten-bright with an inner ember
    ctx.fillStyle = flash || '#c07028'; // glowing molten torso
    ctx.beginPath();
    ctx.moveTo(s * 0.34, s * 0.3);
    ctx.lineTo(s * 0.66, s * 0.3);
    ctx.lineTo(s * 0.6, s * 0.58);
    ctx.lineTo(s * 0.4, s * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd06a'; // white-hot core
    ctx.fillRect(s * 0.46, s * 0.36, s * 0.08, s * 0.12);
    ctx.fillStyle = '#8a3a1a'; // pinched arms
    ctx.fillRect(s * 0.22, s * 0.38, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.68, s * 0.38, s * 0.1, s * 0.12);
    ctx.fillStyle = '#5a2010'; // drips
    ctx.fillRect(s * 0.36, s * 0.58, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.58, s * 0.08, s * 0.16);
  }

  private drawGiantFireBeetle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // humped lantern-beetle with two glowing head glands
    ctx.fillStyle = flash || '#2a2a1a'; // scarab shell
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.52, s * 0.26);
    ctx.fillStyle = '#3a3a26'; // segmented ridge
    ctx.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.04);
    ctx.fillStyle = '#ffa030'; // headlight glands
    ctx.fillRect(s * 0.18, s * 0.3, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.12, s * 0.12);
    ctx.fillStyle = '#1c1c10'; // legs
    ctx.fillRect(s * 0.28, s * 0.6, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.44, s * 0.6, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.6, s * 0.08, s * 0.1);
  }

  private drawSpiderSwarm(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // seething tide of tiny spiders pooling on the floor
    ctx.fillStyle = flash || '#1c1c1c'; // dark mass base
    ctx.fillRect(s * 0.14, s * 0.64, s * 0.72, s * 0.12);
    ctx.fillStyle = '#2c2c2c'; // mounding wave
    ctx.fillRect(s * 0.18, s * 0.5, s * 0.3, s * 0.16);
    ctx.fillRect(s * 0.42, s * 0.44, s * 0.34, s * 0.18);
    ctx.fillStyle = '#606060'; // scuttling legs
    ctx.fillRect(s * 0.2, s * 0.72, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.32, s * 0.72, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.44, s * 0.72, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.72, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.68, s * 0.72, s * 0.03, s * 0.08);
    ctx.fillRect(s * 0.8, s * 0.72, s * 0.03, s * 0.08);
    ctx.fillStyle = '#a02020'; // hungry red eye dots
    ctx.fillRect(s * 0.22, s * 0.48, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.4, s * 0.42, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.62, s * 0.46, s * 0.03, s * 0.03);
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

  private drawSwarmInsects(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // chittering haze of beetle and ant
    ctx.fillStyle = flash || '#262010'; // swarm haze base
    ctx.fillRect(s * 0.14, s * 0.5, s * 0.72, s * 0.16);
    ctx.fillStyle = '#1a150c'; // mounding billows
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.24, s * 0.12);
    ctx.fillStyle = '#3a2c16'; // exoskeleton glints
    ctx.fillRect(s * 0.26, s * 0.44, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.44, s * 0.38, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.6, s * 0.44, s * 0.04, s * 0.04);
    ctx.fillStyle = '#c8b040'; // tiny eye sparks
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.02, s * 0.02);
    ctx.fillRect(s * 0.52, s * 0.54, s * 0.02, s * 0.02);
    ctx.fillRect(s * 0.66, s * 0.52, s * 0.02, s * 0.02);
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

  private drawKillerWhale(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // black-and-white breach leviathan
    ctx.fillStyle = flash || '#10151c'; // great black body
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.78, s * 0.3);
    ctx.fillStyle = '#eef0f2'; // white saddle flank
    ctx.fillRect(s * 0.5, s * 0.42, s * 0.24, s * 0.12);
    ctx.fillStyle = '#eef0f2'; // white chin
    ctx.fillRect(s * 0.76, s * 0.52, s * 0.12, s * 0.08);
    ctx.fillStyle = '#10151c'; // tall curved dorsal
    ctx.beginPath();
    ctx.moveTo(s * 0.42, s * 0.34);
    ctx.lineTo(s * 0.5, s * 0.12);
    ctx.lineTo(s * 0.58, s * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#10151c'; // fluke tail
    ctx.fillRect(s * 0.08, s * 0.38, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.06, s * 0.32, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.06, s * 0.46, s * 0.04, s * 0.06);
    ctx.fillStyle = '#eef0f2'; // eye patch
    ctx.fillRect(s * 0.8, s * 0.4, s * 0.06, s * 0.04);
    ctx.fillStyle = '#0a0e14'; // eye
    ctx.fillRect(s * 0.82, s * 0.4, s * 0.02, s * 0.04);
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
    // broad night hunter with tufted horns
    ctx.fillStyle = flash || '#6a5440'; // round head
    ctx.fillRect(s * 0.32, s * 0.2, s * 0.36, s * 0.28);
    ctx.fillStyle = '#3a2c1e'; // ear tufts
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.64, s * 0.14, s * 0.06, s * 0.1);
    ctx.fillStyle = '#e8d870'; // piercing golden eyes
    ctx.fillRect(s * 0.36, s * 0.24, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.24, s * 0.12, s * 0.12);
    ctx.fillStyle = '#1c1408'; // eye pupils
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.05, s * 0.08);
    ctx.fillStyle = '#e0c86a'; // hooked beak
    ctx.fillRect(s * 0.47, s * 0.36, s * 0.06, s * 0.08);
    ctx.fillStyle = '#e0dcc8'; // facial disc
    ctx.fillRect(s * 0.34, s * 0.36, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.36, s * 0.12, s * 0.04);
  }

  private drawViper(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // thin pale serpent coiled and cold-eyed
    ctx.fillStyle = flash || '#b8b0a0'; // pale coils
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.28, s * 0.16);
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.2, s * 0.12);
    ctx.fillStyle = '#8a8270'; // subtle bands
    ctx.fillRect(s * 0.24, s * 0.48, s * 0.08, s * 0.03);
    ctx.fillRect(s * 0.46, s * 0.54, s * 0.08, s * 0.03);
    ctx.fillStyle = flash || '#d8d2c4'; // raised wedge head
    ctx.beginPath();
    ctx.moveTo(s * 0.64, s * 0.42);
    ctx.lineTo(s * 0.9, s * 0.3);
    ctx.lineTo(s * 0.8, s * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#28282a'; // cold eye
    ctx.fillRect(s * 0.82, s * 0.36, s * 0.03, s * 0.03);
    ctx.fillStyle = '#6a1010'; // forked tongue tip
    ctx.fillRect(s * 0.9, s * 0.28, s * 0.05, s * 0.02);
  }

  private drawSteamMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // puffing scalding vapor wisp
    ctx.fillStyle = flash || '#b8c6d4'; // cloud-billow body
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.26);
    ctx.fillRect(s * 0.22, s * 0.22, s * 0.18, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.22, s * 0.18, s * 0.12);
    ctx.fillStyle = '#8a9aaa'; // wispy lower billow
    ctx.fillRect(s * 0.26, s * 0.56, s * 0.48, s * 0.1);
    ctx.fillStyle = '#2c3038'; // needle eyes
    ctx.fillRect(s * 0.36, s * 0.34, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.34, s * 0.06, s * 0.05);
    ctx.fillStyle = '#e0e8f0'; // hissing mouth
    ctx.fillRect(s * 0.44, s * 0.44, s * 0.12, s * 0.04);
  }

  private drawMudMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // lump of belching wet clay
    ctx.fillStyle = flash || '#6a5130'; // oozy body hump
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.44, s * 0.3);
    ctx.fillStyle = '#4c3a22'; // wet runnel shadow
    ctx.fillRect(s * 0.34, s * 0.5, s * 0.14, s * 0.08);
    ctx.fillRect(s * 0.56, s * 0.4, s * 0.1, s * 0.14);
    ctx.fillStyle = '#c8b898'; // clay highlights
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.34, s * 0.08, s * 0.06);
    ctx.fillStyle = '#24180a'; // bulbous eyes
    ctx.fillRect(s * 0.36, s * 0.34, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.58, s * 0.34, s * 0.06, s * 0.06);
    ctx.fillStyle = '#5a4326'; // gaping drippy mouth
    ctx.fillRect(s * 0.42, s * 0.5, s * 0.16, s * 0.08);
    ctx.fillStyle = '#2c1c0a'; // mud drip
    ctx.fillRect(s * 0.46, s * 0.58, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.58, s * 0.04, s * 0.1);
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

  private drawKoboldInventor(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // tinker-scaled contraption-builder with goggles and a sparking wand
    ctx.fillStyle = flash || '#8a4a2a'; // scaled head
    ctx.fillRect(s * 0.36, s * 0.22, s * 0.28, s * 0.2);
    ctx.fillStyle = '#5a2c14'; // snout
    ctx.fillRect(s * 0.46, s * 0.3, s * 0.14, s * 0.12);
    ctx.fillStyle = '#20282c'; // bulky brass goggles
    ctx.fillRect(s * 0.34, s * 0.24, s * 0.12, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.24, s * 0.12, s * 0.1);
    ctx.fillStyle = '#d8b43a'; // gleaming lenses
    ctx.fillRect(s * 0.36, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.58, s * 0.26, s * 0.06, s * 0.06);
    ctx.fillStyle = '#5a3a20'; // leather straps
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.3, s * 0.03);
    ctx.fillStyle = '#3a2c18'; // smock and belts
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.28);
    ctx.fillStyle = '#96503a'; // tool pouch
    ctx.fillRect(s * 0.6, s * 0.46, s * 0.12, s * 0.12);
    ctx.fillStyle = '#c04818'; // sparking wand tip
    ctx.fillRect(s * 0.78, s * 0.38, s * 0.08, s * 0.06);
    ctx.fillStyle = '#6a4418'; // wand
    ctx.fillRect(s * 0.74, s * 0.32, s * 0.04, s * 0.16);
    ctx.fillStyle = '#e0c040'; // electric sparks
    ctx.fillRect(s * 0.84, s * 0.36, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.82, s * 0.42, s * 0.03, s * 0.03);
  }

  private drawLizardfolkBaron(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // scaled swamp-warlord with a great thrashing axe
    ctx.fillStyle = flash || '#3f8a47'; // crested head
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.24);
    ctx.fillStyle = '#2c6733'; // brow ridge + jaw frill
    ctx.fillRect(s * 0.32, s * 0.14, s * 0.36, s * 0.06);
    ctx.fillRect(s * 0.36, s * 0.4, s * 0.28, s * 0.06);
    ctx.fillStyle = '#d8d8a0'; // slitted predator eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.54, s * 0.24, s * 0.06, s * 0.06);
    ctx.fillStyle = '#22301c'; // heavy scaled torso
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.3);
    ctx.fillStyle = '#8a6a3a'; // bone-beaded pauldron
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.12, s * 0.14);
    ctx.fillStyle = '#6a4420'; // thrashing axe haft
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.05, s * 0.52);
    ctx.fillStyle = '#a8b8cc'; // stone-blade axe head
    ctx.fillRect(s * 0.62, s * 0.16, s * 0.14, s * 0.1);
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.06, s * 0.12);
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

  private drawSwampWight(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // bog-sunken warden risen dripping with peat
    ctx.fillStyle = flash || '#3a4a3a'; // hunched dripping body
    ctx.fillRect(s * 0.32, s * 0.36, s * 0.36, s * 0.3);
    ctx.fillStyle = '#2c3a2c'; // trailing bog-rush chains
    ctx.fillRect(s * 0.26, s * 0.5, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.64, s * 0.5, s * 0.1, s * 0.16);
    ctx.fillStyle = '#4c5c4c'; // sunken bloated head
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.2);
    ctx.fillStyle = '#15240a'; // cold grave light eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.55, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillStyle = '#222a18'; // gaping death-mouth
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.12, s * 0.04);
    ctx.fillStyle = '#202c18'; // peat-wrapped weapon
    ctx.fillRect(s * 0.64, s * 0.4, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.36, s * 0.06, s * 0.12);
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

  private drawSkeletonLegionnaire(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // drilled ranks-man of the long-dead with shield
    ctx.fillStyle = flash || '#d6d0c0'; // bare skull
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillStyle = '#241812'; // hollow eye sockets
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.55, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#241812'; // clench-tooth grin
    ctx.fillRect(s * 0.42, s * 0.32, s * 0.16, s * 0.05);
    ctx.fillStyle = '#8a8a9a'; // rusted iron helm rim
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.05);
    ctx.fillStyle = '#b0b0c0'; // skeletal ribs
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.28, s * 0.08);
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.12, s * 0.08);
    ctx.fillStyle = '#8a8a9a'; // drilled shield
    ctx.fillRect(s * 0.6, s * 0.34, s * 0.24, s * 0.24);
    ctx.fillStyle = '#5a3030'; // bleeding shield icon
    ctx.fillRect(s * 0.66, s * 0.4, s * 0.12, s * 0.12);
    ctx.fillStyle = '#60606a'; // rusted spear
    ctx.fillRect(s * 0.86, s * 0.16, s * 0.03, s * 0.4);
  }

  private drawDireBoar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // foam-flecked mountain of tusk and fury charging
    ctx.fillStyle = flash || '#6a4426'; // bristling tusked body
    ctx.fillRect(s * 0.2, s * 0.38, s * 0.6, s * 0.3);
    ctx.fillStyle = '#4a2c16'; // coarse back-bristle ridge
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.4, s * 0.06);
    ctx.fillStyle = '#8a6240'; // wedge head
    ctx.fillRect(s * 0.7, s * 0.3, s * 0.22, s * 0.24);
    ctx.fillStyle = '#e8e8e8'; // two enormous tusks
    ctx.fillRect(s * 0.74, s * 0.5, s * 0.16, s * 0.06);
    ctx.fillRect(s * 0.8, s * 0.5, s * 0.08, s * 0.14);
    ctx.fillStyle = '#f2f2f2'; // flecked foam
    ctx.fillRect(s * 0.9, s * 0.32, s * 0.05, s * 0.03);
    ctx.fillStyle = '#c03020'; // mad pig-eye
    ctx.fillRect(s * 0.86, s * 0.34, s * 0.04, s * 0.04);
    ctx.fillStyle = '#3a2414'; // churning legs
    ctx.fillRect(s * 0.24, s * 0.68, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.5, s * 0.68, s * 0.1, s * 0.16);
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

  private drawIncubus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // velvet-voiced nightmare-father in shadow blade
    ctx.fillStyle = flash || '#4a3a52'; // lean dark tunic
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.32);
    ctx.fillStyle = '#5d4a68'; // belt sheen
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.04);
    ctx.fillStyle = '#c8b8be'; // handsome dark face
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.22);
    ctx.fillStyle = '#3a3040'; // unsettling eyes
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#3a2c44'; // folded leathery wings
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.16, s * 0.26);
    ctx.fillRect(s * 0.68, s * 0.3, s * 0.16, s * 0.26);
    ctx.fillStyle = '#2c2032'; // wide grim horns
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.52, s * 0.14, s * 0.08, s * 0.08);
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
    // glossy armored beetle with smoking rear vents
    ctx.fillStyle = flash || '#6a3a20'; // shiny red-black shell
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.52, s * 0.26);
    ctx.fillStyle = '#4a2410'; // crust ridge
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.36, s * 0.06);
    ctx.fillStyle = '#7a4a26'; // raised elytra gleam
    ctx.fillRect(s * 0.28, s * 0.38, s * 0.1, s * 0.08);
    ctx.fillStyle = '#1c1008'; // pronotal head
    ctx.fillRect(s * 0.14, s * 0.38, s * 0.12, s * 0.12);
    ctx.fillStyle = '#e0d030'; // chemical rear vents glowing
    ctx.fillRect(s * 0.66, s * 0.42, s * 0.08, s * 0.08);
    ctx.fillStyle = '#8ab0c0'; // searing vapor cloud
    ctx.fillRect(s * 0.72, s * 0.34, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.8, s * 0.4, s * 0.08, s * 0.06);
    ctx.fillStyle = '#241408'; // six armored legs
    ctx.fillRect(s * 0.24, s * 0.64, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.4, s * 0.64, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.06, s * 0.1);
  }

  private drawWerebear(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // guardian lycanthrope in a bear's great frame
    ctx.fillStyle = flash || '#6a4a38'; // massive ursine chest-hide
    ctx.fillRect(s * 0.26, s * 0.36, s * 0.48, s * 0.34);
    ctx.fillStyle = '#8a624a'; // lighter pelt flank
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.2, s * 0.05);
    ctx.fillStyle = '#5a3c2a'; // broad bear head
    ctx.fillRect(s * 0.32, s * 0.18, s * 0.36, s * 0.26);
    ctx.fillStyle = '#402a1a'; // small calm bear eyes
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.05, s * 0.04);
    ctx.fillStyle = '#2a1a10'; // blunt muzzle
    ctx.fillRect(s * 0.42, s * 0.36, s * 0.16, s * 0.08);
    ctx.fillStyle = '#e8e8e8'; // formidable claws
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.4, s * 0.66, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.58, s * 0.66, s * 0.06, s * 0.08);
  }

  private drawWereraven(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sharp-eyed spy of the feather
    ctx.fillStyle = flash || '#2c2c34'; // glossy black raven body
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.26);
    ctx.fillStyle = '#1e1e24'; // folded wing sheen
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.16, s * 0.12);
    ctx.fillStyle = flash || '#2c2c34'; // slender head
    ctx.fillRect(s * 0.54, s * 0.28, s * 0.2, s * 0.16);
    ctx.fillStyle = '#4a4a54'; // sharp wedge beak
    ctx.fillRect(s * 0.7, s * 0.32, s * 0.1, s * 0.06);
    ctx.fillStyle = '#8a3020'; // keen red eye
    ctx.fillRect(s * 0.62, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillStyle = '#1a1a20'; // tail fan
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.22, s * 0.52, s * 0.08, s * 0.14);
    ctx.fillStyle = '#18181e'; // claws
    ctx.fillRect(s * 0.4, s * 0.62, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.52, s * 0.62, s * 0.04, s * 0.08);
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
    // glittering winged serpent, slim and quick
    ctx.fillStyle = flash || '#7a5a2a'; // slender coiled body
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.2, s * 0.16);
    ctx.fillStyle = '#c8a85a'; // bright scale glints
    ctx.fillRect(s * 0.44, s * 0.4, s * 0.05, s * 0.04);
    ctx.fillStyle = '#a89040'; // folded glitter wings
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.18, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.18, s * 0.12);
    ctx.fillStyle = '#3a2810'; // small fierce eyes
    ctx.fillRect(s * 0.5, s * 0.4, s * 0.03, s * 0.03);
    ctx.fillStyle = '#e8c050'; // raised arrow head
    ctx.fillRect(s * 0.52, s * 0.28, s * 0.1, s * 0.1);
    ctx.fillStyle = '#c03030'; // darting tongue
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.06, s * 0.02);
  }

  private drawGiantFrilledLizard(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sleek runner with a monstrous fan of neck skin
    ctx.fillStyle = flash || '#5a8a3a'; // running scaled body
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.4, s * 0.22);
    ctx.fillStyle = '#447024'; // running legs
    ctx.fillRect(s * 0.2, s * 0.62, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.4, s * 0.62, s * 0.08, s * 0.12);
    ctx.fillStyle = '#4a7a2c'; // flat head snapping
    ctx.fillRect(s * 0.56, s * 0.32, s * 0.18, s * 0.16);
    ctx.fillStyle = '#e03030'; // flashing eye
    ctx.fillRect(s * 0.66, s * 0.36, s * 0.04, s * 0.04);
    ctx.fillStyle = '#d04a20'; // great frilled fan spread
    ctx.beginPath();
    ctx.moveTo(s * 0.56, s * 0.32);
    ctx.lineTo(s * 0.3, s * 0.12);
    ctx.lineTo(s * 0.26, s * 0.42);
    ctx.lineTo(s * 0.42, s * 0.26);
    ctx.lineTo(s * 0.58, s * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#a03416'; // frill pattern bands
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.04, s * 0.16);
    ctx.fillRect(s * 0.4, s * 0.16, s * 0.04, s * 0.12);
  }

  private drawGloomWeaver(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // long-limbed spider-fiend weaving strands of gloom
    ctx.fillStyle = flash || '#3a2444'; // hunched weaver torso
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.4, s * 0.3);
    ctx.fillStyle = '#5a3a6a'; // mottled thorax vein
    ctx.fillRect(s * 0.34, s * 0.36, s * 0.32, s * 0.06);
    ctx.fillStyle = '#241430'; // many long legs
    ctx.fillRect(s * 0.12, s * 0.44, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.08, s * 0.32, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.76, s * 0.44, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.8, s * 0.32, s * 0.12, s * 0.05);
    ctx.fillStyle = '#2a1a36'; // bald horror head
    ctx.fillRect(s * 0.38, s * 0.16, s * 0.24, s * 0.18);
    ctx.fillStyle = '#c050d0'; // glaring violet eyes
    ctx.fillRect(s * 0.42, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillStyle = '#181222'; // thread of pure gloom silk
    ctx.fillRect(s * 0.2, s * 0.7, s * 0.6, s * 0.02);
    ctx.fillStyle = '#5a2a7a'; // hanging strand glints
    ctx.fillRect(s * 0.28, s * 0.68, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.48, s * 0.68, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.68, s * 0.68, s * 0.03, s * 0.06);
  }

  private drawDireWasp(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // dagger-striped hunter trailing old-bruise venom
    ctx.fillStyle = flash || '#20222a'; // narrow dark abdomen
    ctx.fillRect(s * 0.42, s * 0.36, s * 0.2, s * 0.24);
    ctx.fillStyle = '#f0c030'; // hazard yellow stripes
    ctx.fillRect(s * 0.42, s * 0.42, s * 0.2, s * 0.05);
    ctx.fillRect(s * 0.42, s * 0.52, s * 0.2, s * 0.05);
    ctx.fillStyle = '#181820'; // gripping legs
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.5, s * 0.05, s * 0.06);
    ctx.fillStyle = '#181820'; // folded translucent wings
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.2, s * 0.14);
    ctx.fillRect(s * 0.64, s * 0.3, s * 0.2, s * 0.14);
    ctx.fillStyle = '#f0c030'; // flat determined head
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.2, s * 0.12);
    ctx.fillStyle = '#c02020'; // unblinking red eyes
    ctx.fillRect(s * 0.42, s * 0.28, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.28, s * 0.05, s * 0.04);
    ctx.fillStyle = '#503058'; // trailing venom sting
    ctx.fillRect(s * 0.56, s * 0.6, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.58, s * 0.72, s * 0.03, s * 0.06);
  }

  private drawGazer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // bobbing beholder offshoot with one wide eye
    ctx.fillStyle = flash || '#7a6a5a'; // plump leathery body
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.3);
    ctx.fillStyle = '#5d4f42'; // central shading
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.2, s * 0.14);
    ctx.fillStyle = '#e8e8e8'; // great glistening single eye
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.2, s * 0.2);
    ctx.fillStyle = '#241820'; // huge beholder-style pupil
    ctx.fillRect(s * 0.45, s * 0.36, s * 0.1, s * 0.1);
    ctx.fillStyle = '#d8d8d8'; // wide grinning needle mouth
    ctx.fillRect(s * 0.4, s * 0.52, s * 0.2, s * 0.04);
    ctx.fillStyle = '#e8e8e8'; // tiny stalk teeth
    ctx.fillRect(s * 0.42, s * 0.56, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.5, s * 0.56, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.58, s * 0.56, s * 0.03, s * 0.03);
    ctx.fillStyle = '#5d4f42'; // little eyestalk nubs
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.68, s * 0.34, s * 0.08, s * 0.05);
  }

  private drawWyrmlingGreen(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // scaly venomed hatchling with coiled long neck
    ctx.fillStyle = flash || '#3f8a47'; // compact young wyrm coils
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.34, s * 0.3);
    ctx.fillStyle = '#2c6733'; // scale plate rings
    ctx.fillRect(s * 0.32, s * 0.38, s * 0.3, s * 0.06);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.3, s * 0.06);
    ctx.fillStyle = '#2a5630'; // folding neck raised
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.16, s * 0.14);
    ctx.fillStyle = '#3f8a47'; // leafy horned head
    ctx.fillRect(s * 0.66, s * 0.16, s * 0.22, s * 0.16);
    ctx.fillStyle = '#2c6733'; // leaf ridge crest
    ctx.fillRect(s * 0.7, s * 0.1, s * 0.14, s * 0.07);
    ctx.fillStyle = '#d8d0a0'; // cruel split-slit eyes
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = '#1a4a20'; // acid dripping fang
    ctx.fillRect(s * 0.8, s * 0.24, s * 0.03, s * 0.08);
  }

  private drawWyrmlingBlack(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sleek wet acid-mud hatchling
    ctx.fillStyle = flash || '#2c3330'; // wet sinuous body
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.36, s * 0.26);
    ctx.fillStyle = '#1c221f'; // curved tail coil
    ctx.fillRect(s * 0.5, s * 0.52, s * 0.24, s * 0.14);
    ctx.fillStyle = '#262e2a'; // long sargasso neck
    ctx.fillRect(s * 0.6, s * 0.24, s * 0.14, s * 0.14);
    ctx.fillStyle = '#2c3330'; // narrow crested head
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.2, s * 0.16);
    ctx.fillStyle = '#18201c'; // forward hook horns
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.84, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillStyle = '#d8d020'; // hot acid-pale eyes
    ctx.fillRect(s * 0.74, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.82, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = '#5a7a30'; // dripping acid gob
    ctx.fillRect(s * 0.78, s * 0.28, s * 0.05, s * 0.12);
  }

  private drawWyrmlingBlue(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // spade-crested desert hatchling that crackles
    ctx.fillStyle = flash || '#4a6a8a'; // angular blue body
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.34, s * 0.28);
    ctx.fillStyle = '#35506d'; // side scale ridges
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.3, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.55, s * 0.3, s * 0.05);
    ctx.fillStyle = '#4a6a8a'; // blocky back-bent neck
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.2, s * 0.16);
    ctx.fillStyle = '#5a84ad'; // angular spade head
    ctx.fillRect(s * 0.68, s * 0.14, s * 0.22, s * 0.14);
    ctx.fillStyle = '#35506d'; // jutting spade crest
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.16, s * 0.08);
    ctx.fillStyle = '#f0d030'; // crackling lightning eyes
    ctx.fillRect(s * 0.72, s * 0.18, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.8, s * 0.18, s * 0.04, s * 0.03);
    ctx.fillStyle = '#d0e0ff'; // live spark arcs
    ctx.fillRect(s * 0.9, s * 0.08, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.94, s * 0.14, s * 0.03, s * 0.08);
  }

  private drawWyrmlingEmerald(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // gem-eyed cave hatchling with verdant ore veins
    ctx.fillStyle = flash || '#3a8a52'; // slightly darker young wyrm
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.34, s * 0.3);
    ctx.fillStyle = '#2e6e40'; // plate rings
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.3, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.54, s * 0.3, s * 0.05);
    ctx.fillStyle = '#2a5c34'; // thick branching neck
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.16, s * 0.16);
    ctx.fillStyle = '#3a8a52'; // gem-capped head
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.2, s * 0.18);
    ctx.fillStyle = '#1a4a26'; // crystal horn ridges
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.83, s * 0.1, s * 0.05, s * 0.08);
    ctx.fillStyle = '#40ffa0'; // gem-green psionic eyes
    ctx.fillRect(s * 0.74, s * 0.22, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.82, s * 0.22, s * 0.04, s * 0.05);
    ctx.fillStyle = '#5a9a64'; // ore-vein scale glints
    ctx.fillRect(s * 0.36, s * 0.36, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.56, s * 0.04, s * 0.04);
  }

  private drawWyrmlingSapphire(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // azure hatchling with psionic drilling gaze
    ctx.fillStyle = flash || '#2a4a7a'; // deep azure body
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.34, s * 0.28);
    ctx.fillStyle = '#1e3a60'; // plate rings
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.3, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.55, s * 0.3, s * 0.05);
    ctx.fillStyle = '#2a4a7a'; // broad armored neck
    ctx.fillRect(s * 0.58, s * 0.24, s * 0.18, s * 0.14);
    ctx.fillStyle = '#2a5a9a'; // drill-crowned head
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.2, s * 0.16);
    ctx.fillStyle = '#182c4a'; // faceted head ridges
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.82, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillStyle = '#40b0ff'; // piercing psionic blue eyes
    ctx.fillRect(s * 0.74, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.82, s * 0.18, s * 0.04, s * 0.04);
    ctx.fillStyle = '#80d0ff'; // psionic drill energy
    ctx.fillRect(s * 0.9, s * 0.2, s * 0.05, s * 0.04);
  }

  private drawWyrmlingTopaz(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // honey-gold hatchling wreathed in brine
    ctx.fillStyle = flash || '#b07a30'; // sun-honey body
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.34, s * 0.28);
    ctx.fillStyle = '#8a5a20'; // plate rings
    ctx.fillRect(s * 0.32, s * 0.42, s * 0.3, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.55, s * 0.3, s * 0.05);
    ctx.fillStyle = '#b07a30'; // swaying brine neck
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.16, s * 0.16);
    ctx.fillStyle = '#d09048'; // flat golden head
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.2, s * 0.16);
    ctx.fillStyle = '#9a6a28'; // jutting fin ears
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.82, s * 0.1, s * 0.06, s * 0.08);
    ctx.fillStyle = '#c03030'; // warning amber eyes
    ctx.fillRect(s * 0.74, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.82, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = '#9fd0d8'; // hissing gleam of brine
    ctx.fillRect(s * 0.2, s * 0.56, s * 0.08, s * 0.05);
  }

  private drawYoungBrassDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sun-bright wyrm of the dunes, laughing furnace
    ctx.fillStyle = flash || '#c8a04a'; // burnished brass coils
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.4, s * 0.3);
    ctx.fillStyle = '#9a782e'; // belly plate seams
    ctx.fillRect(s * 0.28, s * 0.44, s * 0.32, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.58, s * 0.32, s * 0.05);
    ctx.fillStyle = '#c8a04a'; // long serpentine neck
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.2, s * 0.16);
    ctx.fillStyle = '#e0b85a'; // angular brass head
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.24, s * 0.18);
    ctx.fillStyle = '#9a782e'; // back-swept fins
    ctx.fillRect(s * 0.7, s * 0.06, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.84, s * 0.06, s * 0.08, s * 0.08);
    ctx.fillStyle = '#3a2c10'; // bright laughing eyes
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.82, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f0a020'; // furnace heat glow
    ctx.fillRect(s * 0.9, s * 0.06, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.94, s * 0.12, s * 0.03, s * 0.08);
  }

  private drawYoungBronzeDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // restlessly noble surf-wyrm of brass lightning
    ctx.fillStyle = flash || '#5a7a5a'; // deep bronze-green coils
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.42, s * 0.3);
    ctx.fillStyle = '#3d563d'; // rib seam bands
    ctx.fillRect(s * 0.28, s * 0.44, s * 0.34, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.58, s * 0.34, s * 0.05);
    ctx.fillStyle = '#5a7a5a'; // strong finned neck
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.2, s * 0.18);
    ctx.fillStyle = '#5a8a6a'; // bronze horned head
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.24, s * 0.2);
    ctx.fillStyle = '#3d563d'; // twin ceremonial horns
    ctx.fillRect(s * 0.72, s * 0.06, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.85, s * 0.06, s * 0.05, s * 0.08);
    ctx.fillStyle = '#f0c030'; // fierce golden-lit eyes
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f0f0a0'; // branching lightning + surf spray
    ctx.fillRect(s * 0.92, s * 0.06, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.14, s * 0.5, s * 0.06, s * 0.04);
  }

  private drawYoungSilverDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // gleaming almost-white guardian of cold heights
    ctx.fillStyle = flash || '#b8c8d8'; // pale heaving coils
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.42, s * 0.3);
    ctx.fillStyle = '#8fa3b5'; // belly plate seams
    ctx.fillRect(s * 0.28, s * 0.44, s * 0.34, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.58, s * 0.34, s * 0.05);
    ctx.fillStyle = '#b8c8d8'; // sleak arched neck
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.2, s * 0.18);
    ctx.fillStyle = '#d8e4f0'; // regal silver head with proud crest
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.24, s * 0.2);
    ctx.fillStyle = '#8fa3b5'; // forward sweeping crest fins
    ctx.fillRect(s * 0.72, s * 0.06, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.84, s * 0.06, s * 0.08, s * 0.08);
    ctx.fillStyle = '#5a6a7a'; // deep calm trustworthy eyes
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#dcecfc'; // cold frost glow
    ctx.fillRect(s * 0.9, s * 0.06, s * 0.04, s * 0.08);
  }

  private drawYoungGoldDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // radiant wyrm of golden ancestry, banked furnace
    ctx.fillStyle = flash || '#d8a030'; // shimmering gold coils
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.42, s * 0.3);
    ctx.fillStyle = '#a87a1e'; // scale seam bands
    ctx.fillRect(s * 0.28, s * 0.44, s * 0.34, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.58, s * 0.34, s * 0.05);
    ctx.fillStyle = '#d8a030'; // strong golden neck
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.2, s * 0.18);
    ctx.fillStyle = '#f0b846'; // majestic head with regal frill
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.26, s * 0.2);
    ctx.fillStyle = '#a87a1e'; // fan of horned frills
    ctx.fillRect(s * 0.7, s * 0.05, s * 0.05, s * 0.09);
    ctx.fillRect(s * 0.76, s * 0.02, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.82, s * 0.02, s * 0.05, s * 0.12);
    ctx.fillStyle = '#7a4a08'; // noble fire-lit eyes
    ctx.fillRect(s * 0.72, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.82, s * 0.16, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f08020'; // banked flame glow
    ctx.fillRect(s * 0.92, s * 0.08, s * 0.04, s * 0.08);
  }

  private drawAdultCrystalDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // refracted glitter-frost wyrm with razor-splinter breath
    ctx.fillStyle = flash || '#c8d8e0'; // frost-white lithe coils
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.46, s * 0.32);
    ctx.fillStyle = '#9ab2c0'; // facet glow seams
    ctx.fillRect(s * 0.26, s * 0.42, s * 0.38, s * 0.05);
    ctx.fillRect(s * 0.26, s * 0.56, s * 0.38, s * 0.05);
    ctx.fillStyle = '#c8d8e0'; // arched crystalline neck
    ctx.fillRect(s * 0.58, s * 0.18, s * 0.22, s * 0.18);
    ctx.fillStyle = '#e8f4fc'; // dazzling faceted head
    ctx.fillRect(s * 0.7, s * 0.1, s * 0.24, s * 0.18);
    ctx.fillStyle = '#8fb2c4'; // crystal shard frills
    ctx.fillRect(s * 0.72, s * 0.04, s * 0.05, s * 0.08);
    ctx.fillRect(s * 0.84, s * 0.06, s * 0.05, s * 0.08);
    ctx.fillStyle = '#7090a0'; // brilliant opaque eyes
    ctx.fillRect(s * 0.74, s * 0.14, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.84, s * 0.14, s * 0.04, s * 0.05);
    ctx.fillStyle = '#d0ecfc'; // scattered gleam fragments
    ctx.fillRect(s * 0.16, s * 0.36, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.82, s * 0.3, s * 0.04, s * 0.04);
  }

  private drawAdultBrassDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sun-drunk elder of glowing wastes
    ctx.fillStyle = flash || '#b8922e'; // immense burnished coils
    ctx.fillRect(s * 0.2, s * 0.32, s * 0.5, s * 0.34);
    ctx.fillStyle = '#8a6a1e'; // rutted plate seams
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.42, s * 0.05);
    ctx.fillRect(s * 0.24, s * 0.56, s * 0.42, s * 0.05);
    ctx.fillStyle = '#b8922e'; // broad warm neck
    ctx.fillRect(s * 0.58, s * 0.14, s * 0.24, s * 0.2);
    ctx.fillStyle = '#d8b03a'; // wise laughing brass head
    ctx.fillRect(s * 0.72, s * 0.08, s * 0.24, s * 0.2);
    ctx.fillStyle = '#8a6a1e'; // wavy brass crest fins
    ctx.fillRect(s * 0.72, s * 0.02, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.86, s * 0.02, s * 0.06, s * 0.08);
    ctx.fillStyle = '#3a2808'; // knowing amber eyes
    ctx.fillRect(s * 0.76, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.86, s * 0.12, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e07020'; // furnace roar plume
    ctx.fillRect(s * 0.9, s * 0.04, s * 0.05, s * 0.1);
    ctx.fillRect(s * 0.94, s * 0.12, s * 0.04, s * 0.12);
  }

  private drawAdultCopperDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // playful acrobatic wyrm of hilltops and laughter
    ctx.fillStyle = flash || '#b86a38'; // rich copper coils
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.5, s * 0.32);
    ctx.fillStyle = '#8a4a24'; // facet plate seams
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.42, s * 0.05);
    ctx.fillRect(s * 0.24, s * 0.58, s * 0.42, s * 0.05);
    ctx.fillStyle = '#b86a38'; // lithe twisting neck
    ctx.fillRect(s * 0.58, s * 0.16, s * 0.24, s * 0.2);
    ctx.fillStyle = '#c87c42'; // prankish copper head
    ctx.fillRect(s * 0.72, s * 0.1, s * 0.24, s * 0.2);
    ctx.fillStyle = '#8a4a24'; // jaunty back crest
    ctx.fillRect(s * 0.74, s * 0.04, s * 0.08, s * 0.08);
    ctx.fillStyle = '#3a2810'; // witty tawny eyes
    ctx.fillRect(s * 0.76, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.86, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#9ab050'; // slow acid gleam drips
    ctx.fillRect(s * 0.18, s * 0.4, s * 0.04, s * 0.08);
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

  private drawVelociraptor(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // sickle-clawed jungle hunter darting sideways
    ctx.fillStyle = flash || '#7a6a3a'; // lean feathered body
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.4, s * 0.24);
    ctx.fillStyle = '#5d5030'; // feather texture bars
    ctx.fillRect(s * 0.28, s * 0.44, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.44, s * 0.44, s * 0.06, s * 0.16);
    ctx.fillStyle = '#6a5a32'; // raised keeled head
    ctx.fillRect(s * 0.58, s * 0.3, s * 0.24, s * 0.18);
    ctx.fillStyle = '#d8d060'; // keen yellow eye
    ctx.fillRect(s * 0.68, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillStyle = '#4a3a20'; // narrow snout + saw teeth
    ctx.fillRect(s * 0.7, s * 0.42, s * 0.12, s * 0.04);
    ctx.fillStyle = '#2c2010'; // huge killing sickle claw
    ctx.fillRect(s * 0.5, s * 0.64, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.56, s * 0.7, s * 0.05, s * 0.08);
    ctx.fillStyle = '#4a3a20'; // long legs
    ctx.fillRect(s * 0.3, s * 0.64, s * 0.05, s * 0.14);
    ctx.fillRect(s * 0.46, s * 0.64, s * 0.05, s * 0.14);
  }

  private drawPteranodon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // soaring winged reptile on a great kite-sail of skin
    ctx.fillStyle = flash || '#8a8a96'; // slender feathered-less body
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.2, s * 0.2);
    ctx.fillStyle = '#6a6a78'; // deeper belly shade
    ctx.fillRect(s * 0.4, s * 0.44, s * 0.2, s * 0.08);
    ctx.fillStyle = '#a8b0ba'; // spread kite-sail wings
    ctx.fillRect(s * 0.1, s * 0.26, s * 0.28, s * 0.14);
    ctx.fillRect(s * 0.62, s * 0.26, s * 0.28, s * 0.14);
    ctx.fillStyle = '#c8d0d8'; // wing membrane shimmer
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.1, s * 0.04);
    ctx.fillRect(s * 0.74, s * 0.3, s * 0.1, s * 0.04);
    ctx.fillStyle = '#8a8a96'; // small sharp head
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.22, s * 0.12);
    ctx.fillStyle = '#d8b058'; // long pointed crest
    ctx.fillRect(s * 0.58, s * 0.16, s * 0.14, s * 0.06);
    ctx.fillStyle = '#c05030'; // fish-plucking beak tip
    ctx.fillRect(s * 0.72, s * 0.26, s * 0.06, s * 0.05);
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

  private drawNecromancer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // gaunt master of the dead reading final syllables
    ctx.fillStyle = flash || '#3a2c3a'; // tattered grave-robe
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.36);
    ctx.fillStyle = '#271f2b'; // deepening hem shadow
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.06);
    ctx.fillStyle = '#4a3850'; // emaciated face under cowl
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.22);
    ctx.fillStyle = '#1a1420'; // cowl shadow
    ctx.fillRect(s * 0.32, s * 0.12, s * 0.36, s * 0.14);
    ctx.fillStyle = '#c03040'; // pin-prick red eyes
    ctx.fillRect(s * 0.42, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#2c2230'; // leaf-veined death grin
    ctx.fillRect(s * 0.44, s * 0.32, s * 0.12, s * 0.02);
    ctx.fillStyle = '#6a4a3a'; // rattle of finger bones
    ctx.fillRect(s * 0.68, s * 0.4, s * 0.08, s * 0.16);
    ctx.fillStyle = '#b04050'; // necrotic pulsing hand
    ctx.fillRect(s * 0.7, s * 0.34, s * 0.06, s * 0.08);
    ctx.fillStyle = '#405030'; // soil-lord skull-staff
    ctx.fillRect(s * 0.12, s * 0.16, s * 0.04, s * 0.4);
  }

  private drawGargoyleLord(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // stone-winged warden of high ledges and cursed keeps
    ctx.fillStyle = flash || '#7a6f66'; // squat stone torso
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.34);
    ctx.fillStyle = '#5d534b'; // weathered masonry cracks
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.2, s * 0.04);
    ctx.fillRect(s * 0.5, s * 0.54, s * 0.16, s * 0.04);
    ctx.fillStyle = '#857a70'; // worn stony head
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.22);
    ctx.fillStyle = '#423a34'; // fearsome sneer
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.12, s * 0.03);
    ctx.fillStyle = '#4a3a30'; // hooked stone-horns
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.1, s * 0.08, s * 0.1);
    ctx.fillStyle = '#c0b8ac'; // glaring stone-white eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.55, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#6a5f56'; // folded stone wings
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.14, s * 0.3);
    ctx.fillRect(s * 0.72, s * 0.3, s * 0.14, s * 0.3);
    ctx.fillStyle = '#575a5a'; // cracked wing-finger tips
    ctx.fillRect(s * 0.14, s * 0.56, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.8, s * 0.56, s * 0.06, s * 0.06);
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
    // squat sail-blessed saurian with a great back-fan
    ctx.fillStyle = flash || '#6a5436'; // low heavy body
    ctx.fillRect(s * 0.2, s * 0.44, s * 0.52, s * 0.2);
    ctx.fillStyle = '#c05830'; // enormous red sail-fin
    ctx.beginPath();
    ctx.moveTo(s * 0.28, s * 0.44);
    ctx.lineTo(s * 0.4, s * 0.12);
    ctx.lineTo(s * 0.52, s * 0.3);
    ctx.lineTo(s * 0.62, s * 0.16);
    ctx.lineTo(s * 0.7, s * 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e88452'; // sail ribs
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.04, s * 0.14);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.04, s * 0.12);
    ctx.fillStyle = '#6a5436'; // gator-jaw head
    ctx.fillRect(s * 0.66, s * 0.4, s * 0.22, s * 0.14);
    ctx.fillStyle = '#3a2a14'; // irritably glaring eye
    ctx.fillRect(s * 0.76, s * 0.42, s * 0.04, s * 0.04);
    ctx.fillStyle = '#2c1a0a'; // startle-snapping jaw
    ctx.fillRect(s * 0.7, s * 0.52, s * 0.18, s * 0.03);
  }

  private drawPlesiosaurus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // long-necked sea reptile paddling icy tides
    ctx.fillStyle = flash || '#5a7a8a'; // broad flippered hull body
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.4, s * 0.22);
    ctx.fillStyle = '#46626e'; // belly keel
    ctx.fillRect(s * 0.24, s * 0.54, s * 0.32, s * 0.06);
    ctx.fillStyle = '#5a7a8a'; // enormously long serpent neck
    ctx.fillRect(s * 0.58, s * 0.28, s * 0.22, s * 0.14);
    ctx.fillRect(s * 0.78, s * 0.2, s * 0.18, s * 0.12);
    ctx.fillStyle = '#5a7a8a'; // small bobbing head
    ctx.fillRect(s * 0.92, s * 0.16, s * 0.06, s * 0.1);
    ctx.fillStyle = '#1a2a32'; // narrow surface-gazing eye
    ctx.fillRect(s * 0.94, s * 0.2, s * 0.02, s * 0.03);
    ctx.fillStyle = '#4a5f6a'; // great flippers
    ctx.fillRect(s * 0.16, s * 0.5, s * 0.14, s * 0.12);
    ctx.fillRect(s * 0.6, s * 0.5, s * 0.14, s * 0.12);
    ctx.fillStyle = '#6a8a9a'; // trailing wake droplets
    ctx.fillRect(s * 0.12, s * 0.62, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.3, s * 0.64, s * 0.04, s * 0.04);
  }

  private drawDireCrocodile(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // mountain-old scarred river terror with death-roll lunge
    ctx.fillStyle = flash || '#4a5a3a'; // knotted ancient hide
    ctx.fillRect(s * 0.16, s * 0.42, s * 0.56, s * 0.22);
    ctx.fillStyle = '#35432a'; // scar pocks and ridge
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.16, s * 0.16);
    ctx.fillRect(s * 0.5, s * 0.5, s * 0.14, s * 0.12);
    ctx.fillStyle = '#3a4a2c'; // scarred broad head
    ctx.fillRect(s * 0.68, s * 0.34, s * 0.2, s * 0.16);
    ctx.fillStyle = '#2e3c20'; // gnarled knob eyes
    ctx.fillRect(s * 0.7, s * 0.36, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.78, s * 0.36, s * 0.04, s * 0.05);
    ctx.fillStyle = '#18240e'; // hideous tooth line
    ctx.fillRect(s * 0.68, s * 0.46, s * 0.18, s * 0.03);
    ctx.fillStyle = '#d8d8d8'; // great ivory croc teeth
    ctx.fillRect(s * 0.76, s * 0.5, s * 0.02, s * 0.05);
    ctx.fillRect(s * 0.82, s * 0.5, s * 0.02, s * 0.05);
    ctx.fillStyle = '#2c381e'; // paddle legs
    ctx.fillRect(s * 0.24, s * 0.64, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.52, s * 0.64, s * 0.1, s * 0.08);
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
    // psychic wyrm of the buried dark, oil-slicked obsidian
    ctx.fillStyle = flash || '#262a2e'; // sleek obsidian coils
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.42, s * 0.32);
    ctx.fillStyle = '#1d2023'; // scale plate seams
    ctx.fillRect(s * 0.28, s * 0.42, s * 0.34, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.56, s * 0.34, s * 0.05);
    ctx.fillStyle = '#262a2e'; // arching psychic neck
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.2, s * 0.18);
    ctx.fillStyle = '#30363c'; // sleek burrower head
    ctx.fillRect(s * 0.7, s * 0.12, s * 0.22, s * 0.2);
    ctx.fillStyle = '#c040ff'; // curdling psychic eyes
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.84, s * 0.16, s * 0.04, s * 0.05);
    ctx.fillStyle = '#a040e0'; // soft psionic hum aura
    ctx.fillRect(s * 0.92, s * 0.06, s * 0.04, s * 0.1);
    ctx.fillStyle = '#1a1d20'; // burrowing digits
    ctx.fillRect(s * 0.2, s * 0.66, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.66, s * 0.1, s * 0.08);
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

  private drawBaphomet(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // horned Huntmaster of the Abyss, flame-swallowing axe
    ctx.fillStyle = flash || '#6a5a72'; // towering bestial frame
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.48, s * 0.36);
    ctx.fillStyle = '#4a3d52'; // scarred hide band
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.4, s * 0.06);
    ctx.fillStyle = '#7a5a7a'; // great stag-mane head with beard
    ctx.fillRect(s * 0.3, s * 0.16, s * 0.4, s * 0.24);
    ctx.fillStyle = '#d8c8a0'; // huge bone-white antler crown
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.38, s * 0.06, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.58, s * 0.08, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.64, s * 0.06, s * 0.12, s * 0.12);
    ctx.fillStyle = '#c04030'; // blood-hunt eyes
    ctx.fillRect(s * 0.36, s * 0.22, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.08, s * 0.05);
    ctx.fillStyle = '#c8a04a'; // curved steel hooves
    ctx.fillRect(s * 0.4, s * 0.68, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.68, s * 0.08, s * 0.1);
    ctx.fillStyle = '#5a3a20'; // great flame-licking greataxe
    ctx.fillRect(s * 0.72, s * 0.12, s * 0.08, s * 0.56);
    ctx.fillStyle = '#f08020'; // tearing flame aura
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.04, s * 0.08);
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.04, s * 0.06);
  }

  private drawJuiblex(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // resurgent tide of black-green ooze with many mouths
    ctx.fillStyle = flash || '#2c3a1e'; // heaving gelatinous mass
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.3);
    ctx.lineTo(s * 0.8, s * 0.3);
    ctx.lineTo(s * 0.74, s * 0.66);
    ctx.lineTo(s * 0.26, s * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1c2812'; // suspended legions of mouths
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.12, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.42, s * 0.12, s * 0.08);
    ctx.fillStyle = '#3d5227'; // repelling small eyes
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.38, s * 0.05, s * 0.04);
    ctx.fillStyle = '#60782f'; // acid-dissolving glints
    ctx.fillRect(s * 0.48, s * 0.52, s * 0.05, s * 0.04);
    ctx.fillStyle = '#8aa948'; // newborn bile seeping
    ctx.fillRect(s * 0.42, s * 0.6, s * 0.14, s * 0.05);
  }

  private drawZuggtmoy(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // terrible rose-mycelium queen with gravity-caps
    ctx.fillStyle = flash || '#8a3050'; // rose-fleshed fungal crown
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.32, s * 0.24);
    ctx.fillStyle = '#c05876'; // spore-rose petal crest
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.4, s * 0.1);
    ctx.fillRect(s * 0.26, s * 0.06, s * 0.2, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.06, s * 0.2, s * 0.1);
    ctx.fillStyle = '#7a2844'; // honey of rot eyes
    ctx.fillRect(s * 0.38, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillStyle = '#6a1e36'; // weeping spore mouth
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.12, s * 0.05);
    ctx.fillStyle = '#5a2032'; // mycelial fungal body
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.44, s * 0.32);
    ctx.fillStyle = '#9a4a6a'; // bursting spores
    ctx.fillRect(s * 0.18, s * 0.42, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.4, s * 0.05, s * 0.05);
  }

  private drawGrazzt(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // handsome towering seducer of the Abyss
    ctx.fillStyle = flash || '#3a444a'; // fitted dark coat
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.38);
    ctx.fillStyle = '#283036'; // fine dark trim
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.54, s * 0.4, s * 0.05);
    ctx.fillStyle = '#4a5660'; // dark but beautiful face
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.24);
    ctx.fillStyle = '#c83048'; // velvet imploring eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.04);
    ctx.fillStyle = '#20262a'; // six-fingered graceful hand
    ctx.fillRect(s * 0.66, s * 0.46, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.72, s * 0.42, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.74, s * 0.48, s * 0.03, s * 0.06);
    ctx.fillStyle = '#1c2226'; // long ears curling down
    ctx.fillRect(s * 0.28, s * 0.24, s * 0.06, s * 0.14);
    ctx.fillRect(s * 0.66, s * 0.24, s * 0.06, s * 0.14);
  }

  private drawFrazUrbluu(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // many-faced prince of lies, mirror-light delusion
    ctx.fillStyle = flash || '#5a3a6a'; // arching assured frame
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.48, s * 0.36);
    ctx.fillStyle = '#3c2548'; // parting sheen
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.44, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.54, s * 0.44, s * 0.05);
    ctx.fillStyle = '#6a4a7a'; // elegant bearded face
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.36, s * 0.24);
    ctx.fillStyle = '#c03050'; // playful-corrupting eyes
    ctx.fillRect(s * 0.38, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillStyle = '#80588c'; // many-hooded wings
    ctx.fillRect(s * 0.16, s * 0.28, s * 0.12, s * 0.28);
    ctx.fillRect(s * 0.72, s * 0.28, s * 0.12, s * 0.28);
    ctx.fillStyle = '#482a54'; // mirror-shard crown
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.44, s * 0.04, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.04, s * 0.06, s * 0.12);
    ctx.fillRect(s * 0.64, s * 0.06, s * 0.06, s * 0.1);
  }

  private drawMalcanthet(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // last daughter of a dead moon, wings of ruin
    ctx.fillStyle = flash || '#7a3868'; // impossible composed gown
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.38);
    ctx.fillStyle = '#5c2950'; // slit violet sheen
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillStyle = '#c8a8c8'; // luminous flawless face
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.28, s * 0.22);
    ctx.fillStyle = '#f0e8f0'; // voice-that-kneels eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.05, s * 0.05);
    ctx.fillStyle = '#4a2a44'; // wide feather-violet wings
    ctx.fillRect(s * 0.1, s * 0.24, s * 0.2, s * 0.28);
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.2, s * 0.28);
    ctx.fillStyle = '#8a4a70'; // slowly veering halo
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.2, s * 0.05);
    ctx.fillRect(s * 0.46, s * 0.04, s * 0.08, s * 0.05);
  }

  private drawKostchtchie(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // mountain-sized weight of cold rage crowned in frost
    ctx.fillStyle = flash || '#8a8a9c'; // colossal frost-wrapped bulk
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.4);
    ctx.fillStyle = '#6a6a7c'; // fur-lined plate band
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.44, s * 0.06);
    ctx.fillStyle = '#a8a8bc'; // grim diademed head
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.4, s * 0.24);
    ctx.fillStyle = '#d8e8f0'; // huge antler-flake crown
    ctx.fillRect(s * 0.3, s * 0.04, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.5, s * 0.04, s * 0.08, s * 0.12);
    ctx.fillStyle = '#c04030'; // molten-glinting rage eyes
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.08, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.08, s * 0.06);
    ctx.fillStyle = '#6a6a7c'; // iron-fisted weapon hand
    ctx.fillRect(s * 0.7, s * 0.2, s * 0.1, s * 0.12);
    ctx.fillStyle = '#d8d8e8'; // white-forged greatclub spikes
    ctx.fillRect(s * 0.66, s * 0.12, s * 0.08, s * 0.12);
  }

  private drawYeenoghu(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // gnoll-god of hunger loping on four crooked paws
    ctx.fillStyle = flash || '#b87438'; // shaggy hulking gnoll-lord
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.56, s * 0.34);
    ctx.fillStyle = '#8f5730'; // dirt-seamed fur
    ctx.fillRect(s * 0.24, s * 0.42, s * 0.48, s * 0.06);
    ctx.fillStyle = '#a86230'; // great snarling hyena head
    ctx.fillRect(s * 0.54, s * 0.18, s * 0.36, s * 0.24);
    ctx.fillStyle = '#7a3a1c'; // hackle of rage mane
    ctx.fillRect(s * 0.5, s * 0.28, s * 0.1, s * 0.12);
    ctx.fillStyle = '#f2e064'; // fever-dart eyes
    ctx.fillRect(s * 0.6, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.76, s * 0.24, s * 0.06, s * 0.05);
    ctx.fillStyle = '#e8e8d8'; // tusked rending jaws
    ctx.fillRect(s * 0.68, s * 0.38, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.8, s * 0.38, s * 0.05, s * 0.06);
    ctx.fillStyle = '#8f5730'; // four crooked loping legs
    ctx.fillRect(s * 0.24, s * 0.68, s * 0.1, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.68, s * 0.1, s * 0.1);
    ctx.fillStyle = '#a86230'; // ridged crust-back
    ctx.fillRect(s * 0.28, s * 0.66, s * 0.2, s * 0.06);
  }

  private drawDemogorgon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // two-headed ape-god of ruin, howling palindrome
    ctx.fillStyle = flash || '#5a6a3a'; // colossal simian trunk
    ctx.fillRect(s * 0.2, s * 0.3, s * 0.6, s * 0.4);
    ctx.fillStyle = '#45532c'; // pelt folds
    ctx.fillRect(s * 0.24, s * 0.38, s * 0.52, s * 0.06);
    ctx.fillRect(s * 0.24, s * 0.52, s * 0.52, s * 0.06);
    ctx.fillStyle = '#5a6a3a'; // two-targeted twin heads
    ctx.fillRect(s * 0.3, s * 0.12, s * 0.18, s * 0.2);
    ctx.fillRect(s * 0.52, s * 0.12, s * 0.18, s * 0.2);
    ctx.fillStyle = '#c84030'; // both fanged maws
    ctx.fillRect(s * 0.32, s * 0.28, s * 0.14, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.28, s * 0.14, s * 0.05);
    ctx.fillStyle = '#e8e8d8'; // mastiff-ape dog teeth
    ctx.fillRect(s * 0.34, s * 0.26, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.03, s * 0.05);
    ctx.fillStyle = '#3a4624'; // writhing tentacle pair for arms
    ctx.fillRect(s * 0.1, s * 0.34, s * 0.1, s * 0.22);
    ctx.fillRect(s * 0.8, s * 0.34, s * 0.1, s * 0.22);
    ctx.fillStyle = '#2a3418'; // grasping tendril tips
    ctx.fillRect(s * 0.1, s * 0.56, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.82, s * 0.56, s * 0.08, s * 0.08);
  }

  private drawOrcus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // bloated goat-skulled lich-god of the grave
    ctx.fillStyle = flash || '#2c2028'; // ponderous shrouded bulk
    ctx.fillRect(s * 0.24, s * 0.34, s * 0.52, s * 0.4);
    ctx.fillStyle = '#171018'; // shadow-hewn plates
    ctx.fillRect(s * 0.28, s * 0.42, s * 0.44, s * 0.06);
    ctx.fillRect(s * 0.28, s * 0.56, s * 0.44, s * 0.06);
    ctx.fillStyle = '#d8dce0'; // huge grinning goat-skull
    ctx.fillRect(s * 0.32, s * 0.12, s * 0.36, s * 0.26);
    ctx.fillStyle = '#2a1a26'; // doom-pit rotted eyes
    ctx.fillRect(s * 0.38, s * 0.18, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.06, s * 0.06);
    ctx.fillStyle = '#786a54'; // soul-wand pronged crown
    ctx.fillRect(s * 0.34, s * 0.04, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.44, s * 0.02, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.54, s * 0.02, s * 0.04, s * 0.12);
    ctx.fillRect(s * 0.64, s * 0.04, s * 0.04, s * 0.1);
    ctx.fillStyle = '#8a5a1e'; // mighty soul-wand of bone
    ctx.fillRect(s * 0.78, s * 0.1, s * 0.06, s * 0.5);
    ctx.fillStyle = '#c03040'; // living soul-fire core
    ctx.fillRect(s * 0.76, s * 0.06, s * 0.1, s * 0.08);
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

  private drawZariel(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // once-radiant sword-angel now a burning crusade
    ctx.fillStyle = flash || '#8a3a1a'; // scorched arch-suit
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.48, s * 0.4);
    ctx.fillStyle = '#e8d8a0'; // gilding on the fall
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.05);
    ctx.fillStyle = '#f0d8a8'; // radiant-burnt face
    ctx.fillRect(s * 0.32, s * 0.14, s * 0.36, s * 0.22);
    ctx.fillStyle = '#f0f0d8'; // ash-platinum hair
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.08);
    ctx.fillStyle = '#c03020'; // fire-sealed eyes
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillStyle = '#6a2a14'; // great ruff of cobalt wings
    ctx.fillRect(s * 0.08, s * 0.28, s * 0.16, s * 0.3);
    ctx.fillRect(s * 0.76, s * 0.28, s * 0.16, s * 0.3);
    ctx.fillStyle = '#e0c060'; // burning greatsword of flame
    ctx.fillRect(s * 0.78, s * 0.06, s * 0.06, s * 0.26);
    ctx.fillStyle = '#f0a020'; // roaring flame edge
    ctx.fillRect(s * 0.8, s * 0.02, s * 0.04, s * 0.16);
  }

  private drawBel(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // armored master-armorer of the Blood War; forge-smith
    ctx.fillStyle = flash || '#5a4a3a'; // hulking armored forge-bull
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.48, s * 0.38);
    ctx.fillStyle = '#f0d0a0'; // brass pauldrons
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.14, s * 0.16);
    ctx.fillRect(s * 0.62, s * 0.3, s * 0.14, s * 0.16);
    ctx.fillStyle = '#3a2e22'; // grotesque bull head
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.24);
    ctx.fillStyle = '#f0d8a0'; // sweeping brass horns
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.16, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.08, s * 0.16, s * 0.1);
    ctx.fillStyle = '#c04030'; // forge-ember eyes
    ctx.fillRect(s * 0.36, s * 0.18, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.08, s * 0.05);
    ctx.fillStyle = '#241c12'; // apron of smith-leather
    ctx.fillRect(s * 0.3, s * 0.46, s * 0.4, s * 0.14);
    ctx.fillStyle = '#c84828'; // great war-mallet
    ctx.fillRect(s * 0.7, s * 0.28, s * 0.08, s * 0.3);
  }

  private drawDispater(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // scheming iron-metropol lasher of the Second
    ctx.fillStyle = flash || '#3a3a46'; // lank elegant dark coat
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.44, s * 0.38);
    ctx.fillStyle = '#27272f'; // six-of-iron trim
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.54, s * 0.4, s * 0.05);
    ctx.fillStyle = '#4a4a58'; // correct but cold face
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.22);
    ctx.fillStyle = '#d8c8c0'; // bone-ridged brow
    ctx.fillRect(s * 0.34, s * 0.12, s * 0.32, s * 0.08);
    ctx.fillStyle = '#d84040'; // iron-forged eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#6a4a3a'; // ancient iron staff
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.05, s * 0.4);
    ctx.fillStyle = '#f0d0a0'; // forged crown-perch
    ctx.fillRect(s * 0.68, s * 0.1, s * 0.12, s * 0.1);
  }

  private drawMammon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // greening serpent-lord of the sordid fever-swamp
    ctx.fillStyle = flash || '#6a5a24'; // slow snake-lord torso
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.32);
    ctx.fillStyle = '#4a3e16'; // greened brass pips
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.52, s * 0.36, s * 0.05);
    ctx.fillStyle = '#785f26'; // serpentine miser head
    ctx.fillRect(s * 0.34, s * 0.16, s * 0.32, s * 0.22);
    ctx.fillStyle = '#f0d850'; // coin-jewel crown tiers
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.08, s * 0.08, s * 0.08);
    ctx.fillStyle = '#c8d020'; // hungry green eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillStyle = '#4a4018'; // forked serpent lower
    ctx.fillRect(s * 0.36, s * 0.66, s * 0.28, s * 0.1);
    ctx.fillStyle = '#f0d850'; // grinning gold-bone trinket
    ctx.fillRect(s * 0.72, s * 0.4, s * 0.06, s * 0.06);
  }

  private drawLevistus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // frozen lord of the frozen Fifth, working revenge
    ctx.fillStyle = flash || '#7a94a8'; // glacier-pale princely frame
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.48, s * 0.38);
    ctx.fillStyle = '#546f82'; // rime-seamed court coat
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.44, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.54, s * 0.44, s * 0.05);
    ctx.fillStyle = '#b8cfe0'; // icicle-pale face
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.36, s * 0.24);
    ctx.fillStyle = '#8fb0c4'; // spiked ice crown
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.46, s * 0.06, s * 0.06, s * 0.1);
    ctx.fillRect(s * 0.62, s * 0.1, s * 0.06, s * 0.06);
    ctx.fillStyle = '#284a5a'; // deep-frozen eyes
    ctx.fillRect(s * 0.38, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.06, s * 0.05);
    ctx.fillStyle = '#44667a'; // archaic spear of wet frost
    ctx.fillRect(s * 0.74, s * 0.12, s * 0.05, s * 0.42);
    ctx.fillStyle = '#c0d8e8'; // tearing rime trail
    ctx.fillRect(s * 0.12, s * 0.4, s * 0.14, s * 0.04);
  }

  private drawAsmodeus(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // coiled serpent-crowned architect of all Nine Hells
    ctx.fillStyle = flash || '#2a1320'; // overwhelming dark majesty
    ctx.fillRect(s * 0.26, s * 0.3, s * 0.48, s * 0.4);
    ctx.fillStyle = '#401626'; // infernal krass trim
    ctx.fillRect(s * 0.28, s * 0.36, s * 0.44, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.5, s * 0.44, s * 0.05);
    ctx.fillStyle = '#38243a'; // commanding princely face
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.24);
    ctx.fillStyle = '#1c0e16'; // the toppled ruby crown
    ctx.fillRect(s * 0.28, s * 0.06, s * 0.1, s * 0.08);
    ctx.fillRect(s * 0.62, s * 0.06, s * 0.1, s * 0.08);
    ctx.fillStyle = '#e84048'; // smiling ancient eyes
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillStyle = '#1a0812'; // aware subtle beard
    ctx.fillRect(s * 0.4, s * 0.34, s * 0.2, s * 0.06);
    ctx.fillStyle = '#3c1c30'; // coiled serpent-brood beneath
    ctx.fillRect(s * 0.3, s * 0.64, s * 0.4, s * 0.12);
    ctx.fillStyle = '#c04048'; // judging staff tip
    ctx.fillRect(s * 0.72, s * 0.08, s * 0.06, s * 0.2);
  }

  private drawTiamat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // five-headed queen of evil dragons, chromatic apotheosis
    ctx.fillStyle = flash || '#8a1c1c'; // great crimson bulk
    ctx.fillRect(s * 0.16, s * 0.32, s * 0.68, s * 0.38);
    ctx.fillStyle = '#5c1212'; // scale seam
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.6, s * 0.06);
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.6, s * 0.06);
    ctx.fillStyle = '#c04030'; // first crimson head
    ctx.fillRect(s * 0.1, s * 0.14, s * 0.18, s * 0.2);
    ctx.fillStyle = '#e08020'; // second azure head
    ctx.fillRect(s * 0.3, s * 0.08, s * 0.18, s * 0.2);
    ctx.fillStyle = '#38923e'; // third verdant head
    ctx.fillRect(s * 0.5, s * 0.08, s * 0.18, s * 0.2);
    ctx.fillStyle = '#2c2c38'; // fourth sable head
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.18, s * 0.2);
    ctx.fillStyle = '#eef4f8'; // fifth hoary head
    ctx.fillRect(s * 0.86, s * 0.2, s * 0.1, s * 0.16);
    ctx.fillStyle = '#f0e000'; // blinking chromatic eyes batch
    ctx.fillRect(s * 0.14, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.76, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillStyle = '#f08020'; // burning multi-breath fog
    ctx.fillRect(s * 0.9, s * 0.12, s * 0.06, s * 0.08);
  }

  private drawBahamut(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // platinum king of all good dragons, radiant judge
    ctx.fillStyle = flash || '#c0ccd8'; // great platinum coils
    ctx.fillRect(s * 0.16, s * 0.3, s * 0.68, s * 0.38);
    ctx.fillStyle = '#9db0c0'; // plate seam
    ctx.fillRect(s * 0.2, s * 0.38, s * 0.6, s * 0.06);
    ctx.fillRect(s * 0.2, s * 0.52, s * 0.6, s * 0.06);
    ctx.fillStyle = '#e8f0f6'; // proud single platinum head
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.22, s * 0.24);
    ctx.fillStyle = '#8fa6bc'; // sweeping gentle crest fins
    ctx.fillRect(s * 0.44, s * 0.04, s * 0.05, s * 0.1);
    ctx.fillRect(s * 0.6, s * 0.04, s * 0.05, s * 0.1);
    ctx.fillStyle = '#405a78'; // kind all-seeing eyes
    ctx.fillRect(s * 0.46, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = '#80b0e0'; // merciful cool breath glow
    ctx.fillRect(s * 0.9, s * 0.16, s * 0.06, s * 0.1);
    ctx.fillStyle = '#a0b8c8'; // great silvered wings
    ctx.fillRect(s * 0.04, s * 0.28, s * 0.16, s * 0.3);
    ctx.fillRect(s * 0.8, s * 0.28, s * 0.16, s * 0.3);
  }

  private drawPazuzu(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // screaming many-winged instigator of the high Abyss
    ctx.fillStyle = flash || '#3a2a4a'; // wyvern-invective torso
    ctx.fillRect(s * 0.28, s * 0.32, s * 0.44, s * 0.34);
    ctx.fillStyle = '#282036'; // scale sheen
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.4, s * 0.05);
    ctx.fillStyle = '#4a345a'; // chattering wyvern head
    ctx.fillRect(s * 0.3, s * 0.14, s * 0.4, s * 0.24);
    ctx.fillStyle = '#1c1224'; // jutting short horns
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.6, s * 0.08, s * 0.06, s * 0.08);
    ctx.fillStyle = '#e85030'; // screaming mocking eyes
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.06, s * 0.04);
    ctx.fillStyle = '#4a345a'; // rows of small membranous wings
    ctx.fillRect(s * 0.1, s * 0.3, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.78, s * 0.3, s * 0.12, s * 0.14);
    ctx.fillRect(s * 0.16, s * 0.44, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.74, s * 0.44, s * 0.1, s * 0.12);
    ctx.fillStyle = '#5a3a6a'; // tail quill hails
    ctx.fillRect(s * 0.5, s * 0.64, s * 0.16, s * 0.06);
  }

  private drawOboxob(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // many-pincer old lord of insects and burrow
    ctx.fillStyle = flash || '#6a3a1c'; // chitin-crowned bulk
    ctx.fillRect(s * 0.24, s * 0.32, s * 0.52, s * 0.36);
    ctx.fillStyle = '#4a2610'; // crusty chitin seams
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.44, s * 0.05);
    ctx.fillRect(s * 0.28, s * 0.54, s * 0.44, s * 0.05);
    ctx.fillStyle = '#7d4522'; // beetle-crown head
    ctx.fillRect(s * 0.32, s * 0.16, s * 0.36, s * 0.22);
    ctx.fillStyle = '#4a2610'; // off-armed antler pincers
    ctx.fillRect(s * 0.24, s * 0.12, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.12, s * 0.1, s * 0.12);
    ctx.fillStyle = '#d87020'; // burning chitter eyes
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.06, s * 0.05);
    ctx.fillStyle = '#56301a'; // seething crustace legs
    ctx.fillRect(s * 0.18, s * 0.62, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.34, s * 0.64, s * 0.06, s * 0.16);
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.06, s * 0.16);
  }

  private drawAzaezel(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // molten core-fire of the deep Abyss heart
    ctx.fillStyle = flash || '#a84a14'; // molten roaring-mass
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * 0.3);
    ctx.lineTo(s * 0.8, s * 0.3);
    ctx.lineTo(s * 0.74, s * 0.64);
    ctx.lineTo(s * 0.26, s * 0.64);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e06820'; // lava-vein glow
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.4, s * 0.06);
    ctx.fillRect(s * 0.3, s * 0.52, s * 0.4, s * 0.06);
    ctx.fillStyle = '#c8581c'; // many-forked forge tongues
    ctx.fillRect(s * 0.14, s * 0.34, s * 0.1, s * 0.06);
    ctx.fillRect(s * 0.76, s * 0.34, s * 0.1, s * 0.06);
    ctx.fillStyle = '#f0a030'; // searing primal eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.54, s * 0.22, s * 0.06, s * 0.08);
    ctx.fillStyle = '#d84820'; // erupting vein-gluts
    ctx.fillRect(s * 0.34, s * 0.6, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.58, s * 0.6, s * 0.08, s * 0.1);
    ctx.fillStyle = '#f0f0c0'; // harbinger white-hot core
    ctx.fillRect(s * 0.46, s * 0.42, s * 0.08, s * 0.1);
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

  private drawWerebat(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // silent feary-winged lycanthrope of the chapels
    ctx.fillStyle = flash || '#5a3a2e'; // lean scrawny body
    ctx.fillRect(s * 0.32, s * 0.36, s * 0.36, s * 0.28);
    ctx.fillStyle = '#462e22'; // leather skin
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.32, s * 0.05);
    ctx.fillStyle = '#6a4636'; // sharp bat-rat head
    ctx.fillRect(s * 0.34, s * 0.2, s * 0.32, s * 0.2);
    ctx.fillStyle = '#3a2418'; // bat-wing ears
    ctx.fillRect(s * 0.28, s * 0.18, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.18, s * 0.08, s * 0.08);
    ctx.fillStyle = '#c03020'; // nervous red eyes
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.26, s * 0.05, s * 0.04);
    ctx.fillStyle = '#3a2418'; // great batskin wings
    ctx.fillRect(s * 0.12, s * 0.32, s * 0.18, s * 0.22);
    ctx.fillRect(s * 0.7, s * 0.32, s * 0.18, s * 0.22);
    ctx.fillStyle = '#503020'; // tail fold
    ctx.fillRect(s * 0.56, s * 0.62, s * 0.12, s * 0.06);
  }

  private drawWereratKing(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // plague-crowned monarch of the city's vermin
    ctx.fillStyle = flash || '#6a6a62'; // tattered grey-lean body
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.4, s * 0.34);
    ctx.fillStyle = '#4a4a44'; // dirty finery trim
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillRect(s * 0.32, s * 0.54, s * 0.36, s * 0.05);
    ctx.fillStyle = '#8a8a80'; // long rat-king snout
    ctx.fillRect(s * 0.34, s * 0.18, s * 0.32, s * 0.2);
    ctx.fillStyle = '#c03020'; // plague-ruby eyes
    ctx.fillRect(s * 0.4, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.22, s * 0.05, s * 0.05);
    ctx.fillStyle = '#e8d8c8'; // long crooked vermin fangs
    ctx.fillRect(s * 0.44, s * 0.34, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.34, s * 0.04, s * 0.06);
    ctx.fillStyle = '#5a5a52'; // tattered crown horns
    ctx.fillRect(s * 0.3, s * 0.1, s * 0.06, s * 0.08);
    ctx.fillRect(s * 0.64, s * 0.1, s * 0.06, s * 0.08);
    ctx.fillStyle = '#4a4a44'; // whip of wire tail
    ctx.fillRect(s * 0.6, s * 0.66, s * 0.12, s * 0.03);
  }

  private drawWerewolfAlpha(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // first wolf, silver-maned king of the pack
    ctx.fillStyle = flash || '#8a8a96'; // huge gray-pelted body
    ctx.fillRect(s * 0.2, s * 0.36, s * 0.5, s * 0.3);
    ctx.fillStyle = '#6a6a76'; // slung rib-shadow
    ctx.fillRect(s * 0.24, s * 0.44, s * 0.42, s * 0.06);
    ctx.fillStyle = '#a0a0ac'; // great lupine head
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.28, s * 0.22);
    ctx.fillStyle = '#c8c8d8'; // silver-mane hackle
    ctx.fillRect(s * 0.52, s * 0.26, s * 0.14, s * 0.1);
    ctx.fillStyle = '#f0e0a0'; // moon-bleached eyes
    ctx.fillRect(s * 0.62, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.74, s * 0.26, s * 0.06, s * 0.05);
    ctx.fillStyle = '#e8e8e8'; // long gleaming fangs
    ctx.fillRect(s * 0.66, s * 0.38, s * 0.04, s * 0.07);
    ctx.fillRect(s * 0.76, s * 0.38, s * 0.04, s * 0.07);
    ctx.fillStyle = '#6a6a76'; // powerful haunches
    ctx.fillRect(s * 0.24, s * 0.66, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.5, s * 0.66, s * 0.12, s * 0.12);
  }

  private drawWereshark(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // salt-furred terror with dorsal crest and predator bulk
    ctx.fillStyle = flash || '#4a5a6a'; // salt-gray lean bulk
    ctx.fillRect(s * 0.26, s * 0.36, s * 0.48, s * 0.3);
    ctx.fillStyle = '#39464f'; // wet hide seam
    ctx.fillRect(s * 0.28, s * 0.44, s * 0.44, s * 0.05);
    ctx.fillStyle = '#d8e0e8'; // pale shark under-jaw
    ctx.fillRect(s * 0.28, s * 0.56, s * 0.44, s * 0.06);
    ctx.fillStyle = '#4a5a6a'; // wedge shark-ape head
    ctx.fillRect(s * 0.56, s * 0.2, s * 0.3, s * 0.2);
    ctx.fillStyle = '#2c3842'; // single sliticide eye
    ctx.fillRect(s * 0.7, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#e8e8e8'; // many pointed shark teeth
    ctx.fillRect(s * 0.62, s * 0.36, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.7, s * 0.36, s * 0.03, s * 0.05);
    ctx.fillRect(s * 0.78, s * 0.36, s * 0.03, s * 0.05);
    ctx.fillStyle = '#2c3842'; // dorsal fin
    ctx.beginPath();
    ctx.moveTo(s * 0.4, s * 0.36);
    ctx.lineTo(s * 0.48, s * 0.2);
    ctx.lineTo(s * 0.56, s * 0.36);
    ctx.closePath();
    ctx.fill();
  }

  private drawWeretigerAlpha(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    // striped apex with bracer-claws of moonlight
    ctx.fillStyle = flash || '#c08830'; // strong tawny body
    ctx.fillRect(s * 0.2, s * 0.34, s * 0.5, s * 0.32);
    ctx.fillStyle = '#2a1c0c'; // vertical tiger-stripes
    ctx.fillRect(s * 0.24, s * 0.36, s * 0.05, s * 0.28);
    ctx.fillRect(s * 0.38, s * 0.36, s * 0.05, s * 0.28);
    ctx.fillRect(s * 0.52, s * 0.36, s * 0.05, s * 0.28);
    ctx.fillStyle = '#d8a848'; // broad striped head
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.28, s * 0.2);
    ctx.fillStyle = '#f0e8c0'; // pale fury jowls
    ctx.fillRect(s * 0.64, s * 0.34, s * 0.14, s * 0.05);
    ctx.fillStyle = '#3a2a14'; // cold night-striped eyes
    ctx.fillRect(s * 0.68, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.78, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = '#d8c8a8'; // bracer-claw moon claws
    ctx.fillRect(s * 0.7, s * 0.42, s * 0.04, s * 0.08);
    ctx.fillStyle = '#8a5a20'; // leaping haunches
    ctx.fillRect(s * 0.26, s * 0.66, s * 0.12, s * 0.12);
    ctx.fillRect(s * 0.5, s * 0.66, s * 0.12, s * 0.12);
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

  private drawBoggle(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6b8e23'; // olive slick ooze-fairy
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.18, s * 0.28); // body
    ctx.fillRect(s * 0.28, s * 0.34, s * 0.1, s * 0.14); // left arm up
    ctx.fillRect(s * 0.5, s * 0.34, s * 0.1, s * 0.14); // right arm up
    ctx.fillRect(s * 0.32, s * 0.58, s * 0.1, s * 0.14); // leg
    ctx.fillRect(s * 0.48, s * 0.58, s * 0.1, s * 0.14); // leg
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.16, s * 0.14); // head, overhanging
    ctx.fillStyle = '#fff'; ctx.fillRect(s * 0.62, s * 0.06, s * 0.08, s * 0.06); // goo drip
    ctx.fillStyle = '#e8ffe8'; // bright eyes
    ctx.fillRect(s * 0.4, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.24, s * 0.05, s * 0.04);
    ctx.fillStyle = c; ctx.fillRect(s * 0.41, s * 0.3, s * 0.08, s * 0.06); // smirk mouth
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

  private drawMawDemon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a4a2a'; // toothy gullet
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.34, s * 0.26, s * 0.2); // barrel body
    ctx.fillRect(s * 0.3, s * 0.3, s * 0.34, s * 0.14); // great open maw
    ctx.fillStyle = '#2a1010'; // inside mouth
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.26, s * 0.1);
    ctx.fillStyle = '#f0f0e0'; // teeth
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.56, s * 0.32, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.38, s * 0.38, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.38, s * 0.04, s * 0.06);
    ctx.fillStyle = c; ctx.fillRect(s * 0.28, s * 0.52, s * 0.1, s * 0.1); // front leg
    ctx.fillRect(s * 0.56, s * 0.52, s * 0.1, s * 0.1); // front leg
    ctx.fillStyle = '#d0a050'; ctx.fillRect(s * 0.38, s * 0.3, s * 0.06, s * 0.04); // small piggy eye
    ctx.fillStyle = '#6a3a1a'; ctx.fillRect(s * 0.2, s * 0.5, s * 0.08, s * 0.08); // short tail
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

  private drawBalhannothLurker(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a3a5a'; // planar leech-maw
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.4, s * 0.28, s * 0.2); // mantle body
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.2, s * 0.14); // maw prow
    ctx.fillStyle = '#1a1a2a'; // open throat
    ctx.fillRect(s * 0.4, s * 0.32, s * 0.12, s * 0.1);
    ctx.fillStyle = '#f0e8d0'; // ring teeth
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.04, s * 0.04);
    ctx.fillStyle = c; ctx.fillRect(s * 0.24, s * 0.42, s * 0.1, s * 0.06); // tentacle
    ctx.fillRect(s * 0.58, s * 0.42, s * 0.1, s * 0.06); // tentacle
    ctx.fillStyle = '#8a6a4a'; // barnacles
    ctx.fillRect(s * 0.4, s * 0.5, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.5, s * 0.04, s * 0.04);
    ctx.fillStyle = '#40c0ff'; // lurking glow
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.06, s * 0.04);
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
    const c = flash || '#ffe8a0'; // fey spark
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.4, s * 0.3, s * 0.12, s * 0.14); // flame body
    ctx.fillStyle = '#ffd060'; // inner flame
    ctx.fillRect(s * 0.43, s * 0.34, s * 0.06, s * 0.08);
    ctx.fillStyle = c; ctx.fillRect(s * 0.38, s * 0.2, s * 0.06, s * 0.1); // flame lick
    ctx.fillRect(s * 0.48, s * 0.2, s * 0.06, s * 0.1); // flame lick
    ctx.fillStyle = '#fff';
    ctx.fillRect(s * 0.5, s * 0.28, s * 0.03, s * 0.03); // spore eyelight
    ctx.fillStyle = '#e08a2a'; // halo ring
    ctx.fillRect(s * 0.52, s * 0.42, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.34, s * 0.42, s * 0.06, s * 0.04);
    ctx.fillRect(s * 0.43, s * 0.44, s * 0.06, s * 0.04);
    ctx.fillStyle = '#ffe8a0'; ctx.fillRect(s * 0.3, s * 0.12, s * 0.06, s * 0.08); // drifting motes
    ctx.fillRect(s * 0.58, s * 0.08, s * 0.05, s * 0.06);
  }

  private drawForestWitch(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5c4a2a'; // oak-barked crone
    ctx.fillStyle = '#000'; ctx.fillRect(s * 0.15, s * 0.6, s * 0.7, s * 0.05);
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.2, s * 0.3); // robed body
    ctx.fillStyle = '#4a3a20'; // bark texture
    ctx.fillRect(s * 0.4, s * 0.36, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.46, s * 0.44, s * 0.06, s * 0.06);
    ctx.fillStyle = '#6a5520'; // pointed hat
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.12, s * 0.16);
    ctx.fillRect(s * 0.36, s * 0.2, s * 0.2, s * 0.08); // hat brim
    ctx.fillStyle = c; ctx.fillRect(s * 0.39, s * 0.24, s * 0.14, s * 0.08); // face
    ctx.fillStyle = '#e0c040'; // witch eyes
    ctx.fillRect(s * 0.41, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.26, s * 0.04, s * 0.04);
    ctx.fillStyle = '#2a6a20'; // vine staff
    ctx.fillRect(s * 0.58, s * 0.2, s * 0.05, s * 0.4);
    ctx.fillStyle = '#8a5a2a'; // crook bulb
    ctx.fillRect(s * 0.56, s * 0.18, s * 0.08, s * 0.08);
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
    const c = flash || '#a07840'; // desert jackal fur
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.22, s * 0.3); // lean torso
    ctx.fillRect(s * 0.32, s * 0.6, s * 0.07, s * 0.24); // digitigrade legs
    ctx.fillRect(s * 0.54, s * 0.6, s * 0.07, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.16, s * 0.18); // jackal head
    ctx.fillStyle = '#7a5828'; // darker muzzle
    ctx.fillRect(s * 0.5, s * 0.2, s * 0.12, s * 0.08); // snout
    ctx.fillStyle = c; // tall ears
    ctx.fillRect(s * 0.38, s * 0.02, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.02, s * 0.05, s * 0.12);
    ctx.fillStyle = '#ffd24a'; // predatory amber eyes
    ctx.fillRect(s * 0.42, s * 0.17, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.49, s * 0.17, s * 0.04, s * 0.04);
    ctx.fillStyle = '#c8a050'; // khopesh blade
    ctx.fillRect(s * 0.6, s * 0.34, s * 0.04, s * 0.22);
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.09, s * 0.04);
    ctx.fillStyle = '#6a4a20'; // fur ruff
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.26, s * 0.05);
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

  private drawShadowMastiff(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#1a1a26'; // living darkness
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.36, s * 0.44, s * 0.22); // lean hound body
    ctx.fillRect(s * 0.58, s * 0.5, s * 0.22, s * 0.1); // tail streaming
    ctx.fillRect(s * 0.3, s * 0.58, s * 0.08, s * 0.22); // forelegs
    ctx.fillRect(s * 0.54, s * 0.58, s * 0.08, s * 0.22); // hind legs
    ctx.fillRect(s * 0.14, s * 0.26, s * 0.18, s * 0.18); // wolf head
    ctx.fillStyle = '#101018'; // darker under-shade
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.34, s * 0.08);
    ctx.fillStyle = '#ff6a1a'; // ember eyes
    ctx.fillRect(s * 0.18, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.24, s * 0.32, s * 0.04, s * 0.04);
    ctx.fillStyle = '#e8e8f0'; // bared fangs
    ctx.fillRect(s * 0.16, s * 0.4, s * 0.1, s * 0.03);
    ctx.fillStyle = '#3a3a52'; // smoky ear tips
    ctx.fillRect(s * 0.14, s * 0.2, s * 0.05, s * 0.07);
    ctx.fillRect(s * 0.24, s * 0.2, s * 0.05, s * 0.07);
    ctx.fillStyle = '#4a4a66'; // fear-cone haze
    ctx.fillRect(s * 0.04, s * 0.3, s * 0.08, s * 0.12);
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

  private drawNightmareRider(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#181820'; // midnight armor
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.38, s * 0.22, s * 0.2, s * 0.28); // armored torso
    ctx.fillRect(s * 0.4, s * 0.5, s * 0.07, s * 0.14); // riding legs
    ctx.fillStyle = '#2a2a3a'; // gorget
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.12, s * 0.06);
    ctx.fillStyle = '#3a1a1a'; // smoldering neck stump
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.08, s * 0.08);
    ctx.fillStyle = '#ff4a1a'; // neck flame
    ctx.fillRect(s * 0.45, s * 0.06, s * 0.06, s * 0.05);
    ctx.fillStyle = c; // lance couched
    ctx.fillRect(s * 0.58, s * 0.3, s * 0.24, s * 0.04);
    ctx.fillStyle = '#8a8a9a'; // lance tip
    ctx.fillRect(s * 0.8, s * 0.29, s * 0.08, s * 0.06);
    ctx.fillStyle = '#0a0a12'; // nightmare steed body
    ctx.fillRect(s * 0.14, s * 0.56, s * 0.6, s * 0.16);
    ctx.fillRect(s * 0.18, s * 0.72, s * 0.07, s * 0.16); // legs
    ctx.fillRect(s * 0.58, s * 0.72, s * 0.07, s * 0.16);
    ctx.fillRect(s * 0.66, s * 0.42, s * 0.12, s * 0.16); // horse head
    ctx.fillStyle = '#ff6a1a'; // flaming mane and hooves
    ctx.fillRect(s * 0.66, s * 0.38, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.16, s * 0.86, s * 0.09, s * 0.05);
    ctx.fillRect(s * 0.56, s * 0.86, s * 0.09, s * 0.05);
    ctx.fillStyle = '#ff2a2a'; // burning eye
    ctx.fillRect(s * 0.72, s * 0.48, s * 0.03, s * 0.03);
  }

  private drawDrowArachnomancer(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a2a4a'; // spider-silk robes
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.28, s * 0.22, s * 0.3); // robed torso
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.14, s * 0.18); // head
    ctx.fillStyle = '#6a5a8a'; // chitin plates creeping
    ctx.fillRect(s * 0.36, s * 0.46, s * 0.22, s * 0.06);
    ctx.fillRect(s * 0.42, s * 0.12, s * 0.1, s * 0.04);
    ctx.fillStyle = '#e8e0f0'; // pale drow skin
    ctx.fillRect(s * 0.42, s * 0.14, s * 0.1, s * 0.08);
    ctx.fillStyle = '#ff2a6a'; // Lolth's glowing eyes
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.49, s * 0.16, s * 0.03, s * 0.03);
    ctx.fillStyle = '#1a1a1a'; // four extra spider arms
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.22, s * 0.4, s * 0.1, s * 0.05);
    ctx.fillRect(s * 0.6, s * 0.3, s * 0.12, s * 0.05);
    ctx.fillRect(s * 0.64, s * 0.4, s * 0.1, s * 0.05);
    ctx.fillStyle = '#a04adf'; // violet spellflame
    ctx.fillRect(s * 0.24, s * 0.18, s * 0.07, s * 0.07);
    ctx.fillRect(s * 0.66, s * 0.14, s * 0.06, s * 0.06);
    ctx.fillStyle = '#e8e8f0'; // web strands
    ctx.fillRect(s * 0.16, s * 0.08, s * 0.04, s * 0.2);
    ctx.fillRect(s * 0.78, s * 0.06, s * 0.04, s * 0.18);
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

  private drawOozeMephit(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#7a9a4a'; // acid-green ooze
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.32, s * 0.28, s * 0.32); // drippy torso
    ctx.fillRect(s * 0.32, s * 0.6, s * 0.08, s * 0.16); // stubby legs
    ctx.fillRect(s * 0.58, s * 0.6, s * 0.08, s * 0.16);
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.2, s * 0.2); // round head
    ctx.fillStyle = '#a8c868'; // drip highlights
    ctx.fillRect(s * 0.34, s * 0.5, s * 0.05, s * 0.12);
    ctx.fillRect(s * 0.62, s * 0.46, s * 0.05, s * 0.14);
    ctx.fillStyle = '#4a6a2a'; // slimy wing nubs
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.66, s * 0.3, s * 0.1, s * 0.12);
    ctx.fillStyle = '#d4ff8a'; // eyes
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillRect(s * 0.52, s * 0.2, s * 0.05, s * 0.05);
    ctx.fillStyle = '#5a7a32'; // acid drip below
    ctx.fillRect(s * 0.4, s * 0.8, s * 0.04, s * 0.1);
    ctx.fillRect(s * 0.56, s * 0.84, s * 0.04, s * 0.08);
  }

  private drawVoidDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#2a1a3a'; // void-black scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.48, s * 0.3); // serpentine body
    ctx.fillRect(s * 0.06, s * 0.38, s * 0.22, s * 0.18); // tail
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.22); // neck+head
    ctx.fillStyle = '#4a2a6a'; // star-field wing membranes
    ctx.fillRect(s * 0.14, s * 0.2, s * 0.34, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.44, s * 0.34, s * 0.16);
    ctx.fillStyle = '#b08aff'; // starlight freckles on wings
    ctx.fillRect(s * 0.2, s * 0.24, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.6, s * 0.5, s * 0.03, s * 0.03);
    ctx.fillRect(s * 0.72, s * 0.52, s * 0.03, s * 0.03);
    ctx.fillStyle = '#e0c8ff'; // head crest
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.1, s * 0.06);
    ctx.fillStyle = '#ffffff'; // void eyes
    ctx.fillRect(s * 0.72, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillStyle = '#8a5aff'; // gravity-well maw
    ctx.fillRect(s * 0.78, s * 0.32, s * 0.08, s * 0.06);
  }

  private drawMoonDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c8d4e8'; // moon-silver scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.48, s * 0.3); // body
    ctx.fillRect(s * 0.06, s * 0.38, s * 0.22, s * 0.18); // tail
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.22); // neck+head
    ctx.fillStyle = '#e8f0fc'; // pale wing membranes
    ctx.fillRect(s * 0.14, s * 0.2, s * 0.34, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.44, s * 0.34, s * 0.16);
    ctx.fillStyle = '#8a9ab8'; // scale shading
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillStyle = '#f4f8ff'; // horn crest
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.1, s * 0.06);
    ctx.fillStyle = '#4a6aff'; // cold moonlight eyes
    ctx.fillRect(s * 0.72, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillStyle = '#dce8ff'; // frost breath maw
    ctx.fillRect(s * 0.78, s * 0.32, s * 0.08, s * 0.06);
  }

  private drawSunDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#f0c040'; // sun-gold scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.34, s * 0.48, s * 0.3); // body
    ctx.fillRect(s * 0.06, s * 0.38, s * 0.22, s * 0.18); // tail
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.22); // neck+head
    ctx.fillStyle = '#ffe890'; // radiant wing membranes
    ctx.fillRect(s * 0.14, s * 0.2, s * 0.34, s * 0.16);
    ctx.fillRect(s * 0.52, s * 0.44, s * 0.34, s * 0.16);
    ctx.fillStyle = '#d49830'; // scale shading
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.36, s * 0.05);
    ctx.fillStyle = '#fff8d0'; // horn crest
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.1, s * 0.06);
    ctx.fillStyle = '#ff6a00'; // blazing eyes
    ctx.fillRect(s * 0.72, s * 0.26, s * 0.05, s * 0.05);
    ctx.fillStyle = '#ffd700'; // solar flare maw
    ctx.fillRect(s * 0.78, s * 0.32, s * 0.08, s * 0.06);
    ctx.fillStyle = '#fff2b0'; // corona spikes
    ctx.fillRect(s * 0.2, s * 0.14, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.76, s * 0.5, s * 0.04, s * 0.06);
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

  private drawGloomWidow(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#2a2438'; // shadow-purple chitin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.32, s * 0.28); // bulbous abdomen
    ctx.fillRect(s * 0.4, s * 0.26, s * 0.2, s * 0.16); // head
    ctx.fillStyle = '#4a3a6a'; // eight crawling legs
    ctx.fillRect(s * 0.22, s * 0.34, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.22, s * 0.44, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.62, s * 0.34, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.62, s * 0.44, s * 0.16, s * 0.04);
    ctx.fillRect(s * 0.26, s * 0.52, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.6, s * 0.52, s * 0.14, s * 0.04);
    ctx.fillStyle = '#c040ff'; // hourglass marking
    ctx.fillRect(s * 0.46, s * 0.46, s * 0.08, s * 0.05);
    ctx.fillRect(s * 0.48, s * 0.52, s * 0.04, s * 0.05);
    ctx.fillStyle = '#ff4aff'; // cluster of eyes
    ctx.fillRect(s * 0.42, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.48, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.3, s * 0.04, s * 0.04);
    ctx.fillStyle = '#1a1428'; // fangs
    ctx.fillRect(s * 0.44, s * 0.4, s * 0.04, s * 0.06);
    ctx.fillRect(s * 0.52, s * 0.4, s * 0.04, s * 0.06);
  }

  private drawFireSnake(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#e86020'; // ember scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.14); // sinuous body
    ctx.fillRect(s * 0.16, s * 0.5, s * 0.16, s * 0.1); // tail coil
    ctx.fillRect(s * 0.62, s * 0.36, s * 0.22, s * 0.16); // head raised
    ctx.fillStyle = '#ffb020'; // glowing belly bands
    ctx.fillRect(s * 0.34, s * 0.52, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.46, s * 0.52, s * 0.08, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.52, s * 0.08, s * 0.04);
    ctx.fillStyle = '#fff0a0'; // tongue of flame crest
    ctx.fillRect(s * 0.68, s * 0.28, s * 0.06, s * 0.08);
    ctx.fillStyle = '#ffe800'; // ember eyes
    ctx.fillRect(s * 0.74, s * 0.4, s * 0.04, s * 0.04);
    ctx.fillStyle = '#ff5000'; // flame licks along spine
    ctx.fillRect(s * 0.36, s * 0.38, s * 0.05, s * 0.06);
    ctx.fillRect(s * 0.48, s * 0.38, s * 0.05, s * 0.06);
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

  private drawKoboldDragonshield(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a5a2a'; // rust-red kobold scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.34, s * 0.26, s * 0.28); // small torso
    ctx.fillRect(s * 0.36, s * 0.62, s * 0.09, s * 0.22); // legs
    ctx.fillRect(s * 0.55, s * 0.62, s * 0.09, s * 0.22);
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.18, s * 0.2); // dog-like head
    ctx.fillStyle = '#6a4a22'; // dragon-scale shield
    ctx.fillRect(s * 0.22, s * 0.36, s * 0.14, s * 0.18);
    ctx.fillStyle = '#c86a2a'; // shield boss
    ctx.fillRect(s * 0.27, s * 0.42, s * 0.05, s * 0.05);
    ctx.fillStyle = '#a8a8b0'; // shortspear
    ctx.fillRect(s * 0.68, s * 0.2, s * 0.04, s * 0.44);
    ctx.fillStyle = '#d0d0d8'; // spearhead
    ctx.fillRect(s * 0.66, s * 0.14, s * 0.08, s * 0.07);
    ctx.fillStyle = '#ff5500'; // gleaming eyes
    ctx.fillRect(s * 0.44, s * 0.22, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.22, s * 0.04, s * 0.04);
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
    const c = flash || '#1a1a22'; // abyssal black ooze
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.22, s * 0.36, s * 0.56, s * 0.38); // massive pudding mass
    ctx.fillRect(s * 0.3, s * 0.24, s * 0.4, s * 0.14); // rising dome
    ctx.fillRect(s * 0.14, s * 0.5, s * 0.1, s * 0.2); // pseudopod 1
    ctx.fillRect(s * 0.76, s * 0.46, s * 0.1, s * 0.24); // pseudopod 2
    ctx.fillStyle = '#3a3a4a'; // glossy highlights
    ctx.fillRect(s * 0.28, s * 0.4, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.5, s * 0.3, s * 0.14, s * 0.05);
    ctx.fillStyle = '#a030ff'; // sorcererous core glow
    ctx.fillRect(s * 0.44, s * 0.44, s * 0.12, s * 0.12);
    ctx.fillStyle = '#d4a0ff'; // core center
    ctx.fillRect(s * 0.48, s * 0.48, s * 0.04, s * 0.04);
    ctx.fillStyle = '#5a5a6a'; // dissolving crown of the fallen king
    ctx.fillRect(s * 0.4, s * 0.14, s * 0.2, s * 0.08);
    ctx.fillRect(s * 0.42, s * 0.08, s * 0.05, s * 0.07);
    ctx.fillRect(s * 0.53, s * 0.08, s * 0.05, s * 0.07);
  }

  private drawGrimlock(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#8a8a72'; // troglodyte gray-olive
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.34, s * 0.32, s * 0.3, s * 0.32); // hunched torso
    ctx.fillRect(s * 0.32, s * 0.64, s * 0.11, s * 0.22); // legs
    ctx.fillRect(s * 0.56, s * 0.64, s * 0.11, s * 0.22);
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.22, s * 0.2); // egg-bald head
    ctx.fillStyle = '#6a6a54'; // hide patches
    ctx.fillRect(s * 0.36, s * 0.42, s * 0.08, s * 0.1);
    ctx.fillRect(s * 0.54, s * 0.46, s * 0.08, s * 0.08);
    ctx.fillStyle = '#d4cfc0'; // brow ridge over sightless eyes
    ctx.fillRect(s * 0.4, s * 0.18, s * 0.18, s * 0.05);
    ctx.fillStyle = '#3a3a2e'; // sealed eye slits
    ctx.fillRect(s * 0.44, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.52, s * 0.24, s * 0.04, s * 0.03);
    ctx.fillStyle = '#a89878'; // bone spear
    ctx.fillRect(s * 0.68, s * 0.18, s * 0.05, s * 0.5);
    ctx.fillStyle = '#e8e0d0'; // spear tip
    ctx.fillRect(s * 0.66, s * 0.12, s * 0.09, s * 0.07);
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

  private drawRast(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#b87848'; // warm stone sphere
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.3, s * 0.26, s * 0.4, s * 0.4); // floating body ball
    ctx.fillRect(s * 0.36, s * 0.14, s * 0.28, s * 0.14); // crown mass
    ctx.fillStyle = '#8a5030'; // banding
    ctx.fillRect(s * 0.3, s * 0.38, s * 0.4, s * 0.05);
    ctx.fillRect(s * 0.3, s * 0.5, s * 0.4, s * 0.05);
    ctx.fillStyle = '#ff8a20'; // smoldering eye
    ctx.fillRect(s * 0.44, s * 0.3, s * 0.12, s * 0.08);
    ctx.fillStyle = '#ffd700'; // eye core
    ctx.fillRect(s * 0.48, s * 0.32, s * 0.05, s * 0.05);
    ctx.fillStyle = '#6a4028'; // five talons below
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.4, s * 0.68, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.5, s * 0.7, s * 0.06, s * 0.18);
    ctx.fillRect(s * 0.6, s * 0.68, s * 0.06, s * 0.2);
    ctx.fillRect(s * 0.68, s * 0.66, s * 0.06, s * 0.18);
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

  private drawDarkling(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#4a3a5a'; // elder fey dusk-violet
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.3, s * 0.26, s * 0.32); // slight torso
    ctx.fillRect(s * 0.36, s * 0.62, s * 0.09, s * 0.24); // legs
    ctx.fillRect(s * 0.55, s * 0.62, s * 0.09, s * 0.24);
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.18, s * 0.18); // gaunt head
    ctx.fillStyle = '#6a5a7a'; // moth-eaten cloak
    ctx.fillRect(s * 0.3, s * 0.28, s * 0.38, s * 0.36);
    ctx.fillStyle = '#1a1424'; // cloak holes
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.04, s * 0.05);
    ctx.fillRect(s * 0.58, s * 0.48, s * 0.04, s * 0.05);
    ctx.fillStyle = '#e8d84a'; // bargain-bright eyes
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillStyle = '#c8b86a'; // silver-tongued smile
    ctx.fillRect(s * 0.44, s * 0.26, s * 0.1, s * 0.02);
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

  private drawEnveloper(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#9a9a8a'; // gray flesh sheet
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.2, s * 0.6, s * 0.56); // hanging sheet mass
    ctx.fillRect(s * 0.14, s * 0.3, s * 0.1, s * 0.4); // drape edge left
    ctx.fillRect(s * 0.76, s * 0.26, s * 0.1, s * 0.44); // drape edge right
    ctx.fillStyle = '#7a7a6a'; // folds
    ctx.fillRect(s * 0.32, s * 0.24, s * 0.06, s * 0.48);
    ctx.fillRect(s * 0.52, s * 0.3, s * 0.06, s * 0.42);
    ctx.fillStyle = '#c8c0a8'; // faint face pressing through
    ctx.fillRect(s * 0.42, s * 0.34, s * 0.16, s * 0.2);
    ctx.fillStyle = '#2a2a24'; // hollow mouth
    ctx.fillRect(s * 0.46, s * 0.46, s * 0.08, s * 0.05);
    ctx.fillStyle = '#1a1a16'; // eye dimples
    ctx.fillRect(s * 0.44, s * 0.38, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.38, s * 0.04, s * 0.04);
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

  private drawBerbalang(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#6a5a4a'; // corpse-thin brown
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.36, s * 0.26, s * 0.26, s * 0.36); // gaunt torso
    ctx.fillRect(s * 0.36, s * 0.62, s * 0.09, s * 0.26); // stilt legs
    ctx.fillRect(s * 0.55, s * 0.62, s * 0.09, s * 0.26);
    ctx.fillRect(s * 0.4, s * 0.08, s * 0.18, s * 0.18); // narrow skull head
    ctx.fillStyle = '#4a3c30'; // leathery wings
    ctx.fillRect(s * 0.08, s * 0.22, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.62, s * 0.22, s * 0.28, s * 0.06);
    ctx.fillRect(s * 0.1, s * 0.28, s * 0.05, s * 0.2);
    ctx.fillRect(s * 0.83, s * 0.28, s * 0.05, s * 0.2);
    ctx.fillStyle = '#ff8800'; // knowledge-hungry eyes
    ctx.fillRect(s * 0.44, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#2a221a'; // hollow cheeks
    ctx.fillRect(s * 0.4, s * 0.2, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.54, s * 0.2, s * 0.04, s * 0.04);
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
    const c = flash || '#8a7ab0'; // illithid lavender brain
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.32, s * 0.18, s * 0.36, s * 0.2); // oversized brain
    ctx.fillRect(s * 0.36, s * 0.38, s * 0.28, s * 0.3); // robed torso
    ctx.fillRect(s * 0.38, s * 0.68, s * 0.1, s * 0.26);
    ctx.fillRect(s * 0.52, s * 0.68, s * 0.1, s * 0.26);
    ctx.fillStyle = '#b0a0d0'; // four face tentacles
    ctx.fillRect(s * 0.38, s * 0.36, s * 0.05, s * 0.16);
    ctx.fillRect(s * 0.45, s * 0.38, s * 0.05, s * 0.18);
    ctx.fillRect(s * 0.52, s * 0.38, s * 0.05, s * 0.18);
    ctx.fillRect(s * 0.59, s * 0.36, s * 0.05, s * 0.16);
    ctx.fillStyle = '#f0f0ff'; // archmage stole
    ctx.fillRect(s * 0.36, s * 0.42, s * 0.28, s * 0.05);
    ctx.fillStyle = '#ffe080'; // spell runes orbiting
    ctx.fillRect(s * 0.16, s * 0.22, s * 0.06, s * 0.06);
    ctx.fillRect(s * 0.8, s * 0.3, s * 0.06, s * 0.06);
    ctx.fillStyle = '#fff'; // cold pupilless eyes
    ctx.fillRect(s * 0.43, s * 0.3, s * 0.05, s * 0.03);
    ctx.fillRect(s * 0.53, s * 0.3, s * 0.05, s * 0.03);
  }

  private drawElderBrain(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#c090b8'; // pulsing neural pink-violet
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.3, s * 0.76, s * 0.42); // massive brain dome
    ctx.fillRect(s * 0.2, s * 0.24, s * 0.6, s * 0.1); // dome top
    ctx.fillStyle = '#a070a0'; // sulci folds
    ctx.fillRect(s * 0.24, s * 0.4, s * 0.1, s * 0.2);
    ctx.fillRect(s * 0.44, s * 0.36, s * 0.1, s * 0.26);
    ctx.fillRect(s * 0.64, s * 0.4, s * 0.1, s * 0.2);
    ctx.fillStyle = '#60c0d8'; // brine pool below
    ctx.fillRect(s * 0.08, s * 0.74, s * 0.84, s * 0.12);
    ctx.fillStyle = '#f0e0ff'; // psychic aura wisps
    ctx.fillRect(s * 0.04, s * 0.2, s * 0.08, s * 0.08);
    ctx.fillRect(s * 0.88, s * 0.2, s * 0.08, s * 0.08);
    ctx.fillStyle = '#fff'; // dominant single eye
    ctx.fillRect(s * 0.46, s * 0.48, s * 0.08, s * 0.06);
    ctx.fillStyle = '#402040'; // pupil
    ctx.fillRect(s * 0.49, s * 0.5, s * 0.03, s * 0.03);
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
    const c = flash || '#c8a858'; // burnished brass scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.6, s * 0.26); // serpentine body
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.2); // neck
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.22, s * 0.16); // frilled head
    ctx.fillStyle = '#e8d090'; // wing membrane
    ctx.fillRect(s * 0.02, s * 0.24, s * 0.2, s * 0.14);
    ctx.fillRect(s * 0.06, s * 0.42, s * 0.16, s * 0.1);
    ctx.fillStyle = '#8a7030'; // scale shading
    ctx.fillRect(s * 0.2, s * 0.52, s * 0.4, s * 0.05);
    ctx.fillStyle = '#ff9020'; // fire breath glow
    ctx.fillRect(s * 0.88, s * 0.14, s * 0.1, s * 0.05);
    ctx.fillStyle = '#3a2a10'; // wise eyes
    ctx.fillRect(s * 0.76, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.13, s * 0.05, s * 0.04);
  }

  private drawCopperDragonElder(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#b07040'; // warm copper scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.6, s * 0.26);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.22, s * 0.16);
    ctx.fillStyle = '#d89860'; // ribbed wing
    ctx.fillRect(s * 0.02, s * 0.24, s * 0.2, s * 0.14);
    ctx.fillRect(s * 0.06, s * 0.42, s * 0.16, s * 0.1);
    ctx.fillStyle = '#7a4a24'; // belly plates
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.4, s * 0.05);
    ctx.fillStyle = '#e8e0d0'; // mocking grin teeth
    ctx.fillRect(s * 0.86, s * 0.16, s * 0.08, s * 0.03);
    ctx.fillStyle = '#3a2a10'; // glinting jokester eyes
    ctx.fillRect(s * 0.76, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.13, s * 0.05, s * 0.04);
  }

  private drawCrystalDragonElder(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#a8c8e8'; // translucent gem-blue
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.6, s * 0.26);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.22, s * 0.16);
    ctx.fillStyle = '#d8ecff'; // crystal facet wings
    ctx.fillRect(s * 0.02, s * 0.22, s * 0.2, s * 0.14);
    ctx.fillRect(s * 0.06, s * 0.42, s * 0.16, s * 0.1);
    ctx.fillStyle = '#70a0d0'; // facet edges
    ctx.fillRect(s * 0.3, s * 0.4, s * 0.3, s * 0.04);
    ctx.fillStyle = '#c080ff'; // psionic aura
    ctx.fillRect(s * 0.1, s * 0.16, s * 0.07, s * 0.07);
    ctx.fillRect(s * 0.86, s * 0.3, s * 0.07, s * 0.07);
    ctx.fillStyle = '#fff'; // refractive eyes
    ctx.fillRect(s * 0.76, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.13, s * 0.05, s * 0.04);
  }

  private drawObsidianDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#1a1a1e'; // black glass scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.6, s * 0.26);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.22, s * 0.16);
    ctx.fillStyle = '#3a3a44'; // glass-sheen highlights
    ctx.fillRect(s * 0.24, s * 0.38, s * 0.3, s * 0.04);
    ctx.fillRect(s * 0.62, s * 0.24, s * 0.1, s * 0.03);
    ctx.fillStyle = '#e04020'; // lava throat glow
    ctx.fillRect(s * 0.86, s * 0.14, s * 0.1, s * 0.05);
    ctx.fillStyle = '#8a2020'; // ember cracks
    ctx.fillRect(s * 0.34, s * 0.5, s * 0.24, s * 0.03);
    ctx.fillStyle = '#ff6030'; // molten eyes
    ctx.fillRect(s * 0.76, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.13, s * 0.05, s * 0.04);
  }

  private drawStormDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5a6a9a'; // thundercloud slate
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.6, s * 0.26);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.22, s * 0.16);
    ctx.fillStyle = '#8a9ac8'; // storm-cloud wings
    ctx.fillRect(s * 0.02, s * 0.2, s * 0.22, s * 0.16);
    ctx.fillRect(s * 0.04, s * 0.44, s * 0.18, s * 0.1);
    ctx.fillStyle = '#ffe840'; // lightning veins
    ctx.fillRect(s * 0.3, s * 0.42, s * 0.3, s * 0.03);
    ctx.fillRect(s * 0.42, s * 0.48, s * 0.14, s * 0.03);
    ctx.fillStyle = '#fff'; // electric eyes
    ctx.fillRect(s * 0.76, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillStyle = '#c8d4f0'; // rain-shed tail
    ctx.fillRect(s * 0.06, s * 0.62, s * 0.5, s * 0.04);
  }

  private drawPoisonDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#5a7a3a'; // venom green scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.6, s * 0.26);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.22, s * 0.16);
    ctx.fillStyle = '#7a9a4a'; // lighter belly scutes
    ctx.fillRect(s * 0.2, s * 0.54, s * 0.4, s * 0.05);
    ctx.fillStyle = '#b0d040'; // dripping venom fangs
    ctx.fillRect(s * 0.86, s * 0.16, s * 0.03, s * 0.06);
    ctx.fillRect(s * 0.92, s * 0.16, s * 0.03, s * 0.06);
    ctx.fillStyle = '#40602a'; // scale ridges
    ctx.fillRect(s * 0.28, s * 0.38, s * 0.28, s * 0.04);
    ctx.fillStyle = '#c0e040'; // toxic eyes
    ctx.fillRect(s * 0.76, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillStyle = '#6a8a3a'; // withering shadow
    ctx.fillRect(s * 0.14, s * 0.64, s * 0.44, s * 0.04);
  }

  private drawZarielBoss(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#e8c8a0'; // angelic bronze skin
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.18, s * 0.48, s * 0.48); // commanding frame
    ctx.fillRect(s * 0.3, s * 0.66, s * 0.16, s * 0.3);
    ctx.fillRect(s * 0.54, s * 0.66, s * 0.16, s * 0.3);
    ctx.fillRect(s * 0.4, s * 0.04, s * 0.2, s * 0.16); // stern face
    ctx.fillStyle = '#d8d8e0'; // one wing blackened, one white
    ctx.fillRect(s * 0.04, s * 0.16, s * 0.22, s * 0.12);
    ctx.fillStyle = '#2a2a32'; // fallen wing
    ctx.fillRect(s * 0.74, s * 0.16, s * 0.22, s * 0.12);
    ctx.fillStyle = '#ff5020'; // burning greatsword
    ctx.fillRect(s * 0.78, s * 0.28, s * 0.07, s * 0.6);
    ctx.fillStyle = '#ffd040'; // sword flame edge
    ctx.fillRect(s * 0.78, s * 0.28, s * 0.03, s * 0.6);
    ctx.fillStyle = '#ffdf80'; // divine wrath eyes
    ctx.fillRect(s * 0.44, s * 0.1, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.52, s * 0.1, s * 0.05, s * 0.04);
  }

  private drawTiamatAvatar(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#3a3a3a'; // dark divine body
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.2, s * 0.4, s * 0.6, s * 0.32); // draconic mass
    ctx.fillRect(s * 0.3, s * 0.72, s * 0.16, s * 0.24);
    ctx.fillRect(s * 0.54, s * 0.72, s * 0.16, s * 0.24);
    // five heads on necks
    ctx.fillStyle = '#c02020'; ctx.fillRect(s * 0.16, s * 0.2, s * 0.14, s * 0.22); // red neck
    ctx.fillStyle = '#2040c0'; ctx.fillRect(s * 0.32, s * 0.14, s * 0.14, s * 0.28); // blue neck
    ctx.fillStyle = '#208020'; ctx.fillRect(s * 0.46, s * 0.1, s * 0.14, s * 0.32); // green neck
    ctx.fillStyle = '#101010'; ctx.fillRect(s * 0.6, s * 0.14, s * 0.14, s * 0.28); // black neck
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(s * 0.74, s * 0.2, s * 0.14, s * 0.22); // white neck
    ctx.fillStyle = '#ff4040'; ctx.fillRect(s * 0.14, s * 0.14, s * 0.18, s * 0.08);
    ctx.fillStyle = '#5070ff'; ctx.fillRect(s * 0.3, s * 0.08, s * 0.18, s * 0.08);
    ctx.fillStyle = '#50c050'; ctx.fillRect(s * 0.44, s * 0.04, s * 0.18, s * 0.08);
    ctx.fillStyle = '#303030'; ctx.fillRect(s * 0.58, s * 0.08, s * 0.18, s * 0.08);
    ctx.fillStyle = '#f8f8f8'; ctx.fillRect(s * 0.72, s * 0.14, s * 0.18, s * 0.08);
  }

  private drawBahamutAspect(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#e8e4d8'; // platinum-white scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.12, s * 0.36, s * 0.6, s * 0.26);
    ctx.fillRect(s * 0.6, s * 0.2, s * 0.24, s * 0.2);
    ctx.fillRect(s * 0.7, s * 0.08, s * 0.22, s * 0.16);
    ctx.fillStyle = '#fff'; // vast radiant wings
    ctx.fillRect(s * 0.0, s * 0.16, s * 0.24, s * 0.16);
    ctx.fillRect(s * 0.02, s * 0.44, s * 0.2, s * 0.12);
    ctx.fillRect(s * 0.76, s * 0.44, s * 0.2, s * 0.12);
    ctx.fillStyle = '#d0c8a0'; // scale shading
    ctx.fillRect(s * 0.26, s * 0.4, s * 0.3, s * 0.04);
    ctx.fillStyle = '#ffd700'; // justice halo above head
    ctx.fillRect(s * 0.68, s * 0.02, s * 0.26, s * 0.04);
    ctx.fillStyle = '#7ac0ff'; // oath-judging eyes
    ctx.fillRect(s * 0.76, s * 0.13, s * 0.05, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.13, s * 0.05, s * 0.04);
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

  private drawDrowHouseGuard(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4a56'; // house-guard skin
    ctx.fillRect(s * 0.38, s * 0.26, s * 0.24, s * 0.3);
    ctx.fillStyle = '#3e3e4a'; // dusk face
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.14);
    ctx.fillStyle = '#1a1a24'; // silver hair under helm
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.06);
    ctx.fillStyle = flash || '#7a5a30'; // house-livery leathers
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.32, s * 0.16);
    ctx.fillStyle = '#243040'; // house sigil (spider) on chest
    ctx.fillRect(s * 0.44, s * 0.44, s * 0.12, s * 0.06);
    ctx.fillStyle = '#b8b8c8'; // longsword
    ctx.fillRect(s * 0.72, s * 0.18, s * 0.04, s * 0.26);
    ctx.fillRect(s * 0.66, s * 0.14, s * 0.08, s * 0.03);
    ctx.fillStyle = '#7a5a30'; // legs
    ctx.fillRect(s * 0.4, s * 0.56, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.56, s * 0.08, s * 0.14);
  }

  private drawDrowScout(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4a56'; // crouching scout
    ctx.fillRect(s * 0.36, s * 0.32, s * 0.28, s * 0.26);
    ctx.fillStyle = '#3e3e4a'; // hooded face
    ctx.fillRect(s * 0.38, s * 0.2, s * 0.24, s * 0.14);
    ctx.fillStyle = '#2a2a34'; // dark cloak
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.08, s * 0.24);
    ctx.fillRect(s * 0.62, s * 0.34, s * 0.08, s * 0.24);
    ctx.fillStyle = '#5aa0a8'; // hand crossbow
    ctx.fillRect(s * 0.6, s * 0.42, s * 0.14, s * 0.04);
    ctx.fillStyle = '#b8b8c8'; // bolt
    ctx.fillRect(s * 0.66, s * 0.38, s * 0.04, s * 0.06);
    ctx.fillStyle = '#4a4a56'; // legs crouched
    ctx.fillRect(s * 0.4, s * 0.58, s * 0.08, s * 0.12);
    ctx.fillRect(s * 0.52, s * 0.58, s * 0.08, s * 0.12);
  }

  private drawDrowAssassin(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#3e3e4a'; // near-invisible assassin
    ctx.fillRect(s * 0.36, s * 0.26, s * 0.28, s * 0.3);
    ctx.fillStyle = '#2e2e3a'; // cowled head
    ctx.fillRect(s * 0.38, s * 0.12, s * 0.24, s * 0.16);
    ctx.fillStyle = '#1a1a24'; // mask slit
    ctx.fillRect(s * 0.42, s * 0.18, s * 0.16, s * 0.04);
    ctx.fillStyle = flash || '#2a2a34'; // black leathers
    ctx.fillRect(s * 0.34, s * 0.4, s * 0.32, s * 0.16);
    ctx.fillStyle = '#5aa0a8'; // venom drip on twin blades
    ctx.fillRect(s * 0.7, s * 0.16, s * 0.04, s * 0.26);
    ctx.fillRect(s * 0.26, s * 0.16, s * 0.04, s * 0.26);
    ctx.fillStyle = '#3a3a44'; // blades' grips
    ctx.fillRect(s * 0.26, s * 0.14, s * 0.04, s * 0.03);
    ctx.fillRect(s * 0.7, s * 0.14, s * 0.04, s * 0.03);
    ctx.fillStyle = '#2e2e3a'; // legs
    ctx.fillRect(s * 0.4, s * 0.56, s * 0.08, s * 0.14);
    ctx.fillRect(s * 0.52, s * 0.56, s * 0.08, s * 0.14);
  }

  private drawDrowArchmage(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#4a4a58'; // archmage robes
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.28);
    ctx.fillStyle = '#3e3e4c'; // hood
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.18);
    ctx.fillStyle = '#1a1a26'; // long silver hair
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.05);
    ctx.fillStyle = '#8a4ac8'; // arcane sigils on robes
    ctx.fillRect(s * 0.44, s * 0.4, s * 0.12, s * 0.06);
    ctx.fillRect(s * 0.4, s * 0.5, s * 0.2, s * 0.04);
    ctx.fillStyle = '#c8a0ff'; // staff crackling
    ctx.fillRect(s * 0.68, s * 0.1, s * 0.04, s * 0.3);
    ctx.fillStyle = '#e8c8ff'; // staff orb
    ctx.fillRect(s * 0.66, s * 0.06, s * 0.08, s * 0.06);
    ctx.fillStyle = '#4a4a58'; // robe hem
    ctx.fillRect(s * 0.36, s * 0.58, s * 0.28, s * 0.12);
  }

  private drawDrowMatron(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    ctx.fillStyle = flash || '#5a2a6a'; // matron's spider-silk gown
    ctx.fillRect(s * 0.34, s * 0.3, s * 0.32, s * 0.28);
    ctx.fillStyle = '#4a4a5a'; // regal face
    ctx.fillRect(s * 0.38, s * 0.14, s * 0.24, s * 0.16);
    ctx.fillStyle = '#e8e8f0'; // white matron hair
    ctx.fillRect(s * 0.36, s * 0.1, s * 0.28, s * 0.06);
    ctx.fillStyle = '#c8a030'; // crown of house gold
    ctx.fillRect(s * 0.4, s * 0.06, s * 0.2, s * 0.05);
    ctx.fillStyle = '#8a4ac8'; // spider-sigil brooch
    ctx.fillRect(s * 0.46, s * 0.4, s * 0.08, s * 0.08);
    ctx.fillStyle = '#5aa0a8'; // venom-tipped scourge
    ctx.fillRect(s * 0.72, s * 0.14, s * 0.04, s * 0.28);
    ctx.fillStyle = '#e8e8f0'; // scourge barbs
    ctx.fillRect(s * 0.68, s * 0.12, s * 0.12, s * 0.03);
    ctx.fillStyle = '#5a2a6a'; // gown hem
    ctx.fillRect(s * 0.36, s * 0.58, s * 0.28, s * 0.12);
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
    const c = flash || '#a03020'; // half-lizard crimson
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.26, s * 0.32, s * 0.48, s * 0.3); // low-slung body
    ctx.fillRect(s * 0.32, s * 0.22, s * 0.36, s * 0.12); // neck
    ctx.fillRect(s * 0.34, s * 0.08, s * 0.32, s * 0.16); // lizard head
    ctx.fillStyle = '#e86030'; // heat shimmer on scales
    ctx.fillRect(s * 0.3, s * 0.36, s * 0.12, s * 0.04);
    ctx.fillRect(s * 0.58, s * 0.42, s * 0.12, s * 0.04);
    ctx.fillStyle = '#ffd040'; // burning eyes
    ctx.fillRect(s * 0.4, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.12, s * 0.06, s * 0.05);
    ctx.fillStyle = '#e8e8e8'; // first fangs
    ctx.fillRect(s * 0.44, s * 0.2, s * 0.12, s * 0.04);
    ctx.fillStyle = '#e86030'; // stubby proto-wings
    ctx.fillRect(s * 0.16, s * 0.22, s * 0.1, s * 0.12);
    ctx.fillRect(s * 0.74, s * 0.22, s * 0.1, s * 0.12);
    ctx.fillStyle = '#a03020'; // tail
    ctx.fillRect(s * 0.78, s * 0.36, s * 0.1, s * 0.08);
    ctx.fillStyle = '#e86030'; // ember tail tip
    ctx.fillRect(s * 0.86, s * 0.34, s * 0.05, s * 0.05);
  }

  private drawSangDragon(ctx: CanvasRenderingContext2D, s: number, flash?: string) {
    const c = flash || '#2a4a8a'; // cobalt storm scales
    ctx.fillStyle = c;
    ctx.fillRect(s * 0.24, s * 0.3, s * 0.52, s * 0.32); // storm-huge body
    ctx.fillRect(s * 0.3, s * 0.18, s * 0.4, s * 0.14); // neck
    ctx.fillRect(s * 0.34, s * 0.06, s * 0.32, s * 0.14); // head
    ctx.fillStyle = '#e8e8f0'; // lightning veins between scales
    ctx.fillRect(s * 0.3, s * 0.34, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.56, s * 0.4, s * 0.14, s * 0.04);
    ctx.fillRect(s * 0.4, s * 0.5, s * 0.12, s * 0.04);
    ctx.fillStyle = '#e8e830'; // crackling eyes
    ctx.fillRect(s * 0.4, s * 0.1, s * 0.06, s * 0.05);
    ctx.fillRect(s * 0.54, s * 0.1, s * 0.06, s * 0.05);
    ctx.fillStyle = '#e8e8f0'; // storm-fangs
    ctx.fillRect(s * 0.44, s * 0.16, s * 0.12, s * 0.04);
    ctx.fillStyle = '#2a4a8a'; // wings crackling with static
    ctx.fillRect(s * 0.14, s * 0.18, s * 0.1, s * 0.16);
    ctx.fillRect(s * 0.76, s * 0.18, s * 0.1, s * 0.16);
    ctx.fillStyle = '#e8e830'; // wing sparks
    ctx.fillRect(s * 0.12, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillRect(s * 0.84, s * 0.14, s * 0.04, s * 0.04);
    ctx.fillStyle = '#2a4a8a'; // tail
    ctx.fillRect(s * 0.78, s * 0.36, s * 0.1, s * 0.08);
    ctx.fillStyle = '#e8e830'; // static tail tip
    ctx.fillRect(s * 0.86, s * 0.34, s * 0.05, s * 0.05);
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

}
/**
 * Player settings: how the game is shown and how much it spends on showing it.
 *
 * Pure. Nothing here touches the window, the canvas or the shell; `Game`
 * reads the values and applies them (`applySettings`), the settings panel
 * edits them, and this module owns the shape, the defaults, the presets and
 * the arithmetic that turns a window size into a canvas size.
 *
 * Stored as one JSON object under `fatefall.settings`. Unknown or malformed
 * fields fall back to their defaults field by field, so a settings blob from
 * an older build never breaks a newer one.
 */

export type ScaleMode = 'fit' | 'integer' | 'stretch' | 'native';
export type WindowMode = 'windowed' | 'fullscreen';
export type WeatherLevel = 0 | 0.5 | 1;
export type FpsCap = 0 | 30 | 60;
export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export type RendererId = 'pixi' | 'phaser' | 'canvas';

/** The effect switches. Each one is honoured by every backend that has the effect. */
export interface GraphicsSettings {
  /** The lighting pass: torchlight, night, the darkness beyond the party. */
  lighting: boolean;
  /** Weather particles, as a share of the full count. 0 turns the layer off. */
  weather: WeatherLevel;
  /** Dust, pollen and fireflies. */
  ambience: boolean;
  /** The glow around bright things. Five full-screen passes on Pixi. */
  bloom: boolean;
  /** The darkened frame edge. */
  vignette: boolean;
  /** The colour grade: dawn, dusk, the weather's cast, the theme's tint. */
  grade: boolean;
  /** Camera shake and hit-stop on heavy blows. */
  shake: boolean;
  /** The white flash on a critical hit. */
  flash: boolean;
  /** Draw at most this many frames a second. 0 is the display's rate. */
  fpsCap: FpsCap;
}

export interface DisplaySettings {
  windowMode: WindowMode;
  /** How the fixed 1024x768 picture meets the window. */
  scaleMode: ScaleMode;
  /** The HUD's size relative to the picture, 0.7 to 1.3. */
  uiScale: number;
  /** Render at the display's pixel density instead of one texel per logical pixel. */
  sharp: boolean;
  /** Desktop shell only: the last window size the player asked for, as "WxH" or "max". */
  windowSize: string;
}

export interface GameSettings {
  display: DisplaySettings;
  graphics: GraphicsSettings;
  renderer: RendererId;
}

/** The effect flags the frame carries to the backend, derived from the graphics settings. */
export interface RenderFx {
  lighting: boolean;
  weather: number;
  ambience: boolean;
  bloom: boolean;
  vignette: boolean;
  grade: boolean;
}

export const SETTINGS_KEY = 'fatefall.settings';

export const PRESETS: Record<GraphicsPreset, GraphicsSettings> = {
  low: { lighting: false, weather: 0, ambience: false, bloom: false, vignette: false, grade: false, shake: true, flash: true, fpsCap: 30 },
  medium: { lighting: true, weather: 0.5, ambience: false, bloom: false, vignette: true, grade: true, shake: true, flash: true, fpsCap: 60 },
  high: { lighting: true, weather: 1, ambience: true, bloom: false, vignette: true, grade: true, shake: true, flash: true, fpsCap: 60 },
  ultra: { lighting: true, weather: 1, ambience: true, bloom: true, vignette: true, grade: true, shake: true, flash: true, fpsCap: 0 },
};

export const DEFAULT_SETTINGS: GameSettings = {
  display: { windowMode: 'windowed', scaleMode: 'fit', uiScale: 1, sharp: true, windowSize: '1280x880' },
  graphics: { ...PRESETS.ultra },
  renderer: 'pixi',
};

/** Window sizes the desktop shell offers. "max" maximises. */
export const WINDOW_SIZES: { id: string; label: string }[] = [
  { id: '1024x768', label: '1024 × 768' },
  { id: '1280x880', label: '1280 × 880' },
  { id: '1366x768', label: '1366 × 768' },
  { id: '1600x1000', label: '1600 × 1000' },
  { id: '1920x1080', label: '1920 × 1080' },
  { id: 'max', label: 'Maximised' },
];

const GRAPHICS_KEYS = Object.keys(PRESETS.ultra) as (keyof GraphicsSettings)[];

/** Which preset the switches match exactly, or null when the player has mixed their own. */
export function presetFor(g: GraphicsSettings): GraphicsPreset | null {
  for (const id of Object.keys(PRESETS) as GraphicsPreset[]) {
    const p = PRESETS[id];
    if (GRAPHICS_KEYS.every(k => p[k] === g[k])) return id;
  }
  return null;
}

export function renderFx(g: GraphicsSettings): RenderFx {
  return { lighting: g.lighting, weather: g.weather, ambience: g.ambience, bloom: g.bloom, vignette: g.vignette, grade: g.grade };
}

function bool(v: unknown, d: boolean): boolean { return typeof v === 'boolean' ? v : d; }
function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], d: T): T {
  return (allowed as readonly unknown[]).includes(v) ? (v as T) : d;
}

/** Coerce anything into a full settings object, defaulting field by field. */
export function normalizeSettings(raw: unknown): GameSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = (r.display && typeof r.display === 'object' ? r.display : {}) as Record<string, unknown>;
  const g = (r.graphics && typeof r.graphics === 'object' ? r.graphics : {}) as Record<string, unknown>;
  const D = DEFAULT_SETTINGS;
  const uiScale = typeof d.uiScale === 'number' && Number.isFinite(d.uiScale) ? Math.min(1.3, Math.max(0.7, d.uiScale)) : D.display.uiScale;
  const windowSize = typeof d.windowSize === 'string' && /^(\d{3,4}x\d{3,4}|max)$/.test(d.windowSize) ? d.windowSize : D.display.windowSize;
  return {
    display: {
      windowMode: oneOf(d.windowMode, ['windowed', 'fullscreen'] as const, D.display.windowMode),
      scaleMode: oneOf(d.scaleMode, ['fit', 'integer', 'stretch', 'native'] as const, D.display.scaleMode),
      uiScale,
      sharp: bool(d.sharp, D.display.sharp),
      windowSize,
    },
    graphics: {
      lighting: bool(g.lighting, D.graphics.lighting),
      weather: oneOf(g.weather, [0, 0.5, 1] as const, D.graphics.weather),
      ambience: bool(g.ambience, D.graphics.ambience),
      bloom: bool(g.bloom, D.graphics.bloom),
      vignette: bool(g.vignette, D.graphics.vignette),
      grade: bool(g.grade, D.graphics.grade),
      shake: bool(g.shake, D.graphics.shake),
      flash: bool(g.flash, D.graphics.flash),
      fpsCap: oneOf(g.fpsCap, [0, 30, 60] as const, D.graphics.fpsCap),
    },
    renderer: oneOf(r.renderer, ['pixi', 'phaser', 'canvas'] as const, D.renderer),
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the settings. The renderer choice predates this module and lived under
 * its own key; it is still honoured when the settings blob has none.
 */
export function loadSettings(storage: StorageLike | null = defaultStorage()): GameSettings {
  if (!storage) return normalizeSettings(null);
  let raw: unknown = null;
  try {
    const text = storage.getItem(SETTINGS_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const s = normalizeSettings(raw);
  if (!(raw && typeof raw === 'object' && 'renderer' in (raw as object))) {
    try {
      const legacy = storage.getItem('fatefall.renderer');
      if (legacy === 'pixi' || legacy === 'phaser' || legacy === 'canvas') s.renderer = legacy;
    } catch {
      /* the default stands */
    }
  }
  return s;
}

export function saveSettings(s: GameSettings, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
    // Kept in step for anything still reading the old key.
    storage.setItem('fatefall.renderer', s.renderer);
  } catch {
    /* private mode: the choice will not stick */
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function cloneSettings(s: GameSettings): GameSettings {
  return { display: { ...s.display }, graphics: { ...s.graphics }, renderer: s.renderer };
}

/** How the picture and the HUD are laid out in a window of the given size. */
export interface Layout {
  /** CSS size of the canvas. */
  canvasW: number;
  canvasH: number;
  /** Scale applied to the 1024x768 HUD box. */
  uiScale: number;
  /** The picture's scale on the shorter axis, for the readout. */
  scale: number;
}

/**
 * Fit the game's fixed picture into a window.
 *
 * `fit` letterboxes at the largest scale that fits. `integer` uses the
 * largest whole multiple, so every texel is the same size (and falls back to
 * `fit` when even 1x does not fit). `stretch` fills the window and lets the
 * aspect go. `native` draws one texel per CSS pixel whatever the window.
 * The HUD keeps the picture's aspect in every mode, never grows past the
 * window, and takes the player's UI scale on top.
 */
export function computeLayout(winW: number, winH: number, gameW: number, gameH: number, mode: ScaleMode, uiScale: number): Layout {
  const w = Math.max(1, winW);
  const h = Math.max(1, winH);
  const fit = Math.min(w / gameW, h / gameH);
  let scale = fit;
  let canvasW = gameW * fit;
  let canvasH = gameH * fit;
  switch (mode) {
    case 'integer': {
      const n = Math.floor(fit);
      if (n >= 1) { scale = n; canvasW = gameW * n; canvasH = gameH * n; }
      break;
    }
    case 'stretch':
      canvasW = w;
      canvasH = h;
      scale = fit;
      break;
    case 'native':
      scale = 1;
      canvasW = gameW;
      canvasH = gameH;
      break;
    default:
      break;
  }
  const ui = Math.min(fit, scale * uiScale);
  return { canvasW, canvasH, uiScale: ui, scale };
}

/** Parse a "WxH" window size, or null for "max" and anything malformed. */
export function parseWindowSize(id: string): { width: number; height: number } | null {
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(id);
  if (!m) return null;
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

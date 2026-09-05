/**
 * The mood, for the Phaser backend: the picture's weather, light, lens and
 * transitions, replayed from the `SceneMood` the game stamps on every frame.
 *
 * The map renderer draws the world at noon under a clear sky and leaves all of
 * this to whichever backend replays the frame. Pixi has a layer per effect;
 * the plain canvas has one multiply pass and one tint. This sits between:
 * it is built from what Phaser 4 gives cheaply — camera filters for the
 * light and the vignette, a few rectangles for the tint and the lens, one
 * Graphics object for the weather — and it reads the same numbers the other
 * two backends read, so the three agree about how dark a cave is and how a
 * fade looks even where they differ in texture.
 *
 * ── Ordering ──
 *
 * The frame's own objects take depths counted from zero, so everything here
 * sits at depths from a million up, in this order: weather in the scene, the
 * weather's tint over it, the torch glow, then the lens (blinds, black,
 * flash). The night is a camera filter and so covers all of it; a fade to
 * black stays black under it, and the flash of a critical is dimmed at night
 * as a real one would be.
 *
 * ── What is deliberately not here ──
 *
 * Nothing from `MapRenderer` is duplicated. A mood effect painted in the
 * renderer as well as here is a double application, and that bug has
 * happened twice in this codebase.
 */

import * as Phaser from 'phaser';
import type { SceneMood } from '../../DrawCommand';
import { transitionShape } from '../../DrawCommand';
import { themeLightHex } from '../../ThemeLight';
import {
  COMBAT_RELIEF,
  GLOW_RADIUS,
  OUTDOOR_NIGHT_DARKNESS,
  TORCH_RADIUS,
  UNDERGROUND_DARKNESS,
  WEATHER_TINTS,
} from '../CanvasBackend';

// ── Tunables ──

/** Everything here sits above the frame's own objects. */
const DEPTH_BASE = 1_000_000;

/** How many blinds close over the map. The same count as the other backends. */
const BLIND_COUNT = 8;

/**
 * The permanent vignette: soft, and always there, so the frame has a lens.
 *
 * Phaser's vignette is not the usual one. Its shader mixes fully to the colour
 * everywhere beyond `radius` (normalised texture space, so an ellipse on a
 * wide frame) and inside it ramps as sin(d / radius · π · strength). So a
 * radius past the corners (√½ ≈ 0.71) keeps the whole frame in the ramp, and
 * the strength alone sets how dark the corners get: 0.11 puts about a quarter
 * of black in them and a sixth at the middle of each edge.
 */
const LENS_RADIUS = 1.0;
const LENS_STRENGTH = 0.11;

/**
 * The night uses the same filter with a strength of one half, so the ramp
 * reaches the colour exactly at the radius and the outside continues it.
 * Because the outside is the colour in full, the colour itself carries how
 * dark the night is: white for none, and a blue-leaning grey scaled by the
 * darkness otherwise. Multiply-blended, so it can only take light away.
 */
const NIGHT_STRENGTH = 0.5;
const NIGHT_BLUE_LEAN = 1.12;

/** Time constant for weather fading in and out, in milliseconds. */
const WEATHER_TAU_MS = 900;

/** Longest step honoured, so a backgrounded tab does not resume with every drop teleported. */
const MAX_STEP_MS = 100;

/** Particle counts per weather. */
const RAIN_COUNT = 150;
const HEAVY_RAIN_COUNT = 260;
const SNOW_COUNT = 110;
const SAND_COUNT = 170;

/** The additive glow of the carried light underground, as a share of the darkness. */
const GLOW_ALPHA = 0.22;

/** Side of the baked radial texture. */
const RADIAL_SIZE = 256;

type ParticleKind = 'rain' | 'snow' | 'sand' | null;

interface Particle {
  x: number;
  y: number;
  /** Fall speed in pixels per second, or drift speed for sand. */
  v: number;
  /** Streak length for rain and sand; flake size for snow. */
  len: number;
  /** Per-particle phase for the sideways wander of snow. */
  phase: number;
}

/** What a weather asks of the particle field. */
function particleKind(weather: string | null): ParticleKind {
  switch (weather) {
    case 'rain':
    case 'heavy_rain':
      return 'rain';
    case 'snow':
      return 'snow';
    case 'sandstorm':
      return 'sand';
    default:
      return null;
  }
}

export class Mood {
  private readonly scene: Phaser.Scene;
  private readonly width: number;
  private readonly height: number;

  private readonly weather: Phaser.GameObjects.Graphics;
  private readonly tint: Phaser.GameObjects.Rectangle;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly blinds: Phaser.GameObjects.Rectangle[] = [];
  private readonly black: Phaser.GameObjects.Rectangle;
  private readonly white: Phaser.GameObjects.Rectangle;

  private night: Phaser.Filters.Vignette | null = null;
  private lens: Phaser.Filters.Vignette | null = null;

  private particles: Particle[] = [];
  private kind: ParticleKind = null;
  private pendingKind: ParticleKind = null;
  private weatherAlpha = 0;

  constructor(scene: Phaser.Scene, width: number, height: number) {
    this.scene = scene;
    this.width = width;
    this.height = height;

    this.weather = scene.add.graphics().setDepth(DEPTH_BASE);

    this.tint = scene.add.rectangle(0, 0, width, height, 0x000000, 0).setOrigin(0, 0).setDepth(DEPTH_BASE + 1);
    this.tint.setVisible(false);

    Mood.bakeRadial(scene);
    this.glow = scene.add.image(0, 0, 'fatefall-radial').setDepth(DEPTH_BASE + 2);
    this.glow.setBlendMode(Phaser.BlendModes.ADD);
    this.glow.setVisible(false);

    const barH = Math.ceil(height / BLIND_COUNT);
    for (let i = 0; i < BLIND_COUNT; i++) {
      const bar = scene.add.rectangle(0, i * barH, 0, barH, 0x000000, 1).setOrigin(0, 0).setDepth(DEPTH_BASE + 10);
      bar.setVisible(false);
      this.blinds.push(bar);
    }
    this.black = scene.add.rectangle(0, 0, width, height, 0x000000, 1).setOrigin(0, 0).setDepth(DEPTH_BASE + 11);
    this.black.setVisible(false);
    this.white = scene.add.rectangle(0, 0, width, height, 0xffffff, 1).setOrigin(0, 0).setDepth(DEPTH_BASE + 12);
    this.white.setVisible(false);

    // The light and the lens are camera filters. A renderer without them (the
    // Canvas fallback inside Phaser) simply goes without: the tint and the
    // transitions still work, and the world is lit like noon, which is what
    // it was before this file existed.
    try {
      const filters = scene.cameras.main.filters.internal;
      this.night = filters.addVignette(0.5, 0.5, 0.4, NIGHT_STRENGTH, 0xffffff, Phaser.BlendModes.MULTIPLY);
      this.lens = filters.addVignette(0.5, 0.5, LENS_RADIUS, LENS_STRENGTH, 0x000000, Phaser.BlendModes.NORMAL);
    } catch {
      this.night = null;
      this.lens = null;
    }
  }

  /** Recompute the mood for this frame. `elapsedMs` is the delta since the last call. */
  update(mood: SceneMood, elapsedMs: number): void {
    const dt = Math.max(0, Math.min(MAX_STEP_MS, elapsedMs));
    this.updateWeather(mood, dt);
    this.updateTint(mood);
    this.updateLight(mood);
    this.updateLens(mood);
  }

  destroy(): void {
    this.weather.destroy();
    this.tint.destroy();
    this.glow.destroy();
    for (const b of this.blinds) b.destroy();
    this.black.destroy();
    this.white.destroy();
  }

  // ── Weather ──

  private updateWeather(mood: SceneMood, dt: number): void {
    const want = particleKind(mood.weather);
    // A change of kind fades the old field out and seeds the new one at zero,
    // so rain does not turn into snow drop by drop.
    if (want !== this.kind) {
      if (this.weatherAlpha < 0.02) {
        this.kind = want;
        this.pendingKind = null;
        this.seed(mood.weather);
      } else {
        this.pendingKind = want;
      }
    }
    const target = this.kind !== null && this.pendingKind === null && want === this.kind ? 1 : 0;
    const k = 1 - Math.exp(-dt / WEATHER_TAU_MS);
    this.weatherAlpha += (target - this.weatherAlpha) * k;
    if (this.pendingKind !== null && this.weatherAlpha < 0.02) {
      this.kind = this.pendingKind;
      this.pendingKind = null;
      this.seed(mood.weather);
    }

    const g = this.weather;
    g.clear();
    if (this.kind === null || this.weatherAlpha < 0.01) {
      g.setVisible(false);
      return;
    }
    g.setVisible(true);
    const a = this.weatherAlpha * (mood.inCombat ? 0.6 : 1);
    const s = dt / 1000;
    const w = this.width;
    const h = this.height;

    if (this.kind === 'rain') {
      g.lineStyle(1, 0xbfd0e8, 0.55 * a);
      for (const p of this.particles) {
        p.y += p.v * s;
        p.x -= p.v * 0.18 * s;
        if (p.y > h + p.len) {
          p.y = -p.len - Math.random() * 40;
          p.x = Math.random() * (w + 80);
        }
        if (p.x < -10) p.x += w + 20;
        g.lineBetween(p.x, p.y, p.x - p.len * 0.18, p.y - p.len);
      }
    } else if (this.kind === 'snow') {
      g.fillStyle(0xffffff, 0.85 * a);
      for (const p of this.particles) {
        p.phase += s * 0.9;
        p.y += p.v * s;
        p.x += Math.sin(p.phase) * 14 * s;
        if (p.y > h + 4) {
          p.y = -4;
          p.x = Math.random() * w;
        }
        g.fillRect(p.x, p.y, p.len, p.len);
      }
    } else {
      g.lineStyle(1, 0xd9b370, 0.5 * a);
      for (const p of this.particles) {
        p.x += p.v * s;
        p.y += p.v * 0.12 * s;
        if (p.x > w + p.len) {
          p.x = -p.len - Math.random() * 60;
          p.y = Math.random() * h;
        }
        if (p.y > h) p.y -= h;
        g.lineBetween(p.x, p.y, p.x - p.len, p.y - p.len * 0.12);
      }
    }
  }

  private seed(weather: string | null): void {
    const kind = this.kind;
    this.particles = [];
    if (kind === null) return;
    const count = kind === 'rain' ? (weather === 'heavy_rain' ? HEAVY_RAIN_COUNT : RAIN_COUNT) : kind === 'snow' ? SNOW_COUNT : SAND_COUNT;
    for (let i = 0; i < count; i++) {
      const depth = Math.random();
      this.particles.push({
        x: Math.random() * (this.width + 80),
        y: Math.random() * this.height,
        v: kind === 'rain' ? 520 + depth * 420 : kind === 'snow' ? 28 + depth * 40 : 420 + depth * 380,
        len: kind === 'rain' ? 9 + depth * 12 : kind === 'snow' ? 1 + Math.round(depth * 2) : 14 + depth * 22,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  // ── Tint ──

  private updateTint(mood: SceneMood): void {
    const tint = mood.weather ? WEATHER_TINTS[mood.weather] : undefined;
    if (!tint) {
      this.tint.setVisible(false);
      return;
    }
    this.tint.setVisible(true);
    this.tint.setFillStyle(Phaser.Display.Color.HexStringToColor(tint.c).color, tint.a);
  }

  // ── Light ──

  private updateLight(mood: SceneMood): void {
    const night = mood.underground ? UNDERGROUND_DARKNESS : OUTDOOR_NIGHT_DARKNESS * Math.max(0, 1 - mood.daylight);
    const darkness = mood.inCombat ? night * COMBAT_RELIEF : night;
    const fx = mood.focus ? mood.focus.x : this.width / 2;
    const fy = mood.focus ? mood.focus.y : this.height / 2;

    const v = this.night;
    if (v) {
      if (darkness <= 0.01) {
        v.setColor(0xffffff);
      } else {
        const grey = Math.round(255 * (1 - darkness));
        const blue = Math.min(255, Math.round(255 * (1 - darkness) * NIGHT_BLUE_LEAN));
        v.setColor((grey << 16) | (grey << 8) | blue);
      }
      v.x = fx / this.width;
      v.y = fy / this.height;
      // The filter's radius is in normalised texture space, so one number is
      // an ellipse on a wide frame; the mean of the two sides splits the
      // difference. The torch reaches less far than the moonlight the party
      // keeps about them.
      v.radius = (mood.underground ? TORCH_RADIUS : GLOW_RADIUS) / ((this.width + this.height) / 2);
    }

    // Underground the carried light has the colour of the place, laid over the
    // lit core additively so the cave reads as torchlit rather than dimmed.
    if (mood.underground && darkness > 0.01) {
      this.glow.setVisible(true);
      this.glow.setPosition(fx, fy);
      const scale = (TORCH_RADIUS * 2) / RADIAL_SIZE;
      this.glow.setScale(scale);
      this.glow.setTint(themeLightHex(mood.themeId));
      this.glow.setAlpha(GLOW_ALPHA * darkness);
    } else {
      this.glow.setVisible(false);
    }
  }

  // ── Lens ──

  private updateLens(mood: SceneMood): void {
    const flash = mood.flash ?? 0;
    this.white.setVisible(flash > 0.005);
    this.white.setAlpha(flash);

    const t = mood.transition;
    if (!t) {
      for (const b of this.blinds) b.setVisible(false);
      this.black.setVisible(false);
      return;
    }
    const { closed, black } = transitionShape(t.kind, t.progress);
    const w = Math.round(this.width * closed);
    for (let i = 0; i < this.blinds.length; i++) {
      const bar = this.blinds[i];
      bar.setVisible(w > 0);
      bar.width = w;
      bar.x = i % 2 === 0 ? 0 : this.width - w;
    }
    this.black.setVisible(black > 0.005);
    this.black.setAlpha(black);
  }

  // ── Textures ──

  /** A soft white disc fading to nothing, for the torch glow. Baked once per scene. */
  private static bakeRadial(scene: Phaser.Scene): void {
    if (scene.textures.exists('fatefall-radial')) return;
    const tex = scene.textures.createCanvas('fatefall-radial', RADIAL_SIZE, RADIAL_SIZE);
    if (!tex) return;
    const ctx = tex.context;
    const c = RADIAL_SIZE / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, RADIAL_SIZE, RADIAL_SIZE);
    tex.refresh();
  }
}

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, PRESETS, SETTINGS_KEY, computeLayout, loadSettings, saveSettings, normalizeSettings,
  presetFor, renderFx, parseWindowSize, cloneSettings, type StorageLike,
} from '../src/settings/Settings';

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

describe('settings: normalising', () => {
  it('gives the defaults for nothing, garbage and partial objects', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ display: { scaleMode: 'sideways', uiScale: 'big' }, graphics: 7 })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps every valid field and clamps the UI scale', () => {
    const s = normalizeSettings({
      display: { windowMode: 'fullscreen', scaleMode: 'integer', uiScale: 2.5, sharp: false, windowSize: 'max' },
      graphics: { ...PRESETS.low, weather: 0.5, fpsCap: 60 },
      renderer: 'canvas',
    });
    expect(s.display).toEqual({ windowMode: 'fullscreen', scaleMode: 'integer', uiScale: 1.3, sharp: false, windowSize: 'max' });
    expect(s.graphics.weather).toBe(0.5);
    expect(s.graphics.fpsCap).toBe(60);
    expect(s.graphics.lighting).toBe(false);
    expect(s.renderer).toBe('canvas');
  });

  it('rejects a weather share or a frame cap that is not on the menu', () => {
    const s = normalizeSettings({ graphics: { weather: 0.7, fpsCap: 45 } });
    expect(s.graphics.weather).toBe(DEFAULT_SETTINGS.graphics.weather);
    expect(s.graphics.fpsCap).toBe(DEFAULT_SETTINGS.graphics.fpsCap);
  });
});

describe('settings: presets', () => {
  it('names the preset the switches match, and nothing for a mix', () => {
    for (const id of ['low', 'medium', 'high', 'ultra'] as const) expect(presetFor({ ...PRESETS[id] })).toBe(id);
    expect(presetFor({ ...PRESETS.ultra, bloom: false, fpsCap: 30 })).toBeNull();
  });

  it('the default is ultra, and the effect flags follow the switches', () => {
    expect(presetFor(DEFAULT_SETTINGS.graphics)).toBe('ultra');
    const fx = renderFx({ ...PRESETS.low });
    expect(fx).toEqual({ lighting: false, weather: 0, ambience: false, bloom: false, vignette: false, grade: false });
    expect(renderFx(PRESETS.medium).weather).toBe(0.5);
  });
});

describe('settings: storage', () => {
  it('round-trips through storage', () => {
    const store = memory();
    const s = cloneSettings(DEFAULT_SETTINGS);
    s.display.scaleMode = 'stretch';
    s.graphics.bloom = false;
    s.renderer = 'phaser';
    saveSettings(s, store);
    expect(loadSettings(store)).toEqual(s);
    expect(store.data['fatefall.renderer']).toBe('phaser');
  });

  it('honours the old renderer key when the blob has none', () => {
    const store = memory({ 'fatefall.renderer': 'canvas' });
    expect(loadSettings(store).renderer).toBe('canvas');
    const withBlob = memory({ 'fatefall.renderer': 'canvas', [SETTINGS_KEY]: JSON.stringify({ renderer: 'pixi' }) });
    expect(loadSettings(withBlob).renderer).toBe('pixi');
  });

  it('survives a corrupt blob and a missing storage', () => {
    expect(loadSettings(memory({ [SETTINGS_KEY]: '{not json' }))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('settings: layout', () => {
  const G = [1024, 768] as const;

  it('fit letterboxes at the largest scale that fits', () => {
    const l = computeLayout(1920, 1080, ...G, 'fit', 1);
    expect(l.scale).toBeCloseTo(1080 / 768);
    expect(l.canvasW).toBeCloseTo(1024 * (1080 / 768));
    expect(l.canvasH).toBe(1080);
    expect(l.uiScale).toBeCloseTo(l.scale);
  });

  it('integer uses whole multiples and falls back to fit below 1x', () => {
    const big = computeLayout(2600, 1700, ...G, 'integer', 1);
    expect(big.scale).toBe(2);
    expect(big.canvasW).toBe(2048);
    const small = computeLayout(800, 600, ...G, 'integer', 1);
    expect(small.scale).toBeCloseTo(800 / 1024);
    expect(small.canvasW).toBe(800);
  });

  it('stretch fills the window and native stays 1:1', () => {
    const st = computeLayout(1600, 900, ...G, 'stretch', 1);
    expect([st.canvasW, st.canvasH]).toEqual([1600, 900]);
    const na = computeLayout(1600, 900, ...G, 'native', 1);
    expect([na.canvasW, na.canvasH, na.scale]).toEqual([1024, 768, 1]);
  });

  it('the UI scale multiplies the picture scale but never outgrows the window', () => {
    const shrunk = computeLayout(1920, 1080, ...G, 'fit', 0.8);
    expect(shrunk.uiScale).toBeCloseTo((1080 / 768) * 0.8);
    const grown = computeLayout(1920, 1080, ...G, 'fit', 1.3);
    expect(grown.uiScale).toBeCloseTo(1080 / 768);
    const nativeGrown = computeLayout(1920, 1080, ...G, 'native', 1.3);
    expect(nativeGrown.uiScale).toBeCloseTo(1.3);
  });
});

describe('settings: window sizes', () => {
  it('parses a size and rejects the rest', () => {
    expect(parseWindowSize('1280x880')).toEqual({ width: 1280, height: 880 });
    expect(parseWindowSize('max')).toBeNull();
    expect(parseWindowSize('wide')).toBeNull();
  });
});

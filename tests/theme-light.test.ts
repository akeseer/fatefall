import { describe, it, expect } from 'vitest';
import { themeLight, themeLightHex, FLAME_LIGHT } from '../src/rendering/ThemeLight';

/**
 * The colour of the carried light per dungeon theme, read by the Pixi lighting,
 * the Pixi ambience and the Canvas fallback. These pin the contract rather than
 * the numbers: a theme leans the light toward its own glow, anything unknown is
 * plain flame, and the packed form agrees with the channels.
 */
describe('the light of a place', () => {
  it('is plain flame on the surface and for a theme it does not know', () => {
    expect(themeLight(null)).toEqual(FLAME_LIGHT);
    expect(themeLight(undefined)).toEqual(FLAME_LIGHT);
    expect(themeLight('no_such_theme')).toEqual(FLAME_LIGHT);
  });

  it('leans a known theme toward its glow without going all the way', () => {
    // A sunken temple glows teal: less red than flame, more green and blue.
    const [r, g, b] = themeLight('sunken_temple');
    expect(r).toBeLessThan(FLAME_LIGHT[0]);
    expect(g).toBeGreaterThan(FLAME_LIGHT[1]);
    expect(b).toBeGreaterThan(FLAME_LIGHT[2]);
    // But it is still lit by fire underneath: nowhere near pure teal.
    expect(r).toBeGreaterThan(0.5);
  });

  it('tells an ember place from a cold one', () => {
    const ember = themeLight('dragon_graveyard');
    const cold = themeLight('celestial_observatory');
    expect(ember[0] - ember[2]).toBeGreaterThan(cold[0] - cold[2]);
  });

  it('keeps every channel inside 0..1', () => {
    for (const id of [null, 'dragon_graveyard', 'feywild_glade', 'abyssal_rift', 'sunken_temple', 'bogus']) {
      for (const v of themeLight(id)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('packs to the same colour it reports as channels', () => {
    const [r, g, b] = themeLight('feywild_glade');
    const hex = themeLightHex('feywild_glade');
    expect((hex >> 16) & 0xff).toBe(Math.round(r * 255));
    expect((hex >> 8) & 0xff).toBe(Math.round(g * 255));
    expect(hex & 0xff).toBe(Math.round(b * 255));
  });
});

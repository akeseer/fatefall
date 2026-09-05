import { describe, it, expect } from 'vitest';
import { Ambience, ambienceLevels, NIGHT_BELOW } from '../src/audio/Ambience';

const clearDay = { weather: null, underground: false, night: false, town: false, inCombat: false };

/**
 * The levels are pure and pinned here; the audio side is checked in the
 * browser, where Node's lack of an AudioContext is exactly the silent path
 * the player also gets when the engine is unavailable.
 */
describe('ambienceLevels', () => {
  it('leaves clear skies with only a breath of wind', () => {
    const l = ambienceLevels(clearDay);
    expect(l.rain).toBe(0);
    expect(l.rumble).toBe(0);
    expect(l.cave).toBe(0);
    expect(l.crickets).toBe(0);
    expect(l.wind).toBeGreaterThan(0);
    expect(l.wind).toBeLessThan(0.2);
  });

  it('rains harder in heavy rain, with a rumble under it', () => {
    const light = ambienceLevels({ ...clearDay, weather: 'rain' });
    const heavy = ambienceLevels({ ...clearDay, weather: 'heavy_rain' });
    expect(light.rain).toBeGreaterThan(0);
    expect(heavy.rain).toBeGreaterThan(light.rain);
    expect(light.rumble).toBe(0);
    expect(heavy.rumble).toBeGreaterThan(0);
  });

  it('makes a sandstorm the loudest wind', () => {
    const kinds = ['cloudy', 'fog', 'eerie_mist', 'snow', 'rain', 'heavy_rain', 'sandstorm', 'magical_aurora'];
    const winds = kinds.map(w => ambienceLevels({ ...clearDay, weather: w }).wind);
    expect(Math.max(...winds)).toBe(ambienceLevels({ ...clearDay, weather: 'sandstorm' }).wind);
    expect(ambienceLevels({ ...clearDay, weather: 'sandstorm' }).wind).toBe(1);
  });

  it('hears only the cave underground, whatever the sky is doing', () => {
    const l = ambienceLevels({ ...clearDay, weather: 'heavy_rain', night: true, underground: true });
    expect(l.cave).toBe(1);
    expect(l.rain).toBe(0);
    expect(l.wind).toBe(0);
    expect(l.crickets).toBe(0);
  });

  it('brings crickets out on a dry night in the wild, not in town or in the rain', () => {
    expect(ambienceLevels({ ...clearDay, night: true }).crickets).toBe(1);
    expect(ambienceLevels({ ...clearDay, night: true, town: true }).crickets).toBe(0);
    expect(ambienceLevels({ ...clearDay, night: true, weather: 'rain' }).crickets).toBe(0);
    expect(ambienceLevels({ ...clearDay, night: true, weather: 'snow' }).crickets).toBe(0);
    expect(ambienceLevels({ ...clearDay, night: false }).crickets).toBe(0);
    expect(NIGHT_BELOW).toBeGreaterThan(0);
    expect(NIGHT_BELOW).toBeLessThan(1);
  });

  it('turns the weather down for a fight', () => {
    const calm = ambienceLevels({ ...clearDay, weather: 'heavy_rain' });
    const fight = ambienceLevels({ ...clearDay, weather: 'heavy_rain', inCombat: true });
    expect(fight.rain).toBeLessThan(calm.rain);
    expect(fight.rain).toBeGreaterThan(0);
    expect(fight.wind).toBeLessThan(calm.wind);
  });

  it('takes some of the wind off inside town walls', () => {
    const open = ambienceLevels({ ...clearDay, weather: 'snow' });
    const town = ambienceLevels({ ...clearDay, weather: 'snow', town: true });
    expect(town.wind).toBeLessThan(open.wind);
    expect(town.rain).toBe(open.rain);
  });
});

describe('the ambience without audio', () => {
  it('accepts every scene and stops without throwing or building anything', () => {
    const a = new Ambience();
    for (const weather of [null, 'rain', 'heavy_rain', 'snow', 'sandstorm', 'fog', 'cloudy']) {
      expect(() => a.update({ ...clearDay, weather })).not.toThrow();
    }
    expect(() => a.update({ ...clearDay, underground: true })).not.toThrow();
    expect(() => a.stop()).not.toThrow();
    expect(a.debug().built).toBe(false);
  });
});

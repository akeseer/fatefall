import { describe, it, expect } from 'vitest';
import { battleSceneCss } from '../src/ui/BattleScenes';

/** The backdrop is pure CSS from the scene; these pin that it changes with the place. */
describe('battleSceneCss', () => {
  it('gives every place a full set of layers', () => {
    for (const scene of [
      { place: 'dungeon' as const, themeId: 'royal_crypt', daylight: 1 },
      { place: 'overworld' as const, biome: 'forest', daylight: 0.8 },
      { place: 'town' as const, daylight: 0.5 },
    ]) {
      const css = battleSceneCss(scene);
      expect(css.sky).toMatch(/gradient/);
      expect(css.floor).toMatch(/gradient/);
      expect(css.horizon.length).toBeGreaterThan(0);
      expect(css.glow.length).toBeGreaterThan(0);
    }
  });

  it('draws different scenery for different dungeon themes', () => {
    const hall = battleSceneCss({ place: 'dungeon', themeId: 'ancient_dwarven_hall', daylight: 1 });
    const cave = battleSceneCss({ place: 'dungeon', themeId: 'goblin_warren', daylight: 1 });
    const glade = battleSceneCss({ place: 'dungeon', themeId: 'feywild_glade', daylight: 1 });
    expect(hall.scenery).not.toBe(cave.scenery);
    expect(cave.scenery).not.toBe(glade.scenery);
    // The horizon takes the theme's light: teal for the sunken temple, ember for the rift.
    expect(battleSceneCss({ place: 'dungeon', themeId: 'sunken_temple', daylight: 1 }).horizon)
      .not.toBe(battleSceneCss({ place: 'dungeon', themeId: 'abyssal_rift', daylight: 1 }).horizon);
    // An unknown theme still gets a hall rather than nothing.
    expect(battleSceneCss({ place: 'dungeon', themeId: 'nowhere', daylight: 1 }).scenery.length).toBeGreaterThan(0);
  });

  it('darkens the surface at night and clears it by day', () => {
    const noon = battleSceneCss({ place: 'overworld', biome: 'grassland', daylight: 1 });
    const midnight = battleSceneCss({ place: 'overworld', biome: 'grassland', daylight: 0 });
    expect(noon.weather).toBe('');
    expect(midnight.weather).toMatch(/rgba\(4,6,16/);
    expect(noon.sky).not.toBe(midnight.sky);
  });

  it('shows the weather', () => {
    const rain = battleSceneCss({ place: 'overworld', biome: 'grassland', weather: 'heavy_rain', daylight: 1 });
    const snow = battleSceneCss({ place: 'overworld', biome: 'snow', weather: 'snow', daylight: 1 });
    expect(rain.weather).toMatch(/repeating-linear-gradient/);
    expect(snow.weather).toMatch(/#fff/);
    // Underground the sky does not reach.
    expect(battleSceneCss({ place: 'dungeon', themeId: 'royal_crypt', weather: 'heavy_rain', daylight: 1 }).weather).toBe('');
  });

  it('gives each biome its own ground', () => {
    const biomes = ['grassland', 'forest', 'mountain', 'swamp', 'desert', 'snow', 'coast'];
    const floors = new Set(biomes.map(b => battleSceneCss({ place: 'overworld', biome: b, daylight: 1 }).floor));
    expect(floors.size).toBe(biomes.length);
    expect(battleSceneCss({ place: 'overworld', biome: 'unknown_place', daylight: 1 }).floor)
      .toBe(battleSceneCss({ place: 'overworld', biome: 'grassland', daylight: 1 }).floor);
  });
});

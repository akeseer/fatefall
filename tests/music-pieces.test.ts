import { describe, it, expect } from 'vitest';
import { PIECES, DUNGEON_MOOD_BY_THEME, dungeonMood, surfaceMood, type MusicMood } from '../src/audio/Music';
import { LOCATIONS } from '../src/ai/DnDKnowledge';

/**
 * Every piece is data the scheduler trusts: a step past the bar would never
 * sound, a scale degree past the scale would index nothing, and a
 * progression that is not sixteen bars would put the cadence on the wrong
 * bar. These checks are what a wrong number in a new piece would fail.
 */
describe('the score', () => {
  const moods = Object.keys(PIECES) as Exclude<MusicMood, 'none'>[];

  it('has a piece for every mood but silence', () => {
    for (const m of ['title', 'overworld', 'overworld_night', 'overworld_storm', 'overworld_forest', 'overworld_mountain', 'overworld_desert', 'overworld_swamp', 'overworld_snow', 'overworld_coast', 'town', 'town_night', 'festival', 'dungeon', 'dungeon_deep', 'dungeon_clockwork', 'dungeon_haunted', 'dungeon_wild', 'dungeon_water', 'dungeon_sky', 'dungeon_sand', 'dungeon_fire', 'dungeon_abyss', 'dungeon_arcane', 'dungeon_den', 'dungeon_dragon', 'battle', 'boss', 'victory']) {
      expect(moods, m).toContain(m);
    }
  });

  it('keeps every step inside the bar and every degree inside the scale', () => {
    for (const mood of moods) {
      const p = PIECES[mood];
      const steps = p.stepsPerBeat * p.beatsPerBar;
      expect(p.progression.length, `${mood} progression`).toBe(16);
      for (const d of p.progression) expect(d, `${mood} degree`).toBeLessThan(p.scale.length);
      expect(p.scale.length, `${mood} scale`).toBe(7);
      for (const [step, len] of p.bass.pattern) {
        expect(step, `${mood} bass step`).toBeLessThan(steps);
        expect(step + len, `${mood} bass end`).toBeLessThanOrEqual(steps);
      }
      for (const phrase of [...p.lead.phrases, ...p.lead.cadence]) {
        for (const [step, len] of phrase) {
          expect(step, `${mood} lead step`).toBeLessThan(steps);
          expect(step + len, `${mood} lead end`).toBeLessThanOrEqual(steps);
        }
      }
      if (p.drums) {
        for (const list of [p.drums.kick, p.drums.snare, p.drums.hat, p.drums.openHat]) {
          for (const s of list) expect(s, `${mood} drum step`).toBeLessThan(steps);
        }
      }
      expect(p.bpm, `${mood} bpm`).toBeGreaterThan(30);
      expect(p.lead.density, `${mood} density`).toBeLessThanOrEqual(1);
    }
  });

  it('names a mood for every dungeon theme in the game, and every mood it names exists', () => {
    for (const loc of LOCATIONS) expect(DUNGEON_MOOD_BY_THEME[loc.id], loc.id).toBeDefined();
    for (const mood of Object.values(DUNGEON_MOOD_BY_THEME)) expect(moods).toContain(mood);
    expect(dungeonMood('dragon_graveyard', 1)).toBe('dungeon_dragon');
    expect(dungeonMood('no_such_place', 1)).toBe('dungeon');
    expect(dungeonMood('no_such_place', 5)).toBe('dungeon_deep');
    expect(dungeonMood(null, 2)).toBe('dungeon');
  });

  it('picks the surface by storm, then night, then biome', () => {
    expect(surfaceMood('forest', 0.9, 'thunderstorm')).toBe('overworld_storm');
    expect(surfaceMood('forest', 0.1, null)).toBe('overworld_night');
    expect(surfaceMood('forest', 0.9, 'rain')).toBe('overworld_forest');
    expect(surfaceMood('mountain', 0.9, null)).toBe('overworld_mountain');
    expect(surfaceMood('desert', 0.9, null)).toBe('overworld_desert');
    expect(surfaceMood('swamp', 0.9, null)).toBe('overworld_swamp');
    expect(surfaceMood('snow', 0.9, null)).toBe('overworld_snow');
    expect(surfaceMood('coast', 0.9, null)).toBe('overworld_coast');
    expect(surfaceMood('grassland', 0.9, null)).toBe('overworld');
    expect(surfaceMood(null, 0.9, null)).toBe('overworld');
  });

  it('gives each piece its own seed, so two on the same bar make different choices', () => {
    const seeds = moods.map(m => PIECES[m].seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

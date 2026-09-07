import { describe, it, expect } from 'vitest';
import { PIECES, type MusicMood } from '../src/audio/Music';

/**
 * Every piece is data the scheduler trusts: a step past the bar would never
 * sound, a scale degree past the scale would index nothing, and a
 * progression that is not sixteen bars would put the cadence on the wrong
 * bar. These checks are what a wrong number in a new piece would fail.
 */
describe('the score', () => {
  const moods = Object.keys(PIECES) as Exclude<MusicMood, 'none'>[];

  it('has a piece for every mood but silence', () => {
    for (const m of ['title', 'overworld', 'overworld_night', 'overworld_storm', 'town', 'town_night', 'festival', 'dungeon', 'dungeon_deep', 'dungeon_clockwork', 'dungeon_haunted', 'dungeon_wild', 'dungeon_water', 'dungeon_sky', 'dungeon_sand', 'battle', 'boss', 'victory']) {
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

  it('gives each piece its own seed, so two on the same bar make different choices', () => {
    const seeds = moods.map(m => PIECES[m].seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

/**
 * DayNightSystem — a slow, persistent day/night cycle over the overworld.
 *
 * Each in-game day lasts DAY_MS real milliseconds. Time of day is expressed
 * as 0..1 across the full cycle (0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 =
 * midnight). The cycle drives the light level the renderer uses, when certain
 * creatures stir, and mechanical tints (darkness penalty, night predators).
 */

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

/** Real milliseconds for one full in-game day. */
export const DAY_MS = 180_000; // 3 minutes of real time per game-day
/** Time of day at which the cycle starts when a new run begins. */
export const CYCLE_START = 0.08; // mid-morning

export interface ClockState {
  /** Phase of the day cycle in [0, 1). */
  phase: number;
  /** Continuous elapsed ms since the run's calendar began. */
  elapsed: number;
  /** Which named part of the day we're in. */
  timeOfDay: TimeOfDay;
  /** 0 = pitch black, 1 = full daylight. */
  light: number;
}

/** The named bracket for a phase value (0 = dawn ... 0.75 = midnight). */
export function timeOfDayFromPhase(phase: number): TimeOfDay {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.1) return 'dawn';
  if (p < 0.4) return 'day';
  if (p < 0.6) return 'dusk';
  return 'night';
}

/** Light level (0..1) from phase — brightest at noon, darkest at midnight. */
export function lightFromPhase(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  // Cosine-ish ramp peaking at 0.25 (noon).
  return Math.max(0.08, Math.min(1, 0.5 - 0.55 * Math.cos(p * Math.PI * 2)));
}

/** Build a clock for the start of a run. */
export function createClock(): ClockState {
  const phase = CYCLE_START;
  return {
    phase,
    elapsed: CYCLE_START * DAY_MS,
    timeOfDay: timeOfDayFromPhase(phase),
    light: lightFromPhase(phase),
  };
}

/** Advance the clock by a real-time dt in ms. */
export function tickClock(clock: ClockState, dtMs: number): ClockState {
  const elapsed = clock.elapsed + dtMs;
  const phaseRaw = (elapsed % DAY_MS) / DAY_MS;
  const phase = ((phaseRaw % 1) + 1) % 1;
  return {
    phase,
    elapsed,
    timeOfDay: timeOfDayFromPhase(phase),
    light: lightFromPhase(phase),
  };
}

/** A short narration line for dramatic day/time transitions. */
export function dayChangeNarration(from: TimeOfDay, to: TimeOfDay): string | null {
  if (from === to) return null;
  const lines: Record<TimeOfDay, string[]> = {
    dawn: [
      'The first grey light of dawn breaks over the hills. Stars fade one by one.',
      'Dawn spills gold across the horizon. The night\'s beasts slink back to cover.',
    ],
    day: [
      'The sun climbs high. The land is bright and the road is clear.',
      'Noon light floods the world. Travel is easy and warm.',
    ],
    dusk: [
      'The sun sinks low, throwing long shadows across the wilds.',
      'Dusk gathers. Fires begin to glimmer far off in the dark.',
    ],
    night: [
      'Night falls. The stars wheel overhead, cold and indifferent.',
      'Darkness closes in. Shapes move at the edge of the lantern-light.',
    ],
  };
  const arr = lines[to];
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Minimum light below which the party suffers a visibility tax in the dark. */
export const NIGHT_VISIBILITY_LIGHT = 0.32;
/**
 * CalendarSystem — named days, moon phases, and market/sacred days derived
 * deterministically from the day/night clock's elapsed time. Nothing here
 * needs its own saved state: it is a pure function of the clock, so a run's
 * calendar never drifts from the sky overhead.
 *
 * The year is split into canonical 5e-flavored named days. A cycle of days
 * (a "moon") runs ~10 day/night periods (DAYS_PER_MOON below). The moon's
 * phase and the day's market/sacred significance fall out of arithmetic.
 */

import { DAY_MS } from './DayNightSystem';

/** In-game days it takes to complete one full calendar week. */
export const DAYS_PER_WEEK = 7;
/** In-game days per full moon cycle (weekdays + market/sacred rhythm). */
export const DAYS_PER_MOON = 10;

/** Canonical named days of the week (Flavored for our Wilderlands). */
export const WEEKDAYS = [
  'Sunwater',   // 0 — market day (rest, trade)
  'Morrow',     // 1
  'Tallow',     // 2
  'Iron',       // 3
  'Hearth',     // 4 — sacred day (temples, blessing)
  'Windsday',   // 5
  'Gloom',      // 6 — dark day (restless dead)
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Moon phases by the 10-day cycle. */
export type MoonPhase =
  | 'new_moon' | 'waxing_crescent' | 'first_quarter'
  | 'waxing_gibbous' | 'full_moon'
  | 'waning_gibbous' | 'last_quarter' | 'waning_crescent';

export interface CalendarDay {
  /** Index into WEEKDAYS (0..6). */
  weekdayIndex: number;
  weekday: Weekday;
  /** Is today one of the two seasonal market days every week? */
  isMarketday: boolean;
  /** The temple's sacred day — blessings are stronger and healing cheaper. */
  isSacredDay: boolean;
  /** Gloom day — the veil between worlds is thin; undead stir more easily. */
  isGloomDay: boolean;
  /** Moon phase for the current night, 0 = new, 1 = full. */
  moonPhase: MoonPhase;
  /** Moon illumination 0..1 (drives lycanthrope/slink mechanics). */
  moonLight: number;
  /** Which week of the cycle we're in (for lore/narration). */
  dayInMoon: number;
}

/** Turn a moon-phase index (0..7) into its display phase. */
const PHASES: MoonPhase[] = [
  'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous',
  'full_moon', 'waning_gibbous', 'last_quarter', 'waning_crescent',
];

/** Moon illumination: peaks at the full moon, drops to nothing at new. */
function moonLightForDay(dayInMoon: number): number {
  // dayInMoon runs 0..DAYS_PER_MOON-1; illuminate with cosine peaking at 5.
  return Math.max(0, Math.cos(((dayInMoon - 5) / DAYS_PER_MOON) * Math.PI * 2));
}

/** Derive the full calendar day from the clock's accumulated elapsed ms. */
export function calendarFromElapsed(elapsedMs: number): CalendarDay {
  const dayIndex = Math.floor(elapsedMs / DAY_MS);
  const weekdayIndex = ((dayIndex % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const dayInMoon = ((dayIndex % DAYS_PER_MOON) + DAYS_PER_MOON) % DAYS_PER_MOON;
  const weekday = WEEKDAYS[weekdayIndex];
  // Market day = Sunwater + Tallow (fresh goods each market turn).
  const isMarketday = weekdayIndex === 0 || weekdayIndex === 2;
  const isSacredDay = weekdayIndex === 4;
  const isGloomDay = weekdayIndex === 6;
  const phaseIdx = Math.round((dayInMoon / DAYS_PER_MOON) * 8) % 8;
  return {
    weekdayIndex,
    weekday,
    isMarketday,
    isSacredDay,
    isGloomDay,
    moonPhase: PHASES[phaseIdx],
    moonLight: moonLightForDay(dayInMoon),
    dayInMoon,
  };
}
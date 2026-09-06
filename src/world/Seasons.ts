/**
 * Seasons: forty days to the year, ten to each. Pure.
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const DAYS_PER_SEASON = 10;

export function seasonFor(dayIndex: number): Season {
  const i = Math.floor(Math.max(0, dayIndex) / DAYS_PER_SEASON) % 4;
  return (['spring', 'summer', 'autumn', 'winter'] as Season[])[i];
}

/** What the markets make of the season. */
export function seasonPriceMod(season: Season): number {
  switch (season) {
    case 'winter': return 1.15;
    case 'autumn': return 0.9;
    default: return 1;
  }
}

/** A line for the day the season turns. */
export function seasonLine(season: Season): string {
  switch (season) {
    case 'spring': return '🌱 The season turns to spring. The roads are mud and the markets are thin, but everything is growing.';
    case 'summer': return '☀ The season turns to summer. Long days, dry roads, and the wilds awake.';
    case 'autumn': return '🍂 The season turns to autumn. The harvest is in and the markets are full and cheap.';
    case 'winter': return '❄ The season turns to winter. Prices climb, the roads are hard, and the nights are long.';
  }
}

/** Overworld tile colours by season, for the few tiles that change. */
export const SEASON_TILES: Record<Season, Record<string, string>> = {
  spring: { grass: '#3a6b2f', forest: '#245030', swamp: '#2f5233' },
  summer: { grass: '#2d5a2d', forest: '#1e4024', swamp: '#2a4a2e' },
  autumn: { grass: '#6a5a2a', forest: '#5a3a1e', swamp: '#3e4a2a' },
  winter: { grass: '#b8bec4', forest: '#4a5a5e', swamp: '#5a6a6a' },
};

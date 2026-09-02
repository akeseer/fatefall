/**
 * Central dice-roll event bus.
 *
 * Every meaningful roll in the game — attacks, saving throws, death saves,
 * initiative, damage, hit dice, and free DM rolls — is published here, and
 * the DiceTray renders them live so dice are always a visible part of the
 * action. Nothing here touches the DOM; it is a pure observer registry.
 */

export type DiceOutcome = 'crit' | 'fumble' | 'success' | 'failure' | 'neutral' | 'none';

/** The seven standard D&D polyhedra. */
export type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export interface DiceRollEvent {
  kind: 'attack' | 'save' | 'check' | 'damage' | 'death-save' | 'initiative' | 'hit-die' | 'free';
  /** Which die is the primary visual — the big 3D model shown for DM rolls. */
  diceType: DiceType;
  /** Who rolled and why, e.g. "Kael attacks Goblin (AC 15)". */
  label: string;
  /** Human-readable expression, e.g. "d20+4" or "2d10+3". */
  expression: string;
  /** Raw die results (d20s for checks; totals for damage-style rolls). */
  rolls: number[];
  /** Final result after modifiers. */
  total: number;
  outcome: DiceOutcome;
  time: number;
}

const MAX_HISTORY = 60;
let history: DiceRollEvent[] = [];

const stats = {
  rolls: 0,
  crits: 0,
  fumbles: 0,
  /** Per-die-type totals. */
  byType: {} as Record<DiceType, number>,
  /** Per-dungeon-floor totals (keyed by dungeon level). */
  byFloor: {} as Record<number, { rolls: number; crits: number; fumbles: number }>,
  /** Current consecutive run of crits / fumbles, and the best seen. */
  critStreak: 0,
  fumbleStreak: 0,
  bestCritStreak: 0,
  bestFumbleStreak: 0,
};
/** Which dungeon floor the next rolls belong to. */
let currentFloor = 1;

const listeners = new Set<(e: DiceRollEvent) => void>();

/** Point the per-floor bucket at a new dungeon level (called on floor change). */
export function setDiceFloor(level: number): void {
  currentFloor = Math.max(1, Math.floor(level));
  if (!stats.byFloor[currentFloor]) stats.byFloor[currentFloor] = { rolls: 0, crits: 0, fumbles: 0 };
}

export function pushDiceRoll(e: Omit<DiceRollEvent, 'time'>): DiceRollEvent {
  const event: DiceRollEvent = { ...e, time: Date.now() };
  history.push(event);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

  stats.rolls++;
  stats.byType[event.diceType] = (stats.byType[event.diceType] || 0) + 1;
  if (!stats.byFloor[currentFloor]) stats.byFloor[currentFloor] = { rolls: 0, crits: 0, fumbles: 0 };
  const floor = stats.byFloor[currentFloor];
  floor.rolls++;

  if (event.outcome === 'crit') {
    stats.crits++;
    floor.crits++;
    stats.critStreak++;
    stats.fumbleStreak = 0;
    if (stats.critStreak > stats.bestCritStreak) stats.bestCritStreak = stats.critStreak;
  } else if (event.outcome === 'fumble') {
    stats.fumbles++;
    floor.fumbles++;
    stats.fumbleStreak++;
    stats.critStreak = 0;
    if (stats.fumbleStreak > stats.bestFumbleStreak) stats.bestFumbleStreak = stats.fumbleStreak;
  } else {
    stats.critStreak = 0;
    stats.fumbleStreak = 0;
  }

  for (const fn of listeners) fn(event);
  return event;
}

export function onDiceRoll(fn: (e: DiceRollEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getDiceHistory(): DiceRollEvent[] {
  return [...history];
}

export interface DiceStats {
  rolls: number;
  crits: number;
  fumbles: number;
  byType: Record<string, number>;
  byFloor: Record<number, { rolls: number; crits: number; fumbles: number }>;
  critStreak: number;
  fumbleStreak: number;
  bestCritStreak: number;
  bestFumbleStreak: number;
}

export function getDiceStats(): DiceStats {
  const byFloor: DiceStats['byFloor'] = {};
  for (const [k, v] of Object.entries(stats.byFloor)) byFloor[Number(k)] = { ...v };
  return { ...stats, byType: { ...stats.byType }, byFloor };
}

/** Parse a dice expression like "2d6+3" or "d20" into count, sides, modifier. */
export function parseDiceExpr(expr: string): { count: number; sides: number; mod: number; type: DiceType } | null {
  const m = expr.toLowerCase().replace(/\s/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1]) : 1;
  const sides = parseInt(m[2]);
  const mod = m[3] ? parseInt(m[3]) : 0;
  const typeMap: Record<number, DiceType> = { 4: 'd4', 6: 'd6', 8: 'd8', 10: 'd10', 12: 'd12', 20: 'd20', 100: 'd100' };
  const type = typeMap[sides] ?? 'd20';
  return { count, sides, mod, type };
}

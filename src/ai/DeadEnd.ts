/**
 * The fail-safe for a party going in circles.
 *
 * The exploration brain is good at finding the next room and bad at
 * noticing when there is no next room worth finding: a floor whose boss is
 * gone but whose posting still says "slay the boss", a bottom floor with
 * every room seen, a corridor knot the wander logic never escapes. The game
 * counts AI ticks since the delve last made progress (a new room, a kill,
 * a fight, a floor) and, when the count runs long, asks this module what to
 * do. It is pure so the ladder of decisions can be tested.
 */

/** AI ticks of wandering before the party stops and reads the map instead. */
export const STUCK_SOFT_TICKS = 90;

/** AI ticks of wandering before the floor is declared a dead end and resolved. */
export const STUCK_HARD_TICKS = 220;

export interface DeadEndState {
  /** The active posting's kind and floor, if any. */
  quest: { kind: string; targetFloor: number; completed: boolean } | null;
  floor: number;
  bossAlive: boolean;
  bossSlain: boolean;
  hasStairs: boolean;
  roomsUnvisited: number;
}

export type DeadEndResolution =
  /** The posting wants a boss on this floor and there is none: raise one. */
  | 'raise_boss'
  /** The posting's boss is on this floor and the party is not finding it: march straight to it. */
  | 'hunt_boss'
  /** There is a way down and reason to take it. */
  | 'descend'
  /** Nothing left here: climb out. */
  | 'leave';

/**
 * What to do with a floor the party cannot get anywhere on. A missing boss
 * the posting still asks for is conjured rather than left to haunt the
 * quest log; otherwise the party goes down if it can and out if it cannot.
 */
export function resolveDeadEnd(s: DeadEndState): DeadEndResolution {
  const q = s.quest;
  if (q && !q.completed && q.kind === 'slay_boss' && s.floor >= q.targetFloor && !s.bossSlain) {
    return s.bossAlive ? 'hunt_boss' : 'raise_boss';
  }
  if (s.hasStairs) return 'descend';
  return 'leave';
}

/** Whether the tick count has reached the soft or hard threshold. */
export function stuckStage(idleTicks: number): 0 | 1 | 2 {
  if (idleTicks >= STUCK_HARD_TICKS) return 2;
  if (idleTicks >= STUCK_SOFT_TICKS) return 1;
  return 0;
}

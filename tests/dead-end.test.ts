import { describe, it, expect } from 'vitest';
import { resolveDeadEnd, stuckStage, STUCK_SOFT_TICKS, STUCK_HARD_TICKS } from '../src/ai/DeadEnd';

const base = { quest: null, floor: 3, bossAlive: false, bossSlain: false, hasStairs: false, roomsUnvisited: 0 };

/** The fail-safe against a party going in circles: what it does with a dead-end floor. */
describe('resolveDeadEnd', () => {
  it('raises the boss a slay posting still wants when none is on the floor', () => {
    expect(resolveDeadEnd({ ...base, quest: { kind: 'slay_boss', targetFloor: 3, completed: false } })).toBe('raise_boss');
    // Not on a shallower floor than the posting names.
    expect(resolveDeadEnd({ ...base, floor: 2, hasStairs: true, quest: { kind: 'slay_boss', targetFloor: 3, completed: false } })).toBe('descend');
    // Not when the boss is already dead, or still standing somewhere.
    expect(resolveDeadEnd({ ...base, bossSlain: true, quest: { kind: 'slay_boss', targetFloor: 3, completed: false } })).toBe('leave');
    // A boss that is somewhere on the floor is hunted, not left.
    expect(resolveDeadEnd({ ...base, bossAlive: true, quest: { kind: 'slay_boss', targetFloor: 3, completed: false } })).toBe('hunt_boss');
  });

  it('takes the stairs when there are any, and climbs out when there are none', () => {
    expect(resolveDeadEnd({ ...base, hasStairs: true })).toBe('descend');
    expect(resolveDeadEnd({ ...base, hasStairs: false })).toBe('leave');
    expect(resolveDeadEnd({ ...base, hasStairs: true, quest: { kind: 'reach_floor', targetFloor: 5, completed: false } })).toBe('descend');
  });

  it('climbs by stages', () => {
    expect(stuckStage(0)).toBe(0);
    expect(stuckStage(STUCK_SOFT_TICKS - 1)).toBe(0);
    expect(stuckStage(STUCK_SOFT_TICKS)).toBe(1);
    expect(stuckStage(STUCK_HARD_TICKS)).toBe(2);
  });
});

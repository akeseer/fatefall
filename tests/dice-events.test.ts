import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDiceExpr, pushDiceRoll, onDiceRoll, getDiceHistory, getDiceStats, setDiceFloor, resetDiceEvents,
} from '../src/rules/DiceEvents';

describe('parseDiceExpr', () => {
  it('parses plain and full expressions', () => {
    expect(parseDiceExpr('d20')).toEqual({ count: 1, sides: 20, mod: 0, type: 'd20' });
    expect(parseDiceExpr('2d6+3')).toEqual({ count: 2, sides: 6, mod: 3, type: 'd6' });
    expect(parseDiceExpr('4D8-2')).toEqual({ count: 4, sides: 8, mod: -2, type: 'd8' });
    expect(parseDiceExpr(' 1 d 100 ')).toEqual({ count: 1, sides: 100, mod: 0, type: 'd100' });
  });

  it('maps unknown sides to d20 for the visual', () => {
    expect(parseDiceExpr('3d7')!.type).toBe('d20');
    expect(parseDiceExpr('3d7')!.sides).toBe(7);
  });

  it('rejects junk', () => {
    expect(parseDiceExpr('roll d20')).toBeNull();
    expect(parseDiceExpr('d')).toBeNull();
    expect(parseDiceExpr('2d6+')).toBeNull();
    expect(parseDiceExpr('')).toBeNull();
  });
});

describe('dice event bus', () => {
  beforeEach(() => resetDiceEvents());

  type Outcome = 'crit' | 'fumble' | 'success' | 'failure' | 'neutral' | 'none';
  const roll = (outcome: Outcome, diceType: 'd20' | 'd6' = 'd20') =>
    pushDiceRoll({ kind: 'attack', diceType, label: 't', expression: 'd20', rolls: [10], total: 10, outcome });

  it('notifies listeners and keeps history', () => {
    const seen: number[] = [];
    const off = onDiceRoll(e => seen.push(e.total));
    roll('success');
    off();
    roll('failure');
    expect(seen).toEqual([10]);
    expect(getDiceHistory()).toHaveLength(2);
  });

  it('caps history at 60', () => {
    for (let i = 0; i < 70; i++) roll('neutral');
    expect(getDiceHistory()).toHaveLength(60);
    expect(getDiceStats().rolls).toBe(70);
  });

  it('tracks streaks, per-type and per-floor tallies', () => {
    setDiceFloor(2);
    roll('crit'); roll('crit'); roll('fumble'); roll('success', 'd6');
    setDiceFloor(3);
    roll('fumble'); roll('fumble');
    const s = getDiceStats();
    expect(s.crits).toBe(2);
    expect(s.fumbles).toBe(3);
    expect(s.bestCritStreak).toBe(2);
    expect(s.bestFumbleStreak).toBe(2);
    expect(s.fumbleStreak).toBe(2);
    expect(s.critStreak).toBe(0);
    expect(s.byType).toEqual({ d20: 5, d6: 1 });
    expect(s.byFloor[2]).toEqual({ rolls: 4, crits: 2, fumbles: 1 });
    expect(s.byFloor[3]).toEqual({ rolls: 2, crits: 0, fumbles: 2 });
  });

  it('returns copies from getDiceStats', () => {
    roll('crit');
    const s = getDiceStats();
    s.byType.d20 = 99;
    expect(getDiceStats().byType.d20).toBe(1);
  });
});

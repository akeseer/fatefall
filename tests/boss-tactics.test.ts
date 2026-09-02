import { describe, it, expect } from 'vitest';
import { pickLegendaryAction, advanceToward } from '../src/combat/TargetAI';

const claw = { name: 'Claw', damage: '2d6', cost: 1 };
const tail = { name: 'Tail', damage: '2d8+3', cost: 1 };
const fear = { name: 'Frightful Word', condition: 'frightened', cost: 1 };
const wing = { name: 'Wing Buffet', condition: 'prone', damage: '1d6', cost: 2 };

describe('pickLegendaryAction', () => {
  it('finishes the dying with its biggest pure-damage option', () => {
    const pick = pickLegendaryAction([claw, tail, fear], { someoneDying: true, healerStanding: false, bossHpPct: 1 });
    expect(pick).toBe(tail); // 2d8+3 out-paces 2d6
  });

  it('silences the healer with a control effect while healthy', () => {
    let control = 0;
    for (let i = 0; i < 40; i++) {
      const pick = pickLegendaryAction([claw, tail, fear], { someoneDying: false, healerStanding: true, bossHpPct: 0.9 });
      if (pick === fear) control++;
    }
    // 70% control bias — over 40 trials, control should dominate.
    expect(control).toBeGreaterThan(15);
  });

  it('escalates to maximum damage when bloodied', () => {
    const pick = pickLegendaryAction([claw, tail, wing], { someoneDying: false, healerStanding: false, bossHpPct: 0.3 });
    expect(pick).toBe(tail);
  });

  it('returns the only option without ceremony', () => {
    const pick = pickLegendaryAction([claw], { someoneDying: true, healerStanding: true, bossHpPct: 0.1 });
    expect(pick).toBe(claw);
  });
});

describe('advanceToward', () => {
  it('walks the longer axis first', () => {
    const r = advanceToward({ x: 0, y: 0 }, { x: 5, y: 1 }, 3);
    expect(r.tile).toEqual({ x: 3, y: 0 });
    expect(r.steps).toBe(3);
  });

  it('stops adjacent to the target (distance 1), never on top of it', () => {
    const r = advanceToward({ x: 0, y: 0 }, { x: 2, y: 0 }, 10);
    expect(r.tile).toEqual({ x: 1, y: 0 });
  });

  it('respects the step budget (speed cap)', () => {
    const r = advanceToward({ x: 0, y: 0 }, { x: 9, y: 9 }, 2);
    expect(r.steps).toBe(2);
    expect(Math.abs(r.tile.x) + Math.abs(r.tile.y)).toBeLessThanOrEqual(2);
  });

  it('does not move when already adjacent', () => {
    const r = advanceToward({ x: 4, y: 4 }, { x: 5, y: 4 }, 3);
    expect(r.steps).toBe(0);
    expect(r.tile).toEqual({ x: 4, y: 4 });
  });
});

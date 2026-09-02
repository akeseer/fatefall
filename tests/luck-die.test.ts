import { describe, it, expect, beforeEach } from 'vitest';
import { grantLuckDie, getLuckDie, consumeLuckDieIfAny, onLuckDieSpent } from '../src/rules/LuckDie';

describe('LuckDie', () => {
  beforeEach(() => {
    grantLuckDie(null);
    onLuckDieSpent(() => {});
  });

  it('starts empty', () => {
    expect(getLuckDie()).toBeNull();
    expect(consumeLuckDieIfAny('Kael')).toBeNull();
  });

  it('banks a die and returns a copy', () => {
    grantLuckDie({ value: 17, source: 'roll d20' });
    const d = getLuckDie();
    expect(d).toEqual({ value: 17, source: 'roll d20' });
    d!.value = 1;
    expect(getLuckDie()!.value).toBe(17);
  });

  it('replaces a pending die', () => {
    grantLuckDie({ value: 3, source: 'a' });
    grantLuckDie({ value: 20, source: 'b' });
    expect(getLuckDie()).toEqual({ value: 20, source: 'b' });
  });

  it('consumes once and reports the spend', () => {
    const spent: string[] = [];
    onLuckDieSpent((d, roller) => spent.push(`${roller}:${d.value}`));
    grantLuckDie({ value: 12, source: 'roll d20' });
    expect(consumeLuckDieIfAny('Mira')).toEqual({ value: 12, source: 'roll d20' });
    expect(consumeLuckDieIfAny('Mira')).toBeNull();
    expect(spent).toEqual(['Mira:12']);
  });
});

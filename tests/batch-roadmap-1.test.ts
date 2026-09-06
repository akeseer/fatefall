import { describe, it, expect } from 'vitest';
import { parsePolicyOrder, describePolicies, DEFAULT_POLICIES } from '../src/ai/DmPolicies';
import { summarizeFight } from '../src/combat/FightSummary';
import { bossOpening, bossBloodied } from '../src/combat/BossVoice';

describe('standing orders', () => {
  it('reads tolls, parley and loot orders in plain words', () => {
    expect(parsePolicyOrder('never pay tolls')!.change).toEqual({ tolls: 'refuse' });
    expect(parsePolicyOrder("don't pay the toll")!.change).toEqual({ tolls: 'refuse' });
    expect(parsePolicyOrder('always pay tolls')!.change).toEqual({ tolls: 'pay' });
    expect(parsePolicyOrder('always parley')!.change).toEqual({ parley: 'always' });
    expect(parsePolicyOrder('never talk')!.change).toEqual({ parley: 'never' });
    expect(parsePolicyOrder('always loot everything')!.change).toEqual({ loot: 'all' });
    expect(parsePolicyOrder('never loot everything')!.change).toEqual({ loot: 'valuables' });
    expect(parsePolicyOrder('forget the standing orders')!.change).toEqual(DEFAULT_POLICIES);
  });

  it('leaves ordinary orders alone', () => {
    for (const t of ['move north', 'never mind', 'attack', 'always', 'rest', 'pay the smith']) {
      expect(parsePolicyOrder(t)).toBeNull();
    }
  });

  it('describes the orders in force', () => {
    expect(describePolicies(DEFAULT_POLICIES)).toEqual([]);
    expect(describePolicies({ tolls: 'refuse', parley: 'always', loot: 'valuables' })).toEqual(['never pays tolls', 'always parleys', 'loots only valuables']);
  });
});

describe('the fight in numbers', () => {
  it('sums damage by side, counts crits and kills, and finds the hardest blow', () => {
    const s = summarizeFight([
      'Goblin takes 7 damage (0/7 HP)', 'Goblin is slain!', 'Ana takes 4 damage (10/14 HP)',
      'Orc takes 12 damage. CRITICAL!', 'Ana takes 9 damage (1/14 HP)', 'Orc is slain!',
    ], ['Ana', 'Bo'], 3);
    expect(s).toMatchObject({ rounds: 3, dealt: 19, taken: 13, crits: 1, kills: 2, hardest: { amount: 12, victim: 'Orc' } });
    expect(s.line).toContain('3 rounds');
    expect(s.line).toContain('19 dealt');
    expect(s.line).toContain('Hardest blow: 12 to Orc');
  });

  it('copes with an empty log', () => {
    expect(summarizeFight([], ['Ana'], 1)).toMatchObject({ dealt: 0, taken: 0, hardest: null });
  });
});

describe('bosses that talk', () => {
  it('speak by kind, and the same boss keeps its voice', () => {
    const a = bossOpening('The Lich', 'undead', 'm1');
    expect(a).toBe(bossOpening('The Lich', 'undead', 'm1'));
    expect(a).toContain('The Lich');
    expect(bossOpening('Wolf', 'beast', 'm2')).not.toMatch(/"/);
    expect(bossBloodied('The Lich', 'undead', 'm1')).toContain('bloodied');
    expect(bossOpening('Vampire', 'vampire', 'm3')).toMatch(/"/);
    expect(bossOpening('Thing', 'never_heard_of_it', 'm4')).toMatch(/"/);
  });
});

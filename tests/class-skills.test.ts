import { describe, it, expect } from 'vitest';
import { classifyFx } from '../src/ui/BattleFx';
import { naturalRollOf } from '../src/rules/DiceEvents';

/** The new class skills, as the battle window reads them, and the die that lands on what it rolled. */
describe('class skill narration', () => {
  it('is read into the right effect', () => {
    expect(classifyFx('✝ Kael smites Ghoul — holy light pours down the blade, and the unholy thing screams!')[0])
      .toMatchObject({ kind: 'ability', ability: 'divine_smite', actor: 'Kael', target: 'Ghoul', element: 'radiant' });
    expect(classifyFx('✨ Mira channels divinity — a burst of radiance scours the field!')[0])
      .toMatchObject({ ability: 'channel_divinity', actor: 'Mira', aoe: true });
    expect(classifyFx('🌀 Vex lets loose a Chaos Surge — raw magic leaps between Bandit and Goblin!')[0])
      .toMatchObject({ ability: 'chaos_surge', actor: 'Vex', target: 'Bandit', element: 'force' });
    expect(classifyFx('🐾 Lyra takes a Wild Shape — bone and sinew remade, claws for 3 rounds! (+2 damage)')[0])
      .toMatchObject({ ability: 'wild_shape', actor: 'Lyra' });
    expect(classifyFx('🎵 Grom uses Bardic Inspiration — a rousing verse, and the party\'s blades find their nerve!')[0])
      .toMatchObject({ ability: 'bardic_inspiration', actor: 'Grom' });
    expect(classifyFx('📖 Sera uses Arcane Recovery — a 1st-level slot returns, the formula re-read from memory.')[0])
      .toMatchObject({ ability: 'arcane_recovery', actor: 'Sera' });
    expect(classifyFx('🎯 Thorn hexes Wight — every hit against it bites for +1d6!')[0])
      .toMatchObject({ ability: 'eldritch_hex', actor: 'Thorn', target: 'Wight' });
  });
});

describe('naturalRollOf', () => {
  const ev = (expression: string, total: number, rolls: number[]) => ({ expression, total, rolls });
  it('takes the modifier back off a single die', () => {
    expect(naturalRollOf(ev('d20+4', 17, [13]))).toBe(13);
    expect(naturalRollOf(ev('1d20-2', 1, [3]))).toBe(3);
    expect(naturalRollOf(ev('d20', 20, [20]))).toBe(20);
    expect(naturalRollOf(ev('d8+3', 9, [6]))).toBe(6);
  });
  it('uses the kept die when advantage rolled two', () => {
    expect(naturalRollOf(ev('d20+5', 23, [11, 18]))).toBe(18);
  });
  it('has no single face for several dice', () => {
    expect(naturalRollOf(ev('2d6+3', 11, [8]))).toBeNull();
    expect(naturalRollOf(ev('8d6', 27, [27]))).toBeNull();
  });
  it('falls back to the last roll when the arithmetic does not land on a face', () => {
    expect(naturalRollOf(ev('d20+4', 99, [7]))).toBe(7);
  });
});

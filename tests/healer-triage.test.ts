import { describe, it, expect } from 'vitest';
import { GameCharacter } from '../src/entities/Character';
import { Party } from '../src/entities/Party';
import { chooseHealTarget } from '../src/combat/TargetAI';

// Plain-object mocks: the triage brain only reads hp / maxHp / isAlive / isDead.
function mkMember(over: Record<string, unknown>): GameCharacter {
  return {
    id: `m${Math.random().toString(36).slice(2, 8)}`,
    name: 'Hero',
    charClass: { id: 'fighter' },
    hp: 10,
    maxHp: 10,
    isDead: false,
    isAlive: true,
    ...over,
  } as unknown as GameCharacter;
}

function mkParty(members: GameCharacter[]): Party {
  return { members, leaderIndex: 0 } as unknown as Party;
}

describe('chooseHealTarget', () => {
  it('prioritizes a downed ally rolling death saves over a wounded one', () => {
    const downed = mkMember({ name: 'Downed', hp: 0 });
    const hurt = mkMember({ name: 'Hurt', hp: 3, maxHp: 10 });
    const { target, urgency } = chooseHealTarget(mkParty([hurt, downed]));
    expect(target).toBe(downed);
    expect(urgency).toBe('dying');
  });

  it('picks the standing ally closest to dropping as critical', () => {
    const barely = mkMember({ name: 'Barely', hp: 2, maxHp: 20 });
    const bruised = mkMember({ name: 'Bruised', hp: 12, maxHp: 20 });
    const { target, urgency } = chooseHealTarget(mkParty([bruised, barely]));
    expect(target).toBe(barely);
    expect(urgency).toBe('critical');
  });

  it('reports none when everyone stands at full health', () => {
    const a = mkMember({ hp: 10, maxHp: 10 });
    const b = mkMember({ hp: 20, maxHp: 20 });
    const { target, urgency } = chooseHealTarget(mkParty([a, b]));
    expect(target).toBeNull();
    expect(urgency).toBe('none');
  });

  it('never targets a dead ally', () => {
    const dead = mkMember({ name: 'Dead', hp: 0, isDead: true, isAlive: false });
    const scratched = mkMember({ name: 'Scratched', hp: 9, maxHp: 10 });
    const { target } = chooseHealTarget(mkParty([dead, scratched]));
    expect(target).toBe(scratched);
  });

  it('reports none for an empty party without throwing', () => {
    const { target, urgency } = chooseHealTarget(mkParty([]));
    expect(target).toBeNull();
    expect(urgency).toBe('none');
  });

  it('mild wounds read as wounded urgency, not critical', () => {
    const mid = mkMember({ hp: 6, maxHp: 10 }); // 60%
    const { urgency } = chooseHealTarget(mkParty([mid]));
    expect(urgency).toBe('wounded');
  });
});

import { describe, it, expect } from 'vitest';
import { banterFor, type BanterMember } from '../src/events/Banter';
import { rarityTag } from '../src/loot/LootTables';

const m = (name: string, over: Partial<BanterMember> = {}): BanterMember => ({ name, classId: 'fighter', greed: 5, caution: 5, aggression: 5, hpPct: 1, ...over });

describe('banter', () => {
  it('needs two people and a willing die', () => {
    expect(banterFor([m('Ana')], 'vault')).toBeNull();
    expect(banterFor([m('Ana'), m('Bo')], 'vault', () => 0.9)).toBeNull();
  });

  it('speaks to the room, in the speakers\' voices', () => {
    const lines = banterFor([m('Ana', { classId: 'rogue' }), m('Bo')], 'chest', () => 0)!;
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.join(' ')).toContain('Ana');
    expect(lines.join(' ')).toContain('Bo');
    expect(lines.join(' ')).toMatch(/minute|Chest/);
    const general = banterFor([m('Ana', { classId: 'barbarian' }), m('Bo')], null, () => 0.1);
    expect(general === null || general.every(l => /^[A-Z][a-z]+: "/.test(l))).toBe(true);
  });
});

describe('rarity tags', () => {
  it('names the tiers and says nothing for the common', () => {
    expect(rarityTag('legendary')).toMatch(/Legendary/);
    expect(rarityTag('rare')).toMatch(/Rare/);
    expect(rarityTag('uncommon')).toMatch(/Uncommon/);
    expect(rarityTag('common')).toBe('');
    expect(rarityTag(undefined)).toBe('');
  });
});

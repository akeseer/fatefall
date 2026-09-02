import { describe, it, expect } from 'vitest';
import { elementalMultiplier } from '../src/rules/Rules';
import { isFlanking } from '../src/combat/TargetAI';

describe('elementalMultiplier', () => {
  it('radiant sears undead and fiends', () => {
    expect(elementalMultiplier('radiant', 'undead').mult).toBe(1.5);
    expect(elementalMultiplier('radiant', 'fiend').mult).toBe(1.5);
  });

  it('radiant is diminished against celestials', () => {
    expect(elementalMultiplier('radiant', 'celestial').mult).toBe(0.5);
  });

  it('the dead ignore poison and shrug off necrotic', () => {
    expect(elementalMultiplier('poison', 'undead').mult).toBe(0.5);
    expect(elementalMultiplier('necrotic', 'undead').mult).toBe(0.5);
  });

  it('fire torches plants but washes off elementals', () => {
    expect(elementalMultiplier('fire', 'plant').mult).toBe(1.5);
    expect(elementalMultiplier('fire', 'elemental').mult).toBe(0.5);
  });

  it('unlisted pairings are neutral with no note', () => {
    const r = elementalMultiplier('fire', 'humanoid');
    expect(r.mult).toBe(1);
    expect(r.note).toBeNull();
  });

  it('missing element is neutral', () => {
    expect(elementalMultiplier(undefined, 'undead').mult).toBe(1);
  });

  it('strong interactions always produce a log note', () => {
    expect(elementalMultiplier('radiant', 'undead').note).toBeTruthy();
    expect(elementalMultiplier('cold', 'construct').note).toBeTruthy();
  });
});

describe('isFlanking', () => {
  it('opposite sides flank', () => {
    expect(isFlanking({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(true);
  });

  it('vertical opposite sides flank', () => {
    expect(isFlanking({ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 3 })).toBe(true);
  });

  it('same side does not flank', () => {
    expect(isFlanking({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBe(false);
  });

  it('diagonal corner pairs split the foe\'s attention', () => {
    expect(isFlanking({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
  });

  it('standing on the target is never flanking', () => {
    expect(isFlanking({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false);
  });
});

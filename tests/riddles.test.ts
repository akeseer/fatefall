import { describe, it, expect } from 'vitest';
import { RIDDLES, answersRiddle, normalizeAnswer, pickRiddle, riddleById, riddleDc, RIDDLE_PATIENCE_TICKS } from '../src/events/Riddles';

describe('riddles', () => {
  it('every riddle has a question, an answer and a hint', () => {
    for (const r of RIDDLES) {
      expect(r.text.length).toBeGreaterThan(20);
      expect(r.answers.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
      expect(riddleById(r.id)).toBe(r);
    }
    expect(pickRiddle(() => 0)).toBe(RIDDLES[0]);
  });

  it('accepts the answer however the DM phrases it', () => {
    const echo = riddleById('echo')!;
    for (const t of ['echo', 'Echo', 'an echo', 'The answer is echo', 'it is an echo!', "it's echo", 'maybe echo?']) {
      expect(answersRiddle(echo, t)).toBe(true);
    }
    for (const t of ['a shadow', 'move north', '', 'echoes', 'echo chamber']) {
      expect(answersRiddle(echo, t)).toBe(false);
    }
    expect(normalizeAnswer('The answer is: a MAP!')).toBe('a map');
  });

  it('does not swallow ordinary orders', () => {
    for (const r of RIDDLES) {
      for (const order of ['move north', 'attack', 'search the room', 'save', 'rest', 'roll d20']) {
        expect(answersRiddle(r, order)).toBe(false);
      }
    }
  });

  it('gets harder with depth and gives the DM time', () => {
    expect(riddleDc(1)).toBe(12);
    expect(riddleDc(5)).toBe(14);
    expect(RIDDLE_PATIENCE_TICKS).toBeGreaterThan(20);
  });
});

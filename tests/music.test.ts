import { describe, it, expect } from 'vitest';
import {
  Music, PIECES, MAJOR, AEOLIAN, PHRYGIAN,
  scaleNote, chordTones, midiToHz, barHash, choosePhrase,
} from '../src/audio/Music';

/**
 * Node has no AudioContext, so the player's silent path is pinned here along
 * with the theory it is built on, which is pure. The scheduler itself is
 * checked in the browser against the audio clock.
 */

describe('theory', () => {
  it('reads scale degrees and wraps through octaves', () => {
    expect(scaleNote(MAJOR, 0)).toBe(0);
    expect(scaleNote(MAJOR, 4)).toBe(7);
    expect(scaleNote(MAJOR, 7)).toBe(12);
    expect(scaleNote(MAJOR, -1)).toBe(-1);
    expect(scaleNote(AEOLIAN, 2)).toBe(3);
    expect(scaleNote(PHRYGIAN, 1)).toBe(1);
  });

  it('builds triads and sevenths on a degree', () => {
    expect(chordTones(MAJOR, 0)).toEqual([0, 4, 7]);
    expect(chordTones(MAJOR, 4, true)).toEqual([7, 11, 14, 17]);
    expect(chordTones(AEOLIAN, 0)).toEqual([0, 3, 7]);
  });

  it('tunes A4 to 440 and an octave to a doubling', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880);
  });
});

describe('variation', () => {
  it('hashes bars deterministically and differently', () => {
    expect(barHash(1, 5)).toBe(barHash(1, 5));
    expect(barHash(1, 5)).not.toBe(barHash(1, 6));
    expect(barHash(1, 5)).not.toBe(barHash(2, 5));
  });

  it('never repeats the previous phrase when it has a choice', () => {
    for (let bar = 0; bar < 200; bar++) {
      const prev = bar % 5;
      const pick = choosePhrase(7, bar, 5, 1, prev);
      expect(pick).not.toBe(prev);
      expect(pick).toBeGreaterThanOrEqual(0);
      expect(pick).toBeLessThan(5);
    }
  });

  it('rests at about the rate the density asks for', () => {
    let rests = 0;
    const n = 2000;
    for (let bar = 0; bar < n; bar++) if (choosePhrase(3, bar, 4, 0.5, -1) < 0) rests++;
    expect(rests / n).toBeGreaterThan(0.4);
    expect(rests / n).toBeLessThan(0.6);
    expect(choosePhrase(3, 1, 0, 1, -1)).toBe(-1);
  });
});

describe('pieces', () => {
  it('keep every note inside the bar and every degree on the progression', () => {
    for (const [name, piece] of Object.entries(PIECES)) {
      const steps = piece.stepsPerBeat * piece.beatsPerBar;
      expect(piece.progression.length, name).toBeGreaterThan(0);
      for (const d of piece.progression) expect(d, name).toBeGreaterThanOrEqual(0);
      for (const phrase of [...piece.lead.phrases, ...piece.lead.cadence]) {
        for (const [s, l] of phrase) {
          expect(s, name).toBeGreaterThanOrEqual(0);
          expect(s + l, name).toBeLessThanOrEqual(steps);
        }
      }
      for (const [s, l] of piece.bass.pattern) expect(s + l, name).toBeLessThanOrEqual(steps);
      if (piece.drums) {
        for (const hits of [piece.drums.kick, piece.drums.snare, piece.drums.hat, piece.drums.openHat]) {
          for (const s of hits) expect(s, name).toBeLessThan(steps);
        }
      }
      expect(piece.lead.cadence.length, name).toBeGreaterThan(0);
    }
  });

  it('stay quiet enough that the mix cannot clip', () => {
    for (const piece of Object.values(PIECES)) {
      // Two pad oscillators per chord tone, one bass, one lead.
      const sum = piece.pad.gain * 2 * 4 + piece.bass.gain + piece.lead.gain;
      expect(sum).toBeLessThan(0.8);
    }
  });
});

describe('the player without audio', () => {
  it('accepts every mood and reports none', () => {
    const m = new Music();
    for (const mood of Object.keys(PIECES) as (keyof typeof PIECES)[]) {
      expect(() => m.play(mood)).not.toThrow();
      expect(m.mood).toBe('none');
    }
    expect(() => m.play('none')).not.toThrow();
    expect(() => m.stop()).not.toThrow();
    expect(m.liveVoiceCount).toBe(0);
    expect(m.debug().performances).toEqual([]);
  });
});

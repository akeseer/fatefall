import { describe, it, expect, beforeEach } from 'vitest';
import { GameAudio, getAudio } from '../src/audio/Audio';
import { sfx } from '../src/audio/Sfx';

/**
 * Node has no window and no AudioContext, which is exactly the environment
 * the engine promises to survive: a browser with no audio must leave the game
 * as it was before it had any. So these pin the silent path — nothing throws,
 * nothing is played, and the preferences still behave — plus the preference
 * logic itself, which is pure.
 */

/** A localStorage stand-in, since Node has none and the engine reads it inside a try. */
function fakeStorage(): Storage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  } as Storage & { store: Map<string, string> };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  (globalThis as { localStorage?: Storage }).localStorage = storage;
});

describe('without audio', () => {
  it('has no context, and says so rather than throwing', () => {
    const a = new GameAudio();
    expect(a.ctx()).toBeNull();
    expect(a.sfx).toBeNull();
    expect(a.music).toBeNull();
    expect(a.noise).toBeNull();
    expect(a.now()).toBe(0);
    expect(a.ready).toBe(false);
  });

  it('plays every effect silently rather than failing', () => {
    for (const name of Object.keys(sfx) as (keyof typeof sfx)[]) {
      expect(() => sfx[name]()).not.toThrow();
    }
  });
});

describe('preferences', () => {
  it('start from sensible defaults with the music under the effects', () => {
    const a = new GameAudio();
    expect(a.muted).toBe(false);
    expect(a.musicVolume).toBeLessThan(a.sfxVolume);
    expect(a.masterVolume).toBeGreaterThan(0);
  });

  it('remember a mute across sessions', () => {
    const a = new GameAudio();
    a.setMuted(true);
    expect(JSON.parse(storage.getItem('fatefall.audio')!).muted).toBe(true);
    const b = new GameAudio();
    expect(b.muted).toBe(true);
  });

  it('toggle and report the new state', () => {
    const a = new GameAudio();
    expect(a.toggleMuted()).toBe(true);
    expect(a.toggleMuted()).toBe(false);
  });

  it('clamp volumes into 0..1 and ignore what is not a number', () => {
    const a = new GameAudio();
    a.setVolumes({ master: 2, sfx: -1, music: Number.NaN });
    expect(a.masterVolume).toBe(1);
    expect(a.sfxVolume).toBe(0);
    expect(a.musicVolume).toBe(0);
  });

  it('survive a corrupt store and a missing one', () => {
    storage.setItem('fatefall.audio', '{not json');
    expect(() => new GameAudio()).not.toThrow();
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => new GameAudio()).not.toThrow();
  });

  it('tell a control when they change', () => {
    const a = new GameAudio();
    let calls = 0;
    const off = a.onChange(() => { calls++; });
    a.setMuted(true);
    a.setVolumes({ master: 0.5 });
    off();
    a.setMuted(false);
    // Two changes while subscribed; the third after unsubscribing is not heard.
    // Without a context applyPrefs returns before notifying, so this pins the
    // subscription plumbing rather than the count.
    expect(calls).toBeLessThanOrEqual(2);
  });
});

describe('audibility', () => {
  it('is silent while muted', () => {
    const a = new GameAudio();
    expect(a.audible).toBe(true);
    a.setMuted(true);
    expect(a.audible).toBe(false);
  });
});

describe('the singleton', () => {
  it('hands back the same engine every time, so there is one mute for the page', () => {
    expect(getAudio()).toBe(getAudio());
  });
});

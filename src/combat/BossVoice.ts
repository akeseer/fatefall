/**
 * Bosses that talk.
 *
 * A boss says something as the fight opens and something else when it is
 * hurt to half, by its kind: a lich does not speak like a wolf, and a wolf
 * does not speak at all, but its snarl is a line too. Pure: a table and two
 * lookups, seeded by the boss's id so the same boss keeps its voice.
 */

interface Voice {
  opening: string[];
  bloodied: string[];
}

const VOICES: Record<string, Voice> = {
  speaking: {
    opening: [
      '"Come, then. I have been waiting longer than you have been alive."',
      '"You are the ones they sent? I expected more. I always expect more."',
      '"Turn back and I will let you keep what you came with. This is the only mercy on offer."',
      '"Do you know whose hall this is? You will."',
    ],
    bloodied: [
      '"Enough. ENOUGH. Now I stop being polite."',
      '"You have drawn blood. Very few have. None have twice."',
      '"That hurt. Good. I had forgotten what it felt like to be interested."',
      '"Ah. So that is how it will be."',
    ],
  },
  undead: {
    opening: [
      'It speaks in a voice with dust in it: "The living. Again. I had hoped I was done with the living."',
      '"You will join the others. They are all here. They are all still here."',
      'The jaw works before the sound comes: "Warm. You are so warm."',
    ],
    bloodied: [
      '"You cannot kill what has already died. But you may try. They all try."',
      'Something falls off it. It does not seem to mind. "Closer," it says.',
      '"I have been broken before. I am always put back."',
    ],
  },
  fiend: {
    opening: [
      '"Oh, this is a gift. I so rarely get to do this in person."',
      '"Your names are already written. I am only here to collect the signatures."',
      '"Kneel and we can discuss terms. Stand and we cannot."',
    ],
    bloodied: [
      '"That was not part of the bargain." It smiles anyway. "But I can amend."',
      '"Pain. Yes. I remember now why I took a body."',
      '"You will regret this in a very specific and very long way."',
    ],
  },
  beast: {
    opening: [
      'It does not speak. It lowers its head, and the sound it makes has no word for it.',
      'Its eyes find the smallest of the party first, and stay there.',
      'It circles once, unhurried, the way things do when they have done this before.',
    ],
    bloodied: [
      'It bleeds, and the bleeding makes it worse.',
      'A sound comes out of it that is not pain. It is something older than pain.',
      'It stops circling. It has decided.',
    ],
  },
  construct: {
    opening: [
      'It says nothing. Something inside it begins to tick faster.',
      'Its head turns to each of them in turn, as if taking a count.',
      'A voice from inside it, recorded long ago: "INTRUDERS. INTRUDERS. INTRUDERS."',
    ],
    bloodied: [
      'Something in it grinds. It does not slow down.',
      'A panel falls away. Behind it, light.',
      'The ticking stops. That is worse.',
    ],
  },
  aberration: {
    opening: [
      'It speaks inside their heads, all at once, in a voice that is each of their own: "hello."',
      'Its attention arrives before it does, like a weight on the back of the neck.',
      'It regards them from an angle that should not exist.',
    ],
    bloodied: [
      'It is not hurt. It is surprised, which for it is the same thing.',
      'A thought that is not theirs: "interesting. again."',
      'Part of it goes somewhere else, and comes back angrier.',
    ],
  },
};

const KIND_VOICE: Record<string, keyof typeof VOICES> = {
  undead: 'undead', vampire: 'speaking', spirit: 'undead', shade: 'undead',
  fiend: 'fiend', demon: 'fiend', devil: 'fiend', yugoloth: 'fiend',
  beast: 'beast', monstrosity: 'beast', insect: 'beast', arachnid: 'beast', aquatic: 'beast', avian: 'beast', reptile: 'beast', dinosaur: 'beast', ooze: 'beast', plant: 'beast', fungus: 'beast', parasite: 'beast', wyrm: 'beast', lycanthrope: 'beast',
  construct: 'construct', automaton: 'construct', crystal: 'construct',
  aberration: 'aberration', outsider: 'aberration', dreamborn: 'aberration',
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function voiceFor(type: string): Voice {
  return VOICES[KIND_VOICE[type] ?? 'speaking'];
}

/** What a boss says as the fight begins. */
export function bossOpening(name: string, type: string, seed: string): string {
  const v = voiceFor(type);
  return `💀 ${name}: ${v.opening[hash(seed) % v.opening.length]}`;
}

/** What a boss says at half health. */
export function bossBloodied(name: string, type: string, seed: string): string {
  const v = voiceFor(type);
  return `💀 ${name}, bloodied: ${v.bloodied[hash(seed + '!') % v.bloodied.length]}`;
}

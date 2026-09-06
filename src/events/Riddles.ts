/**
 * Riddle doors.
 *
 * A puzzle room now asks a question. The DM can answer it by typing the
 * word (a correct answer opens the door with a flourish and a bigger cache);
 * otherwise the party's sharpest mind puzzles at it with an Intelligence
 * check after a while. Pure: the table, the matching, and the difficulty.
 */

export interface Riddle {
  id: string;
  text: string;
  /** Accepted answers, lower-case; the first is the canonical one. */
  answers: string[];
  /** A word or two the door lets slip, for the log. */
  hint: string;
}

export const RIDDLES: Riddle[] = [
  { id: 'echo', text: 'I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?', answers: ['echo', 'an echo'], hint: 'it answers back' },
  { id: 'candle', text: 'I am tall when I am young and short when I am old. What am I?', answers: ['candle', 'a candle'], hint: 'it burns' },
  { id: 'map', text: 'I have cities but no houses, forests but no trees, and water but no fish. What am I?', answers: ['map', 'a map'], hint: 'travellers carry it' },
  { id: 'shadow', text: 'I follow you all day and lie beneath your feet at noon, and I am gone in the dark. What am I?', answers: ['shadow', 'a shadow', 'my shadow'], hint: 'the sun makes it' },
  { id: 'silence', text: 'The more of me you take, the more you leave behind. What am I?', answers: ['footsteps', 'steps', 'footprints'], hint: 'look down' },
  { id: 'darkness', text: 'The poor have me, the rich need me, and if you eat me you die. What am I?', answers: ['nothing'], hint: 'it is not a thing' },
  { id: 'fire', text: 'Feed me and I live. Give me a drink and I die. What am I?', answers: ['fire', 'a fire', 'flame'], hint: 'it is warm' },
  { id: 'name', text: 'It belongs to you, but others use it more than you do. What is it?', answers: ['name', 'my name', 'your name', 'a name'], hint: 'you were given it' },
  { id: 'coffin', text: 'The one who makes it does not want it. The one who buys it does not use it. The one who uses it does not know it. What is it?', answers: ['coffin', 'a coffin'], hint: 'fitting, down here' },
  { id: 'river', text: 'I have a mouth but never speak, a bed but never sleep, and I run but never walk. What am I?', answers: ['river', 'a river'], hint: 'it flows' },
  { id: 'key', text: 'I have teeth but cannot bite, and I open what no hand can. What am I?', answers: ['key', 'a key'], hint: 'it turns' },
  { id: 'tomorrow', text: 'I am always coming but never arrive. What am I?', answers: ['tomorrow'], hint: 'wait and see' },
  { id: 'breath', text: 'Light as a feather, yet the strongest cannot hold me a quarter hour. What am I?', answers: ['breath', 'a breath', 'your breath', 'my breath'], hint: 'in and out' },
  { id: 'hole', text: 'The more you take away from me, the bigger I get. What am I?', answers: ['hole', 'a hole'], hint: 'dig' },
];

export function pickRiddle(rng: () => number = Math.random): Riddle {
  return RIDDLES[Math.min(RIDDLES.length - 1, Math.floor(rng() * RIDDLES.length))];
}

export function riddleById(id: string): Riddle | undefined {
  return RIDDLES.find(r => r.id === id);
}

/** Normalise a typed answer: case, punctuation, "the answer is" and its kin. */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\b(the answer is|it is|it's|its|answer|i say|i think|is it|maybe|perhaps)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether a typed line answers the riddle. */
export function answersRiddle(riddle: Riddle, text: string): boolean {
  const norm = normalizeAnswer(text);
  if (!norm) return false;
  return riddle.answers.some(a => norm === a || norm === a.replace(/^(a|an|my|your) /, ''));
}

/** The difficulty of working a riddle out unaided, by floor. */
export function riddleDc(dungeonLevel: number): number {
  return 12 + Math.floor(dungeonLevel / 2);
}

/** AI ticks the party spends on the door before trying its wits. */
export const RIDDLE_PATIENCE_TICKS = 36;

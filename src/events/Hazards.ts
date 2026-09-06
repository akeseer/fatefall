/**
 * Hazard rooms: the room itself is the danger.
 *
 * A collapsing bridge, a flooded passage, a wall of spores — each is a room
 * feature that fires once, when the party first walks in, and asks every
 * member for a saving throw (or, for a group challenge such as sneaking past
 * a sleeping guardian, asks the party to succeed together). This module is
 * the pure half: the definitions, the difficulty by floor, and the reading
 * of a set of results into what happens and what is said. `Game` rolls the
 * dice (so the tray can show them one at a time) and applies the effects.
 */

import type { Ability } from '../data/gameData';

export type HazardKind =
  | 'collapsing_bridge'
  | 'flooded_passage'
  | 'spore_wall'
  | 'rune_floor'
  | 'chasm_climb'
  | 'sleeping_guardian'
  | 'whispering_dark';

export type HazardMode =
  /** Every member saves for themselves; each failure costs that member. */
  | 'each'
  /** A group check: half the party or more must succeed, or everyone pays. */
  | 'group';

export type HazardPenalty =
  | { kind: 'damage'; dice: [count: number, sides: number]; flavor: string }
  | { kind: 'exhaustion'; flavor: string }
  | { kind: 'encounter'; cr: number; count: number; flavor: string };

export interface HazardDef {
  kind: HazardKind;
  /** Short title, as a room feature name: "a collapsing rope bridge". */
  name: string;
  entryLine: string;
  inspect: string;
  ability: Ability;
  /** The check's name in the roll label: "Dexterity save", "Stealth check". */
  checkName: string;
  mode: HazardMode;
  /** Difficulty on the first floor; deeper floors climb from here. */
  baseDc: number;
  penalty: HazardPenalty;
  /** Narration for one member who made it, {name} substituted. */
  passLine: string;
  /** Narration for one member who did not. */
  failLine: string;
  /** Group mode: what the party as a whole earns or suffers. */
  groupPass: string;
  groupFail: string;
  /** Experience for coming through, per member, scaled by floor. */
  xp: number;
}

export const HAZARDS: HazardDef[] = [
  {
    kind: 'collapsing_bridge',
    name: 'a collapsing rope bridge',
    entryLine: 'A rope bridge sags across a black chasm here, its planks grey with rot. Halfway over, the first one gives.',
    inspect: 'The anchor posts are sound; the planks are not. There is no other way across.',
    ability: 'dex',
    checkName: 'Dexterity save',
    mode: 'each',
    baseDc: 12,
    penalty: { kind: 'damage', dice: [2, 6], flavor: 'drops through and catches the edge, ribs first' },
    passLine: '{name} feels the plank go and is already on the next one.',
    failLine: '{name} drops through and catches the edge, ribs first.',
    groupPass: 'The last of them swings onto solid stone as the bridge comes apart behind.',
    groupFail: 'The bridge comes apart, and the party gathers itself at the bottom of the fall.',
    xp: 20,
  },
  {
    kind: 'flooded_passage',
    name: 'a flooded passage',
    entryLine: 'Black water fills the passage to the ceiling for a dozen strides. The party must swim it on a held breath.',
    inspect: 'The water is cold and still, and something pale drifts in it that is not a fish.',
    ability: 'con',
    checkName: 'Constitution save',
    mode: 'each',
    baseDc: 11,
    penalty: { kind: 'exhaustion', flavor: 'comes up choking and grey' },
    passLine: '{name} surfaces on the far side, spitting water, none the worse.',
    failLine: '{name} comes up choking and grey, and shakes for a long minute.',
    groupPass: 'The passage is behind them, and the dark ahead is at least dry.',
    groupFail: 'They lie on the far bank a long while before anyone can stand.',
    xp: 20,
  },
  {
    kind: 'spore_wall',
    name: 'a wall of drifting spores',
    entryLine: 'The air is thick with drifting yellow spores from a fungus that carpets every surface. There is no holding a breath long enough.',
    inspect: 'The fungus pulses faintly. Small bones lie under it in the shapes of things that stopped to rest.',
    ability: 'con',
    checkName: 'Constitution save',
    mode: 'each',
    baseDc: 12,
    penalty: { kind: 'damage', dice: [2, 4], flavor: 'doubles over coughing, lungs burning' },
    passLine: '{name} pulls a cloak across their face and walks through without breathing.',
    failLine: '{name} doubles over coughing, lungs burning with the stuff.',
    groupPass: 'They come out the other side with yellow dust in every seam and their lungs intact.',
    groupFail: 'Coughing echoes down the corridor for a long time after they are through.',
    xp: 20,
  },
  {
    kind: 'rune_floor',
    name: 'a floor of waking runes',
    entryLine: 'Runes flare underfoot as the party steps in, and a voice that is not a voice presses at the mind of everyone in the room.',
    inspect: 'The runes spell a binding, half worn away. Whatever they held is gone; the trap they were remains.',
    ability: 'wis',
    checkName: 'Wisdom save',
    mode: 'each',
    baseDc: 13,
    penalty: { kind: 'damage', dice: [2, 6], flavor: 'staggers, nose bleeding, as the runes claw at their thoughts' },
    passLine: '{name} sets their jaw and the whisper breaks against it.',
    failLine: '{name} staggers, nose bleeding, as the runes claw at their thoughts.',
    groupPass: 'The runes dim one by one, cheated, and the room is only a room.',
    groupFail: 'The runes burn out at last, and the party stands blinking in the dark it leaves.',
    xp: 25,
  },
  {
    kind: 'chasm_climb',
    name: 'a sheer climb',
    entryLine: 'The floor of the room has fallen away into the level below; the only way on is a climb up a wet, crumbling wall.',
    inspect: 'Old pitons rust in the rock. Someone made this climb before and left the hard way.',
    ability: 'str',
    checkName: 'Athletics check',
    mode: 'group',
    baseDc: 12,
    penalty: { kind: 'damage', dice: [1, 6], flavor: 'slides back down in a rain of grit' },
    passLine: '{name} finds the holds as if the wall were a ladder.',
    failLine: '{name} slides back down in a rain of grit.',
    groupPass: 'Enough of them reach the top to haul the rest up by rope and wrist.',
    groupFail: 'Too few make the top. They climb it the slow way, and the wall takes its toll from all of them.',
    xp: 25,
  },
  {
    kind: 'sleeping_guardian',
    name: 'a sleeping guardian',
    entryLine: 'Something large sleeps in the middle of this room, its breath stirring the dust in slow waves. The party must pass it without a sound.',
    inspect: 'It is bigger than it looked from the door. One eye is not entirely closed.',
    ability: 'dex',
    checkName: 'Stealth check',
    mode: 'group',
    baseDc: 12,
    penalty: { kind: 'encounter', cr: 1, count: 1, flavor: 'A pebble skitters. The eye opens.' },
    passLine: '{name} moves like smoke.',
    failLine: '{name} puts a boot on something that cracks.',
    groupPass: 'The party is past and through the far door before the sleeper turns over.',
    groupFail: 'A pebble skitters. The eye opens.',
    xp: 30,
  },
  {
    kind: 'whispering_dark',
    name: 'a dark that whispers',
    entryLine: 'Every light in the party guts to a blue pinprick as they enter. In the dark, something says each of their names, once.',
    inspect: 'Nothing lives here. The dark is the thing, and it is listening.',
    ability: 'wis',
    checkName: 'Wisdom save',
    mode: 'each',
    baseDc: 12,
    penalty: { kind: 'exhaustion', flavor: 'answers the voice and is not quite whole for a while after' },
    passLine: '{name} keeps walking and does not answer.',
    failLine: '{name} answers the voice, and is not quite whole for a while after.',
    groupPass: 'The light comes back all at once, and no one speaks of it.',
    groupFail: 'The light comes back, eventually. No one speaks for a long time.',
    xp: 25,
  },
];

export function hazardByKind(kind: HazardKind): HazardDef {
  const def = HAZARDS.find(h => h.kind === kind);
  if (!def) throw new Error(`Unknown hazard ${kind}`);
  return def;
}

/** Pick a hazard for a room, using the given random source. */
export function pickHazard(rng: () => number = Math.random): HazardDef {
  return HAZARDS[Math.min(HAZARDS.length - 1, Math.floor(rng() * HAZARDS.length))];
}

/** Difficulty climbs by one every two floors. */
export function hazardDc(def: HazardDef, dungeonLevel: number): number {
  return def.baseDc + Math.floor(Math.max(0, dungeonLevel - 1) / 2);
}

export interface HazardRoll {
  memberName: string;
  success: boolean;
}

export interface HazardOutcome {
  /** Whether the party as a whole came through (group mode) or at all (each mode: always true). */
  success: boolean;
  /** Names of members who pay the penalty. */
  punished: string[];
  lines: string[];
}

/**
 * Read a set of rolls into who pays and what is said. In each-mode, every
 * failure pays for themselves. In group mode, the party needs at least half
 * (rounded up) to succeed; if it does, no one pays; if not, everyone does.
 */
export function readHazard(def: HazardDef, rolls: HazardRoll[]): HazardOutcome {
  const lines: string[] = [];
  for (const r of rolls) {
    lines.push((r.success ? def.passLine : def.failLine).replace('{name}', r.memberName));
  }
  if (rolls.length === 0) return { success: true, punished: [], lines };
  if (def.mode === 'each') {
    const punished = rolls.filter(r => !r.success).map(r => r.memberName);
    lines.push(punished.length === 0 ? def.groupPass : def.groupFail);
    return { success: true, punished, lines };
  }
  const needed = Math.ceil(rolls.length / 2);
  const made = rolls.filter(r => r.success).length;
  const success = made >= needed;
  lines.push(success ? def.groupPass : def.groupFail);
  return { success, punished: success ? [] : rolls.map(r => r.memberName), lines };
}

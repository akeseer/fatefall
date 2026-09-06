/**
 * The kinds of creature, and what the rules make of them.
 *
 * The bestiary began with the fourteen classic types. The menagerie adds
 * twenty-five more, and the rules that used to ask "is it undead?" by
 * comparing a string now ask here, so a vampire burns under radiant light
 * and a clockwork reaper does not flinch, without every rule keeping its
 * own list.
 */

export const CLASSIC_KINDS = [
  'beast', 'undead', 'humanoid', 'dragon', 'aberration', 'fiend', 'giant',
  'monstrosity', 'ooze', 'construct', 'fey', 'celestial', 'plant', 'elemental',
] as const;

export const MENAGERIE_KINDS = [
  'insect', 'arachnid', 'aquatic', 'avian', 'reptile', 'dinosaur', 'fungus', 'crystal',
  'automaton', 'shapechanger', 'lycanthrope', 'vampire', 'spirit', 'demon', 'devil',
  'yugoloth', 'genie', 'hag', 'titan', 'wyrm', 'parasite', 'cultist', 'outsider',
  'dreamborn', 'shade',
] as const;

export type MonsterKind = typeof CLASSIC_KINDS[number] | typeof MENAGERIE_KINDS[number];

/** Kinds the grave has a claim on: turned, smitten and burned as undead are. */
export const UNDEAD_KINDS: ReadonlySet<string> = new Set(['undead', 'vampire', 'spirit', 'shade']);

/** Kinds of the lower planes: smitten as fiends are, and they shrug off poison. */
export const FIEND_KINDS: ReadonlySet<string> = new Set(['fiend', 'demon', 'devil', 'yugoloth']);

/** Kinds that cannot be frightened: nothing to frighten, or nothing that admits it. */
export const FEARLESS_KINDS: ReadonlySet<string> = new Set([
  'undead', 'construct', 'ooze', 'plant', 'automaton', 'fungus', 'crystal', 'spirit', 'shade', 'parasite', 'titan',
]);

/** Kinds with no speech to bargain with. */
export const WORDLESS_KINDS: ReadonlySet<string> = new Set([
  'beast', 'ooze', 'plant', 'insect', 'arachnid', 'aquatic', 'avian', 'reptile', 'dinosaur', 'fungus', 'crystal', 'parasite', 'automaton',
]);

/** Kinds that can talk before a fight, and sometimes would rather. */
export const TALKING_KINDS: ReadonlySet<string> = new Set([
  'humanoid', 'giant', 'fey', 'fiend', 'dragon',
  'demon', 'devil', 'yugoloth', 'genie', 'hag', 'titan', 'wyrm', 'vampire', 'shapechanger', 'lycanthrope', 'cultist', 'dreamborn',
]);

export const isUndeadKind = (type: string): boolean => UNDEAD_KINDS.has(type);
export const isFiendKind = (type: string): boolean => FIEND_KINDS.has(type);
export const isUnholyKind = (type: string): boolean => UNDEAD_KINDS.has(type) || FIEND_KINDS.has(type);

/** What each kind is called on the page, for the compendium and the log. */
export const KIND_LABEL: Record<string, string> = {
  insect: 'insect', arachnid: 'arachnid', aquatic: 'aquatic beast', avian: 'bird', reptile: 'reptile', dinosaur: 'dinosaur',
  fungus: 'fungus', crystal: 'crystalline', automaton: 'automaton', shapechanger: 'shapechanger', lycanthrope: 'lycanthrope',
  vampire: 'vampire', spirit: 'spirit', demon: 'demon', devil: 'devil', yugoloth: 'yugoloth', genie: 'genie', hag: 'hag',
  titan: 'titan', wyrm: 'wyrm', parasite: 'parasite', cultist: 'cultist', outsider: 'far realm outsider', dreamborn: 'dreamborn', shade: 'shade',
};

/** A default alignment by kind, for the compendium's stat block. */
export function alignmentForKind(type: string, cr: number): string {
  switch (type) {
    case 'celestial': case 'genie': return 'lawful good';
    case 'fiend': case 'demon': return 'chaotic evil';
    case 'devil': case 'yugoloth': return 'lawful evil';
    case 'undead': case 'vampire': case 'shade': case 'hag': case 'cultist': return 'neutral evil';
    case 'spirit': case 'dreamborn': case 'shapechanger': return 'chaotic neutral';
    case 'outsider': case 'parasite': return 'chaotic evil';
    case 'titan': return 'neutral';
    case 'wyrm': return cr >= 15 ? 'chaotic evil' : 'neutral evil';
    case 'lycanthrope': return 'chaotic evil';
    case 'automaton': case 'crystal': return 'lawful neutral';
  }
  if (WORDLESS_KINDS.has(type)) return 'unaligned';
  return cr >= 10 ? 'neutral evil' : 'neutral';
}

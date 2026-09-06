/**
 * Personal quests: each adventurer's own road.
 *
 * A background is a past, and a past leaves something unfinished: a debt
 * owed, a rival unbeaten, an heirloom lost, a pilgrimage unmade. Every
 * member of a new party is dealt one, from their background, and the run
 * quietly watches for it: coin paid in a town, a named foe met on a deep
 * floor, the right chest, the third town's gate. Finishing one earns a
 * title and a point in the ability the road tested. Pure; `Game` does the
 * watching and rides the state in the save.
 */

import type { Ability } from '../data/gameData';

export type PersonalQuestKind =
  /** Pay `target` gold to someone owed, at a town. */
  | 'debt'
  /** A named rival waits on a floor at or below `target`; beat them. */
  | 'rival'
  /** A lost heirloom lies in a chest or hoard on a floor at or below `target`. */
  | 'heirloom'
  /** Reach `target` different towns. */
  | 'pilgrimage';

export interface PersonalQuest {
  id: string;
  memberId: string;
  memberName: string;
  kind: PersonalQuestKind;
  title: string;
  /** The hook, in a sentence or two, told when the road is dealt. */
  hook: string;
  /** What finishing it reads like. */
  ending: string;
  target: number;
  progress: number;
  /** Town ids reached, for a pilgrimage. */
  visited: string[];
  done: boolean;
  /** Rivals only: who waits. */
  rivalName?: string;
  perk: { ability: Ability; title: string };
}

interface Seed {
  id: string;
  name: string;
  background?: string;
  classId: string;
  deity?: string;
}

const pick = <T>(arr: T[], rng: () => number): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

const RIVAL_NAMES = ['Casimir Vane', 'Ysolde Marr', 'Brannock the Lesser', 'Delphine Crowe', 'Otho Blackhand', 'Sable Vantry', 'Harl of the Ninth', 'Maren Duskwell'];
const HEIRLOOMS = ['a signet ring', 'a mother\'s knife', 'a cracked holy symbol', 'a brass compass that points home', 'a soldier\'s medal', 'a book with one page torn out'];
const CREDITORS = ['the Cutpurse Guild', 'an old fence named Wexley', 'a moneylender who never forgets a face', 'the family that took them in and was robbed for it'];

const KIND_BY_BACKGROUND: Record<string, PersonalQuestKind> = {
  Criminal: 'debt', Charlatan: 'debt', Urchin: 'debt',
  Noble: 'rival', Soldier: 'rival', Sailor: 'rival', Entertainer: 'rival',
  'Folk Hero': 'heirloom', Outlander: 'heirloom', 'Guild Artisan': 'heirloom', Sage: 'heirloom',
  Acolyte: 'pilgrimage', Hermit: 'pilgrimage',
};

/** The ability a road tests, by its kind and the class walking it. */
function perkFor(kind: PersonalQuestKind, classId: string): { ability: Ability; title: string } {
  switch (kind) {
    case 'debt': return { ability: 'cha', title: 'the Square' };
    case 'rival': return { ability: ['wizard', 'sorcerer', 'warlock'].includes(classId) ? 'int' : ['cleric', 'druid', 'ranger', 'monk'].includes(classId) ? 'wis' : 'str', title: 'the Unbowed' };
    case 'heirloom': return { ability: 'wis', title: 'the Returned' };
    case 'pilgrimage': return { ability: 'con', title: 'the Far-Walked' };
  }
}

/** Deal one member their road. */
export function generatePersonalQuest(seed: Seed, rng: () => number = Math.random): PersonalQuest {
  const kind = KIND_BY_BACKGROUND[seed.background ?? ''] ?? pick(['debt', 'rival', 'heirloom', 'pilgrimage'] as PersonalQuestKind[], rng);
  const base = { id: `pq_${seed.id}`, memberId: seed.id, memberName: seed.name, kind, progress: 0, visited: [] as string[], done: false, perk: perkFor(kind, seed.classId) };
  switch (kind) {
    case 'debt': {
      const target = 60 + Math.floor(rng() * 5) * 20;
      const creditor = pick(CREDITORS, rng);
      return {
        ...base,
        title: 'A debt',
        hook: `${seed.name} owes ${creditor} ${target} gold, and has been running from it long enough. The next town with that much in the purse is where it ends.`,
        ending: `${seed.name} counts out ${target} gold to a stranger who was expecting it, and walks out of the room lighter than the coin explains.`,
        target,
      };
    }
    case 'rival': {
      const rivalName = pick(RIVAL_NAMES, rng);
      const target = 2 + Math.floor(rng() * 2);
      return {
        ...base,
        title: 'An old rival',
        hook: `${rivalName} beat ${seed.name} once, in front of people who mattered, and has gone to ground somewhere deep. Word is: below the ${target === 2 ? 'second' : 'third'} floor of any lair with a name.`,
        ending: `${rivalName} is down and knows it, and looks up at ${seed.name} with something that is not quite respect and will have to do.`,
        target,
        rivalName,
      };
    }
    case 'heirloom': {
      const item = pick(HEIRLOOMS, rng);
      const target = 2 + Math.floor(rng() * 2);
      return {
        ...base,
        title: 'A thing lost',
        hook: `${seed.name} lost ${item} to a thief years ago, and has heard it changed hands until it went underground. It will be in a hoard somewhere below the ${target === 2 ? 'second' : 'third'} floor, with the rest of what thieves keep.`,
        ending: `Under the coin, wrapped in oilcloth as if someone had known: ${item}. ${seed.name} does not say anything for a while.`,
        target,
      };
    }
    case 'pilgrimage': {
      const target = 3;
      return {
        ...base,
        title: 'A pilgrimage',
        hook: `${seed.name} swore ${seed.deity ? `to ${seed.deity}` : 'once'} to walk to three different towns and speak a prayer at each gate before resting for good. Two of them are still owed.`,
        ending: `${seed.name} speaks the last prayer at the gate and stands a moment with a hand on the stone. The oath is kept. Whatever was listening, it heard.`,
        target,
      };
    }
  }
}

/** Deal every member a road, skipping anyone who already has one. */
export function dealPersonalQuests(seeds: Seed[], existing: PersonalQuest[], rng: () => number = Math.random): PersonalQuest[] {
  const out = [...existing];
  for (const s of seeds) {
    if (out.some(q => q.memberId === s.id)) continue;
    out.push(generatePersonalQuest(s, rng));
  }
  return out;
}

/** A pilgrimage reaches a town: true when this is the town that finishes it. */
export function pilgrimageArrives(q: PersonalQuest, townId: string): boolean {
  if (q.done || q.kind !== 'pilgrimage' || q.visited.includes(townId)) return false;
  q.visited.push(townId);
  q.progress = q.visited.length;
  return q.progress >= q.target;
}

/** A debt can be paid here: true when the purse covers it. */
export function debtPayable(q: PersonalQuest, partyGold: number): boolean {
  return !q.done && q.kind === 'debt' && partyGold >= q.target;
}

/** Which rival quests want a rival on this floor. */
export function rivalsDueOn(quests: PersonalQuest[], floor: number): PersonalQuest[] {
  return quests.filter(q => !q.done && q.kind === 'rival' && floor >= q.target);
}

/** Which heirloom quests could be answered by a hoard on this floor. */
export function heirloomsPossibleOn(quests: PersonalQuest[], floor: number): PersonalQuest[] {
  return quests.filter(q => !q.done && q.kind === 'heirloom' && floor >= q.target);
}

/** A line for the journal and the log when a road is dealt. */
export function hookLine(q: PersonalQuest): string {
  return `✦ ${q.memberName}'s own road — ${q.title.toLowerCase()}: ${q.hook}`;
}

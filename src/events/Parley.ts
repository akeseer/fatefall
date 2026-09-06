/**
 * Parley: not every meeting has to be a fight.
 *
 * Creatures that can talk sometimes would rather. A band of goblins facing a
 * party that outmatches them offers to buy its life; a strong band on a
 * narrow road names a toll; a band of equals might be talked past. The
 * party decides for itself in the spirit of who it is (a cautious, poor
 * party pays; a proud one refuses; a silver tongue tries the third way),
 * and a Charisma check settles the rest. Pure: `Game` rolls the die and
 * applies the result.
 */

export type ParleyOffer =
  /** They are outmatched and know it: they offer coin to be let go. */
  | 'surrender'
  /** They hold the advantage: pay, or fight. */
  | 'toll'
  /** Neither side is sure: a truce, if someone can sell it. */
  | 'truce';

export type ParleyResponse =
  /** Take the offer as it stands. */
  | 'accept'
  /** No deal: steel. */
  | 'refuse'
  /** Talk them into better terms with a Charisma check. */
  | 'persuade';

export interface ParleyFoe {
  name: string;
  type: string;
  cr: number;
  isBoss: boolean;
}

export interface ParleyParty {
  level: number;
  aliveCount: number;
  /** 0–1 average of the standing members' hit points. */
  avgHpPct: number;
  gold: number;
  /** Leader's alignment, e.g. "Chaotic Evil". */
  alignment?: string;
  /** Leader's dials, 0–10. */
  aggression: number;
  caution: number;
  greed: number;
  /** Best Charisma modifier in the party, proficiency included where it applies. */
  bestChaMod: number;
}

/** Creatures with language enough to bargain. */
const TALKERS = new Set(['humanoid', 'giant', 'fey', 'fiend', 'dragon']);

export function canParley(foes: ParleyFoe[]): boolean {
  return foes.length > 0 && foes.every(f => TALKERS.has(f.type) && !f.isBoss);
}

/** A rough measure of a side's weight in a fight. */
function foeStrength(foes: ParleyFoe[]): number {
  return foes.reduce((s, f) => s + Math.max(0.25, f.cr), 0);
}

function partyStrength(p: ParleyParty): number {
  // A level-one member is about a quarter-CR of threat; scale up with level
  // and down with wounds.
  return p.aliveCount * (0.25 + p.level * 0.35) * (0.5 + 0.5 * p.avgHpPct);
}

/**
 * Whether these foes would rather talk, and what they would say. `rng` is
 * the chance roll; about a third of talking bands open their mouths first.
 */
export function parleyOffer(foes: ParleyFoe[], party: ParleyParty, rng: () => number = Math.random): ParleyOffer | null {
  if (!canParley(foes)) return null;
  if (rng() > 0.35) return null;
  const ratio = partyStrength(party) / Math.max(0.25, foeStrength(foes));
  if (ratio >= 1.8) return 'surrender';
  if (ratio <= 0.6) return 'toll';
  return 'truce';
}

/** The toll a band names: by their weight, and never more than the party could possibly pay twice. */
export function tollFor(foes: ParleyFoe[], party: ParleyParty): number {
  const base = Math.round(15 + foeStrength(foes) * 20);
  return Math.max(10, Math.min(base, Math.max(10, Math.floor(party.gold * 0.6))));
}

/** What a surrendering band offers for its lives. */
export function ransomFor(foes: ParleyFoe[]): number {
  return Math.round(8 + foeStrength(foes) * 12);
}

/**
 * The party's answer, in character. Evil and aggressive parties take a
 * surrender's coin and cut them down anyway (refuse); cautious, poor ones
 * pay a toll; anyone with a real talker tries to talk.
 */
export function chooseParleyResponse(offer: ParleyOffer, party: ParleyParty): ParleyResponse {
  const evil = /evil/i.test(party.alignment ?? '');
  const good = /good/i.test(party.alignment ?? '');
  const talker = party.bestChaMod >= 3;
  switch (offer) {
    case 'surrender':
      if (evil && party.aggression >= 6) return 'refuse';
      if (talker && party.greed >= 5) return 'persuade';
      return 'accept';
    case 'toll': {
      const toll = tollFor([], party);
      if (talker) return 'persuade';
      if (party.aggression >= 7 || party.gold < toll) return 'refuse';
      if (party.caution >= 5 || party.avgHpPct < 0.6) return 'accept';
      return 'refuse';
    }
    case 'truce':
      if (party.aggression >= 8 || (evil && !talker)) return 'refuse';
      if (good || party.caution >= 5 || party.avgHpPct < 0.7) return talker ? 'persuade' : 'accept';
      return 'persuade';
  }
}

/** The difficulty of talking a band round, by what is asked of it. */
export function parleyDc(offer: ParleyOffer, foes: ParleyFoe[]): number {
  const weight = Math.floor(foeStrength(foes));
  switch (offer) {
    case 'surrender': return 10 + weight;   // squeezing more from the beaten
    case 'toll': return 13 + weight;        // talking down the strong
    case 'truce': return 11 + weight;       // selling peace to equals
  }
}

export interface ParleyResult {
  fight: boolean;
  /** Gold the party gains (positive) or pays (negative). */
  gold: number;
  /** Experience per member, for a meeting handled well. */
  xp: number;
  /** The foes leave the field. */
  foesLeave: boolean;
  lines: string[];
}

/**
 * How it ends. `check` is the Charisma roll's outcome when the response was
 * to persuade; otherwise it is ignored.
 */
export function resolveParley(
  offer: ParleyOffer,
  response: ParleyResponse,
  foes: ParleyFoe[],
  party: ParleyParty,
  speaker: string,
  check: { success: boolean; natural: number } | null,
): ParleyResult {
  const band = bandName(foes);
  const xpEach = Math.round(10 + foeStrength(foes) * 15);
  switch (offer) {
    case 'surrender': {
      const ransom = ransomFor(foes);
      if (response === 'refuse') {
        return { fight: true, gold: 0, xp: 0, foesLeave: false, lines: [`${speaker} lets the offer hang, then answers it with steel. The ${band} fight like the cornered thing they are.`] };
      }
      if (response === 'persuade' && check) {
        if (check.success) {
          return { fight: false, gold: ransom * 2, xp: xpEach, foesLeave: true, lines: [`${speaker} names a price twice what was offered, and does not blink. The ${band} pay it, and go.`] };
        }
        return { fight: true, gold: 0, xp: 0, foesLeave: false, lines: [`${speaker} pushes for more, and pushes too far. The ${band} decide they would rather die on their feet.`] };
      }
      return { fight: false, gold: ransom, xp: Math.round(xpEach / 2), foesLeave: true, lines: [`${speaker} takes the coin. The ${band} back away into the dark, and no one is sorry.`] };
    }
    case 'toll': {
      const toll = tollFor(foes, party);
      if (response === 'accept') {
        return { fight: false, gold: -toll, xp: 0, foesLeave: true, lines: [`${speaker} counts out ${toll} gold without a word. The ${band} let them pass, and the coin is the cheapest wound of the day.`] };
      }
      if (response === 'persuade' && check) {
        if (check.natural === 20) {
          return { fight: false, gold: 0, xp: xpEach * 2, foesLeave: true, lines: [`${speaker} laughs at the toll, and says something so precisely true about the ${band}'s leader that the band laughs too. They wave the party through, and one of them salutes.`] };
        }
        if (check.success) {
          return { fight: false, gold: -Math.round(toll / 3), xp: xpEach, foesLeave: true, lines: [`${speaker} talks the toll down to a third and makes it sound like a favour to the ${band}. They take it.`] };
        }
        return { fight: true, gold: 0, xp: 0, foesLeave: false, lines: [`${speaker} tries the honeyed word, and the ${band} have heard it before. The toll is blood now.`] };
      }
      return { fight: true, gold: 0, xp: 0, foesLeave: false, lines: [`"We pay no tolls," ${speaker} says, and the ${band} shrug and come on.`] };
    }
    case 'truce': {
      if (response === 'refuse') {
        return { fight: true, gold: 0, xp: 0, foesLeave: false, lines: [`${speaker} does not want a truce. The ${band} see it in the stance before the words, and the words never come.`] };
      }
      if (response === 'persuade' && check) {
        if (check.success) {
          return { fight: false, gold: 0, xp: xpEach, foesLeave: true, lines: [`${speaker} finds the thing the ${band} want more than a fight, and offers it: a way out that costs neither side. Blades go home. Both parties back down the corridor watching each other, and then they are gone.`] };
        }
        return { fight: true, gold: 0, xp: 0, foesLeave: false, lines: [`${speaker} talks, and for a moment it holds. Then someone on the other side loses their nerve.`] };
      }
      // Accepting a truce with no one to sell it: it holds on the party's plain manner.
      return { fight: false, gold: 0, xp: Math.round(xpEach / 2), foesLeave: true, lines: [`${speaker} lowers a weapon and waits. After a long moment, the ${band} do the same. Each side takes the other's measure, and each side goes its own way.`] };
    }
  }
}

function bandName(foes: ParleyFoe[]): string {
  const names = [...new Set(foes.map(f => f.name.replace(/^[^\w]+/, '')))];
  if (names.length === 1) return foes.length === 1 ? names[0].toLowerCase() : `${names[0].toLowerCase()}s`;
  return names.map(n => n.toLowerCase()).join(' and ');
}

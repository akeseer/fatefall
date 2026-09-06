/**
 * Party banter: two members, a room, a few words.
 *
 * Pure. Given the party and where they have just walked into, returns a
 * short exchange or nothing. Lines are keyed by the room's feature and the
 * speakers' classes and dials, so a rogue in a vault and a cleric at an
 * altar do not say the same thing.
 */

export interface BanterMember {
  name: string;
  classId: string;
  greed: number;
  caution: number;
  aggression: number;
  hpPct: number;
}

type Line = (a: BanterMember, b: BanterMember) => string[] | null;

const pick = <T>(arr: T[], rng: () => number): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

const BY_FEATURE: Record<string, Line[]> = {
  altar: [
    (a, b) => a.classId === 'cleric' || a.classId === 'paladin'
      ? [`${a.name}: "Whoever this was for is not listening any more."`, `${b.name}: "Then it will not mind if we do not kneel."`]
      : [`${a.name}: "Do we pray, or do we loot it?"`, `${b.name}: "Pray first. Loot is a kind of prayer."`],
  ],
  vault: [
    (a, b) => a.greed >= 6
      ? [`${a.name}: "That lock is a promise. Somebody promised us something."`, `${b.name}: "Somebody promised whoever built it something, and you see how that went."`]
      : [`${a.name}: "A vault. Someone's whole life is behind that."`, `${b.name}: "Someone's whole death, more likely."`],
  ],
  prison: [
    (a, b) => [`${a.name}: "Empty cells are worse than full ones."`, `${b.name}: "Depends who was in them."`],
  ],
  chest: [
    (a, b) => a.classId === 'rogue'
      ? [`${a.name}: "Nobody touch it. Nobody breathe on it. Give me a minute."`, `${b.name}: "You said that about the last one."`, `${a.name}: "And the last one didn't eat anyone."`]
      : [`${a.name}: "Chest."`, `${b.name}: "Mimic."`, `${a.name}: "Chest."`, `${b.name}: "We will see."`],
  ],
  library: [
    (a, b) => a.classId === 'wizard' || a.classId === 'artificer'
      ? [`${a.name}: "Nobody move. I need an hour."`, `${b.name}: "You have the time it takes me to get bored."`]
      : [`${a.name}: "Books."`, `${b.name}: "Some of them are looking at us."`],
  ],
  forge: [
    (a, b) => [`${a.name}: "Still warm."`, `${b.name}: "Then whoever works it is still here."`],
  ],
  throne: [
    (a, b) => a.aggression >= 6
      ? [`${a.name}: "I am going to sit in it."`, `${b.name}: "You are absolutely not going to sit in it."`]
      : [`${a.name}: "A throne with no king."`, `${b.name}: "Give it a minute."`],
  ],
  sarcophagus: [
    (a, b) => [`${a.name}: "If it opens by itself, I am leaving."`, `${b.name}: "If it opens by itself, you are staying and I am leaving."`],
  ],
  fountain: [
    (a, b) => [`${a.name}: "Is it safe to drink?"`, `${b.name}: "It is water in a dungeon. What do you think?"`],
  ],
  hazard: [
    (a, b) => a.caution >= 6
      ? [`${a.name}: "I do not like this room."`, `${b.name}: "You have not liked a room since the surface."`]
      : [`${a.name}: "Race you across."`, `${b.name}: "No."`],
  ],
  puzzle_room: [
    (a, b) => [`${a.name}: "A door that asks questions."`, `${b.name}: "Everything down here asks questions. This one at least waits for an answer."`],
  ],
  merchant_camp: [
    (a, b) => [`${a.name}: "Who sells things down here?"`, `${b.name}: "Someone who knows exactly how much we will pay."`],
  ],
};

const GENERAL: Line[] = [
  (a, b) => a.hpPct < 0.5 ? [`${b.name}: "You are bleeding on my boots."`, `${a.name}: "Then walk faster."`] : null,
  (a, b) => [`${a.name}: "Did you hear that?"`, `${b.name}: "I hear everything. I am choosing not to."`],
  (a, b) => a.greed >= 7 ? [`${a.name}: "This floor has a smell."`, `${b.name}: "Damp?"`, `${a.name}: "Gold."`] : null,
  (a, b) => b.caution >= 7 ? [`${b.name}: "Slowly."`, `${a.name}: "You always say slowly."`, `${b.name}: "And you are always still alive."`] : null,
  (a, b) => a.classId === 'bard' ? [`${a.name}: "This would make a good verse."`, `${b.name}: "Everything makes a good verse if you are the one who lived."`] : null,
  (a, b) => a.classId === 'barbarian' ? [`${a.name}: "I am going to hit the next thing I see."`, `${b.name}: "The next thing you see is me."`, `${a.name}: "The next thing after that."`] : null,
];

/**
 * An exchange for the room the party has just entered, or null. Roughly
 * one room in four says something; `rng` decides.
 */
export function banterFor(members: BanterMember[], featureKind: string | null, rng: () => number = Math.random): string[] | null {
  if (members.length < 2 || rng() > 0.28) return null;
  const a = pick(members, rng);
  const b = pick(members.filter(m => m !== a), rng);
  const pool = [...(featureKind && BY_FEATURE[featureKind] ? BY_FEATURE[featureKind] : []), ...GENERAL];
  for (let tries = 0; tries < 4; tries++) {
    const lines = pick(pool, rng)(a, b);
    if (lines) return lines;
  }
  return null;
}

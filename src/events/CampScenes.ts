/**
 * Camp scenes: one short vignette at each long rest.
 *
 * A campaign is not only the fights. When the party camps, one of them talks,
 * two of them argue, the watch sees something, or someone dreams. The scene
 * is picked and written here, pure, from the party as it stands; `Game`
 * shows the card and applies the small effect the scene carries.
 */

export interface CampMember {
  name: string;
  className: string;
  raceName: string;
  hpPct: number;
  /** Personality dials, 0–10. */
  loyalty: number;
  caution: number;
  greed: number;
  /** Ability modifier used for the watch's Perception roll. */
  wisMod: number;
  deity?: string;
  background?: string;
}

export interface CampContext {
  placeName: string;
  floor: number;
  /** The next act's title, if the story has one waiting. */
  nextActTitle?: string;
  /** How far the calendar has come, for the odd seasonal line. */
  season?: string;
}

export type CampEffect =
  /** The talk steadies them: a flat attack bonus for the next fights. */
  | { kind: 'edge'; attack: number; fights: number }
  /** Rest sits well: everyone regains a few hit points beyond the rest. */
  | { kind: 'heal'; dice: [count: number, sides: number] }
  /** The watch: `watcher` rolls Perception against `dc`. */
  | { kind: 'watch'; watcher: string; dc: number }
  /** A dream or omen: nothing mechanical, but the story is nudged. */
  | { kind: 'omen' }
  | { kind: 'none' };

export interface CampScene {
  id: string;
  title: string;
  body: string;
  effect: CampEffect;
}

type Scene = (m: CampMember[], ctx: CampContext, rng: () => number) => CampScene | null;

const pick = <T>(arr: T[], rng: () => number): T => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

const SCENES: Scene[] = [
  // A backstory piece, from whoever has the most to tell.
  (m, ctx, rng) => {
    const teller = pick(m, rng);
    const openers = [
      `${teller.name} feeds the fire and, for once, talks.`,
      `Late, when the others think ${teller.name} is asleep, the ${teller.className.toLowerCase()} speaks up.`,
      `${teller.name} turns a coin over and over, then puts it away and tells them.`,
    ];
    const pieces = [
      teller.background
        ? `Before all this there was the life of a ${teller.background.toLowerCase()}, and a door that closed behind it. "I didn't leave," ${teller.name} says. "I was left."`
        : `There was a village once, and a name ${teller.name} does not use any more. "Everyone I owed is dead. That's the only reason I can afford to be here."`,
      teller.deity
        ? `"${teller.deity} spoke to me once. Once. I have been trying to earn a second word ever since, and I think it is somewhere down here."`
        : `"I had a sister who could have done this better than any of us. I carry her knife. I'd like it to have been in the right hands at least once."`,
      `"You all think I'm here for the gold." A long pause. "I'm here because when I stand next to you people I stop hearing the other thing."`,
    ];
    const closers = [
      'No one says anything clever. Someone passes the waterskin. It is enough.',
      'The fire settles. In the morning nobody mentions it, and everyone stands a little closer in the line.',
      'The watch changes. The one taking it puts a hand on the teller\'s shoulder in passing.',
    ];
    return {
      id: 'backstory',
      title: `${teller.name} speaks`,
      body: `${pick(openers, rng)}\n\n${pick(pieces, rng)}\n\n${pick(closers, rng)}`,
      effect: { kind: 'edge', attack: 1, fights: 2 },
    };
  },
  // Two of them argue, and it costs a little or settles something.
  (m, ctx, rng) => {
    if (m.length < 2) return null;
    const a = pick(m, rng);
    const b = pick(m.filter(x => x !== a), rng);
    const hot = a.caution < b.caution ? a : b;
    const cold = hot === a ? b : a;
    const body = `It starts over the fire — who is carrying too much, who nearly got who killed on the last floor. ${hot.name} wants to push deeper tonight. ${cold.name} wants to turn back and come at ${ctx.placeName} again with more than hope.\n\n"You'd have us die careful," ${hot.name} says.\n\n"I'd have us not die," ${cold.name} says, and that is where it stops, because neither is wrong.\n\nThe rest of the camp pretends to sleep. In the morning the two of them share the watch without a word, and the line moves as one again.`;
    return { id: 'argument', title: 'Words by the fire', body, effect: { kind: 'none' } };
  },
  // The watch: the sharpest eyes take the middle watch and roll for it.
  (m, ctx, rng) => {
    const watcher = [...m].sort((x, y) => y.wisMod - x.wisMod)[0];
    const body = `${watcher.name} takes the middle watch, the one nobody wants. The fire is banked to embers. ${ctx.floor > 1 ? 'Somewhere below, water drips onto stone in a rhythm that is almost, but not quite, footsteps.' : 'Outside the light, the dark has a texture to it.'}\n\nA little after the deepest hour, something changes. A shift in the air. A sound that stops.`;
    return {
      id: 'watch',
      title: 'The middle watch',
      body,
      effect: { kind: 'watch', watcher: watcher.name, dc: 11 + Math.floor(ctx.floor / 2) },
    };
  },
  // A good night: the rest actually rests.
  (m, ctx, rng) => {
    const cook = pick(m, rng);
    const meals = ['a stew of something that was probably a rabbit', 'hard bread softened in wine', 'the last of the good cheese, shared out to the crumb', 'a soup made mostly of hope and one onion'];
    const body = `${cook.name} cooks, which is a surprise to everyone, and it is ${pick(meals, rng)}. It is the best thing anyone has eaten since the road.\n\nFor an hour ${ctx.placeName} is not a place where things want to kill them. It is a fire, and people around it, and a story someone has told before that gets better each time.\n\nThey sleep. Really sleep.`;
    return { id: 'good_night', title: 'A good fire', body, effect: { kind: 'heal', dice: [1, 6] } };
  },
  // A dream or omen, tied to the story when there is one.
  (m, ctx, rng) => {
    const dreamer = pick(m, rng);
    const tail = ctx.nextActTitle
      ? `When ${dreamer.name} wakes, the words are already going, but one stays: ${ctx.nextActTitle}. It means nothing yet. It will.`
      : `When ${dreamer.name} wakes, the words are already going. Only the shape of the door remains, and the certainty that it is somewhere below.`;
    const body = `${dreamer.name} dreams of a door.\n\nIt is not a door in ${ctx.placeName}, or in any place the party has been. It is old, and it is listening, and on the other side of it something says the party's names in the order they will die.\n\n${tail}`;
    return { id: 'omen', title: 'A dream of a door', body, effect: { kind: 'omen' } };
  },
  // The greedy one counts the take, and the loyal one counts the party.
  (m, ctx, rng) => {
    if (m.length < 2) return null;
    const greedy = [...m].sort((x, y) => y.greed - x.greed)[0];
    const loyal = [...m.filter(x => x !== greedy)].sort((x, y) => y.loyalty - x.loyalty)[0];
    const hurt = m.filter(x => x.hpPct < 0.5).map(x => x.name);
    const body = `${greedy.name} lays the take out on a cloak and counts it twice, lips moving.\n\n${loyal.name} watches ${hurt.length > 0 ? `${hurt.join(' and ')} instead, the way they favour one side when they sit` : 'the others instead, the way each of them sits a little apart'}.\n\n"We're doing well," ${greedy.name} says.\n\n"We're doing well," ${loyal.name} agrees, and means something else entirely, and checks the bandages one more time before sleeping.`;
    return { id: 'the_count', title: 'The count', body, effect: { kind: 'none' } };
  },
];

/**
 * Pick a scene for this camp. Scenes that do not fit the party (an argument
 * needs two people) fall through to the next roll.
 */
export function pickCampScene(members: CampMember[], ctx: CampContext, rng: () => number = Math.random): CampScene | null {
  if (members.length === 0) return null;
  for (let tries = 0; tries < 8; tries++) {
    const scene = pick(SCENES, rng)(members, ctx, rng);
    if (scene) return scene;
  }
  // The dice kept landing on scenes that need more people: take the first that fits.
  for (const make of SCENES) {
    const scene = make(members, ctx, rng);
    if (scene) return scene;
  }
  return null;
}

/** What the watch found, once the die is read. */
export function readWatch(watcher: string, success: boolean, natural: number): { lines: string[]; ambush: boolean; gold: number } {
  if (natural === 20) {
    return {
      lines: [`${watcher} is on their feet before the sound finishes. It is a lost pack, dropped by someone who did not make it this far, and it is heavy.`],
      ambush: false,
      gold: 25,
    };
  }
  if (success) {
    return {
      lines: [`${watcher} sees it: a shape at the edge of the light, weighing the camp. ${watcher} lets it see the drawn blade. It decides otherwise.`],
      ambush: false,
      gold: 0,
    };
  }
  return {
    lines: [`${watcher} hears it too late. The camp wakes to the sound of something already inside the light.`],
    ambush: true,
    gold: 0,
  };
}

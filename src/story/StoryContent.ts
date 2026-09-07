/**
 * The words of the story: everything the planner draws from when it writes
 * an act. Nothing here decides anything; `Story.ts` does the choosing.
 *
 * The frame is fixed. Once, a die was cast that decided the fate of the
 * world, and it shattered on the throw. Its shards fell across the land, and
 * whoever holds a shard bends a little of fate. The first act is the same in
 * every run: the party learns this from an old woman in a tavern and takes the
 * first shard back from the Ashen Warden in a crypt near the road. After that
 * the shards are held by antagonists the planner assembles from these tables,
 * with motives, twists and a hard choice at the end of each, and the choices
 * change what the tables can produce next. The finale takes the party to the
 * one who has been gathering shards behind every act, and how that ends
 * depends on what the party chose along the way.
 */

import type { MonsterTemplate } from '../entities/Monster';

export type MonsterType = MonsterTemplate['type'];

/** A kind of enemy the story can build an act around. */
export interface Antagonist {
  id: string;
  /** The monster type its boss is drawn from. */
  monsterType: MonsterType;
  /** Names for the boss, drawn with the epithets below. */
  names: string[];
  epithets: string[];
  /** What the party hears about them in taverns. */
  rumor: string[];
  /** How the act opens: {name} is the antagonist, {shard} the shard's name, {place} the lair. */
  intro: string[];
  /** When the boss falls. */
  fall: string[];
  /** A dungeon theme id this antagonist favours, when the lair can be chosen. */
  themes: string[];
  /** The party arrives on the boss's floor: what the place is like at the threshold. */
  threshold: string[];
  /** The boss's first words when the fight opens. */
  taunt: string[];
  /** The boss at half its hit points. */
  bloodied: string[];
  /** What the people of the giver town say of the antagonist while the act is on. */
  herald: string[];
}

/** Why the antagonist wants the shard. Colours the intro and the choice. */
export interface Motive {
  id: string;
  line: string;
  /** Flags that make this motive more likely. */
  favouredBy?: string[];
}

/** A turn the act takes at its end, told when the boss falls. */
export interface Twist {
  id: string;
  text: string;
  /** Flags this twist requires, or that rule it out. */
  requires?: string[];
  forbids?: string[];
}

/** One of the options offered when an act ends. */
export interface ChoiceOption {
  id: string;
  label: string;
  text: string;
  /** Flags set by choosing this. */
  flags: string[];
  /** Mechanical effects, applied by the game. */
  gold?: number;
  xp?: number;
  /** A town's standing changes: positive is gratitude, negative is fear. */
  reputation?: number;
  /** The next act's recommended level shifts by this much. */
  difficulty?: number;
}

export interface Choice {
  id: string;
  prompt: string;
  options: ChoiceOption[];
  requires?: string[];
  forbids?: string[];
}

/** The shards, one per act. Their names come up in every line about them. */
export const SHARD_NAMES = [
  'the First Shard',
  'the Ember Shard',
  'the Drowned Shard',
  'the Hollow Shard',
  'the Crown Shard',
  'the Last Shard',
];

export const ANTAGONISTS: Antagonist[] = [
  {
    id: 'lich_choir',
    monsterType: 'undead',
    names: ['Vessimar', 'Orlathe', 'Harrow', 'Cindrel', 'Maugrim', 'Selvane'],
    epithets: ['the Pale Cantor', 'of the Choir Below', 'the Unburied', 'Who Counts the Dead', 'the Bone Sexton'],
    rumor: [
      'the dead in {place} have started singing, and the song has words',
      'nobody who goes into {place} comes out, but their voices do',
    ],
    intro: [
      '{name} keeps {shard} in {place}, and has been using it to call the buried back into their bones. The choir grows by a voice a night.',
      'The graves around {place} are empty. {name} holds {shard} there and sings the dead up out of the ground to stand in ranks.',
    ],
    fall: ['{name} comes apart mid-verse. The choir falls silent for the first time in a season, and {shard} lies among the bones.'],
    threshold: [
      'The last stair opens on a nave of bone. Every rib in the walls is a pipe, and the whole floor is breathing in, slowly, ready to sing.',
      'The singing is under the floor now. It has words, and the words are the party’s names, in an order that sounds like a list.',
    ],
    taunt: ['“Four more voices,” says {name}. “I had hoped for five. Sing with me, then, or be sung.”', '“You came a long way to be a verse,” says {name}. “Stand still. It is easier.”'],
    bloodied: ['{name} falters mid-line, and the choir loses its place. “No matter. I have sung through worse deaths than this.”', '“You are off the beat,” hisses {name}, and for the first time the choir is louder than the cantor.'],
    herald: [
      'the sexton in {town} has stopped digging graves; “they only get up again,” he says',
      'a girl in {town} sings in her sleep in a voice that is not hers, and the words are about {place}',
    ],
    themes: ['crypt', 'necropolis', 'catacombs'],
  },
  {
    id: 'dragon_hoard',
    monsterType: 'dragon',
    names: ['Ashkaraz', 'Veldrith', 'Mornag', 'Sythrax', 'Ignatha', 'Korrovane'],
    epithets: ['the Ash Tyrant', 'Who Burns the Ledger', 'the Old Debt', 'the Coin-Sleeper', 'Hoardfather'],
    rumor: [
      'the caravans past {place} pay a toll now, in gold or in drivers',
      'something in {place} is buying every ounce of gold at twice its worth and asking no questions',
    ],
    intro: [
      '{name} has {shard} set into a hoard beneath {place}, and with it every coin the region loses seems to find its way there. The towns are going quietly broke.',
      'Under {place}, {name} sleeps on {shard} and dreams the harvests thin. The granaries are emptying and nobody can say where the grain went.',
    ],
    fall: ['{name} falls across the hoard with a sound like a bell. {shard} rolls free of the gold, warm to the touch.'],
    threshold: [
      'The stair ends in a vault whose floor is coin to the ankle. The heat comes up through it. Somewhere ahead, something very large turns over on its side.',
      'The last door has been eaten. Past it the hoard glows like a hearth, and on top of it the shape of {name} is only a darker warmth.',
    ],
    taunt: ['“I know what you are worth,” says {name}, “to the coin. It is not much. Come and be counted.”', '“Every coin here was owed me,” says {name}. “So were you, eventually.”'],
    bloodied: ['{name} coughs sparks across the hoard. “A debt,” it rasps, “is only paid once. This one is not paid yet.”', '“Ah,” says {name}, tasting its own blood. “Interest.”'],
    herald: [
      'the moneylender in {town} has closed shop and gone to {place} with a wagon, and nobody expects the wagon back',
      'gold in {town} is light in the hand this month; “it wants to be elsewhere,” says the smith',
    ],
    themes: ['volcanic', 'caverns', 'mine'],
  },
  {
    id: 'cult_of_the_throw',
    monsterType: 'humanoid',
    names: ['Brother Tally', 'Mother Odds', 'Deacon Sixes', 'the Caller', 'Sister Wager', 'Prior Cast'],
    epithets: ['of the Second Throw', 'Who Reads the Pips', 'the Loaded Hand', 'Keeper of the Cup', 'the Even Chance'],
    rumor: [
      'a new faith is preaching in the villages near {place}: that the die can be thrown again, if enough is staked',
      'whole hamlets near {place} have walked off into the hills after a preacher with a cup of bones',
    ],
    intro: [
      '{name} leads a congregation in {place} that means to throw {shard} again and remake the world on a better roll. What they are staking is the villages around them.',
      'In {place}, {name} has {shard} on an altar and a hundred faithful chanting numbers. They believe the world can be re-rolled. They are not entirely wrong.',
    ],
    fall: ['{name} dies asking what the number was. The congregation scatters into the dark, and {shard} is left on its altar, still humming.'],
    threshold: [
      'The last flight of steps is chalked with numbers, thousands of them, every one crossed out but the last. Chanting comes up the stair in time with the party’s feet.',
      'The hall below is a gambling den built as a church: pews, a cup, an altar with {shard} on it, and a hundred faithful counting under their breath.',
    ],
    taunt: ['“Welcome, dice,” says {name}. “You were always going to be thrown. Stand on the number.”', '“Sixes,” says {name}, not looking up. “The book says you die on sixes. Let us see the book proved.”'],
    bloodied: ['“That was not the number,” says {name}, bleeding onto the altar. “Throw again. Throw again.”', '{name} laughs, red-toothed. “The house always loses in the end. That is the whole faith.”'],
    herald: [
      'three families from {town} have walked to {place} with everything they own, to be staked',
      'a preacher passed through {town} last market day with a cup of bones and left with the miller’s daughter',
    ],
    themes: ['temple', 'ruins', 'sewers'],
  },
  {
    id: 'fey_court',
    monsterType: 'fey',
    names: ['Lord Everwhen', 'Lady Sennight', 'the Marquis of Later', 'Queen Almost', 'Prince Otherwise', 'the Dowager of Ifs'],
    epithets: ['of the Court of Maybes', 'Who Owns the Hour', 'the Unkept Promise', 'of the Second Path', 'the Borrowed Year'],
    rumor: [
      'time runs wrong near {place}: a shepherd went in for an afternoon and came out with a grey beard',
      'the woods around {place} have started offering bargains, and taking them',
    ],
    intro: [
      '{name} holds court in {place} with {shard} for a throne, and every road nearby now leads somewhere it should not. Travellers arrive years late or years early.',
      'Beneath {place}, {name} has made {shard} the centrepiece of a revel that has not ended in a season. The guests cannot leave. Some of them are missed.',
    ],
    fall: ['{name} bows, and is not there when the bow ends. The revel unwinds like a dropped thread and {shard} lies on the empty throne.'],
    threshold: [
      'The stair goes on for a long while, or a short one; the party cannot agree. At the bottom is a hall lit for a dance that is still happening, and the dancers do not look up.',
      'Past the last door the season is wrong. It is summer and the party is hungry and it is a year later and {name} is waiting with a chair pulled out.',
    ],
    taunt: ['“You are late,” says {name}, “and early, and exactly on time. Sit down. Dance. Die. The order hardly matters here.”', '“Oh, guests,” says {name}. “I will keep you. I keep everything.”'],
    bloodied: ['{name} looks at the blood as if it were a rude word. “That was not part of the bargain. There was no bargain. Still.”', '“Enough,” says {name}, and the music stumbles, and the dancers, for a heartbeat, look like people.'],
    herald: [
      'the road from {town} to {place} took a carter a week and his horse an afternoon',
      'the bell-ringer in {town} rang noon twice yesterday and swears both were right',
    ],
    themes: ['fey_glade', 'forest', 'grotto'],
  },
  {
    id: 'aberrant_mind',
    monsterType: 'aberration',
    names: ['the Unnamed', 'Ythollo', 'the Listener', 'Quell', 'the Ninefold', 'Sarranth'],
    epithets: ['Who Dreams Awake', 'the Many-Mouthed', 'Beneath the Well', 'the Patient Thought', 'of the Deep Argument'],
    rumor: [
      'people near {place} are having the same dream, and in it they are digging',
      'the well at {place} has started answering questions, and the answers are true',
    ],
    intro: [
      '{name} has {shard} in the deep under {place} and is thinking with it. The thoughts leak: the towns nearby share a dream, and in the dream they walk toward the well.',
      'Something in {place} has {shard}. It does not want the world re-rolled; it wants to be the one doing the rolling. It has begun with the minds nearest to hand.',
    ],
    fall: ['{name} folds inward, thought by thought, until only the shard is left of it. The dreams stop that night, everywhere at once.'],
    threshold: [
      'The stair is wet and the wet is warm. At the bottom the walls are thinking; the party can feel the shape of it, like a word on the tip of the tongue.',
      'The last room is a well, and the well is looking up. The party has dreamed this. Everyone in the region has.',
    ],
    taunt: ['{name} does not speak; the party hears it anyway. IT HAS BEEN DIGGING YOU OUT OF YOUR DREAMS FOR A SEASON. IT IS NEARLY DONE.', 'YOU ARE EARLY, thinks {name}, and the thought has weight. THE HOLE IS NOT FINISHED.'],
    bloodied: ['Something in the room screams without a mouth, and for a moment the party cannot remember its own names. Then it can.', '{name} folds a fraction inward. IT HURTS, it thinks, surprised. IT HAS NOT HURT BEFORE.'],
    herald: [
      'half of {town} woke this morning with dirt under their nails and a well in their heads',
      'the priest in {town} has stopped taking confessions; everyone confesses the same dream',
    ],
    themes: ['abyss', 'caverns', 'ruins'],
  },
  {
    id: 'infernal_broker',
    monsterType: 'fiend',
    names: ['Malquist', 'Abbadra', 'Vintrel', 'Sorrowmere', 'Kharsis', 'the Notary'],
    epithets: ['Who Holds the Paper', 'the Fair Trader', 'of the Long Contract', 'the Reasonable Devil', 'Whose Ink Is Red'],
    rumor: [
      'the magistrate at the town nearest {place} signed something last month, and the town has been lucky since, in a way nobody likes',
      'a well-spoken stranger has been buying debts near {place} and forgiving them all',
    ],
    intro: [
      '{name} runs a counting-house under {place} where {shard} weights the scales. Every bargain struck within a day’s ride now favours the house.',
      '{name} holds {shard} in {place} and has been lending fortune at interest. The towns around are prospering, and the first payments are coming due.',
    ],
    fall: ['{name} tears the contract as it dies, out of spite. The luck goes out of the region like a tide, and {shard} is left on the desk.'],
    threshold: [
      'The stair is carpeted. At its foot a clerk with too many joints looks up and says the party is expected, and that the terms are on the desk.',
      'The last hall is an office, warm and well lit, with a ledger open on the desk and every name in it the party knows.',
    ],
    taunt: ['“Have a seat,” says {name}. “I have your account here. It is in arrears. We can discuss terms, or we can discuss teeth.”', '“Everyone comes to collect,” says {name}, uncapping a red pen. “Nobody reads the small print.”'],
    bloodied: ['{name} dabs at the wound with a contract. “A penalty clause,” it says. “I do not recall agreeing to one.”', '“Very well,” says {name}, and its voice loses its warmth entirely. “Default, then.”'],
    herald: [
      'the magistrate in {town} is rich and thin and does not sleep, and his signature is on something at {place}',
      'debts in {town} have all been forgiven by a stranger, and the town is more frightened than grateful',
    ],
    themes: ['volcanic', 'temple', 'sewers'],
  },
  {
    id: 'giant_king',
    monsterType: 'giant',
    names: ['Hrothgeir', 'Skallamund', 'Ulfrimm', 'Bregga', 'Thorvane', 'Grendmaw'],
    epithets: ['the Mountain’s Fist', 'Who Would Be Weather', 'Stormhold', 'of the Broken Peak', 'the Toll-Taker'],
    rumor: [
      'the pass by {place} is closed by a landslide that moves when nobody is looking',
      'a giant has been seen carrying a lantern up the slopes near {place}, and the lantern is not a lantern',
    ],
    intro: [
      '{name} has {shard} set in a crown and rules the peaks above {place} with it. The weather does what {name} says, and lately it says drought.',
      'Under {place}, {name} is building a hall with {shard} for a hearthstone, and the mountains are shrugging. Villages on the slopes have moved twice.',
    ],
    fall: ['{name} sits down as if tired and does not get up. The mountain settles. {shard} rolls out of the crown across the stone.'],
    threshold: [
      'The stair is cut for legs twice the party’s length. At its head the hall is a mountain hollowed, and the hearthstone at its heart is the shard, and the room is warm as a forge.',
      'Wind comes down the last stair, though there is no sky here. {name} makes the weather, and the weather knows the party is coming.',
    ],
    taunt: ['“Small things,” says {name}, and the word comes down like a slab. “Small things with sharp edges. Come and be weather.”', '“I have moved villages,” says {name}. “I will move you a shorter way.”'],
    bloodied: ['{name} goes to one knee and the floor cracks with it. “The mountain,” it says, “is older than the wound.”', '“Well struck,” says {name}, and something like respect crosses a face the size of a door. “Once more, then.”'],
    herald: [
      'the pass above {town} has closed three times this month, each time with a sound like a decision',
      'the shepherds of {town} have brought the flocks down early; the slopes above {place} are walking',
    ],
    themes: ['mountain', 'mine', 'ruins'],
  },
  {
    id: 'clockwork_will',
    monsterType: 'construct',
    names: ['the Engine', 'Unit Meridian', 'the Second Maker', 'Tallyman', 'the Regulator', 'Warden Nought'],
    epithets: ['That Counts', 'Which Does Not Sleep', 'of the Perfect Roll', 'the Corrected', 'Which Finishes Things'],
    rumor: [
      'the mills near {place} run at night with nobody inside them',
      'a made thing walked out of {place} and asked a farmer what luck was',
    ],
    intro: [
      'A mind made of gears has {shard} in {place} and has concluded that chance is an error. It is correcting the region one outcome at a time; nothing there has surprised anyone in weeks.',
      '{name} holds {shard} beneath {place} and is using it to make the dice come up the same, every time, forever. The gamblers left first. The farmers are leaving now.',
    ],
    fall: ['{name} stops. Not breaks: stops, mid-motion, as if a decision was reached. {shard} is warm in its open hand.'],
    threshold: [
      'The stair is exactly regular. At its foot every surface is clean, and a ticking fills the hall, and the ticking has not missed a beat in a season.',
      'The last door opens itself at the party’s approach, at the correct moment, to the correct width. {name} has been expecting them to the second.',
    ],
    taunt: ['“Probability of your success,” says {name}, “is being corrected.”', '“You are the last variable,” says {name}. “Hold still while I solve for you.”'],
    bloodied: ['{name} stops, restarts. “Unexpected,” it says. “Recording. Continuing.”', '“Error,” says {name}, and for a moment the ticking is out of time with itself, and every dice in the party’s packs rattles.'],
    herald: [
      'the mill at {town} ground the same weight of flour every day for a month, to the ounce, and the miller has taken to drink',
      'a made thing walked through {town} at night counting the houses, and it counted them right',
    ],
    themes: ['forge', 'mine', 'ruins'],
  },
  {
    id: 'hunger_below',
    monsterType: 'ooze',
    names: ['the Tide', 'Mother Slick', 'the Sump', 'Glutt', 'the Undertow', 'Vessel'],
    epithets: ['That Remembers Faces', 'Which Is Patient', 'of the Lower Cistern', 'the Slow Flood', 'Which Fills'],
    rumor: [
      'the cellars near {place} are filling with something that is not water',
      'the river past {place} runs uphill for an hour each dawn',
    ],
    intro: [
      'Something has grown around {shard} in the cisterns beneath {place} and is drinking the wells of every town nearby. The water tables are dropping. So are the people, into the dry ground.',
      'In the deep of {place}, {shard} sits inside a thing that has no name and needs none. It is spreading through the aquifer and it is hungry.',
    ],
    fall: ['The mass sloughs apart and {shard} drops out of it onto the wet stone. The wells fill again over the following week.'],
    threshold: [
      'The stair is slick and the slick moves. The last hall is a cistern, and the water in it is not water, and it has noticed the party.',
      'The last door has been dissolved rather than opened. Beyond it the floor breathes, and somewhere in the mass a warmth marks where {shard} sits.',
    ],
    taunt: ['{name} has no words, but a face rises in it: a townsman the party met once, mouthing something. Then another. Then the party’s own.', 'The mass shapes a mouth to speak and produces only the sound of a well filling. It is, the party understands, a greeting.'],
    bloodied: ['{name} sloughs a limb and the limb keeps coming. The rest recoils toward the shard like a hand closing.', 'The faces in {name} all open their eyes at once, and the party knows it is being remembered.'],
    herald: [
      'the wells of {town} have dropped a fathom; “it is drinking,” says the well-warden, and will not say what',
      'a cellar in {town} filled overnight with something that had a face in it',
    ],
    themes: ['sewers', 'grotto', 'caverns'],
  },
  {
    id: 'thorn_druid',
    monsterType: 'plant',
    names: ['the Greenwarden', 'Ashwold', 'Bramblemother', 'the Old Yew', 'Sallowhand', 'the Verdant'],
    epithets: ['Who Would Plant the World', 'of the Waking Root', 'the Patient Green', 'Whose Ring Is Wide', 'the Overgrowth'],
    rumor: [
      'the fields near {place} were forest this morning',
      'the roads to {place} keep growing over between one traveller and the next',
    ],
    intro: [
      '{name} has planted {shard} in {place} and the wild has taken it as a seed. Forest is moving over farmland at a mile a week, and the towns in its path are packing.',
      'Under {place}, {name} tends {shard} like a bulb, and the region blooms in ways it should not. Wheat comes up as thorns. Orchards walk.',
    ],
    fall: ['{name} goes to seed in a rush of pollen and is gone. The forest stops where it stands, and {shard} lies in the loam like a dropped stone.'],
    threshold: [
      'The stair is roots. At the bottom the hall is a hollow under a tree that should not be this deep, and the shard hangs in it like a fruit.',
      'The last door is grown shut. The party cuts through, and the cuts bleed sap, and the sap is warm.',
    ],
    taunt: ['“You are compost,” says {name}, kindly. “Everything is, in time. Yours has come a little early.”', '“Lie down,” says {name}. “The ground is good here. I have made it good.”'],
    bloodied: ['{name} sheds leaves like a tree in a gale. “The forest,” it says, “does not stop because one tree falls.”', '“Ah,” says {name}. “Iron. I had forgotten iron.”'],
    herald: [
      'the orchard at {town} walked a furlong in the night and stands in the road now, and the apples are watching',
      'the fields of {town} came up thorns; the farmers went to {place} to ask why, and did not come home',
    ],
    themes: ['forest', 'fey_glade', 'ruins'],
  },
  {
    id: 'storm_elemental',
    monsterType: 'elemental',
    names: ['Anemos', 'the Quiet Front', 'Ruvvath', 'the Long Thunder', 'Ssiral', 'Gale-in-the-Stone'],
    epithets: ['Who Is the Weather', 'the Unbroken Front', 'of the Still Eye', 'Which Was Sky', 'the Falling Pressure'],
    rumor: [
      'there is a storm over {place} that has not moved in a month and has an eye you can stand in',
      'lightning strikes the same spot near {place} every hour, and there is a door there now',
    ],
    intro: [
      'A storm has settled over {place} with {shard} at its eye, and it is learning to want things. Rain falls where it is not needed and never where it is.',
      '{name} holds {shard} in the deep of {place} and the sky answers to it. Three harvests have drowned. The next will burn.',
    ],
    fall: ['{name} comes apart into ordinary air. The storm above breaks up over the next hour into a plain grey afternoon, and {shard} lies on the floor of the eye.'],
    threshold: [
      'The last stair descends into the eye. It is very still and very quiet and the pressure makes the party’s ears ache. Around the eye, the storm goes round.',
      'Lightning has scored the last door into a shape. It is the shape of a door. The party goes through and the sky is on the other side, indoors.',
    ],
    taunt: ['{name} speaks in pressure: THE FIELDS ARE DROWNED. THE FIELDS WILL BURN. WHICH ARE YOU.', '“I was the sky once,” says {name}, and the hall crackles. “Now I am the sky that chooses.”'],
    bloodied: ['The eye wobbles. Rain falls indoors, briefly, and the party tastes iron and ozone.', '{name} thins to a line of light and thunders back, angrier and smaller.'],
    herald: [
      'it has rained on {town} for nine days and not once on the fields beside it',
      'the storm over {place} has an eye you can stand in; a boy from {town} did, and came back speaking of a door',
    ],
    themes: ['mountain', 'caverns', 'ruins'],
  },
  {
    id: 'hunting_pack',
    monsterType: 'monstrosity',
    names: ['the Matriarch', 'Old Scar', 'the Quiet One', 'Gorrash', 'the Culler', 'Nine-Teeth'],
    epithets: ['Who Chooses', 'of the Long Hunt', 'the Last of the Pack', 'Who Takes the Firstborn', 'the Winter Mouth'],
    rumor: [
      'the herds near {place} are being taken one animal at a time, always the best one',
      'hunters near {place} say something is choosing which of them comes home',
    ],
    intro: [
      'A pack has denned in {place} around {shard}, and the shard has taught it to choose. It takes the strongest calf, the best hunter, the eldest child. Never at random.',
      '{name} rules a den under {place} with {shard} in its throat, and its hunts are no longer hunts. They are selections.',
    ],
    fall: ['{name} dies looking at the party as if it had been expecting them, and the pack loses its nerve. {shard} is in the den, among the bones.'],
    threshold: [
      'The last stair is scored by claws going up, never down. Below is a den, warm, and full of things that are choosing whether the party is worth the trouble.',
      'Eyes open in the dark of the last hall, one pair at a time, and each pair looks at a different member of the party, as if allotting them.',
    ],
    taunt: ['{name} looks the party over and chooses one of them. The others can see which. “That one,” it says, “first.”', '“You were not chosen,” says {name}. “You came anyway. That is its own kind of choosing.”'],
    bloodied: ['{name} bleeds and does not seem to mind. The pack’s eyes move from the chosen one to whoever drew the blood.', '“Good,” says {name}, through its teeth. “Now it is a hunt.”'],
    herald: [
      'the best hunter in {town} did not come back from {place}; his dog did, and will not go outdoors',
      'the herds of {town} are being thinned one beast a night, always the finest, never at random',
    ],
    themes: ['caverns', 'forest', 'mountain'],
  },
];

export const MOTIVES: Motive[] = [
  { id: 'reroll', line: 'They mean to throw the die again and remake the world to their liking.' },
  { id: 'hoard', line: 'They want the shards as one wants gold: to have, and to have others not.' },
  { id: 'fix', line: 'They believe chance is a wound in the world and mean to close it, so that everything comes out the same forever.' },
  { id: 'revenge', line: 'The first throw took something from them. They want it back, and the world can pay for it.' },
  { id: 'mercy', line: 'They think the world would be kinder with a steadier hand on fate. They may even be right.', favouredBy: ['merciful'] },
  { id: 'hunger', line: 'They do not want anything from the shard. It is simply theirs now, the way the sea is the sea’s.' },
  { id: 'debt', line: 'Someone offered them the shard in exchange for a small favour. The favour is coming due.', favouredBy: ['bargained'] },
  { id: 'fear', line: 'They know who gathers the shards behind all this, and they hold theirs so that he cannot.', favouredBy: ['ruthless'] },
  { id: 'faith', line: 'They were told, in a dream, that they were chosen. Perhaps they were.' },
  { id: 'grief', line: 'Someone they loved died on a bad roll. They mean to make sure nobody ever rolls badly again.' },
  { id: 'legacy', line: 'They are old, and dying, and mean to be remembered as the one who fixed the world before they left it.' },
  { id: 'love', line: 'Someone they love is held by the one who gathers the shards, and the shard is the ransom. They have not stopped to ask whether the ransom will be honoured.' },
  { id: 'order', line: 'They have seen what chance does to the small and the poor, and mean to end it, and are not squeamish about the cost.', favouredBy: ['sworn'] },
  { id: 'sport', line: 'They want nothing from the shard but the fight it brings to their door. They have heard of the party. They are pleased.', favouredBy: ['hunted', 'bounty'] },
];

export const TWISTS: Twist[] = [
  { id: 'messenger', text: 'Among the dead is a courier with a letter that names the party. Someone has been expecting them, and paying to have them watched.' },
  { id: 'false_shard', text: 'The shard is not the shard. It is a copy, good enough to fool the one who held it. The real one left this place a month ago, going north.', forbids: ['seen_forgery'] },
  { id: 'survivor', text: 'One of the antagonist’s followers survives and asks to come along. The party lets them walk to the nearest town instead. They will remember the kindness, or the slight.', forbids: ['ruthless'] },
  { id: 'map', text: 'On the wall of the lair is a map of the shards, with this one crossed out already. Someone else is keeping count.' },
  { id: 'town_burned', text: 'When the party climbs out, smoke stands over the nearest town. The antagonist’s people made one last raid while the party was below.', forbids: ['merciful'] },
  { id: 'offer', text: 'A stranger in a good coat is waiting at the entrance with an offer: the shard, for a price that would set the party up for life. They refuse. The stranger is not surprised.' },
  { id: 'dream', text: 'That night every member of the party dreams the same throw of a die, and wakes knowing the number. It is not a good number.' },
  { id: 'old_friend', text: 'The lair holds a cell, and in it a knight who set out after the shards a year before the party did. Half-mad, but glad of company. They know a name: the Fatebinder.' },
  { id: 'quiet', text: 'Nothing follows. No twist, no letter, no smoke. The party rests a night in the lair with the shard between them and sleeps better than it has in weeks.' },
  { id: 'shard_speaks', text: 'The shard speaks to whoever holds it, in the voice of someone they lost. It offers to bring them back. The party puts it in a sack and does not take it out again.' },
  { id: 'reward', text: 'Word travels ahead of the party. The nearest town has hung banners. There is a feast, and a purse, and a great many questions.', requires: ['merciful'] },
  { id: 'bounty', text: 'There is a bounty on the party now, posted by someone with a great deal of gold and no name. The innkeepers have stopped meeting their eyes.', requires: ['ruthless'] },
  { id: 'shard_hungers', text: 'The shard is heavier than the last. Whoever carries it wakes older. The party takes turns, and does not talk about it.', forbids: ['merciful'] },
  { id: 'crown_notice', text: 'A rider in the Crown’s colours meets the party at the entrance with a writ: the shard is to be surrendered to the capital. The party keeps it, politely. The rider writes that down.', requires: ['crown_favour'] },
  { id: 'ally_warning', text: 'A note is pinned to the entrance post in a hand the party knows: the next lair is watched, and the watchers are not the antagonist’s. The network is paying for itself.', requires: ['ally_network'] },
  { id: 'hunters_close', text: 'Fresh tracks lead down to the lair and stop. Someone was waiting here to take the shard off whoever came out, and thought better of it. They will not think better next time.', requires: ['hunted'] },
  { id: 'the_number_again', text: 'The party rolls a die for the first watch, idly, and it comes up the number from the dream. Nobody sleeps.', requires: ['fated'] },
  { id: 'cold_trail', text: 'The forgery the party once found is explained: this shard is real, and beside it is the mould that made the false one. Someone is manufacturing hope.', requires: ['seen_forgery'] },
  { id: 'letter_two', text: 'A second letter, red wax, on the antagonist’s body. It is addressed to the party and it is shorter than the first. It says: soon.', requires: ['tempted'] },
  { id: 'the_knight_falls', text: 'The knight who walked a day behind the party does not walk out. They held the stair while the party went down, and the stair is held. The party carries the sword.', requires: ['knight_ally'] },
  { id: 'omen_of_ash', text: 'When the boss falls, the ash of the Ashen Warden, long since scattered, drifts through the lair on no wind. The old woman’s dice, in whoever’s pack, come up double one.' },
];

export const CHOICES: Choice[] = [
  {
    id: 'shard_use',
    prompt: 'The shard is warm in the party’s hands. It could be kept safe, or it could be used.',
    options: [
      { id: 'keep', label: 'Keep it sealed', text: 'The party wraps the shard in lead and speaks no wish. Fate stays crooked, and honest.', flags: ['merciful'] },
      { id: 'wish_gold', label: 'Wish for fortune', text: 'The party asks the shard for gold, and gold there is: the next town’s vault, emptied into their packs. The town will not forget.', flags: ['ruthless', 'bargained'], gold: 400, reputation: -20 },
      { id: 'wish_strength', label: 'Wish for strength', text: 'The party asks the shard to make them more than they are. It obliges, and takes a year from each of them in payment.', flags: ['bargained'], xp: 600, difficulty: 1 },
    ],
  },
  {
    id: 'follower_fate',
    prompt: 'The antagonist’s followers are cornered and unarmed. They were villagers, once.',
    options: [
      { id: 'spare', label: 'Send them home', text: 'The party marches them to the road and points. Most go. Some will find the next shard-holder before the party does.', flags: ['merciful'], reputation: 10 },
      { id: 'press', label: 'Press them for what they know', text: 'It takes a night. By morning the party knows a name it did not, and the followers know the party for what it can be.', flags: ['ruthless'], difficulty: -1 },
      { id: 'ransom', label: 'Ransom them to the town', text: 'The town pays to have its people back, and pays again to have the party leave. Everyone is satisfied and nobody is happy.', flags: ['bargained'], gold: 250 },
    ],
  },
  {
    id: 'the_offer',
    prompt: 'A letter, sealed with a die of red wax: the Fatebinder offers a truce. Keep the shards you have; take no more; be rich.',
    options: [
      { id: 'burn', label: 'Burn it', text: 'The party burns the letter unread past the first line. The wax hisses like it is alive.', flags: ['defiant'] },
      { id: 'reply', label: 'Reply, and lie', text: 'The party accepts by return courier and does not mean a word. The Fatebinder does not believe a word either, but the next lair is unguarded for a week.', flags: ['bargained', 'ruthless'], difficulty: -1 },
      { id: 'read', label: 'Read it all', text: 'The party reads it through. It is reasonable, and kind, and it knows things about each of them it should not. They keep it, folded, and speak of it to no one.', flags: ['tempted'] },
    ],
  },
  {
    id: 'the_town',
    prompt: 'The nearest town suffered for the antagonist’s work. Its people ask the party what they are owed.',
    options: [
      { id: 'give', label: 'Give them the spoils', text: 'The party leaves the lair’s treasure in the town square and walks on poorer. Children run after them to the gate.', flags: ['merciful'], gold: -150, reputation: 30 },
      { id: 'nothing', label: 'Nothing', text: 'The party owes the town nothing and says so. It is true. The gate is closed behind them a little faster than it needs to be.', flags: ['ruthless'], reputation: -10 },
      { id: 'protect', label: 'Promise to come back', text: 'The party swears to return when the last shard is taken. The town writes it down.', flags: ['sworn'] },
    ],
  },
  {
    id: 'the_prisoner',
    prompt: 'The knight from the cell asks to join the hunt for the Fatebinder. Half-mad, but a fine sword.',
    requires: ['knight_found'],
    options: [
      { id: 'yes', label: 'Take them along', text: 'The knight walks a day behind the party from then on, scouting, and is worth a fifth member most days.', flags: ['knight_ally'], difficulty: -1 },
      { id: 'no', label: 'Send them to rest', text: 'The party pays for a room in the nearest town for a year. The knight weeps, and sleeps, and does not follow.', flags: ['merciful'], gold: -100 },
    ],
  },
  {
    id: 'the_relic',
    prompt: 'The antagonist’s weapon lies where it fell. It is very fine, and it is not quite quiet.',
    options: [
      { id: 'take', label: 'Take it up', text: 'One of the party takes the weapon and it fits their hand as if it had been waiting. They dream in a stranger’s voice from then on.', flags: ['haunted'], xp: 250 },
      { id: 'sell', label: 'Sell it', text: 'A collector in the next town pays without asking where it came from. The party does not ask where it went.', flags: ['bargained'], gold: 350 },
      { id: 'break', label: 'Break it', text: 'It takes the whole party and a long while. When it goes, the lair is quieter, and so is the shard.', flags: ['merciful'] },
    ],
  },
  {
    id: 'the_survivor_returns',
    prompt: 'The follower the party once sent to the road is waiting at the entrance, thinner, with news of the next shard and a request to be useful.',
    requires: ['survivor_spared'],
    options: [
      { id: 'trust', label: 'Take the news', text: 'The party listens, and pays for a meal, and sends them ahead to listen more. There are eyes on the road now that are the party’s.', flags: ['ally_network'] },
      { id: 'turn_away', label: 'Turn them away', text: 'Once was enough. The party leaves them at the entrance with the meal and no promise. The next lair will have no warning in it.', flags: ['ruthless'] },
      { id: 'hire', label: 'Put them on wages', text: 'Coin changes hands and a runner is born. It is not friendship. It works better.', flags: ['ally_network', 'bargained'], gold: -80, difficulty: -1 },
    ],
  },
  {
    id: 'the_bounty_hunters',
    prompt: 'Three hunters wait at the entrance with a writ and the party’s faces drawn on it. They are polite about it.',
    requires: ['bounty'],
    options: [
      { id: 'pay', label: 'Buy the writ', text: 'The party pays what the writ is worth and a little over, and the hunters tear it up and go. There will be another writ.', flags: ['bargained'], gold: -200 },
      { id: 'refuse', label: 'Refuse, and walk', text: 'The party walks past. The hunters let them. They have the party’s measure now, and the road is long.', flags: ['hunted'], difficulty: 1 },
      { id: 'clear', label: 'Answer the charge', text: 'The party goes with them to the nearest magistrate and speaks. It takes a week. The writ is struck, and the party has sworn some things in the striking.', flags: ['sworn'], reputation: 10 },
    ],
  },
  {
    id: 'the_dreamer',
    prompt: 'The party knows a number now, from the dream, and knows it will come up. Numbers can be used.',
    requires: ['dreamed'],
    options: [
      { id: 'heed', label: 'Heed it', text: 'The party watches for the number and builds its road around it: rests when it shows, fights when it does not. It is exhausting and it works.', flags: ['fated'], xp: 300 },
      { id: 'ignore', label: 'Ignore it', text: 'A number is a number. The party rolls when it must and takes what comes. Something, somewhere, is annoyed.', flags: ['defiant'] },
      { id: 'sell_number', label: 'Sell it', text: 'A gambler in the next town pays handsomely for a sure number. He is, later, found to have been right, and hanged for it.', flags: ['bargained', 'ruthless'], gold: 200 },
    ],
  },
  {
    id: 'the_map',
    prompt: 'The map of the shards from the lair wall, rolled and carried: it marks the next lair, and the one after, in a careful hand.',
    requires: ['seen_map'],
    options: [
      { id: 'burn_map', label: 'Burn it', text: 'A map made by an enemy is an invitation. The party warms its hands on it.', flags: ['defiant'] },
      { id: 'follow', label: 'Follow the marks', text: 'The party goes where the map says before the map’s owner does. Whoever keeps count will find themselves counted.', flags: ['hunter'], difficulty: -1 },
      { id: 'crown', label: 'Sell it to the Crown', text: 'The capital pays well for a map of where fate lies, and better for the party’s silence. The party is, from then on, a friend of the Crown, which is a thing with a cost.', flags: ['crown_favour'], gold: 300, reputation: 10 },
    ],
  },
  {
    id: 'the_wounded_town',
    prompt: 'The town nearest the lair has lost its walls, its mill and its nerve. The reeve asks the party to stay the season and hold it.',
    forbids: ['sworn'],
    options: [
      { id: 'leave_gold', label: 'Leave gold, and go', text: 'The party leaves what it can spare and does not stay to see it spent. The reeve does not thank them, exactly.', flags: ['bargained'], gold: -120, reputation: 10 },
      { id: 'stay', label: 'Stay the season', text: 'The party stays. The walls go up, the mill turns, the shard sits in a locked box for three months and hums. The road is colder when they take it again.', flags: ['sworn'], reputation: 25, difficulty: 1 },
      { id: 'leave', label: 'Leave', text: 'The town will stand or it will not. The party has shards to find. The gate is not closed behind them; nobody is left to close it.', flags: ['ruthless'], reputation: -15 },
    ],
  },
  {
    id: 'the_confession',
    prompt: 'A third letter, and this one asks for a meeting: a neutral place, no weapons, the Fatebinder alone. It could be true.',
    requires: ['tempted'],
    options: [
      { id: 'refuse_meeting', label: 'Burn this one too', text: 'The party is done reading. The wax hisses. The next letter does not come.', flags: ['defiant'] },
      { id: 'go', label: 'Go', text: 'The party goes. The Fatebinder is there, and alone, and kind, and says things about each of them that are true. The party leaves with the shard and without an answer. The lair ahead will know their faces.', flags: ['fatebinder_met'], difficulty: 1 },
      { id: 'trap', label: 'Go, and bring steel', text: 'The party goes armed and the Fatebinder is not there; a courier is, with the party’s letter, unopened. The Fatebinder, the courier says, expected this, and is not offended.', flags: ['ruthless', 'fatebinder_met'] },
    ],
  },
  {
    id: 'the_bearer',
    prompt: 'Someone must carry the shards from here, and they are getting heavier. Who takes the weight?',
    forbids: ['burdened'],
    options: [
      { id: 'one', label: 'One of them, always', text: 'The strongest shoulders the sack and does not set it down. They grow quiet, and quick, and the others watch them.', flags: ['burdened'], xp: 200 },
      { id: 'turns', label: 'Turns', text: 'A day each. Nobody grows strange. Nobody grows strong, either.', flags: ['shared'] },
      { id: 'lead', label: 'A box of lead', text: 'The party buys a lead box in the next town and the shards go in it and the world stops noticing them. The party sleeps.', flags: ['merciful'], gold: -60 },
    ],
  },
];

/** The fixed opening. Every run begins here. */
export const ACT_ONE = {
  title: 'The Shattered Throw',
  antagonist: {
    id: 'ashen_warden',
    monsterType: 'undead' as MonsterType,
    name: 'the Ashen Warden',
    intro:
      'In the tavern, an old woman with dice for eyes tells the party a thing they half knew already: that the world was decided by one throw of one die, and the die shattered on the throw. Its shards fell everywhere. Whoever holds one bends a little of fate. She knows where the first one landed: a crypt a short march from here, where something called the Ashen Warden has been keeping it warm. She would go herself, she says, but she is already dead.',
    fall:
      'The Ashen Warden crumbles to a grey drift, and in the drift is a shard no bigger than a thumb, hot as a coal and quite black. The party has the First Shard. The old woman is gone from the tavern when they return, but she has left the dice.',
    hint: 'The Ashen Warden waits below. The party knows it is not yet strong enough, and takes what work the towns offer.',
    threshold: 'The second stair ends in a vault of urns, and every urn is warm. In the middle of the floor a figure of grey drift is sitting up, slowly, as if it has been waiting for the party to arrive before it bothered.',
    taunt: ['The Ashen Warden speaks in a voice of settling embers. “She sent you. She always sends someone. Come and be kept.”'],
    bloodied: ['The Ashen Warden loses an arm to the drift and does not seem to notice. “Warm,” it says. “It is still warm.”'],
  },
  choice: {
    id: 'first_shard',
    prompt: 'The First Shard is warm in the party’s hands, and the old woman’s dice sit on the table. A wish would be a small thing to ask.',
    options: [
      { id: 'keep', label: 'Ask nothing', text: 'The party pockets the shard and the dice and asks for nothing. The world stays as crooked as it was made.', flags: ['merciful'] },
      { id: 'ask', label: 'Ask where the others are', text: 'The party asks, and the shard shows them: five more, scattered, each held by something. And behind them all, a figure with a cup, gathering. The Fatebinder.', flags: ['seen_fatebinder'] },
      { id: 'sell', label: 'Ask for gold', text: 'The party asks for gold and finds their packs heavy with it. Somewhere, a town’s vault is empty. They do not ask which.', flags: ['ruthless', 'bargained'], gold: 300, reputation: -15 },
    ],
  },
};

/** The last act: the one who has been gathering shards behind every other. */
export const FINALE = {
  title: 'The Fatebinder',
  names: ['the Fatebinder'],
  intro: [
    'Every shard the party has taken has been wanted by someone else, and the party has finally learned who. The Fatebinder has gathered the rest and needs only theirs to throw the die whole. The party knows the place. They also know they will not be asked twice.',
  ],
  /** What waits at the threshold of the last floor, by what the party has become. Most specific first. */
  confrontation: [
    { requires: ['fatebinder_met'], text: 'The last stair opens on a hall the party has seen once before, at a meeting. The Fatebinder stands where it stood then, with the cup, and says the party’s names in the same kind voice, and this time there are weapons.' },
    { requires: ['tempted'], text: 'The last hall is lit like a study. The letters are all here, in a neat stack, with the party’s replies and the replies they never sent. The Fatebinder looks up from writing another. “You read them,” it says. “Good. Then you know I meant it.”' },
    { requires: ['defiant'], text: 'The last hall is bare. The Fatebinder has stopped writing. It stands with the cup and five shards and says nothing at all, which, after all the letters, is the most it has ever said.' },
    { requires: ['knight_lost'], text: 'The last hall holds a chair, and on it is the knight’s helm, set there carefully, and the Fatebinder beside it. “They were first,” it says. “They are always first. You are late, and I have kept the place.”' },
    { requires: [], text: 'The last stair opens on a hall like the inside of a cup. The Fatebinder stands at its centre with five shards in one hand and the sixth’s empty place in the other, and turns, and is not surprised.' },
  ],
  taunt: ['“One more,” says the Fatebinder, and holds out the hand with the empty place in it. “You have carried it a long way. Set it down.”'],
  bloodied: ['The Fatebinder bleeds something that is not blood, and looks at it, and for the first time seems to be in a hurry.'],
  /** Chosen by the party's flags, most specific first. */
  endings: [
    { requires: ['knight_lost'], text: 'The Fatebinder falls, and the party sets the knight’s sword on the cup and breaks both. They carry the shards to the stair the knight held and leave them there, in the dark, where the holding was done. Fate is nobody’s. The party goes up into the light one lighter than it came down, and does not forget the count.' },
    { requires: ['fatebinder_met', 'tempted'], text: 'The Fatebinder falls, and says the party’s names once more, and means them. The party gathers the shards and the cup and does what the letters asked, on their own terms: a throw, one, for a world a little kinder to the small. The world lurches and settles and is, by most accounts, a little kinder. The party is not sure it was right. That is the only sign it was.' },
    { requires: ['crown_favour', 'sworn'], text: 'The Fatebinder falls, and the Crown’s riders are at the entrance when the party climbs out, as the party knew they would be. The shards go to the capital under seal and the party goes to the town it swore to, and keeps the oath, and is a friend of the Crown, which is a thing with a cost, and pays it gladly.' },
    { requires: ['merciful', 'sworn'], text: 'The Fatebinder falls, and the party holds every shard. They could throw the die. They set the shards in the town square they swore to return to, in a ring of lead, and let the world stay crooked. Children play around them. Nothing is decided, ever again, by anyone but the ones living it.' },
    { requires: ['ruthless', 'bargained'], text: 'The Fatebinder falls, and the party holds every shard, and one of them is already reaching for the cup. The others do not stop them. The die is thrown. The world comes up the way the party wanted it, which is not the way anyone else did. They rule it well enough. That is the kindest thing history says.' },
    { requires: ['burdened'], text: 'The Fatebinder falls, and the one who carried the shards sets the sack down for the first time in a year and cannot stand up straight. The others break the shards around them, one by one, and with each the bearer straightens a little. By the last they are only tired. The party goes home slowly, and the bearer sleeps for a week.' },
    { requires: ['ally_network'], text: 'The Fatebinder falls, and the party is not the only one in the lair; the network is there, a dozen thin faces from a dozen villages, and they carry the shards out between them so that nobody carries more than one. It is, the party thinks, the point. Fate spread thin enough is only luck.' },
    { requires: ['hunted'], text: 'The Fatebinder falls, and the hunters are at the entrance, as they always are. The party comes up with the shards and sets them on the ground between the two lines and says: yours, if you want to carry them. Nobody does. The writ is torn up there on the road, and the party walks through.' },
    { requires: ['fated'], text: 'The Fatebinder falls on the number from the dream, exactly, and the party feels the world click into place like a die coming to rest. They have been waiting for that sound for four acts. They break the shards anyway. A number known is a number owned, and the party would rather not be.' },
    { requires: ['tempted'], text: 'The Fatebinder falls, and the party finds the letter still folded in a pack. They read it again. Then they gather the shards, and the cup, and walk out of the lair to finish what the letter proposed, but on their own terms. Whether that is a better world is not for this tale to say.' },
    { requires: ['knight_ally'], text: 'The Fatebinder falls with the mad knight’s sword through it, a year late and exactly on time. The knight takes the shards to the sea and throws them in, one by one, and the party lets them. Fate is nobody’s now. The knight sleeps a full night for the first time in two years.' },
    { requires: ['seen_fatebinder'], text: 'The Fatebinder falls, and the party is not surprised; they saw this in the First Shard long ago. They break the shards under a hammer, each one, and the world lurches once and steadies. Nothing about it is fixed. Everything about it is possible.' },
    { requires: [], text: 'The Fatebinder falls. The party stands with every shard of the die that decided the world and, after a long silence, buries them under the crypt where the first was found. The old woman’s dice are left on top as a marker. Fate stays crooked. The party goes on adventuring, which is the only thing they were ever sure they wanted.' },
  ],
};

/**
 * What the held shards do for the party at each camp: a fated die, one, its
 * number rising with the count. The first shard bends a roll a little; the
 * whole die, gathered, all but decides one.
 */
export const SHARD_BOONS: { value: number; line: string }[] = [
  { value: 11, line: 'The First Shard is warm in the pack tonight. Someone’s next throw will be a shade better than it should.' },
  { value: 13, line: 'Two shards, and they hum against each other in the dark. One roll tomorrow is already half made.' },
  { value: 15, line: 'Three shards. The party has stopped noticing the warmth, which is how the shards like it. A good number waits in the sack.' },
  { value: 17, line: 'Four shards make a sound at night like a held breath. Whoever throws first tomorrow will throw well.' },
  { value: 19, line: 'Five shards. The dice in the party’s packs have started coming up the same. One throw is all but chosen.' },
  { value: 20, line: 'The die is whole, or as whole as anyone will let it be. One throw tomorrow will be exactly what the party needs. The shards would like the party to notice that.' },
];

/** After the tale: acts go on, harder, for a party that wants to see how far it can get. */
export const EPILOGUE_TITLES = [
  'What the Shards Left',
  'A Second Throw',
  'The Long Road After',
  'Echoes in the Cup',
  'Fate’s Loose Ends',
  'The Crooked World',
];

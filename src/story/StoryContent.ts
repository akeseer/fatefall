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
  /** Chosen by the party's flags, most specific first. */
  endings: [
    { requires: ['merciful', 'sworn'], text: 'The Fatebinder falls, and the party holds every shard. They could throw the die. They set the shards in the town square they swore to return to, in a ring of lead, and let the world stay crooked. Children play around them. Nothing is decided, ever again, by anyone but the ones living it.' },
    { requires: ['ruthless', 'bargained'], text: 'The Fatebinder falls, and the party holds every shard, and one of them is already reaching for the cup. The others do not stop them. The die is thrown. The world comes up the way the party wanted it, which is not the way anyone else did. They rule it well enough. That is the kindest thing history says.' },
    { requires: ['tempted'], text: 'The Fatebinder falls, and the party finds the letter still folded in a pack. They read it again. Then they gather the shards, and the cup, and walk out of the lair to finish what the letter proposed, but on their own terms. Whether that is a better world is not for this tale to say.' },
    { requires: ['knight_ally'], text: 'The Fatebinder falls with the mad knight’s sword through it, a year late and exactly on time. The knight takes the shards to the sea and throws them in, one by one, and the party lets them. Fate is nobody’s now. The knight sleeps a full night for the first time in two years.' },
    { requires: ['seen_fatebinder'], text: 'The Fatebinder falls, and the party is not surprised; they saw this in the First Shard long ago. They break the shards under a hammer, each one, and the world lurches once and steadies. Nothing about it is fixed. Everything about it is possible.' },
    { requires: [], text: 'The Fatebinder falls. The party stands with every shard of the die that decided the world and, after a long silence, buries them under the crypt where the first was found. The old woman’s dice are left on top as a marker. Fate stays crooked. The party goes on adventuring, which is the only thing they were ever sure they wanted.' },
  ],
};

/** After the tale: acts go on, harder, for a party that wants to see how far it can get. */
export const EPILOGUE_TITLES = [
  'What the Shards Left',
  'A Second Throw',
  'The Long Road After',
  'Echoes in the Cup',
  'Fate’s Loose Ends',
  'The Crooked World',
];

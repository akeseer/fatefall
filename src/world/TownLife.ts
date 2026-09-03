/**
 * TownLife — the living pulse of towns. Caravans roll between towns along
 * the roads (merchant cart plus guards, parked in the market square when they
 * arrive), festivals begin and end on their own clocks, and each town carries
 * a rumor that reshapes its quest board between visits.
 *
 * All scheduling uses real timestamps, so time passes even while the game is
 * closed — a town can be mid-festival when the party returns days later.
 */

import { Overworld, OverworldTown, OverworldEntrance, getTownById } from './Overworld';
import { Wanderer, WandererKind } from './OverworldLife';
import { TileMap, TileType } from './TileMap';
import { Vector2, manhattan } from '../engine/types';
import { QuestGiver, generateQuestGivers } from '../quests/QuestGivers';
import { TownEvent, rollTownEvent } from './TownTypes';
import { BulletinTask, generateBulletinTasks } from '../quests/BulletinBoard';
import { WorldRegion, regionAt } from './WorldRegions';

export type RumorBias = 'hunt' | 'depth' | 'boss' | 'rich' | 'fey' | 'undead' | 'dragon' | 'none';

/** Mechanical buff granted by buying a round at the tavern. */
export interface TownRumorBuff {
  /** Short name for the buff. */
  name: string;
  /** Description of the mechanical effect. */
  description: string;
  /** Flat bonus to damage dealt. */
  damageBonus: number;
  /** Flat bonus to AC. */
  acBonus: number;
  /** Flat bonus to attack rolls. */
  attackBonus: number;
  /** Bonus gold found after combat. */
  goldFindBonus: number;
  /** Bonus XP per fight. */
  xpBonus: number;
}

export interface Rumor {
  text: string;
  bias: RumorBias;
}

const RUMORS: Rumor[] = [
  { text: 'The road east has gone quiet — too many carts, too few returning.', bias: 'hunt' },
  { text: 'A merchant swore she saw lights moving deep in the hills last night.', bias: 'depth' },
  { text: 'The graveyard keeper says the dead have started digging up.', bias: 'undead' },
  { text: 'A dragon was seen circling the peaks. The guild is posting bounties.', bias: 'dragon' },
  { text: 'There is gold in the ruins — the last crew to go in never came out.', bias: 'rich' },
  { text: 'The fey have been leaving gifts on doorsteps. Everyone is too polite to refuse.', bias: 'fey' },
  { text: 'Something big moved under the town during the last storm.', bias: 'boss' },
  { text: 'The constable is hiring anyone who can swing a blade — the cells are full of werewolves.', bias: 'hunt' },
  { text: 'A map surfaced in the tavern showing a sealed vault beneath the old temple.', bias: 'depth' },
  { text: 'The merchants are squabbling over a new route — whoever clears it names the toll.', bias: 'rich' },
  { text: 'Traders whisper that the old barrow has a new tenant — something with cold breath.', bias: 'undead' },
  { text: 'A prophecy-seller claims the deepest floor of the nearest delve holds a wish.', bias: 'boss' },
  { text: 'Three shepherds lost flocks inside a week. Whatever took them was not a wolf — wolves leave more behind.', bias: 'hunt' },
  { text: 'The night watch has stopped walking the north wall. They say the noise follows them along it.', bias: 'hunt' },
  { text: 'A trapper came in with an empty line and a broken arm, and will not say what sprang his snares.', bias: 'hunt' },
  { text: 'The bounty clerk has run out of blank notices. He is writing the new ones on the backs of the old.', bias: 'hunt' },
  { text: 'A surveyor put a plumb line down the old shaft and ran out of rope. Twice.', bias: 'depth' },
  { text: 'Cold air comes up out of the ground here all summer. The brewers are delighted. Nobody else is.', bias: 'depth' },
  { text: 'There is a second stair down there that nobody remembers cutting, and it goes the wrong way.', bias: 'depth' },
  { text: 'The dogs will not go past the mile-marker any more, and dogs are not the cautious ones around here.', bias: 'boss' },
  { text: 'Something took the watchtower bell. Not the tower. Just the bell.', bias: 'boss' },
  { text: 'A priest went below to bless the lower halls and came back grey. All he will say is: it counted us.', bias: 'boss' },
  { text: 'A gravedigger settled every debt he had in one afternoon and has not been seen sober since.', bias: 'rich' },
  { text: 'The assayer is buying strange ore at three times the going rate and asking no questions at all.', bias: 'rich' },
  { text: 'Somebody in this town is spending coins no mint in the realm has struck for four hundred years.', bias: 'rich' },
  { text: 'The tax collector would like to know where the new money is coming from. So would everyone else.', bias: 'rich' },
  { text: 'Milk left on the step comes back as coin. Nobody will say aloud who takes it.', bias: 'fey' },
  { text: 'A miller\'s boy went missing for a night and came back knowing every song in the valley and none of his letters.', bias: 'fey' },
  { text: 'The stone circle has one more stone than it did last spring. The surveyor is on his third bottle.', bias: 'fey' },
  { text: 'Every gate in the west quarter has been hung with cold iron. Nobody explains it, and nobody jokes about it.', bias: 'fey' },
  { text: 'The gravedigger has doubled his price, and he digs deeper for it.', bias: 'undead' },
  { text: 'The names on the older stones are wearing away from the inside.', bias: 'undead' },
  { text: 'The bell-ringer swears the temple bell rings itself an hour before every funeral now. He has started keeping the hour free.', bias: 'undead' },
  { text: 'Cattle are going missing whole — no blood, no drag marks, just a scorched hollow in the grass.', bias: 'dragon' },
  { text: 'The granary roof is scored with grooves the width of a man\'s arm, and the granary is two storeys up.', bias: 'dragon' },
  { text: 'A tinker sold a scale to the smith as a shield boss. It is still too heavy for the shield.', bias: 'dragon' },
  { text: 'The bridge toll has doubled and the bridge is no better for it.', bias: 'none' },
  { text: 'Two guilds are suing each other over a well. The case will outlast everyone named in it.', bias: 'none' },
  { text: 'A new inn opened on the square, and the old one has started watering its ale out of spite.', bias: 'none' },
  { text: 'The town crier has been paid to stop crying one particular piece of news, which is how everyone heard it.', bias: 'none' },
];

/**
 * Rumors a town only tells about itself. Keyed by town archetype id, so a
 * mining settlement worries about its shafts and a port worries about what
 * comes in on the tide. An archetype with no entry simply falls back to the
 * general pool.
 */
const ARCHETYPE_RUMORS: Record<string, Rumor[]> = {
  port_town: [
    { text: 'A ship came in on the tide with her sails set and nobody aboard. The harbourmaster has impounded her and stopped answering questions.', bias: 'hunt' },
    { text: 'The net-menders keep hauling up worked stone from the bay. Somebody built down there once, and built well.', bias: 'depth' },
    { text: 'A captain is paying double for hands who will sail past the reef after dark. Nobody has taken that coin twice.', bias: 'rich' },
  ],
  mining_settlement: [
    { text: 'The third shaft has been boarded over, and the foreman will not say who gave the order.', bias: 'depth' },
    { text: 'The canaries in the deep gallery have stopped singing. They have not stopped living — they have just stopped.', bias: 'boss' },
    { text: 'Someone struck silver nine days ago and still has not come up to file the claim.', bias: 'rich' },
  ],
  wizard_college: [
    { text: 'A student\'s familiar came back without the student. It is being very careful about what it says.', bias: 'depth' },
    { text: 'The wards on the undercroft have been renewed twice this month. They are meant to hold for a year.', bias: 'boss' },
    { text: 'Someone is selling practice scrolls that work considerably better than practice scrolls should.', bias: 'rich' },
  ],
  frontier_outpost: [
    { text: 'The patrol route has been shortened twice this season. The captain is calling it efficiency.', bias: 'hunt' },
    { text: 'Every trapper on the north line came in early, and not one of them is going back out.', bias: 'hunt' },
    { text: 'The palisade was rebuilt in the spring. Something has already put a hole in it from the outside.', bias: 'boss' },
  ],
  holy_city: [
    { text: 'The vigil in the lower chapel has not been kept by the same priest twice. They all ask to be reassigned.', bias: 'undead' },
    { text: 'Pilgrims are arriving with the same dream and different accents.', bias: 'boss' },
    { text: 'The reliquary inventory came up one item short, and the sacristan is being remarkably calm about it.', bias: 'rich' },
  ],
  trade_hub: [
    { text: 'Three caravans have come in light, and none of the drivers will name the stretch of road where it happened.', bias: 'hunt' },
    { text: 'A factor is buying grave-goods at market rate and shipping the crates out unopened.', bias: 'undead' },
    { text: 'The moneylenders have quietly stopped writing insurance on the eastern route. They are not saying why.', bias: 'rich' },
  ],
  farming_village: [
    { text: 'The dogs bark at the treeline at the same hour every night, and there is never anything in the treeline.', bias: 'fey' },
    { text: 'A field was harvested in the night. Neatly. Nobody has claimed the work or the crop.', bias: 'fey' },
    { text: 'The plough turned up a stair last autumn. The farmer has ploughed around it ever since.', bias: 'depth' },
  ],
  noble_seat: [
    { text: 'The lord\'s huntsman has been paid to lose the boar hunt three seasons running, and nobody will explain the arrangement.', bias: 'hunt' },
    { text: 'A second cousin arrived to press a claim and knew the castle better than the steward does.', bias: 'none' },
    { text: 'The house guard is recruiting quietly, and not one of the new men is from here.', bias: 'hunt' },
  ],
  forest_hold: [
    { text: 'The old paths have moved again. The elders are pretending this is ordinary.', bias: 'fey' },
    { text: 'Someone has been leaving offerings at a tree the hold does not have a name for.', bias: 'fey' },
    { text: 'The deer have come down to the walls and will not go back up the valley.', bias: 'hunt' },
  ],
  desert_oasis: [
    { text: 'A caravan arrived three days early with every crate intact and no memory of the crossing.', bias: 'fey' },
    { text: 'The old cistern has dropped a foot since the moon turned, and it has not rained anywhere.', bias: 'depth' },
    { text: 'A guide is charging triple to go near the ruin field, and getting it.', bias: 'rich' },
  ],
};

/** What the world can tell a rumor about, when the pieces exist. */
export interface RumorContext {
  town?: OverworldTown;
  /** The nearest dungeon entrance to the town, if the map has one. */
  entrance?: OverworldEntrance;
  /** Another town, for talk about the road between them. */
  neighbor?: OverworldTown;
  /** The territory the town sits in. */
  region?: WorldRegion;
}

/** A rumor that only exists when the world supplies its parts. */
interface ContextualRumor {
  bias: RumorBias;
  /** Returns the line, or null when this world has nothing to hang it on. */
  text: (ctx: RumorContext) => string | null;
}

const CONTEXTUAL_RUMORS: ContextualRumor[] = [
  {
    bias: 'depth',
    text: c => c.entrance ? `The guild has ${c.entrance.name} down as ${c.entrance.depth} floors. The last crew to check came back certain it was more.` : null,
  },
  {
    bias: 'boss',
    text: c => c.entrance ? `Whatever keeps house at the bottom of ${c.entrance.name} has started sending things up to fetch its meals.` : null,
  },
  {
    bias: 'hunt',
    text: c => c.entrance ? `The trail to ${c.entrance.name} has been widened by something that does not use trails.` : null,
  },
  {
    bias: 'rich',
    text: c => c.entrance ? `A carter has been hauling crates out of ${c.entrance.name} after dark and paying his tolls in very old coin.` : null,
  },
  {
    bias: 'depth',
    text: c => c.entrance ? `${c.entrance.name} exhales when the weather turns. The tanners have started planning their week around it.` : null,
  },
  {
    bias: 'undead',
    text: c => (c.entrance && c.entrance.depth >= 3) ? `They stopped burying the dead within sight of ${c.entrance.name}. The graves would not stay tidy.` : null,
  },
  {
    bias: 'boss',
    text: c => (c.entrance && c.entrance.depth >= 5) ? `${c.entrance.name} runs ${c.entrance.depth} floors down, and the guild has stopped selling maps of the last two.` : null,
  },
  {
    bias: 'hunt',
    text: c => c.neighbor ? `The road to ${c.neighbor.name} is three days now instead of two. Nobody takes the short way after dark.` : null,
  },
  {
    bias: 'rich',
    text: c => c.neighbor ? `${c.neighbor.name} is paying better than we are for the same work, which is either good news or a warning.` : null,
  },
  {
    bias: 'none',
    text: c => c.neighbor ? `A rider came through from ${c.neighbor.name} without stopping and would not take water.` : null,
  },
  {
    bias: 'undead',
    text: c => c.neighbor ? `${c.neighbor.name} has been shutting its gates at dusk for a month. They will not say what they are shutting them against.` : null,
  },
  {
    bias: 'hunt',
    text: c => c.region ? `Nothing has come out of ${c.region.name} on foot in a fortnight, and the carts that do come through are not stopping here.` : null,
  },
  {
    bias: 'fey',
    text: c => c.region?.biome === 'forest' ? `Half of ${c.region.name} is walking wrong. The rangers have started marking every tree twice.` : null,
  },
  {
    bias: 'depth',
    text: c => c.region?.biome === 'mountain' ? `The passes through ${c.region.name} are open, and the shepherds are still not using them.` : null,
  },
  {
    bias: 'undead',
    text: c => c.region?.biome === 'swamp' ? `The water in ${c.region.name} has gone still, which anyone raised here will tell you is the worse sign.` : null,
  },
  {
    bias: 'rich',
    text: c => c.region?.biome === 'desert' ? `The last storm uncovered a doorway out in ${c.region.name}. The next one will bury it again.` : null,
  },
  {
    bias: 'boss',
    text: c => c.region?.biome === 'snow' ? `Something crossed ${c.region.name} in a straight line, through the drifts, and did not slow down for the river.` : null,
  },
  {
    bias: 'depth',
    text: c => c.region?.biome === 'coast' ? `The tide along ${c.region.name} has been coming in wrong, and the old hands have started writing it down.` : null,
  },
  {
    bias: 'hunt',
    text: c => c.region?.biome === 'grassland' ? `A whole season of mileposts along ${c.region.name} has been pulled up and stacked. Neatly.` : null,
  },
  {
    bias: 'none',
    text: c => (c.town && c.town.population < 2500) ? `There are more names in the graveyard at ${c.town.name} than there are people paying tax in it, and the gap is widening.` : null,
  },
  {
    bias: 'undead',
    text: c => (c.town && c.town.population < 2500) ? `${c.town.name} is small enough that everyone knows who is meant to be dead. Two people have been counted twice this month.` : null,
  },
  {
    bias: 'rich',
    text: c => (c.town && c.town.population > 11000) ? `${c.town.name} has outgrown its walls again. Whatever is outside them has noticed.` : null,
  },
  {
    bias: 'hunt',
    text: c => (c.town && c.town.population > 11000) ? `A town the size of ${c.town.name} loses people every week and calls it drifting. The watch has stopped calling it that.` : null,
  },
];

export interface Festival {
  name: string;
  kind: string;
  until: number;
  startedAt: number;
}

interface FestivalTemplate {
  name: string;
  kind: string;
  /** The line the log gets when this one begins. Each festival opens differently. */
  opening: (town: string) => string;
  /**
   * Town archetypes that hold this festival. Omitted means anywhere — a
   * listed festival only ever fires in the towns that would actually keep it.
   */
  archetypes?: string[];
}

const FESTIVALS: FestivalTemplate[] = [
  {
    name: 'the Festival of Lanterns', kind: 'lights',
    opening: t => `🎪 ${t} hangs its first lanterns at dusk — by full dark the roofs are a second, lower sky.`,
  },
  {
    name: 'the Harvest Fair', kind: 'harvest',
    opening: t => `🎪 The Harvest Fair opens in ${t}: gourds the size of dogs, a prize pig with strong opinions, and a queue for the pie tent that goes round the well.`,
  },
  {
    name: 'the Day of the Moon', kind: 'moon',
    opening: t => `🎪 ${t} keeps the Day of the Moon — every shutter open, every candle silver, and nobody sleeps until the temple says they may.`,
  },
  {
    name: 'the Anvil-Choir', kind: 'music',
    opening: t => `🎪 The Anvil-Choir has started up in ${t}. Hammers on the beat, four-part harmony, and a noise complaint nobody will sign.`,
    archetypes: ['mining_settlement', 'trade_hub', 'frontier_outpost', 'noble_seat'],
  },
  {
    name: 'the Solstice Fete', kind: 'solstice',
    opening: t => `🎪 Bonfires go up on every rise around ${t} for the Solstice Fete, and half the children in town are already too close to them.`,
  },
  {
    name: 'the Feast of the First Keg', kind: 'ale',
    opening: t => `🎪 ${t} broaches the first keg of the season. The brewer makes a speech; nobody hears the end of it.`,
  },
  {
    name: 'the Midsummer Fling', kind: 'dance',
    opening: t => `🎪 Fiddlers have taken the square in ${t} and the Midsummer Fling is under way. Three feuds will end tonight and two will start.`,
  },
  {
    name: 'the Salt Blessing', kind: 'salt',
    opening: t => `🎪 ${t} ropes its whole fleet together into one floating street for the Salt Blessing, and the priests walk it keel to keel.`,
    archetypes: ['port_town'],
  },
  {
    name: 'the Deep Draught', kind: 'deep',
    opening: t => `🎪 ${t} sends a cask down the main shaft at dawn and drinks it standing when it comes back up. Nobody has ever explained why it tastes better.`,
    archetypes: ['mining_settlement'],
  },
  {
    name: 'the Rite of Open Doors', kind: 'doors',
    opening: t => `🎪 Every door in ${t} is propped open for the Rite, and the temple is feeding whoever walks through them — no questions, no collection plate.`,
    archetypes: ['holy_city', 'farming_village'],
  },
  {
    name: 'the Convocation of Sparks', kind: 'sparks',
    opening: t => `🎪 The towers of ${t} are throwing coloured fire off their roofs and scoring each other out of ten. The fire is harmless. The scoring is not.`,
    archetypes: ['wizard_college'],
  },
  {
    name: 'the Muster', kind: 'muster',
    opening: t => `🎪 ${t} holds the Muster: the garrison drills in the square all day, then loses a drinking contest to the townsfolk all night.`,
    archetypes: ['frontier_outpost', 'noble_seat', 'trade_hub'],
  },
  {
    name: 'the Tally', kind: 'tally',
    opening: t => `🎪 ${t} reads out the year's books in the square, debts and all, and then burns them. Attendance is enthusiastic and not entirely voluntary.`,
    archetypes: ['trade_hub', 'port_town', 'desert_oasis'],
  },
  {
    name: 'the Long Table', kind: 'table',
    opening: t => `🎪 One table now runs the length of the main street in ${t}, and nobody is permitted to eat in their own house.`,
    archetypes: ['farming_village', 'forest_hold', 'holy_city'],
  },
  {
    name: 'the Investiture', kind: 'investiture',
    opening: t => `🎪 The houses of ${t} have paraded their colours and gone to the lists to settle a year of grudges in front of witnesses.`,
    archetypes: ['noble_seat'],
  },
  {
    name: 'the Green Vigil', kind: 'green',
    opening: t => `🎪 ${t} has hung its bridges with new growth for the Green Vigil. No axe will be lifted here for three days, on pain of a very cold silence.`,
    archetypes: ['forest_hold'],
  },
  {
    name: 'the Night of Wells', kind: 'wells',
    opening: t => `🎪 ${t} lights the pool from underneath for the Night of Wells, and the whole town stays up to watch the stars come over the rim.`,
    archetypes: ['desert_oasis', 'farming_village'],
  },
  {
    name: 'the Founders\' Wake', kind: 'founders',
    opening: t => `🎪 ${t} is reading the oldest names off the oldest stones, and drinking, at length, to people none of them ever met.`,
  },
  {
    name: 'the Beast Fair', kind: 'beasts',
    opening: t => `🎪 The Beast Fair fills the stockyards of ${t} with prize animals. One of them is already loose.`,
  },
  {
    name: 'the Mourning Quiet', kind: 'quiet',
    opening: t => `🎪 ${t} has muffled its bells and closed its ledgers for the Mourning Quiet. The whole town is speaking a register lower.`,
  },
  {
    name: 'the Kite Days', kind: 'kites',
    opening: t => `🎪 Paper birds are fighting over the rooftops of ${t}. By local custom the losers stay where they fall.`,
  },
];

export const FESTIVAL_FLAVOR: Record<string, string> = {
  lights: 'every roof wears a row of glowing paper lanterns',
  harvest: 'the square is piled with grain, gourds, and prize pumpkins',
  moon: 'silver candles line the streets and the temple stays open all night',
  music: 'dwarven choirs shake the rafters and the inns never close',
  solstice: 'bonfires ring the town and children chase sparks',
  ale: 'the first keg of the season rolls out and no one is sober',
  dance: 'ribbons and fiddles — the whole square turns into a dance floor',
  salt: 'the fleet is roped together into one floating street and every keel gets a blessing',
  deep: 'the first cask of the season goes down the shaft sweet and comes back up sweeter',
  doors: 'every door in town stands propped open and the temple is feeding all comers',
  sparks: 'the towers throw harmless coloured fire off their roofs and score each other out of ten',
  muster: 'the garrison drills all day and loses to civilians all night',
  tally: 'the year\'s books are read aloud in the square, debts and all, and then burned',
  table: 'one table runs the length of the street and nobody eats at home',
  investiture: 'the houses parade their colours and settle a year of grudges in the lists',
  green: 'the bridges are hung with new growth and no axe is lifted for three days',
  wells: 'the pool is lit from beneath and the whole town is up to watch the stars come over',
  founders: 'the oldest names are read off the stones and toasted by people who never met them',
  beasts: 'the stockyards are full of prize animals and at least one of them is loose',
  quiet: 'the bells are muffled, no trade is done, and the town speaks a register lower',
  kites: 'paper birds fight over the rooftops and the losers are left where they fall',
};

/** How each celebration ends, so the log does not sign off the same way twice. */
const FESTIVAL_CLOSING: Record<string, (town: string) => string> = {
  lights: t => `The lanterns come down over ${t} in daylight and look like what they are: paper.`,
  harvest: t => `The last of the fair is carted out of ${t}, and the prize pig goes home undefeated.`,
  moon: t => `The candles gutter out in ${t} and the temple doors shut on a town that badly needs to sleep.`,
  music: t => `The Anvil-Choir in ${t} runs out of voice before it runs out of ale. The square goes quiet by inches.`,
  solstice: t => `The bonfires around ${t} burn down to rings of white ash, and the children are carried home.`,
  ale: t => `The keg in ${t} is empty, the brewer's speech is still unfinished, and trade resumes.`,
  dance: t => `The fiddlers in ${t} pack up mid-tune and the square goes back to being a square.`,
  salt: t => `The fleet at ${t} unropes on the morning tide, blessed and slightly hungover.`,
  deep: t => `${t} sends the empty cask back down the shaft and goes back to work an hour late.`,
  doors: t => `The doors of ${t} close one by one, and the temple counts what is left in the pot.`,
  sparks: t => `The last of the fire fades off the towers of ${t}. Two colleges are disputing the scoring.`,
  muster: t => `The garrison of ${t} stands down, nurses its dignity, and goes back to the wall.`,
  tally: t => `The ashes of the year's books blow across the square in ${t} and the new ledgers are opened.`,
  table: t => `The long table is broken up into ordinary tables again, and ${t} eats indoors.`,
  investiture: t => `The lists at ${t} are cleared, the grudges are settled on paper, and the colours come down.`,
  green: t => `The green comes off the bridges of ${t} and the axes come out of the sheds.`,
  wells: t => `The lights under the pool at ${t} are put out, and the stars go back to being ordinary.`,
  founders: t => `${t} finishes its toasts, straightens the old stones, and gets on with the living.`,
  beasts: t => `The stockyards of ${t} empty out. The loose animal has still not been recovered.`,
  quiet: t => `The bells of ${t} are unmuffled, the shutters go up, and the town finds its voice again.`,
  kites: t => `The last paper birds are swept off the roofs of ${t} and the roofs are dull again.`,
};

export interface TownLife {
  townId: string;
  rumor: string;
  rumorBias: RumorBias;
  /** When the current rumor was set — visits soon after keep it. */
  rumorSince: number;
  nextFestivalAt: number;
  festival: Festival | null;
  nextCaravanAt: number;
  /** Named NPCs who live in this town and hand out quests. */
  questGivers: QuestGiver[];
  /** Active town event, if any. */
  event: TownEvent | null;
  /** When the current event expires. */
  eventUntil: number;
  /** Total gold spent by the party in this town. Drives prosperity discounts. */
  prosperitySpent: number;
  /** Whether the party has registered with the local guild. */
  guildRegistered: boolean;
  /** Per-town reputation (separate from NPC reputation). 0-100. */
  townReputation: number;
  /** Active tavern rumor buff for this town (applies for next N fights). */
  tavernBuff: TownRumorBuff | null;
  /** Number of fights the tavern buff has left. */
  tavernBuffFightsLeft: number;
  /** Bulletin board tasks for this town. */
  bulletinTasks: BulletinTask[];
  /** How many times the party has visited this town (drives task generation). */
  visitCount: number;
}

export interface Caravan {
  id: string;
  fromTownId: string;
  toTownId: string;
  /** Road path (Road/Bridge/Town tiles) from source to destination. */
  route: Vector2[];
  routeIndex: number;
  /** 0 = outbound, 1 = returning home. */
  leg: 0 | 1;
  restUntil: number;
  state: 'traveling' | 'resting';
  wandererIds: string[];
}

export interface TownLifeState {
  byTown: Record<string, TownLife>;
  caravans: Caravan[];
}

export interface TownLifeContext {
  partyTile: Vector2;
  partyTownId: string | null;
  maxCaravans?: number;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Pick the rumor a town will be repeating. With no context this is the
 * free-floating pool; given a town, its nearest delve, a neighbour and a
 * region, roughly half the time the talk is about something the world
 * actually contains.
 */
export function pickRumor(ctx: RumorContext = {}): Rumor {
  const local: Rumor[] = [];
  const archetypeId = ctx.town?.archetypeId;
  if (archetypeId && ARCHETYPE_RUMORS[archetypeId]) local.push(...ARCHETYPE_RUMORS[archetypeId]);
  for (const c of CONTEXTUAL_RUMORS) {
    const text = c.text(ctx);
    if (text) local.push({ text, bias: c.bias });
  }
  if (local.length > 0 && Math.random() < 0.55) {
    return local[Math.floor(Math.random() * local.length)];
  }
  return RUMORS[Math.floor(Math.random() * RUMORS.length)];
}

/** Everything a town can gossip about: its delve, its neighbour, its country. */
function rumorContextFor(overworld: Overworld, town: OverworldTown): RumorContext {
  let entrance: OverworldEntrance | undefined;
  let best = Infinity;
  for (const e of overworld.entrances) {
    const d = manhattan(e.tile, town.tile);
    if (d < best) { best = d; entrance = e; }
  }
  let neighbor: OverworldTown | undefined;
  let nearest = Infinity;
  for (const t of overworld.towns) {
    if (t.id === town.id) continue;
    const d = manhattan(t.tile, town.tile);
    if (d < nearest) { nearest = d; neighbor = t; }
  }
  const region = overworld.regions ? regionAt(overworld.regions, town.tile) : undefined;
  return { town, entrance, neighbor, region };
}

/** Tavern rumor buffs: bought with 10 gp at the tavern, last for N fights. */
const TAVERN_BUFFS: (TownRumorBuff & { narration: string[] })[] = [
  {
    name: 'Boss Weakness Intel',
    description: 'The bartender heard the dungeon boss is vulnerable to your weapons.',
    damageBonus: 3, acBonus: 0, attackBonus: 1, goldFindBonus: 0, xpBonus: 0,
    narration: [
      'The bartender leans in: the boss on the deepest floor hates fire — and steel.',
      'A retired delver draws the thing on the bar in spilled ale and taps the seam under its jaw. "There. Only there."',
      'The barkeep will not repeat it above a mutter: whatever holds the bottom floor bleeds like anything else once you get past the plate.',
    ],
  },
  {
    name: 'Lucky Coins',
    description: 'A lucky charm found in the ale. Bonus gold after fights.',
    damageBonus: 0, acBonus: 0, attackBonus: 0, goldFindBonus: 25, xpBonus: 0,
    narration: [
      'You find a strange coin at the bottom of your drink — it feels warm in your palm.',
      'The change from the round comes back one coin heavy. Nobody at the bar will admit to putting it there.',
      'An old woman presses a holed penny into your hand, says "for the toll," and will not explain which toll.',
    ],
  },
  {
    name: 'Barroom Brawl Training',
    description: 'You sparred with the locals. Sharper reflexes in combat.',
    damageBonus: 0, acBonus: 1, attackBonus: 2, goldFindBonus: 0, xpBonus: 0,
    narration: [
      'A half-orc teaches you a dirty trick — watch their eyes, not their hands.',
      'Two tables go over. By the time the barkeep separates everyone, you have learned three things and paid for one chair.',
      'The bouncer walks you through how she puts people down without breaking anything. It is mostly footwork and patience.',
    ],
  },
  {
    name: 'Campfire Tales',
    description: 'Old adventurers shared hard-won wisdom. Bonus XP from fights.',
    damageBonus: 0, acBonus: 0, attackBonus: 0, goldFindBonus: 0, xpBonus: 15,
    narration: [
      'A scarred veteran tells you how she survived the deep — knowledge is worth its weight in gold.',
      'A one-handed man walks you through every mistake he made on the fourth floor, in order, without self-pity.',
      'The old guard in the corner names four parties that went down and did not come back, and what each of them got wrong.',
    ],
  },
  {
    name: 'Hearty Meal',
    description: 'A massive meal and strong ale. Boosted vigor for the road.',
    damageBonus: 1, acBonus: 0, attackBonus: 1, goldFindBonus: 10, xpBonus: 5,
    narration: [
      'The stew is thick, the bread is fresh, and the ale hits like a hammer. You feel unstoppable.',
      'The cook takes one look at the party and starts bringing food without being asked. Nobody speaks for ten minutes.',
      'Second helpings arrive unrequested. The bill, when it comes, has been quietly rounded down.',
    ],
  },
  {
    name: 'Thieves\' Tips',
    description: 'A shady figure whispers about hidden treasure locations.',
    damageBonus: 0, acBonus: 0, attackBonus: 0, goldFindBonus: 40, xpBonus: 0,
    narration: [
      'A figure in the corner slides you a note: check behind the waterfall on floor 2.',
      'Someone you do not see leaves a chalk mark on your table and a floor plan under the salt.',
      'A woman with very clean hands tells you which flagstone in the lower hall is a lid, then leaves before the round arrives.',
    ],
  },
];

/** Roll a random tavern buff (or null if nothing special). */
export function rollTavernBuff(): TownRumorBuff | null {
  if (Math.random() > 0.70) return null; // 30% chance
  const buff = TAVERN_BUFFS[Math.floor(Math.random() * TAVERN_BUFFS.length)];
  return { name: buff.name, description: buff.description, damageBonus: buff.damageBonus, acBonus: buff.acBonus, attackBonus: buff.attackBonus, goldFindBonus: buff.goldFindBonus, xpBonus: buff.xpBonus };
}

/** Get the narration for a tavern buff. */
export function getTavernBuffNarration(buff: TownRumorBuff): string {
  const found = TAVERN_BUFFS.find(b => b.name === buff.name);
  if (!found || found.narration.length === 0) return 'The barkeep nods knowingly.';
  return found.narration[Math.floor(Math.random() * found.narration.length)];
}

/**
 * Caravan traffic, said four different ways. The party sees a lot of these,
 * so the log should not read like a shipping manifest.
 */
const CARAVAN_DEPARTURE: ((wagons: number, from: string, to: string) => string)[] = [
  (w, f, t) => `🛒 A caravan of ${w} wagons and their guards rolls out of ${f} for ${t}.`,
  (w, f, t) => `🛒 ${w} wagons form up on the ${f} road, argue about the order, and set off for ${t}.`,
  (w, f, t) => `🛒 The ${f} caravan leaves for ${t} — ${w} wagons, a hired blade on each flank, and a driver who keeps checking behind.`,
  (w, f, t) => `🛒 ${w} wagons pull out of ${f} at walking pace, bound for ${t} and already behind schedule.`,
];

const CARAVAN_ARRIVAL: ((to: string, from: string | null) => string)[] = [
  (t, f) => `🛒 A caravan rolls into ${t}${f ? ` from ${f}` : ''} — crates, spices, and fresh rumors for the market.`,
  (t, f) => `🛒 Wagons crowd the square at ${t}${f ? `, road-dust from ${f} an inch thick on them` : ''}. The stalls rearrange themselves around the new stock.`,
  (t, f) => `🛒 A caravan makes ${t} before dark${f ? ` — the ${f} run, and the drivers look pleased about that` : ''}.`,
  (t, f) => `🛒 The market at ${t} doubles in size in an hour${f ? `: the ${f} wagons are in` : ''}, and the prices are already moving.`,
];

const CARAVAN_TURNAROUND: ((at: string, home: string) => string)[] = [
  (a, h) => `🛒 The caravan in ${a} loads up and turns back toward ${h}.`,
  (a, h) => `🛒 Empty crates go on first, then whatever ${a} is selling. The wagons point themselves at ${h} again.`,
  (a, h) => `🛒 The drivers settle up in ${a}, water the oxen, and start the long haul back to ${h}.`,
  (a, h) => `🛒 The ${h} caravan has sold what it came to sell. It leaves ${a} before the tolls change.`,
];

const CARAVAN_HOME: ((home: string) => string)[] = [
  h => `🛒 The caravan that left ${h} rolls back into the yard — goods unloaded, drivers paid.`,
  h => `🛒 The ${h} wagons come home light and intact, which the drivers consider a better outcome than profit.`,
  h => `🛒 The yard at ${h} takes the caravan back in: axles greased, guards dismissed, one crate quietly unaccounted for.`,
  h => `🛒 The caravan finishes its circuit at ${h}. The tally is short a barrel and nobody is raising it.`,
];

function pickLine<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

export function initTownLife(overworld: Overworld, now: number = Date.now()): TownLifeState {
  const byTown: Record<string, TownLife> = {};
  for (const town of overworld.towns) {
    const rumor = pickRumor(rumorContextFor(overworld, town));
    byTown[town.id] = {
      townId: town.id,
      rumor: rumor.text,
      rumorBias: rumor.bias,
      rumorSince: now,
      nextFestivalAt: now + randInt(90, 240) * 1000,
      festival: null,
      nextCaravanAt: now + randInt(15, 70) * 1000,
      questGivers: generateQuestGivers(town.id),
      event: null,
      eventUntil: 0,
      prosperitySpent: 0,
      guildRegistered: false,
      townReputation: 0,
      tavernBuff: null,
      tavernBuffFightsLeft: 0,
      bulletinTasks: [],
      visitCount: 0,
    };
  }
  return { byTown, caravans: [] };
}

/** Check if a town has an active event (not expired). */
export function eventFor(tl: TownLifeState, townId: string, now: number = Date.now()): TownEvent | null {
  const e = tl.byTown[townId]?.event;
  if (e && now <= (tl.byTown[townId]?.eventUntil ?? 0)) return e;
  return null;
}

/**
 * Calculate the dynamic price modifier for a town based on prosperity,
 * caravan presence, and festivals.
 */
export function townPriceModifier(
  tl: TownLifeState,
  townId: string,
  baseModifier: number,
  now: number = Date.now(),
): number {
  const entry = tl.byTown[townId];
  if (!entry) return baseModifier;
  let mod = baseModifier;
  // Prosperity discount: 1% off per 100 gp spent, max 15% off.
  const prosperityDiscount = Math.min(0.15, entry.prosperitySpent / 10000);
  mod *= (1 - prosperityDiscount);
  // Reputation discount: up to 25% off at max reputation.
  const repDiscount = Math.min(0.25, entry.townReputation / 400);
  mod *= (1 - repDiscount);
  // Festival discount: 10% off during festivals.
  if (entry.festival && now <= entry.festival.until) mod *= 0.9;
  // Caravan discount: 5% off when a caravan is in town.
  if (tl.caravans.some(c => c.toTownId === townId && c.state === 'resting' && now <= c.restUntil)) mod *= 0.95;
  return Math.round(mod * 100) / 100;
}

/** Refresh the bulletin board for a town when the party arrives. */
export function refreshBulletinBoard(
  tl: TownLifeState,
  townId: string,
  overworld: Overworld,
  partyLevel: number,
): BulletinTask[] {
  const entry = tl.byTown[townId];
  if (!entry) return [];
  entry.visitCount++;
  // Work the party has already taken on survives the new posting; only the
  // untouched notices are replaced. Regenerating everything used to wipe a
  // half-finished task the moment the party walked back into town.
  const inFlight = entry.bulletinTasks.filter(t => t.accepted && !t.completed);
  const claimable = entry.bulletinTasks.filter(t => t.completed);
  const fresh = generateBulletinTasks(
    overworld.towns.find(t => t.id === townId)!,
    entry.visitCount,
    partyLevel,
    overworld.entrances,
  );
  const taken = new Set([...inFlight, ...claimable].map(t => t.id));
  entry.bulletinTasks = [...inFlight, ...claimable, ...fresh.filter(t => !taken.has(t.id))];
  return entry.bulletinTasks;
}

/** Roll a new event for a town when the party arrives. Returns the event or null. */
export function rollArrivalEvent(tl: TownLifeState, townId: string, now: number = Date.now()): TownEvent | null {
  const entry = tl.byTown[townId];
  if (!entry) return null;
  // Don't stack events — if one is active, keep it.
  if (entry.event && now <= entry.eventUntil) return entry.event;
  const evt = rollTownEvent();
  if (evt) {
    entry.event = evt;
    entry.eventUntil = now + evt.duration;
  } else {
    entry.event = null;
    entry.eventUntil = 0;
  }
  return entry.event;
}

/** A town's current celebration, if any. */
export function festivalFor(tl: TownLifeState, townId: string, now: number = Date.now()): Festival | null {
  const f = tl.byTown[townId]?.festival;
  if (f && now > f.until) return null;
  return f ?? null;
}

/** Advance the world: caravans roll, festivals begin and end, departures leave. */
export function tickTownLife(
  state: TownLifeState,
  overworld: Overworld,
  map: TileMap,
  wanderers: Wanderer[],
  now: number,
  ctx: TownLifeContext,
): string[] {
  const lines: string[] = [];
  const maxCaravans = ctx.maxCaravans ?? 4;

  for (const town of overworld.towns) {
    const tl = state.byTown[town.id];
    if (!tl) continue;
    const partyHere = ctx.partyTownId === town.id;

    // Festivals begin and end on their own clocks.
    if (!tl.festival && now > tl.nextFestivalAt) {
      // A town only holds the festivals it would actually keep; the rest of
      // the calendar is open to anyone.
      const pool = FESTIVALS.filter(f => !f.archetypes || f.archetypes.includes(town.archetypeId));
      const tpl = pool[Math.floor(Math.random() * pool.length)] ?? FESTIVALS[0];
      tl.festival = { name: tpl.name, kind: tpl.kind, until: now + randInt(45, 120) * 1000, startedAt: now };
      if (partyHere) {
        lines.push(tpl.opening(town.name));
      }
    } else if (tl.festival && now > tl.festival.until) {
      const closing = FESTIVAL_CLOSING[tl.festival.kind];
      tl.festival = null;
      tl.nextFestivalAt = now + randInt(150, 360) * 1000;
      if (partyHere) {
        lines.push(closing ? closing(town.name) : `The festival in ${town.name} winds down; the square returns to trade and gossip.`);
      }
    }

    // A caravan departs on schedule (one per town at a time, cap total).
    const tiedToThisTown = state.caravans.some(c => c.fromTownId === town.id || c.toTownId === town.id);
    if (!tiedToThisTown && state.caravans.length < maxCaravans && now > tl.nextCaravanAt) {
      const dest = pickOtherTown(overworld, town);
      if (dest) {
        const caravan = spawnCaravan(town, dest, map, wanderers);
        state.caravans.push(caravan);
        tl.nextCaravanAt = now + randInt(120, 300) * 1000;
        if (partyHere) {
          lines.push(pickLine(CARAVAN_DEPARTURE)(randInt(2, 4), town.name, dest.name));
        }
      }
    }
  }

  // Advance in-flight caravans along the roads.
  const finished: Caravan[] = [];
  for (const c of state.caravans) {
    const dest = getTownById(overworld, c.toTownId);
    const home = getTownById(overworld, c.fromTownId);
    if (!dest) continue;

    if (c.state === 'traveling') {
      c.routeIndex++;
      // The last route tile is the destination town's center.
      if (c.routeIndex >= c.route.length - 1) {
        c.routeIndex = c.route.length - 1;
        if (c.leg === 1) {
          // Back home — the caravan dissolves into the town's bustle.
          removeCaravan(c, wanderers);
          finished.push(c);
          if (home && manhattan(home.tile, ctx.partyTile) <= 16) {
            lines.push(pickLine(CARAVAN_HOME)(home.name));
          }
          continue;
        }
        // Arrived at the destination — park in the market square.
        c.state = 'resting';
        c.restUntil = now + randInt(15, 40) * 1000;
        parkCaravan(c, dest, wanderers);
        if (manhattan(dest.tile, ctx.partyTile) <= 16) {
          lines.push(pickLine(CARAVAN_ARRIVAL)(dest.name, home?.name ?? null));
        }
        continue;
      }
      syncCaravan(c, wanderers);
    } else if (c.state === 'resting') {
      if (now > c.restUntil) {
        // Load up and head back home.
        c.leg = 1;
        c.state = 'traveling';
        c.route.reverse();
        c.routeIndex = 0;
        syncCaravan(c, wanderers);
        if (manhattan(dest.tile, ctx.partyTile) <= 16) {
          lines.push(pickLine(CARAVAN_TURNAROUND)(dest.name, home?.name ?? 'home'));
        }
      }
    }
  }
  if (finished.length > 0) {
    state.caravans = state.caravans.filter(c => !finished.includes(c));
  }
  return lines;
}

function pickOtherTown(overworld: Overworld, town: OverworldTown): OverworldTown | undefined {
  const others = overworld.towns.filter(t => t.id !== town.id);
  if (others.length === 0) return undefined;
  return others[Math.floor(Math.random() * others.length)];
}

/** BFS along roads (Road / Bridge / Town tiles) from one town center to another. */
function roadPath(map: TileMap, from: Vector2, to: Vector2): Vector2[] {
  const w = map.width;
  const h = map.height;
  const startIdx = from.y * w + from.x;
  const endIdx = to.y * w + to.x;
  if (startIdx < 0 || endIdx < 0 || startIdx >= w * h || endIdx >= w * h) return [from, to];
  const prev = new Int32Array(w * h).fill(-1);
  const q: number[] = [startIdx];
  prev[startIdx] = startIdx;
  let head = 0;
  let found = false;
  while (head < q.length) {
    const cur = q[head++];
    if (cur === endIdx) { found = true; break; }
    const cx = cur % w;
    const cy = (cur / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -1) continue;
      const t = map.getTile(nx, ny);
      if (t !== TileType.Road && t !== TileType.Bridge && t !== TileType.Town) continue;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  if (!found) return [from, to];
  const path: Vector2[] = [];
  let cur = endIdx;
  while (cur !== startIdx) {
    path.push({ x: cur % w, y: (cur / w) | 0 });
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

function spawnCaravan(from: OverworldTown, to: OverworldTown, map: TileMap, wanderers: Wanderer[]): Caravan {
  const route = roadPath(map, from.tile, to.tile);
  const id = `caravan_${Math.random().toString(36).slice(2, 8)}`;
  const make = (kind: WandererKind, name: string): Wanderer => ({
    id: `wanderer_${id}_${kind}`,
    kind,
    name,
    tile: { ...route[0] },
    target: { ...route[0] },
    speed: 0, // TownLife moves caravans; stepWanderers leaves them alone.
    message: '',
    shy: 0,
    phase: Math.random() * Math.PI * 2,
    recent: [],
  });
  const merchant = make('merchant', `${from.name} Caravan`);
  const g1 = make('guard', 'Caravan Guard');
  const g2 = make('guard', 'Caravan Guard');
  wanderers.push(merchant, g1, g2);
  return {
    id,
    fromTownId: from.id,
    toTownId: to.id,
    route,
    routeIndex: 0,
    leg: 0,
    restUntil: 0,
    state: 'traveling',
    wandererIds: [merchant.id, g1.id, g2.id],
  };
}

function syncCaravan(c: Caravan, wanderers: Wanderer[]): void {
  const [m, g1, g2] = c.wandererIds.map(id => wanderers.find(w => w.id === id));
  const idx = c.routeIndex;
  if (m) m.tile = { ...c.route[idx] };
  if (g1) g1.tile = { ...c.route[Math.max(0, idx - 1)] };
  if (g2) g2.tile = { ...c.route[Math.max(0, idx - 2)] };
}

function parkCaravan(c: Caravan, dest: OverworldTown, wanderers: Wanderer[]): void {
  const [m, g1, g2] = c.wandererIds.map(id => wanderers.find(w => w.id === id));
  if (m) m.tile = { ...dest.tile };
  if (g1) g1.tile = { x: dest.tile.x + 1, y: dest.tile.y };
  if (g2) g2.tile = { x: dest.tile.x - 1, y: dest.tile.y };
}

function removeCaravan(c: Caravan, wanderers: Wanderer[]): void {
  const ids = new Set(c.wandererIds);
  for (let i = wanderers.length - 1; i >= 0; i--) {
    if (ids.has(wanderers[i].id)) wanderers.splice(i, 1);
  }
}

/** Drop in-flight caravans (their wanderers too) but keep town clocks/rumors. */
export function sanitizeTownLife(state: TownLifeState | undefined, overworld: Overworld): TownLifeState {
  if (!state || !state.byTown) return initTownLife(overworld);
  const byTown: Record<string, TownLife> = {};
  for (const town of overworld.towns) {
    const prev = state.byTown[town.id];
    if (prev) {
      // Preserve quest-giver reputation across saves; regenerate if missing.
      byTown[town.id] = { ...prev, questGivers: prev.questGivers ?? generateQuestGivers(town.id), event: prev.event ?? null, eventUntil: prev.eventUntil ?? 0, prosperitySpent: prev.prosperitySpent ?? 0, guildRegistered: prev.guildRegistered ?? false, townReputation: prev.townReputation ?? 0, tavernBuff: prev.tavernBuff ?? null, tavernBuffFightsLeft: prev.tavernBuffFightsLeft ?? 0, bulletinTasks: prev.bulletinTasks ?? [], visitCount: prev.visitCount ?? 0 };
    } else {
      byTown[town.id] = initTownLife(overworld).byTown[town.id];
    }
  }
  return { byTown, caravans: [] };
}

/** True if the wanderer belongs to a caravan (used to scrub on restore). */
export function isCaravanWanderer(w: Wanderer): boolean {
  return w.id.startsWith('wanderer_caravan_');
}

/**
 * Achievements: forty of them, each a card and a title when earned.
 *
 * Pure. `Game` keeps a tally of the things it does (`counters`), and every
 * few seconds hands a snapshot here; whatever is newly true is earned. The
 * ids are stable and ride in the save, so nothing is earned twice.
 */

export interface AchievementSnapshot {
  kills: number;
  victories: number;
  defeats: number;
  deepest: number;
  rooms: number;
  gold: number;
  rolls: number;
  crits: number;
  fumbles: number;
  bestCritStreak: number;
  maxLevel: number;
  members: number;
  actsDone: number;
  storyComplete: boolean;
  hardcore: boolean;
  day: number;
  /** Named tallies the game keeps: riddles, parleys, hazards, camps, and so on. */
  counters: Record<string, number>;
}

export interface Achievement {
  id: string;
  title: string;
  /** The title the party may use after, e.g. "the Unbroken". */
  epithet: string;
  text: string;
  test: (s: AchievementSnapshot) => boolean;
}

const c = (s: AchievementSnapshot, key: string) => s.counters[key] ?? 0;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_blood', title: 'First Blood', epithet: 'the Blooded', text: 'The first thing that died at your hands.', test: s => s.kills >= 1 },
  { id: 'a_hundred_dead', title: 'A Hundred Dead', epithet: 'Hundredslayer', text: 'A hundred foes slain.', test: s => s.kills >= 100 },
  { id: 'five_hundred_dead', title: 'The Field of Five Hundred', epithet: 'the Reaper', text: 'Five hundred foes slain.', test: s => s.kills >= 500 },
  { id: 'ten_fights', title: 'Ten Fights', epithet: 'the Tried', text: 'Ten fights won.', test: s => s.victories >= 10 },
  { id: 'fifty_fights', title: 'Fifty Fights', epithet: 'the Veteran', text: 'Fifty fights won.', test: s => s.victories >= 50 },
  { id: 'unbroken', title: 'Unbroken', epithet: 'the Unbroken', text: 'Twenty fights won without a defeat.', test: s => s.victories >= 20 && s.defeats === 0 },
  { id: 'flawless', title: 'Not a Scratch', epithet: 'the Untouched', text: 'A fight won in which no one was hurt.', test: s => c(s, 'flawless') >= 1 },
  { id: 'flawless_ten', title: 'Ten Without a Scratch', epithet: 'the Unmarked', text: 'Ten fights won without a wound.', test: s => c(s, 'flawless') >= 10 },
  { id: 'floor_three', title: 'Three Floors Down', epithet: 'the Delver', text: 'The third floor of any delve.', test: s => s.deepest >= 3 },
  { id: 'floor_six', title: 'The Sixth Floor', epithet: 'the Deep-Walker', text: 'The sixth floor of any delve.', test: s => s.deepest >= 6 },
  { id: 'floor_ten', title: 'Below the Tenth', epithet: 'of the Deep', text: 'The tenth floor, where the light gives up.', test: s => s.deepest >= 10 },
  { id: 'rooms_hundred', title: 'A Hundred Rooms', epithet: 'the Thorough', text: 'A hundred rooms seen.', test: s => s.rooms >= 100 },
  { id: 'natural_twenty', title: 'The Twenty', epithet: 'the Favoured', text: 'The first natural twenty.', test: s => s.crits >= 1 },
  { id: 'twenty_twenties', title: 'Twenty Twenties', epithet: 'the Fated', text: 'Twenty natural twenties.', test: s => s.crits >= 20 },
  { id: 'crit_streak', title: 'Three in a Row', epithet: 'the Streaked', text: 'Three natural twenties without a miss between.', test: s => s.bestCritStreak >= 3 },
  { id: 'fumbles', title: 'The Dice Hate You', epithet: 'the Cursed', text: 'Twenty natural ones.', test: s => s.fumbles >= 20 },
  { id: 'thousand_rolls', title: 'A Thousand Rolls', epithet: 'the Well-Rolled', text: 'A thousand dice rolled.', test: s => s.rolls >= 1000 },
  { id: 'level_five', title: 'Fifth Level', epithet: 'the Seasoned', text: 'A member reaches level five.', test: s => s.maxLevel >= 5 },
  { id: 'level_ten', title: 'Tenth Level', epithet: 'the Renowned', text: 'A member reaches level ten.', test: s => s.maxLevel >= 10 },
  { id: 'level_twenty', title: 'Twentieth Level', epithet: 'the Legend', text: 'A member reaches level twenty.', test: s => s.maxLevel >= 20 },
  { id: 'rich', title: 'A Thousand Gold', epithet: 'the Moneyed', text: 'A thousand gold in hand at once.', test: s => s.gold >= 1000 },
  { id: 'richer', title: 'Five Thousand Gold', epithet: 'the Rich', text: 'Five thousand gold in hand at once.', test: s => s.gold >= 5000 },
  { id: 'boss_one', title: 'The Hall Is Yours', epithet: 'Hall-Taker', text: 'A floor\'s boss slain.', test: s => c(s, 'bosses') >= 1 },
  { id: 'boss_ten', title: 'Ten Halls', epithet: 'the Throne-Breaker', text: 'Ten bosses slain.', test: s => c(s, 'bosses') >= 10 },
  { id: 'act_one', title: 'The First Act', epithet: 'of the First Act', text: 'The story\'s first act ended.', test: s => s.actsDone >= 1 },
  { id: 'act_three', title: 'The Third Act', epithet: 'of the Third Act', text: 'Three acts of the story ended.', test: s => s.actsDone >= 3 },
  { id: 'story_done', title: 'The Die Made Whole', epithet: 'the Fated', text: 'The tale of the shattered die, told to its end.', test: s => s.storyComplete },
  { id: 'riddle', title: 'The Right Word', epithet: 'the Riddler', text: 'A riddle door answered.', test: s => c(s, 'riddles') >= 1 },
  { id: 'riddles_five', title: 'Five Doors', epithet: 'the Sphinx\'s Match', text: 'Five riddle doors answered.', test: s => c(s, 'riddles') >= 5 },
  { id: 'parley', title: 'Words Before Steel', epithet: 'the Diplomat', text: 'A band talked past without a fight.', test: s => c(s, 'parleys') >= 1 },
  { id: 'parleys_five', title: 'The Silver Tongue', epithet: 'Silver-Tongue', text: 'Five bands talked past.', test: s => c(s, 'parleys') >= 5 },
  { id: 'tolls_refused', title: 'We Pay No Tolls', epithet: 'the Unbowed', text: 'Three tolls refused.', test: s => c(s, 'tolls_refused') >= 3 },
  { id: 'hazards', title: 'Through the Spores', epithet: 'the Weathered', text: 'Five hazard rooms crossed.', test: s => c(s, 'hazards') >= 5 },
  { id: 'camps', title: 'Ten Fires', epithet: 'the Well-Rested', text: 'Ten camps made at the stairwell.', test: s => c(s, 'camps') >= 10 },
  { id: 'prisoner', title: 'Brought Home', epithet: 'the Rescuer', text: 'A prisoner escorted to a town.', test: s => c(s, 'escortees') >= 1 },
  { id: 'road_done', title: 'A Road Walked', epithet: 'the Fulfilled', text: 'A member\'s own road walked to its end.', test: s => c(s, 'roads_done') >= 1 },
  { id: 'roads_all', title: 'Every Road', epithet: 'the Whole', text: 'Four members\' roads walked to their ends.', test: s => c(s, 'roads_done') >= 4 },
  { id: 'dice_game', title: 'Beat the House', epithet: 'the Lucky', text: 'The tavern dice game won.', test: s => c(s, 'dice_won') >= 1 },
  { id: 'hardcore_ten', title: 'No Second Chances', epithet: 'the Hardcore', text: 'Ten fights won in hardcore.', test: s => s.hardcore && s.victories >= 10 },
  { id: 'thirty_days', title: 'A Month on the Road', epithet: 'the Long-Travelled', text: 'Thirty days since the party set out.', test: s => s.day >= 30 },
];

/** Which achievements the snapshot earns that were not earned before. */
export function newlyEarned(s: AchievementSnapshot, earned: ReadonlySet<string>): Achievement[] {
  return ACHIEVEMENTS.filter(a => !earned.has(a.id) && a.test(s));
}

export function achievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find(a => a.id === id);
}

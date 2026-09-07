/**
 * The story planner: the main quest, as a machine.
 *
 * A run's story is a sequence of acts. The first is fixed: the Ashen Warden
 * and the First Shard, the same every time, so every party learns the same
 * frame. Every act after it is assembled here from the tables in
 * `StoryContent.ts`: an antagonist, a motive, a lair chosen from the world's
 * real dungeon entrances, a twist when the boss falls, and a choice whose
 * flags feed back into what the next act can be. Six acts hold the die's six
 * shards and the sixth is the Fatebinder; after that the acts go on, harder,
 * for as long as the party lasts.
 *
 * ── Determinism ──
 *
 * Every draw is seeded from the run's seed, the act's number and the flags
 * the party has earned, so a saved story plans the same act on reload as it
 * did the first time, and two runs with different seeds or different
 * choices get different acts. The planner never calls Math.random.
 *
 * ── Why the main quest is a Quest ──
 *
 * Each act is issued to the party as an ordinary slay-the-boss quest with a
 * story id. Everything that already works for quests, the destination on the
 * map, the descent to the target floor, the quest bar, the turn-in, works
 * for the story without a second system. The story only decides when the
 * party is ready to take the posting, which boss waits on the target floor,
 * and what happens when the quest is turned in.
 *
 * ── The pull and the patience ──
 *
 * The party wants to get as far as it can. Each act names a recommended
 * level; below it the party knows it would be broken, says so, and takes
 * side work to grow. At it, the story posting is the first one they take.
 * That is the whole of the AI's ambition, and it is enough.
 */

import type { MonsterTemplate } from '../entities/Monster';
import type { Quest } from '../quests/Quests';
import { hashSeed, mulberry32 } from '../world/DungeonGenerator';
import {
  ACT_ONE, ANTAGONISTS, CHOICES, EPILOGUE_TITLES, FINALE, MOTIVES, SHARD_BOONS, SHARD_NAMES, TWISTS,
  type Antagonist, type Choice, type ChoiceOption, type MonsterType,
} from './StoryContent';

// ── Tunables ──

/** Acts that hold a shard, counting the opening; the sixth is the finale. */
export const SHARD_ACTS = SHARD_NAMES.length;

/** The level the party should be at for act n: 1, 3, 5, 7, 9, 11, then two more per epilogue act. */
export function recommendedLevelFor(actIndex: number): number {
  return 1 + 2 * (actIndex - 1);
}

/** How deep the act's boss sits: two floors down for the opening, one more per act, capped by the lair. */
function desiredFloor(actIndex: number): number {
  return 1 + actIndex;
}

/** A story quest pays better than board work, since it is the reason for the run. */
const QUEST_GOLD_PER_ACT = 120;
const QUEST_XP_PER_ACT = 180;

/** How much a floor-appropriate boss is toughened when it is the act's antagonist. */
export const STORY_BOSS_HP_SCALE = 1.35;

export type StoryStage = 'seek' | 'choice' | 'finished';

export interface ActRecord {
  /** 1-based. */
  index: number;
  kind: 'opening' | 'shard' | 'finale' | 'epilogue';
  title: string;
  antagonistId: string;
  monsterType: MonsterType;
  bossName: string;
  bossTemplateId: string;
  motiveId: string | null;
  twistId: string | null;
  choiceId: string | null;
  entranceId: string;
  entranceName: string;
  targetFloor: number;
  recommendedLevel: number;
  giverTownId: string;
  shard: string;
  intro: string;
  rumor: string;
  fall: string;
  questId: string;
}

export interface StoryState {
  seed: number;
  /** The act in progress, or null before the first is planned. */
  act: ActRecord | null;
  /** Acts finished, which is also how many shards the party holds before the finale. */
  actsDone: number;
  flags: string[];
  /** 'seek' while the act's quest is out; 'choice' once turned in and waiting on the party; 'finished' after the ending. */
  stage: StoryStage;
  /** Whether the finale has been played. Acts after it are epilogue. */
  complete: boolean;
  journal: string[];
  /** Level shift earned from choices, applied to the next act's recommendation. */
  difficultyShift: number;
  /** Act index the not-ready hint was last given for, so it is said once per act. */
  hintedAct: number;
  /** Act index whose threshold card has been shown, so the arrival is told once. Absent in older saves. */
  thresholdAct?: number;
}

/** What the planner needs to know about the world. */
export interface StoryWorld {
  entrances: { id: string; name: string; tile: { x: number; y: number }; depth: number }[];
  towns: { id: string; name: string; tile: { x: number; y: number } }[];
  spawnTownId: string;
  templates: MonsterTemplate[];
  /** Templates the party could never see, which the boss must not be. */
  unseeable?: (templateId: string) => boolean;
}

export function beginStory(seed: number): StoryState {
  return { seed, act: null, actsDone: 0, flags: [], stage: 'seek', complete: false, journal: [], difficultyShift: 0, hintedAct: 0 };
}

// ── Helpers ──

function rngFor(state: StoryState, actIndex: number, salt = ''): () => number {
  return mulberry32(hashSeed(`${state.seed}:${actIndex}:${state.flags.slice().sort().join(',')}:${salt}`));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

function has(state: StoryState, flag: string): boolean {
  return state.flags.includes(flag);
}

function allowed(state: StoryState, requires?: string[], forbids?: string[]): boolean {
  if (requires && !requires.every(f => has(state, f))) return false;
  if (forbids && forbids.some(f => has(state, f))) return false;
  return true;
}

export function roman(n: number): string {
  const table: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}

/** The lair for an act: a real entrance deep enough, not the last act's, chosen by the seed. */
function chooseEntrance(state: StoryState, actIndex: number, world: StoryWorld, rng: () => number, avoidId: string | null): StoryWorld['entrances'][number] {
  const want = desiredFloor(actIndex);
  const spawn = world.towns.find(t => t.id === world.spawnTownId) ?? world.towns[0];
  if (actIndex === 1) {
    // The opening is a short march from the first town: the nearest lair that goes two floors down.
    const deepEnough = world.entrances.filter(e => e.depth >= 2);
    const pool = deepEnough.length > 0 ? deepEnough : world.entrances;
    return pool.slice().sort((a, b) => manhattan(a.tile, spawn.tile) - manhattan(b.tile, spawn.tile))[0];
  }
  let pool = world.entrances.filter(e => e.id !== avoidId && e.depth >= want);
  if (pool.length === 0) pool = world.entrances.filter(e => e.id !== avoidId);
  if (pool.length === 0) pool = world.entrances;
  // Later acts lean farther from the first town, so the tale travels.
  const sorted = pool.slice().sort((a, b) => manhattan(a.tile, spawn.tile) - manhattan(b.tile, spawn.tile));
  const from = Math.min(sorted.length - 1, Math.floor((actIndex - 2) / Math.max(1, SHARD_ACTS - 2) * (sorted.length - 1)));
  const slice = sorted.slice(from);
  return pick(rng, slice.length > 0 ? slice : sorted);
}

function nearestTown(world: StoryWorld, tile: { x: number; y: number }): StoryWorld['towns'][number] {
  return world.towns.slice().sort((a, b) => manhattan(a.tile, tile) - manhattan(b.tile, tile))[0];
}

/** The boss template for an act: the antagonist's kind, at about the floor's CR. */
function chooseBossTemplate(world: StoryWorld, type: MonsterType, floor: number, rng: () => number): MonsterTemplate {
  const seen = (m: MonsterTemplate) => !(world.unseeable && world.unseeable(m.id));
  const cr = Math.min(5, Math.max(1, floor));
  const widths = [1, 2, 3, 6];
  for (const w of widths) {
    const pool = world.templates.filter(m => m.type === type && seen(m) && m.cr >= cr - 0.5 && m.cr <= cr + w);
    if (pool.length > 0) return pick(rng, pool);
  }
  const any = world.templates.filter(m => seen(m) && m.cr >= cr - 0.5 && m.cr <= cr + 3);
  return pick(rng, any.length > 0 ? any : world.templates);
}

function weightedMotive(state: StoryState, rng: () => number): typeof MOTIVES[number] {
  const weighted: typeof MOTIVES[number][] = [];
  for (const m of MOTIVES) {
    const w = m.favouredBy && m.favouredBy.some(f => has(state, f)) ? 3 : 1;
    for (let i = 0; i < w; i++) weighted.push(m);
  }
  return pick(rng, weighted);
}

// ── Planning ──

/** Plan the next act from where the story stands. Pure; the caller stores it. */
export function planNextAct(state: StoryState, world: StoryWorld): ActRecord {
  const index = state.actsDone + 1;
  const rng = rngFor(state, index);
  const avoid = state.act?.entranceId ?? null;
  const entrance = chooseEntrance(state, index, world, rng, avoid);
  const targetFloor = Math.max(1, Math.min(entrance.depth, desiredFloor(index)));
  const giver = nearestTown(world, entrance.tile);
  const recommendedLevel = Math.max(1, recommendedLevelFor(index) + state.difficultyShift);
  const shard = SHARD_NAMES[Math.min(index, SHARD_NAMES.length) - 1];
  const vars = { place: entrance.name, shard };

  if (index === 1) {
    const boss = chooseBossTemplate(world, ACT_ONE.antagonist.monsterType, targetFloor, rng);
    return {
      index, kind: 'opening', title: ACT_ONE.title,
      antagonistId: ACT_ONE.antagonist.id, monsterType: ACT_ONE.antagonist.monsterType,
      bossName: 'the Ashen Warden', bossTemplateId: boss.id,
      motiveId: null, twistId: null, choiceId: ACT_ONE.choice.id,
      entranceId: entrance.id, entranceName: entrance.name, targetFloor, recommendedLevel,
      giverTownId: giver.id, shard,
      intro: ACT_ONE.antagonist.intro.replace('a crypt a short march from here', `${entrance.name}, a short march from here`),
      rumor: `the dead do not rest under ${entrance.name}; something there keeps them`,
      fall: ACT_ONE.antagonist.fall,
      questId: 'story_1',
    };
  }

  if (index === SHARD_ACTS && !state.complete) {
    // The Fatebinder wears the face the party's road earned it: a devil for the ruthless, an angel for the merciful, something stranger otherwise.
    const boss = chooseBossTemplate(world, has(state, 'ruthless') ? 'fiend' : has(state, 'merciful') ? 'celestial' : 'aberration', targetFloor, rng);
    return {
      index, kind: 'finale', title: FINALE.title,
      antagonistId: 'fatebinder', monsterType: boss.type,
      bossName: 'the Fatebinder', bossTemplateId: boss.id,
      motiveId: null, twistId: null, choiceId: null,
      entranceId: entrance.id, entranceName: entrance.name, targetFloor, recommendedLevel,
      giverTownId: giver.id, shard,
      intro: fill(pick(rng, FINALE.intro), vars),
      rumor: `a figure with a cup of bones has been seen going into ${entrance.name}, and the sky over it has stopped changing`,
      fall: 'The Fatebinder falls, and the cup rolls from its hand across the stone, and every shard the party has carried grows warm at once.',
      questId: `story_${index}`,
    };
  }

  // A shard act, or an epilogue act after the tale is told.
  const usedAntagonists = new Set(state.journal.map(j => j.split('|')[0]));
  const fresh = ANTAGONISTS.filter(a => !usedAntagonists.has(a.id));
  const antagonist: Antagonist = pick(rng, fresh.length > 0 ? fresh : ANTAGONISTS);
  const boss = chooseBossTemplate(world, antagonist.monsterType, targetFloor, rng);
  const shortName = pick(rng, antagonist.names);
  const bossName = `${shortName} ${pick(rng, antagonist.epithets)}`;
  const motive = weightedMotive(state, rng);
  const twists = TWISTS.filter(t => allowed(state, t.requires, t.forbids));
  const twist = pick(rng, twists.length > 0 ? twists : TWISTS);
  const choices = CHOICES.filter(c => allowed(state, c.requires, c.forbids));
  const choice = pick(rng, choices.length > 0 ? choices : CHOICES);
  const named = { ...vars, name: bossName };
  const epilogue = state.complete;
  return {
    index, kind: epilogue ? 'epilogue' : 'shard',
    title: epilogue ? pick(rng, EPILOGUE_TITLES) : `${shortName} and ${shard}`,
    antagonistId: antagonist.id, monsterType: antagonist.monsterType,
    bossName, bossTemplateId: boss.id,
    motiveId: motive.id, twistId: twist.id, choiceId: choice.id,
    entranceId: entrance.id, entranceName: entrance.name, targetFloor, recommendedLevel,
    giverTownId: giver.id, shard,
    intro: `${fill(pick(rng, antagonist.intro), named)} ${motive.line}`,
    rumor: fill(pick(rng, antagonist.rumor), named),
    fall: `${fill(pick(rng, antagonist.fall), named)} ${twist.text}`,
    questId: `story_${index}`,
  };
}

/** The act as a posting the party can take. */
export function questForAct(act: ActRecord): Quest {
  const label = act.kind === 'epilogue' ? act.title : `Act ${roman(act.index)}: ${act.title}`;
  return {
    id: act.questId,
    kind: 'slay_boss',
    title: label,
    detail: `Descend to floor ${act.targetFloor} of ${act.entranceName} and end ${act.bossName}. Recommended level ${act.recommendedLevel}.`,
    giverTownId: act.giverTownId,
    entranceId: act.entranceId,
    targetFloor: act.targetFloor,
    targetCount: 1,
    rewardGold: QUEST_GOLD_PER_ACT * act.index,
    rewardXp: QUEST_XP_PER_ACT * act.index,
    accepted: false,
    completed: false,
    turnedIn: false,
  };
}

export function isStoryQuest(q: { id: string }): boolean {
  return q.id.startsWith('story_');
}

/** Whether the party should take the act on yet, and how far short it is. */
export function readiness(act: ActRecord, partyLevel: number): { ready: boolean; needed: number; short: number } {
  const short = Math.max(0, act.recommendedLevel - partyLevel);
  return { ready: short === 0, needed: act.recommendedLevel, short };
}

/** The line the party says when it is not ready, once per act. */
export function notReadyLine(act: ActRecord, partyLevel: number): string {
  const r = readiness(act, partyLevel);
  const who = act.kind === 'opening' ? 'the Ashen Warden' : act.bossName;
  return `The party talks it over. ${who} waits on floor ${act.targetFloor} of ${act.entranceName}, and at level ${partyLevel} they would be broken there; level ${r.needed} is the least of it. They take what work the towns offer and grow.`;
}

/** The line when they are. */
export function readyLine(act: ActRecord): string {
  return act.kind === 'opening'
    ? `The party sets its jaw. The Ashen Warden has kept the First Shard long enough.`
    : `The party sets its jaw. ${act.bossName} has held ${act.shard} long enough; the road to ${act.entranceName} is the only one worth walking now.`;
}

/** The boss waiting on an act's target floor, or null where the act has no say. */
export function bossOverride(state: StoryState, entranceId: string | null, floor: number, templates: MonsterTemplate[]): { template: MonsterTemplate; name: string } | null {
  const act = state.act;
  if (!act || state.stage !== 'seek' || !entranceId) return null;
  if (act.entranceId !== entranceId || act.targetFloor !== floor) return null;
  const base = templates.find(t => t.id === act.bossTemplateId);
  if (!base) return null;
  return { template: { ...base, name: act.bossName }, name: act.bossName };
}

/** The choice the act ends on, or null for the finale and the epilogue. */
export function choiceForAct(act: ActRecord): Choice | null {
  if (act.kind === 'opening') return ACT_ONE.choice;
  if (act.kind === 'finale' || act.kind === 'epilogue') return null;
  return CHOICES.find(c => c.id === act.choiceId) ?? null;
}

/**
 * What a party would choose if nobody is watching, from its temperament:
 * an aggressive, greedy party takes the ruthless road; a loyal, cautious one
 * the merciful; anyone else, the first option, which is always the plain one.
 */
export function autoPick(options: ChoiceOption[], temperament: { aggression: number; greed: number; loyalty: number }): ChoiceOption {
  const grim = temperament.aggression + temperament.greed;
  const kind = temperament.loyalty * 2;
  if (grim > kind + 2) return options.find(o => o.flags.includes('ruthless') || o.flags.includes('bargained')) ?? options[0];
  if (kind > grim + 2) return options.find(o => o.flags.includes('merciful')) ?? options[0];
  return options[0];
}

/** Record a choice and move the story on. Returns the effects for the game to apply. */
export function applyChoice(state: StoryState, option: ChoiceOption | null): { gold: number; xp: number; reputation: number } {
  if (option) {
    for (const f of option.flags) if (!state.flags.includes(f)) state.flags.push(f);
    state.difficultyShift += option.difficulty ?? 0;
  }
  return { gold: option?.gold ?? 0, xp: option?.xp ?? 0, reputation: option?.reputation ?? 0 };
}

/** Close the act: it is done, the journal remembers it, and the finale marks the tale complete. */
export function completeAct(state: StoryState): void {
  const act = state.act;
  if (!act) return;
  state.actsDone = act.index;
  state.journal.push(`${act.antagonistId}|Act ${roman(act.index)}: ${act.title} — ${act.bossName} fell on floor ${act.targetFloor} of ${act.entranceName}.`);
  if (act.kind === 'finale') state.complete = true;
  // The twist's knight is the flag the prisoner choice needs.
  if (act.twistId === 'old_friend' && !state.flags.includes('knight_found')) state.flags.push('knight_found');
  if (act.twistId === 'false_shard' && !state.flags.includes('seen_forgery')) state.flags.push('seen_forgery');
  // Other twists leave a mark the later choices can ask about.
  const marks: Record<string, string> = { survivor: 'survivor_spared', dream: 'dreamed', map: 'seen_map', bounty: 'bounty', the_knight_falls: 'knight_lost' };
  const mark = act.twistId ? marks[act.twistId] : undefined;
  if (mark && !state.flags.includes(mark)) state.flags.push(mark);
  state.stage = 'seek';
}

// ── The act, told as it is played ──

function antagonistOf(act: ActRecord): Antagonist | undefined {
  return ANTAGONISTS.find(a => a.id === act.antagonistId);
}

/** The words that fit an act's lines: its boss, its shard, its lair. */
function actVars(act: ActRecord): Record<string, string> {
  return { name: act.bossName, shard: act.shard, place: act.entranceName };
}

/**
 * What the party sees when it reaches the boss's floor. The opening and the
 * finale have their own; a shard act draws from its antagonist; the finale's
 * confrontation is chosen by the party's flags, most specific first.
 */
export function thresholdLine(state: StoryState, act: ActRecord): string {
  const rng = rngFor(state, act.index, 'threshold');
  if (act.kind === 'opening') return ACT_ONE.antagonist.threshold;
  if (act.kind === 'finale') {
    for (const c of FINALE.confrontation) if (c.requires.every(f => has(state, f))) return c.text;
    return FINALE.confrontation[FINALE.confrontation.length - 1].text;
  }
  const a = antagonistOf(act);
  if (!a) return `${act.bossName} waits on this floor with ${act.shard}.`;
  return fill(pick(rng, a.threshold), actVars(act));
}

/** Whether a fight's boss is the act's antagonist, whatever decorations its name carries. */
export function isActBoss(state: StoryState, monsterName: string): boolean {
  const act = state.act;
  if (!act || state.stage !== 'seek') return false;
  const plain = monsterName.replace(/^\S+ /u, m => (/[A-Za-z]/.test(m) ? m : '')).replace(/ \(Boss\)$/, '').trim();
  return plain === act.bossName || monsterName.includes(act.bossName);
}

/**
 * The story boss's own voice: what it says when the fight opens and when it
 * is bloodied. Null for any monster that is not the act's antagonist, so the
 * generic boss voice speaks for those.
 */
export function storyBossLine(state: StoryState, monsterName: string, phase: 'opening' | 'bloodied'): string | null {
  const act = state.act;
  if (!act || !isActBoss(state, monsterName)) return null;
  const rng = rngFor(state, act.index, `voice:${phase}`);
  if (act.kind === 'opening') return pick(rng, phase === 'opening' ? ACT_ONE.antagonist.taunt : ACT_ONE.antagonist.bloodied);
  if (act.kind === 'finale') return pick(rng, phase === 'opening' ? FINALE.taunt : FINALE.bloodied);
  const a = antagonistOf(act);
  if (!a) return null;
  return fill(pick(rng, phase === 'opening' ? a.taunt : a.bloodied), actVars(act));
}

/** What the giver town says of the antagonist while the act is on, or null for the opening and the finale. */
export function heraldLine(state: StoryState, act: ActRecord, townName: string, rng: () => number): string | null {
  const a = antagonistOf(act);
  if (!a || act.kind === 'opening' || act.kind === 'finale') return null;
  return fill(pick(rng, a.herald), { ...actVars(act), town: townName });
}

/** The fated die the held shards grant at a camp, or null before the first shard is won. */
export function shardBoon(state: StoryState): { value: number; line: string; shards: number } | null {
  const shards = Math.min(SHARD_BOONS.length, state.complete ? SHARD_BOONS.length : state.actsDone);
  if (shards <= 0) return null;
  const boon = SHARD_BOONS[shards - 1];
  return { value: boon.value, line: boon.line, shards };
}

/** What the party's reputation brings to the road: hunters after a bounty, help from a network. */
export type StoryRoadEvent =
  | { kind: 'hunters'; lines: string[] }
  | { kind: 'ally'; lines: string[]; gold: number };

export function storyRoadEvent(state: StoryState, rng: () => number): StoryRoadEvent | null {
  const hunted = has(state, 'hunted') || has(state, 'bounty');
  const network = has(state, 'ally_network');
  if (!hunted && !network) return null;
  const roll = rng();
  if (hunted && roll < 0.5) {
    return {
      kind: 'hunters',
      lines: [
        pick(rng, [
          'Riders on the road behind, keeping pace and not closing. Then closing. They have the party’s faces on a paper.',
          'The next bend holds three hunters with a writ and no interest in reading it aloud.',
          'A whistle from the trees, answered from the rocks. The bounty has found the party before the party found the town.',
        ]),
      ],
    };
  }
  if (network && roll >= 0.5) {
    const gold = 15 + 5 * state.actsDone;
    return {
      kind: 'ally',
      lines: [
        pick(rng, [
          'A thin runner waits at the milestone with a purse and a word: the road ahead is clear, and the town past it knows the party is coming.',
          'A child from a village the party once spared hands over a folded note and a few coins collected door to door. The note says only: we are watching for you.',
        ]),
      ],
      gold,
    };
  }
  return null;
}

/** The ending the party has earned, most specific first. */
export function endingText(state: StoryState): string {
  for (const e of FINALE.endings) {
    if (e.requires.every(f => has(state, f))) return e.text;
  }
  return FINALE.endings[FINALE.endings.length - 1].text;
}

/** The line in the top strip. */
export function storyChip(state: StoryState, partyLevel: number, questActive: boolean): string {
  const act = state.act;
  if (!act) return '';
  const label = act.kind === 'epilogue' ? act.title : `Act ${roman(act.index)}`;
  if (state.stage === 'choice') return `${label} · the party weighs a choice`;
  const r = readiness(act, partyLevel);
  if (questActive) return `${label} · ${act.bossName}, floor ${act.targetFloor} of ${act.entranceName}`;
  if (!r.ready) return `${label} · ${act.bossName} waits · needs level ${r.needed} (party ${partyLevel})`;
  return `${label} · ready for ${act.bossName}`;
}

/** Journal lines the DM can read back. */
export function journalLines(state: StoryState): string[] {
  const lines = state.journal.map(j => j.split('|')[1] ?? j);
  if (state.act) {
    const act = state.act;
    lines.push(`Now: ${act.kind === 'epilogue' ? act.title : `Act ${roman(act.index)}, ${act.title}`} — ${act.bossName} holds ${act.shard} on floor ${act.targetFloor} of ${act.entranceName}.`);
  }
  if (state.flags.length > 0) lines.push(`The party is known for: ${state.flags.join(', ')}.`);
  return lines;
}

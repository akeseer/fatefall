/**
 * BulletinBoard — quick tasks that appear on a town's bulletin board.
 * Each visit to town, a fresh batch of tasks is generated. Tasks are
 * simple: slay N of a creature, collect herbs, escort a merchant, etc.
 * Completing them gives small gold + XP rewards and builds town reputation.
 */

import { OverworldTown, OverworldEntrance } from '../world/Overworld';
import { getMonsterTemplate } from '../entities/Monster';

export type BulletinTaskKind = 'slay' | 'collect' | 'escort' | 'deliver' | 'scout';

export interface BulletinTask {
  id: string;
  kind: BulletinTaskKind;
  title: string;
  detail: string;
  /**
   * Monster template id to slay (for 'slay' tasks). This must be a real
   * template id, because progress is read from the kill ledger, which is
   * keyed by template id and not by display name.
   */
  targetKind?: string;
  /** How many to slay. */
  targetCount: number;
  /** How many collected so far. */
  progress: number;
  rewardGold: number;
  rewardXp: number;
  /** Rep reward on completion. */
  repReward: number;
  /** The party has taken the task on; only accepted tasks make progress. */
  accepted: boolean;
  completed: boolean;
  /** Entrance this task is tied to (if any). */
  entranceId?: string;
  /**
   * Town the party must reach for an escort or delivery. Set when the task is
   * accepted, since it depends on where the party is standing at the time.
   */
  targetTownId?: string;
  /** Kills already on the ledger when a slay task was accepted. */
  baselineKills?: number;
  /** Rooms already explored when a scout task was accepted. */
  baselineRooms?: number;
}

/**
 * Pluralise a creature name for a notice. Monster names come from real
 * templates now, so "Lizardfolk" must not become "Lizardfolks".
 */
export function pluralise(name: string): string {
  if (/(folk|kin|fish|deer|sheep|swine|undead)$/i.test(name)) return name;
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (/f$/i.test(name)) return `${name.slice(0, -1)}ves`;
  return `${name}s`;
}

// ── Task Templates ─────────────────────────────────────────────────────────

interface SlayTemplate {
  kind: BulletinTaskKind;
  titleFn: (count: number, monster: string) => string;
  detailFn: (count: number, monster: string) => string;
  targetCountRange: [number, number];
  goldBase: number;
  xpBase: number;
  repBase: number;
}

const SLAY_TEMPLATES: SlayTemplate[] = [
  {
    kind: 'slay',
    titleFn: (c, m) => `Clear the Roads: ${c} ${pluralise(m)}`,
    detailFn: (c, m) => `${c} ${pluralise(m)} have been spotted near the roads. Slay them to keep travelers safe.`,
    targetCountRange: [2, 5],
    goldBase: 30,
    xpBase: 20,
    repBase: 5,
  },
  {
    kind: 'slay',
    titleFn: (c, m) => `Monster Menace: Hunt ${c} ${pluralise(m)}`,
    detailFn: (c, m) => `The ${pluralise(m)} are terrorizing the countryside. Put an end to ${c} of them.`,
    targetCountRange: [1, 4],
    goldBase: 40,
    xpBase: 25,
    repBase: 8,
  },
  {
    kind: 'slay',
    titleFn: (c, m) => `Bounty: ${c} ${pluralise(m)} Dead or Alive`,
    detailFn: (c, m) => `The constable has posted a bounty. Bring proof of ${c} ${m} kills.`,
    targetCountRange: [2, 6],
    goldBase: 50,
    xpBase: 30,
    repBase: 6,
  },
];

const COLLECT_TEMPLATES = [
  {
    kind: 'collect' as BulletinTaskKind,
    titleFn: (c: number) => `Gather ${c} Herbs`,
    detailFn: (c: number) => `The local healer needs ${c} bundles of herbs from the wilderness. Collect them on your travels.`,
    targetCountRange: [3, 8] as [number, number],
    goldBase: 15,
    xpBase: 10,
    repBase: 3,
  },
  {
    kind: 'collect' as BulletinTaskKind,
    titleFn: (c: number) => `Mine ${c} Crystals`,
    detailFn: (c: number) => `The town's jeweler is paying for ${c} raw crystals. Find them in dungeon chests.`,
    targetCountRange: [2, 5] as [number, number],
    goldBase: 25,
    xpBase: 15,
    repBase: 4,
  },
  {
    kind: 'collect' as BulletinTaskKind,
    titleFn: (c: number) => `Collect ${c} Trophies`,
    detailFn: (c: number) => `A naturalist wants ${c} monster parts for study. Bring back heads, claws, or scales.`,
    targetCountRange: [2, 6] as [number, number],
    goldBase: 35,
    xpBase: 20,
    repBase: 5,
  },
];

const ESCORT_TEMPLATES = [
  {
    kind: 'escort' as BulletinTaskKind,
    titleFn: () => `Escort a Merchant Caravan`,
    detailFn: () => `A merchant needs protection on the road. Escort them safely to the next town.`,
    goldBase: 60,
    xpBase: 40,
    repBase: 10,
  },
  {
    kind: 'escort' as BulletinTaskKind,
    titleFn: () => `Protect a Pilgrim`,
    detailFn: () => `A pilgrim seeks safe passage to a distant temple. Keep them alive.`,
    goldBase: 30,
    xpBase: 25,
    repBase: 12,
  },
  {
    kind: 'escort' as BulletinTaskKind,
    titleFn: () => `Guard a Supply Train`,
    detailFn: () => `The town guard needs escort for a supply run to the frontier outpost.`,
    goldBase: 50,
    xpBase: 35,
    repBase: 8,
  },
];

const DELIVER_TEMPLATES = [
  {
    kind: 'deliver' as BulletinTaskKind,
    titleFn: () => `Deliver a Sealed Letter`,
    detailFn: () => `A merchant has a letter that must reach the next town. No questions asked.`,
    goldBase: 20,
    xpBase: 10,
    repBase: 3,
  },
  {
    kind: 'deliver' as BulletinTaskKind,
    titleFn: () => `Return a Lost Relic`,
    detailFn: () => `A temple relic was stolen and found in a dungeon. Return it to the temple.`,
    goldBase: 40,
    xpBase: 20,
    repBase: 8,
  },
];

const SCOUT_TEMPLATES = [
  {
    kind: 'scout' as BulletinTaskKind,
    titleFn: () => `Scout the Dungeon Entrance`,
    detailFn: () => `Report on what lurks near the dungeon entrance. Simply reaching floor 1 counts.`,
    goldBase: 15,
    xpBase: 10,
    repBase: 3,
    targetCount: 1,
  },
  {
    kind: 'scout' as BulletinTaskKind,
    titleFn: () => `Map the First Floor`,
    detailFn: () => `The cartographer needs a report on the first floor's layout. Explore 5 rooms.`,
    goldBase: 25,
    xpBase: 15,
    repBase: 5,
    targetCount: 5,
  },
];

// ── Monster Names for Slay Tasks ───────────────────────────────────────────

/**
 * Slay targets, held as monster template ids. Progress comes from the kill
 * ledger, which is keyed by template id, so a task must never name a creature
 * by a display string that has no template behind it.
 */
const SLAY_TARGET_IDS = [
  'goblin', 'kobold', 'giant_rat', 'skeleton', 'zombie',
  'ghoul', 'giant_spider', 'orc', 'bugbear', 'hobgoblin',
  'owlbear', 'harpy', 'gnoll', 'lizardfolk', 'bandit',
  'shadow', 'wight', 'dire_wolf', 'giant_bat', 'gargoyle',
];

// ── Generation ─────────────────────────────────────────────────────────────

/** Get a seeded random number generator from a string seed. */
function seededRng(seed: string): () => number {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = ((s << 5) - s + seed.charCodeAt(i)) | 0;
  return () => { s = (s * 16807 + 0) & 0x7fffffff; return (s & 0x7fffffff) / 0x7fffffff; };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate a fresh batch of bulletin board tasks for a town.
 * The seed ensures the same town gets different tasks each visit
 * (seeded by town id + visit count).
 */
export function generateBulletinTasks(
  town: OverworldTown,
  visitCount: number,
  partyLevel: number,
  entrances: OverworldEntrance[],
): BulletinTask[] {
  const rng = seededRng(`${town.id}_visit${visitCount}`);
  const tasks: BulletinTask[] = [];
  const count = 3 + Math.floor(rng() * 2); // 3-4 tasks per board

  // Each slot gets a few attempts, because a repeat of a notice already on the
  // board is discarded rather than posted twice.
  for (let i = 0, attempt = 0; tasks.length < count && attempt < count * 6; attempt++) {
    const roll = rng();
    let task: BulletinTask | null = null;

    if (roll < 0.35) {
      // Slay task
      const tpl = pick(SLAY_TEMPLATES, rng);
      const targetId = pick(SLAY_TARGET_IDS.filter(id => getMonsterTemplate(id)), rng) ?? 'goblin';
      const monster = getMonsterTemplate(targetId)?.name ?? 'Goblin';
      const targetCount = randInt(rng, tpl.targetCountRange[0], tpl.targetCountRange[1]);
      const levelMul = 1 + partyLevel * 0.15;
      const entrance = entrances.length > 0 ? pick(entrances, rng) : undefined;
      task = {
        id: `bulletin_${town.id}_${visitCount}_${i}`,
        kind: 'slay',
        title: tpl.titleFn(targetCount, monster),
        detail: tpl.detailFn(targetCount, monster),
        targetKind: targetId,
        targetCount,
        progress: 0,
        rewardGold: Math.round(tpl.goldBase * levelMul),
        rewardXp: Math.round(tpl.xpBase * levelMul),
        repReward: tpl.repBase,
        accepted: false,
        completed: false,
        entranceId: entrance?.id,
      };
    } else if (roll < 0.55) {
      // Collect task
      const tpl = pick(COLLECT_TEMPLATES, rng);
      const targetCount = randInt(rng, tpl.targetCountRange[0], tpl.targetCountRange[1]);
      const levelMul = 1 + partyLevel * 0.15;
      task = {
        id: `bulletin_${town.id}_${visitCount}_${i}`,
        kind: 'collect',
        title: tpl.titleFn(targetCount),
        detail: tpl.detailFn(targetCount),
        targetCount,
        progress: 0,
        rewardGold: Math.round(tpl.goldBase * levelMul),
        rewardXp: Math.round(tpl.xpBase * levelMul),
        repReward: tpl.repBase,
        accepted: false,
        completed: false,
      };
    } else if (roll < 0.75) {
      // Escort task
      const tpl = pick(ESCORT_TEMPLATES, rng);
      const levelMul = 1 + partyLevel * 0.15;
      task = {
        id: `bulletin_${town.id}_${visitCount}_${i}`,
        kind: 'escort',
        title: tpl.titleFn(),
        detail: tpl.detailFn(),
        targetCount: 1,
        progress: 0,
        rewardGold: Math.round(tpl.goldBase * levelMul),
        rewardXp: Math.round(tpl.xpBase * levelMul),
        repReward: tpl.repBase,
        accepted: false,
        completed: false,
      };
    } else if (roll < 0.9) {
      // Deliver task
      const tpl = pick(DELIVER_TEMPLATES, rng);
      const levelMul = 1 + partyLevel * 0.15;
      task = {
        id: `bulletin_${town.id}_${visitCount}_${i}`,
        kind: 'deliver',
        title: tpl.titleFn(),
        detail: tpl.detailFn(),
        targetCount: 1,
        progress: 0,
        rewardGold: Math.round(tpl.goldBase * levelMul),
        rewardXp: Math.round(tpl.xpBase * levelMul),
        repReward: tpl.repBase,
        accepted: false,
        completed: false,
      };
    } else {
      // Scout task
      const tpl = pick(SCOUT_TEMPLATES, rng);
      const levelMul = 1 + partyLevel * 0.15;
      const entrance = entrances.length > 0 ? pick(entrances, rng) : undefined;
      task = {
        id: `bulletin_${town.id}_${visitCount}_${i}`,
        kind: 'scout',
        title: tpl.titleFn(),
        detail: tpl.detailFn(),
        targetCount: tpl.targetCount,
        progress: 0,
        rewardGold: Math.round(tpl.goldBase * levelMul),
        rewardXp: Math.round(tpl.xpBase * levelMul),
        repReward: tpl.repBase,
        accepted: false,
        completed: false,
        entranceId: entrance?.id,
      };
    }

    // Boards used to post the same notice two or three times; keep them distinct.
    if (task && !tasks.some(t => t.title === task!.title)) {
      tasks.push(task);
      i++;
    }
  }
  return tasks;
}

/** Get the icon for a bulletin task kind. */
export function bulletinIcon(kind: BulletinTaskKind): string {
  switch (kind) {
    case 'slay': return '⚔️';
    case 'collect': return '🌿';
    case 'escort': return '🛡️';
    case 'deliver': return '📦';
    case 'scout': return '🔍';
  }
}

/** Get progress text for a bulletin task. */
export function bulletinProgress(task: BulletinTask): string {
  if (task.completed) return '✅ Complete!';
  if (!task.accepted) return 'Not taken';
  switch (task.kind) {
    case 'slay': return `${task.progress}/${task.targetCount} slain`;
    case 'collect': return `${task.progress}/${task.targetCount} collected`;
    case 'escort': return '🛡️ Escorting — deliver them to another town';
    case 'deliver': return '📦 Carrying — take it to another town';
    case 'scout': return `${task.progress}/${task.targetCount} rooms explored`;
  }
}

/** True once a task's objective is met and it can be claimed. */
export function bulletinObjectiveMet(task: BulletinTask): boolean {
  return task.accepted && task.progress >= task.targetCount;
}

/**
 * What the party must actually do, for the task detail line. Escort and
 * delivery both resolve on arriving at a different town than the one that
 * posted them.
 */
export function bulletinObjective(task: BulletinTask): string {
  switch (task.kind) {
    case 'slay': return `Slay ${task.targetCount}.`;
    case 'collect': return `Bring back ${task.targetCount} finds from your travels.`;
    case 'escort':
    case 'deliver': return 'Reach a different town to complete it.';
    case 'scout': return `Explore ${task.targetCount} room${task.targetCount === 1 ? '' : 's'} underground.`;
  }
}

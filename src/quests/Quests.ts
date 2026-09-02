/**
 * Quests — the reason a party leaves town. A quest points at a specific
 * dungeon entrance and asks the party to reach a floor, slay its boss, or
 * hunt a creature type. Progress is tracked from the kill ledger and the
 * current floor; completed quests are reported back in the giver's town for
 * gold, XP, and sometimes a magic item.
 */

import { Overworld, OverworldEntrance, OverworldTown } from '../world/Overworld';
import { MAGIC_ITEMS } from '../ai/DnDKnowledge';
import { getMonsterTemplate } from '../entities/Monster';
import { RumorBias } from '../world/TownLife';

export type QuestKind = 'reach_floor' | 'slay_boss' | 'slay_kind';

export interface Quest {
  id: string;
  kind: QuestKind;
  title: string;
  detail: string;
  /** Town that handed out the quest (also where it's turned in). */
  giverTownId: string;
  /** The NPC who posted this quest. */
  giverNpcId?: string;
  /** The dungeon entrance the party must delve. */
  entranceId: string;
  /** Objective floor (reach_floor / slay_boss). */
  targetFloor: number;
  /** Monster template id to slay (slay_kind). */
  targetKind?: string;
  /** How many to slay (slay_kind). */
  targetCount: number;
  rewardGold: number;
  rewardXp: number;
  /** Optional magic item id granted on turn-in. */
  rewardItemId?: string;
  accepted: boolean;
  completed: boolean;
  turnedIn: boolean;
}

export interface QuestState {
  dungeonLevel: number;
  killLedger: Record<string, number>;
  bossSlainThisFloor: boolean;
}

const QUESTS: { kind: QuestKind; title: (e: OverworldEntrance) => string; detail: (e: OverworldEntrance, kind?: string, count?: number) => string }[] = [
  {
    kind: 'reach_floor',
    title: e => `Plumb the Depths of ${e.name}`,
    detail: (e, _k, _c) => `Descend to floor ${e.depth} of ${e.name} and return with proof you touched its heart.`,
  },
  {
    kind: 'slay_boss',
    title: e => `The Guardian of ${e.name}`,
    detail: (e, _k, _c) => `Something ancient holds court at the bottom of ${e.name}. Slay it and bring back a trophy.`,
  },
  {
    kind: 'slay_kind',
    title: e => `Hunt in ${e.name}`,
    detail: (e, kind, count) => {
      const t = kind ? getMonsterTemplate(kind) : undefined;
      return `The roads are unsafe — cull ${count} ${t?.name ?? 'creatures'} inside ${e.name} and the town will be grateful.`;
    },
  },
];

/** Kinds favored by each rumor bias (may be empty — falls back to the general pool). */
const BIAS_KINDS: Partial<Record<RumorBias, string[]>> = {
  undead: ['skeleton', 'zombie', 'ghoul', 'ghast', 'ghost', 'shadow', 'wraith', 'specter', 'wight', 'mummy', 'banshee', 'vampire_spawn'],
  fey: ['dryad', 'pixie', 'sprite', 'satyr', 'centaur', 'treant'],
  dragon: ['young_dragon', 'young_white_dragon_monster', 'adult_red_dragon_monster', 'wyvern'],
};

/** Pick a monster kind at or below the entrance's depth for hunt quests. */
function pickHuntKind(entrance: OverworldEntrance, bias: RumorBias = 'none'): { id: string; count: number } {
  const maxCr = Math.max(0.25, Math.floor(entrance.depth / 2));
  // A curated pool of common low-CR kinds so hunt quests always resolve.
  const pool = [
    'goblin', 'kobold', 'skeleton', 'zombie', 'giant_rat', 'orc',
    'gnoll', 'dire_wolf', 'shadow', 'ghoul', 'wraith', 'giant_bat',
    'rust_monster', 'gargoyle', 'vampire_spawn',
  ];
  // The town's rumor can favor a whole family of creatures (undead, fey, drakes).
  const biased = (BIAS_KINDS[bias] ?? []).filter(id => {
    const t = getMonsterTemplate(id);
    return t && t.cr <= maxCr + 2;
  });
  const list = biased.length > 0 ? biased : pool.filter(id => {
    const t = getMonsterTemplate(id);
    return t && t.cr <= maxCr + 1;
  });
  const candidates = list.length > 0 ? list : pool;
  const id = candidates[Math.floor(Math.random() * candidates.length)];
  return { id, count: 3 + Math.floor(Math.random() * 4) };
}

/** How the town's live rumor reshapes the board (kind bias, gold, magic odds). */
export function biasToKinds(bias: RumorBias): QuestKind[] {
  switch (bias) {
    case 'hunt': return ['slay_kind', 'slay_kind', 'slay_boss', 'reach_floor'];
    case 'depth': return ['reach_floor', 'reach_floor', 'slay_boss', 'slay_kind'];
    case 'boss': return ['slay_boss', 'slay_boss', 'reach_floor', 'slay_kind'];
    case 'undead': return ['slay_kind', 'slay_kind', 'slay_boss', 'reach_floor'];
    case 'fey': return ['slay_kind', 'slay_kind', 'reach_floor', 'slay_boss'];
    case 'dragon': return ['slay_boss', 'slay_boss', 'slay_kind', 'reach_floor'];
    case 'rich': return ['reach_floor', 'slay_boss', 'slay_kind', 'slay_kind'];
    default: return ['reach_floor', 'slay_boss', 'slay_kind'];
  }
}

export function generateQuests(
  overworld: Overworld,
  town: OverworldTown,
  partyLevel: number,
  count: number,
  exclude: Quest[] = [],
  bias: RumorBias = 'none',
  questGivers?: { id: string; specialty: string }[],
  guildBonus: boolean = false,
): Quest[] {
  const quests: Quest[] = [];
  const usedEntrances = new Set(exclude.filter(q => !q.turnedIn).map(q => q.entranceId));
  const available = overworld.entrances.filter(e => !usedEntrances.has(e.id));
  if (available.length === 0) return quests;

  const templateKinds = biasToKinds(bias);
  for (let i = 0; i < count && available.length > 0; i++) {
    const entrance = available.splice(Math.floor(Math.random() * available.length), 1)[0];
    const kind = templateKinds[Math.floor(Math.random() * templateKinds.length)];
    const template = QUESTS.find(t => t.kind === kind) ?? QUESTS[0];
    const hunt = template.kind === 'slay_kind' ? pickHuntKind(entrance, bias) : undefined;

    const goldMul = (bias === 'rich' ? 1.6 : 1) * (guildBonus ? 1.5 : 1);
    const baseGold = (60 + entrance.depth * 70 + Math.floor(Math.random() * 60)) * goldMul;
    const baseXp = (40 * entrance.depth + Math.floor(Math.random() * 60)) * (guildBonus ? 1.3 : 1);
    const magicDrop = Math.random() < ((bias === 'fey' ? 0.3 : 0.15) + entrance.depth * 0.05 + (guildBonus ? 0.2 : 0));

    // Assign quest to an NPC — pick one that matches the quest kind when possible
    let giverNpcId: string | undefined;
    if (questGivers && questGivers.length > 0) {
      const preferred = questGivers.filter(g => {
        if (kind === 'slay_kind' && g.specialty === 'combat') return true;
        if (kind === 'slay_boss' && (g.specialty === 'combat' || g.specialty === 'faith')) return true;
        if (kind === 'reach_floor' && (g.specialty === 'lore' || g.specialty === 'nature')) return true;
        return false;
      });
      const pool = preferred.length > 0 ? preferred : questGivers;
      giverNpcId = pool[Math.floor(Math.random() * pool.length)].id;
    }

    const quest: Quest = {
      id: `quest_${town.id}_${i + 1}`,
      kind: template.kind,
      title: template.title(entrance),
      detail: template.detail(entrance, hunt?.id, hunt?.count),
      giverTownId: town.id,
      giverNpcId,
      entranceId: entrance.id,
      targetFloor: entrance.depth,
      targetKind: hunt?.id,
      targetCount: hunt?.count ?? 1,
      rewardGold: Math.round(baseGold * (1 + partyLevel * 0.1)),
      rewardXp: Math.round(baseXp * (1 + partyLevel * 0.1)),
      rewardItemId: magicDrop ? MAGIC_ITEMS[Math.floor(Math.random() * MAGIC_ITEMS.length)].id : undefined,
      accepted: false,
      completed: false,
      turnedIn: false,
    };
    quests.push(quest);
  }
  return quests;
}

/** Recompute a quest's completion from live state. Returns true if newly completed. */
export function checkQuestProgress(quest: Quest, state: QuestState): boolean {
  if (quest.completed || !quest.accepted) return false;
  let done = false;
  switch (quest.kind) {
    case 'reach_floor':
      done = state.dungeonLevel >= quest.targetFloor;
      break;
    case 'slay_boss':
      done = state.dungeonLevel >= quest.targetFloor && state.bossSlainThisFloor;
      break;
    case 'slay_kind': {
      const kills = (quest.targetKind && state.killLedger[quest.targetKind]) || 0;
      done = kills >= quest.targetCount;
      break;
    }
  }
  if (done) quest.completed = true;
  return done;
}

export function questProgressText(quest: Quest, state: QuestState): string {
  if (quest.completed) return '✔ Complete — return to town to report.';
  switch (quest.kind) {
    case 'reach_floor':
      return `Floor ${Math.min(state.dungeonLevel, quest.targetFloor)} / ${quest.targetFloor} reached`;
    case 'slay_boss':
      return `Floor ${Math.min(state.dungeonLevel, quest.targetFloor)} / ${quest.targetFloor} — ${state.bossSlainThisFloor ? 'boss slain' : 'boss not yet slain'}`;
    case 'slay_kind': {
      const kills = (quest.targetKind && state.killLedger[quest.targetKind]) || 0;
      const t = quest.targetKind ? getMonsterTemplate(quest.targetKind) : undefined;
      return `${t?.name ?? 'Foes'} slain: ${Math.min(kills, quest.targetCount)} / ${quest.targetCount}`;
    }
  }
}

export function questTargetEntrance(quest: Quest, overworld: Overworld): OverworldEntrance | undefined {
  return overworld.entrances.find(e => e.id === quest.entranceId);
}

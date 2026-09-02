/**
 * DM command vocabulary.
 *
 * Every order the Dungeon Master can type resolves to one `DMCommand`: an
 * intent plus whatever slots that intent needs. Two understanders produce
 * them — the deterministic regex parser (`DMCommandParser`) and the trained
 * intent model (`IntentModel`) — and `Game.dispatchDMCommand` acts on them.
 *
 * Keep `INTENTS` in a fixed order: the trained model's output layer is indexed
 * by it, and the weights file records the list so a mismatch fails loudly.
 */

import type { Direction } from '../engine/types';
import type { RoomFeatureKind } from '../world/RoomFeatures';

/** The slice of live game state an understander is allowed to look at. */
export interface DMContext {
  /** The current dungeon room's feature, if the party is in a dungeon room that has one. */
  featureKind: RoomFeatureKind | null;
  /** Combat is in progress (room-feature verbs are ignored mid-fight). */
  inCombat: boolean;
  mode: 'overworld' | 'town' | 'dungeon';
}

export type UpcastPolicy = 'always' | 'never' | 'auto';
export type TimeTarget = 'dawn' | 'dusk' | 'night';
export type Stance = 'aggressive' | 'cautious';

export type DMCommand =
  // ── meta ──
  | { intent: 'help' }
  | { intent: 'pause' }
  | { intent: 'resume' }
  | { intent: 'save'; slot?: 1 | 2 | 3 }
  | { intent: 'new_game' }
  | { intent: 'model_toggle'; state: 'on' | 'off' | 'status' }
  | { intent: 'rename_party'; name?: string }
  | { intent: 'rename_member'; oldName: string; newName: string }
  // ── observation ──
  | { intent: 'look' }
  | { intent: 'report' }
  | { intent: 'calendar' }
  | { intent: 'journal'; raw: string }
  | { intent: 'inventory' }
  | { intent: 'gear' }
  // ── movement / stance ──
  | { intent: 'move'; direction: Direction }
  | { intent: 'stance'; stance: Stance }
  | { intent: 'formation'; rows: number; cols: number }
  | { intent: 'formation_help' }
  | { intent: 'descend' }
  | { intent: 'leave_dungeon' }
  | { intent: 'enter_dungeon' }
  | { intent: 'depart_town' }
  | { intent: 'go_to_town' }
  | { intent: 'travel_to'; destination: string }
  // ── time / rest ──
  | { intent: 'wait_until'; time: TimeTarget }
  | { intent: 'long_rest' }
  | { intent: 'short_rest' }
  // ── dice / magic ──
  | { intent: 'roll'; expr: string }
  | { intent: 'upcast'; policy: UpcastPolicy }
  | { intent: 'summon'; monster: string }
  // ── traps ──
  | { intent: 'search_traps' }
  | { intent: 'disarm_trap' }
  // ── items ──
  | { intent: 'use_item'; arg: string }
  | { intent: 'equip'; item: string; member?: string }
  | { intent: 'unequip'; arg: string }
  // ── town / quests / commerce ──
  | { intent: 'quests' }
  | { intent: 'accept_quest'; index?: number }
  | { intent: 'turn_in_quest' }
  | { intent: 'shop' }
  | { intent: 'buy'; item: string }
  | { intent: 'sell'; item: string }
  | { intent: 'talk_to'; npc: string }
  | { intent: 'list_npcs' }
  | { intent: 'raid_camp' }
  | { intent: 'report_camp' }
  | { intent: 'list_clues' }
  // ── room features (only valid when the room has that feature) ──
  | { intent: 'feature_altar' }
  | { intent: 'feature_vault' }
  | { intent: 'feature_prison' }
  | { intent: 'feature_chokepoint' }
  | { intent: 'feature_forge' }
  | { intent: 'feature_library' }
  | { intent: 'feature_fountain' }
  | { intent: 'feature_sarcophagus' }
  | { intent: 'feature_throne' }
  | { intent: 'feature_trapped_search' }
  | { intent: 'feature_trapped_disarm' }
  | { intent: 'feature_treasure' }
  | { intent: 'feature_merchant_talk' }
  | { intent: 'feature_merchant_rob' }
  | { intent: 'feature_puzzle' }
  | { intent: 'feature_ritual' }
  | { intent: 'feature_war_room' }
  /** Generic "search" of a room that has a feature: narrates it without spending it. */
  | { intent: 'feature_inspect' }
  /** "Search the room" in a featureless room. */
  | { intent: 'search_room' }
  | { intent: 'unknown' };

export type DMIntent = DMCommand['intent'];

/** Fixed class order for the intent model. Append only; never reorder. */
export const INTENTS: readonly DMIntent[] = [
  'help', 'pause', 'resume', 'save', 'new_game', 'model_toggle', 'rename_party', 'rename_member',
  'look', 'report', 'calendar', 'journal', 'inventory', 'gear',
  'move', 'stance', 'formation', 'formation_help', 'descend', 'leave_dungeon', 'enter_dungeon',
  'depart_town', 'go_to_town', 'travel_to',
  'wait_until', 'long_rest', 'short_rest',
  'roll', 'upcast', 'summon',
  'search_traps', 'disarm_trap',
  'use_item', 'equip', 'unequip',
  'quests', 'accept_quest', 'turn_in_quest', 'shop', 'buy', 'sell', 'talk_to', 'list_npcs',
  'raid_camp', 'report_camp', 'list_clues',
  'feature_altar', 'feature_vault', 'feature_prison', 'feature_chokepoint', 'feature_forge',
  'feature_library', 'feature_fountain', 'feature_sarcophagus', 'feature_throne',
  'feature_trapped_search', 'feature_trapped_disarm', 'feature_treasure',
  'feature_merchant_talk', 'feature_merchant_rob', 'feature_puzzle', 'feature_ritual', 'feature_war_room',
  'feature_inspect', 'search_room',
  'unknown',
];

/**
 * Intents whose arguments are syntax rather than language (dice expressions,
 * names, slot numbers). The regex parser always wins for these when it matches.
 */
export const STRUCTURED_INTENTS: ReadonlySet<DMIntent> = new Set<DMIntent>([
  'help', 'roll', 'formation', 'formation_help', 'rename_member', 'rename_party', 'save', 'upcast', 'model_toggle',
]);

/** Which room feature each feature intent needs. */
export const FEATURE_INTENT_KIND: Partial<Record<DMIntent, RoomFeatureKind>> = {
  feature_altar: 'altar',
  feature_vault: 'vault',
  feature_prison: 'prison',
  feature_chokepoint: 'chokepoint',
  feature_forge: 'forge',
  feature_library: 'library',
  feature_fountain: 'fountain',
  feature_sarcophagus: 'sarcophagus',
  feature_throne: 'throne',
  feature_trapped_search: 'trapped_corridor',
  feature_trapped_disarm: 'trapped_corridor',
  feature_treasure: 'treasure_room',
  feature_merchant_talk: 'merchant_camp',
  feature_merchant_rob: 'merchant_camp',
  feature_puzzle: 'puzzle_room',
  feature_ritual: 'ritual_chamber',
  feature_war_room: 'war_room',
};

/**
 * Context gates: an intent is only valid when these hold. Used both to mask
 * the model's output and to re-validate before dispatch.
 */
export function intentAllowed(intent: DMIntent, ctx: DMContext): boolean {
  const kind = FEATURE_INTENT_KIND[intent];
  if (kind) return !ctx.inCombat && ctx.featureKind === kind;
  if (intent === 'feature_inspect') return !ctx.inCombat && ctx.featureKind !== null;
  if (intent === 'search_room') return !ctx.inCombat && ctx.featureKind === null && ctx.mode === 'dungeon';
  return true;
}

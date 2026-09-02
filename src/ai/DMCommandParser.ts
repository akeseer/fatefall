/**
 * DM command understanding.
 *
 * `parseDMCommandRegex` is the deterministic parser: a verbatim port of the
 * original ordered regex cascade, first match wins. It is pure — text plus a
 * small `DMContext` in, a `DMCommand` out — so it can be unit-tested and used
 * as the labelling oracle for the trained intent model.
 *
 * `understand` combines the two understanders: the regex parser always wins
 * for structured intents (dice, names, slots), the model may override it for
 * everything else when it is confident, and `extractSlots` fills the model's
 * intent from the original-case text.
 */

import { Direction } from '../engine/types';
import type { RoomFeatureKind } from '../world/RoomFeatures';
import {
  DMCommand, DMContext, DMIntent, STRUCTURED_INTENTS, TimeTarget, UpcastPolicy, intentAllowed,
} from './DMCommand';

// ── Direction ────────────────────────────────────────────────────────────────

/** Map free-text compass wording to a grid direction (original strict form). */
export function extractDirection(cmd: string): Direction | null {
  const wantsMove = /^(go|move|head|walk|travel|venture|march|continue)\b/.test(cmd)
    || /^(north|south|east|west|up|down|left|right|n|s|e|w)[!., ]*$/.test(cmd.trim());
  if (!wantsMove) return null;
  return directionWord(cmd);
}

/** The compass word anywhere in the text, without requiring a movement verb. */
export function directionWord(cmd: string): Direction | null {
  if (/north|\bn\b/.test(cmd)) return Direction.Up;
  if (/south|\bs\b/.test(cmd)) return Direction.Down;
  if (/east|\be\b/.test(cmd)) return Direction.Right;
  if (/west|\bw\b/.test(cmd)) return Direction.Left;
  if (/\bup\b/.test(cmd)) return Direction.Up;
  if (/\bdown\b/.test(cmd)) return Direction.Down;
  if (/\bleft\b/.test(cmd)) return Direction.Left;
  if (/\bright\b/.test(cmd)) return Direction.Right;
  return null;
}

// ── Small slot helpers (shared by both understanders) ────────────────────────

/** Small counting words, since people write "slot two" and "the second job". */
const NUMBER_WORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4,
  first: 1, second: 2, third: 3, fourth: 4,
};
const NUMBER_WORDS = Object.keys(NUMBER_WORD).join('|');

function saveSlot(cmd: string): 1 | 2 | 3 | undefined {
  const m = cmd.match(/slot\s*([1-3])/) || cmd.match(/save\s*([1-3])\s*$/);
  if (m) return parseInt(m[1], 10) as 1 | 2 | 3;
  const word = cmd.match(new RegExp(`slot\\s+(${NUMBER_WORDS})\\b`));
  const n = word ? NUMBER_WORD[word[1]] : 0;
  return n >= 1 && n <= 3 ? (n as 1 | 2 | 3) : undefined;
}

function upcastPolicy(arg: string): UpcastPolicy {
  if (/\b(always|max|maximum|all)\b/.test(arg)) return 'always';
  if (/\b(never|off|none|no)\b/.test(arg)) return 'never';
  // Said the long way round: "burn the biggest slots", "stop wasting the high ones".
  if (/\b(stop|save|conserve|hold back|hold onto|keep|preserve|spare|ration|dont waste|don't waste|stop wasting)\b/.test(arg)) return 'never';
  if (/\b(biggest|highest|largest|strongest|top|full power|everything|go big|all out)\b/.test(arg)) return 'always';
  return 'auto';
}

/** Cautious wording, said any of the many ways a person says "be careful". */
const CAUTIOUS = /\b(flee|retreat|avoid|avoiding|careful|carefully|caution|cautious|sneak|sneaking|evade|withdraw|stealth|stealthy|quiet|quietly|hide|hiding|safe|safety|slip|slipped|slipping|past|dodge|duck|heads down|low profile|no risk|no risks|no unnecessary|dont start|don't start|dont fight|don't fight|no fighting|not fight|stay out|steer clear|wide berth|back off|pull back|fall back|run away|leave them|nobody dies|survive)\b/;

function timeTarget(cmd: string): TimeTarget {
  if (/(dusk|evening)/.test(cmd) && !/(dawn|morning)/.test(cmd)) return 'dusk';
  if (/(night|midnight|dark)/.test(cmd) && !/(dusk|evening|dawn|morning)/.test(cmd)) return 'night';
  return 'dawn';
}

/**
 * Parse "formation 2x2 / line / loose". Returns 'help' for a bare "formation"
 * with no shape. The shape word is looked for anywhere in the order, so
 * "form up in a single file line" works as well as "formation 1x4".
 */
export function parseFormation(cmd: string): { rows: number; cols: number } | 'help' | null {
  if (!/\b(formations?|form up|reform|shape)\b/i.test(cmd)) return null;
  // Asking about formations rather than ordering one.
  if (/\b(options?|list|choices|help|which|what|show)\b/i.test(cmd)) return 'help';
  const grid = cmd.match(/\b(\d+)\s*x\s*(\d+)\b/i);
  if (grid) {
    return {
      cols: Math.max(1, Math.min(4, parseInt(grid[1], 10))),
      rows: Math.max(1, Math.min(4, parseInt(grid[2], 10))),
    };
  }
  if (/\b(line|column|single|file|single-file)\b/i.test(cmd)) return { rows: 4, cols: 1 };
  if (/\b(loose|wide|spread)\b/i.test(cmd)) return { rows: 2, cols: 3 };
  if (/\b(block|square)\b/i.test(cmd)) return { rows: 2, cols: 2 };
  // "formation <unrecognised word>" still means a formation change; bare
  // "formation" is a request for the list of shapes.
  return /\bformation\s+(?:as\s+|into\s+|a\s+|the\s+)?[a-z0-9]/i.test(cmd) ? { rows: 2, cols: 2 } : 'help';
}

/**
 * Split "put the chain mail on the monk" into the gear and who wears it.
 * Returns an empty item when there is no equip wording at all, so callers can
 * fall back to the general span rules.
 */
function equipSlots(cmd: string): { item: string; member?: string } {
  const EQUIP_VERB = /(?:equip|wield|don|wear|put on|strap on|buckle on|kit out with|put|get|give|hand)\s+/;
  const onWho = cmd.match(/^(.*?)\s+on\s+([a-z][a-z' -]*)$/);
  const base = onWho ? onWho[1] : cmd;
  const member = onWho ? onWho[2].replace(/^(the|a|an)\s+/, '').trim() : undefined;
  const m = base.match(new RegExp(EQUIP_VERB.source + '(.+)$'));
  const item = m ? strip(m[1]) : '';
  return member ? { item, member } : { item };
}

function renameMember(text: string): { oldName: string; newName: string } {
  const match = text.match(/(?:rename character|rename)\s+(.+?)\s+(?:to|as)\s+(.+)/i);
  return match ? { oldName: match[1].trim(), newName: match[2].trim() } : { oldName: '', newName: '' };
}

// ── Room-feature verbs (depend on the current room) ──────────────────────────

/**
 * Port of `interactWithRoomFeature`'s matching half. Returns the feature
 * intent the text would have triggered, or null when the feature code would
 * have declined and let the rest of the cascade run.
 */
export function parseFeatureIntent(cmd: string, featureKind: RoomFeatureKind | null): DMCommand | null {
  // Never shadow the dedicated trap commands.
  if (/\b(search for traps|disarm trap|spring the trap)\b/.test(cmd)) return null;

  if (!featureKind) {
    if (/\bsearch\b.*\b(room|chamber|area|here)\b|\binvestigate\b/.test(cmd)) return { intent: 'search_room' };
    return null;
  }

  switch (featureKind) {
    case 'altar':
      if (/\b(pray|kneel|bless|offer|altar|shrine)\b/.test(cmd)) return { intent: 'feature_altar' };
      break;
    case 'vault':
      if (/\b(search|rob|loot|open|break)\b.*\b(vault|strongbox|chest|treasure)\b/.test(cmd)) return { intent: 'feature_vault' };
      break;
    case 'prison':
      if (/\b(free|release|rescue)\b|\b(prison|cell|cage)\b/.test(cmd)) return { intent: 'feature_prison' };
      break;
    case 'chokepoint':
      if (/\b(barricade|blockade|fortify|brace|hold the line)\b/.test(cmd)) return { intent: 'feature_chokepoint' };
      break;
    case 'forge':
      if (/\b(forge|sharpen|whetstone|hone)\b/.test(cmd)) return { intent: 'feature_forge' };
      break;
    case 'library':
      if (/\b(read|study|library|tomes?|books?|grimoire)\b/.test(cmd)) return { intent: 'feature_library' };
      break;
    case 'fountain':
      if (/\b(drink|sip|fountain|cistern)\b/.test(cmd)) return { intent: 'feature_fountain' };
      break;
    case 'sarcophagus':
      if (/\b(open|break|pry)\b.*\b(sarcophagus|tomb|coffin)\b/.test(cmd)) return { intent: 'feature_sarcophagus' };
      break;
    case 'throne':
      if (/\b(throne|sit)\b/.test(cmd)) return { intent: 'feature_throne' };
      break;
    case 'trapped_corridor':
      if (/\b(search|detect|find|scan|check|examine)\b/.test(cmd)) return { intent: 'feature_trapped_search' };
      if (/\b(disarm|disable|defuse)\b/.test(cmd)) return { intent: 'feature_trapped_disarm' };
      break;
    case 'treasure_room':
      if (/\b(search|loot|rob|open|take|grab|steal)\b/.test(cmd)) return { intent: 'feature_treasure' };
      break;
    case 'merchant_camp':
      if (/\b(buy|trade|shop|merchant|talk|speak|hello|greet)\b/.test(cmd)) return { intent: 'feature_merchant_talk' };
      if (/\b(loot|rob|attack|steal)\b/.test(cmd)) return { intent: 'feature_merchant_rob' };
      break;
    case 'puzzle_room':
      if (/\b(solve|puzzle|rotate|align|press|activate|examine|study)\b/.test(cmd)) return { intent: 'feature_puzzle' };
      break;
    case 'ritual_chamber':
      if (/\b(pray|meditate|channel|summon|ritual|cast|use)\b/.test(cmd)) return { intent: 'feature_ritual' };
      break;
    case 'war_room':
      if (/\b(examine|study|map|plan|strategy|search|look)\b/.test(cmd)) return { intent: 'feature_war_room' };
      break;
    case 'chest':
      if (/\b(chest|coffer|strongbox|trunk|lid|box)\b/.test(cmd)
        || /\b(open|pry|force|crack|unlock|pick|loot|rob|search|take|grab|empty)\b/.test(cmd)) {
        return { intent: 'feature_chest' };
      }
      break;
  }

  // Generic search narrates the feature without spending it.
  if (/\bsearch\b|\binvestigate\b/.test(cmd)) return { intent: 'feature_inspect' };
  return null;
}

// ── The regex cascade ────────────────────────────────────────────────────────

/**
 * Deterministic parser: the original ordered regex cascade, first match wins.
 * `text` may be any case; slots that carry names keep the original case.
 */
export function parseDMCommandRegex(rawText: string, ctx: DMContext): DMCommand {
  const text = rawText.trim();
  const cmd = text.toLowerCase();
  if (!cmd) return { intent: 'unknown' };

  if (/^(help|\?)$/.test(cmd)) return { intent: 'help' };

  const model = cmd.match(/^\s*(?:dm\s+)?model(?:\s+(on|off|status))?\s*$/);
  if (model) return { intent: 'model_toggle', state: (model[1] as 'on' | 'off' | 'status' | undefined) ?? 'status' };

  if (/\b(pause|hold)\b/.test(cmd)) return { intent: 'pause' };
  if (/\b(resume|unpause|carry on|as you were)\b/.test(cmd)) return { intent: 'resume' };

  // Checked before "save" so that "wipe the save" wipes rather than saves.
  // "abandon" only wipes when it clearly means the run — "abandon the delve"
  // is an order to climb out, not to erase the party.
  if (/\b(new game|new run|wipe|erase|fresh start|start over|restart)\b/.test(cmd)
    || /\babandon\b(?!\s+(?:the\s+|this\s+)?(?:delve|dungeon|crypt|ruins?|camp|quest|job|contract|fight|battle))/.test(cmd)) {
    return { intent: 'new_game' };
  }
  if (/\b(save|saved|quick ?save|checkpoint)\b/.test(cmd)) return { intent: 'save', slot: saveSlot(cmd) };

  if (/\b(rename party|party name|name party|name the party|rename the party)\b/.test(cmd)) {
    const nameArg = text.replace(/.*?(?:rename party|party name|name party|name the party|rename the party)\s*/i, '').trim();
    return nameArg.length > 0 ? { intent: 'rename_party', name: nameArg } : { intent: 'rename_party' };
  }
  if (/\b(rename character|rename)\b/.test(cmd) && /\b(to|as)\b/.test(cmd)) {
    return { intent: 'rename_member', ...renameMember(text) };
  }

  // Trap-search phrases are specific; check them before "look" can claim "look for traps".
  if (/\b(search for traps|look for traps|find traps|scan for traps|check for traps)\b/.test(cmd)) return { intent: 'search_traps' };

  if (/\b(look|look around|examine|survey|inspect|describe the room|describe room)\b/.test(cmd)) return { intent: 'look' };

  // Interact with the current room's feature (altar, vault, chokepoint...).
  if (!ctx.inCombat) {
    const feature = parseFeatureIntent(cmd, ctx.featureKind);
    if (feature) return feature;
  }

  if (/^\s*roll\b/.test(cmd)) return { intent: 'roll', expr: cmd.replace(/^\s*roll\s*/, '').trim() };

  if (/\bupcast\b/.test(cmd)) return { intent: 'upcast', policy: upcastPolicy(cmd.replace(/upcast\s*/g, '').trim()) };

  const dir = extractDirection(cmd);
  if (dir) return { intent: 'move', direction: dir };

  if (/\b(descend|deeper|next floor|downstairs|stairs? down|take the stairs)\b/.test(cmd)) return { intent: 'descend' };

  // Bandit-camp phrases are checked here, ahead of "camp" (long rest) and
  // "report" (status), which otherwise swallow them. They are specific enough
  // that nothing else can want them.
  const CAMP = /(?:the\s+|their\s+|that\s+)?(?:bandit\s+)?(?:camp|hideout)/;
  if (new RegExp(`\\b(?:raid|assault|attack|hit|storm|sack)\\s+${CAMP.source}\\b`).test(cmd)) return { intent: 'raid_camp' };
  if (new RegExp(`\\breport\\s+${CAMP.source}\\b`).test(cmd)
    || /\breport\s+(?:the\s+)?bandits\b|\breport to (?:the )?constable\b/.test(cmd)) {
    return { intent: 'report_camp' };
  }
  // Camp-clue listings, before "camp" can be read as an order to make camp.
  if (/\b(camp clues|bandit maps|list clues)\b/.test(cmd)) return { intent: 'list_clues' };

  if (/\b(wait|hold up|pass the time|bide|wait out|sit tight)\b/.test(cmd)
    && /(dawn|daylight|morning|day|dusk|evening|night|midnight|dark)/.test(cmd)) {
    return { intent: 'wait_until', time: timeTarget(cmd) };
  }
  if (/\b(long rest|camp)\b/.test(cmd)) return { intent: 'long_rest' };
  if (/\b(rest|recover|catch(ing)? breath|bind wounds)\b/.test(cmd)) return { intent: 'short_rest' };

  if (/\b(attack|fight|charge|hunt|kill|to arms|onward)\b/.test(cmd)) return { intent: 'stance', stance: 'aggressive' };
  if (/\b(flee|retreat|avoid|careful|cautious|sneak|evade|withdraw|stealth)\b/.test(cmd)) return { intent: 'stance', stance: 'cautious' };

  const formation = parseFormation(cmd);
  if (formation === 'help') return { intent: 'formation_help' };
  if (formation) return { intent: 'formation', ...formation };

  if (/\b(search|look for traps|find traps|scan for traps|check for traps)\b/.test(cmd)) return { intent: 'search_traps' };
  if (/\b(disarm|disable the trap|defuse the trap|disarm trap|spring the trap)\b/.test(cmd)) return { intent: 'disarm_trap' };

  const useMatch = cmd.match(/^(?:use|drink|quaff|read|cast)\s+(.+)/i);
  if (useMatch) return { intent: 'use_item', arg: useMatch[1] };

  // "gear" belongs to the equipment listing below (the help text promises it).
  if (/\b(loot|treasure|inventory|pack|what do we carry|what are we carrying)\b/.test(cmd)) return { intent: 'inventory' };

  const summonMatch = cmd.match(/\b(conjure|summon|spawn)\s+(.+)/);
  if (summonMatch) return { intent: 'summon', monster: summonMatch[2].replace(/[!.]/g, '').trim() };

  if (/\b(what day|calendar|date|today|what is it\?|whats today)\b/.test(cmd)) return { intent: 'calendar' };
  if (/\b(journal|chronicle|history|ledger|story|log)\b/.test(cmd)) return { intent: 'journal', raw: cmd };
  if (/\b(report|status|sitrep|how goes|party status)\b/.test(cmd)) return { intent: 'report' };

  // ── Equipment ──
  if (/\b(equip|wield|don|wear|put on)\b/.test(cmd) && !/\b(unequip|remove|doff)\b/.test(cmd)) {
    return { intent: 'equip', ...equipSlots(cmd) };
  }
  if (/\b(unequip|remove|doff|stow)\b/.test(cmd)) {
    return { intent: 'unequip', arg: cmd.replace(/.*?(?:unequip|remove|doff|stow)\s*/, '').replace(/^(the|a|an)\s+/, '').trim() };
  }
  if (/\b(gear|equipment|loadout)\b/.test(cmd)) return { intent: 'gear' };

  // ── Overworld, town, quest & commerce ──
  // Board work, checked before the quest branch so "tasks" is not read as a quest.
  if (/\b(accept|take|take on|pick up|sign up for)\s+(the\s+)?(task|board task|bulletin|notice|odd job)\b/.test(cmd)) {
    const idx = cmd.match(/(?:task|bulletin|notice|job)\s*(\d)/);
    return idx ? { intent: 'accept_task', index: parseInt(idx[1], 10) } : { intent: 'accept_task' };
  }
  if (/\b(tasks|task board|bulletin board|bulletin|notice board|odd jobs)\b/.test(cmd)) return { intent: 'tasks' };

  if (/\b(quests|quest board|postings|contracts)\b/.test(cmd)) return { intent: 'quests' };
  if (/\b(accept|take|take on|pick up)\s+(the\s+)?(quest|contract|posting|job)\b/.test(cmd)) {
    const idx = cmd.match(/(?:quest|job|posting|contract)\s*(\d)/);
    return idx ? { intent: 'accept_quest', index: parseInt(idx[1], 10) } : { intent: 'accept_quest' };
  }
  if (/\b(turn ?in|complete quest|claim reward|hand in)\b/.test(cmd)) return { intent: 'turn_in_quest' };
  if (/\b(leave town|depart|set out|hit the road|take the road|ride out|head out)\b/.test(cmd)) return { intent: 'depart_town' };
  if (/\b(go to town|return to town|back to town|head home|go home|return home)\b/.test(cmd)) return { intent: 'go_to_town' };
  if (/\b(shop|market|store|buy|sell|trade|merchant)\b/.test(cmd)) {
    const want = cmd.match(/\b(buy|sell)\s+(.+)/);
    if (want) return want[1] === 'buy' ? { intent: 'buy', item: want[2].trim() } : { intent: 'sell', item: want[2].trim() };
    return { intent: 'shop' };
  }
  if (/\b(leave|ascend|climb out|surface|get out|exit the dungeon)\b/.test(cmd)) return { intent: 'leave_dungeon' };
  if (/\b(enter|descend into|delve|go into the)\b/.test(cmd)) return { intent: 'enter_dungeon' };
  const travelMatch = cmd.match(/\b(travel to|head to|make for|bound for|trek to)\s+(.+)/);
  if (travelMatch) return { intent: 'travel_to', destination: travelMatch[2].trim() };

  // ── Bandit camps ──
  if (/\b(list clues|clues|maps|bandit maps|camp clues)\b/.test(cmd)) return { intent: 'list_clues' };

  // ── Townsfolk ──
  if (/\b(talk to|speak to|visit|greet|meet|chat with)\s+(\w+\s*\w*)\b/.test(cmd)) {
    const match = cmd.match(/\b(?:talk to|speak to|visit|greet|meet|chat with)\s+(\w+(?:\s+\w+)?)\b/);
    return { intent: 'talk_to', npc: match ? match[1].trim() : '' };
  }
  if (/\b(list npcs|who is here|who's here|townspeople|people|citizens)\b/.test(cmd)) return { intent: 'list_npcs' };

  return { intent: 'unknown' };
}

// ── Slot filling for a model-predicted intent ────────────────────────────────

const ARTICLE = /^(?:the|a|an|some|my|our|that|this|those|these)\s+/;

/**
 * Trailing clauses that describe what to do with a thing rather than naming it:
 * "an owlbear **on them**", "the constable **a visit**". Cutting them keeps the
 * span close to the actual name so lookups match.
 */
const TRAILING_CLAUSE = /\s+(?:on|at|after|into|onto|towards?|against|in|before|so|and|then|when|while|because|a visit|right now|now|please)\b.*$/;

const strip = (s: string) =>
  s.replace(ARTICLE, '').replace(/[!.?]+$/, '').replace(TRAILING_CLAUSE, '').replace(ARTICLE, '').trim() || s.replace(ARTICLE, '').replace(/[!.?]+$/, '').trim();

/** Conversational framing wrapped around an order: "i want you to …", "could you …". */
const SUBJECT_FRAME = /^(?:i(?:'d| would)?\s+(?:want|like|need)(?:\s+(?:you|them|the party|everyone))?\s+to|i\s+want|i'?d\s+like|i\s+need|could\s+you(?:\s+all)?|can\s+you|can\s+someone|would\s+you|someone|somebody|please|just|let'?s|we\s+should|you\s+should|they\s+should|we\s+need\s+to|i\s+think\s+you\s+should|i\s+reckon\s+you\s+should|how\s+about\s+you|why\s+don'?t\s+you|make\s+sure\s+you|see\s+that\s+you|be\s+sure\s+to|the\s+party\s+(?:will|should)|they\s+need\s+to|time\s+to|it'?s\s+time\s+to|tell\s+them\s+to|have\s+them|have\s+the\s+party|get\s+them\s+to|get\s+everyone\s+to|everyone|everybody|party|all\s+of\s+you)\b[,\s]+/i;

/** Discourse openers: "ok", "right,", "now", "alright then". */
const OPENER = /^(?:ok(?:ay)?|alright|right|now|so|well|hey|listen|first|next|then|and|but)\b[,\s]+/i;

/**
 * Generic verbs of command. Peeling them off leaves the thing being acted on,
 * which is what the dispatcher looks up: "drop an owlbear" -> "owlbear".
 */
const LEAD_VERB = /^(?:go|get|take|give|put|drop|send|throw|toss|grab|pick\s+up|pick|crack\s+open|crack|break\s+out|break|use|have|let|make|bring|fetch|pay|set|point|aim|head|move|push|hand|pass|order|want|need|start|keep|try)\b\s+/i;

/**
 * The name inside an order. Uses the trigger phrase when one is present, and
 * otherwise peels conversational framing and leading verbs until what remains
 * is the thing itself. Returns null when nothing usable is left.
 */
/**
 * Words that are only ever the verb of an order. A span made of nothing but
 * these names no thing at all, so "conjure" on its own yields no monster.
 */
const VERB_ONLY = new Set([
  'go', 'get', 'take', 'give', 'put', 'drop', 'send', 'throw', 'toss', 'grab', 'pick', 'crack', 'break',
  'use', 'have', 'let', 'make', 'bring', 'fetch', 'pay', 'set', 'point', 'aim', 'head', 'move', 'push',
  'hand', 'pass', 'order', 'want', 'need', 'start', 'keep', 'try', 'up', 'off', 'on', 'out', 'in', 'to',
  'conjure', 'summon', 'spawn', 'manifest', 'unleash', 'drink', 'quaff', 'read', 'cast', 'apply', 'sip',
  'swig', 'pop', 'down', 'equip', 'wield', 'don', 'wear', 'unequip', 'remove', 'doff', 'stow', 'shed',
  'lose', 'buy', 'purchase', 'acquire', 'secure', 'sell', 'offload', 'hawk', 'pawn', 'flog', 'shift',
  'unload', 'travel', 'journey', 'march', 'trek', 'cross', 'talk', 'speak', 'chat', 'visit', 'greet',
  'meet', 'see', 'find', 'ask', 'call', 'seek', 'look', 'them', 'him', 'her', 'it', 'us', 'someone',
]);

function openSpan(cmd: string, trigger: RegExp): string | null {
  const direct = cmd.match(trigger);
  if (direct && direct[1] && strip(direct[1])) {
    const s = strip(direct[1]);
    if (!s.split(/\s+/).every(w => VERB_ONLY.has(w))) return s;
  }

  let rest = cmd.replace(OPENER, '').replace(SUBJECT_FRAME, '').replace(OPENER, '');
  for (let i = 0; i < 3; i++) {
    const peeled = rest.replace(LEAD_VERB, '');
    if (peeled === rest) break;
    rest = peeled;
  }
  const s = strip(rest);
  if (!s || !/[a-z]/i.test(s) || s.split(/\s+/).length > 6) return null;
  // Nothing but command verbs left means the order named no thing.
  if (s.split(/\s+/).every(w => VERB_ONLY.has(w))) return null;
  return s;
}

const after = (cmd: string, re: RegExp): string | null => {
  const m = cmd.match(re);
  return m ? strip(m[1]) : null;
};

/** The shape alone, for when the model already knows a formation was ordered. */
function formationShape(cmd: string): { rows: number; cols: number } | null {
  const grid = cmd.match(/\b(\d+)\s*x\s*(\d+)\b/i);
  if (grid) {
    return {
      cols: Math.max(1, Math.min(4, parseInt(grid[1], 10))),
      rows: Math.max(1, Math.min(4, parseInt(grid[2], 10))),
    };
  }
  if (/\b(line|column|single|file|single-file)\b/i.test(cmd)) return { rows: 4, cols: 1 };
  if (/\b(loose|wide|spread)\b/i.test(cmd)) return { rows: 2, cols: 3 };
  if (/\b(block|square|box)\b/i.test(cmd)) return { rows: 2, cols: 2 };
  return null;
}

/**
 * Build the full command for an intent the model chose, pulling slots out of
 * the text with relaxed rules. Returns null when a required slot is missing,
 * in which case the caller falls back to the regex result.
 */
export function extractSlots(intent: DMIntent, rawText: string, ctx: DMContext): DMCommand | null {
  const text = rawText.trim();
  const cmd = text.toLowerCase();
  switch (intent) {
    case 'move': {
      const direction = directionWord(cmd);
      return direction ? { intent, direction } : null;
    }
    case 'save': return { intent, slot: saveSlot(cmd) };
    case 'rename_party': {
      const r = parseDMCommandRegex(text, ctx);
      return r.intent === 'rename_party' ? r : null;
    }
    case 'rename_member': {
      const r = renameMember(text);
      return r.oldName ? { intent, ...r } : null;
    }
    case 'wait_until': return { intent, time: timeTarget(cmd) };
    case 'roll': {
      const expr = after(cmd, /\b(?:roll|throw|cast)\s+(.+)/) ?? after(cmd, /((?:\d*)d\d+(?:\s*[+-]\s*\d+)?(?:\s+(?:adv|dis)\w*)?)/);
      return expr ? { intent, expr } : null;
    }
    case 'upcast': return { intent, policy: upcastPolicy(cmd) };
    case 'stance': {
      // "no more hiding" and "stop sneaking" are orders to fight, so drop the
      // negated phrase before looking for caution.
      const positive = cmd.replace(/\bno more \w+/g, ' ').replace(/\bstop \w+/g, ' ').replace(/\benough \w+/g, ' ');
      return { intent, stance: CAUTIOUS.test(positive) ? 'cautious' : 'aggressive' };
    }
    case 'formation': {
      const f = formationShape(cmd);
      return f ? { intent, ...f } : null;
    }
    case 'summon': {
      const monster = openSpan(cmd, /\b(?:conjure|summon|spawn|call forth|call up|manifest|unleash)\s+(.+)/);
      return monster ? { intent, monster } : null;
    }
    case 'use_item': {
      const arg = openSpan(cmd, /\b(?:use|drink|quaff|read|cast|apply|sip|swig|crack open|break out|pop|down)\s+(.+)/);
      return arg ? { intent, arg } : null;
    }
    case 'equip': {
      const s = equipSlots(cmd);
      if (s.item) return { intent, ...s };
      const item = openSpan(cmd, /\b(?:equip|wield|don|wear|put on|strap on|buckle on|kit out with)\s+(.+)/);
      return item ? { intent, item } : null;
    }
    case 'unequip': {
      const arg = openSpan(cmd, /\b(?:unequip|remove|doff|stow|take off|shed|pack away|put away|lose)\s+(.+)/);
      return arg ? { intent, arg } : null;
    }
    case 'journal': return { intent, raw: cmd };
    case 'accept_quest':
    case 'accept_task': {
      const idx = cmd.match(/(?:quest|job|posting|contract|task|number|#)\s*(\d)\b/) ?? cmd.match(/\b(\d)\b/);
      if (idx) return { intent, index: parseInt(idx[1], 10) };
      const word = cmd.match(new RegExp(`\\b(${NUMBER_WORDS})\\b`));
      return word ? { intent, index: NUMBER_WORD[word[1]] } : { intent };
    }
    case 'buy': {
      const item = openSpan(cmd, /\b(?:buy|purchase|acquire|pick up|stock up on|invest in|secure)\s+(.+)/);
      return item ? { intent, item } : null;
    }
    case 'sell': {
      const item = openSpan(cmd, /\b(?:sell on|sell|offload|hawk|pawn|flog|shift|unload|trade in|cash in|get rid of|part with)\s+(.+)/);
      return item ? { intent, item } : null;
    }
    case 'travel_to': {
      const destination = openSpan(cmd, /\b(?:travel to|head to|head for|make for|make your way to|bound for|trek to|go to|walk to|journey to|march to|set out for|set (?:a )?course for|strike out for|take the road to|push on to|carry on to|cross to|point them at|aim for|over to|off to|round to|across to|towards|toward|to)\s+(.+)/);
      return destination ? { intent, destination } : null;
    }
    case 'talk_to': {
      const npc = openSpan(cmd, /\b(?:talk to|talk with|speak to|speak with|a word with|word with|chat to|chat with|catch up with|check in with|call on|look up|seek out|visit|greet|meet with|meet|see|find|ask)\s+(.+)/);
      return npc ? { intent, npc } : null;
    }
    default:
      // Every remaining intent carries no slots.
      return { intent } as DMCommand;
  }
}

// ── Combined understanding ───────────────────────────────────────────────────

export interface IntentPrediction {
  intent: DMIntent;
  /** Calibrated probability of the top intent. */
  prob: number;
  /** Gap between the top and second probabilities. */
  margin: number;
}

export interface IntentPredictor {
  readonly threshold: number;
  predict(text: string, ctx: DMContext): IntentPrediction;
}

export interface Understanding {
  cmd: DMCommand;
  /** Which understander produced the command; 'none' when nothing matched. */
  source: 'regex' | 'model' | 'none';
  prob?: number;
}

/** Minimum lead the model's top intent needs over its runner-up. */
export const MODEL_MIN_MARGIN = 0.15;

export function understand(rawText: string, ctx: DMContext, model: IntentPredictor | null): Understanding {
  const regex = parseDMCommandRegex(rawText, ctx);
  const fromRegex: Understanding = { cmd: regex, source: regex.intent === 'unknown' ? 'none' : 'regex' };
  if (!model) return fromRegex;
  if (STRUCTURED_INTENTS.has(regex.intent)) return fromRegex;

  const p = model.predict(rawText, ctx);
  // `feature_inspect` only narrates a feature; it must never displace a regex
  // match that actually does something with it.
  const weakerThanRegex = p.intent === 'feature_inspect' && regex.intent !== 'unknown';
  if (
    p.intent !== 'unknown'
    && !weakerThanRegex
    && p.prob >= model.threshold
    && p.margin >= MODEL_MIN_MARGIN
    && intentAllowed(p.intent, ctx)
  ) {
    const cmd = extractSlots(p.intent, rawText, ctx);
    if (cmd) return { cmd, source: 'model', prob: p.prob };
  }
  return fromRegex;
}

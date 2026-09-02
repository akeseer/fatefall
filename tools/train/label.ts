/**
 * Label the synthetic dataset with the regex parser and write the canonical
 * fixture.
 *
 *   npm run label-data
 *
 * 1. For every row in data/train.jsonl and data/dev.jsonl, add `regex_intent`
 *    (what parseDMCommandRegex says). Rows where the regex confidently
 *    disagrees with the template label go to data/disagreements.jsonl for
 *    review — they are never auto-resolved.
 * 2. Every alternation word of every regex, labelled by the regex, becomes
 *    tests/fixtures/canonical.jsonl (the model must agree 100%) and
 *    data/canonical_train.jsonl (so the model has seen them).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDMCommandRegex } from '../../src/ai/DMCommandParser';
import type { DMContext } from '../../src/ai/DMCommand';

const DATA = 'tools/train/data';

type Row = { text: string; intent: string; ctx: DMContext; template?: string; regex_intent?: string };

function readJsonl(path: string): Row[] {
  return readFileSync(path, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function writeJsonl(path: string, rows: object[]) {
  writeFileSync(path, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

// ── 1. Label train/dev ───────────────────────────────────────────────────────
const disagreements: Row[] = [];
const tally = new Map<string, number>();
for (const name of ['train.jsonl', 'dev.jsonl']) {
  const rows = readJsonl(`${DATA}/${name}`);
  for (const r of rows) {
    r.regex_intent = parseDMCommandRegex(r.text, r.ctx).intent;
    if (r.regex_intent !== 'unknown' && r.regex_intent !== r.intent) {
      disagreements.push(r);
      const k = `${r.template ?? '?'} → regex says ${r.regex_intent}`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
  }
  writeJsonl(`${DATA}/${name}`, rows);
  const agree = rows.filter(r => r.regex_intent === r.intent).length;
  console.log(`${name}: ${rows.length} rows, regex agrees on ${agree} (${(100 * agree / rows.length).toFixed(1)}%), regex unknown on ${rows.filter(r => r.regex_intent === 'unknown').length}`);
}
writeJsonl(`${DATA}/disagreements.jsonl`, disagreements);
console.log(`\n${disagreements.length} disagreements → ${DATA}/disagreements.jsonl`);
for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`  ${String(n).padStart(4)}  ${k}`);

// ── 2. Canonical phrases ─────────────────────────────────────────────────────
const D = (over: Partial<DMContext> = {}): DMContext => ({ featureKind: null, inCombat: false, mode: 'dungeon', ...over });
const town = D({ mode: 'town' });
const over = D({ mode: 'overworld' });

const canonical: { text: string; ctx: DMContext }[] = [];
const add = (ctx: DMContext, ...texts: string[]) => texts.forEach(text => canonical.push({ text, ctx }));

add(D(), 'help', '?', 'pause', 'hold', 'resume', 'unpause', 'carry on', 'as you were');
add(D(), 'save', 'saved', 'quicksave', 'quick save', 'checkpoint', 'save to slot 2', 'save 3');
add(D(), 'new game', 'new run', 'abandon', 'wipe', 'erase', 'fresh start', 'start over', 'restart');
add(D(), 'model on', 'model off', 'model status');
add(D(), 'rename party The Iron Hawks', 'party name Wolves', 'name the party Ravens', 'rename Kael to Vex', 'rename character Mira as Zed');
add(D(), 'look', 'look around', 'examine', 'survey', 'inspect', 'describe the room', 'describe room');
add(D(), 'roll d20', 'roll 2d6+3', 'roll d20 adv', 'upcast always', 'upcast never', 'upcast auto', 'upcast');
add(D(), 'go north', 'head south', 'move east', 'walk west', 'travel north', 'venture south', 'march east', 'continue west', 'north', 'south', 'east', 'west', 'n', 's', 'e', 'w', 'up', 'down', 'left', 'right');
add(D(), 'descend', 'deeper', 'next floor', 'downstairs', 'stairs down', 'take the stairs');
add(D(), 'wait until dawn', 'wait until dusk', 'wait until night', 'hold up until morning', 'pass the time until evening', 'bide until midnight', 'wait out the dark', 'sit tight until daylight');
add(D(), 'long rest', 'camp', 'rest', 'recover', 'catch breath', 'catching breath', 'bind wounds');
add(D(), 'attack', 'fight', 'charge', 'hunt', 'kill', 'to arms', 'onward');
add(D(), 'flee', 'retreat', 'avoid', 'careful', 'cautious', 'sneak', 'evade', 'withdraw', 'stealth');
add(D(), 'formation 2x2', 'formation 1x4', 'formation line', 'formation loose', 'formation 2x3', 'formation', 'form up', 'reform', 'shape');
add(D(), 'search', 'search for traps', 'look for traps', 'find traps', 'scan for traps', 'check for traps');
add(D(), 'disarm', 'disable the trap', 'defuse the trap', 'disarm trap', 'spring the trap');
add(D(), 'use healing potion', 'drink potion', 'quaff potion', 'read scroll', 'cast scroll of fireball');
add(D(), 'loot', 'treasure', 'inventory', 'pack', 'what do we carry', 'what are we carrying');
add(D(), 'summon owlbear', 'conjure goblin', 'spawn a dragon');
add(D(), 'what day', 'calendar', 'date', 'today', 'whats today');
add(D(), 'journal', 'chronicle', 'history', 'ledger', 'story', 'log');
add(D(), 'report', 'status', 'sitrep', 'how goes', 'party status');
add(D(), 'equip longsword', 'wield shield', 'don chain mail', 'wear leather armor', 'put on the helm', 'unequip armor', 'remove shield', 'doff armor', 'stow dagger', 'gear', 'equipment', 'loadout');
add(town, 'quests', 'quest board', 'postings', 'contracts', 'accept the quest', 'take the job', 'take on the contract', 'pick up the posting', 'accept quest 2');
add(town, 'turn in', 'turnin', 'complete quest', 'claim reward', 'hand in');
add(town, 'leave town', 'depart', 'set out', 'hit the road', 'take the road', 'ride out', 'head out');
add(over, 'go to town', 'return to town', 'back to town', 'head home', 'go home', 'return home');
add(town, 'shop', 'market', 'store', 'buy', 'sell', 'trade', 'merchant', 'buy healing potion', 'sell rations');
add(D(), 'leave', 'ascend', 'climb out', 'surface', 'get out', 'exit the dungeon');
add(over, 'enter', 'descend into the dungeon', 'delve', 'go into the crypt');
add(over, 'travel to Emberwatch', 'head to Duskhollow', 'make for Silverbark', 'bound for the Sunken Crypts', 'trek to Ashen Spire');
add(over, 'raid camp', 'assault camp', 'attack camp', 'hit the camp', 'storm the camp');
add(town, 'report camp', 'report hideout', 'report bandits', 'report to constable');
add(D(), 'list clues', 'clues', 'maps', 'bandit maps', 'camp clues');
add(town, 'talk to Brenna', 'speak to the constable', 'visit Thalen', 'greet Dax', 'meet the innkeeper', 'chat with Varek');
add(town, 'list npcs', 'who is here', "who's here", 'townspeople', 'people', 'citizens');
// Room features, each under its own room.
add(D({ featureKind: 'altar' }), 'pray', 'kneel', 'bless', 'offer', 'altar', 'shrine', 'pray at the altar', 'search');
add(D({ featureKind: 'vault' }), 'search the vault', 'rob the strongbox', 'loot the chest', 'open the treasure', 'break the vault', 'search');
add(D({ featureKind: 'prison' }), 'free', 'release', 'rescue', 'prison', 'cell', 'cage', 'free the prisoners');
add(D({ featureKind: 'chokepoint' }), 'barricade', 'blockade', 'fortify', 'brace', 'hold the line');
add(D({ featureKind: 'forge' }), 'forge', 'sharpen', 'whetstone', 'hone', 'use the forge');
add(D({ featureKind: 'library' }), 'read', 'study', 'library', 'tome', 'tomes', 'book', 'books', 'grimoire', 'read the tomes');
add(D({ featureKind: 'fountain' }), 'drink', 'sip', 'fountain', 'cistern', 'drink from the fountain');
add(D({ featureKind: 'sarcophagus' }), 'open the sarcophagus', 'break the tomb', 'pry the coffin', 'open the coffin');
add(D({ featureKind: 'throne' }), 'throne', 'sit', 'approach the throne', 'sit on the throne');
add(D({ featureKind: 'trapped_corridor' }), 'check', 'detect', 'find', 'scan', 'search', 'disable', 'defuse', 'disarm the traps');
add(D({ featureKind: 'treasure_room' }), 'search', 'loot', 'rob', 'open', 'take', 'grab', 'steal', 'search the treasure room');
add(D({ featureKind: 'merchant_camp' }), 'buy', 'trade', 'shop', 'merchant', 'talk', 'speak', 'hello', 'greet', 'loot', 'rob', 'attack', 'steal', 'talk to the merchant', 'rob him');
add(D({ featureKind: 'puzzle_room' }), 'solve', 'puzzle', 'rotate', 'align', 'press', 'activate', 'study', 'solve the puzzle');
add(D({ featureKind: 'ritual_chamber' }), 'pray', 'meditate', 'channel', 'summon', 'ritual', 'cast', 'use', 'examine the ritual circle');
add(D({ featureKind: 'war_room' }), 'study', 'map', 'plan', 'strategy', 'search', 'study the war table');
add(D({ featureKind: 'forge' }), 'investigate', 'search the room');
add(D(), 'search the room', 'search the chamber', 'search here', 'investigate');

const labelled = canonical.map(c => ({ ...c, intent: parseDMCommandRegex(c.text, c.ctx).intent }));
writeJsonl('tests/fixtures/canonical.jsonl', labelled);
writeJsonl(`${DATA}/canonical_train.jsonl`, labelled.map(r => ({ ...r, template: 'canonical', regex_intent: r.intent })));
const unknowns = labelled.filter(r => r.intent === 'unknown');
console.log(`\ncanonical: ${labelled.length} phrases → tests/fixtures/canonical.jsonl (${unknowns.length} label as unknown${unknowns.length ? ': ' + unknowns.map(u => JSON.stringify(u.text)).join(', ') : ''})`);

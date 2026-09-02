/**
 * Build tests/fixtures/dm-golden.jsonl — the hand-written acceptance set.
 *
 *   node tools/train/make_golden.mjs
 *
 * These are orders phrased the way a person actually talks at the table, kept
 * deliberately distinct from the training templates in templates.py. They are
 * the honest bar: the model has never seen these exact sentences.
 *
 * Written as a script rather than raw JSONL so the contexts stay readable and
 * a typo in one row cannot silently corrupt the file.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const D = (over = {}) => ({ featureKind: null, inCombat: false, mode: 'dungeon', ...over });
const town = D({ mode: 'town' });
const over = D({ mode: 'overworld' });
const rows = [];
const add = (intent, ctx, text, slots) => rows.push(slots ? { text, ctx, intent, slots } : { text, ctx, intent });

// ── movement ────────────────────────────────────────────────────────────────
add('move', D(), 'could everyone please push northward', { direction: 'up' });
add('move', D(), 'i want the whole party moving south now', { direction: 'down' });
add('move', D(), 'take them east, and keep your eyes open', { direction: 'right' });
add('move', D(), 'lets try the western passage', { direction: 'left' });
add('move', D(), 'follow that corridor north', { direction: 'up' });
add('move', over, 'strike out southward across the fields', { direction: 'down' });
add('move', D(), 'nudge them a bit further east', { direction: 'right' });
add('move', D(), 'onwards to the west', { direction: 'left' });

// ── stance ──────────────────────────────────────────────────────────────────
add('stance', D(), 'i want blood - go looking for a fight', { stance: 'aggressive' });
add('stance', D(), 'no more hiding, take the fight to them', { stance: 'aggressive' });
add('stance', D(), 'be bold from here on', { stance: 'aggressive' });
add('stance', D(), 'keep your heads down and dont start anything', { stance: 'cautious' });
add('stance', D(), 'i would rather you slipped past whatever is down there', { stance: 'cautious' });
add('stance', D(), 'no unnecessary risks please', { stance: 'cautious' });
add('stance', D(), 'stay quiet, avoid every fight you can', { stance: 'cautious' });

// ── rest / time ─────────────────────────────────────────────────────────────
add('long_rest', D(), 'bed down for the night right where you are');
add('long_rest', over, 'pitch the tents, we go on in the morning');
add('short_rest', D(), 'take a breather and see to the wounded');
add('short_rest', D(), 'catch your breath for a minute');
add('wait_until', over, 'sit here quietly until the sun comes up', { time: 'dawn' });
add('wait_until', over, 'hold where you are till it gets dark', { time: 'night' });
add('wait_until', over, 'wait out the afternoon until evening falls', { time: 'dusk' });

// ── dungeon navigation ──────────────────────────────────────────────────────
add('descend', D(), 'find a way down to the next level');
add('descend', D(), 'i want you further underground');
add('descend', D(), 'take the party one floor lower');
add('leave_dungeon', D(), 'thats enough, get everyone back to the surface');
add('leave_dungeon', D(), 'call off the delve and climb out');
add('enter_dungeon', over, 'alright, go inside');
add('enter_dungeon', over, 'time to head into the ruins');

// ── observation ─────────────────────────────────────────────────────────────
add('look', D(), 'tell me what this place looks like');
add('look', D(), 'give me a description of where they are standing');
add('look', over, 'whats the country around them like');
add('report', D(), 'how banged up is everybody');
add('report', D(), 'give me the rundown on the party');
add('report', D(), 'is anyone about to drop');
add('calendar', D(), 'remind me what the moon is doing tonight');
add('calendar', over, 'what is todays date again');
add('journal', D(), 'read me back what weve done so far');
add('journal', D(), 'i want to see the chronicle');
add('inventory', D(), 'what are they lugging around');
add('inventory', D(), 'show me everything in the packs');
add('inventory', D(), 'how much coin have we got');
add('gear', D(), 'who is wearing what right now');
add('gear', D(), 'run me through everyones weapons and armour');

// ── dice / magic ────────────────────────────────────────────────────────────
add('roll', D(), 'roll 2d6 plus three', { expr: '2d6 plus three' });
add('upcast', D(), 'i want the casters burning their biggest slots', { policy: 'always' });
add('upcast', D(), 'tell the casters to stop wasting high slots', { policy: 'never' });
add('summon', D(), 'drop an owlbear on them', { monster: 'owlbear' });
add('summon', D(), 'send a pack of wolves after the party', { monster: 'pack of wolves' });
add('summon', D(), 'i want a goblin ambush right now', { monster: 'goblin ambush' });
add('summon', D(), 'let a troll come lumbering out', { monster: 'troll come lumbering out' });

// ── traps ───────────────────────────────────────────────────────────────────
add('search_traps', D(), 'have the rogue sweep the floor ahead');
add('search_traps', D(), 'i want this hallway checked for tripwires');
add('search_traps', D(), 'is anything rigged around here');
add('disarm_trap', D(), 'get that thing defused before someone loses a leg');
add('disarm_trap', D(), 'have the rogue deal with the mechanism');

// ── items ───────────────────────────────────────────────────────────────────
add('use_item', D({ inCombat: true }), 'someone crack open a healing potion', { arg: 'healing potion' });
add('use_item', D({ inCombat: true }), 'read the fireball scroll at them', { arg: 'fireball scroll' });
add('use_item', D(), 'have the cleric drink the antidote', { arg: 'antidote' });
add('equip', town, 'get that longsword into someones hand', { item: 'longsword' });
add('equip', town, 'put the chain mail on the monk', { item: 'chain mail', member: 'monk' });
add('unequip', town, 'take the shield off', { arg: 'shield off' });

// ── town, quests, commerce ──────────────────────────────────────────────────
add('quests', town, 'whats posted on the board today');
add('quests', town, 'see if theres any work going');
add('accept_quest', town, 'sign us up for the second one', { index: 2 });
add('accept_quest', town, 'well take that job');
add('turn_in_quest', town, 'go collect what were owed');
add('turn_in_quest', town, 'time to cash in the contract');
add('shop', town, 'lets see what the stalls have');
add('shop', town, 'take a wander round the market');
add('buy', town, 'grab a couple of healing potions', { item: 'couple of healing potions' });
add('buy', town, 'we should pick up some rope', { item: 'rope' });
add('sell', town, 'offload that spare armour', { item: 'spare armour' });
add('sell', town, 'flog the gems at the market', { item: 'gems' });
add('talk_to', town, 'go have a word with the blacksmith', { npc: 'blacksmith' });
add('talk_to', town, 'i want them to chat to Brenna', { npc: 'brenna' });
add('talk_to', town, 'pay the constable a visit', { npc: 'constable' });
add('list_npcs', town, 'who is knocking about this town');
add('list_npcs', town, 'give me the names of the locals');
add('depart_town', town, 'right, everybody out of town');
add('depart_town', town, 'weve dawdled long enough, get on the road');
add('go_to_town', over, 'take them back to civilisation');
add('go_to_town', over, 'i want them safe behind town walls');
add('travel_to', over, 'set a course for Emberwatch', { destination: 'emberwatch' });
add('travel_to', over, 'get them over to Duskhollow', { destination: 'duskhollow' });
add('travel_to', over, 'point them at the Sunken Crypts', { destination: 'sunken crypts' });

// ── bandit camps ────────────────────────────────────────────────────────────
add('raid_camp', over, 'hit that bandit camp hard');
add('raid_camp', over, 'i want the hideout stormed');
add('report_camp', town, 'hand the camp map over to the constable');
add('report_camp', town, 'tell the guard where the bandits are holed up');
add('list_clues', town, 'what leads do we have on the bandits');
add('list_clues', D(), 'show me the camp clues we picked up');

// ── meta ────────────────────────────────────────────────────────────────────
add('pause', D(), 'freeze everything for a second');
add('pause', D(), 'stop the clock, i need to think');
add('resume', D(), 'never mind my orders, use your own heads');
add('resume', D(), 'off you go then, back to normal');
add('resume', D(), 'forget what i said and carry on');
add('save', D(), 'write this down before something goes wrong');
add('save', D(), 'stick a checkpoint in slot two', { slot: 2 });
add('new_game', D(), 'scrap this lot and roll a fresh party');
add('new_game', D(), 'wipe it, im starting again');
add('help', D(), 'what can i actually tell them to do');
add('rename_party', D(), 'rename party The Grey Lanterns', { name: 'The Grey Lanterns' });
add('rename_member', D(), 'rename Kael to Ser Kaelan', { oldName: 'Kael', newName: 'Ser Kaelan' });
add('formation', D(), 'get them into a 2x2 block', { rows: 2, cols: 2 });
add('formation', D(), 'single file through here', { rows: 4, cols: 1 });
add('formation', D(), 'spread out into a loose formation', { rows: 2, cols: 3 });
add('formation_help', D(), 'what formations can they hold');

// ── room features ───────────────────────────────────────────────────────────
add('feature_altar', D({ featureKind: 'altar' }), 'have the cleric say a few words at the altar');
add('feature_altar', D({ featureKind: 'altar' }), 'everyone kneel and pray');
add('feature_vault', D({ featureKind: 'vault' }), 'get that vault open and empty it');
add('feature_vault', D({ featureKind: 'vault' }), 'crack the strongbox');
add('feature_prison', D({ featureKind: 'prison' }), 'let those poor souls out of the cages');
add('feature_prison', D({ featureKind: 'prison' }), 'get the prisoners free');
add('feature_chokepoint', D({ featureKind: 'chokepoint' }), 'block that passage up before they come through');
add('feature_chokepoint', D({ featureKind: 'chokepoint' }), 'throw up a barricade here');
add('feature_forge', D({ featureKind: 'forge' }), 'put a proper edge on every blade');
add('feature_forge', D({ featureKind: 'forge' }), 'fire the forge up and sharpen everything');
add('feature_library', D({ featureKind: 'library' }), 'let the wizard bury himself in those books');
add('feature_library', D({ featureKind: 'library' }), 'go through the tomes on the shelves');
add('feature_fountain', D({ featureKind: 'fountain' }), 'everyone take a drink from that fountain');
add('feature_fountain', D({ featureKind: 'fountain' }), 'have a sip of the water');
add('feature_sarcophagus', D({ featureKind: 'sarcophagus' }), 'get that coffin lid off');
add('feature_sarcophagus', D({ featureKind: 'sarcophagus' }), 'prise the stone tomb open');
add('feature_throne', D({ featureKind: 'throne' }), 'someone plant themselves on that throne');
add('feature_throne', D({ featureKind: 'throne' }), 'go and sit in the big chair');
add('feature_trapped_search', D({ featureKind: 'trapped_corridor' }), 'scan this passage properly');
add('feature_trapped_disarm', D({ featureKind: 'trapped_corridor' }), 'disable whatever is rigged here');
add('feature_treasure', D({ featureKind: 'treasure_room' }), 'clean the place out, take every coin');
add('feature_treasure', D({ featureKind: 'treasure_room' }), 'grab all that treasure');
add('feature_merchant_talk', D({ featureKind: 'merchant_camp' }), 'see what the trader is selling');
add('feature_merchant_rob', D({ featureKind: 'merchant_camp' }), 'take his goods by force');
add('feature_puzzle', D({ featureKind: 'puzzle_room' }), 'let the wizard have a crack at that mechanism');
add('feature_puzzle', D({ featureKind: 'puzzle_room' }), 'line the symbols up properly');
add('feature_ritual', D({ featureKind: 'ritual_chamber' }), 'channel something through that circle');
add('feature_war_room', D({ featureKind: 'war_room' }), 'pore over those battle maps');
add('search_room', D(), 'turn this room over and see what turns up');

// ── chatter that must not become an order ───────────────────────────────────
add('unknown', D(), 'god this dungeon is creepy');
add('unknown', D(), 'i reckon that dragon was tougher than the last one');
add('unknown', town, 'that innkeeper seemed shifty to me');
add('unknown', D(), 'how does armour class actually work');
add('unknown', D(), 'whats a beholder anyway');
add('unknown', D(), 'this is going really well so far');
add('unknown', D(), 'poor Kael has had a rough day');
add('unknown', over, 'lovely weather for it');
add('unknown', D(), 'asdkfj alskdjf');
add('unknown', D(), 'qwerty uiop');
add('unknown', D(), 'hmmmm');
add('unknown', D(), 'nice one');
add('unknown', D(), 'i have no idea what to do next');
add('unknown', town, 'remind me why we came here again');
add('unknown', D(), 'tell me a joke');
add('unknown', D(), 'the north wind is bitter tonight');
add('unknown', over, 'a camp would be nice about now');
add('unknown', D(), 'do you think the wizard likes her staff');
add('unknown', D(), 'that was a close one');
add('unknown', D(), 'good luck everyone');

mkdirSync('tests/fixtures', { recursive: true });
writeFileSync('tests/fixtures/dm-golden.jsonl', rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const byIntent = new Map();
for (const r of rows) byIntent.set(r.intent, (byIntent.get(r.intent) ?? 0) + 1);
console.log(`dm-golden.jsonl: ${rows.length} orders over ${byIntent.size} intents (${byIntent.get('unknown')} of them chatter)`);
const missing = rows.filter(r => r.slots && Object.keys(r.slots).length === 0);
if (missing.length) console.log('rows with empty slots:', missing);

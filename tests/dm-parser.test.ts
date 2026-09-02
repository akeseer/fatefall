import { describe, it, expect } from 'vitest';
import { parseDMCommandRegex, parseFeatureIntent, extractSlots, understand, parseFormation } from '../src/ai/DMCommandParser';
import { INTENTS, intentAllowed, type DMContext } from '../src/ai/DMCommand';
import { Direction } from '../src/engine/types';

const ctx = (over: Partial<DMContext> = {}): DMContext => ({ featureKind: null, inCombat: false, mode: 'dungeon', ...over });
const parse = (text: string, c: Partial<DMContext> = {}) => parseDMCommandRegex(text, ctx(c));

describe('parseDMCommandRegex — meta', () => {
  it('help, pause, resume, save, new game', () => {
    expect(parse('help')).toEqual({ intent: 'help' });
    expect(parse('?')).toEqual({ intent: 'help' });
    expect(parse('  ')).toEqual({ intent: 'unknown' });
    expect(parse('pause')).toEqual({ intent: 'pause' });
    expect(parse('as you were')).toEqual({ intent: 'resume' });
    expect(parse('save')).toEqual({ intent: 'save', slot: undefined });
    // "wipe the save" must wipe, not save.
    expect(parse('wipe the save')).toEqual({ intent: 'new_game' });
    expect(parse('save to slot 2')).toEqual({ intent: 'save', slot: 2 });
    expect(parse('quicksave 3')).toEqual({ intent: 'save', slot: 3 });
    expect(parse('new game')).toEqual({ intent: 'new_game' });
    expect(parse('abandon')).toEqual({ intent: 'new_game' });
    expect(parse('abandon this run')).toEqual({ intent: 'new_game' });
    // Abandoning a delve, a fight or a quest must never wipe the save.
    for (const order of ['abandon the delve', 'abandon this dungeon', 'abandon the quest', 'abandon the fight', 'abandon the camp']) {
      expect(parse(order).intent).not.toBe('new_game');
    }
    expect(parse('model off')).toEqual({ intent: 'model_toggle', state: 'off' });
    expect(parse('model')).toEqual({ intent: 'model_toggle', state: 'status' });
  });

  it('rename keeps the original case', () => {
    expect(parse('rename party The Iron Hawks')).toEqual({ intent: 'rename_party', name: 'The Iron Hawks' });
    expect(parse('rename party')).toEqual({ intent: 'rename_party' });
    expect(parse('rename Kael to Xarthax the Bold')).toEqual({ intent: 'rename_member', oldName: 'Kael', newName: 'Xarthax the Bold' });
    expect(parse('rename character Mira as Vex')).toEqual({ intent: 'rename_member', oldName: 'Mira', newName: 'Vex' });
    expect(parse('rename to')).toEqual({ intent: 'rename_member', oldName: '', newName: '' });
  });
});

describe('parseDMCommandRegex — movement, rest, stance', () => {
  it('directions need a movement verb or a bare compass word', () => {
    expect(parse('go north')).toEqual({ intent: 'move', direction: Direction.Up });
    expect(parse('head west!')).toEqual({ intent: 'move', direction: Direction.Left });
    expect(parse('e')).toEqual({ intent: 'move', direction: Direction.Right });
    expect(parse('south.')).toEqual({ intent: 'move', direction: Direction.Down });
    expect(parse('the north wind blows').intent).not.toBe('move');
  });

  it('descend, wait, rests', () => {
    expect(parse('descend')).toEqual({ intent: 'descend' });
    expect(parse('take the stairs down')).toEqual({ intent: 'descend' });
    expect(parse('wait until dawn')).toEqual({ intent: 'wait_until', time: 'dawn' });
    expect(parse('wait for dusk')).toEqual({ intent: 'wait_until', time: 'dusk' });
    expect(parse('sit tight until night')).toEqual({ intent: 'wait_until', time: 'night' });
    expect(parse('wait')).not.toEqual({ intent: 'wait_until', time: 'dawn' });
    expect(parse('make camp')).toEqual({ intent: 'long_rest' });
    expect(parse('long rest')).toEqual({ intent: 'long_rest' });
    expect(parse('rest')).toEqual({ intent: 'short_rest' });
    expect(parse('bind wounds')).toEqual({ intent: 'short_rest' });
  });

  it('stances', () => {
    expect(parse('attack')).toEqual({ intent: 'stance', stance: 'aggressive' });
    expect(parse('to arms!')).toEqual({ intent: 'stance', stance: 'aggressive' });
    expect(parse('be careful')).toEqual({ intent: 'stance', stance: 'cautious' });
    expect(parse('sneak')).toEqual({ intent: 'stance', stance: 'cautious' });
  });

  it('formations', () => {
    expect(parse('formation 2x2')).toEqual({ intent: 'formation', rows: 2, cols: 2 });
    expect(parse('formation line')).toEqual({ intent: 'formation', rows: 4, cols: 1 });
    expect(parse('formation loose')).toEqual({ intent: 'formation', rows: 2, cols: 3 });
    expect(parse('formation 3x1')).toEqual({ intent: 'formation', rows: 1, cols: 3 });
    expect(parse('formation 9x9')).toEqual({ intent: 'formation', rows: 4, cols: 4 });
    expect(parse('form up')).toEqual({ intent: 'formation_help' });
    expect(parseFormation('nothing')).toBeNull();
    // The shape may sit anywhere in the order, not only after "formation".
    expect(parse('form up 2x2')).toEqual({ intent: 'formation', rows: 2, cols: 2 });
    expect(parse('adopt a 1x4 formation')).toEqual({ intent: 'formation', rows: 4, cols: 1 });
    expect(parse('get into a loose formation')).toEqual({ intent: 'formation', rows: 2, cols: 3 });
    expect(parse('reform into single file')).toEqual({ intent: 'formation', rows: 4, cols: 1 });
    expect(parse('formation options')).toEqual({ intent: 'formation_help' });
    expect(parse('what formations are there')).toEqual({ intent: 'formation_help' });
  });
});

describe('parseDMCommandRegex — dice, magic, traps, items', () => {
  it('roll and upcast', () => {
    expect(parse('roll 2d6+3')).toEqual({ intent: 'roll', expr: '2d6+3' });
    expect(parse('Roll d20 adv')).toEqual({ intent: 'roll', expr: 'd20 adv' });
    expect(parse('upcast always')).toEqual({ intent: 'upcast', policy: 'always' });
    expect(parse('upcast never')).toEqual({ intent: 'upcast', policy: 'never' });
    expect(parse('upcast')).toEqual({ intent: 'upcast', policy: 'auto' });
  });

  it('traps and items', () => {
    expect(parse('search for traps')).toEqual({ intent: 'search_traps' });
    expect(parse('disarm trap')).toEqual({ intent: 'disarm_trap' });
    expect(parse('drink healing potion')).toEqual({ intent: 'use_item', arg: 'healing potion' });
    expect(parse('use potion on Mira')).toEqual({ intent: 'use_item', arg: 'potion on mira' });
    expect(parse('inventory')).toEqual({ intent: 'inventory' });
    expect(parse('summon an owlbear!')).toEqual({ intent: 'summon', monster: 'an owlbear' });
  });

  it('equipment', () => {
    expect(parse('equip the longsword')).toEqual({ intent: 'equip', item: 'longsword' });
    expect(parse('wield shield on borin')).toEqual({ intent: 'equip', item: 'shield', member: 'borin' });
    expect(parse('unequip armor')).toEqual({ intent: 'unequip', arg: 'armor' });
    expect(parse('loadout')).toEqual({ intent: 'gear' });
    expect(parse('gear')).toEqual({ intent: 'gear' });
    expect(parse('pack')).toEqual({ intent: 'inventory' });
  });
});

describe('parseDMCommandRegex — town, quests, travel, camps, npcs', () => {
  it('quests', () => {
    expect(parse('quests')).toEqual({ intent: 'quests' });
    expect(parse('accept quest 2')).toEqual({ intent: 'accept_quest', index: 2 });
    expect(parse('take the job')).toEqual({ intent: 'accept_quest' });
    expect(parse('turn in')).toEqual({ intent: 'turn_in_quest' });
    expect(parse('claim reward')).toEqual({ intent: 'turn_in_quest' });
  });

  it('board tasks are distinct from quests', () => {
    expect(parse('tasks')).toEqual({ intent: 'tasks' });
    expect(parse('check the bulletin board')).toEqual({ intent: 'tasks' });
    expect(parse('any odd jobs')).toEqual({ intent: 'tasks' });
    expect(parse('accept task 2')).toEqual({ intent: 'accept_task', index: 2 });
    expect(parse('take on the notice')).toEqual({ intent: 'accept_task' });
    // The quest board is still its own thing.
    expect(parse('quests')).toEqual({ intent: 'quests' });
    expect(parse('accept quest 1')).toEqual({ intent: 'accept_quest', index: 1 });
  });

  it('town and commerce', () => {
    expect(parse('depart')).toEqual({ intent: 'depart_town' });
    expect(parse('go to town')).toEqual({ intent: 'go_to_town' });
    expect(parse('shop')).toEqual({ intent: 'shop' });
    expect(parse('buy healing potion')).toEqual({ intent: 'buy', item: 'healing potion' });
    expect(parse('sell rations')).toEqual({ intent: 'sell', item: 'rations' });
    expect(parse('climb out')).toEqual({ intent: 'leave_dungeon' });
    expect(parse('delve')).toEqual({ intent: 'enter_dungeon' });
    expect(parse('travel to Emberwatch')).toEqual({ intent: 'travel_to', destination: 'emberwatch' });
  });

  it('camps and townsfolk', () => {
    expect(parse('raid camp')).toEqual({ intent: 'raid_camp' });
    expect(parse('storm the camp')).toEqual({ intent: 'raid_camp' });
    expect(parse('report to constable')).toEqual({ intent: 'report_camp' });
    expect(parse('list clues')).toEqual({ intent: 'list_clues' });
    expect(parse('talk to Thalen')).toEqual({ intent: 'talk_to', npc: 'thalen' });
    expect(parse('chat with dax rumblefoot')).toEqual({ intent: 'talk_to', npc: 'dax rumblefoot' });
    expect(parse("who's here")).toEqual({ intent: 'list_npcs' });
  });

  it('specific trap phrases beat the generic look branch', () => {
    expect(parse('look for traps')).toEqual({ intent: 'search_traps' });
    expect(parse('check for traps')).toEqual({ intent: 'search_traps' });
    expect(parse('look')).toEqual({ intent: 'look' });
    expect(parse('hunt the goblins on the road')).toEqual({ intent: 'stance', stance: 'aggressive' });
  });

  it('camp phrases beat the generic camp / report words', () => {
    expect(parse('attack camp')).toEqual({ intent: 'raid_camp' });
    expect(parse('raid the camp')).toEqual({ intent: 'raid_camp' });
    expect(parse('storm their bandit camp')).toEqual({ intent: 'raid_camp' });
    expect(parse('attack the hideout')).toEqual({ intent: 'raid_camp' });
    expect(parse('report camp')).toEqual({ intent: 'report_camp' });
    expect(parse('report the bandit camp')).toEqual({ intent: 'report_camp' });
    expect(parse('show camp clues')).toEqual({ intent: 'list_clues' });
    // The plain words still mean what they always did.
    expect(parse('camp')).toEqual({ intent: 'long_rest' });
    expect(parse('report')).toEqual({ intent: 'report' });
  });

  it('falls through to unknown', () => {
    expect(parse('what a lovely day for a stroll')).toEqual({ intent: 'unknown' });
    expect(parse('asdf qwer')).toEqual({ intent: 'unknown' });
  });
});

describe('room features', () => {
  it('depend on the current room and are skipped in combat', () => {
    expect(parse('pray at the altar', { featureKind: 'altar' })).toEqual({ intent: 'feature_altar' });
    expect(parse('pray at the altar', { featureKind: null })).toEqual({ intent: 'unknown' });
    expect(parse('pray at the altar', { featureKind: 'altar', inCombat: true })).toEqual({ intent: 'unknown' });
    expect(parse('loot the vault', { featureKind: 'vault' })).toEqual({ intent: 'feature_vault' });
    expect(parse('loot the vault', { featureKind: 'throne' })).toEqual({ intent: 'inventory' });
    expect(parse('search the room')).toEqual({ intent: 'search_room' });
    expect(parse('search', { featureKind: 'forge' })).toEqual({ intent: 'feature_inspect' });
    expect(parse('search for traps', { featureKind: 'trapped_corridor' })).toEqual({ intent: 'search_traps' });
    expect(parse('check the corridor', { featureKind: 'trapped_corridor' })).toEqual({ intent: 'feature_trapped_search' });
    // "examine" is claimed by the look branch before features get a turn.
    expect(parse('examine the corridor', { featureKind: 'trapped_corridor' })).toEqual({ intent: 'look' });
    expect(parse('defuse it', { featureKind: 'trapped_corridor' })).toEqual({ intent: 'feature_trapped_disarm' });
    expect(parse('open the chest', { featureKind: 'chest' })).toEqual({ intent: 'feature_chest' });
    expect(parse('force the lid', { featureKind: 'chest' })).toEqual({ intent: 'feature_chest' });
    expect(parse('open the chest', { featureKind: 'altar' })).toEqual({ intent: 'unknown' });
    expect(parse('rob him blind', { featureKind: 'merchant_camp' })).toEqual({ intent: 'feature_merchant_rob' });
    // "merchant" is a talk word, so "rob the merchant" is a greeting. Quirk kept.
    expect(parse('rob the merchant', { featureKind: 'merchant_camp' })).toEqual({ intent: 'feature_merchant_talk' });
    expect(parse('talk to the merchant', { featureKind: 'merchant_camp' })).toEqual({ intent: 'feature_merchant_talk' });
    expect(parseFeatureIntent('sit', 'throne')).toEqual({ intent: 'feature_throne' });
    expect(parseFeatureIntent('sit', 'altar')).toBeNull();
  });

  it('intentAllowed gates feature intents on context', () => {
    expect(intentAllowed('feature_altar', ctx({ featureKind: 'altar' }))).toBe(true);
    expect(intentAllowed('feature_altar', ctx({ featureKind: 'vault' }))).toBe(false);
    expect(intentAllowed('feature_altar', ctx({ featureKind: 'altar', inCombat: true }))).toBe(false);
    expect(intentAllowed('feature_inspect', ctx({ featureKind: null }))).toBe(false);
    expect(intentAllowed('search_room', ctx({ mode: 'town' }))).toBe(false);
    expect(intentAllowed('move', ctx({ inCombat: true }))).toBe(true);
  });
});

describe('INTENTS', () => {
  it('is unique and ends with unknown', () => {
    expect(new Set(INTENTS).size).toBe(INTENTS.length);
    expect(INTENTS[INTENTS.length - 1]).toBe('unknown');
  });
});

describe('extractSlots (model path)', () => {
  it('fills relaxed slots from original text', () => {
    expect(extractSlots('move', 'could everyone please push northward', ctx())).toEqual({ intent: 'move', direction: Direction.Up });
    expect(extractSlots('move', 'onward and inward', ctx())).toBeNull();
    expect(extractSlots('summon', 'call forth a Young Red Dragon!', ctx())).toEqual({ intent: 'summon', monster: 'young red dragon' });
    expect(extractSlots('talk_to', 'go see the innkeeper', ctx())).toEqual({ intent: 'talk_to', npc: 'innkeeper' });
    expect(extractSlots('travel_to', 'set course for Silverbark', ctx())).toEqual({ intent: 'travel_to', destination: 'silverbark' });
    expect(extractSlots('buy', 'purchase two rations', ctx())).toEqual({ intent: 'buy', item: 'two rations' });
    expect(extractSlots('accept_quest', 'take the second contract, number 2', ctx())).toEqual({ intent: 'accept_quest', index: 2 });
    expect(extractSlots('stance', "don't fight anything, stay quiet", ctx())).toEqual({ intent: 'stance', stance: 'cautious' });
    expect(extractSlots('short_rest', 'take five', ctx())).toEqual({ intent: 'short_rest' });
  });
});

describe('understand', () => {
  const stub = (intent: any, prob: number, margin = 0.5) => ({ threshold: 0.6, predict: () => ({ intent, prob, margin }) });

  it('is regex-only without a model', () => {
    expect(understand('go north', ctx(), null)).toEqual({ cmd: { intent: 'move', direction: Direction.Up }, source: 'regex' });
    expect(understand('blah', ctx(), null)).toEqual({ cmd: { intent: 'unknown' }, source: 'none' });
  });

  it('lets a confident model override a non-structured regex match', () => {
    const r = understand('look for traps', ctx(), stub('search_traps', 0.95));
    expect(r).toEqual({ cmd: { intent: 'search_traps' }, source: 'model', prob: 0.95 });
  });

  it('never overrides structured intents', () => {
    const r = understand('roll 2d6', ctx(), stub('move', 0.99));
    expect(r.source).toBe('regex');
    expect(r.cmd.intent).toBe('roll');
  });

  it('falls back on low confidence, small margin, gates, or missing slots', () => {
    expect(understand('everyone push north', ctx(), stub('move', 0.5)).source).toBe('none');
    expect(understand('everyone push north', ctx(), stub('move', 0.9, 0.05)).source).toBe('none');
    expect(understand('kneel', ctx({ featureKind: 'vault' }), stub('feature_altar', 0.99)).source).toBe('none');
    expect(understand('conjure', ctx(), stub('summon', 0.99)).source).toBe('none');
    expect(understand('blah', ctx(), stub('unknown', 0.99)).source).toBe('none');
  });
});

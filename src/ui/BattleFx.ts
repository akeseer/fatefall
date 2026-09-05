/**
 * What a combat log line looks like on the battlefield.
 *
 * The engine narrates every turn in prose, and the battle window has always
 * read that prose back to decide what to draw: a lunge for a strike, a pop
 * for damage. This module is that reading, made whole and pure: one line in,
 * a list of effects out, each naming who did it, to whom, and what kind of
 * thing it was (a fire spell, a rage, a miss, a kill, a condition landing),
 * so the window can draw the right thing and play the right sound without
 * either of them knowing the engine's sentences.
 *
 * Elements come from the spell table's damage strings, so a new spell with
 * `damage: '2d6 cold'` is drawn cold without anyone touching this file. The
 * actor and target names are returned as text; the window resolves them to
 * stands, since only it knows who is on the field.
 */

import { SPELLS } from '../data/gameData';
import { COMBAT_ABILITIES } from '../combat/Abilities';

export type Element =
  | 'fire' | 'cold' | 'lightning' | 'thunder' | 'necrotic' | 'radiant' | 'force' | 'psychic' | 'poison' | 'acid' | 'arcane' | 'heal';

export type FxKind =
  /** A spell leaves the caster: `element` colours it, `projectile` sends a bolt, `aoe` washes the field. */
  | 'cast'
  /** A class ability fires: `ability` names which. */
  | 'ability'
  /** An attack finds nothing. */
  | 'miss'
  /** Someone is dead, or a hero is down and dying. */
  | 'kill' | 'down'
  /** A condition lands on the target: `condition` names it. */
  | 'condition'
  /** A boss does something legendary, or its presence lands. */
  | 'legendary'
  /** A monster's special attack (breath, gaze, venom). */
  | 'special'
  /** A potion drunk or a scroll read. */
  | 'potion' | 'scroll'
  /** A buff or ward on an ally: bless, shield, haste, invisibility. */
  | 'buff';

export interface FxEvent {
  kind: FxKind;
  actor?: string;
  target?: string;
  element?: Element;
  spell?: string;
  /** A skill id from the ability table, or one of the older names the window draws by hand. */
  ability?: string;
  condition?: 'poisoned' | 'stunned' | 'frightened' | 'held' | 'asleep' | 'entangled' | 'slowed' | 'cursed' | 'blinded';
  buff?: 'bless' | 'shield' | 'haste' | 'invisible' | 'aid' | 'sanctuary' | 'faerie_fire';
  projectile?: boolean;
  aoe?: boolean;
}

/** Element colours, shared by every effect that has one. */
export const ELEMENT_COLORS: Record<Element, string> = {
  fire: '#ff8a3c', cold: '#8fd8ff', lightning: '#fff08a', thunder: '#c8a8ff',
  necrotic: '#9a6adf', radiant: '#fff2b8', force: '#b0c8ff', psychic: '#ff8ac8',
  poison: '#8ae06a', acid: '#c8ee4a', arcane: '#c8a8ff', heal: '#7fe0a8',
};

/** Spells that travel as a bolt rather than bloom on the target. */
const PROJECTILE_SPELLS = new Set([
  'fire bolt', 'eldritch blast', 'magic missile', 'ray of frost', 'scorching ray', 'chromatic orb',
  'guiding bolt', 'witch bolt', 'acid splash', 'produce flame', 'thorn whip', 'chill touch', 'sacred flame',
]);

/** Spells that fill the field rather than one target. */
const AOE_SPELLS = new Set([
  'fireball', 'lightning bolt', 'thunderwave', 'shatter', 'cone of cold', 'burning hands', 'sleep',
  'call lightning', 'spirit guardians', 'stinking cloud', 'hypnotic pattern', 'darkness', 'entangle',
  'web', 'moonbeam', 'blight', 'word of radiance', 'faerie fire',
]);

const BUFF_SPELLS: Record<string, NonNullable<FxEvent['buff']>> = {
  bless: 'bless', shield: 'shield', 'shield of faith': 'shield', haste: 'haste', invisibility: 'invisible',
  'greater invisibility': 'invisible', aid: 'aid', sanctuary: 'sanctuary', 'faerie fire': 'faerie_fire',
  'mirror image': 'shield', 'armor of agathys': 'shield', guidance: 'aid', resistance: 'aid',
};

const CONDITION_SPELLS: Record<string, NonNullable<FxEvent['condition']>> = {
  'hold person': 'held', sleep: 'asleep', entangle: 'entangled', web: 'entangled', slow: 'slowed',
  'bestow curse': 'cursed', hex: 'cursed', 'hypnotic pattern': 'stunned', 'stinking cloud': 'poisoned',
  darkness: 'blinded', 'vicious mockery': 'cursed',
};

const HEAL_SPELLS = new Set(['cure wounds', 'healing word', 'spare the dying', 'prayer of healing', 'mass healing word', 'heal']);

/** The element a spell's damage string names, or null for a spell that does no damage. */
export function elementOfSpell(name: string): Element | null {
  const key = name.trim().toLowerCase();
  if (HEAL_SPELLS.has(key)) return 'heal';
  const spell = SPELLS.find(s => s.name.toLowerCase() === key);
  const words = (spell?.damage ?? '').toLowerCase().split(/\s+/);
  for (const w of words) {
    if (w in ELEMENT_COLORS && w !== 'heal' && w !== 'arcane') return w as Element;
  }
  if (spell?.damage) return 'force';
  if (spell) return 'arcane';
  return null;
}

/** Strip the emoji and marks the engine prefixes a line with. */
function bare(line: string): string {
  return line.replace(/^[\s☀-⟿\u{1F300}-\u{1FAFF}️‍—–!\-]+/u, '').trim();
}

/** The events in one line of the combat log. Usually zero or one; a kill line can be two. */
export function classifyFx(line: string): FxEvent[] {
  const text = bare(line);
  const out: FxEvent[] = [];

  // Spells: "X casts Spell on Y" / "X casts Spell — ..." / "X casts Spell!"
  const cast = /^(.{2,60}?) (?:casts|upcasts) ([\w' ]+?)(?:\s+on\s+(.{2,60}?))?(?:!|\.|\s+—|\s+into|\s+-|$)/u.exec(text);
  if (cast) {
    const spell = cast[2].trim();
    const key = spell.toLowerCase();
    const element = elementOfSpell(spell) ?? 'arcane';
    const ev: FxEvent = {
      kind: 'cast', actor: cast[1].trim(), target: cast[3]?.trim(), spell, element,
      projectile: PROJECTILE_SPELLS.has(key), aoe: AOE_SPELLS.has(key),
    };
    out.push(ev);
    if (BUFF_SPELLS[key]) out.push({ kind: 'buff', actor: ev.actor, target: ev.target ?? ev.actor, buff: BUFF_SPELLS[key], spell });
    if (CONDITION_SPELLS[key] && ev.target) out.push({ kind: 'condition', actor: ev.actor, target: ev.target, condition: CONDITION_SPELLS[key], spell });
    return out;
  }

  // Abilities, by the engine's own phrasing.
  let m: RegExpExecArray | null;
  if ((m = /^(.{2,60}?) enters a Rage/i.exec(text))) return [{ kind: 'ability', actor: m[1], ability: 'rage' }];
  if ((m = /^(.{2,60}?) (?:marks|curses with a crimson rite|hexes) (.{2,60}?) —/u.exec(text))) {
    return [{ kind: 'ability', actor: m[1], target: m[2], ability: /crimson/.test(text) ? 'blood_mite' : /hexes/.test(text) ? 'eldritch_hex' : 'hunters_mark' }];
  }
  if ((m = /^(.{2,60}?) smites (.{2,60}?) —/u.exec(text))) return [{ kind: 'ability', actor: m[1], target: m[2], ability: 'divine_smite', element: 'radiant' }];
  if ((m = /^(.{2,60}?) channels divinity/i.exec(text))) return [{ kind: 'ability', actor: m[1], ability: 'channel_divinity', element: 'radiant', aoe: true }];
  if ((m = /^(.{2,60}?) lets loose a Chaos Surge — raw magic leaps between (.{2,80}?)!/u.exec(text))) {
    return [{ kind: 'ability', actor: m[1], ability: 'chaos_surge', element: 'force', target: m[2].split(' and ')[0] }];
  }
  if ((m = /^(.{2,60}?) takes a Wild Shape/.exec(text))) return [{ kind: 'ability', actor: m[1], ability: 'wild_shape' }];
  // "X uses Skill!" / "X uses Skill on Y!" / "X uses Skill — ...": any skill in the table, by name.
  if ((m = /^(.{2,60}?) uses ([\w'’ ]+?)(?:\s+on\s+(.{2,60}?))?(?:!|\.|\s+—|$)/u.exec(text))) {
    const name = m[2].trim().toLowerCase();
    const skill = COMBAT_ABILITIES.find(a => a.name.toLowerCase() === name);
    if (skill) {
      const legacy: Record<string, string> = { second_wind: 'second_wind', flurry_of_blows: 'flurry', arcane_jolt: 'arcane_jolt', hunters_mark: 'hunters_mark', blood_mite: 'blood_mite', arcane_recovery: 'arcane_recovery', bardic_inspiration: 'bardic_inspiration' };
      return [{ kind: 'ability', actor: m[1], target: m[3]?.trim(), ability: legacy[skill.id] ?? skill.id, element: skill.element as FxEvent['element'], aoe: skill.effect === 'burst' && !skill.burst?.targets }];
    }
  }
  if ((m = /^Sneak Attack! (.{2,60}?) finds the gaps/i.exec(text))) return [{ kind: 'ability', actor: m[1], ability: 'sneak_attack' }];
  if (/^The infused strike cracks/i.test(text)) return [{ kind: 'ability', ability: 'arcane_jolt' }];

  // Misses.
  if ((m = /^(.{2,60}?) misses (.{2,60}?)\.?$/.exec(text))) return [{ kind: 'miss', actor: m[1], target: m[2] }];

  // Deaths and falls.
  if ((m = /^(.{2,60}?) is slain!?/.exec(text))) return [{ kind: 'kill', target: m[1] }];
  if ((m = /^(.{2,60}?) (?:succumbs to their wounds and dies|dies)!?/.exec(text))) return [{ kind: 'kill', target: m[1] }];
  if ((m = /^(.{2,60}?) has fallen and begins making death saves/.exec(text))) return [{ kind: 'down', target: m[1] }];
  if ((m = /^(.{2,60}?) slumps to the stone, unconscious/.exec(text))) return [{ kind: 'condition', target: m[1], condition: 'asleep' }];

  // Bosses.
  if (/^(.{2,60}?) is a legendary foe/.test(text) || /^A terrifying presence crushes down/.test(text)) return [{ kind: 'legendary' }];
  if ((m = /^(.{2,60}?) (?:lashes out —|fixes its ire on) (.{2,60}?)(?:!|\.|\s+—)/u.exec(text))) return [{ kind: 'legendary', actor: m[1], target: m[2] }];
  if ((m = /^(.{2,60}?) burns a legendary resistance/.exec(text))) return [{ kind: 'buff', actor: m[1], target: m[1], buff: 'shield' }];

  // Monster specials and the conditions they leave.
  if ((m = /^(.{2,60}?)'s (.{2,50}?) chills (.{2,60}?)'s soul/.exec(text))) return [{ kind: 'special', actor: m[1], target: m[3], element: 'necrotic' }];
  if ((m = /^(.{2,60}?) (?:is poisoned|is stunned|is frightened|is paralyzed|is restrained|is blinded|falls asleep)/.exec(text))) {
    const cond: FxEvent['condition'] = /poisoned/.test(text) ? 'poisoned' : /stunned|paralyzed/.test(text) ? 'stunned' : /frightened/.test(text) ? 'frightened' : /restrained/.test(text) ? 'entangled' : /blinded/.test(text) ? 'blinded' : 'asleep';
    return [{ kind: 'condition', target: m[1], condition: cond }];
  }

  // Consumables.
  if ((m = /^(.{2,60}?) drinks /.exec(text))) return [{ kind: 'potion', actor: m[1], target: m[1] }];
  if ((m = /^(.{2,60}?) (?:reads|unrolls) /.exec(text))) return [{ kind: 'scroll', actor: m[1] }];

  return out;
}

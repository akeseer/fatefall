/**
 * Class skills: what a hero can do in a fight besides swing and cast.
 *
 * Every class has a ladder of three or four skills, unlocked by level, and a
 * resource to pay for them: mana for the casters, stamina for the soldiers,
 * ki for the monk, focus for the rogue and ranger, and the blood hunter's own
 * blood, which is hit points. A skill costs some of the pool and may put
 * itself on a cooldown of a few rounds; the pool refills a little every round
 * and fully on a rest. The rogue's Sneak Attack stays a passive that rides
 * their advantaged strikes.
 *
 * The engine resolves skills by their `effect`; the data here only says what
 * each costs, when it unlocks, and how hard it hits. The battle window reads
 * the same table for the menu, the resource bar and the effects it draws.
 */

import type { ConditionId } from '../rules/Rules';

export type ResourceKind = 'mana' | 'stamina' | 'ki' | 'focus' | 'blood';

/** Which pool each class draws on. */
export const CLASS_RESOURCE: Record<string, ResourceKind> = {
  fighter: 'stamina', barbarian: 'stamina', paladin: 'mana', ranger: 'focus', rogue: 'focus', monk: 'ki',
  wizard: 'mana', sorcerer: 'mana', warlock: 'mana', bard: 'mana', cleric: 'mana', druid: 'mana',
  artificer: 'mana', blood_hunter: 'blood',
};

export const RESOURCE_LABEL: Record<ResourceKind, string> = { mana: 'Mana', stamina: 'Stamina', ki: 'Ki', focus: 'Focus', blood: 'Blood' };
export const RESOURCE_COLOR: Record<ResourceKind, string> = { mana: '#6f9fd8', stamina: '#d08a4a', ki: '#6fc4b8', focus: '#9a93a8', blood: '#c4483f' };

export function resourceKindOf(classId: string): ResourceKind {
  return CLASS_RESOURCE[classId] ?? 'stamina';
}

/** The size of a hero's pool at a level. Blood is hit points and has no pool of its own. */
export function resourceMax(classId: string, level: number): number {
  switch (resourceKindOf(classId)) {
    case 'mana': return 10 + 4 * level;
    case 'stamina': return 6 + 2 * level;
    case 'ki': return 3 + level;
    case 'focus': return 5 + level;
    case 'blood': return 0;
  }
}

/** How much of the pool comes back at the top of each round. */
export function resourceRegen(kind: ResourceKind): number {
  switch (kind) {
    case 'mana': return 2;
    case 'stamina': return 2;
    case 'ki': return 1;
    case 'focus': return 1;
    case 'blood': return 0;
  }
}

export type AbilityEffect =
  /** A weapon strike with bonus dice; MARK_ABILITIES lay a mark instead of striking. */
  | 'attack'
  /** Mend the user. */
  | 'heal'
  /** Mend the most hurt living ally (or the user). */
  | 'heal_ally'
  /** Mend everyone standing. */
  | 'heal_all'
  /** A timed fury: bonus damage for some rounds. */
  | 'rage'
  /** Damage dice on every foe, or the nearest few. */
  | 'burst'
  /** A burst on one foe that also mends the user by the damage dealt. */
  | 'drain'
  /** A spent spell slot returns. */
  | 'recover'
  /** The party is blessed for some rounds. */
  | 'inspire'
  /** A condition laid on the user, for some rounds. */
  | 'ward';

export interface CombatAbility {
  id: string;
  name: string;
  /** Which class gets it. */
  classId: string;
  /** Level at which it appears on the menu. */
  minLevel: number;
  /** What it costs from the class's pool. Blood hunters pay in hit points. */
  cost: number;
  /** Rounds before it can be used again; 0 for none. */
  cooldown: number;
  /** One-line description for menus and tooltips. */
  description: string;
  effect?: AbilityEffect;
  /** Colours the effect and its sound. */
  element?: 'fire' | 'cold' | 'lightning' | 'thunder' | 'necrotic' | 'radiant' | 'force' | 'psychic' | 'poison' | 'acid' | 'arcane' | 'heal';
  /** Damage dice granted on top of the weapon attack roll, or rolled by a burst. */
  bonusDamageDice?: (level: number) => { count: number; size: number };
  /** Healing dice. */
  healDice?: (level: number) => { count: number; size: number };
  /** Self-buff while a fury is active, or the rounds an inspiration lasts. */
  buff?: { meleeAttackBonus?: number; damageBonus?: number; rounds: number };
  /** For 'burst' and 'drain': how many foes it reaches (all when unset) and which types take double. */
  burst?: { targets?: number; doubleAgainst?: string[] };
  /** For 'ward': the condition laid on the user. */
  ward?: { condition: ConditionId; rounds: number; name: string };
  /** For 'attack': strikes this many times. */
  strikes?: number;
  /** A passive with no activation; shown but never chosen. */
  passive?: boolean;
}

const d = (count: number, size: number) => () => ({ count, size });
const scaling = (base: number, per: number, size: number) => (level: number) => ({ count: base + Math.floor(level / per), size });

export const COMBAT_ABILITIES: CombatAbility[] = [
  // ── Fighter: stamina ──
  { id: 'power_strike', name: 'Power Strike', classId: 'fighter', minLevel: 1, cost: 2, cooldown: 0,
    description: 'Put your weight behind the blow: +1d8 damage.', effect: 'attack', bonusDamageDice: scaling(1, 6, 8) },
  { id: 'second_wind', name: 'Second Wind', classId: 'fighter', minLevel: 1, cost: 3, cooldown: 3,
    description: 'Catch your breath mid-fight: recover 1d10 + level HP.', effect: 'heal', element: 'heal', healDice: d(1, 10) },
  { id: 'action_surge', name: 'Action Surge', classId: 'fighter', minLevel: 3, cost: 4, cooldown: 4,
    description: 'A burst of effort: two weapon attacks in one turn.', effect: 'attack', strikes: 2 },
  { id: 'cleave', name: 'Cleave', classId: 'fighter', minLevel: 6, cost: 5, cooldown: 2,
    description: 'One great arc: 2d8 slashing to the three nearest foes.', effect: 'burst', bonusDamageDice: scaling(2, 8, 8), burst: { targets: 3 } },

  // ── Barbarian: stamina ──
  { id: 'reckless_strike', name: 'Reckless Strike', classId: 'barbarian', minLevel: 1, cost: 2, cooldown: 0,
    description: 'Swing without a thought for your guard: +1d10 damage.', effect: 'attack', bonusDamageDice: scaling(1, 7, 10) },
  { id: 'rage', name: 'Rage', classId: 'barbarian', minLevel: 1, cost: 4, cooldown: 5,
    description: 'Enter a fury: +2 damage on every blow for 3 rounds.', effect: 'rage', buff: { meleeAttackBonus: 0, damageBonus: 2, rounds: 3 } },
  { id: 'frenzy', name: 'Frenzy', classId: 'barbarian', minLevel: 4, cost: 4, cooldown: 3,
    description: 'Two savage attacks in one turn.', effect: 'attack', strikes: 2 },
  { id: 'earthshaker', name: 'Earthshaker', classId: 'barbarian', minLevel: 7, cost: 6, cooldown: 3,
    description: 'Bring your weapon down on the ground: 2d6 thunder to every foe.', effect: 'burst', element: 'thunder', bonusDamageDice: scaling(2, 8, 6) },

  // ── Monk: ki ──
  { id: 'flurry_of_blows', name: 'Flurry of Blows', classId: 'monk', minLevel: 1, cost: 1, cooldown: 0,
    description: 'Strike twice in one motion.', effect: 'attack', strikes: 2 },
  { id: 'stunning_strike', name: 'Stunning Strike', classId: 'monk', minLevel: 3, cost: 2, cooldown: 2,
    description: 'A blow to the nerve: +2d6 damage and the foe reels.', effect: 'attack', element: 'force', bonusDamageDice: scaling(2, 8, 6) },
  { id: 'patient_defense', name: 'Patient Defense', classId: 'monk', minLevel: 4, cost: 2, cooldown: 3,
    description: 'Flow around every blow: attacks against you have disadvantage for 2 rounds.', effect: 'ward', ward: { condition: 'invisible', rounds: 2, name: 'Patient Defense' } },
  { id: 'ki_wave', name: 'Ki Wave', classId: 'monk', minLevel: 6, cost: 3, cooldown: 3,
    description: 'A ring of force from the palm: 2d6 to every foe.', effect: 'burst', element: 'force', bonusDamageDice: scaling(2, 8, 6) },

  // ── Rogue: focus ──
  { id: 'sneak_attack', name: 'Sneak Attack', classId: 'rogue', minLevel: 1, cost: 0, cooldown: 0, passive: true,
    description: 'Striking with advantage adds bonus dice — the blade finds the gaps.' },
  { id: 'cunning_strike', name: 'Cunning Strike', classId: 'rogue', minLevel: 1, cost: 2, cooldown: 0,
    description: 'A feint and a thrust: +1d6 damage.', effect: 'attack', bonusDamageDice: scaling(1, 6, 6) },
  { id: 'vanish', name: 'Vanish', classId: 'rogue', minLevel: 3, cost: 3, cooldown: 4,
    description: 'Step into the shadows: attacks against you have disadvantage for 2 rounds.', effect: 'ward', ward: { condition: 'invisible', rounds: 2, name: 'Vanished' } },
  { id: 'poisoned_blade', name: 'Poisoned Blade', classId: 'rogue', minLevel: 5, cost: 3, cooldown: 2,
    description: 'A blade drawn through venom: +2d6 poison damage.', effect: 'attack', element: 'poison', bonusDamageDice: scaling(2, 8, 6) },

  // ── Ranger: focus ──
  { id: 'hunters_mark', name: "Hunter's Mark", classId: 'ranger', minLevel: 1, cost: 2, cooldown: 0,
    description: 'Mark your quarry: +1d6 damage on every hit against it, 3 rounds.', effect: 'attack', bonusDamageDice: d(1, 6) },
  { id: 'volley', name: 'Volley', classId: 'ranger', minLevel: 3, cost: 3, cooldown: 2,
    description: 'Arrows for everyone: 1d8 piercing to the two nearest foes.', effect: 'burst', bonusDamageDice: scaling(1, 5, 8), burst: { targets: 2 } },
  { id: 'ensnaring_shot', name: 'Ensnaring Shot', classId: 'ranger', minLevel: 5, cost: 3, cooldown: 3,
    description: 'A thorned shaft: +2d8 damage.', effect: 'attack', element: 'poison', bonusDamageDice: scaling(2, 8, 8) },

  // ── Paladin: mana ──
  { id: 'lay_on_hands', name: 'Lay on Hands', classId: 'paladin', minLevel: 1, cost: 3, cooldown: 1,
    description: 'Healing touch: mend the most hurt ally for 2d8 + level.', effect: 'heal_ally', element: 'heal', healDice: d(2, 8) },
  { id: 'divine_smite', name: 'Divine Smite', classId: 'paladin', minLevel: 1, cost: 4, cooldown: 0,
    description: 'Pour holy power into a strike: +2d8 radiant, +1d8 more against undead and fiends.', effect: 'attack', element: 'radiant', bonusDamageDice: scaling(2, 9, 8) },
  { id: 'aura_of_courage', name: 'Aura of Courage', classId: 'paladin', minLevel: 4, cost: 5, cooldown: 4,
    description: 'Your certainty steadies every blade: the party gains +1d4 on attack rolls for 3 rounds.', effect: 'inspire', buff: { rounds: 3 } },
  { id: 'holy_burst', name: 'Holy Burst', classId: 'paladin', minLevel: 7, cost: 7, cooldown: 3,
    description: 'Radiance breaks from your shield: 2d8 to every foe, double to the unholy.', effect: 'burst', element: 'radiant', bonusDamageDice: scaling(2, 9, 8), burst: { doubleAgainst: ['undead', 'fiend'] } },

  // ── Cleric: mana ──
  { id: 'healing_touch', name: 'Healing Touch', classId: 'cleric', minLevel: 1, cost: 3, cooldown: 0,
    description: 'Mend the most hurt ally for 1d8 + level.', effect: 'heal_ally', element: 'heal', healDice: d(1, 8) },
  { id: 'sacred_hammer', name: 'Sacred Hammer', classId: 'cleric', minLevel: 1, cost: 2, cooldown: 0,
    description: 'A hammer of light falls on one foe: 1d8 radiant.', effect: 'burst', element: 'radiant', bonusDamageDice: scaling(1, 5, 8), burst: { targets: 1 } },
  { id: 'channel_divinity', name: 'Channel Divinity', classId: 'cleric', minLevel: 3, cost: 6, cooldown: 3,
    description: 'A burst of radiance scours every foe for 1d8; the undead take double.', effect: 'burst', element: 'radiant', bonusDamageDice: scaling(1, 5, 8), burst: { doubleAgainst: ['undead', 'fiend'] } },
  { id: 'mass_heal', name: 'Prayer of Healing', classId: 'cleric', minLevel: 6, cost: 8, cooldown: 4,
    description: 'Mend everyone standing for 1d8 + level.', effect: 'heal_all', element: 'heal', healDice: d(1, 8) },

  // ── Wizard: mana ──
  { id: 'arcane_bolt', name: 'Arcane Bolt', classId: 'wizard', minLevel: 1, cost: 2, cooldown: 0,
    description: 'A lance of force at one foe: 2d6.', effect: 'burst', element: 'force', bonusDamageDice: scaling(2, 6, 6), burst: { targets: 1 } },
  { id: 'arcane_recovery', name: 'Arcane Recovery', classId: 'wizard', minLevel: 3, cost: 0, cooldown: 5,
    description: 'Draw on study to recover an expended spell slot.', effect: 'recover' },
  { id: 'frost_nova', name: 'Frost Nova', classId: 'wizard', minLevel: 5, cost: 6, cooldown: 3,
    description: 'Cold bursts outward: 2d6 to every foe.', effect: 'burst', element: 'cold', bonusDamageDice: scaling(2, 7, 6) },
  { id: 'arcane_ward', name: 'Arcane Ward', classId: 'wizard', minLevel: 7, cost: 5, cooldown: 4,
    description: 'A shimmering ward: attacks against you have disadvantage for 2 rounds.', effect: 'ward', element: 'arcane', ward: { condition: 'invisible', rounds: 2, name: 'Arcane Ward' } },

  // ── Sorcerer: mana ──
  { id: 'chaos_bolt', name: 'Chaos Bolt', classId: 'sorcerer', minLevel: 1, cost: 2, cooldown: 0,
    description: 'Unstable magic at one foe: 2d8 force.', effect: 'burst', element: 'force', bonusDamageDice: scaling(2, 9, 8), burst: { targets: 1 } },
  { id: 'chaos_surge', name: 'Chaos Surge', classId: 'sorcerer', minLevel: 3, cost: 5, cooldown: 2,
    description: 'Raw magic leaps to two foes for 2d8 force each.', effect: 'burst', element: 'force', bonusDamageDice: scaling(2, 9, 8), burst: { targets: 2 } },
  { id: 'wild_recovery', name: 'Font of Magic', classId: 'sorcerer', minLevel: 5, cost: 0, cooldown: 5,
    description: 'Burn raw power for a spent spell slot.', effect: 'recover' },
  { id: 'meteor_shower', name: 'Meteor Shower', classId: 'sorcerer', minLevel: 7, cost: 9, cooldown: 4,
    description: 'Stones of fire fall on every foe: 3d6.', effect: 'burst', element: 'fire', bonusDamageDice: scaling(3, 9, 6) },

  // ── Warlock: mana ──
  { id: 'eldritch_hex', name: 'Eldritch Hex', classId: 'warlock', minLevel: 1, cost: 2, cooldown: 0,
    description: 'Hex a foe: every hit against it bites for +1d6 necrotic while the hex holds (5 rounds).', effect: 'attack', element: 'necrotic', bonusDamageDice: scaling(1, 9, 6) },
  { id: 'eldritch_volley', name: 'Eldritch Volley', classId: 'warlock', minLevel: 3, cost: 4, cooldown: 1,
    description: 'Beams of force at the two nearest foes: 1d10 each.', effect: 'burst', element: 'force', bonusDamageDice: scaling(1, 5, 10), burst: { targets: 2 } },
  { id: 'dark_bargain', name: 'Dark Bargain', classId: 'warlock', minLevel: 5, cost: 5, cooldown: 3,
    description: 'Drain one foe for 2d8 necrotic and mend yourself by what it loses.', effect: 'drain', element: 'necrotic', bonusDamageDice: scaling(2, 9, 8), burst: { targets: 1 } },
  { id: 'hellish_rebuke', name: 'Hellish Rebuke', classId: 'warlock', minLevel: 7, cost: 7, cooldown: 3,
    description: 'Hellfire for every foe: 2d10.', effect: 'burst', element: 'fire', bonusDamageDice: scaling(2, 9, 10) },

  // ── Bard: mana ──
  { id: 'bardic_inspiration', name: 'Bardic Inspiration', classId: 'bard', minLevel: 1, cost: 4, cooldown: 3,
    description: 'A rousing verse: the party gains +1d4 on attack rolls for 3 rounds.', effect: 'inspire', buff: { rounds: 3 } },
  { id: 'cutting_words', name: 'Cutting Words', classId: 'bard', minLevel: 1, cost: 2, cooldown: 0,
    description: 'A barb that draws blood: 1d6 psychic to one foe.', effect: 'burst', element: 'psychic', bonusDamageDice: scaling(1, 5, 6), burst: { targets: 1 } },
  { id: 'song_of_rest', name: 'Song of Rest', classId: 'bard', minLevel: 4, cost: 6, cooldown: 4,
    description: 'A gentle air: everyone standing mends 1d6 + level.', effect: 'heal_all', element: 'heal', healDice: d(1, 6) },
  { id: 'dissonant_whispers', name: 'Dissonant Whispers', classId: 'bard', minLevel: 7, cost: 7, cooldown: 3,
    description: 'A discord every foe hears: 2d6 psychic.', effect: 'burst', element: 'psychic', bonusDamageDice: scaling(2, 8, 6) },

  // ── Druid: mana ──
  { id: 'thorn_lash', name: 'Thorn Lash', classId: 'druid', minLevel: 1, cost: 2, cooldown: 0,
    description: 'A whip of briar at one foe: 1d10.', effect: 'burst', element: 'poison', bonusDamageDice: scaling(1, 6, 10), burst: { targets: 1 } },
  { id: 'wild_shape', name: 'Wild Shape', classId: 'druid', minLevel: 2, cost: 4, cooldown: 4,
    description: 'Take a beast’s form: mend 2 HP per level and strike for +2 damage for 3 rounds.', effect: 'rage', buff: { meleeAttackBonus: 0, damageBonus: 2, rounds: 3 }, healDice: (level) => ({ count: Math.max(1, level), size: 2 }) },
  { id: 'healing_rain', name: 'Healing Rain', classId: 'druid', minLevel: 5, cost: 6, cooldown: 4,
    description: 'Soft rain on the party: everyone standing mends 1d6 + level.', effect: 'heal_all', element: 'heal', healDice: d(1, 6) },
  { id: 'call_lightning', name: 'Call Lightning', classId: 'druid', minLevel: 7, cost: 7, cooldown: 3,
    description: 'The sky answers: 2d8 lightning to every foe.', effect: 'burst', element: 'lightning', bonusDamageDice: scaling(2, 9, 8) },

  // ── Artificer: mana ──
  { id: 'arcane_jolt', name: 'Arcane Jolt', classId: 'artificer', minLevel: 1, cost: 2, cooldown: 0,
    description: 'Channel a spark of infused magic into your strike: +1d6 force.', effect: 'attack', element: 'force', bonusDamageDice: scaling(1, 9, 6) },
  { id: 'flash_bomb', name: 'Flash Bomb', classId: 'artificer', minLevel: 3, cost: 4, cooldown: 2,
    description: 'A thrown alchemical charge: 2d6 fire to the two nearest foes.', effect: 'burst', element: 'fire', bonusDamageDice: scaling(2, 8, 6), burst: { targets: 2 } },
  { id: 'field_repair', name: 'Field Repair', classId: 'artificer', minLevel: 5, cost: 4, cooldown: 1,
    description: 'Mend the most hurt ally for 1d8 + level.', effect: 'heal_ally', element: 'heal', healDice: d(1, 8) },
  { id: 'lightning_launcher', name: 'Lightning Launcher', classId: 'artificer', minLevel: 7, cost: 7, cooldown: 3,
    description: 'The launcher discharges into every foe: 2d6 lightning.', effect: 'burst', element: 'lightning', bonusDamageDice: scaling(2, 8, 6) },

  // ── Blood Hunter: blood (hit points) ──
  { id: 'crimson_rite', name: 'Crimson Rite', classId: 'blood_hunter', minLevel: 1, cost: 2, cooldown: 0,
    description: 'Cut your own palm to set the blade alight: +1d6 damage.', effect: 'attack', element: 'fire', bonusDamageDice: scaling(1, 6, 6) },
  { id: 'blood_mite', name: 'Blood Mite', classId: 'blood_hunter', minLevel: 1, cost: 3, cooldown: 0,
    description: 'Pay in blood to curse a foe: your strikes against it sear with crimson rite damage.', effect: 'attack', bonusDamageDice: (level) => ({ count: Math.max(1, Math.floor(level / 5) + 1), size: 6 }) },
  { id: 'blood_curse_of_binding', name: 'Blood Curse of the Marked', classId: 'blood_hunter', minLevel: 4, cost: 4, cooldown: 3,
    description: 'Your blood calls to theirs: 1d8 necrotic to every foe, and you mend by a share of it.', effect: 'drain', element: 'necrotic', bonusDamageDice: scaling(1, 6, 8) },
  { id: 'exsanguinate', name: 'Exsanguinate', classId: 'blood_hunter', minLevel: 7, cost: 6, cooldown: 3,
    description: 'Open a foe entirely: +3d8 necrotic on the strike.', effect: 'attack', element: 'necrotic', bonusDamageDice: scaling(3, 9, 8) },
];

/** Abilities that lay a lasting mark on one foe rather than striking it. */
export const MARK_ABILITIES = new Set(['hunters_mark', 'blood_mite', 'eldritch_hex']);

/** Every skill a class has unlocked at a level, active ones only, in unlock order. */
export function getAbilitiesForClass(classId: string, level: number): CombatAbility[] {
  return COMBAT_ABILITIES
    .filter(a => a.classId === classId && a.minLevel <= level && !a.passive && a.effect !== undefined)
    .sort((a, b) => a.minLevel - b.minLevel);
}

/** The class's signature skill at a level: the newest it has unlocked. Passives count for the rogue. */
export function getAbilityForClass(classId: string, level: number): CombatAbility | null {
  const active = getAbilitiesForClass(classId, level);
  if (active.length > 0) return active[active.length - 1];
  return COMBAT_ABILITIES.find(a => a.classId === classId && a.minLevel <= level) ?? null;
}

export function getAbilityById(id: string): CombatAbility | undefined {
  return COMBAT_ABILITIES.find(a => a.id === id);
}

/** Sneak Attack bonus dice by rogue level (1 at 1st, +1 every odd level after). */
export function sneakAttackDice(level: number): number {
  return Math.max(1, Math.ceil(level / 2));
}

/** True when the hero has an active ability they could use right now. */
export function hasAbilityFor(classId: string, level: number): boolean {
  return getAbilitiesForClass(classId, level).length > 0;
}

/** What a skill costs, as text for a menu. */
export function costLabel(a: CombatAbility): string {
  if (a.cost === 0) return 'free';
  const kind = resourceKindOf(a.classId);
  return kind === 'blood' ? `${a.cost} HP` : `${a.cost} ${RESOURCE_LABEL[kind].toLowerCase()}`;
}

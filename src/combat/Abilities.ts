/**
 * Combat abilities — class skills that give martial heroes a decision space
 * beyond "swing sword" (and casters a reason to hold slots).
 *
 * Active abilities are real engine commands (`{ type: 'ability' }`) with uses
 * tracked per short rest on the character. Sneak Attack is a passive that
 * rewards the flanking game: when the rogue strikes with advantage, the blade
 * finds the gaps for bonus dice.
 */

export interface CombatAbility {
  id: string;
  name: string;
  /** Which class gets it. */
  classId: string;
  /** Uses per short rest; scale by level where noted. */
  usesPerRest: (level: number) => number;
  /** One-line description for menus and tooltips. */
  description: string;
  /** Dice damage added on top of the weapon strike (passive or rider). */
  bonusDamage?: string;
  /**
   * Effects that resolve when activated. 'attack' strikes (with the id
   * deciding rider or mark); 'heal' mends the user; 'rage' is a timed fury;
   * 'burst' hits every foe; 'recover' gives back a spell slot; 'inspire'
   * blesses the party.
   */
  effect?: 'attack' | 'heal' | 'rage' | 'burst' | 'recover' | 'inspire';
  /** For 'burst': the damage type, and how many foes it reaches (all when unset). */
  burst?: { element: 'radiant' | 'force' | 'fire' | 'cold' | 'lightning'; targets?: number; doubleAgainst?: string[] };
  /** Damage dice granted on top of the weapon attack roll. */
  bonusDamageDice?: (level: number) => { count: number; size: number };
  /** Flat healing, scaled by level. */
  healDice?: (level: number) => { count: number; size: number };
  /** Self-buff while the ability is active. */
  buff?: {
    meleeAttackBonus?: number;
    damageBonus?: number;
    /** Rounds before the fury burns out, after which exhaustion follows. */
    rounds: number;
  };
  /** Minimum level to unlock (scaling abilities arrive later). */
  minLevel?: number;
}

export const COMBAT_ABILITIES: CombatAbility[] = [
  {
    id: 'second_wind',
    name: 'Second Wind',
    classId: 'fighter',
    usesPerRest: () => 1,
    description: 'Catch your breath mid-fight: recover 1d10 + level HP.',
    effect: 'heal',
    healDice: (level) => ({ count: 1, size: 10 }),
    minLevel: 1,
  },
  {
    id: 'rage',
    name: 'Rage',
    classId: 'barbarian',
    usesPerRest: (level) => (level >= 3 ? 3 : level >= 1 ? 2 : 1),
    description: 'Enter a fury: +2 melee damage, advantage-granting resistance to blows. 3 rounds.',
    effect: 'rage',
    buff: { meleeAttackBonus: 0, damageBonus: 2, rounds: 3 },
    minLevel: 1,
  },
  {
    id: 'flurry_of_blows',
    name: 'Flurry of Blows',
    classId: 'monk',
    usesPerRest: (level) => (level >= 5 ? 3 : 2),
    description: 'Strike twice in one motion: one extra weapon attack this turn.',
    effect: 'attack',
    minLevel: 2,
  },
  {
    id: 'hunters_mark',
    name: "Hunter's Mark",
    classId: 'ranger',
    usesPerRest: () => 2,
    description: 'Mark your quarry: +1d6 damage on every hit against it, 3 rounds.',
    effect: 'attack',
    bonusDamageDice: () => ({ count: 1, size: 6 }),
    minLevel: 1,
  },
  {
    id: 'sneak_attack',
    name: 'Sneak Attack',
    classId: 'rogue',
    usesPerRest: () => Infinity, // passive — tracked separately
    description: 'Striking with advantage adds bonus damage dice — the blade finds the gaps.',
    minLevel: 1,
  },
  {
    id: 'arcane_jolt',
    name: 'Arcane Jolt',
    classId: 'artificer',
    usesPerRest: (level) => (level >= 9 ? 3 : 2),
    description: 'Channel a spark of infused magic into your strike: extra force damage.',
    effect: 'attack',
    bonusDamageDice: (level) => ({ count: level >= 9 ? 2 : 1, size: 6 }),
    minLevel: 2,
  },
  {
    id: 'blood_mite',
    name: 'Blood Mite',
    classId: 'blood_hunter',
    usesPerRest: (level) => Math.max(1, Math.floor(level / 4)),
    description: 'Pay in blood to curse a foe: your strikes against it sear with crimson rite damage.',
    effect: 'attack',
    bonusDamageDice: (level) => ({ count: Math.max(1, Math.floor(level / 5) + 1), size: 6 }),
    minLevel: 1,
  },
];

// ── The other seven classes ──

COMBAT_ABILITIES.push(
  {
    id: 'divine_smite',
    name: 'Divine Smite',
    classId: 'paladin',
    usesPerRest: (level) => (level >= 5 ? 3 : 2),
    description: 'Pour holy power into a strike: +2d8 radiant, +1d8 more against undead and fiends.',
    effect: 'attack',
    bonusDamageDice: (level) => ({ count: level >= 9 ? 3 : 2, size: 8 }),
    minLevel: 1,
  },
  {
    id: 'channel_divinity',
    name: 'Channel Divinity',
    classId: 'cleric',
    usesPerRest: (level) => (level >= 6 ? 2 : 1),
    description: 'A burst of radiance scours every foe for 1d8; the undead take double.',
    effect: 'burst',
    bonusDamageDice: (level) => ({ count: level >= 5 ? 2 : 1, size: 8 }),
    burst: { element: 'radiant', doubleAgainst: ['undead', 'fiend'] },
    minLevel: 1,
  },
  {
    id: 'arcane_recovery',
    name: 'Arcane Recovery',
    classId: 'wizard',
    usesPerRest: () => 1,
    description: 'Draw on study to recover an expended spell slot mid-fight.',
    effect: 'recover',
    minLevel: 1,
  },
  {
    id: 'wild_shape',
    name: 'Wild Shape',
    classId: 'druid',
    usesPerRest: () => 2,
    description: 'Take a beast\u2019s form: mend 2 HP per level and strike for +2 damage for 3 rounds.',
    effect: 'rage',
    buff: { meleeAttackBonus: 0, damageBonus: 2, rounds: 3 },
    healDice: (level) => ({ count: Math.max(1, level), size: 2 }),
    minLevel: 2,
  },
  {
    id: 'bardic_inspiration',
    name: 'Bardic Inspiration',
    classId: 'bard',
    usesPerRest: (level) => (level >= 5 ? 3 : 2),
    description: 'A rousing verse: the party gains +1d4 on attack rolls for 3 rounds.',
    effect: 'inspire',
    buff: { rounds: 3 },
    minLevel: 1,
  },
  {
    id: 'chaos_surge',
    name: 'Chaos Surge',
    classId: 'sorcerer',
    usesPerRest: (level) => (level >= 5 ? 3 : 2),
    description: 'Raw magic leaps to two foes for 2d8 force damage each.',
    effect: 'burst',
    bonusDamageDice: (level) => ({ count: level >= 9 ? 3 : 2, size: 8 }),
    burst: { element: 'force', targets: 2 },
    minLevel: 1,
  },
  {
    id: 'eldritch_hex',
    name: 'Eldritch Hex',
    classId: 'warlock',
    usesPerRest: () => 2,
    description: 'Hex a foe: every hit against it bites for +1d6 necrotic while the hex holds (5 rounds).',
    effect: 'attack',
    bonusDamageDice: (level) => ({ count: level >= 9 ? 2 : 1, size: 6 }),
    minLevel: 1,
  },
);

/** Abilities that lay a lasting mark on one foe rather than striking it. */
export const MARK_ABILITIES = new Set(['hunters_mark', 'blood_mite', 'eldritch_hex']);

/** Look up the active (non-passive) ability for a class, if any. */
export function getAbilityForClass(classId: string, level: number): CombatAbility | null {
  return COMBAT_ABILITIES.find(a => a.classId === classId && (a.minLevel ?? 1) <= level) ?? null;
}

/** Sneak Attack bonus dice by rogue level (1 at 1st, +1 every odd level after). */
export function sneakAttackDice(level: number): number {
  return Math.max(1, Math.ceil(level / 2));
}

/** True when the hero has an active ability they could use right now. */
export function hasAbilityFor(classId: string, level: number): boolean {
  const a = getAbilityForClass(classId, level);
  return a !== null && a.effect !== undefined;
}

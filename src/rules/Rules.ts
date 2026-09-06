import { Ability, abilityModifier, rollDice } from '../data/gameData';
import { pushDiceRoll } from './DiceEvents';

/**
 * Active rules layer — turns compendium rules into mechanics:
 * saving throws, conditions with real combat effects, concentration,
 * and rest recovery (short/long).
 */

// ── Conditions ───────────────────────────────────────

/** All fifteen 5e conditions (exhaustion is tracked separately). */
export type ConditionId =
  | 'blinded'
  | 'charmed'
  | 'deafened'
  | 'frightened'
  | 'grappled'
  | 'incapacitated'
  | 'invisible'
  | 'paralyzed'
  | 'petrified'
  | 'poisoned'
  | 'prone'
  | 'restrained'
  | 'stunned'
  | 'unconscious';

export interface ActiveCondition {
  id: ConditionId;
  name: string;
  turnsLeft: number;
  /** Who applied it — used to end effects when concentration breaks. */
  sourceId?: string;
}

export interface ConditionLike {
  name: string;
  conditions: ActiveCondition[];
}

export const CONDITION_META: Record<ConditionId, { label: string; color: string; effect: string }> = {
  blinded: { label: 'Blinded', color: '#cc8', effect: 'Attacks have disadvantage; attacks against you have advantage.' },
  charmed: { label: 'Charmed', color: '#f6c', effect: 'Cannot attack the charmer; the charmer has advantage against you.' },
  deafened: { label: 'Deafened', color: '#9a9', effect: 'Cannot hear — initiative rolls are made at disadvantage.' },
  frightened: { label: 'Frightened', color: '#c66', effect: 'Attacks have disadvantage while the source of fear is in sight.' },
  grappled: { label: 'Grappled', color: '#ba8', effect: 'Speed is 0 — held fast and unable to move.' },
  incapacitated: { label: 'Incapacitated', color: '#c9c', effect: 'Cannot take actions — you lose your turn.' },
  invisible: { label: 'Invisible', color: '#6cf', effect: 'Advantage on attacks; attacks against you have disadvantage.' },
  paralyzed: { label: 'Paralyzed', color: '#8cf', effect: 'You lose your turn; melee hits auto-crit and you auto-fail STR/DEX saves.' },
  petrified: { label: 'Petrified', color: '#aa9', effect: 'Turned to stone — turn lost, attackers have advantage, auto-fail STR/DEX saves.' },
  poisoned: { label: 'Poisoned', color: '#5a5', effect: 'Attacks have disadvantage.' },
  prone: { label: 'Prone', color: '#c97', effect: 'Attacks have disadvantage; attackers have advantage against you.' },
  restrained: { label: 'Restrained', color: '#a6a', effect: 'Speed 0; attacks at disadvantage; attackers have advantage.' },
  stunned: { label: 'Stunned', color: '#fa0', effect: 'You lose your turn; attackers have advantage.' },
  unconscious: { label: 'Unconscious', color: '#99f', effect: 'You lose your turn; melee hits auto-crit.' },
};

/** Conditions that completely prevent acting on your turn. */
const INCAPACITATING: ConditionId[] = ['paralyzed', 'unconscious', 'stunned', 'incapacitated', 'petrified'];

export function hasCondition(entity: ConditionLike, id: ConditionId): boolean {
  return entity.conditions.some(c => c.id === id);
}

export function applyCondition(entity: ConditionLike, cond: ActiveCondition): boolean {
  const existing = entity.conditions.find(c => c.id === cond.id);
  if (existing) {
    existing.turnsLeft = Math.max(existing.turnsLeft, cond.turnsLeft);
    return false;
  }
  entity.conditions.push({ ...cond });
  return true;
}

export function removeCondition(entity: ConditionLike, id: ConditionId): boolean {
  const idx = entity.conditions.findIndex(c => c.id === id);
  if (idx >= 0) {
    entity.conditions.splice(idx, 1);
    return true;
  }
  return false;
}

/** Remove every condition applied by a given source (concentration ended). */
export function removeConditionsFromSource(entity: ConditionLike, sourceId: string): boolean {
  const before = entity.conditions.length;
  entity.conditions = entity.conditions.filter(c => c.sourceId !== sourceId);
  return entity.conditions.length !== before;
}

/** Decrement durations at the start of the entity's turn; returns expired names. */
export function tickConditions(entity: ConditionLike): string[] {
  const expired: string[] = [];
  entity.conditions = entity.conditions.filter(c => {
    c.turnsLeft--;
    if (c.turnsLeft <= 0) {
      expired.push(c.name);
      return false;
    }
    return true;
  });
  return expired;
}

export function incapacityMessage(entity: ConditionLike): string | null {
  const blocking = entity.conditions.find(c => INCAPACITATING.includes(c.id));
  return blocking ? `${entity.name} cannot act (${blocking.name})!` : null;
}

// ── Dice & saves ─────────────────────────────────────

export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function rollWithDisadvantage(): number {
  return Math.min(rollD20(), rollD20());
}

export function rollWithAdvantage(): number {
  return Math.max(rollD20(), rollD20());
}

export function proficiencyBonus(level: number): number {
  return 2 + Math.floor((level - 1) / 4);
}

export interface SaveResult {
  success: boolean;
  natural: number;
  total: number;
  dc: number;
  /** True when a legendary resistance was burned to force this success. */
  legendaryResisted?: boolean;
}

export function savingThrow(mod: number, dc: number, opts?: { disadvantage?: boolean; label?: string; naturalOverride?: number }): SaveResult {
  const rolls = [rollD20()];
  if (opts?.disadvantage) rolls.push(rollD20());
  // A fated Luck die replaces the roll entirely — fate needs no dice.
  const natural = opts?.naturalOverride ?? (opts?.disadvantage ? Math.min(...rolls) : rolls[0]);
  if (opts?.naturalOverride !== undefined) rolls.length = 0, rolls.push(opts.naturalOverride);
  const total = natural + mod;
  let success = total >= dc;
  if (natural === 20) success = true;
  if (natural === 1) success = false;

  pushDiceRoll({
    kind: 'save',
    diceType: 'd20',
    label: `${opts?.label ?? 'Saving throw'} vs DC ${dc}`,
    expression: `${opts?.naturalOverride !== undefined ? 'd20 (fated)' : opts?.disadvantage ? '2d20-low' : 'd20'}${mod >= 0 ? '+' : ''}${mod}`,
    rolls,
    total,
    outcome: natural === 20 ? 'crit' : natural === 1 ? 'fumble' : success ? 'success' : 'failure',
  });
  return { success, natural, total, dc };
}

/**
 * An ability check outside combat: Stealth past a sleeper, Athletics up a
 * wall, Persuasion at a parley. Same die, same crit and fumble rules, logged
 * as a check so the tray shows it as one.
 */
export function abilityCheck(mod: number, dc: number, label: string): SaveResult {
  const natural = rollD20();
  const total = natural + mod;
  let success = total >= dc;
  if (natural === 20) success = true;
  if (natural === 1) success = false;
  pushDiceRoll({
    kind: 'check',
    diceType: 'd20',
    label: `${label} vs DC ${dc}`,
    expression: `d20${mod >= 0 ? '+' : ''}${mod}`,
    rolls: [natural],
    total,
    outcome: natural === 20 ? 'crit' : natural === 1 ? 'fumble' : success ? 'success' : 'failure',
  });
  return { success, natural, total, dc };
}

// ── Death saves & exhaustion ────────────────────────

export const DEATH_SAVE_DC = 10;

/** 5e exhaustion levels — level 6 is fatal. */
export const EXHAUSTION_EFFECTS: Record<number, string> = {
  0: 'No penalty',
  1: 'Disadvantage on ability checks',
  2: 'Speed halved',
  3: 'Disadvantage on attack rolls and saving throws',
  4: 'Hit point maximum halved',
  5: 'Speed reduced to 0',
  6: 'Death',
};

// ── Attack modifiers from conditions ──────────────────

export interface AttackOpts {
  advantage?: boolean;
  disadvantage?: boolean;
  /** e.g. bless +1d4 to the attack roll. */
  attackRollBonus?: number;
  /** e.g. a Giant Strength potion adding weight to every blow. */
  damageBonus?: number;
}

/**
 * Resolve how attacker/defender conditions modify an attack (full 5e table):
 * - Poisoned/blinded/restrained/frightened/prone attackers roll at disadvantage.
 * - Restrained/blinded/unconscious/prone/petrified defenders are easier to hit.
 * - Invisible attackers have advantage; invisible defenders are harder to hit.
 * - A charmed creature can't effectively strike its charmer.
 * - Paralyzed/unconscious defenders are hit automatically AND crit on melee.
 * - Advantage and disadvantage cancel (5e).
 */
export function getAttackModifiers(
  attacker: { id: string } & ConditionLike,
  defender: { id: string } & ConditionLike
): Required<Pick<AttackOpts, 'advantage' | 'disadvantage'>> & { autoCrit: boolean } {
  const has = (e: ConditionLike, id: ConditionId) => hasCondition(e, id);

  const attackerBlind = has(attacker, 'blinded');
  const attackerDebuff = ['poisoned', 'restrained', 'frightened', 'prone']
    .some(id => has(attacker, id as ConditionId));
  const defenderVulnerable = ['restrained', 'blinded', 'unconscious', 'prone', 'petrified']
    .some(id => has(defender, id as ConditionId));
  const defenderInvisible = has(defender, 'invisible');
  const attackerInvisible = has(attacker, 'invisible');
  const charmedByDefender = attacker.conditions.some(c => c.id === 'charmed' && c.sourceId === defender.id);
  const autoCrit = has(defender, 'paralyzed') || has(defender, 'unconscious');

  let advantage = attackerInvisible;
  let disadvantage = defenderInvisible || attackerBlind || attackerDebuff || charmedByDefender;
  if (defenderVulnerable && !attackerBlind) advantage = true;

  // Advantage and disadvantage cancel one another.
  if (advantage && disadvantage) {
    advantage = false;
    disadvantage = false;
  }

  return { advantage, disadvantage, autoCrit };
}

// ── Elemental damage vs creature types ─────────────────

/**
 * The classic D&D elemental interactions, keyed by damage element →
 * monster type → multiplier. Anything unlisted is ×1. Radiant sears the
 * unholy, fire turns dry plant-flesh to torchwood, thunder resonates
 * through constructs, and the dead simply do not care about venom.
 */
const ELEMENT_VS_TYPE: Record<string, Partial<Record<string, number>>> = {
  radiant: { undead: 1.5, fiend: 1.5, celestial: 0.5 },
  necrotic: { undead: 0.5, fiend: 0.5, celestial: 1.5 },
  fire: { plant: 1.5, elemental: 0.5 },
  cold: { ooze: 1.5, construct: 0.5 },
  thunder: { construct: 1.5, ooze: 0.5 },
  lightning: { ooze: 0.5, plant: 1.25 },
  poison: { undead: 0.5, construct: 0.5, fiend: 0.5 },
  psychic: { construct: 0.5, ooze: 1.5 },
};

export interface ElementalResult {
  mult: number;
  /** Short flavor line for the log, or null when unremarkable. */
  note: string | null;
}

/** Look up an elemental interaction. Pure and table-driven. */
export function elementalMultiplier(element: string | undefined, monsterType: string): ElementalResult {
  if (!element) return { mult: 1, note: null };
  const mult = ELEMENT_VS_TYPE[element]?.[monsterType] ?? 1;
  if (mult === 1) return { mult: 1, note: null };
  const note = mult > 1
    ? `${monsterType} suffers — ${element} damage surges!`
    : `${monsterType} shrugs off ${element} — damage diminished.`;
  return { mult, note };
}

// ── Monster special attacks ───────────────────────────

export interface MonsterSpecial {
  /** Any 5e condition the monster can impose — or 'drain' for necrotic life-drain. */
  kind: ConditionId | 'drain';
  dc: number;
  saveAbility: Ability;
  durationTurns: number;
  description: string;
}

/** Signature rider effects on hits, resolved as real saving throws. */
export const MONSTER_SPECIALS: Record<string, MonsterSpecial> = {
  ghoul: {
    kind: 'paralyzed',
    dc: 10,
    saveAbility: 'con',
    durationTurns: 2,
    description: 'paralyzing claws',
  },
  giant_spider: {
    kind: 'poisoned',
    dc: 11,
    saveAbility: 'con',
    durationTurns: 3,
    description: 'venomous bite',
  },
  drow_elite: {
    kind: 'poisoned',
    dc: 13,
    saveAbility: 'con',
    durationTurns: 2,
    description: 'coated crossbow bolts',
  },
  wight: {
    kind: 'drain',
    dc: 0,
    saveAbility: 'con',
    durationTurns: 0,
    description: 'life drain',
  },
  medusa_monster: {
    kind: 'petrified',
    dc: 14,
    saveAbility: 'con',
    durationTurns: 2,
    description: 'petrifying gaze',
  },
  minotaur: {
    kind: 'prone',
    dc: 14,
    saveAbility: 'str',
    durationTurns: 1,
    description: 'goring charge',
  },
  rakshasa_monster: {
    kind: 'charmed',
    dc: 17,
    saveAbility: 'wis',
    durationTurns: 2,
    description: 'hypnotic gaze',
  },
  mind_flayer: {
    kind: 'stunned',
    dc: 15,
    saveAbility: 'int',
    durationTurns: 1,
    description: 'mind blast',
  },
};

/** Frightful presence checked once at combat start (WIS save or frightened). */
export const FRIGHTFUL_PRESENCE_DC: Record<string, number> = {
  young_dragon: 13,
  young_white_dragon_monster: 13,
  adult_red_dragon_monster: 16,
  balor_monster: 17,
  horned_devil_monster: 14,
  banshee: 12,
  beholder: 12,
  storm_giant_monster: 14,
};

// ── Legendary & lair actions (boss fights) ───────────

/** Legendary actions a boss regains at the start of its turn (5e standard: 3). */
export const LEGENDARY_ACTIONS_PER_ROUND = 3;

export interface LegendaryActionDef {
  name: string;
  description: string;
  /** Legendary-action cost (1 unless noted, e.g. Wing Attack = 2). */
  cost?: number;
  /** Damage dice expression like '2d8'. */
  damage?: string;
  damageBonus?: number;
  /** When set, the target saves (half damage on success; condition only on failure). */
  saveAbility?: Ability;
  dc?: number;
  /** Condition imposed when the save fails (or always, if no save). */
  condition?: ConditionId;
  durationTurns?: number;
}

export interface LairActionDef {
  name: string;
  description: string;
  damage?: string;
  damageBonus?: number;
  saveAbility?: Ability;
  dc?: number;
  condition?: ConditionId;
  durationTurns?: number;
}

export interface BossKit {
  legendary: LegendaryActionDef[];
  /** Lair actions fire once per round while the boss is alive in its lair. */
  lair?: LairActionDef[];
  /** 5e legendary resistances: 1/day-uses that turn a failed save into a success. */
  legendaryResistances?: number;
}

/** Boss kits keyed by MonsterTemplate id. High-CR monsters fight like real 5e bosses. */
export const BOSS_KITS: Record<string, BossKit> = {
  // ── CR 21 · Lich ──
  lich: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Paralyzing Touch', description: 'a deathly cold hand', damage: '3d6', damageBonus: 3, saveAbility: 'con', dc: 18, condition: 'paralyzed', durationTurns: 2 },
      { name: 'Frightening Gaze', description: 'an unblinking stare', saveAbility: 'wis', dc: 18, condition: 'frightened', durationTurns: 2 },
      { name: 'Necrotic Bolt', description: 'a bolt of raw unlife', damage: '2d6', damageBonus: 3 },
    ],
    lair: [
      { name: 'Arcane Backlash', description: 'ancient wards flare with sickly green light', damage: '2d6', saveAbility: 'dex', dc: 16 },
      { name: 'Rising Dead', description: 'skeletal hands claw up from the flagstones', saveAbility: 'str', dc: 16, condition: 'restrained', durationTurns: 1 },
    ],
  },
  // ── CR 20 · Pit Fiend ──
  pit_fiend: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Bite', description: 'fangs dripping molten ichor', damage: '2d6', damageBonus: 6 },
      { name: 'Tail', description: 'a spiked tail whip', damage: '2d8', damageBonus: 6, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Hellfire Bolt', description: 'a searing bolt of infernal flame', damage: '3d6', saveAbility: 'dex', dc: 18 },
    ],
    lair: [
      { name: 'Infernal Flame', description: 'hellfire gouts from every crack in the floor', damage: '2d8', saveAbility: 'dex', dc: 18 },
      { name: 'Burning Coals', description: 'the ground beneath the party turns to smoldering coal', damage: '2d6', saveAbility: 'con', dc: 18 },
    ],
  },
  // ── CR 19 · Balor ──
  balor_monster: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Flame Sword', description: 'a whip of fire that cuts like a blade', damage: '2d8', damageBonus: 7 },
      { name: 'Whip', description: 'a lightning whip that cracks and pulls', damage: '2d6', damageBonus: 7, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Fire Lash', description: 'a tongue of Abyssal flame', damage: '3d6', saveAbility: 'dex', dc: 18 },
    ],
    lair: [
      { name: 'Abyssal Firestorm', description: 'the air itself ignites in a demonic blaze', damage: '2d8', saveAbility: 'dex', dc: 18 },
      { name: 'Demonic Tempest', description: 'a howling gale of cinders and spite', damage: '2d6', saveAbility: 'str', dc: 18 },
    ],
  },
  // ── CR 17 · Adult Red Dragon ──
  adult_red_dragon_monster: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'a massive tail that sweeps the chamber', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 19, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'beating wings that hurl the party backward', damage: '2d6', damageBonus: 8, cost: 2, saveAbility: 'str', dc: 19, condition: 'prone', durationTurns: 1 },
      { name: 'Searing Bite', description: 'teeth white-hot from the furnace gullet', damage: '2d8', damageBonus: 8 },
    ],
    lair: [
      { name: 'Volcanic Eruption', description: 'molten rock bursts through the floor', damage: '4d6', saveAbility: 'dex', dc: 17 },
      { name: 'Choking Ash', description: 'a cloud of blinding ash rolls through the lair', damage: '2d6', saveAbility: 'con', dc: 17 },
      { name: 'Ground Tremor', description: 'the volcanic ground shudders beneath the party', saveAbility: 'dex', dc: 17, condition: 'prone', durationTurns: 1 },
    ],
  },
  // ── CR 17 · Death Knight ──
  death_knight: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Doom Blade', description: 'a rune-etched sword sheathed in black fire', damage: '2d6', damageBonus: 5 },
      { name: 'Hellfire Orb', description: 'a sphere of hellfire hurled across the room', damage: '2d8', saveAbility: 'dex', dc: 17 },
      { name: 'Terrifying Gaze', description: 'a glare that promises a slow death', saveAbility: 'wis', dc: 17, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Hellfire Wave', description: 'a wave of black flame washes across the hall', damage: '2d8', saveAbility: 'dex', dc: 17 },
      { name: 'Shadow Chains', description: 'chains of darkness rattle up from the floor', saveAbility: 'str', dc: 17, condition: 'restrained', durationTurns: 1 },
    ],
  },
  // ── CR 17 · Dragon Turtle ──
  dragon_turtle: {
    legendaryResistances: 2,
    legendary: [
      { name: 'Bite', description: 'jaws that could swallow a rowboat', damage: '3d12', damageBonus: 6 },
      { name: 'Tail', description: 'a club-like tail', damage: '2d12', damageBonus: 6, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Steam Burst', description: 'a jet of scalding steam', damage: '2d8', saveAbility: 'con', dc: 18 },
    ],
    lair: [
      { name: 'Steam Vents', description: 'vents erupt with blistering steam', damage: '2d6', saveAbility: 'con', dc: 18 },
      { name: 'Tidal Surge', description: 'a surge of dark water sweeps the chamber', damage: '2d6', saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
    ],
  },
  // ── CR 16 · Marilith ──
  marilith_monster: {
    legendaryResistances: 2,
    legendary: [
      { name: 'Tail', description: 'a serpentine tail that coils and crushes', damage: '2d8', damageBonus: 7, saveAbility: 'str', dc: 19, condition: 'restrained', durationTurns: 1 },
      { name: 'Sword', description: 'a blade wielded with six-armed fury', damage: '1d8', damageBonus: 7 },
    ],
  },
  // ── CR 16 · Iron Golem ──
  iron_golem: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Slam', description: 'a fist of riveted iron', damage: '2d10', damageBonus: 6 },
      { name: 'Crushing Grasp', description: 'iron fingers that clamp shut', damage: '2d8', damageBonus: 6, saveAbility: 'str', dc: 17, condition: 'restrained', durationTurns: 1 },
    ],
  },
  // ── CR 15 · Purple Worm ──
  purple_worm: {
    legendaryResistances: 2,
    legendary: [
      { name: 'Bite', description: 'a maw ringed with crystalline teeth', damage: '3d8', damageBonus: 9 },
      { name: 'Tail', description: 'a stinger-tipped tail', damage: '3d6', damageBonus: 9, saveAbility: 'str', dc: 19, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Earthquake', description: 'the chamber heaves and cracks', damage: '2d8', saveAbility: 'dex', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Burrow Collapse', description: 'the ceiling rains stone', damage: '2d8', saveAbility: 'dex', dc: 18 },
    ],
  },
  // ── CR 14 · Ice Devil ──
  ice_devil: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Bite', description: 'mandibles cold as the grave', damage: '2d6', damageBonus: 7 },
      { name: 'Tail', description: 'a barbed tail', damage: '2d6', damageBonus: 7, saveAbility: 'str', dc: 17, condition: 'prone', durationTurns: 1 },
      { name: 'Freezing Mist', description: 'a breath of absolute cold', damage: '2d6', saveAbility: 'con', dc: 17 },
    ],
    lair: [
      { name: 'Frostbite Wind', description: 'a wind that freezes the marrow', damage: '2d6', saveAbility: 'con', dc: 17 },
      { name: 'Slick Ice', description: 'a sheet of black ice spreads beneath the party', saveAbility: 'dex', dc: 17, condition: 'prone', durationTurns: 1 },
    ],
  },
  // ── CR 13 · Beholder ──
  beholder: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Charm Ray', description: 'a violet eye ray', saveAbility: 'wis', dc: 16, condition: 'charmed', durationTurns: 2 },
      { name: 'Paralyzing Ray', description: 'a yellow eye ray', saveAbility: 'con', dc: 16, condition: 'paralyzed', durationTurns: 1 },
      { name: 'Fear Ray', description: 'a crimson eye ray', saveAbility: 'wis', dc: 16, condition: 'frightened', durationTurns: 2 },
      { name: 'Enervation Ray', description: 'a sickly green eye ray that drains life', damage: '2d6', damageBonus: 5 },
    ],
    lair: [
      { name: 'Rock Falls', description: 'chunks of ceiling stone crash down', damage: '3d6', saveAbility: 'dex', dc: 16 },
      { name: 'Grasping Stone', description: 'the stone floor sprouts clutching fingers', saveAbility: 'str', dc: 16, condition: 'restrained', durationTurns: 1 },
    ],
  },
  // ── CR 13 · Storm Giant ──
  storm_giant_monster: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Greatsword', description: 'a sword crackling with lightning', damage: '3d6', damageBonus: 7 },
      { name: 'Lightning Strike', description: 'a bolt of sky-fire called down', damage: '3d6', saveAbility: 'dex', dc: 17 },
    ],
    lair: [
      { name: 'Storm Winds', description: 'winds howl through the lair', damage: '2d6', saveAbility: 'str', dc: 17, condition: 'prone', durationTurns: 1 },
      { name: 'Lightning Lash', description: 'forked lightning dances across the floor', damage: '2d8', saveAbility: 'dex', dc: 17 },
    ],
  },
  // ── CR 13 · Rakshasa ──
  rakshasa_monster: {
    legendaryResistances: 2,
    legendary: [
      { name: 'Claw', description: 'curved tiger claws', damage: '1d8', damageBonus: 5 },
      { name: 'Enchanting Glare', description: 'amber eyes that bore into the mind', saveAbility: 'wis', dc: 17, condition: 'charmed', durationTurns: 2 },
      { name: 'Dark Whispers', description: 'a voice that plants fear', saveAbility: 'wis', dc: 17, condition: 'frightened', durationTurns: 2 },
    ],
  },
  // ── CR 13 · Vampire ──
  vampire: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Bite', description: 'fangs that drink deep', damage: '1d6', damageBonus: 4 },
      { name: 'Unarmed Strike', description: 'a blow with supernatural force', damage: '1d8', damageBonus: 4 },
      { name: 'Shadow Cloak', description: 'the vampire vanishes into living shadow', saveAbility: 'wis', dc: 17, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Grasping Shadows', description: 'shadows coil around the party like snakes', saveAbility: 'str', dc: 17, condition: 'restrained', durationTurns: 1 },
      { name: 'Swarm of Bats', description: 'a torrent of bats pours through the lair', damage: '2d6', saveAbility: 'dex', dc: 17 },
    ],
  },
  // ── CR 10-12 · young dragons & titans ──
  young_dragon: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Tail', description: 'a sweeping tail', damage: '2d8', damageBonus: 6, saveAbility: 'str', dc: 17, condition: 'prone', durationTurns: 1 },
      { name: 'Fire Lash', description: 'a jet of dragonfire', damage: '2d6', damageBonus: 6 },
    ],
  },
  stone_golem: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Slam', description: 'a fist of living rock', damage: '2d10', damageBonus: 6 },
      { name: 'Slow Gaze', description: 'a dulling gaze that saps strength', saveAbility: 'wis', dc: 17, condition: 'restrained', durationTurns: 1 },
    ],
  },
  roc: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Talons', description: 'great curving talons', damage: '2d6', damageBonus: 5, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Sweep', description: 'a thunderclap of wings', damage: '2d4', damageBonus: 5, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
    ],
  },
  remorhaz: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Bite', description: 'a furnace-hot bite', damage: '2d6', damageBonus: 7 },
      { name: 'Heat Burst', description: 'a blast of internal fire', damage: '2d6', saveAbility: 'con', dc: 17 },
    ],
  },
  erinyes_monster: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Sword', description: 'a flaming longsword', damage: '2d6', damageBonus: 5 },
      { name: 'Hellish Rebuke', description: 'a flare of hellfire in answer to every blow', damage: '3d6', saveAbility: 'dex', dc: 17 },
    ],
  },
  horned_devil_monster: {
    legendaryResistances: 1,
    legendary: [
      { name: 'Tail', description: 'a spiked tail', damage: '2d6', damageBonus: 6, saveAbility: 'str', dc: 17, condition: 'prone', durationTurns: 1 },
      { name: 'Hurl Flame', description: 'a glob of hellfire', damage: '3d6', saveAbility: 'dex', dc: 17 },
    ],
  },
  ancient_red_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'a tail that shatters stone', damage: '2d8', damageBonus: 9, saveAbility: 'str', dc: 22, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'great wings beat a gale of fire', damage: '2d6', damageBonus: 9, cost: 2, saveAbility: 'str', dc: 22, condition: 'prone', durationTurns: 1 },
      { name: 'Searing Bite', description: 'fangs glowing furnace-white', damage: '3d8', damageBonus: 9 },
      { name: 'Fire Roar', description: 'a throat of liquid flame', damage: '4d6', saveAbility: 'dex', dc: 22 },
    ],
    lair: [
      { name: 'Volcanic Upheaval', description: 'the mountain heaves, spraying cinders and magma', damage: '4d6', saveAbility: 'dex', dc: 21 },
      { name: 'Molten Geyser', description: 'a geyser of fresh lava bursts upward', damage: '5d6', saveAbility: 'dex', dc: 21 },
      { name: 'Sulfuric Gas', description: 'volcanic gases pool in the lair, choking the intruders', damage: '2d6', saveAbility: 'con', dc: 21 },
    ],
  },
  ancient_blue_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'a lightning-charged tail', damage: '2d8', damageBonus: 9, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'wings that crack with static', damage: '2d6', damageBonus: 9, cost: 2, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Lightning Bite', description: 'a bite arcing with blue fire', damage: '3d8', damageBonus: 9 },
      { name: 'Thunderclap', description: 'a thunderclap that deafens', damage: '3d6', damageBonus: 5, saveAbility: 'con', dc: 21 },
    ],
    lair: [
      { name: 'Lightning Storm', description: 'a fork of lightning stabs down from the storm', damage: '4d6', saveAbility: 'dex', dc: 20 },
      { name: 'Sand Blast', description: 'scouring sand whips through the lair', damage: '3d6', saveAbility: 'con', dc: 20 },
      { name: 'Static Charge', description: 'the air charges with static until the floor itself sparks', damage: '2d6', saveAbility: 'dex', dc: 20 },
    ],
  },
  ancient_green_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'a creeper-veiled tail', damage: '2d8', damageBonus: 9, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'wings that reek of rotten swamp', damage: '2d6', damageBonus: 9, cost: 2, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Bile Bite', description: 'a bite dripping sickly poison', damage: '3d8', damageBonus: 9 },
      { name: 'Corrosive Spit', description: 'a glob of acid the size of a cauldron', damage: '4d6', saveAbility: 'dex', dc: 21 },
    ],
    lair: [
      { name: 'Poison Miasma', description: 'swamp vapors thicken into choking fog', damage: '3d6', saveAbility: 'con', dc: 20 },
      { name: 'Verdant Grasp', description: 'roots burst through the floor to entangle', saveAbility: 'str', dc: 20, condition: 'restrained', durationTurns: 1 },
      { name: 'Thorned Thicket', description: 'thorned vines lash out across the lair floor', damage: '2d6', saveAbility: 'dex', dc: 20 },
    ],
  },
  ancient_black_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'a tail wreathed in viscous acid', damage: '2d8', damageBonus: 9, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'wings that drip black ichor', damage: '2d6', damageBonus: 9, cost: 2, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Acid Bite', description: 'jaws weeping green vitriol', damage: '3d8', damageBonus: 9 },
      { name: 'Vitriol Spray', description: 'a fan of acid', damage: '4d6', saveAbility: 'dex', dc: 21 },
    ],
    lair: [
      { name: 'Acid Rain', description: 'corrosive drips rain from the ceiling', damage: '3d6', saveAbility: 'dex', dc: 20 },
      { name: 'Sinkhole', description: 'the floor rots and splits beneath the party', saveAbility: 'dex', dc: 20, condition: 'prone', durationTurns: 1 },
      { name: 'Caustic Vapor', description: 'acid vapor pools in the low ground of the lair', damage: '2d6', saveAbility: 'con', dc: 20 },
    ],
  },
  ancient_white_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'a tail hard as glacial ice', damage: '2d8', damageBonus: 9, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'a gale of blinding snow', damage: '2d6', damageBonus: 9, cost: 2, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Frost Bite', description: 'fangs rimed with frost', damage: '3d8', damageBonus: 9 },
      { name: 'Cryeling Blast', description: 'a scream so cold it cracks metal', damage: '3d6', saveAbility: 'con', dc: 21 },
    ],
    lair: [
      { name: 'Blizzard', description: 'a howling blizzard rages through the lair', damage: '3d6', saveAbility: 'con', dc: 20 },
      { name: 'Slick Ice Sheet', description: 'a sheet of black ice forms beneath the party', saveAbility: 'dex', dc: 20, condition: 'prone', durationTurns: 1 },
      { name: 'Icicle Fall', description: 'frozen spears drop from the ceiling of the lair', damage: '3d6', saveAbility: 'dex', dc: 20 },
    ],
  },
  adult_blue_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'a crackling tail lash', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'wings that throw a gale of sand', damage: '2d6', damageBonus: 8, cost: 2, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Forked Bite', description: 'a bite coursing with blue fire', damage: '2d8', damageBonus: 8 },
    ],
    lair: [
      { name: 'Lightning Fork', description: 'two forks of lightning rake the lair', damage: '3d6', saveAbility: 'dex', dc: 17 },
      { name: 'Thunderous Rumble', description: 'a wall of thunder rolls through the lair', damage: '2d6', saveAbility: 'con', dc: 17 },
      { name: 'Sandstorm Gust', description: 'scouring sand whips through the lair', saveAbility: 'dex', dc: 17, condition: 'blinded', durationTurns: 1 },
    ],
  },
  adult_green_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'a swamp-choked tail', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'a stinking wing buffet', damage: '2d6', damageBonus: 8, cost: 2, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Venomous Bite', description: 'a bite that weeps bile', damage: '2d8', damageBonus: 8 },
    ],
    lair: [
      { name: 'Choking Miasma', description: 'rotten gas floods the lair', damage: '2d6', saveAbility: 'con', dc: 17 },
      { name: 'Lulling Drone', description: 'a droning song drifts through the lair', saveAbility: 'wis', dc: 17, condition: 'charmed', durationTurns: 1 },
      { name: 'Thorned Thicket', description: 'thorned vines lash out across the lair floor', damage: '2d6', saveAbility: 'dex', dc: 17 },
    ],
  },
  adult_black_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'an acid-rimed tail', damage: '2d8', damageBonus: 7, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'a reeking wing buffet', damage: '2d6', damageBonus: 7, cost: 2, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Acid Bite', description: 'corroding fangs', damage: '2d8', damageBonus: 7 },
    ],
    lair: [
      { name: 'Acid Drip', description: 'slime runs down the walls, hissing', damage: '2d6', saveAbility: 'dex', dc: 17 },
      { name: 'Caustic Vapor', description: 'acid vapor pools in the low ground of the lair', damage: '2d6', saveAbility: 'con', dc: 17 },
      { name: 'Floor Rot', description: 'the floor rots and splits beneath the party', saveAbility: 'dex', dc: 17, condition: 'prone', durationTurns: 1 },
    ],
  },
  adult_white_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tail', description: 'an ice-rimed tail', damage: '2d8', damageBonus: 7, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Wing Attack', description: 'a frosty wing buffet', damage: '2d6', damageBonus: 7, cost: 2, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Frost Bite', description: 'biting fangs', damage: '2d8', damageBonus: 7 },
    ],
    lair: [
      { name: 'Bitter Frost', description: 'the air flash-freezes', damage: '2d6', saveAbility: 'con', dc: 17 },
      { name: 'Icicle Fall', description: 'frozen spears drop from the ceiling of the lair', damage: '3d6', saveAbility: 'dex', dc: 17 },
      { name: 'Ice Sheet', description: 'a sheet of black ice forms beneath the party', saveAbility: 'dex', dc: 17, condition: 'prone', durationTurns: 1 },
    ],
  },
  tiamat_avatar: {
    legendaryResistances: 5,
    legendary: [
      { name: 'Crown of Five Heads', description: 'all five heads roar at once, each breath converging on the party', damage: '8d6', damageBonus: 9, saveAbility: 'dex', dc: 24 },
      { name: 'Wing Gust', description: 'five pairs of wings drive a hurricane', damage: '2d6', damageBonus: 9, cost: 2, saveAbility: 'str', dc: 24, condition: 'prone', durationTurns: 1 },
      { name: 'Biting Constellation', description: 'each head takes a separate bite', damage: '2d8', damageBonus: 9 },
    ],
    lair: [
      { name: 'Dragonstorm', description: 'the sky splits — fire, acid, frost, lightning and venom rain down', damage: '6d6', saveAbility: 'dex', dc: 23 },
      { name: 'Kobold Tide', description: 'a swarming horde of cultist-kobolds floods the lair', damage: '2d6', saveAbility: 'str', dc: 23 },
    ],
  },
  bahamut_aspect: {
    legendaryResistances: 5,
    legendary: [
      { name: 'Radiant Breath', description: 'a pillar of platinum light', damage: '6d6', damageBonus: 9, saveAbility: 'con', dc: 24 },
      { name: 'Wing of Judgment', description: 'a sweeping wing of sacred light', damage: '2d6', damageBonus: 9, cost: 2, saveAbility: 'str', dc: 24, condition: 'prone', durationTurns: 1 },
      { name: 'Smiting Bite', description: 'jaws gleaming like tempered steel', damage: '3d8', damageBonus: 9 },
    ],
    lair: [
      { name: 'Sacred Ground', description: 'the floor glows with hallowed light', damage: '3d6', saveAbility: 'con', dc: 23 },
      { name: 'Platinum Halo', description: 'a blinding ring of light', damage: '2d6', saveAbility: 'wis', dc: 23 },
    ],
  },
  demogorgon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tentacle', description: 'a grasping tentacle with a demonic face', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 23, condition: 'restrained', durationTurns: 1 },
      { name: 'Gaze of the Twin Kings', description: 'two maddening gazes lock onto the party', saveAbility: 'wis', dc: 23, condition: 'frightened', durationTurns: 2 },
      { name: 'Tail', description: 'a whip-crack tail', damage: '2d10', damageBonus: 8 },
    ],
    lair: [
      { name: 'Abyssal Madness', description: 'the Abyss howls through the chamber', damage: '3d6', saveAbility: 'int', dc: 22 },
      { name: 'Tentacle Storm', description: 'a hundred tentacles burst from the floor', saveAbility: 'str', dc: 22, condition: 'restrained', durationTurns: 1 },
    ],
  },
  orcus: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Wand of Orcus', description: 'a blast of negative energy from the wand', damage: '4d8', damageBonus: 8, saveAbility: 'con', dc: 23 },
      { name: 'Purple Gaze', description: 'a gaze promising a slow unmaking', saveAbility: 'wis', dc: 23, condition: 'frightened', durationTurns: 2 },
      { name: 'Tail', description: 'a spiked tail', damage: '2d8', damageBonus: 8 },
    ],
    lair: [
      { name: 'Rise, My Dead', description: 'a legion of the dead claws from the earth', damage: '3d6', saveAbility: 'str', dc: 22 },
      { name: 'Deathly Silence', description: 'a wave of silence swallows all sound', damage: '3d6', saveAbility: 'con', dc: 22 },
    ],
  },
  molydeus: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Wolf Bite', description: 'a bite from a maw that has eaten armies', damage: '2d10', damageBonus: 8 },
      { name: 'Viper Bite', description: 'the snake head strikes with venom', damage: '2d6', saveAbility: 'con', dc: 22, condition: 'poisoned', durationTurns: 2 },
      { name: 'Judge of the Abyss', description: 'a pronouncement of doom', damage: '3d6', saveAbility: 'wis', dc: 21, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Abyssal Verdict', description: 'the floor splits revealing a pit of souls', damage: '4d6', saveAbility: 'dex', dc: 21 },
      { name: 'Hunt of the Damned', description: 'phantasmal wolves charge through the lair', damage: '2d6', saveAbility: 'wis', dc: 21, condition: 'frightened', durationTurns: 2 },
    ],
  },
  asmodeus: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Ruby Sceptre', description: 'a blast of hellfire from the Ruby Rod', damage: '4d8', damageBonus: 8, saveAbility: 'dex', dc: 24 },
      { name: 'Lay Bare the Soul', description: 'a gaze that reads every sin', saveAbility: 'wis', dc: 24, condition: 'frightened', durationTurns: 2 },
      { name: 'Forge Contracts', description: 'chains of law bind the unruly', saveAbility: 'str', dc: 24, condition: 'restrained', durationTurns: 1 },
    ],
    lair: [
      { name: 'Ninth Circle', description: 'absolute cold grips the lair', damage: '4d6', saveAbility: 'con', dc: 23 },
      { name: 'Pact Binder', description: 'sigils blaze, demanding obedience', saveAbility: 'cha', dc: 23, condition: 'charmed', durationTurns: 2 },
    ],
  },
  zariel_boss: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Burning Greatsword', description: 'a sword stroke wreathed in infernal flame', damage: '3d8', damageBonus: 8 },
      { name: 'Wing of Avernus', description: 'a sweeping wing charred black', damage: '2d6', damageBonus: 8, cost: 2, saveAbility: 'str', dc: 23, condition: 'prone', durationTurns: 1 },
      { name: 'Hellfire Bolt', description: 'a bolt of Hellfire from Avernus', damage: '3d6', saveAbility: 'dex', dc: 21 },
    ],
    lair: [
      { name: 'Avernus Burns', description: 'the ground itself smolders with hellfire', damage: '3d6', saveAbility: 'dex', dc: 21 },
      { name: 'Warband Charge', description: 'a spectral legion charges through the lair', damage: '2d6', saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
    ],
  },
  lich_king: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Soul Shard', description: 'a shard of the phylactery-crown lashes out', damage: '3d8', damageBonus: 8, saveAbility: 'con', dc: 22 },
      { name: 'Word of the Crown', description: 'a royal command that wracks the spirit', saveAbility: 'wis', dc: 22, condition: 'frightened', durationTurns: 2 },
      { name: 'Dead King Blade', description: 'a runeblade weighty with centuries', damage: '2d10', damageBonus: 8 },
    ],
    lair: [
      { name: 'The Court Rises', description: 'long-dead courtiers claw from the flagstones', damage: '3d6', saveAbility: 'str', dc: 21 },
      { name: 'Cold Court', description: 'royal cold seeps through the lair', damage: '2d6', saveAbility: 'con', dc: 21 },
    ],
  },
  lich_archmage_queen: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Arcane Blast', description: 'a lance of crackling arcana', damage: '3d8', damageBonus: 8, saveAbility: 'dex', dc: 22 },
      { name: 'Queens Rite', description: 'a gesture that unravels flesh', saveAbility: 'con', dc: 22, condition: 'paralyzed', durationTurns: 2 },
      { name: 'Glimmering Staff', description: 'a staff strike that shimmers with stolen magic', damage: '2d8', damageBonus: 7 },
    ],
    lair: [
      { name: 'Ley Line Surge', description: 'arcane energy floods through the lair', damage: '3d6', saveAbility: 'dex', dc: 21 },
      { name: 'Mana Geyser', description: 'raw magic erupts beneath the party', damage: '2d6', saveAbility: 'con', dc: 21, condition: 'prone', durationTurns: 1 },
    ],
  },
  dracolich: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Bite', description: 'a hollow deathly bite', damage: '3d8', damageBonus: 8 },
      { name: 'Tail', description: 'a skeletal tail', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 20, condition: 'prone', durationTurns: 1 },
      { name: 'Crepuscular Breath', description: 'a breath of necrotic twilight', damage: '4d6', saveAbility: 'con', dc: 20 },
    ],
    lair: [
      { name: 'Rising Bones', description: 'a field of bone spears erupts', damage: '3d6', saveAbility: 'dex', dc: 19 },
      { name: 'Ghostflame', description: 'pale flames lick the walls', damage: '2d6', saveAbility: 'con', dc: 19 },
    ],
  },
  death_tyrant: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Disintegrate Ray', description: 'a thin green ray', damage: '3d8', saveAbility: 'dex', dc: 19 },
      { name: 'Paralyzing Ray', description: 'a yellow eye ray', saveAbility: 'con', dc: 19, condition: 'paralyzed', durationTurns: 2 },
      { name: 'Fear Ray', description: 'a crimson ray', saveAbility: 'wis', dc: 19, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Eye Storm', description: 'every eyestalk blazes at once', damage: '3d6', saveAbility: 'dex', dc: 18 },
      { name: 'Pylon Flare', description: 'necrotic pylons flare with purple light', damage: '2d6', saveAbility: 'con', dc: 18 },
    ],
  },
  elder_brain: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Mind Blast', description: 'a shockwave of raw thought', damage: '4d6', saveAbility: 'int', dc: 19 },
      { name: 'Dominate', description: 'an irresistible command', saveAbility: 'wis', dc: 19, condition: 'charmed', durationTurns: 2 },
      { name: 'Tentacle Slam', description: 'a brine-slick tentacle', damage: '2d8', damageBonus: 7, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Colony Cry', description: 'a psychic wail from every thrall in the pool', damage: '3d6', saveAbility: 'int', dc: 18 },
      { name: 'Brine Surge', description: 'a wave of brine floods the chamber', damage: '2d6', saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
    ],
  },
  vampire_lord: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Bite', description: 'fangs that drink deeply of the bloodline', damage: '2d8', damageBonus: 7 },
      { name: 'Charm', description: 'a gaze that bends will', saveAbility: 'wis', dc: 20, condition: 'charmed', durationTurns: 2 },
      { name: 'Bat Swarm', description: 'a cloud of bats tears at the party', damage: '2d6', saveAbility: 'dex', dc: 18 },
    ],
    lair: [
      { name: 'Night Falls', description: 'unnatural darkness pools in the lair', damage: '2d6', saveAbility: 'con', dc: 18 },
      { name: 'Coffin Chains', description: 'chains rattle up from the tomb floor', saveAbility: 'str', dc: 18, condition: 'restrained', durationTurns: 1 },
    ],
  },
  atropal: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Necrotic Burst', description: 'a wave of unborn darkness', damage: '4d6', saveAbility: 'con', dc: 20 },
      { name: 'Wail of the Stillborn', description: 'a sound that undoes life', saveAbility: 'wis', dc: 20, condition: 'frightened', durationTurns: 2 },
      { name: 'Umbilical Lash', description: 'a shadow-tether whips out', damage: '2d8', damageBonus: 7 },
    ],
    lair: [
      { name: 'Negative Energy Tide', description: 'the chamber floods with anti-life', damage: '3d6', saveAbility: 'con', dc: 19 },
      { name: 'Dead Gods Dream', description: 'the air shimmers with a forgotten divinity', damage: '2d6', saveAbility: 'wis', dc: 19 },
    ],
  },
  death_titan: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Skull Club', description: 'a fist like a battering ram', damage: '3d10', damageBonus: 8, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Grave Stomp', description: 'a footfall that cracks the earth', damage: '2d8', saveAbility: 'dex', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Bone Shard Storm', description: 'a spray of its own ribs', damage: '3d6', saveAbility: 'dex', dc: 20 },
    ],
    lair: [
      { name: 'Earthquake', description: 'the lair collapses around the party', damage: '4d6', saveAbility: 'dex', dc: 20 },
      { name: 'Dead Rise', description: 'every buried corpse rises', damage: '2d6', saveAbility: 'wis', dc: 20 },
    ],
  },
  nightwalker: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Shadow Fist', description: 'a fist of pure unlight', damage: '3d8', damageBonus: 8 },
      { name: 'Aura of Annihilation', description: 'an aura that unmakes matter', damage: '2d6', saveAbility: 'con', dc: 19 },
      { name: 'Black Bolt', description: 'a bolt of negative energy', damage: '3d6', saveAbility: 'con', dc: 19 },
    ],
    lair: [
      { name: 'The Void Opens', description: 'a rift to the Negative Energy Plane tears open', damage: '4d6', saveAbility: 'con', dc: 18 },
      { name: 'Shadowtide', description: 'shadows flood the lair like water', damage: '2d6', saveAbility: 'wis', dc: 18, condition: 'frightened', durationTurns: 2 },
    ],
  },
  elder_tempest: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Lightning Lash', description: 'a chain of lightning', damage: '3d8', saveAbility: 'dex', dc: 22 },
      { name: 'Wind Shard', description: 'a blade of condensed gale', damage: '2d8', damageBonus: 8 },
      { name: 'Thunderclap', description: 'a detonation of air', damage: '3d6', saveAbility: 'con', dc: 22, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Eye of the Storm', description: 'the lair becomes the calm heart of a cyclone', damage: '4d6', saveAbility: 'str', dc: 21 },
      { name: 'Torrent', description: 'a wall of rain and hail', damage: '2d6', saveAbility: 'dex', dc: 21 },
    ],
  },
  tarrasque: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Swallow', description: 'a maw that gaps like the underworld', damage: '4d8', damageBonus: 10 },
      { name: 'Tail', description: 'a tail that topples towers', damage: '3d8', damageBonus: 10, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Thrash', description: 'a frenzy of claws', damage: '2d8', damageBonus: 10 },
    ],
    lair: [
      { name: 'World-Breaker', description: 'the lair collapses, raining ruin', damage: '5d6', saveAbility: 'dex', dc: 20 },
      { name: 'Spine Burst', description: 'a ring of thorns erupts from the shell', damage: '3d6', saveAbility: 'dex', dc: 20 },
    ],
  },
  kraken: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tentacle', description: 'a mile-long tentacle coils', damage: '3d8', damageBonus: 8, saveAbility: 'str', dc: 22, condition: 'restrained', durationTurns: 1 },
      { name: 'Lightning Storm', description: 'a storm brews above the deep', damage: '3d8', saveAbility: 'dex', dc: 21 },
      { name: 'Bite', description: 'a beak like an abyss', damage: '3d8', damageBonus: 8 },
    ],
    lair: [
      { name: 'Tsunami', description: 'a wall of water crashes through the lair', damage: '4d6', saveAbility: 'str', dc: 21 },
      { name: 'Deep Current', description: 'a riptide drags the party under', damage: '2d6', saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
    ],
  },
  aboleth: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tentacle', description: 'a slime-slick tentacle', damage: '2d8', damageBonus: 6, saveAbility: 'str', dc: 16, condition: 'restrained', durationTurns: 1 },
      { name: 'Mucus Trap', description: 'a wash of mucus', saveAbility: 'con', dc: 16, condition: 'poisoned', durationTurns: 2 },
      { name: 'Phantasmal Fear', description: 'a vision of the deep', saveAbility: 'wis', dc: 16, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Enslave', description: 'a wave of compulsion', saveAbility: 'wis', dc: 16, condition: 'charmed', durationTurns: 2 },
      { name: 'Slime Tide', description: 'a tide of mucus floods the lair', damage: '2d6', saveAbility: 'con', dc: 16 },
    ],
  },
  demilich: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Howl', description: 'a howl that stops hearts', saveAbility: 'con', dc: 18, condition: 'prone', durationTurns: 1 },
      { name: 'Life Drain', description: 'a beam of draining light', damage: '3d6', saveAbility: 'con', dc: 18 },
      { name: 'Gem Halitosis', description: 'a shriek of trapped souls', damage: '2d6', saveAbility: 'wis', dc: 18, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Soul Storm', description: 'trapped souls swirl through the lair', damage: '3d6', saveAbility: 'con', dc: 17 },
      { name: 'Grave Dust', description: 'a cloud of ancient dust', damage: '2d6', saveAbility: 'con', dc: 17 },
    ],
  },
  ghost_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Bite', description: 'a ghostly bite', damage: '3d8', damageBonus: 7 },
      { name: 'Shadow Breath', description: 'a breath of spectral twilight', damage: '3d6', saveAbility: 'con', dc: 19 },
      { name: 'Tail', description: 'a moonlit tail', damage: '2d8', damageBonus: 7, saveAbility: 'str', dc: 18, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Haunting Moan', description: 'a moan from beyond the veil', damage: '2d6', saveAbility: 'wis', dc: 18, condition: 'frightened', durationTurns: 2 },
      { name: 'Phantom Legion', description: 'long-dead knights ride through the lair', damage: '2d6', saveAbility: 'str', dc: 18 },
    ],
  },
  void_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Void Bite', description: 'a bite from beyond the blue', damage: '3d8', damageBonus: 8 },
      { name: 'Void Breath', description: 'a breath of absolute emptiness', damage: '4d6', saveAbility: 'con', dc: 21 },
      { name: 'Gravity Tail', description: 'a tail that warps gravity', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 20, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Gravity Well', description: 'gravity lurches sideways through the lair', damage: '3d6', saveAbility: 'str', dc: 20 },
      { name: 'Starfall', description: 'debris rains from a rent in the sky', damage: '3d6', saveAbility: 'dex', dc: 20 },
    ],
  },
  moon_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Lunar Bite', description: 'a bite of cold moonlight', damage: '3d8', damageBonus: 8 },
      { name: 'Moonbeam Breath', description: 'a beam of pale light', damage: '3d6', saveAbility: 'wis', dc: 21 },
      { name: 'Tail', description: 'a silver tail', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 20, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Blue Moon', description: 'the lair floods with moonlight', damage: '3d6', saveAbility: 'wis', dc: 20 },
      { name: 'Lunar Dance', description: 'shadows dance and snare', saveAbility: 'dex', dc: 20, condition: 'restrained', durationTurns: 1 },
    ],
  },
  sun_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Solar Bite', description: 'a bite like noon', damage: '3d8', damageBonus: 9 },
      { name: 'Sunfire Breath', description: 'a breath of burning day', damage: '4d6', saveAbility: 'con', dc: 22 },
      { name: 'Tail', description: 'a tail bright as polished gold', damage: '2d8', damageBonus: 9, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Noontide', description: 'the lair blazes like high summer', damage: '3d6', saveAbility: 'con', dc: 21 },
      { name: 'Dazzling Halo', description: 'a ring of blinding light', saveAbility: 'wis', dc: 21, condition: 'frightened', durationTurns: 2 },
    ],
  },
  storm_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Storm Bite', description: 'teeth crackling with lightning', damage: '3d8', damageBonus: 8 },
      { name: 'Thunder Breath', description: 'a detonation of thunder', damage: '4d6', saveAbility: 'con', dc: 22 },
      { name: 'Tail', description: 'a tail wreathed in cloud', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Hurricane Eye', description: 'the lair becomes the eye of a hurricane', damage: '3d6', saveAbility: 'str', dc: 21 },
      { name: 'Chain Lightning', description: 'lightning races between everyone', damage: '3d6', saveAbility: 'dex', dc: 21 },
    ],
  },
  obsidian_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Obsidian Bite', description: 'teeth knapped like arrowheads', damage: '3d8', damageBonus: 8 },
      { name: 'Shard Breath', description: 'a storm of volcanic glass', damage: '4d6', saveAbility: 'dex', dc: 22 },
      { name: 'Tail', description: 'a razor-edged tail', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Lava Vent', description: 'lava vents burst beneath the party', damage: '3d6', saveAbility: 'dex', dc: 21 },
      { name: 'Ashfall', description: 'a gray rain of ash chokes the lair', damage: '2d6', saveAbility: 'con', dc: 21 },
    ],
  },
  poison_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Poison Bite', description: 'fangs weeping venom', damage: '3d8', damageBonus: 7 },
      { name: 'Venom Breath', description: 'a cloud of green vapor', damage: '4d6', saveAbility: 'con', dc: 21 },
      { name: 'Tail', description: 'a tail dripping toxin', damage: '2d8', damageBonus: 7, saveAbility: 'str', dc: 20, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Toxic Bloom', description: 'a garden of deadly flowers blooms', damage: '3d6', saveAbility: 'con', dc: 20 },
      { name: 'Venom Rain', description: 'a hissing rain of venom', damage: '2d6', saveAbility: 'dex', dc: 20 },
    ],
  },
  brass_dragon_elder: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Blistering Bite', description: 'a bite from a desert sage', damage: '3d8', damageBonus: 8 },
      { name: 'Draconic Lecture', description: 'an unending monologue that wears the mind', saveAbility: 'wis', dc: 20, condition: 'frightened', durationTurns: 2 },
      { name: 'Tail', description: 'a dusty tail', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 19, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Heatwave', description: 'a shimmering wave of heat', damage: '3d6', saveAbility: 'con', dc: 19 },
      { name: 'Dune Slide', description: 'the sand floor shifts and swallows', saveAbility: 'str', dc: 19, condition: 'prone', durationTurns: 1 },
    ],
  },
  copper_dragon_elder: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Nipping Bite', description: 'a playful-but-lethal bite', damage: '3d8', damageBonus: 8 },
      { name: 'Riddle Breath', description: 'a blast of acidic wit', damage: '3d6', saveAbility: 'dex', dc: 19 },
      { name: 'Tail', description: 'a mischievous tail', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 19, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Landslide', description: 'the cliff-side lair sloughs away', damage: '3d6', saveAbility: 'dex', dc: 19 },
      { name: 'Caustic Spores', description: 'a puff of burning spores', damage: '2d6', saveAbility: 'con', dc: 19 },
    ],
  },
  crystal_dragon_elder: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Facet Bite', description: 'a bite of sharp crystal', damage: '3d8', damageBonus: 8 },
      { name: 'Refract Breath', description: 'a beam that refracts into a storm of light', damage: '4d6', saveAbility: 'con', dc: 21 },
      { name: 'Tail', description: 'a tail of prismatic glass', damage: '2d8', damageBonus: 8, saveAbility: 'str', dc: 20, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Prism Burst', description: 'the lair erupts with refracted color', damage: '3d6', saveAbility: 'wis', dc: 20 },
      { name: 'Crystal Rain', description: 'shards of crystal fall', damage: '2d6', saveAbility: 'dex', dc: 20 },
    ],
  },
  empyrean: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Lightning Maul', description: 'a maul wreathed in skyfire', damage: '3d8', damageBonus: 8 },
      { name: 'Godly Gaze', description: 'a gaze that weighs the soul', saveAbility: 'wis', dc: 21, condition: 'frightened', durationTurns: 2 },
      { name: 'Heavenly Bolt', description: 'a bolt of divine wrath', damage: '3d6', saveAbility: 'dex', dc: 21 },
    ],
    lair: [
      { name: 'Celestial Choir', description: 'a choir that burns the impure', damage: '3d6', saveAbility: 'cha', dc: 20 },
      { name: 'Radiant Flood', description: 'the lair blazes with holy light', damage: '2d6', saveAbility: 'con', dc: 20 },
    ],
  },
  astral_dreadnought: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Rend', description: 'a grinding blade arm', damage: '4d8', damageBonus: 9 },
      { name: 'Echo of the Deep', description: 'a voice from the Astral Sea', saveAbility: 'wis', dc: 21, condition: 'frightened', durationTurns: 2 },
      { name: 'Tail', description: 'an armored tail', damage: '3d8', damageBonus: 9, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
    ],
    lair: [
      { name: 'Dissolve Space', description: 'the fabric of the lair bends', damage: '3d6', saveAbility: 'int', dc: 20 },
      { name: 'Shifting Ancestry', description: 'the room remakes itself, hurling the party', damage: '2d6', saveAbility: 'str', dc: 20, condition: 'prone', durationTurns: 1 },
    ],
  },
  mummy_lord: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Rotting Fist', description: 'a fist of ancient fury', damage: '2d8', damageBonus: 6, saveAbility: 'con', dc: 18, condition: 'poisoned', durationTurns: 2 },
      { name: 'Dreadful Glare', description: 'a gaze steeped in black hieroglyphs', saveAbility: 'wis', dc: 17, condition: 'frightened', durationTurns: 2 },
      { name: 'Sand Blade', description: 'a blade forged from the desert', damage: '2d6', damageBonus: 6 },
    ],
    lair: [
      { name: 'Tomb Dust', description: 'a storm of grave dust', damage: '2d6', saveAbility: 'con', dc: 17 },
      { name: 'Scarab Swarm', description: 'a tide of scarabs', damage: '2d6', saveAbility: 'dex', dc: 17 },
    ],
  },
  kraken_priest_lord: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Tentacle', description: 'a priests tentacle of sea-dark flesh', damage: '2d8', damageBonus: 6, saveAbility: 'str', dc: 18, condition: 'restrained', durationTurns: 1 },
      { name: 'Sea Wrath', description: 'a blast of brine and lightning', damage: '3d6', saveAbility: 'dex', dc: 18 },
      { name: 'Deep Chant', description: 'a chant that drags the spirit under', saveAbility: 'wis', dc: 18, condition: 'frightened', durationTurns: 2 },
    ],
    lair: [
      { name: 'Flood', description: 'the lair floods to the rafters', damage: '2d6', saveAbility: 'str', dc: 17, condition: 'prone', durationTurns: 1 },
      { name: 'Jellyfish Bloom', description: 'a cluster of stinging jellies', damage: '2d6', saveAbility: 'con', dc: 17 },
    ],
  },
  // ── CR 13 · Drow Matron Mother ──
  drow_matron: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Scourge Lash', description: 'the venom-tipped scourge cracks', damage: '2d8', damageBonus: 4, saveAbility: 'con', dc: 19, condition: 'poisoned', durationTurns: 2 },
      { name: 'Imperative Command', description: 'a word of command that seizes the will', saveAbility: 'wis', dc: 19, condition: 'charmed', durationTurns: 2 },
      { name: 'Cloud of Spiders', description: 'a swarm of biting spiders pours from her sleeves', damage: '2d6', saveAbility: 'dex', dc: 19 },
    ],
    lair: [
      { name: 'Web Barricade', description: 'thick webs drop from the ceiling to snare the party', saveAbility: 'dex', dc: 18, condition: 'restrained', durationTurns: 1 },
      { name: 'Venom Mist', description: 'poison mist seeps from the temple stones', damage: '2d6', saveAbility: 'con', dc: 18 },
      { name: 'Spider Ally', description: 'a giant spider descends to defend its matron', damage: '2d6', saveAbility: 'dex', dc: 18 },
    ],
  },

  // ── CR 16 · Izzru, Wyrm of the Ashpit ──
  izzru: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Ash-Break Charge', description: 'the wyrm bursts from the ash beneath its prey', damage: '3d10', damageBonus: 7, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Cinder Burp', description: 'a chest-full of hot ash coughed across the room', damage: '3d6', saveAbility: 'dex', dc: 21 },
      { name: 'Tail Sweep', description: 'a tail broad as a gate swings low', damage: '2d8', damageBonus: 7, saveAbility: 'dex', dc: 21 },
    ],
    lair: [
      { name: 'Ashfall', description: 'the ceiling sheds burning ash over the whole chamber', damage: '3d6', saveAbility: 'dex', dc: 19 },
      { name: 'Ember Updraft', description: 'a column of superheated air erupts under the party', damage: '2d6', saveAbility: 'dex', dc: 19 },
      { name: 'Soot Blind', description: 'ash clouds blind the intruders', saveAbility: 'con', dc: 19, condition: 'blinded', durationTurns: 1 },
    ],
  },

  // ── CR 16 · Sang Dragon ──
  sang_dragon: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Storm Wing Buffet', description: 'wings like thunderheads beat a gale', damage: '2d8', damageBonus: 6, cost: 2, saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Forked Lightning Bite', description: 'fangs trailing arcs of blue-white light', damage: '3d8', damageBonus: 6 },
      { name: 'Rolling Thunder', description: 'a roar that arrives with its own lightning', damage: '4d6', saveAbility: 'dex', dc: 21 },
    ],
    lair: [
      { name: 'Lightning Strike', description: 'the storm overhead answers its master', damage: '4d6', saveAbility: 'dex', dc: 20 },
      { name: 'Rain Wall', description: 'a curtain of blinding rain sweeps the lair', saveAbility: 'con', dc: 20, condition: 'blinded', durationTurns: 1 },
      { name: 'Static Floor', description: 'charge builds until the wet stone itself sparks', damage: '2d6', saveAbility: 'dex', dc: 20 },
    ],
  },

  // ── CR 17 · Asteri, Star Herald ──
  asteri: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Nova Gaze', description: 'eyes like dying stars fix on a target', damage: '4d6', saveAbility: 'con', dc: 22 },
      { name: 'Constellation Bind', description: 'lines of starlight lash the party in place', saveAbility: 'str', dc: 22, condition: 'restrained', durationTurns: 1 },
      { name: 'Solar Word', description: 'a spoken word that arrives as heat and light', damage: '3d6', saveAbility: 'dex', dc: 22 },
    ],
    lair: [
      { name: 'Starfall', description: 'fragments of light rain from the observatory dome', damage: '3d6', saveAbility: 'dex', dc: 21 },
      { name: 'Gravity Shift', description: 'the constellation-patterned floor pulls sideways', saveAbility: 'str', dc: 21, condition: 'prone', durationTurns: 1 },
      { name: 'Radiant Chorus', description: 'the stars themselves sing a deafening chord', damage: '2d6', saveAbility: 'con', dc: 21 },
    ],
  },

  // ── CR 21 · Titan of the Celestial Host ──
  titan_celestial: {
    legendaryResistances: 3,
    legendary: [
      { name: 'Greatsword of Dawn', description: 'a blade of solid daylight falls', damage: '4d10', damageBonus: 9, saveAbility: 'dex', dc: 24 },
      { name: 'Heraldic Blast', description: 'a trumpet-blast of pure force', damage: '3d8', saveAbility: 'con', dc: 24 },
      { name: 'Smiting Grasp', description: 'a hand the size of a door closes on the wicked', damage: '3d10', damageBonus: 9, saveAbility: 'str', dc: 24, condition: 'restrained', durationTurns: 1 },
    ],
    lair: [
      { name: 'Pillar of Light', description: 'a column of dawnlight strikes the floor', damage: '5d6', saveAbility: 'dex', dc: 23 },
      { name: 'Hymn of Judgment', description: 'a choir of unseen voices weighs the party\'s sins', damage: '3d6', saveAbility: 'wis', dc: 23 },
      { name: 'Ward of Gold', description: 'golden sigils flare with warding light that turns aside blows', saveAbility: 'dex', dc: 23 },
    ],
  },

};

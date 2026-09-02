import { Ability, CharacterClass, Race, abilityModifier, getCasterType, maxSlotsFor, ordinal, rollDice } from '../data/gameData';
import { DiceType, pushDiceRoll } from '../rules/DiceEvents';
import { consumeLuckDieIfAny } from '../rules/LuckDie';
import { Vector2 } from '../engine/types';
import {
  ActiveCondition,
  AttackOpts,
  ConditionId,
  DEATH_SAVE_DC,
  EXHAUSTION_EFFECTS,
  SaveResult,
  applyCondition,
  hasCondition,
  proficiencyBonus,
  removeCondition,
  rollD20,
  savingThrow,
} from '../rules/Rules';

export interface InventoryItem {
  id: string;
  name: string;
  type: 'weapon' | 'armor' | 'potion' | 'scroll' | 'treasure';
  description: string;
  effect?: string;
  value?: number;
  /** Whether this item has been identified. Unidentified items show as '???'. */
  identified?: boolean;
  /** Numeric power value (damage, healing, etc.). */
  power?: number;
  /** Cursed items bind to the wearer until remove curse / temple rite. */
  cursed?: boolean;
  /** Once revealed (by a telltale check or identification), the curse is known. */
  curseKnown?: boolean;
  /** Optional mechanical curse flavor: which penalty it carries. */
  curseKind?: 'leeching' | 'clumsy' | 'heavy' | 'doomed';
}

/** The four body slots a character can fill with gear. */
export type EquipSlot = 'weapon' | 'armor' | 'shield' | 'trinket';
export interface Equipment {
  weapon?: InventoryItem;
  armor?: InventoryItem;
  shield?: InventoryItem;
  trinket?: InventoryItem;
}

/** Infer the slot an item occupies from its type and name. */
export function slotForItem(item: InventoryItem): EquipSlot | null {
  const name = item.name.toLowerCase();
  if (item.type === 'weapon') return 'weapon';
  if (item.type === 'armor') {
    if (/shield|buckler/.test(name)) return 'shield';
    if (/cloak|ring|amulet|pendant|bauble|charm|talisman|mantle|brooch|periapt/.test(name)) return 'trinket';
    return 'armor';
  }
  return null;
}

/** Parse a magic +N bonus from an item's name or effect text. */
export function magicBonusOf(item: InventoryItem): number {
  const m = (item.name + ' ' + (item.effect ?? '')).match(/\+(\d)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** True once an item has been cursed by its encounter of origin. */
export function isCursed(item: InventoryItem): boolean {
  return item.cursed === true;
}

/**
 * The telltale signs a cursed item shows before it's equipped — vague but
 * real warnings, the classic "it hums with a low, hungry note".
 */
export function curseTelltale(item: InventoryItem): string | null {
  if (!isCursed(item)) return null;
  const kind = item.type === 'weapon' ? 'blade' : item.type === 'armor' ? 'armor' : 'trinket';
  const SIGNS: Record<string, string[]> = {
    weapon: [
      'the steel drinks the light around it a shade too eagerly',
      'a faint whisper rides the edge of hearing when it is lifted',
      'the grip is cold, and stays cold no matter how long it is held',
    ],
    armor: [
      'the clasps are tarnished as if by old tears',
      'a low hum settles in the bones when it is worn',
      'it fits too well, as if it already knows its owner',
    ],
    trinket: [
      'the stone at its heart pulses out of rhythm with any living heart',
      'your reflection in it lags half a beat behind',
      'it is warmer than the air around it, like something breathing',
    ],
  };
  const pool = SIGNS[kind] ?? SIGNS.trinket;
  const idx = (item.name.length + (item.value ?? 0)) % pool.length;
  return pool[idx];
}

// ── Weapon & armor proficiency tables (5e-flavored) ─────────────────────────

const SIMPLE_WEAPON_RE = /dagger|staff|quarterstaff|mace|sling|dart|club|javelin|spear|handaxe|hand axe|sickle|light crossbow|torch/i;
const FINESSE_WEAPON_RE = /dagger|rapier|shortsword|scimitar|whip|dart/i;

/** Classes trained in all martial weapons. */
const MARTIAL_CLASSES = new Set(['fighter', 'barbarian', 'paladin', 'ranger']);
/** Classes that also handle finesse martial weapons (5e rogue/bard lists). */
const FINESSE_CLASSES = new Set(['rogue', 'bard']);

const HEAVY_ARMOR_RE = /chain mail|plate|splint|banded/i;
const MEDIUM_ARMOR_RE = /scale|breastplate|half plate|hide|chain shirt/i;
const SHIELD_RE = /shield|buckler/i;

const HEAVY_ARMOR_CLASSES = new Set(['fighter', 'paladin']);
const MEDIUM_ARMOR_CLASSES = new Set(['fighter', 'paladin', 'ranger', 'cleric', 'barbarian', 'druid']);
const SHIELD_CLASSES = new Set(['fighter', 'paladin', 'cleric', 'ranger', 'barbarian']);

export interface Personality {
  aggression: number;    // 0-10: likelihood of attacking
  curiosity: number;     // 0-10: exploring, checking things
  caution: number;       // 0-10: retreat threshold, trap checking
  loyalty: number;       // 0-10: helping party members
  greed: number;         // 0-10: looting priority
}

export class GameCharacter {
  public id: string;
  public name: string;
  public charClass: CharacterClass;
  public race: Race;

  // Core stats (standard array: 15,14,13,12,10,8)
  public abilities: Record<Ability, number>;
  public level: number = 1;
  public xp: number = 0;

  // Derived
  public hp: number;
  public baseMaxHp: number;
  public ac: number;
  public speed: number;

  // Position
  public tile: Vector2;
  public direction: 'down' | 'left' | 'right' | 'up' = 'down';

  // Inventory
  public inventory: InventoryItem[] = [];
  public gold: number = 0;

  // Equipped gear (v8+). Items are removed from inventory while equipped.
  public equipment: Equipment = {};

  // Combat state
  public conditions: ActiveCondition[] = [];
  public isDead: boolean = false;
  public stabilized: boolean = false;
  /** True for temporary companions (hired guards) that leave after the dungeon. */
  public isTemporaryCompanion: boolean = false;
  public deathSaveSuccesses: number = 0;
  public deathSaveFailures: number = 0;
  public exhaustion: number = 0;

  // Concentration (one spell at a time)
  public concentration?: { spellName: string; sourceId: string };

  // Hit dice for short rests
  public maxHitDice: number = 1;
  public hitDiceRemaining: number = 1;

  /** Set by takeDamage when a concentration save just failed. */
  public pendingConcentrationBreak: boolean = false;
  /** Vendetta ledger: monster template ids this hero was downed by → times. Survives between fights. */
  public vendettas: Record<string, number> = {};

  // AI personality
  public personality: Personality;

  // Lore identity
  public subclass?: string;
  public deity?: string;
  public background?: string;
  public alignment?: string;

  // Spell slots: spell level -> slots remaining; maxSpellSlots is the ceiling.
  public spellSlots: Record<number, number> = {};
  public maxSpellSlots: Record<number, number> = {};
  public knownSpells: string[] = [];

  /** True when the DM had this member use a potion/scroll mid-round — their next combat turn is spent. */
  public pendingItemUse: boolean = false;

  constructor(
    id: string,
    name: string,
    charClass: CharacterClass,
    race: Race,
    abilities: Record<Ability, number>,
    personality?: Partial<Personality>
  ) {
    this.id = id;
    this.name = name;
    this.charClass = charClass;
    this.race = race;
    this.abilities = abilities;
    this.tile = { x: 0, y: 0 };
    this.speed = race.speed;

    // HP
    this.baseMaxHp = charClass.hitDie + abilityModifier(abilities.con);
    this.hp = this.baseMaxHp;

    // Rest resources
    this.maxHitDice = 1;
    this.hitDiceRemaining = 1;
    this.recomputeSpellSlots();

    // AC (base 10 + dex)
    this.ac = 10 + abilityModifier(abilities.dex);

    // Personality
    this.personality = {
      aggression: 5,
      curiosity: 5,
      caution: 5,
      loyalty: 5,
      greed: 5,
      ...personality,
    };
  }

  get str(): number { return this.abilities.str; }
  get dex(): number { return this.abilities.dex; }
  get con(): number { return this.abilities.con; }
  get int(): number { return this.abilities.int; }
  get wis(): number { return this.abilities.wis; }
  get cha(): number { return this.abilities.cha; }

  get strMod(): number { return abilityModifier(this.str); }
  get dexMod(): number { return abilityModifier(this.dex); }
  get conMod(): number { return abilityModifier(this.con); }
  get intMod(): number { return abilityModifier(this.int); }
  get wisMod(): number { return abilityModifier(this.wis); }
  get chaMod(): number { return abilityModifier(this.cha); }

  /** Extra attack bonus from honing a blade at a dungeon forge (persisted). */
  bonusAttackBonus: number = 0;

  /**
   * Is this character trained with this weapon? Simple weapons for everyone;
   * full martial lists for fighter/paladin/ranger/barbarian; rogues and bards
   * add finesse blades; monks add the shortsword.
   */
  isProficientWithWeapon(item: InventoryItem): boolean {
    const name = item.name.toLowerCase();
    if (SIMPLE_WEAPON_RE.test(name)) return true;
    const cls = this.charClass.id;
    if (MARTIAL_CLASSES.has(cls)) return true;
    if (FINESSE_CLASSES.has(cls) && FINESSE_WEAPON_RE.test(name)) return true;
    if (cls === 'monk' && /shortsword/.test(name)) return true;
    return false;
  }

  /** Why a character can't wear this armor/shield piece, or null if they can. */
  armorRefusal(item: InventoryItem, slot: 'armor' | 'shield'): string | null {
    const name = item.name.toLowerCase();
    const cls = this.charClass.id;
    if (slot === 'shield') {
      if (SHIELD_CLASSES.has(cls)) return null;
      return `${this.name} has never trained with a shield — it would only get in the way.`;
    }
    if (HEAVY_ARMOR_RE.test(name)) {
      if (HEAVY_ARMOR_CLASSES.has(cls)) return null;
      return `Heavy harness like ${item.name} is fighter's and paladin's steel — ${this.name} refuses it.`;
    }
    if (MEDIUM_ARMOR_RE.test(name)) {
      if (MEDIUM_ARMOR_CLASSES.has(cls)) return null;
      return `${item.name} is beyond ${this.name}'s training — they'll stick to lighter wear.`;
    }
    return null; // light armor and robes suit everyone
  }

  /** Magic weapon bonus (+1/+2/+3 sword etc.) applied to attacks and damage. */
  get weaponMagicBonus(): number {
    return this.equipment.weapon ? magicBonusOf(this.equipment.weapon) : 0;
  }

  /**
   * Total attack bonus. Swinging a weapon the class never trained with costs
   * the proficiency bonus — the classic 5e penalty — so a wizard's greataxe
   * swing lands far less often than the fighter's.
   */
  get attackBonus(): number {
    const weapon = this.equipment.weapon;
    const proficient = !weapon || this.isProficientWithWeapon(weapon);
    const profPart = proficient ? proficiencyBonus(this.level) : 0;
    // The 'clumsy' curse fumbles the wielder's hands: -2 to hit.
    const clumsy = this.findCursedEquipped()?.curseKind === 'clumsy' ? -2 : 0;
    return profPart + this.bonusAttackBonus + this.weaponMagicBonus + clumsy;
  }

  /** True when the equipped weapon is outside the class's training. */
  get hasWeaponProficiencyPenalty(): boolean {
    const weapon = this.equipment.weapon;
    return Boolean(weapon) && !this.isProficientWithWeapon(weapon!);
  }

  get profBonus(): number {
    return proficiencyBonus(this.level);
  }

  /** Primary casting stat modifier for this class. */
  get spellcastingMod(): number {
    switch (this.charClass.id) {
      case 'wizard': return this.intMod;
      case 'cleric':
      case 'druid':
      case 'ranger': return this.wisMod;
      case 'bard':
      case 'sorcerer':
      case 'warlock':
      case 'paladin': return this.chaMod;
      default: return this.intMod;
    }
  }

  /** 8 + prof + casting mod — the DC monsters save against. */
  get spellSaveDC(): number {
    return 8 + this.profBonus + this.spellcastingMod;
  }

  get damageBonus(): number {
    return this.strMod + this.weaponMagicBonus;
  }

  /**
   * Recompute AC from equipped gear: base 10+DEX, overridden by armor's
   * target AC, then shields add +2 and protective trinkets add their +N.
   */
  recomputeAC(): void {
    let ac = 10 + abilityModifier(this.abilities.dex);
    const armor = this.equipment.armor;
    if (armor) ac = Math.max(ac, armor.power ?? 11);
    if (this.equipment.shield) ac += this.equipment.shield.power ?? 2;
    if (this.equipment.trinket) ac += magicBonusOf(this.equipment.trinket) || 1;
    // The 'heavy' curse weighs the wearer down: -1 AC.
    if (this.findCursedEquipped()?.curseKind === 'heavy') ac -= 1;
    this.ac = ac;
  }

  /**
   * Equip an item from this character's inventory into its natural slot.
   * Returns a narration line, or null if the item can't be equipped.
   * Any item already in that slot returns to the pack first.
   */
  /**
   * Equip an inventory item by id. Returns { ok, line } — `line` is the
   * narration on success or the refusal reason on failure.
   */
  equip(itemId: string): { ok: boolean; line: string } {
    const fail = (line: string) => ({ ok: false, line });
    const idx = this.inventory.findIndex(i => i.id === itemId);
    if (idx < 0) return fail(`${this.name} can't find that item.`);
    const item = this.inventory[idx];
    const slot = slotForItem(item);
    if (!slot) return fail(`The ${item.name} can't be equipped.`);
    // Armor and shields a class has no training for are refused outright.
    if (slot === 'armor' || slot === 'shield') {
      const refusal = this.armorRefusal(item, slot);
      if (refusal) return fail(refusal);
    }
    // Swap out whatever currently sits in the slot.
    const previous = this.equipment[slot];
    this.inventory.splice(idx, 1);
    this.equipment[slot] = item;
    if (previous) this.inventory.push(previous);
    this.recomputeAC();
    const slotLabel = { weapon: 'wields', armor: 'dons', shield: 'raises', trinket: 'fastens' }[slot];
    // A cursed item binds the moment it is worn — the truth arrives too late.
    if (isCursed(item)) {
      item.curseKnown = true;
      return { ok: true, line: `${this.name} ${slotLabel} ${item.name}. ${this.curseBites(item)}` };
    }
    return { ok: true, line: `${this.name} ${slotLabel} ${item.name}.` };
  }

  /** The narration when a curse takes hold on equip. */
  private curseBites(item: InventoryItem): string {
    const kind = item.curseKind ?? 'leeching';
    switch (kind) {
      case 'clumsy': return `The moment it settles, ${this.name}'s fingers forget their cunning — the item grips back. (-2 to hit)`;
      case 'heavy': return `It settles like a stone — ${this.name} feels the weight of someone else's regrets. (-1 AC)`;
      case 'doomed': return `A whisper names ${this.name} to something far below. Monsters will hunt this one. (-1 to all saves)`;
      default: return `${this.name} feels a slow pull at their strength — the ${item.name} is drinking. (leeches 1 HP per combat round)`;
    }
  }

  /**
   * Try to remove an equipped item. Cursed gear refuses unless the curse
   * has been lifted (item.cursed cleared by remove curse / temple rite).
   */
  unequip(slot: EquipSlot): string | null {
    const item = this.equipment[slot];
    if (!item) return null;
    if (isCursed(item)) {
      return `The ${item.name} will not come off — it clings like a second skin. Only a remove curse spell or a temple's rite can part them.`;
    }
    this.equipment[slot] = undefined;
    this.inventory.push(item);
    this.recomputeAC();
    return `${this.name} stows their ${item.name}.`;
  }

  /** Lift a curse in place: the item stays equipped but comes off freely after. */
  liftCurse(): string | null {
    for (const slot of ['weapon', 'armor', 'shield', 'trinket'] as EquipSlot[]) {
      const item = this.equipment[slot];
      if (item && isCursed(item)) {
        item.cursed = false;
        item.curseKnown = true;
        return `The pall over the ${item.name} lifts — ${this.name} breathes easier. It can be removed now.`;
      }
    }
    return null;
  }

  /** The equipped cursed item, if any. */
  findCursedEquipped(): InventoryItem | null {
    for (const slot of ['weapon', 'armor', 'shield', 'trinket'] as EquipSlot[]) {
      const item = this.equipment[slot];
      if (item && isCursed(item)) return item;
    }
    return null;
  }

  /** Human-readable equipped-gear summary for UI and DM inspection. */
  gearSummary(): string {
    const slots: EquipSlot[] = ['weapon', 'armor', 'shield', 'trinket'];
    const parts = slots.map(s => {
      const it = this.equipment[s];
      return `${s}: ${it ? it.name : '—'}`;
    });
    return parts.join(' · ');
  }

  /** Alive = not dead. Dying and stabilized characters are still alive. */
  get isAlive(): boolean { return !this.isDead; }
  get isConscious(): boolean { return this.hp > 0; }
  get isDying(): boolean { return this.hp <= 0 && !this.isDead && !this.stabilized; }
  get exhaustionLabel(): string { return EXHAUSTION_EFFECTS[this.exhaustion] ?? ''; }

  /** Exhaustion level 4+ halves the hit point maximum. */
  get maxHp(): number {
    return this.exhaustion >= 4 ? Math.floor(this.baseMaxHp / 2) : this.baseMaxHp;
  }

  takeDamage(amount: number, opts?: { crit?: boolean }): string {
    const messages: string[] = [];

    // Damage wakes the unconscious (the Sleep spell).
    if (removeCondition(this, 'unconscious')) {
      messages.push(`${this.name} is jolted awake by the pain!`);
    }

    // A character already at 0 HP takes death-save failures instead of damage.
    if (this.hp <= 0 && !this.isDead) {
      const failures = opts?.crit ? 2 : 1;
      this.stabilized = false;
      this.deathSaveFailures += failures;
      if (this.deathSaveFailures >= 3) {
        this.isDead = true;
        messages.push(`${this.name} succumbs to their wounds and dies!`);
      } else {
        messages.push(`${this.name} is down — the blow costs ${failures} death-save failure${failures === 1 ? '' : 's'} (${this.deathSaveFailures}/3).`);
      }
      return messages.join(' ');
    }

    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.enterDying();
      const lost = this.concentration?.spellName;
      this.breakConcentration();
      messages.push(`${this.name} has fallen and begins making death saves${lost ? ` (concentration on ${lost} lost)` : ''}!`);
      return messages.join(' ');
    }
    messages.push(`${this.name} takes ${amount} damage (${this.hp}/${this.maxHp} HP)${opts?.crit ? ' CRITICAL!' : ''}`);

    // Concentration save: DC 10 or half the damage, whichever is higher.
    if (this.concentration) {
      const dc = Math.max(10, Math.floor(amount / 2));
      const result = this.makeSavingThrow('con', dc);
      const spellName = this.concentration.spellName;
      if (result.success) {
        messages.push(`${this.name} holds concentration on ${spellName} (CON ${result.total} vs DC ${dc}).`);
      } else {
        this.breakConcentration();
        this.pendingConcentrationBreak = true;
        messages.push(`${this.name}'s concentration on ${spellName} is broken! (CON ${result.total} vs DC ${dc})`);
      }
    }

    return messages.join(' ');
  }

  /** Enter the dying state: reset death-save counters, drop prone. */
  private enterDying(): void {
    this.deathSaveSuccesses = 0;
    this.deathSaveFailures = 0;
    this.stabilized = false;
  }

  /**
   * Roll a death save on a dying character's turn.
   * 20 = back on their feet at 1 HP; 10+ = success; 9- = failure;
   * a natural 1 counts as two failures. Three successes stabilize,
   * three failures mean death.
   */
  rollDeathSave(): string {
    if (this.isDead || this.stabilized || this.hp > 0) return '';
    // A fated Luck die decides the save outright.
    const roll = consumeLuckDieIfAny(this.name)?.value ?? rollD20();
    pushDiceRoll({
      kind: 'death-save',
      diceType: 'd20',
      label: `${this.name} death save (DC ${DEATH_SAVE_DC})`,
      expression: 'd20',
      rolls: [roll],
      total: roll,
      outcome: roll === 20 ? 'crit' : roll === 1 ? 'fumble' : roll >= DEATH_SAVE_DC ? 'success' : 'failure',
    });
    if (roll === 20) {
      this.hp = 1;
      this.resetDeathState();
      return `${this.name} rolls a death save: NATURAL 20! ${this.name} surges back to their feet with 1 HP!`;
    }
    if (roll === 1) {
      this.deathSaveFailures += 2;
    } else if (roll >= DEATH_SAVE_DC) {
      this.deathSaveSuccesses++;
    } else {
      this.deathSaveFailures++;
    }
    if (this.deathSaveFailures >= 3) {
      this.deathSaveFailures = 3;
      this.isDead = true;
      return `${this.name} rolls ${roll} — 3 death-save failures. ${this.name} dies!`;
    }
    if (this.deathSaveSuccesses >= 3) {
      this.deathSaveSuccesses = 3;
      this.stabilized = true;
      return `${this.name} rolls ${roll} — 3 death-save successes. ${this.name} stabilizes, clinging to life.`;
    }
    return `${this.name} rolls ${roll} — death saves ${this.deathSaveSuccesses}S / ${this.deathSaveFailures}F.`;
  }

  /** Bring a downed character back: clears death-save state and sets HP. */
  revive(hp: number): void {
    this.isDead = false;
    this.hp = Math.max(1, Math.min(hp, this.maxHp));
    this.resetDeathState();
  }

  resetDeathState(): void {
    this.deathSaveSuccesses = 0;
    this.deathSaveFailures = 0;
    this.stabilized = false;
  }

  /** Add a level of exhaustion; level 6 is fatal. Returns the narration. */
  gainExhaustion(): string {
    if (this.isDead) return `${this.name} is already beyond exhaustion.`;
    this.exhaustion++;
    if (this.exhaustion >= 6) {
      this.exhaustion = 6;
      this.isDead = true;
      this.hp = 0;
      return `${this.name} collapses from exhaustion (level 6) — dead!`;
    }
    return `${this.name} gains a level of exhaustion (${this.exhaustion}/6) — ${EXHAUSTION_EFFECTS[this.exhaustion]}.`;
  }

  /** d20 + ability mod (+proficiency if it's a class save). Nat 20 succeeds, nat 1 fails. */
  makeSavingThrow(ability: Ability, dc: number, extraBonus: number = 0): SaveResult {
    // The 'doomed' curse draws hostile attention: -1 to all saves.
    if (this.findCursedEquipped()?.curseKind === 'doomed') extraBonus -= 1;
    // Petrified and paralyzed creatures automatically fail STR and DEX saves.
    if ((ability === 'str' || ability === 'dex') &&
        (this.hasCondition('petrified') || this.hasCondition('paralyzed'))) {
      return { success: false, natural: 1, total: 0, dc };
    }
    const proficient = this.charClass.savingThrows.includes(ability);
    const mod = abilityModifier(this.abilities[ability]) + (proficient ? this.profBonus : 0) + extraBonus;
    // A fated Luck die overrides the roll; exhaustion 3+ otherwise means disadvantage.
    const fate = consumeLuckDieIfAny(this.name);
    return savingThrow(mod, dc, {
      disadvantage: !fate && this.exhaustion >= 3,
      label: `${this.name} ${ability.toUpperCase()} save`,
      naturalOverride: fate?.value,
    });
  }

  /** Speed after conditions and exhaustion: grappled/restrained = 0. */
  get effectiveSpeed(): number {
    if (this.hasCondition('grappled') || this.hasCondition('restrained') || this.exhaustion >= 5) return 0;
    if (this.exhaustion >= 2) return Math.floor(this.speed / 2);
    return this.speed;
  }

  /**
   * Weapon swings per Attack action. Martial classes gain Extra Attack at
   * level 5 (two swings) and a third at level 11 — the fighter's classic
   * multiattack curve. Sneaky and spell-focused classes keep a single strike.
   */
  get attackCount(): number {
    if (!['fighter', 'barbarian', 'paladin', 'ranger', 'monk'].includes(this.charClass.id)) return 1;
    if (this.level >= 11) return 3;
    if (this.level >= 5) return 2;
    return 1;
  }

  applyCondition(id: ConditionId, turnsLeft: number, name: string, sourceId?: string): boolean {
    return applyCondition(this, { id, name, turnsLeft, sourceId });
  }

  hasCondition(id: ConditionId): boolean {
    return hasCondition(this, id);
  }

  startConcentration(spellName: string, sourceId: string): string | null {
    const previous = this.concentration?.spellName ?? null;
    this.concentration = { spellName, sourceId };
    return previous;
  }

  breakConcentration(): void {
    this.concentration = undefined;
  }

  get spellSlotsRemaining(): number {
    return Object.values(this.spellSlots).reduce((s, n) => s + n, 0);
  }

  get maxSpellSlotsTotal(): number {
    return Object.values(this.maxSpellSlots).reduce((s, n) => s + n, 0);
  }

  /** Derive slot ceilings from class and level; keeps spent slots spent. */
  recomputeSpellSlots(): void {
    const table = maxSlotsFor(this.charClass.id, this.level);
    const previousMax = this.maxSpellSlots;
    const previousRemaining = this.spellSlots;
    const nextMax: Record<number, number> = {};
    const nextRemaining: Record<number, number> = {};
    for (let lvl = 1; lvl <= 9; lvl++) {
      const max = table[lvl - 1] || 0;
      if (max <= 0) continue;
      nextMax[lvl] = max;
      // Keep whatever was left; newly gained slots arrive full.
      const kept = previousRemaining[lvl] ?? 0;
      const gained = max - (previousMax[lvl] || 0);
      nextRemaining[lvl] = Math.min(max, kept + Math.max(0, gained));
    }
    this.maxSpellSlots = nextMax;
    this.spellSlots = nextRemaining;
  }

  /** Cantrips (level 0) are free; otherwise any slot of this level or higher. */
  canCastSpell(spellLevel: number): boolean {
    if (spellLevel <= 0) return true;
    for (let lvl = spellLevel; lvl <= 9; lvl++) {
      if ((this.spellSlots[lvl] || 0) > 0) return true;
    }
    return false;
  }

  /**
   * Spend the lowest available slot of at least `spellLevel`.
   * Returns the slot level actually used (0 for cantrips), or null if broke.
   */
  spendSpellSlot(spellLevel: number): number | null {
    if (spellLevel <= 0) return 0;
    for (let lvl = spellLevel; lvl <= 9; lvl++) {
      if ((this.spellSlots[lvl] || 0) > 0) {
        this.spellSlots[lvl] = (this.spellSlots[lvl] || 0) - 1;
        return lvl;
      }
    }
    return null;
  }

  /** Spend a specific slot level; false if none remain there. Cantrips are free. */
  spendSlotAt(level: number): boolean {
    if (level <= 0) return true;
    if ((this.spellSlots[level] || 0) <= 0) return false;
    this.spellSlots[level] = (this.spellSlots[level] || 0) - 1;
    return true;
  }

  /** Restore one expended slot of the lowest level; returns the level restored. */
  restoreSpellSlot(): number | null {
    for (let lvl = 1; lvl <= 9; lvl++) {
      const max = this.maxSpellSlots[lvl] || 0;
      const remaining = this.spellSlots[lvl] || 0;
      if (remaining < max) {
        this.spellSlots[lvl] = remaining + 1;
        return lvl;
      }
    }
    return null;
  }

  /** Restore the lowest expended slot that could cast a spell of `spellLevel`. */
  restoreSpellSlotForSpell(spellLevel: number): number | null {
    for (let lvl = Math.max(1, spellLevel); lvl <= 9; lvl++) {
      const max = this.maxSpellSlots[lvl] || 0;
      const remaining = this.spellSlots[lvl] || 0;
      if (remaining < max) {
        this.spellSlots[lvl] = remaining + 1;
        return lvl;
      }
    }
    return null;
  }

  /** Human-readable slot state for spell levels at or above `spellLevel`. */
  slotSummaryFor(spellLevel: number): string {
    const parts: string[] = [];
    for (let lvl = Math.max(1, spellLevel); lvl <= 9; lvl++) {
      const max = this.maxSpellSlots[lvl] || 0;
      if (max <= 0) continue;
      parts.push(`${ordinal(lvl)} ${this.spellSlots[lvl] || 0}/${max}`);
    }
    return parts.length > 0 ? parts.join(', ') : 'no matching slots';
  }

  heal(amount: number): string {
    if (this.isDead) {
      return `${this.name} is beyond healing — only a rest at camp can help.`;
    }
    const wasDown = this.hp <= 0;
    const before = this.hp;
    this.hp = Math.min(this.hp + amount, this.maxHp);
    if (wasDown && this.hp > 0) {
      // Back on their feet: death saves reset.
      this.resetDeathState();
      return `${this.name} is pulled back from the brink — ${this.hp} HP!`;
    }
    const healed = this.hp - before;
    return `${this.name} heals ${healed} HP (${this.hp}/${this.maxHp})`;
  }

  attack(target: { name: string; ac: number }, opts?: AttackOpts): { hit: boolean; damage: number; message: string } {
    // Exhaustion level 3+ means disadvantage on attack rolls.
    if (this.exhaustion >= 3) opts = { ...opts, disadvantage: true };
    const advantage = Boolean(opts?.advantage && !opts.disadvantage);
    const disadvantage = Boolean(opts?.disadvantage);
    const rolls = [rollD20()];
    if (advantage || disadvantage) rolls.push(rollD20());
    let roll = advantage ? Math.max(...rolls) : disadvantage ? Math.min(...rolls) : rolls[0];
    // A fated Luck die replaces the natural roll — no dice needed, fate decides.
    const fate = consumeLuckDieIfAny(this.name);
    if (fate) {
      roll = fate.value;
      rolls.length = 0;
      rolls.push(fate.value);
    }
    const attackBonus = this.attackBonus + (opts?.attackRollBonus || 0);
    const total = roll + attackBonus;

    pushDiceRoll({
      kind: 'attack',
      diceType: 'd20',
      label: `${this.name} attacks ${target.name} (AC ${target.ac})`,
      expression: `${advantage ? '2d20-adv' : disadvantage ? '2d20-dis' : 'd20'}${attackBonus >= 0 ? '+' : ''}${attackBonus}`,
      rolls,
      total,
      outcome: roll === 20 ? 'crit' : roll === 1 ? 'fumble' : total >= target.ac ? 'success' : 'failure',
    });

    if (roll === 20) {
      // Critical hit
      const weaponDie = this.getWeaponDamageDie();
      const dice = this.level >= 5 ? 2 : 1;
      const damage = rollDice(dice, weaponDie) + this.damageBonus + (opts?.damageBonus || 0);
      pushDiceRoll({
        kind: 'damage',
        diceType: ('d' + weaponDie) as DiceType,
        label: `${this.name} critical hits ${target.name}`,
        expression: `${dice}d${weaponDie}${this.damageBonus >= 0 ? '+' : ''}${this.damageBonus}${opts?.damageBonus ? '+' + opts.damageBonus : ''}`,
        rolls: [damage],
        total: damage,
        outcome: 'crit',
      });
      return { hit: true, damage, message: `CRITICAL HIT! ${this.name} strikes ${target.name} for ${damage} damage!` };
    }

    if (total >= target.ac) {
      const weaponDie = this.getWeaponDamageDie();
      const damage = rollDice(1, weaponDie) + this.damageBonus + (opts?.damageBonus || 0);
      pushDiceRoll({
        kind: 'damage',
        diceType: ('d' + weaponDie) as DiceType,
        label: `${this.name} hits ${target.name}`,
        expression: `1d${weaponDie}${this.damageBonus >= 0 ? '+' : ''}${this.damageBonus}${opts?.damageBonus ? '+' + opts.damageBonus : ''}`,
        rolls: [damage],
        total: damage,
        outcome: 'neutral',
      });
      return { hit: true, damage, message: `${this.name} hits ${target.name} for ${damage} damage.` };
    }

    return { hit: false, damage: 0, message: `${this.name} misses ${target.name}.` };
  }

  getWeaponDamageDie(): number {
    // An equipped weapon's power IS its damage die (d4 dagger … d12 greataxe).
    const weapon = this.equipment.weapon;
    if (weapon?.power && weapon.power >= 4 && weapon.power <= 12) return weapon.power;
    // Unarmed / no usable weapon: simplified class defaults.
    if (['fighter', 'paladin', 'barbarian'].includes(this.charClass.id)) return 10;
    if (['ranger', 'cleric'].includes(this.charClass.id)) return 8;
    if (['rogue', 'druid'].includes(this.charClass.id)) return 6;
    return 4; // wizard etc.
  }

  addXp(amount: number): boolean {
    this.xp += amount;
    const needed = this.xpToNext();
    if (this.xp >= needed) {
      this.levelUp();
      return true;
    }
    return false;
  }

  xpToNext(): number {
    return this.level * 300;
  }

  levelUp() {
    this.level++;
    const hpGain = rollDice(1, this.charClass.hitDie) + this.conMod;
    this.baseMaxHp += Math.max(1, hpGain);
    this.hp = this.maxHp; // full heal on level up
    this.maxHitDice = this.level;
    this.recomputeSpellSlots();
  }

  /** Spend up to `maxDice` remaining hit dice to heal (die + CON mod each). */
  shortRest(maxDice: number = 2): string {
    const notes: string[] = [];
    // Pact Magic: a warlock's spell slots return on a short rest.
    if (getCasterType(this.charClass.id) === 'pact') {
      const before = this.spellSlotsRemaining;
      this.spellSlots = { ...this.maxSpellSlots };
      const after = this.spellSlotsRemaining;
      if (after > before) {
        notes.push(`Pact Magic restores ${after - before} spell slot${after - before === 1 ? '' : 's'}.`);
      }
    }
    if (this.hp >= this.maxHp || this.hitDiceRemaining <= 0) {
      return notes.length > 0 ? `${this.name} rests — ${notes.join(' ')}` : `${this.name} rests but needs nothing.`;
    }
    let healedTotal = 0;
    let diceSpent = 0;
    while (diceSpent < maxDice && this.hitDiceRemaining > 0 && this.hp < this.maxHp) {
      this.hitDiceRemaining--;
      diceSpent++;
      healedTotal += Math.max(1, rollDice(1, this.charClass.hitDie) + this.conMod);
    }
    this.hp = Math.min(this.hp + healedTotal, this.maxHp);
    if (diceSpent > 0) {
      pushDiceRoll({
        kind: 'hit-die',
        diceType: ('d' + this.charClass.hitDie) as DiceType,
        label: `${this.name} spends Hit Dice on a short rest`,
        expression: `${diceSpent}d${this.charClass.hitDie}${this.conMod >= 0 ? '+' : ''}${this.conMod}`,
        rolls: [healedTotal],
        total: healedTotal,
        outcome: 'success',
      });
    }
    const diceMsg = `${this.name} spends ${diceSpent} Hit Die${diceSpent === 1 ? '' : 's'} on a short rest, healing ${healedTotal} HP (${this.hp}/${this.maxHp}).`;
    return notes.length > 0 ? `${diceMsg} ${notes.join(' ')}` : diceMsg;
  }

  /** Full recovery: HP, half total hit dice, spell uses, conditions, concentration. */
  longRest(): string[] {
    const messages: string[] = [];
    this.hp = this.maxHp;
    this.hitDiceRemaining = Math.min(this.level, Math.max(1, Math.floor(this.level / 2)) + this.hitDiceRemaining);
    this.hitDiceRemaining = Math.min(this.hitDiceRemaining, this.level);
    this.spellSlots = { ...this.maxSpellSlots };
    if (this.conditions.length > 0) {
      messages.push(`${this.name} shakes off all lingering conditions.`);
    }
    this.conditions = [];
    this.breakConcentration();
    // A long rest lifts one level of exhaustion.
    if (this.exhaustion > 0) {
      this.exhaustion--;
      messages.push(`${this.name} recovers from exhaustion (${this.exhaustion}/6 remaining).`);
    }
    // A night at camp brings even the fallen back around.
    this.resetDeathState();
    if (this.isDead) {
      this.isDead = false;
      messages.push(`${this.name} is carried back from the brink by the campfire.`);
    }
    return messages.length > 0 ? messages : [`${this.name} wakes fully restored.`];
  }

  /** Roll a skill check */
  skillCheck(ability: Ability, dc: number): boolean {
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + abilityModifier(this.abilities[ability]);
    return total >= dc;
  }

  addToInventory(item: InventoryItem) {
    this.inventory.push(item);
  }

  hasItem(itemId: string): boolean {
    return this.inventory.some(i => i.id === itemId);
  }

  useItem(itemId: string): InventoryItem | undefined {
    const idx = this.inventory.findIndex(i => i.id === itemId);
    if (idx >= 0) {
      const [item] = this.inventory.splice(idx, 1);
      return item;
    }
    return undefined;
  }
}
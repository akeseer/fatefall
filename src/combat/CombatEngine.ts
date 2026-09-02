import { GameCharacter } from '../entities/Character';
import { Monster } from '../entities/Monster';
import { Party } from '../entities/Party';
import { Spell, SPELLS, abilityModifier, cantripDice, ordinal, rollDice } from '../data/gameData';
import { Ability } from '../data/gameData';
import { generateCombatTurnNarration, generateSpellDescription } from '../ai/LoreGenerator';
import {
  AttackOpts,
  BOSS_KITS,
  CONDITION_META,
  ConditionId,
  FRIGHTFUL_PRESENCE_DC,
  LEGENDARY_ACTIONS_PER_ROUND,
  LegendaryActionDef,
  MONSTER_SPECIALS,
  SaveResult,
  getAttackModifiers,
  hasCondition,
  incapacityMessage,
  removeConditionsFromSource,
  removeCondition,
  rollD20,
  savingThrow,
  tickConditions,
} from '../rules/Rules';
import { DiceType, pushDiceRoll } from '../rules/DiceEvents';
import { consumeLuckDieIfAny } from '../rules/LuckDie';

export interface CombatLog {
  round: number;
  messages: string[];
  isOver: boolean;
  winner: 'party' | 'monsters' | null;
}

export interface CombatAction {
  type: 'attack' | 'spell' | 'defend' | 'flee';
  actor: GameCharacter;
  target?: GameCharacter | Monster;
  spell?: Spell;
}

/**
 * A DM command chosen from the FF-style battle menu. The AI executes it —
 * target selection, rolls and narration stay engine-side.
 */
export type PartyCommand =
  | { type: 'attack' }
  | { type: 'spell'; spellId: string }
  | { type: 'item'; itemId: string; holderId: string; itemName?: string }
  | { type: 'flee' };

export class CombatEngine {
  public isActive: boolean = false;
  /** Extra AC for the party this fight (e.g. a barricaded chokepoint). */
  public defenseBonus: number = 0;
  public party: Party;
  public monsters: Monster[] = [];
  public log: CombatLog = { round: 0, messages: [], isOver: false, winner: null };
  public initiativeOrder: (GameCharacter | Monster)[] = [];
  public currentTurnIndex: number = 0;

  // Bless (party-wide concentration buff)
  public partyBlessRounds: number = 0;
  public blessSourceId: string = '';

  /** Kinds the party knows cold: template id → flat attack bonus ("we know how they fight"). */
  public knownFoeBonus: Record<string, number> = {};

  /** Active potion buffs: character id → bonuses, ticking down each turn. */
  public potionBuffs: Record<string, { damageBonus: number; extraAttacks: number; turns: number }> = {};
  /** Hero whose turn is paused awaiting an FF-command-menu decision. */
  public pendingDecision: GameCharacter | null = null;
  /** Master switch: pause on every conscious hero's turn for the command menu. */
  public decisionPause: boolean = false;

  /** Town-sourced combat buffs (enchant, blessing, armor upgrade). Cleared after N fights. */
  public townBuffDamage: number = 0;
  public townBuffAC: number = 0;
  public townBuffSaveBonus: number = 0;
  /** Number of fights remaining for the town buff. Decrement in endCombat. */
  public townBuffFightsLeft: number = 0;

  /** Weather attack modifier: storms/gales throw off accents (neg = harsher). Applied in weapon & monster attacks. */
  public weatherAttackMod: number = 0;
  /** Weather spell-power bonus (arcane aurora empowers casters). */
  public weatherSpellMod: number = 0;
  /** Gloom day: the veil thins and undead strike harder (+1 attack, +2 dmg). */
  public gloomDayUndeadBonus: number = 0;
  /** Party forged a silvered weapon: +1 damage to all, extra vs shapeshifters. */
  public silveredWeapon: boolean = false;
  /** Smith moon-contract tier — deeper tempering hits shapeshifters harder. */
  public moonForgeLevel: number = 1;
  /** Legendary upgrade from the hidden moon-forge: bonus to all strikes. */
  public moonForgeBlade: boolean = false;
  /** Full moon: moon-borne lycanthropes howl with renewed fury (+1 attack, +2 dmg). */
  public fullMoonLycanthropeBonus: number = 0;

  /** Tavern rumor buff fields (stack with town buffs). */
  public tavernBuffDamage: number = 0;
  public tavernBuffAC: number = 0;
  public tavernBuffAttack: number = 0;
  public tavernBuffGoldFind: number = 0;
  public tavernBuffXp: number = 0;
  public tavernBuffFightsLeft: number = 0;

  /** Grant a potion buff to a party member (Speed, Giant Strength…). */
  addPotionBuff(characterId: string, buff: { damageBonus: number; extraAttacks: number; turns: number }) {
    const existing = this.potionBuffs[characterId];
    this.potionBuffs[characterId] = existing
      ? {
          damageBonus: existing.damageBonus + buff.damageBonus,
          extraAttacks: Math.max(existing.extraAttacks, buff.extraAttacks),
          turns: Math.max(existing.turns, buff.turns),
        }
      : { ...buff };
  }

  constructor(party: Party) {
    this.party = party;
  }

  startCombat(monsters: Monster[]) {
    this.monsters = monsters;
    this.isActive = true;
    this.log = { round: 0, messages: [], isOver: false, winner: null };
    this.rollInitiative();
    this.checkFrightfulPresence();
    this.setupBosses();
    // The full moon wakes the lycanthrope in every were-beast present.
    if (this.fullMoonLycanthropeBonus > 0) {
      for (const m of this.monsters) {
        if (!m.isAlive) continue;
        if (/wolf|werewolf|were|lycanthrope|jackalwere|werebear|wererat|weretiger|wereboar|wercat/i.test(m.template.name)) {
          const line = m.awakenMoonHowl();
          if (line) this.log.messages.push(`🌕 ${line}`);
        }
      }
    }
  }

  /** Legendary bosses currently alive in this fight (drives the boss bar). */
  getBosses(): Monster[] {
    return this.monsters.filter(m => m.isAlive && m.isBoss);
  }

  /** Announce a boss fight, grant legendary actions, and fire the first lair action. */
  private setupBosses() {
    const bosses = this.getBosses();
    if (bosses.length === 0) return;
    for (const boss of bosses) {
      const kit = BOSS_KITS[boss.template.id];
      if (!kit) continue;
      boss.legendaryActions = LEGENDARY_ACTIONS_PER_ROUND;
      if (kit.legendaryResistances) boss.legendaryResistances = kit.legendaryResistances;
      const parts: string[] = [];
      if (kit.legendary.length > 0) parts.push(`${LEGENDARY_ACTIONS_PER_ROUND} legendary actions per round`);
      if (kit.lair) parts.push('it commands this lair');
      if (kit.legendaryResistances) parts.push(`${kit.legendaryResistances} legendary resistance${kit.legendaryResistances > 1 ? 's' : ''}`);
      this.log.messages.push(`\uD83D\uDC51 ${boss.template.name} is a legendary foe \u2014 ${parts.join(', ')}!`);
    }
    // The lair acts at initiative 20 — the very start of the fight.
    this.lairTurn();
  }

  /** Dragons, devils, and banshees test the party's nerve as combat begins. */
  private checkFrightfulPresence() {
    let maxDc = 0;
    for (const m of this.monsters) {
      if (!m.isAlive) continue;
      const dc = FRIGHTFUL_PRESENCE_DC[m.template.id];
      if (dc) maxDc = Math.max(maxDc, dc);
    }
    if (maxDc === 0) return;

    this.log.messages.push(`A terrifying presence crushes down on the party! (Frightful Presence, WIS DC ${maxDc})`);
    for (const member of this.party.alive) {
      const result = member.makeSavingThrow('wis', maxDc, this.townBuffSaveBonus);
      if (result.success) {
        this.log.messages.push(`${member.name} steels their nerve. (WIS ${result.total})`);
      } else {
        member.applyCondition('frightened', 3, 'Frightened');
        this.log.messages.push(`${member.name} is gripped by fear! (WIS ${result.total})`);
      }
    }
  }

  rollInitiative() {
    this.initiativeOrder = [];
    // All party members and monsters, sorted by initiative roll
    const entries: { entity: GameCharacter | Monster; roll: number }[] = [];

    for (const member of this.party.alive) {
      // A fated Luck die decides the initiative outright.
      const fate = consumeLuckDieIfAny(member.name);
      // A deafened combatant can't hear the fight begin.
      const rolls = fate ? [fate.value] : member.hasCondition('deafened') ? [rollD20(), rollD20()] : [rollD20()];
      const d20 = fate ? fate.value : member.hasCondition('deafened') ? Math.min(...rolls) : rolls[0];
      const roll = d20 + member.dexMod;
      pushDiceRoll({
        kind: 'initiative',
        diceType: 'd20',
        label: `${member.name} initiative`,
        expression: `${member.hasCondition('deafened') ? '2d20-dis' : 'd20'}${member.dexMod >= 0 ? '+' : ''}${member.dexMod}`,
        rolls,
        total: roll,
        outcome: d20 === 20 ? 'crit' : d20 === 1 ? 'fumble' : 'neutral',
      });
      entries.push({ entity: member, roll });
    }
    for (const monster of this.monsters.filter(m => m.isAlive)) {
      const d20 = rollD20();
      const mod = abilityModifier(monster.template.abilities.dex);
      const roll = d20 + mod;
      pushDiceRoll({
        kind: 'initiative',
        diceType: 'd20',
        label: `${monster.template.name} initiative`,
        expression: `d20${mod >= 0 ? '+' : ''}${mod}`,
        rolls: [d20],
        total: roll,
        outcome: d20 === 20 ? 'crit' : d20 === 1 ? 'fumble' : 'neutral',
      });
      entries.push({ entity: monster, roll });
    }

    entries.sort((a, b) => b.roll - a.roll);
    this.initiativeOrder = entries.map(e => e.entity);
    this.currentTurnIndex = 0;

    this.log.messages.push(`--- Combat begins! Initiative rolled. ---`);
    for (const entry of entries) {
      const name = entry.entity instanceof GameCharacter ? entry.entity.name : entry.entity.template.name;
      this.log.messages.push(`${name}: Initiative ${entry.roll}`);
    }
  }

  /** Advance combat one action (one entity's turn) */
  step(): CombatLog {
    if (!this.isActive) return this.log;

    // Check if combat is over
    if (this.monsters.every(m => !m.isAlive)) {
      this.endCombat('party');
      return this.log;
    }
    // Monsters win when no one is left standing — downed allies roll death
    // saves to buy time, but once the whole party is down the fight is lost.
    if (!this.party.hasConscious) {
      this.endCombat('monsters');
      return this.log;
    }

    // Remove dead entities from initiative order
    this.initiativeOrder = this.initiativeOrder.filter(e => {
      if (e instanceof GameCharacter) return e.isAlive;
      return e.isAlive;
    });

    if (this.initiativeOrder.length === 0) return this.log;

    // Wrap around
    if (this.currentTurnIndex >= this.initiativeOrder.length) {
      this.currentTurnIndex = 0;
      this.log.round++;
      if (this.partyBlessRounds > 0) {
        this.partyBlessRounds--;
        if (this.partyBlessRounds === 0) {
          this.log.messages.push('The blessing fades from the party.');
        }
      }
      // The lair acts at the top of each round (initiative 20).
      this.lairTurn();
    }

    const actor = this.initiativeOrder[this.currentTurnIndex];

    // A legendary boss regains its legendary actions at the start of its turn.
    if (actor instanceof Monster && actor.isBoss) {
      actor.legendaryActions = LEGENDARY_ACTIONS_PER_ROUND;
    }

    // Conditions tick down at the start of the actor's turn.
    const expired = tickConditions(actor);
    const actorName = actor instanceof GameCharacter ? actor.name : actor.template.name;
    for (const name of expired) {
      this.log.messages.push(`${actorName} is no longer ${name}.`);
    }

    // Dying characters roll death saves instead of acting; stabilized ones lie still.
    if (actor instanceof GameCharacter && actor.hp <= 0) {
      if (actor.isDying) {
        const msg = actor.rollDeathSave();
        if (msg) this.log.messages.push(msg);
      } else {
        this.log.messages.push(`${actor.name} lies stabilized and unconscious.`);
      }
      this.currentTurnIndex++;
      return this.log;
    }

    // Paralyzed, stunned, unconscious, incapacitated, or petrified actors lose their turn.
    const blocked = incapacityMessage(actor);
    if (blocked) {
      this.log.messages.push(blocked);
      this.currentTurnIndex++;
      return this.log;
    }

    // A prone combatant scrambles upright as their turn begins (they paid
    // for it: attackers had advantage on them while they were down).
    if (hasCondition(actor, 'prone')) {
      removeCondition(actor, 'prone');
      this.log.messages.push(`${actorName} scrambles back to their feet.`);
    }

    // Potion buffs tick down as the member's turn begins.
    if (actor instanceof GameCharacter && this.potionBuffs[actor.id]) {
      const buff = this.potionBuffs[actor.id];
      buff.turns--;
      if (buff.turns <= 0) {
        delete this.potionBuffs[actor.id];
        this.log.messages.push(`The potion's magic fades from ${actor.name}.`);
      }
    }

    if (actor instanceof GameCharacter) {
      // A DM-ordered item use already spent this member's action for the round.
      if (actor.pendingItemUse) {
        actor.pendingItemUse = false;
        this.log.messages.push(`${actor.name} is busy with the item's effects — no time for more.`);
      } else if (this.decisionPause) {
        // FF-style command menu: pause on the hero's turn until the DM picks.
        this.pendingDecision = actor;
        this.log.messages.push(`⏸ ${actor.name} awaits your command…`);
        return this.log;
      } else {
        this.partyTurn(actor);
      }
    } else {
      this.monsterTurn(actor);
    }

    this.currentTurnIndex++;

    // A legendary boss strikes at the end of any other creature's turn.
    this.tryLegendaryAction(actor);

    return this.log;
  }

  /** The hero awaiting a command-menu decision (null when not paused). */
  get decisionActor(): GameCharacter | null {
    return this.pendingDecision;
  }

  /**
   * Spells the paused hero can actually cast right now (level affordable).
   * Drives the Spell submenu in the battle window.
   */
  getDecisionSpells(hero: GameCharacter): Spell[] {
    return hero.knownSpells
      .map(id => SPELLS.find(s => s.id === id))
      .filter((s): s is Spell => Boolean(s))
      .filter(s => hero.canCastSpell(s.level));
  }

  /**
   * Execute a command chosen from the FF command menu, then resume the turn.
   * The AI handles targeting and rolls; the DM picks the intent.
   */
  submitCommand(cmd: PartyCommand): void {
    const hero = this.pendingDecision;
    if (!hero || !this.isActive) return;
    this.pendingDecision = null;

    if (cmd.type === 'item') {
      // Items resolve game-side (potion/scroll effects); mark the action spent.
      hero.pendingItemUse = true;
      this.onItemCommand?.(cmd.itemId, cmd.holderId, hero);
      this.currentTurnIndex++;
      return;
    }

    if (cmd.type === 'flee') {
      this.onFleeCommand?.(hero);
      return;
    }

    this.partyTurn(hero, cmd);
    this.currentTurnIndex++;
    this.tryLegendaryAction(hero);
  }

  /** Game-side hook: executes an item use for the acting hero (potion/scroll). */
  public onItemCommand?: (itemId: string, holderId: string, actor: GameCharacter) => void;
  /** Game-side hook: the party attempts to flee the fight. */
  public onFleeCommand?: (caller: GameCharacter) => void;

  /** Fire one legendary action from a boss that still has actions left (never on its own turn). */
  private tryLegendaryAction(justActed: GameCharacter | Monster) {
    if (!this.isActive) return;
    // The boss does not act at the end of its own turn.
    if (justActed instanceof Monster && justActed.isBoss) return;
    if (this.monsters.every(m => !m.isAlive)) return;

    for (const boss of this.getBosses()) {
      if (boss.legendaryActions <= 0) continue;
      // Incapacitated bosses cannot take legendary actions.
      if (incapacityMessage(boss)) continue;
      const kit = BOSS_KITS[boss.template.id];
      if (!kit || kit.legendary.length === 0) continue;
      const available = kit.legendary.filter(d => boss.legendaryActions >= (d.cost ?? 1));
      if (available.length === 0) continue;
      const def = available[Math.floor(Math.random() * available.length)];
      this.useLegendaryAction(boss, def);
      return; // one legendary action per foreign turn
    }
  }

  /** Resolve a boss's legendary action against a random party member. */
  private useLegendaryAction(boss: Monster, def: LegendaryActionDef) {
    const cost = def.cost ?? 1;
    boss.legendaryActions -= cost;
    const alive = this.party.alive;
    if (alive.length === 0) return;
    const target = alive[Math.floor(Math.random() * alive.length)];

    this.log.messages.push(`\u26A1 ${boss.template.name} lashes out \u2014 ${def.name}! ${def.description}.`);

    let damage = 0;
    let failedSave = false;
    if (def.damage) {
      const { count, size } = parseDice(def.damage);
      const bonus = def.damageBonus ?? 0;
      damage = rollDice(count, size) + bonus;
    }
    if (def.saveAbility && def.dc) {
      const result = target.makeSavingThrow(def.saveAbility, def.dc, this.townBuffSaveBonus);
      failedSave = !result.success;
      if (def.damage && !failedSave) damage = Math.floor(damage / 2);
      this.log.messages.push(`${target.name} ${failedSave ? 'fails the save' : 'holds against it'} (${def.saveAbility.toUpperCase()} ${result.total} vs DC ${def.dc})`);
    }

    if (def.damage) {
      const { size } = parseDice(def.damage);
      pushDiceRoll({
        kind: 'damage',
        diceType: ('d' + size) as DiceType,
        label: `${boss.template.name} \u2014 ${def.name} on ${target.name}`,
        expression: `${def.damage}${(def.damageBonus ?? 0) > 0 ? '+' : ''}${def.damageBonus ?? ''}`,
        rolls: [damage],
        total: damage,
        outcome: 'neutral',
      });
      this.log.messages.push(target.takeDamage(damage));
    }

    if (def.condition && (!def.saveAbility || failedSave)) {
      const meta = CONDITION_META[def.condition];
      target.applyCondition(def.condition, def.durationTurns ?? 2, meta.label, boss.id);
      this.log.messages.push(`${target.name} is ${meta.label.toLowerCase()}!`);
    }
  }

  /** The lair acts at the top of each round while its boss is alive. */
  private lairTurn() {
    if (!this.isActive) return;
    const boss = this.getBosses().find(b => BOSS_KITS[b.template.id]?.lair);
    if (!boss) return;
    const kit = BOSS_KITS[boss.template.id];
    const lair = kit.lair!;
    const def = lair[Math.floor(Math.random() * lair.length)];

    this.log.messages.push(`\uD83C\uDFF0 The lair of the ${boss.template.name} stirs \u2014 ${def.description}!`);

    if (def.damage) {
      const { count, size } = parseDice(def.damage);
      const bonus = def.damageBonus ?? 0;
      let sampleDamage = 0;
      for (const target of this.party.alive) {
        let damage = rollDice(count, size) + bonus;
        if (def.saveAbility && def.dc) {
          const result = target.makeSavingThrow(def.saveAbility, def.dc, this.townBuffSaveBonus);
          if (result.success) damage = Math.floor(damage / 2);
          this.log.messages.push(`${target.name} ${result.success ? 'shrugs off part of it' : 'is caught in the blast'} (${def.saveAbility.toUpperCase()} ${result.total} vs DC ${def.dc})`);
        }
        if (sampleDamage === 0) sampleDamage = damage;
        this.log.messages.push(target.takeDamage(damage));
      }
      pushDiceRoll({
        kind: 'damage',
        diceType: ('d' + size) as DiceType,
        label: `${boss.template.name}'s lair \u2014 ${def.name}`,
        expression: `${def.damage}${bonus > 0 ? '+' : ''}${bonus || ''}`,
        rolls: [sampleDamage],
        total: sampleDamage,
        outcome: 'neutral',
      });
    }
    if (def.condition) {
      for (const target of this.party.alive) {
        let applied = true;
        if (def.saveAbility && def.dc) {
          const result = target.makeSavingThrow(def.saveAbility, def.dc, this.townBuffSaveBonus);
          applied = !result.success;
          this.log.messages.push(`${target.name} ${applied ? 'fails the save' : 'resists'} (${def.saveAbility.toUpperCase()} ${result.total} vs DC ${def.dc})`);
        }
        if (applied) {
          const meta = CONDITION_META[def.condition];
          target.applyCondition(def.condition, def.durationTurns ?? 1, meta.label, boss.id);
          this.log.messages.push(`${target.name} is ${meta.label.toLowerCase()}!`);
        }
      }
    }
  }

  private partyTurn(character: GameCharacter, forced?: PartyCommand) {
    // Find nearest alive monster. A charmed character cannot strike the
    // source of their charm — they'll fight anyone else, or do nothing.
    const charmSource = character.conditions.find(c => c.id === 'charmed')?.sourceId;
    const alive = this.monsters.filter(m => m.isAlive && m.id !== charmSource);
    if (alive.length === 0) {
      if (charmSource) {
        this.log.messages.push(`${character.name} hesitates — they cannot raise a hand against their charmer!`);
      }
      return;
    }

    // Pick target: nearest
    let target = alive[0];
    let minDist = Infinity;
    for (const m of alive) {
      const d = Math.abs(m.tile.x - character.tile.x) + Math.abs(m.tile.y - character.tile.y);
      if (d < minDist) { minDist = d; target = m; }
    }

    // AI decision: attempt a spell the caster can actually afford.
    // Cantrips are always affordable, so a caster out of slots falls back to
    // cantrips instead of swinging a weapon.
    const affordableSpells = character.knownSpells
      .map(id => SPELLS.find(s => s.id === id))
      .filter((s): s is Spell => Boolean(s))
      .filter(s => character.canCastSpell(s.level));

    // A DM command from the FF battle menu overrides the AI's own choice.
    if (forced) {
      if (forced.type === 'spell') {
        const spell = SPELLS.find(s => s.id === forced.spellId);
        if (spell && character.canCastSpell(spell.level) && this.castSpell(character, spell)) return;
        this.log.messages.push(`${character.name} cannot cast that right now — falls back to their blade.`);
      } else if (forced.type === 'flee') {
        this.log.messages.push(`${character.name} looks for an opening to disengage!`);
        return;
      }
      // 'item' commands were executed game-side before the turn; fall through
      // to a weapon attack so the action isn't wasted.
    } else if (affordableSpells.length > 0 && Math.random() < 0.4) {
      const spell = affordableSpells[Math.floor(Math.random() * affordableSpells.length)];
      if (this.castSpell(character, spell)) return;
    }

    // Default: weapon attack with condition modifiers and bless bonus.
    // Martial classes gain Extra Attack: two swings at level 5, three at 11.
    const attacks = character.attackCount;
    const pickTarget = (): Monster | null => {
      const candidates = this.monsters.filter(m => m.isAlive && m.id !== charmSource);
      if (candidates.length === 0) return null;
      let best = candidates[0];
      let bestDist = Infinity;
      for (const m of candidates) {
        const d = Math.abs(m.tile.x - character.tile.x) + Math.abs(m.tile.y - character.tile.y);
        if (d < bestDist) { bestDist = d; best = m; }
      }
      return best;
    };

    // A Speed potion grants a martial flurry on top of Extra Attack.
    const buff = this.potionBuffs[character.id];
    const totalAttacks = attacks + (buff?.extraAttacks ?? 0);
    if (totalAttacks > attacks && this.log.round > 0) {
      this.log.messages.push(`${character.name} moves with hasted speed — ${totalAttacks} attacks!`);
    }
    if (totalAttacks > 1) this.log.messages.push(`${character.name} strikes ${totalAttacks} times in one motion!`);
    for (let i = 0; i < totalAttacks; i++) {
      // If the first swing dropped the target, move on to the next nearest foe.
      if (!target.isAlive) {
        const next = pickTarget();
        if (!next) break;
        target = next;
      }
      this.weaponAttack(character, target);
    }
  }

  /**
   * Choose which slot level to spend for a spell, then spend it.
   * Defaults to the lowest usable slot; the DM's upcast policy — or the AI's
   * read of the fight under 'auto' — can push the caster to deliberately
   * upcast. Only scaling spells (damage/healing/sleep) ever upcast.
   * Returns the slot level used (0 for cantrips), or null if broke.
   */
  private chooseSlotFor(caster: GameCharacter, spell: Spell): number | null {
    if (spell.level <= 0) return 0; // cantrips cost nothing

    const available: number[] = [];
    for (let lvl = spell.level; lvl <= 9; lvl++) {
      if ((caster.spellSlots[lvl] || 0) > 0) available.push(lvl);
    }
    if (available.length === 0) return null;

    const scales = Boolean(spell.damage || spell.healing || spell.id === 'sleep');
    let chosen = available[0]; // default: lowest usable slot
    if (scales) {
      if (this.party.upcastPolicy === 'always') {
        chosen = available[available.length - 1];
      } else if (this.party.upcastPolicy === 'auto' && this.shouldUpcast(caster, spell)) {
        chosen = available.find(lvl => lvl > spell.level) ?? available[available.length - 1];
      }
    }

    caster.spendSlotAt(chosen);
    if (chosen > spell.level) {
      const above = chosen - spell.level;
      this.log.messages.push(`${caster.name} upcasts ${spell.name} into a ${ordinal(chosen)}-level slot \u2014 ${above} level${above === 1 ? '' : 's'} above base!`);
    } else {
      this.log.messages.push(`${caster.name} spends a ${ordinal(chosen)}-level slot on ${spell.name}.`);
    }
    return chosen;
  }

  /** Auto-policy read of the battlefield: upcast when it will meaningfully matter. */
  private shouldUpcast(caster: GameCharacter, spell: Spell): boolean {
    if (spell.damage) {
      const victims = this.monsters.filter(m => m.isAlive);
      if (victims.length === 0) return false;
      const toughestHp = victims.reduce((mx, m) => Math.max(mx, m.hp), 0);
      const avgAllyHp = this.party.conscious.reduce((s, m) => s + m.hp / m.maxHp, 0) / Math.max(1, this.party.conscious.length);
      // A tough foe while the party is hurting — end it faster.
      return toughestHp > 30 && avgAllyHp < 0.5;
    }
    if (spell.healing) {
      const worst = this.party.alive
        .filter(m => m.hp < m.maxHp)
        .sort((a, b) => a.hp - b.hp)[0];
      return Boolean(worst && worst.hp <= Math.ceil(worst.maxHp * 0.25));
    }
    if (spell.id === 'sleep') {
      return this.monsters.filter(m => m.isAlive).length >= 3;
    }
    return false;
  }

  /** Resolve a character spell; returns true when the turn is spent casting. */
  private castSpell(caster: GameCharacter, spell: Spell): boolean {
    // ── Control & support effects ──
    if (spell.id === 'hold_person') {
      const humanoid = this.monsters.find(m => m.isAlive && m.template.type === 'humanoid');
      if (!humanoid) return false;
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      this.beginConcentration(caster, spell.name);
      this.log.messages.push(`${caster.name} casts Hold Person on ${humanoid.template.name}!`);
      const result = monsterAbilitySave(humanoid, 'wis', caster.spellSaveDC);
      if (result.success) {
        this.log.messages.push(`${humanoid.template.name} resists (WIS ${result.total} vs DC ${caster.spellSaveDC}).`);
        if (result.legendaryResisted) {
          this.log.messages.push(`\uD83D\uDEE1 ${humanoid.template.name} burns a legendary resistance!`);
        }
      } else {
        humanoid.applyCondition('paralyzed', 2, 'Paralyzed', `${caster.id}:hold_person`);
        this.log.messages.push(`${humanoid.template.name} freezes mid-stride, paralyzed! (WIS ${result.total} vs DC ${caster.spellSaveDC})`);
      }
      return true;
    }

    if (spell.id === 'sleep') {
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      // Upcast: +2d8 to the pool per slot level above 1st.
      const poolDice = 5 + 2 * Math.max(0, (slotLevel || 1) - 1);
      let pool = rollDice(poolDice, 8);
      this.log.messages.push(`${caster.name} casts Sleep — a wave of drowsiness rolls outward (${poolDice}d8 = ${pool} HP pool)!`);
      const sleepable = this.monsters.filter(m => m.isAlive).sort((a, b) => a.hp - b.hp);
      let dropped = false;
      for (const m of sleepable) {
        if (m.hp <= pool) {
          pool -= m.hp;
          m.applyCondition('unconscious', 3, 'Unconscious');
          this.log.messages.push(`${m.template.name} slumps to the stone, unconscious!`);
          dropped = true;
        }
      }
      if (!dropped) {
        this.log.messages.push('The remaining foes are too hardy to fall asleep.');
      }
      return true;
    }

    if (spell.id === 'bless') {
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      this.beginConcentration(caster, spell.name);
      this.partyBlessRounds = 3;
      this.blessSourceId = `${caster.id}:bless`;
      this.log.messages.push(`${caster.name} casts Bless! The party gains +1d4 on attack rolls while concentration holds.`);
      return true;
    }

    if (spell.id === 'entangle') {
      const victims = this.monsters.filter(m => m.isAlive);
      if (victims.length === 0) return false;
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      this.beginConcentration(caster, spell.name);
      this.log.messages.push(`${caster.name} casts Entangle — grasping vines erupt across the floor!`);
      let caught = 0;
      for (const m of victims) {
        const result = monsterAbilitySave(m, 'str', caster.spellSaveDC);
        if (result.success) {
          this.log.messages.push(`${m.template.name} tears free of the vines (STR ${result.total} vs DC ${caster.spellSaveDC}).`);
          if (result.legendaryResisted) {
            this.log.messages.push(`\uD83D\uDEE1 ${m.template.name} burns a legendary resistance!`);
          }
        } else {
          m.applyCondition('restrained', 2, 'Restrained', `${caster.id}:entangle`);
          this.log.messages.push(`${m.template.name} is tangled in the grasping vines — restrained! (STR ${result.total} vs DC ${caster.spellSaveDC})`);
          caught++;
        }
      }
      if (caught === 0) this.log.messages.push('The vines find no purchase.');
      return true;
    }

    if (spell.id === 'invisibility') {
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      this.beginConcentration(caster, spell.name);
      caster.applyCondition('invisible', 3, 'Invisible', `${caster.id}:invisibility`);
      this.log.messages.push(`${caster.name} fades from view — invisible! Attacks against them now have disadvantage.`);
      return true;
    }

    // ── Healing ──
    if (spell.healing) {
      const injured = this.party.alive
        .filter(m => m.hp < m.maxHp)
        .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
      if (injured.length === 0) return false;
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      const ally = injured[0];
      const [dicePart] = spell.healing.split('+');
      const [diceCount, diceSize] = dicePart.split('d').map(Number);
      // Upcast: +1 die per slot level above the spell's base level.
      let dice = diceCount || 1;
      if (slotLevel > spell.level) dice += slotLevel - spell.level;
      const healing = rollDice(dice, diceSize || 4) + caster.spellcastingMod;
      this.log.messages.push(`${caster.name} casts ${spell.name}!`);
      this.log.messages.push(ally.heal(healing));
      return true;
    }

    // ── Damage spells: targets now make real saving throws ──
    if (spell.damage) {
      const victims = this.monsters.filter(m => m.isAlive);
      if (victims.length === 0) return false;
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      const victim = victims[Math.floor(Math.random() * victims.length)];
      const [dicePart] = spell.damage.split(' ');
      const [diceCount, diceSize] = dicePart.split('d').map(Number);
      let dice = diceCount || 1;
      if (spell.level <= 0) {
        // Cantrips scale with caster level: 2 dice at 5th, 3 at 11th, 4 at 17th.
        dice = cantripDice(caster.level);
        if (dice > (diceCount || 1)) {
          this.log.messages.push(`${spell.name} surges to ${dice}d${diceSize || 4} as ${caster.name} grows in power!`);
        }
      }
      // Upcast: +1 die per slot level above the spell's base level.
      if (slotLevel > spell.level) dice += slotLevel - spell.level;
      let damage = rollDice(dice, diceSize || 4) + caster.spellcastingMod;
      // An arcane aurora sharpens raw spellpower.
      if (this.weatherSpellMod !== 0 && spell.level > 0) {
        damage += this.weatherSpellMod;
      }

      if (spell.save) {
        const result = monsterAbilitySave(victim, spell.save, caster.spellSaveDC);
        if (result.success) {
          damage = Math.floor(damage / 2);
          this.log.messages.push(`${victim.template.name} partially resists ${spell.name} (${spell.save.toUpperCase()} ${result.total} vs DC ${caster.spellSaveDC}).`);
          if (result.legendaryResisted) {
            this.log.messages.push(`\uD83D\uDEE1 ${victim.template.name} burns a legendary resistance!`);
          }
        } else {
          this.log.messages.push(`${victim.template.name} fails the save against ${spell.name}! (${spell.save.toUpperCase()} ${result.total} vs DC ${caster.spellSaveDC})`);
        }
      }

      pushDiceRoll({
        kind: 'damage',
        diceType: ('d' + (diceSize || 4)) as DiceType,
        label: `${caster.name} casts ${spell.name} on ${victim.template.name}`,
        expression: `${dice}d${diceSize || 4}${caster.spellcastingMod >= 0 ? '+' : ''}${caster.spellcastingMod}${spell.save ? ` (${spell.save.toUpperCase()} save)` : ''}`,
        rolls: [damage],
        total: damage,
        outcome: 'neutral',
      });
      const narration = generateCombatTurnNarration({
        attackerName: caster.name,
        attackerClass: caster.charClass.id,
        defenderName: victim.template.name,
        defenderType: 'monster',
        spellName: spell.name,
        hit: true,
        damage: damage,
        critical: false,
        killingBlow: !victim.isAlive,
      });
      this.log.messages.push(narration);
      this.log.messages.push(victim.takeDamage(damage));
      return true;
    }

    return false; // Utility spell with no battlefield use here
  }

  /** Track concentration; casting again ends whatever was held before. */
  private beginConcentration(caster: GameCharacter, spellName: string): void {
    const previous = caster.startConcentration(spellName, `${caster.id}:${slug(spellName)}`);
    if (previous) {
      const previousSource = `${caster.id}:${slug(previous)}`;
      let endedSomething = false;
      for (const m of this.monsters) {
        if (removeConditionsFromSource(m, previousSource)) endedSomething = true;
      }
      this.log.messages.push(`${caster.name}'s earlier ${previous} fades as they weave new magic.${endedSomething ? ' Its effects end.' : ''}`);
    }
  }

  /** Weapon attack applying advantage/disadvantage, bless, and auto-crits. */
  private weaponAttack(attacker: GameCharacter, target: Monster): void {
    const mods = getAttackModifiers(attacker, target);

    // Paralyzed or sleeping defenders are automatically crit.
    if (mods.autoCrit) {
      const dice = attacker.level >= 5 ? 4 : 2;
      const weaponDie = attacker.getWeaponDamageDie();
      const damage = rollDice(dice, weaponDie) + attacker.damageBonus;
      pushDiceRoll({
        kind: 'damage',
        diceType: ('d' + weaponDie) as DiceType,
        label: `${attacker.name} auto-crits the helpless ${target.template.name}`,
        expression: `${dice}d${weaponDie}${attacker.damageBonus >= 0 ? '+' : ''}${attacker.damageBonus}`,
        rolls: [damage],
        total: damage,
        outcome: 'crit',
      });
      this.log.messages.push(`${attacker.name} strikes the helpless ${target.template.name} — automatic critical hit for ${damage} damage!`);
      this.log.messages.push(target.takeDamage(damage, { crit: true }));
      return;
    }

    const opts: AttackOpts = { advantage: mods.advantage, disadvantage: mods.disadvantage };
    if (this.partyBlessRounds > 0) {
      opts.attackRollBonus = rollDice(1, 4);
    }
    // Battle-worn knowledge: the party has slain this kind many times and
    // knows its openings — a flat edge on every strike against it.
    const known = this.knownFoeBonus[target.template.id] ?? 0;
    if (known > 0) {
      opts.attackRollBonus = (opts.attackRollBonus || 0) + known;
    }
    // Giant Strength: the potion's fury adds weight to every blow.
    const strBuff = this.potionBuffs[attacker.id]?.damageBonus ?? 0;
    if (strBuff > 0) {
      opts.damageBonus = (opts.damageBonus || 0) + strBuff;
    }
    // Town enchantment: the blacksmith's forge adds elemental power.
    if (this.townBuffDamage > 0) {
      opts.damageBonus = (opts.damageBonus || 0) + this.townBuffDamage;
    }
    // Tavern rumor buff: extra damage and attack.
    if (this.tavernBuffDamage > 0) {
      opts.damageBonus = (opts.damageBonus || 0) + this.tavernBuffDamage;
    }
    if (this.tavernBuffAttack > 0) {
      opts.attackRollBonus = (opts.attackRollBonus || 0) + this.tavernBuffAttack;
    }
    // Storm or gale weather throws off every strike.
    if (this.weatherAttackMod !== 0) {
      opts.attackRollBonus = (opts.attackRollBonus || 0) + this.weatherAttackMod;
    }
    // A forged silvered weapon bites true on all flesh and doubly on the changed.
    if (this.silveredWeapon) {
      const isShifter = /were|lycanthrope|vampire|ghast|revenant|jackalwere|changeling|doppelganger|hag/i.test(target.template.name);
      opts.damageBonus = (opts.damageBonus || 0) + (isShifter ? 1 + this.moonForgeLevel : 1);
    }
    // The moon-forge blade hums on every stroke — and sings louder on a critical.
    if (this.moonForgeBlade) {
      opts.damageBonus = (opts.damageBonus || 0) + 2;
    }

    const result = attacker.attack(target, opts);
    // The finished moon-forge edge bites deepest when the strike lands true and hard.
    if (this.moonForgeBlade && result.hit && (result.message.includes('CRIT') || result.message.includes('CRITICAL'))) {
      result.damage += 4;
    }
    const narration = generateCombatTurnNarration({
      attackerName: attacker.name,
      attackerClass: attacker.charClass.id,
      defenderName: target.template.name,
      defenderType: 'monster',
      hit: result.hit,
      damage: result.damage,
      critical: result.message.includes('CRITICAL'),
      killingBlow: result.hit && !target.isAlive,
    });
    this.log.messages.push(narration);
    if (result.hit) {
      this.log.messages.push(target.takeDamage(result.damage, { crit: result.message.includes('CRITICAL') }));
    }
  }

  private monsterTurn(monster: Monster) {
    // Pick random alive party member
    const alive = this.party.alive;
    if (alive.length === 0) return;

    const target = alive[Math.floor(Math.random() * alive.length)];
    const mods = getAttackModifiers(monster, target);
    // Gloom-day undead strike with supernatural fury (full-moon lycanthropes
    // are handled by their own awakening transformation in startCombat).
    const gloom = monster.template.type === 'undead' ? this.gloomDayUndeadBonus : 0;
    // The fury bonus shows as a lower AC to beat (i.e. an easier hit) and a
    // flat damage bump after the strike lands.
    const effectiveAc = target.ac + this.defenseBonus + this.townBuffAC + this.tavernBuffAC
      + Math.max(0, -this.weatherAttackMod)
      - gloom;
    const result = monster.attack(effectiveAc, mods);
    if (gloom > 0 && result.hit) result.damage += 2;
    // Rich combat narration
    const narration = generateCombatTurnNarration({
      attackerName: monster.template.name,
      defenderName: target.name,
      defenderType: 'party',
      hit: result.hit,
      damage: result.damage,
      critical: result.message.includes('CRIT'),
      killingBlow: result.hit && !target.isAlive,
    });      this.log.messages.push(narration);
    if (result.hit) {
      // Strikes against a downed character are automatic critical hits.
      const crit = result.message.includes('CRIT') || target.isDying;
      this.log.messages.push(target.takeDamage(result.damage, { crit }));
      this.applyMonsterSpecial(monster, target);
      this.handleConcentrationBreak(target);
    }
  }

  /** Signature rider effects resolved as genuine saving throws. */
  private applyMonsterSpecial(monster: Monster, target: GameCharacter): void {
    const special = MONSTER_SPECIALS[monster.template.id];
    if (!special) return;

    if (special.kind === 'drain') {
      const extra = rollDice(1, 6);
      this.log.messages.push(`${monster.template.name}'s ${special.description} chills ${target.name}'s soul — ${extra} extra necrotic damage.`);
      this.log.messages.push(target.takeDamage(extra));
      return;
    }

    // Elven blood cannot be paralyzed by ghouls.
    if (special.kind === 'paralyzed' && target.race.id === 'elf') {
      this.log.messages.push(`${target.name}'s elven blood shrugs off the paralysis.`);
      return;
    }

    // Every other rider is a real 5e condition resolved against a save.
    const meta = CONDITION_META[special.kind as keyof typeof CONDITION_META];
    const save = target.makeSavingThrow(special.saveAbility, special.dc);
    if (save.success) {
      this.log.messages.push(`${target.name} saves against the ${special.description}. (${special.saveAbility.toUpperCase()} ${save.total} vs DC ${special.dc})`);
      return;
    }
    target.applyCondition(special.kind as ConditionId, special.durationTurns, meta.label, monster.id);
    const verbs: Partial<Record<ConditionId, string>> = {
      paralyzed: 'stiffens mid-step, paralyzed',
      poisoned: 'reels as venom burns through them — poisoned',
      petrified: 'begins to harden into stone, petrified',
      prone: 'is knocked to the ground, prone',
      charmed: 'falls under a beguiling influence, charmed',
      stunned: 'is stunned senseless',
      frightened: 'is gripped by fear, frightened',
      restrained: 'is tangled and restrained',
      blinded: 'is blinded',
      deafened: 'is deafened',
    };
    const verb = verbs[special.kind as ConditionId] ?? `is ${meta.label.toLowerCase()}`;
    this.log.messages.push(`${target.name} ${verb}! (${special.saveAbility.toUpperCase()} ${save.total} vs DC ${special.dc})`);
  }

  /** When a caster's concentration breaks, their sustained effects unravel. */
  private handleConcentrationBreak(caster: GameCharacter): void {
    if (!caster.pendingConcentrationBreak) return;
    caster.pendingConcentrationBreak = false;

    if (this.partyBlessRounds > 0 && this.blessSourceId.startsWith(caster.id)) {
      this.partyBlessRounds = 0;
      this.blessSourceId = '';
    }

    const prefix = `${caster.id}:`;
    let unraveled = false;
    for (const m of this.monsters) {
      const before = m.conditions.length;
      m.conditions = m.conditions.filter(c => !(c.sourceId || '').startsWith(prefix));
      if (m.conditions.length !== before) unraveled = true;
    }
    if (unraveled) {
      this.log.messages.push('The magic binding the enemy snaps — held creatures are freed!');
    }
  }

  /** Get the tavern gold find bonus for use by the Game after combat. */
  getTavernGoldFindBonus(): number {
    return this.tavernBuffGoldFind;
  }

  private endCombat(winner: 'party' | 'monsters') {
    this.isActive = false;
    this.defenseBonus = 0;
    this.knownFoeBonus = {};
    this.potionBuffs = {};
    // Town buffs last multiple fights — decrement fight counter.
    if (this.townBuffFightsLeft > 0) {
      this.townBuffFightsLeft--;
      if (this.townBuffFightsLeft === 0) {
        this.townBuffDamage = 0;
        this.townBuffAC = 0;
        this.townBuffSaveBonus = 0;
        this.log.messages.push('The town enchantments fade.');
      }
    }
    // Tavern rumor buff fades after N fights.
    if (this.tavernBuffFightsLeft > 0) {
      this.tavernBuffFightsLeft--;
      if (this.tavernBuffFightsLeft === 0) {
        this.tavernBuffDamage = 0;
        this.tavernBuffAC = 0;
        this.tavernBuffAttack = 0;
        this.tavernBuffGoldFind = 0;
        this.tavernBuffXp = 0;
        this.log.messages.push('The tavern rumors fade from memory.');
      }
    }
    for (const member of this.party.members) member.pendingItemUse = false;
    this.log.isOver = true;
    this.log.winner = winner;

    if (winner === 'party') {
      // Grant XP
      let totalXp = 0;
      for (const m of this.monsters) {
        totalXp += m.template.xp;
      }
      const xpEach = Math.ceil(totalXp / Math.max(1, this.party.alive.length));
      // Tavern rumor buff: bonus XP per fight.
      const tavernXpBonus = this.tavernBuffXp > 0 ? this.tavernBuffXp : 0;
      const finalXpEach = xpEach + tavernXpBonus;
      this.log.messages.push(`Victory! +${totalXp} total XP (${finalXpEach} each${tavernXpBonus > 0 ? ' + ' + tavernXpBonus + ' tavern bonus' : ''})`);
      for (const member of this.party.alive) {
        member.addXp(finalXpEach);
      }
      // Bind wounds: anyone down is dragged back to their feet at 1 HP.
      for (const member of this.party.members) {
        if (!member.isDead && member.hp <= 0) {
          member.revive(1);
          this.log.messages.push(`${member.name} is revived at 1 HP as the party binds wounds.`);
        }
      }
      // The party catches its breath: a short rest after every victory.
      this.log.messages.push('The party binds wounds and catches its breath — short rest.');
      for (const restMsg of this.party.shortRest()) {
        this.log.messages.push(restMsg);
      }
    } else {
      this.log.messages.push('The party has been defeated...');
    }
  }

  /** Run the entire combat to completion, returning final log */
  runToCompletion(): CombatLog {
    while (this.isActive) {
      this.step();
    }
    return this.log;
  }
}

/** Monsters save with raw ability modifiers (no proficiency). */
function monsterAbilitySave(monster: Monster, ability: Ability, dc: number): SaveResult {
  const result = savingThrow(abilityModifier(monster.template.abilities[ability]), dc, {
    label: `${monster.template.name} ${ability.toUpperCase()} save`,
  });
  // 5e legendary resistance: a failed save is turned into a success, once per use.
  if (!result.success && monster.legendaryResistances > 0) {
    monster.legendaryResistances -= 1;
    return { ...result, success: true, legendaryResisted: true };
  }
  return result;
}

/** Parse a '2d8' dice expression into count and size. */
function parseDice(expr: string): { count: number; size: number } {
  const [c, s] = expr.toLowerCase().split('d').map(Number);
  return { count: c || 1, size: s || 6 };
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}
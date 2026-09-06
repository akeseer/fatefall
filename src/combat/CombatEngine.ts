import { surgeFor } from './WildMagic';
import { isUndeadKind, isUnholyKind } from '../entities/MonsterKinds';
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
  elementalMultiplier,
  hasCondition,
  incapacityMessage,
  removeConditionsFromSource,
  removeCondition,
  rollD20,
  savingThrow,
  tickConditions,
} from '../rules/Rules';
import { manhattan, Vector2 } from '../engine/types';
import { DiceType, pushDiceRoll } from '../rules/DiceEvents';
import { consumeLuckDieIfAny } from '../rules/LuckDie';
import { chooseMonsterTarget, choosePartyFocus, shouldMonsterFlee, chooseHealTarget, pickLegendaryAction, advanceToward, isFlanking } from './TargetAI';
import { sneakAttackDice, MARK_ABILITIES, resourceRegen, type CombatAbility } from './Abilities';

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
/** A skill as the command menu sees it: the skill, and whether it can be used this turn. */
export interface MenuSkill { ability: CombatAbility; ready: boolean; cooldown: number; reason: string }

export type PartyCommand =
  | { type: 'attack'; targetMonsterId?: string }
  | { type: 'spell'; spellId: string; targetMonsterId?: string; targetAllyId?: string }
  | { type: 'item'; itemId: string; holderId: string; itemName?: string }
  | { type: 'ability'; abilityId?: string }
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

  /**
   * War-room study: a flat bonus to the party's attack rolls for the next few
   * fights. Transient — it is not saved, so a reload forgets it, which is a
   * fair price for a bonus that lasts one battle.
   */
  public warRoomAttackBonus: number = 0;
  public warRoomFightsLeft: number = 0;

  /** Hearth-blessed delve: the party's blows land harder on undead. */
  public hearthBlessedUndeadBonus: number = 0;
  /** The party's light has gone out: monsters strike with advantage. */
  public darkness: boolean = false;
  /** Added to every monster special's DC: the difficulty setting. */
  public dcShift: number = 0;
  /** A bond with an ally standing close: the game says how much, from what it remembers. */
  public bondBonus: ((hero: GameCharacter) => number) | null = null;
  /** Heroes who have spent their reaction this round: a parry, a shield block, a counterspell. */
  private reactionsUsed = new Set<string>();
  /** Bosses that have entered their second phase this fight. */
  private phaseTwo = new Set<string>();
  /** Gloom delve: fear bites harder — added to every frightful-presence DC. */
  public gloomFearDcBonus: number = 0;

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
    this.phaseTwo.clear();
    this.rollInitiative();
    this.checkFrightfulPresence();
    this.setupBosses();
    this.reinforcedThisFight = false;
    this.interceptionUsedThisRound = false;
    this.vendettaNarrationUsed.clear();
    this.rageRounds = {};
    this.marks = {};
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
    // A gloom delve: dread bites harder, so the save is a point steeper.
    maxDc += this.gloomFearDcBonus;

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

    // Check if combat is over — foes slain OR broken and fled.
    if (this.monsters.every(m => !m.isAlive || m.fled)) {
      this.endCombat('party');
      return this.log;
    }
    // Monsters win when no one is left standing — downed allies roll death
    // saves to buy time, but once the whole party is down the fight is lost.
    if (!this.party.hasConscious) {
      this.endCombat('monsters');
      return this.log;
    }

    // Remove dead or fled entities from initiative order
    this.initiativeOrder = this.initiativeOrder.filter(e => {
      if (e instanceof GameCharacter) return e.isAlive;
      return e.isAlive && !e.fled;
    });

    if (this.initiativeOrder.length === 0) return this.log;

    // Wrap around
    if (this.currentTurnIndex >= this.initiativeOrder.length) {
      this.currentTurnIndex = 0;
      this.log.round++;
      this.reactionsUsed.clear();
      // Pools refill a little each round and skills come off cooldown.
      for (const m of this.party.members) {
        if (!m.isAlive) continue;
        if (m.resourceKind !== 'blood') m.resource = Math.min(m.resourceMax, m.resource + resourceRegen(m.resourceKind));
        const cds = this.cooldowns[m.id];
        if (cds) for (const k of Object.keys(cds)) { cds[k]--; if (cds[k] <= 0) delete cds[k]; }
      }
      // The party re-reads the field at the top of each round and designates
      // a focus target so everyone gangs up on one foe instead of scattering.
      const live = this.monsters.filter(m => m.isAlive && !m.fled);
      if (live.length > 0) {
        this.roundFocusMonsterId = choosePartyFocus(this.party, this.monsters.filter(m => m.isAlive && !m.fled)).target.id;
      } else {
        this.roundFocusMonsterId = null;
      }
      // A new round renews the tanks' chance to shield their casters.
      this.interceptionUsedThisRound = false;
      // Rages burn out; marks fade when they lapse or their quarry falls.
      for (const id of Object.keys(this.rageRounds)) {
        this.rageRounds[id]--;
        if (this.rageRounds[id] <= 0) {
          delete this.rageRounds[id];
          const rager = this.party.members.find(m => m.id === id);
          const label = this.furyLabel[id];
          delete this.furyLabel[id];
          if (rager) {
            this.log.messages.push(label === 'wild_shape'
              ? `${rager.name}'s beast shape falls away — fur to skin, claws to hands.`
              : `${rager.name}'s rage gutters out — breath heaving, fists still clenched.`);
          }
        }
      }
      for (const id of Object.keys(this.marks)) {
        const mark = this.marks[id];
        mark.rounds--;
        if (mark.rounds <= 0 || !this.monsters.some(m => m.id === mark.monsterId && m.isAlive)) {
          delete this.marks[id];
        }
      }
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

    // A leeching curse drinks from its bearer as their turn begins.
    if (actor instanceof GameCharacter && actor.hp > 0) {
      const cursed = actor.findCursedEquipped();
      if (cursed && (cursed.curseKind ?? 'leeching') === 'leeching') {
        const msg = actor.takeDamage(1);
        this.log.messages.push(`🩸 The ${cursed.name} feeds — ${msg}`);
      }
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
      } else if (this.queuedOrders.has(actor.id)) {
        // A Tab-queued order (set while another hero's menu was open) executes
        // now instead of re-pausing — the player already decided this turn.
        const cmd = this.queuedOrders.get(actor.id)!;
        this.queuedOrders.delete(actor.id);
        this.log.messages.push(`⏳ ${actor.name} follows the standing order.`);
        this.submitCommandFor(actor, cmd);
      } else if (this.decisionPause) {
        // FF-style command menu: pause on the hero's turn until the DM picks.
        this.pendingDecision = actor;
        this.log.messages.push(`⏸ ${actor.name} awaits your command…`);
        return this.log;
      } else {
        this.partyTurn(actor);
      }
    } else {
      // A battered, alert monster cries out for its kin — once per fight.
      const m = actor as Monster;
      if (
        !this.reinforcedThisFight &&
        m.alertLevel >= 2 &&
        m.isAlive && !m.fled &&
        (m.hp / Math.max(1, m.maxHp) < 0.6 || this.log.round >= 3) &&
        this.onReinforcementsRequested
      ) {
        this.reinforcedThisFight = true;
        this.log.messages.push(`🗣️ ${m.template.name} calls for its kin!`);
        this.onReinforcementsRequested();
      }
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
   * Switch between waiting for the DM on every hero's turn and letting the AI
   * resolve them. Turning the pause off releases whoever is currently held, so
   * the fight resumes on the next tick — without this the game waits forever
   * for a command the player has just stopped being asked for.
   */
  setDecisionPause(on: boolean): void {
    this.decisionPause = on;
    if (!on) {
      this.pendingDecision = null;
      this.queuedOrders.clear();
    }
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

  /** The paused hero's class ability, if usable right now (drives the menu). */
  getDecisionAbility(hero: GameCharacter): CombatAbility | null {
    const ready = this.getDecisionAbilities(hero).filter(x => x.ready);
    return ready.length > 0 ? ready[ready.length - 1].ability : null;
  }

  /** Every skill the hero has, with whether it can be used this turn and why not. */
  getDecisionAbilities(hero: GameCharacter): MenuSkill[] {
    return hero.skills.map(ability => {
      const cd = this.cooldowns[hero.id]?.[ability.id] ?? 0;
      const affordable = hero.canAfford(ability);
      return {
        ability,
        cooldown: cd,
        ready: cd <= 0 && affordable,
        reason: cd > 0 ? `${cd} round${cd === 1 ? '' : 's'}` : !affordable ? (hero.resourceKind === 'blood' ? 'too little blood' : `needs ${ability.cost} ${hero.resourceKind}`) : 'ready',
      };
    });
  }

  private isReady(hero: GameCharacter, a: CombatAbility): boolean {
    return (this.cooldowns[hero.id]?.[a.id] ?? 0) <= 0 && hero.canAfford(a);
  }

  /**
   * Which skill, if any, the hero's own judgement reaches for this turn. Each
   * usable skill is scored against the moment; nothing scores means a plain
   * attack or a spell.
   */
  private chooseAbility(hero: GameCharacter, focus: Monster | null, spellsAffordable: number): CombatAbility | null {
    const foes = this.monsters.filter(m => m.isAlive);
    if (foes.length === 0) return null;
    const hpPct = hero.hp / Math.max(1, hero.maxHp);
    const hurtAlly = this.party.alive.filter(m => m.hp / Math.max(1, m.maxHp) < 0.5).length;
    const worstAlly = Math.min(...this.party.alive.map(m => m.hp / Math.max(1, m.maxHp)));
    const hasSpentSlot = Object.keys(hero.maxSpellSlots).some(l => (hero.spellSlots[Number(l)] ?? 0) < (hero.maxSpellSlots[Number(l)] ?? 0));
    let best: CombatAbility | null = null;
    let bestScore = 0;
    for (const a of hero.skills) {
      if (!this.isReady(hero, a)) continue;
      let score = 0;
      switch (a.effect) {
        case 'heal': score = hpPct < 0.45 ? 8 : 0; break;
        case 'heal_ally': score = worstAlly < 0.4 ? 9 : worstAlly < 0.6 ? 4 : 0; break;
        case 'heal_all': score = hurtAlly >= 2 ? 9 : 0; break;
        case 'rage': score = this.log.round <= 1 || (this.rageRounds[hero.id] ?? 0) <= 0 ? 6 : 0; break;
        case 'inspire': score = this.partyBlessRounds <= 0 ? 6 : 0; break;
        case 'recover': score = hasSpentSlot && spellsAffordable === 0 ? 7 : 0; break;
        case 'ward': score = hpPct < 0.5 && !hero.conditions.some(c => c.id === (a.ward?.condition ?? 'invisible')) ? 5 : 0; break;
        case 'burst':
        case 'drain': {
          const reach = a.burst?.targets ?? foes.length;
          const hits = Math.min(reach, foes.length);
          score = hits >= 2 ? 3 + hits : focus ? 3 : 0;
          if (a.effect === 'drain' && hpPct < 0.6) score += 3;
          if (a.burst?.doubleAgainst && foes.some(f => a.burst!.doubleAgainst!.some(k => k === f.template.type || (k === 'undead' && isUndeadKind(f.template.type)) || (k === 'fiend' && isUnholyKind(f.template.type))))) score += 3;
          break;
        }
        case 'attack':
          if (!focus) break;
          if (MARK_ABILITIES.has(a.id)) score = this.marks[hero.id] ? 0 : 5;
          else score = (a.strikes ?? 1) > 1 ? 5 : 4;
          break;
      }
      // Newer skills are the stronger ones; a tie goes to them.
      score += a.minLevel * 0.1;
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  /**
   * Execute a command chosen from the FF command menu, then resume the turn.
   * The AI handles targeting and rolls; the DM picks the intent.
   */
  /** Orders queued via the battle menu's Tab-cycle, consumed at each hero's turn. */
  public queuedOrders: Map<string, PartyCommand> = new Map();
  /** The party's per-round focus target id so members gang up instead of scattering. */
  private roundFocusMonsterId: string | null = null;
  /** Set once per round: a tank has thrown themselves in front of a blow. */
  private interceptionUsedThisRound: boolean = false;
  /** Vendetta one-liners fire once per hero-per-kind per fight. */
  private vendettaNarrationUsed: Set<string> = new Set();
  /** Raging heroes: character id → rounds of fury remaining. */
  private rageRounds: Record<string, number> = {};
  /** What each fury is called when it ends: a rage, or a beast's shape. */
  private furyLabel: Record<string, string> = {};
  /** Rounds until a hero may use a skill again, by hero then skill. */
  private cooldowns: Record<string, Record<string, number>> = {};
  /** Marks & rites: character id → quarry, rounds, and bonus dice. */
  private marks: Record<string, { monsterId: string; rounds: number; dice: { count: number; size: number } }> = {};

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

  /**
   * Execute a queued command for a specific hero outside the normal pause
   * flow. Items resolve game-side (pendingItemUse), everything else runs the
   * normal turn path, then the turn index advances.
   */
  private submitCommandFor(hero: GameCharacter, cmd: PartyCommand): void {
    if (cmd.type === 'item') {
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

  /**
   * Game-side hook: the party heard a call for help. The engine only raises
   * the alarm once per fight; the game decides whether backup actually
   * arrives (spawn budget, theme rosters, fairness caps) and feeds it back
   * through addReinforcements().
   */
  public onItemCommand?: (itemId: string, holderId: string, actor: GameCharacter) => void;
  /**
   * Game-side hook: is this tile passable? Wired to the dungeon map so
   * monsters reposition around walls instead of through them.
   */
  public isTileWalkable?: (x: number, y: number) => boolean;

  /**
   * Opportunity attack: strike a combatant as it moves out of your melee
   * reach. Monsters provoke these from heroes when they advance or flee;
   * heroes provoke them from monsters the same way.
   * Returns the narration (possibly empty) instead of only logging, so
   * callers that already hold the log lock can interleave it correctly.
   */
  private opportunityAttack(mover: GameCharacter | Monster, moverNewTile: Vector2): string[] {
    const lines: string[] = [];
    const isMonsterMover = !(mover instanceof GameCharacter);
    const watchers = isMonsterMover ? this.party.alive : this.party.alive;
    const strike = (attacker: GameCharacter, victim: Monster) => {
      const mods = getAttackModifiers(attacker, victim);
      const result = attacker.attack(victim, { ...mods, disadvantage: true });
      const narration = generateCombatTurnNarration({
        attackerName: attacker.name,
        attackerClass: attacker.charClass.id,
        defenderName: victim.template.name,
        defenderType: 'monster',
        hit: result.hit,
        damage: result.damage,
        critical: result.message.includes('CRIT'),
        killingBlow: result.hit && !victim.isAlive,
      });
      lines.push(`⚔️ ${narration} (opportunity attack)`);
      if (result.hit) {
        lines.push(victim.takeDamage(result.damage));
        if (!victim.isAlive) this.noteKinVengeance(attacker, victim);
      }
    };
    const monsterStrike = (attacker: Monster, victim: GameCharacter) => {
      const mods = getAttackModifiers(attacker, victim);
      const effectiveAc = victim.ac + this.defenseBonus + this.townBuffAC + this.tavernBuffAC + Math.max(0, -this.weatherAttackMod);
      const result = attacker.attack(effectiveAc, mods);
      lines.push(`⚔️ ${attacker.template.name} lashes out at ${victim.name} as they slip away! (opportunity attack)`);
      if (result.hit) {
        const crit = result.message.includes('CRIT') || victim.isDying;
        lines.push(victim.takeDamage(result.damage, { crit }));
        this.applyMonsterSpecial(attacker, victim);
        this.handleConcentrationBreak(victim);
        if (!victim.isAlive) this.noteHeroDowned(victim, attacker);
      }
    };
    if (isMonsterMover) {
      const mv = mover as Monster;
      // Heroes the mover leaves (was adjacent, is no longer) get a parting blow.
      for (const hero of watchers) {
        const was = manhattan(mv.tile, hero.tile) <= 1;
        const now = manhattan(moverNewTile, hero.tile) <= 1;
        if (was && !now && hero.hp > 0) {
          strike(hero, mv);
        }
      }
    } else {
      const mv = mover as GameCharacter;
      for (const m of this.monsters) {
        if (!m.isAlive || m.fled) continue;
        const was = manhattan(m.tile, mv.tile) <= 1;
        const now = manhattan(m.tile, moverNewTile) <= 1;
        if (was && !now && m.isAlive) {
          monsterStrike(m, mv);
        }
      }
    }
    return lines;
  }

  /**
   * Game-side hook: the party heard a call for help. The engine only raises
   * the alarm once per fight; the game decides whether backup actually
   * arrives (spawn budget, theme rosters, fairness caps) and feeds it back
   * through addReinforcements().
   */
  public onReinforcementsRequested?: () => void;
  /** Set once the alarm has sounded, so one shout can't spam the request. */
  private reinforcedThisFight: boolean = false;

  /**
   * Backup arrives mid-fight: rolled into initiative at the back, narrated
   * as part of the same battle.
   */
  addReinforcements(monsters: Monster[]): void {
    if (!this.isActive || monsters.length === 0) return;
    this.monsters.push(...monsters);
    for (const m of monsters) {
      this.initiativeOrder.push(m);
      m.alertLevel = 2;
    }
    const names = [...new Set(monsters.map(m => m.template.name))].join(', ');
    this.log.messages.push(`🚨 Reinforcements pour in: ${names} answers the call!`);
  }

  /** Whether the alarm has already sounded this fight. */
  get reinforcementsRequested(): boolean {
    return this.reinforcedThisFight;
  }
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
      // A boss fights with a plan: finish the dying, silence the healer,
      // escalate when bloodied — not a dice roll among its options.
      const def = pickLegendaryAction(available, {
        someoneDying: this.party.members.some(m => m.isAlive && m.hp <= 0),
        healerStanding: this.party.alive.some(m => /cleric|druid|bard|paladin/.test(m.charClass.id)),
        bossHpPct: boss.hp / Math.max(1, boss.maxHp),
      });
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
    // The legendary strike is aimed, not rolled: grudge-aware tactical
    // targeting — tormentors, healers, finishable heroes first.
    const chosen = chooseMonsterTarget(this.party, boss, { maxReach: 12 });
    const target = chosen.target;
    if (chosen.reason !== 'the closest reachable threat') {
      this.log.messages.push(`\u26A1 ${boss.template.name} fixes its ire on ${target.name} \u2014 ${chosen.reason}.`);
    }

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
    // The lair serves its master's plan too: damage waves when the party is
    // wounded, control effects while they stand strong.
    const lairDef = pickLegendaryAction(lair, {
      someoneDying: false,
      healerStanding: this.party.alive.some(m => /cleric|druid|bard|paladin/.test(m.charClass.id)),
      bossHpPct: boss.hp / Math.max(1, boss.maxHp),
    });
    let def: LegendaryActionDef = lairDef;
    const woundedHeavy = this.party.alive.length > 0 && this.party.alive.every(m => m.hp < m.maxHp * 0.6);
    if (woundedHeavy && lair.some(d => d.damage)) {
      const damageLair = lair.filter(d => d.damage).sort((a, b) => parseDice(b.damage!).count * parseDice(b.damage!).size - parseDice(a.damage!).count * parseDice(a.damage!).size);
      if (damageLair.length > 0) {
        def = damageLair[0];
      }
    }

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

    // Pick target: the party's round focus (so everyone gangs up) — unless the
    // DM picked a specific foe from the battle menu, which always wins, or it
    // has already fallen, which drops to the nearest-alive fallback.
    let target = alive[0];
    let minDist = Infinity;
    for (const m of alive) {
      const d = Math.abs(m.tile.x - character.tile.x) + Math.abs(m.tile.y - character.tile.y);
      if (d < minDist) { minDist = d; target = m; }
    }
    const orderedFoe = forced && 'targetMonsterId' in forced && forced.targetMonsterId
      ? this.monsters.find(m => m.id === forced.targetMonsterId && m.isAlive)
      : undefined;
    if (orderedFoe) {
      target = orderedFoe;
    } else if (this.roundFocusMonsterId) {
      const focus = this.monsters.find(m => m.id === this.roundFocusMonsterId && m.isAlive);
      if (focus) {
        // Focus wins when it's a reasonable push or already bloodied; never
        // drag the ranged across the map for a full-health distant foe.
        const focusReachable = Math.abs(focus.tile.x - character.tile.x) + Math.abs(focus.tile.y - character.tile.y) <= 6;
        if (focusReachable || focus.hp <= 14) target = focus;
      }
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
      if (forced.type === 'ability') {
        if (this.useClassAbility(character, forced.abilityId)) return;
        this.log.messages.push(`${character.name} cannot muster that ability — falls back to their blade.`);
      } else if (forced.type === 'spell') {
        const spell = SPELLS.find(s => s.id === forced.spellId);
        const monsterTarget = forced.targetMonsterId ? this.monsters.find(m => m.id === forced.targetMonsterId && m.isAlive) : undefined;
        const allyTarget = forced.targetAllyId ? this.party.members.find(m => m.id === forced.targetAllyId) : undefined;
        if (spell && character.canCastSpell(spell.level) && this.castSpell(character, spell, monsterTarget, allyTarget)) return;
        this.log.messages.push(`${character.name} cannot cast that right now — falls back to their blade.`);
      } else if (forced.type === 'flee') {
        this.log.messages.push(`${character.name} looks for an opening to disengage!`);
        return;
      }
      // 'item' commands were executed game-side before the turn; fall through
      // to a weapon attack so the action isn't wasted.
    } else {
      // AI ability use: Second Wind when someone is badly hurt, Rage when the
      // fight opens, Hunter's Mark on the round's focus target. Rogues pass —
      // Sneak Attack rides on their normal attacks.
      // AI skill use: the chooser weighs the situation and the skills that are
      // paid for and off cooldown. Rogues pass — Sneak Attack rides on their strikes.
      {
        const focus = this.roundFocusMonsterId
          ? this.monsters.find(m => m.id === this.roundFocusMonsterId && m.isAlive)
          : undefined;
        const pick = this.chooseAbility(character, focus ?? null, affordableSpells.length);
        if (pick && this.useClassAbility(character, pick.id)) return;
      }
      if (affordableSpells.length > 0) {
      // A cursed ally jumps the queue: the trained hand lifts the binding.
      const allyCursed = this.party.members.some(m => m.isAlive && m.findCursedEquipped());
      const priority = allyCursed
        ? affordableSpells.find(s => s.id === 'remove_curse' && this.party.members.some(m => m.findCursedEquipped()))
        : undefined;
      if (priority) {
        if (this.castSpell(character, priority)) return;
      }

      // Contextual spell choice instead of a 40% coin flip:
      // 1. heal when the party needs it (triage),
      // 2. buff early while everyone stands,
      // 3. otherwise damage — AoE into clusters, big slots on big HP pools,
      //    cantrips to conserve slots on near-dead focus targets.
      const aliveMonsters = this.monsters.filter(m => m.isAlive && !m.fled);
      const woundedAllies = this.party.alive.filter(m => m.hp < m.maxHp * 0.5).length;
      const healSpells = affordableSpells.filter(s => s.healing);
      const earlyRound = this.log.round <= 2;

      if (woundedAllies > 0 && healSpells.length > 0 && (woundedAllies >= 2 || Math.random() < 0.6)) {
        const heal = healSpells.sort((a, b) => a.level - b.level)[0];
        if (this.castSpell(character, heal)) return;
      }

      const damageSpells = affordableSpells.filter(s => s.damage && s.level > 0);
      const buffSpells = affordableSpells.filter(s => !s.damage && !s.healing && s.level > 0 && s.level <= 2);
      if (buffSpells.length > 0 && earlyRound && woundedAllies === 0 && Math.random() < 0.5) {
        const buff = buffSpells.sort((a, b) => a.level - b.level)[0];
        if (this.castSpell(character, buff)) return;
      }

      if (damageSpells.length > 0) {
        const avgHp = aliveMonsters.length > 0
          ? aliveMonsters.reduce((s, m) => s + m.hp, 0) / aliveMonsters.length
          : 0;
        // A big spell against a nearly-dead focus target wastes slots; hold
        // back and let the cantrip finish the job.
        const focus = this.roundFocusMonsterId ? aliveMonsters.find(m => m.id === this.roundFocusMonsterId) : undefined;
        const bigSpells = damageSpells.filter(s => s.level > 0 && (s.level > 1 || avgHp > 20));
        const pool = focus && focus.hp <= 10 && bigSpells.length > 0 ? damageSpells.filter(s => s.level === 0) : damageSpells;
        const spell = pool.length > 0 ? pool[0] : damageSpells[0];
        if (spell && this.castSpell(character, spell)) return;
      }

      // Last resort: cantrips are free actions of war.
      const cantrips = affordableSpells.filter(s => s.level === 0);
      if (cantrips.length > 0 && Math.random() < 0.4) {
        if (this.castSpell(character, cantrips[Math.floor(Math.random() * cantrips.length)])) return;
      }
      }
    }

    // Default: weapon attack with condition modifiers and bless bonus.
    // Martial classes gain Extra Attack: two swings at level 5, three at 11.
    const attacks = character.attackCount;
    const pickTarget = (): Monster | null => {
      const candidates = this.monsters.filter(m => m.isAlive && m.id !== charmSource);
      if (candidates.length === 0) return null;
      // Next victim: the round focus if alive (keep the gang-up going), else nearest.
      const focus = this.roundFocusMonsterId ? candidates.find(m => m.id === this.roundFocusMonsterId) : undefined;
      if (focus) return focus;
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
   * Resolve a class combat ability. Returns false when the hero has no uses
   * left or nothing to target — the caller falls back to a weapon attack.
   */
  private useClassAbility(hero: GameCharacter, abilityId?: string): boolean {
    const focus = this.monsters.find(m => m.isAlive && m.id === this.roundFocusMonsterId) ?? null;
    const ability = abilityId ? hero.skills.find(a => a.id === abilityId) ?? null : this.chooseAbility(hero, focus, 0);
    if (!ability || !ability.effect || !this.isReady(hero, ability)) return false;
    const alive = this.monsters.filter(m => m.isAlive);
    const target = focus ?? alive[0] ?? null;
    const pay = () => {
      hero.spendAbility(ability);
      if (ability.cooldown > 0) (this.cooldowns[hero.id] ??= {})[ability.id] = ability.cooldown + 1;
    };
    const dice = ability.bonusDamageDice?.(hero.level);

    switch (ability.effect) {
      case 'heal': {
        const h = ability.healDice!(hero.level);
        pay();
        this.log.messages.push(`\u26a1 ${hero.name} uses ${ability.name}!`);
        this.log.messages.push(hero.heal(rollDice(h.count, h.size) + hero.level));
        return true;
      }
      case 'heal_ally': {
        const h = ability.healDice!(hero.level);
        const ally = this.party.alive.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0] ?? hero;
        pay();
        this.log.messages.push(`\u2728 ${hero.name} uses ${ability.name} on ${ally.name}!`);
        this.log.messages.push(ally.heal(rollDice(h.count, h.size) + hero.level));
        return true;
      }
      case 'heal_all': {
        const h = ability.healDice!(hero.level);
        pay();
        this.log.messages.push(`\u2728 ${hero.name} uses ${ability.name} — the whole party is mended!`);
        for (const m of this.party.alive) this.log.messages.push(m.heal(rollDice(h.count, h.size) + hero.level));
        return true;
      }
      case 'rage': {
        pay();
        this.rageRounds[hero.id] = ability.buff!.rounds;
        this.furyLabel[hero.id] = ability.id;
        if (ability.id === 'wild_shape') {
          const h = ability.healDice!(hero.level);
          this.log.messages.push(`\ud83d\udc3e ${hero.name} takes a Wild Shape — bone and sinew remade, claws for ${ability.buff!.rounds} rounds! (+${ability.buff!.damageBonus} damage)`);
          this.log.messages.push(hero.heal(rollDice(h.count, h.size)));
        } else {
          this.log.messages.push(`\ud83d\ude24 ${hero.name} enters a ${ability.name} — the fury burns for ${ability.buff!.rounds} rounds! (+${ability.buff!.damageBonus} damage)`);
        }
        return true;
      }
      case 'inspire': {
        pay();
        this.partyBlessRounds = Math.max(this.partyBlessRounds, ability.buff!.rounds);
        this.blessSourceId = `${hero.id}:inspire`;
        this.log.messages.push(`\ud83c\udfb5 ${hero.name} uses ${ability.name} — the party's blades find their nerve (+1d4 on attack rolls, ${ability.buff!.rounds} rounds)!`);
        return true;
      }
      case 'recover': {
        const lvl = hero.restoreSpellSlot();
        if (lvl === null) return false;
        pay();
        this.log.messages.push(`\ud83d\udcd6 ${hero.name} uses ${ability.name} — a ${ordinal(lvl)}-level slot returns.`);
        return true;
      }
      case 'ward': {
        pay();
        hero.applyCondition(ability.ward!.condition, ability.ward!.rounds, ability.ward!.name, `${hero.id}:${ability.id}`);
        this.log.messages.push(`\ud83d\udee1 ${hero.name} uses ${ability.name} — blows will have trouble finding them for ${ability.ward!.rounds} rounds.`);
        return true;
      }
      case 'burst':
      case 'drain': {
        if (alive.length === 0) return false;
        pay();
        let targets = alive;
        if (ability.burst?.targets) targets = [...(focus ? [focus] : []), ...alive.filter(m => m !== focus)].slice(0, ability.burst.targets);
        const names = targets.map(t => t.template.name).join(' and ');
        this.log.messages.push(ability.id === 'chaos_surge'
          ? `\ud83c\udf00 ${hero.name} lets loose a Chaos Surge — raw magic leaps between ${names}!`
          : ability.id === 'channel_divinity'
            ? `\u2728 ${hero.name} channels divinity — a burst of radiance scours the field!`
            : `\u26a1 ${hero.name} uses ${ability.name} — ${names}!`);
        let dealt = 0;
        for (const t of targets) {
          let dmg = rollDice(dice!.count, dice!.size);
          if (ability.burst?.doubleAgainst?.some(k => k === t.template.type || (k === 'undead' && isUndeadKind(t.template.type)) || (k === 'fiend' && isUnholyKind(t.template.type)))) dmg *= 2;
          dealt += Math.min(dmg, Math.max(0, t.hp));
          this.log.messages.push(`${t.template.name} takes ${dmg} damage (${Math.max(0, t.hp - dmg)}/${t.maxHp} HP)`);
          this.log.messages.push(t.takeDamage(dmg));
        }
        if (ability.effect === 'drain' && dealt > 0) {
          const mended = ability.burst?.targets === 1 ? dealt : Math.ceil(dealt / 2);
          this.log.messages.push(hero.heal(mended));
        }
        return true;
      }
      case 'attack': {
        if (!target) return false;
        pay();
        if (MARK_ABILITIES.has(ability.id)) {
          const isRite = ability.id === 'blood_mite';
          const isHex = ability.id === 'eldritch_hex';
          this.marks[hero.id] = { monsterId: target.id, rounds: isRite || isHex ? 5 : 3, dice: dice! };
          const label = isRite ? 'curses with a crimson rite' : isHex ? 'hexes' : 'marks';
          this.log.messages.push(`\ud83c\udfaf ${hero.name} ${label} ${target.template.name} — every hit against it bites for +${dice!.count}d${dice!.size}!`);
          return true;
        }
        if (ability.id === 'divine_smite') {
          const unholy = isUnholyKind(target.template.type);
          this.log.messages.push(`\u271d ${hero.name} smites ${target.template.name} — holy light pours down the blade${unholy ? ', and the unholy thing screams' : ''}!`);
          this.weaponAttack(hero, target, { count: dice!.count + (unholy ? 1 : 0), size: dice!.size });
          return true;
        }
        this.log.messages.push(`\u26a1 ${hero.name} uses ${ability.name}!`);
        const strikes = ability.strikes ?? 1;
        for (let n = 0; n < strikes; n++) {
          if (!target.isAlive) break;
          this.weaponAttack(hero, target, n === 0 ? dice : undefined);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Choose which slot level to spend for a spell, then spend it.
   * Defaults to the lowest usable slot; the DM's upcast policy — or the AI's
   * read of the fight under 'auto' — can push the caster to deliberately
   * upcast. Only scaling spells (damage/healing/sleep) ever upcast.
   * Returns the slot level used (0 for cantrips), or null if broke.
   */
  /** Slot levels this caster could still put the spell into, lowest first. */
  private affordableSlots(caster: GameCharacter, spell: Spell): number[] {
    const available: number[] = [];
    for (let lvl = spell.level; lvl <= 9; lvl++) {
      if ((caster.spellSlots[lvl] || 0) > 0) available.push(lvl);
    }
    return available;
  }

  /**
   * Which slot the caster would use, without spending it. Choosing and paying
   * are separate because callers that right-size the slot (healing triage)
   * need to decide against the slots the caster still has, not the ones left
   * after a speculative spend.
   */
  private pickSlotLevel(caster: GameCharacter, spell: Spell): number | null {
    if (spell.level <= 0) return 0; // cantrips cost nothing
    const available = this.affordableSlots(caster, spell);
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
    return chosen;
  }

  /** Pay for the chosen slot and say so. */
  private spendSlotFor(caster: GameCharacter, spell: Spell, chosen: number): void {
    if (spell.level <= 0) return;
    caster.spendSlotAt(chosen);
    if (chosen > spell.level) {
      const above = chosen - spell.level;
      this.log.messages.push(`${caster.name} upcasts ${spell.name} into a ${ordinal(chosen)}-level slot \u2014 ${above} level${above === 1 ? '' : 's'} above base!`);
    } else {
      this.log.messages.push(`${caster.name} spends a ${ordinal(chosen)}-level slot on ${spell.name}.`);
    }
  }

  private chooseSlotFor(caster: GameCharacter, spell: Spell): number | null {
    const chosen = this.pickSlotLevel(caster, spell);
    if (chosen === null) return null;
    this.spendSlotFor(caster, spell, chosen);
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
  private castSpell(caster: GameCharacter, spell: Spell, forcedMonsterTarget?: Monster, forcedAllyTarget?: GameCharacter): boolean {
    const ok = this.castSpellInner(caster, spell, forcedMonsterTarget, forcedAllyTarget);
    if (ok && caster.charClass.id === 'sorcerer' && spell.level > 0 && Math.random() < 0.1) this.wildSurge(caster);
    return ok;
  }

  /** The sorcerer's magic gets away from them: one of twenty things happens. */
  private wildSurge(caster: GameCharacter): void {
    const surge = surgeFor(rollD20(), caster.name);
    this.log.messages.push(surge.text);
    const fx = surge.effect;
    const foes = this.monsters.filter(m => m.isAlive && !m.fled);
    switch (fx.kind) {
      case 'heal_party':
        for (const m of this.party.alive) { const n = rollDice(fx.dice[0], fx.dice[1]); m.heal(n); this.log.messages.push(`${m.name} heals ${n}.`); }
        break;
      case 'heal_self': { const n = rollDice(fx.dice[0], fx.dice[1]); caster.heal(n); this.log.messages.push(`${caster.name} heals ${n}.`); break; }
      case 'burn_self': this.log.messages.push(caster.takeDamage(rollDice(fx.dice[0], fx.dice[1]))); break;
      case 'burn_foe': {
        const t = foes[Math.floor(Math.random() * foes.length)];
        if (t) { const n = rollDice(fx.dice[0], fx.dice[1]); this.log.messages.push(t.takeDamage(n)); }
        break;
      }
      case 'burn_all_foes':
        for (const t of foes) { const n = rollDice(fx.dice[0], fx.dice[1]); this.log.messages.push(t.takeDamage(n)); }
        break;
      case 'bless': this.partyBlessRounds = Math.max(this.partyBlessRounds, fx.rounds); break;
      case 'none': break;
    }
  }

  private castSpellInner(caster: GameCharacter, spell: Spell, forcedMonsterTarget?: Monster, forcedAllyTarget?: GameCharacter): boolean {
    // ── Control & support effects ──
    if (spell.id === 'remove_curse') {
      // Castable out of combat too: the AI lifts an ally's curse if it can.
      const afflicted = this.party.members.find(m => m.isAlive && m.findCursedEquipped());
      if (!afflicted) return false; // nobody is cursed — don't waste the slot
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      const item = afflicted.findCursedEquipped()!;
      afflicted.liftCurse();
      this.log.messages.push(`${caster.name} casts Remove Curse — tracing sigils over ${afflicted.name}'s ${item.name}. The binding parts, and the item can be removed.`);
      return true;
    }
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
      if (forcedAllyTarget && forcedAllyTarget.isAlive) {
        const slotLevel = this.chooseSlotFor(caster, spell);
        if (slotLevel === null) return false;
        const [dicePart] = spell.healing.split('+');
        const [diceCount, diceSize] = dicePart.split('d').map(Number);
        let dice = diceCount || 1;
        if (slotLevel > spell.level) dice += slotLevel - spell.level;
        const healing = rollDice(dice, diceSize || 4) + caster.spellcastingMod;
        this.log.messages.push(`${caster.name} casts ${spell.name} on ${forcedAllyTarget.name}!`);
        this.log.messages.push(forcedAllyTarget.heal(healing));
        return true;
      }
      // Triage: the downed ally comes first (they're rolling death saves),
      // then the ally closest to dropping. Upcast only as far as the
      // emergency demands — a scrape gets a base-level slot.
      const triage = chooseHealTarget(this.party);
      if (!triage.target) return false;
      const ally = triage.target;
      // Right-size the slot before paying for it. This block used to spend a
      // slot first and then reconsider: for a wounded ally it could spend a
      // second one, and for a dying ally it re-read the slots left after the
      // spend and healed at that lower level — an upcast paid for and not
      // delivered.
      let slotLevel = this.pickSlotLevel(caster, spell);
      if (slotLevel === null) return false;
      const affordable = this.affordableSlots(caster, spell);
      const emergency = triage.urgency === 'dying';
      if (emergency) {
        // Dying ally: the biggest slot on hand. Every die is more of a cushion
        // above 0 HP, and there may not be a next turn to spend it on.
        if (affordable.length > 0) slotLevel = affordable[affordable.length - 1];
      } else if (triage.urgency === 'wounded' && slotLevel > spell.level) {
        // Non-critical wounds get the base slot, when one is still spare.
        if ((caster.spellSlots[spell.level] ?? 0) > 0) slotLevel = spell.level;
      }
      this.spendSlotFor(caster, spell, slotLevel);
      const [dicePart] = spell.healing.split('+');
      const [diceCount, diceSize] = dicePart.split('d').map(Number);
      // Upcast: +1 die per slot level above the spell's base level.
      let dice = diceCount || 1;
      if (slotLevel > spell.level) dice += slotLevel - spell.level;
      const healing = rollDice(dice, diceSize || 4) + caster.spellcastingMod;
      const why = triage.urgency === 'dying'
        ? ' — the fallen come first!'
        : triage.urgency === 'critical'
          ? ' — they are one hit from going down!'
          : '';
      this.log.messages.push(`${caster.name} casts ${spell.name} on ${ally.name}${why}`);
      this.log.messages.push(ally.heal(healing));
      return true;
    }

    // ── Damage spells: targets now make real saving throws ──
    if (spell.damage) {
      const victims = this.monsters.filter(m => m.isAlive);
      if (victims.length === 0) return false;
      const slotLevel = this.chooseSlotFor(caster, spell);
      if (slotLevel === null) return false;
      const victim = (forcedMonsterTarget && forcedMonsterTarget.isAlive)
        ? forcedMonsterTarget
        : (this.roundFocusMonsterId
            ? (victims.find(m => m.id === this.roundFocusMonsterId) ?? victims[0])
            : victims[Math.floor(Math.random() * victims.length)]);
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
      // Elemental interactions: radiant sears the unholy, fire turns dry
      // plant-flesh to torchwood, the dead ignore venom. Read the element
      // straight off the spell's damage string ("1d10 fire").
      const element = spell.damage.split(' ')[1];
      const elem = elementalMultiplier(element, victim.template.type);
      if (elem.mult !== 1) {
        damage = Math.max(1, Math.round(damage * elem.mult));
        if (elem.note) {
          this.log.messages.push(`✨ ${elem.note}`);
        }
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
      // Spells leave memory too: the victim now knows which hand burned it.
      if (victim.isAlive) {
        if (victim.tormentorId === caster.id) victim.grudge++;
        else {
          victim.tormentorId = caster.id;
          victim.grudge = 1;
        }
      } else {
        this.noteKinVengeance(caster, victim);
      }
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

  /**
   * A cloak of displacement blurs its wearer the way invisibility does:
   * attacks against them roll with disadvantage, and, as with every other
   * source, advantage and disadvantage cancel one another out.
   */
  displacementMods<M extends { advantage: boolean; disadvantage: boolean }>(mods: M, defender: GameCharacter): M {
    if (!defender.hasDisplacement) return mods;
    if (mods.advantage) return { ...mods, advantage: false, disadvantage: false };
    return { ...mods, disadvantage: true };
  }

  /** Weapon attack applying advantage/disadvantage, bless, and auto-crits. */
  private weaponAttack(attacker: GameCharacter, target: Monster, abilityBonus?: { count: number; size: number }): void {
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
    // Vendetta: this hero has been downed by this kind before. Old hate
    // sharpens the eye — +1 to hit, +2 once the debt is twice paid.
    const vendetta = attacker.vendettas[target.template.id] ?? 0;
    if (vendetta > 0) {
      opts.attackRollBonus = (opts.attackRollBonus || 0) + (vendetta >= 2 ? 2 : 1);
    }
    // A bond: two who have fought side by side long enough know each other's blind side.
    const bond = this.bondBonus?.(attacker) ?? 0;
    if (bond > 0) opts.attackRollBonus = (opts.attackRollBonus || 0) + bond;
    // Giant Strength: the potion's fury adds weight to every blow.
    const strBuff = this.potionBuffs[attacker.id]?.damageBonus ?? 0;
    if (strBuff > 0) {
      opts.damageBonus = (opts.damageBonus || 0) + strBuff;
    }
    // Flanking: an ally standing on the opposite side of the foe splits its
    // attention — the classic 5e optional rule, and a reason to move.
    if (!opts.advantage && !opts.disadvantage) {
      const flankAlly = this.party.alive.find(m =>
        m !== attacker &&
        manhattan(m.tile, target.tile) <= 1 &&
        isFlanking(attacker.tile, target.tile, m.tile),
      );
      if (flankAlly) {
        opts.advantage = true;
      }
    }
    // Rage: the fury adds weight to every blow while it burns.
    if ((this.rageRounds[attacker.id] ?? 0) > 0) {
      opts.damageBonus = (opts.damageBonus || 0) + 2;
    }
    // Hunter's Mark / Blood Mite: the marked quarry takes the mark's dice
    // of extra damage from every hit.
    const mark = this.marks[attacker.id];
    if (mark && mark.monsterId === target.id) {
      opts.damageBonus = (opts.damageBonus || 0) + rollDice(mark.dice.count, mark.dice.size);
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
    // War-room maps: the party knows where the foe will stand.
    if (this.warRoomAttackBonus > 0 && this.warRoomFightsLeft > 0) {
      opts.attackRollBonus = (opts.attackRollBonus || 0) + this.warRoomAttackBonus;
    }
    // Hearth-blessed delve: the light the party carries burns the undead.
    if (this.hearthBlessedUndeadBonus > 0 && isUndeadKind(target.template.type)) {
      opts.damageBonus = (opts.damageBonus || 0) + this.hearthBlessedUndeadBonus;
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
    // Sneak Attack: an advantaged rogue strike finds the gaps for bonus dice.
    if (attacker.charClass.id === 'rogue' && opts.advantage && !opts.disadvantage && result.hit) {
      const sneak = rollDice(sneakAttackDice(attacker.level), 6);
      result.damage += sneak;
      this.log.messages.push(`🗡️ Sneak Attack! ${attacker.name} finds the gaps for ${sneak} extra damage.`);
    }
    // Arcane Jolt and friends: the ability's dice crackle over the strike.
    if (abilityBonus && result.hit) {
      const extra = rollDice(abilityBonus.count, abilityBonus.size);
      result.damage += extra;
      this.log.messages.push(`⚡ The infused strike cracks for ${extra} extra damage!`);
    }
    // Old hate narrates itself the first time a vendetta lands.
    if (result.hit && vendetta > 0 && !this.vendettaNarrationUsed.has(attacker.id + ':' + target.template.id)) {
      this.vendettaNarrationUsed.add(attacker.id + ':' + target.template.id);
      this.log.messages.push(`⚔️ "${['This one is for last time.', 'I owe your kind a debt.', 'You remember me now, don\'t you?'][Math.floor(Math.random() * 3)]}" — ${attacker.name} fights with old hate against the ${target.template.name}.`);
    }
    // The finished moon-forge edge bites deepest when the strike lands true and hard.
    if (this.moonForgeBlade && result.hit && (result.message.includes('CRIT') || result.message.includes('CRITICAL'))) {
      result.damage += 4;
    }
    // Combat memory: a landed blow marks the striker. Monsters remember who
    // hurts them and go looking for that hero when their turn comes round.
    if (result.hit) {
      if (target.tormentorId === attacker.id) target.grudge++;
      else {
        target.tormentorId = attacker.id;
        target.grudge = 1;
      }
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
      if (!target.isAlive) this.noteKinVengeance(attacker, target);
    }
  }

  /**
   * Kin-vengeance: when a monster falls, its surviving packmates fix their
   * grudge on the killer — they fight angrier and hunt that hero down.
   */
  private noteKinVengeance(killer: GameCharacter, victim: Monster): void {
    const kin = this.monsters.filter(m => m.isAlive && !m.fled && m.template.id === victim.template.id && m !== victim);
    if (kin.length === 0) return;
    for (const m of kin) {
      m.tormentorId = killer.id;
      m.grudge = Math.max(m.grudge, 2);
    }
    const names = [...new Set(kin.map(m => m.template.name))].join(', ');
    this.log.messages.push(`🩸 The ${names} ${kin.length === 1 ? 'watches' : 'watch'} ${victim.template.name} fall — their rage turns to ${killer.name}!`);
  }

  private monsterTurn(monster: Monster) {
    const alive = this.party.alive;
    if (alive.length === 0) return;
    // A boss hurt to half changes: quicker, angrier, and its legendary
    // actions come back at once.
    if ((monster.isBoss || /\(Boss\)/.test(monster.template.name)) && monster.hp <= monster.maxHp / 2 && !this.phaseTwo.has(monster.id)) {
      this.phaseTwo.add(monster.id);
      monster.template = { ...monster.template, attackBonus: monster.template.attackBonus + 1, damageBonus: monster.template.damageBonus + 2 };
      monster.legendaryActions = LEGENDARY_ACTIONS_PER_ROUND;
      this.log.messages.push(`\ud83d\udd25 ${monster.template.name} enters its second phase \u2014 faster, angrier, and not done.`);
    }

    // Morale check: a broken creature bolts instead of fighting to the death.
    if (
      !monster.fled &&
      shouldMonsterFlee(monster, {
        alliesAlive: this.monsters.filter(m => m.isAlive && !m.fled && m !== monster).length,
        alliesFled: this.monsters.filter(m => m.fled).length,
        foesStanding: this.party.alive.length,
        round: this.log.round,
      })
    ) {
      monster.fled = true;
      const packmates = this.monsters.filter(m => m.fled && m !== monster).length;
      const line = packmates > 0
        ? `${monster.template.name} breaks and flees into the dark — ${packmates + 1} ${packmates === 1 ? 'foe has' : 'foes have'} now fled!`
        : `${monster.template.name} breaks and flees into the dark, leaving its allies behind!`;
      this.log.messages.push(`💨 ${line}`);
      // Running through a hero's melee reach invites a parting blow.
      const sprint = advanceToward(monster.tile, { x: monster.tile.x + 3, y: monster.tile.y }, 3);
      this.log.messages.push(...this.opportunityAttack(monster, sprint.tile));
      return;
    }

    // Tactical target selection: finish downed heroes, deny the healer, and
    // punish the squishy backline instead of whaling on a random hero.
    const { target, reason } = chooseMonsterTarget(this.party, monster, { maxReach: 6 });
    if (reason !== 'the closest reachable threat') {
      this.log.messages.push(`\uD83C\uDFF0 ${monster.template.name} fixates on ${target.name} \u2014 ${reason}.`);
    }
    // Closing the distance: an out-of-reach monster advances up to its speed
    // before swinging — slow creatures get to feel slow, not absent.
    const dist = manhattan(monster.tile, target.tile);
    if (dist > 1) {
      const speed = Math.max(1, Math.round(monster.template.speed / 5));
      const move = advanceToward(monster.tile, target.tile, speed);
      const blocked = this.isTileWalkable ? !this.isTileWalkable(move.tile.x, move.tile.y) : false;
      if (move.steps > 0 && !blocked) {
        // Advancing out of one hero's reach to reach another can cost a hit.
        // Resolve the parting blow BEFORE the move completes — if the monster
        // is cut down mid-dash, it never reaches its target.
        const leaving = this.party.alive.filter(h =>
          h !== target &&
          manhattan(monster.tile, h.tile) <= 1 &&
          manhattan(move.tile, h.tile) > 1,
        );
        if (leaving.length > 0) {
          this.log.messages.push(...this.opportunityAttack(monster, move.tile));
        }
        if (!monster.isAlive || monster.fled) return;
        monster.tile = move.tile;
        if (move.steps >= 2) {
          this.log.messages.push(`🏃 ${monster.template.name} closes in on ${target.name}.`);
        }
      }
    }
    const mods = this.displacementMods(getAttackModifiers(monster, target), target);
    // Pack Tactics (5e): swarming beasts and humanoids gain advantage when a
    // living, un-fled ally stands beside their target — numbers are a weapon.
    if (!mods.advantage && !mods.disadvantage) {
      const packSize = this.monsters.filter(m =>
        m.isAlive && !m.fled && m !== monster &&
        m.template.id === monster.template.id &&
        manhattan(m.tile, target.tile) <= 2,
      ).length;
      if (packSize >= 2) {
        mods.advantage = true;
      }
    }
    // Flanking cuts both ways: monsters surrounded by their own kin on
    // opposite sides of a hero strike with advantage too.
    if (!mods.advantage && !mods.disadvantage) {
      const flanker = this.monsters.find(m =>
        m.isAlive && !m.fled && m !== monster &&
        manhattan(m.tile, target.tile) <= 1 &&
        isFlanking(monster.tile, target.tile, m.tile),
      );
      if (flanker) {
        mods.advantage = true;
      }
    }
    // In the dark, everything that hunts by scent or sound has the party cold.
    if (this.darkness && !mods.disadvantage) mods.advantage = true;
    // Gloom-day undead strike with supernatural fury (full-moon lycanthropes
    // are handled by their own awakening transformation in startCombat).
    const gloom = isUndeadKind(monster.template.type) ? this.gloomDayUndeadBonus : 0;
    // The fury bonus shows as a lower AC to beat (i.e. an easier hit) and a
    // flat damage bump after the strike lands.
    const effectiveAc = target.ac + this.defenseBonus + this.townBuffAC + this.tavernBuffAC
      + Math.max(0, -this.weatherAttackMod)
      - gloom;
    // A tank's oath: bodyblock one strike aimed at the backline each round.
    if (!this.interceptionUsedThisRound) {
      const isCaster = /cleric|wizard|sorcerer|druid|bard|warlock/.test(target.charClass.id);
      if (isCaster) {
        const guardian = this.party.alive.find(m =>
          m !== target &&
          ['fighter', 'paladin', 'barbarian'].includes(m.charClass.id) &&
          !m.hasCondition('paralyzed') && !m.hasCondition('stunned') && !m.hasCondition('unconscious') &&
          manhattan(m.tile, target.tile) <= 2,
        );
        if (guardian) {
          this.interceptionUsedThisRound = true;
          this.log.messages.push(`🛡️ ${guardian.name} throws ${guardian.charClass.id === 'paladin' ? 'a holy shield' : 'a shoulder'} in front of ${target.name} — the blow is theirs to take!`);
          const guardianMods = this.displacementMods(getAttackModifiers(monster, guardian), guardian);
          const gAc = guardian.ac + this.defenseBonus + this.townBuffAC + this.tavernBuffAC + Math.max(0, -this.weatherAttackMod) - gloom;
          const gResult = monster.attack(gAc, guardianMods);
          this.log.messages.push(generateCombatTurnNarration({
            attackerName: monster.template.name,
            defenderName: guardian.name,
            defenderType: 'party',
            hit: gResult.hit,
            damage: gResult.damage,
            critical: gResult.message.includes('CRIT'),
            killingBlow: gResult.hit && !guardian.isAlive,
          }));
          if (gResult.hit) {
            const gCrit = gResult.message.includes('CRIT') || guardian.isDying;
            this.log.messages.push(guardian.takeDamage(gResult.damage, { crit: gCrit }));
            this.applyMonsterSpecial(monster, guardian);
            this.handleConcentrationBreak(guardian);
            // Interception is deliberate sacrifice: the blow enrages the
            // monster at the wall of steel blocking it, not the caster.
            if (monster.tormentorId === guardian.id) monster.grudge++;
            else {
              monster.tormentorId = guardian.id;
              monster.grudge = Math.max(monster.grudge, 2);
            }
          }
          return;
        }
      }
    }
    const result = monster.attack(effectiveAc, mods);
    if (gloom > 0 && result.hit) result.damage += 2;
    // A reaction: a fighter's kind turns a plain hit aside once a round.
    if (result.hit && !result.message.includes('CRIT') && !target.isDying
      && ['fighter', 'rogue', 'monk', 'ranger', 'paladin', 'blood_hunter'].includes(target.charClass.id)
      && !this.reactionsUsed.has(target.id) && Math.random() < 0.3) {
      this.reactionsUsed.add(target.id);
      this.log.messages.push(`\u2694 ${target.name} turns ${monster.template.name}'s blow aside with a parry.`);
      return;
    }
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
      // A reaction: a shield takes some of it, once a round.
      if (target.equipment.shield && !this.reactionsUsed.has(target.id) && !target.isDying) {
        const blocked = Math.min(result.damage, rollDice(1, 6) + 1);
        if (blocked > 0) {
          this.reactionsUsed.add(target.id);
          result.damage -= blocked;
          this.log.messages.push(`\ud83d\udee1 ${target.name} catches ${blocked} of it on the shield.`);
        }
      }
      this.log.messages.push(target.takeDamage(result.damage, { crit }));
      this.applyMonsterSpecial(monster, target);
      this.handleConcentrationBreak(target);
      if (!target.isAlive) this.noteHeroDowned(target, monster);
    }
  }

  /** A hero falls: the monster remembers its kind, the hero remembers the kind. */
  private noteHeroDowned(hero: GameCharacter, monster: Monster): void {
    hero.vendettas[monster.template.id] = (hero.vendettas[monster.template.id] ?? 0) + 1;
    const kin = this.monsters.filter(m => m.isAlive && !m.fled && m.template.id === monster.template.id);
    for (const m of kin) {
      m.tormentorId = hero.id;
      m.grudge = Math.max(m.grudge, 2);
    }
  }

  /** Signature rider effects resolved as genuine saving throws. */
  private applyMonsterSpecial(monster: Monster, target: GameCharacter): void {
    const special = MONSTER_SPECIALS[monster.template.id];
    if (!special) return;
    // A reaction: a caster with a slot to spare counters the rider, once a round.
    const counter = this.party.alive.find(m => ['wizard', 'sorcerer', 'artificer'].includes(m.charClass.id) && m.canCastSpell(1) && !this.reactionsUsed.has(m.id));
    if (counter && special.kind !== 'drain' && Math.random() < 0.45) {
      this.reactionsUsed.add(counter.id);
      this.log.messages.push(`\u270b ${counter.name} counters the ${special.description} with a word and a gesture.`);
      return;
    }

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
    const save = target.makeSavingThrow(special.saveAbility, special.dc + this.dcShift);
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
    // The war-room edge is spent on the battles it was promised for.
    if (this.warRoomFightsLeft > 0) {
      this.warRoomFightsLeft--;
      if (this.warRoomFightsLeft === 0) {
        this.warRoomAttackBonus = 0;
        this.log.messages.push('The war-room maps have served their purpose — the tactical edge is spent.');
      }
    }
    for (const member of this.party.members) member.pendingItemUse = false;
    this.log.isOver = true;
    this.log.winner = winner;

    if (winner === 'party') {
      // Grant XP — driven-off foes yield half their bounty: the party won,
      // but the creature lives to menace another day.
      let totalXp = 0;
      let fledCount = 0;
      for (const m of this.monsters) {
        if (m.fled) {
          fledCount++;
          totalXp += Math.ceil(m.template.xp / 2);
        } else {
          totalXp += m.template.xp;
        }
      }
      const xpEach = Math.ceil(totalXp / Math.max(1, this.party.alive.length));
      // Tavern rumor buff: bonus XP per fight.
      const tavernXpBonus = this.tavernBuffXp > 0 ? this.tavernBuffXp : 0;
      const finalXpEach = xpEach + tavernXpBonus;
      this.log.messages.push(`Victory! +${totalXp} total XP (${finalXpEach} each${tavernXpBonus > 0 ? ' + ' + tavernXpBonus + ' tavern bonus' : ''})${fledCount > 0 ? ` — ${fledCount} ${fledCount === 1 ? 'foe fled' : 'foes fled'}, denied its full bounty` : ''}`);
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
/**
 * Room features — altars, vaults, forges, chests and the rest.
 *
 * One feature can sit in a dungeon room, and the DM acts on it by name
 * ("pray at the altar", "open the chest"). The data and placement live in
 * world/RoomFeatures; this is what actually happens when the party uses one.
 *
 * It reaches back into the game only through `RoomFeatureHost`, so what a
 * feature is allowed to touch is visible in one place instead of being
 * spread through a six-thousand-line class.
 */

import type { GameCharacter } from '../entities/Character';
import type { MonsterTemplate } from '../entities/Monster';
import type { Party } from '../entities/Party';
import type { Room } from '../world/DungeonGenerator';
import type { RoomFeature, RoomFeatureKind } from '../world/RoomFeatures';
import type { OverworldTown } from '../world/Overworld';
import type { TownLifeState } from '../world/TownLife';
import type { HUD } from '../ui/HUD';
import type { LootResult } from '../loot/LootTables';
import type { DMIntent } from '../ai/DMCommand';
import { FEATURE_INTENT_KIND } from '../ai/DMCommand';
import { getMonsterTemplate, getRandomMonster } from '../entities/Monster';
import { rollCombatLoot } from '../loot/LootTables';
import { pushDiceRoll } from '../rules/DiceEvents';
import { rollD20 } from '../rules/Rules';
import { SPELLS, isCaster, rollDice } from '../data/gameData';

/** The slice of the game a room feature is allowed to reach. */
export interface RoomFeatureHost {
  readonly party: Party;
  readonly dungeonLevel: number;
  readonly hud: HUD;
  readonly townLife: TownLifeState | null;
  readonly currentTown: OverworldTown | null;
  currentRoom(): Room | undefined;
  addGold(n: number): void;
  bestScout(): GameCharacter;
  bestDisarmer(): GameCharacter;
  spawnEncounter(templates: MonsterTemplate[]): void;
  distributeLoot(loot: LootResult, emptyLine: string): void;
}

/** Capitalise a sentence built from a feature name, which starts lowercase. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class RoomFeatureController {
  constructor(private game: RoomFeatureHost) {}

  /** What to type to use each feature, quoted back when the party inspects one. */
  static readonly HINT: Record<RoomFeatureKind, string> = {
    altar: 'pray at the altar',
    vault: 'search the vault',
    prison: 'free the prisoners',
    chokepoint: 'barricade the chokepoint',
    forge: 'use the forge',
    library: 'read the tomes',
    fountain: 'drink from the fountain',
    sarcophagus: 'open the sarcophagus',
    throne: 'approach the throne',
    trapped_corridor: 'disarm the traps',
    treasure_room: 'search the treasure room',
    merchant_camp: 'talk to the merchant',
    puzzle_room: 'solve the puzzle',
    ritual_chamber: 'examine the ritual circle',
    war_room: 'study the war table',
    chest: 'open the chest',
  };

  /**
   * Open a chest. A stuck lid takes a Strength check to force, and a wired one
   * springs on whoever opens it unless the party spotted it first with
   * "search for traps". What is inside is rolled from the same tables as
   * combat spoils, scaled to the depth.
   */
  private featureChest(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    // Feature names carry their own article ("a small brass coffer").
    const it = f.name.replace(/^(a|an|the)\s+/i, 'the ');
    if (f.used) { say(`${capitalise(it)} stands open and empty.`, '#888'); return true; }

    if (f.locked) {
      // The strongest hand present shoulders it open; failure costs the turn.
      const forcer = this.game.party.alive.reduce(
        (best, m) => (m.strMod > best.strMod ? m : best),
        this.game.party.leader,
      );
      const roll = 1 + Math.floor(Math.random() * 20);
      const total = roll + forcer.strMod;
      pushDiceRoll({
        kind: 'check', diceType: 'd20',
        label: `${forcer.name} forces ${it}`,
        expression: `d20${forcer.strMod >= 0 ? '+' : ''}${forcer.strMod}`,
        rolls: [roll], total,
        outcome: roll === 20 ? 'crit' : roll === 1 ? 'fumble' : total >= 13 ? 'success' : 'failure',
      });
      if (total < 13) {
        say(`${forcer.name} heaves at the lid (Strength ${total}) — it does not give. Try again.`, '#c88');
        return true;
      }
      f.locked = false;
      say(`${forcer.name} forces the lid with a crack of splitting wood (Strength ${total}).`, '#ca8');
    }

    if (f.trapped) {
      f.trapped = false;
      const victim = this.game.bestDisarmer();
      const dmg = 2 + Math.floor(Math.random() * (4 + this.game.dungeonLevel * 2));
      victim.takeDamage(dmg);
      say(`The lid was wired — a needle bites ${victim.name} for ${dmg} damage!`, '#c44');
      this.game.hud.setParty(this.game.party);
      if (!victim.isConscious) {
        say(`${victim.name} goes down.`, '#c44');
        return true;
      }
    }

    f.used = true;
    say(`${capitalise(it)} creaks open.`, '#ffd700');
    const loot = rollCombatLoot(
      [{ cr: Math.max(1, this.game.dungeonLevel), name: f.name, type: 'chest', isBoss: false }],
      this.game.dungeonLevel,
    );
    // Drop the kill-flavoured lines; nothing here died.
    loot.narration = loot.narration.filter(line => !/corpse|body|remains|yields/i.test(line));
    this.game.distributeLoot(loot, 'It holds nothing but mouldering rags.');
    this.game.hud.setParty(this.game.party);
    return true;
  }

  /**
   * Act on a room-feature intent for the room the party stands in. Returns
   * true when the feature consumed the order (even a "nothing left" one),
   * false when the room has no such feature.
   */
  perform(intent: DMIntent): boolean {
    const say = (line: string, color = '#ca8') => this.game.hud.addCombatMessage(line, color);
    const feature = this.game.currentRoom()?.feature;

    if (intent === 'search_room') {
      if (feature) return false;
      say('The room holds nothing of note \u2014 only stone, dust, and silence.', '#888');
      return true;
    }
    if (!feature) return false;
    const f = feature;

    if (intent === 'feature_inspect') {
      // Generic search narrates the feature without spending it.
      this.game.hud.addCombatMessage(
        f.used ? f.inspect : `${f.inspect} Try \u201c${RoomFeatureController.HINT[f.kind]}\u201d.`,
        '#8aa'
      );
      return true;
    }
    if (FEATURE_INTENT_KIND[intent] !== f.kind) return false;

    switch (intent) {
      case 'feature_altar': return this.featureAltar(f, say);
      case 'feature_vault': return this.featureVault(f, say);
      case 'feature_prison': return this.featurePrison(f, say);
      case 'feature_chokepoint': return this.featureChokepoint(f, say);
      case 'feature_forge': return this.featureForge(f, say);
      case 'feature_library': return this.featureLibrary(f, say);
      case 'feature_fountain': return this.featureFountain(f, say);
      case 'feature_sarcophagus': return this.featureSarcophagus(f, say);
      case 'feature_throne': return this.featureThrone(f, say);
      case 'feature_trapped_search':
        say('The corridor is rigged with traps! Use \"search for traps\" to detect them safely.', '#c66');
        return true;
      case 'feature_trapped_disarm':
        say('The traps are complex — use \"disarm trap\" after detecting them.', '#8a8');
        return true;
      case 'feature_treasure': {
        if (f.used) { say('The treasure room has already been looted.', '#888'); return true; }
        f.used = true;
        const goldFound = 20 + Math.floor(Math.random() * 80);
        this.game.addGold(goldFound);
        say('You search the treasure room and find ' + goldFound + ' gp in scattered coins and gems!', '#ffd700');
        // Chance for a magic item
        if (Math.random() < 0.25) {
          const items = ['Potion of Healing', 'Scroll of Fireball', 'Scroll of Shield', 'Antidote'];
          const item = items[Math.floor(Math.random() * items.length)];
          this.game.party.leader.inventory.push({
            id: 'treasure_' + Date.now(), name: item, type: 'potion',
            value: 30, description: 'Found in a treasure room.',
          });
          say('Among the coins you find a ' + item + '!', '#8cf');
        }
        return true;
      }
      case 'feature_merchant_talk': {
        if (f.used) { say('The merchant has packed up and left.', '#888'); return true; }
        say('The weary merchant looks up. \"I have potions, scrolls, and odds and ends. Take a look at the town shops — they have better prices.\"', '#a89');
        say('Tip: Buy something from the merchant for a discount? He sells Healing Potions for 20 gp and Scrolls for 30 gp.', '#8cf');
        return true;
      }
      case 'feature_merchant_rob': {
        if (f.used) { say('The merchant already fled.', '#888'); return true; }
        f.used = true;
        say('You attack the merchant! He screams and drops his goods before fleeing.', '#c44');
        const haul = 15 + Math.floor(Math.random() * 30);
        this.game.addGold(haul);
        say('Loot: ' + haul + ' gp from his abandoned cart.', '#ffd700');
        // Lose reputation
        if (this.game.currentTown && this.game.townLife) {
          const tl = this.game.townLife.byTown[this.game.currentTown.id];
          if (tl) tl.townReputation = Math.max(0, tl.townReputation - 5);
          say('Your reputation with the town drops.', '#c66');
        }
        return true;
      }
      case 'feature_puzzle': {
        if (f.used) { say('The puzzle has already been solved.', '#888'); return true; }
        f.used = true;
        const solved = Math.random() < 0.6; // 60% success chance
        if (solved) {
          say('You study the puzzle carefully and align the pieces correctly. A hidden door slides open!', '#ffd700');
          const bonus = 30 + Math.floor(Math.random() * 50);
          this.game.addGold(bonus);
          say('Behind the door: a cache with ' + bonus + ' gp!', '#8cf');
        } else {
          const coin = 5 + Math.floor(Math.random() * 10);
          say('You attempt the puzzle but fail. The mechanism locks — but you spot a ' + coin + ' gp coin that fell out.', '#a89');
          this.game.addGold(coin);
        }
        return true;
      }
      case 'feature_ritual': {
        if (f.used) { say('The ritual chamber has already been used.', '#888'); return true; }
        f.used = true;
        const blessing = Math.random();
        if (blessing < 0.5) {
          // Restore some HP
          for (const m of this.game.party.members) {
            const heal = 5 + Math.floor(Math.random() * 15);
            m.hp = Math.min(m.maxHp, m.hp + heal);
          }
          say('The ritual chamber bathes the party in warm light. Each member recovers 5-20 HP.', '#8cf');
        } else if (blessing < 0.8) {
          // Restore a spell slot
          say('Arcane energy flows through the chamber. The casters feel their magic renewed.', '#a8f');
          for (const m of this.game.party.members) {
            if (m.charClass.id === 'wizard' || m.charClass.id === 'cleric' || m.charClass.id === 'sorcerer' || m.charClass.id === 'warlock') {
              // Add a spell slot (simplified: just note it)
              say(m.name + ' feels a spell slot restored.', '#a8f');
            }
          }
        } else {
          // Bonus XP
          const xp = 20 + Math.floor(Math.random() * 40);
          for (const m of this.game.party.members) m.xp += xp;
          say('Ancient knowledge floods your mind. Each member gains ' + xp + ' XP.', '#ffd700');
        }
        return true;
      }
      case 'feature_chest': return this.featureChest(f, say);
      case 'feature_war_room': {
        if (f.used) { say('You have already studied the war room thoroughly.', '#888'); return true; }
        f.used = true;
        // Reveals info about the dungeon
        say('The maps reveal hidden passages and monster patrol routes. You gain tactical advantage.', '#8cf');
        // Bonus: +2 to next attack rolls
        say('Your party gains +2 to attack rolls for the next battle (tactical knowledge).', '#a89');
        // Small gold find
        const gold = 10 + Math.floor(Math.random() * 25);
        this.game.addGold(gold);
        say('Hidden in a map case: ' + gold + ' gp.', '#ffd700');
        return true;
      }
    }
    return false;
  }

  private featureAltar(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say(`The ${f.name} is spent \u2014 the candle gutters out.`, '#888'); return true; }
    f.used = true;
    const deity = this.game.party.leader.deity;
    const heal = rollDice(1, 4) + 2;
    let healed = 0;
    for (const m of this.game.party.members) {
      if (!m.isDead && m.hp > 0 && m.hp < m.maxHp) { m.heal(heal); healed++; }
    }
    say(deity
      ? `\u2726 ${deity} accepts the offering! ${healed ? `${healed} wounded ${healed === 1 ? 'companion is' : 'companions are'} mended (+${heal} HP).` : 'The blessing settles over the party, unneeded.'}`
      : `\u2726 Something answers the prayer \u2014 ${healed ? `${healed} of the party feel their wounds close (+${heal} HP).` : 'a presence passes through and the air grows warm.'}`);
    return true;
  }

  private featureVault(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The vault has been picked clean.', '#888'); return true; }
    f.used = true;
    const searcher = this.game.bestScout();
    const dc = 12 + Math.floor(this.game.dungeonLevel / 2);
    if (rollD20() + searcher.wisMod >= dc) {
      const gp = rollDice(2, 6) * this.game.dungeonLevel;
      this.game.party.leader.gold += gp;
      let extra = '';
      if (Math.random() < 0.4) {
        const gems = ['a chip of azurite', 'a banded agate', 'a fire-red garnet', 'a perfect pearl', 'a star sapphire', 'a flawless ruby'];
        const gem = gems[Math.floor(Math.random() * gems.length)];
        const value = rollDice(1, 6) * 100;
        this.game.party.leader.addToInventory({
          id: `gem_${Math.floor(Math.random() * 1e6)}`,
          name: gem.charAt(0).toUpperCase() + gem.slice(1),
          type: 'treasure',
          description: `A gem worth ${value} gp.`,
          value,
        });
        extra = ` Among the coins: ${gem} worth ${value} gp.`;
      }
      say(`\ud83d\udcb0 ${searcher.name} cracks the vault! ${gp} gp recovered.${extra}`, '#ffd700');
    } else {
      const dmg = rollDice(1, 4);
      searcher.takeDamage(dmg);
      say(`\u2620 A dart whips out of the lock \u2014 ${searcher.name} takes ${dmg} damage wrenching clear.`, '#c66');
    }
    return true;
  }

  private featurePrison(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The cells are empty \u2014 whoever was here is long gone.', '#888'); return true; }
    f.used = true;
    const gp = rollDice(2, 6) * this.game.dungeonLevel;
    this.game.party.leader.gold += gp;
    say(`\u26d1 ${this.game.bestScout().name} works the lock on the deepest cell and finds a prisoner \u2014 a gaunt scribe who presses ${gp} gp into their hands and whispers of what waits on the next floor.`, '#8cf');
    return true;
  }

  private featureChokepoint(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.barricaded) { say('The gap is already braced \u2014 nothing gets through that line easily.', '#888'); return true; }
    f.barricaded = true;
    say('\u2694 The party braces the chokepoint with fallen timber. Foes who come through here will fight at a disadvantage (+1 AC while this room is held).', '#8a8');
    return true;
  }

  private featureForge(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The forge is cold \u2014 nothing left to work here.', '#888'); return true; }
    f.used = true;
    const leader = this.game.party.leader;
    leader.bonusAttackBonus += 1;
    say(`\u2699 ${leader.name} hones a blade at the anvil \u2014 a keen edge gleams. ${leader.name}\u2019s attack bonus is now +${leader.attackBonus}.`, '#fd8');
    return true;
  }

  private featureLibrary(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The tomes have been read \u2014 the shelves hold only rot now.', '#888'); return true; }
    f.used = true;
    const scholar = this.game.bestScout();
    if (rollD20() + scholar.intMod >= 14) {
      const cantrips = SPELLS.filter(s => s.level <= 0);
      const learner = this.game.party.members.find(m => isCaster(m.charClass.id) && cantrips.some(c => !m.knownSpells.includes(c.id)));
      if (learner) {
        const spell = cantrips.find(c => !learner.knownSpells.includes(c.id))!;
        learner.knownSpells.push(spell.id);
        say(`\ud83d\udcda ${scholar.name} deciphers a diagram \u2014 ${learner.name} commits ${spell.name} to memory!`, '#8cf');
      } else {
        for (const m of this.game.party.members) if (!m.isDead) m.addXp(50);
        say('\ud83d\udcda The diagrams are dense but rewarding \u2014 the party lingers, sharpening their understanding (+50 XP each).', '#8cf');
      }
    } else {
      say(`\ud83d\udcda The script resists ${scholar.name}\u2019s translation \u2014 only fragments of meaning surface.`, '#888');
    }
    return true;
  }

  private featureFountain(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The fountain is dry \u2014 its basin holds only a film of dust.', '#888'); return true; }
    f.used = true;
    const drinker = this.game.party.members.find(m => !m.isDead && m.hp < m.maxHp) ?? this.game.party.leader;
    if (Math.random() < 0.5) {
      const heal = rollDice(2, 4) + 2;
      drinker.heal(heal);
      say(`\ud83d\udca7 ${drinker.name} drinks deep \u2014 cool water washes through them (+${heal} HP).`, '#4c4');
    } else {
      const dmg = rollDice(1, 6);
      drinker.takeDamage(dmg);
      if (drinker.makeSavingThrow('con', 10).success) {
        say(`\u2620 The water turns brackish! ${drinker.name} gags but shakes off the worst (${dmg} damage).`, '#c66');
      } else {
        drinker.applyCondition('poisoned', 2, 'Foul fountain');
        say(`\u2620 The water is poisoned! ${drinker.name} fails a CON save, takes ${dmg} damage, and is poisoned for 2 turns.`, '#c66');
      }
    }
    return true;
  }

  private featureSarcophagus(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The lid lies askew \u2014 nothing left to disturb.', '#888'); return true; }
    f.used = true;
    const roll = rollD20();
    const opener = this.game.bestScout();
    if (roll <= 4) {
      const dmg = rollDice(1, 6);
      opener.takeDamage(dmg);
      const saved = opener.makeSavingThrow('con', 11).success;
      if (!saved) opener.applyCondition('poisoned', 2, 'Tomb gas');
      say(`\u2620 Foul gas hisses from the seal! ${opener.name} takes ${dmg} damage${saved ? '' : ' and is poisoned (2 turns)'}.`, '#c66');
    } else if (roll <= 14) {
      const gp = rollDice(2, 6) * this.game.dungeonLevel;
      this.game.party.leader.gold += gp;
      say(`\ud83d\udc8e ${opener.name} eases the lid aside \u2014 grave goods! ${gp} gp recovered.`, '#ffd700');
    } else if (roll <= 19) {
      say(`\ud83d\udcdc The tomb holds only dust and a name in an unknown alphabet \u2014 but a cold draft seems to whisper \u201cleave\u201d.`, '#9aa');
    } else {
      const spirit = getMonsterTemplate('wight') ?? getRandomMonster(3);
      say(`\u2620 The lid SHATTERS outward \u2014 the occupant was never resting! A ${spirit.name} claws free of the tomb!`, '#c44');
      this.game.spawnEncounter([spirit]);
    }
    return true;
  }

  private featureThrone(f: RoomFeature, say: (l: string, c?: string) => void): boolean {
    if (f.used) { say('The throne holds nothing new \u2014 the crown is long gone.', '#888'); return true; }
    f.used = true;
    const gp = rollDice(1, 6) * this.game.dungeonLevel;
    this.game.party.leader.gold += gp;
    say(`\ud83d\udc51 ${this.game.party.leader.name} approaches the throne \u2014 loose coins spill from the cushions (${gp} gp). The seat is cold, but for a moment it feels\u2026 heavy.`, '#ffd700');
    return true;
  }
}

/**
 * Acting on an understood DM order.
 *
 * The pipeline is `Game.handleDMCommand` → `understand()` → this. The
 * understanders (the regex cascade in `ai/DMCommandParser` and the trained
 * classifier in `ai/IntentModel`) decide *which* order was given; nothing
 * about what an order does lives there. This is the other half: one arm per
 * intent, and every line the party says back.
 *
 * A word on `DMCommandHost`, because it is wide. Fifty-odd orders reach across
 * the whole run by definition — the DM can ask about the weather, sell a
 * potion, rename a fighter and march the party downstairs — so "the slice of
 * the game the DM may touch" is close to "the game". What the host still buys,
 * as with `SaveHost`, is honesty in three directions:
 *
 *   - It is an itemised list of what a typed order can reach. If it is not
 *     named here, no order can touch it.
 *   - It asks questions instead of reading enums. Where the party is comes
 *     back as `inTown` / `inDungeon` / `inOverworld`, never as a `GameMode`
 *     ordinal — which also keeps `main.ts` out of this module's import graph,
 *     and so out of vitest's.
 *   - It stops at the point where an order stops being about wording. An order
 *     that only needs to *happen* — save the run, depart the town, start the
 *     walk down to the next floor — is a named method on the host, and Game
 *     keeps its timers, its private travel plans and its dungeon generator to
 *     itself. Only the lines the party speaks are written here, because those
 *     are what the order actually is.
 *
 * `inBattle`, not `inCombat`: an order is refused from the moment initiative
 * is rolled until the last blow has finished landing, which is one phase wider
 * than `Game.inCombat`.
 */

import type { GameCharacter, InventoryItem } from '../entities/Character';
import type { Party } from '../entities/Party';
import type { HUD } from '../ui/HUD';
import type { Monster, MonsterTemplate } from '../entities/Monster';
import type { Room } from '../world/DungeonGenerator';
import { sfx } from '../audio/Sfx';
import type { PlacedTrap } from '../traps/Traps';
import type { Overworld, OverworldEntrance, OverworldTown } from '../world/Overworld';
import type { TownLifeState } from '../world/TownLife';
import type { BanditCampState } from '../quests/BanditCamps';
import type { Quest } from '../quests/Quests';
import type { QuestGiver } from '../quests/QuestGivers';
import type { BulletinTask } from '../quests/BulletinBoard';
import type { WeatherState } from '../world/WeatherSystem';
import type { CalendarDay } from '../world/CalendarSystem';
import type { ClockState, TimeOfDay } from '../world/DayNightSystem';
import type { PartyHistory } from '../ai/LoreGenerator';
import type { DMCommand, DMIntent } from '../ai/DMCommand';
import type { Direction } from '../engine/types';
import type { EquipSlot } from '../entities/Character';

import { curseTelltale } from '../entities/Character';
import { MONSTER_TEMPLATES, getMonsterTemplate } from '../entities/Monster';
import { entranceAt } from '../world/Overworld';
import { getReputationTier } from '../quests/QuestGivers';
import { NIGHT_VISIBILITY_LIGHT, dayChangeNarration, timeOfDayFromPhase } from '../world/DayNightSystem';
import { getMonsterBestiaryEntry } from '../ai/LoreGenerator';
import { CONDITION_META } from '../rules/Rules';
import { getDiceStats } from '../rules/DiceEvents';
import { getLuckDie } from '../rules/LuckDie';
import { getTrapKind, rollPerception } from '../traps/Traps';

/** What the party calls each compass direction when the DM orders a march. */
export const DM_DIR_NAMES: Record<Direction, string> = { up: 'north', down: 'south', left: 'west', right: 'east' };

/** Pick a fitting glyph for a carried item in the loot listing. */
function inventoryItemEmoji(item: InventoryItem): string {
  if (item.id === 'ration') return '🍞';
  if (item.type === 'potion') return '🧪';
  if (item.type === 'scroll') return '📜';
  if (item.type === 'weapon') return '⚔️';
  if (item.type === 'armor') return '🛡️';
  if (item.type === 'treasure') {
    if (item.id.startsWith('gem_')) return '💎';
    if (item.id.startsWith('art_')) return '🖼️';
    return '✨'; // magic item
  }
  return '📦';
}

/** Everything a typed order is allowed to reach. */
export interface DMCommandHost {
  // ── Where the party is standing ──
  readonly inOverworld: boolean;
  readonly inTown: boolean;
  readonly inDungeon: boolean;
  /**
   * Blades are out. One phase wider than `Game.inCombat`: it stays true while
   * the last exchange is still being played out, which is when most orders
   * were always refused.
   */
  readonly inBattle: boolean;
  readonly dungeonName: string;
  readonly dungeonLevel: number;
  readonly currentTown: OverworldTown | null;
  readonly overworld: Overworld | null;
  readonly townLife: TownLifeState | null;
  currentRoom(): Room | undefined;
  /** The room's narration, for "look" underground. */
  describeCurrentRoom(): string;
  /** The same, for "look" on the surface or in a town. */
  describeOverworldHere(): string;

  // ── The party ──
  readonly party: Party;
  readonly history: PartyHistory;
  readonly hud: HUD;
  bestScout(): GameCharacter;
  findItemOwner(nameQuery: string): GameCharacter | null;

  // ── The world around it ──
  readonly monsters: Monster[];
  readonly traps: PlacedTrap[];
  readonly banditCamps: BanditCampState;
  readonly weather: WeatherState | null;
  readonly calendar: CalendarDay;
  /** The named day, as "report" and "calendar" both quote it. */
  calendarDesc(): string;
  /** Writable: "wait until dawn" turns the sky forward. */
  clock: ClockState;
  lastClockStage: TimeOfDay;

  // ── The moon-forge contract, which "calendar" reports the state of ──
  readonly silveredWeapon: boolean;
  readonly moonForgeLevel: number;
  readonly moonForgeBlade: boolean;

  // ── Standing orders the DM leaves behind ──
  dmStance: 'auto' | 'aggressive' | 'cautious';
  dmDirection?: Direction;
  /** Which save slot future saves go to; "save to slot 2" moves it. */
  activeSlot: number;

  // ── Work the party has taken on ──
  readonly quests: Quest[];
  activeQuest(): Quest | undefined;
  acceptQuest(q: Quest): void;
  reportQuest(q: Quest): void;
  listQuests(): void;
  /** One town's board, in the order "tasks" numbers it. */
  boardForTown(townId: string): BulletinTask[];
  acceptBulletinTask(task: BulletinTask): void;
  listBulletinTasks(): void;

  // ── The market ──
  marketStock(): InventoryItem[];
  partyInventory(): InventoryItem[];
  buyItem(item: InventoryItem): void;
  sellItem(item: InventoryItem): void;

  // ── Orders whose whole body lives elsewhere ──
  /** Room features: altars, chests, forges. Returns false if the room has none. */
  performFeatureIntent(intent: DMIntent): boolean;
  /** Disarm the nearest detected trap. False when there is nothing in reach. */
  checkTrapDisarm(maxDist?: number): boolean;
  rollDiceForParty(expr: string): void;
  handleLootedItemUse(raw: string): void;
  journalCodex(raw: string): void;
  handleModelToggle(state: 'on' | 'off' | 'status'): void;
  greetQuestGiver(npc: QuestGiver): void;
  spawnEncounter(templates: MonsterTemplate[]): void;
  /** Announce something the DM made happen, in the DM's own voice. */
  proclaim(message: string): void;

  // ── Effects an order has, which belong to Game ──
  readonly isPaused: boolean;
  togglePause(): void;
  saveGame(silent?: boolean): boolean;
  startFreshRun(): void;
  /** True while a descent is already queued, so a second order is a no-op. */
  readonly isDescending: boolean;
  /** Send the party looking for the stairwell down. */
  beginDescent(): void;
  departTown(): void;
  /** Point the surface march at a town or a dungeon mouth. */
  travelTo(kind: 'town' | 'entrance', id: string): void;
  enterDungeonFromEntrance(e: OverworldEntrance): void;
  exitDungeonToOverworld(): void;
}

export class DMCommandDispatcher {
  constructor(private game: DMCommandHost) {}

  /** What the party does when an order lands and means nothing to them. */
  confusedGlances(): void {
    sfx.refuse();
    this.game.hud.addCombatMessage('The party exchanges confused glances. Type "help" for orders they understand.', '#888');
  }

  /** Act on one understood order. Bodies are the original command handlers, keyed by intent. */
  dispatch(cmd: DMCommand, text: string): void {
    const leader = this.game.party.leader;
    const inCombat = this.game.inBattle;

    switch (cmd.intent) {
      case 'help': {
        for (const line of [
          '• go / head + north, south, east, west — march that way',
          '• attack / charge — hunt nearby foes   |   flee / cautious — avoid fights',
          '• "as you were" — resume normal exploring',
          '• rest (short) or camp / long rest   |   descend / deeper — next floor',
          '• wait until dawn / night — bide your time and let the sky turn',
          '• calendar / what day is it — the weekday, moon, and today’s festivals',
          '• journal / chronicle — read the party’s deeds back',
          '• summon <monster> e.g. "summon owlbear"   |   report — party status',
          '• roll d20 / 2d6+3 / "roll d20 adv" — roll the dice (d20 banks a fated Luck die)',
          '• look / examine / describe — narrate the room around you',
          '• talk to <npc> / list npcs — visit townsfolk for quests and gossip',
          '• raid camp / report camp / list clues — deal with bandit hideouts',
          '• pray at the altar / search the vault / free prisoners / barricade — use the room’s feature',
          '• search for traps / disarm trap — find and defuse dungeon hazards',
          '• loot / inventory / pack — show what the party is carrying',
          '• equip <item> / unequip <item> / gear — manage weapons and armor',
          '• upcast always / never / auto — how aggressively casters spend higher slots',
          '• save — persist to the active slot | "save to slot 1/2/3" — pick a slot | "new game" — wipe it',
          '• rename party <name> — give your party a custom name',
          '• rename <character> to <new name> — rename a party member',
          '• model on / off / status — the DM intent model that reads free-form orders',
          '• pause / resume',
        ]) this.game.hud.addCombatMessage(line, '#8a8');
        return;
      }

      case 'model_toggle': {
        this.game.handleModelToggle(cmd.state);
        return;
      }

      case 'pause': {
        if (!this.game.isPaused) this.game.togglePause();
        this.game.hud.addCombatMessage('Time holds its breath.', '#8cf');
        return;
      }
      case 'resume': {
        this.game.dmStance = 'auto';
        this.game.dmDirection = undefined;
        if (this.game.isPaused) this.game.togglePause();
        this.game.hud.addCombatMessage('The party resumes exploring at its own judgment.', '#8cf');
        return;
      }

      case 'save': {
        if (cmd.slot) {
          this.game.activeSlot = cmd.slot - 1;
          this.game.hud.addCombatMessage(`The party inks the ledger — future saves go to slot ${this.game.activeSlot + 1}.`, '#8cf');
        }
        this.game.saveGame(false);
        return;
      }
      case 'new_game': {
        this.game.startFreshRun();
        return;
      }

      case 'rename_party': {
        const placeName = this.game.inDungeon
          ? this.game.dungeonName
          : (this.game.currentTown?.name ?? 'The Wilderlands');
        if (cmd.name) {
          const chosen = this.game.party.setName(cmd.name);
          this.game.hud.addCombatMessage(`✦ The party is now known as “${chosen}”.`, '#ffd700');
          this.game.hud.setDungeonTitle(`${chosen} — ${placeName}`);
        } else {
          this.game.party.generateDefaultName();
          this.game.hud.addCombatMessage(`✦ The party is now known as “${this.game.party.partyName}”.`, '#ffd700');
          this.game.hud.setDungeonTitle(`${this.game.party.partyName} — ${placeName}`);
        }
        this.game.hud.setParty(this.game.party);
        return;
      }

      case 'rename_member': {
        if (cmd.oldName) {
          const member = this.game.party.members.find(m => m.name.toLowerCase() === cmd.oldName.toLowerCase());
          if (member) {
            const cleaned = cmd.newName.replace(/[^a-zA-Z0-9\s'\-]/g, '').trim().slice(0, 30);
            if (cleaned.length > 0) {
              const old = member.name;
              member.name = cleaned;
              this.game.hud.addCombatMessage(`✦ ${old} is now known as “${cleaned}”.`, '#ffd700');
            } else {
              this.game.hud.addCombatMessage(`⚠ The name “${cmd.newName}” is not valid.`, '#c88');
            }
          } else {
            this.game.hud.addCombatMessage(`⚠ No party member named “${cmd.oldName}” found.`, '#c88');
          }
        } else {
          this.game.hud.addCombatMessage(`⚠ Usage: rename <character> to <new name>  (e.g. “rename Grom to Gandalf”)`, '#c88');
        }
        this.game.hud.setParty(this.game.party);
        return;
      }

      case 'look': {
        this.game.hud.addCombatMessage(this.game.inDungeon ? this.game.describeCurrentRoom() : this.game.describeOverworldHere(), '#8aa');
        return;
      }

      case 'feature_altar': case 'feature_vault': case 'feature_prison': case 'feature_chokepoint':
      case 'feature_forge': case 'feature_library': case 'feature_fountain': case 'feature_sarcophagus':
      case 'feature_throne': case 'feature_trapped_search': case 'feature_trapped_disarm':
      case 'feature_treasure': case 'feature_merchant_talk': case 'feature_merchant_rob':
      case 'feature_puzzle': case 'feature_ritual': case 'feature_war_room': case 'feature_chest':
      case 'feature_inspect': case 'search_room': {
        if (!inCombat && this.game.performFeatureIntent(cmd.intent)) {
          this.game.hud.setParty(this.game.party);
        } else {
          this.confusedGlances();
        }
        return;
      }

      case 'roll': {
        this.game.rollDiceForParty(cmd.expr);
        return;
      }

      case 'upcast': {
        this.game.party.upcastPolicy = cmd.policy;
        const doctrine = this.game.party.upcastPolicy === 'always'
          ? 'Casters spend the highest slot they can — maximum upcast!'
          : this.game.party.upcastPolicy === 'never'
            ? 'Casters always use the lowest usable slot — no upcasting.'
            : 'Casters upcast when the fight calls for it — otherwise lowest slot.';
        this.game.hud.addCombatMessage(`✦ Casting doctrine set: ${doctrine}`, '#8cf');
        return;
      }

      case 'move': {
        if (inCombat) { this.game.hud.addCombatMessage('They cannot reposition mid-melee!', '#c66'); return; }
        this.game.dmDirection = cmd.direction;
        this.game.dmStance = 'auto';
        this.game.hud.addCombatMessage(`${leader.name} nods — the party sets off ${DM_DIR_NAMES[cmd.direction]}.`, '#6a8');
        return;
      }

      case 'descend': {
        if (!this.game.inDungeon) {
          this.game.hud.addCombatMessage('There are no stairs here — the dungeon is underground.', '#886');
          return;
        }
        if (inCombat) { this.game.hud.addCombatMessage('Not with swords still drawn!', '#c66'); return; }
        if (this.game.isDescending) { this.game.hud.addCombatMessage('The party is already on its way down...', '#cc8'); return; }
        this.game.hud.addCombatMessage('⬇ The party seeks the stairwell downward...', '#cc8');
        this.game.beginDescent();
        return;
      }

      case 'wait_until': {
        if (inCombat) { this.game.hud.addCombatMessage('Not while blades are drawn!', '#c66'); return; }
        // Fast-forward the clock to the next desired stage of the day.
        const want = cmd.time === 'dusk' ? 0.5 : cmd.time === 'night' ? 0.75 : 0.08; // dawn / morning / day / default
        const STAMP = 180_000;
        const cur = this.game.clock.phase;
        let delta = want - cur;
        if (delta < 0) delta += 1;
        if (delta < 0.02) delta = 1; // already there — a full day passes
        const newPhase = ((cur + delta) % 1 + 1) % 1;
        const fromStage = this.game.clock.timeOfDay;
        this.game.clock = {
          phase: newPhase,
          elapsed: this.game.clock.elapsed + delta * STAMP,
          timeOfDay: timeOfDayFromPhase(newPhase),
          light: 0.5 - 0.55 * Math.cos(newPhase * Math.PI * 2),
        };
        this.game.lastClockStage = this.game.clock.timeOfDay;
        const line = dayChangeNarration(fromStage, this.game.clock.timeOfDay) ?? 'The campfire crackles and the hours turn. When the party opens their eyes, the world has moved on.';
        this.game.hud.addCombatMessage(`🏕 The party settles in to wait out the hours.`, '#8cf');
        this.game.hud.addCombatMessage(`${this.game.clock.light < NIGHT_VISIBILITY_LIGHT ? '🌙' : '🌤'} ${this.game.clock.timeOfDay.toUpperCase()} — ${line}`, '#7ca');
        return;
      }
      case 'long_rest': {
        if (inCombat) { this.game.hud.addCombatMessage('Not mid-melee!', '#c66'); return; }
        this.game.hud.addCombatMessage('🛡 The party makes camp right here — long rest.', '#8cf');
        for (const msg of this.game.party.longRest()) this.game.hud.addCombatMessage(msg, '#7c7');
        this.game.hud.setParty(this.game.party);
        return;
      }
      case 'short_rest': {
        if (inCombat) { this.game.hud.addCombatMessage('No rest mid-fight — win first!', '#c66'); return; }
        this.game.hud.addCombatMessage('The party pauses for a short rest.', '#8cf');
        for (const msg of this.game.party.shortRest()) this.game.hud.addCombatMessage(msg, '#8cf');
        this.game.hud.setParty(this.game.party);
        return;
      }

      case 'stance': {
        this.game.dmDirection = undefined;
        if (cmd.stance === 'aggressive') {
          this.game.dmStance = 'aggressive';
          this.game.hud.addCombatMessage('⚔ Weapons up — the party will hunt anything that moves.', '#c84');
        } else {
          this.game.dmStance = 'cautious';
          this.game.hud.addCombatMessage('The party tightens formation — discretion over valor.', '#886');
        }
        return;
      }

      case 'formation_help': {
        this.game.hud.addCombatMessage(
          `Formations: “formation 2x2” (block), “formation 1x4” (single file), “formation 2x3” (loose), “formation line”.`,
          '#8cf'
        );
        return;
      }
      case 'formation': {
        const { rows, cols } = cmd;
        this.game.party.setFormation(rows, cols);
        const shape =
          rows === 1 && cols === 4 ? 'a single-file line, four deep'
          : rows === 4 && cols === 1 ? 'a single-file line, four deep'
          : `${cols}×${rows}`;
        this.game.hud.addCombatMessage(`The party reforms into ${shape}${rows > 1 && cols > 1 ? ' block' : ''} — they’ll spread out where space allows and squeeze single-file through tight spots.`, '#8cf');
        return;
      }

      case 'search_traps': {
        if (inCombat) { this.game.hud.addCombatMessage('Not mid-melee!', '#c66'); return; }
        const searcher = this.game.bestScout();
        const { total } = rollPerception(searcher);
        const radius = 3;
        let found = 0;
        for (const t of this.game.traps) {
          if (t.detected || t.disarmed) continue;
          const d = Math.max(Math.abs(t.tile.x - leader.tile.x), Math.abs(t.tile.y - leader.tile.y));
          if (d <= radius) {
            t.detected = true;
            found++;
            this.game.hud.addCombatMessage(`${searcher.name} spots a ${getTrapKind(t.kindId)!.name} at (${t.tile.x}, ${t.tile.y}).`, '#a86');
          }
        }
        // A wired chest is a hazard in this room too, and the chest handler has
        // always promised it could be spotted "with search for traps" — but
        // nothing cleared the flag, so the needle was unavoidable and searching
        // bought nothing. The same look that finds floor traps finds this.
        const chest = this.game.currentRoom()?.feature;
        if (chest?.kind === 'chest' && chest.trapped && !chest.used) {
          if (total >= 12 + Math.floor(this.game.dungeonLevel / 2)) {
            chest.trapped = false;
            found++;
            this.game.hud.addCombatMessage(`${searcher.name} traces a hair-fine wire under the lid of ${chest.name} and stills it.`, '#a86');
          } else {
            this.game.hud.addCombatMessage(`${searcher.name} eyes ${chest.name} and cannot say either way.`, '#888');
          }
        }
        if (found === 0) {
          this.game.hud.addCombatMessage(`${searcher.name} scans the stone (Perception ${total}) but finds no traps nearby.`, '#888');
        } else {
          this.game.hud.addCombatMessage(`${searcher.name} reveals ${found} hidden hazard${found === 1 ? '' : 's'}!`, '#6c6');
        }
        return;
      }

      case 'disarm_trap': {
        if (inCombat) { this.game.hud.addCombatMessage('Not mid-melee!', '#c66'); return; }
        if (!this.game.checkTrapDisarm(3)) {
          this.game.hud.addCombatMessage('There is no detected trap within reach to disarm. Try "search for traps".', '#888');
        }
        return;
      }

      // ── Use a looted potion or scroll (works mid-combat) ──
      case 'use_item': {
        this.game.handleLootedItemUse(cmd.arg);
        return;
      }

      case 'inventory': {
        const carriers = this.game.party.members.filter(m => m.inventory.length > 0);
        if (carriers.length === 0) {
          this.game.hud.addCombatMessage('The party carries nothing but weapons, wounds, and determination.', '#888');
          return;
        }
        let totalItemValue = 0;
        for (const m of carriers) {
          this.game.hud.addCombatMessage(`🎥 ${m.name}'s pack:`, '#ca8');
          for (const item of m.inventory) {
            const value = item.value ?? 0;
            totalItemValue += value;
            this.game.hud.addCombatMessage(
              `  ${inventoryItemEmoji(item)} ${item.name}${value > 0 ? ` (${value.toLocaleString()} gp)` : ''}`,
              '#ca8'
            );
          }
        }
        const coin = this.game.party.members.reduce((s, m) => s + m.gold, 0);
        this.game.hud.addCombatMessage(
          `💰 Combined wealth: ${coin.toLocaleString()} gp in coin + ${totalItemValue.toLocaleString()} gp in carried items.`,
          '#fd8'
        );
        return;
      }

      case 'summon': {
        const query = cmd.monster.toLowerCase();
        const candidates = MONSTER_TEMPLATES
          .filter(t => t.name.toLowerCase().includes(query) || query.includes(t.name.toLowerCase()))
          .sort((a, b) => a.name.length - b.name.length);
        if (candidates.length === 0) {
          this.game.hud.addCombatMessage(`Nothing in the bestiary answers to "${query}".`, '#888');
          return;
        }
        const template = candidates[0];
        this.game.proclaim(`At your word, a ${template.name} manifests!`);
        this.game.spawnEncounter([template]);
        this.game.hud.setParty(this.game.party);
        return;
      }

      case 'calendar': {
        const c = this.game.calendar;
        const phaseLabel = c.moonPhase.replace(/_/g, ' ');
        const alt = this.game.clock.light < NIGHT_VISIBILITY_LIGHT ? 'night' : this.game.clock.light > 0.85 ? 'day' : this.game.clock.timeOfDay;
        this.game.hud.addCombatMessage(`📅 ${this.game.calendarDesc()}.`, '#7aa');
        this.game.hud.addCombatMessage(`The sun is ${alt}.${this.game.calendar.isGloomDay ? ' Old tales say the dead walk a Gloom day.' : ''}${this.game.calendar.isSacredDay ? ' Hearth blesses the faithful — the temple is open to all.' : ''}`, '#9aa');
        if (this.game.calendar.moonLight > 0.86) this.game.hud.addCombatMessage(`🌕 The ${phaseLabel} rides high — a hunting pack is abroad tonight, and werecreatures answer its call.`, '#c86');
        else if (this.game.calendar.moonLight < 0.14) this.game.hud.addCombatMessage(`🌑 The ${phaseLabel} blots the sky — the dark opens vaults the light has kept shut for a thousand years.`, '#8cf');
        else this.game.hud.addCombatMessage(`The ${phaseLabel} sits midway through its cycle.`, '#9aa');
        if (this.game.moonForgeBlade) {
          this.game.hud.addCombatMessage(`⚔ The party wields the legendary Moonfall — silver that sings on every stroke and thunders on a critical.`, '#ffd700');
        } else if (this.game.silveredWeapon && this.game.moonForgeLevel < 3) {
          this.game.hud.addCombatMessage(`⚔ The moon-forge contract stands at tier ${this.game.moonForgeLevel} of 3 — temper the blade further with moon-fangs and a were-pelt at any smith.`, '#ca8');
        } else if (this.game.moonForgeLevel >= 3) {
          this.game.hud.addCombatMessage(`⚔ The moon-forge blade is complete — nothing mortal can temper it further. Seek the forge it spoke of to finish it.`, '#ffd700');
        }
        return;
      }
      case 'journal': {
        this.game.journalCodex(cmd.raw);
        return;
      }
      case 'report': {
        const foes = this.game.monsters.filter(m => m.isAlive).length;
        const armedTraps = this.game.traps.filter(t => !t.disarmed).length;
        const detectedTraps = this.game.traps.filter(t => t.detected && !t.disarmed).length;
        const trapNote = armedTraps > 0
          ? ` | traps: ${detectedTraps}/${armedTraps} visible`
          : ' | traps: none';
        const placeLabel = this.game.inDungeon
          ? this.game.dungeonName
          : this.game.inTown && this.game.currentTown
            ? `${this.game.currentTown.name} (town)`
            : 'The Wilderlands (surface)';
        this.game.hud.addCombatMessage(`📍 ${placeLabel} — ${foes} foe${foes === 1 ? '' : 's'} remain. Orders: ${this.game.dmStance}${this.game.dmDirection ? ` (marching ${DM_DIR_NAMES[this.game.dmDirection]})` : ''} | casting: ${this.game.party.upcastPolicy}${trapNote}.`, '#ffd700');
        this.game.hud.addCombatMessage(`📅 ${this.game.calendarDesc()} — the ${this.game.clock.timeOfDay}, weather ${this.game.weather?.type.replace(/_/g, ' ') ?? 'fair'}.`, '#7aa');
        for (const m of this.game.party.members) {
          const conds = m.conditions.map(c => CONDITION_META[c.id].label).join(', ');
          const pct = Math.round((m.hp / m.maxHp) * 100);
          const state = m.isConscious ? '' : m.isDead ? 'DEAD ' : m.stabilized ? 'STABILIZED ' : 'DYING ';
          this.game.hud.addCombatMessage(`${m.isConscious ? '' : '☠ '}${state}${m.name}: ${pct}% HP${conds ? ` [${conds}]` : ''}${m.concentration ? ` (concentrating)` : ''}${m.exhaustion > 0 ? ` [Exhaustion ${m.exhaustion}]` : ''}`, m.isConscious ? '#ccc' : '#c44');
        }
        this.game.hud.addCombatMessage(`Gold carried: ${this.game.party.members.reduce((s, m) => s + m.gold, 0)}.`, '#ca8');
        const h = this.game.history;
        this.game.hud.addCombatMessage(
          `📜 Chronicle: ${h.kills} slain, ${h.victories} victor${h.victories === 1 ? 'y' : 'ies'}, ${h.defeats} retreat${h.defeats === 1 ? '' : 's'}, ${h.roomsVisited} room${h.roomsVisited === 1 ? '' : 's'} explored, deepest level ${h.deepestLevel}.`,
          '#9aa'
        );
        // Bestiary kill ledger — per-kind totals, most slain first.
        const ledger = Object.entries(h.killLedger)
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1]);
        if (ledger.length > 0) {
          const kinds = ledger.length === 1 ? 'kind' : 'kinds';
          const top = ledger.slice(0, 5).map(([id, n]) => {
            const entry = getMonsterBestiaryEntry(id);
            return `${entry ? entry.name : id} ×${n}`;
          }).join(', ');
          const extra = ledger.length > 5 ? ` (+${ledger.length - 5} more)` : '';
          this.game.hud.addCombatMessage(`📖 Bestiary: ${ledger.length} ${kinds} slain${extra} — ${top}.`, '#7bd');
        }
        const dice = getDiceStats();
        const byType = Object.entries(dice.byType).filter(([, n]) => n > 0).map(([t, n]) => `${n}×${t}`).join(', ');
        this.game.hud.addCombatMessage(`🎲 ${dice.rolls} rolls this session — ${dice.crits} natural 20s, ${dice.fumbles} natural 1s.`, '#fd8');
        const floorDice = dice.byFloor[this.game.dungeonLevel] ?? { rolls: 0, crits: 0, fumbles: 0 };
        this.game.hud.addCombatMessage(
          `🗺 Floor ${this.game.dungeonLevel}: ${floorDice.rolls} rolls — ${floorDice.crits} natural 20s, ${floorDice.fumbles} natural 1s.`,
          '#fd8'
        );
        if (dice.critStreak >= 2) {
          this.game.hud.addCombatMessage(`🔥 ${dice.critStreak} crits in a row (best ${dice.bestCritStreak})!`, '#ffd700');
        } else if (dice.fumbleStreak >= 2) {
          this.game.hud.addCombatMessage(`💀 ${dice.fumbleStreak} fumbles in a row (best ${dice.bestFumbleStreak})…`, '#c66');
        } else if (dice.bestCritStreak >= 2 || dice.bestFumbleStreak >= 2) {
          this.game.hud.addCombatMessage(`Streaks: best ${dice.bestCritStreak} crits, worst ${dice.bestFumbleStreak} fumbles in a row.`, '#aa8');
        }
        const luck = getLuckDie();
        if (luck) this.game.hud.addCombatMessage(`⚡ Fated Luck die pending: ${luck.value} (from "${luck.source}") — spent on the next party d20 roll.`, '#fd8');
        if (byType) this.game.hud.addCombatMessage(`  Breakdown: ${byType}`, '#aa8');
        return;
      }

      // ── Equipment ──
      case 'equip': {
        const itemName = cmd.item;
        const owner = cmd.member
          ? this.game.party.members.find(m => m.name.toLowerCase().includes(cmd.member!)) ?? leader
          : this.game.findItemOwner(itemName) ?? leader;
        const item = [...owner.inventory, ...Object.values(owner.equipment)]
          .find(i => i && i.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(itemName.replace(/[^a-z0-9]+/g, ' ').trim()));
        if (!item) {
          this.game.hud.addCombatMessage(`No one carries a "${itemName}" — try "gear" to see what's held.`, '#886');
          return;
        }
        if (Object.values(owner.equipment).some(e => e?.id === item.id)) {
          this.game.hud.addCombatMessage(`${owner.name} is already using the ${item.name}.`, '#886');
          return;
        }
        // A telltale check before the DM forces gear on someone.
        const telltale = curseTelltale(item);
        if (telltale && !item.curseKnown) {
          item.curseKnown = true;
          this.game.hud.addCombatMessage(`⚠ ${owner.name} examines the ${item.name} first: ${telltale}. Equipping it anyway is unwise.`, '#fa6');
        }
        const line = owner.equip(item.id);
        this.game.hud.addCombatMessage(line ? `⚔ ${line} (AC ${owner.ac})` : `The ${item.name} can't be equipped.`, line ? '#8cf' : '#c66');
        this.game.hud.setParty(this.game.party);
        return;
      }
      case 'unequip': {
        const arg = cmd.arg;
        const SLOT_WORDS: Record<string, EquipSlot> = { weapon: 'weapon', armor: 'armor', shield: 'shield', trinket: 'trinket', ring: 'trinket', amulet: 'trinket', cloak: 'trinket' };
        let done = false;
        for (const m of this.game.party.members) {
          for (const slot of ['weapon', 'armor', 'shield', 'trinket'] as EquipSlot[]) {
            const it = m.equipment[slot];
            if (!it) continue;
            const hit = SLOT_WORDS[arg] === slot ||
              it.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(arg.replace(/[^a-z0-9]+/g, ' ').trim());
            if (hit && arg.length > 0) {
              const line = m.unequip(slot);
              this.game.hud.addCombatMessage(`🎒 ${line} (AC ${m.ac})`, '#8cf');
              done = true;
            }
          }
        }
        if (!done) this.game.hud.addCombatMessage('Nothing like that is equipped — try "gear" to see worn items.', '#886');
        this.game.hud.setParty(this.game.party);
        return;
      }
      case 'gear': {
        this.game.hud.addCombatMessage('⚔ Equipped gear:', '#ffd700');
        for (const m of this.game.party.members) {
          this.game.hud.addCombatMessage(`${m.name} (AC ${m.ac}, +${m.attackBonus} to hit, +${m.damageBonus} dmg): ${m.gearSummary()}`, '#ccc');
        }
        return;
      }

      // ── Overworld, town, quest & commerce ──
      case 'quests': {
        this.game.listQuests();
        return;
      }
      case 'tasks': {
        this.game.listBulletinTasks();
        return;
      }
      case 'accept_task': {
        if (!this.game.inTown || !this.game.currentTown || !this.game.townLife) {
          this.game.hud.addCombatMessage('Board work is taken on in town.', '#886');
          return;
        }
        // The same list "tasks" numbers, so the DM can read a number off the
        // board and have it mean the same notice.
        const board = this.game.boardForTown(this.game.currentTown.id);
        const pick = board[Math.max(0, (cmd.index ?? 1) - 1)];
        if (!pick) {
          this.game.hud.addCombatMessage('Nothing on the board matches that — try "tasks".', '#886');
          return;
        }
        if (pick.completed) {
          this.game.hud.addCombatMessage(`"${pick.title}" is already settled up.`, '#886');
          return;
        }
        this.game.acceptBulletinTask(pick);
        return;
      }
      case 'accept_quest': {
        if (this.game.activeQuest()) {
          this.game.hud.addCombatMessage('A quest is already accepted — finish it before taking another.', '#886');
          return;
        }
        const pool = this.game.quests.filter(q => !q.accepted && !q.turnedIn);
        const q = pool[Math.max(0, (cmd.index ?? 1) - 1)];
        if (!q) {
          this.game.hud.addCombatMessage('There is nothing to accept right now — try "quests".', '#886');
          return;
        }
        this.game.acceptQuest(q);
        return;
      }
      case 'turn_in_quest': {
        const active = this.game.activeQuest();
        if (!active || !active.completed) {
          this.game.hud.addCombatMessage('No quest is ready to report — finish the objective first.', '#886');
          return;
        }
        if (!this.game.inTown) {
          this.game.hud.addCombatMessage('Quest rewards are claimed in town — head back and report there.', '#886');
          return;
        }
        this.game.reportQuest(active);
        return;
      }
      case 'depart_town': {
        this.game.departTown();
        return;
      }
      case 'go_to_town': {
        if (this.game.inOverworld) {
          this.game.travelTo('town', this.game.currentTown?.id ?? this.game.overworld?.spawnTownId ?? '');
          this.game.hud.addCombatMessage('The party turns its steps toward town.', '#6a8');
        } else {
          this.game.hud.addCombatMessage(this.game.inTown ? 'The party is already in town.' : 'The party is underground — climb out first ("leave").', '#886');
        }
        return;
      }
      case 'shop': case 'buy': case 'sell': {
        if (!this.game.inTown) {
          this.game.hud.addCombatMessage('No merchants here — the market is in town.', '#886');
          return;
        }
        this.game.hud.townPanel.show();
        if (cmd.intent !== 'shop') {
          const query = cmd.item.toLowerCase();
          // Buy from the shelves, sell from the packs. Searching both at once
          // meant "sell a potion of healing" found the shop's copy first and
          // then quietly sold nothing, because the party did not own it.
          const shelf = cmd.intent === 'buy' ? this.game.marketStock() : this.game.partyInventory();
          const item = shelf.find(i => i.name.toLowerCase().includes(query));
          if (item) {
            if (cmd.intent === 'buy') this.game.buyItem(item);
            else this.game.sellItem(item);
          } else {
            this.game.hud.addCombatMessage(`No ${cmd.intent === 'buy' ? 'stock' : 'item'} matching "${query}".`, '#888');
          }
        }
        return;
      }
      case 'leave_dungeon': {
        if (this.game.inDungeon) {
          this.game.hud.addCombatMessage('The party turns back and climbs toward the light.', '#ca8');
          this.game.exitDungeonToOverworld();
        } else if (this.game.inOverworld) {
          this.game.hud.addCombatMessage('The party is already on the surface.', '#888');
        } else {
          this.game.hud.addCombatMessage('The party is in town — try "depart" to leave.', '#888');
        }
        return;
      }
      case 'enter_dungeon': {
        const e = this.game.overworld ? entranceAt(this.game.overworld, leader.tile.x, leader.tile.y) : undefined;
        if (this.game.inOverworld && e) {
          this.game.enterDungeonFromEntrance(e);
        } else if (this.game.inDungeon) {
          this.game.hud.addCombatMessage('The party is already underground.', '#888');
        } else {
          this.game.hud.addCombatMessage('There is no dungeon entrance here.', '#888');
        }
        return;
      }
      case 'travel_to': {
        const query = cmd.destination.toLowerCase();
        if (this.game.inOverworld && this.game.overworld) {
          const town = this.game.overworld.towns.find(t => t.name.toLowerCase().includes(query));
          const entrance = this.game.overworld.entrances.find(e => e.name.toLowerCase().includes(query));
          if (town) {
            this.game.travelTo('town', town.id);
            this.game.hud.addCombatMessage(`The party sets course for ${town.name}.`, '#6a8');
          } else if (entrance) {
            this.game.travelTo('entrance', entrance.id);
            this.game.hud.addCombatMessage(`The party sets course for ${entrance.name}.`, '#6a8');
          } else {
            this.game.hud.addCombatMessage(`No town or dungeon named "${query}" on the maps.`, '#888');
          }
        } else {
          this.game.hud.addCombatMessage('Travel orders only make sense on the surface.', '#886');
        }
        return;
      }

      // ── Bandit camps ──
      case 'raid_camp': {
        if (inCombat) { this.game.hud.addCombatMessage('Not mid-melee!', '#c66'); return; }
        if (!this.game.inOverworld) { this.game.hud.addCombatMessage('There are no camps to raid from here — head to the overworld.', '#886'); return; }
        const pendingClue = this.game.banditCamps.clues.find(c => !c.resolved);
        if (!pendingClue) {
          this.game.hud.addCombatMessage('You have no camp clues to act on. Defeat bandits on the road to find their hideouts.', '#888');
          return;
        }
        this.game.hud.addCombatMessage('⚔️ The party moves to assault the bandit camp!', '#c84');
        // Spawn a combat encounter scaled to the camp tier
        const templates = [];
        for (let i = 0; i < 2 + pendingClue.tier; i++) {
          templates.push(getMonsterTemplate('bandit') ?? getMonsterTemplate('goblin')!);
        }
        if (pendingClue.tier >= 2) templates.push(getMonsterTemplate('highwayman') ?? getMonsterTemplate('bandit')!);
        if (pendingClue.tier >= 3) templates.push(getMonsterTemplate('bandit_captain') ?? getMonsterTemplate('orc')!);
        this.game.spawnEncounter(templates);
        pendingClue.resolved = true;
        return;
      }
      case 'report_camp': {
        if (!this.game.inTown) {
          this.game.hud.addCombatMessage('You must be in town to report a camp location.', '#886');
          return;
        }
        const pendingClue = this.game.banditCamps.clues.find(c => !c.resolved);
        if (!pendingClue) {
          this.game.hud.addCombatMessage('You have no camp clues to report.', '#888');
          return;
        }
        // Nobody left standing collects nothing — and the clue is worth too
        // much to be spent on a reward that is never paid. It keeps.
        const living = this.game.party.members.filter(m => m.isAlive);
        if (living.length === 0) {
          this.game.hud.addCombatMessage('There is no one left standing to carry the map inside.', '#886');
          return;
        }
        this.game.hud.addCombatMessage(`🗺️ The constable studies the map and nods grimly.`, '#ca8');
        this.game.hud.addCombatMessage(`"Good work. The guard will handle the rest. Here's your reward — ${pendingClue.reportReward} gold, as promised."`, '#888');
        const each = Math.floor(pendingClue.reportReward / living.length);
        living.forEach(m => m.gold += each);
        pendingClue.resolved = true;
        return;
      }
      case 'list_clues': {
        const pending = this.game.banditCamps.clues.filter(c => !c.resolved);
        if (pending.length === 0) {
          this.game.hud.addCombatMessage('No bandit camp clues in hand. Defeat bandits on the road to find their hideouts.', '#888');
          return;
        }
        // These were numbered, which read as a menu — but neither "raid camp"
        // nor "report camp" takes an index; both always take the oldest
        // unresolved clue. The list marks that one instead of implying a
        // choice the DM does not have.
        this.game.hud.addCombatMessage('🗺️ Bandit Camp Clues:', '#ca8');
        pending.forEach((c, i) => {
          const mark = i === 0 ? '▶' : ' ';
          this.game.hud.addCombatMessage(`  ${mark} ${c.description} (Tier ${c.tier}) — ${c.reportReward} gp`, i === 0 ? '#ca8' : '#a89');
        });
        this.game.hud.addCombatMessage('  ▶ is the one "raid camp" or "report camp" will act on.', '#888');
        return;
      }

      // ── Townsfolk ──
      case 'talk_to': {
        const query = cmd.npc.toLowerCase();
        if (!query) { this.game.hud.addCombatMessage('Who do you want to talk to?', '#888'); return; }
        if (!this.game.inTown || !this.game.currentTown) {
          this.game.hud.addCombatMessage('You must be in town to visit NPCs.', '#886');
          return;
        }
        const tl = this.game.townLife?.byTown[this.game.currentTown.id];
        if (!tl?.questGivers) { this.game.hud.addCombatMessage('No one of note is around right now.', '#888'); return; }
        const npc = tl.questGivers.find(g => g.name.toLowerCase().includes(query));
        if (!npc) { this.game.hud.addCombatMessage(`No one named "${query}" is around right now.`, '#888'); return; }
        this.game.greetQuestGiver(npc);
        return;
      }
      case 'list_npcs': {
        if (!this.game.inTown || !this.game.currentTown) {
          this.game.hud.addCombatMessage('You must be in town to see the locals.', '#886');
          return;
        }
        const tl = this.game.townLife?.byTown[this.game.currentTown.id];
        if (!tl?.questGivers) { this.game.hud.addCombatMessage('No one of note is around.', '#888'); return; }
        this.game.hud.addCombatMessage('👥 Notable NPCs in town:', '#ca8');
        tl.questGivers.forEach(g => {
          this.game.hud.addCombatMessage(`  ${g.portrait} ${g.name} — ${g.title} [${getReputationTier(g)}]`, '#a89');
        });
        return;
      }

      case 'unknown': {
        void text;
        this.confusedGlances();
        return;
      }
    }
  }
}

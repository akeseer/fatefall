/**
 * Bulletin board work — the small jobs a town posts beside the quest board.
 *
 * A task has to be accepted before it counts, and progress is measured from
 * that moment: slay tasks read the kill ledger against a baseline, collect
 * tasks tick up as loot comes out of the dark, scout tasks count rooms opened,
 * and escorts and deliveries resolve on reaching a different town. The game
 * calls in at those four moments; everything else about a task lives here.
 */

import type { Party } from '../entities/Party';
import type { HUD } from '../ui/HUD';
import type { OverworldTown } from '../world/Overworld';
import type { TownLifeState } from '../world/TownLife';
import type { BulletinTask } from '../quests/BulletinBoard';
import { bulletinIcon, bulletinObjective, bulletinObjectiveMet, bulletinProgress } from '../quests/BulletinBoard';

/** The party's running tally of what it has done, which slay tasks read. */
interface PartyHistoryLike {
  killLedger: Record<string, number>;
}

/** The slice of the game the board needs. */
export interface BulletinHost {
  readonly party: Party;
  readonly hud: HUD;
  readonly townLife: TownLifeState | null;
  readonly currentTown: OverworldTown | null;
  readonly history: PartyHistoryLike;
  /** True while the party is standing in a town, where work is taken and claimed. */
  readonly inTown: boolean;
  addGold(n: number): void;
}

export class BulletinBoardController {
  constructor(private game: BulletinHost) {}


  /** Every task on every board, so progress can land wherever the party is. */
  allBulletinTasks(): BulletinTask[] {
    if (!this.game.townLife) return [];
    return Object.values(this.game.townLife.byTown).flatMap(t => t.bulletinTasks ?? []);
  }

  /** Accepted, unfinished tasks — the only ones that can make progress. */
  activeBulletinTasks(): BulletinTask[] {
    return this.allBulletinTasks().filter(t => t.accepted && !t.completed);
  }

  /** Take a task on. Progress is measured from this moment, not from the run. */
  acceptBulletinTask(task: BulletinTask): void {
    if (task.accepted) {
      this.game.hud.addCombatMessage(`The party has already taken on "${task.title}".`, '#8a8');
      return;
    }
    task.accepted = true;
    task.progress = 0;
    if (task.kind === 'slay' && task.targetKind) {
      task.baselineKills = this.game.history.killLedger[task.targetKind] ?? 0;
    }
    if (task.kind === 'escort' || task.kind === 'deliver') {
      task.targetTownId = this.game.currentTown?.id;
    }
    this.game.hud.addCombatMessage(`📋 Task accepted: ${task.title}`, '#ffd700');
    this.game.hud.addCombatMessage(`   ${task.detail}`, '#8cf');
    this.game.hud.addCombatMessage(`   ${bulletinObjective(task)}`, '#8a8');
    this.game.hud.townPanel.refresh();
  }

  /** Announce a task whose objective has just been met. */
  announceBulletinReady(task: BulletinTask): void {
    if (task.completed) return;
    task.completed = true;
    this.game.hud.addCombatMessage(`📋 Task ready to claim: ${task.title} — report in town.`, '#ffd700');
    this.game.hud.townPanel.refresh();
  }

  /** Slay tasks read the kill ledger, so they count kills made since accepting. */
  bulletinSlayProgress(): void {
    for (const task of this.activeBulletinTasks()) {
      if (task.kind !== 'slay' || !task.targetKind) continue;
      const total = this.game.history.killLedger[task.targetKind] ?? 0;
      task.progress = Math.min(task.targetCount, Math.max(0, total - (task.baselineKills ?? 0)));
      if (task.progress >= task.targetCount) this.announceBulletinReady(task);
    }
  }

  /** Collect tasks tick up as the party hauls finds out of the dark. */
  bulletinCollectProgress(found: number): void {
    if (found <= 0) return;
    for (const task of this.activeBulletinTasks()) {
      if (task.kind !== 'collect') continue;
      task.progress = Math.min(task.targetCount, task.progress + found);
      if (task.progress >= task.targetCount) this.announceBulletinReady(task);
    }
  }

  /**
   * Scout tasks count rooms the party opens up. This counts up as each new
   * room is entered rather than diffing a total, because the room tally resets
   * on every floor and a baseline taken in town would never be reached again.
   */
  bulletinScoutProgress(rooms: number = 0): void {
    if (rooms <= 0) return;
    for (const task of this.activeBulletinTasks()) {
      if (task.kind !== 'scout') continue;
      task.progress = Math.min(task.targetCount, task.progress + rooms);
      if (task.progress >= task.targetCount) this.announceBulletinReady(task);
    }
  }

  /** Escorts and deliveries resolve on reaching a town other than the poster's. */
  bulletinArrivalProgress(townId: string): void {
    for (const task of this.activeBulletinTasks()) {
      if (task.kind !== 'escort' && task.kind !== 'deliver') continue;
      // A task with no town recorded against it has no "somewhere else" to
      // reach, so it waits. The falsy guard this replaces let such a task
      // match nothing and resolve at the first town the party walked into,
      // including the one that posted it.
      if (!task.targetTownId || task.targetTownId === townId) continue;
      task.progress = task.targetCount;
      this.announceBulletinReady(task);
    }
  }

  /**
   * The board of one town, in the order the DM is shown it.
   *
   * Numbering it is the whole point: the listing and "accept task 2" used to
   * build the list separately, one over every notice and the other over only
   * the unfinished ones, so a single claimable task on the board put every
   * number out by one.
   */
  boardForTown(townId: string): BulletinTask[] {
    return this.game.townLife?.byTown[townId]?.bulletinTasks ?? [];
  }

  /**
   * Finished work the party is carrying from somewhere else.
   *
   * An escort completes by definition in a town that is not the one that
   * posted it, and the town panel only ever listed the local board — so the
   * party was told to report in and then found nothing to claim until they
   * walked all the way back.
   */
  awayTasksReadyToClaim(townId: string): BulletinTask[] {
    const local = this.boardForTown(townId);
    return this.activeBulletinTasks().filter(t => !local.includes(t) && bulletinObjectiveMet(t));
  }

  completeBulletinTask(task: BulletinTask): void {
    if (!this.game.inTown) {
      this.game.hud.addCombatMessage('Board work is claimed in town.', '#886');
      return;
    }
    if (!task.accepted) {
      this.acceptBulletinTask(task);
      return;
    }
    if (!bulletinObjectiveMet(task)) {
      this.game.hud.addCombatMessage(
        `"${task.title}" is not done yet — ${bulletinProgress(task)}. ${bulletinObjective(task)}`,
        '#886',
      );
      return;
    }
    if (task.progress >= task.targetCount && !task.completed) task.completed = true;

    // Grant rewards. addXp is used so a level-up actually fires.
    this.game.addGold(task.rewardGold);
    for (const m of this.game.party.members) {
      // addXp, not a raw xp bump, so the level-up actually fires.
      if (m.addXp(task.rewardXp)) {
        this.game.hud.addCombatMessage(`⬆ ${m.name} reaches level ${m.level}!`, '#7c7');
      }
    }
    // Reputation reward
    if (this.game.currentTown && this.game.townLife) {
      const tl = this.game.townLife.byTown[this.game.currentTown.id];
      if (tl) {
        tl.townReputation = Math.min(100, tl.townReputation + task.repReward);
      }
    }

    // Claimed work leaves the board.
    if (this.game.townLife) {
      for (const entry of Object.values(this.game.townLife.byTown)) {
        entry.bulletinTasks = (entry.bulletinTasks ?? []).filter(t => t.id !== task.id);
      }
    }

    this.game.hud.addCombatMessage(`📋 Task complete: ${task.title}`, '#ffd700');
    this.game.hud.addCombatMessage(`   +${task.rewardGold} gp, +${task.rewardXp} XP, +${task.repReward} reputation`, '#8cf');
    this.game.hud.setParty(this.game.party);
    this.game.hud.townPanel.refresh();
  }

  /** "tasks" — read the board and the party's in-flight work back to the DM. */
  listBulletinTasks(): void {
    const local = this.game.currentTown && this.game.townLife
      ? this.game.townLife.byTown[this.game.currentTown.id]?.bulletinTasks ?? []
      : [];
    const carried = this.activeBulletinTasks().filter(t => !local.includes(t));
    if (local.length === 0 && carried.length === 0) {
      this.game.hud.addCombatMessage('No board work in hand. Boards are posted in town.', '#888');
      return;
    }
    if (local.length > 0) {
      this.game.hud.addCombatMessage('📋 Bulletin board:', '#ca8');
      local.forEach((t, i) => {
        const state = t.completed ? '✅ ready to claim' : t.accepted ? bulletinProgress(t) : 'not taken';
        this.game.hud.addCombatMessage(`  ${i + 1}. ${bulletinIcon(t.kind)} ${t.title} — ${state}`, '#a89');
        this.game.hud.addCombatMessage(`     ${t.rewardGold} gp, ${t.rewardXp} XP. ${bulletinObjective(t)}`, '#888');
      });
      this.game.hud.addCombatMessage('  Say "accept task 2" to take one on.', '#888');
    }
    if (carried.length > 0) {
      this.game.hud.addCombatMessage('📋 Work in hand from other towns:', '#ca8');
      for (const t of carried) {
        this.game.hud.addCombatMessage(`  ${bulletinIcon(t.kind)} ${t.title} — ${bulletinProgress(t)}`, '#a89');
      }
    }
  }
}

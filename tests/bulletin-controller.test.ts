import { describe, it, expect, beforeEach } from 'vitest';
import { BulletinBoardController, type BulletinHost } from '../src/game/BulletinBoardController';
import type { BulletinTask } from '../src/quests/BulletinBoard';
import { createCharacter } from '../src/game/CharacterFactory';
import { Party } from '../src/entities/Party';
import type { HUD } from '../src/ui/HUD';
import { initTownLife } from '../src/world/TownLife';
import type { TownLifeState } from '../src/world/TownLife';
import type { Overworld, OverworldTown } from '../src/world/Overworld';
import { TileMap } from '../src/world/TileMap';

const EMBERWATCH: OverworldTown = {
  id: 'town_1', name: 'Emberwatch', tile: { x: 10, y: 10 }, radius: 3, population: 400,
  description: '', archetypeId: 'market', buildingIds: [],
};
const DUSKHOLLOW: OverworldTown = {
  id: 'town_2', name: 'Duskhollow', tile: { x: 40, y: 12 }, radius: 3, population: 250,
  description: '', archetypeId: 'market', buildingIds: [],
};

const world = (): Overworld => ({
  map: new TileMap(), towns: [EMBERWATCH, DUSKHOLLOW], entrances: [],
  spawnTownId: 'town_1', pois: [], regions: [],
});

/**
 * The board only reaches the game through `BulletinHost`, so the whole feature
 * can be driven from a stand-in that records what it was asked to do.
 */
class FakeHost implements BulletinHost {
  readonly log: string[] = [];
  refreshes = 0;
  /** What `addGold` was handed, summed — the payout the party actually saw. */
  gold = 0;
  inTown = true;
  currentTown: OverworldTown | null = EMBERWATCH;
  townLife: TownLifeState | null = initTownLife(world());
  readonly history = { killLedger: {} as Record<string, number> };
  readonly party = new Party();
  readonly hud = {
    addCombatMessage: (line: string) => { this.log.push(line); },
    setParty: () => {},
    townPanel: { refresh: () => { this.refreshes++; } },
  } as unknown as HUD;

  constructor() {
    this.party.members = [
      createCharacter('fighter', 'human', 'Kael'),
      createCharacter('cleric', 'human', 'Brenna'),
    ];
  }

  addGold(n: number): void { this.gold += n; }

  said(fragment: string): boolean { return this.log.some(l => l.includes(fragment)); }

  /** Put a notice on a town's board and hand it back for the test to drive. */
  post(task: BulletinTask, townId = 'town_1'): BulletinTask {
    this.townLife!.byTown[townId].bulletinTasks.push(task);
    return task;
  }
}

const mkTask = (over: Partial<BulletinTask> = {}): BulletinTask => ({
  id: 'task_1', kind: 'slay', title: 'Clear the Roads', detail: 'Goblins on the north road.',
  targetKind: 'goblin', targetCount: 3, progress: 0,
  rewardGold: 40, rewardXp: 25, repReward: 5,
  accepted: false, completed: false,
  ...over,
});

let host: FakeHost;
let board: BulletinBoardController;

beforeEach(() => {
  host = new FakeHost();
  board = new BulletinBoardController(host);
});

describe('slay progress', () => {
  it('counts only the kills made after the work was taken on', () => {
    const task = host.post(mkTask({ targetCount: 3 }));
    // The party had already been busy before it read the board.
    host.history.killLedger.goblin = 5;
    board.acceptBulletinTask(task);
    board.bulletinSlayProgress();
    expect(task.progress).toBe(0);

    host.history.killLedger.goblin = 7;
    board.bulletinSlayProgress();
    expect(task.progress).toBe(2);
    expect(task.completed).toBe(false);
  });

  it('reads the ledger by monster template id and not by display name', () => {
    const task = host.post(mkTask({ targetKind: 'goblin', targetCount: 2 }));
    board.acceptBulletinTask(task);
    // A display-name key is the exact mistake the template-id rule exists to
    // prevent: it must not move the task at all.
    host.history.killLedger.Goblin = 9;
    board.bulletinSlayProgress();
    expect(task.progress).toBe(0);

    host.history.killLedger.goblin = 2;
    board.bulletinSlayProgress();
    expect(task.progress).toBe(2);
  });

  it('announces the notice ready and stops counting once the tally is met', () => {
    const task = host.post(mkTask({ targetCount: 2 }));
    board.acceptBulletinTask(task);
    host.history.killLedger.goblin = 30;
    board.bulletinSlayProgress();
    expect(task.progress).toBe(2);
    expect(task.completed).toBe(true);
    expect(host.said('ready to claim')).toBe(true);

    // A finished notice drops out of the active set, so it cannot be announced twice.
    host.log.length = 0;
    board.bulletinSlayProgress();
    expect(host.said('ready to claim')).toBe(false);
  });

  it('leaves a slay notice with no named target alone', () => {
    const task = host.post(mkTask({ targetKind: undefined, targetCount: 2 }));
    board.acceptBulletinTask(task);
    host.history.killLedger.goblin = 9;
    board.bulletinSlayProgress();
    expect(task.progress).toBe(0);
  });

  it('records the baseline only for slay work, since nothing else reads the ledger', () => {
    host.history.killLedger.goblin = 4;
    const collect = host.post(mkTask({ kind: 'collect', targetKind: undefined }));
    board.acceptBulletinTask(collect);
    expect(collect.baselineKills).toBeUndefined();
  });
});

describe('work that has not been taken on', () => {
  it('accrues no progress from any of the four hooks', () => {
    const slay = host.post(mkTask({ id: 'a', kind: 'slay' }));
    const collect = host.post(mkTask({ id: 'b', kind: 'collect', targetKind: undefined }));
    const scout = host.post(mkTask({ id: 'c', kind: 'scout', targetKind: undefined }));
    const escort = host.post(mkTask({ id: 'd', kind: 'escort', targetKind: undefined }));

    host.history.killLedger.goblin = 99;
    board.bulletinSlayProgress();
    board.bulletinCollectProgress(9);
    board.bulletinScoutProgress(9);
    board.bulletinArrivalProgress('town_2');

    for (const t of [slay, collect, scout, escort]) {
      expect(t.progress, `${t.kind} moved without being accepted`).toBe(0);
      expect(t.completed).toBe(false);
    }
  });

  it('refuses to take the same work on twice', () => {
    const task = host.post(mkTask());
    board.acceptBulletinTask(task);
    task.progress = 2;
    board.acceptBulletinTask(task);
    expect(host.said('already taken on')).toBe(true);
    // The second acceptance must not wipe the progress already earned.
    expect(task.progress).toBe(2);
  });
});

describe('collect and scout progress', () => {
  it('adds each haul to a collect task and caps it at the target', () => {
    const task = host.post(mkTask({ kind: 'collect', targetKind: undefined, targetCount: 4 }));
    board.acceptBulletinTask(task);
    board.bulletinCollectProgress(0);
    expect(task.progress).toBe(0);
    board.bulletinCollectProgress(2);
    expect(task.progress).toBe(2);
    board.bulletinCollectProgress(9);
    expect(task.progress).toBe(4);
    expect(task.completed).toBe(true);
  });

  it('counts scouted rooms as they are opened rather than diffing a total', () => {
    const task = host.post(mkTask({ kind: 'scout', targetKind: undefined, targetCount: 3 }));
    board.acceptBulletinTask(task);
    board.bulletinScoutProgress(1);
    board.bulletinScoutProgress(1);
    expect(task.progress).toBe(2);
    // A floor change resets the game's room tally; the task must not.
    board.bulletinScoutProgress(1);
    expect(task.progress).toBe(3);
    expect(task.completed).toBe(true);
  });

  it('keeps each hook to its own kind of work', () => {
    const collect = host.post(mkTask({ id: 'a', kind: 'collect', targetKind: undefined, targetCount: 5 }));
    const scout = host.post(mkTask({ id: 'b', kind: 'scout', targetKind: undefined, targetCount: 5 }));
    board.acceptBulletinTask(collect);
    board.acceptBulletinTask(scout);
    board.bulletinCollectProgress(2);
    expect(collect.progress).toBe(2);
    expect(scout.progress).toBe(0);
  });

  it('moves work taken in one town while the party is standing in another', () => {
    const task = host.post(mkTask({ kind: 'collect', targetKind: undefined, targetCount: 2 }), 'town_2');
    board.acceptBulletinTask(task);
    host.currentTown = EMBERWATCH;
    board.bulletinCollectProgress(2);
    expect(task.progress).toBe(2);
  });

  it('reports nothing on the board when there is no town life yet', () => {
    host.townLife = null;
    expect(board.allBulletinTasks()).toEqual([]);
    expect(board.activeBulletinTasks()).toEqual([]);
  });
});

describe('arrival progress', () => {
  it('records the town the work was taken in, which is the one it cannot be delivered to', () => {
    const task = host.post(mkTask({ kind: 'escort', targetKind: undefined }));
    host.currentTown = EMBERWATCH;
    board.acceptBulletinTask(task);
    expect(task.targetTownId).toBe('town_1');
  });

  it('finishes an escort on reaching a town other than the one that posted it', () => {
    const task = host.post(mkTask({ kind: 'escort', targetKind: undefined, targetCount: 1 }));
    board.acceptBulletinTask(task);
    board.bulletinArrivalProgress('town_2');
    expect(task.progress).toBe(task.targetCount);
    expect(task.completed).toBe(true);
  });

  it('leaves a delivery untouched back in the town that posted it', () => {
    const task = host.post(mkTask({ kind: 'deliver', targetKind: undefined, targetCount: 1 }));
    board.acceptBulletinTask(task);
    board.bulletinArrivalProgress('town_1');
    expect(task.progress).toBe(0);
    expect(task.completed).toBe(false);
  });

  it('ignores slay, collect and scout work when the party rides into town', () => {
    const slay = host.post(mkTask({ id: 'a', kind: 'slay' }));
    const scout = host.post(mkTask({ id: 'b', kind: 'scout', targetKind: undefined }));
    board.acceptBulletinTask(slay);
    board.acceptBulletinTask(scout);
    board.bulletinArrivalProgress('town_2');
    expect(slay.progress).toBe(0);
    expect(scout.progress).toBe(0);
  });

  /**
   * The town used to be compared only when it was set, so an escort accepted
   * outside a town matched nothing and resolved at the first town the party
   * walked into — including the one that posted it.
   */
  it('holds an escort accepted with no town recorded rather than resolving anywhere', () => {
    const task = host.post(mkTask({ kind: 'escort', targetKind: undefined, targetCount: 1 }));
    host.currentTown = null;
    board.acceptBulletinTask(task);
    expect(task.targetTownId).toBeUndefined();
    board.bulletinArrivalProgress('town_1');
    expect(task.progress).toBe(0);
    expect(task.completed).toBeFalsy();
  });
});

describe('claiming finished work', () => {
  it('refuses to settle up anywhere but in town', () => {
    const task = host.post(mkTask({ targetCount: 1, accepted: true, progress: 1 }));
    host.inTown = false;
    board.completeBulletinTask(task);
    expect(host.said('claimed in town')).toBe(true);
    expect(host.gold).toBe(0);
  });

  it('takes the work on when a notice nobody has accepted is claimed', () => {
    const task = host.post(mkTask());
    board.completeBulletinTask(task);
    expect(task.accepted).toBe(true);
    expect(host.gold).toBe(0);
    expect(host.said('Task accepted')).toBe(true);
  });

  it('pays nothing while the objective is unmet, however close it is', () => {
    const task = host.post(mkTask({ targetCount: 3, accepted: true, progress: 2 }));
    board.completeBulletinTask(task);
    expect(host.gold).toBe(0);
    expect(host.said('is not done yet')).toBe(true);
    expect(task.completed).toBe(false);
  });

  it('pays gold, XP and reputation and takes the notice off the board', () => {
    const task = host.post(mkTask({ targetCount: 2, accepted: true, progress: 2, rewardGold: 40, rewardXp: 25, repReward: 5 }));
    const xpBefore = host.party.members.map(m => m.xp);
    board.completeBulletinTask(task);

    expect(host.gold).toBe(40);
    host.party.members.forEach((m, i) => expect(m.xp).toBe(xpBefore[i] + 25));
    expect(host.townLife!.byTown.town_1.townReputation).toBe(5);
    expect(host.townLife!.byTown.town_1.bulletinTasks).not.toContain(task);
    expect(host.said('Task complete')).toBe(true);
  });

  it('clears the claimed notice from every board, not only the one in front of the party', () => {
    const task = mkTask({ targetCount: 1, accepted: true, progress: 1 });
    host.post(task, 'town_1');
    host.post(task, 'town_2');
    board.completeBulletinTask(task);
    expect(host.townLife!.byTown.town_2.bulletinTasks).toEqual([]);
  });

  it('caps town reputation at 100 however lavish the reward', () => {
    host.townLife!.byTown.town_1.townReputation = 98;
    const task = host.post(mkTask({ targetCount: 1, accepted: true, progress: 1, repReward: 25 }));
    board.completeBulletinTask(task);
    expect(host.townLife!.byTown.town_1.townReputation).toBe(100);
  });
});

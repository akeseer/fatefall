import { describe, it, expect } from 'vitest';
import { checkQuestProgress, questProgressText, type Quest, type QuestState } from '../src/quests/Quests';

const quest = (over: Partial<Quest>): Quest => ({
  id: 'q', kind: 'reach_floor', title: 't', detail: 'd', giverTownId: 'town_1', entranceId: 'gate_1',
  targetFloor: 3, targetCount: 1, rewardGold: 10, rewardXp: 10, accepted: true, completed: false, turnedIn: false,
  ...over,
});
const state = (over: Partial<QuestState> = {}): QuestState =>
  ({ dungeonLevel: 1, killLedger: {}, bossSlainThisFloor: false, ...over });

describe('checkQuestProgress', () => {
  it('ignores unaccepted and already-complete quests', () => {
    expect(checkQuestProgress(quest({ accepted: false }), state({ dungeonLevel: 9 }))).toBe(false);
    expect(checkQuestProgress(quest({ completed: true }), state({ dungeonLevel: 9 }))).toBe(false);
  });

  it('reach_floor completes at the target floor and reports once', () => {
    const q = quest({});
    expect(checkQuestProgress(q, state({ dungeonLevel: 2 }))).toBe(false);
    expect(q.completed).toBe(false);
    expect(checkQuestProgress(q, state({ dungeonLevel: 3 }))).toBe(true);
    expect(q.completed).toBe(true);
    expect(checkQuestProgress(q, state({ dungeonLevel: 4 }))).toBe(false);
  });

  it('slay_boss needs the floor and the boss', () => {
    const q = quest({ kind: 'slay_boss' });
    expect(checkQuestProgress(q, state({ dungeonLevel: 3 }))).toBe(false);
    expect(checkQuestProgress(q, state({ dungeonLevel: 2, bossSlainThisFloor: true }))).toBe(false);
    expect(checkQuestProgress(q, state({ dungeonLevel: 3, bossSlainThisFloor: true }))).toBe(true);
  });

  it('slay_kind counts the kill ledger by template id', () => {
    const q = quest({ kind: 'slay_kind', targetKind: 'goblin', targetCount: 3 });
    expect(checkQuestProgress(q, state({ killLedger: { goblin: 2, wolf: 9 } }))).toBe(false);
    expect(checkQuestProgress(q, state({ killLedger: { goblin: 3 } }))).toBe(true);
  });
});

describe('questProgressText', () => {
  it('describes each kind', () => {
    expect(questProgressText(quest({}), state({ dungeonLevel: 5 }))).toBe('Floor 3 / 3 reached');
    expect(questProgressText(quest({ kind: 'slay_boss' }), state({ dungeonLevel: 1 }))).toContain('boss not yet slain');
    const hunt = quest({ kind: 'slay_kind', targetKind: 'goblin', targetCount: 4 });
    expect(questProgressText(hunt, state({ killLedger: { goblin: 7 } }))).toMatch(/slain: 4 \/ 4$/);
    expect(questProgressText(quest({ completed: true }), state())).toContain('Complete');
  });
});

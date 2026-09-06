/**
 * The story, in the game: the slice of `Game` that turns the pure planner in
 * `story/Story.ts` into postings, bosses, cards and choices.
 *
 * The host is asked only for what the story touches: the world to plan lairs
 * in, the quest list to post to, the party to judge readiness by, the HUD to
 * speak through, and a few effects a choice can have. Everything else about
 * quests keeps working as it did, because the main quest is a quest.
 */

import type { Overworld, OverworldTown } from '../world/Overworld';
import type { Quest } from '../quests/Quests';
import type { Party } from '../entities/Party';
import type { HUD } from '../ui/HUD';
import type { MonsterTemplate } from '../entities/Monster';
import { MONSTER_TEMPLATES, isUnseeableMonster } from '../entities/Monster';
import type { ChoiceOption } from '../story/StoryContent';
import {
  applyChoice, autoPick, beginStory, bossOverride, choiceForAct, completeAct, endingText, isStoryQuest,
  journalLines, notReadyLine, planNextAct, questForAct, readiness, readyLine, roman, storyChip,
  type StoryState, type StoryWorld,
} from '../story/Story';
import { sfx } from '../audio/Sfx';

/** How long an unattended party mulls a choice before its temperament decides. */
const AUTO_CHOICE_MS = 25_000;

export interface StoryHost {
  story: StoryState | null;
  overworld: Overworld | null;
  quests: Quest[];
  party: Party;
  hud: HUD;
  activeQuestId: string | null;
  runMode: 'auto' | 'manual';
  readonly isPaused: boolean;
  expeditionJournal: string[];
  dungeonEntranceId: string | null;
  acceptQuest(q: Quest): void;
  addGold(amount: number): void;
  spendGold(amount: number): boolean;
  grantXp(amountFor: (member: { level: number }) => number): void;
  adjustTownReputation(townId: string, delta: number): void;
  setPaused(paused: boolean): void;
  /** A companion joins for an act, and leaves when it ends. */
  hireCompanion(act: { index: number; bossName: string; monsterType: string }): void;
  dismissCompanion(): void;
  /** Each member's own road, for the epilogues. */
  readonly personalQuests: { memberName: string; done: boolean; perk: { title: string } }[];
  inTown: boolean;
}

export class StoryController {
  private pendingCard: { kicker: string; title: string; body: string } | null = null;

  constructor(private readonly game: StoryHost) {}

  // ── Beginning ──

  /** A fresh run: seed the story and plan the opening. The card waits for the loop to start. */
  beginNewRun(): void {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    this.game.story = beginStory(seed);
    this.planAndPost();
    const act = this.game.story.act!;
    this.pendingCard = { kicker: 'Act I', title: act.title, body: act.intro };
  }

  /** A restored run from before the story existed: plan quietly, with no card. */
  ensureStory(): void {
    if (this.game.story) {
      // A save from mid-act keeps its posting; make sure it is on the board.
      const act = this.game.story.act;
      if (act && this.game.story.stage === 'seek' && !this.game.quests.some(q => q.id === act.questId)) {
        this.game.quests.push(questForAct(act));
      }
      return;
    }
    this.game.story = beginStory(hashSeedNow());
    this.planAndPost();
  }

  /** Called once the loop is running, so a card can pause it. */
  afterStart(): void {
    // The chip should not wait for the first step, which a paused or hidden game never takes.
    this.refreshChip();
    if (!this.pendingCard) return;
    const card = this.pendingCard;
    this.pendingCard = null;
    this.showCard(card.kicker, card.title, card.body);
  }

  // ── The party's mind ──

  /** The board posting the party would take next: the story when ready, otherwise side work. */
  nextPosting(): Quest | undefined {
    const open = this.game.quests.filter(q => !q.accepted && !q.turnedIn);
    const story = open.find(isStoryQuest);
    if (story && this.game.story?.act && readiness(this.game.story.act, this.partyLevel()).ready) return story;
    return open.find(q => !isStoryQuest(q));
  }

  /** In town: the story either calls the party on or tells them to grow. */
  onTownArrival(town: OverworldTown): void {
    const s = this.game.story;
    if (!s || !s.act || s.stage !== 'seek') return;
    const act = s.act;
    const level = this.partyLevel();
    const r = readiness(act, level);
    const posting = this.game.quests.find(q => q.id === act.questId);
    if (posting && !posting.accepted && !posting.turnedIn && r.ready && !this.game.activeQuestId) {
      this.game.hud.addCombatMessage(`⚔ ${readyLine(act)}`, '#e8c56a');
      this.game.acceptQuest(posting);
      return;
    }
    if (!r.ready && s.hintedAct !== act.index) {
      s.hintedAct = act.index;
      this.game.hud.addCombatMessage(`📖 ${notReadyLine(act, level)}`, '#c9b8ff');
    }
    // Taverns talk about the act wherever the party goes.
    if (Math.random() < 0.35) {
      this.game.hud.addCombatMessage(`Someone at the bar says ${act.rumor}. (${town.name} has heard it too.)`, '#a89');
    }
  }

  /** The boss the story puts on a floor, if this is the floor. */
  bossOverride(floor: number): { template: MonsterTemplate; name: string } | null {
    const s = this.game.story;
    if (!s) return null;
    return bossOverride(s, this.game.dungeonEntranceId, floor, MONSTER_TEMPLATES);
  }

  /** A quest was turned in. If it was the act's, the act ends: the fall, the twist, the choice. */
  onQuestTurnedIn(q: Quest): void {
    const s = this.game.story;
    if (!s || !s.act || q.id !== s.act.questId) return;
    const act = s.act;
    s.stage = 'choice';
    sfx.levelUp();
    this.game.expeditionJournal.push(`Took ${act.shard} from ${act.bossName} in ${act.entranceName}`);
    this.game.dismissCompanion();
    const kicker = act.kind === 'epilogue' ? act.title : `Act ${roman(act.index)} ends`;
    this.showCard(kicker, act.kind === 'finale' ? 'The Die, Whole' : `${act.shard.replace(/^the /, 'The ')}`, act.fall, () => this.presentChoice());
  }

  private presentChoice(): void {
    const s = this.game.story;
    if (!s || !s.act) return;
    const act = s.act;
    const choice = choiceForAct(act);
    if (!choice) {
      this.finishAct(null);
      return;
    }
    const decide = (o: ChoiceOption) => this.finishAct(o);
    if (this.game.runMode === 'manual') {
      this.game.hud.showStoryChoice(choice.prompt, choice.options, decide);
    } else {
      // Auto: the party is shown thinking, and thinks for itself if nobody steps in.
      this.game.hud.showStoryChoice(choice.prompt, choice.options, decide, {
        seconds: AUTO_CHOICE_MS / 1000,
        fallback: () => autoPick(choice.options, this.temperament()),
      });
    }
  }

  private finishAct(option: ChoiceOption | null): void {
    const s = this.game.story;
    if (!s || !s.act) return;
    const act = s.act;
    const fx = applyChoice(s, option);
    if (option) {
      this.game.hud.addCombatMessage(`⚖ ${option.text}`, '#e8c56a');
      const costs: string[] = [];
    if (fx.gold < 0) costs.push(`${-fx.gold} gold`);
    if (fx.reputation < 0) costs.push(`${-fx.reputation} standing in ${act.giverTownId.replace(/_/g, ' ')}`);
    if (option.difficulty && option.difficulty > 0) costs.push('a harder road ahead');
    const gains: string[] = [];
    if (fx.gold > 0) gains.push(`${fx.gold} gold`);
    if (fx.xp > 0) gains.push(`${fx.xp} XP`);
    if (fx.reputation > 0) gains.push('standing');
    this.game.expeditionJournal.push(`Chose to ${option.label.toLowerCase()} after ${act.title}${costs.length ? ` (it cost ${costs.join(', ')})` : ''}${gains.length ? ` (it brought ${gains.join(', ')})` : ''}`);
      if (fx.gold > 0) this.game.addGold(fx.gold);
      else if (fx.gold < 0) this.game.spendGold(-fx.gold);
      if (fx.xp > 0) this.game.grantXp(() => fx.xp);
      if (fx.reputation !== 0) this.game.adjustTownReputation(act.giverTownId, fx.reputation);
    }
    completeAct(s);

    if (act.kind === 'finale') {
      const ending = endingText(s);
      this.game.expeditionJournal.push('The tale of the shattered die was told to its end');
      this.showCard('The tale is told', 'Fatefall', `${ending}\n\nThe party goes on. The acts that follow are theirs alone, and harder.`, () => {
        const lines = this.game.party.members.map(m => this.memberEpilogue(m.name, m.charClass.id, m.level, m.isDead));
        this.showCard('Epilogues', 'What became of them', lines.join('\n\n'), () => this.planAndPost(true));
      });
      return;
    }
    this.planAndPost(true);
  }

  /** Plan the next act and put it on the board; announce it if asked. */
  private planAndPost(announce = false): void {
    const s = this.game.story;
    const world = this.world();
    if (!s || !world) return;
    const act = planNextAct(s, world);
    s.act = act;
    s.stage = 'seek';
    // Retire any older story posting still lying around.
    for (let i = this.game.quests.length - 1; i >= 0; i--) {
      const q = this.game.quests[i];
      if (isStoryQuest(q) && q.id !== act.questId && !q.turnedIn) this.game.quests.splice(i, 1);
    }
    if (!this.game.quests.some(q => q.id === act.questId)) this.game.quests.push(questForAct(act));
    if (announce) {
      const kicker = act.kind === 'epilogue' ? 'Epilogue' : act.kind === 'finale' ? 'The last act' : `Act ${roman(act.index)}`;
      if (act.index > 1 && act.kind !== 'epilogue' && act.kind !== 'finale') this.game.hireCompanion({ index: act.index, bossName: act.bossName, monsterType: act.monsterType });
      if (act.index > 1 && act.kind !== 'epilogue') {
        // Meanwhile: what the world did while the party rested.
        const meanwhile = `While the party rested and counted its coin, the world did not. Word came down the roads of ${act.bossName}: ${act.rumor}.\n\nBelow ${act.entranceName}, on the ${act.targetFloor === 1 ? 'first' : act.targetFloor === 2 ? 'second' : act.targetFloor === 3 ? 'third' : `${act.targetFloor}th`} floor, it has begun.`;
        this.showCard('Meanwhile', 'Between the acts', meanwhile, () => this.showCard(kicker, act.title, act.intro));
      } else {
        this.showCard(kicker, act.title, act.intro);
      }
    }
  }

  // ── Presentation ──

  /** Keep the top-strip chip current. The HUD dedupes, so this is cheap to call every step. */
  refreshChip(): void {
    const s = this.game.story;
    const text = s ? storyChip(s, this.partyLevel(), this.game.activeQuestId !== null && isStoryQuest({ id: this.game.activeQuestId })) : '';
    this.game.hud.setStoryChip(text || null);
  }

  /** What the Chronicle screen shows. */
  chronicle(): { acts: string[]; current: string | null; flags: string[]; shards: number; complete: boolean } {
    const s = this.game.story;
    if (!s) return { acts: [], current: null, flags: [], shards: 0, complete: false };
    const acts = s.journal.map(j => j.split('|')[1] ?? j);
    const act = s.act;
    const current = act
      ? `${act.kind === 'epilogue' ? act.title : `Act ${roman(act.index)}, ${act.title}`}: ${act.bossName} holds ${act.shard} on floor ${act.targetFloor} of ${act.entranceName}. ${s.stage === 'choice' ? 'The party weighs a choice.' : readiness(act, this.partyLevel()).ready ? 'The party is ready.' : `The party means to reach level ${act.recommendedLevel} first.`}`
      : null;
    return { acts, current, flags: s.flags, shards: Math.min(6, s.complete ? 6 : s.actsDone), complete: s.complete };
  }

  journalLines(): string[] {
    return this.game.story ? journalLines(this.game.story) : [];
  }

  /** One line each, from what the run made of them. */
  private memberEpilogue(name: string, classId: string, level: number, dead: boolean): string {
    const road = this.game.personalQuests.find(q => q.memberName === name);
    const title = road?.done ? ` ${road.perk.title}` : '';
    if (dead) return `${name} did not see the end of it. The others carry the name.`;
    const byClass: Record<string, string> = {
      fighter: 'kept the sword sharp and the door held, and was never once the first to run',
      wizard: 'wrote it all down, and the writing outlived the writer',
      cleric: 'buried more than a cleric should, and prayed for every one',
      rogue: 'is still not saying where the second key went',
      ranger: 'went back to the road afterward, and the road was glad',
      paladin: 'kept the oath, which was the hard part',
      barbarian: 'was calmer after, the way a fire is after',
      druid: 'planted something on every floor, and some of it took',
      bard: 'made the song, and the song made everyone in it braver than they were',
      sorcerer: 'never did find out where the magic came from, and stopped minding',
      warlock: 'paid the patron what was owed, and not a coin more',
      monk: 'sat down at the end of it and did not get up for a long, contented while',
      artificer: 'built a better version of everything that nearly killed them',
      blood_hunter: 'bled for all of them, and would again',
    };
    return `${name}${title}, level ${level}, ${byClass[classId] ?? 'walked out into daylight and kept walking'}.`;
  }

  private showCard(kicker: string, title: string, body: string, then?: () => void): void {
    const wasPaused = this.game.isPaused;
    this.game.setPaused(true);
    this.game.hud.showStoryCard({ kicker, title, body }, () => {
      if (!wasPaused) this.game.setPaused(false);
      then?.();
    });
  }

  // ── Readings of the party ──

  private partyLevel(): number {
    const alive = this.game.party.members.filter(m => !m.isDead);
    if (alive.length === 0) return 1;
    return Math.round(alive.reduce((s, m) => s + m.level, 0) / alive.length);
  }

  private temperament(): { aggression: number; greed: number; loyalty: number } {
    const alive = this.game.party.members.filter(m => !m.isDead);
    const avg = (k: 'aggression' | 'greed' | 'loyalty') => alive.length ? alive.reduce((s, m) => s + (m.personality?.[k] ?? 5), 0) / alive.length : 5;
    return { aggression: avg('aggression'), greed: avg('greed'), loyalty: avg('loyalty') };
  }

  private world(): StoryWorld | null {
    const ow = this.game.overworld;
    if (!ow) return null;
    return {
      entrances: ow.entrances.map(e => ({ id: e.id, name: e.name, tile: e.tile, depth: e.depth })),
      towns: ow.towns.map(t => ({ id: t.id, name: t.name, tile: t.tile })),
      spawnTownId: ow.spawnTownId,
      templates: MONSTER_TEMPLATES,
      unseeable: isUnseeableMonster,
    };
  }
}

function hashSeedNow(): number {
  return (Date.now() ^ 0x5bd1e995) >>> 0;
}

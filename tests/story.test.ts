import { describe, it, expect } from 'vitest';
import {
  beginStory, planNextAct, questForAct, readiness, bossOverride, choiceForAct, applyChoice, completeAct,
  endingText, autoPick, storyChip, recommendedLevelFor, SHARD_ACTS, isStoryQuest, roman,
  type StoryWorld, type StoryState,
} from '../src/story/Story';
import { ANTAGONISTS, CHOICES, MOTIVES, TWISTS, ACT_ONE } from '../src/story/StoryContent';
import { MONSTER_TEMPLATES, isUnseeableMonster } from '../src/entities/Monster';

/** A small world with lairs of every depth, laid out along a road east of the first town. */
function world(): StoryWorld {
  return {
    spawnTownId: 'town_a',
    towns: [
      { id: 'town_a', name: 'Emberwatch', tile: { x: 10, y: 10 } },
      { id: 'town_b', name: 'Duskhollow', tile: { x: 60, y: 12 } },
      { id: 'town_c', name: 'Corvusport', tile: { x: 110, y: 30 } },
    ],
    entrances: [
      { id: 'e1', name: 'The Sunken Crypts', tile: { x: 16, y: 12 }, depth: 2 },
      { id: 'e2', name: 'Blackroot Warren', tile: { x: 40, y: 8 }, depth: 3 },
      { id: 'e3', name: 'The Hollow Fane', tile: { x: 70, y: 20 }, depth: 4 },
      { id: 'e4', name: 'Kingsgrave', tile: { x: 95, y: 28 }, depth: 5 },
      { id: 'e5', name: 'The Drowned Stair', tile: { x: 120, y: 40 }, depth: 5 },
      { id: 'e6', name: 'Ashen Deep', tile: { x: 130, y: 10 }, depth: 5 },
    ],
    templates: MONSTER_TEMPLATES,
    unseeable: isUnseeableMonster,
  };
}

/** Play the story through to a given act, choosing the first option each time. */
function playTo(seed: number, acts: number, pickIndex = 0): StoryState {
  const s = beginStory(seed);
  const w = world();
  for (let i = 0; i < acts; i++) {
    s.act = planNextAct(s, w);
    const c = choiceForAct(s.act);
    applyChoice(s, c ? c.options[Math.min(pickIndex, c.options.length - 1)] : null);
    completeAct(s);
  }
  return s;
}

describe('the opening act', () => {
  it('is the same tale in every run: the Ashen Warden in the nearest crypt, two floors down', () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const s = beginStory(seed);
      const act = planNextAct(s, world());
      expect(act.index).toBe(1);
      expect(act.kind).toBe('opening');
      expect(act.title).toBe(ACT_ONE.title);
      expect(act.bossName).toBe('the Ashen Warden');
      expect(act.monsterType).toBe('undead');
      expect(act.entranceId).toBe('e1');
      expect(act.targetFloor).toBe(2);
      expect(act.recommendedLevel).toBe(1);
      expect(act.intro).toContain('The Sunken Crypts');
    }
  });

  it('is issued as a slay-the-boss quest posted at the nearest town', () => {
    const act = planNextAct(beginStory(7), world());
    const q = questForAct(act);
    expect(isStoryQuest(q)).toBe(true);
    expect(q.kind).toBe('slay_boss');
    expect(q.entranceId).toBe('e1');
    expect(q.targetFloor).toBe(2);
    expect(q.giverTownId).toBe('town_a');
    expect(q.title).toBe('Act I: The Shattered Throw');
    expect(q.accepted).toBe(false);
  });

  it('puts the Warden on the target floor of the target lair and nowhere else', () => {
    const s = beginStory(7);
    s.act = planNextAct(s, world());
    const here = bossOverride(s, 'e1', 2, MONSTER_TEMPLATES);
    expect(here).not.toBeNull();
    expect(here!.name).toBe('the Ashen Warden');
    expect(here!.template.type).toBe('undead');
    expect(here!.template.id).toBe(s.act.bossTemplateId);
    expect(bossOverride(s, 'e1', 1, MONSTER_TEMPLATES)).toBeNull();
    expect(bossOverride(s, 'e2', 2, MONSTER_TEMPLATES)).toBeNull();
    expect(bossOverride(s, null, 2, MONSTER_TEMPLATES)).toBeNull();
  });
});

describe('the acts after it', () => {
  it('are planned the same way twice from the same story', () => {
    const a = playTo(42, 2);
    const b = playTo(42, 2);
    expect(planNextAct(a, world())).toEqual(planNextAct(b, world()));
  });

  it('differ between seeds', () => {
    const plans = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = playTo(seed, 1);
      const act = planNextAct(s, world());
      plans.add(`${act.antagonistId}|${act.motiveId}|${act.twistId}|${act.choiceId}|${act.entranceId}|${act.bossName}`);
    }
    // Forty seeds, and near enough forty different second acts.
    expect(plans.size).toBeGreaterThan(30);
  });

  it('change with the choices the party made', () => {
    const merciful = playTo(5, 1, 0);
    const ruthless = playTo(5, 1, 2);
    expect(merciful.flags).toContain('merciful');
    expect(ruthless.flags).toContain('ruthless');
    const a = planNextAct(merciful, world());
    const b = planNextAct(ruthless, world());
    expect(`${a.antagonistId}|${a.twistId}|${a.motiveId}`).not.toBe(`${b.antagonistId}|${b.twistId}|${b.motiveId}`);
  });

  it('climb in level and depth, and move away from the first town', () => {
    const s = beginStory(11);
    const w = world();
    let lastLevel = 0;
    for (let i = 1; i <= SHARD_ACTS; i++) {
      s.act = planNextAct(s, w);
      expect(s.act.recommendedLevel).toBe(recommendedLevelFor(i));
      expect(s.act.recommendedLevel).toBeGreaterThan(lastLevel);
      lastLevel = s.act.recommendedLevel;
      expect(s.act.targetFloor).toBeLessThanOrEqual(w.entrances.find(e => e.id === s.act!.entranceId)!.depth);
      applyChoice(s, choiceForAct(s.act)?.options[0] ?? null);
      completeAct(s);
    }
    expect(recommendedLevelFor(SHARD_ACTS)).toBe(11);
  });

  it('never reuse an antagonist while there are fresh ones', () => {
    const s = beginStory(3);
    const w = world();
    const seen: string[] = [];
    for (let i = 1; i < SHARD_ACTS; i++) {
      s.act = planNextAct(s, w);
      if (s.act.kind === 'shard') {
        expect(seen).not.toContain(s.act.antagonistId);
        seen.push(s.act.antagonistId);
      }
      applyChoice(s, choiceForAct(s.act)?.options[0] ?? null);
      completeAct(s);
    }
  });

  it('name the boss and fill every blank in the prose', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = playTo(seed, 1);
      const act = planNextAct(s, world());
      expect(act.bossName.length).toBeGreaterThan(3);
      for (const text of [act.intro, act.rumor, act.fall]) {
        expect(text).not.toMatch(/\{\w+\}/);
        expect(text.length).toBeGreaterThan(20);
      }
    }
  });

  it('offer more distinct acts than anyone will see', () => {
    const combos = ANTAGONISTS.length * ANTAGONISTS[0].names.length * ANTAGONISTS[0].epithets.length * MOTIVES.length * TWISTS.length * CHOICES.length * 6;
    expect(combos).toBeGreaterThan(1_000_000);
  });
});

describe('the finale and after', () => {
  it('arrives as the sixth act, and the tale is complete when it falls', () => {
    const s = playTo(8, SHARD_ACTS - 1);
    const finale = planNextAct(s, world());
    expect(finale.kind).toBe('finale');
    expect(finale.bossName).toBe('the Fatebinder');
    expect(choiceForAct(finale)).toBeNull();
    s.act = finale;
    completeAct(s);
    expect(s.complete).toBe(true);
    expect(endingText(s).length).toBeGreaterThan(40);
  });

  it('gives the ending the party earned', () => {
    const s = playTo(8, SHARD_ACTS - 1, 0);
    s.flags.push('sworn');
    expect(endingText(s)).toContain('ring of lead');
    const r = playTo(9, SHARD_ACTS - 1, 2);
    expect(endingText(r)).toContain('The die is thrown');
  });

  it('goes on into epilogue acts that keep climbing', () => {
    const s = playTo(8, SHARD_ACTS);
    expect(s.complete).toBe(true);
    const after = planNextAct(s, world());
    expect(after.kind).toBe('epilogue');
    expect(after.recommendedLevel).toBe(recommendedLevelFor(SHARD_ACTS + 1));
    expect(questForAct(after).title).toBe(after.title);
  });
});

describe('readiness', () => {
  it('holds the party back until the recommended level, then lets it go', () => {
    const s = playTo(4, 1);
    const act = planNextAct(s, world());
    expect(act.recommendedLevel).toBe(3);
    expect(readiness(act, 1)).toEqual({ ready: false, needed: 3, short: 2 });
    expect(readiness(act, 3).ready).toBe(true);
    expect(readiness(act, 9).ready).toBe(true);
  });

  it('says so in the chip', () => {
    const s = beginStory(1);
    s.act = planNextAct(s, world());
    expect(storyChip(s, 1, false)).toContain('ready');
    s.act = { ...s.act, recommendedLevel: 5 };
    expect(storyChip(s, 2, false)).toContain('needs level 5');
    expect(storyChip(s, 5, true)).toContain('floor 2');
    s.stage = 'choice';
    expect(storyChip(s, 5, false)).toContain('choice');
  });

  it('a wish for strength makes the next act harder', () => {
    const s = beginStory(2);
    s.act = planNextAct(s, world());
    applyChoice(s, { id: 'x', label: 'x', text: 'x', flags: [], difficulty: 1 });
    completeAct(s);
    expect(planNextAct(s, world()).recommendedLevel).toBe(recommendedLevelFor(2) + 1);
  });
});

describe('an unattended party', () => {
  const options = CHOICES[0].options;
  it('takes the ruthless road when it is aggressive and greedy', () => {
    expect(autoPick(options, { aggression: 8, greed: 7, loyalty: 4 }).flags).toContain('ruthless');
  });
  it('takes the merciful road when it is loyal and calm', () => {
    expect(autoPick(options, { aggression: 2, greed: 2, loyalty: 8 }).flags).toContain('merciful');
  });
  it('otherwise takes the plain first option', () => {
    expect(autoPick(options, { aggression: 5, greed: 5, loyalty: 5 })).toBe(options[0]);
  });
});

describe('roman numerals', () => {
  it('count acts', () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10].map(roman)).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'IX', 'X']);
  });
});

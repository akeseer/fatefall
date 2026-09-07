import { describe, it, expect } from 'vitest';
import {
  beginStory, planNextAct, choiceForAct, applyChoice, completeAct, thresholdLine, storyBossLine, isActBoss,
  heraldLine, shardBoon, storyRoadEvent, endingText, SHARD_ACTS, type StoryWorld, type StoryState,
} from '../src/story/Story';
import { ACT_ONE, ANTAGONISTS, CHOICES, FINALE, TWISTS, SHARD_BOONS, MOTIVES } from '../src/story/StoryContent';
import { MONSTER_TEMPLATES, isUnseeableMonster } from '../src/entities/Monster';

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

/** Every flag any option, twist or opening can set. */
function producibleFlags(): Set<string> {
  const flags = new Set<string>();
  for (const c of CHOICES) for (const o of c.options) for (const f of o.flags) flags.add(f);
  for (const o of ACT_ONE.choice.options) for (const f of o.flags) flags.add(f);
  // Twists that leave a mark, as completeAct records them.
  for (const f of ['knight_found', 'seen_forgery', 'survivor_spared', 'dreamed', 'seen_map', 'bounty', 'knight_lost']) flags.add(f);
  return flags;
}

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

describe('the antagonists speak', () => {
  it('every antagonist has a threshold, a taunt, a bloodied line and a herald', () => {
    for (const a of ANTAGONISTS) {
      expect(a.threshold.length, a.id).toBeGreaterThan(0);
      expect(a.taunt.length, a.id).toBeGreaterThan(0);
      expect(a.bloodied.length, a.id).toBeGreaterThan(0);
      expect(a.herald.length, a.id).toBeGreaterThan(0);
      for (const line of [...a.threshold, ...a.taunt, ...a.bloodied, ...a.herald]) {
        expect(line, a.id).not.toMatch(/\{(?!name|shard|place|town)\w+\}/);
      }
    }
  });

  it('a shard act’s threshold and voice come from its antagonist, with the names filled in', () => {
    const s = playTo(7, 1);
    s.act = planNextAct(s, world());
    const act = s.act;
    const a = ANTAGONISTS.find(x => x.id === act.antagonistId)!;
    const threshold = thresholdLine(s, act);
    expect(a.threshold.some(t => t.split('{')[0].length > 0 && threshold.startsWith(t.split('{')[0]))).toBe(true);
    expect(threshold).not.toContain('{');
    const opening = storyBossLine(s, act.bossName, 'opening');
    expect(opening).not.toBeNull();
    expect(opening).not.toContain('{name}');
    expect(storyBossLine(s, `\u{1F480} ${act.bossName} (Boss)`, 'bloodied')).not.toBeNull();
    expect(storyBossLine(s, 'Some Other Goblin (Boss)', 'opening')).toBeNull();
    expect(isActBoss(s, act.bossName)).toBe(true);
    // The same fight says the same line on reload.
    expect(storyBossLine(s, act.bossName, 'opening')).toBe(opening);
  });

  it('the opening and the finale have their own voices', () => {
    const s = beginStory(3);
    s.act = planNextAct(s, world());
    expect(thresholdLine(s, s.act)).toBe(ACT_ONE.antagonist.threshold);
    expect(storyBossLine(s, 'the Ashen Warden', 'opening')).toBe(ACT_ONE.antagonist.taunt[0]);
    const f = playTo(3, SHARD_ACTS - 1);
    f.act = planNextAct(f, world());
    expect(f.act.kind).toBe('finale');
    f.flags = [];
    expect(thresholdLine(f, f.act)).toBe(FINALE.confrontation[FINALE.confrontation.length - 1].text);
    expect(storyBossLine(f, 'the Fatebinder', 'opening')).toBe(FINALE.taunt[0]);
  });

  it('the finale’s confrontation follows the party’s flags, most specific first', () => {
    const f = playTo(5, SHARD_ACTS - 1);
    f.act = planNextAct(f, world());
    f.flags = ['defiant'];
    expect(thresholdLine(f, f.act)).toBe(FINALE.confrontation.find(c => c.requires[0] === 'defiant')!.text);
    f.flags.push('fatebinder_met');
    expect(thresholdLine(f, f.act)).toBe(FINALE.confrontation[0].text);
  });

  it('the herald speaks of the giver town and only in a shard act', () => {
    const s = playTo(11, 1);
    s.act = planNextAct(s, world());
    const line = heraldLine(s, s.act, 'Duskhollow', () => 0);
    expect(line).not.toBeNull();
    expect(line).not.toContain('{');
    const o = beginStory(11);
    o.act = planNextAct(o, world());
    expect(heraldLine(o, o.act, 'Duskhollow', () => 0)).toBeNull();
  });
});

describe('the tables hang together', () => {
  it('every flag a twist, choice or ending requires can be earned', () => {
    const can = producibleFlags();
    for (const t of TWISTS) for (const f of t.requires ?? []) expect(can.has(f), `twist ${t.id} needs ${f}`).toBe(true);
    for (const c of CHOICES) for (const f of c.requires ?? []) expect(can.has(f), `choice ${c.id} needs ${f}`).toBe(true);
    for (const e of FINALE.endings) for (const f of e.requires) expect(can.has(f), `ending needs ${f}`).toBe(true);
    for (const c of FINALE.confrontation) for (const f of c.requires) expect(can.has(f), `confrontation needs ${f}`).toBe(true);
    for (const m of MOTIVES) for (const f of m.favouredBy ?? []) expect(can.has(f), `motive ${m.id} favours ${f}`).toBe(true);
  });

  it('the endings and the confrontation end in a catch-all', () => {
    expect(FINALE.endings[FINALE.endings.length - 1].requires).toEqual([]);
    expect(FINALE.confrontation[FINALE.confrontation.length - 1].requires).toEqual([]);
  });

  it('twists leave the marks the later choices ask for', () => {
    const s = beginStory(1);
    s.act = { ...planNextAct(s, world()), twistId: 'dream', kind: 'shard' };
    completeAct(s);
    expect(s.flags).toContain('dreamed');
    s.act = { ...planNextAct(s, world()), twistId: 'map' };
    completeAct(s);
    expect(s.flags).toContain('seen_map');
    s.act = { ...planNextAct(s, world()), twistId: 'the_knight_falls' };
    completeAct(s);
    expect(s.flags).toContain('knight_lost');
    expect(endingText(s)).toBe(FINALE.endings[0].text);
  });

  it('the new choices are offered once their flags are held, and not before', () => {
    const s = beginStory(9);
    const ids = (st: StoryState) => {
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const probe: StoryState = { ...st, seed: st.seed + i, actsDone: 1, journal: [], act: null };
        const act = planNextAct(probe, world());
        if (act.choiceId) seen.add(act.choiceId);
      }
      return seen;
    };
    expect(ids(s).has('the_dreamer')).toBe(false);
    s.flags.push('dreamed');
    expect(ids(s).has('the_dreamer')).toBe(true);
    const sworn = beginStory(9);
    sworn.flags.push('sworn');
    expect(ids(sworn).has('the_wounded_town')).toBe(false);
  });
});

describe('what the shards do', () => {
  it('lend a fated die that rises with the count and caps at the whole die', () => {
    expect(shardBoon(beginStory(1))).toBeNull();
    const one = playTo(1, 1);
    expect(shardBoon(one)).toMatchObject({ value: SHARD_BOONS[0].value, shards: 1 });
    const four = playTo(1, 4);
    expect(shardBoon(four)).toMatchObject({ value: SHARD_BOONS[3].value, shards: 4 });
    const done = playTo(1, SHARD_ACTS + 2);
    expect(done.complete).toBe(true);
    expect(shardBoon(done)).toMatchObject({ value: 20, shards: 6 });
  });
});

describe('the road remembers', () => {
  it('sends hunters after a bounty and help from a network, and nothing to the unremarkable', () => {
    const plain = beginStory(2);
    expect(storyRoadEvent(plain, () => 0.1)).toBeNull();
    const hunted = beginStory(2);
    hunted.flags.push('hunted');
    expect(storyRoadEvent(hunted, () => 0.1)?.kind).toBe('hunters');
    expect(storyRoadEvent(hunted, () => 0.9)).toBeNull();
    const network = beginStory(2);
    network.flags.push('ally_network');
    network.actsDone = 3;
    const help = storyRoadEvent(network, () => 0.9);
    expect(help?.kind).toBe('ally');
    if (help?.kind === 'ally') expect(help.gold).toBe(30);
    expect(storyRoadEvent(network, () => 0.1)).toBeNull();
  });
});

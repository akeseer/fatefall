import { describe, it, expect } from 'vitest';
import { HAZARDS, hazardByKind, hazardDc, pickHazard, readHazard } from '../src/events/Hazards';
import { pickCampScene, readWatch, type CampMember } from '../src/events/CampScenes';
import { canParley, chooseParleyResponse, parleyDc, parleyOffer, resolveParley, tollFor, type ParleyFoe, type ParleyParty } from '../src/events/Parley';
import { ROAD_EVENT_CHANCE, describe as describeRoad, rollRoadEvent } from '../src/events/RoadEvents';

const seq = (...vals: number[]) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

describe('hazards', () => {
  it('every hazard has text for both outcomes and a sane difficulty', () => {
    for (const h of HAZARDS) {
      expect(h.passLine).toContain('{name}');
      expect(h.failLine).toContain('{name}');
      expect(h.baseDc).toBeGreaterThanOrEqual(10);
      expect(h.baseDc).toBeLessThanOrEqual(15);
      expect(hazardByKind(h.kind)).toBe(h);
    }
  });

  it('difficulty climbs one per two floors', () => {
    const h = hazardByKind('collapsing_bridge');
    expect(hazardDc(h, 1)).toBe(h.baseDc);
    expect(hazardDc(h, 2)).toBe(h.baseDc);
    expect(hazardDc(h, 3)).toBe(h.baseDc + 1);
    expect(hazardDc(h, 7)).toBe(h.baseDc + 3);
  });

  it('pickHazard covers the table', () => {
    expect(pickHazard(() => 0).kind).toBe(HAZARDS[0].kind);
    expect(pickHazard(() => 0.999).kind).toBe(HAZARDS[HAZARDS.length - 1].kind);
  });

  it('each-mode: only the failures pay, and the party always comes through', () => {
    const out = readHazard(hazardByKind('spore_wall'), [
      { memberName: 'Ana', success: true },
      { memberName: 'Bo', success: false },
      { memberName: 'Cy', success: false },
    ]);
    expect(out.success).toBe(true);
    expect(out.punished).toEqual(['Bo', 'Cy']);
    expect(out.lines[0]).toContain('Ana');
    expect(out.lines[1]).toContain('Bo');
    expect(out.lines).toHaveLength(4);
  });

  it('group-mode: half or more succeed and no one pays; fewer and everyone does', () => {
    const climb = hazardByKind('chasm_climb');
    const good = readHazard(climb, [
      { memberName: 'A', success: true },
      { memberName: 'B', success: true },
      { memberName: 'C', success: false },
      { memberName: 'D', success: false },
    ]);
    expect(good.success).toBe(true);
    expect(good.punished).toEqual([]);
    const bad = readHazard(climb, [
      { memberName: 'A', success: true },
      { memberName: 'B', success: false },
      { memberName: 'C', success: false },
    ]);
    expect(bad.success).toBe(false);
    expect(bad.punished).toEqual(['A', 'B', 'C']);
    expect(bad.lines[bad.lines.length - 1]).toBe(climb.groupFail);
  });

  it('a lone member in group mode needs only their own success', () => {
    const sleeper = hazardByKind('sleeping_guardian');
    expect(readHazard(sleeper, [{ memberName: 'Solo', success: true }]).success).toBe(true);
    expect(readHazard(sleeper, [{ memberName: 'Solo', success: false }]).success).toBe(false);
    expect(readHazard(sleeper, []).success).toBe(true);
  });
});

const member = (name: string, over: Partial<CampMember> = {}): CampMember => ({
  name, className: 'Fighter', raceName: 'Human', hpPct: 1, loyalty: 5, caution: 5, greed: 5, wisMod: 1, ...over,
});

describe('camp scenes', () => {
  const ctx = { placeName: 'Cinderfen Ruins', floor: 2, nextActTitle: 'The Salt Choir' };

  it('returns nothing for an empty camp and something for any party', () => {
    expect(pickCampScene([], ctx)).toBeNull();
    for (let i = 0; i < 40; i++) {
      const scene = pickCampScene([member('Ana')], ctx);
      expect(scene).not.toBeNull();
      expect(scene!.body.length).toBeGreaterThan(40);
      expect(scene!.title.length).toBeGreaterThan(0);
    }
  });

  it('an argument needs two people, so a lone camper never gets one', () => {
    for (let i = 0; i < 60; i++) {
      expect(pickCampScene([member('Ana')], ctx)!.id).not.toBe('argument');
    }
  });

  it('the watch goes to the sharpest eyes and names them in the effect', () => {
    // Scene index 2 is the watch; the first rng draw picks the scene.
    const scene = pickCampScene([member('Ana', { wisMod: 0 }), member('Bo', { wisMod: 4 })], ctx, seq(2 / 6 + 0.01, 0.5, 0.5))!;
    expect(scene.id).toBe('watch');
    expect(scene.effect).toEqual({ kind: 'watch', watcher: 'Bo', dc: 12 });
    expect(scene.body).toContain('Bo');
  });

  it('the dream names the next act when the story has one', () => {
    const scene = pickCampScene([member('Ana')], ctx, seq(4 / 6 + 0.01, 0.5))!;
    expect(scene.id).toBe('omen');
    expect(scene.body).toContain('The Salt Choir');
    const blind = pickCampScene([member('Ana')], { ...ctx, nextActTitle: undefined }, seq(4 / 6 + 0.01, 0.5))!;
    expect(blind.body).not.toContain('Salt Choir');
  });

  it('the watch reads: a natural 20 finds coin, a success wards, a failure wakes the camp to a fight', () => {
    expect(readWatch('Bo', true, 20)).toMatchObject({ ambush: false, gold: 25 });
    expect(readWatch('Bo', true, 14)).toMatchObject({ ambush: false, gold: 0 });
    expect(readWatch('Bo', false, 3)).toMatchObject({ ambush: true, gold: 0 });
  });
});

const goblins = (n: number): ParleyFoe[] => Array.from({ length: n }, () => ({ name: 'Goblin', type: 'humanoid', cr: 0.25, isBoss: false }));
const party = (over: Partial<ParleyParty> = {}): ParleyParty => ({
  level: 3, aliveCount: 4, avgHpPct: 1, gold: 100, alignment: 'Neutral Good', aggression: 4, caution: 5, greed: 4, bestChaMod: 1, ...over,
});

describe('parley', () => {
  it('only bands that can talk, and never a boss', () => {
    expect(canParley(goblins(2))).toBe(true);
    expect(canParley([{ name: 'Wolf', type: 'beast', cr: 0.25, isBoss: false }])).toBe(false);
    expect(canParley([{ name: 'Goblin King (Boss)', type: 'humanoid', cr: 3, isBoss: true }])).toBe(false);
    expect(canParley([])).toBe(false);
  });

  it('the offer follows the odds: the weak surrender, the strong name a toll, equals try a truce', () => {
    const talk = () => 0; // always willing to talk
    expect(parleyOffer(goblins(2), party({ level: 5 }), talk)).toBe('surrender');
    const ogres: ParleyFoe[] = [{ name: 'Ogre', type: 'giant', cr: 2, isBoss: false }, { name: 'Ogre', type: 'giant', cr: 2, isBoss: false }, { name: 'Ogre', type: 'giant', cr: 2, isBoss: false }];
    expect(parleyOffer(ogres, party({ level: 1, aliveCount: 3, avgHpPct: 0.5 }), talk)).toBe('toll');
    const bandits: ParleyFoe[] = [{ name: 'Bandit', type: 'humanoid', cr: 1, isBoss: false }, { name: 'Bandit', type: 'humanoid', cr: 1, isBoss: false }, { name: 'Bandit', type: 'humanoid', cr: 1, isBoss: false }, { name: 'Bandit', type: 'humanoid', cr: 1, isBoss: false }];
    expect(parleyOffer(bandits, party({ level: 2 }), talk)).toBe('truce');
    // Most bands do not open their mouths at all.
    expect(parleyOffer(goblins(2), party(), () => 0.9)).toBeNull();
  });

  it('the party answers in character', () => {
    expect(chooseParleyResponse('surrender', party({ alignment: 'Chaotic Evil', aggression: 8 }))).toBe('refuse');
    expect(chooseParleyResponse('surrender', party())).toBe('accept');
    expect(chooseParleyResponse('surrender', party({ bestChaMod: 4, greed: 7 }))).toBe('persuade');
    expect(chooseParleyResponse('toll', party({ bestChaMod: 5 }))).toBe('persuade');
    expect(chooseParleyResponse('toll', party({ aggression: 8 }))).toBe('refuse');
    expect(chooseParleyResponse('toll', party({ caution: 7 }))).toBe('accept');
    expect(chooseParleyResponse('truce', party({ aggression: 9 }))).toBe('refuse');
    expect(chooseParleyResponse('truce', party({ alignment: 'Lawful Good', bestChaMod: 0 }))).toBe('accept');
  });

  it('a toll is bounded by what the party has', () => {
    expect(tollFor(goblins(2), party({ gold: 10 }))).toBe(10);
    expect(tollFor(goblins(4), party({ gold: 1000 }))).toBe(35);
    expect(parleyDc('toll', goblins(4))).toBeGreaterThan(parleyDc('surrender', goblins(4)));
  });

  it('resolves: coin changes hands, the foes leave, or steel decides', () => {
    const p = party();
    const paid = resolveParley('toll', 'accept', goblins(4), p, 'Ana', null);
    expect(paid.fight).toBe(false);
    expect(paid.gold).toBeLessThan(0);
    expect(paid.foesLeave).toBe(true);
    const refused = resolveParley('toll', 'refuse', goblins(4), p, 'Ana', null);
    expect(refused.fight).toBe(true);
    expect(refused.foesLeave).toBe(false);
    const haggled = resolveParley('toll', 'persuade', goblins(4), p, 'Ana', { success: true, natural: 15 });
    expect(haggled.fight).toBe(false);
    expect(-haggled.gold).toBeLessThan(-paid.gold);
    const laughed = resolveParley('toll', 'persuade', goblins(4), p, 'Ana', { success: true, natural: 20 });
    expect(laughed.gold).toBe(0);
    expect(laughed.xp).toBeGreaterThan(haggled.xp);
    const ransom = resolveParley('surrender', 'accept', goblins(3), p, 'Ana', null);
    expect(ransom.gold).toBeGreaterThan(0);
    const squeezed = resolveParley('surrender', 'persuade', goblins(3), p, 'Ana', { success: true, natural: 12 });
    expect(squeezed.gold).toBe(ransom.gold * 2);
    const botched = resolveParley('truce', 'persuade', goblins(3), p, 'Ana', { success: false, natural: 4 });
    expect(botched.fight).toBe(true);
    for (const r of [paid, refused, haggled, ransom, botched]) expect(r.lines[0]).toContain('Ana');
  });
});

describe('road events', () => {
  const ctx = { gold: 50, partyLevel: 2, weather: null, isSacredDay: false, nearTown: false, woundedCount: 0 };

  it('most steps hold nothing', () => {
    expect(rollRoadEvent(ctx, () => ROAD_EVENT_CHANCE + 0.01)).toBeNull();
    expect(rollRoadEvent(ctx, seq(0, 0.5))).not.toBeNull();
  });

  it('storms only in storms; toll-takers keep away from towns', () => {
    for (let i = 0; i < 200; i++) {
      const e = rollRoadEvent({ ...ctx, weather: null }, seq(0, i / 200));
      expect(e?.kind).not.toBe('storm_shelter');
    }
    const stormy = new Set<string>();
    for (let i = 0; i < 200; i++) stormy.add(rollRoadEvent({ ...ctx, weather: 'heavy_rain' }, seq(0, i / 200))!.kind);
    expect(stormy.has('storm_shelter')).toBe(true);
  });

  it('every event describes itself and carries a usable effect', () => {
    for (const kind of ['caravan', 'pilgrims', 'toll_bridge', 'storm_shelter', 'rival_party', 'lost_traveller'] as const) {
      const e = describeRoad(kind, ctx);
      expect(e.kind).toBe(kind);
      expect(e.lines.length).toBeGreaterThan(0);
      expect(e.effect.kind).toBeTruthy();
    }
    const holy = describeRoad('pilgrims', { ...ctx, isSacredDay: true });
    expect(holy.effect).toMatchObject({ kind: 'blessing', attack: 2, fights: 3 });
    const rival = describeRoad('rival_party', { ...ctx, gold: 5 });
    expect(rival.effect).toMatchObject({ kind: 'contest', lossGold: 5 });
  });
});

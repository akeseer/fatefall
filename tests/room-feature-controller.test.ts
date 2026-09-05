import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomFeatureController, type RoomFeatureHost } from '../src/game/RoomFeatureController';
import { createCharacter } from '../src/game/CharacterFactory';
import type { GameCharacter } from '../src/entities/Character';
import type { MonsterTemplate } from '../src/entities/Monster';
import { Party } from '../src/entities/Party';
import type { Room } from '../src/world/DungeonGenerator';
import type { RoomFeature, RoomFeatureKind } from '../src/world/RoomFeatures';
import type { LootResult } from '../src/loot/LootTables';
import type { HUD } from '../src/ui/HUD';
import { FEATURE_INTENT_KIND, type DMIntent } from '../src/ai/DMCommand';
import { initTownLife } from '../src/world/TownLife';
import type { TownLifeState } from '../src/world/TownLife';
import type { Overworld, OverworldTown } from '../src/world/Overworld';
import { TileMap } from '../src/world/TileMap';
import { resetDiceEvents, getDiceHistory } from '../src/rules/DiceEvents';
import { grantLuckDie } from '../src/rules/LuckDie';

const EMBERWATCH: OverworldTown = {
  id: 'town_1', name: 'Emberwatch', tile: { x: 10, y: 10 }, radius: 3, population: 400,
  description: '', archetypeId: 'market', buildingIds: [],
};
const world = (): Overworld => ({
  map: new TileMap(), towns: [EMBERWATCH], entrances: [], spawnTownId: 'town_1', pois: [], regions: [],
});

const mkFeature = (over: Partial<RoomFeature> & { kind: RoomFeatureKind }): RoomFeature => ({
  id: 'f1', name: 'a rusted altar', entryLine: '', inspect: 'It is old.', used: false, ...over,
});

class FakeHost implements RoomFeatureHost {
  readonly log: string[] = [];
  gold = 0;
  dungeonLevel = 3;
  townLife: TownLifeState | null = initTownLife(world());
  currentTown: OverworldTown | null = EMBERWATCH;
  room: Room | undefined;
  /** Everything the host was asked to spawn or hand out, for the tests to read. */
  readonly spawned: MonsterTemplate[][] = [];
  readonly looted: LootResult[] = [];
  readonly party = new Party();
  readonly hud = {
    addCombatMessage: (line: string) => { this.log.push(line); },
    setParty: () => {},
    townPanel: { refresh: () => {} },
  } as unknown as HUD;

  constructor() {
    this.party.members = [
      createCharacter('fighter', 'human', 'Kael'),
      createCharacter('rogue', 'halfling', 'Wren'),
      createCharacter('wizard', 'human', 'Ysolde'),
    ];
    for (const m of this.party.members) m.gold = 0;
  }

  currentRoom(): Room | undefined { return this.room; }
  addGold(n: number): void { this.gold += n; }
  bestScout(): GameCharacter { return this.party.members[1]; }
  bestDisarmer(): GameCharacter { return this.party.members[1]; }
  spawnEncounter(templates: MonsterTemplate[]): void { this.spawned.push(templates); }
  distributeLoot(loot: LootResult): void { this.looted.push(loot); }
  treasuresCounted = 0;
  recordTreasureFound(count: number): void { this.treasuresCounted += count; }
  /** Mirrors Game.spendGold: affordability first, then richest pocket first. */
  spendGold(n: number): boolean {
    const total = this.party.members.reduce((s, m) => s + m.gold, 0);
    if (total < n) return false;
    let remaining = n;
    for (const m of [...this.party.members].sort((a, b) => b.gold - a.gold)) {
      const take = Math.min(m.gold, remaining);
      m.gold -= take;
      remaining -= take;
    }
    return true;
  }
  levelUps = 0;
  grantXp(amountFor: (m: GameCharacter) => number): void {
    for (const m of this.party.members) {
      const amount = amountFor(m);
      if (amount > 0 && m.addXp(amount)) this.levelUps++;
    }
  }
  battleEdge: { attackBonus: number; fights: number } | null = null;
  grantBattleEdge(attackBonus: number, fights: number): void { this.battleEdge = { attackBonus, fights }; }

  said(fragment: string): boolean { return this.log.some(l => l.includes(fragment)); }

  /** Stand the party in a room holding one feature, and hand the feature back. */
  place(feature: RoomFeature): RoomFeature {
    this.room = { feature } as unknown as Room;
    return feature;
  }
}

let host: FakeHost;
let features: RoomFeatureController;

beforeEach(() => {
  resetDiceEvents();
  grantLuckDie(null);
  host = new FakeHost();
  features = new RoomFeatureController(host);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('routing an order to the feature in the room', () => {
  it('hands "search the room" back to the game when there is a feature to describe', () => {
    host.place(mkFeature({ kind: 'altar' }));
    expect(features.perform('search_room')).toBe(false);
  });

  it('narrates an empty room itself when there is no feature', () => {
    expect(features.perform('search_room')).toBe(true);
    expect(host.said('nothing of note')).toBe(true);
  });

  it('declines every feature order in a room with no feature', () => {
    for (const intent of Object.keys(FEATURE_INTENT_KIND) as DMIntent[]) {
      expect(features.perform(intent), `${intent} in a bare room`).toBe(false);
    }
    expect(features.perform('feature_inspect')).toBe(false);
  });

  it('declines an order aimed at a feature the room does not hold', () => {
    host.place(mkFeature({ kind: 'vault' }));
    expect(features.perform('feature_altar')).toBe(false);
    expect(features.perform('feature_chest')).toBe(false);
    // The vault's own order is the one that lands.
    expect(features.perform('feature_vault')).toBe(true);
  });

  it('inspects without spending the feature, and quotes the order that would', () => {
    const f = host.place(mkFeature({ kind: 'forge', inspect: 'Coals still glow.' }));
    expect(features.perform('feature_inspect')).toBe(true);
    expect(f.used).toBe(false);
    expect(host.said('Coals still glow.')).toBe(true);
    expect(host.said(RoomFeatureController.HINT.forge)).toBe(true);
  });

  it('drops the how-to hint once the feature has been spent', () => {
    const f = host.place(mkFeature({ kind: 'forge', used: true, inspect: 'The coals are dead.' }));
    features.perform('feature_inspect');
    expect(host.said(RoomFeatureController.HINT.forge)).toBe(false);
    expect(f.used).toBe(true);
  });

  it('names an order for every kind of feature that can be placed', () => {
    // A kind with no hint would leave the DM with nothing to type at it.
    for (const kind of Object.values(FEATURE_INTENT_KIND) as RoomFeatureKind[]) {
      expect(RoomFeatureController.HINT[kind], `no hint for ${kind}`).toBeTruthy();
    }
  });
});

describe('a feature that has already been used', () => {
  /** Each kind's single big interaction, and the intent that triggers it. */
  const SPENT: [DMIntent, RoomFeatureKind][] = [
    ['feature_altar', 'altar'],
    ['feature_vault', 'vault'],
    ['feature_prison', 'prison'],
    ['feature_forge', 'forge'],
    ['feature_library', 'library'],
    ['feature_fountain', 'fountain'],
    ['feature_sarcophagus', 'sarcophagus'],
    ['feature_throne', 'throne'],
    ['feature_treasure', 'treasure_room'],
    ['feature_puzzle', 'puzzle_room'],
    ['feature_ritual', 'ritual_chamber'],
    ['feature_war_room', 'war_room'],
    ['feature_chest', 'chest'],
    ['feature_merchant_rob', 'merchant_camp'],
  ];

  it('consumes the order but pays out nothing a second time', () => {
    for (const [intent, kind] of SPENT) {
      host = new FakeHost();
      features = new RoomFeatureController(host);
      host.place(mkFeature({ kind, used: true }));
      const goldBefore = host.party.members.reduce((s, m) => s + m.gold, 0);

      expect(features.perform(intent), `${intent} on a spent feature`).toBe(true);
      expect(host.gold, `${intent} paid out again`).toBe(0);
      expect(host.party.members.reduce((s, m) => s + m.gold, 0)).toBe(goldBefore);
      expect(host.log.length, `${intent} said nothing`).toBeGreaterThan(0);
    }
  });
});

describe('the deterministic features', () => {
  it('braces a chokepoint once and then reports the line already held', () => {
    const f = host.place(mkFeature({ kind: 'chokepoint', name: 'a collapsed arch' }));
    expect(features.perform('feature_chokepoint')).toBe(true);
    expect(f.barricaded).toBe(true);
    host.log.length = 0;
    expect(features.perform('feature_chokepoint')).toBe(true);
    expect(host.said('already braced')).toBe(true);
  });

  it('hones the leader\'s weapon at the forge and spends the anvil', () => {
    const f = host.place(mkFeature({ kind: 'forge' }));
    const before = host.party.leader.attackBonus;
    expect(features.perform('feature_forge')).toBe(true);
    expect(host.party.leader.attackBonus).toBe(before + 1);
    expect(f.used).toBe(true);
  });

  it('warns rather than acting on a trapped corridor, which the trap system owns', () => {
    const f = host.place(mkFeature({ kind: 'trapped_corridor' }));
    expect(features.perform('feature_trapped_search')).toBe(true);
    expect(features.perform('feature_trapped_disarm')).toBe(true);
    // Neither order spends the corridor: the real work happens in the trap system.
    expect(f.used).toBe(false);
  });

  it('a penniless party can talk to the merchant as often as it likes, and buys nothing', () => {
    const f = host.place(mkFeature({ kind: 'merchant_camp' }));
    expect(features.perform('feature_merchant_talk')).toBe(true);
    expect(f.used).toBe(false);
    expect(host.said('cannot scrape together')).toBe(true);
    expect(host.party.leader.inventory.some(i => i.id === 'potion_healing')).toBe(false);
    expect(features.perform('feature_merchant_talk')).toBe(true);
  });

  it('sells the party a discounted healing potion and then packs up', () => {
    host.party.members[1].gold = 25;
    const f = host.place(mkFeature({ kind: 'merchant_camp' }));
    expect(features.perform('feature_merchant_talk')).toBe(true);
    expect(f.used).toBe(true);
    // The cheapest ware is the potion, at the dungeon price rather than the town's 50.
    expect(host.party.members[1].gold).toBe(25 - RoomFeatureController.MERCHANT_POTION_PRICE);
    expect(host.party.leader.inventory.filter(i => i.id === 'potion_healing')).toHaveLength(1);
    host.log.length = 0;
    expect(features.perform('feature_merchant_talk')).toBe(true);
    expect(host.said('packed up')).toBe(true);
  });

  it('the war room hands the combat engine a +2 edge for one battle', () => {
    const f = host.place(mkFeature({ kind: 'war_room' }));
    expect(features.perform('feature_war_room')).toBe(true);
    expect(host.battleEdge).toEqual({ attackBonus: 2, fights: 1 });
    expect(f.used).toBe(true);
  });

  it('the ritual chamber really restores an expended spell slot', () => {
    // Force the slot-restoring branch of the ritual (0.5 <= roll < 0.8).
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const wizard = host.party.members[2];
    const max = wizard.maxSpellSlots[1];
    expect(max).toBeGreaterThan(0);
    wizard.spellSlots[1] = max - 1;
    host.place(mkFeature({ kind: 'ritual_chamber' }));
    expect(features.perform('feature_ritual')).toBe(true);
    expect(wizard.spellSlots[1]).toBe(max);
    expect(host.said('spell slot restored')).toBe(true);
  });

  it('the ritual chamber grants XP through the level-up path', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const fighter = host.party.members[0];
    fighter.xp = fighter.xpToNext() - 1;
    host.place(mkFeature({ kind: 'ritual_chamber' }));
    expect(features.perform('feature_ritual')).toBe(true);
    expect(fighter.level).toBe(2);
    // Only the fighter was a hair from levelling; the announcement fires once.
    expect(host.levelUps).toBe(1);
  });

  it('robbing the merchant pays out once and costs standing in the nearest town', () => {
    host.townLife!.byTown.town_1.townReputation = 20;
    const f = host.place(mkFeature({ kind: 'merchant_camp' }));
    expect(features.perform('feature_merchant_rob')).toBe(true);
    expect(f.used).toBe(true);
    expect(host.gold).toBeGreaterThanOrEqual(15);
    expect(host.gold).toBeLessThan(45);
    expect(host.townLife!.byTown.town_1.townReputation).toBe(15);
  });

  it('never drives town standing below nothing, however often the party robs', () => {
    host.townLife!.byTown.town_1.townReputation = 2;
    host.place(mkFeature({ kind: 'merchant_camp' }));
    features.perform('feature_merchant_rob');
    expect(host.townLife!.byTown.town_1.townReputation).toBe(0);
  });

  it('heals the wounded at an altar and leaves the hale alone', () => {
    const [, wounded, hale] = host.party.members;
    wounded.hp = 1;
    const haleHp = hale.hp;
    const f = host.place(mkFeature({ kind: 'altar' }));
    expect(features.perform('feature_altar')).toBe(true);
    expect(wounded.hp).toBeGreaterThan(1);
    expect(hale.hp).toBe(haleHp);
    expect(f.used).toBe(true);
  });

  it('frees a prisoner who pays the party leader for the trouble', () => {
    const leader = host.party.leader;
    host.place(mkFeature({ kind: 'prison' }));
    expect(features.perform('feature_prison')).toBe(true);
    expect(leader.gold).toBeGreaterThan(0);
  });

  it('shakes loose coins from the throne into the leader\'s purse', () => {
    const leader = host.party.leader;
    host.place(mkFeature({ kind: 'throne' }));
    expect(features.perform('feature_throne')).toBe(true);
    expect(leader.gold).toBeGreaterThan(0);
  });

  it('pays treasure-room gold through the party purse, not into one pocket', () => {
    host.place(mkFeature({ kind: 'treasure_room' }));
    expect(features.perform('feature_treasure')).toBe(true);
    expect(host.gold).toBeGreaterThanOrEqual(20);
    expect(host.gold).toBeLessThan(100);
  });
});

describe('opening a chest', () => {
  it('reports an empty chest without rolling anything', () => {
    host.place(mkFeature({ kind: 'chest', name: 'a small brass coffer', used: true }));
    expect(features.perform('feature_chest')).toBe(true);
    expect(getDiceHistory()).toEqual([]);
    expect(host.looted).toEqual([]);
  });

  it('costs the turn when the strongest hand fails to force the lid', () => {
    // A natural 1 cannot reach the DC on any Strength modifier this party has.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const f = host.place(mkFeature({ kind: 'chest', name: 'a banded chest', locked: true }));
    expect(features.perform('feature_chest')).toBe(true);
    expect(f.locked).toBe(true);
    expect(f.used).toBe(false);
    expect(host.looted).toEqual([]);
    expect(host.said('does not give')).toBe(true);
    // The attempt is a visible check, not a silent one.
    expect(getDiceHistory().some(d => d.kind === 'check' && d.diceType === 'd20')).toBe(true);
  });

  it('opens the forced chest and hands the haul to the party', () => {
    // A natural 20 clears the DC for anyone.
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const f = host.place(mkFeature({ kind: 'chest', name: 'a banded chest', locked: true }));
    expect(features.perform('feature_chest')).toBe(true);
    expect(f.locked).toBe(false);
    expect(f.used).toBe(true);
    expect(host.looted.length).toBe(1);
  });

  it('drops the kill-flavoured loot lines, since nothing died in a chest', () => {
    host.place(mkFeature({ kind: 'chest', name: 'a banded chest' }));
    features.perform('feature_chest');
    const narration = host.looted[0].narration.join(' ');
    expect(narration).not.toMatch(/corpse|body|remains|yields/i);
  });

  it('springs the needle on a wired chest', () => {
    const f = host.place(mkFeature({ kind: 'chest', name: 'a banded chest', trapped: true }));
    const victim = host.party.leader;
    const before = victim.hp;
    expect(features.perform('feature_chest')).toBe(true);
    expect(f.trapped).toBe(false);
    expect(victim.hp).toBeLessThan(before);
    expect(host.said('The lid was wired')).toBe(true);
  });

  /**
   * The wire is cleared by a successful "search for traps" over in Game, which
   * is what this handler's own comment has always promised. Standing in for
   * that here by clearing the flag pins the half that lives in this file: a
   * chest known to be safe opens without costing anyone.
   */
  /**
   * The vault and the treasure room hand items straight to the leader instead
   * of going through distributeLoot, so the two richest finds in the game
   * counted towards no collect task at all until they reported it themselves.
   */
  it('counts a find that never passed through the loot table', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // pass the search, roll the extra
    host.place(mkFeature({ kind: 'treasure_room', name: 'a treasure room' }));
    expect(features.perform('feature_treasure')).toBe(true);
    expect(host.treasuresCounted).toBe(1);
  });

  it('costs nobody anything once the wire has been found', () => {
    const f = host.place(mkFeature({ kind: 'chest', name: 'a banded chest', trapped: true }));
    f.trapped = false;
    const hpBefore = host.party.alive.map(m => m.hp);
    expect(features.perform('feature_chest')).toBe(true);
    expect(host.party.alive.map(m => m.hp)).toEqual(hpBefore);
    expect(host.said('The lid was wired')).toBe(false);
  });

  /**
   * The needle used to find `bestDisarmer()` — the one character who, had they
   * been the hand on the lid, would have been least likely to set it off.
   */
  it('wounds the hand that forced the lid, not the party\'s best disarmer', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // force the lid open
    const forcer = host.party.alive.reduce((b, m) => (m.strMod > b.strMod ? m : b), host.party.leader);
    const disarmer = host.bestDisarmer();
    const forcerHp = forcer.hp;
    const disarmerHp = disarmer.hp;
    host.place(mkFeature({ kind: 'chest', name: 'a banded chest', locked: true, trapped: true }));
    features.perform('feature_chest');
    expect(forcer.hp).toBeLessThan(forcerHp);
    if (forcer !== disarmer) expect(disarmer.hp).toBe(disarmerHp);
  });

  it('stops at the trap when it drops the victim, leaving the chest shut', () => {
    const victim = host.party.leader;
    victim.hp = 1;
    const f = host.place(mkFeature({ kind: 'chest', name: 'a banded chest', trapped: true }));
    expect(features.perform('feature_chest')).toBe(true);
    expect(victim.isConscious).toBe(false);
    expect(f.used).toBe(false);
    expect(host.looted).toEqual([]);
    expect(host.said('goes down')).toBe(true);
  });
});

describe('the sarcophagus', () => {
  it('turns out the occupant when the lid shatters on a natural 20', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    host.place(mkFeature({ kind: 'sarcophagus', name: 'a stone sarcophagus' }));
    expect(features.perform('feature_sarcophagus')).toBe(true);
    expect(host.spawned.length).toBe(1);
    expect(host.spawned[0].length).toBe(1);
  });

  it('gasses the opener on a low roll instead of spawning anything', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const opener = host.bestScout();
    const before = opener.hp;
    host.place(mkFeature({ kind: 'sarcophagus', name: 'a stone sarcophagus' }));
    features.perform('feature_sarcophagus');
    expect(host.spawned).toEqual([]);
    expect(opener.hp).toBeLessThan(before);
  });
});

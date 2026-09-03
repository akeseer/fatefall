import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarketController, type MarketHost } from '../src/game/MarketController';
import { createCharacter } from '../src/game/CharacterFactory';
import { Party } from '../src/entities/Party';
import type { InventoryItem } from '../src/entities/Character';
import type { HUD } from '../src/ui/HUD';
import type { CalendarDay } from '../src/world/CalendarSystem';
import { initTownLife, townPriceModifier } from '../src/world/TownLife';
import type { TownLifeState } from '../src/world/TownLife';
import type { Overworld, OverworldTown } from '../src/world/Overworld';
import { TileMap } from '../src/world/TileMap';
import { TOWN_ARCHETYPES, type ReputationShopItem } from '../src/world/TownTypes';
import { MARKET_POTIONS, MARKET_SCROLLS } from '../src/loot/LootTables';

/** A real archetype id, so the price modifier is the one the game would use. */
const ARCHETYPE = 'port_town';
const BASE_MODIFIER = TOWN_ARCHETYPES[ARCHETYPE].priceModifier;

const EMBERWATCH: OverworldTown = {
  id: 'town_1', name: 'Emberwatch', tile: { x: 10, y: 10 }, radius: 3, population: 400,
  description: '', archetypeId: ARCHETYPE, buildingIds: [],
};
const DUSKHOLLOW: OverworldTown = {
  id: 'town_2', name: 'Duskhollow', tile: { x: 40, y: 12 }, radius: 3, population: 250,
  description: '', archetypeId: ARCHETYPE, buildingIds: [],
};
const world = (): Overworld => ({
  map: new TileMap(), towns: [EMBERWATCH, DUSKHOLLOW], entrances: [],
  spawnTownId: 'town_1', pois: [], regions: [],
});

const PLAIN_DAY: CalendarDay = {
  weekdayIndex: 0, weekday: 'Sunday' as CalendarDay['weekday'],
  isMarketday: false, isSacredDay: false, isGloomDay: false,
  moonPhase: 'new_moon', moonLight: 0, dayInMoon: 1,
};

class FakeHost implements MarketHost {
  readonly log: string[] = [];
  inTown = true;
  currentTown: OverworldTown | null = EMBERWATCH;
  townLife: TownLifeState | null = initTownLife(world());
  calendar: CalendarDay = PLAIN_DAY;
  readonly party = new Party();
  readonly hud = {
    addCombatMessage: (line: string) => { this.log.push(line); },
    setParty: () => {},
    townPanel: { refresh: () => {} },
  } as unknown as HUD;

  constructor(gold = 1000) {
    this.party.members = [
      createCharacter('fighter', 'human', 'Kael'),
      createCharacter('rogue', 'halfling', 'Wren'),
    ];
    for (const m of this.party.members) {
      m.gold = 0;
      m.inventory = [];
    }
    this.party.leader.gold = gold;
  }

  addGold(n: number): void { this.party.leader.gold += n; }

  /** Mirrors Game.spendGold exactly: affordability first, then richest pocket first. */
  spendGold(n: number): boolean {
    if (this.purse < n) return false;
    let remaining = n;
    for (const m of [...this.party.members].sort((a, b) => b.gold - a.gold)) {
      if (remaining <= 0) break;
      const take = Math.min(m.gold, remaining);
      m.gold -= take;
      remaining -= take;
    }
    return true;
  }

  get purse(): number { return this.party.members.reduce((s, m) => s + m.gold, 0); }

  said(fragment: string): boolean { return this.log.some(l => l.includes(fragment)); }
}

/** What the shop should charge for `value` gp of goods in this town, today. */
function expectedCost(host: FakeHost, value: number): number {
  const mod = townPriceModifier(host.townLife!, host.currentTown!.id, BASE_MODIFIER);
  const marketMod = host.calendar.isMarketday ? 0.9 : 1;
  return Math.max(1, Math.floor(value * mod * marketMod));
}

const mkItem = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'trinket', name: 'Brass Trinket', type: 'treasure', description: 'Shiny.', value: 100, ...over,
});

let host: FakeHost;
let market: MarketController;

beforeEach(() => {
  host = new FakeHost();
  market = new MarketController(host);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is on the shelves', () => {
  it('always stocks the standing potion and scroll list', () => {
    const names = market.marketStock().map(i => i.name);
    for (const p of MARKET_POTIONS) expect(names).toContain(p.name);
    for (const s of MARKET_SCROLLS) expect(names).toContain(s.name);
  });

  it('offers only the standing list on the road, where there is no smithy', () => {
    host.currentTown = null;
    expect(market.marketStock().length).toBe(MARKET_POTIONS.length + MARKET_SCROLLS.length);
  });

  it('rolls the enchantment rack once and keeps it for the whole visit', () => {
    const first = market.marketStock();
    expect(market.marketStock()).toEqual(first);
    expect(first.length).toBeGreaterThan(MARKET_POTIONS.length + MARKET_SCROLLS.length);
  });

  it('rolls a fresh rack when the party reaches the next town', () => {
    const emberwatch = market.marketStock().slice(MARKET_POTIONS.length + MARKET_SCROLLS.length);
    host.currentTown = DUSKHOLLOW;
    const duskhollow = market.marketStock().slice(MARKET_POTIONS.length + MARKET_SCROLLS.length);
    expect(duskhollow.map(i => i.id)).not.toEqual(emberwatch.map(i => i.id));
  });

  it('never puts the same piece on the rack twice', () => {
    for (let visit = 0; visit < 20; visit++) {
      host.currentTown = visit % 2 ? EMBERWATCH : DUSKHOLLOW;
      const rack = market.marketStock().slice(MARKET_POTIONS.length + MARKET_SCROLLS.length);
      expect(new Set(rack.map(i => i.name)).size).toBe(rack.length);
    }
  });

  /**
   * Buying reads the shop and selling reads the party's packs. Keeping the two
   * lists visibly distinct is what stops the two sides being crossed.
   */
  it('keeps the shop shelf and the party packs as separate lists', () => {
    const held = mkItem({ id: 'heirloom', name: 'Heirloom Dagger' });
    host.party.members[1].inventory.push(held);
    expect(market.partyInventory()).toEqual([held]);
    expect(market.marketStock().map(i => i.name)).not.toContain('Heirloom Dagger');
    expect(market.partyInventory().map(i => i.name)).not.toContain(MARKET_POTIONS[0].name);
  });

  it('gathers the packs of every member, not only the leader\'s', () => {
    host.party.members[0].inventory.push(mkItem({ id: 'a' }));
    host.party.members[1].inventory.push(mkItem({ id: 'b' }));
    expect(market.partyInventory().map(i => i.id).sort()).toEqual(['a', 'b']);
  });
});

describe('buying', () => {
  it('does not trade out on the road', () => {
    host.inTown = false;
    market.buyItem(mkItem());
    expect(host.purse).toBe(1000);
    expect(market.partyInventory()).toEqual([]);
  });

  it('charges the town price and puts the goods in the leader\'s pack', () => {
    const item = mkItem({ value: 100 });
    const cost = expectedCost(host, 100);
    market.buyItem(item);
    expect(host.purse).toBe(1000 - cost);
    expect(host.party.leader.inventory.map(i => i.name)).toContain('Brass Trinket');
    expect(host.said(`for ${cost} gp`)).toBe(true);
  });

  it('hands over a copy, so selling one does not empty the shelf', () => {
    const shelfItem = mkItem();
    market.buyItem(shelfItem);
    const bought = host.party.leader.inventory[0];
    expect(bought).not.toBe(shelfItem);
    expect(bought).toEqual(shelfItem);
  });

  it('knocks a tenth off every price on market day', () => {
    const full = expectedCost(host, 100);
    host.calendar = { ...PLAIN_DAY, isMarketday: true };
    const discounted = expectedCost(host, 100);
    expect(discounted).toBeLessThan(full);
    market.buyItem(mkItem({ value: 100 }));
    expect(host.purse).toBe(1000 - discounted);
  });

  it('never gives anything away, however cheap the goods and the town', () => {
    market.buyItem(mkItem({ value: 0 }));
    expect(host.purse).toBe(999);
  });

  it('counts what was spent towards the town\'s prosperity', () => {
    const cost = expectedCost(host, 100);
    market.buyItem(mkItem({ value: 100 }));
    expect(host.townLife!.byTown.town_1.prosperitySpent).toBe(cost);
  });

  it('takes a rack piece off the shelf once it is sold', () => {
    const rackStart = MARKET_POTIONS.length + MARKET_SCROLLS.length;
    const piece = market.marketStock()[rackStart];
    // The rack is rolled fresh per town, and a piece of plate can outprice a
    // starting purse, so fund the sale rather than let the assertion ride on
    // which weapon came up.
    host.party.leader.gold = (piece.value ?? 0) * 10 + 1000;
    market.buyItem(piece);
    expect(market.marketStock().map(i => i.id)).not.toContain(piece.id);
  });

  it('leaves the standing potion list in stock after a sale', () => {
    market.buyItem(MARKET_POTIONS[0]);
    expect(market.marketStock().map(i => i.id)).toContain(MARKET_POTIONS[0].id);
  });

  it('refuses the sale and hands over nothing when the purse is short', () => {
    host.party.leader.gold = 5;
    market.buyItem(mkItem({ value: 100 }));
    expect(market.partyInventory()).toEqual([]);
    expect(host.said('Not enough gold')).toBe(true);
  });

  /**
   * `spendGold` once took what it could from every pocket before discovering
   * the party was short, returning false with the purse empty and nothing
   * bought. buyItem is its only caller, so the player saw a refused purchase
   * and their gold gone. It checks the total before a coin moves now.
   */
  it('leaves the gold where it is when a purchase is refused', () => {
    host.party.leader.gold = 5;
    market.buyItem(mkItem({ value: 100 }));
    expect(host.purse).toBe(5);
    expect(market.partyInventory()).toEqual([]);
  });
});

describe('selling', () => {
  it('does not trade out on the road', () => {
    const item = mkItem();
    host.party.members[1].inventory.push(item);
    host.inTown = false;
    market.sellItem(item);
    expect(host.party.members[1].inventory).toContain(item);
  });

  /**
   * Selling searches the party's packs, not the shop's shelves. Handing it a
   * shelf item must be a no-op rather than minting gold out of stock.
   */
  it('refuses an item that is on the shelf but in nobody\'s pack', () => {
    const before = host.purse;
    market.sellItem(market.marketStock()[0]);
    expect(host.purse).toBe(before);
    expect(host.log).toEqual([]);
  });

  it('takes the item from the member holding it and pays that member', () => {
    const wren = host.party.members[1];
    const item = mkItem({ value: 100 });
    wren.inventory.push(item);
    const leaderGold = host.party.leader.gold;

    market.sellItem(item);
    expect(wren.inventory).not.toContain(item);
    expect(wren.gold).toBeGreaterThan(0);
    expect(host.party.leader.gold).toBe(leaderGold);
    expect(host.said('sells Brass Trinket')).toBe(true);
  });

  it('pays half the item\'s worth, adjusted for the town', () => {
    const item = mkItem({ value: 100 });
    host.party.members[1].inventory.push(item);
    const mod = townPriceModifier(host.townLife!, 'town_1', BASE_MODIFIER);
    market.sellItem(item);
    expect(host.party.members[1].gold).toBe(Math.max(1, Math.floor(Math.floor(100 / 2) * mod)));
  });

  it('pays a quarter more on market day, when buyers are thick on the ground', () => {
    const plain = mkItem({ id: 'a', value: 100 });
    const festive = mkItem({ id: 'b', value: 100 });
    host.party.members[1].inventory.push(plain, festive);
    market.sellItem(plain);
    const plainPrice = host.party.members[1].gold;
    host.calendar = { ...PLAIN_DAY, isMarketday: true };
    market.sellItem(festive);
    expect(host.party.members[1].gold - plainPrice).toBeGreaterThan(plainPrice);
  });

  it('pays at least a coin for worthless junk', () => {
    const item = mkItem({ value: 0 });
    host.party.members[1].inventory.push(item);
    market.sellItem(item);
    expect(host.party.members[1].gold).toBe(1);
  });

  it('sells one of a pair and leaves the other in the pack', () => {
    const wren = host.party.members[1];
    const first = mkItem({ id: 'a' });
    const second = mkItem({ id: 'a' });
    wren.inventory.push(first, second);
    market.sellItem(first);
    expect(wren.inventory).toEqual([second]);
  });
});

describe('the reputation shop', () => {
  const favour: ReputationShopItem = {
    name: 'Cloak of the Watch', type: 'wondrous', value: 200,
    description: 'A town favour.', repRequired: 40, power: 3,
  };

  it('turns the party away below the standing it asks for', () => {
    host.townLife!.byTown.town_1.townReputation = 10;
    market.buyRepItem(favour);
    expect(host.said('Reputation too low')).toBe(true);
    expect(market.partyInventory()).toEqual([]);
    expect(host.purse).toBe(1000);
  });

  it('sells to a party the town trusts, at the town price', () => {
    host.townLife!.byTown.town_1.townReputation = 40;
    const mod = townPriceModifier(host.townLife!, 'town_1', BASE_MODIFIER);
    const cost = Math.max(1, Math.floor(200 * mod));
    market.buyRepItem(favour);
    expect(host.purse).toBe(1000 - cost);
    expect(host.party.leader.inventory.map(i => i.name)).toContain('Cloak of the Watch');
  });

  it('files a ring or a wonder as treasure, since neither is a pack slot the game knows', () => {
    host.townLife!.byTown.town_1.townReputation = 100;
    market.buyRepItem(favour);
    expect(host.party.leader.inventory[0].type).toBe('treasure');
    expect(host.party.leader.inventory[0].power).toBe(3);
  });

  it('does not trade out on the road', () => {
    host.inTown = false;
    host.townLife!.byTown.town_1.townReputation = 100;
    market.buyRepItem(favour);
    expect(market.partyInventory()).toEqual([]);
  });
});

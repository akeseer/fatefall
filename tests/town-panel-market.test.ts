import { describe, it, expect } from 'vitest';
import { buyPriceOf, sellPriceOf, isRackPiece, quickMarketStock, sellsRack } from '../src/ui/TownPanel';
import { getReputationPerks, reputationDiscountPercent, TOWN_ARCHETYPES, REPUTATION_SHOP } from '../src/world/TownTypes';
import { initTownLife, townPriceModifier } from '../src/world/TownLife';
import type { Overworld, OverworldTown } from '../src/world/Overworld';
import { TileMap } from '../src/world/TileMap';
import { MARKET_POTIONS, MARKET_SCROLLS } from '../src/loot/LootTables';
import type { InventoryItem } from '../src/entities/Character';

/**
 * The town panel prints prices before the market charges them. These pin the
 * panel's arithmetic to MarketController's, and the reputation perks to the
 * discount curve the market actually applies.
 */

const rack = (id: string, value = 300): InventoryItem => ({ id, name: `Longsword ${id}`, type: 'weapon', description: '', value });

describe('the panel prices', () => {
  it('ask what the market asks: value × town modifier, 10% off on market day, never below 1 gp', () => {
    expect(buyPriceOf(100, 1, false)).toBe(100);
    expect(buyPriceOf(100, 0.85, false)).toBe(85);
    expect(buyPriceOf(100, 0.85, true)).toBe(Math.floor(100 * 0.85 * 0.9));
    expect(buyPriceOf(0, 0.5, true)).toBe(1);
  });

  it('pay what the market pays: half value, then the town modifier, then 25% more on market day', () => {
    expect(sellPriceOf(101, 1, false)).toBe(50);
    expect(sellPriceOf(100, 0.8, false)).toBe(40);
    expect(sellPriceOf(100, 0.8, true)).toBe(50);
    expect(sellPriceOf(1, 1, false)).toBe(1);
  });
});

describe('the quick market', () => {
  const standing = [...MARKET_POTIONS, ...MARKET_SCROLLS];

  it('knows the standing wares from the town rack by id', () => {
    for (const s of standing) expect(isRackPiece(s)).toBe(false);
    expect(isRackPiece(rack('tg_1'))).toBe(true);
  });

  it('puts the rack first and stops at eight', () => {
    const stock = [...standing, rack('a'), rack('b'), rack('c')];
    const shown = quickMarketStock(stock);
    expect(shown).toHaveLength(8);
    expect(shown.slice(0, 3).map(i => i.id)).toEqual(['a', 'b', 'c']);
    expect(shown.slice(3).map(i => i.id)).toEqual(standing.slice(0, 5).map(i => i.id));
  });

  it('shows a short stock whole', () => {
    expect(quickMarketStock([rack('a')])).toHaveLength(1);
    expect(quickMarketStock([])).toEqual([]);
  });
});

describe('where the rack stands', () => {
  it('is every smithy, armoury, relic hall and market square, and no tavern', () => {
    const all = Object.values(TOWN_ARCHETYPES).flatMap(a => a.buildings);
    const withRack = all.filter(sellsRack);
    expect(withRack.length).toBeGreaterThan(0);
    for (const b of withRack) expect(b.hasShop).toBe(true);
    for (const b of all.filter(b => b.id === 'tavern')) expect(sellsRack(b)).toBe(false);
    for (const b of all.filter(b => b.shopPool === 'weapons')) expect(sellsRack(b)).toBe(true);
  });
});

describe('the reputation perks', () => {
  const town: OverworldTown = {
    id: 'town_1', name: 'Emberwatch', tile: { x: 10, y: 10 }, radius: 3, population: 400,
    description: '', archetypeId: 'port_town', buildingIds: [],
  };
  const world = (): Overworld => ({
    map: new TileMap(), towns: [town], entrances: [], spawnTownId: 'town_1', pois: [], regions: [],
  });

  it('quote the discount the till really gives', () => {
    for (const rep of [0, 10, 25, 50, 75, 100]) {
      const tl = initTownLife(world());
      tl.byTown.town_1.townReputation = rep;
      const mod = townPriceModifier(tl, 'town_1', 1, 0);
      expect(reputationDiscountPercent(rep)).toBe(Math.round((1 - mod) * 100));
    }
  });

  it('promise nothing the game does not grant', () => {
    expect(getReputationPerks(0)).toEqual([]);
    const perks = getReputationPerks(100);
    expect(perks.some(p => p.startsWith('25% off'))).toBe(true);
    expect(perks.some(p => p.includes(`${REPUTATION_SHOP.length} of ${REPUTATION_SHOP.length}`))).toBe(true);
    for (const p of perks) expect(p).not.toMatch(/healing|blessing|identify|quest/i);
  });
});

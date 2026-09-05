import { describe, it, expect } from 'vitest';
import { SHOP_STOCK, shopItemToInventory } from '../src/world/TownTypes';

/**
 * The building shops sell ShopItems; the party carries InventoryItems. The
 * Buy button used to hand the panel a name and have it looked up by id in the
 * market's stock, which never matched, so nothing could be bought. This pins
 * the conversion that replaced it.
 */
describe('shop wares', () => {
  it('convert every ware to something the party can carry', () => {
    for (const [pool, wares] of Object.entries(SHOP_STOCK)) {
      for (const w of wares) {
        const item = shopItemToInventory(pool, w);
        expect(item.name).toBe(w.name);
        expect(item.value).toBe(w.value);
        expect(item.description).toBe(w.description);
        expect(item.identified).toBe(true);
        expect(['weapon', 'armor', 'potion', 'scroll', 'treasure']).toContain(item.type);
        expect(item.id).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });

  it('give the same ware the same id, and different wares different ids', () => {
    const ids = new Set<string>();
    for (const [pool, wares] of Object.entries(SHOP_STOCK)) {
      for (const w of wares) {
        const a = shopItemToInventory(pool, w);
        const b = shopItemToInventory(pool, w);
        expect(a.id).toBe(b.id);
        expect(a).not.toBe(b);
        ids.add(`${pool}/${a.id}`);
      }
    }
    const total = Object.values(SHOP_STOCK).reduce((n, w) => n + w.length, 0);
    expect(ids.size).toBe(total);
  });

  it('hand known scrolls and potions over under the id the game already reads', () => {
    const fireball = SHOP_STOCK.magic.find(w => w.name === 'Scroll of Fireball')!;
    expect(shopItemToInventory('magic', fireball).id).toBe('scroll_fireball');
    const rez = SHOP_STOCK.rare.find(w => w.name === 'Scroll of Resurrection')!;
    expect(shopItemToInventory('rare', rez).id).toBe('scroll_revivify');
    const speed = SHOP_STOCK.rare.find(w => w.name === 'Potion of Speed')!;
    expect(shopItemToInventory('rare', speed).id).toBe('potion_speed');
  });

  it('turn gems and tools into treasure worth their price', () => {
    const ruby = SHOP_STOCK.gems.find(w => w.name === 'Ruby')!;
    const item = shopItemToInventory('gems', ruby);
    expect(item.type).toBe('treasure');
    expect(item.value).toBe(100);
    const torch = SHOP_STOCK.general.find(w => w.name === 'Torch')!;
    expect(shopItemToInventory('general', torch).type).toBe('treasure');
  });

  it('keep the healing amount readable on the ware itself', () => {
    const potion = SHOP_STOCK.general.find(w => w.name === 'Healing Potion')!;
    const item = shopItemToInventory('general', potion);
    expect(item.power).toBe(30);
    expect(/restores (\d+) hp/i.exec(item.description)?.[1]).toBe('30');
  });
});

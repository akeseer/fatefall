/**
 * The town market — what is on the shelves, and what changes hands.
 *
 * Stock is the archetype's standing list plus a tiered-gear rack that is
 * rolled once per town and then cached, so the same visit keeps showing the
 * same wares. Prices move with the town's prosperity, its festivals and the
 * party's standing, all of which the town-life state carries.
 *
 * The party's purse stays on Game: everything in the game spends gold, only
 * this spends it on goods.
 */

import { seasonFor, seasonPriceMod } from '../world/Seasons';
import { townTier } from '../world/TownLife';
import { slotForItem, type InventoryItem } from '../entities/Character';
import type { Party } from '../entities/Party';
import type { HUD } from '../ui/HUD';
import type { OverworldTown } from '../world/Overworld';
import type { TownLifeState } from '../world/TownLife';
import type { CalendarDay } from '../world/CalendarSystem';
import type { ReputationShopItem } from '../world/TownTypes';
import { TOWN_ARCHETYPES } from '../world/TownTypes';
import { MARKET_POTIONS, MARKET_SCROLLS } from '../loot/LootTables';
import { rollTieredGear } from '../loot/TieredGear';
import { townPriceModifier } from '../world/TownLife';

/** The slice of the game the market needs. */
export interface MarketHost {
  readonly party: Party;
  readonly hud: HUD;
  readonly townLife: TownLifeState | null;
  readonly currentTown: OverworldTown | null;
  readonly calendar: CalendarDay;
  /** True while the party is standing in a town, where trade is possible. */
  readonly inTown: boolean;
  addGold(n: number): void;
  spendGold(n: number): boolean;
  /** A big purchase can be argued down: the game rolls the Charisma and returns the price paid. */
  haggle?(cost: number, itemName: string): number;
  /** The day of the run, for the season. */
  readonly dayIndex?: number;
}

export class MarketController {
  constructor(private game: MarketHost) {}

  partyInventory(): InventoryItem[] {
    return this.game.party.members.flatMap(m => m.inventory);
  }

  addItemToParty(item: InventoryItem): void {
    this.game.party.leader.inventory.push({ ...item });
  }

  /** The smithy's enchantment rack — tiered gear rolled once per town visit. */
  private shopTieredStock: InventoryItem[] = [];
  private shopTieredTownId: string | null = null;

  marketStock(): InventoryItem[] {
    const base = [...MARKET_POTIONS, ...MARKET_SCROLLS];
    if (!this.game.currentTown) return base;
    // Tiered gear: rolled fresh when the party arrives in a new town.
    // Wealthier towns (higher priceModifier) stock higher tiers.
    const stockKey = `${this.game.currentTown.id}:${this.game.calendar.weekdayIndex}`;
    if (this.shopTieredTownId !== stockKey) {
      const archetype = TOWN_ARCHETYPES[this.game.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
      const wealth = archetype?.priceModifier ?? 1;
      const maxBonus = Math.min(3, (wealth >= 1.25 ? 3 : wealth >= 1.0 ? 2 : 1) + (this.game.calendar.isMarketday ? 1 : 0));
      // Market day brings the traders in: more pieces, and a better one among them.
      const count = 2 + Math.floor(Math.random() * 3) + (this.game.calendar.isMarketday ? 2 : 0);
      const stock: InventoryItem[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < count * 3 && stock.length < count; i++) {
        const piece = rollTieredGear({ maxBonus, minBonus: Math.max(1, maxBonus - 1) });
        if (seen.has(piece.name)) continue;
        seen.add(piece.name);
        stock.push(piece);
      }
      this.shopTieredStock = stock;
      this.shopTieredTownId = stockKey;
    }
    return [...base, ...this.shopTieredStock];
  }

  buyItem(item: InventoryItem): void {
    if (!this.game.inTown) return;
    const baseCost = item.value ?? 0;
    // Apply dynamic pricing from archetype + prosperity + festival + caravan.
    let cost = baseCost;
    if (this.game.currentTown && this.game.townLife) {
      const archetype = TOWN_ARCHETYPES[this.game.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
      const dynamicMod = townPriceModifier(this.game.townLife, this.game.currentTown.id, archetype?.priceModifier ?? 1);
      // Market day: goods are abundant and the squares are thronged — 10% off.
      const marketMod = this.game.calendar.isMarketday ? 0.9 : 1;
      // Winter is dear and the harvest is cheap; a town that has grown gives a little back.
      const seasonMod = seasonPriceMod(seasonFor(this.game.dayIndex ?? 0));
      const tierMod = 1 - 0.03 * (townTier(this.game.townLife.byTown[this.game.currentTown.id]) - 1);
      cost = Math.max(1, Math.floor(baseCost * dynamicMod * marketMod * seasonMod * tierMod));
    }
    if (cost >= 80 && this.game.haggle) cost = this.game.haggle(cost, item.name);
    if (!this.game.spendGold(cost)) {
      this.game.hud.addCombatMessage(`Not enough gold for ${item.name} (${cost} gp).`, '#c66');
      this.game.hud.townPanel.refresh();
      return;
    }
    // Track prosperity for future discounts.
    if (this.game.currentTown && this.game.townLife) {
      this.game.townLife.byTown[this.game.currentTown.id].prosperitySpent += cost;
    }
    this.addItemToParty(item);
    // Tiered gear is a physical rack piece — once sold, it's gone.
    this.shopTieredStock = this.shopTieredStock.filter(s => s.id !== item.id);
    this.game.hud.addCombatMessage(`🛒 ${this.game.party.leader.name} buys ${item.name} for ${cost} gp.`, '#ffd700');
    this.game.hud.townPanel.refresh();
  }

  sellItem(item: InventoryItem): void {
    if (!this.game.inTown) return;
    const member = this.game.party.members.find(m => m.inventory.includes(item));
    if (!member) return;
    let price = Math.floor((item.value ?? 0) / 2);
    // Apply dynamic pricing (sell price also affected).
    if (this.game.currentTown && this.game.townLife) {
      const archetype = TOWN_ARCHETYPES[this.game.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
      const dynamicMod = townPriceModifier(this.game.townLife, this.game.currentTown.id, archetype?.priceModifier ?? 1);
      // Market day: buyers are plenty and ready — wares fetch 25% more.
      const marketMod = this.game.calendar.isMarketday ? 1.25 : 1;
      price = Math.max(1, Math.floor(price * dynamicMod * marketMod));
    }
    member.gold += price;
    member.inventory = member.inventory.filter(i => i !== item);
    this.game.hud.addCombatMessage(`⚖ ${member.name} sells ${item.name} for ${price} gp.`, '#ca8');
    this.game.hud.townPanel.refresh();
  }

  buyRepItem(repItem: ReputationShopItem): void {
    if (!this.game.inTown || !this.game.currentTown || !this.game.townLife) return;
    const rep = this.game.townLife.byTown[this.game.currentTown.id]?.townReputation ?? 0;
    if (rep < repItem.repRequired) {
      this.game.hud.addCombatMessage(`Reputation too low. Need ${repItem.repRequired}, have ${rep}.`, '#c66');
      this.game.hud.townPanel.refresh();
      return;
    }
    let cost = repItem.value;
    if (this.game.currentTown && this.game.townLife) {
      const archetype = TOWN_ARCHETYPES[this.game.currentTown.archetypeId as keyof typeof TOWN_ARCHETYPES];
      const dynamicMod = townPriceModifier(this.game.townLife, this.game.currentTown.id, archetype?.priceModifier ?? 1);
      cost = Math.max(1, Math.floor(cost * dynamicMod));
    }
    if (!this.game.spendGold(cost)) {
      this.game.hud.addCombatMessage(`Not enough gold for ${repItem.name} (${cost} gp).`, '#c66');
      this.game.hud.townPanel.refresh();
      return;
    }
    const item = repItemToInventory(repItem);
    const leader = this.game.party.leader;
    leader.inventory.push(item);
    this.game.hud.addCombatMessage(`${leader.name} acquires ${repItem.name} from the reputation shop for ${cost} gp!`, '#ffd700');
    // A ring or a cloak does nothing in the pack. Fasten it on at once if the
    // slot is free; otherwise the DM chooses what to swap with an equip order.
    if (slotForItem(item) === 'trinket' && !leader.equipment.trinket) {
      const worn = leader.equip(item.id);
      if (worn.ok) this.game.hud.addCombatMessage(worn.line, '#ffd700');
    }
    this.game.hud.townPanel.refresh();
  }
}

/**
 * The item a reputation-shop purchase hands over. Rings and wonders are filed
 * under 'armor' because that is the type the equipment slots read: a name
 * with "ring" or "cloak" in it then lands in the trinket slot, where a "+1"
 * raises AC and saves and a cloak of displacement makes attackers miss. For
 * a while they were 'treasure', and 400 gp bought a paperweight.
 */
export function repItemToInventory(repItem: ReputationShopItem): InventoryItem {
  const type: InventoryItem['type'] = repItem.type === 'ring' || repItem.type === 'wondrous' ? 'armor' : repItem.type;
  return {
    id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: repItem.name,
    type,
    value: repItem.value,
    description: repItem.description,
    power: repItem.power,
    identified: true,
  };
}

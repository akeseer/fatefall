import { InventoryItem, magicBonusOf } from '../entities/Character';

/**
 * Tiered mundane gear — the D&D progression ladder between plain steel and
 * named legendaries. A "+1 Longsword" is still a longsword, priced like one
 * with a masterwork enchantment on top.
 */

interface BaseGear {
  name: string;
  power: number;   // damage die (weapons) or AC (armor)
  value: number;   // plain value in gp
}

/** Mundane weapons that can be enchanted. Power = damage die. */
const WEAPONS: BaseGear[] = [
  { name: 'Dagger', power: 4, value: 2 },
  { name: 'Shortsword', power: 6, value: 10 },
  { name: 'Mace', power: 6, value: 5 },
  { name: 'Quarterstaff', power: 6, value: 2 },
  { name: 'Shortbow', power: 6, value: 25 },
  { name: 'Longsword', power: 8, value: 15 },
  { name: 'Battleaxe', power: 8, value: 10 },
  { name: 'Warhammer', power: 8, value: 15 },
  { name: 'Rapier', power: 8, value: 25 },
  { name: 'Scimitar', power: 6, value: 25 },
  { name: 'Greataxe', power: 12, value: 30 },
  { name: 'Greatsword', power: 12, value: 50 },
];

/** Mundane armor pieces. Power = target AC. */
const ARMORS: BaseGear[] = [
  { name: 'Leather Armor', power: 11, value: 10 },
  { name: 'Studded Leather', power: 12, value: 45 },
  { name: 'Hide Armor', power: 12, value: 10 },
  { name: 'Scale Mail', power: 14, value: 50 },
  { name: 'Breastplate', power: 14, value: 400 },
  { name: 'Half Plate', power: 15, value: 750 },
  { name: 'Chain Mail', power: 16, value: 75 },
];

/** Mundane shields (all +2 AC before enchantment). */
const SHIELDS: BaseGear[] = [
  { name: 'Shield', power: 2, value: 10 },
];

/** D&D 5e price curve: a +N weapon costs the plain weapon + N tiers of enchantment. */
const WEAPON_BONUS_PRICE = [0, 350, 1600, 5400];
const ARMOR_BONUS_PRICE = [0, 350, 1600, 5400];
const SHIELD_BONUS_PRICE = [0, 150, 900, 2700];

/** Recompute value from the base piece + enchantment tier (used on re-roll). */
function pricedValue(base: BaseGear, bonus: number, kind: 'weapon' | 'armor' | 'shield'): number {
  const table = kind === 'weapon' ? WEAPON_BONUS_PRICE : kind === 'shield' ? SHIELD_BONUS_PRICE : ARMOR_BONUS_PRICE;
  return base.value + table[bonus];
}

export interface TieredGearOptions {
  /** Max enchantment tier to roll (e.g. shop tier, dungeon depth). 1-3. */
  maxBonus?: number;
  /** Minimum enchantment tier. Defaults to maxBonus (fixed tier). */
  minBonus?: number;
  /** Restrict to weapons only / armor+shields only. */
  kind?: 'weapon' | 'armor' | 'any';
}

/**
 * Roll one piece of tiered gear: "Longsword +1", "Chain Mail +2", etc.
 * Enchantment tier is uniform between minBonus..maxBonus.
 */
export function rollTieredGear(opts: TieredGearOptions = {}): InventoryItem {
  const maxBonus = Math.min(3, Math.max(1, opts.maxBonus ?? 1));
  const minBonus = Math.min(maxBonus, Math.max(1, opts.minBonus ?? maxBonus));
  const kind = opts.kind ?? 'any';

  // Pick the base piece from the relevant pool.
  let base: BaseGear;
  if (kind === 'weapon') base = WEAPONS[Math.floor(Math.random() * WEAPONS.length)];
  else if (kind === 'armor') {
    const pool = Math.random() < 0.2 ? SHIELDS : ARMORS;
    base = pool[Math.floor(Math.random() * pool.length)];
  } else {
    const pool = Math.random() < 0.55 ? WEAPONS : Math.random() < 0.8 ? ARMORS : SHIELDS;
    base = pool[Math.floor(Math.random() * pool.length)];
  }
  const isShield = SHIELDS.includes(base);
  const kindOf = isShield ? 'shield' : WEAPONS.includes(base) ? 'weapon' : 'armor';

  // Enchantment tier.
  const bonus = minBonus + Math.floor(Math.random() * (maxBonus - minBonus + 1));

  const name = `${base.name} +${bonus}`;
  const value = pricedValue(base, bonus, kindOf);
  const description = kindOf === 'weapon'
    ? `A ${base.name} bearing a +${bonus} enchantment. Its power: ${base.power} die.`
    : isShield
      ? `A ${base.name} bearing a +${bonus} enchantment (adds ${2 + bonus} AC).`
      : `A ${base.name} bearing a +${bonus} enchantment (AC ${base.power + bonus}).`;

  return {
    id: `tiered_${base.name.toLowerCase().replace(/\W+/g, '_')}_p${bonus}_${Math.floor(Math.random() * 1e6)}`,
    name,
    type: kindOf === 'weapon' ? 'weapon' : 'armor',
    description,
    value,
    power: kindOf === 'weapon' ? base.power : isShield ? 2 + bonus : base.power + bonus,
    identified: true,
  };
}

/** Flat list of every tiered variant of a base piece (for shop stock). */
export function tieredVariantsOf(baseName: string, maxBonus: number = 3): InventoryItem[] {
  const all = [...WEAPONS, ...ARMORS, ...SHIELDS];
  const base = all.find(b => b.name.toLowerCase() === baseName.toLowerCase());
  if (!base) return [];
  const isShield = SHIELDS.includes(base);
  const kindOf = isShield ? 'shield' : WEAPONS.includes(base) ? 'weapon' : 'armor';
  const out: InventoryItem[] = [];
  for (let bonus = 1; bonus <= maxBonus; bonus++) {
    out.push({
      id: `tiered_${base.name.toLowerCase().replace(/\W+/g, '_')}_p${bonus}`,
      name: `${base.name} +${bonus}`,
      type: kindOf === 'weapon' ? 'weapon' : 'armor',
      description: kindOf === 'weapon'
        ? `A ${base.name} bearing a +${bonus} enchantment. Its power: ${base.power} die.`
        : isShield
          ? `A ${base.name} bearing a +${bonus} enchantment (adds ${2 + bonus} AC).`
          : `A ${base.name} bearing a +${bonus} enchantment (AC ${base.power + bonus}).`,
      value: pricedValue(base, bonus, kindOf),
      power: kindOf === 'weapon' ? base.power : isShield ? 2 + bonus : base.power + bonus,
      identified: true,
    });
  }
  return out;
}

/** Parse the enchantment tier from a tiered item's name ("Longsword +2" → 2). */
export function tierBonusOf(item: InventoryItem): number {
  return magicBonusOf(item);
}

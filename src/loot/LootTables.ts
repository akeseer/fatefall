/**
 * D&D-standard loot tables — treasure generation tied to monster CR and
 * dungeon level, modeled on the 5e Dungeon Master's Guide's individual and
 * hoard treasure tables.
 *
 * Individual treasure rolls per slain creature (coins only). Hoards — rolled
 * for bosses or at a small per-victory chance that rises with dungeon level —
 * add gems, art objects, and magic items on top of a bigger coin pile.
 */

import { MAGIC_ITEMS, MagicItem } from '../ai/DnDKnowledge';
import { InventoryItem } from '../entities/Character';
import { rollDice } from '../data/gameData';

export interface CoinPurse {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export const EMPTY_PURSE: CoinPurse = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

export interface LootResult {
  coins: CoinPurse;
  /** Total value of the coin purse, in gold pieces. */
  goldValue: number;
  /** Items handed out to the party (gems, art, potions, scrolls, magic items). */
  items: InventoryItem[];
  /** Magic items for narration (also appear in `items`). */
  magicItems: MagicItem[];
  /** Narration lines describing the haul. */
  narration: string[];
  hoard: boolean;
}

export interface LootSource {
  cr: number;
  name: string;
  isBoss?: boolean;
  /** MonsterTemplate type ('fiend', 'dragon', 'undead'…) — drives themed loot. */
  type?: string;
}

// ── Consumables ──────────────────────────────────────

export const MARKET_POTIONS: InventoryItem[] = [
  { id: 'potion_healing', name: 'Potion of Healing', type: 'potion', description: 'Regain 2d4+2 hit points when drunk.', value: 50 },
  { id: 'potion_greater_healing', name: 'Potion of Greater Healing', type: 'potion', description: 'Regain 4d4+4 hit points when drunk.', value: 150 },
  { id: 'potion_superior_healing', name: 'Potion of Superior Healing', type: 'potion', description: 'Regain 8d4+8 hit points when drunk.', value: 450 },
  { id: 'potion_invisibility', name: 'Potion of Invisibility', type: 'potion', description: 'Become invisible for 1 hour, until you attack or cast.', value: 180 },
  { id: 'potion_giant_strength', name: 'Potion of Hill Giant Strength', type: 'potion', description: 'Strength becomes 21 for 1 hour.', value: 250 },
  { id: 'potion_speed', name: 'Potion of Speed', type: 'potion', description: 'Haste effect for 1 minute.', value: 400 },
  { id: 'potion_flying', name: 'Potion of Flying', type: 'potion', description: 'Flying speed of 60 feet for 1 hour.', value: 500 },
];

export const MARKET_SCROLLS: InventoryItem[] = [
  { id: 'scroll_fireball', name: 'Spell Scroll (Fireball)', type: 'scroll', description: 'Cast Fireball once; the scroll crumbles.', value: 200 },
  { id: 'scroll_cure_wounds', name: 'Spell Scroll (Cure Wounds)', type: 'scroll', description: 'Cast Cure Wounds once; the scroll crumbles.', value: 100 },
  { id: 'scroll_invisibility', name: 'Spell Scroll (Invisibility)', type: 'scroll', description: 'Cast Invisibility once; the scroll crumbles.', value: 150 },
  { id: 'scroll_lightning_bolt', name: 'Spell Scroll (Lightning Bolt)', type: 'scroll', description: 'Cast Lightning Bolt once; the scroll crumbles.', value: 200 },
  { id: 'scroll_revivify', name: 'Spell Scroll (Revivify)', type: 'scroll', description: 'Cast Revivify once; the scroll crumbles.', value: 300 },
];

// ── Gems and art objects (hoard dressing) ────────────

const GEMS: { name: string; value: number }[] = [
  { name: 'a chip of azurite', value: 10 },
  { name: 'a banded agate', value: 10 },
  { name: 'a polished bloodstone', value: 50 },
  { name: 'a citrine', value: 50 },
  { name: 'a fire-red garnet', value: 100 },
  { name: 'a fist-sized jade', value: 100 },
  { name: 'a perfect pearl', value: 100 },
  { name: 'a smoky spinel', value: 100 },
  { name: 'a star sapphire', value: 1000 },
  { name: 'a flawless ruby', value: 1000 },
  { name: 'an eye-clean diamond', value: 5000 },
];

const ART_OBJECTS: { name: string; value: number }[] = [
  { name: 'a silver ewer', value: 25 },
  { name: 'a silk robe with gold thread', value: 100 },
  { name: 'a carved ivory statuette', value: 250 },
  { name: 'a gold locket with a painted portrait', value: 25 },
  { name: 'a set of onyx chess pieces', value: 250 },
  { name: 'a jade-inlaid ceremonial dagger', value: 250 },
  { name: 'an ornate tapestry depicting a dragon', value: 750 },
  { name: 'a platinum crown of a forgotten king', value: 7500 },
];

// ── Individual treasure (DMG) ────────────────────────

/**
 * Individual treasure: coins only, keyed to challenge rating.
 * Tables are faithful to the 5e DMG (converted to a coin purse + gp value).
 */
function rollIndividualCoins(cr: number): CoinPurse {
  const roll = rollDice(1, 100);

  if (cr <= 4) {
    if (roll <= 30) return { ...EMPTY_PURSE, cp: rollDice(5, 6) };
    if (roll <= 60) return { ...EMPTY_PURSE, sp: rollDice(4, 6) };
    if (roll <= 70) return { ...EMPTY_PURSE, ep: rollDice(3, 6) };
    if (roll <= 95) return { ...EMPTY_PURSE, gp: rollDice(3, 6) };
    return { ...EMPTY_PURSE, pp: rollDice(1, 6) };
  }

  if (cr <= 10) {
    if (roll <= 30) return { cp: rollDice(4, 6) * 100, ep: rollDice(1, 6) * 10, sp: 0, gp: 0, pp: 0 };
    if (roll <= 60) return { sp: rollDice(6, 6) * 10, ep: rollDice(2, 6) * 10, cp: 0, gp: 0, pp: 0 };
    if (roll <= 70) return { ep: rollDice(3, 6) * 10, gp: rollDice(2, 6) * 10, cp: 0, sp: 0, pp: 0 };
    if (roll <= 95) return { gp: rollDice(4, 6) * 10, cp: 0, sp: 0, ep: 0, pp: 0 };
    return { pp: rollDice(2, 6) * 10, cp: 0, sp: 0, ep: 0, gp: 0 };
  }

  if (cr <= 16) {
    if (roll <= 20) return { sp: rollDice(4, 6) * 100, gp: rollDice(1, 6) * 100, cp: 0, ep: 0, pp: 0 };
    if (roll <= 35) return { ep: rollDice(1, 6) * 100, gp: rollDice(1, 6) * 100, cp: 0, sp: 0, pp: 0 };
    if (roll <= 75) return { gp: rollDice(2, 6) * 100, pp: rollDice(1, 6) * 10, cp: 0, sp: 0, ep: 0 };
    return { gp: rollDice(2, 6) * 100, pp: rollDice(2, 6) * 10, cp: 0, sp: 0, ep: 0 };
  }

  if (roll <= 15) return { ep: rollDice(2, 6) * 1000, gp: rollDice(8, 6) * 100, cp: 0, sp: 0, pp: 0 };
  if (roll <= 55) return { gp: rollDice(1, 6) * 1000, pp: rollDice(1, 6) * 100, cp: 0, sp: 0, ep: 0 };
  return { gp: rollDice(1, 6) * 1000, pp: rollDice(2, 6) * 100, cp: 0, sp: 0, ep: 0 };
}

// ── Individual treasure dressing: gems & art, gated by CR ──

/** Finer gems only appear on bigger beasts. */
function gemCapForCr(cr: number): number {
  if (cr >= 17) return 5000;
  if (cr >= 11) return 1000;
  if (cr >= 5) return 100;
  return 50;
}

function pickGem(cr: number): InventoryItem | null {
  const cap = gemCapForCr(cr);
  const pool = GEMS.filter(g => g.value <= cap);
  if (pool.length === 0) return null;
  const gem = pool[Math.floor(Math.random() * pool.length)];
  return { id: `gem_${slug(gem.name)}`, name: gem.name.charAt(0).toUpperCase() + gem.name.slice(1), type: 'treasure', description: `A gem worth ${gem.value} gp.`, value: gem.value };
}

function pickArt(cr: number): InventoryItem | null {
  const cap = cr >= 17 ? 7500 : cr >= 11 ? 750 : 250;
  const pool = ART_OBJECTS.filter(a => a.value <= cap);
  if (pool.length === 0) return null;
  const art = pool[Math.floor(Math.random() * pool.length)];
  return { id: `art_${slug(art.name)}`, name: art.name.charAt(0).toUpperCase() + art.name.slice(1), type: 'treasure', description: `A work of art worth ${art.value} gp.`, value: art.value };
}

// ── Magic item rarity gates by CR tier ───────────────

const RARITY_RANK: Record<MagicItem['rarity'], number> = {
  common: 1, uncommon: 2, rare: 3, 'very rare': 4, legendary: 5, artifact: 6, varies: 2,
};

function maxRarityForCr(cr: number): MagicItem['rarity'] {
  if (cr >= 17) return 'legendary';
  if (cr >= 11) return 'very rare';
  if (cr >= 5) return 'rare';
  return 'uncommon';
}

/**
 * Theme affinity per magic item id — a fiend's corpse leans hellish, a
 * dragon's hoard leans fiery and grand, an undead's cache leans cold.
 */
const MAGIC_ITEM_THEMES: Record<string, string[]> = {
  vorpal_sword: ['war', 'arcane'],
  holy_avenger: ['celestial', 'war'],
  staff_of_the_magi: ['arcane', 'draconic'],
  deck_of_many_things: ['arcane'],
  bag_of_holding: ['utility'],
  cloak_of_invisibility: ['shadow'],
  ring_of_three_wishes: ['arcane', 'draconic'],
  sun_blade: ['celestial', 'undead', 'war'],
  wand_of_fireballs: ['draconic', 'fiendish', 'elemental'],
  pearl_of_power: ['arcane'],
  belt_of_giant_strength: ['giant'],
  portable_hole: ['arcane', 'utility'],
  eye_of_vecna: ['undead', 'shadow'],
  hand_of_vecna: ['undead', 'shadow'],
  talisman_of_pure_good: ['celestial'],
  apparatus_of_kwalish: ['aquatic', 'utility'],
  robe_of_the_archmagi: ['arcane'],
  gauntlets_of_ogre_power: ['giant', 'war'],
  headband_of_intellect: ['arcane'],
  amulet_of_health: ['utility'],
  boots_of_striding: ['fey', 'nature'],
  wings_of_flying: ['draconic', 'celestial'],
  slippers_of_spider_climbing: ['fey', 'aberrant'],
  cloak_of_elvenkind: ['fey', 'shadow'],
  cloak_of_protection_lore: ['utility'],
  bracers_of_defense: ['war'],
  ring_of_invisibility_lore: ['shadow', 'arcane'],
  ring_of_regeneration: ['nature', 'undead'],
  ring_of_spell_storing: ['arcane'],
  immovable_rod: ['utility'],
  decanter_endless_water: ['aquatic'],
  necklace_of_fireballs: ['draconic', 'fiendish', 'elemental'],
  wand_of_wonder_lore: ['arcane', 'fey'],
  staff_of_healing_lore: ['celestial', 'nature'],
  rod_of_lordly_might: ['war', 'arcane'],
  rod_of_rulership: ['fiendish', 'arcane'],
  ioun_stone_insight: ['arcane'],
  sovereign_glue_lore: ['utility'],
  sphere_of_annihilation_lore: ['aberrant', 'arcane'],
  well_of_many_worlds_lore: ['arcane', 'aberrant'],
  iron_flask_lore: ['fiendish', 'arcane'],
  efreeti_bottle_lore: ['fiendish', 'elemental'],
  figurine_wondrous_power: ['fey', 'arcane'],
  hat_of_disguise_lore: ['fey', 'shadow'],
  pipes_of_haunting: ['undead', 'shadow'],
  quiver_of_ehlonna: ['nature', 'fey'],
  rope_of_climbing_lore: ['fey', 'utility'],
  scarab_of_protection: ['undead', 'arcane'],
};

/** Monster type → loot theme keyword. */
function typeTheme(type?: string): string | null {
  switch (type) {
    case 'fiend': return 'fiendish';
    case 'undead': return 'undead';
    case 'dragon': return 'draconic';
    case 'celestial': return 'celestial';
    case 'fey': return 'fey';
    case 'elemental': return 'elemental';
    case 'plant':
    case 'beast': return 'nature';
    case 'giant': return 'giant';
    case 'construct': return 'arcane';
    case 'aberration': return 'aberrant';
    default: return null;
  }
}

/** A one-line flourish for a magic item that fits its source's theme. */
const THEME_FLAVOR: Record<string, string> = {
  fiendish: ' It reeks of brimstone and spent oaths.',
  undead: ' It is cold to the touch, and faintly hungry.',
  draconic: ' It gleams like fresh dragon-scale.',
  celestial: ' It hums with a faint, warm light.',
  fey: ' Glamour clings to it like dew.',
  elemental: ' Heat and static crackle along its surface.',
  nature: ' It still smells of deep earth and green things.',
  giant: ' It is sized for enormous hands.',
  aberrant: ' Looking at it too long makes your eyes water.',
  shadow: ' It drinks the light around it.',
  arcane: ' Faint runes crawl across its surface.',
  war: ' It is scarred by a hundred battles.',
  aquatic: ' It drips seawater that never dries.',
  utility: '',
};

function rollMagicItem(cr: number, type?: string): MagicItem | null {
  const cap = maxRarityForCr(cr);
  const capRank = RARITY_RANK[cap];
  const pool = MAGIC_ITEMS.filter(i => {
    const rank = RARITY_RANK[i.rarity];
    return rank <= capRank && i.rarity !== 'artifact' && i.rarity !== 'varies';
  });
  if (pool.length === 0) return null;
  // Weight toward the top of the available range, so deeper loot feels better.
  const weighted = pool.filter(i => RARITY_RANK[i.rarity] >= capRank - 1);
  const base = weighted.length > 0 ? weighted : pool;

  const theme = typeTheme(type);
  if (!theme) return base[Math.floor(Math.random() * base.length)];

  // Themed affinity: ~70% of the time the corpse yields something that fits
  // its kind; the rest stays generic, so a hint of the unexpected survives.
  const themed = base.filter(i => (MAGIC_ITEM_THEMES[i.id] ?? []).includes(theme));
  if (themed.length === 0) return base[Math.floor(Math.random() * base.length)];
  return Math.random() < 0.7
    ? themed[Math.floor(Math.random() * themed.length)]
    : base[Math.floor(Math.random() * base.length)];
}

function rollConsumable(cr: number): InventoryItem | null {
  const potions = MARKET_POTIONS.filter(p => (p.value || 0) <= Math.max(50, cr * 150));
  const scrolls = MARKET_SCROLLS.filter(s => (s.value || 0) <= Math.max(100, cr * 200));
  const pool = [...potions, ...scrolls];
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Individual loot for a single slain creature: DMG coin roll plus gems,
 * art objects, consumables, and magic items whose chance and quality rise
 * steeply with CR — the bigger the beast, the better the haul.
 */
interface IndividualLoot {
  coins: CoinPurse;
  items: InventoryItem[];
  magicItems: MagicItem[];
}

/** Per-tier chances for individual treasure (index 0 = CR 0-4 … 3 = CR 17+). */
const INDIVIDUAL_GEM_CHANCE = [0.12, 0.35, 0.6, 0.85];
const INDIVIDUAL_ART_CHANCE = [0, 0.15, 0.35, 0.5];
const INDIVIDUAL_CONSUMABLE_CHANCE = [0.08, 0.2, 0.35, 0.5];
const INDIVIDUAL_MAGIC_CHANCE = [0.04, 0.12, 0.25, 0.4];
const HOARD_MAGIC_CHANCE = [0.15, 0.35, 0.55, 0.8];

/** Challenge-rating tier (1-4) for a creature's CR. */
function crTier(cr: number): number {
  return cr <= 4 ? 1 : cr <= 10 ? 2 : cr <= 16 ? 3 : 4;
}

function rollIndividualLoot(cr: number, type?: string): IndividualLoot {
  const coins = rollIndividualCoins(cr);
  const items: InventoryItem[] = [];
  const magicItems: MagicItem[] = [];
  const tier = crTier(cr);

  // Gems: a goblin occasionally carries a chip of agate; a dragon's corpse
  // is rarely without treasure, and tier 3+ beasts often carry several.
  if (Math.random() < INDIVIDUAL_GEM_CHANCE[tier - 1]) {
    const gem = pickGem(cr);
    if (gem) items.push(gem);
    if (tier >= 3 && Math.random() < 0.5) {
      const extra = pickGem(cr);
      if (extra) items.push(extra);
    }
  }

  // Art objects from tier 2 upward.
  if (Math.random() < INDIVIDUAL_ART_CHANCE[tier - 1]) {
    const art = pickArt(cr);
    if (art) items.push(art);
  }

  // Consumables — usable loot at every tier.
  if (Math.random() < INDIVIDUAL_CONSUMABLE_CHANCE[tier - 1]) {
    const consumable = rollConsumable(cr);
    if (consumable) items.push(consumable);
  }

  // Magic items: possible even at low CR, common on titans. The pick leans
  // toward items that fit the creature's kind — fiends drop hellish gear.
  if (Math.random() < INDIVIDUAL_MAGIC_CHANCE[tier - 1]) {
    const item = rollMagicItem(cr, type);
    if (item) magicItems.push(item);
  }

  return { coins, items, magicItems };
}

// ── Hoard treasure ───────────────────────────────────

function rollHoard(cr: number, type?: string): { coins: CoinPurse; gems: InventoryItem[]; magicItems: MagicItem[] } {
  // Hoard coins: far larger than individual, scaled by tier.
  const tier = cr <= 4 ? 1 : cr <= 10 ? 2 : cr <= 16 ? 3 : 4;
  let coins: CoinPurse;
  switch (tier) {
    case 1:
      coins = { cp: rollDice(6, 6) * 100, sp: rollDice(3, 6) * 100, gp: rollDice(2, 6) * 10, ep: 0, pp: 0 };
      break;
    case 2:
      coins = { cp: 0, sp: rollDice(2, 6) * 1000, gp: rollDice(6, 6) * 100, pp: rollDice(3, 6) * 10, ep: 0 };
      break;
    case 3:
      coins = { cp: 0, sp: 0, gp: rollDice(4, 6) * 1000, pp: rollDice(5, 6) * 100, ep: 0 };
      break;
    default:
      coins = { cp: 0, sp: 0, gp: rollDice(12, 6) * 1000, pp: rollDice(8, 6) * 1000, ep: 0 };
  }

  // Gems and art objects.
  const gems: InventoryItem[] = [];
  const gemRoll = rollDice(1, 100);
  if (tier >= 2 || gemRoll > 40) {
    const gem = GEMS[Math.floor(Math.random() * GEMS.length)];
    gems.push({ id: `gem_${slug(gem.name)}`, name: gem.name.charAt(0).toUpperCase() + gem.name.slice(1), type: 'treasure', description: `A gem worth ${gem.value} gp.`, value: gem.value });
  }
  const artRoll = rollDice(1, 100);
  if (tier >= 3 || artRoll > 60) {
    const art = ART_OBJECTS[Math.floor(Math.random() * ART_OBJECTS.length)];
    gems.push({ id: `art_${slug(art.name)}`, name: art.name.charAt(0).toUpperCase() + art.name.slice(1), type: 'treasure', description: `A work of art worth ${art.value} gp.`, value: art.value });
  }

  // Magic items: chance rises with tier. A dragon's hoard leans draconic.
  const magicItems: MagicItem[] = [];
  const magicChance = HOARD_MAGIC_CHANCE[tier - 1];
  if (Math.random() < magicChance) {
    const item = rollMagicItem(cr, type);
    if (item) magicItems.push(item);
  } else if (Math.random() < 0.4) {
    // A consolation consumable so every hoard rewards something usable.
    const consumable = rollConsumable(cr);
    if (consumable) gems.push(consumable);
  }

  return { coins, gems, magicItems };
}

// ── Public roll helpers ──────────────────────────────

function purseValue(coins: CoinPurse): number {
  return Math.round(coins.cp / 100 + coins.sp / 10 + coins.ep / 2 + coins.gp + coins.pp * 10);
}

function describePurse(coins: CoinPurse): string | null {
  const parts: string[] = [];
  if (coins.cp > 0) parts.push(`${coins.cp.toLocaleString()} cp`);
  if (coins.sp > 0) parts.push(`${coins.sp.toLocaleString()} sp`);
  if (coins.ep > 0) parts.push(`${coins.ep.toLocaleString()} ep`);
  if (coins.gp > 0) parts.push(`${coins.gp.toLocaleString()} gp`);
  if (coins.pp > 0) parts.push(`${coins.pp.toLocaleString()} pp`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Wrap a MagicItem so it can ride in the party's inventory. */
function magicToInventoryItem(mi: MagicItem): InventoryItem {
  // Weapon- and jewelry-type magic items become equippable gear; the rest
  // stay as treasure flavor items.
  const t = mi.type.toLowerCase();
  if (t.startsWith('weapon') || t === 'staff') {
    return {
      id: mi.id,
      name: mi.name,
      type: 'weapon',
      description: mi.description,
      value: magicValue(mi),
      identified: true,
    };
  }
  if (/\bring|cloak|amulet|talisman|periapt|eye|hand/.test(t)) {
    return {
      id: mi.id,
      name: mi.name,
      type: 'armor',
      description: mi.description,
      value: magicValue(mi),
      identified: true,
    };
  }
  return {
    id: mi.id,
    name: mi.name,
    type: 'treasure',
    description: mi.description,
    value: magicValue(mi),
  };
}

/**
 * Roll loot for a whole battle: individual CR-scaled loot per creature,
 * plus a hoard for bosses (or a small chance scaled by dungeon level).
 */
export function rollCombatLoot(sources: LootSource[], dungeonLevel: number): LootResult {
  const coins: CoinPurse = { ...EMPTY_PURSE };
  const items: InventoryItem[] = [];
  const magicItems: MagicItem[] = [];
  const narration: string[] = [];
  let hoard = false;

  const addCoins = (c: CoinPurse) => {
    coins.cp += c.cp; coins.sp += c.sp; coins.ep += c.ep; coins.gp += c.gp; coins.pp += c.pp;
  };

  // Per-creature individual loot — every corpse rolls its own scaled haul,
  // and magic items lean toward the creature's kind.
  const individualItems: InventoryItem[] = [];
  for (const src of sources) {
    const drop = rollIndividualLoot(src.cr, src.type);
    addCoins(drop.coins);
    items.push(...drop.items);
    individualItems.push(...drop.items);
    for (const mi of drop.magicItems) {
      magicItems.push(mi);
      items.push(magicToInventoryItem(mi));
    }
    const notable = [...drop.items, ...drop.magicItems];
    if (notable.length > 0) {
      const purse = describePurse(drop.coins);
      narration.push(
        `${src.name}'s corpse yields ${notable.map(n => n.name).join(', ')}${purse ? ` beside ${purse}` : ''}.`
      );
    }
    // A magic item that fits its owner's kind gets a flavor flourish.
    const theme = typeTheme(src.type);
    const flavoredMagic = theme
      ? drop.magicItems.find(mi => (MAGIC_ITEM_THEMES[mi.id] ?? []).includes(theme))
      : undefined;
    if (flavoredMagic) {
      narration.push(`The ${flavoredMagic.name}${THEME_FLAVOR[theme!] ?? ''}`);
    }
  }

  // Hoard: always for a boss, otherwise a rising chance by dungeon level.
  const hasBoss = sources.some(s => s.isBoss);
  const hoardChance = hasBoss ? 1 : Math.min(0.4, 0.05 + dungeonLevel * 0.03);
  if (sources.length > 0 && Math.random() < hoardChance) {
    hoard = true;
    const hoardCr = Math.max(1, ...sources.map(s => s.cr));
    const hoardSource = sources.reduce((a, b) => (b.cr > a.cr ? b : a));
    const h = rollHoard(hoardCr, hoardSource.type);
    addCoins(h.coins);
    items.push(...h.gems);
    for (const mi of h.magicItems) {
      magicItems.push(mi);
      items.push(magicToInventoryItem(mi));
    }
  }

  const purseLine = describePurse(coins);
  if (purseLine) narration.push(`Coins recovered: ${purseLine}.`);
  // Hoard-dropped treasure gets its own lines; individual drops were already
  // named on their corpse, so skip anything narrated above.
  for (const item of items) {
    if (item.type !== 'treasure' || magicItems.some(mi => mi.id === item.id)) continue;
    const alreadyNamed = individualItems.some(ii => ii.id === item.id && ii.name === item.name);
    if (!alreadyNamed) narration.push(`Also found: ${item.name} (${item.value} gp).`);
  }
  for (const mi of magicItems) {
    narration.push(`${mi.name} (${mi.rarity}) — ${mi.description.substring(0, 90)}${mi.description.length > 90 ? '...' : ''}`);
  }

  const gp = purseValue(coins);
  if (hoard) narration.unshift('It was guarding a hoard — the party finds a stockpile of wealth.');

  return { coins, goldValue: gp, items, magicItems, narration, hoard };
}

function magicValue(item: MagicItem): number {
  const ranks: Record<MagicItem['rarity'], number> = {
    common: 100, uncommon: 500, rare: 5000, 'very rare': 50000, legendary: 500000, artifact: 0, varies: 1000,
  };
  return ranks[item.rarity];
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ── Grimoire loot guide (single source of truth for the docs) ──

export interface LootTierGuide {
  crRange: string;
  /** Typical individual coin haul (DMG scale), e.g. '3d6 gp' or '2d6 × 100 gp'. */
  coinScale: string;
  gem: string;
  art: string;
  consumable: string;
  magic: string;
  /** Hoard magic-item chance for a boss of this tier. */
  hoard: string;
  flavor: string;
}

/**
 * What a corpse typically yields per CR tier — mirrors rollIndividualLoot and
 * rollHoard exactly, so the Grimoire can never drift from the mechanics.
 */
export const LOOT_TIER_GUIDES: LootTierGuide[] = [
  {
    crRange: 'CR 0\u20134',
    coinScale: '3d6 gp (or 1d6 pp)',
    gem: `${Math.round(INDIVIDUAL_GEM_CHANCE[0] * 100)}% \u2014 gems up to 50 gp`,
    art: 'None',
    consumable: `${Math.round(INDIVIDUAL_CONSUMABLE_CHANCE[0] * 100)}% \u2014 potion or scroll`,
    magic: `${Math.round(INDIVIDUAL_MAGIC_CHANCE[0] * 100)}% \u2014 common to uncommon`,
    hoard: `${Math.round(HOARD_MAGIC_CHANCE[0] * 100)}%`,
    flavor: 'A goblin\u2019s pouch: copper, a few silver, maybe a chip of agate.'
  },
  {
    crRange: 'CR 5\u201310',
    coinScale: '4d6 \u00d7 10 gp',
    gem: `${Math.round(INDIVIDUAL_GEM_CHANCE[1] * 100)}% \u2014 gems up to 100 gp`,
    art: `${Math.round(INDIVIDUAL_ART_CHANCE[1] * 100)}% \u2014 up to 250 gp`,
    consumable: `${Math.round(INDIVIDUAL_CONSUMABLE_CHANCE[1] * 100)}%`,
    magic: `${Math.round(INDIVIDUAL_MAGIC_CHANCE[1] * 100)}% \u2014 up to rare`,
    hoard: `${Math.round(HOARD_MAGIC_CHANCE[1] * 100)}%`,
    flavor: 'A troll\u2019s hoard: gold by the handful, a garnet in the ribs, a potion the owner never drank.'
  },
  {
    crRange: 'CR 11\u201316',
    coinScale: '2d6 \u00d7 100 gp',
    gem: `${Math.round(INDIVIDUAL_GEM_CHANCE[2] * 100)}% \u2014 gems up to 1,000 gp, often two`,
    art: `${Math.round(INDIVIDUAL_ART_CHANCE[2] * 100)}% \u2014 up to 750 gp`,
    consumable: `${Math.round(INDIVIDUAL_CONSUMABLE_CHANCE[2] * 100)}%`,
    magic: `${Math.round(INDIVIDUAL_MAGIC_CHANCE[2] * 100)}% \u2014 up to very rare`,
    hoard: `${Math.round(HOARD_MAGIC_CHANCE[2] * 100)}%`,
    flavor: 'A vampire\u2019s cache: coin of dead dynasties, a star sapphire, cold magic that drinks the light.'
  },
  {
    crRange: 'CR 17+',
    coinScale: '1d6 \u00d7 1,000 gp',
    gem: `${Math.round(INDIVIDUAL_GEM_CHANCE[3] * 100)}% \u2014 gems up to 5,000 gp`,
    art: `${Math.round(INDIVIDUAL_ART_CHANCE[3] * 100)}% \u2014 up to 7,500 gp`,
    consumable: `${Math.round(INDIVIDUAL_CONSUMABLE_CHANCE[3] * 100)}%`,
    magic: `${Math.round(INDIVIDUAL_MAGIC_CHANCE[3] * 100)}% \u2014 up to legendary`,
    hoard: `${Math.round(HOARD_MAGIC_CHANCE[3] * 100)}%`,
    flavor: 'A lich\u2019s vault: treasure beyond counting, and relics that remember their first owners.'
  },
];

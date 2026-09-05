import type { InventoryItem } from '../entities/Character';
/**
 * TownTypes — town archetypes that give each settlement a distinct personality.
 * Each archetype determines what buildings exist, what services are available,
 * what the shop sells, and what flavor text the town panel shows.
 *
 * When a town is generated, it receives an archetype (seeded by its ID) and
 * the archetype populates its buildings, shops, and services.
 */

export type TownArchetypeId =
  | 'port_town'
  | 'mining_settlement'
  | 'wizard_college'
  | 'frontier_outpost'
  | 'holy_city'
  | 'trade_hub'
  | 'farming_village'
  | 'noble_seat'
  | 'forest_hold'
  | 'desert_oasis';

export interface TownBuilding {
  id: string;
  name: string;
  /** Emoji icon for the building. */
  icon: string;
  /** Short description shown in the building list. */
  description: string;
  /** Services this building offers (empty = flavor only). */
  services: TownService[];
  /** Whether this building has a shop. */
  hasShop: boolean;
  /** Shop item pool ids (looked up from SHOP_STOCK). */
  shopPool?: string;
}

export type TownServiceId =
  | 'rest'
  | 'train_combat'
  | 'train_magic'
  | 'heal'
  | 'identify'
  | 'remove_curse'
  | 'enchant'
  | 'craft'
  | 'bounty_board'
  | 'tavern_rumors'
  | 'temple_blessing'
  | 'blacksmith_upgrade'
  | 'silver_forge'
  | 'guild_registration'
  | 'hire_guard'
  | 'tavern_gamble'
  | 'temple_donate';

export interface TownService {
  id: TownServiceId;
  name: string;
  description: string;
  /** Cost in gold, 0 = free. */
  cost: number;
  /** Effect description shown to the player. */
  effect: string;
}

export interface TownArchetype {
  id: TownArchetypeId;
  name: string;
  /** Flavor text for the town panel header. */
  flavor: string;
  /** Buildings that exist in this type of town. */
  buildings: TownBuilding[];
  /** Global price modifier (1.0 = normal, 1.2 = expensive, 0.8 = cheap). */
  priceModifier: number;
  /** Bonus description appended to the town's description. */
  bonusDescription: string;
}

// ── Service Templates ──────────────────────────────────────────────────────

const SERVICES: Record<TownServiceId, Omit<TownService, 'id'>> = {
  rest: {
    name: 'Long Rest',
    description: 'Recover all HP and spell slots at the inn.',
    cost: 0,
    effect: 'Full HP and spell slot recovery.',
  },
  train_combat: {
    name: 'Combat Training',
    description: 'Spar with the local trainer. Grants bonus XP toward your next level.',
    cost: 50,
    effect: 'Grants 30 XP per training session.',
  },
  train_magic: {
    name: 'Arcane Study',
    description: 'Study under the college wizard. Grants bonus XP for casters.',
    cost: 75,
    effect: 'Grants 40 XP per study session.',
  },
  heal: {
    name: 'Healing',
    description: 'The temple cleric heals wounds and cures ailments.',
    cost: 25,
    effect: 'Restores 50% of max HP to all party members.',
  },
  identify: {
    name: 'Identify Item',
    description: 'The wizard identifies a magical item in your inventory.',
    cost: 30,
    effect: 'Reveals the properties of one unidentified item.',
  },
  remove_curse: {
    name: 'Rite of Curse-Lifting',
    description: 'The temple clergy perform a rite that parts a cursed item from its bearer.',
    cost: 120,
    effect: 'Lifts the curse on one equipped cursed item so it can be removed.',
  },
  enchant: {
    name: 'Enchant Weapon',
    description: 'The blacksmith infuses your weapon with elemental power.',
    cost: 200,
    effect: 'Adds +1 to weapon damage rolls for 3 battles.',
  },
  craft: {
    name: 'Craft Item',
    description: 'Combine materials to create potions, scrolls, or gear.',
    cost: 100,
    effect: 'Produces a random consumable (potion or scroll).',
  },
  bounty_board: {
    name: 'Bounty Board',
    description: 'Check the latest monster bounties posted by the town guard.',
    cost: 0,
    effect: 'Refreshes the quest board with combat-focused posts.',
  },
  tavern_rumors: {
    name: 'Buy a Round',
    description: 'Buy drinks for the locals and hear the latest gossip.',
    cost: 10,
    effect: 'Reveals a dungeon hint or treasure rumor.',
  },
  temple_blessing: {
    name: 'Divine Blessing',
    description: 'Receive a holy blessing from the temple priests.',
    cost: 40,
    effect: '+2 to all saving throws for the next battle.',
  },
  blacksmith_upgrade: {
    name: 'Upgrade Armor',
    description: 'The smith reinforces your armor with better materials.',
    cost: 150,
    effect: '+1 AC to the party leader for 3 battles.',
  },
  silver_forge: {
    name: 'Forge Silvered Weapon',
    description: 'Forge your Moon-Silver Crescent and moon-touched trophies into a blessed silvered blade that bites shapeshifters true.',
    cost: 0,
    effect: 'Permanent: +1 damage vs all foes and double damage vs shapeshifters for the forger\'s lifetime.',
  },
  guild_registration: {
    name: 'Guild Registration',
    description: 'Register with the Adventurers\' Guild for exclusive contracts.',
    cost: 25,
    effect: 'Unlocks higher-tier quests and better rewards.',
  },
  hire_guard: {
    name: 'Hire Guard',
    description: 'Recruit a local sellsword to join the party for the next dungeon delve.',
    cost: 40,
    effect: 'Adds a temporary companion with basic combat stats.',
  },
  tavern_gamble: {
    name: 'Dice Game',
    description: 'Roll the bones against the house. High risk, high reward.',
    cost: 15,
    effect: 'Win 30-90 gp or lose your stake.',
  },
  temple_donate: {
    name: 'Temple Offering',
    description: 'Make a generous offering to the temple. Karma remembers.',
    cost: 50,
    effect: 'Gain reputation and a random blessing.',
  },
};

// ── Shop Stock Pools ──────────────────────────────────────────────────────

export interface ShopItem {
  name: string;
  type: 'potion' | 'scroll' | 'weapon' | 'armor' | 'gem' | 'tool';
  value: number;
  description: string;
  power?: number;
}

/**
 * Shop wares whose effect the game already knows how to apply under a market
 * id. Everything else is carried under a shop id and falls to the generic
 * "Restores N HP" reading, or is simply carried and sold.
 */
const SHOP_ITEM_IDS: Record<string, string> = {
  'Potion of Invisibility': 'potion_invisibility',
  'Potion of Speed': 'potion_speed',
  'Scroll of Fireball': 'scroll_fireball',
  'Scroll of Lightning Bolt': 'scroll_lightning_bolt',
  'Scroll of Resurrection': 'scroll_revivify',
};

/** An InventoryItem type for a shop type: gems and tools are treasure, worth their value and nothing else. */
function inventoryType(t: ShopItem['type']): InventoryItem['type'] {
  return t === 'gem' || t === 'tool' ? 'treasure' : t;
}

/**
 * The item a building's shop hands over. The id is stable per pool and name,
 * so a second Healing Potion is the same kind of thing as the first.
 */
export function shopItemToInventory(pool: string, item: ShopItem): InventoryItem {
  const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const out: InventoryItem = {
    id: SHOP_ITEM_IDS[item.name] ?? `shop_${pool}_${slug}`,
    name: item.name,
    type: inventoryType(item.type),
    description: item.description,
    value: item.value,
    identified: true,
  };
  if (item.power !== undefined) out.power = item.power;
  return out;
}

export const SHOP_STOCK: Record<string, ShopItem[]> = {
  general: [
    { name: 'Healing Potion', type: 'potion', value: 25, description: 'Restores 30 HP.', power: 30 },
    { name: 'Antidote', type: 'potion', value: 15, description: 'Cures poison.', power: 10 },
    { name: 'Scroll of Magic Missile', type: 'scroll', value: 40, description: 'Deals 14 force damage.', power: 14 },
    { name: 'Rations (3 days)', type: 'tool', value: 5, description: 'Keeps the party fed on the road.' },
    { name: 'Torch', type: 'tool', value: 1, description: 'Lights up a 30ft radius in dungeons.' },
    { name: 'Rope (50ft)', type: 'tool', value: 5, description: 'Useful for climbing and binding.' },
  ],
  weapons: [
    { name: 'Longsword', type: 'weapon', value: 30, description: 'Versatile melee weapon. 1d8 slashing.', power: 8 },
    { name: 'Battleaxe', type: 'weapon', value: 35, description: 'Heavy melee weapon. 1d8 slashing.', power: 8 },
    { name: 'Shortbow', type: 'weapon', value: 25, description: 'Ranged weapon. 1d6 piercing.', power: 6 },
    { name: 'Dagger +1', type: 'weapon', value: 100, description: 'Enchanted dagger. 1d4+1 piercing.', power: 5 },
    { name: 'Warhammer', type: 'weapon', value: 40, description: 'Bludgeoning weapon. 1d8 bludgeoning.', power: 8 },
    { name: 'Greataxe', type: 'weapon', value: 50, description: 'Two-handed axe. 1d12 slashing.', power: 12 },
  ],
  armor: [
    { name: 'Chain Mail', type: 'armor', value: 75, description: 'Heavy armor. AC 16.', power: 16 },
    { name: 'Leather Armor', type: 'armor', value: 20, description: 'Light armor. AC 11.', power: 11 },
    { name: 'Shield', type: 'armor', value: 20, description: 'Adds +2 AC.', power: 2 },
    { name: 'Half Plate', type: 'armor', value: 150, description: 'Medium armor. AC 15.', power: 15 },
    { name: 'Scale Mail', type: 'armor', value: 100, description: 'Medium armor. AC 14.', power: 14 },
  ],
  magic: [
    { name: 'Scroll of Fireball', type: 'scroll', value: 150, description: 'Deals 28 fire damage in a 20ft radius.', power: 28 },
    { name: 'Scroll of Lightning Bolt', type: 'scroll', value: 150, description: 'Deals 28 lightning damage.', power: 28 },
    { name: 'Scroll of Cure Wounds', type: 'scroll', value: 60, description: 'Restores 28 HP.', power: 28 },
    { name: 'Potion of Greater Healing', type: 'potion', value: 50, description: 'Restores 60 HP.', power: 60 },
    { name: 'Scroll of Haste', type: 'scroll', value: 200, description: 'Doubles movement and grants an extra attack.', power: 40 },
    { name: 'Potion of Fire Breath', type: 'potion', value: 100, description: 'Deals 42 fire damage.', power: 42 },
  ],
  rare: [
    { name: 'Scroll of Resurrection', type: 'scroll', value: 500, description: 'Brings a fallen comrade back from the dead.', power: 100 },
    { name: 'Potion of Speed', type: 'potion', value: 300, description: 'Grants haste for one battle.', power: 50 },
    { name: 'Diamond (spell component)', type: 'gem', value: 250, description: 'Required for high-level resurrection spells.' },
    { name: 'Scroll of Power Word Kill', type: 'scroll', value: 800, description: 'Instantly kills a creature with less than 100 HP.', power: 100 },
    { name: 'Flame Tongue Longsword', type: 'weapon', value: 600, description: 'A sword that burns with magical fire. 1d8+2d6 fire.', power: 20 },
  ],
  gems: [
    { name: 'Ruby', type: 'gem', value: 100, description: 'A deep red gemstone. Prized by collectors.' },
    { name: 'Sapphire', type: 'gem', value: 150, description: 'A brilliant blue gem. Used in enchanting.' },
    { name: 'Emerald', type: 'gem', value: 120, description: 'A vivid green gem. Fey creatures covet these.' },
    { name: 'Black Opal', type: 'gem', value: 200, description: 'An opal that shifts between dark colors. Illithid traders pay top coin.' },
    { name: 'Star Diamond', type: 'gem', value: 500, description: 'A flawless diamond that catches light like a star. Temple relic.' },
  ],
  potions: [
    { name: 'Healing Potion', type: 'potion', value: 25, description: 'Restores 30 HP.', power: 30 },
    { name: 'Potion of Healing', type: 'potion', value: 50, description: 'Restores 60 HP.', power: 60 },
    { name: 'Potion of Strength', type: 'potion', value: 40, description: 'Grants +4 to melee attacks for one battle.', power: 4 },
    { name: 'Potion of Invisibility', type: 'potion', value: 60, description: 'Grants invisibility for 3 rounds.', power: 10 },
    { name: 'Potion of Flying', type: 'potion', value: 100, description: 'Grants flying for one battle.', power: 20 },
    { name: 'Antidote', type: 'potion', value: 15, description: 'Cures poison.', power: 10 },
  ],
};

// ── Town Events ───────────────────────────────────────────────────────────

export interface TownEvent {
  id: string;
  name: string;
  /** Emoji for the event. */
  icon: string;
  /** Narration when the party arrives during this event. */
  narration: string;
  /** Bonus or penalty applied. */
  effect: TownEventEffect;
  /** How long the event lasts (ms). */
  duration: number;
}

export interface TownEventEffect {
  type: 'gold_bonus' | 'xp_bonus' | 'price_change' | 'free_rest' | 'free_item' | 'combat' | 'quest_unlock';
  value: number;
  description: string;
}

export const TOWN_EVENTS: TownEvent[] = [
  {
    id: 'tavern_brawl',
    name: 'Tavern Brawl',
    icon: '🍺',
    narration: 'The tavern erupts in a brawl — chairs fly and beer spills everywhere! The party joins in for a free drink and some scrap experience.',
    effect: { type: 'xp_bonus', value: 15, description: '+15 XP from the brawl.' },
    duration: 30000,
  },
  {
    id: 'merchant_caravan',
    name: 'Merchant Caravan Arrives',
    icon: '🛒',
    narration: 'A heavily laden merchant caravan rolls into town! The shops have rare goods at discount prices.',
    effect: { type: 'price_change', value: 0.7, description: 'All prices 30% off while the caravan is in town.' },
    duration: 60000,
  },
  {
    id: 'festival_of_dead',
    name: 'Festival of the Departed',
    icon: '💀',
    narration: 'The townsfolk light candles for the dead. The temple offers free healing — a blessing from beyond the veil.',
    effect: { type: 'free_rest', value: 1, description: 'Free healing from the temple.' },
    duration: 45000,
  },
  {
    id: 'dragon_sighting',
    name: 'Dragon Sighting',
    icon: '🐉',
    narration: 'A dragon was spotted circling the peaks! The town guard doubles the bounty on dragonkind.',
    effect: { type: 'quest_unlock', value: 2, description: 'New dragon-hunting quests available.' },
    duration: 90000,
  },
  {
    id: 'circus_arrives',
    name: 'Circus of the Spectral Arts',
    icon: '🎪',
    narration: 'A mysterious circus arrives! The performers offer a show that grants strange blessings.',
    effect: { type: 'xp_bonus', value: 25, description: '+25 XP from the spectacular show.' },
    duration: 40000,
  },
  {
    id: 'plague_warning',
    name: 'Plague Warning',
    icon: '☠️',
    narration: 'A plague sweeps through town! The apothecary needs ingredients from the nearby dungeon.',
    effect: { type: 'quest_unlock', value: 1, description: 'Urgent quest: Fetch plague cure ingredients.' },
    duration: 60000,
  },
  {
    id: 'royal_visit',
    name: 'Royal Visit',
    icon: '👑',
    narration: 'The king\'s herald arrives with a proclamation! Bounty increases and new royal contracts are posted.',
    effect: { type: 'gold_bonus', value: 50, description: '+50 gp royal bounty bonus on all quests.' },
    duration: 50000,
  },
  {
    id: 'monster_attack',
    name: 'Monster Attack!',
    icon: '👹',
    narration: 'Monsters storm the town walls! The party must defend the settlement before anything else.',
    effect: { type: 'combat', value: 3, description: 'Fight 3 monsters in town defense.' },
    duration: 30000,
  },
  {
    id: 'guild_meet',
    name: 'Adventurers\' Guild Meet',
    icon: '⚔️',
    narration: 'The local guild chapter holds a meet — adventurers swap stories and share intel on nearby dungeons.',
    effect: { type: 'xp_bonus', value: 20, description: '+20 XP from shared knowledge.' },
    duration: 35000,
  },
  {
    id: 'market_day',
    name: 'Market Day',
    icon: '📊',
    narration: 'The weekly market brings traders from across the region! Better prices and rarer goods fill the stalls.',
    effect: { type: 'price_change', value: 0.8, description: 'All prices 20% off on market day.' },
    duration: 50000,
  },
  {
    id: 'assize_day',
    name: 'Assize Day',
    icon: '⚖️',
    narration: 'The circuit judge is in town and the square has been cleared for the assize. Half the crowd came for justice; the rest came for the gallows humour. Witnesses are paid, and the party saw plenty on the road.',
    effect: { type: 'gold_bonus', value: 25, description: '+25 gp in witness fees and a share of the fines.' },
    duration: 45000,
  },
  {
    id: 'wedding_on_the_square',
    name: 'A Wedding on the Square',
    icon: '💐',
    narration: 'Two families that have not spoken in a decade are marrying their children in front of the whole town. Nobody is permitted to pay for a bed or a meal tonight, and refusing would be worse than accepting.',
    effect: { type: 'free_rest', value: 1, description: 'Beds, board and healing on the house.' },
    duration: 40000,
  },
  {
    id: 'funeral_procession',
    name: 'Funeral Procession',
    icon: '🕯️',
    narration: 'The town is burying someone who mattered. Trade stops, hats come off, and the graveside talk afterward is the most honest the party has heard in months.',
    effect: { type: 'xp_bonus', value: 12, description: '+12 XP from an hour of very plain speaking.' },
    duration: 35000,
  },
  {
    id: 'fire_in_the_quarter',
    name: 'Fire in the Lower Quarter',
    icon: '🔥',
    narration: 'A chimney fire has taken three roofs and is working on a fourth. The party ends up on the bucket line until dawn, soot to the elbows, and the quarter remembers who turned out.',
    effect: { type: 'xp_bonus', value: 20, description: '+20 XP from a night on the bucket line.' },
    duration: 40000,
  },
  {
    id: 'gaol_delivery',
    name: 'Gaol Delivery',
    icon: '🔓',
    narration: 'Someone opened the cells in the night and hung the keys neatly on the door on the way out. The constable is hiring, loudly, and is not being careful about who hears the terms.',
    effect: { type: 'quest_unlock', value: 1, description: 'Urgent bounties posted on the escaped prisoners.' },
    duration: 55000,
  },
  {
    id: 'missing_child',
    name: 'Lanterns at the Treeline',
    icon: '🏮',
    narration: 'A miller\'s daughter did not come home. Half the town is out with lanterns, and the line of them is drifting steadily toward the treeline that nobody walks after dark.',
    effect: { type: 'quest_unlock', value: 1, description: 'The search party needs people who can go where it cannot.' },
    duration: 50000,
  },
  {
    id: 'the_well_has_turned',
    name: 'The Well Has Turned',
    icon: '🪣',
    narration: 'The main well has come up brackish and faintly warm. The town is drinking small beer and insisting this is fine. The apothecary is not insisting anything.',
    effect: { type: 'quest_unlock', value: 1, description: 'Work posted to find what is fouling the water.' },
    duration: 60000,
  },
  {
    id: 'bard_in_residence',
    name: 'A Bard Worth Hearing',
    icon: '🎻',
    narration: 'Somebody genuinely good has the taproom tonight — the kind that gets remembered and repeated. The party picks up three verses about themselves, only half of which are wrong.',
    effect: { type: 'xp_bonus', value: 15, description: '+15 XP, and a reputation with some new details in it.' },
    duration: 35000,
  },
  {
    id: 'veterans_return',
    name: 'The Border Company Returns',
    icon: '🎖️',
    narration: 'A company back from the border is drinking through its pay in one sitting. They talk shop until closing, and they talk it well — formations, ground, when to run.',
    effect: { type: 'xp_bonus', value: 22, description: '+22 XP from a night of hard-won tactics.' },
    duration: 40000,
  },
  {
    id: 'stock_drive',
    name: 'Stock Drive Through Town',
    icon: '🐄',
    narration: 'Four hundred head of cattle are coming up the main street and every gate in town needs a body standing in front of it. The drovers pay in coin, on the spot, and do not haggle.',
    effect: { type: 'gold_bonus', value: 30, description: '+30 gp for a day of standing in gateways.' },
    duration: 40000,
  },
  {
    id: 'foundation_stair',
    name: 'The Foundation Stair',
    icon: '⛏️',
    narration: 'Work on a cellar wall broke through into a stair and a sealed door that no plan of this town admits to. The digging has stopped. The arguing has not.',
    effect: { type: 'quest_unlock', value: 2, description: 'Contracts posted for whoever will open the door.' },
    duration: 70000,
  },
];

// ── Archetype Definitions ─────────────────────────────────────────────────

function svc(id: TownServiceId): TownService {
  return { id, ...SERVICES[id] };
}

export const TOWN_ARCHETYPES: Record<TownArchetypeId, TownArchetype> = {
  port_town: {
    id: 'port_town',
    name: 'Port Town',
    flavor: 'Salt air, creaking masts, and the cries of gulls. Ships from distant lands dock here, bringing exotic goods and stranger rumors.',
    bonusDescription: 'a bustling port where foreign ships unload exotic cargo',
    priceModifier: 1.1,
    buildings: [
      {
        id: 'tavern', name: 'The Salty Dog', icon: '🍺',
        description: 'A rowdy waterfront tavern where sailors and adventurers trade stories over rum.',
        services: [svc('rest'), svc('tavern_rumors'), svc('bounty_board'), svc('tavern_gamble')],
        hasShop: true, shopPool: 'general',
      },
      {
        id: 'dock', name: 'The Docks', icon: '⚓',
        description: 'The harbor district. Merchants sell goods fresh off the ships, and captains look for crew.',
        services: [svc('guild_registration')],
        hasShop: true, shopPool: 'gems',
      },
      {
        id: 'temple', name: 'Temple of the Tides', icon: '✨',
        description: 'A seaside temple dedicated to the sea gods. Prayers are offered for safe voyages.',
        services: [svc('heal'), svc('temple_blessing'), svc('temple_donate'), svc('remove_curse')],
        hasShop: false,
      },
      {
        id: 'blacksmith', name: 'Harbor Forge', icon: '🔨',
        description: 'A smithy that specializes in ship anchors and boarding weapons.',
        services: [svc('blacksmith_upgrade'), svc('silver_forge'), svc('craft')],
        hasShop: true, shopPool: 'weapons',
      },
    ],
  },
  mining_settlement: {
    id: 'mining_settlement',
    name: 'Mining Settlement',
    flavor: 'The earth groans with the rhythm of pickaxes. Deep shafts honeycomb the hills beneath, and the wealth of the mountain flows through a single chokepoint.',
    bonusDescription: 'a gritty mining town built around a network of deep shafts',
    priceModifier: 0.9,
    buildings: [
      {
        id: 'tavern', name: 'The Dusty Pick', icon: '🍺',
        description: 'A dim, warm tavern where miners wash away the grime of the deep.',
        services: [svc('rest'), svc('tavern_rumors')],
        hasShop: true, shopPool: 'general',
      },
      {
        id: 'mine', name: 'The Deep Shafts', icon: '⛏️',
        description: 'The mine entrance. Adventurers are sometimes hired to clear monsters from abandoned tunnels.',
        services: [svc('bounty_board')],
        hasShop: true, shopPool: 'gems',
      },
      {
        id: 'forge', name: 'Mountain Forge', icon: '🔥',
        description: 'A legendary forge fed by volcanic vents. Weapons made here are exceptionally hard.',
        services: [svc('blacksmith_upgrade'), svc('silver_forge'), svc('enchant'), svc('craft')],
        hasShop: true, shopPool: 'weapons',
      },
      {
        id: 'temple', name: "Shrine of Earth's Heart", icon: '✨',
        description: 'A dwarven shrine carved into living rock. The priests bless miners before each descent.',
        services: [svc('heal'), svc('temple_blessing'), svc('temple_donate'), svc('remove_curse')],
        hasShop: false,
      },
    ],
  },
  wizard_college: {
    id: 'wizard_college',
    name: 'Wizard College',
    flavor: 'Towers of twisted stone and glowing runes. The air crackles with arcane residue, and every alley hides a scholar chasing forbidden knowledge.',
    bonusDescription: 'a center of arcane learning where towers twist toward the sky',
    priceModifier: 1.3,
    buildings: [
      {
        id: 'tower', name: 'The Grand Spire', icon: '🗼',
        description: 'The main tower of the college. Arcane research happens on every floor.',
        services: [svc('train_magic'), svc('identify'), svc('enchant')],
        hasShop: true, shopPool: 'magic',
      },
      {
        id: 'library', name: 'The Forbidden Library', icon: '📚',
        description: 'A vast library of spellbooks and scrolls. Some tomes are chained to the shelves.',
        services: [svc('train_magic'), svc('craft')],
        hasShop: true, shopPool: 'magic',
      },
      {
        id: 'tavern', name: 'The Spellbound Flask', icon: '🍺',
        description: 'An enchanted tavern where drinks change color and the barkeep is a mage.',
        services: [svc('rest'), svc('tavern_rumors')],
        hasShop: true, shopPool: 'potions',
      },
      {
        id: 'clinic', name: 'Arcane Infirmary', icon: '💚',
        description: 'Mage-healers treat wounds with a mix of magic and medicine.',
        services: [svc('heal'), svc('temple_blessing'), svc('temple_donate'), svc('remove_curse')],
        hasShop: false,
      },
    ],
  },
  frontier_outpost: {
    id: 'frontier_outpost',
    name: 'Frontier Outpost',
    flavor: 'A hard town on the edge of nowhere. Walls of sharpened timber, a garrison of weary soldiers, and the constant smell of woodsmoke and danger.',
    bonusDescription: 'a grim frontier outpost on the edge of the wilds',
    priceModifier: 1.0,
    buildings: [
      {
        id: 'tavern', name: 'The Last Hearth', icon: '🍺',
        description: 'The only tavern for fifty miles. Its walls are covered in monster trophies.',
        services: [svc('rest'), svc('tavern_rumors'), svc('bounty_board'), svc('tavern_gamble')],
        hasShop: true, shopPool: 'general',
      },
      {
        id: 'garrison', name: 'The Garrison', icon: '🏰',
        description: 'The town guard HQ. The captain hires adventurers for dangerous patrols.',
        services: [svc('bounty_board'), svc('guild_registration'), svc('hire_guard')],
        hasShop: true, shopPool: 'armor',
      },
      {
        id: 'blacksmith', name: 'Frontier Forge', icon: '🔨',
        description: 'A no-nonsense smith who makes weapons built to last.',
        services: [svc('blacksmith_upgrade'), svc('silver_forge'), svc('craft')],
        hasShop: true, shopPool: 'weapons',
      },
      {
        id: 'temple', name: 'Waystone Shrine', icon: '✨',
        description: 'A simple stone shrine at the town\'s edge. Travelers pray for safe passage.',
        services: [svc('heal'), svc('temple_blessing'), svc('temple_donate'), svc('remove_curse')],
        hasShop: false,
      },
    ],
  },
  holy_city: {
    id: 'holy_city',
    name: 'Holy City',
    flavor: 'Golden domes and prayer bells. The faithful stream through marble halls, and the temple\'s shadow covers the entire town.',
    bonusDescription: 'a gleaming holy city centered around a great temple',
    priceModifier: 0.85,
    buildings: [
      {
        id: 'temple', name: 'The Grand Cathedral', icon: '⛪',
        description: 'The mightiest temple in the region. The high priests offer blessings and healing to all.',
        services: [svc('heal'), svc('temple_blessing'), svc('rest')],
        hasShop: false,
      },
      {
        id: 'scriptorium', name: 'The Scriptorium', icon: '📜',
        description: 'Monks copy holy texts and prepare scrolls of divine magic.',
        services: [svc('train_magic'), svc('craft')],
        hasShop: true, shopPool: 'magic',
      },
      {
        id: 'tavern', name: 'The Pilgrim\'s Rest', icon: '🍺',
        description: 'A humble inn for travelers and penitents. The soup is free; the bed is simple.',
        services: [svc('rest'), svc('tavern_rumors')],
        hasShop: true, shopPool: 'potions',
      },
      {
        id: 'market', name: 'The Relic Market', icon: '🏛️',
        description: 'A market selling holy relics, prayer beads, and blessed items.',
        services: [svc('identify'), svc('enchant')],
        hasShop: true, shopPool: 'rare',
      },
    ],
  },
  trade_hub: {
    id: 'trade_hub',
    name: 'Trade Hub',
    flavor: 'Where the roads meet and the coin flows. Every race, every guild, every faction has a representative here — and everyone is buying and selling.',
    bonusDescription: 'a cosmopolitan trade hub where every faction has a representative',
    priceModifier: 1.0,
    buildings: [
      {
        id: 'market', name: 'The Grand Market', icon: '🏪',
        description: 'A sprawling market with dozens of stalls. If it exists, you can buy it here.',
        services: [svc('guild_registration')],
        hasShop: true, shopPool: 'general',
      },
      {
        id: 'tavern', name: 'The Crossed Swords', icon: '🍺',
        description: 'The most famous tavern in the region. Every adventurer passes through eventually.',
        services: [svc('rest'), svc('tavern_rumors'), svc('bounty_board'), svc('tavern_gamble')],
        hasShop: true, shopPool: 'general',
      },
      {
        id: 'guildhall', name: 'Adventurers\' Guildhall', icon: '⚔️',
        description: 'The regional guild headquarters. Contracts, training, and camaraderie.',
        services: [svc('train_combat'), svc('guild_registration'), svc('bounty_board'), svc('hire_guard')],
        hasShop: true, shopPool: 'armor',
      },
      {
        id: 'blacksmith', name: 'The Golden Anvil', icon: '🔨',
        description: 'A prestigious smith known for masterwork weapons.',
        services: [svc('blacksmith_upgrade'), svc('silver_forge'), svc('enchant'), svc('craft')],
        hasShop: true, shopPool: 'weapons',
      },
    ],
  },
  farming_village: {
    id: 'farming_village',
    name: 'Farming Village',
    flavor: 'Fields of gold stretch in every direction. The folk here are honest and hardworking — and they could use help with the things that lurk in the furrows at night.',
    bonusDescription: 'a peaceful farming village surrounded by golden fields',
    priceModifier: 0.75,
    buildings: [
      {
        id: 'tavern', name: 'The Harvest Inn', icon: '🍺',
        description: 'A cozy inn with a roaring hearth. Home-cooked meals and honest prices.',
        services: [svc('rest'), svc('tavern_rumors')],
        hasShop: true, shopPool: 'general',
      },
      {
        id: 'temple', name: 'Village Chapel', icon: '⛪',
        description: 'A small stone chapel. The priest blesses the crops and heals the sick.',
        services: [svc('heal'), svc('temple_blessing'), svc('temple_donate'), svc('remove_curse')],
        hasShop: false,
      },
      {
        id: 'blacksmith', name: 'Village Forge', icon: '🔨',
        description: 'A simple forge that makes plowshares and pitchforks — and the occasional sword.',
        services: [svc('blacksmith_upgrade'), svc('silver_forge')],
        hasShop: true, shopPool: 'weapons',
      },
      {
        id: 'well', name: 'The Old Well', icon: '🪣',
        description: 'An ancient well at the village center. Locals say it was blessed by a dragon.',
        services: [svc('rest')],
        hasShop: false,
      },
    ],
  },
  noble_seat: {
    id: 'noble_seat',
    name: 'Noble Seat',
    flavor: 'A castle looms over the town, banners snapping in the wind. The noble houses vie for power, and their politics spill into every tavern.',
    bonusDescription: 'a noble seat dominated by a castle and warring noble houses',
    priceModifier: 1.2,
    buildings: [
      {
        id: 'castle', name: 'The Castle', icon: '🏰',
        description: 'The lord\'s castle. Petitions, audiences, and noble intrigue happen within.',
        services: [svc('bounty_board'), svc('guild_registration')],
        hasShop: true, shopPool: 'rare',
      },
      {
        id: 'tavern', name: 'The Velvet Flask', icon: '🍺',
        description: 'An upscale tavern where nobles and adventurers share uncomfortable space.',
        services: [svc('rest'), svc('tavern_rumors')],
        hasShop: true, shopPool: 'magic',
      },
      {
        id: 'academy', name: 'The Sword Academy', icon: '⚔️',
        description: 'A prestigious martial academy. Training here costs more but teaches more.',
        services: [svc('train_combat'), svc('blacksmith_upgrade'), svc('silver_forge')],
        hasShop: true, shopPool: 'weapons',
      },
      {
        id: 'temple', name: 'Noble Chapel', icon: '✨',
        description: 'The private chapel of the noble houses, open to distinguished visitors.',
        services: [svc('heal'), svc('temple_blessing'), svc('enchant')],
        hasShop: false,
      },
    ],
  },
  forest_hold: {
    id: 'forest_hold',
    name: 'Forest Hold',
    flavor: 'Built into and around ancient trees, this hold blends with the forest. Elven and halfling residents live in harmony with the woodlands.',
    bonusDescription: 'an elven hold woven into the canopy of ancient trees',
    priceModifier: 0.95,
    buildings: [
      {
        id: 'tavern', name: 'The Mossy Branch', icon: '🍺',
        description: 'A tavern built in the hollow of a massive oak. Drinks are herbal, beds are hammocks.',
        services: [svc('rest'), svc('tavern_rumors')],
        hasShop: true, shopPool: 'potions',
      },
      {
        id: 'grove', name: 'The Sacred Grove', icon: '🌳',
        description: 'An ancient grove where druids commune with the spirits of the forest.',
        services: [svc('heal'), svc('temple_blessing'), svc('train_magic')],
        hasShop: false,
      },
      {
        id: 'archer', name: 'Ranger\'s Lodge', icon: '🏹',
        description: 'Where the forest rangers train and sell their craft.',
        services: [svc('train_combat'), svc('guild_registration'), svc('hire_guard')],
        hasShop: true, shopPool: 'weapons',
      },
      {
        id: 'apothecary', name: 'Root & Branch Apothecary', icon: '🌿',
        description: 'An apothecary selling potions brewed from rare forest herbs.',
        services: [svc('craft'), svc('identify')],
        hasShop: true, shopPool: 'potions',
      },
    ],
  },
  desert_oasis: {
    id: 'desert_oasis',
    name: 'Desert Oasis',
    flavor: 'Palm trees shade a turquoise pool in an endless sea of sand. Caravans rest here, and the night sky blazes with more stars than you can count.',
    bonusDescription: 'a desert oasis where palm trees shade a turquoise pool',
    priceModifier: 1.15,
    buildings: [
      {
        id: 'tavern', name: 'The Mirage', icon: '🍺',
        description: 'A tavern built around the oasis pool. Cool drinks and warm sand underfoot.',
        services: [svc('rest'), svc('tavern_rumors')],
        hasShop: true, shopPool: 'general',
      },
      {
        id: 'temple', name: 'Sun Temple', icon: '☀️',
        description: 'A temple dedicated to the sun gods. Its dome glitters with gold leaf.',
        services: [svc('heal'), svc('temple_blessing'), svc('temple_donate'), svc('remove_curse')],
        hasShop: false,
      },
      {
        id: 'caravansary', name: 'The Caravansary', icon: '🐪',
        description: 'A walled compound where merchants shelter and trade goods from across the desert.',
        services: [svc('guild_registration'), svc('bounty_board')],
        hasShop: true, shopPool: 'gems',
      },
      {
        id: 'oasis_forge', name: 'Sandstone Forge', icon: '🔨',
        description: 'A forge that uses desert glass and rare minerals to make exceptional blades.',
        services: [svc('blacksmith_upgrade'), svc('silver_forge'), svc('enchant')],
        hasShop: true, shopPool: 'weapons',
      },
    ],
  },
};

// ── Helper Functions ──────────────────────────────────────────────────────

const ARCHETYPE_IDS: TownArchetypeId[] = Object.keys(TOWN_ARCHETYPES) as TownArchetypeId[];

/**
 * Pick an archetype for a town based on its seeded ID.
 */
export function archetypeForTown(townId: string, biomeHint?: string): TownArchetype {
  // If we have a biome hint, try to match it
  if (biomeHint) {
    const match = ARCHETYPE_IDS.find(a => a.includes(biomeHint));
    if (match) return TOWN_ARCHETYPES[match];
  }
  // Seeded selection
  let seed = 0;
  for (let i = 0; i < townId.length; i++) seed = ((seed << 5) - seed + townId.charCodeAt(i)) | 0;
  const idx = Math.abs(seed) % ARCHETYPE_IDS.length;
  return TOWN_ARCHETYPES[ARCHETYPE_IDS[idx]];
}

/**
 * Get a random town event (or null if no event fires).
 * Chance is ~20% per visit.
 */
export function rollTownEvent(): TownEvent | null {
  if (Math.random() > 0.20) return null;
  return TOWN_EVENTS[Math.floor(Math.random() * TOWN_EVENTS.length)];
}

/**
 * Apply a service effect. Returns a message string.
 * The caller is responsible for deducting gold and applying HP/XP changes.
 */
export function describeServiceEffect(serviceId: TownServiceId): string {
  return SERVICES[serviceId]?.effect ?? 'Nothing happens.';
}

// ── Reputation Shop ───────────────────────────────────────────────────────

export interface ReputationShopItem {
  name: string;
  type: 'potion' | 'scroll' | 'weapon' | 'armor' | 'ring' | 'wondrous';
  value: number;
  description: string;
  /** Minimum reputation required to see this item. */
  repRequired: number;
  /** Power value for combat items. */
  power?: number;
}

export const REPUTATION_SHOP: ReputationShopItem[] = [
  { name: 'Potion of Fortitude', type: 'potion', value: 30, description: 'Grants +2 CON for 1 battle.', repRequired: 10, power: 5 },
  { name: 'Scroll of Shield', type: 'scroll', value: 45, description: 'Grants +4 AC for 3 rounds.', repRequired: 10, power: 4 },
  { name: 'Silver Dagger +1', type: 'weapon', value: 120, description: 'Enchanted silver blade. Effective vs undead and fey.', repRequired: 25, power: 6 },
  { name: 'Ring of Protection +1', type: 'ring', value: 200, description: 'Grants +1 AC and +1 to all saves.', repRequired: 25, power: 2 },
  { name: 'Potion of Greater Healing', type: 'potion', value: 50, description: 'Restores 60 HP.', repRequired: 25, power: 60 },
  { name: 'Scroll of Counterspell', type: 'scroll', value: 150, description: 'Counters an enemy spell (auto-success vs level 3 and below).', repRequired: 50, power: 20 },
  { name: 'Mithril Chain Shirt', type: 'armor', value: 300, description: 'Lightweight heavy armor. AC 16, no stealth disadvantage.', repRequired: 50, power: 16 },
  { name: 'Potion of Speed', type: 'potion', value: 300, description: 'Grants haste for one battle (extra attack, +2 AC, double speed).', repRequired: 50, power: 50 },
  { name: 'Flame Tongue Scimitar', type: 'weapon', value: 500, description: 'A scimitar wreathed in fire. 1d6+2d6 fire damage.', repRequired: 75, power: 18 },
  { name: 'Cloak of Displacement', type: 'wondrous', value: 400, description: 'Attackers have disadvantage on attacks against you.', repRequired: 75, power: 10 },
  { name: 'Scroll of Resurrection', type: 'scroll', value: 600, description: 'Brings a fallen party member back from the dead with full HP.', repRequired: 100, power: 100 },
  { name: 'Vorpal Sword', type: 'weapon', value: 800, description: 'On a natural 20, deals triple damage. The legendary blade.', repRequired: 100, power: 25 },
];

/** Get reputation tier label and color for display. */
export function getReputationShopTier(rep: number): { label: string; color: string; unlockNext: number | null } {
  if (rep >= 100) return { label: 'Legendary', color: '#ffd700', unlockNext: null };
  if (rep >= 75) return { label: 'Revered', color: '#ff6b6b', unlockNext: 100 };
  if (rep >= 50) return { label: 'Honored', color: '#a855f7', unlockNext: 75 };
  if (rep >= 25) return { label: 'Friendly', color: '#3b82f6', unlockNext: 50 };
  if (rep >= 10) return { label: 'Neutral', color: '#22c55e', unlockNext: 25 };
  return { label: 'Stranger', color: '#6b7280', unlockNext: 10 };
}

/**
 * The price discount a town's standing earns, as a whole percentage. This is
 * the same curve `townPriceModifier` applies (rep/400, capped at 25%); the
 * panel prints it, so the two must agree or the shop calls the notice a liar.
 */
export function reputationDiscountPercent(rep: number): number {
  // Rounded the way the till rounds — the modifier to two decimals — so a
  // 2.5% standing reads as the 2% it actually saves, not a rounded-up 3%.
  const modifier = Math.round((1 - Math.min(0.25, Math.max(0, rep) / 400)) * 100) / 100;
  return Math.round((1 - modifier) * 100);
}

/**
 * What a reputation level actually buys, in words the panel shows. Only the
 * two things the game really does: the market discount, and the shelves the
 * reputation shop opens. An older list promised free healing, quest bonuses
 * and blessings no code granted.
 */
export function getReputationPerks(rep: number): string[] {
  const perks: string[] = [];
  const pct = reputationDiscountPercent(rep);
  if (pct > 0) perks.push(`${pct}% off every purchase${pct >= 25 ? ' (the most a town will give)' : ''}`);
  const unlocked = REPUTATION_SHOP.filter(i => i.repRequired <= rep).length;
  if (unlocked > 0) perks.push(`${unlocked} of ${REPUTATION_SHOP.length} reputation wares on the shelves`);
  return perks;
}

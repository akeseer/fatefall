import { GameCharacter, InventoryItem, Personality } from '../entities/Character';
import { CLASSES, RACES, Ability } from '../data/gameData';
import { SPELLS } from '../data/gameData';
import { SUBCLASSES, DEITIES, BACKGROUNDS, ALIGNMENTS } from '../ai/DnDGrimoire';

/** Class-appropriate starting gear, equipped on creation. */
export const STARTER_GEAR: Record<string, Omit<InventoryItem, 'id'>[]> = {
  fighter: [
    { name: 'Longsword', type: 'weapon', description: 'A sturdy blade. 1d8 slashing.', value: 15, power: 8, identified: true },
    { name: 'Chain Mail', type: 'armor', description: 'Heavy armor. AC 16.', value: 75, power: 16, identified: true },
    { name: 'Shield', type: 'armor', description: 'Adds +2 AC while equipped.', value: 10, power: 2, identified: true },
  ],
  paladin: [
    { name: 'Longsword', type: 'weapon', description: 'A blade sworn to an oath. 1d8 slashing.', value: 15, power: 8, identified: true },
    { name: 'Chain Mail', type: 'armor', description: 'Heavy armor. AC 16.', value: 75, power: 16, identified: true },
  ],
  barbarian: [
    { name: 'Greataxe', type: 'weapon', description: 'A two-handed axe. 1d12 slashing.', value: 30, power: 12, identified: true },
    { name: 'Hide Armor', type: 'armor', description: 'Cured hides. AC 12 + DEX.', value: 10, power: 12, identified: true },
  ],
  ranger: [
    { name: 'Shortbow', type: 'weapon', description: 'Ranged weapon. 1d6 piercing.', value: 25, power: 6, identified: true },
    { name: 'Leather Armor', type: 'armor', description: 'Light armor. AC 11 + DEX.', value: 10, power: 11, identified: true },
  ],
  rogue: [
    { name: 'Shortsword', type: 'weapon', description: 'A quick blade. 1d6 piercing.', value: 10, power: 6, identified: true },
    { name: 'Leather Armor', type: 'armor', description: 'Light armor. AC 11 + DEX.', value: 10, power: 11, identified: true },
  ],
  cleric: [
    { name: 'Mace', type: 'weapon', description: 'A blunt instrument of faith. 1d6 bludgeoning.', value: 5, power: 6, identified: true },
    { name: 'Scale Mail', type: 'armor', description: 'Medium armor. AC 14.', value: 50, power: 14, identified: true },
    { name: 'Shield', type: 'armor', description: 'Adds +2 AC while equipped.', value: 10, power: 2, identified: true },
  ],
  druid: [
    { name: 'Wooden Staff', type: 'weapon', description: 'A gnarled focus of the wild. 1d6 bludgeoning.', value: 5, power: 6, identified: true },
    { name: 'Leather Armor', type: 'armor', description: 'Light armor. AC 11 + DEX.', value: 10, power: 11, identified: true },
  ],
  wizard: [
    { name: 'Dagger', type: 'weapon', description: 'A small blade for emergencies. 1d4 piercing.', value: 2, power: 4, identified: true },
    { name: 'Robes', type: 'armor', description: 'Arcane vestments, more symbolic than protective.', value: 5, power: 10, identified: true },
  ],
  sorcerer: [
    { name: 'Dagger', type: 'weapon', description: 'A small blade for emergencies. 1d4 piercing.', value: 2, power: 4, identified: true },
  ],
  warlock: [
    { name: 'Dagger', type: 'weapon', description: 'A patron-blessed blade. 1d4 piercing.', value: 2, power: 4, identified: true },
    { name: 'Leather Armor', type: 'armor', description: 'Light armor. AC 11 + DEX.', value: 10, power: 11, identified: true },
  ],
  bard: [
    { name: 'Rapier', type: 'weapon', description: 'An elegant blade. 1d8 piercing.', value: 25, power: 8, identified: true },
    { name: 'Leather Armor', type: 'armor', description: 'Light armor. AC 11 + DEX.', value: 10, power: 11, identified: true },
  ],
  monk: [
    { name: 'Quarterstaff', type: 'weapon', description: 'A simple staff. 1d6 bludgeoning.', value: 2, power: 6, identified: true },
  ],
  artificer: [
    { name: 'Light Crossbow', type: 'weapon', description: 'An ingeniously tuned mechanism. 1d8 piercing.', value: 25, power: 8, identified: true },
    { name: 'Studded Leather', type: 'armor', description: 'Reinforced leather of the tinker\u2019s craft. AC 12 + DEX.', value: 45, power: 12, identified: true },
  ],
  blood_hunter: [
    { name: 'Rapier', type: 'weapon', description: 'A slender blade kept close for the rites. 1d8 piercing.', value: 25, power: 8, identified: true },
    { name: 'Leather Armor', type: 'armor', description: 'Light armor. AC 11 + DEX.', value: 10, power: 11, identified: true },
  ],
  _default: [
    { name: 'Shortsword', type: 'weapon', description: 'A quick blade. 1d6 piercing.', value: 10, power: 6, identified: true },
  ],
};

export const FIRST_NAMES = [
  'Thorn', 'Luna', 'Grom', 'Sera', 'Kael', 'Mira', 'Draven', 'Nyx',
  'Aldric', 'Vex', 'Fenris', 'Lyra', 'Orin', 'Thea', 'Zephyr', 'Kira',
  'Borin', 'Cora', 'Eldrin', 'Shade'
];

export const LAST_NAMES = [
  'Ironfoot', 'Shadowmere', 'Stormborn', 'Dragonbane', 'Silverhand',
  'Blackwood', 'Frosthelm', 'Thunderstrike', 'Ashwalker', 'Darkblade',
  'Starweaver', 'Moonshadow', 'Stonefist', 'Hawkwind', 'Brightshield'
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function generateAbilities(): Record<Ability, number> {
  // Standard array: 15, 14, 13, 12, 10, 8
  const base = [15, 14, 13, 12, 10, 8];
  // Shuffle
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  return {
    str: base[0],
    dex: base[1],
    con: base[2],
    int: base[3],
    wis: base[4],
    cha: base[5],
  };
}

function applyRacialBonuses(
  abilities: Record<Ability, number>,
  raceId: string
): Record<Ability, number> {
  const race = RACES.find(r => r.id === raceId);
  if (!race) return abilities;

  const result = { ...abilities };
  for (const [abil, bonus] of Object.entries(race.abilityBonuses)) {
    result[abil as Ability] += bonus;
  }
  return result;
}

function assignSpells(classId: string): string[] {
  const spellIds = SPELLS.map(s => s.id);
  const result: string[] = [];

  switch (classId) {
    case 'wizard':
      // Arcane casters get damage and utility
      result.push('fire_bolt', 'magic_missile', 'shield', 'burning_hands', 'misty_step', 'fireball', 'remove_curse');
      break;
    case 'sorcerer':
      result.push('fire_bolt', 'chill_touch', 'magic_missile', 'chromatic_orb', 'scorching_ray', 'fireball');
      break;
    case 'warlock':
      result.push('eldritch_blast', 'chill_touch', 'shatter', 'vampiric_touch');
      break;
    case 'bard':
      result.push('vicious_mockery', 'healing_word', 'thunderwave', 'shatter', 'hold_person');
      break;
    case 'cleric':
      result.push('sacred_flame', 'cure_wounds', 'bless', 'healing_word', 'spiritual_weapon', 'inflict_wounds', 'remove_curse');
      break;
    case 'druid':
      result.push('guidance', 'cure_wounds', 'healing_word', 'thunderwave', 'call_lightning');
      break;
    case 'paladin':
      result.push('bless', 'cure_wounds', 'inflict_wounds', 'thunderwave');
      break;
    case 'artificer':
      // Tinker-mage: utility and blasting in equal measure.
      result.push('fire_bolt', 'magic_missile', 'shield', 'cure_wounds', 'shatter', 'remove_curse');
      break;
    case 'blood_hunter':
      // Hemocraft rites lean on curses; slots stay for self-sustain.
      result.push('chromatic_orb', 'cure_wounds');
      break;
    case 'ranger':
      result.push('cure_wounds', 'chromatic_orb', 'lightning_bolt');
      break;
  }

  return result.filter(id => spellIds.includes(id));
}

function assignDeity(classId: string): string | undefined {
  const divineClasses = ['cleric', 'paladin', 'druid', 'warlock'];
  if (!divineClasses.includes(classId)) return undefined;

  const preferred: Record<string, string[]> = {
    cleric: ['Lathander', 'Mystra', 'Tempus', 'Kelemvor', 'Tymora', 'Moradin'],
    paladin: ['Bahamut', 'Tyr of the Broken Blade', 'Lathander', 'Tempus'],
    druid: ['Silvanus', 'Selûne'],
    warlock: ['Fiend of the Ninth', 'Great Old One Below', 'Archfey of the Winter Court'],
  };

  const pool = preferred[classId] || DEITIES.map(d => d.name);
  return pick(pool);
}

export function createCharacter(
  classId?: string,
  raceId?: string,
  name?: string,
  personality?: Partial<Personality>
): GameCharacter {
  const charClass = CLASSES.find(c => c.id === classId) || pick(CLASSES);
  const race = RACES.find(r => r.id === raceId) || pick(RACES);
  let abilities = generateAbilities();
  abilities = applyRacialBonuses(abilities, race.id);

  // Ensure primary stat is highest
  if (charClass.primaryAbilities.length > 0) {
    const primary = charClass.primaryAbilities[0];
    const max = Math.max(...Object.values(abilities));
    if (abilities[primary] < max) {
      // Swap with the actual max
      const maxAbility = (Object.entries(abilities) as [Ability, number][]).find(([_, v]) => v === max)![0];
      const temp = abilities[primary];
      abilities[primary] = max;
      abilities[maxAbility] = temp;
    }
  }

  const id = `char_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const character = new GameCharacter(
    id,
    name || generateName(),
    charClass,
    race,
    abilities,
    personality
  );

  character.knownSpells = assignSpells(charClass.id);
  character.subclass = pick(SUBCLASSES[charClass.id] || ['Wanderer (no formal tradition)']);
  character.deity = assignDeity(charClass.id);
  character.background = pick(BACKGROUNDS).name;
  character.alignment = pick(ALIGNMENTS).name;

  // Give starting equipment: class-appropriate gear, already equipped.
  character.addToInventory({
    id: 'ration',
    name: 'Rations',
    type: 'potion',
    description: 'Basic adventuring rations.',
    value: 5,
  });
  const starter = STARTER_GEAR[charClass.id] ?? STARTER_GEAR._default;
  for (const item of starter) {
    character.addToInventory({ ...item, id: `gear_${item.name.toLowerCase().replace(/\W+/g, '_')}_${id.slice(-6)}` });
  }
  // Equip everything the class starts with (weapon, armor, shield as listed).
  // Refusals can't happen — starter gear is class-appropriate — but guard anyway.
  for (const item of [...character.inventory]) {
    if (item.type === 'weapon' || item.type === 'armor') character.equip(item.id);
  }
  character.gold = randInt(5, 25);

  return character;
}

/**
 * A party of `size`. `classIds` are the player's picks in seat order; any
 * seats left over, or any pick that is not a class, are filled with distinct
 * random classes as before. Names, races, faces and everything else are
 * always the generator's.
 */
export function createParty(size: number = 4, classIds: string[] = []): GameCharacter[] {
  const classes = ['fighter', 'cleric', 'wizard', 'rogue', 'paladin', 'ranger', 'druid', 'barbarian', 'bard', 'sorcerer', 'warlock', 'monk', 'artificer', 'blood_hunter'];
  const chosenClasses: string[] = [];
  const party: GameCharacter[] = [];

  for (let i = 0; i < size; i++) {
    // The player's pick for this seat, or a class no other seat has.
    let classId: string;
    const wanted = classIds[i];
    if (wanted && CLASSES.some(c => c.id === wanted)) {
      classId = wanted;
    } else {
      do {
        classId = pick(classes);
      } while ((chosenClasses.includes(classId) || classIds.includes(classId)) && chosenClasses.length + classIds.length < classes.length);
    }
    chosenClasses.push(classId);

    // Varied personalities
    const personalities: Partial<Personality>[] = [
      { aggression: 7, curiosity: 5, caution: 3, loyalty: 6, greed: 4 },
      { aggression: 3, curiosity: 8, caution: 6, loyalty: 7, greed: 3 },
      { aggression: 6, curiosity: 4, caution: 4, loyalty: 8, greed: 5 },
      { aggression: 4, curiosity: 6, caution: 7, loyalty: 5, greed: 6 },
      { aggression: 8, curiosity: 3, caution: 2, loyalty: 6, greed: 7 },
      { aggression: 2, curiosity: 7, caution: 8, loyalty: 7, greed: 2 },
      { aggression: 5, curiosity: 5, caution: 5, loyalty: 5, greed: 5 },
      { aggression: 6, curiosity: 7, caution: 3, loyalty: 4, greed: 8 },
    ];

    const char = createCharacter(classId, undefined, undefined, personalities[i % personalities.length]);
    party.push(char);
  }

  return party;
}

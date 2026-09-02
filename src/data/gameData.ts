/**
 * D&D-inspired character data: classes, races, stats, spells.
 * Pulled from the D&D 5e SRD and classic handbook flavor.
 */

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface CharacterClass {
  id: string;
  name: string;
  description: string;
  hitDie: number; // d8, d10, etc.
  primaryAbilities: Ability[];
  savingThrows: Ability[];
  armorProficiencies: string[];
  weaponProficiencies: string[];
  skillChoices: string[];
  spellsKnown?: Record<number, number>; // level -> spells known
}

export interface Race {
  id: string;
  name: string;
  description: string;
  abilityBonuses: Partial<Record<Ability, number>>;
  speed: number;
  darkvision: number;
  size: 'Medium' | 'Small';
  traits: string[];
}

export interface Spell {
  id: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  duration: string;
  description: string;
  damage?: string;
  healing?: string;
  save?: Ability;
}

// ── Classes ─────────────────────────────────────────

export const CLASSES: CharacterClass[] = [
  {
    id: 'fighter',
    name: 'Fighter',
    description: 'A master of martial combat, skilled with a variety of weapons and armor.',
    hitDie: 10,
    primaryAbilities: ['str', 'con'],
    savingThrows: ['str', 'con'],
    armorProficiencies: ['All armor', 'Shields'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    skillChoices: ['Acrobatics', 'Athletics', 'Intimidation', 'Perception', 'Survival'],
  },
  {
    id: 'wizard',
    name: 'Wizard',
    description: 'A scholarly magic-user capable of manipulating the structures of reality.',
    hitDie: 6,
    primaryAbilities: ['int'],
    savingThrows: ['int', 'wis'],
    armorProficiencies: [],
    weaponProficiencies: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'],
    skillChoices: ['Arcana', 'History', 'Insight', 'Investigation', 'Medicine', 'Religion'],
    spellsKnown: { 1: 6, 2: 8, 3: 10, 4: 12, 5: 14 },
  },
  {
    id: 'cleric',
    name: 'Cleric',
    description: 'A priestly champion who wields divine magic in service of a higher power.',
    hitDie: 8,
    primaryAbilities: ['wis'],
    savingThrows: ['wis', 'cha'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Shields'],
    weaponProficiencies: ['Simple weapons'],
    skillChoices: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'],
    spellsKnown: { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12 },
  },
  {
    id: 'rogue',
    name: 'Rogue',
    description: 'A scoundrel who uses stealth and trickery to overcome obstacles and enemies.',
    hitDie: 8,
    primaryAbilities: ['dex'],
    savingThrows: ['dex', 'int'],
    armorProficiencies: ['Light armor'],
    weaponProficiencies: ['Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords'],
    skillChoices: ['Acrobatics', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Perception', 'Performance', 'Persuasion', 'Sleight of Hand', 'Stealth'],
  },
  {
    id: 'ranger',
    name: 'Ranger',
    description: 'A warrior who uses martial prowess and nature magic to combat threats on the edges of civilization.',
    hitDie: 10,
    primaryAbilities: ['dex', 'wis'],
    savingThrows: ['str', 'dex'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Shields'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    skillChoices: ['Animal Handling', 'Athletics', 'Insight', 'Investigation', 'Nature', 'Perception', 'Stealth', 'Survival'],
  },
  {
    id: 'paladin',
    name: 'Paladin',
    description: 'A holy warrior bound to a sacred oath, blending martial prowess with divine power.',
    hitDie: 10,
    primaryAbilities: ['str', 'cha'],
    savingThrows: ['wis', 'cha'],
    armorProficiencies: ['All armor', 'Shields'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    skillChoices: ['Athletics', 'Insight', 'Intimidation', 'Medicine', 'Persuasion', 'Religion'],
  },
  {
    id: 'barbarian',
    name: 'Barbarian',
    description: 'A fierce warrior of primitive background who can enter a battle rage.',
    hitDie: 12,
    primaryAbilities: ['str', 'con'],
    savingThrows: ['str', 'con'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Shields'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    skillChoices: ['Animal Handling', 'Athletics', 'Intimidation', 'Nature', 'Perception', 'Survival'],
  },
  {
    id: 'druid',
    name: 'Druid',
    description: 'A priest of the Old Faith, wielding the powers of nature and adopting animal forms.',
    hitDie: 8,
    primaryAbilities: ['wis'],
    savingThrows: ['int', 'wis'],
    armorProficiencies: ['Light armor', 'Medium armor', 'Shields (non-metal)'],
    weaponProficiencies: ['Clubs', 'Daggers', 'Darts', 'Javelins', 'Maces', 'Quarterstaffs', 'Scimitars', 'Sickles', 'Slings', 'Spears'],
    skillChoices: ['Arcana', 'Animal Handling', 'Insight', 'Medicine', 'Nature', 'Perception', 'Religion', 'Survival'],
    spellsKnown: { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12 },
  },
  {
    id: 'bard',
    name: 'Bard',
    description: 'An inspiring magician whose power echoes the music of creation, weaving spell and song into one.',
    hitDie: 8,
    primaryAbilities: ['cha'],
    savingThrows: ['dex', 'cha'],
    armorProficiencies: ['Light armor'],
    weaponProficiencies: ['Simple weapons', 'Hand crossbows', 'Longswords', 'Rapiers', 'Shortswords'],
    skillChoices: ['Any three skills of choice — bards are jacks of all trades'],
    spellsKnown: { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12 },
  },
  {
    id: 'sorcerer',
    name: 'Sorcerer',
    description: 'A spellcaster who draws on inherent magic from a bloodline or supernatural gift, shaping raw power by instinct.',
    hitDie: 6,
    primaryAbilities: ['cha'],
    savingThrows: ['con', 'cha'],
    armorProficiencies: [],
    weaponProficiencies: ['Daggers', 'Darts', 'Slings', 'Quarterstaffs', 'Light crossbows'],
    skillChoices: ['Arcana', 'Deception', 'Insight', 'Intimidation', 'Persuasion', 'Religion'],
    spellsKnown: { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12 },
  },
  {
    id: 'warlock',
    name: 'Warlock',
    description: 'A wielder of magic derived from a bargain with an otherworldly patron — fiend, fey, or something older still.',
    hitDie: 8,
    primaryAbilities: ['cha'],
    savingThrows: ['wis', 'cha'],
    armorProficiencies: ['Light armor'],
    weaponProficiencies: ['Simple weapons'],
    skillChoices: ['Arcana', 'Deception', 'History', 'Intimidation', 'Investigation', 'Nature', 'Religion'],
    spellsKnown: { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10 },
  },
  {
    id: 'monk',
    name: 'Monk',
    description: 'A master of martial arts who channels ki — the body\u2019s inner energy — into preternatural speed and strikes.',
    hitDie: 8,
    primaryAbilities: ['dex', 'wis'],
    savingThrows: ['str', 'dex'],
    armorProficiencies: [],
    weaponProficiencies: ['Simple weapons', 'Shortswords'],
    skillChoices: ['Acrobatics', 'Athletics', 'History', 'Insight', 'Religion', 'Stealth'],
  },
];

// ── Races ────────────────────────────────────────────

export const RACES: Race[] = [
  {
    id: 'human',
    name: 'Human',
    description: 'The most adaptable and ambitious people among the common races.',
    abilityBonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    speed: 30,
    darkvision: 0,
    size: 'Medium',
    traits: ['Versatile: +1 to all ability scores'],
  },
  {
    id: 'elf',
    name: 'Elf',
    description: 'A magical people of otherworldly grace, living in the world but not entirely part of it.',
    abilityBonuses: { dex: 2 },
    speed: 30,
    darkvision: 60,
    size: 'Medium',
    traits: ['Keen Senses', 'Fey Ancestry', 'Trance'],
  },
  {
    id: 'dwarf',
    name: 'Dwarf',
    description: 'Bold and hardy, dwarves are known as skilled warriors, miners, and workers of stone and metal.',
    abilityBonuses: { con: 2 },
    speed: 25,
    darkvision: 60,
    size: 'Medium',
    traits: ['Dwarven Resilience', 'Stonecunning'],
  },
  {
    id: 'halfling',
    name: 'Halfling',
    description: 'The comforts of home are the goals of most halflings\' lives.',
    abilityBonuses: { dex: 2 },
    speed: 25,
    darkvision: 0,
    size: 'Small',
    traits: ['Lucky', 'Brave', 'Halfling Nimbleness'],
  },
  {
    id: 'dragonborn',
    name: 'Dragonborn',
    description: 'Born of dragons, as their name proclaims, dragonborn walk proudly through a world that greets them with fearful incomprehension.',
    abilityBonuses: { str: 2, cha: 1 },
    speed: 30,
    darkvision: 0,
    size: 'Medium',
    traits: ['Draconic Ancestry', 'Breath Weapon'],
  },
  {
    id: 'gnome',
    name: 'Gnome',
    description: 'A gnome\'s energy and enthusiasm for living shines through every inch of their tiny bodies.',
    abilityBonuses: { int: 2 },
    speed: 25,
    darkvision: 60,
    size: 'Small',
    traits: ['Gnome Cunning'],
  },
  {
    id: 'tiefling',
    name: 'Tiefling',
    description: 'To be greeted with stares and whispers, to suffer violence and insult on the street — this is the lot of the tiefling.',
    abilityBonuses: { int: 1, cha: 2 },
    speed: 30,
    darkvision: 60,
    size: 'Medium',
    traits: ['Hellish Resistance', 'Infernal Legacy'],
  },
  {
    id: 'half_orc',
    name: 'Half-Orc',
    description: 'Half-orcs\u2019 grayish pigmentation, sloping foreheads, jutting jaws, prominent teeth, and towering builds make their orcish heritage plain for all to see.',
    abilityBonuses: { str: 2, con: 1 },
    speed: 30,
    darkvision: 60,
    size: 'Medium',
    traits: ['Relentless Endurance', 'Savage Attacks'],
  },
  {
    id: 'half_elf',
    name: 'Half-Elf',
    description: 'Walking in two worlds but truly belonging to neither, half-elves combine what some say are the best qualities of their two bloodlines.',
    abilityBonuses: { cha: 2, dex: 1 },
    speed: 30,
    darkvision: 60,
    size: 'Medium',
    traits: ['Fey Ancestry', 'Skill Versatility', 'Darkvision'],
  },
];

// ── Spells ───────────────────────────────────────────

export const SPELLS: Spell[] = [
  // Cantrips
  { id: 'fire_bolt', name: 'Fire Bolt', level: 0, school: 'Evocation', castingTime: '1 action', range: '120 ft', duration: 'Instantaneous', description: 'You hurl a mote of fire at a creature or object.', damage: '1d10 fire' },
  { id: 'sacred_flame', name: 'Sacred Flame', level: 0, school: 'Evocation', castingTime: '1 action', range: '60 ft', duration: 'Instantaneous', description: 'Flame-like radiance descends on a creature.', damage: '1d8 radiant', save: 'dex' },
  { id: 'eldritch_blast', name: 'Eldritch Blast', level: 0, school: 'Evocation', castingTime: '1 action', range: '120 ft', duration: 'Instantaneous', description: 'A beam of crackling energy streaks toward a creature.', damage: '1d10 force' },
  { id: 'guidance', name: 'Guidance', level: 0, school: 'Divination', castingTime: '1 action', range: 'Touch', duration: '1 min', description: 'You touch a willing creature, blessing it with divine guidance.' },
  // Level 1
  { id: 'magic_missile', name: 'Magic Missile', level: 1, school: 'Evocation', castingTime: '1 action', range: '120 ft', duration: 'Instantaneous', description: 'Three glowing darts of magical force strike unerringly.', damage: '3d4 force' },
  { id: 'cure_wounds', name: 'Cure Wounds', level: 1, school: 'Evocation', castingTime: '1 action', range: 'Touch', duration: 'Instantaneous', description: 'A creature you touch regains hit points.', healing: '1d8 + mod' },
  { id: 'bless', name: 'Bless', level: 1, school: 'Enchantment', castingTime: '1 action', range: '30 ft', duration: '1 min', description: 'You bless up to three creatures, granting +1d4 to attack rolls and saves.' },
  { id: 'shield', name: 'Shield', level: 1, school: 'Abjuration', castingTime: '1 reaction', range: 'Self', duration: '1 round', description: 'An invisible barrier of magical force grants +5 AC.' },
  { id: 'burning_hands', name: 'Burning Hands', level: 1, school: 'Evocation', castingTime: '1 action', range: '15 ft cone', duration: 'Instantaneous', description: 'A thin sheet of flames shoots from your fingertips.', damage: '3d6 fire', save: 'dex' },
  { id: 'healing_word', name: 'Healing Word', level: 1, school: 'Evocation', castingTime: '1 bonus action', range: '60 ft', duration: 'Instantaneous', description: 'A creature you can see regains hit points.', healing: '1d4 + mod' },
  // Level 2
  { id: 'fireball', name: 'Fireball', level: 3, school: 'Evocation', castingTime: '1 action', range: '150 ft', duration: 'Instantaneous', description: 'A bright streak flashes, then blossoms into a roaring explosion.', damage: '8d6 fire', save: 'dex' },
  { id: 'lightning_bolt', name: 'Lightning Bolt', level: 3, school: 'Evocation', castingTime: '1 action', range: '100 ft line', duration: 'Instantaneous', description: 'A stroke of lightning blasts out from you.', damage: '8d6 lightning', save: 'dex' },
  { id: 'spiritual_weapon', name: 'Spiritual Weapon', level: 2, school: 'Evocation', castingTime: '1 bonus action', range: '60 ft', duration: '1 min', description: 'A floating spectral weapon attacks on your behalf.', damage: '1d8 + mod force' },
  { id: 'misty_step', name: 'Misty Step', level: 2, school: 'Conjuration', castingTime: '1 bonus action', range: 'Self', duration: 'Instantaneous', description: 'Briefly surrounded by silvery mist, you teleport up to 30 feet.' },
  { id: 'hold_person', name: 'Hold Person', level: 2, school: 'Enchantment', castingTime: '1 action', range: '60 ft', duration: '1 min', description: 'A humanoid you can see is paralyzed.', save: 'wis' },
  // More cantrips
  { id: 'chill_touch', name: 'Chill Touch', level: 0, school: 'Necromancy', castingTime: '1 action', range: '120 ft', duration: '1 round', description: 'A ghostly skeletal hand grasps a creature, dealing necrotic damage and preventing healing.', damage: '1d8 necrotic' },
  { id: 'vicious_mockery', name: 'Vicious Mockery', level: 0, school: 'Enchantment', castingTime: '1 action', range: '60 ft', duration: 'Instantaneous', description: 'You unleash insults laced with subtle enchantment.', damage: '1d4 psychic', save: 'wis' },
  // Level 1 additions
  { id: 'thunderwave', name: 'Thunderwave', level: 1, school: 'Evocation', castingTime: '1 action', range: '15 ft cube', duration: 'Instantaneous', description: 'A wave of thunderous force sweeps outward, pushing creatures away.', damage: '2d8 thunder', save: 'con' },
  { id: 'chromatic_orb', name: 'Chromatic Orb', level: 1, school: 'Evocation', castingTime: '1 action', range: '90 ft', duration: 'Instantaneous', description: 'You hurl a sphere of energy of your chosen element.', damage: '3d8' },
  { id: 'inflict_wounds', name: 'Inflict Wounds', level: 1, school: 'Necromancy', castingTime: '1 action', range: 'Touch', duration: 'Instantaneous', description: 'Your touch channels negative energy, charring flesh.', damage: '3d10 necrotic' },
  // Level 2 additions
  { id: 'scorching_ray', name: 'Scorching Ray', level: 2, school: 'Evocation', castingTime: '1 action', range: '120 ft', duration: 'Instantaneous', description: 'Three rays of fire streak toward your targets.', damage: '6d6 fire' },
  { id: 'shatter', name: 'Shatter', level: 2, school: 'Evocation', castingTime: '1 action', range: '60 ft', duration: 'Instantaneous', description: 'A sudden loud ringing sound shatters objects and creatures.', damage: '3d8 thunder', save: 'con' },
  { id: 'vampiric_touch', name: 'Vampiric Touch', level: 3, school: 'Necromancy', castingTime: '1 action', range: 'Self (touch)', duration: 'Concentration, 1 min', description: 'Your touch drains life to heal yourself.', damage: '3d6 necrotic' },
  // Level 3-4
  { id: 'call_lightning', name: 'Call Lightning', level: 3, school: 'Conjuration', castingTime: '1 action', range: '120 ft', duration: 'Concentration, 10 min', description: 'A storm cloud births bolts of lightning at your command.', damage: '3d10 lightning', save: 'dex' },
  { id: 'blight_spell', name: 'Blight', level: 4, school: 'Necromancy', castingTime: '1 action', range: '30 ft', duration: 'Instantaneous', description: 'Necromantic energy withers the target.', damage: '8d8 necrotic', save: 'con' },
  { id: 'cone_of_cold_playable', name: 'Cone of Cold', level: 5, school: 'Evocation', castingTime: '1 action', range: '60 ft cone', duration: 'Instantaneous', description: 'A blast of killing cold erupts from your hands.', damage: '8d8 cold', save: 'con' },
  // ── More Cantrips ──
  { id: 'poison_spray', name: 'Poison Spray', level: 0, school: 'Conjuration', castingTime: '1 action', range: '10 ft', duration: 'Instantaneous', description: 'You extend your hand and project a puff of noxious gas.', damage: '1d12 poison', save: 'con' },
  { id: 'ray_of_frost', name: 'Ray of Frost', level: 0, school: 'Evocation', castingTime: '1 action', range: '60 ft', duration: '1 round', description: 'A frigid beam of blue-white light streaks toward a creature.', damage: '1d8 cold' },
  { id: 'prestidigitation', name: 'Prestidigitation', level: 0, school: 'Transmutation', castingTime: '1 action', range: '10 ft', duration: 'Up to 1 hour', description: 'You create a minor magical sensory effect: a shower of sparks, a puff of wind, or faint musical notes.' },
  { id: 'minor_illusion', name: 'Minor Illusion', level: 0, school: 'Illusion', castingTime: '1 action', range: '30 ft', duration: '1 min', description: 'You create a sound or image of an object no larger than a 5-foot cube.' },
  { id: 'dancing_lights', name: 'Dancing Lights', level: 0, school: 'Evocation', castingTime: '1 action', range: '120 ft', duration: '1 min', description: 'Up to four torch-sized lights float and drift within range.' },
  { id: 'resistance_cantrip', name: 'Resistance', level: 0, school: 'Abjuration', castingTime: '1 action', range: 'Touch', duration: '1 min', description: 'You touch a willing creature and grant it resistance to one type of damage.' },
  { id: 'spare_the_dying', name: 'Spare the Dying', level: 0, school: 'Necromancy', castingTime: '1 action', range: 'Touch', duration: 'Instantaneous', description: 'You touch a living creature that has 0 hit points. It stabilizes.' },
  { id: 'thorn_whip', name: 'Thorn Whip', level: 0, school: 'Transmutation', castingTime: '1 action', range: '30 ft', duration: 'Instantaneous', description: 'You create a vine-like whip that thorns lash at a creature.', damage: '1d6 piercing' },
  { id: 'produce_flame', name: 'Produce Flame', level: 0, school: 'Conjuration', castingTime: '1 action', range: 'Self', duration: '1 min', description: 'A flickering flame appears in your hand, shedding light. You can hurl it.', damage: '1d8 fire' },
  { id: 'shillelagh', name: 'Shillelagh', level: 0, school: 'Transmutation', castingTime: '1 bonus action', range: 'Touch', duration: '1 min', description: 'The wood of a club or quarterstaff glows with primal energy.' },
  { id: 'true_strike', name: 'True Strike', level: 0, school: 'Divination', castingTime: '1 action', range: '30 ft', duration: '1 round', description: 'You gain insight into the defenses of a target, gaining advantage on your first attack against it.' },
  { id: 'word_of_radiance', name: 'Word of Radiance', level: 0, school: 'Evocation', castingTime: '1 action', range: '5 ft', duration: 'Instantaneous', description: 'Burning radiance gleams in your eyes, searing nearby foes.', damage: '1d6 radiant', save: 'con' },
  // ── Level 1 additions ──
  { id: 'shield_of_faith', name: 'Shield of Faith', level: 1, school: 'Abjuration', castingTime: '1 bonus action', range: '60 ft', duration: '10 min', description: 'A shimmering field appears around a creature, granting +2 AC.' },
  { id: 'faerie_fire', name: 'Faerie Fire', level: 1, school: 'Evocation', castingTime: '1 action', range: '60 ft', duration: '1 min', description: 'Objects and creatures outline in faint light, granting advantage on attacks against them.', save: 'dex' },
  { id: 'armor_of_agathys', name: 'Armor of Agathys', level: 1, school: 'Abjuration', castingTime: '1 action', range: 'Self', duration: '1 hour', description: 'A protective magical force surrounds you, granting 5 temp HP and dealing 5 cold damage to attackers.', damage: '5 cold' },
  { id: 'hex', name: 'Hex', level: 1, school: 'Enchantment', castingTime: '1 bonus action', range: '90 ft', duration: '1 hour', description: 'You curse a creature, dealing extra 1d6 necrotic damage on each hit.', damage: '1d6 necrotic' },
  { id: 'entangle', name: 'Entangle', level: 1, school: 'Conjuration', castingTime: '1 action', range: '90 ft', duration: '1 min', description: 'Grasping weeds and vines sprout in a 20-foot square, restraining creatures.', save: 'str' },
  { id: 'sanctuary', name: 'Sanctuary', level: 1, school: 'Abjuration', castingTime: '1 bonus action', range: '30 ft', duration: '1 min', description: 'A creature warded by sanctuary must be attacked with a wisdom save before being targeted.' },
  // ── Level 2 additions ──
  { id: 'moonbeam', name: 'Moonbeam', level: 2, school: 'Evocation', castingTime: '1 action', range: '120 ft', duration: '1 min', description: 'A silvery beam of pale light shines down in a 5-foot radius cylinder.', damage: '2d10 radiant', save: 'con' },
  { id: 'invisibility', name: 'Invisibility', level: 2, school: 'Illusion', castingTime: '1 action', range: 'Touch', duration: '1 hour', description: 'A creature you touch becomes invisible until the spell ends or it attacks.' },
  { id: 'mirror_image', name: 'Mirror Image', level: 2, school: 'Illusion', castingTime: '1 action', range: 'Self', duration: '1 min', description: 'Three illusory duplicates of yourself appear, making it harder for enemies to hit you.' },
  { id: 'web', name: 'Web', level: 2, school: 'Conjuration', castingTime: '1 action', range: '60 ft', duration: '1 min', description: 'Thick, sticky strands of webbing fill a 20-foot cube, restraining creatures.', save: 'dex' },
  { id: 'aid', name: 'Aid', level: 2, school: 'Abjuration', castingTime: '1 action', range: '30 ft', duration: '8 hours', description: 'Three creatures gain 5 temporary hit points each and their max HP increases by 5.' },
  { id: 'darkness', name: 'Darkness', level: 2, school: 'Evocation', castingTime: '1 action', range: '60 ft', duration: '10 min', description: 'Magical darkness spreads from a point, filling a 15-foot sphere.' },
  // ── Level 3 additions ──
  { id: 'counterspell', name: 'Counterspell', level: 3, school: 'Abjuration', castingTime: '1 reaction', range: '60 ft', duration: 'Instantaneous', description: 'You attempt to interrupt a creature casting a spell, negating it on a successful check.' },
  { id: 'haste', name: 'Haste', level: 3, school: 'Transmutation', castingTime: '1 action', range: '30 ft', duration: '1 min', description: 'A willing creature gains doubled speed, +2 AC, an extra action, and advantage on Dexterity saves.' },
  { id: 'slow', name: 'Slow', level: 3, school: 'Transmutation', castingTime: '1 action', range: '120 ft', duration: '1 min', description: 'You alter time around up to six creatures, halving their speed and limiting their actions.', save: 'wis' },
  { id: 'hypnotic_pattern', name: 'Hypnotic Pattern', level: 3, school: 'Illusion', castingTime: '1 action', range: '120 ft', duration: '1 min', description: 'A shimmering pattern of colors fascinates creatures, stunning them.', save: 'wis' },
  { id: 'stinking_cloud', name: 'Stinking Cloud', level: 3, school: 'Conjuration', castingTime: '1 action', range: '90 ft', duration: '1 min', description: 'A nauseating cloud of yellow-green gas fills a 20-foot sphere.', save: 'con' },
  { id: 'spirit_guardians', name: 'Spirit Guardians', level: 3, school: 'Conjuration', castingTime: '1 action', range: 'Self', duration: '10 min', description: 'Spirits swarm around you, damaging enemies that start their turn within 15 feet.', damage: '3d8 necrotic', save: 'wis' },
  { id: 'fly', name: 'Fly', level: 3, school: 'Transmutation', castingTime: '1 action', range: 'Touch', duration: '10 min', description: 'A willing creature gains a flying speed of 60 feet.' },
  { id: 'bestow_curse', name: 'Bestow Curse', level: 3, school: 'Necromancy', castingTime: '1 action', range: 'Touch', duration: '1 min', description: 'You touch a creature and subject it to a dark curse.', save: 'wis' },
  // ── Level 4 additions ──
  { id: 'greater_invisibility', name: 'Greater Invisibility', level: 4, school: 'Illusion', castingTime: '1 action', range: 'Touch', duration: '1 min', description: 'A creature you touch becomes invisible even while attacking or casting spells.' },
  { id: 'fire_shield', name: 'Fire Shield', level: 4, school: 'Evocation', castingTime: '1 action', range: 'Self', duration: '10 min', description: 'Wisps of flame wreath your body, granting fire resistance and dealing 2d8 fire damage to melee attackers.' },
  { id: 'banishment', name: 'Banishment', level: 4, school: 'Abjuration', castingTime: '1 action', range: '60 ft', duration: '1 min', description: 'You attempt to send a creature to another plane of existence.', save: 'cha' },
  { id: 'ice_storm', name: 'Ice Storm', level: 4, school: 'Evocation', castingTime: '1 action', range: '300 ft', duration: '1 round', description: 'A hail of rock-hard ice pounds to the ground in a 20-foot cylinder.', damage: '2d8 bludgeoning + 4d6 cold', save: 'dex' },
  { id: 'dimension_door', name: 'Dimension Door', level: 4, school: 'Conjuration', castingTime: '1 action', range: '500 ft', duration: 'Instantaneous', description: 'You teleport yourself and a willing creature to a spot within range.' },
  { id: 'polymorph', name: 'Polymorph', level: 4, school: 'Transmutation', castingTime: '1 action', range: '60 ft', duration: '1 hour', description: 'A creature transforms into a beast of equal or lower CR.', save: 'wis' },
  // ── Level 5 additions ──
  { id: 'dispel_magic', name: 'Dispel Magic', level: 3, school: 'Abjuration', castingTime: '1 action', range: '120 ft', duration: 'Instantaneous', description: 'Choose one creature, object, or magical effect within range. Any spell of 3rd level or lower ends.' },
  { id: 'wall_of_force', name: 'Wall of Force', level: 5, school: 'Evocation', castingTime: '1 action', range: '120 ft', duration: '10 min', description: 'An invisible wall of force springs into existence, forming up to 10 connected panels.' },
  { id: 'banishing_smite', name: 'Banishing Smite', level: 5, school: 'Abjuration', castingTime: '1 bonus action', range: 'Self', duration: '1 min', description: 'The next time you hit a creature with a weapon attack, it takes an extra 5d10 force damage.', damage: '5d10 force' },
  { id: 'flame_strike', name: 'Flame Strike', level: 5, school: 'Evocation', castingTime: '1 action', range: '60 ft', duration: 'Instantaneous', description: 'A vertical column of divine fire roars down in a 10-foot radius.', damage: '4d6 fire + 4d6 radiant', save: 'dex' },
  { id: 'circle_of_power', name: 'Circle of Power', level: 5, school: 'Abjuration', castingTime: '1 action', range: 'Self (30 ft)', duration: '10 min', description: 'An aura emanates from you, granting allies advantage on saving throws against spells.' },
];

// ── Spell slots & caster types ──────────────────────

/**
 * Spell slot progression by caster type, indexed by level-1 (rows 0-19 for
 * levels 1-20), columns are spell levels 1-9. Faithful 5e-style tables:
 * full casters (wizard/cleric/druid/bard/sorcerer), half casters
 * (paladin/ranger, slots start at level 2), and warlocks (Pact Magic — few
 * slots, but they return on a short rest).
 */
export const SPELL_SLOTS_BY_LEVEL: Record<'full' | 'half' | 'pact', number[][]> = {
  full: [
    [2, 0, 0, 0, 0, 0, 0, 0, 0], // level 1
    [3, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 2, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 2, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 1, 0, 0, 0, 0, 0],
    [4, 3, 3, 2, 0, 0, 0, 0, 0],
    [4, 3, 3, 3, 1, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 0, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 0, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 0],
    [4, 3, 3, 3, 2, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 2, 1, 1], // level 20
  ],
  half: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0], // level 1
    [2, 0, 0, 0, 0, 0, 0, 0, 0],
    [3, 0, 0, 0, 0, 0, 0, 0, 0],
    [3, 0, 0, 0, 0, 0, 0, 0, 0],
    [4, 2, 0, 0, 0, 0, 0, 0, 0],
    [4, 2, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 0, 0, 0, 0, 0, 0, 0],
    [4, 3, 2, 0, 0, 0, 0, 0, 0],
    [4, 3, 2, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 0, 0, 0, 0, 0, 0],
    [4, 3, 3, 1, 0, 0, 0, 0, 0],
    [4, 3, 3, 1, 0, 0, 0, 0, 0],
    [4, 3, 3, 2, 0, 0, 0, 0, 0],
    [4, 3, 3, 2, 0, 0, 0, 0, 0],
    [4, 3, 3, 3, 1, 0, 0, 0, 0],
    [4, 3, 3, 3, 1, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 0, 0, 0, 0],
    [4, 3, 3, 3, 2, 0, 0, 0, 0], // level 20
  ],
  pact: [
    [1, 0, 0, 0, 0, 0, 0, 0, 0], // level 1
    [2, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 2, 0, 0, 0, 0, 0, 0, 0],
    [0, 2, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 2, 0, 0, 0, 0, 0, 0],
    [0, 0, 2, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 2, 0, 0, 0, 0, 0],
    [0, 0, 0, 2, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 2, 0, 0, 0, 0],
    [0, 0, 0, 0, 2, 0, 0, 0, 0],
    [0, 0, 0, 0, 3, 0, 0, 0, 0],
    [0, 0, 0, 0, 3, 0, 0, 0, 0],
    [0, 0, 0, 0, 3, 0, 0, 0, 0],
    [0, 0, 0, 0, 3, 0, 0, 0, 0],
    [0, 0, 0, 0, 3, 0, 0, 0, 0],
    [0, 0, 0, 0, 3, 0, 0, 0, 0],
    [0, 0, 0, 0, 3, 1, 1, 1, 1],
    [0, 0, 0, 0, 3, 1, 1, 1, 1],
    [0, 0, 0, 0, 3, 1, 1, 1, 1],
    [0, 0, 0, 0, 3, 1, 1, 1, 1], // level 20
  ],
};

export type CasterType = 'full' | 'half' | 'pact' | 'none';

export function getCasterType(classId: string): CasterType {
  switch (classId) {
    case 'wizard':
    case 'cleric':
    case 'druid':
    case 'bard':
    case 'sorcerer':
      return 'full';
    case 'paladin':
    case 'ranger':
      return 'half';
    case 'warlock':
      return 'pact';
    default:
      return 'none';
  }
}

export function isCaster(classId: string): boolean {
  return getCasterType(classId) !== 'none';
}

/** Maximum slots per spell level (index 0 = 1st-level spells) for a caster. */
export function maxSlotsFor(classId: string, level: number): number[] {
  const type = getCasterType(classId);
  if (type === 'none') return [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const table = SPELL_SLOTS_BY_LEVEL[type];
  return table[Math.max(0, Math.min(level, table.length) - 1)];
}

/** 1st / 2nd / 3rd / 4th ... */
export function ordinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

/** 5e cantrip scaling: damage cantrips gain a die at 5th, 11th, and 17th level. */
export function cantripDice(characterLevel: number): number {
  if (characterLevel >= 17) return 4;
  if (characterLevel >= 11) return 3;
  if (characterLevel >= 5) return 2;
  return 1;
}

// ── Helpers ──────────────────────────────────────────

export function getClassById(id: string): CharacterClass | undefined {
  return CLASSES.find(c => c.id === id);
}

export function getRaceById(id: string): Race | undefined {
  return RACES.find(r => r.id === id);
}

export function getSpellById(id: string): Spell | undefined {
  return SPELLS.find(s => s.id === id);
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function rollDice(count: number, sides: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total;
}
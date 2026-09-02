/**
 * The D&D Grimoire — Rules & World Knowledge
 *
 * Everything a Dungeon Master knows that isn't a statblock:
 * alignment, abilities, skills, conditions, damage types, schools of magic,
 * languages, combat actions & rules, feats, backgrounds, subclasses,
 * the planes, deities, factions, traps, puzzles, weather, taverns,
 * rumors, quests, prophecies, legends, curses, diseases, poisons,
 * and name tables for every race.
 */

// ── Alignment ────────────────────────────────────────

export interface AlignmentEntry {
  id: string;
  name: string;
  description: string;
  exampleCreatures: string;
}

export const ALIGNMENTS: AlignmentEntry[] = [
  { id: 'lg', name: 'Lawful Good', description: 'Acts as conscience dictates, according to law and order. Believes in duty, honor, and protecting the innocent.', exampleCreatures: 'paladins, gold dragons, devas' },
  { id: 'ng', name: 'Neutral Good', description: 'Does the best good possible without bias toward order or freedom.', exampleCreatures: 'silver dragons, most clerics of good gods' },
  { id: 'cg', name: 'Chaotic Good', description: 'Follows conscience over rules, valuing freedom and kindness above authority.', exampleCreatures: 'brass dragons, robin-hood heroes, fey tricksters' },
  { id: 'ln', name: 'Lawful Neutral', description: 'Acts according to law, tradition, or personal code without moral weighting.', exampleCreatures: 'modrons, monks, judges, many dwarves' },
  { id: 'n', name: 'True Neutral', description: 'Prefers balance and equilibrium, avoiding extremes of any kind.', exampleCreatures: 'druids, most animals, many elementals' },
  { id: 'cn', name: 'Chaotic Neutral', description: 'Follows whim and impulse, valuing personal freedom above all else.', exampleCreatures: 'barbarians, slaadi, many rogues' },
  { id: 'le', name: 'Lawful Evil', description: 'Takes what is wanted within accepted hierarchy and codes — tyranny, contracts, and cold discipline.', exampleCreatures: 'devils, hobgoblins, liches' },
  { id: 'ne', name: 'Neutral Evil', description: 'Does whatever it can get away with, without compassion or qualms.', exampleCreatures: 'wraiths, drow assassins, many undead' },
  { id: 'ce', name: 'Chaotic Evil', description: 'Acts on arbitrary violence, greed, and bloodlust with no regard for anything.', exampleCreatures: 'demons, red dragons, orcs of legend' },
];

// ── Abilities & Skills ───────────────────────────────

export const ABILITY_SCORES = [
  { id: 'str', name: 'Strength', description: 'Physical power, athletic training, force of blows. Governs Athletics.' },
  { id: 'dex', name: 'Dexterity', description: 'Agility, reflexes, balance. Governs Acrobatics, Sleight of Hand, Stealth. Drives AC and initiative.' },
  { id: 'con', name: 'Constitution', description: 'Health, stamina, vital force. Drives hit points and concentration saves.' },
  { id: 'int', name: 'Intelligence', description: 'Memory, reasoning, arcane learning. Governs Arcana, History, Investigation, Nature, Religion.' },
  { id: 'wis', name: 'Wisdom', description: 'Perceptiveness, intuition, willpower. Governs Animal Handling, Insight, Medicine, Perception, Survival. Drives perception and insight saves.' },
  { id: 'cha', name: 'Charisma', description: 'Force of personality, confidence, leadership. Governs Deception, Intimidation, Performance, Persuasion. Fuels sorcerers, bards, warlocks, and paladins.' },
] as const;

export interface SkillEntry {
  name: string;
  ability: string;
  description: string;
}

export const SKILLS: SkillEntry[] = [
  { name: 'Acrobatics', ability: 'DEX', description: 'Balance flips, tumbles, landing safely from falls.' },
  { name: 'Animal Handling', ability: 'WIS', description: 'Calming beasts, reading animal intent, controlling mounts.' },
  { name: 'Arcana', ability: 'INT', description: 'Recalling spells, magic items, eldritch symbols, planar lore.' },
  { name: 'Athletics', ability: 'STR', description: 'Climbing, jumping, swimming, grappling.' },
  { name: 'Deception', ability: 'CHA', description: 'Lying convincingly, passing yourself off as someone else.' },
  { name: 'History', ability: 'INT', description: 'Recalling kingdoms, wars, ancient peoples, lost civilizations.' },
  { name: 'Insight', ability: 'WIS', description: 'Reading true intentions, sensing lies and charm.' },
  { name: 'Intimidation', ability: 'CHA', description: 'Threatening, cowing, extracting obedience through fear.' },
  { name: 'Investigation', ability: 'INT', description: 'Deducing from clues, finding hidden mechanisms, piecing evidence.' },
  { name: 'Medicine', ability: 'WIS', description: 'Stabilizing the dying, diagnosing illness, treating wounds.' },
  { name: 'Nature', ability: 'INT', description: 'Recalling terrain, plants, weather, beast behavior.' },
  { name: 'Perception', ability: 'WIS', description: 'Noticing danger through sight, sound, smell — spotting ambushes.' },
  { name: 'Performance', ability: 'CHA', description: 'Music, dance, oratory, holding an audience spellbound.' },
  { name: 'Persuasion', ability: 'CHA', description: 'Influencing with tact, grace, and social nuance.' },
  { name: 'Religion', ability: 'INT', description: 'Recalling deities, rites, holy symbols, cult doctrine.' },
  { name: 'Sleight of Hand', ability: 'DEX', description: 'Pickpocketing, palming objects, planting items unnoticed.' },
  { name: 'Stealth', ability: 'DEX', description: 'Slipping past unseen and unheard, hiding in shadows.' },
  { name: 'Survival', ability: 'WIS', description: 'Tracking, foraging, navigating wilderness, predicting weather.' },
];

// ── Conditions ───────────────────────────────────────

export interface ConditionEntry {
  id: string;
  name: string;
  effects: string[];
  commonSources: string;
}

export const CONDITIONS: ConditionEntry[] = [
  { id: 'blinded', name: 'Blinded', effects: ['Cannot see', 'Fails checks requiring sight', 'Attack rolls against it have advantage', 'Its attacks have disadvantage'], commonSources: 'glitterdust, blindness/deafness, darkness, color spray' },
  { id: 'charmed', name: 'Charmed', effects: ['Cannot attack the charmer', 'Charmer has advantage on social checks with it'], commonSources: 'charm person, vampire Charm, harpy song, succubus' },
  { id: 'deafened', name: 'Deafened', effects: ['Cannot hear', 'Fails checks requiring hearing'], commonSources: 'thunder damage, deafness, shout spells' },
  { id: 'frightened', name: 'Frightened', effects: ['Disadvantage while source of fear is in sight', 'Cannot willingly move closer to the source'], commonSources: 'dragon Frightful Presence, fear spell, cause fear' },
  { id: 'grappled', name: 'Grappled', effects: ['Speed becomes 0', 'Ends if grappler is incapacitated or lets go'], commonSources: 'grapple action, tentacles, mimic adhesive' },
  { id: 'incapacitated', name: 'Incapacitated', effects: ['Cannot take actions or reactions'], commonSources: 'paralysis, stun, unconsciousness, sleep' },
  { id: 'invisible', name: 'Invisible', effects: ['Cannot be seen', 'Attacks against it have disadvantage', 'Its attacks have advantage'], commonSources: 'invisibility, greater invisibility, imp Natural Invisibility' },
  { id: 'paralyzed', name: 'Paralyzed', effects: ['Incapacitated, cannot move or speak', 'Attack rolls against it have advantage', 'Hits within 5 ft are critical strikes', 'Auto-fails STR and DEX saves'], commonSources: 'hold person/monster, ghoul claws, power word stun' },
  { id: 'petrified', name: 'Petrified', effects: ['Transformed to stone, incapacitated', 'Resistant to all damage', 'Poison-immune, auto-fails STR/DEX saves'], commonSources: 'medusa gaze, basilisk gaze, flesh to stone' },
  { id: 'poisoned', name: 'Poisoned', effects: ['Disadvantage on attack rolls and ability checks'], commonSources: 'poisoned weapons, green dragon breath, spores, tainted wine' },
  { id: 'prone', name: 'Prone', effects: ['Only crawling costs movement', 'Disadvantage on attacks', 'Melee attacks against it have advantage, ranged have disadvantage'], commonSources: 'shove, thunderwave, greased ground, knockdown blows' },
  { id: 'restrained', name: 'Restrained', effects: ['Speed 0, cannot benefit from bonuses to speed', 'Disadvantage on attacks and DEX saves', 'Attacks against it have advantage'], commonSources: 'webs, entangle, nets, manacles, tentacle grabs' },
  { id: 'stunned', name: 'Stunned', effects: ['Incapacitated, auto-fails STR/DEX saves', 'Attacks against it have advantage'], commonSources: 'mind blast, stunning strike, symbol' },
  { id: 'unconscious', name: 'Unconscious', effects: ['Incapacitated, unaware, drops everything', 'Attacks within 5 ft auto-crit', 'Auto-fails STR/DEX saves'], commonSources: 'sleep spell, knockout poison, dropping to 0 HP' },
  { id: 'exhaustion', name: 'Exhaustion (1–6 levels)', effects: ['1: disadvantage on ability checks', '2: speed halved', '3: disadvantage on attacks and saves', '4: hit point maximum halved', '5: speed reduced to 0', '6: death'], commonSources: 'forced marches, starvation, extreme heat or cold, swimming storms' },
];

// ── Damage Types ─────────────────────────────────────

export const DAMAGE_TYPES = [
  { type: 'acid', note: 'Corrosive — melts metal, flesh, and stone. Oozes breathe it.' },
  { type: 'bludgeoning', note: 'Crushing impact — maces, falling rocks, hammers.' },
  { type: 'cold', note: 'Frost and chill — white dragon breath, ice storms, riming winds.' },
  { type: 'fire', note: 'Flame and heat — the most common resistance in the multiverse. Reds love it.' },
  { type: 'force', note: 'Pure magical energy — magic missile, eldritch blast. Almost nothing resists it.' },
  { type: 'lightning', note: 'Electricity — blue dragon breath, chain lightning, storm giants.' },
  { type: 'necrotic', note: 'Withering life-drain — channel negative energy, undeath, decay.' },
  { type: 'piercing', note: 'Puncturing — arrows, spears, fangs, stingers.' },
  { type: 'poison', note: 'Toxin — the most commonly resisted damage type by monsters.' },
  { type: 'psychic', note: 'Mind-shattering mental force — mind blast, phantasmal killer.' },
  { type: 'radiant', note: 'Holy searing light — divine smites, sunburst, celestial wrath. Anathema to undead.' },
  { type: 'slashing', note: 'Cutting edges — swords, axes, claws, vorpal blades.' },
  { type: 'thunder', note: 'Concussive sound-boom — thunderwave, shatter, booming steps.' },
];

// ── Schools of Magic ─────────────────────────────────

export const SCHOOLS_OF_MAGIC = [
  { school: 'Abjuration', description: 'Protective wards, dispelling, banishment, antimagic. The shield-magic of guardians.' },
  { school: 'Conjuration', description: 'Transportation, summoning, creation of matter. Teleports, portals, summoned allies, black tentacles.' },
  { school: 'Divination', description: 'Revealing information — scrying, foresight, detect thoughts, true seeing. The eye of magic.' },
  { school: 'Enchantment', description: 'Influencing minds — charms, dominates, compulsion, heroism. Forbidden in some lands.' },
  { school: 'Evocation', description: 'Channeling raw energy into destructive blasts and healing surges — fireball, lightning bolt, cure wounds.' },
  { school: 'Illusion', description: 'Deceiving the senses — invisibility, phantasmal killer, silent image. Reality bends but does not break.' },
  { school: 'Necromancy', description: 'The magic of life and death itself — animate dead, vampiric touch, finger of death. Feared and regulated everywhere.' },
  { school: 'Transmutation', description: 'Changing matter and form — polymorph, enlarge/reduce, stone shape, time stop at its apex.' },
];

// ── Languages ────────────────────────────────────────

export const LANGUAGES = [
  { language: 'Common', speakers: 'Trade tongue of humans; understood nearly everywhere', script: 'Common' },
  { language: 'Abyssal', speakers: 'Demons, cultists of demon lords', script: 'Infernal' },
  { language: 'Celestial', speakers: 'Angels, devas, celestials, good-aligned outsiders', script: 'Celestial' },
  { language: 'Deep Speech', speakers: 'Mind flayers, aboleths, things of the Far Realm', script: 'none — spoken in the dark between stars' },
  { language: 'Draconic', speakers: 'Dragons, dragonborn, kobolds — the oldest mortal tongue', script: 'Draconic' },
  { language: 'Druidic', speakers: 'Druids only — secret nature-code', script: 'Druidic runes' },
  { language: 'Dwarvish', speakers: 'Dwarves — clanging, consonant-heavy', script: 'Dethek runes' },
  { language: 'Elvish', speakers: 'Elves — flowing, lyrical, precise', script: 'Espruar' },
  { language: 'Giant', speakers: 'Giants, ogres — ancient tongue of the titans', script: 'Dethek runes' },
  { language: 'Gnomish', speakers: 'Gnomes — rapid, technical, pun-laden', script: 'Dwarvish letters' },
  { language: 'Goblin', speakers: 'Goblins, hobgoblins, bugbears', script: 'Common letters, crude spelling' },
  { language: 'Halfling', speakers: 'Halflings — warm and homey', script: 'Common letters' },
  { language: 'Infernal', speakers: 'Devils — contractual precision, every word binding', script: 'Infernal' },
  { language: 'Orc', speakers: 'Orcs — guttural, clipped', script: 'Dethek runes' },
  { language: 'Primordial', speakers: 'Elementals, genies — dialects of Auran, Aquan, Ignan, Terran', script: 'Primordial' },
  { language: 'Sylvan', speakers: 'Fey creatures, satyrs, dryads, unicorns', script: 'Elvish letters' },
  { language: 'Undercommon', speakers: 'Drow, duergar, mind flayers, Underdark merchants', script: 'Elvish letters' },
  { language: 'Thieves\u2019 Cant', speakers: 'Criminal guilds — coded slang and chalk marks', script: 'hidden meanings in ordinary signs' },
];

// ── Combat Actions & Rules ───────────────────────────

export const COMBAT_ACTIONS = [
  { action: 'Attack', cost: 'Action', note: 'Make one melee or ranged attack; Extra Attack grants multiple swings.' },
  { action: 'Cast a Spell', cost: 'Action/Bonus/Reaction', note: 'Spellcasting time determines slot used. One leveled spell per turn when slots are spent.' },
  { action: 'Dash', cost: 'Action', note: 'Gain extra movement equal to your speed.' },
  { action: 'Disengage', cost: 'Action', note: 'Move without provoking opportunity attacks this turn.' },
  { action: 'Dodge', cost: 'Action', note: 'Attacks against you have disadvantage until your next turn; DEX saves made with advantage.' },
  { action: 'Help', cost: 'Action', note: 'Grant advantage on an ally\u2019s next check or attack against one target.' },
  { action: 'Hide', cost: 'Action', note: 'Stealth check vs passive Perception; unseen attackers gain advantage.' },
  { action: 'Ready', cost: 'Action', note: 'Hold an action triggered by a specific event, spending your reaction to execute it.' },
  { action: 'Search', cost: 'Action', note: 'Devote attention to finding something — Perception or Investigation.' },
  { action: 'Use an Object', cost: 'Action', note: 'Interact with a second object beyond your free interaction.' },
  { action: 'Opportunity Attack', cost: 'Reaction', note: 'Strike a hostile that leaves your reach without Disengaging.' },
  { action: 'Shield Block / Cast Reaction Spell', cost: 'Reaction', note: 'shield, hellish rebuke, counterspell all use your reaction.' },
  { action: 'Two-Weapon Fighting', cost: 'Bonus Action', note: 'Attack with an off-hand light weapon after attacking with the main hand.' },
];

export const COMBAT_RULES = [
  {
    rule: 'Advantage & Disadvantage',
    explanation: 'Roll 2d20 and take the higher (advantage) or lower (disadvantage). Multiple instances never stack; they cancel out.',
    tips: 'Flanking (optional rule), unseen attackers, prone targets in melee, and help actions grant advantage.',
  },
  {
    rule: 'Death Saving Throws',
    explanation: 'At 0 HP you fall unconscious and roll d20 at the start of each turn. 10+ succeeds; three successes stabilize you, three failures kill you. A natural 20 restores 1 HP; a natural 1 counts as two failures. Taking damage causes an automatic failure (two on a crit).',
    tips: 'Healing brings a dying ally back to consciousness instantly.',
  },
  {
    rule: 'Concentration',
    explanation: 'Spells like bless, hold person, or wall of force require concentration. Taking damage forces a Constitution save (DC 10 or half damage, whichever is higher) or the spell ends.',
    tips: 'War Caster feat grants advantage on these saves.',
  },
  {
    rule: 'Short Rest',
    explanation: 'One hour of light activity. Spend Hit Dice to heal, regain some class features (warlock slots, monk ki, second wind).',
    tips: 'Arcane recovery (wizard) works on a long rest, not short.',
  },
  {
    rule: 'Long Rest',
    explanation: 'Eight hours of sleep (or six for elves in Trance). Restore full HP, half your Hit Dice, and all spell slots.',
    tips: 'Interrupted rests only restore benefits if resumed — adventurers rarely get eight quiet hours in a dungeon.',
  },
  {
    rule: 'Cover',
    explanation: 'Half cover (+2 AC/DEX saves): low walls, furniture. Three-quarters (+5): arrow slits, portcullises. Total cover: cannot be targeted directly.',
    tips: 'Smart monsters use pillars and doorframes ruthlessly.',
  },
  {
    rule: 'Grapple & Shove',
    explanation: 'Replace an attack with an Athletics contest. Grappling sets speed to 0; shoving knocks prone or pushes 5 feet.',
    tips: 'Grappling a flying creature drags it out of the sky.',
  },
  {
    rule: 'Critical Hits',
    explanation: 'Rolling a natural 20 hits regardless of AC and doubles all damage dice (not modifiers). Some weapons and features add extra crit dice.',
    tips: 'Champion fighters crit on 19-20; half-orc Savage Attacks adds extra dice.',
  },
  {
    rule: 'Difficulty Class (DC)',
    explanation: 'Typical DCs: 10 easy, 15 moderate, 20 hard, 25 very hard, 30 nearly impossible.',
    tips: 'Skill checks, saving throws, and dispel attempts all compare d20 + modifier against a DC.',
  },
  {
    rule: 'Inspiration',
    explanation: 'The DM awards inspiration for great roleplay; spend it to reroll any d20 roll.',
    tips: 'Heroes who act in character earn their luck.',
  },
];

// ── Feats ────────────────────────────────────────────

export const FEATS = [
  { feat: 'Great Weapon Master', effect: 'On crit or kill, make a bonus attack; take -5 to hit for +10 damage.' },
  { feat: 'Sharpshooter', effect: 'Ignore long range and cover; -5 to hit for +10 damage.' },
  { feat: 'Crossbow Expert', effect: 'No loading limit, no close-range disadvantage, bonus hand-crossbow attack.' },
  { feat: 'Polearm Master', effect: 'Bonus butt-end attack; opportunity attack when enemies enter reach.' },
  { feat: 'Sentinel', effect: 'Reduce enemy speed to 0 on opportunity hit; attack them when they attack others.' },
  { feat: 'Shield Master', effect: 'Shove as bonus attack; +2 DEX saves vs targeted effects; block full damage on successful saves.' },
  { feat: 'War Caster', effect: 'Advantage on concentration saves; cast spells as opportunity attacks; cast with hands full.' },
  { feat: 'Resilient', effect: '+1 to an ability and proficiency in its saving throws.' },
  { feat: 'Lucky', effect: 'Three luck points per long rest — reroll attacks, checks, saves, or force foes to reroll.' },
  { feat: 'Alert', effect: '+5 initiative; can\u2019t be surprised while conscious; no disadvantage vs hidden attackers.' },
  { feat: 'Mobile', effect: '+10 speed; Dash ignores difficult terrain; no opportunity attacks from the target you attack.' },
  { feat: 'Tough', effect: '+2 HP per level, retroactive.' },
  { feat: 'Magic Initiate', effect: 'Learn two cantrips and one 1st-level spell from another class\u2019 list.' },
  { feat: 'Ritual Caster', effect: 'Own a ritual book; cast ritual spells without expending slots.' },
  { feat: 'Actor', effect: '+1 Charisma; advantage on Deception and Performance when impersonating; mimic any voice.' },
  { feat: 'Observant', effect: '+1 INT or WIS; read lips; +5 passive Perception and Investigation.' },
  { feat: 'Heavy Armor Master', effect: '+1 Strength; reduce bludgeoning, piercing, slashing damage by 3 while in heavy armor.' },
  { feat: 'Elven Accuracy', effect: 'Elf/half-elf only — reroll one die when rolling with advantage (triple advantage).' },
  { feat: 'Metamagic Adept', effect: 'Two sorcery points and two metamagic options for non-sorcerers.' },
  { feat: 'Crusher / Slasher / Piercer', effect: 'Weapon-type mastery: move targets, reduce speeds, or add crit dice respectively.' },
];

// ── Backgrounds ──────────────────────────────────────

export interface BackgroundEntry {
  name: string;
  skills: string;
  feature: string;
  description: string;
}

export const BACKGROUNDS: BackgroundEntry[] = [
  { name: 'Acolyte', skills: 'Insight, Religion', feature: 'Shelter of the Faithful — free healing and care at temples of your faith', description: 'Served in a temple, learning rites and dogma before taking up the adventuring path.' },
  { name: 'Criminal', skills: 'Deception, Stealth', feature: 'Criminal Contact — reliable underworld connection', description: 'Lived outside the law as a burglar, enforcer, or fence.' },
  { name: 'Folk Hero', skills: 'Animal Handling, Survival', feature: 'Rustic Hospitality — commoners hide and aid you', description: 'Ordinary origins; performed one deed that made you a local legend.' },
  { name: 'Noble', skills: 'History, Persuasion', feature: 'Position of Privilege — welcomed by high society', description: 'Raised in a manor of wealth, power, and expectation.' },
  { name: 'Sage', skills: 'Arcana, History', feature: 'Researcher — knows where to find any obscure knowledge', description: 'Spent years in libraries and laboratories unlocking secrets.' },
  { name: 'Soldier', skills: 'Athletics, Intimidation', feature: 'Military Rank — authority over lower-ranked soldiers', description: 'Marched under a banner; war is your first language.' },
  { name: 'Charlatan', skills: 'Deception, Sleight of Hand', feature: 'False Identity — a second persona with deep roots', description: 'Sold dreams and swindles; every smile is a con.' },
  { name: 'Entertainer', skills: 'Acrobatics, Performance', feature: 'By Popular Demand — venues compete to host you', description: 'Thrived before crowds — songs, blades, or both.' },
  { name: 'Guild Artisan', skills: 'Insight, Persuasion', feature: 'Guild Membership — lodging, food, legal muscle', description: 'Member of a trade guild; craftsmanship is your creed.' },
  { name: 'Hermit', skills: 'Medicine, Religion', feature: 'Discovery — a unique truth found in solitude', description: 'Lived apart from society seeking enlightenment.' },
  { name: 'Outlander', skills: 'Athletics, Survival', feature: 'Wanderer — recall terrain and find food and water', description: 'Raised beyond the walls, where the wild keeps its own laws.' },
  { name: 'Sailor', skills: 'Athletics, Perception', feature: "Ship's Passage — free passage on ships for you and allies", description: 'Salt-blooded deckhand or privateer; the sea raised you.' },
  { name: 'Urchin', skills: 'Sleight of Hand, Stealth', feature: 'City Secrets — move twice normal speed through urban maze', description: 'Survived the streets alone; the city is a map in your head.' },
];

// ── Subclasses (5e-flavored, one line each) ──────────

export const SUBCLASSES: Record<string, string[]> = {
  fighter: ['Champion (improved criticals)', 'Battle Master (combat maneuvers and superiority dice)', 'Eldritch Knight (wizardry on the front line)', 'Cavalier (mounted guardian)', 'Samurai (fighting spirit)', 'Psi Warrior (telekinetic combat)'],
  wizard: ['Evocationist (sculpted fireballs)', 'Abjurer (arcane ward)', 'Illusionist (malleable illusions)', 'Necromancer (undead servants)', 'Diviner (portent — replace rolls with foreseen results)', 'Transmuter (philosopher\u2019s stone)', 'Bladesinger (sword-and-spell dance)', 'War Mage (battle-focused defense)'],
  cleric: ['Life Domain (healing mastery)', 'Light Domain (radiance and fire)', 'War Domain (blessed arms)', 'Tempest Domain (storm and thunder)', 'Trickery Domain (illusion and deceit)', 'Knowledge Domain (mind-expanding secrets)', 'Death Domain (necromantic zeal)', 'Twilight Domain (protective vigil)'],
  rogue: ['Thief (fast hands, second-story work)', 'Assassin (death-dealing ambushes)', 'Arcane Trickster (mage hand larceny)', 'Inquisitive (deduction and eye for detail)', 'Swashbuckler (dueling panache)', 'Phantom (whispers of the dead)'],
  ranger: ['Hunter (colossus slayer, horde breaker)', 'Beast Master (animal companion)', 'Gloom Stalker (ambusher of the dark)', 'Horizon Walker (planar rambler)', 'Fey Wanderer (feywild dread)', 'Swarmkeeper (living swarm)'],
  paladin: ['Devotion (unblemished purity)', 'Ancients (nature\u2019s champion)', 'Vengeance (relentless avenger)', 'Oathbreaker (fallen, commanding undead)', 'Redemption (peace through mercy)', 'Crown (fealty to civilization)'],
  barbarian: ['Berserker (frenzy)', 'Totem Warrior (bear, eagle, wolf spirits)', 'Zealot (divine rage, hard to kill)', 'Ancestral Guardian (spirit shields)', 'Storm Herald (aura of tempest, desert, or tundra)'],
  druid: ['Circle of the Land (terrain-tuned caster)', 'Circle of the Moon (master shapeshifter)', 'Circle of Dreams (feywild healer)', 'Circle of Spores (fungi and necromancy hybrid)', 'Circle of Stars (star map forms)'],
  bard: ['College of Lore (cutting words, wide knowledge)', 'College of Valor (wartime skald)', 'College of Glamour (fey charm)', 'College of Swords (blade flourish)', 'College of Whispers (psychic dread)'],
  sorcerer: ['Draconic Bloodline (dragon ancestor, scaled resilience)', 'Wild Magic (surges of chaos)', 'Storm Sorcery (wind and thunder flight)', 'Shadow Sorcery (hounds of ill omen)', 'Divine Soul (celestial bloodline)'],
  warlock: ['Fiend Pact (hellish bargains)', 'Great Old One (alien whispers)', 'Archfey (feystep charms)', 'Hexblade (weapon-bound shadow)', 'Celestial (light-pact healer)'],
  monk: ['Open Hand (technique of the flowing strike)', 'Shadow (ninjutsu silence)', 'Four Elements (ki-bending of water, earth, fire, air)', 'Kensei (weapon saint)', 'Way of Mercy (mask of pain, healing hands)'],
  artificer: ['Alchemist (elixirs and experimental draughts)', 'Artillerist (eldritch cannon)', 'Battle Smith (steel defender companion)', 'Armorer (arcane armor, thunder gauntlets)'],
  blood_hunter: ['Order of the Ghostslayer (swiftest against the dead)', 'Order of the Lycan (hunted hybrid rage)', 'Order of the Profane Soul (pact blade hemocraft)', 'Order of the Mutagenic (mutagens brewed from pain)'],
};

// ── Planes of Existence ──────────────────────────────

export interface PlaneEntry {
  name: string;
  category: string;
  description: string;
  dangers: string;
  denizens: string;
}

export const PLANES: PlaneEntry[] = [
  { name: 'Material Plane', category: 'Core', description: 'The mortal world — continents, oceans, kingdoms, and dungeons. The fulcrum on which all other planes pivot.', dangers: 'Whatever walks in from elsewhere', denizens: 'Humans, elves, dwarves, and all familiar folk' },
  { name: 'Feywild', category: 'Transitive', description: 'A mirror-world of unbridled emotion and magic where seasons last centuries and time flows wrong. Beauty and peril are indistinguishable.', dangers: 'Time slips, fey bargains, eating fey food binds you there', denizens: 'Eladrin, pixies, hags, displacer beasts, archfey courts' },
  { name: 'Shadowfell', category: 'Transitive', description: 'The gray echo where light goes to die. Despair pools here like standing water, and memories fade with distance traveled.', dangers: 'Soul-draining gloom, shadow mastiffs, despair events', denizens: 'Shadows, wraiths, shadar-kai, the Raven Queen\u2019s servitors' },
  { name: 'Ethereal Plane', category: 'Transitive', description: 'An ocean of ghostly mist overlapping the Material. Incorporeal travelers drift through walls and watch the world as through smoked glass.', dangers: 'Phase spiders, ether cyclones, the Deep Ethereal\u2019s demiplanes', denizens: 'Ghosts, phase spiders, night hags on nightmare rides' },
  { name: 'Astral Plane', category: 'Transitive', description: 'The Silver Void between worlds, where thought outpaces travel and dead gods drift like whales. Your body sleeps while your silver cord connects soul to shell.', dangers: 'Severed silver cords mean death; astral dreadnoughts; githyanki raiders', denizens: 'Githyanki, astral dreadnoughts, psurlons, the corpses of forgotten gods' },
  { name: 'Elemental Plane of Fire', category: 'Inner', description: 'An inferno without edge or floor — seas of flame beneath skies of ember. Fire here is not merely hot; it is alive and hungry.', dangers: 'Everything burns; cinder storms; magma rivers', denizens: 'Efreet in brass citadels, fire elementals, salamanders, azer' },
  { name: 'Elemental Plane of Water', category: 'Inner', description: 'A boundless ocean without surface or seabed, warm above and crushing below, lit by drifting bioluminescence.', dangers: 'Pressure depths, whirlpools the size of nations', denizens: 'Marids, water elementals, tritons, krakens of legend' },
  { name: 'Elemental Plane of Air', category: 'Inner', description: 'An endless sky of cloud banks and hurricane corridors. Cities hang tethered to nothing; travelers fly or fall forever.', dangers: 'Windwalls, voids of thin air, lightning squalls', denizens: 'Djinn in cloud palaces, air elementals, aarakocra exiles' },
  { name: 'Elemental Plane of Earth', category: 'Inner', description: 'Infinite cavernous stone — tunnels bored by burrowing gods, caves lit by veins of luminous ore. Gravity points wherever stone decides.', dangers: 'Collapsing galleries, petrification pockets', denizens: 'Dao, earth elementals, xorn, gargoyles of living rock' },
  { name: 'Nine Hells (Baator)', category: 'Outer — Lawful Evil', description: 'Nine descending layers of ordered tyranny: Avernus\u2019 battlefields, Dis\u2019 iron city, Minauros\u2019 bog, Phlegethos\u2019 flame pits, Stygia\u2019s ice, Malbolge\u2019s slopes, Maladomini\u2019s ruins, Cania\u2019s glacier, and Nessus at the bottom where Asmodeus rules.', dangers: 'Contracts bind souls; devil hierarchies punish weakness', denizens: 'Devils of every rank — lemures to pit fiends, archdevils, Zariel' },
  { name: 'The Abyss', category: 'Outer — Chaotic Evil', description: 'An infinite chasm of numberless layers, each a mad god\u2019s fever dream. Demons wage eternal war on devils (the Blood War) and on all order itself.', dangers: 'Demon lords wander layers like storms — Demogorgon, Orcus, Graz\u2019zt, Yeenoghu, Fraz-Urb\u2019luu', denizens: 'Demons — dretches to balors, tanar\u2019ri hosts, lost souls' },
  { name: 'Mount Celestia', category: 'Outer — Lawful Good', description: 'Seven nested heavens rising toward ultimate light. Every slope climbed purifies the pilgrim; the summit holds the throne of justice.', dangers: 'Evil beings are burned by the very light', denizens: 'Lantern archons, devas, planetars, solars, empyreal lords' },
  { name: 'The Beastlands', category: 'Outer — Neutral Good', description: 'An endless wilderness where animals are people and people become animals. The moon hangs fixed; the hunt is sacred.', dangers: 'Predators judge visitors; pride invites transformation', denizens: 'Awakened beasts, werewolf clans, cat lords, animal lords' },
  { name: 'Arborea', category: 'Outer — Chaotic Good', description: 'Wild forests, wine-dark seas, and mountains that sing. Passion outruns reason; elven souls come here to rest among the trees.', dangers: 'Excess — feasts that never end consume the partaker', denizens: 'Eladrin, satyrs, titans, Olympian-style powers' },
  { name: 'Mechanus', category: 'Outer — Lawful Neutral', description: 'An infinite machine of interlocking gears the size of continents. Law made visible; every cog turns exactly as designed.', dangers: 'Being filed down into a component', denizens: 'Modrons on their Great March, inevitables enforcing cosmic law' },
  { name: 'Limbo', category: 'Outer — Chaotic Neutral', description: 'Raw chaos — a boiling soup of unformed elements. Githzerai monasteries hold islands of stability by sheer discipline of will.', dangers: 'Reality reshapes around untrained minds', denizens: 'Slaadi (frog-like agents of chaos), githzerai, chaos beasts' },
  { name: 'The Outlands', category: 'Outer — Neutral', description: 'The ring-plane at reality\u2019s hub, where all portals converge. Gate towns ring the Spire at its center, atop which sits Sigil.', dangers: 'Magic fades near the Spire; neutrality drains conviction', denizens: 'Rilmani balance-bringers, exiles from every plane' },
  { name: 'Sigil, the City of Doors', category: 'Planar Metropolis', description: 'A torus-city on the inside of the Spire, ruled by the Lady of Pain. Every doorway may open anywhere. Factions war politely in its streets.', dangers: 'Offending the Lady of Pain ends lives and afterlives', denizens: 'Every race and plane; dabus caretakers; planar merchants' },
  { name: 'Negative Energy Plane', category: 'Energy', description: 'The void of unbeing at existence\u2019s edge. Light dies here; matter unravels; the undead draw breath from its anti-life.', dangers: 'Touch drains levels and life outright', denizens: 'Xeg-yi, shadows, nightshades, entropy itself' },
  { name: 'Positive Energy Plane', category: 'Energy', description: 'Blinding creative radiance — the source of life, healing, and explosions of uncontrolled growth. Mortals overdose on vitality simply by arriving.', dangers: 'Overwhelmed mortals detonate in bursts of health', denizens: 'Xeg-yi counterparts, mihstlings, pure energy life' },
];

// ── Deities (Forgotten Realms flavored pantheon) ─────

export interface DeityEntry {
  name: string;
  portfolio: string;
  alignment: string;
  domains: string;
  symbol: string;
  lore: string;
}

export const DEITIES: DeityEntry[] = [
  { name: 'Bahamut', portfolio: 'Justice, honor, metallic dragons', alignment: 'Lawful Good', domains: 'Life, War', symbol: 'Dragon head in profile', lore: 'The Platinum Dragon wanders the world as an old man with seven golden canaries. He rewards those who fight tyranny.' },
  { name: 'Tiamat', portfolio: 'Greed, chromatic dragons, vengeance', alignment: 'Lawful Evil', domains: 'War, Trickery', symbol: 'Five-headed dragon', lore: 'Queen of chromatic dragons, imprisoned in Avernus. Her five heads hate each other almost as much as they hate Bahamut.' },
  { name: 'Mystra', portfolio: 'Magic, the Weave', alignment: 'Neutral Good', domains: 'Knowledge, Arcana', symbol: 'Ring of seven stars', lore: 'Goddess of magic itself. When she dies, magic breaks — history records several such Spellplagues.' },
  { name: 'Lathander', portfolio: 'Dawn, renewal, youth', alignment: 'Neutral Good', domains: 'Life, Light', symbol: 'Sun rising over road', lore: 'The Morninglord. His clergy build temples facing east and bury the dead at dawn.' },
  { name: 'Tempus', portfolio: 'War, battle', alignment: 'Chaotic Neutral', domains: 'War', symbol: 'Flaming sword on white shield', lore: 'Lord of Battles cares not who wins — only that the fighting is fierce and honest.' },
  { name: 'Kelemvor', portfolio: 'Death, the dead', alignment: 'Lawful Neutral', domains: 'Death, Grave', symbol: 'Balanced scales on skeletal arm', lore: 'Judge of the Damned. Death is not evil; it is a door he keeps fair and honest.' },
  { name: 'Shar', portfolio: 'Darkness, loss, secrets', alignment: 'Neutral Evil', domains: 'Death, Knowledge', symbol: 'Black disc with purple border', lore: 'Mistress of the Night, twin of Selûne. She erases memory, light, and hope to reclaim her primordial dark.' },
  { name: 'Selûne', portfolio: 'Moon, stars, navigation', alignment: 'Chaotic Good', domains: 'Knowledge, Life, Light', symbol: 'Pair of eyes in crescent moon', lore: 'Our Lady of Silver, eternal foe of Shar. Werewolves howl to her whether they serve or defy her.' },
  { name: 'Tymora', portfolio: 'Luck, adventure', alignment: 'Chaotic Good', domains: 'Trickery', symbol: 'Shiny coin face-up', lore: 'Lady Luck smiles on gamblers and heroes alike. Her shrines accept tithes paid in daring.' },
  { name: 'Bane', portfolio: 'Tyranny, conquest', alignment: 'Lawful Evil', domains: 'War, Order', symbol: 'Black fist on red field', lore: 'The Black Lord demands obedience and rewards empire. His church is a ladder — climb or fall.' },
  { name: 'Myrkul', portfolio: 'Decay, exhaustion, undead', alignment: 'Neutral Evil', domains: 'Death', symbol: 'White skull on black field', lore: 'The Old God of the dead teaches that death is universal and patient. Liches whisper his name.' },
  { name: 'Cyric', portfolio: 'Lies, madness, murder', alignment: 'Chaotic Evil', domains: 'Trickery', symbol: 'White skull on sunburst', lore: 'The Mad God of lies betrayed every friend he ever had — including the ones who made him divine.' },
  { name: 'Moradin', portfolio: 'Forge, dwarves, creation', alignment: 'Lawful Good', domains: 'Knowledge, Forge', symbol: 'Hammer and anvil', lore: 'The Soul Forger hammered dwarven souls on his anvil and breathes patience into stone.' },
  { name: 'Corellon Larethian', portfolio: 'Elves, art, magic', alignment: 'Chaotic Good', domains: 'Light, Arcana', symbol: 'Silver crescent', lore: 'First of the Seldarine, patron of artistry and the elven race\u2019s long memory.' },
  { name: 'Garl Glittergold', portfolio: 'Gnomes, humor, gems', alignment: 'Lawful Good', domains: 'Trickery', symbol: 'Gold nugget', lore: 'The Watchful Protector pranks evil into ruin and treasures a clever joke above treasure.' },
  { name: 'Yondalla', portfolio: 'Halflings, home, community', alignment: 'Lawful Good', domains: 'Life', symbol: 'Cornucopia on shield', lore: 'The Blessed Child protects hearth and harvest; her people defend each other fiercely.' },
  { name: 'Talos', portfolio: 'Storms, destruction', alignment: 'Chaotic Evil', domains: 'Tempest', symbol: 'Three lightning bolts from fist', lore: 'The Destroyer is worshipped out of fear by those in tornado country and volcano shadow.' },
  { name: 'Silvanus', portfolio: 'Nature, wild places', alignment: 'True Neutral', domains: 'Nature', symbol: 'Oak leaf', lore: 'Oak Father of forests. Balance is his creed — the flood and the drought are both his sermon.' },
  { name: 'Umberlee', portfolio: 'The sea, storms at sea', alignment: 'Chaotic Evil', domains: 'Tempest', symbol: 'Wave and claw', lore: 'The Bitch Queen takes tribute before every voyage; sailors spit leeward in her honor.' },
  { name: 'Vecna', portfolio: 'Secrets, forbidden knowledge, undeath', alignment: 'Neutral Evil', domains: 'Death, Knowledge', symbol: 'Hand with eye in palm', lore: 'The Archlich ascended through treachery and dismemberment. His Eye and Hand still seek new bearers.' },
  { name: 'Asmodeus', portfolio: 'Indulgence, pride, domination', alignment: 'Lawful Evil', domains: 'Order, Trickery', symbol: 'Three inverted triangles', lore: 'Lord of the Ninth. Older than theology claims; patient as geology.' },
  { name: 'The Raven Queen', portfolio: 'Winter, fate, death\u2019s dignity', alignment: 'Unaligned', domains: 'Death, Grave', symbol: 'Raven skull', lore: 'She hates the undead for cheating her winter, and collects the memories of the dying in her fortress of sorrow.' },
];

// ── Factions & Guilds ────────────────────────────────

export interface FactionEntry {
  name: string;
  motto: string;
  description: string;
  goals: string;
  reputation: string;
}

export const FACTIONS: FactionEntry[] = [
  { name: 'The Harpers', motto: 'Down with tyranny. Fairness and equality for all.', description: 'A scattered network of spies, bards, and rangers who oppose abuse of power by stealth, song, and sabotage.', goals: 'Preserve history, topple tyrants, protect the weak quietly', reputation: 'Beloved in villages; hunted by crowns' },
  { name: 'The Zhentarim', motto: 'Join us and see the world, leave behind danger and fear.', description: 'A mercantile syndicate that smuggles anything, hires anyone, and forgives nothing. Power is purchased here.', goals: 'Monopolies, influence, profit — in that order', reputation: 'Feared; useful; never trusted' },
  { name: 'The Order of the Gauntlet', motto: 'Faith guides the blade; the blade protects the faithful.', description: 'Paladins and clerics militant who smite evil openly and audit their own hearts nightly.', goals: 'Destroy evil at its root, shield frontier settlements', reputation: 'Righteous, rigid, occasionally insufferable' },
  { name: 'The Emerald Enclave', motto: 'The order of nature must be preserved.', description: 'Rangers, druids, and barbarians guarding civilization-nature balance. They burn poacher camps and feed famine zones.', goals: 'Keep wild places wild; blunt unchecked expansion', reputation: 'Guardians to rural folk; obstacles to loggers' },
  { name: 'The Lords\u2019 Alliance', motto: 'Band together against the coming darkness.', description: 'A coalition of rulers pooling spies and soldiers against shared threats. Politics by other means.', goals: 'Regional stability, mutual defense treaties', reputation: 'Powerful; bureaucratic; self-interested' },
  { name: 'The Red Wizards of Thay', motto: 'Power belongs to those who seize it.', description: 'Scarlet-robed magocracy of necromancers and slavers. Their zulkirs scheme even against each other.', goals: 'Magical supremacy, immortal rule, undead legions', reputation: 'Universally dreaded' },
  { name: 'The Cult of the Dragon', motto: 'Ever has man coveted dragonkind\u2019s might.', description: 'Dragon-worshipers who hoard wealth for draconic masters and seek to enthrone Tiamat.', goals: 'Summon dragon overlords, amass hoards, corrupt kings', reputation: 'Fanatical; well-funded; everywhere' },
  { name: 'House Jarkoti Trade Consortium', motto: 'Every road leads through us.', description: 'Caravan magnates whose ledgers double as spy networks across three kingdoms.', goals: 'Tariff control, route monopolies, debt leverage', reputation: 'Indispensable; predatory' },
  { name: 'The Grey Wardens of Kellmarch', motto: 'We keep the last watch so the realm need not.', description: 'Monster-hunting brotherhood stationed at dungeon mouths, cataloging threats and hiring adventurers.', goals: 'Contain outbreaks, bounty boards, bestiary research', reputation: 'Gruff professionals; always short-staffed' },
  { name: 'The Silent Ledger', motto: 'Nothing is written that we did not allow.', description: 'Information brokers selling secrets in sealed envelopes. Membership unknown; prices known to be steep.', goals: 'Omniscience, leverage over every crown', reputation: 'Mythical until the envelope arrives' },
];

// ── Traps ────────────────────────────────────────────

export interface TrapEntry {
  name: string;
  trigger: string;
  effect: string;
  dc: string;
}

export const TRAPS: TrapEntry[] = [
  { name: 'Collapsing Roof', trigger: 'Pressure plate in center corridor', effect: 'Ceiling collapses — 4d10 bludgeoning, buried victims restrained', dc: 'DC 15 Perception to spot hairline cracks; DC 12 DEX to dodge' },
  { name: 'Poison Needle', trigger: 'Lock mechanism or doorknob pull', effect: 'Needle prick — DC 15 CON save or 2d4 poison plus poisoned condition', dc: 'DC 14 Investigation reveals pinhole' },
  { name: 'Swinging Blade', trigger: 'Tripwire across hallway ankle height', effect: 'Scything pendulum — 2d6 slashing, DC 13 DEX negates', dc: 'DC 14 Perception spots glint of wire' },
  { name: 'Fire-Breathing Statue', trigger: 'Standing within 10 ft of idol', effect: 'Cone of flame — 4d6 fire, DC 13 DEX halves', dc: 'DC 12 Arcana senses residual evocation' },
  { name: 'Pit Trap', trigger: 'Weight on false flagstone', effect: '20 ft fall — 2d6 bludgeoning, spikes add 1d4 piercing', dc: 'DC 15 Perception notes seam in dust' },
  { name: 'Glyph of Warding', trigger: 'Opening sealed chest or speaking password wrongly', effect: 'Explosive runes — 5d8 thunder/fire/ice per glyph variant', dc: 'DC 15 Investigation detects; dispel magic (3rd+) removes' },
  { name: 'Lightning Bolt Runes', trigger: 'Crossing threshold carrying metal', effect: 'Line of lightning — 3d8 lightning, DC 14 DEX halves', dc: 'DC 16 Perception finds scorched marks' },
  { name: 'Teleportation Circle Trap', trigger: 'Stepping on inlaid sigil', effect: 'Victims teleported to holding cell or random dungeon level', dc: 'DC 17 Arcana recognizes transmutation lattice' },
  { name: 'Sleep Gas Chamber', trigger: 'Rotating wall panel release', effect: 'Room floods with gas — CON saves each round or fall asleep', dc: 'DC 12 CON; ventilation lever hidden behind tapestry' },
  { name: 'Crushing Walls', trigger: 'Taking idol\u2019s gem eyes', effect: 'Walls grind inward — 4d6 bludgeoning per round until escape', dc: 'DC 18 Investigation finds pressure-release stones' },
];

// ── Puzzles ──────────────────────────────────────────

export const PUZZLES = [
  'Four braziers must burn in the order of the seasons — spring green, summer gold, autumn red, winter white — or the doors reset with a grinding of stone.',
  'A mosaic shows five knights; pressing the one whose shadow falls longest opens the way. The light source moves with whoever carries the torch.',
  'Whisper the answer to the riddle carved on the sphinx door: "I have cities but no houses, forests but no trees, water but no fish." (A map.)',
  'Three levers labeled in Dwarvish: STONE, WATER, WIND. The chamber floods unless pulled in ascending weight order.',
  'A chessboard of trapped tiles — only the safe squares trace a knight\u2019s tour from the entry to the far altar.',
  'Mirrors redirect a beam of sunlight onto the heart of a statue; the beam must pass through every prism in the room first.',
  'A scale weighs "what you value least" against the lock. Drop a copper coin and the door opens; drop a diamond and alarms scream.',
  'Six musical pipes play a melody heard earlier from a ghostly bard — play it back correctly or face phantom archers.',
  'Statues of nine gods surround a fountain. Pour water on the one whose domain matches today\u2019s weather outside.',
  'Countdown glyphs count down from ten in Draconic numerals; each wrong answer subtracts two. Speak the prime numbers aloud to disarm.',
];

// ── Weather ──────────────────────────────────────────

export const WEATHER_TABLES = {
  temperate: ['clear skies', 'light breeze', 'overcast', 'steady rain', 'thunderstorm', 'dense fog', 'first frost', 'heat haze'],
  mountain: ['biting wind', 'sleet', 'snow flurries', 'whiteout blizzard', 'crystal-clear alpine cold', 'avalanche weather — distant booms', 'katabatic gusts', 'thin, starlit silence'],
  desert: ['scorching stillness', 'dust devils', 'sandstorm (visibility 10 ft)', 'cold desert night', 'simoom — the poison wind', 'mirage shimmer', 'rare deluge flooding wadis', 'locust clouds'],
  swamp: ['clinging humidity', 'drizzle', 'ground fog knee-high', 'green thunderheads', 'mosquito swarms', 'brackish downpour', 'unnatural calm — predators hunting', 'will-o-wisp lights over open water'],
  underground: ['still, stale air', 'cold draft from unknown depths', 'water drip echoing', 'sulfur vent', 'tremor rattling loose stones', 'absolute damp chill', 'strange humming in the rock', 'air pressure shift — something big moved'],
};

// ── Taverns, Rumors, Quests, Prophecies ──────────────

export const TAVERN_NAMES = [
  'The Prancing Pony', 'The Gilded Griffin', 'The Broken Tankard', 'The Sleeping Dragon',
  'The Rusty Flail', 'The Weeping Willow', 'The Crossed Swords', 'The Laughing Beholder',
  'The Salt-Stained Sail', 'The Ember & Oak', 'The Wayward Wraith', 'The Copper Kettle',
  'The Black Stag', 'The Drowned Rat', 'The Full Moon Inn', 'The Thirsty Mimic',
  'The Halfling\u2019s Rest', 'The Iron Hearth', 'The Velvet Curtains', 'The Last Coin',
];

export const RUMORS = [
  'They say the third level flooded last winter — something drowned down there that didn\u2019t stay dead.',
  'Old Man Corvin swears he saw lights in the ruined tower again. Green lights. Moving against the wind.',
  'The guild posted a bounty on a "horned terror" — 500 gold, double if taken alive. Nobody\u2019s claimed it.',
  'A merchant caravan vanished on the north road. Only hoofprints remain, leading straight into the treeline.',
  'The baron doubled the tax on iron. Blacksmiths whisper that he\u2019s arming someone quietly.',
  'There\u2019s a shrine in the hills that heals any wound — but every visitor leaves a memory behind.',
  'Fishermen pulled up a chest last week. Inside was another, smaller chest. They stopped opening them.',
  'A wandering minstrel sings about a sleeping giant under the mountain. The verses match no known tongue.',
  'The cemetery gates have been found open three mornings running. The gravedigger won\u2019t speak of it.',
  'They say a dragon\u2019s hoard lies under the millpond — that\u2019s why the water never freezes.',
  'A hooded stranger paid in ancient coins minted for a king dead four hundred years.',
  'Wolves have left the forest entirely. Hunters say whatever moved in is worse than wolves.',
  'The mine closed after the crews kept hearing their own voices calling from deeper shafts.',
  'A child went missing near the old well. The search party came back one member larger, and quieter.',
  'The temple bell rings by itself at midnight. Each ring, the priest says, counts a soul that won\u2019t rest.',
];

export const QUEST_HOOKS = [
  'A dying courier presses a sealed letter into your hands — "Deliver it… before they know it exists…"',
  'The village elder begs you to retrieve a reliquary stolen by kobolds; without it, the harvest blessing fails.',
  'A noble offers triple pay to clear the family crypt of "grandfather" — who has, apparently, gotten up.',
  'A map fragment surfaces at auction showing a wing of the dungeon no survey ever recorded.',
  'The mage\u2019s guild needs a rare reagent found only in a monster\u2019s gullet — bring gloves.',
  'Children dare each other to spend a night in the ruined fort. One hasn\u2019t come home.',
  'A captured goblin offers to lead you to his chief\u2019s treasure — for a guarantee of safety, sworn on iron.',
  'Your innkeeper\u2019s brother joined a doomsday cult in the hills. She wants him talked out of it, gently.',
  'The bridge toll has tripled because bandits took the old watchtower. Merchants are desperate.',
  'A ghost appears each dusk repeating coordinates and the word "unfinished." Treasure? Grudge? Both?',
  'The smith\u2019s apprentice forged a blade that whispers. She wants it gone before it learns names.',
  'A rival adventuring party went in three days ago. Their employer wants proof of what happened — and any survivors.',
  'Farmers report crops growing thorns overnight, spreading outward from a circle in the north field.',
  'A priest has visions of a chained thing beneath the dungeon waking link by link. He\u2019ll pay for confirmation.',
  'Someone stole the town\u2019s founding charter. Without it, a claim-jumper noble seizes everything at month\u2019s end.',
];

export const PROPHECIES = [
  '"When the seventh seal cracks and the moon runs red, the sleeper beneath the stones shall count his chains — and find one broken."',
  '"A crown of rust, a sword of glass, and a child who tells no lies: these three shall unmake the tower that never fell."',
  '"Beware the guest who brings his own chair; beware the host who sets a place for one not seen."',
  '"The river remembers what the mountain forgets. Ask the water; it asks only that you listen twice."',
  '"Two brothers, one shadow. When the shadow chooses, the brothers will learn which of them was real."',
  '"Before the last door closes, a key will grow in the garden of the dead. Harvest quickly."',
  '"The stars are a ledger. Tonight, an entry is being corrected."',
  '"What was buried singing will rise dancing. Do not join the dance."',
];

export const LEGENDS = [
  'The Sunless Citadel, where a dragon-priest grafts trees that grow human fruit.',
  'The Forge of Hephaestus-Moradin, said to still hammer out weapons for worthy hands.',
  'Castle Ravenloft, which appears in different worlds whenever its master hungers.',
  'The Tomb of Horrors, built by a lich to murder hope itself. Few enter; fewer agree with the survivors.',
  'The Lost Mine of Phandelver, where a forge of waves once shaped wonder.',
  'White Plume Mountain, a wizard\u2019s funhouse of impossible trials and a talking sword with opinions.',
  'The Isle of the Abbey, where monks guard a library of books that read their readers.',
  'Undermountain, the dungeon beneath Waterdeep — a mad archmage\u2019s labyrinth, still expanding.',
];

export const CURSES = [
  { name: 'Curse of Lycanthropy', description: 'Bitten by a werecreature under the full moon; each transformation erodes more of the mind. Remove curse fails unless cast within three days of infection.' },
  { name: 'Mummy Rot', description: 'A festering wound from a mummy\u2019s rotting fist. Cannot be healed naturally; each day costs maximum hit points. Only powerful magic cleanses it.' },
  { name: 'Cursed Item Attunement', description: 'Some items cannot be unattuned — a berserker axe that feeds rage, armor of vulnerability that doubles certain wounds. Wish or a deity\u2019s intervention frees the bearer.' },
  { name: 'Bestow Curse (classic)', description: 'Imposed by spell: disadvantage on one ability\u2019s checks and saves, inability to cast one spell type, or halved speed. Breakable by remove curse at 3rd level.' },
  { name: 'The Hollow Blessing', description: 'Granted wishes turn sour: gold turns to leaves, rescued loved ones arrive changed. Genies call this "fair dealing."' },
  { name: 'Geas', description: 'A command laid on the soul. Disobeying deals escalating psychic torment. At its strongest (9th level), disobedience is death.' },
];

export const DISEASES_AND_POISONS = [
  { name: 'Sewer Plague', description: 'Incubates silently after rat bites or bad water. Four days later: crushing fatigue and hemorrhagic fever. Con save DC 13 daily or worsen.' },
  { name: 'Cackle Fever', description: 'Mad laughter that spreads to listeners. Victims cackle until exhaustion kills them — or until someone makes them laugh genuinely instead.' },
  { name: 'Sight Rot', description: 'Contaminated water blinds gradually. Eyes cloud over three days unless treated with eyebright salve and rest.' },
  { name: 'Essence of Ether', description: 'Inhaled poison — DC 15 CON or fall unconscious for 8 hours. Assassins favor it for quiet work.' },
  { name: 'Purple Worm Poison', description: 'Injury poison harvested at terrible risk — DC 19 CON or 42 (12d6) poison damage. A single vial costs 2,000 gold.' },
  { name: 'Burnt Othur Fumes', description: 'Inhaled — initial 3d6 poison damage, then 1.5x damage daily until three consecutive successful DC 22 CON saves. Nasty, slow, lethal.' },
];

// ── Names by Culture ─────────────────────────────────

export const NAME_TABLES: Record<string, { first: string[]; last: string[] }> = {
  dwarven: {
    first: ['Thorgrim', 'Brunhild', 'Durak', 'Helga', 'Balrik', 'Greta', 'Morgran', 'Sigrid', 'Kazrak', 'Dagna'],
    last: ['Ironfoot', 'Stonehelm', 'Deepdelver', 'Goldbeard', 'Emberforge', 'Granitefist', 'Anvilborn', 'Oathhammer'],
  },
  elven: {
    first: ['Aelrindel', 'Sylvara', 'Thalion', 'Elaria', 'Faelivrin', 'Loras', 'Nimue', 'Caladwen', 'Erevan', 'Maethor'],
    last: ['Moonwhisper', 'Silverleaf', 'Dawnstrider', 'Starweaver', 'Windemere', 'Lightbough', 'Evenfall', 'Riverbloom'],
  },
  halfling: {
    first: ['Merroc', 'Pippa', 'Osborn', 'Rosie', 'Bilbo', 'Dora', 'Ferris', 'Lila', 'Milo', 'Poppy'],
    last: ['Applewhite', 'Greenbottle', 'Honeyfoot', 'Tealeaf', 'Barrowdown', 'Underbough', 'Millstone', 'Featherfall'],
  },
  orcish: {
    first: ['Grommash', 'Urzog', 'Karguk', 'Shautha', 'Mhurren', 'Vargash', 'Thokk', 'Yevelda', 'Baggi', 'Ovak'],
    last: ['Skullsplitter', 'Bloodtusk', 'Ironmaw', 'Nightmane', 'Wolfbrother', 'Stormcaller', 'Bonechewer', 'Thunderhowl'],
  },
  draconic: {
    first: ['Arjhan', 'Balasar', 'Ghesh', 'Kriv', 'Medrash', 'Rhogar', 'Torinn', 'Akra', 'Harann', 'Sora'],
    last: ['Clethtinthiallor', 'Daardendrian', 'Kepeshkmolik', 'Myastan', 'Verthisathurgiesh', 'Turnuroth', 'Prethil'],
  },
  tiefling: {
    first: ['Damakos', 'Ekemon', 'Kairon', 'Leucis', 'Mordai', 'Nezlem', 'Therai', 'Akta', 'Bryseis', 'Orianna'],
    last: ['Ambrose', 'Carrion', 'Cries-at-Dawn', 'Duskwalker', 'Hollow', 'Penance', 'Sorrowmourn', 'Thorne'],
  },
  gnomish: {
    first: ['Boddynock', 'Dimble', 'Fonkin', 'Glim', 'Namfoodle', 'Roondar', 'Seebo', 'Zook', 'Ellywick', 'Jebeddo'],
    last: ['Beren', 'Deraccius', 'Garrick', 'Timbers', 'Turen', 'Spinogrist', 'Cogsworth', 'Fizzlebang'],
  },
};

// ── Helper functions ─────────────────────────────────

import { getRandomElement } from './DnDKnowledge';

export function getCondition(id: string): ConditionEntry | undefined {
  return CONDITIONS.find(c => c.id === id);
}

export function getPlane(name: string): PlaneEntry | undefined {
  return PLANES.find(p => p.name.toLowerCase() === name.toLowerCase());
}

export function getDeity(name: string): DeityEntry | undefined {
  return DEITIES.find(d => d.name.toLowerCase() === name.toLowerCase());
}

export function generateRandomName(raceKey?: string): string {
  const table = NAME_TABLES[raceKey || getRandomElement(Object.keys(NAME_TABLES))];
  return `${getRandomElement(table.first)} ${getRandomElement(table.last)}`;
}

export function describeCondition(id: string): string {
  const cond = getCondition(id);
  if (!cond) return 'An unfamiliar affliction.';
  return `${cond.name}: ${cond.effects.join('; ')}. Common sources: ${cond.commonSources}.`;
}

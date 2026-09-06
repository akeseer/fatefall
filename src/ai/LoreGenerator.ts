/**
 * D&D Lore Generator
 * Produces rich, contextually-aware narration using the D&D Knowledge Base.
 * All generation runs locally — no external API calls.
 */

import {
  BESTIARY, SPELLS_EXPANDED, MAGIC_ITEMS, NPC_TEMPLATES, LOCATIONS,
  DUNGEON_FEATURES, COMBAT_NARRATION, ROOM_NARRATION,
  getRandomElement, getRandomEntries, getBestiaryEntry,
  getSpell, getMagicItem, getNPCTemplate, getLocation, LocationTemplate,
} from './DnDKnowledge';
import { MONSTER_TEMPLATES } from '../entities/Monster';

import {
  CONDITIONS, PLANES, DEITIES, FACTIONS, RUMORS, QUEST_HOOKS, PROPHECIES,
  LEGENDS, TAVERN_NAMES, TRAPS, PUZZLES, WEATHER_TABLES, COMBAT_RULES,
  ALIGNMENTS, SUBCLASSES, CURSES, DISEASES_AND_POISONS, LANGUAGES, FEATS,
} from './DnDGrimoire';

// ── Room Generation ──────────────────────────────────

export function generateRoomDescription(dungeonLevel: number): string {
  const size = getRandomElement(['cavernous', 'cramped', 'looming', 'vast', 'narrow', 'sprawling']);
  const feature = getRandomElement(DUNGEON_FEATURES.roomFeatures);
  const odor = getRandomElement(DUNGEON_FEATURES.odors);
  const sound = getRandomElement(DUNGEON_FEATURES.sounds);

  const templates = [
    `A ${size} chamber stretches before you, its walls lined with ${feature}. The air carries the scent of ${odor}, and ${sound} drifts from the darkness beyond.`,

    `The room opens into a ${size} space dominated by ${feature}. ${sound} echoes off the stone, and the smell of ${odor} hangs heavy in the air.`,

    `You enter a ${size} hall. ${feature.charAt(0).toUpperCase() + feature.slice(1)} catches your attention immediately. The atmosphere is thick with ${odor}, punctuated by ${sound}.`,

    `${size.charAt(0).toUpperCase() + size.slice(1)} and foreboding, this chamber features ${feature}. ${sound} provides an unsettling soundtrack to the ${odor}-scented air.`,

    `Before you lies a ${size} room. ${feature.charAt(0).toUpperCase() + feature.slice(1)} dominates the space. The air smells of ${odor}, and somewhere, ${sound}.`,
  ];

  // Higher dungeon levels get more elaborate descriptions
  if (dungeonLevel > 5) {
    const lore = getRandomElement([
      'Ancient runes flicker with dying magic along the walls.',
      'The stonework here predates any known civilization.',
      'A faint telepathic pressure presses against your mind.',
      'Something about this room feels fundamentally wrong.',
      'The shadows here seem to move independently of the light.',
    ]);
    return getRandomElement(templates) + ' ' + lore;
  }

  return getRandomElement(templates);
}

// ── Atmospheric Room Description ──────────────────────
//
// Weaves the dungeon's theme, the monsters lurking within, and the party's
// accumulated history into one evocative paragraph. Unlike the generic room
// generator above, every clause is anchored to something actually happening
// in this run.

export interface RoomMonsterClue {
  id: string;
  name: string;
  type: string;
  size: string;
}

export interface RoomPartyState {
  leaderName: string;
  deity?: string;
  background?: string;
  alignment?: string;
  /** 0..1 — average remaining HP across living members. */
  averageHpPct: number;
  exhausted: number;
  downed: number;
  dead: number;
}

export interface PartyHistory {
  kills: number;
  victories: number;
  defeats: number;
  roomsVisited: number;
  deepestLevel: number;
  /** Bestiary ledger — monster template id → lifetime kills of that kind. */
  killLedger: Record<string, number>;
}

export interface RoomDescriptionContext {
  theme: LocationTemplate;
  dungeonLevel: number;
  monsters: RoomMonsterClue[];
  party: RoomPartyState;
  history: PartyHistory;
}

/** What the presence of each monster type leaves behind in a chamber. */
const MONSTER_TYPE_CLUES: Record<string, string[]> = {
  undead: [
    'the cloying reek of grave-mold and old rot',
    'a cold that seeps up through the very stone',
    'the faint, dry scrape of something long dead',
  ],
  dragon: [
    'stone scorched black by breath that has long since cooled',
    'the glimmer of hoarded metal half-buried in ash',
    'a predatory stillness that makes the air feel thick',
  ],
  beast: [
    'fur-tufted claw marks raking the lower walls',
    'the musk of a well-used den',
    'gnawed bones heaped carelessly in a corner',
  ],
  fiend: [
    'the sulfurous reek of brimstone',
    'a heat that rises with no fire behind it',
    'smears of ash in shapes no living hand drew',
  ],
  aberration: [
    'a wrongness in the way the walls meet',
    'a whisper that curls in on itself and falls silent',
    'geometry that seems to shift when you look away',
  ],
  humanoid: [
    'the stale smell of unwashed bodies',
    "a crude camp's scattered leavings",
    'a tally of marks scratched into the wall with a blade',
  ],
  giant: [
    'flagstones cracked under some enormous weight',
    'a ceiling chipped far overhead where something tall once passed',
    'the bitter tang of old sweat and stone-dust',
  ],
  monstrosity: [
    "a predator's lair, all sour reek and matted fur",
    'deep gouges torn through the stone',
    'a nest of splintered bone and shed quills',
  ],
  ooze: [
    'the sharp bite of acid on the air',
    'pitted, half-dissolved flagstones',
    'a faint, wet sliding sound from the dark',
  ],
  construct: [
    'the rhythmic scrape of stone on stone, like a statue shifting its weight',
    'deep, dust-powdered footprints marching in perfect straight lines',
    'the heavy stillness of something that never breathes',
  ],
  fey: [
    'a ring of pale mushrooms where none grew the day before',
    'the faint, mocking echo of laughter that stops when you turn',
    'wildflowers blooming out of season in a perfect circle',
  ],
  celestial: [
    'a soft, golden light that lingers at the edge of sight',
    'the hush of a space that feels consecrated and watchful',
    'feathers, shed and luminous, glinting in the dust',
  ],
  plant: [
    'roots creeping through the cracks with unnatural purpose',
    'the sweet-sour reek of sap and turned soil',
    'leaf litter stirring as if something beneath it breathes',
  ],
  elemental: [
    'air that moves against the draft, circling the room',
    'stone grain and scorch marks arranging themselves into whorls',
    'a low, keening hum that seems to come from the walls themselves',
  ],
};

// ── Monster presence, tied to the theme's ecology ──

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six'];

/** Rough 5e plural: shadows, wraiths, goblins; duergar stays duergar. */
function pluralizeKind(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'duergar') return name;
  if (/(s|x|ch|sh)$/.test(lower)) return name + 'es';
  return name + 's';
}

/** "a shadow", "two shadows", "four stone golems" — with boss honorifics kept. */
function countedKind(name: string, count: number): string {
  if (count === 1) return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
  const plural = pluralizeKind(name);
  const word = NUMBER_WORDS[count - 1];
  return word ? `${word} ${plural}` : `${count} ${plural}`;
}

/**
 * A one-line ecology flourish for a monster kind, drawn from its bestiary
 * tactics (the first actionable sentence) so the room feels inhabited by the
 * actual creature, not a generic monster.
 */
function ecologyFlourish(id: string): string | undefined {
  const entry = getMonsterBestiaryEntry(id);
  if (!entry) return undefined;
  const t = entry.tactics;
  if (!t) return undefined;
  const firstSentence = t.split(/\.\s+/).find(s => s.length > 12);
  return firstSentence ? firstSentence.trim() : undefined;
}

/**
 * Names the monsters actually standing in the room — grouped by kind with
 * counts — and frames them as denizens of the theme's ecology, with a
 * bestiary-derived behavior for one of the kinds present.
 */
function generateMonsterPresenceClause(ctx: RoomDescriptionContext): string {
  const themeName = ctx.theme.name;
  // "The Fallen Observatory" → "Fallen Observatory" so "this Fallen Observatory"
  // reads naturally instead of "this The Fallen Observatory".
  const themeShort = themeName.replace(/^The\s+/i, '');
  const monsters = ctx.monsters;
  if (monsters.length === 0) {
    return getRandomElement([
      'for now, this chamber holds only silence and the promise of worse',
      'the room lies empty — but tracks in the dust say it was not always so',
      'nothing stirs, which somehow unsettles more than any growl would',
    ]);
  }

  // Group by kind, preserving appearance order, with live counts.
  const order: { name: string; id: string; count: number }[] = [];
  const index = new Map<string, number>();
  for (const m of monsters) {
    const key = m.id + '|' + m.name;
    if (index.has(key)) {
      order[index.get(key)!].count++;
    } else {
      index.set(key, order.length);
      order.push({ name: m.name, id: m.id, count: 1 });
    }
  }

  const roster = order.length === 1
    ? countedKind(order[0].name, order[0].count)
    : order.slice(0, -1).map(k => countedKind(k.name, k.count)).join(', ')
      + ' and ' + countedKind(order[order.length - 1].name, order[order.length - 1].count);

  // A type clue for the room, plus an ecology flourish for one kind.
  const clueType = monsters[0].type;
  const typeClue = MONSTER_TYPE_CLUES[clueType]
    ? getRandomElement(MONSTER_TYPE_CLUES[clueType])
    : 'the lingering reek of a recent occupant';
  const flourish = order.map(k => ecologyFlourish(k.id)).find(Boolean);

  const themed = [
    `It suits this ${themeShort}: ${roster} ${getRandomElement(['hold the chamber', 'keep their vigil', 'make this room their own'])}, natives of this place.`,
    `As is right for a ${themeShort}, ${roster} ${getRandomElement(['lurk here', 'have claimed this chamber', 'stir in the gloom'])}.`,
    `${roster.charAt(0).toUpperCase() + roster.slice(1)} ${getRandomElement(['wait', 'drift', 'watch'])}, denizens of this ${themeShort}.`,
    `${typeClue.charAt(0).toUpperCase() + typeClue.slice(1)} — ${roster} ${getRandomElement(['are here', 'have taken this room', 'move through the dark'])}.`,
  ];
  const sentence = getRandomElement(themed);
  return flourish ? `${sentence} ${flourish.charAt(0).toUpperCase() + flourish.slice(1)}.` : sentence;
}

export function generateAtmosphericRoomDescription(ctx: RoomDescriptionContext): string {
  const theme = ctx.theme;
  const atmosphere = getRandomElement(theme.atmosphere);
  const feature = getRandomElement(theme.features);

  // ── Monster presence ───────────────────────────────
  const monsterClause = generateMonsterPresenceClause(ctx);

  // ── Party history ──────────────────────────────────
  const historyBits: string[] = [];
  if (ctx.history.kills === 0) {
    historyBits.push('no blood of theirs has yet stained these stones');
  } else if (ctx.history.kills >= 30) {
    historyBits.push(`the ghosts of ${ctx.history.kills} fallen foes seem to crowd the shadows`);
  } else {
    historyBits.push(`${ctx.history.kills} foe${ctx.history.kills === 1 ? '' : 's'} have already fallen to this band`);
  }
  if (ctx.history.defeats > 0) {
    historyBits.push(`they still carry the bruise of ${ctx.history.defeats} bitter retreat${ctx.history.defeats === 1 ? '' : 's'}`);
  } else if (ctx.history.victories > 0) {
    historyBits.push(`unbeaten after ${ctx.history.victories} hard-won victor${ctx.history.victories === 1 ? 'y' : 'ies'}`);
  }
  if (ctx.history.roomsVisited > 12) {
    historyBits.push('weary cartographers of a dozen halls');
  }
  if (ctx.history.deepestLevel > 1) {
    historyBits.push(`they have already braved the depths to level ${ctx.history.deepestLevel}`);
  }

  // ── Party state ────────────────────────────────────
  if (ctx.party.dead > 0) {
    historyBits.push('grief rides heavy on their shoulders');
  }
  if (ctx.party.downed > 0) {
    historyBits.push('one of their number fights for every breath');
  }
  if (ctx.party.exhausted > 0) {
    historyBits.push('exhaustion drags at their limbs');
  }
  if (ctx.party.averageHpPct < 0.5) {
    historyBits.push('blood still dries on their wounds');
  }
  if (ctx.party.deity) {
    historyBits.push(`${ctx.party.leaderName} mutters a quiet oath to ${ctx.party.deity}`);
  }

  const historyClause = historyBits.length > 0
    ? getRandomElement(historyBits)
    : 'a band whose tale is only beginning to be written';

  // ── Assembly ───────────────────────────────────────
  const lead = getRandomElement([
    `Within ${theme.name.toLowerCase()}, `,
    `Deep in ${theme.name.toLowerCase()}, `,
    `${theme.name.charAt(0).toUpperCase() + theme.name.slice(1)} presses in around you as `,
  ]);

  const templates = [
    `${lead}a ${getRandomElement(['chamber', 'hall', 'space'])} opens before the party, dominated by ${feature}. ${atmosphere.charAt(0).toUpperCase() + atmosphere.slice(1)} hangs over everything. ${monsterClause} ${historyClause.charAt(0).toUpperCase() + historyClause.slice(1)}.`,
    `${lead}the party pauses. ${feature.charAt(0).toUpperCase() + feature.slice(1)} looms out of the ${getRandomElement(['torchlight', 'dark', 'gloom', 'half-light'])}, and ${atmosphere.toLowerCase()} fills the silence. ${monsterClause} ${historyClause.charAt(0).toUpperCase() + historyClause.slice(1)}.`,
    `${lead}${atmosphere.toLowerCase()} greets them, and ${feature} catches the eye at once. ${monsterClause} ${historyClause.charAt(0).toUpperCase() + historyClause.slice(1)}.`,
  ];

  // Deeper floors earn an extra brushstroke.
  const deeper = ctx.dungeonLevel > 4
    ? ' ' + getRandomElement([
        'The deeper you go, the more the walls themselves seem to breathe.',
        'Somewhere far below, something ancient turns in its sleep.',
        'The stone here predates every name carved into it.',
      ])
    : '';

  return getRandomElement(templates) + deeper;
}

// ── Combat Narration ─────────────────────────────────

export function generateHitNarration(attacker: string, defender: string, damage: number): string {
  if (damage >= 20) {
    return getRandomElement(COMBAT_NARRATION.criticalHits)
      .replace('{attacker}', attacker)
      .replace('{defender}', defender);
  }
  return getRandomElement(COMBAT_NARRATION.meleeHits)
    .replace('{attacker}', attacker)
    .replace('{defender}', defender);
}

export function generateMissNarration(attacker: string, defender: string): string {
  return getRandomElement(COMBAT_NARRATION.misses)
    .replace('{attacker}', attacker)
    .replace('{defender}', defender);
}

export function generateSpellNarration(caster: string, spellName: string): string {
  return getRandomElement(COMBAT_NARRATION.spellCasts)
    .replace('{caster}', caster)
    .replace('{spell}', spellName);
}

export function generateDeathNarration(victim: string): string {
  return getRandomElement(COMBAT_NARRATION.deaths)
    .replace('{victim}', victim);
}

export function generateVictoryNarration(): string {
  return getRandomElement(COMBAT_NARRATION.victory);
}

/**
 * Bestiary lookup that tolerates monster-template id quirks. Resolves the
 * template id ('medusa_monster' → bestiary 'medusa'), then falls back to a
 * name match so classics living in the edition lists under prefixed ids
 * ('odnd_goblin', 'orc_core', 'owlbear_knowledge'…) still resolve.
 */
export function getMonsterBestiaryEntry(monsterId: string) {
  const candidates = [monsterId, monsterId.replace(/_monster$/, '')];
  for (const id of candidates) {
    const entry = getBestiaryEntry(id);
    if (entry) return entry;
  }
  const template = MONSTER_TEMPLATES.find(t => t.id === monsterId);
  if (template) {
    const byName = BESTIARY.find(b => b.name.toLowerCase() === template.name.toLowerCase());
    if (byName) return byName;
  }
  return undefined;
}

/**
 * Unique narration the first time the party slays a creature of a given kind.
 * Weaves in the bestiary entry's lore when one exists.
 */
export function generateFirstKillNarration(monsterId: string, name: string): string {
  const entry = getMonsterBestiaryEntry(monsterId);
  if (!entry) {
    return getRandomElement([
      `The party's blades find a ${name.toLowerCase()} for the first time \u2014 the kill is added to the bestiary.`,
      `A ${name.toLowerCase()} falls \u2014 the first of its kind the party has ever slain.`,
      `They have never killed a ${name.toLowerCase()} before. Now they have.`,
    ]);
  }
  return getRandomElement([
    `${entry.name} \u2014 first of its kind slain! The party learns: ${entry.lore}`,
    `A ${entry.name.toLowerCase()} lies dead \u2014 a new entry in the party's bestiary. ${entry.description}`,
    `The party claims its first ${entry.name.toLowerCase()} kill. ${entry.tactics}`,
    `Bestiary updated: ${entry.name}. ${entry.lore} The killing blow taught them what the tomes could not.`,
  ]);
}

// ── Monster Lore Generation ──────────────────────────

export function generateMonsterDescription(monsterId: string): string {
  const entry = getBestiaryEntry(monsterId);
  if (!entry) return 'A mysterious creature lurks in the shadows.';

  const options = [
    `${entry.description} ${entry.lore}`,
    `A ${entry.size.toLowerCase()} ${entry.type}, this ${entry.name.toLowerCase()} is ${entry.alignment}. ${entry.description}`,
    `${entry.description} It is known to inhabit ${entry.habitat}. ${entry.tactics}`,
    `Behold: a ${entry.name.toLowerCase()}! ${entry.lore}`,
    `${entry.description} ${getRandomElement(['Its abilities include: ', 'Be warned — it can ', 'The truly dangerous thing is: '])}${getRandomElement(entry.abilities)}.`,
  ];

  return getRandomElement(options);
}

export function generateMonsterTactics(monsterId: string): string {
  const entry = getBestiaryEntry(monsterId);
  if (!entry) return 'The creature attacks wildly.';
  return entry.tactics;
}

// ── Spell Lore ───────────────────────────────────────

export function generateSpellDescription(spellId: string): string {
  const spell = getSpell(spellId);
  if (!spell) return 'An unknown spell crackles through the air.';

  // Get a lore-appropriate description
  const loreIntros: Record<string, string> = {
    'Evocation': 'Raw magical energy manifests as ',
    'Necromancy': 'The stench of death accompanies ',
    'Conjuration': 'Reality tears open as ',
    'Enchantment': 'A subtle pulse of power marks ',
    'Transmutation': 'The fabric of matter warps under ',
    'Abjuration': 'A shimmering ward coalesces from ',
    'Divination': 'A moment of perfect clarity accompanies ',
    'Illusion': 'Reality bends and shimmers with ',
  };

  const intro = loreIntros[spell.school] || 'The air crackles with ';
  return `${intro}${spell.name}. ${spell.description.substring(0, 120)}...`;
}

// ── NPC Dialogue Generation ──────────────────────────

export function generateNPCDialogue(npcId: string, context: 'greeting' | 'quest' | 'combat' | 'farewell'): string {
  const npc = getNPCTemplate(npcId);
  if (!npc) return '...';

  switch (context) {
    case 'greeting':
      return getRandomElement(npc.dialogueExamples.slice(0, 2));
    case 'quest':
      return npc.dialogueExamples[2] || getRandomElement(npc.dialogueExamples);
    case 'farewell':
      return npc.dialogueExamples[3] || getRandomElement(npc.dialogueExamples.slice(0, 2));
    default:
      return getRandomElement(npc.dialogueExamples);
  }
}

export function generateNPCIntroduction(npcId: string): string {
  const npc = getNPCTemplate(npcId);
  if (!npc) return 'A mysterious figure watches you.';

  return `${npc.name}, a ${npc.occupation}. ${npc.personality}. They speak with a ${npc.voice.toLowerCase()}.`;
}

// ── Location Generation ──────────────────────────────

export function generateLocationDescription(locationId: string): string {
  const loc = getLocation(locationId);
  if (!loc) return 'An unknown area stretches before you.';

  const features = getRandomEntries(loc.features, 3).join(', ');
  const atmosphere = getRandomElement(loc.atmosphere);

  return `${loc.description} Notable features include ${features}. ${atmosphere}.`;
}

// ── Treasure Generation ──────────────────────────────

export function generateTreasureDescription(dungeonLevel: number): string {
  const treasure = getRandomElement(DUNGEON_FEATURES.treasures);
  const item = getRandomElement(MAGIC_ITEMS.filter(i => {
    const rarityMap: Record<string, number> = {
      'common': 1, 'uncommon': 3, 'rare': 6, 'very rare': 10, 'legendary': 15, 'artifact': 20, 'varies': 1,
    };
    return rarityMap[i.rarity] <= dungeonLevel + 3;
  }));

  if (Math.random() < 0.05 && item) {
    // 5% chance for magic item
    return `Among the treasure, you find ${treasure}. Most remarkable is ${item.name} — ${item.description.substring(0, 100)}...`;
  }

  const gold = Math.floor(Math.random() * dungeonLevel * 50) + 10;
  return `You find ${treasure} and ${gold} gold pieces.`;
}

// ── Contextual Party Commentary ───────────────────────

export function generatePartyCommentary(
  characterName: string,
  characterClass: string,
  personality: { aggression: number; caution: number; curiosity: number; loyalty: number; greed: number },
  situation: 'entering_dungeon' | 'finding_treasure' | 'low_health' | 'seeing_monster' | 'victory' | 'defeat'
): string {
  const classQuips: Record<string, Record<string, string[]>> = {
    fighter: {
      entering_dungeon: ['"Stay sharp. I didn\'t survive this long by being careless."', '"Form up. We move as one."', '"Watch the corners. That\'s where they hide."'],
      finding_treasure: ['"Good haul. Don\'t let it slow you down."', '"Gold\'s nice, but I\'d rather have a sharp blade."'],
      low_health: ['"I\'ve had worse. Keep fighting."', '"Just a scratch. Push forward."'],
      seeing_monster: ['"Contact! Weapons ready!"', '"I see them. On my mark."'],
      victory: ['"Another battle won. Who\'s injured?"', '"A good fight. You all fought well."'],
      defeat: ['"Fall back! Live to fight another day!"', '"Retreat is not cowardice — it\'s strategy."'],
    },
    wizard: {
      entering_dungeon: ['"Fascinating architecture. Third Dynasty, if I\'m not mistaken."', '"I sense residual magic. Something powerful was here."', '"Let me examine these runes before we proceed."'],
      finding_treasure: ['"Knowledge is the true treasure. Though gold is also acceptable."', '"Is that... a spell scroll? Let me see!"'],
      low_health: ['"This is suboptimal. Retreat would be prudent."', '"My defenses are failing. I need cover!"'],
      seeing_monster: ['"I\'ve read about these. Stay back while I prepare something."', '"Let me handle this. Fireball solves most problems."'],
      victory: ['"Excellent! Remind me to document this encounter."', '"Fascinating combat patterns. I must study them."'],
      defeat: ['"A tactical withdrawal is not the same as losing!"', '"Live and learn. And read more books."'],
    },
    cleric: {
      entering_dungeon: ['"May the gods watch over us."', '"This place... I feel great evil here."', '"Stay close. My light will guide us."'],
      finding_treasure: ['"Let us be grateful for this bounty."', '"Wealth is a blessing, not a goal."'],
      low_health: ['"By divine mercy, let me heal you!"', '"Hold on. The gods are not done with you yet."'],
      seeing_monster: ['"Unholy creature! Face divine judgment!"', '"Bless our weapons and guide our strikes!"'],
      victory: ['"Give thanks. We are watched over today."', '"The light prevails over darkness."'],
      defeat: ['"Have faith. Death is not the end."', '"The gods test us. We must endure."'],
    },
    rogue: {
      entering_dungeon: ['"I\'ll scout ahead. Try not to make noise."', '"Keep your voices down. Sound travels in these tunnels."', '"I\'ve got a bad feeling about this place..."'],
      finding_treasure: ['"Now we\'re talking! This makes the whole thing worthwhile."', '"Don\'t touch that — it might be trapped. Let me check."'],
      low_health: ['"I\'m not dying in a hole like this. No way."', '"Time to make myself scarce..."'],
      seeing_monster: ['"They haven\'t seen us yet. I can get behind them."', '"Big one. I\'ll work on its blind spot."'],
      victory: ['"Not bad. Not bad at all. Did you see that backstab?"', '"Let\'s see what they were carrying..."'],
      defeat: ['"Discretion is the better part of valor!"', '"I didn\'t sign up to die!"'],
    },
  };

  const defaultQuips: Record<string, string[]> = {
    entering_dungeon: ['"Into the darkness we go..."', '"Stay together and stay alive."', '"Whatever awaits, we face it as one."'],
    finding_treasure: ['"Jackpot!"', '"This will buy a lot of ale."', '"Worth the risk."'],
    low_health: ['"Medic!"', '"I can\'t take much more of this..."', '"Falling back!"'],
    seeing_monster: ['"We\'ve got company!"', '"What in the nine hells is that?!"', '"Prepare for battle!"'],
    victory: ['"We did it!"', '"That was close."', '"Another fight, another victory."'],
    defeat: ['"Run! Now!"', '"This isn\'t over!"', '"Retreat! Everyone, retreat!"'],
  };

  const classQuip = classQuips[characterClass]?.[situation];
  const pool = classQuip || defaultQuips[situation] || ['"..."'];

  return getRandomElement(pool);
}

/**
 * Kills needed before the party "knows" a kind cold (battle-worn banter
 * + attack edge), and the higher tier that earns a sharper edge.
 * Single source of truth shared by the AI feed (main.ts) and the
 * Grimoire's Known Foes tab (DnDCompendium).
 */
export const KNOWN_FOE_KILLS = 3;
export const KNOWN_FOE_EXPERT_KILLS = 7;

export function knownFoeBonusForKills(kills: number): number {
  return kills >= KNOWN_FOE_EXPERT_KILLS ? 2 : kills >= KNOWN_FOE_KILLS ? 1 : 0;
}

/**
 * Battle-worn banter for monster kinds the party has slain many times.
 * Speaks as if the party has learned the creature's habits by killing it
 * over and over — weaving in the bestiary's tactics as hard-won advice.
 */
export function generateBattleWornBanter(
  monsterId: string,
  monsterName: string,
  kills: number,
  speaker: {
    name: string;
    classId: string;
    personality: { aggression: number; caution: number; curiosity: number; loyalty: number; greed: number };
  },
): string {
  const cleanName = monsterName.replace(/^\ud83d\udc80 /, '').replace(/^\u2620\ufe0f? /, '').replace(/ \(Boss\)$/, '');
  const plural = pluralizeKind(cleanName);
  const tactics = ecologyFlourish(monsterId);
  const { aggression, caution } = speaker.personality;

  // Tactical advice drawn from the bestiary — "we know how they fight".
  if (tactics) {
    const advice = tactics.charAt(0).toLowerCase() + tactics.slice(1);
    if (kills >= 7) {
      return getRandomElement([
        `"${plural}. We've buried ${kills} of their kind — ${advice} We've seen every trick they have."`,
        `"I could fight ${plural} in my sleep now. ${advice} That's how we've beaten ${kills} of them."`,
      ]);
    }
    return getRandomElement([
      `"We know how ${plural} fight — ${advice} ${kills} of them already lie behind us."`,
      `"These ${plural}? We've learned them the hard way. ${advice} Remember that."`,
      `"${kills} ${plural} have fallen to this band. ${advice} They hold no surprises."`,
    ]);
  }

  // No bestiary entry — plain battle-worn confidence.
  if (aggression >= 0.7) {
    return getRandomElement([
      `"${plural} again. They're just prey to us now — ${kills} already dead at our hands."`,
      `"We've butchered ${kills} of these. One more pack changes nothing."`,
    ]);
  }
  if (caution >= 0.7) {
    return getRandomElement([
      `"We've slain ${kills} ${plural}, but stay sharp — pride kills slower, but it kills."`,
      `"I know their kind well enough to fear them properly. ${kills} haven't been enough to learn all their tricks."`,
    ]);
  }
  return getRandomElement([
    `"We know ${plural}. ${kills} of them have already fallen to us — they bleed like anything else."`,
    `"${plural} again — the kind we've put ${kills} of in the ground. We can do it again."`,
    `"Been here before with their kind. ${kills} times we won. Make it ${kills + 1}."`,
  ]);
}

// ── Dungeon Lore Snapshot ────────────────────────────

export function generateDungeonLore(dungeonLevel: number): string {
  const ancientNames = [
    'Kharaz-Thûm, the Lost Delve', 'The Labyrinth of Vael', 'Grimstone Hollow',
    'The Sunken Citadel of Akar', 'Barrowmere Depths', 'The Wyrm-Wound',
    'Ironhall, the Fallen Forge', 'The Obsidian Maw', 'Silverpeak Crypts',
    'The Charnel Path', 'Nithalor\'s Rest', 'The Weeping Caverns',
    'Aurelian Gaol', 'The Shadow Rift', 'Tomb of the Nine',
    'The Salt King\'s Vault', 'Wren\'s Hospice', 'The Lantern Deep', 'The Giants\' Stair',
    'The Drowned Choir', 'Hollowcrown', 'The Amber Hall', 'The First Forge',
    'The Oubliette of Ravensfall', 'The Bell Vaults', 'Thornhollow', 'The Glass Cathedral',
  ];

  const ancientBuilders = [
    'dwarves of the Ironfist Clan, who delved too greedily',
    'a forgotten empire of serpentfolk, their civilization now dust',
    'human cultists dedicated to an unnamed god of darkness',
    'giant-kind, before their kingdoms crumbled',
    'drow exiles fleeing the destruction of their city',
    'mind flayers, who abandoned this colony when the Elder Brain perished',
    'a mad archmage who reshaped stone with a thought',
    'dragon-worshipping kobolds, over many generations',
    'the First Men, before the gods granted them language',
    'elemental beings from the Plane of Earth, for unknowable purpose',
  ];

  const purposes = [
    'a fortress against an ancient enemy',
    'a tomb for a sorcerer-king who refused to die',
    'a vault for artifacts deemed too dangerous for the surface world',
    'a prison for something that could not be killed',
    'a temple where forbidden rites were performed',
    'a mine that broke through into something that should have stayed buried',
    'a laboratory where the boundaries between planes were tested',
    'a refuge during an age when the surface world burned',
    'a proving ground for warriors seeking immortality',
    'a city that chose to hide rather than fight',
  ];

  const name = getRandomElement(ancientNames);
  const builder = getRandomElement(ancientBuilders);
  const purpose = getRandomElement(purposes);

  const templates = [
    `This place was once called ${name}. It was built by ${builder} as ${purpose}.`,
    `The crumbling walls belonged to ${name}, constructed by ${builder}. It served as ${purpose}.`,
    `Archaeologists would recognize this as ${name} — ${purpose}, built by ${builder}.`,
    `${name}: ${builder} carved this place to be ${purpose}.`,
  ];

  let result = getRandomElement(templates);

  if (dungeonLevel > 3) {
    result += ' ' + getRandomElement([
      'Those who built it are long dead, but something else has moved in.',
      'The original inhabitants are gone, replaced by creatures drawn to the lingering magic.',
      'Darkness has claimed this place, and with it, any memory of its creators.',
      'The deeper you go, the more the original purpose seems to have... changed.',
    ]);
  }

  return result;
}

// ── Full Combat Turn Narration ───────────────────────

export interface CombatTurnContext {
  attackerName: string;
  attackerClass?: string;
  defenderName: string;
  defenderType: 'party' | 'monster';
  spellName?: string;
  hit: boolean;
  damage?: number;
  critical: boolean;
  killingBlow: boolean;
}

export function generateCombatTurnNarration(ctx: CombatTurnContext): string {
  const attacker = ctx.attackerName;
  const defender = ctx.defenderName;

  if (ctx.spellName) {
    const spellNarration = generateSpellNarration(attacker, ctx.spellName);
    if (!ctx.hit) {
      return `${spellNarration} But ${defender} ${getRandomElement(['resists the magic!', 'dodges the effect!', 'shrugs it off!', 'is unaffected!'])}`;
    }
    if (ctx.killingBlow) {
      return `${spellNarration} ${defender} is ${getRandomElement(['consumed by the blast!', 'destroyed!', 'torn apart by arcane force!', 'obliterated!'])}`;
    }
    return spellNarration;
  }

  if (!ctx.hit) {
    return generateMissNarration(attacker, defender);
  }

  if (ctx.killingBlow) {
    return generateHitNarration(attacker, defender, ctx.damage || 10) + ' ' + generateDeathNarration(defender);
  }

  return generateHitNarration(attacker, defender, ctx.damage || 5);
}

// ── Grimoire Lore: conditions, planes, deities, factions ──

export function generateConditionLore(): string {
  const cond = getRandomElement(CONDITIONS);
  const intros = [
    `A veteran\u2019s warning — ${cond.name.toLowerCase()} is nothing to dismiss: ${cond.effects[0].toLowerCase()}.`,
    `${cond.name}: ${cond.effects.join('; ')}. Sources include ${cond.commonSources}.`,
    `Every adventurer learns about ${cond.name.toLowerCase()} eventually. ${cond.effects[0]}. Seen from: ${cond.commonSources}.`,
    `The party sage recalls the texts on ${cond.name.toLowerCase()}: ${cond.effects.slice(0, 2).join(', and ')}. Beware ${cond.commonSources.split(',')[0].trim()}.`,
  ];
  return getRandomElement(intros);
}

export function generatePlaneLore(match?: string): string {
  let plane = undefined as (typeof PLANES)[number] | undefined;
  if (match) {
    const m = match.toLowerCase();
    plane = PLANES.find(p => m.includes(p.name.toLowerCase().replace(/^the /, '')));
    if (!plane && m.includes('nine hell')) plane = PLANES.find(p => p.name.includes('Nine Hells'));
    if (!plane && m.includes('sigil')) plane = PLANES.find(p => p.name.startsWith('Sigil'));
  }
  plane = plane || getRandomElement(PLANES);
  const templates = [
    `${plane.name} (${plane.category}): ${plane.description} Dangers: ${plane.dangers}.`,
    `The old maps speak of ${plane.name} — ${plane.description} Its denizens include ${plane.denizens}.`,
    `Scholars classify ${plane.name} among the ${plane.category.toLowerCase()} realms. ${plane.description}`,
    `${plane.name}. ${plane.description} Those who travel there risk: ${plane.dangers}.`,
  ];
  return getRandomElement(templates);
}

export function generateDeityLore(): string {
  const deity = getRandomElement(DEITIES);
  const templates = [
    `${deity.name}, ${deity.alignment} god of ${deity.portfolio} (Domains: ${deity.domains}). Symbol: ${deity.symbol}. ${deity.lore}`,
    `${deity.name} watches over ${deity.portfolio}. ${deity.lore} Followers mark themselves with ${deity.symbol.toLowerCase()}.`,
    `Clerics of the ${deity.domains} domains serve ${deity.name} — ${deity.alignment}, patron of ${deity.portfolio}. ${deity.lore}`,
  ];
  return getRandomElement(templates);
}

export function generateFactionLore(): string {
  const faction = getRandomElement(FACTIONS);
  return `${faction.name} — "${faction.motto}" ${faction.description} Reputation: ${faction.reputation}.`;
}

export function generateRumor(dungeonName?: string): string {
  const where = dungeonName ? ` Somewhere in ${dungeonName}, perhaps.` : '';
  return getRandomElement(RUMORS) + where;
}

export function generateQuestHook(): string {
  return getRandomElement(QUEST_HOOKS);
}

export function generateProphecy(): string {
  return getRandomElement(PROPHECIES);
}

export function generateLegendTale(): string {
  const legend = getRandomElement(LEGENDS);
  return `Around the fire, someone speaks of ${legend}`;
}

export function generateTavernScene(): string {
  const name = getRandomElement(TAVERN_NAMES);
  const rumor = getRandomElement(RUMORS);
  return `The ${name} is loud tonight. Over the din, you catch a rumor: "${rumor}"`;
}

export function generateTrapLore(): string {
  const trap = getRandomElement(TRAPS);
  return `Dungeon lore — ${trap.name}: triggers on ${trap.trigger}. Effect: ${trap.effect}. Spotting it: ${trap.dc}.`;
}

export function generatePuzzleLore(): string {
  return `Ancient builders left their marks: ${getRandomElement(PUZZLES)}`;
}

export function generateWeatherLore(biome?: keyof typeof WEATHER_TABLES): string {
  const table = biome && WEATHER_TABLES[biome] ? WEATHER_TABLES[biome] : getRandomElement(Object.values(WEATHER_TABLES));
  return `The weather turns: ${getRandomElement(table)}.`;
}

export function generateRuleLore(): string {
  const rule = getRandomElement(COMBAT_RULES);
  return `${rule.rule}: ${rule.explanation} ${rule.tips}`;
}

export function generateAlignmentMusing(match?: string): string {
  let align = ALIGNMENTS[4];
  if (match) {
    const m = match.toLowerCase();
    const found = ALIGNMENTS.find(a => {
      const words = a.name.toLowerCase().split(' ');
      return words.every(w => m.includes(w));
    });
    align = found || getRandomElement(ALIGNMENTS);
  } else {
    align = getRandomElement(ALIGNMENTS);
  }
  return `${align.name} — ${align.description} Think: ${align.exampleCreatures}.`;
}

export function describeSubclass(classId: string): string {
  const subs = SUBCLASSES[classId];
  if (!subs || subs.length === 0) return 'This tradition keeps no formal schools.';
  return `Traditions of the craft: ${subs.join('; ')}.`;
}

export function describeSubclassFromText(text: string): string {
  const lower = text.toLowerCase();
  for (const classId of Object.keys(SUBCLASSES)) {
    if (lower.includes(classId)) return describeSubclass(classId);
  }
  const classId = getRandomElement(Object.keys(SUBCLASSES));
  return describeSubclass(classId);
}

export function generateCurseLore(): string {
  const curse = getRandomElement(CURSES);
  return `${curse.name}: ${curse.description}`;
}

export function generateDiseaseLore(): string {
  const ailment = getRandomElement(DISEASES_AND_POISONS);
  return `${ailment.name}: ${ailment.description}`;
}

export function generateLanguageLore(): string {
  const lang = getRandomElement(LANGUAGES);
  return `${lang.language} — spoken by ${lang.speakers}; written in ${lang.script}.`;
}

export function generateFeatLore(): string {
  const feat = getRandomElement(FEATS);
  return `${feat.feat}: ${feat.effect}`;
}
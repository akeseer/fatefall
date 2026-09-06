import { alignmentForKind, WORDLESS_KINDS, KIND_LABEL } from '../entities/MonsterKinds';
import {
  ALIGNMENTS,
  ABILITY_SCORES,
  SKILLS,
  CONDITIONS,
  DAMAGE_TYPES,
  SCHOOLS_OF_MAGIC,
  LANGUAGES,
  COMBAT_ACTIONS,
  COMBAT_RULES,
  FEATS,
  BACKGROUNDS,
  SUBCLASSES,
  PLANES,
  DEITIES,
  FACTIONS,
  TRAPS,
} from '../ai/DnDGrimoire';
import {
  BESTIARY,
  SPELLS_EXPANDED,
  MAGIC_ITEMS,
  NPC_TEMPLATES,
  LOCATIONS,
} from '../ai/DnDKnowledge';
import { MONSTER_TEMPLATES, type MonsterTemplate } from '../entities/Monster';
import { SPELLS as PLAYABLE_SPELLS, getCasterType, isCaster, ordinal } from '../data/gameData';
import { LOOT_TIER_GUIDES } from '../loot/LootTables';
import type { Party } from '../entities/Party';
import {
  knownFoeBonusForKills,
  KNOWN_FOE_KILLS,
  KNOWN_FOE_EXPERT_KILLS,
} from '../ai/LoreGenerator';
import { T } from './Theme';

// Lookups linking compendium lore to playable content.
const MONSTER_BY_NAME = new Map(MONSTER_TEMPLATES.map(t => [t.name.toLowerCase(), t]));
const PLAYABLE_SPELL_BY_NAME = new Map(PLAYABLE_SPELLS.map(s => [s.name.toLowerCase(), s]));

/** What a slain creature of this CR yields, drawn from the live loot tables. */
function lootSummaryForCr(cr: number): string {
  const tier = LOOT_TIER_GUIDES[cr < 5 ? 0 : cr <= 10 ? 1 : cr <= 16 ? 2 : 3];
  return tier
    ? `Corpse loot: ${tier.coinScale} in coin. Gems: ${tier.gem}. Art: ${tier.art}. Consumables: ${tier.consumable}. Magic items: ${tier.magic}. Hoard chance ${tier.hoard}. \u201c${tier.flavor}\u201d`
    : 'Corpse loot scales with challenge rating — small beasts carry coin pouches, titans guard hoards.';
}

/** Deterministic lore/tactics/habitat synthesis per creature type. */
const TYPE_FLAVOR: Record<string, { lore: string; habitat: string }> = {
  beast: { lore: 'A creature of the wild, governed by hunger and instinct. Sages catalog its kind in the field guides of the Emerald Tower, noting its place in the chain of teeth.', habitat: 'Wilderness, forests, plains, mountains, waterways' },
  undead: { lore: 'An animated remnant of the dead, bound to this world by spite, unfinished business, or necromantic will. Clerics of the Dawnspear teach that every undead is a soul that was denied its rest.', habitat: 'Tombs, battlefields, ruins, barrows, shadow-places' },
  humanoid: { lore: 'A thinking folk with culture, tools, and ambitions of its own — warrior, thief, priest, or tyrant. They trade, raid, and build, and their wars shake the map every generation.', habitat: 'Settlements, camps, strongholds, roads, ruins' },
  dragon: { lore: 'A drake of the old blood, scaled and ancient, whose hoard and ego shaped the geography around its lair. Dragons remember centuries, and they hold grudges longer.', habitat: 'High lairs, mountain crags, cavern vaults, ruins they claim' },
  aberration: { lore: 'A thing from beyond the natural order — the Far Realm, the deep dark, or the space between stars. Aberrations think in geometries that break the mind that maps them.', habitat: 'The Underdark, alien ruins, sunken places, the Far Realm\u2019s edge' },
  fiend: { lore: 'A native of the lower planes, carrying the weight of its hellish or abyssal origin. Deals with fiends always read well and always end badly.', habitat: 'The Nine Hells, the Abyss, cursed temples, shadow corruption' },
  giant: { lore: 'A titan-kin whose ancestors once walked the world as its masters. Giants keep ancient grudges, storm oaths, and doorways built to their size.', habitat: 'Mountain holds, cloud palaces, glacial halls, giant-built ruins' },
  monstrosity: { lore: 'A hybrid or warped creature that defies easy classification — bred in a wizard\u2019s vat, cursed in a god\u2019s tantrum, or simply too strange for the naturalists.', habitat: 'Anywhere strange: deep caves, cursed wilds, wizard ruins' },
  ooze: { lore: 'A mindless, amorphous predator of mucus and hunger, often the final resident of a flooded tomb. Oozes dissolve everything they touch, including the mapmaker.', habitat: 'Dungeon depths, sewers, flooded ruins, caves' },
  construct: { lore: 'A machine of magic and craft — guardian, servant, or war engine left running long after its maker died. Constructs obey their last command without mercy.', habitat: 'Wizard towers, dwarven halls, vaults, ancient workshops' },
  fey: { lore: 'A creature of the Feywild, where promises are law and names have weight. Fey keep their bargains to the letter — and exploit yours the same way.', habitat: 'Feywild glades, ancient forests, standing stones, faerie rings' },
  celestial: { lore: 'A servant of the upper planes, sworn to guard the worthy and burn the wicked. Celestials rarely intervene directly — but when they do, mortal war ends.', habitat: 'Celestial courts, radiant temples, mountaintop shrines, holy ground' },
  plant: { lore: 'A sentient growth with roots older than the kingdom. Plants of this kind remember rainfalls and armies, and they do not forgive chainsaws.', habitat: 'Deep forests, overgrown ruins, groves, swamps' },
  elemental: { lore: 'A being of raw elemental matter given purpose — fire that hates, water that remembers, earth that waits. Summoned or free, elementals serve their nature utterly.', habitat: 'Elemental nodes, volcanoes, storms, deep water, living stone' },
};

/** Build a bestiary entry from a playable stat block when no curated lore exists. */
function synthesizeBestiary(t: MonsterTemplate): (typeof BESTIARY)[number] {
  const flavor = TYPE_FLAVOR[t.type] ?? TYPE_FLAVOR.monstrosity!;
  const scoreLabels: string[] = [];
  if (t.abilities.str >= 16) scoreLabels.push('Powerful Build — raw strength that bends doors and armor');
  if (t.abilities.dex >= 16) scoreLabels.push('Lightning Reflexes — blurs through attacks and ambushes');
  if (t.abilities.con >= 16) scoreLabels.push('Enduring — shrugs off blows that fell lesser creatures');
  if (t.abilities.int >= 14) scoreLabels.push('Cunning — plans beyond simple predator instinct');
  if (t.abilities.wis >= 14) scoreLabels.push('Keen Senses — notices what hides in shadow');
  if (t.abilities.cha >= 14) scoreLabels.push('Commanding Presence — its will presses on the party');
  if (scoreLabels.length === 0) scoreLabels.push('Single-Minded — relentless and uncomplicated in its attacks');
  const aggression = t.hp >= 90 || t.damageDice >= 2
    ? `Trades blows fearlessly; closing distance is its whole plan, and its ${t.damageDice}d${t.damageDie} strikes make the approach costly.`
    : `Strikes opportunistically — sets up the ${t.damageDice}d${t.damageDie} hit, then falls back or circles for another opening.`;
  const hpDice = Math.max(1, Math.round(t.hp / 8));
  return {
    id: t.id,
    name: t.name,
    type: KIND_LABEL[t.type] ?? t.type,
    size: t.size,
    alignment: alignmentForKind(t.type, t.cr),
    cr: t.cr,
    ac: t.ac,
    hp: `${t.hp} (${hpDice}d8 + ${Math.max(0, t.hp - hpDice * 4)})`,
    speed: `${t.speed} ft.`,
    description: t.description || `A ${t.size.toLowerCase()} ${t.type} that the party\u2019s field guides describe with a warning and a sketch.`,
    lore: `${flavor.lore} This particular kind — ${t.name.toLowerCase()} — is ${t.cr >= 17 ? 'a legend spoken of in frightened tavern whispers, worth a saga if survived' : t.cr >= 9 ? 'a seasoned predator that experienced adventurers respect and name aloud' : 'a common hazard that wayfarers are taught to recognize'}.`,
    tactics: `Fights with an AC of ${t.ac} and ${t.hp} hit points. ${aggression}`,
    habitat: flavor.habitat,
    abilities: ['Multiattack', ...scoreLabels],
    languages: WORDLESS_KINDS.has(t.type) ? ['\u2014'] : ['Undercommon or regional dialects'],
    senses: [`darkvision 60 ft.`, `passive Perception ${8 + Math.floor(t.abilities.wis / 2)}`],
  };
}


/**
 * Playable monster template id → bestiary lore entry. Resolves the id quirks
 * (template 'will_o_wisp_monster' → bestiary 'will_o_wisp') and falls back to
 * a name match for classics (goblin, skeleton, orc…) whose bestiary entries
 * live in the edition lists under prefixed ids like 'odnd_skeleton'.
 *
 * Every template is guaranteed a page: when no curated lore exists, the entry
 * is synthesized from the stat block so the whole 600+ roster stays browsable
 * and unlockable in Known Foes.
 */
const BESTIARY_BY_TEMPLATE_ID = new Map<string, (typeof BESTIARY)[number]>();
for (const t of MONSTER_TEMPLATES) {
  const stripped = t.id.replace(/_monster$/, '');
  const creature = BESTIARY.find(c => c.id === t.id)
    || BESTIARY.find(c => c.id === stripped)
    || BESTIARY.find(c => c.name.toLowerCase() === t.name.toLowerCase());
  BESTIARY_BY_TEMPLATE_ID.set(t.id, creature ?? synthesizeBestiary(t));
}
// Reverse lookup: bestiary entry id → playable template id (for kill badges).
const TEMPLATE_BY_BESTIARY_ID = new Map<string, string>();
for (const [templateId, creature] of BESTIARY_BY_TEMPLATE_ID) {
  TEMPLATE_BY_BESTIARY_ID.set(creature.id, templateId);
}

type Detail = { label: string; value: string };

export type CompendiumActionKind = 'summon-monster' | 'teach-spell' | 'faction' | 'deity';

export interface CompendiumEntry {
  id: string;
  name: string;
  category: string;
  subtitle: string;
  details: Detail[];
  /** Present when reading this entry can affect the living dungeon. */
  action?: { kind: CompendiumActionKind; refId: string };
}

const CATEGORY_ORDER = [
  'Known Foes', 'Bestiary', 'Spells', 'Magic Items', 'Rules', 'Conditions', 'Character Options',
  'Planes', 'Deities', 'Factions', 'NPCs', 'Locations',
];

/** The playable MonsterTemplate types (the 14-type union in Monster.ts). */
const MONSTER_TYPES = [
  'beast', 'undead', 'humanoid', 'dragon', 'aberration', 'fiend', 'giant',
  'monstrosity', 'ooze', 'construct', 'fey', 'celestial', 'plant', 'elemental',
];

interface CrBucket { label: string; min: number; max: number; }
const CR_BUCKETS: CrBucket[] = [
  { label: 'CR < 1', min: -Infinity, max: 0.99 },
  { label: 'CR 1\u20134', min: 1, max: 4 },
  { label: 'CR 5\u20138', min: 5, max: 8 },
  { label: 'CR 9\u201312', min: 9, max: 12 },
  { label: 'CR 13\u201316', min: 13, max: 16 },
  { label: 'CR 17+', min: 17, max: Infinity },
];

function detail(label: string, value: unknown): Detail {
  return { label, value: Array.isArray(value) ? value.join(', ') : String(value) };
}

/**
 * The Bestiary's pinned loot guide — documents what each CR tier's corpse
 * yields, drawn from the same constants the loot tables actually roll with.
 */
function buildLootGuideEntry(): CompendiumEntry {
  const tierRows = LOOT_TIER_GUIDES.map(g => detail(
    `Tier ${g.crRange}`,
    `${g.coinScale} in coin\nGems: ${g.gem}.\nArt: ${g.art}.\nConsumables: ${g.consumable}.\nMagic items: ${g.magic}.\nBoss-hoard magic: ${g.hoard}.\n\"${g.flavor}\"`
  ));
  return {
    id: 'bestiary:loot-guide',
    name: '\uD83D\uDCDC Loot Guide',
    category: 'Bestiary',
    subtitle: 'What a corpse yields \u2014 treasure tables by CR',
    details: [
      detail('How Loot Works', 'Every slain creature rolls its own individual treasure scaled to its challenge rating: DMG coin tables, plus gems, art objects, consumables, and magic items whose chance and quality rise steeply with CR. The bigger the beast, the better the haul.'),
      ...tierRows,
      detail('Boss Hoards', 'Floor bosses and legendary monsters always guard a hoard \u2014 a far larger coin pile, extra gems and art, and a magic item at the tier\u2019s chance. After any other victory a small chance of a hoard exists, rising with dungeon level.'),
      detail('Themed Drops', 'Magic items lean \u224870% toward the creature\u2019s kind: a pit fiend\u2019s corpse runs to Efreeti Bottles and brimstone, a lich\u2019s cache to cold relics, a dragon\u2019s hoard to draconic grandeur. The rest stays generic, so a hint of the unexpected survives.'),
    ],
  };
}

function buildEntries(): CompendiumEntry[] {
  const entries: CompendiumEntry[] = [];

  // Pinned first in the Bestiary: the treasure-table reference page.
  entries.push(buildLootGuideEntry());

  for (const creature of BESTIARY) {
    const entry: CompendiumEntry = {
      id: `bestiary:${creature.id}`,
      name: creature.name,
      category: 'Bestiary',
      subtitle: `${creature.type} | CR ${creature.cr} | ${creature.size}`,
      details: [
        detail('Armor Class', creature.ac),
        detail('Hit Points', creature.hp),
        detail('Speed', creature.speed),
        detail('Alignment', creature.alignment),
        detail('Description', creature.description),
        detail('Lore', creature.lore),
        detail('Tactics', creature.tactics),
        detail('Habitat', creature.habitat),
        detail('Abilities', creature.abilities),
        detail('Languages', creature.languages),
        detail('Senses', creature.senses),
        detail('Loot', lootSummaryForCr(creature.cr)),
      ],
    };
    const template = MONSTER_BY_NAME.get(creature.name.toLowerCase());
    if (template) entry.action = { kind: 'summon-monster', refId: template.id };
    entries.push(entry);
  }

  // Every playable template gets its own bestiary page — curated when the
  // lore books cover it, synthesized from its stat block otherwise — so the
  // full roster is browsable, filterable, and unlockable in Known Foes.
  const curatedTemplateIds = new Set(BESTIARY_BY_TEMPLATE_ID.keys());
  for (const template of MONSTER_TEMPLATES) {
    if (curatedTemplateIds.has(template.id)) continue;
    const creature = synthesizeBestiary(template);
    const entry: CompendiumEntry = {
      id: `bestiary:${template.id}`,
      name: creature.name,
      category: 'Bestiary',
      subtitle: `${creature.type} | CR ${creature.cr} | ${creature.size}`,
      details: [
        detail('Armor Class', creature.ac),
        detail('Hit Points', creature.hp),
        detail('Speed', creature.speed),
        detail('Alignment', creature.alignment),
        detail('Description', creature.description),
        detail('Lore', creature.lore),
        detail('Tactics', creature.tactics),
        detail('Habitat', creature.habitat),
        detail('Abilities', creature.abilities),
        detail('Languages', creature.languages),
        detail('Senses', creature.senses),
        detail('Loot', lootSummaryForCr(creature.cr)),
      ],
    };
    // Playable by construction — a template always has a summonable stat block.
    entry.action = { kind: 'summon-monster', refId: template.id };
    entries.push(entry);
  }

  for (const spell of SPELLS_EXPANDED) {
    const playable = PLAYABLE_SPELL_BY_NAME.get(spell.name.toLowerCase());
    const details: Detail[] = [
      detail('Casting Time', spell.castingTime),
      detail('Range', spell.range),
      detail('Components', spell.components),
      detail('Duration', spell.duration),
      detail('Classes', spell.classes),
      detail('Effect', spell.description),
      ...(spell.higherLevels ? [detail('At Higher Levels', spell.higherLevels)] : []),
    ];
    // Cantrips scale with character level: +1 damage die at 5th, 11th, 17th.
    if (spell.level <= 0 && playable?.damage) {
      const m = playable.damage.match(/^(\d+)d(\d+)/);
      if (m) {
        const base = parseInt(m[1], 10);
        const die = m[2];
        const progression = [1, 2, 3, 4].map(c => `${base * c}d${die}`).join(' \u2192 ');
        details.push(detail('Scaling', `Cantrip damage grows with character level: ${progression} at levels 1, 5, 11, and 17 \u2014 the extra dice kick in at 5th, 11th, and 17th level.`));
      }
    }
    const entry: CompendiumEntry = {
      id: `spell:${spell.id}`,
      name: spell.name,
      category: 'Spells',
      subtitle: `Level ${spell.level} ${spell.school} | ${spell.classes.join(', ')}`,
      details,
    };
    if (playable) entry.action = { kind: 'teach-spell', refId: playable.id };
    entries.push(entry);
  }

  for (const item of MAGIC_ITEMS) {
    entries.push({
      id: `item:${item.id}`,
      name: item.name,
      category: 'Magic Items',
      subtitle: `${item.rarity} | ${item.type}`,
      details: [
        detail('Type', item.type),
        detail('Rarity', item.rarity),
        detail('Attunement', item.attunement ? 'Required' : 'Not required'),
        detail('Effect', item.description),
      ],
    });
  }

  for (const alignment of ALIGNMENTS) {
    entries.push({ id: `alignment:${alignment.id}`, name: alignment.name, category: 'Rules', subtitle: 'Alignment', details: [detail('Meaning', alignment.description), detail('Examples', alignment.exampleCreatures)] });
  }
  for (const ability of ABILITY_SCORES) {
    entries.push({ id: `ability:${ability.id}`, name: ability.name, category: 'Rules', subtitle: 'Ability Score', details: [detail('Use', ability.description)] });
  }
  for (const skill of SKILLS) {
    entries.push({ id: `skill:${skill.name}`, name: skill.name, category: 'Rules', subtitle: `${skill.ability} skill`, details: [detail('Ability', skill.ability), detail('Use', skill.description)] });
  }
  for (const action of COMBAT_ACTIONS) {
    entries.push({ id: `action:${action.action}`, name: action.action, category: 'Rules', subtitle: action.cost, details: [detail('Cost', action.cost), detail('Rule', action.note)] });
  }
  for (const rule of COMBAT_RULES) {
    entries.push({ id: `rule:${rule.rule}`, name: rule.rule, category: 'Rules', subtitle: 'Combat rule', details: [detail('Rule', rule.explanation), detail('Table Tip', rule.tips)] });
  }
  for (const damage of DAMAGE_TYPES) {
    entries.push({ id: `damage:${damage.type}`, name: damage.type, category: 'Rules', subtitle: 'Damage type', details: [detail('Use', damage.note)] });
  }
  for (const school of SCHOOLS_OF_MAGIC) {
    entries.push({ id: `school:${school.school}`, name: school.school, category: 'Rules', subtitle: 'School of magic', details: [detail('Focus', school.description)] });
  }
  for (const language of LANGUAGES) {
    entries.push({ id: `language:${language.language}`, name: language.language, category: 'Rules', subtitle: 'Language', details: [detail('Speakers', language.speakers), detail('Script', language.script)] });
  }

  for (const condition of CONDITIONS) {
    entries.push({ id: `condition:${condition.id}`, name: condition.name, category: 'Conditions', subtitle: 'Condition', details: [detail('Effects', condition.effects), detail('Common Sources', condition.commonSources)] });
  }

  for (const feat of FEATS) {
    entries.push({ id: `feat:${feat.feat}`, name: feat.feat, category: 'Character Options', subtitle: 'Feat', details: [detail('Benefit', feat.effect)] });
  }
  for (const background of BACKGROUNDS) {
    entries.push({ id: `background:${background.name}`, name: background.name, category: 'Character Options', subtitle: background.skills, details: [detail('Skills', background.skills), detail('Feature', background.feature), detail('Origin', background.description)] });
  }
  for (const [className, subclasses] of Object.entries(SUBCLASSES)) {
    entries.push({ id: `subclasses:${className}`, name: `${className} subclasses`, category: 'Character Options', subtitle: `${subclasses.length} paths`, details: [detail('Options', subclasses)] });
  }

  for (const plane of PLANES) {
    entries.push({ id: `plane:${plane.name}`, name: plane.name, category: 'Planes', subtitle: plane.category, details: [detail('Description', plane.description), detail('Dangers', plane.dangers), detail('Denizens', plane.denizens)] });
  }
  for (const deity of DEITIES) {
    const entry: CompendiumEntry = { id: `deity:${deity.name}`, name: deity.name, category: 'Deities', subtitle: `${deity.alignment} | ${deity.portfolio}`, details: [detail('Portfolio', deity.portfolio), detail('Alignment', deity.alignment), detail('Domains', deity.domains), detail('Symbol', deity.symbol), detail('Lore', deity.lore)] };
    entry.action = { kind: 'deity', refId: deity.name };
    entries.push(entry);
  }
  for (const faction of FACTIONS) {
    const entry: CompendiumEntry = { id: `faction:${faction.name}`, name: faction.name, category: 'Factions', subtitle: faction.motto, details: [detail('Motto', faction.motto), detail('Description', faction.description), detail('Goals', faction.goals), detail('Reputation', faction.reputation)] };
    entry.action = { kind: 'faction', refId: faction.name };
    entries.push(entry);
  }
  for (const npc of NPC_TEMPLATES) {
    entries.push({ id: `npc:${npc.id}`, name: npc.name, category: 'NPCs', subtitle: npc.occupation, details: [detail('Personality', npc.personality), detail('Voice', npc.voice), detail('Motivation', npc.motivation), detail('Knowledge', npc.knowledge), detail('Sample Dialogue', npc.dialogueExamples)] });
  }
  for (const location of LOCATIONS) {
    entries.push({ id: `location:${location.id}`, name: location.name, category: 'Locations', subtitle: location.category, details: [detail('Description', location.description), detail('Monsters', location.commonMonsters), detail('Features', location.features), detail('Atmosphere', location.atmosphere)] });
  }
  for (const trap of TRAPS) {
    entries.push({ id: `trap:${trap.name}`, name: trap.name, category: 'Rules', subtitle: 'Trap', details: [detail('Trigger', trap.trigger), detail('Effect', trap.effect), detail('Detection / Escape', trap.dc)] });
  }

  return entries;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

function actionLabel(kind: CompendiumActionKind): string {
  switch (kind) {
    case 'summon-monster': return '\u2694 Conjure an Encounter';
    case 'teach-spell': return '\u2726 Teach This Spell';
    case 'faction': return '\u2691 Summon Its Agents';
    case 'deity': return '\u263c Manifest a Shrine';
  }
}

export class DnDCompendium {
  /** Fired when the reader acts on an entry (conjure, teach, summon, recite). */
  public onAction?: (entry: CompendiumEntry, mode: 'encounter' | 'legend') => void;
  /** Provides the live party so spell pages can show real, current slots. */
  public partyProvider?: () => Party | null;
  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** Provides the kill ledger so the Known Foes tab tracks what was slain. */
  public killLedgerProvider?: () => Record<string, number>;
  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** Provides expedition journal entries for the Expedition tab. */
  public expeditionJournalProvider?: () => string[];

  private host: HTMLElement;
  private panel: HTMLElement;
  private list: HTMLElement;
  private detailPane: HTMLElement;
  private search: HTMLInputElement;
  private category: HTMLSelectElement;
  private typeFilter: HTMLSelectElement;
  private crFilter: HTMLSelectElement;
  private playableOnly: HTMLInputElement;
  private entries: CompendiumEntry[] = buildEntries();
  private filteredEntries: CompendiumEntry[] = this.entries;
  private selectedId: string = this.entries[0]?.id || '';
  private lastLedgerSig: string = '';

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.insertAdjacentHTML('beforeend', `
      <div id="compendium-overlay" class="dp-theme" style="display:none; position:absolute; inset:0; z-index:97; background:radial-gradient(ellipse at 50% 28%, #14100c 0%, #0a0808 60%, #050405 100%); color:${T.text};">
        <div style="height:100%; display:flex; flex-direction:column; padding:18px; box-sizing:border-box;">
          <div style="display:flex; align-items:center; gap:10px; border-bottom:1px solid #2a3242; padding-bottom:12px;">
            <div class="dp-title" style="flex:1; color:#e8c56a; font-size:19px; font-weight:700; letter-spacing:2px; text-shadow:0 0 14px rgba(232,197,106,0.28);">D&D Compendium</div>
            <div style="color:#8a94a6; font-size:11px;" id="compendium-count"></div>
            <button id="btn-close-compendium" class="dp-btn-gold" title="Close compendium" style="padding:5px 12px; font-size:12px; cursor:pointer;">Close</button>
          </div>
          <div style="display:flex; gap:8px; margin:12px 0 8px;">
            <input id="compendium-search" type="search" placeholder="Search creatures, spells, rules..." style="flex:1; min-width:0; padding:8px;">
            <select id="compendium-category" style="width:180px; padding:8px;"></select>
          </div>
          <div style="display:flex; gap:8px; margin:0 0 12px; align-items:center;">
            <select id="compendium-type" title="Filter by monster type" style="width:160px; padding:8px;"></select>
            <select id="compendium-cr" title="Filter by challenge rating" style="width:130px; padding:8px;"></select>
            <label id="compendium-playable-label" title="Only kinds with a playable stat block & sprite (the 124-monster roster)" style="color:#b8a; font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer; user-select:none;">
              <input type="checkbox" id="compendium-playable" checked style="cursor:pointer;"> Playable only
            </label>
            <button id="compendium-reset" class="dp-btn" title="Clear all filters" style="padding:6px 12px; cursor:pointer; font-size:11px;">Reset</button>
          </div>
          <div style="flex:1; min-height:0; display:flex; gap:12px;">
            <div id="compendium-list" style="width:37%; min-width:220px; overflow-y:auto; border-right:1px solid #30313d; padding-right:8px;"></div>
            <div id="compendium-detail" style="flex:1; min-width:0; overflow-y:auto; padding:4px 10px;"></div>
          </div>
        </div>
      </div>
    `);

    this.panel = this.host.querySelector('#compendium-overlay')!;
    this.list = this.host.querySelector('#compendium-list')!;
    this.detailPane = this.host.querySelector('#compendium-detail')!;
    this.search = this.host.querySelector('#compendium-search') as HTMLInputElement;
    this.category = this.host.querySelector('#compendium-category') as HTMLSelectElement;
    this.typeFilter = this.host.querySelector('#compendium-type') as HTMLSelectElement;
    this.crFilter = this.host.querySelector('#compendium-cr') as HTMLSelectElement;
    this.playableOnly = this.host.querySelector('#compendium-playable') as HTMLInputElement;

    this.category.innerHTML = '<option value="All">All categories</option>' + CATEGORY_ORDER.map(name => `<option value="${name}">${name}</option>`).join('') + '<option value="Expedition">Expedition Journal</option>';
    this.typeFilter.innerHTML = '<option value="All">All types</option>' + MONSTER_TYPES.map(name => `<option value="${name}">${name[0].toUpperCase()}${name.slice(1)}</option>`).join('');
    this.crFilter.innerHTML = '<option value="All">All CRs</option>' + CR_BUCKETS.map(b => `<option value="${b.label}">${b.label}</option>`).join('');
    this.search.addEventListener('input', () => this.refresh());
    this.category.addEventListener('change', () => this.refresh());
    this.typeFilter.addEventListener('change', () => this.refresh());
    this.crFilter.addEventListener('change', () => this.refresh());
    this.playableOnly.addEventListener('change', () => this.refresh());
    this.host.querySelector('#compendium-reset')!.addEventListener('click', () => this.resetFilters());
    this.host.querySelector('#btn-close-compendium')!.addEventListener('click', () => this.close());
    this.detailPane.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest('[data-compendium-action]') as HTMLElement | null;
      if (!target) return;
      const entry = this.filteredEntries.find(e => e.id === this.selectedId)
        || this.entries.find(e => e.id === this.selectedId);
      if (!entry || !entry.action) return;
      const mode = target.dataset.compendiumAction === 'legend' ? 'legend' : 'encounter';
      this.onAction?.(entry, mode);
      if (mode === 'encounter') this.close();
    });
    this.list.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const row = target.closest('[data-entry-id]') as HTMLElement | null;
      if (row) {
        this.selectedId = row.dataset.entryId || this.selectedId;
        this.renderList();
        this.renderDetail();
      }
    });
    this.refresh();
  }

  open() {
    this.panel.style.display = 'block';
    this.search.focus();
  }

  close() {
    this.panel.style.display = 'none';
  }

  toggle() {
    if (this.panel.style.display === 'none') this.open();
    else this.close();
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** Bestiary entry id ("bestiary:medusa") → kills recorded for that kind. */
  private killsForBestiaryEntry(entry: CompendiumEntry): number {
    if (!entry.id.startsWith('bestiary:')) return 0;
    const creatureId = entry.id.slice('bestiary:'.length);
    const templateId = TEMPLATE_BY_BESTIARY_ID.get(creatureId);
    if (!templateId) return 0;
    return (this.killLedgerProvider?.() ?? {})[templateId] ?? 0;
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /**
   * Build Expedition Journal entries from the live journal array.
   */
  private journalEntries(): CompendiumEntry[] {
    const journal = this.expeditionJournalProvider?.() ?? [];
    if (journal.length === 0) return [];
    // Group entries by prefix (first word or icon)
    const groups: Record<string, string[]> = {};
    for (const entry of journal) {
      const key = entry.split(':')[0] || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(entry);
    }
    const entries: CompendiumEntry[] = [];
    for (const [key, items] of Object.entries(groups)) {
      entries.push({
        id: `journal:${key.replace(/\s/g, '_')}`,
        name: key,
        category: 'Expedition',
        subtitle: `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`,
        details: items.map((item, i) => detail(`Entry ${i + 1}`, item)),
      });
    }
    // Add a summary entry
    entries.unshift({
      id: 'journal:summary',
      name: 'Expedition Summary',
      category: 'Expedition',
      subtitle: `${journal.length} total entries`,
      details: [
        detail('Total Entries', `${journal.length} events recorded`),
        detail('Latest', journal[journal.length - 1] ?? 'None'),
        detail('First', journal[0] ?? 'None'),
      ],
    });
    return entries;
  }

  /**
   * The Known Foes tab: bestiary pages the party has earned by slaying each
   * kind — kill count, hard-won tactics, and the battle-worn edge they carry.
   */
  private knownFoeEntries(): CompendiumEntry[] {
    const ledger = this.killLedgerProvider?.() ?? {};
    const built: { entry: CompendiumEntry; kills: number }[] = [];
    for (const [id, kills] of Object.entries(ledger)) {
      if (kills <= 0) continue;
      const creature = BESTIARY_BY_TEMPLATE_ID.get(id);
      if (!creature) continue;
      const bonus = knownFoeBonusForKills(kills);
      const template = MONSTER_BY_NAME.get(creature.name.toLowerCase());
      const entry: CompendiumEntry = {
        id: `known:${id}`,
        name: creature.name,
        category: 'Known Foes',
        subtitle: `${kills} slain | ${creature.type} | CR ${creature.cr}`,
        details: [
          detail('Kills', `${kills} ${kills === 1 ? 'kill' : 'kills'} — the party learned this page the hard way, blade by blade.`),
          ...(bonus > 0
            ? [detail('Battle-Worn Edge', `The party knows ${creature.name}s cold. Every attack roll against them carries +${bonus}, and the party holds the line longer against them.`)]
            : [detail('Battle-Worn Edge', `A few more kills (${KNOWN_FOE_KILLS} total) and the party will know this kind cold — +1 on every attack roll against them.`)]),
          detail('Tactics', creature.tactics),
          detail('Lore', creature.lore),
          detail('Description', creature.description),
          detail('Habitat', creature.habitat),
          detail('Abilities', creature.abilities),
          detail('Alignment', creature.alignment),
          detail('Hit Points', creature.hp),
          detail('Armor Class', creature.ac),
          detail('Speed', creature.speed),
          detail('Senses', creature.senses),
          detail('Languages', creature.languages),
        ],
      };
      if (template) entry.action = { kind: 'summon-monster', refId: template.id };
      built.push({ entry, kills });
    }
    built.sort((a, b) => b.kills - a.kills);
    return built.map(b => b.entry);
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** Strip a bestiary type like 'fiend (devil)' down to its playable kind. */
  private normalizeType(raw: string): string {
    return raw.toLowerCase().split(' (')[0].trim();
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** The bestiary creature backing a Bestiary / Known Foes entry, if any. */
  private creatureForEntry(entry: CompendiumEntry): (typeof BESTIARY)[number] | null {
    if (entry.category === 'Bestiary' && entry.id.startsWith('bestiary:')) {
      const creatureId = entry.id.slice('bestiary:'.length);
      return BESTIARY.find(c => c.id === creatureId) ?? null;
    }
    if (entry.category === 'Known Foes' && entry.id.startsWith('known:')) {
      const templateId = entry.id.slice('known:'.length);
      return BESTIARY_BY_TEMPLATE_ID.get(templateId) ?? null;
    }
    return null;
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** True when the entry survives the type + CR filter selects. */
  private entryMatchesTypeAndCr(entry: CompendiumEntry): boolean {
    const typeSel = this.typeFilter.value;
    const crSel = this.crFilter.value;
    if (typeSel === 'All' && crSel === 'All') return true;
    const creature = this.creatureForEntry(entry);
    if (!creature) return false; // no creature data → filtered out when any filter is active
    if (typeSel !== 'All' && this.normalizeType(creature.type) !== typeSel) return false;
    if (crSel !== 'All') {
      const bucket = CR_BUCKETS.find(b => b.label === crSel);
      if (!bucket) return false;
      const cr = Number(creature.cr) || 0;
      if (cr < bucket.min || cr > bucket.max) return false;
    }
    return true;
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /**
   * The playable template behind a Bestiary entry (null when not playable).
   * Non-Bestiary entries return null — they're unaffected by the toggle.
   */
  private playableTemplateId(entry: CompendiumEntry): string | null {
    if (entry.category !== 'Bestiary') return null;
    const creatureId = entry.id.slice('bestiary:'.length);
    return TEMPLATE_BY_BESTIARY_ID.get(creatureId)
      ?? MONSTER_BY_NAME.get(entry.name.toLowerCase())?.id
      ?? null;
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** Clear every filter control back to its default. */
  private resetFilters(): void {
    this.search.value = '';
    this.category.value = 'All';
    this.typeFilter.value = 'All';
    this.crFilter.value = 'All';
    this.playableOnly.checked = true;
    this.refresh();
  }

  private refresh() {
    const query = this.search.value.trim().toLowerCase();
    const selectedCategory = this.category.value;
    if (selectedCategory === 'Known Foes') {
      this.filteredEntries = this.knownFoeEntries().filter(entry =>
        this.entryMatchesTypeAndCr(entry)
        && (!query || [entry.name, entry.subtitle, ...entry.details.map(item => item.value)].join(' ').toLowerCase().includes(query))
      );
    } else if (selectedCategory === 'Expedition') {
      this.filteredEntries = this.journalEntries().filter(entry =>
        !query || [entry.name, entry.subtitle, ...entry.details.map(item => item.value)].join(' ').toLowerCase().includes(query)
      );
    } else {
      // 'Playable only' shows exactly one page per playable kind — the 124-roster,
      // not the same creature repeated across edition lists.
      const seenTemplates = new Set<string>();
      this.filteredEntries = this.entries.filter(entry => {
        // The loot guide is a reference page, not a creature: it stays under
        // 'Playable only' but disappears when a type/CR filter narrows the list.
        const isGuide = entry.id === 'bestiary:loot-guide';
        const categoryMatches = selectedCategory === 'All' || entry.category === selectedCategory;
        const text = [entry.name, entry.category, entry.subtitle, ...entry.details.map(item => item.value)].join(' ').toLowerCase();
        // The guide has no creature data, so entryMatchesTypeAndCr hides it the
        // moment a type/CR filter narrows the list — exactly as intended.
        if (!categoryMatches || !this.entryMatchesTypeAndCr(entry) || (query && !text.includes(query))) return false;
        if (this.playableOnly.checked && !isGuide) {
          const templateId = this.playableTemplateId(entry);
          if (!templateId) return false;
          if (seenTemplates.has(templateId)) return false;
          seenTemplates.add(templateId);
        }
        return true;
      });
    }
    if (!this.filteredEntries.some(entry => entry.id === this.selectedId)) {
      this.selectedId = this.filteredEntries[0]?.id || '';
    }
    this.renderList();
    this.renderDetail();
  }

  private renderList() {
    const count = this.host.querySelector('#compendium-count');
    if (count) count.textContent = `${this.filteredEntries.length} of ${this.entries.length} entries`;
    this.list.innerHTML = this.filteredEntries.map(entry => {
      const kills = entry.category === 'Bestiary' ? this.killsForBestiaryEntry(entry) : 0;
      const badge = kills > 0
        ? `<span style="color:#ff9a3c; font-size:10px; margin-left:6px;">\ud83d\udde1 \u00d7${kills}</span>`
        : '';
      return `
      <button data-entry-id="${escapeHtml(entry.id)}" class="dp-row-click" style="display:block; width:100%; text-align:left; padding:7px 9px; margin-bottom:4px; background:${entry.id === this.selectedId ? 'rgba(232,197,106,0.10)' : T.row}; color:${entry.id === this.selectedId ? '#f2dca0' : T.text}; border:1px solid ${entry.id === this.selectedId ? T.goldDim : T.line}; border-radius:${T.r2}; cursor:pointer; font-family:${T.bodyFont};">
        <div style="font-weight:bold;">${escapeHtml(entry.name)}${badge}</div>
        <div style="color:#888; font-size:10px; margin-top:3px;">${escapeHtml(entry.subtitle)}</div>
      </button>`;
    }).join('') || (
      this.category.value === 'Known Foes'
        ? '<div style="color:#888; padding:14px; line-height:1.5;">No foes recorded yet.<br><span style="color:#665; font-size:11px;">Slay any creature and its bestiary page will unlock here — tactics and lore earned through combat.</span></div>'
        : '<div style="color:#777; padding:12px;">No entries match that search.</div>'
    );
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** Live party spell slots + what teaching this page would do, per caster. */
  private partySlotsHtml(entry: CompendiumEntry): string {
    const party = this.partyProvider?.() ?? null;
    if (!party) return '';
    const playable = PLAYABLE_SPELL_BY_NAME.get(entry.name.toLowerCase());
    const spellLevel = playable?.level ?? 0;
    const casters = party.members.filter(m => isCaster(m.charClass.id));

    const rows = casters.map(m => {
      const slotParts: string[] = [];
      for (let lvl = 1; lvl <= 9; lvl++) {
        const max = m.maxSpellSlots[lvl] || 0;
        if (max <= 0) continue;
        const used = m.spellSlots[lvl] || 0;
        slotParts.push(`${ordinal(lvl)} ${'\u25cf'.repeat(used)}${'\u25cb'.repeat(max - used)}`);
      }
      const pact = getCasterType(m.charClass.id) === 'pact' ? ' \u26a1 Pact' : '';
      const slotsStr = slotParts.length ? slotParts.join(' ') + pact : 'no slots';

      let hint = '';
      let color = '#9a9';
      if (playable) {
        const knows = m.knownSpells.includes(playable.id);
        if (spellLevel <= 0) {
          hint = knows ? 'already knows it \u2014 no slot needed' : 'can learn instantly (cantrip)';
          color = knows ? '#888' : '#4c4';
        } else if (!knows) {
          const free = Object.entries(m.spellSlots).some(([lvl, cur]) => Number(lvl) >= spellLevel && (cur || 0) > 0);
          hint = free ? 'can learn & cast now' : 'can learn \u2014 all matching slots spent (rest first)';
          color = free ? '#4c4' : '#ca8';
        } else {
          hint = 'knows it \u2014 studying restores a spent slot';
          color = '#88f';
        }
      }

      return `<div style="padding:4px 0; border-bottom:1px dashed #33384a;">
        <span style="color:#ddd;">${escapeHtml(m.name)}</span> <span style="color:#778; font-size:11px;">Lv${m.level} ${escapeHtml(m.charClass.name)}</span>
        <div style="color:#9ab; font-size:11px;">${escapeHtml(slotsStr)}</div>
        <div style="color:${color}; font-size:11px;">${hint}</div>
      </div>`;
    }).join('');

    return `<section id="compendium-party-slots" style="margin:0 0 16px; padding:10px; background:rgba(255,215,0,0.05); border:1px solid #5a4c28; border-radius:4px;">
      <div style="color:#ffd76a; font-size:11px; font-weight:bold; text-transform:uppercase; margin-bottom:6px;">Party Spell Slots (live)</div>
      ${rows || '<div style="color:#c66; font-size:12px;">No caster in the party \u2014 teaching this page would be lost on them.</div>'}
    </section>`;
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /** Keep the live party-slot section current while the compendium is open. */
  refreshPartySlots() {
    if (this.panel.style.display === 'none') return;
    const entry = this.entries.find(item => item.id === this.selectedId);
    if (!entry || entry.action?.kind !== 'teach-spell') return;
    const node = this.detailPane.querySelector('#compendium-party-slots');
    if (node) node.outerHTML = this.partySlotsHtml(entry);
    else this.renderDetail(); // first party snapshot — build the section now
  }

  private renderDetail() {
    const entry = this.filteredEntries.find(item => item.id === this.selectedId)
      || this.entries.find(item => item.id === this.selectedId);
    if (!entry) {
      this.detailPane.innerHTML = '<div style="color:#777; padding:20px;">Select an entry to inspect it.</div>';
      return;
    }
    // Battle-worn knowledge section on regular bestiary pages the party has slain.
    let earnedHtml = '';
    if (entry.category === 'Bestiary') {
      const kills = this.killsForBestiaryEntry(entry);
      if (kills > 0) {
        const bonus = knownFoeBonusForKills(kills);
        const edge = bonus > 0
          ? `The party knows this kind cold \u2014 +${bonus} on every attack roll against it.`
          : `${KNOWN_FOE_KILLS - kills} more kill${KNOWN_FOE_KILLS - kills === 1 ? '' : 's'} until the party knows it cold (+1 attack).`;
        earnedHtml = `<section style="margin:0 0 16px; padding:10px; background:rgba(255,154,60,0.06); border:1px solid #6a4c28; border-radius:4px;">
          <div style="color:#ff9a3c; font-size:11px; font-weight:bold; text-transform:uppercase;">\ud83d\udde1 Battle-Worn Knowledge (${kills} slain)</div>
          <div style="color:#e0c9a8; line-height:1.45; margin-top:4px;">This page was earned in blood. ${edge} The tactics below are what the party learned from fighting them \u2014 and winning.</div>
        </section>`;
      }
    }
    const buttonsHtml = entry.action ? `
      <div style="margin-top:16px; padding-top:12px; border-top:1px solid #3a3a48; display:flex; gap:8px; flex-wrap:wrap;">
        <button data-compendium-action="encounter" class="dp-btn-gold" style="padding:6px 13px; font-size:12px;">${escapeHtml(actionLabel(entry.action.kind))}</button>
        <button data-compendium-action="legend" class="dp-btn" style="padding:6px 13px; font-size:12px;">\ud83d\udcdc Recite Its Legend</button>
      </div>` : '';
    this.detailPane.innerHTML = `
      <div style="color:#ffd76a; font-size:20px; font-weight:bold;">${escapeHtml(entry.name)}</div>
      <div style="color:#a9976b; margin:4px 0 16px;">${escapeHtml(entry.category)} / ${escapeHtml(entry.subtitle)}</div>
      ${entry.action?.kind === 'teach-spell' ? this.partySlotsHtml(entry) : ''}
      ${earnedHtml}
      ${entry.details.map(item => `
        <section style="margin:0 0 14px;">
          <div style="color:#8ea6c9; font-size:11px; font-weight:bold; text-transform:uppercase;">${escapeHtml(item.label)}</div>
          <div style="color:#d0d0d0; line-height:1.45; white-space:pre-wrap;">${escapeHtml(item.value || 'None')}</div>
        </section>
      `).join('')}
      ${buttonsHtml}
    `;
  }

  /**
   * Build Expedition Journal entries from the live journal array.
   */

  /**
   * Keep every live section current while the compendium is open: the spell
   * slots pane and the Known Foes / battle-worn badges that track the ledger.
   */
  refreshLive() {
    if (this.panel.style.display === 'none') return;
    const entry = this.entries.find(item => item.id === this.selectedId);
    if (entry && entry.action?.kind === 'teach-spell') {
      const node = this.detailPane.querySelector('#compendium-party-slots');
      if (node) node.outerHTML = this.partySlotsHtml(entry);
      else this.renderDetail(); // first party snapshot — build the section now
    }
    // Ledger changes (new kills) re-render the Known Foes list and badges.
    const sig = JSON.stringify(this.killLedgerProvider?.() ?? {});
    if (sig !== this.lastLedgerSig) {
      this.lastLedgerSig = sig;
      this.refresh();
    }
  }
}

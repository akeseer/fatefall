/**
 * Dump the game's name pools and the intent list to tools/train/data/*.json so
 * the Python training pipeline and the TypeScript game never drift apart.
 *
 * Run with:  npm run export-vocab
 * (bundled by esbuild because the game sources are TypeScript with enums).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { MONSTER_TEMPLATES } from '../../src/entities/Monster';
import { BESTIARY, MAGIC_ITEMS, NPC_TEMPLATES } from '../../src/ai/DnDKnowledge';
import { GIVERS } from '../../src/quests/QuestGivers';
import { MARKET_POTIONS, MARKET_SCROLLS } from '../../src/loot/LootTables';
import { STARTER_GEAR, FIRST_NAMES, LAST_NAMES } from '../../src/game/CharacterFactory';
import { SHOP_STOCK } from '../../src/world/TownTypes';
import { TOWN_NAMES, ENTRANCE_NAMES } from '../../src/world/Overworld';
import { SPELLS } from '../../src/data/gameData';
import { INTENTS, FEATURE_INTENT_KIND } from '../../src/ai/DMCommand';

const names = (arr: any[]): string[] =>
  Array.from(new Set(arr.map(x => (typeof x === 'string' ? x : x?.name)).filter((s): s is string => typeof s === 'string' && s.length > 0)));

const gearNames = names([...Object.values(STARTER_GEAR).flat(), ...Object.values(SHOP_STOCK).flat()])
  .filter(n => !/potion|scroll|ration|antidote/i.test(n));

const vocab = {
  monsters: names(MONSTER_TEMPLATES),
  bestiary: names(BESTIARY),
  questGivers: names(GIVERS as any[]),
  npcTemplates: names(NPC_TEMPLATES),
  potions: names(MARKET_POTIONS as any[]),
  scrolls: names(MARKET_SCROLLS as any[]),
  gear: gearNames,
  magicItems: names(MAGIC_ITEMS),
  spells: names(SPELLS),
  towns: TOWN_NAMES,
  entrances: ENTRANCE_NAMES,
  firstNames: FIRST_NAMES,
  lastNames: LAST_NAMES,
  featureKinds: Array.from(new Set(Object.values(FEATURE_INTENT_KIND))),
};

mkdirSync('tools/train/data', { recursive: true });
writeFileSync('tools/train/data/vocab.json', JSON.stringify(vocab, null, 2));
writeFileSync('tools/train/data/intents.json', JSON.stringify(INTENTS, null, 2));
const summary = Object.fromEntries(Object.entries(vocab).map(([k, v]) => [k, (v as string[]).length]));
console.log('vocab.json written:', JSON.stringify(summary));
console.log('intents.json written:', INTENTS.length, 'intents');

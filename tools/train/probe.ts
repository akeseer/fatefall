/**
 * Ask the trained model what it thinks of specific orders.
 *
 *   npm run probe -- "set a course for Emberwatch" --mode overworld
 *   npm run probe                # runs the built-in diagnostic set
 *
 * Prints the regex answer, the model's top intents, and what understand()
 * would actually do — which is the only one the game sees.
 */
import { readFileSync } from 'node:fs';
import { IntentModel } from '../../src/ai/IntentModel';
import { parseDMCommandRegex, understand } from '../../src/ai/DMCommandParser';
import type { DMContext } from '../../src/ai/DMCommand';

const buf = readFileSync('public/models/dm-intent-v1.bin');
const model = IntentModel.fromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const D = (over: Partial<DMContext> = {}): DMContext => ({ featureKind: null, inCombat: false, mode: 'dungeon', ...over });

const argv = process.argv.slice(2);
let cases: [string, DMContext][];

if (argv.length && !argv[0].startsWith('--')) {
  const modeIdx = argv.indexOf('--mode');
  const featIdx = argv.indexOf('--feature');
  const ctx = D({
    mode: (modeIdx >= 0 ? argv[modeIdx + 1] : 'dungeon') as DMContext['mode'],
    featureKind: featIdx >= 0 ? (argv[featIdx + 1] as DMContext['featureKind']) : null,
    inCombat: argv.includes('--combat'),
  });
  cases = [[argv[0], ctx]];
} else {
  cases = [
    ['set a course for Emberwatch', D({ mode: 'overworld' })],
    ['point them at the Sunken Crypts', D({ mode: 'overworld' })],
    ['go have a word with the blacksmith', D({ mode: 'town' })],
    ['pay the constable a visit', D({ mode: 'town' })],
    ['we should pick up some rope', D({ mode: 'town' })],
    ['drop an owlbear on them', D()],
    ['someone crack open a healing potion', D({ inCombat: true })],
    ['take the shield off', D({ mode: 'town' })],
    ['get them into a 2x2 block', D()],
    ['remind me what the moon is doing tonight', D()],
  ];
}

console.log(`model v${model.version}: ${model.intents.length} intents, threshold ${model.threshold}, temperature ${model.temperature}\n`);
for (const [text, ctx] of cases) {
  const top = model.topK(text, ctx, 3).map(t => `${t.intent} ${t.prob.toFixed(3)}`).join('   ');
  const got = understand(text, ctx, model);
  console.log(JSON.stringify(text));
  console.log(`   regex     ${parseDMCommandRegex(text, ctx).intent}`);
  console.log(`   model     ${top}`);
  console.log(`   result    ${got.cmd.intent} (via ${got.source})\n`);
}

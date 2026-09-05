# The DM intent model

Fatefall reads your orders with a small classifier trained from scratch on the
game's own vocabulary. No cloud API, no pretrained download, no runtime npm
dependency: the weights are one 550 KB file and the inference is about eighty
lines of TypeScript in [`src/ai/IntentModel.ts`](../../src/ai/IntentModel.ts).

## What it does

Every DM order resolves to a `DMCommand` — an intent plus its arguments. Two
understanders produce them, and `understand()` in
[`src/ai/DMCommandParser.ts`](../../src/ai/DMCommandParser.ts) combines them:

1. **The regex parser** handles every documented order exactly. It is the
   fallback and, for orders whose arguments are syntax rather than language
   (dice expressions, names, save slots), it always wins.
2. **The model** handles the rest — the paraphrases nobody could enumerate. Its
   answer is used only when it clears a confidence bar and the intent makes
   sense in the current room.

On a set of 166 hand-written orders, the regex alone gets 36% right and the two
together get 99%.

## Results

Run `npm run model-report` for the current numbers.

| | regex only | with the model |
|---|---|---|
| Hand-written orders (166) | 35.5% | **98.8%** |
| Documented orders (369) | 100% | 99.5% |

The 99.5% is not a regression: two canonical phrases change meaning and both
are the model correcting a known quirk in the regex cascade's ordering. They
are listed and justified in `tests/intent-model.test.ts`.

Prediction costs about 60 microseconds, so it runs comfortably on a keystroke.

## Looking closer

`npm run model-report` scores what the player experiences: `understand()` with
the regex fallback in place, on the two acceptance sets. `python
tools/train/eval.py` does the other half — the classifier on its own, over the
11,870-row dev split. It reads the shipped `.bin` rather than a checkpoint, at
the temperature and threshold in its header and with the context gating the game
applies, so the numbers are the ones the player gets and not the ones the float
model would give. It takes about five seconds and writes nothing.

It prints, in order:

- **Accuracy**, split by whether a row clears the accept bar. Rows below the bar
  never reach the player — the regex answer stands for those.
- **The confused pairs**, ranked by count, each as a share of the true intent's
  support, then per-intent precision, recall and F1 sorted weakest first. A
  square matrix over 69 intents is unreadable; the pairs are where the mass is.
- **Calibration** — ECE and MCE over ten confidence bins, a reliability table,
  and the ECE above the accept bar on its own. The runtime trusts the model only
  above that bar, so confidence that stops meaning what it says quietly changes
  how often the model is listened to at all.
- **Regex agreement** with the cascade that labelled the data, split by whether
  the regex committed to an answer, and who turns out to be right when the two
  disagree.
- **`unknown` precision and recall**, against a 0.95 precision bar. Precision is
  the number that matters: of the rows called `unknown`, how many really were
  table talk rather than an order that got dropped.

Flags: `--model`, `--split`, `--bins`, `--pairs`, `--classes`, `--all-classes`,
`--threshold`, `--margin`, `--unknown-bar`. Where the current weights stand:

| | |
|---|---|
| Dev accuracy | 87.6% — 92.9% on the 84.5% of rows that clear the bar |
| ECE | 0.013, and 0.009 above the bar |
| Regex agreement | 86.9% where the regex commits; on the 837 disagreements the model is right 709 times to the regex's 65 |
| `unknown` precision / recall | 84.6% / 82.7% — still under the 0.95 precision bar on this split |

The dev split is the harsher of the two measurements and deliberately so: it
holds out *whole templates*, so every wording family with only one member is a
family the model is scored on having never seen. See the last of the known
limits below for what that costs.

## How it is built

```
   src/**             npm run export-vocab   ->  data/vocab.json, data/intents.json
   templates.py       python gen_data.py     ->  data/train.jsonl, data/dev.jsonl
   + vocabulary.py
   regex parser       npm run label-data     ->  labels + data/disagreements.jsonl
                                                 tests/fixtures/canonical.jsonl
   PyTorch            python train.py        ->  public/models/dm-intent-v1.bin
                                                 tests/fixtures/*-parity.json
```

Full rebuild from a clean checkout:

```bash
npm run export-vocab
python tools/train/gen_data.py
npm run label-data
python tools/train/train.py --epochs 16
node tools/train/make_golden.mjs   # only if the acceptance set changed
npm test
```

Training takes under a minute on a laptop GPU and works on CPU too. Only
`torch` and `numpy` are needed; nothing here ships with the game.

### The pieces

| File | What it is |
|---|---|
| `export_vocab.ts` | Dumps monster, town, NPC and item names out of the game so Python and TypeScript can never disagree about them. |
| `templates.py` | Paraphrase templates per intent, plus the conversational carriers ("i want you to …") that wrap them. |
| `vocabulary.py` | Vocabulary expansion: the wider set of words people actually use for each intent. |
| `gen_data.py` | Fills templates from the exported vocabulary, wraps half of them in carriers, adds typos and filler, and splits by template. |
| `label.ts` | Labels every row with the regex parser and writes the canonical fixture. Rows where the two disagree go to `data/disagreements.jsonl` for review. |
| `featurizer.py` | The feature extractor. Must stay identical to the TypeScript one. |
| `train.py` | Trains, calibrates, quantises, exports, and reports. |
| `export.py` | The binary weights format and the reference forward pass. |
| `eval.py` | Scores the shipped weights on the dev split: confusion, calibration, regex agreement, `unknown` (`python tools/train/eval.py`). |
| `probe.ts` | Ask the shipped model about a specific order (`npm run probe -- "your order"`). |
| `report.ts` | Score the shipped model (`npm run model-report`). |
| `make_golden.mjs` | Rebuilds the hand-written acceptance set. |

## The model

A hashed bag of n-grams into a two-layer network:

- Text is lowercased, stripped of punctuation, and split into word unigrams,
  word bigrams and character 1–3-grams, plus three tokens describing the room,
  whether a fight is on, and where the party is.
- Each feature string is hashed with FNV-1a into one of 8192 buckets, and the
  resulting sparse vector is L2-normalised.
- 8192×64 with ReLU, then 64×66, one logit per intent. About 528k parameters,
  shipped as row-wise int8 with float32 scales.
- Logits for intents that make no sense in the current room are masked out
  before the softmax, so the model can never order the party to pray at an
  altar that is not there.

Bag-of-ngrams was the right call here because every argument is either a closed
set (a direction, a policy), pure syntax (a dice expression), or a span after a
trigger word. Rules pull those out more reliably than a sequence tagger trained
on synthetic names would, and the whole thing stays small enough to hand-write
the inference.

## Keeping the two sides honest

`train.py` writes `tests/fixtures/featurizer-parity.json` and
`logits-parity.json` from the Python side. The TypeScript tests replay them and
require identical hash buckets and logits within 1e-4. If the two featurizers
ever drift, those tests fail rather than the model quietly getting worse.

## When you change a command's wording

The regex parser is the labelling oracle, so changing it changes the training
labels. After editing `DMCommandParser.ts`:

1. `npm run label-data` and read `data/disagreements.jsonl`. Disagreements are
   either a template that is genuinely ambiguous or a real bug in the parser —
   triage them, never resolve them automatically.
2. Regenerate, retrain, and run `npm test`.

## Known limits

- A bag of n-grams has no word order beyond bigrams. Negation is handled by
  training on negated phrasings, not by understanding it.
- Two of the 166 hand-written orders are still misread: "sign us up for the
  second one" is board work read as a quest rather than a bulletin task (the
  sentence names neither), and one line of table talk ("a camp would be nice
  about now") is taken as an order to make camp — the word "camp" is a
  documented command, so the regex claims it before the model is asked.
- Names are open vocabulary and are pulled out by span rules, never by the
  classifier, so renaming a character to something unusual still works.
- `unknown` precision clears its 0.95 bar on the hand-written set — 19 of 19,
  no real order dropped as chatter, and 5% of the table talk acted on — but is
  0.846 on the dev split, where the bar still reads FAIL. The gap is the split's
  design, not a second opinion about the same thing: the dev split holds out
  whole templates, so a wording family with one member ("is there a festival
  on", "prioritise staying alive", "take five") is scored with nothing near it
  in its own class, and the model's honest answer for a phrasing it has never
  seen is `unknown`. The remaining 126 false `unknown`s are spread thinly over
  twenty-odd such templates, so closing that gap means widening those families
  in `vocabulary.py`, not tuning the model. What the player actually feels is
  the last line of the report: 0.7% of the split's table talk clears the accept
  bar and would be acted on, down from 6.4%. Run `python tools/train/eval.py`
  for the current figures.

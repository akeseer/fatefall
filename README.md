# Fatefall — An AI-Run Tabletop Adventure

A browser RPG where **you are the Dungeon Master** and the party plays itself.
Four adventurers explore a living overworld, delve procedurally generated dungeons,
fight turn-based D&D-style battles, take quests in town, and trade at the market —
all on their own judgment. You steer them by typing orders in plain English
("head north", "attack", "rest", "talk to the constable", "summon an owlbear").

Everything runs locally in the browser. No server, no accounts, no API keys.

## Running

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # strict typecheck + production build into dist/
npm run preview    # serve the production build
npm test           # Vitest unit tests
```

Saves live in `localStorage` (three slots) and are written automatically every few
seconds, on tab hide, and on close.

## Running as a desktop app

Fatefall is a desktop game. The built files refuse to start in a plain browser
and show a notice instead; the game runs in its own window with its own save slots:

```bash
npm run app        # build, then open Fatefall in an Electron window
npm run app:build  # build a Windows installer and a portable .exe into release/
```

The packaged app serves the built files from a loopback-only local server inside
the window. It boots behind a splash that checks the latest GitHub release of
[akeseer/fatefall](https://github.com/akeseer/fatefall) for a newer version
(`fatefall.updates` in `package.json`; a JSON manifest URL works too). Pushing a
version tag builds the installer and publishes the release from
`.github/workflows/release.yml`:

```bash
npm version minor
git push --follow-tags
```

An unreachable server just means the game opens after a moment. When an update is
found, the game's log says so and the Sound drawer gets a button to the download.

For development the dev server (`npm run dev`) still plays in the browser, as does a
local preview of a build opened with `?debug`.

## Playing

- Pick a save slot on the start screen. A new run asks you to choose your party's four
  classes; the world rolls their names, races, faces and gear. The party leaves town for
  its first quest on its own if you do nothing for a while.
- The same screen sets how the run is played. **Auto**: the party runs itself and fights
  resolve on their own. **Manual**: you command every hero in every fight, and the party
  holds at each new room and town gate until you press Play. **Hardcore**: a fallen
  adventurer leaves the party for good, and when the last one falls the run is over and
  the slot is cleared.
- The **DM** button (or the input bar at the bottom) takes orders. Type `help` for
  the list the party understands, though you do not have to stick to it — see below.
- Speed controls run the world from 0.25× to 4×; Pause freezes it.
- Combat opens a battle screen. It runs automatically, or flip it to manual and
  command each hero.
- Typing `roll d20` banks a **Luck die**: the party's next d20 roll is fated to that
  result, for better or worse.
- Everything you hear is synthesised in the browser: a score per place and mood, a
  sound for every blow and spell, and the weather itself. The **Sound** button opens
  a drawer with master, effects and music levels; `M` mutes.

## Talking to the party

You do not have to memorise commands. "Could everyone please push northward",
"how banged up is everybody" and "drop an owlbear on them" all work, because the
game ships its own small language model, trained from scratch on its own
vocabulary. It runs in the browser in about 50 microseconds per order, with no
API key, no download and no runtime dependency.

Written orders are still handled by an exact parser, which is also the fallback,
so nothing breaks if the model is switched off. On a set of 157 hand-written
orders the parser alone reads 34% and the two together read 95%.

The chip next to the `DM ❯` prompt shows which is in use; click it, or type
`model off` / `model on`, to switch. See [`tools/train/`](tools/train/README.md)
for how the model is built and retrained.

## Project layout

| Directory | What lives there |
|---|---|
| `src/main.ts` | The `Game` class: game loop, mode switching, DM orders, save/restore |
| `src/ai/` | The party's tactical brain (`AIDirector`), lore/knowledge tables, narration templates |
| `src/combat/` | Turn-based combat engine |
| `src/world/` | Overworld, towns and town life, dungeons, weather, day/night, calendar |
| `src/entities/` | Characters, monsters, party, procedural pixel sprites |
| `src/audio/` | The audio engine, sound effects, the score and the weather ambience, all synthesised |
| `src/quests/` | Quests, quest givers, bulletin board, bandit camps |
| `src/rules/`, `src/loot/`, `src/traps/`, `src/save/` | Dice, loot tables, traps, save slots and migrations |
| `src/ui/` | HUD overlay, battle view, 3D dice, town panel, compendium |
| `src/rendering/`, `src/engine/` | Recorded-frame map renderer, Pixi and Canvas backends with lighting, weather and mood effects, camera, shared types |
| `tests/` | Vitest suites (run with `npm test`) |
| `tools/train/` | Training pipeline for the DM command-understanding model |
| `electron/` | The desktop shell: a window around the built game |

See `CLAUDE.md` for architecture notes and conventions.

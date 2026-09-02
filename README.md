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

## Playing

- Pick a save slot on the start screen. The party leaves town for its first quest on
  its own if you do nothing for a while.
- The **DM** button (or the input bar at the bottom) takes orders. Type `help` for
  the list the party understands, though you do not have to stick to it — see below.
- Speed controls run the world from 0.25× to 4×; Pause freezes it.
- Combat opens a battle screen. It runs automatically, or flip it to manual and
  command each hero.
- Typing `roll d20` banks a **Luck die**: the party's next d20 roll is fated to that
  result, for better or worse.

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
| `src/quests/` | Quests, quest givers, bulletin board, bandit camps |
| `src/rules/`, `src/loot/`, `src/traps/`, `src/save/` | Dice, loot tables, traps, save slots and migrations |
| `src/ui/` | HUD overlay, battle view, 3D dice, town panel, compendium |
| `src/rendering/`, `src/engine/` | Canvas map renderer, camera, shared types |
| `tests/` | Vitest suites (run with `npm test`) |
| `tools/train/` | Training pipeline for the DM command-understanding model |

See `CLAUDE.md` for architecture notes and conventions.

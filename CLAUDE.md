# CLAUDE.md — working notes for this codebase

Fatefall is a zero-runtime-dependency browser RPG in vanilla TypeScript + Vite.
The player is the Dungeon Master; the party is autonomous.

## Commands

```bash
npm run dev      # dev server (127.0.0.1:5173)
npm run typecheck # tsc (strict) over src, then over tests
npm run build    # typecheck then vite build
npm test         # vitest run; tests live in tests/**/*.test.ts
```

Keep the game bundle free of runtime npm dependencies. Dev-only tooling is fine.

## Architecture map

- **`src/game/*Controller.ts`** — slices carved out of `Game`. Each takes a
  small host interface (`RoomFeatureHost`, `BulletinHost`, `MarketHost`) naming
  exactly what it may touch, and `Game` passes itself and keeps thin
  pass-throughs. Add to these rather than back to `main.ts`, and prefer asking
  the host a question (`inTown`) over reading `GameMode` from a controller.
- **`src/main.ts` — `Game`**. Owns all state. One class, one `requestAnimationFrame`
  loop with a fixed 33 ms simulation step (`gameStep`) and a visible-only watchdog
  timer. `update(dt)` branches on `GameMode` (Overworld / Town / Dungeon) and
  `GamePhase` (Exploration / Combat). Three consecutive thrown errors halt the sim
  and show a HUD banner (`handleStepError`); UI callbacks are wrapped with `guard()`.
- **DM orders**: `handleDMCommand` → `understand()` → `dispatchDMCommand`. Intent
  types live in `src/ai/DMCommand.ts`, the pure regex parser in
  `src/ai/DMCommandParser.ts`, and the trained classifier in `src/ai/IntentModel.ts`
  (weights in `public/models/`, pipeline in `tools/train/` — read its README before
  touching either). `understand()` prefers the regex for orders whose arguments are
  syntax (dice, names, save slots) and otherwise takes the model when it clears its
  confidence bar. Adding an intent means updating `INTENTS` (append only — the
  weights file records the order) and retraining.
- **`src/ai/AIDirector.ts`** — the party's tactical planner. Returns an `AIAction`
  union that `Game.aiTick` dispatches on. Combat decisions live in `CombatEngine`.
- **`src/combat/CombatEngine.ts`** — DOM-free. `step()` returns a `CombatLog` whose
  messages the game feeds to the HUD. Mutates the `Party`/`Monster` objects it is given.
- **`src/world/`** — `Overworld` (towns, entrances, POIs), `TownLife` (rumors,
  festivals, bulletin boards, quest givers per town), `DungeonGenerator` (seedable via
  `hashSeed`), `RoomFeatures` (one optional feature per room), weather/day-night/calendar.
- **`src/save/SaveManager.ts`** — three localStorage slots. `SAVE_VERSION` guards the
  schema; `migrateSave` is a linear chain of `migrateVNtoVN+1` steps.
- **`src/rendering/`** — the frame is *recorded*, not drawn. `RecordingContext` is a
  canvas-shaped shim that `MapRenderer` and `Sprites` are handed instead of a real
  context; it appends `DrawCommand`s. A `RenderBackend` replays the `Frame`.
  `CanvasBackend` is the reference; `PixiBackend` (the default) adds `pixi/Lighting`
  (multiply-blended torch and night) and `pixi/Atmosphere` (colour grade, vignette,
  bloom), both driven by the `SceneMood` the game attaches to each frame.
  Adding a draw call means adding a `DrawCommand` kind and handling it in every backend.
- **`src/ui/HUD.ts`** — builds the DOM overlay from a template string. The log is
  append-only HTML strings (`addCombatMessage`).

## Conventions and gotchas

- **Adding a save field**: declare it optional on `SaveData`, bump `SAVE_VERSION`,
  add a `migrateVNtoVN+1` step and a line in the `migrateSave` ladder, write it in
  `Game.toSaveData()`, read it with `?? default` in `Game.restore()`. Add a test in
  `tests/save-migrate.test.ts`.
- **Adding a `TileType` or `RoomFeatureKind`**: several exhaustive `Record`s must be
  updated or `tsc` fails — `TILE_COLORS` in `TileMap.ts`, `VARIANTS` in
  `RoomFeatures.ts`, and `Game.FEATURE_HINT`. `drawFeature` in `MapRenderer.ts` has a
  default arm, so a new kind renders as a generic marker until you give it a case.
  A feature that the DM can act on also needs an intent in `DMCommand.ts`, a branch in
  `parseFeatureIntent`, a case in `Game.performFeatureIntent`, and a retrain.
- **Bulletin tasks** only make progress once accepted. Slay progress is read from the
  kill ledger against a baseline taken on accept, so targets must be real template ids.
  `refreshBulletinBoard` keeps accepted and finished work and replaces only the rest.
- **Kill ledger keys are monster template ids** (`m.template.id`), not display names.
  Anything that counts kills must use template ids.
- `DiceEvents` and `LuckDie` are module-level singletons; tests call
  `resetDiceEvents()` / `grantLuckDie(null)` in `beforeEach`.
- `main.ts` uses LF line endings; `.gitattributes` normalizes the repo to LF.
- The DM regex cascade is the labelling oracle for the intent model. When you change
  a command's wording, regenerate the canonical fixture and retrain (see
  `tools/train/README.md`).

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

Keep `dependencies` in `package.json` empty. Pixi and Phaser are devDependencies that
Vite bundles behind dynamic imports; nothing is installed at runtime. Dev-only tooling is fine.
`electron/main.cjs` wraps the built `dist/` as a desktop app (`npm run app`, `npm run app:build`);
it serves the build from a loopback HTTP server rather than `file://`, and `preload.cjs` puts a
`fatefall` object on the window that `startGame` requires: a production build in a plain browser
shows a desktop-only notice instead. The dev server is exempt, and so is a loopback preview with
`?debug` (the `stable` config), which is why that workflow still works. The splash
(`electron/splash.html`) is driven by `executeJavaScript` from the main process; the update check
reads `fatefall.updates` in package.json (GitHub releases or a JSON manifest) and never blocks the
game for more than six seconds. `FATEFALL_SHOT=<png>` runs the app headlessly for a screenshot of
the splash and the game; `FATEFALL_UPDATE_URL` points the check at a local manifest for testing.

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
- **DM orders**: `handleDMCommand` → `understand()` → `DMCommandDispatcher`
  (`src/game/DMCommandDispatcher.ts`, one arm per intent behind `DMCommandHost`).
  Intent types live in `src/ai/DMCommand.ts`, the pure regex parser in
  `src/ai/DMCommandParser.ts`, and the trained classifier in `src/ai/IntentModel.ts`
  (weights in `public/models/`, pipeline in `tools/train/` — read its README before
  touching either). `understand()` prefers the regex for orders whose arguments are
  syntax (dice, names, save slots) and otherwise takes the model when it clears its
  confidence bar. Adding an intent means updating `INTENTS` (append only — the
  weights file records the order) and retraining.
- **`src/story/`** — the main quest. `Story.ts` is a pure, seeded planner: the opening
  act is fixed content from `StoryContent.ts`, later acts are assembled (antagonist, lair
  from real entrances, motive, twist, choice) from the run seed plus the flags earlier
  choices set, so a saved story replans identically. Each act is issued as an ordinary
  `slay_boss` Quest with a `story_` id, so the quest machinery does the travelling,
  descending and turning in; `game/StoryController.ts` decides readiness (recommended
  level per act, side work below it), swaps the act's boss onto the target floor in
  `populateDungeonFloor`, and runs the cards and choices through the HUD. Story state
  rides in the save (`story`, v13). Never call `Math.random` in `Story.ts`.
- **`src/ai/AIDirector.ts`** — the party's tactical planner. Returns an `AIAction`
  union that `Game.aiTick` dispatches on. Combat decisions live in `CombatEngine`.
- **`src/combat/Abilities.ts`** — class skills as data: a ladder of three or four per class
  unlocked by `minLevel`, each with a `cost` from the class's resource pool (`CLASS_RESOURCE`:
  mana, stamina, ki, focus, or the blood hunter's hit points) and a `cooldown` in rounds.
  `Character` owns the pool (`resource`, refilled by rests, saved as `resource`); the engine owns
  cooldowns and regen (`resourceRegen` at each round wrap), chooses for the AI in
  `chooseAbility`, and resolves by `effect` in `useClassAbility`. Adding a skill is a data
  entry plus, if its wording is new, a line in `BattleFx`; a new `effect` kind needs an arm in
  `useClassAbility`, the chooser, and the battle view's generic drawer.
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
  `CanvasBackend` is the reference; `phaser/Mood.ts` gives the Phaser backend the same
  weather, light and lens from camera filters and a few rectangles, reading the Canvas
  backend's exported constants so the coarse backends agree; `PixiBackend` (the default) adds `pixi/Lighting`
  (multiply-blended torch and night), `pixi/Atmosphere` (colour grade, vignette,
  bloom), `pixi/Weather` (particle rain, snow, fog, sandstorm), `pixi/Ambience`
  (dust, pollen, fireflies) and `pixi/Transition` (fade, blinds, crit flash), all
  driven by the `SceneMood` the game attaches to each frame. The renderer draws the
  world at noon under a clear sky; the backend owns every mood effect, and a mood
  effect painted in `MapRenderer` as well is a double application (that bug has
  happened twice). `SceneMood.themeId` is the dungeon theme; `rendering/ThemeLight.ts`
  is the one table that turns it into the colour of the carried light, read by the
  Pixi torch, the dust, the grade and the Canvas fallback. `SceneMood.transition`
  and `flash` are stamped by `Game` with a progress the backends only map to a
  picture, through `transitionShape` in `DrawCommand.ts`, so both backends agree.
  Adding a draw call means adding a `DrawCommand` kind and handling it in every backend.
- **Looking at it**: `.claude/launch.json` has a `stable` config that serves a built
  copy on port 4390, immune to the dev server's HMR reloading the page mid-inspection
  (`npm run build` first). `window.__game` exists in dev builds and in a production
  build loaded with `?debug`; from it, `togglePause()`, then set both `camera.x/y`
  and `camera.targetX/targetY` to pin the view, `clock.light = 1` for daylight, and
  scale `#game-canvas`'s CSS size to zoom (re-grab the element after start, since the
  backend swaps it in). When screenshots stall, rasterise the recorded frame or the
  sprite `<img>`s to ASCII from the page; that has worked every time.
- **`src/audio/`** — sound, with no sound files. `Audio.ts` owns the one AudioContext
  for the page (lazily created, unlocked by the first pointer or key), a master gain
  with separate effects and music buses, and remembered volume and mute
  (`fatefall.audio`). `Sfx.ts` is the effect bank: each effect is a few lines of
  oscillator and filtered-noise synthesis behind a per-kind rate limit, and every one
  returns silently when the engine is unavailable or muted. `Music.ts` is the score:
  one `Piece` per `MusicMood`, a lookahead scheduler on the audio clock, and a
  two-second crossfade between moods; `Game.musicMood()` picks the mood from mode,
  phase and daylight every step and `Music.play` treats a repeat as a no-op.
  `Ambience.ts` is the weather heard: looped filtered noise per layer (rain,
  rumble, wind, cave hush, crickets) on the effects bus, gliding toward the levels
  the pure `ambienceLevels()` derives from the same state the picture uses.
  `ui/DiceSounds.ts` is a client of the engine. Never create a second AudioContext; browsers cap them and it
  would break the single mute. Wire a new sound at the event that makes it, next to
  the picture of it. `window.__audio` is exposed alongside `__game` for inspection.
- **`src/ui/BattleFx.ts`** — the battle window's reading of the combat log, pure: one line in,
  effects out (cast with element and delivery, ability, miss, kill, condition, legendary,
  special, potion, scroll). Elements come from the spell table's damage strings. `ui/SpellFx.ts`
  gives every spell by name its delivery, motif, element and sound, and a test insists no spell
  in the data is missing from it, so a new spell needs an entry there. `BattleView`
  draws each kind as one-shot DOM nodes and plays the sound for it; fire, lightning, arcane and
  healing sounds stay in `Game` (they predate this), so a new element's sound belongs in the
  battle view and nowhere else. Changing an engine sentence means updating the regex and its test.
- **`src/ui/HUD.ts`** — builds the DOM overlay from a template string. The log is
  append-only HTML strings (`addCombatMessage`).

## Conventions and gotchas

- **Adding a save field**: declare it optional on `SaveData`, bump `SAVE_VERSION`,
  add a `migrateVNtoVN+1` step and a line in the `migrateSave` ladder, write it in
  `Game.toSaveData()`, read it with `?? default` in `Game.restore()`. Add a test in
  `tests/save-migrate.test.ts`.
- **Adding a `TileType` or `RoomFeatureKind`**: several exhaustive `Record`s must be
  updated or `tsc` fails — `TILE_COLORS` in `TileMap.ts`, `VARIANTS` in
  `RoomFeatures.ts`, and `RoomFeatureController.HINT`. `drawFeature` in `MapRenderer.ts` has a
  default arm, so a new kind renders as a generic marker until you give it a case.
  A feature that the DM can act on also needs an intent in `DMCommand.ts`, a branch in
  `parseFeatureIntent`, a case in `RoomFeatureController.perform`, a case label on the
  feature arm of `DMCommandDispatcher`, and a retrain.
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

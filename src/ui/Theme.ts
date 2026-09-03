/**
 * UI theme — one design language for every panel.
 *
 * The world art is candlelight on stone: warm torch pools, a colour grade, and
 * parchment-coloured highlights. The overlay follows it — warm ink panels,
 * parchment text, gold hairlines — rather than the cool blue-grey of a web
 * dashboard.
 *
 * Everything here is a token. Panels should read colour, radius, spacing and
 * type from `T` (or from the shared classes installed by `installTheme`)
 * instead of inlining hex, so a change to the language lands everywhere at
 * once.
 *
 * Fonts are local stacks only: the game ships with no runtime dependencies and
 * must not reach the network to draw its own UI. `Palatino Linotype` / `Book
 * Antiqua` (Windows), `Palatino` / `Iowan Old Style` (macOS) and Georgia
 * everywhere else give the inscriptional serif the titles want; Georgia is the
 * body face because it holds up at 11-12px where Palatino goes thin.
 */

const THEME_STYLE_ID = 'dungeon-party-theme';

/** Canonical theme tokens. Values are quoted so they can be inlined in cssText. */
export const T = {
  /** Deepest background ink (panels, scrims). */
  ink: '#0b0d12',
  /** Raised panel background. */
  panel: 'rgba(19, 18, 24, 0.93)',
  /** The same panel as a two-stop gradient, for the larger surfaces. */
  panelGrad: 'linear-gradient(180deg, rgba(24,22,29,0.95), rgba(14,13,18,0.96))',
  /** Slightly raised row / card background. */
  row: 'rgba(232, 197, 106, 0.045)',
  /** Row background on hover. */
  rowHot: 'rgba(232, 197, 106, 0.09)',
  /** Hairline border color for dark surfaces. */
  line: '#312d33',
  /** Brighter border for hovered/focused elements. */
  lineHot: '#5c5040',
  /** A gold hairline, for section rules and panel insets. */
  rule: 'rgba(232, 197, 106, 0.16)',
  /** Primary gold accent (titles, active states). */
  gold: '#e8c56a',
  /** Dimmer gold for secondary accents. */
  goldDim: '#a08a4a',
  /** Body text on dark surfaces — warm parchment, not cool grey. */
  text: '#ddd5c4',
  /** Muted/secondary text. */
  muted: '#968e7e',
  /** Faintest text — hints, disabled. */
  faint: '#6b6559',
  /** Hero/success green. */
  good: '#8ecf92',
  /** Warning amber. */
  warn: '#e8b45a',
  /** Danger red. */
  bad: '#e0705f',
  /** Arcane violet (magic UI accents). */
  arcane: '#bb9ee0',
  /** Cool blue, for information and objectives. */
  info: '#8cbede',
  /** Coin / treasure brown-gold. */
  coin: '#d2a862',
  /** The gold frame of a JRPG window (the victory summary's border). */
  frame: '#b8963e',
  /** The warm ink behind a JRPG window, as the victory summary paints it. */
  windowGrad: 'linear-gradient(180deg, rgba(32,27,20,0.98), rgba(14,12,10,0.98))',
  /** Title font stack (local faces only). */
  titleFont: "'Palatino Linotype', 'Book Antiqua', Palatino, 'Iowan Old Style', Georgia, serif",
  /** Body font stack (local faces only). */
  bodyFont: "Georgia, 'Palatino Linotype', 'Times New Roman', serif",
  /** Numeric/tabular stack, for dice, HP and prices. */
  monoFont: "'Consolas', 'DejaVu Sans Mono', 'Courier New', monospace",
  /** Corner radii: chips, controls, panels. */
  r1: '3px',
  r2: '5px',
  r3: '8px',
} as const;

/**
 * Class accent colours, one per class id in `CLASSES`. All fourteen are here:
 * the six that used to fall through to grey (bard, sorcerer, warlock, monk,
 * artificer, blood hunter) left half a party unreadable at a glance.
 */
export const CLASS_COLOR: Record<string, string> = {
  fighter: '#d4705f',
  barbarian: '#d08a4a',
  paladin: '#e8cf8a',
  ranger: '#7fae72',
  druid: '#8fbf5a',
  monk: '#6fc4b8',
  rogue: '#9a93a8',
  bard: '#e08fb8',
  cleric: '#dcd5c4',
  wizard: '#6f9fd8',
  sorcerer: '#d06a8a',
  warlock: '#a97fd8',
  artificer: '#c8a06a',
  blood_hunter: '#c2504e',
};

/** The accent colour for a class id, falling back to parchment. */
export function classColor(classId: string): string {
  return CLASS_COLOR[classId] ?? T.text;
}

/** Bar colour for a fraction of remaining health. */
export function hpColor(fraction: number): string {
  return fraction > 0.5 ? '#6fbf7a' : fraction > 0.25 ? '#d9a94a' : '#d0604f';
}

/**
 * Install the global stylesheet once per document.
 * Safe to call repeatedly — it is idempotent.
 */
export function installTheme(): void {
  if (document.getElementById(THEME_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = `
    /* ── Global type ───────────────────────────────────────────── */
    #app, #ui-overlay, .dp-theme {
      font-family: ${T.bodyFont};
      color: ${T.text};
    }
    /* Inscriptional serif for every title and banner. */
    #dungeon-title, #battle-banner, #battle-round, .dp-title {
      font-family: ${T.titleFont} !important;
      letter-spacing: 1.5px;
    }
    #battle-order > span:first-child { letter-spacing: 2px; }
    /* The battle feed reads as prose, like the combat log. */
    #battle-feed {
      font-family: ${T.bodyFont} !important;
      font-size: 12.5px !important;
      line-height: 1.42 !important;
    }
    /* Small caps-ish section headers: gold, tracked out, hairline above. */
    .dp-section-label {
      font-family: ${T.titleFont} !important;
      letter-spacing: 2px !important;
      text-transform: uppercase;
    }
    .dp-label {
      font-family: ${T.titleFont};
      font-size: 9px;
      font-weight: bold;
      letter-spacing: 1.8px;
      text-transform: uppercase;
      color: ${T.goldDim};
    }
    /* A gold hairline with a tracked-out label sitting on it. */
    .dp-rule {
      margin: 9px 0 4px;
      padding-top: 6px;
      border-top: 1px solid ${T.rule};
    }

    /* ── Panels ────────────────────────────────────────────────── */
    .dp-panel {
      background: ${T.panelGrad};
      border: 1px solid ${T.line};
      border-radius: ${T.r3};
      box-shadow: 0 12px 40px rgba(0,0,0,0.7), inset 0 0 0 1px ${T.rule};
    }
    /* A raised row inside a panel: quests, shop lines, NPCs, buildings. */
    .dp-row {
      background: ${T.row};
      border: 1px solid ${T.line};
      border-radius: ${T.r2};
      transition: border-color .15s ease, background .15s ease;
    }
    .dp-row-click { cursor: pointer; }
    .dp-row-click:hover { border-color: ${T.goldDim}; background: ${T.rowHot}; }
    /* A JRPG window: the gold-framed box the battle screen is built from —
       command menu, narration, party status — drawn exactly as the victory
       summary is, so the whole fight speaks one dialect. */
    .dp-window {
      background: ${T.windowGrad};
      border: 2px solid ${T.frame};
      border-radius: ${T.r3};
      box-shadow: 0 6px 30px rgba(0,0,0,0.7), inset 0 0 0 1px ${T.rule};
    }

    /* ── Chips ─────────────────────────────────────────────────── */
    /* One shape for every status pill in the game: weather, delve mood,
       quest tracker, reputation tier, conditions. */
    .dp-chip {
      display: inline-flex; align-items: center; gap: 5px;
      font-family: ${T.bodyFont};
      font-size: 11px;
      line-height: 1.5;
      padding: 3px 9px;
      border-radius: 999px;
      border: 1px solid ${T.line};
      background: rgba(10, 9, 13, 0.85);
      color: ${T.text};
      white-space: nowrap;
    }
    .dp-chip-sm { font-size: 9px; padding: 1px 7px; gap: 4px; }
    /* A chip that has to give way when its row is crowded. An inline-flex box
       swallows text-overflow (the text is an anonymous flex item), so truncating
       chips are inline-block and end in a proper ellipsis, not a hard clip. */
    .dp-chip-trunc {
      display: inline-block;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── Buttons ───────────────────────────────────────────────── */
    #hud-top button, .dp-btn {
      font-family: ${T.bodyFont} !important;
      background: linear-gradient(180deg, rgba(46,42,52,0.95), rgba(26,24,31,0.95)) !important;
      border: 1px solid ${T.line} !important;
      border-radius: ${T.r2} !important;
      color: ${T.text} !important;
      cursor: pointer;
      transition: border-color .15s ease, box-shadow .15s ease, transform .06s ease, background .15s ease;
    }
    #hud-top button:hover, .dp-btn:hover {
      border-color: ${T.goldDim} !important;
      box-shadow: 0 0 10px rgba(232,197,106,0.18);
    }
    #hud-top button:active, .dp-btn:active { transform: translateY(1px); }
    /* Gold-framed primary action (Continue, Send, Accept, close-on-confirm). */
    .dp-btn-gold {
      font-family: ${T.bodyFont} !important;
      background: linear-gradient(180deg, rgba(96,80,36,0.95), rgba(58,46,20,0.95)) !important;
      border: 1px solid ${T.goldDim} !important;
      border-radius: ${T.r2} !important;
      color: #f6e7bd !important;
      cursor: pointer;
      transition: border-color .15s ease, box-shadow .15s ease, transform .06s ease;
    }
    .dp-btn-gold:hover {
      border-color: ${T.gold} !important;
      box-shadow: 0 0 12px rgba(232,197,106,0.28);
    }
    .dp-btn-gold:active { transform: translateY(1px); }
    /* Destructive action: the same shape, banked to red. */
    .dp-btn-bad {
      background: linear-gradient(180deg, rgba(74,30,26,0.95), rgba(44,18,16,0.95)) !important;
      border-color: #6b3a34 !important;
      color: #e0a094 !important;
    }
    .dp-btn-bad:hover { border-color: #a4574c !important; box-shadow: 0 0 12px rgba(200,90,70,0.25); }

    /* ── Fields ────────────────────────────────────────────────── */
    input[type="text"], input[type="search"], textarea, select {
      font-family: ${T.bodyFont} !important;
      background: rgba(9, 8, 12, 0.9) !important;
      border: 1px solid ${T.line} !important;
      border-radius: ${T.r1} !important;
      color: ${T.text} !important;
      outline: none !important;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    input[type="text"]:focus, input[type="search"]:focus, textarea:focus, select:focus {
      border-color: ${T.goldDim} !important;
      box-shadow: 0 0 8px rgba(232,197,106,0.22) !important;
    }
    ::placeholder { color: ${T.faint}; font-style: italic; }

    /* ── Scrollbars ────────────────────────────────────────────── */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: rgba(0,0,0,0.25); border-radius: 4px; }
    ::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: ${T.lineHot}; }
    ::selection { background: rgba(232,197,106,0.3); color: #fff; }

    /* ── Start-screen slot cards ───────────────────────────────── */
    .dp-slot-btn {
      transition: border-color .15s ease, box-shadow .15s ease, transform .06s ease;
    }
    .dp-slot-btn:hover {
      border-color: ${T.goldDim} !important;
      box-shadow: 0 0 14px rgba(232,197,106,0.16);
    }
    .dp-slot-btn:active { transform: translateY(1px); }

    /* ── The narrative log ─────────────────────────────────────────
       Both the HUD's combat log and the battle window's feed render
       lines through this. Every line is a two-column grid: a fixed
       glyph gutter and the prose. That gutter is the whole point —
       it turns a wall of coloured text into a readable ledger, and
       it lets the eye find loot, harm and speech without reading.  */
    #combat-log, #battle-feed {
      font-family: ${T.bodyFont} !important;
      font-size: 12.5px !important;
      line-height: 1.45 !important;
      letter-spacing: 0.1px;
    }
    .dp-log-line {
      display: grid;
      grid-template-columns: 15px 1fr;
      gap: 0 5px;
      align-items: baseline;
      color: ${T.text};
      padding: 0 0 1px;
    }
    /* A new entry gets air above it; continuation lines stay tight to
       their parent so an indented block reads as one thing. */
    .dp-log-line + .dp-log-line:not(.dp-log-sub) { margin-top: 2px; }
    .dp-log-glyph {
      grid-column: 1;
      text-align: center;
      font-size: 10px;
      line-height: 1.6;
      opacity: 0.9;
      user-select: none;
    }
    .dp-log-body { grid-column: 2; min-width: 0; }
    /* Indented continuation lines ("   +12 gp, +40 XP") keep the gutter
       but step their prose in, so detail hangs under its heading. */
    .dp-log-sub .dp-log-body { padding-left: 12px; color: ${T.muted}; font-size: 11.5px; }
    .dp-log-sub2 .dp-log-body { padding-left: 24px; color: ${T.muted}; font-size: 11.5px; }

    /* Tones. Deliberately few: the call sites pass 40-odd different hexes
       and they all collapse into these, so the log has a palette rather
       than a paintbox. */
    .dp-log-plain  { color: ${T.text}; }
    .dp-log-muted  { color: ${T.muted}; }
    .dp-log-good   { color: ${T.good}; }
    .dp-log-info   { color: ${T.info}; }
    .dp-log-arcane { color: ${T.arcane}; }
    .dp-log-loot   { color: ${T.coin}; }
    .dp-log-gold   { color: ${T.gold}; }
    .dp-log-harm   { color: ${T.bad}; }
    .dp-log-warn   { color: ${T.warn}; }
    /* Speech: italic parchment behind a quote rule — the party talking
       should never look like the engine reporting damage. */
    .dp-log-speech .dp-log-body {
      font-style: italic;
      color: #e6d9b8;
      border-left: 2px solid ${T.rule};
      padding-left: 8px;
    }
    /* The DM's own order, echoed back: gold, tracked, unmistakable. */
    .dp-log-order .dp-log-body {
      color: ${T.gold};
      letter-spacing: 0.5px;
    }
    .dp-log-order .dp-log-glyph { color: ${T.gold}; }
    /* A scene break ("--- Combat begins ---"). */
    .dp-log-break {
      margin: 6px 0 4px;
      color: ${T.faint};
      font-size: 10px;
      letter-spacing: 2px;
      text-transform: uppercase;
      text-align: center;
      border-top: 1px solid ${T.rule};
      padding-top: 5px;
      display: block;
    }
    .dp-log-break .dp-log-glyph { display: none; }
    /* Numbers inside prose line up. */
    .dp-log-body b, .dp-num { font-variant-numeric: tabular-nums; }
  `;
  document.head.appendChild(style);
}

/**
 * The tone a log line is drawn in. `addCombatMessage` still takes the colour
 * the game has always passed; this maps that paintbox onto the palette.
 */
export type LogTone =
  | 'plain' | 'muted' | 'good' | 'info' | 'arcane'
  | 'loot' | 'gold' | 'harm' | 'warn';

/** Hex → tone. Keys are lower-case, `#`-prefixed, as the game passes them. */
const TONE_BY_COLOR: Record<string, LogTone> = {
  // Gold — victory, level-ups, the things worth stopping for.
  '#ffd700': 'gold', '#dd0': 'gold', '#ff9': 'gold', '#ff8': 'gold',
  '#cc8': 'gold', '#aa8': 'gold', '#fd8': 'gold', '#d8c88a': 'gold',
  // Coin and cargo — buying, selling, hauling.
  '#ca8': 'loot', '#a86': 'loot', '#c86': 'loot', '#c84': 'loot',
  '#a96': 'loot', '#caa': 'loot', '#a88': 'loot', '#a89': 'loot',
  '#c9a04a': 'loot',
  // Harm — damage, death, refusals, warnings.
  '#c66': 'harm', '#c44': 'harm', '#f44': 'harm', '#f88': 'harm',
  '#c88': 'harm', '#fa6': 'warn',
  // Information — objectives, travel, the world reporting itself.
  '#8cf': 'info', '#7bd': 'info', '#88a': 'info', '#8ff': 'info', '#6fd': 'info',
  // Good — healing, rests, success.
  '#8a8': 'good', '#7c7': 'good', '#8f8': 'good', '#6c6': 'good',
  '#8d8': 'good', '#8c8': 'good', '#7ca': 'good', '#6a8': 'good',
  // Arcane — spells, omens, the strange.
  '#a8f': 'arcane', '#a9f': 'arcane', '#c9b8ff': 'arcane', '#a8a': 'arcane',
  '#a8c': 'arcane', '#f6c': 'arcane',
  // Quiet — bookkeeping the player skims.
  '#888': 'muted', '#886': 'muted', '#666': 'muted', '#778': 'muted',
  '#9a9': 'muted', '#9aa': 'muted', '#ccc': 'plain',
};

/** Map one of the game's log colours onto the palette. */
export function toneForColor(color: string): LogTone {
  return TONE_BY_COLOR[color.toLowerCase()] ?? 'plain';
}

/**
 * UI theme — one design language for every panel: parchment-on-ink fantasy
 * colors, warm gold accents, shared radii/shadows, and a font pairing
 * (Cinzel for titles, Spectral for body text) loaded once from Google Fonts.
 * Panels can opt in gradually — anything still using inline `monospace`
 * styling keeps working, but new/rendered-once surfaces should use these.
 */

const FONT_LINK_ID = 'dungeon-party-fonts';
const THEME_STYLE_ID = 'dungeon-party-theme';

/** Canonical theme tokens. Values are quoted so they can be inlined in cssText. */
export const T = {
  /** Deepest background ink (panels, scrims). */
  ink: '#0b0e14',
  /** Raised panel background. */
  panel: 'rgba(16, 20, 30, 0.92)',
  /** Slightly raised row / card background. */
  row: 'rgba(255, 255, 255, 0.035)',
  /** Hairline border color for dark surfaces. */
  line: '#2a3242',
  /** Brighter border for hovered/focused elements. */
  lineHot: '#4a5a78',
  /** Primary gold accent (titles, active states). */
  gold: '#e8c56a',
  /** Dimmer gold for secondary accents. */
  goldDim: '#a08a4a',
  /** Body text on dark surfaces. */
  text: '#d6dce8',
  /** Muted/secondary text. */
  muted: '#8a94a6',
  /** Hero/success green. */
  good: '#7fd88f',
  /** Warning amber. */
  warn: '#e8b45a',
  /** Danger red. */
  bad: '#e0705f',
  /** Arcane violet (magic UI accents). */
  arcane: '#b39ddb',
  /** Title font stack. */
  titleFont: "'Cinzel', 'Georgia', serif",
  /** Body font stack. */
  bodyFont: "'Spectral', 'Georgia', serif",
} as const;

/**
 * Install the font links + global stylesheet once per document.
 * Safe to call repeatedly — it is idempotent.
 */
export function installTheme(): void {
  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Spectral:ital,wght@0,400;0,600;1,400&display=swap';
    document.head.appendChild(link);
  }
  if (document.getElementById(THEME_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = `
    /* ── Global polish ─────────────────────────────────────────── */
    #app, .dp-theme {
      font-family: ${T.bodyFont};
      color: ${T.text};
    }
    /* Cinzel titles: dungeon title, banners, panel headers. */
    #dungeon-title, #battle-banner, #battle-round, .dp-title {
      font-family: ${T.titleFont} !important;
      letter-spacing: 1.5px;
    }
    /* Battle turn-order bar label + town header get the same treatments. */
    #battle-order > span:first-child { letter-spacing: 2px; }
    /* Battle window: feed reads as body prose, captions get Cinzel. */
    #battle-feed {
      font-family: ${T.bodyFont} !important;
      font-size: 12.5px !important;
      line-height: 1.42 !important;
    }
    .dp-section-label {
      font-family: ${T.titleFont} !important;
      letter-spacing: 2px !important;
    }
    /* Buttons: parchment-raised look, consistent across the HUD. */
    #hud-top button, .dp-btn {
      font-family: ${T.bodyFont} !important;
      background: linear-gradient(180deg, rgba(38,46,64,0.95), rgba(22,28,42,0.95)) !important;
      border: 1px solid ${T.line} !important;
      border-radius: 5px !important;
      color: ${T.text} !important;
      transition: border-color .15s ease, box-shadow .15s ease, transform .06s ease;
    }
    #hud-top button:hover, .dp-btn:hover {
      border-color: ${T.goldDim} !important;
      box-shadow: 0 0 10px rgba(232,197,106,0.18);
    }
    #hud-top button:active, .dp-btn:active { transform: translateY(1px); }
    /* Combat log: a touch of readability polish. */
    #combat-log {
      font-family: ${T.bodyFont} !important;
      font-size: 12.5px !important;
      line-height: 1.45 !important;
      letter-spacing: 0.1px;
    }
    /* Scrollbars: slim, dark, unobtrusive — everywhere. */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: rgba(0,0,0,0.25); border-radius: 4px; }
    ::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: ${T.lineHot}; }
    /* Inputs: quiet dark fields with a gold focus ring. */
    input[type="text"], input[type="search"], textarea {
      font-family: ${T.bodyFont} !important;
      background: rgba(8, 11, 18, 0.9) !important;
      border: 1px solid ${T.line} !important;
      border-radius: 4px !important;
      color: ${T.text} !important;
      outline: none !important;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    input[type="text"]:focus, input[type="search"]:focus, textarea:focus, select:focus {
      border-color: ${T.goldDim} !important;
      box-shadow: 0 0 8px rgba(232,197,106,0.22) !important;
    }
    /* Selects: same quiet dark field as text inputs (dropdown arrow tinted). */
    select {
      font-family: ${T.bodyFont} !important;
      background: rgba(8, 11, 18, 0.9) !important;
      border: 1px solid ${T.line} !important;
      border-radius: 4px !important;
      color: ${T.text} !important;
      outline: none !important;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    /* Gold-framed primary action (Continue, Send, close-on-confirm). */
    .dp-btn-gold {
      font-family: ${T.bodyFont} !important;
      background: linear-gradient(180deg, rgba(96,80,36,0.95), rgba(60,48,20,0.95)) !important;
      border: 1px solid ${T.goldDim} !important;
      border-radius: 5px !important;
      color: #f6e7bd !important;
      transition: border-color .15s ease, box-shadow .15s ease, transform .06s ease;
    }
    .dp-btn-gold:hover {
      border-color: ${T.gold} !important;
      box-shadow: 0 0 12px rgba(232,197,106,0.28);
    }
    .dp-btn-gold:active { transform: translateY(1px); }
    /* Selection: gold on ink, matching the accent language. */
    ::selection { background: rgba(232,197,106,0.3); color: #fff; }
    /* Start-screen slot cards + big choice buttons: hover lift without
       overriding their tinted backgrounds. */
    .dp-slot-btn {
      transition: border-color .15s ease, box-shadow .15s ease, transform .06s ease;
    }
    .dp-slot-btn:hover {
      border-color: ${T.goldDim} !important;
      box-shadow: 0 0 14px rgba(232,197,106,0.16);
    }
    .dp-slot-btn:active { transform: translateY(1px); }
  `;
  document.head.appendChild(style);
}

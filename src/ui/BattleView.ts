import { GameCharacter } from '../entities/Character';
import type { CombatAbility } from '../combat/Abilities';
import { Monster } from '../entities/Monster';
import { SpriteRenderer } from '../entities/Sprites';
import { BIND_ORDER, BindAction, BindMap, DEFAULT_KEYBINDS, labelFor, loadKeybinds, saveKeybinds } from './Keybinds';
import { Party } from '../entities/Party';
import { CONDITION_META } from '../rules/Rules';
import { maxSlotsFor, getCasterType, SPELLS } from '../data/gameData';
import type { Spell } from '../data/gameData';
import type { PartyCommand } from '../combat/CombatEngine';
import type { DiceSounds } from './DiceSounds';
import { battleSceneCss, type BattleScene } from './BattleScenes';
import { T, classColor, hpColor } from './Theme';

/** A consumable the command menu can offer: a potion or scroll in someone's pack. */
export interface MenuConsumable {
  itemId: string;
  holderId: string;
  name: string;
  holderName: string;
}

/** What the party walked away with — shown in the victory summary panel. */
export interface BattleSpoils {
  xpEach: number;
  gold: number;
  items: { name: string; kind: 'magic' | 'potion' | 'scroll' | 'treasure' | 'other' }[];
  kills: { name: string; count: number }[];
  boss: boolean;
}

/**
 * BattleView — a full-screen, Final-Fantasy-style combat window.
 *
 * When a fight starts this overlay covers the map so the battle reads as its
 * own scene: heroes line the bottom with their class sprites, hit points and
 * spell slots; enemies loom across the top with their own health; and a
 * central feed streams every action as it lands. Whose turn it is is always
 * highlighted, and the win/loss banner crowns the outcome.
 *
 * The game is AI-driven, so this is a presentation layer over the combat
 * engine's existing state — no new simulation, just a window that makes the
 * fight legible and dramatic.
 */
export class BattleView {
  private root: HTMLElement;
  private enemyRow: HTMLElement;
  private heroRow: HTMLElement;
  /** The scrolling frame of the narration panel. */
  private feedEl: HTMLElement;
  /** The lines themselves, bottom-anchored inside that frame. */
  private feedLinesEl: HTMLElement;
  private roundEl: HTMLElement;
  private bannerEl: HTMLElement;
  /** Rows of the party status window (bottom-left, under the command menu). */
  private statusRowsEl: HTMLElement;
  private spellRenderer: SpriteRenderer | null = null;
  private party: Party | null = null;
  private enemies: Monster[] = [];
  private activeEnemyId: string | null = null;
  private activeHeroId: string | null = null;
  private isOpen: boolean = false;
  /** Battle playback speed multiplier, adjustable from inside the window. */
  private speed: number = 1;
  /** Notifies the game to rescale its combat tick interval. */
  public onSpeedChange?: (speed: number) => void;

  private static readonly SPEEDS = [0.5, 1, 2, 4] as const;

  /** Last-tick HP snapshots — a drop means the actor was hit this tick. */
  private lastHp: Map<string, number> = new Map();
  /** Actors that lunged this tick (attacker ids), so cards get the lunge class. */
  private lungedIds: Set<string> = new Set();
  /** Actors that were hit this tick, for the shake/flash effect. */
  private hitIds: Set<string> = new Set();
  /** Damage numbers waiting to pop over the hit card: {id, text, kind}. */
  private pendingPops: { id: string; text: string; crit: boolean; heal: boolean }[] = [];
  /** Actors that were crit this tick — red flash overlay + hit-spark burst. */
  private critIds: Set<string> = new Set();
  /** Actors healed this tick — soft green glow. */
  private healIds: Set<string> = new Set();
  /** Casters this tick → spell element, for the colored cast glow. */
  private castGlows: { id: string; color: string }[] = [];
  /** Spell-damage victims this tick → element color, for the impact ring. */
  private impactRings: { id: string; color: string }[] = [];
  /** Melee-hit victims this tick, for the slash streak. */
  private slashIds: Set<string> = new Set();
  /** Spell elements by spell name (from SPELLS damage strings). */
  private static readonly ELEMENT_COLORS: Record<string, string> = {
    fire: '#ff8a3c', cold: '#6ec6ff', lightning: '#ffe95c', thunder: '#c8a8ff',
    necrotic: '#9a6adf', radiant: '#ffe9a0', force: '#b0c8ff', psychic: '#ff8ac8',
    poison: '#8ae06a', acid: '#c0e84a',
  };
  private static readonly DEFAULT_ELEMENT = '#c8a8ff';

  // ── FF command menu state ──
  /** The hero whose turn is paused; null hides the menu. */
  private menuHero: GameCharacter | null = null;
  /** Quick-cast memory: the last spell each hero cast, for Shift+2 recast. */
  private lastSpellByHero: Map<string, { spellId: string; spellName: string }> = new Map();
  /** Transient hint-row message (e.g. a failed quick-cast reason). */
  private quickCastFlash: string | null = null;
  /** Living party roster for Tab-cycling (synced from the game). */
  private partyRoster: GameCharacter[] = [];
  /** The hero the engine is actually paused on — their pick resolves the pause. */
  private parkedHeroId: string | null = null;
  /** True while the menu shows a non-parked hero: picks are queued, not submitted. */
  private menuIsQueued: boolean = false;
  /** Orders queued via Tab-cycling, consumed by the game when each hero acts. */
  public queuedOrders: Map<string, PartyCommand> = new Map();
  /** Hero id the command menu is currently open on (their chip turns gold). */
  private pausedOrderKey: string | null = null;
  /** Targeting mode: pending command + the candidate cards being cycled. */
  private targeting: {
    cmd: PartyCommand;
    candidates: { id: string; label: string; isEnemy: boolean }[];
    index: number;
  } | null = null;
  // ── Gamepad (couch play): D-pad moves, Ⓐ confirms, Ⓑ backs out ──
  /** Buttons held on the previous poll — edges trigger, holds do nothing. */
  private padPrev: boolean[] = [];
  /** Poll interval handle (0 = not running). */
  private padPollId: number = 0;
  /** True while any gamepad is connected — flips the hint rows to pad-first. */
  private padConnected: boolean = false;
  // ── Remappable hotkeys (F1 opens the controls overlay) ──
  /** Current bind map, persisted in localStorage via Keybinds.ts. */
  private binds: BindMap = loadKeybinds();
  /** Turn-order bar element (initiative chips across the top). */
  private turnOrderEl: HTMLElement;
  /** Last-known initiative order from the engine (for the turn bar). */
  private lastTurnActors: (GameCharacter | Monster)[] = [];
  /** F1 overlay element (created on first toggle, hidden afterwards). */
  private controlsEl: HTMLElement | null = null;
  /** Action mid-remap — the next keydown captures its code. */
  private remapping: BindAction | null = null;
  /** Game-side sync: copy the engine's queue into the chip mirror each tick. */
  public chipSyncFromGame?: () => void;
  /** Providers so the cycle menu can build spell/item panes for any hero. */
  public spellsFor?: (hero: GameCharacter) => Spell[];
  public itemsFor?: () => MenuConsumable[];
  /** Consumables the game offers for the Item submenu (potion/scroll entries). */
  private menuItems: MenuConsumable[] = [];
  /** Spells the acting hero can afford, provided by the game each pause. */
  private menuSpells: Spell[] = [];
  /** The acting hero's usable class ability, if any. */
  private menuAbility: CombatAbility | null = null;
  /** Which submenu pane is showing. */
  private menuPane: 'root' | 'spell' | 'item' = 'root';
  /** Numbered buttons of the current menu pane, in order — keyboard 1-9 targets. */
  private menuButtons: { el: HTMLElement; onClick: () => void; key?: string; danger?: boolean }[] = [];
  /** Keyboard cursor index within menuButtons (classic FF selection). */
  private menuCursor: number = 0;
  /** Blinking ▶ pointer element attached to the cursor row. */
  private cursorEl: HTMLElement | null = null;
  /** DM picked a command — the game executes it and resumes the tick. */
  public onCommand?: (heroId: string, cmd: PartyCommand) => void;
  /** Game-side hook: an order was queued for a hero who is not acting yet. */
  public onQueuedOrder?: (heroId: string, cmd: PartyCommand) => void;
  /** Game-side hook: a formation preset's battle-cry line for the feed. */
  public onFormation?: (line: string) => void;
  /** Menu root element, created lazily inside the battle window. */
  private menuEl: HTMLElement | null = null;
  /** Web-audio engine (shared with the dice tray) for end-of-fight jingles. */
  public sounds: { victoryFanfare(): void; defeatSting(): void } | null = null;
  /** Command mode: 'manual' pauses every hero's turn for the menu; 'auto' lets the AI resolve. */
  private mode: 'manual' | 'auto' = 'manual';
  /** The game flips this when the mode button is pressed; drives decisionPause. */
  public onModeChange?: (mode: 'manual' | 'auto') => void;
  /** Victory summary panel element, created lazily. */
  private spoilsEl: HTMLElement | null = null;
  /** Timeout handle for the summary's auto-dismiss. */
  private spoilsTimer: number | null = null;
  /** Set when close() was requested while the summary is still up. */
  private pendingClose: boolean = false;
  /** Guards the close() → dismissSpoils() → close() recursion. */
  private closing: boolean = false;

  constructor(overlay: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'battle-view';
    this.root.style.cssText = [
      'position:absolute; inset:0; z-index:45; display:none;',
      `background:${T.ink};`,
      `flex-direction:column; font-family:${T.bodyFont}; overflow:hidden;`,
    ].join('');
    this.root.innerHTML = `
      <style>
        /* ── The field ──────────────────────────────────────────────
           A side-view battlefield: a thin band of sky, a horizon rule,
           and a floor the two sides stand on. The floor is lit from
           below the way the map is lit by its torches. */
        #battle-field {
          /* Defaults: the old torchlit hall. setScene() overrides these per fight. */
          --bv-sky: linear-gradient(180deg, #07060a 0%, #0c0a0e 100%);
          --bv-floor: linear-gradient(180deg, #1a1410 0%, #16110d 55%, #0f0c09 100%);
          --bv-horizon: rgba(232,197,106,0.32);
          --bv-lines: rgba(232,197,106,0.035);
          --bv-glow: rgba(232,197,106,0.13);
          --bv-scenery: none;
          --bv-weather: none;
        }
        #battle-ground {
          position: absolute; inset: 0; pointer-events: none;
          /* Sky above the horizon line (the top third), floor below it. */
          background: var(--bv-sky) top / 100% 34% no-repeat, var(--bv-floor) bottom / 100% 66% no-repeat;
        }
        #battle-ground::before {
          /* Horizon: a hairline where the sky meets the ground. */
          content: ''; position: absolute; left: 0; right: 0; top: 34%; height: 1px; z-index: 2;
          background: linear-gradient(90deg, transparent, var(--bv-horizon) 25%, var(--bv-horizon) 75%, transparent);
        }
        #battle-ground::after {
          /* Floor: a glow under the ranks, faint perspective courses, a vignette to the sides. */
          content: ''; position: absolute; left: 0; right: 0; top: 34%; bottom: 0;
          background:
            radial-gradient(ellipse 70% 55% at 50% 100%, var(--bv-glow), transparent 70%),
            linear-gradient(90deg, rgba(0,0,0,0.5), transparent 18%, transparent 82%, rgba(0,0,0,0.5)),
            repeating-linear-gradient(180deg, transparent 0 26px, var(--bv-lines) 26px 27px);
        }
        #battle-scenery {
          /* Silhouettes against the sky, standing on the horizon. */
          position: absolute; left: 0; right: 0; top: 0; height: 34%; pointer-events: none; z-index: 1;
          background: var(--bv-scenery);
        }
        #battle-weather {
          position: absolute; inset: 0; pointer-events: none; z-index: 3;
          background: var(--bv-weather);
        }
        /* ── Stands ─────────────────────────────────────────────────
           Every combatant is a stand: the sprite over a shadow, a name
           tag and a health bar beneath. Positioned absolutely by the
           formation layout; moves glide when the ranks reshuffle. */
        .battle-card {
          position: absolute; display: flex; flex-direction: column; align-items: center; gap: 2px;
          transition: left .35s ease, top .35s ease, transform .18s ease-out;
          will-change: transform;
        }
        .battle-card.bv-hero.bv-active { transform: translateX(-14px); }
        .battle-card.bv-foe.bv-active { transform: translateX(14px); }
        .bv-figure {
          position: relative; display: flex; align-items: flex-end; justify-content: center;
          flex: 0 0 auto;
        }
        .bv-shadow {
          position: absolute; left: 50%; bottom: -2px; transform: translateX(-50%);
          width: 88%; height: 22%; border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.45) 45%, transparent 72%);
          pointer-events: none;
        }
        .bv-ring {
          position: absolute; left: 50%; bottom: -5px; transform: translateX(-50%);
          width: 104%; height: 28%; border-radius: 50%;
          border: 2px solid ${T.gold}; box-shadow: 0 0 12px rgba(232,197,106,0.55), inset 0 0 8px rgba(232,197,106,0.35);
          opacity: 0; transition: opacity .15s ease; pointer-events: none;
        }
        .battle-card.bv-active .bv-ring { opacity: 1; animation: bv-ring-pulse 1.4s ease-in-out infinite; }
        @keyframes bv-ring-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        .bv-sprite {
          position: relative; z-index: 2; image-rendering: pixelated; display: block;
          filter: drop-shadow(0 4px 3px rgba(0,0,0,0.55));
          transition: transform .3s ease, opacity .4s ease, filter .4s ease;
        }
        .battle-card.bv-active .bv-sprite { filter: drop-shadow(0 4px 3px rgba(0,0,0,0.55)) drop-shadow(0 0 6px rgba(232,197,106,0.45)); }
        /* The fallen: foes fade out where they stood; heroes lie down. */
        .battle-card.bv-down .bv-sprite { opacity: 0.28; filter: grayscale(1) drop-shadow(0 2px 2px rgba(0,0,0,0.5)); }
        .battle-card.bv-hero.bv-down .bv-sprite { transform: rotate(90deg) translateY(12%); opacity: 0.5; }
        .battle-card.bv-down .bv-shadow { opacity: 0.4; }
        .bv-tag {
          font-family: ${T.titleFont}; font-weight: bold; letter-spacing: 0.4px;
          text-align: center; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 100%; text-shadow: 0 1px 2px #000, 0 0 6px rgba(0,0,0,0.8);
        }
        .bv-hpbar {
          position: relative; width: 100%; height: 6px; border-radius: 2px; overflow: hidden;
          background: rgba(0,0,0,0.6); border: 1px solid rgba(232,197,106,0.28);
        }
        /* Two fills: the pale ghost drains slowly behind the live bar, so a
           blow reads as a chunk of health torn away rather than a snap. */
        .bv-hpghost { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(255,225,200,0.55); transition: width .9s ease-out .22s; }
        .bv-hpfill { position: absolute; left: 0; top: 0; bottom: 0; transition: width .3s ease-out, background-color .3s ease; }
        .bv-hpnum { font-size: 9px; color: ${T.muted}; line-height: 1.1; text-shadow: 0 1px 2px #000; }
        .bv-extra { font-size: 8.5px; line-height: 1.2; text-align: center; max-width: 100%; text-shadow: 0 1px 2px #000; }
        /* Queued-order chip on hero stands: slides in when an order lands. */
        @keyframes bv-chip-in {
          0% { transform: translateY(-6px) scale(0.8); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        .bv-order-chip {
          font-size: 8px; padding: 1px 6px; border-radius: 7px;
          border: 1px solid ${T.goldDim}; background: rgba(60,48,14,0.75); color: #f2dca0;
          white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
          animation: bv-chip-in 0.25s ease-out;
        }
        /* Targeting: the classic pointer hangs over the chosen creature and
           its ground ring burns red. */
        .battle-card.bv-targeted .bv-ring {
          opacity: 1; border-color: #ff7a5a;
          box-shadow: 0 0 12px rgba(255,120,80,0.55), inset 0 0 8px rgba(255,120,80,0.35);
          animation: none;
        }
        .battle-card.bv-targeted .bv-figure::before {
          content: '▼'; position: absolute; left: 50%; top: -18px; transform: translateX(-50%);
          color: #ff7a5a; font-size: 14px; z-index: 3; text-shadow: 0 0 6px rgba(255,120,80,0.8), 0 1px 2px #000;
          animation: bv-pointer-bob 0.6s ease-in-out infinite alternate;
        }
        @keyframes bv-pointer-bob { 0% { transform: translate(-50%, 0); } 100% { transform: translate(-50%, 4px); } }
        /* Gamepad pip: glows beside the header while a pad is connected. */
        @keyframes pad-pip-blink { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        .pad-pip { color: ${T.gold}; animation: pad-pip-blink 2s ease-in-out infinite; }
        /* FF-style blinking command cursor. */
        @keyframes menu-cursor-blink {
          0%, 55% { opacity: 1; }
          56%, 100% { opacity: 0.15; }
        }
        /* ── Kinetics ───────────────────────────────────────────────
           All of these move the figure, never the stand: the tag and
           bar stay put while the creature recoils or lunges. */
        @keyframes battle-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(4px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(2px); }
        }
        @keyframes battle-crit-shake {
          0%, 100% { transform: translate(0, 0) rotate(0); }
          12% { transform: translate(-9px, -4px) rotate(-2deg); }
          28% { transform: translate(8px, 3px) rotate(1.6deg); }
          44% { transform: translate(-7px, 2px) rotate(-1.4deg); }
          60% { transform: translate(6px, -3px) rotate(1.2deg); }
          76% { transform: translate(-4px, 1px) rotate(-0.8deg); }
          90% { transform: translate(2px, 0) rotate(0.4deg); }
        }
        /* Lunge toward the far side: heroes step left, foes step right. */
        @keyframes battle-lunge-left {
          0%, 100% { transform: translateX(0); }
          45% { transform: translateX(-22px) scale(1.06); }
        }
        @keyframes battle-lunge-right {
          0%, 100% { transform: translateX(0); }
          45% { transform: translateX(22px) scale(1.06); }
        }
        @keyframes battle-damage-pop {
          0% { transform: translate(-50%, 0) scale(0.6); opacity: 0; }
          15% { transform: translate(-50%, -8px) scale(1.25); opacity: 1; }
          70% { transform: translate(-50%, -26px) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -40px) scale(0.9); opacity: 0; }
        }
        .battle-card.bv-shake .bv-figure { animation: battle-shake 0.35s ease-in-out; }
        .battle-card.bv-lunge-left .bv-figure { animation: battle-lunge-left 0.3s ease-out; }
        .battle-card.bv-lunge-right .bv-figure { animation: battle-lunge-right 0.3s ease-out; }
        .battle-card.bv-hit .bv-sprite { filter: brightness(2.2) saturate(0.4) drop-shadow(0 0 8px #ff6040); transition: none; }
        /* Critical hit: violent shake + harsh red flash washing over the figure. */
        .battle-card.bv-crit .bv-figure {
          animation: battle-crit-shake 0.5s ease-in-out;
        }
        .battle-card.bv-crit .bv-sprite { animation: battle-crit-flash 0.55s ease-out; }
        .battle-card.bv-crit .bv-figure::after {
          content: ''; position: absolute; inset: -6px; pointer-events: none; border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(255,50,20,0.5) 0%, rgba(255,20,10,0.2) 55%, transparent 80%);
          animation: battle-crit-overlay 0.55s ease-out forwards; z-index: 5;
        }
        @keyframes battle-crit-flash {
          0% { filter: brightness(3.2) saturate(0.2) drop-shadow(0 0 14px #ff3810); }
          40% { filter: brightness(2.2) saturate(0.6) drop-shadow(0 0 10px #ff5030); }
          100% { filter: drop-shadow(0 4px 3px rgba(0,0,0,0.55)); }
        }
        @keyframes battle-crit-overlay {
          0% { opacity: 1; } 100% { opacity: 0; }
        }
        /* Healing: soft green glow blooming over the figure. */
        .battle-card.bv-heal-glow .bv-sprite { animation: battle-heal-glow 0.9s ease-out; }
        .battle-card.bv-heal-glow .bv-figure::after {
          content: ''; position: absolute; inset: -6px; pointer-events: none; border-radius: 50%;
          background: radial-gradient(ellipse at center, rgba(110,240,170,0.38) 0%, rgba(80,220,140,0.12) 55%, transparent 80%);
          animation: battle-crit-overlay 0.9s ease-out forwards; z-index: 5;
        }
        @keyframes battle-heal-glow {
          0% { filter: brightness(1.1) drop-shadow(0 0 6px #6ef0aa); }
          40% { filter: brightness(1.35) drop-shadow(0 0 16px #6ef0aa); }
          100% { filter: drop-shadow(0 4px 3px rgba(0,0,0,0.55)); }
        }
        /* Crit spark: a starburst of shrapnel streaks from the impact point. */
        .bv-spark {
          position: absolute; pointer-events: none; z-index: 31;
          width: 4px; height: 4px; border-radius: 50%;
          background: #ffe9a0; box-shadow: 0 0 6px #ffd24a, 0 0 12px #ff9020;
        }
        @keyframes battle-spark-fly {
          0% { transform: translate(0, 0) scale(1); opacity: 1; }
          70% { opacity: 1; }
          100% { transform: translate(var(--sx), var(--sy)) scale(0.3); opacity: 0; }
        }
        /* Spell-cast glow: element-colored aura blooming around the caster. */
        .bv-spell-glow {
          position: absolute; inset: -10px; pointer-events: none; z-index: 1;
          border-radius: 50%;
          background: radial-gradient(ellipse at center, var(--glow) 0%, transparent 72%);
          animation: battle-glow-fade 0.9s ease-out forwards;
        }
        @keyframes battle-glow-fade {
          0% { opacity: 0; transform: scale(0.85); }
          25% { opacity: 1; transform: scale(1.04); }
          100% { opacity: 0; transform: scale(1.1); }
        }
        /* Element impact: a colored ring bursting on the struck target. */
        .bv-impact-ring {
          position: absolute; pointer-events: none; z-index: 29;
          width: 30px; height: 30px; border-radius: 50%; margin-left: -15px;
          border: 3px solid var(--glow); box-shadow: 0 0 12px var(--glow), inset 0 0 8px var(--glow);
          animation: battle-impact-ring 0.5s ease-out forwards;
        }
        @keyframes battle-impact-ring {
          0% { transform: scale(0.3); opacity: 1; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        /* Melee slash: a white-hot streak sweeping across the struck figure. */
        .bv-slash {
          position: absolute; pointer-events: none; z-index: 28;
          width: 90px; height: 3px; border-radius: 2px; margin-left: -45px;
          background: linear-gradient(90deg, transparent, #fff 45%, #ffb090 60%, transparent);
          box-shadow: 0 0 8px rgba(255,200,150,0.9);
          animation: battle-slash-sweep 0.32s ease-out forwards;
        }
        @keyframes battle-slash-sweep {
          0% { transform: translate(-46px, 8px) rotate(-28deg); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: translate(34px, -6px) rotate(-28deg); opacity: 0; }
        }
        .bv-damage-pop {
          position: absolute; pointer-events: none; z-index: 30; left: 50%;
          font-weight: bold; font-size: 18px; font-family: ${T.monoFont};
          text-shadow: 0 1px 3px #000, 0 0 6px rgba(0,0,0,0.6), 0 0 1px #000;
          animation: battle-damage-pop 0.9s ease-out forwards;
        }
        /* ── Turn order ─────────────────────────────────────────────
           One strip of initiative chips under the header; the acting one
           is kept in view by scrolling the strip, never the page. */
        .bv-turn-chip {
          display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
          font-size: 9px; padding: 1px 7px; border-radius: 9px;
          border: 1px solid ${T.line}; background: rgba(16,14,19,0.88); color: ${T.text};
          white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis;
        }
        .bv-turn-chip.foe { border-color: #6a3630; background: rgba(34,15,13,0.88); color: #dbaa9e; }
        .bv-turn-chip.active {
          border-color: ${T.gold}; color: #f2dca0;
          box-shadow: 0 0 9px rgba(232,197,106,0.45);
          animation: pad-pip-blink 1.6s ease-in-out infinite;
        }
        .bv-turn-chip .dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
        /* ── Party status window ────────────────────────────────────
           The bottom-left window when no one is being asked for orders:
           one line per hero, the way the classic screens list the party. */
        .bv-status-row {
          display: grid; grid-template-columns: 14px minmax(0, 1fr) 62px 54px; align-items: center; gap: 0 6px;
          padding: 3px 4px; border-radius: ${T.r1}; font-size: 11.5px;
        }
        .bv-status-row.active { background: rgba(232,197,106,0.10); }
        .bv-status-row .cur { color: ${T.gold}; font-size: 9px; opacity: 0; animation: menu-cursor-blink 0.9s steps(1) infinite; }
        .bv-status-row.active .cur { opacity: 1; }
        .bv-status-row .nm { font-family: ${T.titleFont}; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bv-status-row .sub { font-size: 8.5px; color: ${T.muted}; font-family: ${T.bodyFont}; font-weight: normal; letter-spacing: 0; }
        .bv-status-row .hp { font-family: ${T.monoFont}; font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }
        .bv-status-row .pips { font-size: 8px; color: ${T.info}; text-align: right; white-space: nowrap; overflow: hidden; }
        .bv-status-row .bar { grid-column: 2 / 5; height: 3px; border-radius: 2px; background: rgba(0,0,0,0.55); border: 1px solid rgba(232,197,106,0.18); overflow: hidden; margin-top: 1px; }
        .bv-status-row .bar > div { height: 100%; transition: width .3s ease-out; }
        .bv-status-row .conds { grid-column: 2 / 5; font-size: 8.5px; color: #e8a99e; }
        .bv-status-row .chipwrap { grid-column: 2 / 5; }
      </style>
      <div id="battle-top" style="flex:0 0 auto; height:34px; display:flex; align-items:center; gap:10px; padding:0 14px; border-bottom:1px solid ${T.rule}; background:rgba(0,0,0,0.35);">
        <div id="battle-round" style="flex:0 0 auto; color:${T.text}; font-size:13px; font-weight:bold; letter-spacing:2px;">ROUND 1</div>
        <div id="battle-order" style="flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:4px; overflow:hidden; white-space:nowrap; -webkit-mask-image:linear-gradient(90deg, #000 0, #000 calc(100% - 28px), transparent); mask-image:linear-gradient(90deg, #000 0, #000 calc(100% - 28px), transparent);"></div>
        <div style="flex:0 0 auto; display:flex; align-items:center; gap:8px;">
          <div id="battle-speed" style="display:flex; gap:3px;"></div>
          <button id="battle-mode" title="Toggle command mode: Manual = you pick every hero's action; Auto = the AI resolves all turns" style="padding:3px 9px; font-size:10px; cursor:pointer; background:linear-gradient(180deg, rgba(84,66,26,0.95), rgba(52,40,16,0.95)); color:#f2dca0; border:1px solid ${T.goldDim}; border-radius:4px;">Manual</button>
        </div>
      </div>
      <!-- The field: foes on the left, the party on the right, both in ranks
           on one floor. Stands are laid out absolutely by layoutSide(). The
           middle sixteen percent belongs to nobody: the dice land there. -->
      <div id="battle-field" style="position:relative; flex:1 1 auto; min-height:0; overflow:hidden;">
        <div id="battle-ground"></div>
        <div id="battle-scenery"></div>
        <div id="battle-weather"></div>
        <div id="battle-banner" style="position:absolute; left:0; right:0; top:14px; z-index:8; text-align:center; pointer-events:none; color:${T.gold}; font-size:30px; font-weight:bold; letter-spacing:8px; text-shadow:0 2px 4px #000, 0 0 18px rgba(232,197,106,0.55);"></div>
        <div id="battle-enemies" style="position:absolute; left:0; top:0; bottom:0; width:42%;"></div>
        <div id="battle-heroes" style="position:absolute; right:0; top:0; bottom:0; width:42%;"></div>
      </div>
      <!-- The bottom windows: party status (the command menu docks over it
           when a hero is asked for orders) and the narration box. -->
      <div id="battle-bottom" style="flex:0 0 auto; height:232px; display:flex; gap:10px; padding:8px 14px 12px; background:linear-gradient(180deg, rgba(0,0,0,0.0), rgba(0,0,0,0.35));">
        <div id="battle-party-status" class="dp-window" style="flex:0 0 292px; min-width:0; padding:8px 10px; overflow:hidden; display:flex; flex-direction:column; color:${T.text};">
          <div class="dp-section-label" style="color:${T.goldDim}; font-size:9px; margin-bottom:4px; text-align:center;">◆ Party ◆</div>
          <div id="battle-party-rows" style="flex:1 1 auto; min-height:0; overflow-y:auto;"></div>
        </div>
        <div id="battle-feed" class="dp-window" style="flex:1 1 auto; min-width:0; padding:9px 13px; overflow-y:auto; color:${T.text}; display:flex; flex-direction:column;">
          <div id="battle-feed-lines" style="margin-top:auto; flex:0 0 auto;"></div>
        </div>
      </div>
    `;
    this.enemyRow = this.root.querySelector('#battle-enemies')!;
    this.heroRow = this.root.querySelector('#battle-heroes')!;
    this.statusRowsEl = this.root.querySelector('#battle-party-rows')!;
    this.feedEl = this.root.querySelector('#battle-feed')!;
    this.feedLinesEl = this.root.querySelector('#battle-feed-lines')!;
    this.roundEl = this.root.querySelector('#battle-round')!;
    this.bannerEl = this.root.querySelector('#battle-banner')!;
    this.turnOrderEl = this.root.querySelector('#battle-order')!;
    this.buildSpeedControls();
    this.buildModeToggle();
    window.addEventListener('keydown', this.handleMenuKey);
    this.startPadPoll();
    overlay.appendChild(this.root);
  }

  /** Open the window for a fight and render both sides. */
  /** Paint the backdrop for where the fight is. Safe to call before or during a fight. */
  setScene(scene: BattleScene): void {
    const css = battleSceneCss(scene);
    const field = this.root.querySelector('#battle-field') as HTMLElement | null;
    if (!field) return;
    field.style.setProperty('--bv-sky', css.sky);
    field.style.setProperty('--bv-floor', css.floor);
    field.style.setProperty('--bv-horizon', css.horizon);
    field.style.setProperty('--bv-lines', css.lines);
    field.style.setProperty('--bv-glow', css.glow);
    field.style.setProperty('--bv-scenery', css.scenery || 'none');
    field.style.setProperty('--bv-weather', css.weather || 'none');
  }

  open(party: Party, monsters: Monster[], sprites: SpriteRenderer, scene?: BattleScene): void {
    if (scene) this.setScene(scene);
    this.party = party;
    this.enemies = monsters;
    this.spellRenderer = sprites;
    this.activeEnemyId = null;
    this.activeHeroId = null;
    this.root.style.display = 'flex';
    this.isOpen = true;
    // Re-arm menu keyboard control — close() removes the listener so a closed
    // window can't eat keystrokes (idempotent: same fn reference, no dupes).
    window.addEventListener('keydown', this.handleMenuKey);
    this.startPadPoll();
    this.feedLinesEl.innerHTML = '';
    this.lastTurnActors = []; // fresh fight — bar fills on the first tick
    if (this.turnOrderEl) this.turnOrderEl.innerHTML = '';
    this.renderEnemies();
    this.renderHeroes();
  }

  isVisible(): boolean {
    return this.isOpen;
  }

  /**
   * Refresh hit points, slots, conditions, round count and the highlighted
   * turn. `actors` is the engine's initiative order so we can light whoever
   * is about to act. `messages` streams into the feed.
   */
  update(opts: {
    round: number;
    currentActorId?: string | null;
    actors?: (GameCharacter | Monster)[];
    messages?: string[];
    over?: boolean;
    winner?: 'party' | 'monsters' | null;
  }): void {
    if (!this.isOpen) return;
    // Chips track the game's engine queue each tick: orders disappear as the
    // engine consumes them, mirroring the ⏳→executed lifecycle.
    this.chipSyncFromGame?.();
    // Derive kinetic effects from the new log batch BEFORE re-rendering.
    const prevRound = this.roundEl.textContent;
    this.consumeEffects(opts.actors, opts.messages);
    if (!opts.messages || opts.messages.length === 0) {
      this.refreshStates();
    } else {
      if (prevRound !== `ROUND ${Math.max(1, opts.round)}`) this.resetEffects();
      this.refreshStates();
      this.applyEffects();
    }
    for (const msg of opts.messages ?? []) this.pushFeed(msg);
    this.roundEl.textContent = `ROUND ${Math.max(1, opts.round)}`;
    if (opts.actors) this.lastTurnActors = opts.actors;
    this.renderTurnOrder(opts.currentActorId);

    // Light up the acting combatant.
    this.highlightActors(opts.actors, opts.currentActorId);

    if (opts.over) {
      if (opts.winner === 'party') {
        this.bannerEl.textContent = 'VICTORY';
        this.bannerEl.style.color = '#ffd700';
      } else if (opts.winner === 'monsters') {
        this.bannerEl.textContent = 'DEFEAT';
        this.bannerEl.style.color = '#ff6060';
      } else {
        this.bannerEl.textContent = '— FIGHT ENDS —';
      }
    }
  }

  /**
   * Render the turn-order bar: one initiative chip per living combatant in
   * engine order, the acting one lit gold. Heroes get a blue dot, monsters
   * red, bosses a crown. Dead combatants drop out (the engine filters them
   * from initiativeOrder at round start).
   */
  private renderTurnOrder(currentActorId?: string | null): void {
    if (!this.turnOrderEl) return;
    const actors = this.lastTurnActors.filter(a => (a as GameCharacter).isAlive !== false && (a as GameCharacter).hp > 0);
    this.turnOrderEl.innerHTML = '';
    if (actors.length === 0) return;
    const label = document.createElement('span');
    label.style.cssText = `flex:0 0 auto; font-size:9px; color:${T.faint}; margin-right:6px; letter-spacing:1px;`;
    label.textContent = 'TURN ORDER';
    this.turnOrderEl.appendChild(label);
    let activeChip: HTMLElement | null = null;
    for (const a of actors) {
      const id = this.actorId(a);
      const isMonster = this.isMonster(a);
      const chip = document.createElement('span');
      chip.className = 'bv-turn-chip' + (isMonster ? ' foe' : '') + (id === currentActorId ? ' active' : '');
      const boss = isMonster && (a as Monster).isBoss;
      const dotColor = isMonster ? (boss ? '#ffb020' : '#ff6a5a') : '#6ab8ff';
      const name = isMonster ? (a as Monster).template.name : a.name;
      chip.title = isMonster
        ? `${name} — acts here this round${boss ? ' (BOSS)' : ''}`
        : `${name} — acts here this round`;
      const dot = `<span class="dot" style="background:${dotColor};${boss ? ' box-shadow:0 0 5px #ffb020;' : ''}"></span>`;
      chip.innerHTML = `${dot}${name}${boss ? ' ♛' : ''}`;
      this.turnOrderEl.appendChild(chip);
      if (id === currentActorId) activeChip = chip;
    }
    // A big fight's strip runs past the header: slide it so the acting
    // chip is in view. Scroll the strip's own box, never the page.
    if (activeChip) {
      const bar = this.turnOrderEl;
      const want = (activeChip as HTMLElement).offsetLeft + (activeChip as HTMLElement).offsetWidth - (bar.clientWidth - 30);
      bar.scrollLeft = Math.max(0, want);
    } else {
      this.turnOrderEl.scrollLeft = 0;
    }
  }

  /**
   * Derive kinetic effects from the new log batch: which actors lost HP
   * (shake + hit flash + damage pop) and which acted (lunge). Parsed from
   * the narration lines so the presentation layer stays decoupled from the
   * combat engine.
   */
  private consumeEffects(
    actors?: (GameCharacter | Monster)[],
    messages?: string[],
  ): void {
    const all = actors ?? ([...(this.party?.members ?? []), ...this.enemies] as (
      | GameCharacter
      | Monster
    )[]);

    // Snapshot HP before applying this batch, then diff after.
    const before: Map<string, number> = new Map();
    for (const a of all) before.set(this.actorId(a), a.hp);

    const newLunged: Set<string> = new Set();
    const newHit: Set<string> = new Set();
    const newCrit: Set<string> = new Set();
    const newHeal: Set<string> = new Set();
    const newSlash: Set<string> = new Set();
    const glows: { id: string; color: string }[] = [];
    const rings: { id: string; color: string }[] = [];
    const pops: { id: string; text: string; crit: boolean; heal: boolean }[] = [];
    /** Most recent cast line's element — damage lines that follow inherit it. */
    let pendingElement: string | null = null;

    /** Resolve a spell's element color from the engine narration text. */
    const elementOfSpell = (spellName: string): string => {
      const spell = SPELLS.find(s => s.name.toLowerCase() === spellName.toLowerCase());
      const element = spell?.damage?.split(' ').slice(1).join(' ').toLowerCase() ?? '';
      return BattleView.ELEMENT_COLORS[element] ?? BattleView.DEFAULT_ELEMENT;
    };

    for (const msg of messages ?? []) {
      // "X strikes/hits ... Y" or narration lines: attacker lunges.
      const atk = /^(.{2,60}?)\b(?:strikes|hits|slashes|smashes|drives|chops|connects|feints|lands)\b/.exec(msg);
      if (atk) {
        const attacker = this.resolveActorByName(all, atk[1].trim());
        if (attacker) newLunged.add(this.actorId(attacker));
      }
      // "X casts <Spell>" / spell narration naming the spell — glow the caster.
      const cast = /(?:^|!\s*|—\s*)(.{2,60}?) casts ([\w' ]+?)(?:!| on |\.)/.exec(msg);
      if (cast) {
        const caster = this.resolveActorByName(all, cast[1].trim());
        if (caster) glows.push({ id: this.actorId(caster), color: elementOfSpell(cast[2].trim()) });
        pendingElement = elementOfSpell(cast[2].trim());
      }
      // "X takes N damage" / "X takes N damage (Y/Z HP)" — damage pop.
      const dmg = /^(.{2,60}?) takes (\d+) damage/.exec(msg);
      if (dmg) {
        const victim = this.resolveActorByName(all, dmg[1].trim());
        if (victim) {
          const crit = /CRIT/i.test(msg);
          const vid = this.actorId(victim);
          pops.push({ id: vid, text: `-${dmg[2]}`, crit, heal: false });
          newHit.add(vid);
          if (crit) newCrit.add(vid);
          // Spell damage lands with an element ring; melee with a slash streak.
          if (pendingElement) rings.push({ id: vid, color: pendingElement });
          else newSlash.add(vid);
        }
      }
      // "X heals N" / "restores N HP" — heal pop.
      const heal = /^(.{2,60}?) (?:heals|restores) (\d+)/.exec(msg);
      if (heal) {
        const target = this.resolveActorByName(all, heal[1].trim());
        if (target) {
          pops.push({ id: this.actorId(target), text: `+${heal[2]}`, crit: false, heal: true });
          newHeal.add(this.actorId(target));
        }
      }
    }

    // HP-diff pass: catch damage lines whose phrasing the regexes missed.
    for (const a of all) {
      const id = this.actorId(a);
      const prev = this.lastHp.get(id);
      if (prev !== undefined && a.hp < prev && !newHit.has(id)) {
        newHit.add(id);
        pops.push({ id, text: `-${prev - a.hp}`, crit: false, heal: false });
      }
    }
    // Refresh the snapshot for the next tick.
    this.lastHp = new Map(all.map(a => [this.actorId(a), a.hp]));

    this.lungedIds = newLunged;
    this.hitIds = newHit;
    this.critIds = newCrit;
    this.healIds = newHeal;
    this.slashIds = newSlash;
    this.castGlows = glows;
    this.impactRings = rings;
    this.pendingPops = pops;
  }

  /** Resolve an actor by name prefix, tolerating narration phrasing. */
  private resolveActorByName(
    all: (GameCharacter | Monster)[],
    name: string,
  ): GameCharacter | Monster | null {
    const needle = name.toLowerCase().replace(/^(the|a|an)\s+/, '');
    for (const a of all) {
      const label = this.isMonster(a) ? a.template.name : a.name;
      if (label.toLowerCase().startsWith(needle) || needle.startsWith(label.toLowerCase())) {
        return a;
      }
    }
    return null;
  }

  /** Every kinetic class a stand can carry; cleared before each batch. */
  private static readonly FX_CLASSES = ['bv-shake', 'bv-lunge-left', 'bv-lunge-right', 'bv-hit', 'bv-crit', 'bv-heal-glow'];

  /** The figure (sprite + shadow) of a stand, where every effect is anchored. */
  private figureOf(id: string): HTMLElement | null {
    const card = this.cardOf(id);
    return card ? (card.querySelector('.bv-figure') as HTMLElement | null) : null;
  }

  /** The stand for an actor id, on whichever side it fights. */
  private cardOf(id: string): HTMLElement | null {
    return (this.enemyRow.querySelector(`.battle-card[data-id="${id}"]`) as HTMLElement | null)
      ?? (this.heroRow.querySelector(`.battle-card[data-id="${id}"]`) as HTMLElement | null);
  }

  /**
   * Apply the derived kinetic effects to the stands. The stands persist
   * between ticks now, so a class has to come off, the element reflow, and
   * the class go back on for its animation to run again.
   */
  private applyEffects(): void {
    const apply = (container: HTMLElement, isHero: boolean) => {
      for (const card of Array.from(container.querySelectorAll('.battle-card'))) {
        const el = card as HTMLElement;
        const id = el.getAttribute('data-id') ?? '';
        el.classList.remove(...BattleView.FX_CLASSES);
        const add: string[] = [];
        if (this.critIds.has(id)) {
          // Crit: the harsher flash subsumes the plain hit flash.
          add.push('bv-crit');
        } else if (this.hitIds.has(id)) {
          add.push('bv-shake', 'bv-hit');
        }
        if (this.healIds.has(id)) add.push('bv-heal-glow');
        // Heroes stand on the right and lunge left; foes lunge right.
        if (this.lungedIds.has(id)) add.push(isHero ? 'bv-lunge-left' : 'bv-lunge-right');
        if (add.length > 0) {
          void el.offsetWidth; // restart the animations
          el.classList.add(...add);
        }
      }
    };
    apply(this.enemyRow, false);
    apply(this.heroRow, true);
    // The hit flash is a plain style, not an animation: lift it after a beat.
    if (this.hitIds.size > 0) {
      window.setTimeout(() => {
        for (const el of Array.from(this.root.querySelectorAll('.battle-card.bv-hit'))) el.classList.remove('bv-hit');
      }, 260);
    }

    // Damage/heal pops over the affected figures.
    for (const pop of this.pendingPops) {
      const fig = this.figureOf(pop.id);
      if (!fig) continue;
      const num = document.createElement('div');
      num.className = 'bv-damage-pop';
      num.textContent = pop.text;
      num.style.color = pop.heal ? '#7fe0a8' : pop.crit ? '#ffcc33' : '#ff7a5a';
      if (pop.crit) num.style.fontSize = '24px';
      num.style.top = '20%';
      fig.appendChild(num);
      window.setTimeout(() => num.remove(), 950);
      // Critical hits erupt with a burst of hit-spark particles at the impact point.
      if (pop.crit) this.spawnHitSparks(fig);
    }
    this.pendingPops = [];

    // Spell-cast glows: element-colored aura blooming around each caster.
    for (const g of this.castGlows) {
      const fig = this.figureOf(g.id);
      if (!fig) continue;
      const glow = document.createElement('div');
      glow.className = 'bv-spell-glow';
      glow.style.setProperty('--glow', g.color);
      fig.appendChild(glow);
      window.setTimeout(() => glow.remove(), 950);
    }
    this.castGlows = [];

    // Spell impact rings: element-colored burst on each struck target.
    for (const r of this.impactRings) {
      const fig = this.figureOf(r.id);
      if (!fig) continue;
      const ring = document.createElement('div');
      ring.className = 'bv-impact-ring';
      ring.style.setProperty('--glow', r.color);
      ring.style.left = '50%';
      ring.style.top = '35%';
      fig.appendChild(ring);
      window.setTimeout(() => ring.remove(), 550);
    }
    this.impactRings = [];

    // Melee slash streaks on struck figures (skipped when a crit ran its own FX).
    for (const id of this.slashIds) {
      if (this.critIds.has(id)) continue; // crit sparks + flash already cover it
      const fig = this.figureOf(id);
      if (!fig) continue;
      const slash = document.createElement('div');
      slash.className = 'bv-slash';
      slash.style.left = '50%';
      slash.style.top = '45%';
      fig.appendChild(slash);
      window.setTimeout(() => slash.remove(), 400);
    }
    this.slashIds = new Set();
  }

  /**
   * Erupt a starburst of glowing sparks from the heart of a figure — the
   * visual punctuation of a critical hit. 10 shrapnel streaks fly outward in
   * a fan and fade; each cleans itself up after the animation.
   */
  private spawnHitSparks(fig: HTMLElement): void {
    const SPARKS = 10;
    for (let i = 0; i < SPARKS; i++) {
      const s = document.createElement('div');
      s.className = 'bv-spark';
      // Fan of angles across the upper arc, slightly randomized.
      const angle = (-150 + (300 / (SPARKS - 1)) * i + (Math.random() * 20 - 10)) * (Math.PI / 180);
      const dist = 26 + Math.random() * 30;
      s.style.setProperty('--sx', `${Math.cos(angle) * dist}px`);
      s.style.setProperty('--sy', `${Math.sin(angle) * dist}px`);
      s.style.left = '50%';
      s.style.top = '40%';
      s.style.animation = `battle-spark-fly ${0.45 + Math.random() * 0.25}s ease-out forwards`;
      fig.appendChild(s);
      window.setTimeout(() => s.remove(), 800);
    }
  }

  /** React to HP/slot/condition changes between action batches. */
  private refreshStates(): void {
    this.renderHeroes();
    this.renderEnemies();
  }

  /** Snap all stands to their resting pose (called between rounds). */
  private resetEffects(): void {
    for (const card of Array.from(this.root.querySelectorAll('.battle-card'))) {
      const el = card as HTMLElement;
      el.classList.remove(...BattleView.FX_CLASSES);
      // Restart animations on the next batch by forcing a reflow.
      void el.offsetWidth;
    }
  }

  /**
   * Append one line to the fight's narration.
   *
   * Same two-column grid as the HUD's combat log: a glyph gutter and the
   * prose. The engine's own dingbats (⚔ 🛡 🏃 💀) move into that gutter, and
   * a quoted line is drawn as speech rather than as another damage report —
   * during a fight the feed is scrolling fast and the eye needs a margin to
   * follow.
   */
  private pushFeed(msg: string): void {
    const line = document.createElement('div');
    line.className = 'dp-log-line';

    // A scene break: '--- Combat begins! Initiative rolled. ---'
    if (/^-{2,}/.test(msg)) {
      line.classList.add('dp-log-break');
      const body = document.createElement('span');
      body.className = 'dp-log-body';
      body.textContent = msg.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
      line.appendChild(body);
      this.appendFeedLine(line);
      return;
    }

    // Pull a leading glyph into the gutter.
    let text = msg;
    let glyph = '';
    const g = /^([←-⯿\u{1F000}-\u{1FAFF}\u{FE0F}]+)\s*/u.exec(text);
    if (g) { glyph = g[1]; text = text.slice(g[0].length); }

    let color: string | null = null;
    if (/^[“"'‘]/.test(text) && /[”"'’]\s*$/.test(text)) {
      line.classList.add('dp-log-speech');
    } else if (msg.includes('CRIT')) {
      line.classList.add('dp-log-gold');
    } else if (/\bheal/.test(msg)) {
      line.classList.add('dp-log-good');
    } else if (msg.includes('misses')) {
      line.classList.add('dp-log-muted');
    } else if (msg.includes('slain') || msg.includes('fallen')) {
      line.classList.add('dp-log-harm');
    } else if (msg.includes('Victory')) {
      line.classList.add('dp-log-gold');
    } else if (msg.includes('Initiative')) {
      line.classList.add('dp-log-muted');
    } else {
      // Spell lines take their element colour — the feed matches the FX.
      const cast = / casts ([\w' ]+?)(?:!| on |\.)/.exec(msg);
      if (cast) {
        const spell = SPELLS.find(s => s.name.toLowerCase() === cast[1].trim().toLowerCase());
        const element = spell?.damage?.split(' ').slice(1).join(' ').toLowerCase() ?? '';
        color = BattleView.ELEMENT_COLORS[element] ?? BattleView.DEFAULT_ELEMENT;
      } else if (msg.includes('casts') || msg.includes('sigils') || msg.includes('Words of power') || msg.includes('Arcane energy') || msg.includes('air itself recoils')) {
        color = BattleView.DEFAULT_ELEMENT;
      } else if (msg.includes('damage')) {
        line.classList.add('dp-log-warn');
      } else {
        line.classList.add('dp-log-plain');
      }
    }

    const gutter = document.createElement('span');
    gutter.className = 'dp-log-glyph';
    gutter.textContent = glyph;
    const body = document.createElement('span');
    body.className = 'dp-log-body';
    body.textContent = text;
    if (color) { line.style.color = color; gutter.style.color = color; }
    line.append(gutter, body);
    this.appendFeedLine(line);
  }

  /** Append to the feed and keep it to a fixed length. */
  private appendFeedLine(line: HTMLElement): void {
    this.feedLinesEl.appendChild(line);
    while (this.feedLinesEl.children.length > 60) this.feedLinesEl.removeChild(this.feedLinesEl.firstChild!);
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }

  /**
   * Ring whoever is acting.
   *
   * The remembered id matters: cards are rebuilt from scratch every tick, so
   * without it a re-render between turns drops the ring. (It used to be set
   * inside `heroCard`, which meant it always ended up holding the *last*
   * hero drawn — the gold ring sat on the wrong character for the whole
   * fight, including while the command menu was asking someone else for
   * orders.)
   */
  private highlightActors(actors?: (GameCharacter | Monster)[], currentActorId?: string | null): void {
    // While the menu is up the engine is paused on that hero: ring them, so
    // "who am I giving orders to?" is answerable from the field.
    const menuId = this.menuEl && this.menuEl.style.display !== 'none' ? this.menuHero?.id ?? null : null;
    if (currentActorId == null && menuId) {
      this.activeHeroId = menuId;
      this.highlightIn(this.heroRow, menuId);
      this.highlightIn(this.enemyRow, menuId);
      return;
    }
    if (!actors || currentActorId == null) return;
    const cur = actors.find(a => this.actorId(a) === currentActorId) ?? null;
    if (!cur) return;
    const id = this.actorId(cur);
    if (this.isMonster(cur)) {
      this.activeEnemyId = id;
      this.activeHeroId = null;
    } else {
      this.activeHeroId = id;
      this.activeEnemyId = null;
    }
    this.highlightIn(this.enemyRow, id);
    this.highlightIn(this.heroRow, id);
  }

  private highlightIn(container: HTMLElement, actorId: string): void {
    for (const card of Array.from(container.querySelectorAll('.battle-card'))) {
      card.classList.toggle('bv-active', card.getAttribute('data-id') === actorId);
    }
    if (container === this.heroRow) this.renderPartyStatus();
  }

  private isMonster(x: GameCharacter | Monster): x is Monster {
    return (x as Monster).template !== undefined;
  }

  private actorId(a: GameCharacter | Monster): string {
    return this.isMonster(a) ? a.id : a.id;
  }

  /**
   * Classes that fight in the front rank. Everyone else — the casters, the
   * archer, the tinkerer — stands behind them, the way a party lines up in
   * the classic screens.
   */
  private static readonly FRONT_RANK = new Set(['fighter', 'barbarian', 'paladin', 'monk', 'rogue', 'blood_hunter']);

  /**
   * Foes are rebuilt in place: a stand per monster, kept between ticks so
   * its health bar can drain and its move can glide. The fallen stay where
   * they fell (faded) until the whole side is down.
   */
  private renderEnemies(): void {
    const shown = this.enemies.filter(m => m.isAlive || this.enemies.some(o => o.isAlive));
    const ids = new Set(shown.map(m => m.id));
    for (const el of Array.from(this.enemyRow.children)) {
      if (!ids.has(el.getAttribute('data-id') ?? '')) el.remove();
    }
    const n = shown.length;
    // Ranks are columns: the front rank stands nearest the party. Up to
    // four foes make one rank, ten make two, and a horde makes three, so
    // fifteen goblins are three files of five rather than a wall.
    const rankCount = n <= 4 ? 1 : n <= 10 ? 2 : 3;
    const perRank = Math.ceil(n / rankCount);
    const ranks: HTMLElement[][] = [];
    shown.forEach((m, i) => {
      const card = this.ensureCard(m.id, false);
      this.fillEnemyCard(card, m);
      const r = Math.floor(i / perRank);
      (ranks[r] ??= []).push(card);
    });
    this.layoutSide(this.enemyRow, ranks, false, n <= 2 ? 120 : n <= 4 ? 104 : n <= 8 ? 84 : 68);
    this.highlightIn(this.enemyRow, this.activeEnemyId ?? '');
  }

  private renderHeroes(): void {
    if (!this.party) return;
    const members = this.party.members;
    const ids = new Set(members.map(m => m.id));
    for (const el of Array.from(this.heroRow.children)) {
      if (!ids.has(el.getAttribute('data-id') ?? '')) el.remove();
    }
    const [front, back] = this.heroRanks(members);
    const ranks: HTMLElement[][] = [[], []];
    for (const m of members) {
      const card = this.ensureCard(m.id, true);
      this.fillHeroCard(card, m);
      ranks[front.includes(m) ? 0 : 1].push(card);
    }
    if (back.length === 0) ranks.pop();
    this.layoutSide(this.heroRow, ranks, true, members.length <= 4 ? 96 : 80);
    this.highlightIn(this.heroRow, this.activeHeroId ?? '');
  }

  /** Split the party into a front and a back rank by class, kept balanced. */
  private heroRanks(members: GameCharacter[]): [GameCharacter[], GameCharacter[]] {
    if (members.length <= 2) return [[...members], []];
    let front = members.filter(m => BattleView.FRONT_RANK.has(m.charClass.id));
    let back = members.filter(m => !BattleView.FRONT_RANK.has(m.charClass.id));
    // An all-steel or all-spell party still forms two files.
    if (front.length === 0) { front = back.slice(0, Math.ceil(back.length / 2)); back = back.slice(front.length); }
    if (back.length === 0) { back = front.slice(Math.ceil(front.length / 2)); front = front.slice(0, front.length - back.length); }
    while (front.length > 4) back.unshift(front.pop()!);
    while (back.length > 4) front.push(back.shift()!);
    return [front, back];
  }

  /**
   * Place a side's ranks on the floor. Each rank is a file (a column);
   * the front file stands nearest the middle of the field and the files
   * behind it step outward and are centred on the floor, so a short back
   * rank sits staggered between the front rank's shoulders. The sprite
   * size comes from the tallest file: everyone on a side is drawn at one
   * scale, shrunk only as far as the floor demands.
   */
  private layoutSide(side: HTMLElement, ranks: HTMLElement[][], isHero: boolean, maxSprite: number): void {
    const W = side.clientWidth || 512;
    const H = side.clientHeight || 500;
    const perRank = Math.max(1, ...ranks.map(r => r.length));
    const topPad = Math.round(H * 0.13);
    const botPad = 14;
    const band = H - topPad - botPad;
    const slotH = band / perRank;
    const labelH = isHero ? 46 : 34;
    const sprite = Math.max(36, Math.min(maxSprite, Math.floor(slotH - labelH - 2)));
    const standW = Math.max(sprite + 28, 86);
    const fileW = standW + 6;
    // Files must fit the half-field; a crowded side packs its files closer.
    const inset = 26;
    const step = Math.min(fileW, Math.max(sprite + 8, (W - inset * 2 - standW) / Math.max(1, ranks.length - 1)));
    ranks.forEach((rank, r) => {
      // Vertically centre the file. A shorter file slides half a slot so
      // its members stand between the shoulders of the fuller file rather
      // than beside them — the classic diagonal.
      const spare = band - rank.length * slotH;
      const shift = rank.length < perRank
        ? Math.min(slotH * 0.5, spare / 2) * (r % 2 === 0 ? -1 : 1)
        : 0;
      const y0 = topPad + spare / 2 + shift;
      const x = isHero
        ? inset + r * step
        : W - inset - standW - r * step;
      // Within its slot a front-file stand sits high and a back-file stand
      // low, so equal files still read as a diagonal rather than a grid.
      const lean = ranks.length > 1 ? (r % 2 === 0 ? 0.2 : 0.8) : 0.5;
      rank.forEach((card, k) => {
        const standH = sprite + labelH;
        const y = Math.round(y0 + slotH * k + (slotH - standH) * lean);
        card.style.left = `${Math.round(x)}px`;
        card.style.top = `${Math.max(2, y)}px`;
        card.style.width = `${standW}px`;
        card.style.zIndex = String(10 + k); // lower on the floor draws in front
        const fig = card.querySelector('.bv-figure') as HTMLElement;
        const img = card.querySelector('.bv-sprite') as HTMLElement;
        const boss = card.classList.contains('bv-boss');
        const s = boss ? Math.round(sprite * 1.22) : sprite;
        fig.style.width = `${sprite}px`;
        fig.style.height = `${sprite}px`;
        img.style.width = `${s}px`;
        img.style.height = `${s}px`;
        img.style.marginBottom = boss ? '-2px' : '0';
        (card.querySelector('.bv-tag') as HTMLElement).style.fontSize = `${sprite >= 84 ? 11.5 : sprite >= 60 ? 10 : 9}px`;
      });
    });
  }

  /** Rasterize a monster/hero sprite into an <img> src data URL. */
  private spriteSrc(topaint: GameCharacter | Monster): string {
    if (!this.spellRenderer) return '';
    try {
      const canvas = this.spellRenderer.getSpriteCanvas(topaint);
      return canvas;
    } catch {
      return '';
    }
  }

  /**
   * Find or build the stand for a combatant. The skeleton is built once;
   * the sprite is rasterized once (a data URL per tick per creature was the
   * old window's biggest cost); everything else is filled in per tick.
   */
  private ensureCard(id: string, isHero: boolean): HTMLElement {
    const side = isHero ? this.heroRow : this.enemyRow;
    const existing = side.querySelector(`.battle-card[data-id="${id}"]`) as HTMLElement | null;
    if (existing) return existing;
    const card = document.createElement('div');
    card.className = 'battle-card ' + (isHero ? 'bv-hero' : 'bv-foe');
    card.setAttribute('data-id', id);
    card.innerHTML = `
      <div class="bv-figure">
        <div class="bv-shadow"></div>
        <div class="bv-ring"></div>
        <img class="bv-sprite" draggable="false" alt=""/>
      </div>
      <div class="bv-tag"></div>
      <div class="bv-hpbar"><div class="bv-hpghost"></div><div class="bv-hpfill"></div></div>
      <div class="bv-hpnum dp-num"></div>
      <div class="bv-extra"></div>
    `;
    side.appendChild(card);
    return card;
  }

  /** Paint the live values of a stand: bar, numbers, name, conditions. */
  private fillStand(card: HTMLElement, opts: {
    name: string; nameColor: string; hp: number; maxHp: number; down: boolean; extraHtml: string; sprite: GameCharacter | Monster;
  }): void {
    const img = card.querySelector('.bv-sprite') as HTMLImageElement;
    if (!img.getAttribute('src')) img.src = this.spriteSrc(opts.sprite);
    const frac = Math.max(0, Math.min(1, opts.hp / Math.max(1, opts.maxHp)));
    const tag = card.querySelector('.bv-tag') as HTMLElement;
    if (tag.innerHTML !== opts.name) tag.innerHTML = opts.name;
    tag.style.color = opts.nameColor;
    const fill = card.querySelector('.bv-hpfill') as HTMLElement;
    const ghost = card.querySelector('.bv-hpghost') as HTMLElement;
    const width = `${(frac * 100).toFixed(1)}%`;
    if (fill.style.width !== width) {
      // A first paint has no history: both fills start where they are, no drain.
      const first = !fill.style.width;
      if (first) ghost.style.transition = 'none';
      fill.style.width = width;
      ghost.style.width = width;
      if (first) window.setTimeout(() => ghost.style.removeProperty('transition'), 40);
    }
    fill.style.backgroundColor = hpColor(frac);
    const num = card.querySelector('.bv-hpnum') as HTMLElement;
    const numHtml = `${Math.max(0, Math.round(opts.hp))}<span style="color:${T.faint};">/${opts.maxHp}</span>`;
    if (num.innerHTML !== numHtml) num.innerHTML = numHtml;
    const extra = card.querySelector('.bv-extra') as HTMLElement;
    if (extra.innerHTML !== opts.extraHtml) extra.innerHTML = opts.extraHtml;
    extra.style.display = opts.extraHtml ? '' : 'none';
    card.classList.toggle('bv-down', opts.down);
  }

  private fillEnemyCard(card: HTMLElement, m: Monster): void {
    const boss = m.isBoss || m.template.name.includes('(Boss)');
    card.classList.toggle('bv-boss', boss);
    const conds = m.conditions.map(c => CONDITION_META[c.id]?.label ?? c.name).join(', ');
    this.fillStand(card, {
      name: `${boss ? '♛ ' : ''}${m.template.name}`,
      nameColor: boss ? T.gold : '#dbaa9e',
      hp: m.hp, maxHp: m.maxHp, down: !m.isAlive,
      extraHtml: conds ? `<span style="color:#e8a99e;">${conds}</span>` : '',
      sprite: m,
    });
  }

  private fillHeroCard(card: HTMLElement, hero: GameCharacter): void {
    const accent = classColor(hero.charClass.id);
    const conds = hero.conditions.map(c => CONDITION_META[c.id]?.label ?? c.name).join(', ');
    const deadMarker = hero.isDead || hero.isDying ? ` <span style="color:#ef8272;">&#9760;</span>` : '';
    const pips = this.slotPips(hero);
    const extras = [
      pips ? `<div class="dp-num" style="color:${T.info};">${pips}</div>` : '',
      conds ? `<div style="color:#e8a99e;">${conds}</div>` : '',
      this.queuedChipHtml(hero),
    ].join('');
    this.fillStand(card, {
      name: `${hero.name}${deadMarker}`,
      nameColor: accent,
      hp: hero.hp, maxHp: hero.maxHp, down: hero.hp <= 0,
      extraHtml: extras,
      sprite: hero,
    });
  }

  /**
   * The party status window: one line per hero with class, health, spell
   * slots and any standing order — the bottom-left window of the classic
   * screen. The command menu docks over it while a hero is asked for orders.
   */
  private renderPartyStatus(): void {
    if (!this.party || !this.statusRowsEl) return;
    const rows: string[] = [];
    for (const hero of this.party.members) {
      const accent = classColor(hero.charClass.id);
      const frac = Math.max(0, Math.min(1, hero.hp / Math.max(1, hero.maxHp)));
      const active = hero.id === this.activeHeroId;
      const conds = hero.conditions.map(c => CONDITION_META[c.id]?.label ?? c.name).join(', ');
      const dead = hero.isDead || hero.isDying;
      const pips = this.slotPips(hero);
      const chip = this.queuedChipHtml(hero);
      rows.push(`
        <div class="bv-status-row${active ? ' active' : ''}" style="${dead ? 'opacity:0.55;' : ''}">
          <span class="cur">▶</span>
          <span class="nm" style="color:${accent};">${hero.name}${dead ? ' <span style="color:#ef8272;">&#9760;</span>' : ''} <span class="sub">Lv${hero.level} ${hero.charClass.name}</span></span>
          <span class="hp" style="color:${hpColor(frac)};">${Math.max(0, Math.round(hero.hp))}<span style="color:${T.faint};">/${hero.maxHp}</span></span>
          <span class="pips">${pips}</span>
          <div class="bar"><div style="width:${(frac * 100).toFixed(1)}%; background:${hpColor(frac)};"></div></div>
          ${conds ? `<div class="conds">${conds}</div>` : ''}
          ${chip ? `<div class="chipwrap">${chip}</div>` : ''}
        </div>`);
    }
    const html = rows.join('');
    if (this.statusRowsEl.innerHTML !== html) this.statusRowsEl.innerHTML = html;
  }

  /** Short human label for a queued order ('⚔ Attack', '✦ Fireball', …). */
  private chipLabel(hero: GameCharacter, cmd: PartyCommand): string {
    switch (cmd.type) {
      case 'attack': return '⚔ Attack';
      case 'flee': return '🏃 Flee';
      case 'ability': return '⚡ Skill';
      case 'item': return `🧪 ${cmd.itemName ?? 'Item'}`;
      case 'spell': {
        const name = this.menuSpells.find(s => s.id === cmd.spellId)?.name
          ?? this.spellsFor?.(hero).find(s => s.id === cmd.spellId)?.name
          ?? SPELLS.find(s => s.id === cmd.spellId)?.name;
        return name ? `✦ ${name}` : '✦ Spell';
      }
    }
  }

  /** The queued-order chip for a hero card, or '' when they have no standing order. */
  private queuedChipHtml(hero: GameCharacter): string {
    const cmd = this.queuedOrders.get(hero.id);
    if (!cmd) {
      // The hero the engine is paused on shows a muted 'awaiting orders' chip.
      if (this.pausedOrderKey === hero.id && hero.isAlive) {
        return `<div class="bv-order-chip" style="border-style:dashed; border-color:${T.lineHot}; background:rgba(30,26,20,0.6); color:${T.muted};">⏳ awaiting orders</div>`;
      }
      return '';
    }
    const label = this.chipLabel(hero, cmd);
    const active = this.pausedOrderKey === hero.id;
    const style = active ? 'border-color:#ffd700; background:rgba(96,74,10,0.6); box-shadow:0 0 8px rgba(255,215,0,0.35);' : '';
    return `<div class="bv-order-chip" style="${style}" title="⏳ ${hero.name} will follow this order when their turn comes.">⏳ ${label}</div>`;
  }

  /** Render remaining spell slots as pips per available level (e.g. "① ●● ○○"). */
  private slotPips(hero: GameCharacter): string {
    const type = getCasterType(hero.charClass.id);
    if (type === 'none') return '';
    const max = maxSlotsFor(hero.charClass.id, hero.level);
    const parts: string[] = [];
    for (let lvl = 1; lvl <= 9; lvl++) {
      const capacity = max[lvl - 1] || 0;
      if (capacity <= 0) continue;
      const left = Math.min(capacity, hero.spellSlots[lvl] || 0);
      const used = capacity - left;
      parts.push(`${lvl}${'●'.repeat(left)}${'○'.repeat(used)}`);
    }
    return parts.join(' ');
  }

  /** Wire the Manual/Auto command-mode toggle in the header. */
  private buildModeToggle(): void {
    const btn = this.root.querySelector('#battle-mode') as HTMLElement;
    btn.title = 'Toggle command mode: Manual = you pick every hero\'s action; Auto = the AI resolves all turns';
    btn.addEventListener('click', () => {
      const next = this.mode === 'manual' ? 'auto' : 'manual';
      this.setMode(next);
      this.onModeChange?.(next);
    });
  }

  /** Update the mode label + styling, and tell the menu what to do. */
  setMode(mode: 'manual' | 'auto'): void {
    this.mode = mode;
    const btn = this.root.querySelector('#battle-mode') as HTMLElement | null;
    if (btn) {
      // Manual = you command (gold); Auto = AI resolves (muted).
      btn.textContent = mode === 'manual' ? 'Manual' : 'Auto';
      btn.style.color = mode === 'manual' ? '#f2dca0' : T.muted;
      btn.style.borderColor = mode === 'manual' ? T.goldDim : T.line;
      btn.style.background = mode === 'manual'
        ? 'linear-gradient(180deg, rgba(84,66,26,0.95), rgba(52,40,16,0.95))'
        : 'rgba(20,18,23,0.9)';
    }
  }

  getMode(): 'manual' | 'auto' {
    return this.mode;
  }

  /** Build the ⏩ fast-forward control strip in the header. */
  private buildSpeedControls(): void {
    const bar = this.root.querySelector('#battle-speed')! as HTMLElement;
    for (const s of BattleView.SPEEDS) {
      const btn = document.createElement('button');
      btn.className = 'battle-speed-btn';
      btn.dataset.speed = String(s);
      btn.textContent = `${s}x`;
      btn.style.cssText = [
        'padding:3px 7px; font-size:10px; cursor:pointer;',
        `background:rgba(20,18,23,0.9); color:${T.muted}; border:1px solid ${T.line}; border-radius:4px;`,
      ].join('');
      btn.addEventListener('click', () => this.setSpeed(s));
      bar.appendChild(btn);
    }
    this.setSpeed(this.speed);
  }

  /**
   * Sync the speed strip to the game's current combat tick interval, so a
   * fight opened while the player already runs 2x/4x reflects that instead of
   * silently snapping back to 1x.
   */
  syncSpeedFromInterval(intervalMs: number): void {
    const match = BattleView.SPEEDS.find(s => Math.abs(150 / s - intervalMs) < 2);
    if (match && match !== this.speed) this.setSpeed(match);
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    const btns = this.root.querySelectorAll('.battle-speed-btn');
    btns.forEach(b => {
      const el = b as HTMLElement;
      const active = parseFloat(el.dataset.speed!) === speed;
      el.style.background = active ? 'linear-gradient(180deg, rgba(84,66,26,0.95), rgba(52,40,16,0.95))' : 'rgba(20,18,23,0.9)';
      el.style.color = active ? '#f2dca0' : T.muted;
      el.style.borderColor = active ? T.goldDim : T.line;
    });
    this.onSpeedChange?.(speed);
  }

  /** Close and hide the battle window. */
  close(): void {
    this.closing = true;
    this.dismissSpoils();
    this.closing = false;
    window.removeEventListener('keydown', this.handleMenuKey);
    this.root.style.display = 'none';
    this.isOpen = false;
    this.bannerEl.textContent = '';
    this.feedLinesEl.innerHTML = '';
    this.enemyRow.innerHTML = '';
    this.heroRow.innerHTML = '';
    this.statusRowsEl.innerHTML = '';
    this.menuHero = null;
    if (this.menuEl) this.menuEl.remove();
    this.menuEl = null;
    this.menuCursor = 0;
    this.cursorEl = null;
    // Reset Tab-cycle/queue state so a stale queue can't leak between fights.
    this.queuedOrders.clear();
    this.parkedHeroId = null;
    this.menuIsQueued = false;
    this.partyRoster = [];
    // Drop remap/overlay state too — nothing should survive the window.
    this.remapping = null;
    if (this.controlsEl) this.controlsEl.style.display = 'none';
  }

  /**
   * Close the window, but only after the victory summary has been dismissed
   * (Continue clicked or the auto-dismiss timer elapsed) — the player always
   * gets to read the spoils before the map returns.
   */
  closeAfterSpoils(): void {
    if (this.isOpen && this.spoilsEl && this.spoilsEl.style.display === 'block') {
      this.pendingClose = true;
    } else {
      this.close();
    }
  }

  // ── FF command menu ──

  /**
   * Show the command menu paused on a hero's turn. The game supplies the
   * castable spells and usable consumables; the DM picks and the game runs it.
   */
  showCommandMenu(hero: GameCharacter, spells: Spell[], items: MenuConsumable[], ability: CombatAbility | null = null): void {
    this.menuHero = hero;
    this.menuSpells = spells;
    this.menuItems = items;
    this.menuAbility = ability;
    this.menuPane = 'root';
    this.parkedHeroId = hero.id;
    this.menuIsQueued = false;
    this.targeting = null; // a fresh pause never inherits a stale aim
    // While the engine is paused on this hero, their card shows a live chip
    // (like queued allies) that turns gold-outline when they pick a command.
    this.pausedOrderKey = hero.id;
    this.activeHeroId = hero.id; // the field ring follows the menu
    this.renderHeroes(); // paint the 'awaiting orders' chip immediately
    this.renderMenu();
  }

  // ── Formation presets: one key queues the party's standard opener ──

  /** A preset assigns each party role a default command. */
  private static readonly PRESETS: Record<string, { label: string; hint: string; roles: Record<string, PartyCommand> }> = {
    standard: {
      label: '⚔ Standard', hint: 'steel forward, faith and fire behind',
      roles: { fighter: { type: 'attack' }, barbarian: { type: 'attack' }, paladin: { type: 'attack' }, ranger: { type: 'attack' }, monk: { type: 'attack' }, rogue: { type: 'attack' }, cleric: { type: 'spell', spellId: 'bless' }, druid: { type: 'spell', spellId: 'bless' }, bard: { type: 'spell', spellId: 'bless' }, wizard: { type: 'spell', spellId: 'fireball' }, sorcerer: { type: 'spell', spellId: 'fireball' }, warlock: { type: 'spell', spellId: 'fireball' } },
    },
    careful: {
      label: '✚ Careful', hint: 'steady the line, close the wounds',
      roles: { fighter: { type: 'attack' }, barbarian: { type: 'attack' }, paladin: { type: 'attack' }, ranger: { type: 'attack' }, monk: { type: 'attack' }, rogue: { type: 'attack' }, cleric: { type: 'spell', spellId: 'healing_word' }, druid: { type: 'spell', spellId: 'healing_word' }, bard: { type: 'spell', spellId: 'healing_word' }, wizard: { type: 'spell', spellId: 'magic_missile' }, sorcerer: { type: 'spell', spellId: 'magic_missile' }, warlock: { type: 'spell', spellId: 'eldritch_blast' } },
    },
    reckless: {
      label: '🔥 Reckless', hint: 'everyone swings, no one hides',
      roles: { fighter: { type: 'attack' }, barbarian: { type: 'attack' }, paladin: { type: 'attack' }, ranger: { type: 'attack' }, monk: { type: 'attack' }, rogue: { type: 'attack' }, bard: { type: 'attack' }, cleric: { type: 'attack' }, druid: { type: 'attack' }, wizard: { type: 'attack' }, sorcerer: { type: 'attack' }, warlock: { type: 'attack' } },
    },
  };

  /**
   * Apply a formation preset: queue the mapped command for every living
   * hero who doesn't have one yet, then resolve the engine's pause so the
   * round plays out. Each hero falls back gracefully when their assigned
   * spell is unknown or unaffordable (martial swing, else cantrip, else
   * attack). Returns the narration lines for the feed.
   */
  applyPreset(name: string): string[] {
    const preset = BattleView.PRESETS[name];
    if (!preset || !this.menuHero || !this.menuEl) return [];
    const parked = this.partyRoster.find(m => m.id === this.parkedHeroId) ?? this.menuHero;
    const lines: string[] = [];
    const verb = name === 'careful' ? 'holds the line' : name === 'reckless' ? 'howls into the fray' : 'calls the standard';
    lines.push(`⚑ Formation: the party ${verb} — ${preset.hint}.`);
    const labelOf = (hero: GameCharacter, c: PartyCommand) => c.type === 'attack' ? 'Attack' : c.type === 'flee' ? 'Flee' : c.type === 'item' ? 'Item' : c.type === 'ability' ? 'Skill' : (this.spellsFor?.(hero).find(s => s.id === c.spellId)?.name ?? 'Spell');
    const resolve = (hero: GameCharacter): PartyCommand => {
      const mapped = preset.roles[hero.charClass?.id ?? ''] ?? { type: 'attack' as const };
      if (mapped.type !== 'spell') return mapped;
      const spell = this.menuSpells.find(s => s.id === mapped.spellId);
      const castable = spell && this.spellsFor?.(hero).some(s => s.id === spell.id);
      if (spell && castable) return { type: 'spell', spellId: spell.id };
      // Graceful fallback: any affordable offensive cantrip, else steel.
      const cantrip = this.spellsFor?.(hero).find(s => s.level === 0) ?? null;
      return cantrip ? { type: 'spell', spellId: cantrip.id } : { type: 'attack' };
    };
    for (const hero of this.partyRoster) {
      if (hero.id === parked.id || this.queuedOrders.has(hero.id)) continue;
      const cmd = resolve(hero);
      this.queuedOrders.set(hero.id, cmd);
      if (cmd.type === 'spell') {
        const sp = this.spellsFor?.(hero).find(s => s.id === cmd.spellId);
        if (sp) this.lastSpellByHero.set(hero.id, { spellId: sp.id, spellName: sp.name });
      }
      lines.push(`⚑ ${hero.name} → ${labelOf(hero, cmd)}`);
      this.onQueuedOrder?.(hero.id, cmd);
    }
    // Hand the pause back to the DM so they can override or confirm the parked hero.
    this.menuHero = parked;
    this.menuSpells = this.spellsFor ? this.spellsFor(parked) : [];
    this.menuItems = this.itemsFor ? this.itemsFor() : [];
    this.menuPane = 'root';
    this.menuIsQueued = false;
    this.renderMenu();
    return lines;
  }

  /** Sync the living roster the Tab key cycles through. */
  setPartyRoster(members: GameCharacter[]): void {
    this.partyRoster = members.filter(m => m.isAlive);
  }

  /** Apply a preset from the UI: narrate and flash a summary. */
  private runPreset(name: string): void {
    const preset = BattleView.PRESETS[name];
    const lines = this.applyPreset(name);
    if (lines.length === 0) return;
    const queued = [...this.queuedOrders.keys()].length;
    this.flashQuickCast(`⚑ ${preset.label.replace(/^[^ ]+ /, '')} formation — ${queued} ${queued === 1 ? 'ally' : 'allies'} queued; your command resolves the round`);
    this.onFormation?.(lines[0]);
  }

  /** Hide the menu (turn resolved or combat over). */
  hideCommandMenu(): void {
    this.menuHero = null;
    this.menuCursor = 0;
    this.cursorEl = null;
    this.menuButtons = [];
    this.pausedOrderKey = null;
    if (this.targeting) {
      this.targeting = null;
      this.applyTargetCursor(); // drop any crosshair ring
    }
    if (this.menuEl) {
      this.menuEl.style.display = 'none';
      this.menuEl.innerHTML = '';
    }
  }

  private renderMenu(): void {
    if (!this.menuHero) return;
    if (!this.menuEl) {
      this.menuEl = document.createElement('div');
      this.menuEl.id = 'battle-command-menu';
      this.menuEl.className = 'dp-window';
      this.menuEl.style.cssText = [
        'position:absolute; left:14px; bottom:12px; z-index:25;',
        // Tall enough to cover the party status window it docks over, even
        // as the three-line aim prompt; grows upward for a long spell list.
        'width:292px; min-height:212px; max-height:64%; overflow-y:auto;',
        `font-family:${T.bodyFont}; color:${T.text}; padding:10px 12px;`,
      ].join('');
      this.root.appendChild(this.menuEl);
    }
    this.menuEl.style.display = 'block';
    this.menuButtons = [];
    const hero = this.menuHero;



    const menuBtn = (label: string, sub: string, onClick: () => void, danger = false, keyHint?: string) => {
      const b = document.createElement('button');
      b.style.cssText = [
        'display:flex; justify-content:space-between; align-items:center; width:100%; gap:10px;',
        'padding:8px 12px; margin:3px 0; cursor:pointer; text-align:left;',
        `background:${danger ? 'rgba(58,24,20,0.85)' : 'rgba(255,255,255,0.035)'}; color:${danger ? '#ef9a8a' : T.text};`,
        `border:1px solid ${danger ? '#6a3630' : T.line}; border-radius:${T.r2}; font-size:12.5px;`,
      ].join('');
      const keyTag = keyHint
        ? `<span class="dp-num" style="display:inline-block; min-width:16px; margin-right:8px; padding:1px 4px; background:rgba(0,0,0,0.45); border:1px solid ${T.line}; border-radius:3px; color:${T.goldDim}; font-size:10px; text-align:center;">${keyHint}</span>`
        : '';
      b.innerHTML = `<span style="display:flex; align-items:center;">${keyTag}${label}</span><span style="color:${T.muted}; font-size:10px;">${sub}</span>`;
      const btnIndex = this.menuButtons.length;
      // Mouse and keyboard share one cursor: hovering moves it, arrows move
      // it back. The highlight persists until the cursor moves again.
      b.addEventListener('mouseenter', () => { this.menuCursor = btnIndex; this.applyCursor(); });
      b.addEventListener('click', () => { (document.activeElement as HTMLElement | null)?.blur?.(); onClick(); });
      this.menuButtons.push({ el: b, onClick, key: keyHint, danger });
      return b;
    };

    // Targeting mode: the menu becomes an aim prompt — arrows move the
    // crosshair over the battle cards, Enter fires, Esc returns to the root.
    if (this.targeting) {
      const cur = this.targeting.candidates[this.targeting.index];
      const aimingAllies = this.targeting.cmd.type === 'spell' && (!cur || !cur.isEnemy);
      this.menuEl.innerHTML = ''; // targeting owns the whole pane
      const title = document.createElement('div');
      title.style.cssText = `font-size:12.5px; color:${T.gold}; margin:2px 0 7px; text-align:center; letter-spacing:1px;`;
      title.textContent = aimingAllies ? '✛ Choose an ally…' : '✛ Choose a target…';
      this.menuEl.appendChild(title);
      const cancelBtn = menuBtn('← Cancel', 'Esc', () => this.cancelTargeting(), true);
      this.menuEl.appendChild(cancelBtn);
      const confirmLabel = cur ? cur.label : '—';
      const confirmBtn = menuBtn(`▶ ${confirmLabel}`, 'Enter', () => this.confirmTarget(), false, 'Enter');
      this.menuEl.appendChild(confirmBtn);
      this.menuButtons.push({ el: confirmBtn, onClick: () => this.confirmTarget(), key: '1', danger: false });
      this.menuButtons.push({ el: cancelBtn, onClick: () => this.cancelTargeting(), key: '', danger: true });
      this.applyTargetCursor();
      const hint = document.createElement('div');
      hint.style.cssText = `font-size:9px; color:${T.faint}; margin-top:6px; text-align:center;`;
      hint.textContent = this.padConnected ? '🎮 D-pad target · Ⓐ confirm · Ⓑ cancel' : '↑↓ target · Enter confirm · Esc cancel';
      this.menuEl.appendChild(hint);
      this.menuCursor = this.menuButtons.findIndex(b => b.key === '1');
      this.applyCursor();
      return;
    }

    const backBtn = menuBtn('← Back', 'Esc', () => { this.menuPane = 'root'; this.renderMenu(); }, false, '');
    const queuedTag = this.menuIsQueued && hero.id !== this.parkedHeroId
      ? `<div style="font-size:10px; color:${T.muted}; margin-top:2px;">⏳ order will be queued — Tab to reach another hero</div>`
      : `<div style="font-size:10px; color:${T.muted}; margin-top:2px;">Tab: cycle heroes · Shift+2: recast last spell</div>`;
    const queuedCount = this.queuedOrders.size;
    const queuedList = queuedCount > 0
      ? `<div style="font-size:10px; color:${T.info}; margin-bottom:4px;">Queued: ${[...this.queuedOrders.entries()].map(([id, c]) => {
          const m = this.partyRoster.find(x => x.id === id);
          const name = m ? m.name : '?';
          const label = c.type === 'attack' ? 'Attack' : c.type === 'flee' ? 'Flee' : c.type === 'item' ? 'Item' : this.lastSpellByHero.get(id)?.spellName ?? 'Spell';
          return `${name} → ${label}`;
        }).join(', ')}</div>`
      : '';
    const padPip = this.padConnected ? '<span class="pad-pip" title="Gamepad connected — D-pad move · Ⓐ confirm · Ⓑ back · LB hero">🎮</span> ' : '';
    const header = `<div class="dp-title" style="font-size:13px; color:${T.gold}; letter-spacing:1.2px; margin-bottom:6px; border-bottom:1px solid ${T.rule}; padding-bottom:6px;">${padPip}⌘ ${hero.name}${this.menuIsQueued && hero.id !== this.parkedHeroId ? ' (queued)' : ''} — your command?</div>${queuedTag}${queuedList}`;

    if (this.menuPane === 'root') {
      this.menuEl.innerHTML = header;
      this.menuEl.appendChild(menuBtn('⚔ Attack', 'strike the nearest foe', () =>
        this.pickCommand({ type: 'attack' }), false, labelFor(this.binds.attack)));
      const memory = this.lastSpellByHero.get(hero.id);
      const spellSub = this.menuSpells.length > 0
        ? (memory && this.menuSpells.some(s => s.id === memory.spellId)
          ? `⏭ ${memory.spellName} ready`
          : `${this.menuSpells.length} castable`)
        : 'none affordable';
      this.menuEl.appendChild(menuBtn('✦ Spell', spellSub, () => {
        if (this.menuSpells.length > 0) { this.menuPane = 'spell'; this.renderMenu(); }
      }, false, labelFor(this.binds.spell)));
      this.menuEl.appendChild(menuBtn('🧪 Item', this.menuItems.length > 0 ? `${this.menuItems.length} usable` : 'pack empty', () => {
        if (this.menuItems.length > 0) { this.menuPane = 'item'; this.renderMenu(); }
      }, false, labelFor(this.binds.item)));
      if (this.menuAbility) {
        const usesLeft = this.menuHero.abilityUses[this.menuAbility.id] ?? 0;
        this.menuEl.appendChild(menuBtn(`⚡ ${this.menuAbility.name}`, `${this.menuAbility.description} (${usesLeft} use${usesLeft === 1 ? '' : 's'} left)`, () =>
          this.pickCommand({ type: 'ability' }), false, 'E'));
      }
      this.menuEl.appendChild(menuBtn('🏃 Flee', 'disengage the fight', () =>
        this.pickCommand({ type: 'flee' }), true, labelFor(this.binds.flee)));
      // Formation presets: queue a standard opener for the whole party.
      const presetRow = document.createElement('div');
      presetRow.style.cssText = `display:flex; gap:5px; margin-top:7px; padding-top:7px; border-top:1px solid ${T.rule};`;
      for (const [name, preset] of Object.entries(BattleView.PRESETS)) {
        const p = document.createElement('button');
        p.style.cssText = [
          'flex:1; padding:5px 4px; cursor:pointer; font-size:10.5px;',
          `background:rgba(255,255,255,0.03); color:${T.goldDim}; border:1px solid ${T.line}; border-radius:${T.r2};`,
        ].join('');
        p.innerHTML = preset.label;
        const presetBind = { standard: this.binds.formationStandard, careful: this.binds.formationCareful, reckless: this.binds.formationReckless }[name] ?? '';
        p.title = `Formation — ${preset.hint} (key ${labelFor(presetBind)}; queues every hero's default order)`;
        p.addEventListener('mouseenter', () => { p.style.borderColor = T.gold; p.style.color = '#f2dca0'; });
        p.addEventListener('mouseleave', () => { p.style.borderColor = T.line; p.style.color = T.goldDim; });
        p.addEventListener('click', () => this.runPreset(name));
        presetRow.appendChild(p);
      }
      this.menuEl.appendChild(presetRow);
    } else if (this.menuPane === 'spell') {
      this.menuEl.innerHTML = header;
      const menuEl = this.menuEl;
      menuEl.appendChild(backBtn);
      // School → one-word descriptor for spells with no damage/healing line.
      const SCHOOL_WORD: Record<string, string> = {
        abjuration: 'ward', enchantment: 'control', conjuration: 'summon',
        illusion: 'deceive', divination: 'insight', necromancy: 'drain',
        transmutation: 'transform', evocation: 'arcane',
      };
      this.menuSpells.forEach((s, i) => {
        // Dice + element straight from the spell data ('8d6 fire').
        const tokens = (s.damage ?? '').split(' ').filter(t => t.length > 0);
        const dice = tokens[0] ?? null;
        const element = tokens.find(t => BattleView.ELEMENT_COLORS[t]) ?? null;
        const healDice = s.healing ? (s.healing.split(' ')[0] ?? null) : null;
        const color = element ? BattleView.ELEMENT_COLORS[element]
          : healDice ? '#6ef0aa'
          : BattleView.DEFAULT_ELEMENT;
        const kindLabel = dice
          ? `${dice}${element ? ` ${element}` : ''}`
          : healDice
            ? `${healDice} healing`
            : SCHOOL_WORD[s.school.toLowerCase()] ?? s.school.toLowerCase();
        const dot = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${color}; margin-right:6px; box-shadow:0 0 5px ${color};"></span>`;
        const sub = s.level === 0 ? 'cantrip' : `Lv${s.level} slot`;
        const isMemory = this.lastSpellByHero.get(hero.id)?.spellId === s.id;
        const queuedCmd = this.queuedOrders.get(hero.id);
        const isQueued = this.menuIsQueued && queuedCmd?.type === 'spell' && queuedCmd.spellId === s.id;
        const markers = [
          isMemory ? '<span style="color:#ffd700;">⏭ last cast</span>' : null,
          isQueued ? '<span style="color:#8fd6a0;">⏳ queued</span>' : null,
        ].filter(Boolean).join(' · ');
        const subHtml = `${markers ? markers + ' · ' : ''}<span style="color:${color}; font-weight:bold;">${kindLabel}</span> · ${sub}`;
        menuEl.appendChild(menuBtn(`${dot}✦ ${s.name}`, subHtml, () =>
          this.pickCommand({ type: 'spell', spellId: s.id }), false, String(i + 1)));
      });
    } else {
      this.menuEl.innerHTML = header;
      const menuEl = this.menuEl;
      menuEl.appendChild(backBtn);
      this.menuItems.forEach((it, i) => {
        menuEl.appendChild(menuBtn(`🧪 ${it.name}`, `held by ${it.holderName}`, () =>
          this.pickCommand({ type: 'item', itemId: it.itemId, holderId: it.holderId }), false, String(i + 1)));
      });
    }

    // Keyboard hint row under the menu.
    const hint = document.createElement('div');
    hint.style.cssText = `margin-top:7px; padding-top:6px; border-top:1px solid ${T.rule}; color:${T.faint}; font-size:9px; text-align:center;`;
    if (this.quickCastFlash) {
      hint.style.color = T.gold;
      hint.textContent = this.quickCastFlash;
      this.quickCastFlash = null; // one-shot
    } else {
      const pad = this.padConnected ? '🎮 D-pad move · Ⓐ confirm · Ⓑ back' : null;
      const kb = (...codes: string[]) => codes.map(c => labelFor(c)).join('/');
      hint.textContent = this.menuPane === 'root'
        ? (this.menuIsQueued
          ? (pad ? pad + ' · LB hero' : `↑↓ select · Enter queue · ${labelFor(this.binds.heroNext)} next hero · Esc stay`)
          : (pad
            ? pad + ' · LB hero'
            : `${kb(this.binds.attack, this.binds.spell, this.binds.item, this.binds.flee)} commands · ${kb(this.binds.formationStandard, this.binds.formationCareful, this.binds.formationReckless)} formation · Shift+${labelFor(this.binds.quickcast)} recast · ${labelFor(this.binds.heroNext)} hero · F1 controls`))
        : (pad ? pad + ' · LB hero' : '↑↓ select · Enter pick · 1-9 pick · Esc back');
    }
    this.menuEl.appendChild(hint);

    // Restore the keyboard cursor after a rebuild: flash re-renders keep the
    // position; a pane switch defaults to the first numbered entry.
    const cur = this.menuButtons[this.menuCursor];
    if (!cur || !cur.key) this.menuCursor = this.defaultCursorIndex();
    this.applyCursor();
  }

  /** First selectable (numbered) entry — the cursor's home position. */
  private defaultCursorIndex(): number {
    const i = this.menuButtons.findIndex(b => !!b.key);
    return i >= 0 ? i : 0;
  }

  /** Paint the cursor row: blinking ▶ pointer, gold border, scroll into view. */
  private applyCursor(): void {
    if (!this.menuEl) return;
    if (this.cursorEl && this.cursorEl.parentElement) this.cursorEl.remove();
    this.cursorEl = null;
    this.menuButtons.forEach(b => {
      b.el.style.borderColor = b.danger ? '#6a3630' : T.line;
      b.el.style.background = b.danger ? 'rgba(58,24,20,0.85)' : 'rgba(255,255,255,0.035)';
      const old = b.el.querySelector('.menu-cursor');
      if (old) old.remove();
    });
    const entry = this.menuButtons[this.menuCursor];
    if (!entry) return;
    entry.el.style.borderColor = T.gold;
    entry.el.style.background = 'linear-gradient(180deg, rgba(84,66,26,0.75), rgba(52,40,16,0.75))';
    const ptr = document.createElement('span');
    ptr.className = 'menu-cursor';
    ptr.textContent = '▶';
    ptr.style.cssText = `display:inline-block; width:12px; margin-right:4px; color:${T.gold}; animation:menu-cursor-blink 0.9s steps(1) infinite;`;
    const content = entry.el.firstElementChild;
    if (content) entry.el.insertBefore(ptr, content); else entry.el.appendChild(ptr);
    entry.el.scrollIntoView({ block: 'nearest' });
  }

  /** Move the cursor with wraparound, skipping the unnumbered Back button. */
  private moveCursor(delta: number): void {
    const selectable = this.menuButtons
      .map((b, i) => (b.key ? i : -1))
      .filter(i => i >= 0);
    if (selectable.length === 0) return;
    let pos = selectable.indexOf(this.menuCursor);
    if (pos < 0) pos = 0;
    this.menuCursor = selectable[(pos + delta + selectable.length) % selectable.length];
    this.applyCursor();
  }

  // ── Gamepad support: D-pad = cursor, Ⓐ = confirm, Ⓑ = back/cancel ──

  /** Begin polling gamepads at 120ms while the battle window may be open. */
  private startPadPoll(): void {
    if (this.padPollId) return; // idempotent — constructor + open() both call
    const tick = () => {
      this.pollPads();
      if (this.isOpen || this.padConnected) {
        this.padPollId = window.setTimeout(tick, 120);
      } else {
        this.padPollId = 0;
        this.padConnected = false;
      }
    };
    this.padPollId = window.setTimeout(tick, 120);
  }

  /** One pad poll: detect press edges and translate them into menu input. */
  private pollPads(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) { pad = p; break; }
    }
    if (!pad) {
      if (this.padConnected) {
        this.padConnected = false;
        this.renderMenu(); // restore keyboard-first hints
      }
      this.padPrev = [];
      return;
    }
    if (!this.padConnected) {
      this.padConnected = true;
      this.renderMenu(); // flip hints to pad-first once
    }
    const held = (pad.buttons || []).map(b => !!b && b.pressed);
    const edge = (i: number): boolean => !!held[i] && !this.padPrev[i];

    // Standard mapping: 12 up, 13 down, 14 left, 15 right, 0 Ⓐ, 1 Ⓑ.
    const menuAlive = this.menuHero && this.menuEl && this.menuEl.style.display === 'block';
    if (menuAlive) {
      if (edge(12)) {
        if (this.targeting) this.moveTargetCursor(-1); else this.moveCursor(-1);
      } else if (edge(13)) {
        if (this.targeting) this.moveTargetCursor(1); else this.moveCursor(1);
      }
      if (edge(14) && this.targeting) this.moveTargetCursor(-1);
      if (edge(15) && this.targeting) this.moveTargetCursor(1);
      if (edge(0)) {
        // Ⓐ confirm: fire the targeting pick, the highlighted row, or the
        // first numbered entry when no cursor has moved yet.
        if (this.targeting) this.confirmTarget();
        else {
          const entry = this.menuButtons[this.menuCursor];
          if (entry) entry.onClick();
          else {
            const first = this.menuButtons.find(b => !!b.key);
            if (first) first.onClick();
          }
        }
      }
      if (edge(1)) {
        // Ⓑ back/cancel: out of targeting, out of a submenu; Esc semantics.
        if (this.targeting) this.cancelTargeting();
        else if (this.menuPane !== 'root') {
          this.menuPane = 'root';
          this.renderMenu();
        }
      }
      if (edge(4)) this.cycleMenuHero(); // LB hops heroes like Tab
    }
    this.padPrev = held;
  }

  /**
   * Global keyboard control for the command menu: 1-9 trigger the numbered
   * entries, Esc backs out of a submenu. Only active while the menu is open
   * (and not typing in the DM bar) — otherwise keys pass through untouched.
   */
  private handleMenuKey = (event: KeyboardEvent): void => {
    if (!this.menuHero || !this.menuEl || this.menuEl.style.display !== 'block') return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    // F1: toggle the controls/remap overlay — works even while targeting.
    if (event.key === 'F1' || event.code === 'F1') {
      event.preventDefault();
      this.toggleControlsOverlay();
      return;
    }

    // Mid-remap: capture the next key (Esc escapes without rebinding).
    if (this.remapping) {
      event.preventDefault();
      const action = this.remapping;
      if (event.key !== 'Escape') {
        const code = event.code || event.key;
        this.setBind(action, code);
      }
      this.remapping = null;
      this.renderControlsOverlay();
      return;
    }

    if (event.key === 'Escape') {
      // Controls overlay open? Esc closes it first.
      if (this.controlsEl && this.controlsEl.style.display === 'flex') {
        event.preventDefault();
        this.toggleControlsOverlay();
        return;
      }
      // Targeting first: cancel back to the root pane, no command fired.
      if (this.targeting) {
        event.preventDefault();
        this.cancelTargeting();
        return;
      }
      if (this.menuIsQueued && this.menuPane === 'root') {
        // Esc from a queued hero hops back to the hero the engine paused on.
        event.preventDefault();
        this.menuIsQueued = false;
        const parked = this.partyRoster.find(m => m.id === this.parkedHeroId) ?? null;
        if (parked) {
          this.menuHero = parked;
          this.menuSpells = this.spellsFor ? this.spellsFor(parked) : [];
          this.menuItems = this.itemsFor ? this.itemsFor() : [];
          this.menuPane = 'root';
          this.renderMenu();
        }
        return;
      }
      if (this.menuPane !== 'root') {
        event.preventDefault();
        this.menuPane = 'root';
        this.renderMenu();
      }
      return;
    }

    // Firing a bind that carries modifiers (quick-cast) only when the
    // modifier state matches the bind's expected shape.
    const code = event.code || '';

    // Quick-cast bind: Shift + code (Digit2 default) — recast last spell.
    if (event.shiftKey && !event.ctrlKey && !event.altKey && this.binds.quickcast === code) {
      event.preventDefault();
      if (this.menuPane === 'root') this.quickCastLastSpell();
      return;
    }

    // Plain (unmodified) binds: hero cycle, formations, commands.
    if (!event.shiftKey && !event.ctrlKey && !event.altKey) {
      // Classic FF cursor: arrows move the selection, Enter confirms. While
      // targeting, the same keys drive the crosshair over the battle cards.
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (this.targeting) this.moveTargetCursor(1);
        else this.moveCursor(1);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        if (this.targeting) this.moveTargetCursor(-1);
        else this.moveCursor(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (this.targeting) {
          this.confirmTarget();
          return;
        }
        const entry = this.menuButtons[this.menuCursor];
        if (entry) entry.onClick();
        return;
      }
      if (this.binds.heroNext === code) {
        event.preventDefault();
        this.cycleMenuHero();
        return;
      }
      if (this.menuPane === 'root') {
        if (this.binds.attack === code) { event.preventDefault(); this.pickCommand({ type: 'attack' }); return; }
        if (this.binds.spell === code) {
          event.preventDefault();
          if (this.menuSpells.length > 0) { this.menuPane = 'spell'; this.renderMenu(); }
          return;
        }
        if (this.binds.item === code) {
          event.preventDefault();
          if (this.menuItems.length > 0) { this.menuPane = 'item'; this.renderMenu(); }
          return;
        }
        if (this.binds.flee === code) { event.preventDefault(); this.pickCommand({ type: 'flee' }); return; }
        if (this.binds.formationStandard === code) { event.preventDefault(); this.runPreset('standard'); return; }
        if (this.binds.formationCareful === code) { event.preventDefault(); this.runPreset('careful'); return; }
        if (this.binds.formationReckless === code) { event.preventDefault(); this.runPreset('reckless'); return; }
      }
    }

    const num = Number(event.key);
    if (Number.isInteger(num) && num >= 1 && num <= 9) {
      // Match by the button's printed key tag, not array index — the Back
      // button occupies slot 0 of the list without a number.
      const entry = this.menuButtons.find(b => b.key === String(num));
      if (entry) {
        event.preventDefault();
        this.menuCursor = this.menuButtons.indexOf(entry);
        this.applyCursor();
        entry.onClick();
      }
    }
  };

  // ── Controls overlay (F1): view binds, remap, reset ──

  /** Show/hide the F1 controls + remapping overlay. */
  private toggleControlsOverlay(): void {
    if (!this.controlsEl) {
      this.controlsEl = document.createElement('div');
      this.controlsEl.style.cssText = [
        'position:absolute; inset:0; z-index:60; display:none;',
        `background:rgba(6,4,4,0.85); font-family:${T.bodyFont}; color:${T.text};`,
        'align-items:center; justify-content:center;',
      ].join('');
      this.root.appendChild(this.controlsEl);
    }
    const show = this.controlsEl.style.display !== 'flex';
    this.controlsEl.style.display = show ? 'flex' : 'none';
    if (show) {
      this.remapping = null;
      this.renderControlsOverlay();
    }
  }

  /** (Re)build the controls overlay content. */
  private renderControlsOverlay(): void {
    const el = this.controlsEl;
    if (!el) return;
    el.innerHTML = '';
    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:linear-gradient(180deg, rgba(30,26,20,0.98), rgba(14,12,10,0.98));',
      `border:1px solid ${T.goldDim}; border-radius:${T.r3}; padding:16px 20px; max-width:560px; width:92%;`,
      `box-shadow:0 8px 40px rgba(0,0,0,0.8), inset 0 0 0 1px ${T.rule};`,
    ].join('');
    const title = document.createElement('div');
    title.className = 'dp-title';
    title.style.cssText = `font-size:16px; color:${T.gold}; letter-spacing:1.5px; margin-bottom:4px;`;
    title.textContent = '⌨ Battle Controls';
    panel.appendChild(title);
    const sub = document.createElement('div');
    sub.style.cssText = `font-size:10px; color:${T.faint}; margin-bottom:12px;`;
    sub.textContent = 'Arrows/Enter always navigate · click a key tile, then press a new key · Esc closes';
    panel.appendChild(sub);
    const list = document.createElement('div');
    list.style.cssText = 'display:grid; grid-template-columns:1fr; gap:4px; max-height:52vh; overflow-y:auto;';
    for (const row of BIND_ORDER) {
      const line = document.createElement('div');
      line.style.cssText = `display:flex; align-items:center; gap:10px; padding:5px 9px; background:${T.row}; border:1px solid ${T.line}; border-radius:${T.r2};`;
      const name = document.createElement('span');
      name.style.cssText = `flex:1; font-size:11.5px; color:${T.text};`;
      name.textContent = row.name;
      const hint = document.createElement('span');
      hint.style.cssText = `flex:2; font-size:9.5px; color:${T.muted};`;
      hint.textContent = row.hint;
      const key = document.createElement('button');
      const isRemapping = this.remapping === row.action;
      key.style.cssText = [
        `min-width:64px; padding:4px 8px; cursor:pointer; font-family:${T.monoFont}; font-size:11px; border-radius:${T.r1};`,
        isRemapping
          ? `background:rgba(84,66,26,0.9); color:${T.gold}; border:1px solid ${T.gold}; animation:pad-pip-blink 1s ease-in-out infinite;`
          : `background:rgba(0,0,0,0.45); color:${T.goldDim}; border:1px solid ${T.line};`,
      ].join('');
      key.textContent = isRemapping ? 'press a key…' : labelFor(this.binds[row.action]);
      key.addEventListener('click', () => {
        this.remapping = this.remapping === row.action ? null : row.action;
        this.renderControlsOverlay();
      });
      line.appendChild(name);
      line.appendChild(hint);
      line.appendChild(key);
      list.appendChild(line);
    }
    panel.appendChild(list);
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:space-between; margin-top:10px;';
    const padNote = document.createElement('span');
    padNote.style.cssText = `font-size:9px; color:${T.faint};`;
    padNote.textContent = this.padConnected
      ? '🎮 Gamepad: D-pad move · Ⓐ confirm · Ⓑ back · LB hero (fixed)'
      : '🎮 Gamepad supported: D-pad move · Ⓐ confirm · Ⓑ back · LB hero';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'dp-btn dp-btn-bad';
    resetBtn.style.cssText = 'padding:4px 11px; font-size:10px;';
    resetBtn.textContent = '↺ Reset to defaults';
    resetBtn.addEventListener('click', () => {
      this.binds = { ...DEFAULT_KEYBINDS };
      saveKeybinds(this.binds);
      this.renderControlsOverlay();
    });
    footer.appendChild(padNote);
    footer.appendChild(resetBtn);
    panel.appendChild(footer);
    el.appendChild(panel);
  }

  /** Rebind an action, clearing any other action that shared the code. */
  private setBind(action: BindAction, code: string): void {
    for (const k of Object.keys(this.binds) as BindAction[]) {
      if (this.binds[k] === code) this.binds[k] = '';
    }
    this.binds[action] = code;
    saveKeybinds(this.binds);
    this.renderMenu(); // refresh printed key tags on the live menu
  }

  /**
   * Quick-cast: fire the hero's last spell as an immediate command, skipping
   * the submenu. Falls back with a short flash message when there is no
   * memory or the spell is no longer affordable.
   */
  private quickCastLastSpell(): void {
    const hero = this.menuHero;
    if (!hero) return;
    const memory = this.lastSpellByHero.get(hero.id);
    if (!memory) {
      this.flashQuickCast('no spell cast yet — pick from the Spell menu');
      return;
    }
    const stillCastable = this.menuSpells.find(s => s.id === memory.spellId);
    if (!stillCastable) {
      this.flashQuickCast(`no slot left for ${memory.spellName}`);
      return;
    }
    this.pickCommand({ type: 'spell', spellId: memory.spellId });
  }

  /** Show a one-shot message in the hint row, clearing on the next render. */
  private flashQuickCast(msg: string): void {
    this.quickCastFlash = msg;
    this.renderMenu();
  }

  /** Fire the command back to the game and drop the menu. */
  private pickCommand(cmd: PartyCommand): void {
    const hero = this.menuHero;
    if (!hero) return;
    // Remember spell casts for the Shift+2 quick-cast.
    if (cmd.type === 'spell') {
      const spell = this.menuSpells.find(s => s.id === cmd.spellId);
      if (spell) this.lastSpellByHero.set(hero.id, { spellId: spell.id, spellName: spell.name });
    }
    // Attacks and spells enter targeting mode: the same arrow-cursor flow
    // selects which enemy (or ally, for heals) takes the hit.
    if (cmd.type === 'attack' || cmd.type === 'spell') {
      this.beginTargeting(cmd);
      return;
    }
    // Queued hero (Tab-cycled): park the order, advance the cycle menu.
    if (this.menuIsQueued && hero.id !== this.parkedHeroId) {
      this.queuedOrders.set(hero.id, cmd);
      this.hideCommandMenu();
      this.onQueuedOrder?.(hero.id, cmd);
      this.renderHeroes(); // chip appears the instant the order lands
      this.cycleMenuHero();
      return;
    }
    this.hideCommandMenu();
    this.renderHeroes(); // gold-outline chip state is resolved on repaint
    this.onCommand?.(hero.id, cmd);
  }

  // ── Targeting: FF-style arrow selection over battle cards ──

  /**
   * Enter targeting mode for an attack or spell command: build the candidate
   * list (enemies for attacks/damage spells; allies for healing spells) and
   * repaint the menu as an aim prompt. The command fires once a target is
   * confirmed — Esc cancels back to the root pane.
   */
  private beginTargeting(cmd: PartyCommand): void {
    const hero = this.menuHero;
    if (!hero) return;
    const candidates: { id: string; label: string; isEnemy: boolean }[] = [];
    if (cmd.type === 'attack') {
      for (const m of this.enemies) if (m.isAlive) candidates.push({ id: m.id, label: m.template.name, isEnemy: true });
    } else if (cmd.type === 'spell') {
      const spell = SPELLS.find(s => s.id === cmd.spellId);
      if (spell?.healing) {
        for (const m of this.party?.members ?? []) if (m.isAlive) candidates.push({ id: m.id, label: m.name, isEnemy: false });
      } else {
        for (const m of this.enemies) if (m.isAlive) candidates.push({ id: m.id, label: m.template.name, isEnemy: true });
      }
    }
    if (candidates.length === 0) {
      // No valid targets (e.g. everyone hurt-free or foes down): resolve as
      // a plain command and let the engine's own fallbacks handle it.
      this.resolveTargeted(cmd, undefined);
      return;
    }
    this.targeting = { cmd, candidates, index: 0 };
    this.renderMenu(); // menu repurposes itself as the aim prompt
  }

  /** The currently highlighted target, or null when not targeting. */
  private targetCardEl(): HTMLElement | null {
    if (!this.targeting) return null;
    const cur = this.targeting.candidates[this.targeting.index];
    if (!cur) return null;
    const row = cur.isEnemy ? this.enemyRow : this.heroRow;
    return row.querySelector(`.battle-card[data-id="${cur.id}"]`) as HTMLElement | null;
  }

  /** Paint/remove the crosshair ring on the selected target card. */
  private applyTargetCursor(): void {
    for (const row of [this.enemyRow, this.heroRow]) {
      for (const card of Array.from(row.querySelectorAll('.battle-card.bv-targeted'))) {
        card.classList.remove('bv-targeted');
      }
    }
    const el = this.targetCardEl();
    if (el) el.classList.add('bv-targeted');
  }

  /** Move the target selection with wraparound (FF pointer on the field). */
  private moveTargetCursor(delta: number): void {
    if (!this.targeting) return;
    const n = this.targeting.candidates.length;
    this.targeting.index = (this.targeting.index + delta + n) % n;
    this.renderMenu(); // re-renders the aim prompt + crosshair together
  }

  /** Confirm the highlighted target: merge the id into the command and fire. */
  private confirmTarget(): void {
    if (!this.targeting || !this.menuHero) return;
    const cur = this.targeting.candidates[this.targeting.index];
    const cmd = this.targeting.cmd;
    this.targeting = null;
    if (cmd.type === 'attack') cmd.targetMonsterId = cur?.id;
    else if (cmd.type === 'spell') {
      if (cur?.isEnemy) cmd.targetMonsterId = cur.id;
      else if (cur) cmd.targetAllyId = cur.id;
    }
    this.resolveTargeted(cmd, cur?.id);
  }

  /** Cancel targeting: back to the root pane, no command fired. */
  private cancelTargeting(): void {
    this.targeting = null;
    this.applyTargetCursor(); // clears the ring
    this.menuPane = 'root';
    this.renderMenu();
  }

  /** Fire a finalized command through the normal queue/submit paths. */
  private resolveTargeted(cmd: PartyCommand, _targetId?: string): void {
    const hero = this.menuHero;
    if (!hero) return;
    if (this.menuIsQueued && hero.id !== this.parkedHeroId) {
      this.queuedOrders.set(hero.id, cmd);
      this.hideCommandMenu();
      this.onQueuedOrder?.(hero.id, cmd);
      this.renderHeroes();
      this.cycleMenuHero();
      return;
    }
    this.hideCommandMenu();
    this.renderHeroes();
    this.onCommand?.(hero.id, cmd);
  }

  /**
   * Tab: move the command menu to the next living hero who has no queued
   * order yet. Wraps around; stops on the parked hero when everyone else
   * is queued. Reachable from the root pane or any submenu.
   */
  cycleMenuHero(): void {
    const roster = this.partyRoster;
    if (roster.length <= 1) return;
    const currentIdx = this.menuHero ? roster.findIndex(m => m.id === this.menuHero!.id) : -1;
    for (let step = 1; step <= roster.length; step++) {
      const next = roster[(currentIdx + step) % roster.length];
      if (next.id === this.parkedHeroId) continue;
      if (this.queuedOrders.has(next.id)) continue;
      this.showQueuedMenuFor(next);
      return;
    }
    // Everyone (except the parked hero) already has orders — go back to the
    // hero the engine is paused on so their pick resolves the pause.
    this.flashQuickCast('all orders queued — the acting hero awaits their command');
    const parked = roster.find(m => m.id === this.parkedHeroId);
    if (parked) {
      this.menuHero = parked;
      this.menuSpells = this.spellsFor ? this.spellsFor(parked) : [];
      this.menuItems = this.itemsFor ? this.itemsFor() : [];
      this.menuPane = 'root';
      this.menuIsQueued = false;
      this.renderMenu();
    }
  }

  /** Show the queue-ordered menu for a hero who is not the engine's parked actor. */
  private showQueuedMenuFor(hero: GameCharacter): void {
    this.menuHero = hero;
    this.menuSpells = this.spellsFor ? this.spellsFor(hero) : [];
    this.menuItems = this.itemsFor ? this.itemsFor() : [];
    this.menuPane = 'root';
    this.menuIsQueued = true;
    this.renderMenu();
  }

  // ── Victory summary panel ──

  /**
   * Show the end-of-fight summary: fanfare, spoils (XP/gold/items), the
   * kill tally, and a Continue button. Auto-dismisses after 14s if untouched.
   * For a defeat, call with a short message and no spoils.
   */
  showSpoils(spoils: BattleSpoils): void {
    if (!this.isOpen) return;
    this.sounds?.victoryFanfare();

    if (!this.spoilsEl) {
      this.spoilsEl = document.createElement('div');
      this.spoilsEl.id = 'battle-spoils';
      this.spoilsEl.className = 'dp-window';
      this.spoilsEl.style.cssText = [
        'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:32;',
        'min-width:320px; max-width:460px; max-height:70%; overflow-y:auto; padding:16px 20px;',
        'box-shadow:0 6px 40px rgba(0,0,0,0.8), 0 0 26px rgba(255,200,60,0.22);',
        `font-family:${T.bodyFont}; color:#e8e0c8;`,
      ].join('');
      this.root.appendChild(this.spoilsEl);
    }
    this.spoilsEl.style.display = 'block';

    const kindIcon: Record<BattleSpoils['items'][number]['kind'], string> = {
      magic: '✦', potion: '🧪', scroll: '📜', treasure: '💎', other: '·',
    };
    const itemLines = spoils.items.length === 0
      ? `<div style="color:${T.faint}; font-size:11px; margin:3px 0; font-style:italic;">The corpses yield nothing but dust.</div>`
      : spoils.items.map(i =>
        `<div style="font-size:11px; margin:3px 0; color:${i.kind === 'magic' ? '#c8a8ff' : i.kind === 'treasure' ? '#e8c860' : '#a8d8b0'};">` +
        `${kindIcon[i.kind]} ${i.name}</div>`).join('');
    const killLines = spoils.kills.map(k =>
      `<span style="display:inline-block; margin:2px 8px 2px 0; font-size:10px; color:${T.muted};">☠ ${k.count}× ${k.name}</span>`).join('');

    this.spoilsEl.innerHTML = `
      <div style="text-align:center; margin-bottom:10px;">
        <div style="font-family:${T.titleFont}; font-size:23px; font-weight:bold; color:${T.gold}; letter-spacing:6px; text-shadow:0 0 14px rgba(232,197,106,0.55);">
          ${spoils.boss ? '⭐ VICTORY! ⭐' : 'VICTORY!'}
        </div>
        <div style="font-size:10px; color:${T.goldDim}; letter-spacing:3px; margin-top:4px; font-style:italic;">THE FIELD IS YOURS</div>
      </div>
      <div style="border-top:1px solid ${T.rule}; padding-top:8px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; margin:4px 0;">
          <span style="color:${T.muted};">Experience</span><span class="dp-num" style="color:${T.info};">+${spoils.xpEach} XP each</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin:4px 0;">
          <span style="color:${T.muted};">Coin</span><span class="dp-num" style="color:${T.coin};">💰 ${spoils.gold} gp</span>
        </div>
      </div>
      <div style="border-top:1px solid ${T.rule}; margin-top:8px; padding-top:6px;">
        <div class="dp-section-label" style="font-size:9px; color:${T.goldDim}; margin-bottom:4px;">SPOILS</div>
        ${itemLines}
      </div>
      ${killLines ? `<div style="border-top:1px solid ${T.rule}; margin-top:8px; padding-top:6px;">${killLines}</div>` : ''}
      <div style="text-align:center; margin-top:12px;">
        <button id="spoils-continue" style="padding:9px 30px; background:linear-gradient(180deg, rgba(96,80,36,0.95), rgba(58,46,20,0.95)); color:#f6e7bd; border:1px solid ${T.goldDim}; border-radius:${T.r2}; cursor:pointer; font-family:${T.titleFont}; font-size:13px; letter-spacing:2px; box-shadow:0 0 14px rgba(232,197,106,0.2);">Continue ▸</button>
      </div>
    `;
    this.spoilsEl.querySelector('#spoils-continue')!.addEventListener('click', () => this.dismissSpoils());

    // The dice tray's cinematic die lives outside this window at z-index 95,
    // so the last roll of the fight used to hang over the victory card. Lift
    // the whole (opaque, full-screen) battle window above it while the spoils
    // are up; `dismissSpoils` puts it back so combat rolls stay visible.
    this.root.style.zIndex = '96';

    // Auto-dismiss so an idle window never blocks the flow.
    if (this.spoilsTimer !== null) window.clearTimeout(this.spoilsTimer);
    this.spoilsTimer = window.setTimeout(() => this.dismissSpoils(), 14000);
  }

  /** Defeat sting: no spoils, just a quiet dirge over the banner. */
  showDefeat(): void {
    if (!this.isOpen) return;
    this.sounds?.defeatSting();
  }

  /** Remove the summary panel (also fired by close()). */
  private dismissSpoils(): void {
    if (this.spoilsTimer !== null) {
      window.clearTimeout(this.spoilsTimer);
      this.spoilsTimer = null;
    }
    if (this.spoilsEl) {
      this.spoilsEl.style.display = 'none';
      this.spoilsEl.innerHTML = '';
    }
    this.root.style.zIndex = '45'; // back under the dice tray
    // A close that was deferred for the summary fires now that it's read.
    if (this.pendingClose && !this.closing) {
      this.pendingClose = false;
      this.close();
    }
  }
}
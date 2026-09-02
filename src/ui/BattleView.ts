import { GameCharacter } from '../entities/Character';
import { Monster } from '../entities/Monster';
import { SpriteRenderer } from '../entities/Sprites';
import { Party } from '../entities/Party';
import { CONDITION_META } from '../rules/Rules';
import { maxSlotsFor, getCasterType, SPELLS } from '../data/gameData';
import type { Spell } from '../data/gameData';
import type { PartyCommand } from '../combat/CombatEngine';
import type { DiceSounds } from './DiceSounds';

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
  private feedEl: HTMLElement;
  private roundEl: HTMLElement;
  private bannerEl: HTMLElement;
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
  /** Consumables the game offers for the Item submenu (potion/scroll entries). */
  private menuItems: MenuConsumable[] = [];
  /** Spells the acting hero can afford, provided by the game each pause. */
  private menuSpells: Spell[] = [];
  /** Which submenu pane is showing. */
  private menuPane: 'root' | 'spell' | 'item' = 'root';
  /** Numbered buttons of the current menu pane, in order — keyboard 1-9 targets. */
  private menuButtons: { el: HTMLElement; onClick: () => void; key?: string }[] = [];
  /** DM picked a command — the game executes it and resumes the tick. */
  public onCommand?: (heroId: string, cmd: PartyCommand) => void;
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
      'position:absolute; inset:0; z-index:18; display:none;',
      'background:radial-gradient(ellipse at 50% 38%, #101418 0%, #07090c 70%, #040506 100%);',
      'flex-direction:column; font-family:monospace; overflow:hidden;',
    ].join('');
    this.root.innerHTML = `
      <style>
        @keyframes battle-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(4px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(2px); }
        }
        /* Crit shake: violent, with vertical component — the card recoils. */
        @keyframes battle-crit-shake {
          0%, 100% { transform: translate(0, 0) rotate(0); }
          12% { transform: translate(-9px, -4px) rotate(-2deg); }
          28% { transform: translate(8px, 3px) rotate(1.6deg); }
          44% { transform: translate(-7px, 2px) rotate(-1.4deg); }
          60% { transform: translate(6px, -3px) rotate(1.2deg); }
          76% { transform: translate(-4px, 1px) rotate(-0.8deg); }
          90% { transform: translate(2px, 0) rotate(0.4deg); }
        }
        @keyframes battle-lunge-up {
          0%, 100% { transform: translateY(0); }
          45% { transform: translateY(-16px) scale(1.06); }
        }
        @keyframes battle-lunge-down {
          0%, 100% { transform: translateY(0); }
          45% { transform: translateY(16px) scale(1.06); }
        }
        @keyframes battle-damage-pop {
          0% { transform: translateY(0) scale(0.6); opacity: 0; }
          15% { transform: translateY(-8px) scale(1.25); opacity: 1; }
          70% { transform: translateY(-26px) scale(1); opacity: 1; }
          100% { transform: translateY(-40px) scale(0.9); opacity: 0; }
        }
        @keyframes battle-heal-pop {
          0% { transform: translateY(0) scale(0.6); opacity: 0; }
          15% { transform: translateY(-8px) scale(1.2); opacity: 1; }
          70% { transform: translateY(-26px) scale(1); opacity: 1; }
          100% { transform: translateY(-40px) scale(0.9); opacity: 0; }
        }
        .battle-card.bv-shake { animation: battle-shake 0.35s ease-in-out; }
        .battle-card.bv-lunge-up { animation: battle-lunge-up 0.3s ease-out; }
        .battle-card.bv-lunge-down { animation: battle-lunge-down 0.3s ease-out; }
        .battle-card.bv-hit { filter: brightness(2.2) saturate(0.4) drop-shadow(0 0 8px #ff6040); }
        /* Critical hit: violent shake + harsh red flash washing over the card. */
        .battle-card.bv-crit {
          animation: battle-crit-shake 0.5s ease-in-out, battle-crit-flash 0.55s ease-out;
        }
        .battle-card.bv-crit::after {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(ellipse at center, rgba(255,50,20,0.45) 0%, rgba(255,20,10,0.18) 55%, transparent 80%);
          animation: battle-crit-overlay 0.55s ease-out forwards; z-index: 5;
        }
        @keyframes battle-crit-flash {
          0% { filter: brightness(3.2) saturate(0.2) drop-shadow(0 0 14px #ff3810); }
          40% { filter: brightness(2.2) saturate(0.6) drop-shadow(0 0 10px #ff5030); }
          100% { filter: none; }
        }
        @keyframes battle-crit-overlay {
          0% { opacity: 1; } 100% { opacity: 0; }
        }
        /* Healing: soft green glow blooming over the card. */
        .battle-card.bv-heal-glow {
          animation: battle-heal-glow 0.9s ease-out;
        }
        .battle-card.bv-heal-glow::after {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(ellipse at center, rgba(110,240,170,0.35) 0%, rgba(80,220,140,0.12) 55%, transparent 80%);
          animation: battle-crit-overlay 0.9s ease-out forwards; z-index: 5;
        }
        @keyframes battle-heal-glow {
          0% { filter: brightness(1.1) drop-shadow(0 0 6px #6ef0aa); }
          40% { filter: brightness(1.35) drop-shadow(0 0 16px #6ef0aa); }
          100% { filter: none; }
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
          position: absolute; inset: -4px; pointer-events: none; z-index: 6;
          border-radius: 4px;
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
          width: 30px; height: 30px; border-radius: 50%;
          border: 3px solid var(--glow); box-shadow: 0 0 12px var(--glow), inset 0 0 8px var(--glow);
          animation: battle-impact-ring 0.5s ease-out forwards;
        }
        @keyframes battle-impact-ring {
          0% { transform: scale(0.3); opacity: 1; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        /* Melee slash: a white-hot streak sweeping across the struck card. */
        .bv-slash {
          position: absolute; pointer-events: none; z-index: 28;
          width: 90px; height: 3px; border-radius: 2px;
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
          position: absolute; pointer-events: none; z-index: 30;
          font-weight: bold; font-size: 17px; font-family: monospace;
          text-shadow: 0 1px 3px #000, 0 0 6px rgba(0,0,0,0.6);
          animation: battle-damage-pop 0.9s ease-out forwards;
        }
        .bv-heal-pop { animation: battle-heal-pop 0.9s ease-out forwards; }
      </style>
      <div style="flex:0 0 auto; height:210px; display:flex; flex-direction:column; padding:10px 14px;">          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div id="battle-round" style="color:#cfd6e6; font-size:13px; font-weight:bold; letter-spacing:1px;">ROUND 1</div>
          <div style="display:flex; align-items:center; gap:8px;">
            <div id="battle-speed" style="display:flex; gap:3px;"></div>
            <button id="battle-mode" title="Toggle command mode: Manual = you pick every hero's action; Auto = the AI resolves all turns" style="padding:2px 8px; font-size:10px; font-family:monospace; cursor:pointer; background:#2a2418; color:#ffd700; border:1px solid #b8963e; border-radius:3px;">Manual</button>
            <div id="battle-banner" style="color:#ffd700; font-size:15px; font-weight:bold; letter-spacing:2px; text-shadow:0 0 12px rgba(255,200,0,0.5);"></div>
          </div>
        </div>
        <div id="battle-enemies" style="flex:1; display:flex; justify-content:center; align-items:flex-start; gap:12px; flex-wrap:wrap;"></div>
      </div>
      <div id="battle-feed" style="flex:1 1 auto; margin:0 16px; background:rgba(8,12,18,0.6); border:1px solid #2a3540; border-radius:4px; padding:8px 10px; overflow-y:auto; color:#c8d2de; font-size:12px; min-height:40px; max-height:38%;"></div>
      <div style="flex:0 0 auto; height:210px; display:flex; flex-direction:column; padding:10px 14px;">
        <div style="color:#8fd6a0; font-size:11px; letter-spacing:1px; margin-bottom:6px; text-align:center;">◆ PARTY ◆</div>
        <div id="battle-heroes" style="flex:1; display:flex; justify-content:center; align-items:flex-end; gap:12px; flex-wrap:wrap;"></div>
      </div>
    `;
    this.enemyRow = this.root.querySelector('#battle-enemies')!;
    this.heroRow = this.root.querySelector('#battle-heroes')!;
    this.feedEl = this.root.querySelector('#battle-feed')!;
    this.roundEl = this.root.querySelector('#battle-round')!;
    this.bannerEl = this.root.querySelector('#battle-banner')!;
    this.buildSpeedControls();
    this.buildModeToggle();
    window.addEventListener('keydown', this.handleMenuKey);
    overlay.appendChild(this.root);
  }

  /** Open the window for a fight and render both sides. */
  open(party: Party, monsters: Monster[], sprites: SpriteRenderer): void {
    this.party = party;
    this.enemies = monsters;
    this.spellRenderer = sprites;
    this.activeEnemyId = null;
    this.activeHeroId = null;
    this.root.style.display = 'flex';
    this.isOpen = true;
    this.feedEl.innerHTML = '';
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

  /** Apply the derived kinetic effects to freshly rendered cards. */
  private applyEffects(): void {
    const apply = (container: HTMLElement) => {
      for (const card of Array.from(container.querySelectorAll('.battle-card'))) {
        const el = card as HTMLElement;
        const id = el.getAttribute('data-id') ?? '';
        // The crit/heal ::after overlays need a positioned ancestor.
        el.style.position = 'relative';
        el.classList.remove('bv-shake', 'bv-lunge-up', 'bv-lunge-down', 'bv-hit', 'bv-crit', 'bv-heal-glow');
        if (this.critIds.has(id)) {
          // Crit: the harsher flash subsumes the plain hit flash.
          el.classList.add('bv-crit');
        } else if (this.hitIds.has(id)) {
          el.classList.add('bv-shake', 'bv-hit');
        }
        if (this.healIds.has(id)) {
          el.classList.add('bv-heal-glow');
        }
        if (this.lungedIds.has(id)) {
          // Heroes sit at the bottom (lunge up), enemies at the top (lunge down).
          el.classList.add(container === this.heroRow ? 'bv-lunge-up' : 'bv-lunge-down');
        }
      }
    };
    apply(this.enemyRow);
    apply(this.heroRow);

    // Damage/heal pops over the affected cards.
    for (const pop of this.pendingPops) {
      const card =
        (this.enemyRow.querySelector(`.battle-card[data-id="${pop.id}"]`) as HTMLElement | null) ??
        (this.heroRow.querySelector(`.battle-card[data-id="${pop.id}"]`) as HTMLElement | null);
      if (!card) continue;
      card.style.position = 'relative';
      const num = document.createElement('div');
      num.className = 'bv-damage-pop' + (pop.heal ? ' bv-heal-pop' : '');
      num.textContent = pop.text;
      num.style.color = pop.heal ? '#7fe0a8' : pop.crit ? '#ffcc33' : '#ff7a5a';
      if (pop.crit) num.style.fontSize = '22px';
      num.style.left = '50%';
      num.style.top = '18px';
      card.appendChild(num);
      window.setTimeout(() => num.remove(), 950);
      // Critical hits erupt with a burst of hit-spark particles at the impact point.
      if (pop.crit) this.spawnHitSparks(card);
    }
    this.pendingPops = [];

    // Spell-cast glows: element-colored aura blooming around each caster.
    for (const g of this.castGlows) {
      const card =
        (this.enemyRow.querySelector(`.battle-card[data-id="${g.id}"]`) as HTMLElement | null) ??
        (this.heroRow.querySelector(`.battle-card[data-id="${g.id}"]`) as HTMLElement | null);
      if (!card) continue;
      card.style.position = 'relative';
      const glow = document.createElement('div');
      glow.className = 'bv-spell-glow';
      glow.style.setProperty('--glow', g.color);
      card.appendChild(glow);
      window.setTimeout(() => glow.remove(), 950);
    }
    this.castGlows = [];

    // Spell impact rings: element-colored burst on each struck target.
    for (const r of this.impactRings) {
      const card =
        (this.enemyRow.querySelector(`.battle-card[data-id="${r.id}"]`) as HTMLElement | null) ??
        (this.heroRow.querySelector(`.battle-card[data-id="${r.id}"]`) as HTMLElement | null);
      if (!card) continue;
      card.style.position = 'relative';
      const ring = document.createElement('div');
      ring.className = 'bv-impact-ring';
      ring.style.setProperty('--glow', r.color);
      ring.style.left = '50%';
      ring.style.top = '30px';
      ring.style.marginLeft = '-15px';
      card.appendChild(ring);
      window.setTimeout(() => ring.remove(), 550);
    }
    this.impactRings = [];

    // Melee slash streaks on struck cards (skipped when a crit ran its own FX).
    for (const id of this.slashIds) {
      if (this.critIds.has(id)) continue; // crit sparks + flash already cover it
      const card =
        (this.enemyRow.querySelector(`.battle-card[data-id="${id}"]`) as HTMLElement | null) ??
        (this.heroRow.querySelector(`.battle-card[data-id="${id}"]`) as HTMLElement | null);
      if (!card) continue;
      card.style.position = 'relative';
      const slash = document.createElement('div');
      slash.className = 'bv-slash';
      slash.style.left = '50%';
      slash.style.top = '34px';
      slash.style.marginLeft = '-45px';
      card.appendChild(slash);
      window.setTimeout(() => slash.remove(), 400);
    }
    this.slashIds = new Set();
  }

  /**
   * Erupt a starburst of glowing sparks from the top-center of a card — the
   * visual punctuation of a critical hit. 10 shrapnel streaks fly outward in
   * a fan and fade; each cleans itself up after the animation.
   */
  private spawnHitSparks(card: HTMLElement): void {
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
      s.style.top = '22px';
      s.style.animation = `battle-spark-fly ${0.45 + Math.random() * 0.25}s ease-out forwards`;
      card.appendChild(s);
      window.setTimeout(() => s.remove(), 800);
    }
  }

  /** React to HP/slot/condition changes between action batches. */
  private refreshStates(): void {
    this.renderHeroes();
    this.renderEnemies();
  }

  /** Snap all cards to their resting pose (called between rounds). */
  private resetEffects(): void {
    for (const card of Array.from(this.root.querySelectorAll('.battle-card'))) {
      const el = card as HTMLElement;
      el.classList.remove('bv-shake', 'bv-lunge-up', 'bv-lunge-down', 'bv-hit', 'bv-crit', 'bv-heal-glow');
      // Restart animations on the next batch by forcing a reflow.
      void el.offsetWidth;
    }
  }

  private pushFeed(msg: string): void {
    const line = document.createElement('div');
    line.style.marginBottom = '2px';
    line.style.lineHeight = '1.35';
    let color = '#c8d2de';
    if (msg.includes('CRIT')) color = '#ffcc33';
    else if (/\bheal/.test(msg)) color = '#7fe0a8';
    else if (msg.includes('misses') || msg.includes('slain') || msg.includes('fallen')) color = '#ff7a6a';
    else if (msg.includes('Victory')) color = '#ffd700';
    else if (msg.includes('Initiative') || msg.startsWith('---')) color = '#8a93a3';
    else {
      // Spell lines take their element color — the feed matches the FX.
      const cast = / casts ([\w' ]+?)(?:!| on |\.)/.exec(msg);
      if (cast) {
        const spell = SPELLS.find(s => s.name.toLowerCase() === cast[1].trim().toLowerCase());
        const element = spell?.damage?.split(' ').slice(1).join(' ').toLowerCase() ?? '';
        color = BattleView.ELEMENT_COLORS[element] ?? BattleView.DEFAULT_ELEMENT;
      } else if (msg.includes('casts') || msg.includes('sigils') || msg.includes('Words of power') || msg.includes('Arcane energy') || msg.includes('air itself recoils')) {
        color = BattleView.DEFAULT_ELEMENT;
      } else if (msg.includes('hits') || msg.includes('damage')) {
        color = '#ffd29a';
      }
    }
    line.textContent = msg;
    line.style.color = color;
    this.feedEl.appendChild(line);
    while (this.feedEl.children.length > 60) this.feedEl.removeChild(this.feedEl.firstChild!);
    this.feedEl.scrollTop = this.feedEl.scrollHeight;
  }

  private highlightActors(actors?: (GameCharacter | Monster)[], currentActorId?: string | null): void {
    if (!actors || currentActorId == null) return;
    const cur = actors.reduce<(GameCharacter | Monster) | null>((acc, a) => {
      const id = this.actorId(a);
      if (id === currentActorId) return a;
      return acc;
    }, null);
    if (!cur) return;
    const isMonster = this.isMonster(cur);
    const id = this.actorId(cur);
    this.highlightIn(this.enemyRow, id);
    this.highlightIn(this.heroRow, id);
    void isMonster;
  }

  private highlightIn(container: HTMLElement, actorId: string): void {
    for (const card of Array.from(container.querySelectorAll('.battle-card'))) {
      const hit = card.getAttribute('data-id') === actorId;
      (card as HTMLElement).style.outline = hit ? '2px solid #ffd700' : '1px solid #33404d';
      (card as HTMLElement).style.boxShadow = hit ? '0 0 14px rgba(255,200,0,0.35)' : 'none';
    }
  }

  private isMonster(x: GameCharacter | Monster): x is Monster {
    return (x as Monster).template !== undefined;
  }

  private actorId(a: GameCharacter | Monster): string {
    return this.isMonster(a) ? a.id : a.id;
  }

  private renderEnemies(): void {
    this.enemyRow.innerHTML = '';
    for (const m of this.enemies) {
      if (!m.isAlive && !this.enemies.some(o => o.isAlive)) continue;
      this.enemyRow.appendChild(this.enemyCard(m));
    }
    this.highlightIn(this.enemyRow, this.activeEnemyId ?? '');
  }

  private renderHeroes(): void {
    if (!this.party) return;
    this.heroRow.innerHTML = '';
    for (const m of this.party.members) this.heroRow.appendChild(this.heroCard(m));
    this.highlightIn(this.heroRow, this.activeHeroId ?? '');
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

  private enemyCard(m: Monster): HTMLElement {
    const card = document.createElement('div');
    card.className = 'battle-card';
    card.setAttribute('data-id', m.id);
    const boss = m.template.name.includes('(Boss)');
    const pct = Math.max(0, Math.min(100, (m.hp / Math.max(1, m.maxHp)) * 100));
    const hpColor = pct > 50 ? '#7fe07f' : pct > 25 ? '#f0d070' : '#ff7a5a';
    const conds = m.conditions.map(c => CONDITION_META[c.id]?.label ?? c.name).join(', ');
    card.style.cssText = [
      'display:flex; flex-direction:column; align-items:center; gap:4px;',
      'background:rgba(16,20,28,0.7); border:1px solid #33404d; border-radius:4px;',
      'padding:8px 10px 6px; min-width:96px; max-width:130px;',
    ].join('');
    card.innerHTML = `
      <div style="font-size:10px; color:${boss ? '#ffd700' : '#8fd6a0'}; text-align:center; line-height:1.2; min-height:24px;">${m.template.name}</div>
      <img src="${this.spriteSrc(m)}" style="width:64px; height:64px; image-rendering:pixelated; ${m.isAlive ? '' : 'opacity:0.3; filter:grayscale(1);'}" draggable="false"/>
      <div style="width:100%; background:#1a1f26; border:1px solid #2c3742; border-radius:2px; overflow:hidden;">
        <div style="width:${pct}%; height:8px; background:${hpColor}; transition:width .25s;"></div>
      </div>
      <div style="font-size:9px; color:#9aa; width:100%; text-align:center;">HP ${Math.max(0, Math.round(m.hp))}/${m.maxHp}</div>
      ${conds ? `<div style="font-size:8px; color:#ffb0a0; text-align:center; line-height:1.1;">${conds}</div>` : ''}
    `;
    return card;
  }

  private heroCard(hero: GameCharacter): HTMLElement {
    const card = document.createElement('div');
    card.className = 'battle-card';
    card.setAttribute('data-id', hero.id);
    this.activeHeroId = hero.id;
    const pct = Math.max(0, Math.min(100, (hero.hp / Math.max(1, hero.maxHp)) * 100));
    const hpColor = pct > 50 ? '#7fe07f' : pct > 25 ? '#f0d070' : '#ff7a5a';
    const conds = hero.conditions.map(c => CONDITION_META[c.id]?.label ?? c.name).join(', ');
    // Spell slots as pips per level.
    const slotPips = this.slotPips(hero);
    card.style.cssText = [
      'display:flex; flex-direction:column; align-items:center; gap:4px;',
      'background:rgba(18,26,40,0.75); border:1px solid #2e4a6d; border-radius:4px;',
      'padding:8px 10px 6px; min-width:104px; max-width:150px;',
    ].join('');
    const deadMarker = hero.isDead || hero.isDying ? ` <span style="color:#ff6060;">☠</span>` : '';
    card.innerHTML = `
      <div style="font-size:11px; color:#9fd8ff; text-align:center; line-height:1.2;">${hero.name}${deadMarker}</div>
      <div style="font-size:9px; color:#789; text-align:center;">Lv${hero.level} ${hero.charClass.name}</div>
      <img src="${this.spriteSrc(hero)}" style="width:64px; height:64px; image-rendering:pixelated; ${hero.hp <= 0 ? 'opacity:0.35; filter:grayscale(1);' : ''}" draggable="false"/>
      <div style="width:100%; background:#1a1f26; border:1px solid #2c3742; border-radius:2px; overflow:hidden;">
        <div style="width:${pct}%; height:9px; background:${hpColor}; transition:width .25s;"></div>
      </div>
      <div style="font-size:9px; color:#9aa; width:100%; text-align:center;">HP ${Math.max(0, Math.round(hero.hp))}/${hero.maxHp}</div>
      ${slotPips ? `<div style="font-size:9px; color:#b8c8ff; width:100%; text-align:center;">${slotPips}</div>` : ''}
      ${conds ? `<div style="font-size:8px; color:#ffb0a0; text-align:center; line-height:1.1;">${conds}</div>` : ''}
    `;
    return card;
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
      btn.style.color = mode === 'manual' ? '#ffd700' : '#889';
      btn.style.borderColor = mode === 'manual' ? '#b8963e' : '#33404d';
      btn.style.background = mode === 'manual' ? '#2a2418' : '#1a2028';
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
        'padding:2px 6px; font-size:10px; font-family:monospace; cursor:pointer;',
        'background:#1a2028; color:#889; border:1px solid #33404d; border-radius:3px;',
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
      el.style.background = active ? '#3a4a5e' : '#1a2028';
      el.style.color = active ? '#ffd700' : '#889';
      el.style.borderColor = active ? '#ffd700' : '#33404d';
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
    this.feedEl.innerHTML = '';
    this.enemyRow.innerHTML = '';
    this.heroRow.innerHTML = '';
    this.menuHero = null;
    if (this.menuEl) this.menuEl.remove();
    this.menuEl = null;
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
  showCommandMenu(hero: GameCharacter, spells: Spell[], items: MenuConsumable[]): void {
    this.menuHero = hero;
    this.menuSpells = spells;
    this.menuItems = items;
    this.menuPane = 'root';
    this.renderMenu();
  }

  /** Hide the menu (turn resolved or combat over). */
  hideCommandMenu(): void {
    this.menuHero = null;
    this.menuButtons = [];
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
      this.menuEl.style.cssText = [
        'position:absolute; right:16px; bottom:224px; z-index:25;',
        'min-width:230px; max-width:320px; max-height:44%; overflow-y:auto;',
        'background:linear-gradient(180deg, rgba(10,16,30,0.97), rgba(6,10,18,0.97));',
        'border:2px solid #4a6a9a; border-radius:6px; box-shadow:0 4px 24px rgba(0,0,0,0.7), 0 0 18px rgba(60,110,180,0.25);',
        'font-family:monospace; color:#d8e4f2; padding:10px 12px;',
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
        `background:${danger ? '#3a1a1a' : '#16283e'}; color:${danger ? '#ff9a8a' : '#cfe0f2'};`,
        `border:1px solid ${danger ? '#6a3030' : '#3a5a80'}; border-radius:4px; font-family:monospace; font-size:12px;`,
      ].join('');
      const keyTag = keyHint
        ? `<span style="display:inline-block; min-width:16px; margin-right:8px; padding:1px 4px; background:#0d1520; border:1px solid #3a5a80; border-radius:3px; color:#8fb8d8; font-size:10px; text-align:center;">${keyHint}</span>`
        : '';
      b.innerHTML = `<span style="display:flex; align-items:center;">${keyTag}${label}</span><span style="color:#688; font-size:10px;">${sub}</span>`;
      b.addEventListener('mouseenter', () => { b.style.borderColor = '#ffd700'; });
      b.addEventListener('mouseleave', () => { b.style.borderColor = danger ? '#6a3030' : '#3a5a80'; });
      b.addEventListener('click', onClick);
      this.menuButtons.push({ el: b, onClick, key: keyHint });
      return b;
    };

    const backBtn = menuBtn('← Back', 'Esc', () => { this.menuPane = 'root'; this.renderMenu(); }, false, '');
    const header = `<div style="font-size:12px; color:#ffd700; letter-spacing:1px; margin-bottom:6px; border-bottom:1px solid #3a4a60; padding-bottom:5px;">⌘ ${hero.name} — your command?</div>`;

    if (this.menuPane === 'root') {
      this.menuEl.innerHTML = header;
      this.menuEl.appendChild(menuBtn('⚔ Attack', 'strike the nearest foe', () =>
        this.pickCommand({ type: 'attack' }), false, '1'));
      this.menuEl.appendChild(menuBtn('✦ Spell', this.menuSpells.length > 0 ? `${this.menuSpells.length} castable` : 'none affordable', () => {
        if (this.menuSpells.length > 0) { this.menuPane = 'spell'; this.renderMenu(); }
      }, false, '2'));
      this.menuEl.appendChild(menuBtn('🧪 Item', this.menuItems.length > 0 ? `${this.menuItems.length} usable` : 'pack empty', () => {
        if (this.menuItems.length > 0) { this.menuPane = 'item'; this.renderMenu(); }
      }, false, '3'));
      this.menuEl.appendChild(menuBtn('🏃 Flee', 'disengage the fight', () =>
        this.pickCommand({ type: 'flee' }), true, '4'));
    } else if (this.menuPane === 'spell') {
      this.menuEl.innerHTML = header;
      const menuEl = this.menuEl;
      menuEl.appendChild(backBtn);
      this.menuSpells.forEach((s, i) => {
        menuEl.appendChild(menuBtn(`✦ ${s.name}`, s.level === 0 ? 'cantrip' : `Lv${s.level} slot`, () =>
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
    hint.style.cssText = 'margin-top:6px; padding-top:5px; border-top:1px solid #2a3a50; color:#5a6a7a; font-size:9px; text-align:center;';
    hint.textContent = this.menuPane === 'root'
      ? 'keys: 1 Attack · 2 Spell · 3 Item · 4 Flee'
      : 'keys: 1-9 pick · Esc back';
    this.menuEl.appendChild(hint);
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

    if (event.key === 'Escape') {
      if (this.menuPane !== 'root') {
        event.preventDefault();
        this.menuPane = 'root';
        this.renderMenu();
      }
      return;
    }

    const num = Number(event.key);
    if (Number.isInteger(num) && num >= 1 && num <= 9) {
      // Match by the button's printed key tag, not array index — the Back
      // button occupies slot 0 of the list without a number.
      const entry = this.menuButtons.find(b => b.key === String(num));
      if (entry) {
        event.preventDefault();
        entry.onClick();
      }
    }
  };

  /** Fire the command back to the game and drop the menu. */
  private pickCommand(cmd: PartyCommand): void {
    const hero = this.menuHero;
    this.hideCommandMenu();
    if (hero) this.onCommand?.(hero.id, cmd);
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
      this.spoilsEl.style.cssText = [
        'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:32;',
        'min-width:320px; max-width:460px; max-height:70%; overflow-y:auto;',
        'background:linear-gradient(180deg, rgba(14,20,36,0.98), rgba(8,10,20,0.98));',
        'border:2px solid #b8963e; border-radius:8px; padding:16px 20px;',
        'box-shadow:0 6px 40px rgba(0,0,0,0.8), 0 0 26px rgba(255,200,60,0.22);',
        'font-family:monospace; color:#e8e0c8;',
      ].join('');
      this.root.appendChild(this.spoilsEl);
    }
    this.spoilsEl.style.display = 'block';

    const kindIcon: Record<BattleSpoils['items'][number]['kind'], string> = {
      magic: '✦', potion: '🧪', scroll: '📜', treasure: '💎', other: '·',
    };
    const itemLines = spoils.items.length === 0
      ? `<div style="color:#778; font-size:11px; margin:3px 0;">The corpses yield nothing but dust.</div>`
      : spoils.items.map(i =>
        `<div style="font-size:11px; margin:3px 0; color:${i.kind === 'magic' ? '#c8a8ff' : i.kind === 'treasure' ? '#e8c860' : '#a8d8b0'};">` +
        `${kindIcon[i.kind]} ${i.name}</div>`).join('');
    const killLines = spoils.kills.map(k =>
      `<span style="display:inline-block; margin:2px 8px 2px 0; font-size:10px; color:#9aa;">☠ ${k.count}× ${k.name}</span>`).join('');

    this.spoilsEl.innerHTML = `
      <div style="text-align:center; margin-bottom:10px;">
        <div style="font-size:20px; font-weight:bold; color:#ffd700; letter-spacing:3px; text-shadow:0 0 14px rgba(255,200,0,0.6);">
          ${spoils.boss ? '⭐ VICTORY! ⭐' : 'VICTORY!'}
        </div>
        <div style="font-size:10px; color:#8a7; letter-spacing:2px; margin-top:2px;">THE FIELD IS YOURS</div>
      </div>
      <div style="border-top:1px solid #3a3520; padding-top:8px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; margin:4px 0;">
          <span style="color:#8ac;">Experience</span><span style="color:#bdf;">+${spoils.xpEach} XP each</span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin:4px 0;">
          <span style="color:#8ac;">Coin</span><span style="color:#fd8;">💰 ${spoils.gold} gp</span>
        </div>
      </div>
      <div style="border-top:1px solid #3a3520; margin-top:8px; padding-top:6px;">
        <div style="font-size:10px; color:#886; letter-spacing:1px; margin-bottom:3px;">SPOILS</div>
        ${itemLines}
      </div>
      ${killLines ? `<div style="border-top:1px solid #3a3520; margin-top:8px; padding-top:6px;">${killLines}</div>` : ''}
      <div style="text-align:center; margin-top:12px;">
        <button id="spoils-continue" style="padding:8px 28px; background:#3a3020; color:#ffd700; border:1px solid #b8963e; border-radius:4px; cursor:pointer; font-family:monospace; font-size:13px; letter-spacing:1px;">Continue ▸</button>
      </div>
    `;
    this.spoilsEl.querySelector('#spoils-continue')!.addEventListener('click', () => this.dismissSpoils());

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
    // A close that was deferred for the summary fires now that it's read.
    if (this.pendingClose && !this.closing) {
      this.pendingClose = false;
      this.close();
    }
  }
}
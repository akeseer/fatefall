import { GameCharacter } from '../entities/Character';
import { CombatLog } from '../combat/CombatEngine';
import { Party } from '../entities/Party';
import { Quest, QuestState, questProgressText } from '../quests/Quests';
import { DnDCompendium, CompendiumEntry } from './DnDCompendium';
import { CONDITION_META } from '../rules/Rules';
import { getCasterType, ordinal } from '../data/gameData';
import type { SaveData } from '../save/SaveManager';
import { clearSlot, listSaves } from '../save/SaveManager';
import { DiceTray } from './DiceTray';
import { calendarFromElapsed } from '../world/CalendarSystem';
import { DiceSounds } from './DiceSounds';
import { getAudio } from '../audio/Audio';
import { PartyBuilder } from './PartyBuilder';
import { sfx } from '../audio/Sfx';
import { buildDieScene, buildDiceModel, normalize3, quatFromAxisAngle, quatToMatrix3d } from './Dice3D';
import { TownPanel } from './TownPanel';
import { BattleView } from './BattleView';
import { installTheme, T, classColor, hpColor, toneForColor, LogTone } from './Theme';

export type GameSpeed = 0.25 | 0.5 | 1 | 2 | 4;

export class HUD {
  private overlay: HTMLElement;
  private logEl: HTMLElement;
  private partyEl: HTMLElement;
  private speedBtns: HTMLElement;
  private charSheetEl: HTMLElement;
  private compendium: DnDCompendium;
  private diceTray: DiceTray;
  private diceSounds: DiceSounds;

  public onSpeedChange?: (speed: GameSpeed) => void;
  public onPauseToggle?: () => void;
  public onNewDungeon?: () => void;
  public onCompendiumAction?: (entry: CompendiumEntry, mode: 'encounter' | 'legend') => void;
  public onDMCommand?: (text: string) => void;
  public onSave?: () => void;
  /** An update the desktop shell found at launch; the drawer shows a line for it. */
  public updateAvailable: { version: string; open: () => void } | null = null;
  /** The player picked a renderer in the sound drawer; the game switches and remembers it. */
  public onRendererChange?: (id: 'pixi' | 'phaser' | 'canvas') => void;
  /** Open the town panel when in town; otherwise narrates that you're not in town. */
  public onTownOpen?: () => void;
  /** Save the run and return to the main menu. */
  public onMainMenu?: () => void;
  /** The interactive town overlay (quest board + market). */
  public townPanel: TownPanel;
  /** Final-Fantasy-style full-screen combat window. */
  public battleView: BattleView;
  /** Latest kill ledger snapshot, fed to the Grimoire's Known Foes tab. */
  public liveKillLedger: Record<string, number> = {};
  /** The party's currently accepted quest, shown in the status tracker. */
  public questProvider: () => Quest | null = () => null;
  /** Live quest progress state for the tracker. */
  public questStateProvider: () => QuestState = () => ({
    dungeonLevel: 1,
    killLedger: {},
    bossSlainThisFloor: false,
  });

  /** Point the Grimoire at the live kill ledger (called by the game). */
  public setKillLedgerProvider(fn: () => Record<string, number>) {
    this.liveKillLedger = fn();
    const orig = this.compendium.killLedgerProvider;
    this.compendium.killLedgerProvider = () => {
      this.liveKillLedger = fn();
      return this.liveKillLedger;
    };
    void orig;
  }
  public onStartChoice?: (choice: 'continue' | 'new', slot: number) => void;
  /** The screen between New Run and the road, where the classes are chosen. Made once the overlay exists. */
  public partyBuilder!: PartyBuilder;

  /** True while the big 3D die is tumbling — the game freezes until it lands. */
  isDiceRolling(): boolean {
    return this.diceTray.isRolling();
  }

  /** Close every floating panel and unpause — called before returning to the menu. */
  closeOverlays() {
    this.compendium.close();
    this.townPanel.hide();
    this.battleView.close();
    const dmBar = this.overlay.querySelector('#dm-bar') as HTMLElement | null;
    if (dmBar) dmBar.style.display = 'none';
    if (this.isPaused) this.togglePause();
  }

  private speed: GameSpeed = 1;
  private isPaused: boolean = false;
  private liveParty: Party | null = null;
  private selectedChar: GameCharacter | null = null;
  private combatMessages: string[] = [];
  private dungeonLevel: number = 1;
  private selectedSlot: number = 0;
  private confirmNewSlot: boolean = false;
  private confirmErase: boolean = false;
  private startDieFrame?: number;
  private bossBarEl: HTMLElement;
  private questBarEl: HTMLElement;
  /** The purse/depth line pinned to the foot of the party rail. */
  private partyFootEl: HTMLElement;
  /** How many lines the log currently holds (it appends, never re-joins). */
  private logLineCount: number = 0;

  constructor() {
    this.overlay = document.getElementById('ui-overlay')!;
    installTheme(); // fonts + global polish stylesheet (idempotent)
    this.overlay.innerHTML = this.getTemplate();
    this.logEl = this.overlay.querySelector('#combat-log')!;
    this.bossBarEl = this.overlay.querySelector('#boss-bar')!;
    this.questBarEl = this.overlay.querySelector('#quest-bar')!;
    this.partyEl = this.overlay.querySelector('#party-list')!;
    this.partyFootEl = this.overlay.querySelector('#party-foot')!;
    this.speedBtns = this.overlay.querySelector('#speed-controls')!;
    this.charSheetEl = this.overlay.querySelector('#char-sheet')!;
    this.compendium = new DnDCompendium(this.overlay);
    this.compendium.onAction = (entry, mode) => this.onCompendiumAction?.(entry, mode);
    this.compendium.partyProvider = () => this.liveParty;
    this.compendium.killLedgerProvider = () => this.liveKillLedger;
    this.diceTray = new DiceTray(this.overlay);
    this.diceSounds = new DiceSounds();
    this.townPanel = new TownPanel(this.overlay);
    this.battleView = new BattleView(this.overlay);
    this.partyBuilder = new PartyBuilder(this.overlay);
    this.bindEvents();
    // Battle end jingles ride the same audio engine as the dice.
    this.battleView.sounds = this.diceSounds;
  }

  private getTemplate(): string {
    return `
      <style>
        /* The bottom band is one plank of dark wood with a gold seam along its
           top edge — the same seam the panels and section rules use. */
        .dp-hud-panel {
          background: ${T.panelGrad};
          border-top: 1px solid ${T.line};
          box-shadow: 0 -6px 24px rgba(0,0,0,0.55), inset 0 1px 0 ${T.rule};
        }
        .dp-hud-col { padding: 8px 10px; overflow-y: auto; font-size: 11px; }
        #hud-top button { padding: 5px 12px; font-size: 12px; }
        /* An icon carries the colour; the label stays parchment, so seven
           controls read as one set instead of seven unrelated buttons. */
        #hud-top button .ic { margin-right: 5px; }
        /* Sound: a small drawer under the speaker, one slider per bus. */
        #audio-pop {
          position: absolute; top: 44px; right: 10px; z-index: 40;
          width: 230px; padding: 10px 12px;
          background: ${T.panelGrad}; border: 1px solid ${T.lineHot}; border-radius: ${T.r2};
          box-shadow: 0 10px 28px rgba(0,0,0,0.6), inset 0 1px 0 ${T.rule};
          font-size: 11px; color: ${T.text};
        }
        #audio-pop .ap-row { display: flex; align-items: center; gap: 8px; margin-top: 7px; }
        #audio-pop .ap-row label { flex: 0 0 52px; color: ${T.muted}; }
        #audio-pop .ap-row input[type=range] { flex: 1; accent-color: ${T.gold}; height: 14px; margin: 0; }
        #audio-pop .ap-row .ap-val { flex: 0 0 30px; text-align: right; color: ${T.gold}; font-family: ${T.monoFont}; font-size: 10px; }
        #audio-pop .ap-head { display: flex; justify-content: space-between; align-items: center; }
        #audio-pop .ap-head span { color: ${T.gold}; font-family: ${T.titleFont}; letter-spacing: 0.04em; }
        #audio-pop .ap-rule { border-top: 1px solid ${T.rule}; margin: 10px 0 6px; }
        #audio-pop .ap-seg { display: flex; border: 1px solid ${T.line}; border-radius: ${T.r2}; overflow: hidden; flex: 1; }
        #audio-pop .ap-seg button { flex: 1; padding: 3px 0; font-size: 10px; border: 0; border-radius: 0; }
        #audio-pop .ap-seg button + button { border-left: 1px solid ${T.line}; }
        #audio-pop .ap-seg button.on { background: ${T.rowHot}; color: ${T.gold}; }
        #audio-pop .ap-note { color: ${T.faint}; font-size: 10px; margin-top: 5px; font-style: italic; }
        /* Speed: one segmented control, not five loose buttons. */
        #speed-controls {
          display: flex;
          border: 1px solid ${T.line};
          border-radius: ${T.r2};
          overflow: hidden;
          background: rgba(9,8,12,0.75);
        }
        #speed-controls .speed-btn {
          padding: 5px 8px; font-size: 11px; color: ${T.muted};
          background: transparent !important;
          border: none !important;
          border-radius: 0 !important;
          border-left: 1px solid ${T.line} !important;
          box-shadow: none !important;
        }
        #speed-controls .speed-btn:first-child { border-left: none !important; }
        #speed-controls .speed-btn:hover { color: ${T.text}; background: rgba(232,197,106,0.07) !important; }
        #speed-controls .speed-btn.speed-active {
          color: #f6e7bd !important;
          background: linear-gradient(180deg, rgba(84,66,26,0.95), rgba(58,44,16,0.95)) !important;
          box-shadow: inset 0 0 10px rgba(232,197,106,0.18);
        }
        /* Party rail rows. */
        .party-member {
          display: flex; gap: 7px; padding: 4px 6px; margin-bottom: 4px;
          border: 1px solid transparent; border-radius: ${T.r2};
          cursor: pointer;
          transition: border-color .15s ease, background .15s ease;
        }
        .party-member:hover { background: ${T.rowHot}; border-color: ${T.line}; }
        .party-member.sel { border-color: ${T.goldDim}; background: rgba(232,197,106,0.08); }
        .party-member.down { background: rgba(170,60,45,0.10); }
      </style>
      <div id="hud-panels" class="dp-hud-panel" style="position:absolute; bottom:0; left:0; right:0; height:200px; display:flex; flex-direction:row;">
        <!-- Party rail: a scrolling roster with the purse pinned to the foot,
             so a fourth member can never push the gold count out of sight. -->
        <div id="party-status" class="dp-hud-col" style="width:246px; flex:0 0 auto; display:flex; flex-direction:column; overflow:hidden; border-right:1px solid ${T.line};">
          <div id="party-list" style="flex:1 1 auto; overflow-y:auto; min-height:0;"></div>
          <div id="party-foot" style="flex:0 0 auto; margin-top:5px; padding-top:5px; border-top:1px solid ${T.rule}; display:flex; justify-content:space-between; font-size:9.5px;"></div>
        </div>

        <!-- The narrative log — the surface the player actually reads. -->
        <div class="dp-hud-col" style="flex:1; min-width:0;">
          <div id="boss-bar" style="display:none; margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid ${T.rule};"></div>
          <div id="combat-log"></div>
        </div>

        <!-- Character Sheet (when selected) -->
        <div id="char-sheet" class="dp-hud-col" style="width:250px; flex:0 0 auto; border-left:1px solid ${T.line}; display:none;">
        </div>
      </div>

      <!-- Top bar: controls -->
      <div id="hud-top" style="position:absolute; top:10px; right:10px; display:flex; gap:6px; z-index:20;">
        <button id="btn-pause" title="Pause / resume the world (P)"><span class="ic">⏸</span>Pause</button>
        <div id="speed-controls">
          <button data-speed="0.25" class="speed-btn">0.25x</button>
          <button data-speed="0.5" class="speed-btn">0.5x</button>
          <button data-speed="1" class="speed-btn">1x</button>
          <button data-speed="2" class="speed-btn">2x</button>
          <button data-speed="4" class="speed-btn">4x</button>
        </div>
        <button id="btn-new-dungeon" title="Generate a fresh dungeon"><span class="ic">↻</span>New Dungeon</button>
        <button id="btn-compendium" title="Open the D&D compendium"><span class="ic" style="color:${T.arcane};">📖</span>Grimoire</button>
        <button id="btn-save" title="Save the run to this browser"><span class="ic" style="color:${T.coin};">💾</span>Save</button>
        <button id="btn-audio" title="Sound settings (M mutes)"><span class="ic">🔊</span>Sound</button>
        <button id="btn-dm-panel" title="Issue orders to the party"><span class="ic" style="color:${T.good};">\u2328</span>DM</button>
        <button id="btn-town" title="Open the town (quests & market)"><span class="ic" style="color:${T.gold};">🏪</span>Town</button>
        <button id="btn-menu" title="Save and return to the main menu" class="dp-btn-bad"><span class="ic">☰</span>Menu</button>
      </div>
      <div id="audio-pop" style="display:none;">
        <div class="ap-head"><span>Sound</span><button id="btn-mute" class="dp-btn" style="padding:2px 9px; font-size:10px;">Mute</button></div>
        <div class="ap-row"><label for="vol-master">Master</label><input id="vol-master" type="range" min="0" max="100" data-bus="master"><span class="ap-val"></span></div>
        <div class="ap-row"><label for="vol-sfx">Effects</label><input id="vol-sfx" type="range" min="0" max="100" data-bus="sfx"><span class="ap-val"></span></div>
        <div class="ap-row"><label for="vol-music">Music</label><input id="vol-music" type="range" min="0" max="100" data-bus="music"><span class="ap-val"></span></div>
        <div class="ap-rule"></div>
        <div class="ap-row"><label>Renderer</label><div class="ap-seg" id="renderer-pick">
          <button data-renderer="pixi" title="WebGL with lighting, weather and colour grading">Pixi</button>
          <button data-renderer="phaser" title="WebGL through Phaser, with the same mood in broader strokes">Phaser</button>
          <button data-renderer="canvas" title="Plain 2D canvas: the fallback that runs anywhere">Canvas</button>
        </div></div>
        <div class="ap-note">Switches at once; the choice is remembered.</div>
        <div class="ap-row" id="update-row" style="display:none;"><label>Update</label><span id="update-text" style="flex:1; color:${T.warn};"></span><button id="btn-update" class="dp-btn dp-btn-gold" style="padding:2px 9px; font-size:10px;">Get it</button></div>
      </div>

      <!-- Top strip: dungeon title + quest tracker, pinned on their own row below the
           controls so the title can never run underneath the buttons. Both truncate
           with ellipsis when the window is narrow. -->
      <div id="top-strip" style="position:absolute; top:44px; left:10px; right:10px; display:flex; align-items:center; gap:8px; z-index:25; pointer-events:none;">
        <div id="dungeon-title" class="dp-title" style="font-size:17px; font-weight:bold; color:${T.gold}; text-shadow:0 1px 0 rgba(0,0,0,0.9), 0 0 12px rgba(232,197,106,0.35); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:0 1 auto; min-width:104px;">
          Fatefall
        </div>
        <div id="quest-bar" class="dp-chip dp-chip-trunc" style="display:none; flex:1 1 auto; min-width:0; box-shadow:0 2px 10px rgba(0,0,0,0.5); overflow:hidden; text-overflow:ellipsis;"></div>
        <div id="weather-chip" class="dp-chip dp-chip-trunc" style="display:none; flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;"></div>
        <div id="error-banner" role="alert" style="display:none; position:absolute; top:34px; left:0; right:0; margin:0 auto; max-width:720px; background:rgba(56,14,12,0.96); border:1px solid #a4574c; border-radius:${T.r2}; padding:8px 12px; font-size:12px; color:#f4c6c6; box-shadow:0 4px 18px rgba(0,0,0,0.6); pointer-events:auto; white-space:normal;"></div>
        <div id="delve-mood-chip" class="dp-chip dp-chip-trunc" style="display:none; flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; border-color:#5a4468; color:#e0c8f0; box-shadow:0 0 10px rgba(150,80,200,0.18);"></div>
      </div>

      <!-- DM command bar -->
      <div id="dm-bar" style="display:none; position:absolute; left:0; right:0; bottom:200px; z-index:30;">
        <div style="display:flex; gap:8px; padding:7px 10px; background:linear-gradient(180deg, rgba(30,25,17,0.97), rgba(16,13,9,0.97)); border-top:1px solid ${T.goldDim}; border-bottom:1px solid ${T.line}; box-shadow:0 -2px 14px rgba(0,0,0,0.45);">
          <span class="dp-title" style="align-self:center; color:${T.gold}; font-size:12px; letter-spacing:2px; text-shadow:0 0 10px rgba(232,197,106,0.4);">DM \u276f</span>
          <span id="dm-model-chip" class="dp-chip dp-chip-sm" title="How the party reads your orders. Click to switch between the trained model and the written orders."
                style="align-self:center; cursor:pointer; user-select:none;"></span>
          <input id="dm-input" type="text" autocomplete="off"
                 placeholder='Order the party\u2026 try "go north", "attack", "flee", "rest", "camp", "descend", "summon owlbear", "report", "help"'
                 style="flex:1; min-width:0; padding:6px 9px; font-size:12px;" />
          <button id="dm-send" class="dp-btn-gold" style="padding:6px 16px; font-size:12px;">Send</button>
        </div>
      </div>
    `;
  }

  private bindEvents() {
    // Speed buttons
    this.speedBtns.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.getAttribute('data-speed')!) as GameSpeed;
        this.setSpeed(speed);
      });
    });

    // Pause
    this.overlay.querySelector('#btn-pause')!.addEventListener('click', () => {
      this.togglePause();
    });

    // New dungeon
    this.overlay.querySelector('#btn-new-dungeon')!.addEventListener('click', () => {
      this.onNewDungeon?.();
    });

    this.overlay.querySelector('#btn-compendium')!.addEventListener('click', () => {
      this.compendium.toggle();
    });

    // Save the run
    this.overlay.querySelector('#btn-save')!.addEventListener('click', () => {
      this.onSave?.();
    });

    // Sound: the toolbar speaker and the M key both toggle the one engine,
    // and the speaker shows the state. The key ignores anything typed into a
    // field, since "m" is a letter the DM uses.
    const audioBtn = this.overlay.querySelector('#btn-audio') as HTMLButtonElement;
    const audioPop = this.overlay.querySelector('#audio-pop') as HTMLElement;
    const muteBtn = audioPop.querySelector('#btn-mute') as HTMLButtonElement;
    const sliders = Array.from(audioPop.querySelectorAll('input[type=range]')) as HTMLInputElement[];
    const audio = getAudio();
    const showAudio = () => {
      const ic = audioBtn.querySelector('.ic') as HTMLElement | null;
      if (ic) ic.textContent = audio.muted ? '🔇' : '🔊';
      audioBtn.classList.toggle('dp-btn-bad', audio.muted);
      muteBtn.textContent = audio.muted ? 'Unmute' : 'Mute';
      muteBtn.classList.toggle('dp-btn-bad', audio.muted);
      const levels = { master: audio.masterVolume, sfx: audio.sfxVolume, music: audio.musicVolume };
      for (const sl of sliders) {
        const bus = sl.dataset.bus as keyof typeof levels;
        const pct = Math.round(levels[bus] * 100);
        if (document.activeElement !== sl) sl.value = String(pct);
        const val = sl.parentElement?.querySelector('.ap-val');
        if (val) val.textContent = `${pct}%`;
      }
    };
    audioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = audioPop.style.display !== 'none';
      audioPop.style.display = open ? 'none' : 'block';
      sfx.click();
    });
    audioPop.addEventListener('pointerdown', (e) => e.stopPropagation());
    // Anywhere else closes the drawer.
    window.addEventListener('pointerdown', () => { audioPop.style.display = 'none'; });
    muteBtn.addEventListener('click', () => { audio.toggleMuted(); sfx.click(); });
    for (const sl of sliders) {
      sl.addEventListener('input', () => {
        audio.setVolumes({ [sl.dataset.bus as 'master' | 'sfx' | 'music']: Number(sl.value) / 100 });
      });
      // A blip on release, so the effects level can be judged by ear.
      sl.addEventListener('change', () => sfx.click());
    }
    audio.onChange(showAudio);
    showAudio();

    // Renderer: three buttons, the current one lit. The game does the switch;
    // the drawer only remembers which is meant to be lit until it reports.
    const pick = audioPop.querySelector('#renderer-pick') as HTMLElement;
    const showRenderer = () => {
      let current = 'pixi';
      try { current = localStorage.getItem('fatefall.renderer') ?? 'pixi'; } catch { /* default */ }
      for (const b of Array.from(pick.querySelectorAll('button'))) b.classList.toggle('on', b.dataset.renderer === current);
    };
    for (const b of Array.from(pick.querySelectorAll('button'))) {
      b.addEventListener('click', () => {
        const id = b.dataset.renderer as 'pixi' | 'phaser' | 'canvas';
        sfx.click();
        this.onRendererChange?.(id);
        // Optimistic: the game writes the preference once the switch succeeds,
        // and the next open of the drawer reads it back.
        for (const o of Array.from(pick.querySelectorAll('button'))) o.classList.toggle('on', o === b);
      });
    }
    showRenderer();
    audioBtn.addEventListener('click', showRenderer);

    // Update line: filled in when the drawer opens, since the shell's result is
    // attached after the HUD is built.
    const updateRow = audioPop.querySelector('#update-row') as HTMLElement;
    const showUpdate = () => {
      const u = this.updateAvailable;
      updateRow.style.display = u ? 'flex' : 'none';
      if (u) (updateRow.querySelector('#update-text') as HTMLElement).textContent = `Fatefall ${u.version} is out`;
    };
    updateRow.querySelector('#btn-update')!.addEventListener('click', () => { sfx.click(); this.updateAvailable?.open(); });
    audioBtn.addEventListener('click', showUpdate);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      audio.toggleMuted();
      sfx.click();
    });
    // Every toolbar button answers the hand.
    for (const b of Array.from(this.overlay.querySelectorAll('#hud-top button'))) {
      if (b.id === 'btn-audio') continue;
      b.addEventListener('click', () => sfx.click());
    }

    // DM command bar
    this.overlay.querySelector('#btn-dm-panel')!.addEventListener('click', () => {
      this.toggleDMPanel();
    });

    // Town panel
    this.overlay.querySelector('#btn-town')!.addEventListener('click', () => {
      this.onTownOpen?.();
    });

    // Back to the main menu (the run is saved first by the game)
    this.overlay.querySelector('#btn-menu')!.addEventListener('click', () => {
      this.onMainMenu?.();
    });
    const dmInput = this.overlay.querySelector('#dm-input') as HTMLInputElement;
    this.overlay.querySelector('#dm-send')!.addEventListener('click', () => this.sendDMCommand(dmInput));
    this.overlay.querySelector('#dm-model-chip')!.addEventListener('click', () => this.onModelToggle?.());
    dmInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') this.sendDMCommand(dmInput);
    });
  }

  /**
   * Paint the party rail.
   *
   * Two lines per hero and no more: name + hit points on the first, class and
   * a health bar on the second. Four heroes and the purse then fit the 200px
   * band without scrolling, which is the whole job of this rail — a glance
   * has to answer "who is hurt?" without a wheel.
   */
  setParty(party: Party) {
    this.liveParty = party;
    const members = party.members;
    let html = '';
    for (const m of members) {
      const frac = Math.max(0, Math.min(1, m.hp / Math.max(1, m.maxHp)));
      const bar = hpColor(frac);
      const accent = classColor(m.charClass.id);
      const isSel = m.id === this.selectedChar?.id;
      const down = m.hp <= 0;
      html += `
        <div class="party-member${isSel ? ' sel' : ''}${down ? ' down' : ''}" data-id="${m.id}">
          <div style="width:3px; align-self:stretch; border-radius:2px; background:${accent}; opacity:${down ? 0.35 : 0.9}; flex:0 0 auto;"></div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:baseline; gap:6px;">
              <span style="color:${accent}; font-weight:bold; font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1 1 auto; min-width:0; ${down ? 'opacity:0.6;' : ''}">${m.name}</span>
              <span class="dp-num" style="font-size:9.5px; color:${bar}; flex:0 0 auto;">${Math.max(0, m.hp)}<span style="color:${T.faint};">/${m.maxHp}</span></span>
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
              <span style="font-size:9px; color:${T.muted}; flex:0 0 auto;">Lv${m.level} ${m.charClass.name}</span>
              ${this.slotPips(m)}
              <div style="flex:1 1 auto; min-width:22px; height:4px; background:rgba(0,0,0,0.5); border:1px solid ${T.line}; border-radius:3px; overflow:hidden;">
                <div style="width:${frac * 100}%; height:100%; background:linear-gradient(90deg, ${bar}, ${bar}bb); transition:width .25s;"></div>
              </div>
            </div>
            ${this.conditionChips(m)}
          </div>
        </div>`;
    }
    this.refreshQuestBar();
    this.partyEl.innerHTML = html;
    this.partyFootEl.innerHTML =
      `<span style="color:${T.muted};">${this.dungeonLevel > 0 ? `Dungeon Lv ${this.dungeonLevel}` : 'The Surface World'}</span>`
      + `<span class="dp-num" style="color:${T.coin};">💰 ${party.members.reduce((s, m) => s + m.gold, 0)} gp</span>`;

    // Click handlers
    this.partyEl.querySelectorAll('.party-member').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id')!;
        const member = members.find(m => m.id === id);
        if (member) this.showCharSheet(member);
      });
    });

    // Keep the compendium's live sections (spell slots + Known Foes) in sync.
    this.compendium.refreshLive();
  }

  /** Refresh the pinned quest bar at the top of the screen. Hidden when idle. */
  private refreshQuestBar(): void {
    const q = this.questProvider();
    if (!q || q.turnedIn) {
      this.questBarEl.style.display = 'none';
      this.questBarEl.innerHTML = '';
      return;
    }
    const state = this.questStateProvider();
    const progress = q.completed ? '\u2714 Complete \u2014 return to town to report' : questProgressText(q, state);
    const accent = q.completed ? T.gold : T.info;
    const border = q.completed ? T.goldDim : T.line;
    this.questBarEl.style.display = 'inline-block';
    this.questBarEl.style.borderColor = border;
    this.questBarEl.innerHTML =
      `<span style="color:${accent}; font-weight:bold;">\ud83d\udcdc ${q.title}</span>` +
      `<span style="color:${T.muted}; margin-left:10px;">${progress}</span>` +
      `<span style="color:${T.faint}; margin-left:10px;">${q.rewardGold} gp \u00b7 ${q.rewardXp} XP</span>`;
  }

  /** Render live boss bars (HP + legendary action pips) above the combat log. */
  setBosses(bosses: { name: string; hp: number; maxHp: number; legendary: number }[]) {
    if (bosses.length === 0) {
      this.bossBarEl.style.display = 'none';
      this.bossBarEl.innerHTML = '';
      return;
    }
    this.bossBarEl.style.display = 'block';
    this.bossBarEl.innerHTML = bosses.map(b => {
      const pct = Math.max(0, Math.min(100, Math.round((b.hp / b.maxHp) * 100)));
      const pips = '\u26A1'.repeat(Math.max(0, Math.min(3, b.legendary))).padEnd(3, '\u00B7');
      return `
        <div style="margin-bottom:4px;">
          <div style="display:flex; justify-content:space-between; font-size:11px; color:${T.gold};">
            <span class="dp-title" style="letter-spacing:1px;">\uD83D\uDC51 ${b.name}</span>
            <span class="dp-num">${b.hp}/${b.maxHp} ${pips}</span>
          </div>
          <div style="height:6px; margin-top:2px; background:rgba(0,0,0,0.55); border:1px solid ${T.line}; border-radius:3px; overflow:hidden;">
            <div style="height:100%; width:${pct}%; background:linear-gradient(90deg,#8e2f2b,#d2564a); transition:width 0.3s;"></div>
          </div>
        </div>`;
    }).join('');
  }

  private showCharSheet(character: GameCharacter) {
    this.selectedChar = character;
    this.charSheetEl.style.display = 'block';

    const c = character;
    const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
    const abilsHtml = abilities.map(a => {
      const mod = c[a + 'Mod' as keyof GameCharacter] as number;
      const sign = mod >= 0 ? '+' : '';
      return `<div style="display:flex; justify-content:space-between; padding:1px 4px;">
        <span style="color:#888;">${a.toUpperCase()}</span>
        <span>${c.abilities[a]} (${sign}${mod})</span>
      </div>`;
    }).join('');

    const slotsHtml = c.maxSpellSlotsTotal > 0 ? `
      <div style="margin-top:6px; color:#88f; font-weight:bold;">Spell Slots${getCasterType(c.charClass.id) === 'pact' ? ' (Pact Magic)' : ''}:</div>
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].filter(lvl => (c.maxSpellSlots[lvl] || 0) > 0).map(lvl => {
        const max = c.maxSpellSlots[lvl] || 0;
        const rem = c.spellSlots[lvl] || 0;
        return `<div style="color:#aaf; font-size:10px; padding:1px 4px;">${ordinal(lvl)}: ${'\u25cf'.repeat(Math.max(0, rem))}${'\u25cb'.repeat(Math.max(0, max - rem))}</div>`;
      }).join('')}
    ` : '';

    const spellsHtml = c.knownSpells.length > 0 ? `
      <div style="margin-top:6px; color:#c8a; font-weight:bold;">Known Spells:</div>
      ${c.knownSpells.map(s => `<div style="color:#a8c; font-size:10px; padding:1px 4px;">• ${s.replace(/_/g, ' ')}</div>`).join('')}
    ` : '';

    const SLOT_LABELS: Record<string, string> = { weapon: '⚔', armor: '🛡', shield: '⛨', trinket: '💍' };
    const gearEntries = (['weapon', 'armor', 'shield', 'trinket'] as const)
      .map(s => ({ slot: s, item: c.equipment[s] }))
      .filter(e => e.item);
    const profTag = c.hasWeaponProficiencyPenalty
      ? ` <span style="color:#c66;">(not proficient with ${c.equipment.weapon!.name} — no prof bonus)</span>`
      : '';
    const gearHtml = gearEntries.length > 0 ? `
      <div style="margin-top:6px; color:#fd8; font-weight:bold;">Equipped (AC ${c.ac}, +${c.attackBonus} to hit):${profTag}</div>
      ${gearEntries.map(e => {
        const curse = e.item!.cursed ? ' <span style="color:#c44;">☠ cursed</span>' : '';
        return `<div style="color:#db8; font-size:10px; padding:1px 4px;">${SLOT_LABELS[e.slot]} ${e.item!.name}${e.item!.identified === false ? ' (???)' : ''}${curse}</div>`;
      }).join('')}
    ` : '';

    const invHtml = c.inventory.length > 0 ? `
      <div style="margin-top:6px; color:#ca8; font-weight:bold;">Inventory:</div>
      ${c.inventory.map(i => `<div style="color:#a98; font-size:10px; padding:1px 4px;">• ${i.identified === false ? '???' : i.name}</div>`).join('')}
    ` : '<div style="color:#555; font-size:10px; margin-top:4px;">Inventory empty</div>';

    const classColor = this.classColor(c.charClass.id);
    const hpPct = Math.max(0, Math.min(100, (c.hp / Math.max(1, c.maxHp)) * 100));
    const hpBarColor = hpPct > 50 ? '#5fbf7f' : hpPct > 25 ? '#d9a94a' : '#d06a5a';
    // Monogram badge: class initial on a parchment-plaque instead of art.
    const badge = `<div style="width:40px; height:40px; border-radius:8px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; background:linear-gradient(160deg, rgba(232,197,106,0.16), rgba(232,197,106,0.04)); border:1px solid ${classColor}; box-shadow:0 0 12px ${T.rule}; color:${classColor}; font-family:${T.titleFont}; font-size:22px;">${c.charClass.name.charAt(0)}</div>`;
    // Section divider with a gold hairline + small label.
    const sec = (label: string) => `<div style="margin-top:8px; margin-bottom:3px; padding-top:6px; border-top:1px solid ${T.rule}; color:${T.goldDim}; font-size:9px; font-weight:bold; letter-spacing:1.5px;">${label}</div>`;
    this.charSheetEl.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:6px;">
        ${badge}
        <div style="min-width:0;">
          <div style="color:${classColor}; font-family:${T.titleFont}; font-size:14px; font-weight:bold; line-height:1.1;">${c.name}</div>
          <div style="color:${T.muted}; font-size:10px; margin-top:2px;">Lv${c.level} ${c.race.name} ${c.charClass.name}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <div style="flex:1; height:7px; background:rgba(0,0,0,0.45); border:1px solid ${T.line}; border-radius:4px; overflow:hidden;">
          <div style="width:${hpPct}%; height:100%; background:linear-gradient(90deg, ${hpBarColor}, ${hpBarColor}cc); border-radius:4px; transition:width .25s;"></div>
        </div>
        <span style="color:${hpBarColor}; font-size:10px; font-variant-numeric:tabular-nums;">${c.hp}/${c.maxHp} HP</span>
      </div>
      ${c.hp <= 0 ? `<div style="color:#d06a5a; font-size:10px; margin-top:3px; font-weight:bold;">${c.isDead ? '☠ DEAD' : c.stabilized ? 'STABILIZED — stable at 0 HP' : 'DYING — making death saves'}</div>` : ''}
      ${c.isDying ? `<div style="color:#e0a094; font-size:9px; margin-top:2px;">Death saves: ${'◉'.repeat(Math.max(0, c.deathSaveSuccesses))}${'○'.repeat(Math.max(0, 3 - c.deathSaveSuccesses))} passed · ${'◉'.repeat(Math.max(0, c.deathSaveFailures))}${'○'.repeat(Math.max(0, 3 - c.deathSaveFailures))} failed</div>` : ''}
      ${c.exhaustion > 0 ? `<div style="color:#e8b45a; font-size:9px; margin-top:2px;">Exhaustion ${c.exhaustion}/6 — ${c.exhaustionLabel}</div>` : ''}
      <div style="color:${T.muted}; font-size:9px; margin-top:4px;">AC ${c.ac} · SPD ${c.effectiveSpeed}ft${c.effectiveSpeed !== c.speed ? ` (base ${c.speed})` : ''} · Prof +${c.profBonus}${getCasterType(c.charClass.id) !== 'none' ? ` · DC ${c.spellSaveDC}` : ''} · Hit Dice ${c.hitDiceRemaining}/${c.maxHitDice}</div>
      ${c.conditions.length > 0 || c.concentration ? `${sec('ACTIVE')}${this.conditionChips(c)}${c.conditions.length > 0 ? c.conditions.map(cond => {
        const meta = CONDITION_META[cond.id];
        return `<div style="color:${meta.color}; font-size:9px; padding:1px 4px;">• ${meta.label} — ${meta.effect}${cond.turnsLeft > 0 ? ` (${cond.turnsLeft} turn${cond.turnsLeft === 1 ? '' : 's'} left)` : ''}</div>`;
      }).join('') : ''}` : ''}
      ${sec('ATTRIBUTES')}
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1px 8px;">${abilsHtml}</div>
      ${sec('XP')}<div style="color:${T.muted}; font-size:9px; padding:1px 4px;">${c.xp} / ${c.xpToNext()}</div>
      ${slotsHtml}
      ${spellsHtml}
      ${gearHtml}
      ${invHtml}
      ${sec('COMBAT')}<div style="color:${T.muted}; font-size:9px; padding:1px 4px;">+${c.attackBonus} to hit · ${c.getWeaponDamageDie()}d damage</div>
      <div style="color:#6a7486; font-size:9px; margin-top:6px; font-style:italic;">${c.charClass.description.substring(0, 84)}…</div>
    `;
  }

  /** Glyphs the game already prefixes its lines with, and the tone each implies. */
  private static readonly GLYPH_TONE: Record<string, LogTone> = {
    '💰': 'loot', '🪙': 'loot', '🛒': 'loot', '⚖': 'loot', '🎒': 'loot', '🎥': 'loot',
    '📜': 'info', '📋': 'info', '📍': 'info', '📅': 'info', '🗺️': 'info', '🗺': 'info',
    '⬆': 'gold', '🏆': 'gold', '✦': 'gold', '⚔': 'gold', '⚔️': 'gold',
    '⚠': 'warn', '💀': 'harm', '☠': 'harm', '🔥': 'warn',
    '🎲': 'arcane', '⚡': 'arcane', '🌕': 'arcane', '🌑': 'arcane', '🌙': 'arcane',
    '🏕': 'good', '⛺': 'good', '🌤': 'good',
  };

  /**
   * Append one line to the narrative log.
   *
   * The game passes forty-odd different hexes into this from a hundred call
   * sites; left alone they make a wall of confetti. Every line is instead
   * resolved into a *kind* — order, speech, scene break, harm, loot, quiet
   * bookkeeping — and drawn on a two-column grid with the leading glyph
   * pulled out into a fixed gutter. The prose then starts at one column and
   * the eye can find things down the margin.
   *
   * Appending is a single `insertAdjacentHTML`; the old implementation
   * re-joined and re-parsed all 150 lines on every message, which the log
   * cannot afford when it runs all session.
   */
  addCombatMessage(msg: string, color: string = '#ccc') {
    this.combatMessages.push(msg);
    if (this.combatMessages.length > 400) this.combatMessages = this.combatMessages.slice(-200);
    this.logEl.insertAdjacentHTML('beforeend', this.renderLogLine(msg, color));
    this.logLineCount++;
    // Trim from the front so the log stays a fixed size all run.
    while (this.logLineCount > 150 && this.logEl.firstElementChild) {
      this.logEl.removeChild(this.logEl.firstElementChild);
      this.logLineCount--;
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Build the markup for one log line. Pure — also used by tests-by-eye. */
  private renderLogLine(msg: string, color: string): string {
    // Leading spaces mean "this hangs under the line above" (the game indents
    // task details and reward breakdowns). HTML collapses them, so they were
    // invisible; turn them into a real indent instead.
    const indentMatch = /^( +)/.exec(msg);
    const indent = indentMatch ? Math.min(2, Math.floor(indentMatch[1].length / 2)) : 0;
    let body = msg.slice(indentMatch ? indentMatch[1].length : 0);

    // A scene break: '--- Combat begins! Initiative rolled. ---'
    if (/^-{2,}/.test(body)) {
      const label = body.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
      return `<div class="dp-log-line dp-log-break"><span class="dp-log-body">${label}</span></div>`;
    }

    // Pull a leading glyph out into the gutter. Emoji, dingbats and the DM's
    // own '❯' all qualify; a plain sentence gets an empty gutter.
    let glyph = '';
    const glyphMatch = /^([←-⯿\u{1F000}-\u{1FAFF}\u{FE0F}]+)\s*/u.exec(body);
    if (glyphMatch) {
      glyph = glyphMatch[1];
      body = body.slice(glyphMatch[0].length);
    }

    const classes = ['dp-log-line'];
    if (indent === 1) classes.push('dp-log-sub');
    if (indent >= 2) classes.push('dp-log-sub2');

    let tone: LogTone | null = null;
    if (glyph === '❯') {
      // The DM's own order, echoed back into the log.
      classes.push('dp-log-order');
    } else if (/^[“"'‘]/.test(body) && /[”"'’]\s*$/.test(body)) {
      // Somebody is speaking. Prose, not telemetry.
      classes.push('dp-log-speech');
    } else {
      tone = (glyph && HUD.GLYPH_TONE[glyph]) || toneForColor(color);
      classes.push(`dp-log-${tone}`);
    }

    return `<div class="${classes.join(' ')}">`
      + `<span class="dp-log-glyph">${glyph}</span>`
      + `<span class="dp-log-body">${body}</span></div>`;
  }

  addCombatLogBatch(log: CombatLog) {
    for (const msg of log.messages) {
      let color = '#ccc';
      if (msg.includes('CRIT')) color = '#ffd700';
      else if (msg.includes('casts')) color = '#a8f';
      else if (msg.includes('heals')) color = '#8a8';
      else if (msg.includes('misses')) color = '#888';
      else if (msg.includes('slain') || msg.includes('fallen')) color = '#c44';
      else if (msg.includes('Victory')) color = '#ffd700';
      else if (msg.includes('defeated')) color = '#c44';
      else if (msg.includes('Initiative') || msg.startsWith('---')) color = '#888';
      else if (msg.includes('hits') || msg.includes('damage')) color = '#c66';

      this.addCombatMessage(msg, color);
    }
  }

  /** Clear the combat log (used when a restored run takes over the screen). */
  resetLog() {
    this.combatMessages = [];
    this.logLineCount = 0;
    this.logEl.innerHTML = '';
  }

  setDungeonLevel(level: number) {
    this.dungeonLevel = level;
  }

  setDungeonTitle(name: string) {
    const el = this.overlay.querySelector('#dungeon-title') as HTMLElement | null;
    if (!el) return;
    el.textContent = name;
    el.title = name; // the strip truncates on narrow windows
  }

  /** Show the live overworld weather with its mechanical effects, or hide it underground. */
  setWeatherChip(state: { icon: string; label: string; effects: string[] } | null) {
    const el = this.overlay.querySelector('#weather-chip') as HTMLElement | null;
    if (!el) return;
    if (!state) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'flex';
    el.textContent = state.effects.length
      ? `${state.icon} ${state.label} \u2014 ${state.effects.join(', ')}`
      : `${state.icon} ${state.label}`;
    el.title = el.textContent; // the strip truncates it when crowded
    const tint = { rain: '#9fb8d8', heavy_rain: '#7e9cc8', fog: '#bfcfe0',
      snow: '#eef2fb', sandstorm: '#e0c180', magical_aurora: '#d0a0f0',
      eerie_mist: '#9ad4a8', blood_red_sky: '#f09078' } as Record<string, string>;
    el.style.color = tint[state.label] ?? '#cfe0f2';
  }

  /** Show the active delve mood while underground, with its mechanical effects. */
  setDelveMoodChip(state: { icon: string; label: string; effects: string[] } | null) {
    const el = this.overlay.querySelector('#delve-mood-chip') as HTMLElement | null;
    if (!el) return;
    if (!state) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'flex';
    el.textContent = state.effects.length
      ? `${state.icon} Delve: ${state.label} \u2014 ${state.effects.join(', ')}`
      : `${state.icon} Delve: ${state.label}`;
    el.title = el.textContent; // the strip truncates it when crowded
  }

  /** Full-screen start overlay: pick a save slot, then continue or begin fresh. */
  showStartScreen(saves: (SaveData | null)[], preselectedSlot?: number) {
    const firstFilled = saves.findIndex(s => s !== null);
    this.selectedSlot = preselectedSlot !== undefined && preselectedSlot >= 0 && preselectedSlot < saves.length
      ? preselectedSlot
      : firstFilled >= 0 ? firstFilled : 0;
    this.confirmNewSlot = false;
    this.confirmErase = false;

    const screen = document.createElement('div');
    screen.id = 'start-screen';
    // A centered column: the tumbling die sits in flow ABOVE the logo, then
    // the choices. The die is a sibling of #start-content so slot re-renders
    // never wipe it.
    screen.style.cssText = `position:absolute; inset:0; z-index:100; background:radial-gradient(ellipse at 50% 30%, #14100c 0%, #0a0808 55%, #050405 100%); display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:${T.bodyFont};`;
    this.overlay.appendChild(screen);

    // Decorative tumbling d20 behind the choices (sibling of the content
    // wrapper so slot re-renders never wipe it).
    screen.appendChild(this.createDecorativeDie());
    this.renderStartContent(screen, saves);

    // Event delegation: slot cards and action buttons re-render in place.
    screen.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const slotBtn = target.closest('[data-slot]') as HTMLElement | null;
      if (slotBtn) {
        this.selectedSlot = parseInt(slotBtn.getAttribute('data-slot')!, 10);
        this.confirmNewSlot = false;
        this.confirmErase = false;
        this.renderStartContent(screen, saves);
        return;
      }

      const actionBtn = target.closest('[data-action]') as HTMLElement | null;
      if (!actionBtn) return;
      const action = actionBtn.getAttribute('data-action')!;
      if (action === 'continue') {
        this.onStartChoice?.('continue', this.selectedSlot);
      } else if (action === 'new') {
        if (saves[this.selectedSlot]) {
          this.confirmNewSlot = true;
          this.renderStartContent(screen, saves);
        } else {
          this.onStartChoice?.('new', this.selectedSlot);
        }
      } else if (action === 'confirm-new') {
        this.onStartChoice?.('new', this.selectedSlot);
      } else if (action === 'erase') {
        this.confirmErase = true;
        this.confirmNewSlot = false;
        this.renderStartContent(screen, saves);
      } else if (action === 'confirm-erase') {
        clearSlot(this.selectedSlot);
        const updated = listSaves();
        saves.length = 0;
        saves.push(...updated);
        this.confirmErase = false;
        this.renderStartContent(screen, saves);
      } else if (action === 'cancel') {
        this.confirmNewSlot = false;
        this.confirmErase = false;
        this.renderStartContent(screen, saves);
      }
    });
  }

  /** Re-render just the choice panel so the decorative die keeps tumbling. */
  private renderStartContent(screen: HTMLElement, saves: (SaveData | null)[]) {
    screen.querySelector('#start-content')?.remove();
    const content = document.createElement('div');
    content.id = 'start-content';
    content.style.cssText = 'position:relative; z-index:2;';
    content.innerHTML = this.startScreenHtml(saves, this.selectedSlot, this.confirmNewSlot);
    screen.appendChild(content);
  }

  /** A d20 that tumbles forever above the start-screen logo. */
  private createDecorativeDie(): HTMLElement {
    const wrap = document.createElement('div');
    // A sized flow element in the centered column; the 3D die is built around
    // this box's center, so it floats directly above the title. NO filter or
    // drop-shadow anywhere on this chain: applying filter to the wrapper
    // smears a big soft shadow across the whole preserve-3d projection (the
    // "weird circular glow" around the old die). The die's own faces already
    // carry per-face lighting, so a billboard drop-shadow is pure mud.
    // margin-bottom gives the pool + shadow room to sit below the die without
    // crowding the title; the centered column re-centers itself, so the die
    // rises a touch and the title drops, opening space for the table-top.
    wrap.style.cssText = 'position:relative; width:140px; height:130px; margin-bottom:92px; z-index:1; pointer-events:none; perspective:760px; display:flex; align-items:center; justify-content:center;';
    wrap.style.transform = 'scale(2)';

    // A warm table-top pool behind the die: the cast shadow needs a surface
    // to fall on, and the near-black menu background swallowed it. This soft
    // ellipse of candlelight is centered on the die, so the die sits in the
    // pool and the dark cast shadow reads against it. DOM order (backdrop →
    // shadow → scene) keeps it behind everything.
    const backdrop = document.createElement('div');
    // A warm table-top pool spanning the die's body down through the cast
    // shadow, bright focus just below the die's center so the dark shadow
    // reads against it. Stays clear of the title below.
    backdrop.style.cssText = 'position:absolute; left:50%; top:8px; transform:translateX(-50%); width:260px; height:129px; border-radius:50%; background:radial-gradient(ellipse at 50% 62%, rgba(150,112,62,0.34) 0%, rgba(130,96,56,0.28) 30%, rgba(118,88,50,0.22) 55%, rgba(100,74,44,0.15) 72%, rgba(60,45,28,0.06) 88%, rgba(0,0,0,0) 100%);';
    wrap.appendChild(backdrop);

    // Grounded cast shadow: a soft ellipse sitting just below the die, so it
    // reads as resting on the menu rather than surrounded by a blur halo.
    const shadow = document.createElement('div');
    shadow.style.cssText = 'position:absolute; left:50%; bottom:6px; width:74px; height:18px; transform:translateX(-50%); border-radius:50%; background:radial-gradient(ellipse at center, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.18) 55%, transparent 75%);';
    wrap.appendChild(shadow);

    const faces = buildDiceModel('d20');
    const scene = buildDieScene(faces, '#c33', '50%', '50%');
    wrap.appendChild(scene);

    const start = performance.now();
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      // A slow precessing axis with a wobble: reads as a die tumbling forever.
      const axis = normalize3([Math.sin(t * 0.6) * 0.8, Math.cos(t * 0.43) * 0.8, 0.45 + Math.sin(t * 0.9) * 0.25]);
      const q = quatFromAxisAngle(axis, t * 1.1);
      scene.style.transform = quatToMatrix3d(q);
      // Squeeze the cast shadow as the die lists — tighter when it leans in,
      // fatter when upright, so the shadow feels coupled to the tumble. The
      // lean tracks the axis's y-tilt (cos, the same term that drives the
      // precession) — a sin-based phase here made the shadow widen exactly
      // when the die leaned, the wrong way around.
      const lean = Math.abs(Math.cos(t * 0.43) * 0.8);
      shadow.style.width = `${74 - lean * 14}px`;
      shadow.style.opacity = String(0.5 + (1 - lean) * 0.35);
      this.startDieFrame = requestAnimationFrame(frame);
    };
    this.startDieFrame = requestAnimationFrame(frame);
    return wrap;
  }

  hideStartScreen() {
    if (this.startDieFrame !== undefined) {
      cancelAnimationFrame(this.startDieFrame);
      this.startDieFrame = undefined;
    }
    this.overlay.querySelector('#start-screen')?.remove();
  }

  /** Render a saved run's in-world date for the start screen, from its clock. */
  private calendarShortDate(elapsedMs: number): string {
    try {
      const c = calendarFromElapsed(elapsedMs);
      const moon = c.moonPhase.replace(/_/g, ' ');
      const tags = [c.isMarketday && 'market day', c.isSacredDay && 'temple day', c.isGloomDay && 'gloom day']
        .filter(Boolean).join(', ');
      return `\ud83d\udcc5 ${c.weekday}\u00b7${c.dayInMoon + 1}/10 \u00b7 ${moon} moon${tags ? ` \u00b7 ${tags}` : ''}`;
    } catch {
      return '';
    }
  }

  private startScreenHtml(saves: (SaveData | null)[], selected: number, confirming: boolean): string {
    const title = `
      <div class="dp-title" style="font-size:34px; font-weight:bold; color:${T.gold}; text-shadow:0 0 14px rgba(232,197,106,0.5), 0 0 44px rgba(255,120,40,0.22); letter-spacing:10px;">\u2694 FATEFALL</div>
      <div style="color:${T.muted}; font-size:13.5px; line-height:1.6; margin-top:12px; font-style:italic;">An autonomous party of adventurers roams a living world of dice, dungeons, and fate.<br>Pick a save slot below \u2014 each holds one run, saved automatically.</div>`;

    const slotCards = saves.map((save, i) => {
      const isSelected = i === selected;
      const cardStyle = `flex:1; min-width:170px; padding:12px 14px; cursor:pointer; text-align:left; background:${isSelected ? 'rgba(232,197,106,0.07)' : T.row}; border:1px solid ${isSelected ? T.gold : T.line}; border-radius:${T.r3}; box-shadow:${isSelected ? '0 0 16px rgba(232,197,106,0.2), inset 0 0 20px rgba(232,197,106,0.04)' : 'none'}; transition:border-color .15s ease, box-shadow .15s ease;`;
      const body = save ? (() => {
        const inDungeon = (save.mode ?? 2) === 2;
        const partyLabel = save.partyName && save.partyName !== 'The Unnamed Party' ? save.partyName : '';
        const locationName = inDungeon
          ? save.dungeonName
          : (save.mode ?? 2) === 1 ? 'The Wilderlands \u2014 in town' : 'The Wilderlands \u2014 on the road';
        const locationLine = inDungeon
          ? `Level ${save.dungeonLevel}`
          : 'The Surface World';
        return `
        ${partyLabel ? `<div class="dp-title" style="color:${T.gold}; font-size:12px; font-weight:bold; margin-top:3px; letter-spacing:0.5px;">${partyLabel}</div>` : ''}
        <div style="color:${T.text}; font-size:12px; font-weight:bold; margin-top:3px;">${locationName}</div>
        <div style="color:${T.faint}; font-size:10px; margin-top:2px;">${locationLine} \u00b7 ${new Date(save.savedAt).toLocaleDateString()} ${new Date(save.savedAt).toLocaleTimeString()}</div>
        ${(typeof (save as any).clockElapsed === 'number')
          ? `<div style="color:${T.info}; font-size:10px; margin-top:2px;">${this.calendarShortDate((save as any).clockElapsed)}</div>`
          : ''}
        ${(save.expeditionJournal && save.expeditionJournal.length > 0)
          ? `<div style="color:${T.muted}; font-size:10px; margin-top:5px; font-style:italic; border-left:2px solid ${T.rule}; padding-left:7px;">\u2018${save.expeditionJournal[save.expeditionJournal.length - 1]}\u2019</div>`
          : ''}
        <div style="margin-top:6px;">
          ${save.party.members.map(m => {
            const cls = m.classId.charAt(0).toUpperCase() + m.classId.slice(1);
            const maxHp = m.exhaustion >= 4 ? Math.floor(m.baseMaxHp / 2) : m.baseMaxHp;
            const hpTint = hpColor(m.hp / Math.max(1, maxHp));
            const state = m.hp <= 0 ? (m.isDead ? ' DEAD' : m.stabilized ? ' STAB' : ' DYING') : '';
            return `<div style="display:flex; gap:6px; font-size:10.5px; padding:1.5px 0;"><span style="color:${classColor(m.classId)}; flex:0 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${m.name}</span><span style="color:${hpTint};">${state}</span><span style="color:${T.faint}; flex:1 1 auto;">Lv${m.level} ${cls}</span><span class="dp-num" style="color:${hpTint};">${m.hp}/${maxHp}</span></div>`;
          }).join('')}
        </div>`;
      })() : `<div style="color:${T.faint}; font-size:12px; margin-top:14px; font-style:italic;">Empty</div>`;

      return `<button data-slot="${i}" class="dp-slot-btn" style="${cardStyle}">
        <div class="dp-label">Slot ${i + 1}</div>
        ${body}
      </button>`;
    }).join('');

    let buttons: string;
    if (this.confirmErase) {
      buttons = `
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px; align-items:center;">
          <span style="color:#ef8272; font-size:12px; font-weight:bold;">\u26a0 Permanently erase Slot ${selected + 1}? This cannot be undone!</span>
          <button data-action="confirm-erase" class="dp-btn dp-btn-bad dp-title" style="padding:9px 20px; font-size:13px; font-weight:bold; letter-spacing:1px;">\u2716 Erase Forever</button>
          <button data-action="cancel" class="dp-btn dp-title" style="padding:9px 20px; font-size:13px; letter-spacing:1px;">Cancel</button>
        </div>`;
    } else if (confirming) {
      buttons = `
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px; align-items:center;">
          <span style="color:${T.muted}; font-size:12px;">Starting fresh in Slot ${selected + 1} erases the run saved there.</span>
          <button data-action="confirm-new" class="dp-btn dp-btn-bad dp-title" style="padding:9px 20px; font-size:13px; font-weight:bold; letter-spacing:1px;">Erase & New Run</button>
          <button data-action="cancel" class="dp-btn dp-title" style="padding:9px 20px; font-size:13px; letter-spacing:1px;">Cancel</button>
        </div>`;
    } else if (saves[selected]) {
      buttons = `
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px;">
          <button data-action="continue" class="dp-btn-gold dp-slot-btn dp-title" style="padding:10px 26px; font-size:14px; font-weight:bold; letter-spacing:1.5px; border-radius:${T.r2}; box-shadow:0 0 16px rgba(232,197,106,0.22);">\u25b6 Continue Slot ${selected + 1}</button>
          <button data-action="new" class="dp-btn dp-slot-btn dp-title" style="padding:10px 26px; font-size:14px; font-weight:bold; letter-spacing:1.5px; border-radius:${T.r2};">\u2726 New Run</button>
          <button data-action="erase" class="dp-btn dp-btn-bad dp-slot-btn dp-title" style="padding:10px 26px; font-size:14px; font-weight:bold; letter-spacing:1.5px; border-radius:${T.r2};">\u2716 Erase</button>
        </div>`;
    } else {
      buttons = `
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px;">
          <button data-action="new" class="dp-btn-gold dp-slot-btn dp-title" style="padding:10px 26px; font-size:14px; font-weight:bold; letter-spacing:1.5px; border-radius:${T.r2}; box-shadow:0 0 16px rgba(232,197,106,0.22);">\u2726 Start New Run in Slot ${selected + 1}</button>
        </div>`;
    }

    return `<div style="max-width:800px; width:94%; text-align:center;">${title}
      <div style="display:flex; gap:12px; margin-top:22px; justify-content:center;">${slotCards}</div>
      ${buttons}
    </div>`;
  }

  setSpeed(speed: GameSpeed) {
    this.speed = speed;
    this.speedBtns.querySelectorAll('.speed-btn').forEach(btn => {
      const s = parseFloat(btn.getAttribute('data-speed')!);
      const isActive = s === speed;
      (btn as HTMLElement).classList.toggle('speed-active', isActive);
    });
    this.onSpeedChange?.(speed);
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    const btn = this.overlay.querySelector('#btn-pause') as HTMLElement;
    btn.textContent = this.isPaused ? '▶ Play' : '⏸ Pause';
    this.onPauseToggle?.();
  }

  /** Called when the player clicks the DM understander chip. */
  public onModelToggle?: () => void;

  /**
   * Show how DM orders are being read: while the weights download, with the
   * trained model on, with it switched off, or when only the regex parser is
   * available because the weights could not be loaded.
   */
  setModelChip(state: 'loading' | 'model' | 'regex' | 'off') {
    const el = this.overlay.querySelector('#dm-model-chip') as HTMLElement | null;
    if (!el) return;
    const look: Record<typeof state, { label: string; color: string; border: string; title: string }> = {
      loading: { label: '◌ reading', color: '#8a9', border: '#3f5b4f', title: 'Loading the trained order-reader…' },
      model: { label: '◆ model', color: '#7fd88f', border: '#3f6b4f', title: 'Free-form orders go through the trained model. Click to switch it off.' },
      off: { label: '◇ by the book', color: '#c8b98a', border: '#6b5f3f', title: 'Only the written orders are understood. Click to switch the model on.' },
      regex: { label: '◇ by the book', color: '#a89', border: '#5b4f4f', title: 'The trained model could not load; the written orders still work.' },
    };
    const { label, color, border, title } = look[state];
    el.textContent = label;
    el.style.color = color;
    el.style.borderColor = border;
    el.title = title;
    el.style.cursor = state === 'loading' || state === 'regex' ? 'default' : 'pointer';
  }

  /** Sync the pause button to a pause the game decided on itself (no callback). */
  setPausedIndicator(paused: boolean) {
    this.isPaused = paused;
    const btn = this.overlay.querySelector('#btn-pause') as HTMLElement | null;
    if (btn) btn.textContent = paused ? '▶ Play' : '⏸ Pause';
  }

  /** A one-line red notice for when the game had to stop itself. */
  showErrorBanner(message: string) {
    const el = this.overlay.querySelector('#error-banner') as HTMLElement | null;
    if (!el) return;
    el.textContent = `⚠ ${message}`;
    el.style.display = 'block';
  }

  hideErrorBanner() {
    const el = this.overlay.querySelector('#error-banner') as HTMLElement | null;
    if (el) el.style.display = 'none';
  }

  get isGamePaused(): boolean {
    return this.isPaused;
  }

  /**
   * Remaining spell slots as inline pips ("●●○"), for the party rail.
   *
   * These used to be a full-width chip under each row, which pushed the
   * fourth party member off the bottom of a 200px rail. Inline beside the
   * class they cost nothing and sit where you'd look for them.
   */
  private slotPips(m: GameCharacter): string {
    if (getCasterType(m.charClass.id) === 'none' || m.maxSpellSlotsTotal <= 0) return '';
    const parts: { level: number; pips: string }[] = [];
    for (let lvl = 1; lvl <= 9; lvl++) {
      const max = m.maxSpellSlots[lvl] || 0;
      if (max <= 0) continue;
      const remaining = Math.max(0, Math.min(max, m.spellSlots[lvl] || 0));
      parts.push({ level: lvl, pips: '●'.repeat(remaining) + '○'.repeat(max - remaining) });
    }
    if (parts.length === 0) return '';
    const pact = getCasterType(m.charClass.id) === 'pact' ? '⚡' : '';
    const detail = `Spell slots — ${parts.map(p => `${ordinal(p.level)} ${p.pips}`).join(', ')}`;
    return `<span title="${detail}" style="font-size:8px; letter-spacing:0.5px; color:${T.info}; flex:0 0 auto; opacity:0.9;">${pact}${parts.map(p => p.pips).join(' ')}</span>`;
  }

  /** Render active conditions, concentration, and death saves as chips. */
  private conditionChips(m: GameCharacter): string {
    /** One chip shape everywhere: a pill, tinted by the thing it reports. */
    const chip = (color: string, label: string, bg = 'rgba(10,9,13,0.85)') =>
      `<span class="dp-chip dp-chip-sm" style="margin:2px 3px 0 0; color:${color}; border-color:${color}66; background:${bg};">${label}</span>`;
    const chips = m.conditions.map(c => {
      const meta = CONDITION_META[c.id];
      return chip(meta.color, meta.label);
    });
    if (m.concentration) {
      chips.push(chip(T.gold, `\u2726 ${m.concentration.spellName}`));
    }
    if (m.hp <= 0) {
      const label = m.isDead ? 'DEAD' : m.stabilized ? 'STABILIZED' : 'DYING ☠';
      chips.push(chip('#ef8272', label, 'rgba(60,16,12,0.9)'));
    }
    if (m.isDying) {
      chips.push(chip('#e8a99e', `Death saves ${m.deathSaveSuccesses}S/${m.deathSaveFailures}F`));
    }
    if (m.exhaustion > 0) {
      chips.push(chip(T.warn, `Exhaustion ${m.exhaustion}/6`, 'rgba(44,30,10,0.9)'));
    }
    return chips.length > 0 ? `<div style="margin-top:3px; line-height:1.5;">${chips.join('')}</div>` : '';
  }

  /** Toggle the DM command bar and focus its input when opening. */
  toggleDMPanel() {
    const bar = this.overlay.querySelector('#dm-bar') as HTMLElement;
    const opening = bar.style.display === 'none' || !bar.style.display;
    bar.style.display = opening ? 'block' : 'none';
    if (opening) {
      (bar.querySelector('#dm-input') as HTMLInputElement).focus();
    }
  }

  private sendDMCommand(input: HTMLInputElement) {
    const value = input.value;
    input.value = '';
    this.onDMCommand?.(value);
    input.focus();
  }

  /** Class accent, from the shared theme (all fourteen classes, not eight). */
  private classColor(classId: string): string {
    return classColor(classId);
  }
}
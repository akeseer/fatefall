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
import { buildDieScene, buildDiceModel, normalize3, quatFromAxisAngle, quatToMatrix3d } from './Dice3D';
import { TownPanel } from './TownPanel';
import { BattleView } from './BattleView';

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
  /** Called after an erase so the game can refresh the saves list. */
  public onEraseComplete?: () => void;

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

  constructor() {
    this.overlay = document.getElementById('ui-overlay')!;
    this.overlay.innerHTML = this.getTemplate();
    this.logEl = this.overlay.querySelector('#combat-log')!;
    this.bossBarEl = this.overlay.querySelector('#boss-bar')!;
    this.questBarEl = this.overlay.querySelector('#quest-bar')!;
    this.partyEl = this.overlay.querySelector('#party-status')!;
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
    this.bindEvents();
    // Battle end jingles ride the same audio engine as the dice.
    this.battleView.sounds = this.diceSounds;
  }

  private getTemplate(): string {
    return `
      <div style="position:absolute; bottom:0; left:0; right:0; height:200px; display:flex; flex-direction:row;">
        <!-- Party Status -->
        <div id="party-status" style="width:250px; background:rgba(10,10,20,0.92); color:#ccc; padding:8px; overflow-y:auto; font-family:monospace; font-size:11px; border-right:1px solid #333;">
        </div>

        <!-- Combat Log -->
        <div style="flex:1; background:rgba(10,10,20,0.92); color:#ccc; padding:8px; overflow-y:auto; font-family:monospace; font-size:11px;">
          <div id="boss-bar" style="display:none; margin-bottom:6px; padding-bottom:6px; border-bottom:1px solid #553;"></div>
          <div id="combat-log"></div>
        </div>

        <!-- Character Sheet (when selected) -->
        <div id="char-sheet" style="width:250px; background:rgba(10,10,20,0.92); color:#ccc; padding:8px; overflow-y:auto; font-family:monospace; font-size:11px; border-left:1px solid #333; display:none;">
        </div>
      </div>

      <!-- Top bar: controls -->
      <div style="position:absolute; top:10px; right:10px; display:flex; gap:8px; z-index:20;">
        <button id="btn-pause" style="padding:4px 12px; background:#333; color:#ccc; border:1px solid #555; cursor:pointer; font-family:monospace; font-size:12px;">⏸ Pause</button>
        <div id="speed-controls" style="display:flex; gap:4px;">
          <button data-speed="0.25" class="speed-btn" style="padding:4px 8px; background:#222; color:#888; border:1px solid #444; cursor:pointer; font-family:monospace; font-size:11px;">0.25x</button>
          <button data-speed="0.5" class="speed-btn" style="padding:4px 8px; background:#222; color:#888; border:1px solid #444; cursor:pointer; font-family:monospace; font-size:11px;">0.5x</button>
          <button data-speed="1" class="speed-btn" style="padding:4px 8px; background:#444; color:#fff; border:1px solid #666; cursor:pointer; font-family:monospace; font-size:11px;">1x</button>
          <button data-speed="2" class="speed-btn" style="padding:4px 8px; background:#222; color:#888; border:1px solid #444; cursor:pointer; font-family:monospace; font-size:11px;">2x</button>
          <button data-speed="4" class="speed-btn" style="padding:4px 8px; background:#222; color:#888; border:1px solid #444; cursor:pointer; font-family:monospace; font-size:11px;">4x</button>
        </div>
        <button id="btn-new-dungeon" style="padding:4px 12px; background:#432; color:#ca8; border:1px solid #654; cursor:pointer; font-family:monospace; font-size:12px;">↻ New Dungeon</button>
        <button id="btn-compendium" title="Open the D&D compendium" style="padding:4px 12px; background:#24233b; color:#c9b8ff; border:1px solid #5a4f89; cursor:pointer; font-family:monospace; font-size:12px;">📖 Grimoire</button>
        <button id="btn-save" title="Save the run to this browser" style="padding:4px 12px; background:#2b241f; color:#d6a88f; border:1px solid #6b4f3f; cursor:pointer; font-family:monospace; font-size:12px;">💾 Save</button>
        <button id="btn-dm-panel" title="Issue orders to the party" style="padding:4px 12px; background:#1f2b22; color:#8fd6a0; border:1px solid #3f6b4f; cursor:pointer; font-family:monospace; font-size:12px;">\u2328 DM</button>
        <button id="btn-town" title="Open the town (quests & market)" style="padding:4px 12px; background:#2b2420; color:#e0c060; border:1px solid #6b5a3f; cursor:pointer; font-family:monospace; font-size:12px;">🏪 Town</button>
        <button id="btn-menu" title="Save and return to the main menu" style="padding:4px 12px; background:#332c2c; color:#e0b0a8; border:1px solid #6b4a45; cursor:pointer; font-family:monospace; font-size:12px;">☰ Menu</button>
      </div>

      <!-- Top strip: dungeon title + quest tracker, pinned on their own row below the
           controls so the title can never run underneath the buttons. Both truncate
           with ellipsis when the window is narrow. -->
      <div id="top-strip" style="position:absolute; top:44px; left:10px; right:10px; display:flex; align-items:center; gap:12px; z-index:25; pointer-events:none;">
        <div id="dungeon-title" style="font-family:monospace; font-size:16px; font-weight:bold; color:#ffd700; text-shadow:0 0 8px rgba(255,200,0,0.5); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:0 1 auto; min-width:0;">
          Fatefall
        </div>
        <div id="quest-bar" style="display:none; flex:1 1 auto; min-width:0; background:rgba(8,12,24,0.88); border:1px solid #3a4a6a; border-radius:3px; padding:4px 10px; font-family:monospace; font-size:11px; box-shadow:0 2px 10px rgba(0,0,0,0.5); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></div>
        <div id="weather-chip" style="display:none; flex:0 0 auto; align-items:center; background:rgba(8,12,24,0.85); border:1px solid #4a5a6a; border-radius:3px; padding:4px 10px; font-family:monospace; font-size:11px; color:#cfe0f2; white-space:nowrap;"></div>
        <div id="error-banner" role="alert" style="display:none; position:absolute; top:34px; left:0; right:0; margin:0 auto; max-width:720px; background:rgba(60,12,12,0.96); border:1px solid #c44; border-radius:4px; padding:8px 12px; font-family:monospace; font-size:12px; color:#f4c6c6; box-shadow:0 4px 18px rgba(0,0,0,0.6); pointer-events:auto; white-space:normal;"></div>
        <div id="delve-mood-chip" style="display:none; flex:0 0 auto; align-items:center; background:rgba(20,8,24,0.9); border:1px solid #6a4a7a; border-radius:3px; padding:4px 10px; font-family:monospace; font-size:11px; color:#e0c8f0; white-space:nowrap; box-shadow:0 0 10px rgba(150,80,200,0.25);"></div>
      </div>

      <!-- DM command bar -->
      <div id="dm-bar" style="display:none; position:absolute; left:0; right:0; bottom:200px; z-index:30;">
        <div style="display:flex; gap:6px; padding:6px 8px; background:rgba(6,20,10,0.94); border-top:1px solid #2f5b40; border-bottom:1px solid #2f5b40;">
          <span style="align-self:center; color:#8fd6a0; font-family:monospace; font-size:12px;">DM \u276f</span>
          <input id="dm-input" type="text" autocomplete="off"
                 placeholder='Order the party\u2026 try "go north", "attack", "flee", "rest", "camp", "descend", "summon owlbear", "report", "help"'
                 style="flex:1; min-width:0; padding:6px 8px; background:#0d130f; color:#d7efe0; border:1px solid #3f6b4f; font-family:monospace; font-size:12px;" />
          <button id="dm-send" style="padding:6px 14px; background:#274a35; color:#bdf0cf; border:1px solid #3f6b4f; cursor:pointer; font-family:monospace; font-size:12px;">Send</button>
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
    dmInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') this.sendDMCommand(dmInput);
    });
  }

  setParty(party: Party) {
    this.liveParty = party;
    const members = party.members;
    let html = '';
    for (const m of members) {
      const hpColor = m.hp / m.maxHp > 0.5 ? '#4c4' : m.hp / m.maxHp > 0.25 ? '#cc4' : '#c44';
      const classColor = this.classColor(m.charClass.id);
      html += `
        <div class="party-member" data-id="${m.id}"
             style="padding:4px; margin-bottom:4px; background:rgba(255,255,255,0.03); border-radius:2px; cursor:pointer; ${m.id === this.selectedChar?.id ? 'border:1px solid #ffd700;' : ''}">
          <div style="color:${classColor}; font-weight:bold;">${m.name}</div>
          <div style="color:#888;">Lv${m.level} ${m.race.name} ${m.charClass.name}</div>
          <div style="display:flex; align-items:center; gap:4px;">
            <div style="flex:1; height:4px; background:#222; border-radius:2px;">
              <div style="width:${(m.hp / m.maxHp) * 100}%; height:100%; background:${hpColor}; border-radius:2px;"></div>
            </div>
            <span style="font-size:10px;">${m.hp}/${m.maxHp}</span>
          </div>
          ${this.conditionChips(m)}
        </div>`;
    }
    this.refreshQuestBar();
    html += this.dungeonLevel > 0
      ? `<div style="color:#665; font-size:9px; margin-top:4px;">Dungeon Level: ${this.dungeonLevel}</div>`
      : `<div style="color:#665; font-size:9px; margin-top:4px;">The Surface World</div>`;
    html += `<div style="color:#864; font-size:9px;">Gold: ${party.members.reduce((s, m) => s + m.gold, 0)}</div>`;
    this.partyEl.innerHTML = html;

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
    const accent = q.completed ? '#ffd700' : '#8cf';
    const border = q.completed ? '#6a5a2a' : '#3a4a6a';
    this.questBarEl.style.display = 'block';
    this.questBarEl.style.borderColor = border;
    this.questBarEl.innerHTML =
      `<span style="color:${accent}; font-weight:bold;">\ud83d\udcdc ${q.title}</span>` +
      `<span style="color:#aab; margin-left:12px;">${progress}</span>` +
      `<span style="color:#998; margin-left:12px;">Reward: ${q.rewardGold} gp \u00b7 ${q.rewardXp} XP</span>`;
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
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#ffd700;">
            <span>\uD83D\uDC51 ${b.name}</span>
            <span>${b.hp}/${b.maxHp} ${pips}</span>
          </div>
          <div style="height:6px; background:#222; border-radius:3px; overflow:hidden;">
            <div style="height:100%; width:${pct}%; background:linear-gradient(90deg,#a33,#e55); transition:width 0.3s;"></div>
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
        return `<div style="color:#aaf; font-size:10px; padding:1px 4px;">${ordinal(lvl)}: ${'\u25cf'.repeat(rem)}${'\u25cb'.repeat(max - rem)}</div>`;
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
    const gearHtml = gearEntries.length > 0 ? `
      <div style="margin-top:6px; color:#fd8; font-weight:bold;">Equipped (AC ${c.ac}, +${c.attackBonus} to hit):</div>
      ${gearEntries.map(e => `<div style="color:#db8; font-size:10px; padding:1px 4px;">${SLOT_LABELS[e.slot]} ${e.item!.name}${e.item!.identified === false ? ' (???)' : ''}</div>`).join('')}
    ` : '';

    const invHtml = c.inventory.length > 0 ? `
      <div style="margin-top:6px; color:#ca8; font-weight:bold;">Inventory:</div>
      ${c.inventory.map(i => `<div style="color:#a98; font-size:10px; padding:1px 4px;">• ${i.identified === false ? '???' : i.name}</div>`).join('')}
    ` : '<div style="color:#555; font-size:10px; margin-top:4px;">Inventory empty</div>';

    this.charSheetEl.innerHTML = `
      <div style="color:#ffd700; font-size:12px; font-weight:bold; margin-bottom:4px;">${c.name}</div>
      <div style="color:#888; font-size:10px;">Lv${c.level} ${c.race.name} ${c.charClass.name}</div>
      <div style="margin-top:4px; color:#4c4;">HP: ${c.hp}/${c.maxHp}</div>
      ${c.hp <= 0 ? `<div style="color:#f66; font-size:10px; margin-top:2px;">${c.isDead ? 'DEAD' : c.stabilized ? 'STABILIZED — stable at 0 HP' : 'DYING — making death saves'}</div>` : ''}
      ${c.isDying ? `<div style="color:#faa; font-size:9px;">Death saves: ${c.deathSaveSuccesses}S / ${c.deathSaveFailures}F</div>` : ''}
      ${c.exhaustion > 0 ? `<div style="color:#fa0; font-size:9px;">Exhaustion ${c.exhaustion}/6 — ${c.exhaustionLabel}</div>` : ''}
      <div style="color:#888; font-size:9px;">AC: ${c.ac} | Speed: ${c.effectiveSpeed}ft${c.effectiveSpeed !== c.speed ? ` (base ${c.speed})` : ''}</div>
      <div style="color:#888; font-size:9px;">Prof bonus: +${c.profBonus}${getCasterType(c.charClass.id) !== 'none' ? ` | Spell DC ${c.spellSaveDC}` : ''} | Hit Dice: ${c.hitDiceRemaining}/${c.maxHitDice}</div>
      ${c.conditions.length > 0 || c.concentration ? `<div style="margin-top:4px; color:#ca8; font-weight:bold; font-size:10px;">Active:</div>${this.conditionChips(c)}${c.conditions.length > 0 ? c.conditions.map(cond => {
        const meta = CONDITION_META[cond.id];
        return `<div style="color:${meta.color}; font-size:9px; padding:1px 4px;">• ${meta.label} — ${meta.effect}${cond.turnsLeft > 0 ? ` (${cond.turnsLeft} turn${cond.turnsLeft === 1 ? '' : 's'} left)` : ''}</div>`;
      }).join('') : ''}` : ''}
      <div style="color:#888; font-size:9px;">XP: ${c.xp}/${c.xpToNext()}</div>
      <div style="margin-top:4px; color:#ccc; font-weight:bold;">Attributes:</div>
      ${abilsHtml}
      ${slotsHtml}
      ${spellsHtml}
      ${gearHtml}
      ${invHtml}
      <div style="margin-top:6px; color:#888; font-size:9px;">Combat: +${c.attackBonus} atk / ${c.getWeaponDamageDie()}d die</div>
      <div style="margin-top:6px; color:#888; font-size:9px;">
        ${c.charClass.description.substring(0, 80)}...
      </div>
    `;
  }

  addCombatMessage(msg: string, color: string = '#ccc') {
    this.combatMessages.push(`<span style="color:${color}">${msg}</span>`);
    if (this.combatMessages.length > 150) {
      this.combatMessages = this.combatMessages.slice(-100);
    }
    this.logEl.innerHTML = this.combatMessages.join('<br>');
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  addCombatLogBatch(log: CombatLog) {
    const colors: Record<string, string> = {
      'hit': '#8c8',
      'miss': '#888',
      'heal': '#8cf',
      'spell': '#c8a',
      'crit': '#fc0',
      'death': '#c44',
      'victory': '#ffd700',
      'defeat': '#c44',
      'system': '#888',
    };

    for (const msg of log.messages) {
      let color = '#ccc';
      if (msg.includes('CRIT')) color = colors.crit;
      else if (msg.includes('casts')) color = colors.spell;
      else if (msg.includes('heals')) color = colors.heal;
      else if (msg.includes('misses')) color = colors.miss;
      else if (msg.includes('slain') || msg.includes('fallen')) color = colors.death;
      else if (msg.includes('Victory')) color = colors.victory;
      else if (msg.includes('defeated')) color = colors.defeat;
      else if (msg.includes('Initiative') || msg.startsWith('---')) color = colors.system;
      else if (msg.includes('hits') || msg.includes('damage')) color = colors.hit;

      this.addCombatMessage(msg, color);
    }
  }

  /** Clear the combat log (used when a restored run takes over the screen). */
  resetLog() {
    this.combatMessages = [];
    this.logEl.innerHTML = '';
  }

  setDungeonLevel(level: number) {
    this.dungeonLevel = level;
  }

  setDungeonTitle(name: string) {
    const el = this.overlay.querySelector('#dungeon-title');
    if (el) el.textContent = name;
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
    screen.style.cssText = 'position:absolute; inset:0; z-index:100; background:rgba(5,5,12,0.97); display:flex; flex-direction:column; align-items:center; justify-content:center; font-family:monospace;';
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
        this.onEraseComplete?.();
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
      <div style="font-size:30px; font-weight:bold; color:#ffd700; text-shadow:0 0 14px rgba(255,200,0,0.55), 0 0 40px rgba(255,120,40,0.25); letter-spacing:6px;">\u2694 FATEFALL</div>
      <div style="color:#8a8; font-size:12px; margin-top:8px;">An autonomous party of adventurers roams a living world of dice, dungeons, and fate.<br>Pick a save slot below \u2014 each holds one run, saved automatically.</div>`;

    const slotCards = saves.map((save, i) => {
      const isSelected = i === selected;
      const cardStyle = `flex:1; min-width:170px; padding:12px; cursor:pointer; text-align:left; background:${isSelected ? 'rgba(255,215,0,0.07)' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isSelected ? '#ffd700' : '#333'}; border-radius:4px; font-family:monospace;`;
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
        ${partyLabel ? `<div style="color:#ffd700; font-size:11px; font-weight:bold; margin-top:2px;">${partyLabel}</div>` : ''}
        <div style="color:#ccc; font-size:12px; font-weight:bold; margin-top:2px;">${locationName}</div>
        <div style="color:#888; font-size:10px;">${locationLine} \u00b7 ${new Date(save.savedAt).toLocaleDateString()} ${new Date(save.savedAt).toLocaleTimeString()}</div>
        ${(typeof (save as any).clockElapsed === 'number')
          ? `<div style="color:#7aa; font-size:10px;">${this.calendarShortDate((save as any).clockElapsed)}</div>`
          : ''}
        ${(save.expeditionJournal && save.expeditionJournal.length > 0)
          ? `<div style="color:#8a9; font-size:9px; margin-top:3px; font-style:italic;">\u2018${save.expeditionJournal[save.expeditionJournal.length - 1]}\u2019</div>`
          : ''}
        <div style="margin-top:6px;">
          ${save.party.members.map(m => {
            const cls = m.classId.charAt(0).toUpperCase() + m.classId.slice(1);
            const maxHp = m.exhaustion >= 4 ? Math.floor(m.baseMaxHp / 2) : m.baseMaxHp;
            const hpColor = m.hp / maxHp > 0.5 ? '#4c4' : m.hp / maxHp > 0.25 ? '#cc4' : '#c44';
            const state = m.hp <= 0 ? (m.isDead ? ' DEAD' : m.stabilized ? ' STAB' : ' DYING') : '';
            return `<div style="color:#ccc; font-size:10px; padding:1px 0;">${m.name}<span style="color:${hpColor};">${state}</span> <span style="color:#888;">Lv${m.level} ${cls}</span> <span style="color:${hpColor};">${m.hp}/${maxHp}</span></div>`;
          }).join('')}
        </div>`;
      })() : `<div style="color:#555; font-size:12px; margin-top:14px;">Empty</div>`;

      return `<button data-slot="${i}" style="${cardStyle}">
        <div style="color:#ca8; font-weight:bold; font-size:10px; letter-spacing:1px;">SLOT ${i + 1}</div>
        ${body}
      </button>`;
    }).join('');

    let buttons: string;
    if (this.confirmErase) {
      buttons = `
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px; align-items:center;">
          <span style="color:#f88; font-size:12px; font-weight:bold;">\u26a0 Permanently erase Slot ${selected + 1}? This cannot be undone!</span>
          <button data-action="confirm-erase" style="padding:10px 22px; background:#4a0a0a; color:#f44; border:2px solid #a33; cursor:pointer; font-family:monospace; font-size:13px; font-weight:bold;">\u2716 Erase Forever</button>
          <button data-action="cancel" style="padding:10px 22px; background:#1a1a24; color:#aab; border:1px solid #4a4a66; cursor:pointer; font-family:monospace; font-size:13px;">Cancel</button>
        </div>`;
    } else if (confirming) {
      buttons = `
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px; align-items:center;">
          <span style="color:#c88; font-size:12px;">Starting fresh in Slot ${selected + 1} erases the run saved there.</span>
          <button data-action="confirm-new" style="padding:10px 22px; background:#3a1a10; color:#f88; border:1px solid #8a3a2a; cursor:pointer; font-family:monospace; font-size:13px; font-weight:bold;">Erase & New Run</button>
          <button data-action="cancel" style="padding:10px 22px; background:#1a1a24; color:#aab; border:1px solid #4a4a66; cursor:pointer; font-family:monospace; font-size:13px;">Cancel</button>
        </div>`;
    } else if (saves[selected]) {
      buttons = `
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px;">
          <button data-action="continue" style="padding:10px 26px; background:#3a3a10; color:#ffd700; border:1px solid #8a8a2a; cursor:pointer; font-family:monospace; font-size:14px; font-weight:bold;">\u25b6 Continue Slot ${selected + 1}</button>
          <button data-action="new" style="padding:10px 26px; background:#1a1a24; color:#a8b; border:1px solid #4a4a66; cursor:pointer; font-family:monospace; font-size:14px;">\u2726 New Run</button>
          <button data-action="erase" style="padding:10px 26px; background:#2a1010; color:#c66; border:1px solid #6a3030; cursor:pointer; font-family:monospace; font-size:14px;">\u2716 Erase</button>
        </div>`;
    } else {
      buttons = `
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px;">
          <button data-action="new" style="padding:10px 26px; background:#3a3a10; color:#ffd700; border:1px solid #8a8a2a; cursor:pointer; font-family:monospace; font-size:14px; font-weight:bold;">\u2726 Start New Run in Slot ${selected + 1}</button>
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
      (btn as HTMLElement).style.background = isActive ? '#444' : '#222';
      (btn as HTMLElement).style.color = isActive ? '#fff' : '#888';
    });
    this.onSpeedChange?.(speed);
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    const btn = this.overlay.querySelector('#btn-pause') as HTMLElement;
    btn.textContent = this.isPaused ? '▶ Play' : '⏸ Pause';
    this.onPauseToggle?.();
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

  /** Render active conditions, concentration, and remaining spell uses as chips. */
  private conditionChips(m: GameCharacter): string {
    const chips = m.conditions.map(c => {
      const meta = CONDITION_META[c.id];
      return `<span style="display:inline-block; padding:0 4px; margin:2px 3px 0 0; font-size:9px; border-radius:2px; background:#15151f; color:${meta.color}; border:1px solid ${meta.color};">${meta.label}</span>`;
    });
    if (m.concentration) {
      chips.push(`<span style="display:inline-block; padding:0 4px; margin:2px 3px 0 0; font-size:9px; border-radius:2px; background:#15151f; color:#ffd700; border:1px solid #ffd700;">\u2726 Concentrating: ${m.concentration.spellName}</span>`);
    }
    if (getCasterType(m.charClass.id) !== 'none' && m.maxSpellSlotsTotal > 0) {
      const parts: string[] = [];
      for (let lvl = 1; lvl <= 9; lvl++) {
        const max = m.maxSpellSlots[lvl] || 0;
        if (max <= 0) continue;
        const remaining = m.spellSlots[lvl] || 0;
        parts.push(`${ordinal(lvl)} ${'\u25cf'.repeat(remaining)}${'\u25cb'.repeat(max - remaining)}`);
      }
      if (parts.length > 0) {
        const pact = getCasterType(m.charClass.id) === 'pact' ? ' \u26a1 Pact' : '';
        chips.push(`<span style="display:inline-block; padding:0 4px; margin:2px 3px 0 0; font-size:9px; border-radius:2px; background:#15151f; color:#88f; border:1px solid #446;">${parts.join(' ')}${pact}</span>`);
      }
    }
    if (m.hp <= 0) {
      const label = m.isDead ? 'DEAD' : m.stabilized ? 'STABILIZED' : 'DYING ☠';
      chips.push(`<span style="display:inline-block; padding:0 4px; margin:2px 3px 0 0; font-size:9px; border-radius:2px; background:#2a0d0d; color:#f66; border:1px solid #f66;">${label}</span>`);
    }
    if (m.isDying) {
      chips.push(`<span style="display:inline-block; padding:0 4px; margin:2px 3px 0 0; font-size:9px; border-radius:2px; background:#15151f; color:#faa; border:1px solid #faa;">Death saves ${m.deathSaveSuccesses}S/${m.deathSaveFailures}F</span>`);
    }
    if (m.exhaustion > 0) {
      chips.push(`<span style="display:inline-block; padding:0 4px; margin:2px 3px 0 0; font-size:9px; border-radius:2px; background:#2a1d0d; color:#fa0; border:1px solid #fa0;">Exhaustion ${m.exhaustion}/6</span>`);
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

  private classColor(classId: string): string {
    const colors: Record<string, string> = {
      fighter: '#c44',
      wizard: '#48c',
      cleric: '#ccc',
      rogue: '#888',
      ranger: '#484',
      paladin: '#cc8',
      barbarian: '#c84',
      druid: '#8a4',
    };
    return colors[classId] || '#ccc';
  }
}
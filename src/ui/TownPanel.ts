/**
 * TownPanel — the interactive town overlay. Three-column layout:
 * left: buildings list, NPCs, quest board; right: building detail + market;
 * footer: rest, depart, building-specific actions.
 * Rendered into the game's ui-overlay as a centered panel.
 */

import { InventoryItem } from '../entities/Character';
import { Quest, questProgressText, QuestState } from '../quests/Quests';
import { OverworldTown } from '../world/Overworld';
import { QuestGiver, getReputationTier, getDialogue } from '../quests/QuestGivers';
import { TOWN_ARCHETYPES, TownBuilding, TownService, TownServiceId, TownArchetype, SHOP_STOCK, ShopItem, shopItemToInventory, REPUTATION_SHOP, ReputationShopItem, getReputationShopTier, getReputationPerks } from '../world/TownTypes';
import { BulletinTask, bulletinIcon, bulletinProgress } from '../quests/BulletinBoard';
import { T } from './Theme';

export class TownPanel {
  private overlay: HTMLElement;
  private el: HTMLElement | null = null;
  private visible: boolean = false;
  /** Which building the player has "entered" (null = overview). */
  private activeBuildingId: string | null = null;

  public onAcceptQuest?: (quest: Quest) => void;
  public onReportQuest?: (quest: Quest) => void;
  public onBuy?: (item: InventoryItem) => void;
  public onSell?: (item: InventoryItem) => void;
  public onDepart?: () => void;
  public onRest?: () => void;
  public onVisitNPC?: (npcId: string) => void;
  public onUseService?: (serviceId: TownServiceId) => void;

  public townProvider: () => OverworldTown | null = () => null;
  /** The quest-givers in the current town. */
  public questGiverProvider: () => QuestGiver[] = () => [];
  /** The town's current tavern rumor (drives the quest board). */
  public rumorProvider: () => { text: string } | null = () => null;
  /** The live festival, if the town is celebrating. */
  public festivalProvider: () => { name: string; kind: string } | null = () => null;
  /** Active town event, if any. */
  public eventProvider: () => { name: string; icon: string; effect: { description: string } } | null = () => null;
  /** Dynamic price modifier for this town (includes prosperity, festival, caravan). */
  public priceModifierProvider: () => number = () => 1;
  /** Current town reputation (0-100). */
  public townRepProvider: () => number = () => 0;
  /** Buy a reputation shop item. */
  public onBuyRepItem?: (item: ReputationShopItem) => void;
  /** Bulletin board tasks for this town. */
  public bulletinProvider: () => BulletinTask[] = () => [];
  /** Complete a bulletin task. */
  public onBulletinComplete?: (task: BulletinTask) => void;
  public questProvider: () => Quest[] = () => [];
  public questStateProvider: () => QuestState = () => ({ dungeonLevel: 1, killLedger: {}, bossSlainThisFloor: false });
  public goldProvider: () => number = () => 0;
  public inventoryProvider: () => InventoryItem[] = () => [];
  public buyStockProvider: () => InventoryItem[] = () => [];

  constructor(overlay: HTMLElement) {
    this.overlay = overlay;
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.activeBuildingId = null;
    this.el = document.createElement('div');
    // Above the dice tray's cinematic die (z-index 95): this is a modal, and a
    // d20 tumbling through the middle of the market read as a glitch.
    this.el.style.cssText = `position:absolute; inset:0; z-index:96; background:rgba(10,7,5,0.74); display:flex; align-items:center; justify-content:center; font-family:${T.bodyFont}; backdrop-filter: blur(3px);`;
    this.el.innerHTML = `<div id="town-panel" class="dp-panel" style="width:920px; max-width:96%; height:640px; max-height:92%; display:flex; flex-direction:column; overflow:hidden;"></div>`;
    this.overlay.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('#tp-close')) { this.hide(); return; }
      const btn = target.closest('[data-tp-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.getAttribute('data-tp-action')!;
      const id = btn.getAttribute('data-tp-id') ?? '';
      switch (action) {
        case 'accept': {
          const q = this.questProvider().find(x => x.id === id);
          if (q) this.onAcceptQuest?.(q);
          break;
        }
        case 'report': {
          const q = this.questProvider().find(x => x.id === id);
          if (q) this.onReportQuest?.(q);
          break;
        }
        case 'buy': {
          const item = this.buyStockProvider().find(x => x.id === id);
          if (item) this.onBuy?.(item);
          break;
        }
        case 'buy-shop': {
          // A building's own wares: "pool:name", looked up in the pool it was drawn from.
          const cut = id.indexOf(':');
          const pool = id.slice(0, cut);
          const ware = (SHOP_STOCK[pool] ?? []).find(x => x.name === id.slice(cut + 1));
          if (ware) this.onBuy?.(shopItemToInventory(pool, ware));
          break;
        }
        case 'sell': {
          const item = this.inventoryProvider().find(x => x.id === id);
          if (item) this.onSell?.(item);
          break;
        }
        case 'rest': this.onRest?.(); break;
        case 'depart': this.onDepart?.(); break;
        case 'visit-npc': this.onVisitNPC?.(id); break;
        case 'buy-rep': {
          const repItem = REPUTATION_SHOP.find(x => x.name === id);
          if (repItem) this.onBuyRepItem?.(repItem);
          break;
        }
        case 'bulletin-complete': {
          const task = this.bulletinProvider().find(t => t.id === id);
          if (task) this.onBulletinComplete?.(task);
          break;
        }
        case 'use-service': this.onUseService?.(id as TownServiceId); break;
        case 'enter-building': this.activeBuildingId = id; this.render(); break;
        case 'leave-building': this.activeBuildingId = null; this.render(); break;
      }
    });

    this.render();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.activeBuildingId = null;
    this.el?.remove();
    this.el = null;
  }

  /** Re-render in place (keeps the overlay up while state changes). */
  refresh(): void {
    if (!this.visible || !this.el) return;
    this.render();
  }

  /** A tracked-out gold section heading sitting on a hairline rule. */
  private static section(label: string, trailing = ''): string {
    return `<div class="dp-rule" style="display:flex; align-items:baseline; gap:8px;">`
      + `<span class="dp-label">${label}</span>${trailing}</div>`;
  }

  /** The panel's small-print helper: a muted line of detail. */
  private static detail(text: string): string {
    return `<div style="color:${T.muted}; font-size:10.5px; line-height:1.45;">${text}</div>`;
  }

  private render(): void {
    const panel = this.el!.querySelector('#town-panel')!;
    const town = this.townProvider();
    const rumor = this.rumorProvider();
    const festival = this.festivalProvider();
    const event = this.eventProvider();
    const quests = this.questProvider();
    const state = this.questStateProvider();
    const gold = this.goldProvider();
    const stock = this.buyStockProvider();
    const inventory = this.inventoryProvider();
    const giversList = this.questGiverProvider();

    // Resolve archetype
    const archetype: TownArchetype | undefined = town ? TOWN_ARCHETYPES[town.archetypeId as keyof typeof TOWN_ARCHETYPES] : undefined;
    const buildings: TownBuilding[] = archetype?.buildings ?? [];
    const activeBuilding = this.activeBuildingId ? buildings.find(b => b.id === this.activeBuildingId) : null;
    const dynamicMod = this.priceModifierProvider();

    // If we're inside a building, show the building detail view
    if (activeBuilding) {
      this.renderBuilding(panel, town, activeBuilding, archetype!, gold, stock, inventory, dynamicMod);
      return;
    }

    // ── Overview layout ──
    const activeQuest = quests.find(q => q.accepted && !q.turnedIn);
    const questRows = quests.filter(q => !q.turnedIn).map(q => {
      const progress = q.accepted ? questProgressText(q, state) : '';
      const action = !q.accepted
        ? `<button data-tp-action="accept" data-tp-id="${q.id}" class="dp-btn-gold" style="padding:4px 12px; font-size:11px;">Accept</button>`
        : q.completed
          ? `<button data-tp-action="report" data-tp-id="${q.id}" class="dp-btn-gold" style="padding:4px 12px; font-size:11px;">💰 Report</button>`
          : `<span style="color:${T.good}; font-size:11px;">${progress}</span>`;
      const reward = `${q.rewardGold} gp · ${q.rewardXp} XP${q.rewardItemId ? ' · magic item' : ''}`;
      const giver = q.giverNpcId ? giversList.find(g => g.id === q.giverNpcId) : null;
      const giverTag = giver
        ? `<div style="color:${giver.portraitColor}; font-size:10px; margin-top:5px;">Posted by ${giver.portrait} ${giver.name}</div>`
        : '';
      return `<div class="dp-row" style="padding:9px 11px; margin-bottom:7px;">
        <div style="color:${T.gold}; font-size:13px; font-weight:bold;">${q.title}</div>
        ${TownPanel.detail(q.detail)}
        <div class="dp-num" style="color:${T.info}; font-size:10.5px; margin-top:3px;">${reward}</div>
        ${giverTag}
        <div style="margin-top:7px;">${action}</div>
      </div>`;
    }).join('') || `<div style="color:${T.faint}; padding:8px 2px; font-size:11px; font-style:italic;">No quests posted right now.</div>`;

    // Buildings list
    const buildingRows = buildings.map(b => {
      const svcCount = b.services.length;
      const shopTag = b.hasShop ? ' 🏪' : '';
      return `<div class="dp-row dp-row-click" style="padding:7px 10px; margin-bottom:5px;" data-tp-action="enter-building" data-tp-id="${b.id}">
        <div style="display:flex; align-items:center; gap:9px;">
          <span style="font-size:18px; width:22px; text-align:center;">${b.icon}</span>
          <div style="flex:1; min-width:0;">
            <div style="color:${T.text}; font-size:12px;">${b.name}${shopTag}</div>
            <div style="color:${T.faint}; font-size:10px;">${svcCount} service${svcCount !== 1 ? 's' : ''}</div>
          </div>
          <span style="color:${T.goldDim}; font-size:10px;">Enter ▸</span>
        </div>
      </div>`;
    }).join('');

    // Quest-giver NPCs
    const giverRows = giversList.map(g => {
      const tier = getReputationTier(g);
      const tierColor = tier === 'legend' ? T.gold : tier === 'trusted' ? T.arcane : tier === 'acquaintance' ? T.info : T.muted;
      const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
      return `<div class="dp-row dp-row-click" style="padding:6px 10px; margin-bottom:5px;" data-tp-action="visit-npc" data-tp-id="${g.id}">
        <div style="display:flex; align-items:center; gap:9px;">
          <span style="font-size:16px; width:22px; text-align:center;">${g.portrait}</span>
          <div style="flex:1; min-width:0;">
            <div style="color:${g.portraitColor}; font-size:12px;">${g.name}</div>
            <div style="color:${T.faint}; font-size:10px;">${g.title}</div>
          </div>
          <span class="dp-chip dp-chip-sm" style="color:${tierColor}; border-color:${tierColor}55;">${tierLabel}</span>
        </div>
      </div>`;
    }).join('') || '';

    // Quick market (show shop pool from first building with a shop, or "general")
    const defaultShopPool = buildings.find(b => b.hasShop)?.shopPool ?? 'general';
    const shopItems = (SHOP_STOCK[defaultShopPool] ?? SHOP_STOCK.general).slice(0, 4);
    const buyRows = shopItems.map(item => {
      const adjustedPrice = Math.max(1, Math.floor(item.value * dynamicMod));
      const discount = dynamicMod < 1 ? `<span class="dp-num" style="color:${T.good}; font-size:9px; text-decoration:line-through; margin-right:5px;">${item.value}</span>` : '';
      return `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:5px 9px; border-bottom:1px solid ${T.line};">
        <div style="min-width:0;">
          <div style="color:${T.text}; font-size:11px;">${item.name}</div>
          <div style="color:${T.faint}; font-size:10px;">${item.description}</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex:0 0 auto;">
          ${discount}<span class="dp-num" style="color:${T.coin}; font-size:11px;">${adjustedPrice} gp</span>
        </div>
      </div>`;
    }).join('');

    const sellable = inventory.filter(i => (i.value ?? 0) > 0);
    const sellRows = sellable.length > 0 ? sellable.map(item => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:5px 9px; border-bottom:1px solid ${T.line};">
        <div style="color:${T.text}; font-size:11px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.name}</div>
        <div style="display:flex; align-items:center; gap:7px; flex:0 0 auto;">
          <span class="dp-num" style="color:${T.coin}; font-size:11px;">${Math.floor((item.value ?? 0) / 2)} gp</span>
          <button data-tp-action="sell" data-tp-id="${item.id}" class="dp-btn" style="padding:2px 9px; font-size:10px;">Sell</button>
        </div>
      </div>`).join('')
      : `<div style="color:${T.faint}; padding:7px 9px; font-size:11px; font-style:italic;">Nothing to sell.</div>`;

    // Archetype flavour badge
    const archName = archetype ? `<span class="dp-chip dp-chip-sm" style="margin-left:9px; color:${T.goldDim}; vertical-align:middle;">${archetype.name}</span>` : '';

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding:11px 16px; border-bottom:1px solid ${T.line}; background:linear-gradient(180deg, rgba(46,38,26,0.55), rgba(24,20,15,0.35));">
        <div style="max-width:560px; min-width:0;">
          <div class="dp-title" style="color:${T.gold}; letter-spacing:2px; font-size:18px;">🏘 ${town?.name ?? 'Town'}${archName}</div>
          ${TownPanel.detail(town?.description ?? '')}
          <div style="color:#e6d9b8; font-size:10.5px; margin-top:5px; font-style:italic; border-left:2px solid ${T.rule}; padding-left:8px;">🗣 “${rumor?.text ?? 'The streets are quiet.'}”</div>
          ${festival ? `<div style="color:${T.arcane}; font-size:10.5px; margin-top:4px;">🎪 ${festival.name}</div>` : ''}
          ${event ? `<div style="color:${T.warn}; font-size:10.5px; margin-top:4px;">${event.icon} ${event.name} — ${event.effect.description}</div>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:12px; flex:0 0 auto;">
          <span class="dp-num" style="color:${T.coin}; font-size:14px;">💰 ${gold} gp</span>
          <button id="tp-close" class="dp-btn dp-btn-bad" style="padding:4px 12px; font-size:12px;">✕</button>
        </div>
      </div>
      <div style="display:flex; flex:1; overflow:hidden;">
        <!-- Left: Buildings + NPCs + Quests -->
        <div style="flex:1; min-width:0; overflow-y:auto; padding:4px 12px 12px; border-right:1px solid ${T.line};">
          ${TownPanel.section('Buildings')}
          ${buildingRows}
          ${giverRows ? `${TownPanel.section('Notable NPCs')}${giverRows}` : ''}
          ${(() => {
            const tasks = this.bulletinProvider();
            if (tasks.length === 0) return '';
            const taskRows = tasks.map(t => {
              const icon = bulletinIcon(t.kind);
              const prog = bulletinProgress(t);
              const action = t.completed
                ? `<button data-tp-action="bulletin-complete" data-tp-id="${t.id}" class="dp-btn-gold" style="padding:3px 10px; font-size:10px;">Claim</button>`
                : !t.accepted
                ? `<button data-tp-action="bulletin-complete" data-tp-id="${t.id}" class="dp-btn" style="padding:3px 10px; font-size:10px;">Accept</button>`
                : `<span title="Finish the objective, then claim it here." style="padding:3px 8px; color:${T.good}; font-size:10px;">In hand</span>`;
              return `<div class="dp-row" style="padding:7px 10px; margin-bottom:5px;">
                <div style="display:flex; align-items:center; gap:9px;">
                  <span style="font-size:14px; width:22px; text-align:center;">${icon}</span>
                  <div style="flex:1; min-width:0;">
                    <div style="color:${T.text}; font-size:11.5px;">${t.title}</div>
                    <div style="color:${T.faint}; font-size:10px;">${t.detail}</div>
                    <div class="dp-num" style="color:${T.info}; font-size:10px;">${prog} · ${t.rewardGold} gp · ${t.rewardXp} XP</div>
                  </div>
                  ${action}
                </div>
              </div>`;
            }).join('');
            return `${TownPanel.section('Bulletin Board')}${taskRows}`;
          })()}
          ${TownPanel.section('Quest Board', activeQuest ? `<span class="dp-chip dp-chip-sm" style="color:${T.gold}; border-color:${T.goldDim};">active</span>` : '')}
          ${questRows}
        </div>
        <!-- Right: Quick Market + Sell -->
        <div style="width:326px; flex:0 0 auto; overflow-y:auto; padding:4px 12px 12px;">
          ${TownPanel.section('Quick Market')}
          <div class="dp-row" style="padding:0; overflow:hidden;">${buyRows || `<div style="color:${T.faint}; padding:7px 9px; font-size:11px; font-style:italic;">Enter a building to see its shop.</div>`}</div>
          ${TownPanel.section('Sell')}
          <div class="dp-row" style="padding:0; overflow:hidden;">${sellRows}</div>
          ${(() => {
            const rep = this.townRepProvider();
            const tier = getReputationShopTier(rep);
            const repItems = REPUTATION_SHOP.filter(i => i.repRequired <= rep);
            const nextUnlock = REPUTATION_SHOP.find(i => i.repRequired > rep);
            if (repItems.length === 0 && !nextUnlock) return '';
            const tierBar = TownPanel.section('Reputation Shop',
              `<span class="dp-chip dp-chip-sm" style="color:${tier.color}; border-color:${tier.color}55;">${tier.label} · ${rep}/100</span>`);
            const progress = nextUnlock
              ? `<div style="color:${T.faint}; font-size:9.5px; margin-bottom:6px;">Next unlock at rep ${nextUnlock.repRequired}: ${nextUnlock.name}</div>`
              : `<div style="color:${T.gold}; font-size:9.5px; margin-bottom:6px;">All reputation items unlocked.</div>`;
            const items = repItems.map(item => {
              const adjustedPrice = Math.max(1, Math.floor(item.value * dynamicMod));
              const typeIcon = item.type === 'weapon' ? '⚔️' : item.type === 'armor' ? '🛡️' : item.type === 'potion' ? '🧪' : item.type === 'scroll' ? '📜' : item.type === 'ring' ? '💍' : '✨';
              return `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:5px 9px; border-bottom:1px solid ${T.line};">
                <div style="min-width:0;">
                  <div style="color:${T.text}; font-size:11px;">${typeIcon} ${item.name}</div>
                  <div style="color:${T.faint}; font-size:10px;">${item.description}</div>
                </div>
                <div style="display:flex; align-items:center; gap:7px; flex:0 0 auto;">
                  <span class="dp-num" style="color:${T.coin}; font-size:11px;">${adjustedPrice} gp</span>
                  <button data-tp-action="buy-rep" data-tp-id="${item.name}" class="dp-btn" style="padding:2px 9px; font-size:10px;">Buy</button>
                </div>
              </div>`;
            }).join('');
            return `${tierBar}${progress}<div class="dp-row" style="padding:0; overflow:hidden;">${items || `<div style="color:${T.faint}; padding:6px 9px; font-size:10px; font-style:italic;">No items at your reputation level yet.</div>`}</div>`;
          })()}
        </div>
      </div>
      <div style="display:flex; gap:10px; padding:10px 16px; border-top:1px solid ${T.line}; background:linear-gradient(0deg, rgba(46,38,26,0.5), rgba(24,20,15,0.3));">
        <button data-tp-action="rest" class="dp-btn" style="flex:1; padding:8px; font-size:12.5px;">⛺ Rest</button>
        <button data-tp-action="depart" class="dp-btn-gold" style="flex:1; padding:8px; font-size:12.5px;">🚪 Depart</button>
      </div>`;
  }

  /** Render the "inside a building" detail view. */
  private renderBuilding(
    panel: Element,
    town: OverworldTown | null,
    building: TownBuilding,
    archetype: TownArchetype,
    gold: number,
    stock: InventoryItem[],
    inventory: InventoryItem[],
    dynamicMod: number = 1,
  ): void {
    // Services
    const serviceRows = building.services.map(s => {
      const costTag = s.cost > 0
        ? `<span class="dp-num" style="color:${T.coin}; font-size:11px;">${s.cost} gp</span>`
        : `<span style="color:${T.good}; font-size:11px;">Free</span>`;
      return `<div class="dp-row" style="padding:8px 11px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div style="flex:1; min-width:0;">
          <div style="color:${T.text}; font-size:12px;">${s.name}</div>
          <div style="color:${T.faint}; font-size:10px;">${s.description}</div>
          <div style="color:${T.info}; font-size:10px; margin-top:2px;">${s.effect}</div>
        </div>
        <div style="display:flex; align-items:center; gap:9px; flex:0 0 auto;">
          ${costTag}
          <button data-tp-action="use-service" data-tp-id="${s.id}" class="dp-btn-gold" style="padding:4px 12px; font-size:11px;">Use</button>
        </div>
      </div>`;
    }).join('') || `<div style="color:${T.faint}; padding:8px 2px; font-size:11px; font-style:italic;">No services available here.</div>`;

    // Shop
    const shopPool = building.shopPool ? SHOP_STOCK[building.shopPool] : null;
    let shopRows = '';
    if (shopPool) {
      shopRows = shopPool.map(item => {
        const adjustedPrice = Math.max(1, Math.floor(item.value * dynamicMod));
        return `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:6px 9px; border-bottom:1px solid ${T.line};">
          <div style="min-width:0;">
            <div style="color:${T.text}; font-size:11px;">${item.name}</div>
            <div style="color:${T.faint}; font-size:10px;">${item.description}</div>
          </div>
          <div style="display:flex; align-items:center; gap:7px; flex:0 0 auto;">
            <span class="dp-num" style="color:${T.coin}; font-size:11px;">${adjustedPrice} gp</span>
            <button data-tp-action="buy-shop" data-tp-id="${building.shopPool}:${item.name}" class="dp-btn" style="padding:2px 9px; font-size:10px;">Buy</button>
          </div>
        </div>`;
      }).join('');
    }
    void town; void archetype; void stock; void inventory;

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:16px; padding:11px 16px; border-bottom:1px solid ${T.line}; background:linear-gradient(180deg, rgba(46,38,26,0.55), rgba(24,20,15,0.35));">
        <div style="min-width:0;">
          <div class="dp-title" style="color:${T.gold}; font-size:16px; letter-spacing:1.5px;">${building.icon} ${building.name}</div>
          ${TownPanel.detail(building.description)}
        </div>
        <div style="display:flex; align-items:center; gap:12px; flex:0 0 auto;">
          <span class="dp-num" style="color:${T.coin}; font-size:14px;">💰 ${gold} gp</span>
          <button data-tp-action="leave-building" class="dp-btn" style="padding:4px 12px; font-size:12px;">← Back</button>
        </div>
      </div>
      <div style="display:flex; flex:1; overflow:hidden;">
        <div style="flex:1; min-width:0; overflow-y:auto; padding:4px 12px 12px; border-right:1px solid ${T.line};">
          ${TownPanel.section('Services')}
          ${serviceRows}
        </div>
        ${shopPool ? `
        <div style="width:306px; flex:0 0 auto; overflow-y:auto; padding:4px 12px 12px;">
          ${TownPanel.section('Shop')}
          <div class="dp-row" style="padding:0; overflow:hidden;">${shopRows}</div>
        </div>` : ''}
      </div>
      <div style="display:flex; gap:10px; padding:10px 16px; border-top:1px solid ${T.line}; background:linear-gradient(0deg, rgba(46,38,26,0.5), rgba(24,20,15,0.3));">
        <button data-tp-action="rest" class="dp-btn" style="flex:1; padding:8px; font-size:12.5px;">⛺ Rest</button>
        <button data-tp-action="depart" class="dp-btn-gold" style="flex:1; padding:8px; font-size:12.5px;">🚪 Depart</button>
      </div>`;
  }
}

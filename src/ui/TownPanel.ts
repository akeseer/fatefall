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
import { TOWN_ARCHETYPES, TownBuilding, TownService, TownServiceId, TownArchetype, SHOP_STOCK, ShopItem, REPUTATION_SHOP, ReputationShopItem, getReputationShopTier, getReputationPerks } from '../world/TownTypes';
import { BulletinTask, bulletinIcon, bulletinProgress } from '../quests/BulletinBoard';

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
    this.el.style.cssText = 'position:absolute; inset:0; z-index:60; background:rgba(6,8,16,0.72); display:flex; align-items:center; justify-content:center; font-family:monospace;';
    this.el.innerHTML = `<div id="town-panel" style="width:920px; max-width:96vw; height:640px; max-height:90vh; background:rgba(16,20,30,0.97); border:1px solid #5a6b4f; border-radius:8px; box-shadow:0 0 40px rgba(0,0,0,0.8); display:flex; flex-direction:column; overflow:hidden;"></div>`;
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
        ? `<button data-tp-action="accept" data-tp-id="${q.id}" style="padding:3px 10px; background:#274a35; color:#bdf0cf; border:1px solid #3f6b4f; cursor:pointer; font-family:monospace; font-size:11px;">✔ Accept</button>`
        : q.completed
          ? `<button data-tp-action="report" data-tp-id="${q.id}" style="padding:3px 10px; background:#4a3a1a; color:#ffd700; border:1px solid #8a7a3a; cursor:pointer; font-family:monospace; font-size:11px;">💰 Report</button>`
          : `<span style="color:#8a8; font-size:11px;">${progress}</span>`;
      const reward = `${q.rewardGold} gp · ${q.rewardXp} XP${q.rewardItemId ? ' · magic item' : ''}`;
      const giver = q.giverNpcId ? giversList.find(g => g.id === q.giverNpcId) : null;
      const giverTag = giver
        ? `<div style="color:${giver.portraitColor}; font-size:10px; margin-top:4px;">Posted by ${giver.portrait} ${giver.name}</div>`
        : '';
      return `<div style="border:1px solid #2a3a2a; background:#101a12; padding:8px; margin-bottom:8px; border-radius:4px;">
        <div style="color:#ffd700; font-size:13px;">${q.title}</div>
        <div style="color:#9a9; font-size:11px; margin:4px 0;">${q.detail}</div>
        <div style="color:#8cf; font-size:11px; margin-bottom:4px;">Reward: ${reward}</div>
        ${giverTag}
        <div>${action}</div>
      </div>`;
    }).join('') || '<div style="color:#666; padding:8px;">No quests posted right now.</div>';

    // Buildings list
    const buildingRows = buildings.map(b => {
      const svcCount = b.services.length;
      const shopTag = b.hasShop ? ' 🏪' : '';
      return `<div style="border:1px solid #2a3a2a; background:#182018; padding:8px; margin-bottom:6px; border-radius:4px; cursor:pointer;" data-tp-action="enter-building" data-tp-id="${b.id}">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:18px;">${b.icon}</span>
          <div style="flex:1;">
            <div style="color:#d7efe0; font-size:12px;">${b.name}${shopTag}</div>
            <div style="color:#778; font-size:10px;">${svcCount} service${svcCount !== 1 ? 's' : ''}</div>
          </div>
          <span style="color:#5a7a5a; font-size:10px;">▸ Enter</span>
        </div>
      </div>`;
    }).join('');

    // Quest-giver NPCs
    const giverRows = giversList.map(g => {
      const tier = getReputationTier(g);
      const tierColor = tier === 'legend' ? '#ffd700' : tier === 'trusted' ? '#a8f' : tier === 'acquaintance' ? '#8cf' : '#999';
      const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
      return `<div style="border:1px solid #2a3a2a; background:#151820; padding:6px; margin-bottom:6px; border-radius:4px; cursor:pointer;" data-tp-action="visit-npc" data-tp-id="${g.id}">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:16px;">${g.portrait}</span>
          <div style="flex:1;">
            <div style="color:${g.portraitColor}; font-size:12px;">${g.name}</div>
            <div style="color:#888; font-size:10px;">${g.title}</div>
          </div>
          <span style="color:${tierColor}; font-size:10px; border:1px solid ${tierColor}40; padding:1px 6px; border-radius:8px;">${tierLabel}</span>
        </div>
      </div>`;
    }).join('') || '';

    // Quick market (show shop pool from first building with a shop, or "general")
    const defaultShopPool = buildings.find(b => b.hasShop)?.shopPool ?? 'general';
    const shopItems = (SHOP_STOCK[defaultShopPool] ?? SHOP_STOCK.general).slice(0, 4);
    const buyRows = shopItems.map(item => {
      const adjustedPrice = Math.max(1, Math.floor(item.value * dynamicMod));
      const discount = dynamicMod < 1 ? `<span style="color:#8a8; font-size:9px; text-decoration:line-through; margin-right:4px;">${item.value}</span>` : '';
      return `<div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-bottom:1px solid #1a2430;">
        <div>
          <div style="color:#d7efe0; font-size:11px;">${item.name}</div>
          <div style="color:#778; font-size:10px;">${item.description}</div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          ${discount}<span style="color:#ffd700; font-size:11px;">${adjustedPrice} gp</span>
        </div>
      </div>`;
    }).join('');

    const sellable = inventory.filter(i => (i.value ?? 0) > 0);
    const sellRows = sellable.length > 0 ? sellable.map(item => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-bottom:1px solid #1a2430;">
        <div style="color:#d7efe0; font-size:11px;">${item.name}</div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="color:#ca8; font-size:11px;">${Math.floor((item.value ?? 0) / 2)} gp</span>
          <button data-tp-action="sell" data-tp-id="${item.id}" style="padding:2px 8px; background:#4a3527; color:#f0cbbd; border:1px solid #6b4f3f; cursor:pointer; font-family:monospace; font-size:10px;">Sell</button>
        </div>
      </div>`).join('')
      : '<div style="color:#666; padding:6px; font-size:11px;">Nothing to sell.</div>';

    // Archetype flavor badge
    const archName = archetype ? `<span style="color:#8a8; font-size:10px; border:1px solid #4a5a4a; padding:1px 6px; border-radius:8px; margin-left:8px;">${archetype.name}</span>` : '';

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 16px; border-bottom:1px solid #3a4a3a; background:rgba(30,40,30,0.6);">
        <div style="max-width:520px;">
          <div style="color:#ffd700; font-size:16px;">🏘 ${town?.name ?? 'Town'}${archName}</div>
          <div style="color:#8a8; font-size:10px; margin-top:2px;">${town?.description ?? ''}</div>
          <div style="color:#a89; font-size:10px; margin-top:2px; font-style:italic;">🗣 "${rumor?.text ?? 'The streets are quiet.'}"</div>
          ${festival ? `<div style="color:#f6c; font-size:10px; margin-top:2px;">🎪 ${festival.name}</div>` : ''}
          ${event ? `<div style="color:#ff8; font-size:10px; margin-top:2px;">${event.icon} ${event.name} — ${event.effect.description}</div>` : ''}
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="color:#ffd700; font-size:13px;">💰 ${gold} gp</span>
          <button id="tp-close" style="padding:4px 12px; background:#3a2a2a; color:#d8a; border:1px solid #6b4f4f; cursor:pointer; font-family:monospace; font-size:12px;">✕</button>
        </div>
      </div>
      <div style="display:flex; flex:1; overflow:hidden;">
        <!-- Left: Buildings + NPCs + Quests -->
        <div style="flex:1; overflow-y:auto; padding:10px; border-right:1px solid #2a3a2a;">
          <div style="color:#8fd6a0; font-size:12px; margin-bottom:6px;">🏛 Buildings</div>
          ${buildingRows}
          ${giverRows ? `<div style="color:#8fd6a0; font-size:12px; margin:10px 0 6px;">👥 Notable NPCs</div>${giverRows}` : ''}
          ${(() => {
            const tasks = this.bulletinProvider();
            if (tasks.length === 0) return '';
            const taskRows = tasks.map(t => {
              const icon = bulletinIcon(t.kind);
              const prog = bulletinProgress(t);
              const action = t.completed
                ? `<span style="color:#8a8; font-size:10px;">✅ Done</span>`
                : `<button data-tp-action="bulletin-complete" data-tp-id="${t.id}" style="padding:2px 8px; background:#274a35; color:#bdf0cf; border:1px solid #3f6b4f; cursor:pointer; font-family:monospace; font-size:10px;">Claim</button>`;
              return `<div style="border:1px solid #2a3a2a; background:#151a20; padding:6px; margin-bottom:4px; border-radius:4px;">
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="font-size:14px;">${icon}</span>
                  <div style="flex:1;">
                    <div style="color:#d7efe0; font-size:11px;">${t.title}</div>
                    <div style="color:#778; font-size:10px;">${t.detail}</div>
                    <div style="color:#8cf; font-size:10px;">${prog} · ${t.rewardGold} gp · ${t.rewardXp} XP</div>
                  </div>
                  ${action}
                </div>
              </div>`;
            }).join('');
            return `<div style="color:#8fd6a0; font-size:12px; margin:10px 0 6px;">📋 Bulletin Board</div>${taskRows}`;
          })()}
          <div style="color:#8fd6a0; font-size:12px; margin:10px 0 6px;">📜 Quest Board ${activeQuest ? '— <span style="color:#ffd700;">active</span>' : ''}</div>
          ${questRows}
        </div>
        <!-- Right: Quick Market + Sell -->
        <div style="width:320px; overflow-y:auto; padding:10px;">
          <div style="color:#8fd6a0; font-size:12px; margin-bottom:6px;">🏪 Quick Market</div>
          <div style="border:1px solid #2a3a2a; background:#0d130f; border-radius:4px; margin-bottom:10px;">${buyRows || '<div style="color:#666; padding:6px; font-size:11px;">Enter a building to see its shop.</div>'}</div>
          <div style="color:#ca8; font-size:12px; margin-bottom:6px;">⚖ Sell</div>
          <div style="border:1px solid #3a2a2a; background:#130d0d; border-radius:4px;">${sellRows}</div>
          ${(() => {
            const rep = this.townRepProvider();
            const tier = getReputationShopTier(rep);
            const repItems = REPUTATION_SHOP.filter(i => i.repRequired <= rep);
            const nextUnlock = REPUTATION_SHOP.find(i => i.repRequired > rep);
            if (repItems.length === 0 && !nextUnlock) return '';
            const tierBar = `<div style="display:flex; align-items:center; gap:6px; margin:10px 0 6px;">
              <span style="color:#8fd6a0; font-size:12px;">🏆 Reputation Shop</span>
              <span style="color:${tier.color}; font-size:10px; border:1px solid ${tier.color}40; padding:1px 6px; border-radius:8px;">${tier.label} (${rep}/100)</span>
            </div>`;
            const progress = nextUnlock ? `<div style="color:#666; font-size:9px; margin-bottom:6px;">Next unlock at rep ${nextUnlock.repRequired}: ${nextUnlock.name}</div>` : '<div style="color:#ffd700; font-size:9px; margin-bottom:6px;">All reputation items unlocked!</div>';
            const items = repItems.map(item => {
              const adjustedPrice = Math.max(1, Math.floor(item.value * dynamicMod));
              const typeIcon = item.type === 'weapon' ? '⚔️' : item.type === 'armor' ? '🛡️' : item.type === 'potion' ? '🧪' : item.type === 'scroll' ? '📜' : item.type === 'ring' ? '💍' : '✨';
              return `<div style="display:flex; justify-content:space-between; align-items:center; padding:4px 8px; border-bottom:1px solid #1a2430;">
                <div>
                  <div style="color:#d7efe0; font-size:11px;">${typeIcon} ${item.name}</div>
                  <div style="color:#778; font-size:10px;">${item.description}</div>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="color:#ffd700; font-size:11px;">${adjustedPrice} gp</span>
                  <button data-tp-action="buy-rep" data-tp-id="${item.name}" style="padding:2px 8px; background:#3a2745; color:#d7bdf0; border:1px solid #5a3f6a; cursor:pointer; font-family:monospace; font-size:10px;">Buy</button>
                </div>
              </div>`;
            }).join('');
            return `<div style="border:1px solid #2a3a2a; background:#0d0f1a; border-radius:4px; margin-top:10px; padding:6px;">${tierBar}${progress}${items || '<div style="color:#666; padding:4px; font-size:10px;">No items at your reputation level yet.</div>'}</div>`;
          })()}
        </div>
      </div>
      <div style="display:flex; gap:8px; padding:8px 16px; border-top:1px solid #3a4a3a; background:rgba(30,40,30,0.6);">
        <button data-tp-action="rest" style="flex:1; padding:7px; background:#24324a; color:#9ac; border:1px solid #3f5a7a; cursor:pointer; font-family:monospace; font-size:12px;">⛺ Rest</button>
        <button data-tp-action="depart" style="flex:1; padding:7px; background:#274a35; color:#bdf0cf; border:1px solid #3f6b4f; cursor:pointer; font-family:monospace; font-size:12px;">🚪 Depart</button>
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
      const costTag = s.cost > 0 ? `<span style="color:#ffd700; font-size:11px;">${s.cost} gp</span>` : '<span style="color:#8a8; font-size:11px;">Free</span>';
      return `<div style="border:1px solid #2a3a2a; background:#151820; padding:8px; margin-bottom:6px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
        <div style="flex:1;">
          <div style="color:#d7efe0; font-size:12px;">${s.name}</div>
          <div style="color:#888; font-size:10px;">${s.description}</div>
          <div style="color:#8cf; font-size:10px; margin-top:2px;">${s.effect}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-left:12px;">
          ${costTag}
          <button data-tp-action="use-service" data-tp-id="${s.id}" style="padding:3px 10px; background:#274a35; color:#bdf0cf; border:1px solid #3f6b4f; cursor:pointer; font-family:monospace; font-size:11px;">Use</button>
        </div>
      </div>`;
    }).join('') || '<div style="color:#666; padding:8px; font-size:11px;">No services available here.</div>';

    // Shop
    const shopPool = building.shopPool ? SHOP_STOCK[building.shopPool] : null;
    let shopRows = '';
    if (shopPool) {
      shopRows = shopPool.map(item => {
        const adjustedPrice = Math.max(1, Math.floor(item.value * dynamicMod));
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 8px; border-bottom:1px solid #1a2430;">
          <div>
            <div style="color:#d7efe0; font-size:11px;">${item.name}</div>
            <div style="color:#778; font-size:10px;">${item.description}</div>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:#ffd700; font-size:11px;">${adjustedPrice} gp</span>
            <button data-tp-action="buy" data-tp-id="${item.name}" style="padding:2px 8px; background:#274a35; color:#bdf0cf; border:1px solid #3f6b4f; cursor:pointer; font-family:monospace; font-size:10px;">Buy</button>
          </div>
        </div>`;
      }).join('');
    }

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 16px; border-bottom:1px solid #3a4a3a; background:rgba(30,40,30,0.6);">
        <div>
          <div style="color:#ffd700; font-size:15px;">${building.icon} ${building.name}</div>
          <div style="color:#8a8; font-size:10px; margin-top:2px;">${building.description}</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="color:#ffd700; font-size:13px;">💰 ${gold} gp</span>
          <button data-tp-action="leave-building" style="padding:4px 12px; background:#3a2a2a; color:#d8a; border:1px solid #6b4f4f; cursor:pointer; font-family:monospace; font-size:12px;">← Back</button>
        </div>
      </div>
      <div style="display:flex; flex:1; overflow:hidden;">
        <div style="flex:1; overflow-y:auto; padding:10px; border-right:1px solid #2a3a2a;">
          <div style="color:#8fd6a0; font-size:12px; margin-bottom:6px;">⚒ Services</div>
          ${serviceRows}
        </div>
        ${shopPool ? `
        <div style="width:300px; overflow-y:auto; padding:10px;">
          <div style="color:#8fd6a0; font-size:12px; margin-bottom:6px;">🏪 Shop</div>
          <div style="border:1px solid #2a3a2a; background:#0d130f; border-radius:4px;">${shopRows}</div>
        </div>` : ''}
      </div>
      <div style="display:flex; gap:8px; padding:8px 16px; border-top:1px solid #3a4a3a; background:rgba(30,40,30,0.6);">
        <button data-tp-action="rest" style="flex:1; padding:7px; background:#24324a; color:#9ac; border:1px solid #3f5a7a; cursor:pointer; font-family:monospace; font-size:12px;">⛺ Rest</button>
        <button data-tp-action="depart" style="flex:1; padding:7px; background:#274a35; color:#bdf0cf; border:1px solid #3f6b4f; cursor:pointer; font-family:monospace; font-size:12px;">🚪 Depart</button>
      </div>`;
  }
}

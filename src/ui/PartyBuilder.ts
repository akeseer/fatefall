/**
 * The party builder: the screen between "New Run" and the road.
 *
 * The player picks four classes; everything else about the party — names,
 * races, faces, abilities, gear, personalities — is rolled by the generator
 * as it always was. That is the whole design: choosing a class is a real
 * decision that shapes a run, and choosing a name is a chore, so the first is
 * offered and the second is done for you.
 *
 * The screen is a grid of class cards, each with the class's own sprite as
 * the generator will draw it, and four seats above the grid that fill as
 * cards are chosen. Choosing a fifth swaps out the oldest; choosing a chosen
 * one unseats it. A die button rolls a party the way the game used to, for
 * anyone who would rather be surprised.
 */

import { CLASSES } from '../data/gameData';
import { T, classColor } from './Theme';
import { sfx } from '../audio/Sfx';

/** How many adventurers set out. The formation, the AI and the HUD all assume four. */
export const PARTY_SIZE = 4;

/** Sprite pixels are shown at this many screen pixels each. */
const PORTRAIT_SCALE = 3;

/** One-line pitches, since the class descriptions in the data are written for the compendium. */
const ROLE: Record<string, string> = {
  fighter: 'Front line. Hits hard, takes hits.',
  wizard: 'Glass cannon. Fireballs, sleep, shield.',
  cleric: 'Healer and holy hammer.',
  rogue: 'Traps, locks, and knives in the dark.',
  ranger: 'Bow, tracking, a friend to the wild.',
  paladin: 'Armoured faith. Smites and heals.',
  barbarian: 'Rage. More hit points than sense.',
  druid: 'Nature’s magic, and a bear when needed.',
  bard: 'Songs that sharpen blades and dull foes.',
  sorcerer: 'Raw magic in the blood.',
  warlock: 'Borrowed power, eldritch blasts.',
  monk: 'Fists, speed, stillness.',
  artificer: 'Gadgets, infusions, a tinker’s answer to everything.',
  blood_hunter: 'Scarred zealot; bleeds to punish monsters.',
};

export interface PartyBuilderOptions {
  /** The class's sprite as the generator draws it, for the card. */
  portrait: (classId: string) => ImageData;
  /** Four class ids, in seat order. */
  onBegin: (classIds: string[]) => void;
  onBack: () => void;
}

export class PartyBuilder {
  private chosen: string[] = [];
  private root: HTMLElement | null = null;
  private opts: PartyBuilderOptions | null = null;
  private readonly portraits = new Map<string, string>();

  constructor(private readonly overlay: HTMLElement) {}

  show(opts: PartyBuilderOptions): void {
    this.hide();
    this.opts = opts;
    this.chosen = [];
    const root = document.createElement('div');
    root.id = 'party-builder';
    root.style.cssText = `position:absolute; inset:0; z-index:100; overflow:auto; background:radial-gradient(ellipse at 50% 20%, #14100c 0%, #0a0808 55%, #050405 100%); display:flex; flex-direction:column; align-items:center; font-family:${T.bodyFont}; color:${T.text};`;
    root.innerHTML = `
      <style>
        #party-builder .pb-seat { width:92px; height:118px; border:1px solid ${T.line}; border-radius:${T.r3}; background:${T.row}; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:6px; padding:8px 4px; position:relative; }
        #party-builder .pb-seat.filled { border-color:${T.lineHot}; box-shadow:0 0 14px rgba(232,197,106,0.12); }
        #party-builder .pb-seat .pb-num { position:absolute; top:6px; left:8px; font-size:10px; color:${T.faint}; letter-spacing:0.1em; }
        #party-builder .pb-seat img { image-rendering:pixelated; width:${28 * PORTRAIT_SCALE}px; height:${28 * PORTRAIT_SCALE}px; }
        #party-builder .pb-seat .pb-empty { color:${T.faint}; font-size:11px; font-style:italic; margin-bottom:34px; }
        #party-builder .pb-grid { display:grid; grid-template-columns:repeat(7, 118px); gap:10px; margin-top:20px; }
        #party-builder .pb-card { border:1px solid ${T.line}; border-radius:${T.r2}; background:${T.row}; padding:8px 6px 7px; cursor:pointer; text-align:center; transition:transform 90ms ease, border-color 90ms ease; }
        #party-builder .pb-card:hover { border-color:${T.lineHot}; background:${T.rowHot}; transform:translateY(-2px); }
        #party-builder .pb-card.on { border-color:${T.gold}; background:${T.rowHot}; box-shadow:0 0 12px rgba(232,197,106,0.18); }
        #party-builder .pb-card img { image-rendering:pixelated; width:${28 * PORTRAIT_SCALE}px; height:${28 * PORTRAIT_SCALE}px; display:block; margin:0 auto 4px; }
        #party-builder .pb-card .pb-name { font-family:${T.titleFont}; font-size:12px; letter-spacing:0.06em; }
        #party-builder .pb-card .pb-role { font-size:9.5px; color:${T.muted}; line-height:1.3; margin-top:3px; min-height:24px; }
        #party-builder .pb-card .pb-seatno { position:absolute; margin-top:-100px; margin-left:88px; width:18px; height:18px; border-radius:50%; background:${T.gold}; color:${T.ink}; font-size:10px; font-weight:bold; line-height:18px; }
        #party-builder .pb-btn { padding:10px 26px; font-size:14px; font-weight:bold; letter-spacing:1.5px; border-radius:${T.r2}; }
        #party-builder .pb-btn[disabled] { opacity:0.45; cursor:default; }
      </style>
      <div style="max-width:920px; width:96%; text-align:center; padding:28px 0 36px;">
        <div class="dp-title" style="font-size:26px; letter-spacing:0.2em; color:${T.gold};">CHOOSE YOUR PARTY</div>
        <div style="color:${T.muted}; font-style:italic; font-size:12px; margin-top:6px;">Pick four callings. The world will roll their names, faces and fates.</div>
        <div id="pb-seats" style="display:flex; gap:12px; justify-content:center; margin-top:22px;"></div>
        <div class="pb-grid" id="pb-grid"></div>
        <div style="display:flex; gap:12px; justify-content:center; margin-top:26px; align-items:center;">
          <button data-pb="back" class="dp-btn dp-title pb-btn">← Back</button>
          <button data-pb="random" class="dp-btn dp-title pb-btn" title="Roll a party for me">⚄ Surprise Me</button>
          <button data-pb="begin" class="dp-btn-gold dp-title pb-btn" disabled style="box-shadow:0 0 16px rgba(232,197,106,0.22);">✦ Set Out</button>
        </div>
      </div>`;
    this.overlay.appendChild(root);
    this.root = root;

    const grid = root.querySelector('#pb-grid') as HTMLElement;
    grid.innerHTML = CLASSES.map(c => `
      <div class="pb-card" data-class="${c.id}" title="${c.description.replace(/"/g, '&quot;')}">
        <img alt="${c.name}" src="${this.portrait(c.id)}">
        <div class="pb-name" style="color:${classColor(c.id)};">${c.name}</div>
        <div class="pb-role">${ROLE[c.id] ?? ''}</div>
      </div>`).join('');

    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const card = target.closest('[data-class]') as HTMLElement | null;
      if (card) {
        this.toggle(card.dataset.class!);
        return;
      }
      const btn = target.closest('[data-pb]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.pb;
      if (action === 'back') {
        sfx.click();
        this.opts?.onBack();
      } else if (action === 'random') {
        sfx.click();
        this.chosen = rollClasses(PARTY_SIZE);
        this.render();
      } else if (action === 'begin' && this.chosen.length === PARTY_SIZE) {
        sfx.levelUp();
        const picked = [...this.chosen];
        this.opts?.onBegin(picked);
      }
    });

    this.render();
  }

  hide(): void {
    this.root?.remove();
    this.root = null;
    this.opts = null;
  }

  /** Seat or unseat a class. A fifth pick replaces the oldest. */
  private toggle(classId: string): void {
    const at = this.chosen.indexOf(classId);
    if (at >= 0) {
      this.chosen.splice(at, 1);
      sfx.click();
    } else {
      if (this.chosen.length >= PARTY_SIZE) this.chosen.shift();
      this.chosen.push(classId);
      sfx.order();
    }
    this.render();
  }

  private render(): void {
    const root = this.root;
    if (!root) return;
    const seats = root.querySelector('#pb-seats') as HTMLElement;
    seats.innerHTML = Array.from({ length: PARTY_SIZE }, (_, i) => {
      const id = this.chosen[i];
      const cls = id ? CLASSES.find(c => c.id === id) : undefined;
      return `<div class="pb-seat ${cls ? 'filled' : ''}">
        <span class="pb-num">SEAT ${i + 1}</span>
        ${cls
          ? `<img alt="${cls.name}" src="${this.portrait(cls.id)}"><div style="font-size:11px; color:${classColor(cls.id)};">${cls.name}</div>`
          : `<div class="pb-empty">empty</div>`}
      </div>`;
    }).join('');
    for (const card of Array.from(root.querySelectorAll<HTMLElement>('.pb-card'))) {
      const at = this.chosen.indexOf(card.dataset.class!);
      card.classList.toggle('on', at >= 0);
      card.querySelector('.pb-seatno')?.remove();
      if (at >= 0) {
        const badge = document.createElement('div');
        badge.className = 'pb-seatno';
        badge.textContent = String(at + 1);
        card.appendChild(badge);
      }
    }
    const begin = root.querySelector('[data-pb="begin"]') as HTMLButtonElement;
    begin.disabled = this.chosen.length !== PARTY_SIZE;
    begin.textContent = this.chosen.length === PARTY_SIZE ? '✦ Set Out' : `✦ Set Out (${this.chosen.length}/${PARTY_SIZE})`;
  }

  /** The class sprite as a data URL, drawn once per class and kept. */
  private portrait(classId: string): string {
    const cached = this.portraits.get(classId);
    if (cached) return cached;
    let url = '';
    try {
      const data = this.opts!.portrait(classId);
      const c = document.createElement('canvas');
      c.width = data.width;
      c.height = data.height;
      c.getContext('2d')!.putImageData(data, 0, 0);
      url = c.toDataURL();
    } catch {
      /* no sprite: the card keeps its name */
    }
    this.portraits.set(classId, url);
    return url;
  }
}

/** Distinct classes drawn at random, the way createParty used to choose. */
export function rollClasses(count: number): string[] {
  const pool = CLASSES.map(c => c.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

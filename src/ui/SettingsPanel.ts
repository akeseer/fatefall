/**
 * The settings screen: display, graphics and sound, applied as they change.
 *
 * The panel never owns a setting. It asks its host for the current values,
 * draws them, and hands back a whole new object on every change; the game
 * applies it and the panel redraws from what the game now holds, so a change
 * the game could not honour (a renderer that failed to start, a window the
 * shell would not resize) shows its true state rather than the wish.
 */

import { T } from './Theme';
import { sfx } from '../audio/Sfx';
import { getAudio } from '../audio/Audio';
import {
  cloneSettings, presetFor, PRESETS, WINDOW_SIZES, DEFAULT_SETTINGS,
  type GameSettings, type GraphicsPreset, type ScaleMode, type FpsCap, type WeatherLevel, type RendererId,
} from '../settings/Settings';

export interface SettingsHost {
  /** The settings as the game holds them now. */
  get(): GameSettings;
  /** Apply and remember a new set. May be async underneath; the panel redraws on `refresh`. */
  apply(next: GameSettings): void;
  /** Whether the desktop shell is present, which is what makes window sizes and true fullscreen available. */
  shell(): boolean;
  /** One line about the current window, picture and renderer. */
  readout(): string;
}

export class SettingsPanel {
  private root: HTMLElement | null = null;

  constructor(private overlay: HTMLElement, private host: SettingsHost) {}

  isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.root) { this.refresh(); return; }
    const screen = document.createElement('div');
    screen.id = 'settings-screen';
    screen.style.cssText = `position:absolute; inset:0; z-index:106; background:rgba(5,4,5,0.72); display:flex; align-items:center; justify-content:center; font-family:${T.bodyFont}; color:${T.text};`;
    screen.addEventListener('pointerdown', e => e.stopPropagation());
    screen.addEventListener('click', e => { if (e.target === screen) this.close(); });
    this.overlay.appendChild(screen);
    this.root = screen;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.root) { e.stopPropagation(); this.close(); }
    };
    window.addEventListener('keydown', onKey, true);
    (screen as HTMLElement & { _onKey?: (e: KeyboardEvent) => void })._onKey = onKey;
    // The readout names the window, so it follows the window.
    const onResize = () => { if (this.root === screen) this.refresh(); };
    window.addEventListener('resize', onResize);
    (screen as HTMLElement & { _onResize?: () => void })._onResize = onResize;
    this.refresh();
    sfx.click();
  }

  close(): void {
    const root = this.root as (HTMLElement & { _onKey?: (e: KeyboardEvent) => void }) | null;
    if (!root) return;
    if (root._onKey) window.removeEventListener('keydown', root._onKey, true);
    const r2 = root as HTMLElement & { _onResize?: () => void };
    if (r2._onResize) window.removeEventListener('resize', r2._onResize);
    root.remove();
    this.root = null;
    sfx.click();
  }

  /** Redraw from the host's current values. Cheap enough to do on every change. */
  refresh(): void {
    const root = this.root;
    if (!root) return;
    const s = this.host.get();
    const g = s.graphics;
    const d = s.display;
    const shell = this.host.shell();
    const audio = getAudio();
    const preset = presetFor(g);

    const seg = <V extends string | number>(name: string, value: V, options: { v: V; label: string; title?: string }[]) =>
      `<div class="st-seg" data-name="${name}">${options.map(o => `<button data-v="${String(o.v)}" class="${o.v === value ? 'on' : ''}" title="${o.title ?? ''}">${o.label}</button>`).join('')}</div>`;
    const toggle = (name: string, on: boolean, label: string, hint: string) =>
      `<div class="st-row"><label>${label}<small>${hint}</small></label>${seg(name, on ? 'on' : 'off', [{ v: 'on', label: 'On' }, { v: 'off', label: 'Off' }])}</div>`;
    const row = (label: string, hint: string, control: string) =>
      `<div class="st-row"><label>${label}<small>${hint}</small></label>${control}</div>`;
    const head = (text: string) => `<div class="st-head">${text}</div>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;

    root.innerHTML = `
      <style>
        #settings-screen .st-box { width:min(760px, 94%); max-height:90%; overflow:auto; background:${T.windowGrad}; border:1px solid ${T.frame}; border-radius:${T.r3}; box-shadow:0 0 0 1px ${T.rule} inset, 0 24px 60px rgba(0,0,0,0.75); padding:22px 28px 18px; }
        #settings-screen .st-head { font-family:${T.titleFont}; font-size:12px; letter-spacing:0.14em; color:${T.goldDim}; margin:16px 0 6px; border-top:1px solid ${T.rule}; padding-top:12px; }
        #settings-screen .st-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:5px 0; font-size:12.5px; }
        #settings-screen .st-row label { flex:1 1 auto; color:${T.text}; }
        #settings-screen .st-row label small { display:block; font-size:10.5px; color:${T.muted}; font-style:italic; margin-top:1px; }
        #settings-screen .st-seg { display:flex; border:1px solid ${T.line}; border-radius:${T.r2}; overflow:hidden; flex:0 0 auto; }
        #settings-screen .st-seg button { padding:4px 10px; font-size:11px; border:0; border-radius:0; background:transparent; color:${T.muted}; cursor:pointer; font-family:${T.bodyFont}; min-width:44px; }
        #settings-screen .st-seg button + button { border-left:1px solid ${T.line}; }
        #settings-screen .st-seg button:hover { color:${T.gold}; }
        #settings-screen .st-seg button.on { background:${T.rowHot}; color:${T.gold}; }
        #settings-screen .st-seg button:disabled { opacity:0.4; cursor:default; }
        #settings-screen input[type=range] { width:150px; accent-color:${T.gold}; }
        #settings-screen .st-val { display:inline-block; width:38px; text-align:right; font-family:${T.monoFont}; font-size:10.5px; color:${T.gold}; }
        #settings-screen .st-readout { font-size:11px; color:${T.muted}; font-family:${T.monoFont}; margin-top:4px; }
        #settings-screen .st-grid { display:grid; grid-template-columns:1fr 1fr; column-gap:28px; }
      </style>
      <div class="st-box">
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <div class="dp-title" style="font-size:22px; color:${T.gold}; letter-spacing:0.12em;">SETTINGS</div>
          <div style="font-size:10.5px; color:${T.faint}; font-style:italic;">Changes apply at once and are remembered.</div>
        </div>
        <div class="st-readout">${this.host.readout()}</div>

        ${head('DISPLAY')}
        ${row('Window', shell ? 'F11 or Alt+Enter toggles fullscreen.' : 'Fullscreen uses the browser; Esc leaves it.',
          seg('windowMode', d.windowMode, [{ v: 'windowed', label: 'Windowed' }, { v: 'fullscreen', label: 'Fullscreen' }]))}
        ${shell ? row('Window size', 'The window is resized now and opens at this size next time.',
          seg('windowSize', d.windowSize, WINDOW_SIZES.map(w => ({ v: w.id, label: w.label })))) : ''}
        ${row('Scaling', 'How the 1024×768 picture meets the window.',
          seg('scaleMode', d.scaleMode, [
            { v: 'fit', label: 'Fit', title: 'Largest size that fits, letterboxed' },
            { v: 'integer', label: 'Integer', title: 'Whole-pixel multiples only: every texel the same size' },
            { v: 'stretch', label: 'Stretch', title: 'Fill the window; the aspect goes' },
            { v: 'native', label: '1:1', title: 'One texel per pixel, whatever the window' },
          ]))}
        ${row('UI scale', 'The size of the panels and text over the picture.',
          `<span><input type="range" min="70" max="130" step="5" data-name="uiScale" value="${Math.round(d.uiScale * 100)}"><span class="st-val">${pct(d.uiScale)}</span></span>`)}
        ${toggle('sharp', d.sharp, 'Sharp rendering', 'Draw at the display’s density so text and light stay crisp when the window is large.')}

        ${head('GRAPHICS')}
        ${row('Renderer', 'Pixi lights and grades the scene; Canvas runs anywhere.',
          seg('renderer', s.renderer, [{ v: 'pixi', label: 'Pixi' }, { v: 'phaser', label: 'Phaser' }, { v: 'canvas', label: 'Canvas' }]))}
        ${row('Quality', preset ? '' : 'Custom: the switches below are your own mix.',
          seg('preset', preset ?? 'custom', [{ v: 'low', label: 'Low' }, { v: 'medium', label: 'Medium' }, { v: 'high', label: 'High' }, { v: 'ultra', label: 'Ultra' }]))}
        <div class="st-grid">
          <div>
            ${toggle('lighting', g.lighting, 'Dynamic lighting', 'Torchlight, night and the dark beyond the party.')}
            ${row('Weather', 'Rain, snow, fog and sand as particles.',
              seg('weather', g.weather, [{ v: 0, label: 'Off' }, { v: 0.5, label: 'Light' }, { v: 1, label: 'Full' }]))}
            ${toggle('ambience', g.ambience, 'Ambient particles', 'Dust, pollen and fireflies.')}
            ${toggle('bloom', g.bloom, 'Bloom', 'The glow around bright things. The costliest effect.')}
          </div>
          <div>
            ${toggle('vignette', g.vignette, 'Vignette', 'The darkened frame edge.')}
            ${toggle('grade', g.grade, 'Colour grade', 'Dawn, dusk, the weather’s cast and each dungeon’s tint.')}
            ${toggle('shake', g.shake, 'Screen shake', 'Camera shake on criticals and kills.')}
            ${toggle('flash', g.flash, 'Hit flash', 'The white flash when a critical lands.')}
          </div>
        </div>
        ${row('Frame rate cap', 'Lower caps spend less power; the world runs the same.',
          seg('fpsCap', g.fpsCap, [{ v: 30, label: '30' }, { v: 60, label: '60' }, { v: 0, label: 'Uncapped' }]))}

        ${head('SOUND')}
        ${row('Master', '', `<span><input type="range" min="0" max="100" data-bus="master" value="${Math.round(audio.masterVolume * 100)}"><span class="st-val">${pct(audio.masterVolume)}</span></span>`)}
        ${row('Effects', '', `<span><input type="range" min="0" max="100" data-bus="sfx" value="${Math.round(audio.sfxVolume * 100)}"><span class="st-val">${pct(audio.sfxVolume)}</span></span>`)}
        ${row('Music', '', `<span><input type="range" min="0" max="100" data-bus="music" value="${Math.round(audio.musicVolume * 100)}"><span class="st-val">${pct(audio.musicVolume)}</span></span>`)}
        ${row('Mute', 'M toggles it anywhere.', seg('muted', audio.muted ? 'on' : 'off', [{ v: 'on', label: 'Muted' }, { v: 'off', label: 'Sound on' }]))}

        <div style="display:flex; justify-content:space-between; margin-top:18px;">
          <button id="st-reset" class="dp-btn dp-title" style="padding:7px 16px; font-size:11px; letter-spacing:1px; border-radius:${T.r2};">Reset to defaults</button>
          <button id="st-close" class="dp-btn-gold dp-title" style="padding:7px 22px; font-size:12px; letter-spacing:1px; border-radius:${T.r2};">Close</button>
        </div>
      </div>`;

    root.querySelector('#st-close')!.addEventListener('click', () => this.close());
    root.querySelector('#st-reset')!.addEventListener('click', () => {
      const next = cloneSettings(DEFAULT_SETTINGS);
      // The window mode and the renderer are left alone: a reset should not
      // throw the player out of fullscreen or restart the graphics library.
      next.display.windowMode = s.display.windowMode;
      next.display.windowSize = s.display.windowSize;
      next.renderer = s.renderer;
      this.change(next);
    });

    for (const segEl of Array.from(root.querySelectorAll<HTMLElement>('.st-seg'))) {
      const name = segEl.dataset.name!;
      for (const b of Array.from(segEl.querySelectorAll<HTMLButtonElement>('button'))) {
        b.addEventListener('click', () => this.pick(name, b.dataset.v!));
      }
    }
    const ui = root.querySelector<HTMLInputElement>('input[data-name=uiScale]');
    ui?.addEventListener('input', () => {
      const next = cloneSettings(this.host.get());
      next.display.uiScale = Number(ui.value) / 100;
      const val = ui.parentElement?.querySelector('.st-val');
      if (val) val.textContent = `${ui.value}%`;
      this.host.apply(next);
    });
    ui?.addEventListener('change', () => this.refresh());
    for (const sl of Array.from(root.querySelectorAll<HTMLInputElement>('input[data-bus]'))) {
      sl.addEventListener('input', () => {
        audio.setVolumes({ [sl.dataset.bus as 'master' | 'sfx' | 'music']: Number(sl.value) / 100 });
        const val = sl.parentElement?.querySelector('.st-val');
        if (val) val.textContent = `${sl.value}%`;
      });
      sl.addEventListener('change', () => sfx.click());
    }
  }

  private pick(name: string, raw: string): void {
    const next = cloneSettings(this.host.get());
    const on = raw === 'on';
    switch (name) {
      case 'windowMode': next.display.windowMode = raw === 'fullscreen' ? 'fullscreen' : 'windowed'; break;
      case 'windowSize': next.display.windowSize = raw; break;
      case 'scaleMode': next.display.scaleMode = raw as ScaleMode; break;
      case 'sharp': next.display.sharp = on; break;
      case 'renderer': next.renderer = raw as RendererId; break;
      case 'preset': {
        const p = PRESETS[raw as GraphicsPreset];
        if (p) next.graphics = { ...p };
        break;
      }
      case 'weather': next.graphics.weather = Number(raw) as WeatherLevel; break;
      case 'fpsCap': next.graphics.fpsCap = Number(raw) as FpsCap; break;
      case 'lighting': case 'ambience': case 'bloom': case 'vignette': case 'grade': case 'shake': case 'flash':
        next.graphics[name] = on;
        break;
      case 'muted': {
        const audio = getAudio();
        if (audio.muted !== on) audio.toggleMuted();
        this.refresh();
        return;
      }
      default: return;
    }
    this.change(next);
  }

  private change(next: GameSettings): void {
    sfx.click();
    this.host.apply(next);
    this.refresh();
  }
}

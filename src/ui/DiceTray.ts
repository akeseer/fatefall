import { DiceRollEvent, DiceType, onDiceRoll } from '../rules/DiceEvents';
import { T } from './Theme';
import {
  DiceFace,
  buildDieScene,
  buildDiceModel,
  normalize3,
  quatFromAxisAngle,
  quatMul,
  quatRotate,
  quatToMatrix3d,
} from './Dice3D';
import { naturalRollOf } from '../rules/DiceEvents';

const OUTCOME_COLOR: Record<DiceRollEvent['outcome'], string> = {
  crit: '#ffd700',
  fumble: '#ff5555',
  success: '#5fdc5f',
  failure: '#cc6666',
  neutral: '#aab6d0',
  none: '#888888',
};

const DICE_COLOR: Record<DiceType, string> = {
  d4: '#e8d44d',
  d6: '#d44',
  d8: '#4a8',
  d10: '#48d',
  d12: '#a4f',
  d20: '#c33',
  d100: '#da3',
};

/** Rolls that deserve the big 3D die (all the d20 moments). */
const BIG_DIE_KINDS = new Set(['attack', 'save', 'check', 'death-save', 'initiative', 'free']);

type RollPace = 'dramatic' | 'cinematic' | 'combat';

/**
 * Live dice tray with full CSS 3D models for every D&D polyhedron.
 *
 * - Chip strip: the newest 8 rolls as compact cards.
 * - BIG 3D DIE: every meaningful d20 roll — attacks, saves, checks, death
 *   saves, initiative, and DM rolls — gets a tumbling die that settles
 *   exactly on the rolled face. Rolls queue up so dice keep rolling through
 *   combat instead of stacking.
 * - Crits and fumbles break the queue: slow-motion tumble, camera zoom-in on
 *   the landing face, full-screen flash, then the number reveal.
 * - d100 shows two d10s side by side (tens + ones), each settling on its digit.
 */
export class DiceTray {
  private overlay: HTMLElement;
  private strip: HTMLElement;
  private revealTimer?: number;
  /** The latest roll waiting for the current die to finish. */
  private pendingRoll: DiceRollEvent | null = null;
  /**
   * When set, combat d20s are not shown the moment they are rolled. The game
   * plays them itself, one at a time, in step with the blow each one decides
   * (see Game.presentStep); the strip still logs every roll as it happens.
   */
  public deferCombat = false;
  /** Who is waiting for the current big die to finish. */
  private idleWaiters: (() => void)[] = [];
  /** Whether a big-die animation cycle is currently running. */
  private bigRollActive: boolean = false;
  /** Generation counter so superseded animations never touch the DOM. */
  private bigRollGen: number = 0;
  /** Safety net: if an animation chain stalls, force-release the slot. */
  private watchdogTimer?: number;

  /**
   * True while a big-die cycle is running. The game loop freezes on this so
   * the roll actually happens before anything moves on.
   */
  isRolling(): boolean {
    return this.bigRollActive;
  }

  constructor(overlay: HTMLElement) {
    this.overlay = overlay;

    this.strip = document.createElement('div');
    // A flex child of the top strip (title + quest bar + rolls) so the roll
    // chips reserve their own space instead of floating over other UI.
    this.strip.style.cssText =
      `flex:0 1 auto; min-width:0; max-width:300px; display:flex; flex-direction:row-reverse; gap:5px; overflow:hidden; pointer-events:none; font-family:${T.bodyFont}; align-self:center;`;
    const host = overlay.querySelector('#top-strip') ?? overlay;
    host.appendChild(this.strip);

    onDiceRoll((e) => this.onRoll(e));
  }

  private onRoll(e: DiceRollEvent) {
    const color = OUTCOME_COLOR[e.outcome];

    const chip = document.createElement('div');
    chip.style.cssText = `flex:0 0 auto; min-width:74px; max-width:146px; padding:3px 7px; background:rgba(12,10,14,0.92); border:1px solid ${T.line}; border-left:3px solid ${color}; border-radius:${T.r1}; color:${T.text}; opacity:1;`;
    chip.innerHTML = `
      <div style="font-size:8px; color:${T.faint}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(e.label)}</div>
      <div class="dp-num" style="font-size:11px; white-space:nowrap;"><span style="color:${T.muted};">${escapeHtml(e.expression)}</span> <b style="color:${color};">= ${e.total}</b></div>`;
    this.strip.prepend(chip);
    while (this.strip.children.length > 8) {
      this.strip.lastChild?.remove();
    }
    this.popInElement(chip, 260);

    // ── The big die ──────────────────────────────────
    const dramatic = e.outcome === 'crit' || e.outcome === 'fumble';

    // DM rolls always get the cinematic die.
    if (e.kind === 'free') {
      this.showBigRoll(e, dramatic, dramatic ? 'dramatic' : 'cinematic');
      return;
    }

    // Combat d20s: queue when one is already rolling so dice keep tumbling.
    // Crits and fumbles jump the queue for the slow-motion zoom. When the
    // game is presenting the fight itself, it asks for each die by hand.
    if (BIG_DIE_KINDS.has(e.kind)) {
      if (this.deferCombat) return;
      if (dramatic) {
        this.pendingRoll = null;
        this.showBigRoll(e, true, 'dramatic');
      } else if (this.bigRollActive) {
        this.pendingRoll = e;
      } else {
        this.showBigRoll(e, false, 'combat');
      }
      return;
    }

    // Non-d20 rolls: banners only.
    if (dramatic) {
      this.banner(e.kind === 'death-save' ? 'NATURAL 20 — BACK ON YOUR FEET!' : 'NATURAL 20!', '#ffd700');
    } else if (e.outcome === 'fumble') {
      this.banner('NATURAL 1...', '#ff5555');
    }
  }

  // ── Big rolling die ────────────────────────────────

  private showBigRoll(e: DiceRollEvent, dramatic = false, pace: RollPace = 'cinematic') {
    this.clearBigRoll();
    const gen = ++this.bigRollGen;
    this.bigRollActive = true;

    // Watchdog: the game freezes while a die is rolling, so a stalled rAF
    // chain must never hold the game hostage. The budget covers the full
    // tumble + reveal + panel dwell + fade with margin; if it fires, the
    // slot is force-released and the game resumes (the roll already counted).
    // Combat rolls are brisk: the die is one beat of a turn, not the turn.
    // A fight with a three-second die on every swing read as a slideshow, and
    // when the die finally cleared the queued turns tumbled out on top of each other.
    const tumble = dramatic ? 2600 : pace === 'combat' ? 550 : 1500;
    const revealDelay = dramatic ? 900 : pace === 'combat' ? 160 : 550;
    const dwell = dramatic ? 3200 : pace === 'combat' ? 480 : 2600;
    this.watchdogTimer = window.setTimeout(() => this.forceFinishBigRoll(), tumble + revealDelay + dwell + 1200);

    if (e.diceType === 'd100') {
      this.showD100Roll(e, dramatic, gen);
      return;
    }

    this.addCastShadow(false);
    const faces = buildDiceModel(e.diceType);
    const color = DICE_COLOR[e.diceType] || DICE_COLOR.d20;
    const scene = buildDieScene(faces, color, '50%');
    this.overlay.appendChild(scene);
    // The die shows what the die rolled; the modifier is in the total beside it.
    this.animateDieSettle(scene, faces, naturalRollOf(e) ?? e.total, () => {
      if (gen === this.bigRollGen) this.revealBigRoll([scene], e, dramatic, pace, gen);
    }, dramatic, pace);
  }

  private showD100Roll(e: DiceRollEvent, dramatic = false, gen: number) {
    this.clearBigRoll();

    // Two d10s: tens die + ones die (a roll of 100 reads as 00/0).
    const natural = naturalRollOf(e) ?? e.total;
    const tens = Math.floor(natural / 10) % 10;
    const ones = natural % 10;
    this.addCastShadow(true);
    const faces = buildDiceModel('d10');

    const left = buildDieScene(faces, DICE_COLOR.d10, '44%');
    const right = buildDieScene(faces, '#d46', '56%');
    this.overlay.appendChild(left);
    this.overlay.appendChild(right);

    let landed = 0;
    const finish = () => {
      if (++landed === 2 && gen === this.bigRollGen) {
        this.revealBigRoll([left, right], e, dramatic, 'cinematic', gen);
      }
    };
    this.animateDieSettle(left, faces, tens, finish, dramatic, 'cinematic');
    this.animateDieSettle(right, faces, ones, finish, dramatic, 'cinematic');
  }

  /**
   * A grounded cast shadow beneath the tumbling die, so it reads as resting
   * on the battlefield instead of floating over it. A soft ellipse anchored
   * just below the die's center; the die tumbles in place above it and the
   * shadow fades out with the die at reveal.
   */
  private addCastShadow(wide: boolean) {
    const shadow = document.createElement('div');
    shadow.id = 'big-die-shadow';
    const w = wide ? 142 : 106;
    const h = wide ? 24 : 20;
    shadow.style.cssText = `position:absolute; top:calc(40% + 70px); left:50%; transform:translateX(-50%); width:${w}px; height:${h}px; border-radius:50%; background:radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.28) 55%, transparent 72%); z-index:94; pointer-events:none;`;
    this.overlay.appendChild(shadow);
  }

  /**
   * Tumble the die and settle it exactly with the rolled result's face up.
   *
   * The final orientation is a quaternion that (a) maps the target face's
   * normal to +Z (facing the viewer) and (b) rolls about that axis so the
   * face's number is right-side up. The tumble is a decaying rotation about
   * a wobbling in-plane axis, so the die lands precisely on that pose.
   */
  private animateDieSettle(scene: HTMLElement, faces: DiceFace[], result: number, onDone: () => void, dramatic = false, pace: RollPace = 'cinematic') {
    let target = faces.find(f => f.value === result) ?? null;
    let override: string | null = null;
    if (!target) {
      // Multi-die totals (e.g. 2d6+3 = 13) can't be a single face — land
      // anywhere and show the total on the top face in gold.
      target = faces[Math.floor(Math.random() * faces.length)];
      override = String(result);
    }
    if (override) {
      const span = scene.children[target.index]?.querySelector('span');
      if (span) {
        span.textContent = override;
        const el = span as HTMLElement;
        el.style.color = '#ffd700';
        el.style.textShadow = '0 0 8px rgba(255,215,0,0.8)';
      }
    }

    const Z: [number, number, number] = [0, 0, 1];
    // Rotate the die so the target face's normal points at the viewer.
    const qSettle = quatFromUnitVecs(target.normal, Z);
    // Then roll about the face normal so the number sits upright.
    const vWorld = quatRotate(qSettle, target.v);
    const beta = Math.atan2(vWorld[0], vWorld[1]);
    const qFinal = quatMul(quatFromAxisAngle(Z, beta), qSettle);

    // Tumble: a decaying spin about a wobbling in-plane axis.
    const phi = Math.random() * Math.PI * 2;
    const axis0 = normalize3([Math.cos(phi), Math.sin(phi), (Math.random() - 0.5) * 0.6]);
    const drift = normalize3(cross3(axis0, Z));
    // Dramatic rolls (nat 20 / nat 1) spin longer, die away in slow motion,
    // and the "camera" zooms in on the landing face. Combat rolls are
    // snappier so the queue keeps moving.
    const theta0 = (dramatic ? 4.5 + Math.random() * 1.5 : pace === 'combat' ? 2 + Math.random() * 1.5 : 2.5 + Math.random() * 2) * Math.PI * 2;
    const duration = dramatic ? 2600 : pace === 'combat' ? 550 : 1500;
    const decay = dramatic ? 3.4 : pace === 'combat' ? 1.9 : 2.2;
    const start = performance.now();

    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const theta = theta0 * Math.pow(1 - t, decay);
      const wob = Math.sin(t * Math.PI * 3) * 0.4;
      const axis = normalize3([
        axis0[0] + drift[0] * wob,
        axis0[1] + drift[1] * wob,
        axis0[2],
      ]);
      const q = quatMul(qFinal, quatFromAxisAngle(axis, theta));
      if (dramatic) {
        // Slow-motion push-in: rotation has all but stopped while the
        // camera rushes to the face (accelerating zoom, 1.5× at rest).
        const zoom = 1 + 0.5 * Math.pow(t, 2.2);
        scene.style.transform = `${quatToMatrix3d(q)} scale(${zoom.toFixed(3)})`;
      } else {
        scene.style.transform = quatToMatrix3d(q);
      }
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        onDone();
      }
    };
    requestAnimationFrame(frame);
  }

  /** Show the result panel, then fade the landed die away. */
  private revealBigRoll(scenes: HTMLElement[], e: DiceRollEvent, dramatic = false, pace: RollPace = 'cinematic', gen: number) {
    const color = OUTCOME_COLOR[e.outcome];
    const delay = dramatic ? 900 : pace === 'combat' ? 300 : 550;

    this.revealTimer = window.setTimeout(() => {
      if (gen !== this.bigRollGen) return;

      if (dramatic) {
        // Full-screen radial flash in the outcome color behind the reveal.
        const flash = document.createElement('div');
        flash.id = 'big-die-flash';
        flash.style.cssText = `position:absolute; inset:0; background:radial-gradient(circle, ${color}45 0%, ${color}1c 45%, transparent 75%); z-index:94; pointer-events:none;`;
        this.overlay.appendChild(flash);
        this.fadeOutElement(flash, 1000, true);
      }

      const panel = document.createElement('div');
      panel.id = 'big-die-result';
      // Base styles are set directly (visible immediately) — the pop-in
      // animation is a pure enhancement, so a stalled WAAPI animation can
      // never leave the result invisible.
      panel.style.cssText = `position:absolute; top:40%; left:50%; transform:translate(-50%,-50%); text-align:center; font-family:${T.bodyFont}; z-index:95; pointer-events:none;`;
      const size = dramatic ? 76 : pace === 'combat' ? 46 : 58;
      panel.innerHTML = `
        <div style="font-size:12px; color:#99a;">${escapeHtml(e.label)}</div>
        <div style="font-size:${size}px; font-weight:bold; line-height:1.1; color:${color}; text-shadow:0 2px 2px rgba(0,0,0,0.55);">${e.total}</div>
        <div style="font-size:13px; color:#aab;">${escapeHtml(e.expression)}</div>`;
      this.overlay.appendChild(panel);
      this.popInElement(panel, 350);

      // Fade the landed die away. Driven by rAF (same loop as the tumble,
      // which provably runs here) with a hard timeout fallback — WAAPI
      // onfinish alone is not enough in throttled webviews, where animations
      // can be created with a null start time and never advance, leaving a
      // ghost die on screen forever. The cast shadow goes with the die so
      // nothing lingers after the reveal.
      for (const scene of scenes) {
        this.fadeOutElement(scene, 450);
      }
      const shadow = this.overlay.querySelector('#big-die-shadow');
      if (shadow) this.fadeOutElement(shadow as HTMLElement, 450);

      this.revealTimer = window.setTimeout(() => {
        if (gen === this.bigRollGen) panel.remove();
        this.finishBigRoll();
      }, dramatic ? 3200 : pace === 'combat' ? 1800 : 2600);
    }, delay);
  }

  /**
   * Pop an element in (scale up + fade in).
   *
   * rAF-driven like fadeOutElement: the base styles stay visible, and the
   * animation is a pure enhancement, so a stalled frame loop can never leave
   * the element invisible or stuck at the first keyframe.
   */
  private popInElement(el: HTMLElement, duration: number) {
    const start = performance.now();
    const frame = (now: number) => {
      if (!el.isConnected) return;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const scale = 0.85 + 0.15 * eased;
      el.style.opacity = String(Math.min(1, eased * 1.25));
      el.style.transform = el.style.transform.includes('translate(-50%,-50%)')
        ? `translate(-50%,-50%) scale(${scale.toFixed(3)})`
        : `scale(${scale.toFixed(3)})`;
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /**
   * Fade an element to opacity 0 and remove it.
   *
   * Driven by requestAnimationFrame (the same loop that provably runs the
   * die tumble here) with a hard setTimeout fallback, so cleanup never
   * depends on WAAPI animation completion — in throttled webviews animations
   * can sit in a pending state (null start time) forever, leaving ghost UI.
   */
  private fadeOutElement(el: HTMLElement, duration: number, remove: boolean = true) {
    const start = performance.now();
    const frame = (now: number) => {
      if (!el.isConnected) return;
      const t = Math.min(1, (now - start) / duration);
      el.style.opacity = String(1 - t);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else if (remove) {
        el.remove();
      }
    };
    requestAnimationFrame(frame);
    window.setTimeout(() => { if (el.isConnected && remove) el.remove(); }, duration + 200);
  }

  /** Release the animation slot and roll the next queued die. */
  private finishBigRoll() {
    if (this.watchdogTimer !== undefined) {
      window.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    this.bigRollActive = false;
    this.settleWaiters();
    const next = this.pendingRoll;
    this.pendingRoll = null;
    if (next) {
      const dramatic = next.outcome === 'crit' || next.outcome === 'fumble';
      const pace: RollPace = next.kind === 'free' ? 'cinematic' : dramatic ? 'dramatic' : 'combat';
      this.showBigRoll(next, dramatic, pace);
    }
  }

  /** Emergency release — the game must never freeze on a stalled die. */
  /**
   * Play one roll's die now and resolve when it has landed and cleared. Used
   * by the game to put a die in front of the blow it decided.
   */
  playRoll(e: DiceRollEvent): Promise<void> {
    const dramatic = e.outcome === 'crit' || e.outcome === 'fumble';
    return new Promise<void>(resolve => {
      this.idleWaiters.push(resolve);
      this.pendingRoll = null;
      this.showBigRoll(e, dramatic, dramatic ? 'dramatic' : 'combat');
    });
  }

  private settleWaiters(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private forceFinishBigRoll() {
    if (!this.bigRollActive) return;
    this.bigRollActive = false;
    this.settleWaiters();
    this.pendingRoll = null;
    this.overlay.querySelectorAll('.big-die').forEach(el => el.remove());
    this.overlay.querySelector('#big-die-result')?.remove();
    this.overlay.querySelector('#big-die-flash')?.remove();
    this.overlay.querySelector('#big-die-shadow')?.remove();
  }

  private clearBigRoll() {
    if (this.revealTimer !== undefined) {
      window.clearTimeout(this.revealTimer);
      this.revealTimer = undefined;
    }
    if (this.watchdogTimer !== undefined) {
      window.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    this.overlay.querySelectorAll('.big-die').forEach(el => el.remove());
    this.overlay.querySelector('#big-die-result')?.remove();
    this.overlay.querySelector('#big-die-flash')?.remove();
    this.overlay.querySelector('#big-die-shadow')?.remove();
  }

  private banner(text: string, color: string) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `position:absolute; top:36%; left:0; right:0; text-align:center; font-family:${T.monoFont}; font-size:40px; font-weight:bold; color:${color}; text-shadow:0 0 22px ${color}; z-index:90; pointer-events:none;`;
    this.overlay.appendChild(el);
    // Pop-in via rAF, then fade out and remove. No WAAPI dependency — same
    // reason as everywhere else: stalled animations leave ghost UI behind.
    this.popInElement(el, 220);
    window.setTimeout(() => this.fadeOutElement(el, 500), 800);
  }
}

/** Shortest-arc rotation taking unit vector `from` to unit vector `to`. */
function quatFromUnitVecs(from: number[], to: number[]): [number, number, number, number] {
  const d = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  if (d > 0.9999) return [1, 0, 0, 0];
  if (d < -0.9999) {
    // 180° about any axis perpendicular to `from`.
    const ref = Math.abs(from[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return quatFromAxisAngle(cross3(from, ref), Math.PI);
  }
  return quatFromAxisAngle(cross3(from, to), Math.acos(d));
}

function cross3(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

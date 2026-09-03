/**
 * Screen transitions: the cut to black when the party goes somewhere, and
 * the blinds that close over the map when a fight begins.
 *
 * Every change of place in the game was a hard cut — one frame the road, the
 * next frame the dungeon — and a fight began by a window appearing over the
 * map. Both are the kind of thing a JRPG never does. A cut to black and a fade
 * up on the new place says "you have gone somewhere"; the blinds say "and now
 * this is a battle".
 *
 * ── Where it sits ──
 *
 * On the stage above the world, not inside it. The world is lit, weathered
 * and colour-graded; this is the lens, and the lens is not. It is also not
 * torn down with the world each frame, so it is added once and drives its
 * own sprites from the mood.
 *
 * ── Who owns the timing ──
 *
 * The game does. It stamps `mood.transition` with a kind and a progress from
 * 0 to 1, and this file only maps progress to a picture. That keeps the two
 * backends that draw transitions in exact agreement, since they read the same
 * number, and it means a stutter changes nothing the player can see.
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { SceneMood } from '../../DrawCommand';
import { transitionShape } from '../../DrawCommand';

// ── Tunables ──

/** How many blinds close over the map. Eight is the classic count; more reads as a shutter. */
const BLIND_COUNT = 8;

/** The lens: black, in the shapes the game asks for. */
export class Transition {
  readonly layer: Container;
  private readonly blinds: Sprite[] = [];
  private readonly black: Sprite;
  /** The white hit of a critical, over everything including a transition. */
  private readonly white: Sprite;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.layer = new Container();
    this.layer.interactiveChildren = false;
    this.layer.visible = false;

    const barH = Math.ceil(height / BLIND_COUNT);
    for (let i = 0; i < BLIND_COUNT; i++) {
      const bar = new Sprite(Texture.WHITE);
      bar.tint = 0x000000;
      bar.height = barH;
      bar.position.y = i * barH;
      bar.visible = false;
      this.layer.addChild(bar);
      this.blinds.push(bar);
    }

    this.black = new Sprite(Texture.WHITE);
    this.black.tint = 0x000000;
    this.black.width = width;
    this.black.height = height;
    this.black.visible = false;
    this.layer.addChild(this.black);

    this.white = new Sprite(Texture.WHITE);
    this.white.width = width;
    this.white.height = height;
    this.white.visible = false;
    this.layer.addChild(this.white);
  }

  update(mood: SceneMood): void {
    const t = mood.transition;
    const flash = mood.flash ?? 0;
    this.white.visible = flash > 0.005;
    this.white.alpha = flash;
    if (!t) {
      for (const b of this.blinds) b.visible = false;
      this.black.visible = false;
      this.layer.visible = this.white.visible;
      return;
    }
    this.layer.visible = true;

    // Blinds: alternate bars grow from opposite sides, so the map is eaten
    // from both edges at once rather than wiped from one. A fade asks for no
    // blinds at all and comes through the same path with them hidden.
    const { closed, black } = transitionShape(t.kind, t.progress);
    const w = Math.round(this.width * closed);
    for (let i = 0; i < this.blinds.length; i++) {
      const bar = this.blinds[i];
      bar.visible = w > 0;
      bar.width = w;
      bar.position.x = i % 2 === 0 ? 0 : this.width - w;
      bar.alpha = 1;
    }
    this.black.visible = black > 0;
    this.black.alpha = black;
  }

  destroy(): void {
    this.layer.destroy({ children: true });
  }
}

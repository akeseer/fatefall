import { describe, it, expect } from 'vitest';
import { RecordingContext, bakeImage } from '../src/rendering/RecordingContext';
import type { DrawCommand, SceneMood } from '../src/rendering/DrawCommand';

const MOOD: SceneMood = { daylight: 1, underground: false, weather: null, focus: null, inCombat: false };

/** A recorder mid-frame, which is the only state the game ever draws into. */
function recorder(mood: SceneMood = MOOD): RecordingContext {
  const ctx = new RecordingContext();
  ctx.begin('#000', mood);
  return ctx;
}

/** Most cases draw one thing; asserting on the whole command pins its shape. */
function only(ctx: RecordingContext): DrawCommand {
  const { commands } = ctx.end();
  expect(commands).toHaveLength(1);
  return commands[0];
}

// Node has no ImageData global, and the recorder only ever reads width, height
// and data, so a plain object standing in for one is enough.
function imageData(width: number, height: number, fill = 0): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(fill);
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}

describe('fillRect', () => {
  it('captures the fill and alpha in force at the moment of the call', () => {
    const ctx = recorder();
    ctx.fillStyle = '#ff0000';
    ctx.globalAlpha = 0.5;
    ctx.fillRect(1, 2, 3, 4);
    // Later state must not reach back into a command already recorded: the
    // renderer sets these thousands of times per frame between draws.
    ctx.fillStyle = '#00ff00';
    ctx.globalAlpha = 1;

    expect(only(ctx)).toEqual({ op: 'rect', x: 1, y: 2, w: 3, h: 4, fill: '#ff0000', alpha: 0.5 });
  });

  it('bakes the current translate into the recorded position', () => {
    const ctx = recorder();
    ctx.translate(10, 20);
    ctx.translate(5, -5);
    ctx.fillRect(1, 1, 2, 2);

    expect(only(ctx)).toMatchObject({ x: 16, y: 16, w: 2, h: 2 });
  });

  it('leaves width and height untranslated', () => {
    const ctx = recorder();
    ctx.translate(100, 100);
    ctx.fillRect(0, 0, 8, 9);

    expect(only(ctx)).toMatchObject({ w: 8, h: 9 });
  });
});

describe('save and restore', () => {
  it('round-trips every piece of state it claims to', () => {
    const ctx = recorder();
    ctx.fillStyle = '#111';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.25;
    ctx.font = '20px serif';
    ctx.textAlign = 'center';
    ctx.translate(7, 8);

    ctx.save();
    ctx.fillStyle = '#999';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 12;
    ctx.globalAlpha = 1;
    ctx.font = '5px sans-serif';
    ctx.textAlign = 'right';
    ctx.translate(100, 100);
    ctx.restore();

    expect(ctx.fillStyle).toBe('#111');
    expect(ctx.strokeStyle).toBe('#222');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.globalAlpha).toBe(0.25);
    expect(ctx.font).toBe('20px serif');
    expect(ctx.textAlign).toBe('center');

    // The transform is only observable through a draw.
    ctx.fillRect(0, 0, 1, 1);
    expect(only(ctx)).toMatchObject({ x: 7, y: 8 });
  });

  it('nests, so an inner restore only undoes the inner save', () => {
    const ctx = recorder();
    ctx.translate(10, 0);
    ctx.save();
    ctx.translate(10, 0);
    ctx.save();
    ctx.translate(10, 0);
    ctx.restore();
    ctx.fillRect(0, 0, 1, 1);

    expect(only(ctx)).toMatchObject({ x: 20 });
  });

  it('ignores a restore with nothing saved instead of throwing', () => {
    const ctx = recorder();
    ctx.fillStyle = '#abc';
    ctx.translate(4, 4);

    expect(() => ctx.restore()).not.toThrow();
    expect(ctx.fillStyle).toBe('#abc');
    ctx.fillRect(0, 0, 1, 1);
    expect(only(ctx)).toMatchObject({ x: 4, y: 4 });
  });
});

describe('gradients', () => {
  it('records a linear fill as a gradient command carrying its stops', () => {
    const ctx = recorder();
    const g = ctx.createLinearGradient(0, 0, 10, 40);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(2, 3, 10, 40);

    expect(only(ctx)).toEqual({
      op: 'gradient', kind: 'linear', x: 2, y: 3, w: 10, h: 40,
      stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000' }], alpha: 0.75,
    });
  });

  it('records a radial fill and translates its origin like any other draw', () => {
    const ctx = recorder();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 8);
    g.addColorStop(0, '#ffcc66');
    ctx.fillStyle = g;
    ctx.translate(50, 50);
    ctx.fillRect(0, 0, 16, 16);

    expect(only(ctx)).toMatchObject({ op: 'gradient', kind: 'radial', x: 50, y: 50 });
  });

  it('collapses a gradient to its first stop where only a solid colour fits', () => {
    const ctx = recorder();
    const g = ctx.createLinearGradient(0, 0, 1, 1);
    g.addColorStop(0, '#123456');
    g.addColorStop(1, '#654321');
    ctx.strokeStyle = g;
    ctx.strokeRect(0, 0, 4, 4);

    expect(only(ctx)).toMatchObject({ op: 'strokeRect', stroke: '#123456' });
  });

  it('falls back to black for a gradient with no stops', () => {
    const ctx = recorder();
    ctx.fillStyle = ctx.createLinearGradient(0, 0, 1, 1);
    ctx.fillText('hi', 0, 0);

    expect(only(ctx)).toMatchObject({ op: 'text', fill: '#000' });
  });
});

describe('paths', () => {
  it('records an open stroked polyline with its points translated', () => {
    const ctx = recorder();
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 2;
    ctx.translate(1, 1);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 0);
    ctx.lineTo(10, 10);
    ctx.stroke();

    expect(only(ctx)).toEqual({
      op: 'path',
      points: [{ x: 1, y: 1 }, { x: 11, y: 1 }, { x: 11, y: 11 }],
      stroke: '#eee', lineWidth: 2, closed: false, alpha: 1,
    });
  });

  it('marks a stroked path closed once closePath is called', () => {
    const ctx = recorder();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(4, 0);
    ctx.closePath();
    ctx.stroke();

    expect(only(ctx)).toMatchObject({ closed: true });
  });

  it('treats a filled path as closed whether or not closePath was called', () => {
    const ctx = recorder();
    ctx.fillStyle = '#0f0';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(4, 0);
    ctx.lineTo(4, 4);
    ctx.fill();

    expect(only(ctx)).toMatchObject({ op: 'path', fill: '#0f0', closed: true });
  });

  it('drops beginPath state so a second shape does not inherit the first', () => {
    const ctx = recorder();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(1, 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(5, 5);
    ctx.lineTo(6, 6);
    ctx.stroke();

    const { commands } = ctx.end();
    expect(commands).toHaveLength(2);
    expect(commands[1]).toMatchObject({ points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] });
  });

  it('records nothing for an empty path', () => {
    const ctx = recorder();
    ctx.beginPath();
    ctx.fill();
    ctx.stroke();

    expect(ctx.end().commands).toEqual([]);
  });
});

describe('arc', () => {
  it('turns arc plus fill into a filled circle at the translated centre', () => {
    const ctx = recorder();
    ctx.fillStyle = '#ffd';
    ctx.lineWidth = 1;
    ctx.translate(10, 10);
    ctx.beginPath();
    ctx.arc(5, 6, 3, 0, Math.PI * 2);
    ctx.fill();

    expect(only(ctx)).toEqual({ op: 'circle', x: 15, y: 16, r: 3, fill: '#ffd', lineWidth: 1, alpha: 1 });
  });

  it('turns arc plus stroke into an outlined circle', () => {
    const ctx = recorder();
    ctx.strokeStyle = '#f0f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.stroke();

    expect(only(ctx)).toMatchObject({ op: 'circle', stroke: '#f0f', lineWidth: 4 });
  });

  it('consumes the arc, so filling then stroking does not double it', () => {
    const ctx = recorder();
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // The second call finds no circle and no points, so it records nothing.
    expect(ctx.end().commands).toHaveLength(1);
  });
});

describe('frame boundaries', () => {
  it('begin drops the previous frame and resets transform, alpha and the stack', () => {
    const ctx = recorder();
    ctx.fillRect(0, 0, 1, 1);
    ctx.translate(30, 40);
    ctx.globalAlpha = 0.1;
    ctx.save();
    ctx.save();

    ctx.begin('#0a0a12', MOOD);
    ctx.fillRect(0, 0, 1, 1);

    expect(ctx.globalAlpha).toBe(1);
    expect(only(ctx)).toEqual({ op: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#000', alpha: 1 });

    // A stale save must not survive into the new frame's transform either.
    ctx.restore();
    ctx.fillRect(0, 0, 1, 1);
    expect(ctx.end().commands[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('end returns the clear colour and the mood it was begun with', () => {
    const mood: SceneMood = { daylight: 0.2, underground: true, weather: 'rain', focus: { x: 4, y: 5 }, inCombat: true };
    const ctx = new RecordingContext();
    ctx.begin('#123', mood);

    const frame = ctx.end();
    expect(frame.clear).toBe('#123');
    expect(frame.mood).toBe(mood);
  });
});

describe('putImageData', () => {
  // Regression guard. Sprites reach the screen through putImageData, and the
  // backends used to replay it with the real ctx.putImageData, which REPLACES
  // pixels including their alpha: every sprite punched a fully transparent
  // rectangle through the terrain and the page background showed through as a
  // dark box. The fix was to record the sprite as an ordinary `image` draw so
  // the backends composite it. If this ever goes back to writing pixels, the
  // dark boxes come back, so the contract is pinned here.
  it('records the sprite as a composited image draw, not a pixel write', () => {
    const ctx = recorder();
    const data = imageData(2, 3, 200);
    ctx.putImageData(data, 12, 34);

    const cmd = only(ctx);
    expect(cmd).toMatchObject({ op: 'image', x: 12, y: 34, alpha: 1 });
    expect(cmd).toMatchObject({ image: { width: 2, height: 3 } });
    expect((cmd as { image: { rgba: Uint8ClampedArray } }).image.rgba).toBe(data.data);
  });

  it('ignores the transform, matching the call it stands in for', () => {
    // Deliberate: the real putImageData is untransformed too, and the game only
    // translates for two flourishes, neither of which draws a sprite.
    const ctx = recorder();
    ctx.translate(64, 64);
    ctx.putImageData(imageData(1, 1), 5, 5);

    expect(only(ctx)).toMatchObject({ x: 5, y: 5 });
  });
});

describe('bakeImage', () => {
  it('mints one stable id per ImageData identity', () => {
    const a = imageData(1, 1);
    const b = imageData(1, 1);

    // Backends key their texture cache on this id, so the sprite cache handing
    // back the same object must not upload a new texture every frame.
    expect(bakeImage(a).id).toBe(bakeImage(a).id);
    expect(bakeImage(a).id).not.toBe(bakeImage(b).id);
  });

  it('carries the pixels by reference rather than copying them', () => {
    const data = imageData(4, 4);
    const baked = bakeImage(data);

    expect(baked.rgba).toBe(data.data);
    expect(baked.width).toBe(4);
    expect(baked.height).toBe(4);
  });
});

/** Core game engine constants and types */

export const TILE_SIZE = 32;
export const MAP_WIDTH = 72;
export const MAP_HEIGHT = 72;

/** The massive overworld the party starts in. */
export const OVERWORLD_WIDTH = 320;
export const OVERWORLD_HEIGHT = 220;

export const GAME_WIDTH = 1024;
export const GAME_HEIGHT = 768;

export enum Direction {
  Up = 'up',
  Down = 'down',
  Left = 'left',
  Right = 'right',
}

export interface Vector2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function vec2(x: number, y: number): Vector2 {
  return { x, y };
}

export function distance(a: Vector2, b: Vector2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function manhattan(a: Vector2, b: Vector2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
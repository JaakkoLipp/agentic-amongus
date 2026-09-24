/** World-space vector. One world unit equals one map tile. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const ZERO: Vec2 = { x: 0, y: 0 };

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const distSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function normalize(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  return len < 1e-9 ? ZERO : { x: a.x / len, y: a.y / len };
}

/** Clamp a direction input so its length never exceeds 1 (diagonal WASD is not faster). */
export function clampUnit(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y);
  return len > 1 ? { x: a.x / len, y: a.y / len } : a;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export type CompassDirection = "north" | "south" | "east" | "west" | "northeast" | "northwest" | "southeast" | "southwest";

/** Screen-style coordinates: +y points south. */
export function compassDirection(delta: Vec2): CompassDirection | null {
  if (Math.hypot(delta.x, delta.y) < 1e-6) return null;
  const angle = Math.atan2(-delta.y, delta.x); // 0 = east, counter-clockwise, north positive
  const octant = Math.round(angle / (Math.PI / 4));
  switch ((octant + 8) % 8) {
    case 0:
      return "east";
    case 1:
      return "northeast";
    case 2:
      return "north";
    case 3:
      return "northwest";
    case 4:
      return "west";
    case 5:
      return "southwest";
    case 6:
      return "south";
    default:
      return "southeast";
  }
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const rectContains = (r: Rect, p: Vec2): boolean => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
export const rectCenter = (r: Rect): Vec2 => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

import type { AreaId, Vec2 } from "@deduction/shared";
import type { GameMap } from "./compile";

/** Half-extent of a player's collision box, in tiles. */
export const PLAYER_RADIUS = 0.3;

export function isWalkableTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return false;
  return map.walkable[ty * map.width + tx] === 1;
}

export const isWalkablePoint = (map: GameMap, p: Vec2): boolean => isWalkableTile(map, Math.floor(p.x), Math.floor(p.y));

/** True if a player-sized box centred at p overlaps only walkable tiles. */
export function boxFits(map: GameMap, p: Vec2, r: number = PLAYER_RADIUS): boolean {
  const x0 = Math.floor(p.x - r);
  const x1 = Math.floor(p.x + r);
  const y0 = Math.floor(p.y - r);
  const y1 = Math.floor(p.y + r);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!isWalkableTile(map, x, y)) return false;
  return true;
}

export function areaAt(map: GameMap, p: Vec2): AreaId | null {
  const tx = Math.floor(p.x);
  const ty = Math.floor(p.y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null;
  const idx = map.areaIndex[ty * map.width + tx] as number;
  return idx < 0 ? null : (map.areas[idx]?.id ?? null);
}

export const areaName = (map: GameMap, id: AreaId | null): string => (id ? (map.areaById.get(id)?.name ?? id) : "unknown");

/**
 * Axis-separated movement with box-vs-tile collision (slides along walls). Per-tick displacement must stay below
 * one tile, which holds for every legal speed at 30 Hz.
 */
export function moveWithCollision(map: GameMap, pos: Vec2, delta: Vec2, r: number = PLAYER_RADIUS): Vec2 {
  const EPS = 1e-4;
  let x = pos.x + delta.x;
  let y = pos.y;
  if (delta.x !== 0 && !boxFits(map, { x, y }, r)) {
    x = delta.x > 0 ? Math.floor(x + r) - r - EPS : Math.floor(x - r) + 1 + r + EPS;
    if (!boxFits(map, { x, y }, r)) x = pos.x;
  }
  y = pos.y + delta.y;
  if (delta.y !== 0 && !boxFits(map, { x, y }, r)) {
    y = delta.y > 0 ? Math.floor(y + r) - r - EPS : Math.floor(y - r) + 1 + r + EPS;
    if (!boxFits(map, { x, y }, r)) y = pos.y;
  }
  return { x, y };
}

/**
 * Grid line of sight (Amanatides–Woo voxel traversal). Any wall or obstacle tile on the segment blocks sight.
 * Symmetric up to floating point on exact tile corners, which both directions resolve the same way here because
 * we always traverse from the lexicographically smaller endpoint.
 */
export function hasLineOfSight(map: GameMap, a: Vec2, b: Vec2): boolean {
  if (a.x > b.x || (a.x === b.x && a.y > b.y)) return traverse(map, b, a);
  return traverse(map, a, b);
}

function traverse(map: GameMap, a: Vec2, b: Vec2): boolean {
  let tx = Math.floor(a.x);
  let ty = Math.floor(a.y);
  const ex = Math.floor(b.x);
  const ey = Math.floor(b.y);
  if (!isWalkableTile(map, tx, ty)) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX > 0 ? (tx + 1 - a.x) * tDeltaX : stepX < 0 ? (a.x - tx) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (ty + 1 - a.y) * tDeltaY : stepY < 0 ? (a.y - ty) * tDeltaY : Infinity;
  let guard = map.width + map.height + 4;
  while (tx !== ex || ty !== ey) {
    if (guard-- <= 0) break;
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      tx += stepX;
    } else if (tMaxY < tMaxX) {
      tMaxY += tDeltaY;
      ty += stepY;
    } else {
      // Passing exactly through a tile corner: blocked if either side tile is solid (no peeking through diagonal gaps).
      if (!isWalkableTile(map, tx + stepX, ty) || !isWalkableTile(map, tx, ty + stepY)) return false;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      tx += stepX;
      ty += stepY;
    }
    if (!isWalkableTile(map, tx, ty)) return false;
    // Next boundary crossing lies beyond b: we are in the final tile (guards against floating-point drift).
    if (tMaxX > 1 && tMaxY > 1) break;
  }
  return isWalkableTile(map, ex, ey);
}

/** True if a player box can slide in a straight line from a to b (used for path smoothing). */
export function segmentClear(map: GameMap, a: Vec2, b: Vec2, r: number = PLAYER_RADIUS): boolean {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(d / 0.2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!boxFits(map, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r)) return false;
  }
  return true;
}

/** Nearest walkable tile centre to p (p itself if its tile is walkable and the player box fits). */
export function nearestWalkable(map: GameMap, p: Vec2): Vec2 {
  if (boxFits(map, p)) return p;
  const cx = Math.floor(p.x);
  const cy = Math.floor(p.y);
  for (let radius = 0; radius < Math.max(map.width, map.height); radius++) {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius) continue;
        if (!isWalkableTile(map, x, y)) continue;
        const c = { x: x + 0.5, y: y + 0.5 };
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best) return best;
  }
  return p;
}

import { isWalkableTile, type GameMap } from "@deduction/maps";
import type { Vec2 } from "@deduction/shared";

/**
 * Distance from `o` along `angle` to the first wall/furniture tile (grid DDA, the same traversal the engine uses for
 * line of sight), capped at `max`. Only public map geometry and the player's own position go in, so drawing the
 * light polygon reveals nothing the player could not already work out.
 */
export function castRay(map: GameMap, o: Vec2, angle: number, max: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let tx = Math.floor(o.x);
  let ty = Math.floor(o.y);
  if (!isWalkableTile(map, tx, ty)) return 0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = stepX > 0 ? (tx + 1 - o.x) * tDeltaX : stepX < 0 ? (o.x - tx) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (ty + 1 - o.y) * tDeltaY : stepY < 0 ? (o.y - ty) * tDeltaY : Infinity;
  for (;;) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (t >= max) return max;
    if (!isWalkableTile(map, tx, ty)) return t;
  }
}

/** Light polygon (flat x,y list in tile units) around `o`. Rays stop a little inside walls so wall faces are lit. */
export function visibilityPolygon(map: GameMap, o: Vec2, radius: number, rays = 256, wallBleed = 0.45): number[] {
  const pts: number[] = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const d = castRay(map, o, a, radius);
    const r = d >= radius ? radius : Math.min(radius, d + wallBleed);
    pts.push(o.x + Math.cos(a) * r, o.y + Math.sin(a) * r);
  }
  return pts;
}

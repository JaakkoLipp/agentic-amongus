import type { Vec2 } from "@deduction/shared";
import type { GameMap } from "./compile";
import { isWalkableTile, nearestWalkable, segmentClear } from "./geometry";

/**
 * Pathfinding on the tile grid (8-connected, no corner cutting).
 *
 * - Points of interest (stations, vents, room centres, the emergency button) get a lazily computed distance field,
 *   so routing to them is a cheap gradient descent and "how far is X" is an O(1) lookup.
 * - Anything else (following a moving player, fleeing, wandering) uses A*.
 * Both produce tile routes that are then compressed and string-pulled into a few waypoints.
 */

const SQRT2 = Math.SQRT2;
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

const tileIndexOf = (map: GameMap, p: Vec2): number => Math.floor(p.y) * map.width + Math.floor(p.x);
const tileCenter = (map: GameMap, i: number): Vec2 => ({ x: (i % map.width) + 0.5, y: Math.floor(i / map.width) + 0.5 });

function canStep(map: GameMap, x: number, y: number, dx: number, dy: number): boolean {
  if (!isWalkableTile(map, x + dx, y + dy)) return false;
  if (dx !== 0 && dy !== 0) return isWalkableTile(map, x + dx, y) && isWalkableTile(map, x, y + dy);
  return true;
}

/** Binary min-heap over (priority, node) with lazy deletion. */
class MinHeap {
  private prio: Float64Array;
  private node: Int32Array;
  size = 0;
  constructor(capacity: number) {
    this.prio = new Float64Array(capacity);
    this.node = new Int32Array(capacity);
  }
  clear(): void {
    this.size = 0;
  }
  push(p: number, n: number): void {
    if (this.size >= this.prio.length) this.grow();
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.prio[parent] as number) <= p) break;
      this.prio[i] = this.prio[parent] as number;
      this.node[i] = this.node[parent] as number;
      i = parent;
    }
    this.prio[i] = p;
    this.node[i] = n;
  }
  /** Returns the node with smallest priority; caller must check size > 0. */
  pop(): number {
    const top = this.node[0] as number;
    const lastP = this.prio[--this.size] as number;
    const lastN = this.node[this.size] as number;
    let i = 0;
    const half = this.size >> 1;
    while (i < half) {
      let child = 2 * i + 1;
      const right = child + 1;
      if (right < this.size && (this.prio[right] as number) < (this.prio[child] as number)) child = right;
      if ((this.prio[child] as number) >= lastP) break;
      this.prio[i] = this.prio[child] as number;
      this.node[i] = this.node[child] as number;
      i = child;
    }
    this.prio[i] = lastP;
    this.node[i] = lastN;
    return top;
  }
  private grow(): void {
    const p = new Float64Array(this.prio.length * 2);
    const n = new Int32Array(this.node.length * 2);
    p.set(this.prio);
    n.set(this.node);
    this.prio = p;
    this.node = n;
  }
}

interface Scratch {
  g: Float64Array;
  parent: Int32Array;
  stamp: Uint32Array;
  closed: Uint32Array;
  generation: number;
  heap: MinHeap;
}
const scratchByMap = new WeakMap<GameMap, Scratch>();
function scratchFor(map: GameMap): Scratch {
  let s = scratchByMap.get(map);
  if (!s) {
    const n = map.width * map.height;
    s = { g: new Float64Array(n), parent: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), generation: 0, heap: new MinHeap(1024) };
    scratchByMap.set(map, s);
  }
  return s;
}

/** Tiles for which distance fields are worth caching. */
const poiTilesByMap = new WeakMap<GameMap, Set<number>>();
function poiTiles(map: GameMap): Set<number> {
  let set = poiTilesByMap.get(map);
  if (!set) {
    set = new Set<number>();
    const add = (p: Vec2) => set!.add(tileIndexOf(map, p));
    map.def.taskStations.forEach((s) => add(s.pos));
    map.def.sabotageStations.forEach((s) => add(s.pos));
    map.def.vents.forEach((v) => add(v.pos));
    add(map.def.emergencyButton.pos);
    map.areas.forEach((a) => add(a.center));
    poiTilesByMap.set(map, set);
  }
  return set;
}

/** Dijkstra distance (in tiles) from every tile to `goalTile`. Unreachable = Infinity. */
export function distanceField(map: GameMap, goalTile: number): Float32Array {
  const cached = map.distanceFieldCache.get(goalTile);
  if (cached) return cached;
  const n = map.width * map.height;
  const dist = new Float32Array(n).fill(Infinity);
  const heap = new MinHeap(4096);
  dist[goalTile] = 0;
  heap.push(0, goalTile);
  while (heap.size > 0) {
    const i = heap.pop();
    const d = dist[i] as number;
    const x = i % map.width;
    const y = (i - x) / map.width;
    for (const [dx, dy, cost] of NEIGHBOURS) {
      if (!canStep(map, x, y, dx, dy)) continue;
      const j = (y + dy) * map.width + (x + dx);
      const nd = d + cost;
      if (nd < (dist[j] as number)) {
        dist[j] = nd;
        heap.push(nd, j);
      }
    }
  }
  map.distanceFieldCache.set(goalTile, dist);
  return dist;
}

/** Walking distance between two points (tiles). Exact for points of interest, A* otherwise. Infinity if unreachable. */
export function travelDistance(map: GameMap, from: Vec2, to: Vec2): number {
  const goal = tileIndexOf(map, nearestWalkable(map, to));
  const start = tileIndexOf(map, nearestWalkable(map, from));
  if (poiTiles(map).has(goal) || map.distanceFieldCache.has(goal)) return distanceField(map, goal)[start] as number;
  const route = aStarTiles(map, start, goal);
  if (!route) return Infinity;
  let total = 0;
  for (let k = 1; k < route.length; k++) {
    const a = route[k - 1] as number;
    const b = route[k] as number;
    total += Math.abs(a - b) === 1 || Math.abs(a - b) === map.width ? 1 : SQRT2;
  }
  return total;
}

/**
 * Route from `from` to `to` as a short list of waypoints (excluding `from`, ending at `to` or the nearest walkable
 * point to it). Returns null if unreachable.
 */
export function findPath(map: GameMap, from: Vec2, to: Vec2): Vec2[] | null {
  const target = nearestWalkable(map, to);
  const startPos = nearestWalkable(map, from);
  const start = tileIndexOf(map, startPos);
  const goal = tileIndexOf(map, target);
  if (start === goal) return segmentClear(map, from, target) ? [target] : [tileCenter(map, goal), target];

  let tiles: number[] | null;
  if (poiTiles(map).has(goal) || map.distanceFieldCache.has(goal)) tiles = descendField(map, distanceField(map, goal), start, goal);
  else tiles = aStarTiles(map, start, goal);
  if (!tiles) return null;

  // Keep the start and goal tile centres as candidate waypoints: endpoints are usually off-centre, and smoothing
  // may only drop a point when the straight segment around it is actually clear.
  const corners = compressRoute(tiles);
  const points: Vec2[] = [from, ...corners.map((i) => tileCenter(map, i)), target];
  return smooth(map, points);
}

function descendField(map: GameMap, field: Float32Array, start: number, goal: number): number[] | null {
  if (!Number.isFinite(field[start] as number)) return null;
  const route = [start];
  let i = start;
  let guard = map.width * map.height;
  while (i !== goal && guard-- > 0) {
    const x = i % map.width;
    const y = (i - x) / map.width;
    let best = -1;
    let bestD = field[i] as number;
    for (const [dx, dy] of NEIGHBOURS) {
      if (!canStep(map, x, y, dx, dy)) continue;
      const j = (y + dy) * map.width + (x + dx);
      const d = field[j] as number;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) return null;
    route.push(best);
    i = best;
  }
  return i === goal ? route : null;
}

function aStarTiles(map: GameMap, start: number, goal: number): number[] | null {
  if (start === goal) return [start];
  const s = scratchFor(map);
  s.generation = (s.generation + 1) >>> 0;
  if (s.generation === 0) {
    s.stamp.fill(0);
    s.closed.fill(0);
    s.generation = 1;
  }
  const gen = s.generation;
  const heap = s.heap;
  heap.clear();
  const gx = goal % map.width;
  const gy = (goal - gx) / map.width;
  const h = (i: number): number => {
    const x = i % map.width;
    const y = (i - x) / map.width;
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };
  s.g[start] = 0;
  s.parent[start] = -1;
  s.stamp[start] = gen;
  heap.push(h(start), start);
  while (heap.size > 0) {
    const i = heap.pop();
    if (s.closed[i] === gen) continue;
    s.closed[i] = gen;
    if (i === goal) {
      const route: number[] = [];
      for (let k = goal; k !== -1; k = s.parent[k] as number) route.push(k);
      return route.reverse();
    }
    const x = i % map.width;
    const y = (i - x) / map.width;
    const gi = s.g[i] as number;
    for (const [dx, dy, cost] of NEIGHBOURS) {
      if (!canStep(map, x, y, dx, dy)) continue;
      const j = (y + dy) * map.width + (x + dx);
      if (s.closed[j] === gen) continue;
      const ng = gi + cost;
      if (s.stamp[j] !== gen || ng < (s.g[j] as number)) {
        s.stamp[j] = gen;
        s.g[j] = ng;
        s.parent[j] = i;
        heap.push(ng + h(j), j);
      }
    }
  }
  return null;
}

/** Keep only the tiles where the route changes direction. */
function compressRoute(tiles: readonly number[]): number[] {
  if (tiles.length <= 2) return [...tiles];
  const out = [tiles[0] as number];
  let prevDir = (tiles[1] as number) - (tiles[0] as number);
  for (let k = 1; k < tiles.length - 1; k++) {
    const dir = (tiles[k + 1] as number) - (tiles[k] as number);
    if (dir !== prevDir) out.push(tiles[k] as number);
    prevDir = dir;
  }
  out.push(tiles[tiles.length - 1] as number);
  return out;
}

/**
 * Greedy string pulling: skip points while the player box can slide straight to a later one. Consecutive tile
 * centres of an 8-connected route without corner cutting are always mutually clear, so the fallback step is safe.
 */
function smooth(map: GameMap, points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  let i = 0;
  const last = points.length - 1;
  while (i < last) {
    let j = i + 1;
    const limit = Math.min(last, i + 8);
    for (let k = limit; k > j; k--) {
      if (segmentClear(map, points[i] as Vec2, points[k] as Vec2)) {
        j = k;
        break;
      }
    }
    const next = points[j] as Vec2;
    const prev = out[out.length - 1];
    if (!prev || prev.x !== next.x || prev.y !== next.y) out.push(next);
    i = j;
  }
  return out;
}

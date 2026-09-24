import type { AreaId, Rect, StationId, Vec2, VentId } from "@deduction/shared";
import type { CompiledArea, Doorway, MapDefinition, SabotageStationDef, TaskStationDef, VentDef } from "./types";

/**
 * Runtime form of a map: tile grids plus lookup tables. Immutable after compilation except for lazily filled
 * caches (distance fields, pathfinding scratch buffers), which never affect results.
 */
export interface GameMap {
  readonly def: MapDefinition;
  readonly id: string;
  readonly version: string;
  readonly width: number;
  readonly height: number;
  /** 1 = walkable floor, 0 = wall/obstacle. Index = y * width + x. */
  readonly walkable: Uint8Array;
  /** Area index per tile, -1 for walls. */
  readonly areaIndex: Int16Array;
  readonly areas: readonly CompiledArea[];
  readonly areaById: ReadonlyMap<AreaId, CompiledArea>;
  /** Room graph: areas that share a doorway. */
  readonly adjacency: ReadonlyMap<AreaId, readonly AreaId[]>;
  readonly doorways: readonly Doorway[];
  readonly taskStationById: ReadonlyMap<StationId, TaskStationDef>;
  readonly sabotageStationById: ReadonlyMap<StationId, SabotageStationDef>;
  readonly ventById: ReadonlyMap<VentId, VentDef>;
  /** Symmetrized vent links. */
  readonly ventLinks: ReadonlyMap<VentId, readonly VentId[]>;
  /** Lazily computed per-target distance fields (see pathfinding.ts). */
  readonly distanceFieldCache: Map<number, Float32Array>;
}

export class MapValidationError extends Error {}

export function compileMap(def: MapDefinition): GameMap {
  const { width, height } = def;
  const walkable = new Uint8Array(width * height);
  const areaIndex = new Int16Array(width * height).fill(-1);

  def.areas.forEach((area, index) => {
    for (const r of area.rects) {
      forEachTile(r, width, height, (i) => {
        walkable[i] = 1;
        if (areaIndex[i] === -1) areaIndex[i] = index;
      });
    }
  });
  for (const r of def.obstacles) {
    forEachTile(r, width, height, (i) => {
      walkable[i] = 0;
      areaIndex[i] = -1;
    });
  }
  // Outer border is always wall so movement/LOS never index out of bounds.
  for (let x = 0; x < width; x++) {
    walkable[x] = 0;
    walkable[(height - 1) * width + x] = 0;
  }
  for (let y = 0; y < height; y++) {
    walkable[y * width] = 0;
    walkable[y * width + width - 1] = 0;
  }

  const sums = def.areas.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = areaIndex[y * width + x] as number;
      if (a < 0) continue;
      const s = sums[a]!;
      s.x += x + 0.5;
      s.y += y + 0.5;
      s.n++;
    }
  }
  const areas: CompiledArea[] = def.areas.map((a, index) => {
    const s = sums[index]!;
    if (s.n === 0) throw new MapValidationError(`area ${a.id} has no walkable tiles`);
    const centroid = { x: s.x / s.n, y: s.y / s.n };
    return { ...a, index, tileCount: s.n, center: snapCenterIntoArea(centroid, index, areaIndex, width, height) };
  });
  const areaById = new Map(areas.map((a) => [a.id, a]));

  const { adjacency, doorways } = deriveDoorways(areas, areaIndex, width, height);

  const ventLinks = new Map<VentId, VentId[]>();
  for (const v of def.vents) ventLinks.set(v.id, []);
  for (const v of def.vents) {
    for (const other of v.links) {
      if (!ventLinks.has(other)) throw new MapValidationError(`vent ${v.id} links to unknown vent ${other}`);
      const a = ventLinks.get(v.id)!;
      const b = ventLinks.get(other)!;
      if (!a.includes(other)) a.push(other);
      if (!b.includes(v.id)) b.push(v.id);
    }
  }

  const map: GameMap = {
    def,
    id: def.id,
    version: def.version,
    width,
    height,
    walkable,
    areaIndex,
    areas,
    areaById,
    adjacency,
    doorways,
    taskStationById: new Map(def.taskStations.map((s) => [s.id, s])),
    sabotageStationById: new Map(def.sabotageStations.map((s) => [s.id, s])),
    ventById: new Map(def.vents.map((v) => [v.id, v])),
    ventLinks,
    distanceFieldCache: new Map(),
  };
  validateMap(map);
  return map;
}

function forEachTile(r: Rect, width: number, height: number, fn: (index: number) => void): void {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) fn(y * width + x);
}

/** Non-convex areas (or areas with furniture) may have a centroid on a wall; snap to the nearest own tile. */
function snapCenterIntoArea(c: Vec2, index: number, areaIndex: Int16Array, width: number, height: number): Vec2 {
  const cx = Math.floor(c.x);
  const cy = Math.floor(c.y);
  if (areaIndex[cy * width + cx] === index) return c;
  let best: Vec2 = c;
  let bestD = Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (areaIndex[y * width + x] !== index) continue;
      const d = (x + 0.5 - c.x) ** 2 + (y + 0.5 - c.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: x + 0.5, y: y + 0.5 };
      }
    }
  }
  return best;
}

function deriveDoorways(areas: readonly CompiledArea[], areaIndex: Int16Array, width: number, height: number) {
  const pairTiles = new Map<string, Vec2[]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = areaIndex[y * width + x] as number;
      if (a < 0) continue;
      // Look right and down so each boundary is visited once.
      const neighbours: [number, number][] = [
        [x + 1, y],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx >= width || ny >= height) continue;
        const b = areaIndex[ny * width + nx] as number;
        if (b < 0 || b === a) continue;
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const key = `${lo}:${hi}`;
        const list = pairTiles.get(key) ?? [];
        list.push({ x: (x + nx) / 2 + 0.5, y: (y + ny) / 2 + 0.5 });
        pairTiles.set(key, list);
      }
    }
  }
  const adjacency = new Map<AreaId, AreaId[]>(areas.map((a) => [a.id, []]));
  const doorways: Doorway[] = [];
  for (const [key, tiles] of [...pairTiles.entries()].sort(([k1], [k2]) => (k1 < k2 ? -1 : 1))) {
    const [lo, hi] = key.split(":").map(Number) as [number, number];
    const a = areas[lo]!;
    const b = areas[hi]!;
    adjacency.get(a.id)!.push(b.id);
    adjacency.get(b.id)!.push(a.id);
    const center = tiles.reduce((acc, t) => ({ x: acc.x + t.x / tiles.length, y: acc.y + t.y / tiles.length }), { x: 0, y: 0 });
    doorways.push({ id: `${a.id}~${b.id}`, areas: [a.id, b.id], tiles, center });
  }
  return { adjacency, doorways };
}

function validateMap(map: GameMap): void {
  const { def } = map;
  const problems: string[] = [];
  const ids = new Set<string>();
  const checkId = (id: string) => {
    if (ids.has(id)) problems.push(`duplicate id ${id}`);
    ids.add(id);
  };
  const checkPoint = (label: string, pos: Vec2, roomId: AreaId) => {
    const tx = Math.floor(pos.x);
    const ty = Math.floor(pos.y);
    const i = ty * map.width + tx;
    if (map.walkable[i] !== 1) problems.push(`${label} at (${pos.x},${pos.y}) is not on a walkable tile`);
    const area = map.areas[map.areaIndex[i] as number];
    if (area && area.id !== roomId) problems.push(`${label} is in ${area.id}, declared ${roomId}`);
    if (!map.areaById.has(roomId)) problems.push(`${label} references unknown area ${roomId}`);
  };
  for (const a of def.areas) checkId(a.id);
  for (const s of def.taskStations) {
    checkId(s.id);
    checkPoint(`task station ${s.id}`, s.pos, s.roomId);
  }
  for (const s of def.sabotageStations) {
    checkId(s.id);
    checkPoint(`sabotage station ${s.id}`, s.pos, s.roomId);
  }
  for (const v of def.vents) {
    checkId(v.id);
    checkPoint(`vent ${v.id}`, v.pos, v.roomId);
  }
  checkPoint("emergency button", def.emergencyButton.pos, def.emergencyButton.roomId);

  // Every walkable tile must be reachable from the spawn point.
  const start = Math.floor(def.spawn.center.y) * map.width + Math.floor(def.spawn.center.x);
  if (map.walkable[start] !== 1) problems.push("spawn center is not walkable");
  const seen = new Uint8Array(map.walkable.length);
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const i = queue.pop()!;
    const x = i % map.width;
    const y = (i - x) / map.width;
    for (const [nx, ny] of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const) {
      const j = ny * map.width + nx;
      if (map.walkable[j] === 1 && seen[j] === 0) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  let unreachable = 0;
  for (let i = 0; i < map.walkable.length; i++) if (map.walkable[i] === 1 && seen[i] === 0) unreachable++;
  if (unreachable > 0) problems.push(`${unreachable} walkable tiles are unreachable from spawn`);

  for (const kind of ["lights", "reactor", "oxygen", "comms"] as const) {
    if (!def.sabotageStations.some((s) => s.kind === kind)) problems.push(`no repair station for ${kind}`);
  }
  if (problems.length > 0) throw new MapValidationError(`Map ${def.id} invalid:\n  ${problems.join("\n  ")}`);
}

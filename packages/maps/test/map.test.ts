import { describe, expect, it } from "vitest";
import { deriveRng, dist, type Rng, type Vec2 } from "@deduction/shared";
import {
  areaAt,
  boxFits,
  compileMap,
  findPath,
  getMap,
  hasLineOfSight,
  isWalkablePoint,
  MapValidationError,
  moveWithCollision,
  nearestWalkable,
  OUTPOST_KAPPA,
  PLAYER_RADIUS,
  segmentClear,
  travelDistance,
  type GameMap,
  type MapDefinition,
} from "../src";

const map = getMap("outpost-kappa");

/** Tile centres where a player box fits. */
const freeTiles: Vec2[] = [];
for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (boxFits(map, { x: x + 0.5, y: y + 0.5 })) freeTiles.push({ x: x + 0.5, y: y + 0.5 });

/** Random point (anywhere in its tile) where a player box fits. */
function randomFreePoint(rng: Rng): Vec2 {
  for (;;) {
    const c = rng.pick(freeTiles);
    const p = { x: c.x + rng.float(-0.5, 0.5), y: c.y + rng.float(-0.5, 0.5) };
    if (boxFits(map, p)) return p;
  }
}

function pointsOfInterest(m: GameMap): { label: string; pos: Vec2 }[] {
  return [
    ...m.def.taskStations.map((s) => ({ label: `task ${s.id}`, pos: s.pos })),
    ...m.def.sabotageStations.map((s) => ({ label: `sabotage ${s.id}`, pos: s.pos })),
    ...m.def.vents.map((v) => ({ label: `vent ${v.id}`, pos: v.pos })),
    { label: "emergency button", pos: m.def.emergencyButton.pos },
  ];
}

describe("map compilation", () => {
  it("the map compiles and validates", () => {
    expect(() => compileMap(OUTPOST_KAPPA)).not.toThrow();
    expect(getMap("outpost-kappa")).toBe(map); // cached
    expect(() => getMap("no-such-map")).toThrow(/Unknown map/);
    expect(map.width * map.height).toBe(map.walkable.length);
    expect(map.def.taskStations).toHaveLength(22);
    expect(map.def.sabotageStations).toHaveLength(6);
    expect(map.def.vents).toHaveLength(11);
    // Every declared point lies in its declared area, on a tile where a player can stand.
    for (const s of [...map.def.taskStations, ...map.def.sabotageStations, ...map.def.vents]) {
      expect(areaAt(map, s.pos), s.id).toBe(s.roomId);
      expect(boxFits(map, s.pos), s.id).toBe(true);
    }
    expect(areaAt(map, map.def.emergencyButton.pos)).toBe("commons");
    expect(map.def.emergencyButton.pos).toEqual({ x: 50, y: 35 });
    // The border is solid.
    for (let x = 0; x < map.width; x++) expect(isWalkablePoint(map, { x: x + 0.5, y: 0.5 }) || isWalkablePoint(map, { x: x + 0.5, y: map.height - 0.5 })).toBe(false);
  });

  it("rejects invalid definitions", () => {
    const broken = (patch: Partial<MapDefinition>): MapDefinition => ({ ...OUTPOST_KAPPA, ...patch });
    const station = OUTPOST_KAPPA.taskStations[0]!;
    expect(() => compileMap(broken({ taskStations: [{ ...station, pos: { x: 0.5, y: 0.5 } }] }))).toThrow(MapValidationError);
    expect(() => compileMap(broken({ taskStations: [{ ...station, roomId: "commons" }] }))).toThrow(/declared commons/);
    expect(() => compileMap(broken({ taskStations: [station, station] }))).toThrow(/duplicate id/);
    expect(() => compileMap(broken({ vents: [{ ...OUTPOST_KAPPA.vents[0]!, links: ["vent_nowhere"] }] }))).toThrow(/unknown vent/);
    expect(() => compileMap(broken({ sabotageStations: OUTPOST_KAPPA.sabotageStations.filter((s) => s.kind !== "lights") }))).toThrow(/no repair station for lights/);
    // An island room that no corridor reaches.
    const island = { id: "island", name: "Island", kind: "room" as const, rects: [{ x: 70, y: 4, w: 4, h: 4 }] };
    expect(() => compileMap(broken({ areas: [...OUTPOST_KAPPA.areas, island] }))).toThrow(/unreachable from spawn/);
  });
});

describe("reachability", () => {
  it("every task/sabotage station, vent and the button is reachable from spawn", () => {
    const spawn = map.def.spawn.center;
    for (const { label, pos } of pointsOfInterest(map)) {
      const d = travelDistance(map, spawn, pos);
      expect(Number.isFinite(d), label).toBe(true);
      expect(d, label).toBeGreaterThanOrEqual(dist(spawn, pos) - 1.5);
      const path = findPath(map, spawn, pos);
      expect(path, label).not.toBeNull();
      const end = path!.at(-1)!;
      // The route ends close enough to use the station.
      expect(dist(end, pos), label).toBeLessThanOrEqual(1.4);
      expect(boxFits(map, end), label).toBe(true);
    }
  });

  it("every room is reachable from every other room", () => {
    for (const a of map.areas) {
      for (const b of map.areas) expect(Number.isFinite(travelDistance(map, a.center, b.center)), `${a.id} -> ${b.id}`).toBe(true);
    }
  });
});

describe("geometry properties", () => {
  it("hasLineOfSight is symmetric over many random point pairs", () => {
    const rng = deriveRng(11, "los");
    let visible = 0;
    const N = 5_000;
    for (let i = 0; i < N; i++) {
      const pick = (): Vec2 => {
        const mode = i % 3;
        if (mode === 0) return randomFreePoint(rng); // floor
        if (mode === 1) return { x: rng.int(0, map.width), y: rng.int(0, map.height) }; // exact tile corners
        return { x: rng.float(0, map.width), y: rng.float(0, map.height) }; // anywhere, walls included
      };
      const a = pick();
      // Bias half of the pairs to be close together so both outcomes occur often.
      const b = i % 2 === 0 ? pick() : { x: a.x + rng.float(-8, 8), y: a.y + rng.float(-8, 8) };
      const ab = hasLineOfSight(map, a, b);
      expect(hasLineOfSight(map, b, a), `(${a.x},${a.y}) <-> (${b.x},${b.y})`).toBe(ab);
      if (ab) visible++;
    }
    expect(visible).toBeGreaterThan(N / 20);
    expect(visible).toBeLessThan(N);
  });

  it("hasLineOfSight: open floor sees, walls and furniture block", () => {
    expect(hasLineOfSight(map, { x: 40.5, y: 34.5 }, { x: 56.5, y: 34.5 })).toBe(true); // across the Commons
    expect(hasLineOfSight(map, { x: 40.5, y: 27.5 }, { x: 40.5, y: 22.5 })).toBe(false); // Commons -> North Hall wall
    expect(hasLineOfSight(map, { x: 43.5, y: 27.5 }, { x: 43.5, y: 32.5 })).toBe(false); // through a table
    expect(hasLineOfSight(map, { x: 49.5, y: 27.5 }, { x: 49.5, y: 22.5 })).toBe(true); // through the north doorway
  });

  it("moveWithCollision fuzz never ends with the box overlapping a wall", () => {
    const rng = deriveRng(12, "move");
    let moves = 0;
    let blocked = 0;
    for (let walk = 0; walk < 400; walk++) {
      let pos = randomFreePoint(rng);
      const maxStep = walk % 2 === 0 ? 0.4 : 0.95; // legal per-tick speeds, then near the one-tile limit
      let dir = { x: rng.float(-1, 1), y: rng.float(-1, 1) };
      for (let k = 0; k < 25; k++) {
        if (k % 5 === 0) dir = { x: rng.float(-1, 1), y: rng.float(-1, 1) };
        const len = Math.hypot(dir.x, dir.y) || 1;
        const speed = rng.float(0, maxStep);
        const delta = rng.chance(0.1) ? { x: rng.pick([-maxStep, 0, maxStep]), y: rng.pick([-maxStep, 0, maxStep]) } : { x: (dir.x / len) * speed, y: (dir.y / len) * speed };
        const next = moveWithCollision(map, pos, delta);
        moves++;
        expect(boxFits(map, next), `from (${pos.x}, ${pos.y}) by (${delta.x}, ${delta.y})`).toBe(true);
        // Never moves further than asked (up to the 1e-4 wall-snap epsilon).
        expect(Math.abs(next.x - pos.x)).toBeLessThanOrEqual(Math.abs(delta.x) + 2e-4);
        expect(Math.abs(next.y - pos.y)).toBeLessThanOrEqual(Math.abs(delta.y) + 2e-4);
        if (dist(next, pos) < Math.hypot(delta.x, delta.y) - 1e-6) blocked++;
        pos = next;
      }
    }
    expect(moves).toBe(10_000);
    expect(blocked).toBeGreaterThan(100); // the fuzz really did run into walls
  });

  it("moveWithCollision slides along walls instead of stopping", () => {
    // Walking diagonally into the Commons' north wall keeps the x motion.
    const start = { x: 40.5, y: 26.0 + PLAYER_RADIUS + 0.01 };
    const next = moveWithCollision(map, start, { x: 0.2, y: -0.2 });
    expect(next.x).toBeCloseTo(40.7, 6);
    expect(next.y).toBeGreaterThanOrEqual(26 + PLAYER_RADIUS - 1e-3);
    expect(boxFits(map, next)).toBe(true);
  });

  /** Check one route: every waypoint walkable, every consecutive segment clear for the player box. */
  function checkRoute(from: Vec2, to: Vec2): void {
    const label = `(${from.x},${from.y}) -> (${to.x},${to.y})`;
    const path = findPath(map, from, to);
    expect(path, label).not.toBeNull();
    let prev = from;
    for (const wp of path!) {
      expect(boxFits(map, wp), `${label}: waypoint (${wp.x},${wp.y})`).toBe(true);
      expect(segmentClear(map, prev, wp), `${label}: segment (${prev.x},${prev.y}) -> (${wp.x},${wp.y})`).toBe(true);
      prev = wp;
    }
    expect(path!.at(-1)).toEqual(to);
    // A route is never shorter than the straight line, and not absurdly longer than the tile distance.
    const length = path!.reduce((acc, wp, k) => acc + dist(k === 0 ? from : path![k - 1]!, wp), 0);
    expect(length, label).toBeGreaterThanOrEqual(dist(from, to) - 1e-6);
    expect(length, label).toBeLessThanOrEqual(travelDistance(map, from, to) + 3);
  }

  it("findPath waypoints are all walkable and consecutive segments are clear (endpoints near tile centres)", () => {
    const rng = deriveRng(13, "paths");
    // Within 0.2 of a tile centre the player box stays inside its tile.
    const nearCentre = (): Vec2 => {
      const c = rng.pick(freeTiles);
      return { x: c.x + rng.float(-0.2, 0.2), y: c.y + rng.float(-0.2, 0.2) };
    };
    for (let i = 0; i < 600; i++) checkRoute(nearCentre(), nearCentre());
    // Points of interest to and from spawn, too.
    for (const { pos } of pointsOfInterest(map)) {
      checkRoute(map.def.spawn.center, pos);
      checkRoute(pos, map.def.spawn.center);
    }
  });

  // Regression: off-centre endpoints once produced a straight segment clipping the East Passage wall corner.
  it("findPath segments are clear for arbitrary (off-centre) endpoints", () => {
    checkRoute({ x: 84.62353530107066, y: 35.93795475852676 }, { x: 21.5, y: 35.5 });
    const rng = deriveRng(13, "paths-any");
    for (let i = 0; i < 400; i++) checkRoute(randomFreePoint(rng), randomFreePoint(rng));
  });

  it("findPath to an unwalkable target ends at the nearest walkable point", () => {
    const wall = { x: 40.5, y: 24.5 }; // wall between Commons and North Hall
    const path = findPath(map, map.def.spawn.center, wall);
    expect(path).not.toBeNull();
    const end = path!.at(-1)!;
    expect(end).toEqual(nearestWalkable(map, wall));
    expect(boxFits(map, end)).toBe(true);
  });
});

describe("room graph", () => {
  it("adjacency is symmetric and includes the expected links", () => {
    for (const [a, list] of map.adjacency) {
      expect(new Set(list).size, a).toBe(list.length);
      expect(list, a).not.toContain(a);
      for (const b of list) expect(map.adjacency.get(b), `${b} -> ${a}`).toContain(a);
    }
    const linked = (a: string, b: string) => map.adjacency.get(a)?.includes(b) ?? false;
    for (const [a, b] of [
      ["commons", "north_hall"],
      ["commons", "south_hall"],
      ["commons", "west_passage"],
      ["commons", "east_passage"],
      ["electrical", "maintenance"],
      ["cargo", "maintenance"],
      ["reactor", "north_hall"],
      ["engines", "west_passage"],
      ["life_support", "east_passage"],
      ["hydroponics", "south_hall"],
    ] as const) {
      expect(linked(a, b), `${a} <-> ${b}`).toBe(true);
    }
    expect(linked("commons", "reactor")).toBe(false);
    expect(linked("electrical", "cargo")).toBe(false);
    // Every room hangs off at least one corridor, and doorways match the adjacency.
    for (const area of map.areas) expect(map.adjacency.get(area.id)!.length, area.id).toBeGreaterThan(0);
    expect(map.doorways.length * 2).toBe([...map.adjacency.values()].reduce((n, l) => n + l.length, 0));
  });

  it("vent links are symmetric and form the four documented networks", () => {
    for (const [a, links] of map.ventLinks) for (const b of links) expect(map.ventLinks.get(b), `${b} -> ${a}`).toContain(a);
    const component = (start: string): string[] => {
      const seen = new Set([start]);
      const queue = [start];
      while (queue.length > 0) {
        for (const n of map.ventLinks.get(queue.pop()!) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
        }
      }
      return [...seen].sort();
    };
    expect(component("vent_reactor")).toEqual(["vent_electrical", "vent_engines", "vent_reactor"]);
    expect(component("vent_navigation")).toEqual(["vent_infirmary", "vent_life_support", "vent_navigation"]);
    expect(component("vent_security")).toEqual(["vent_comms", "vent_security"]);
    expect(component("vent_commons")).toEqual(["vent_cargo", "vent_commons", "vent_hydroponics"]);
  });
});

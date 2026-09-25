import { Container, Graphics, Text } from "pixi.js";
import type { GameMap } from "@deduction/maps";

/** Pixels per tile in the static map geometry (the camera scales the whole world). */
export const TILE = 32;

export const COLORS = {
  space: 0x07090d,
  wall: 0x3b4252,
  wallEdge: 0x6b7890,
  roomFloor: 0x232a36,
  corridorFloor: 0x1b212b,
  floorLine: 0x2b3342,
  furniture: 0x4a5468,
  furnitureEdge: 0x7d8aa3,
  station: 0x5a6b88,
  stationEdge: 0x9fb3d1,
  vent: 0x2f3542,
  ventEdge: 0x8792a8,
  beacon: 0xe5484d,
  label: 0x8b98ae,
};

/**
 * Static map geometry drawn once: floors per area, wall bodies and edges, furniture, consoles, vents, the emergency
 * beacon and room names. Everything here is public (`@deduction/maps`); dynamic markers live in other layers.
 */
export function buildMapLayer(map: GameMap): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  const { width: w, height: h } = map;
  const walk = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && map.walkable[y * w + x] === 1;

  // Floors: merge horizontal runs of tiles that belong to the same area.
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const a = map.areaIndex[y * w + x]!;
      if (a < 0 || !walk(x, y)) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < w && map.areaIndex[y * w + end] === a && walk(end, y)) end++;
      const kind = map.areas[a]!.kind;
      g.rect(x * TILE, y * TILE, (end - x) * TILE, TILE).fill(kind === "room" ? COLORS.roomFloor : COLORS.corridorFloor);
      x = end;
    }
  }

  // Faint floor grid inside rooms.
  const grid = new Graphics();
  for (const area of map.areas) {
    if (area.kind !== "room") continue;
    for (const r of area.rects) {
      for (let x = r.x + 2; x < r.x + r.w; x += 2) grid.moveTo(x * TILE, r.y * TILE).lineTo(x * TILE, (r.y + r.h) * TILE);
      for (let y = r.y + 2; y < r.y + r.h; y += 2) grid.moveTo(r.x * TILE, y * TILE).lineTo((r.x + r.w) * TILE, y * TILE);
    }
  }
  grid.stroke({ width: 1, color: COLORS.floorLine, alpha: 0.6 });
  root.addChild(grid);

  // Wall bodies: solid tiles next to floor (8-neighbourhood) that are not furniture.
  const furniture = new Set<number>();
  for (const r of map.def.obstacles) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) furniture.add(y * w + x);
  const walls = new Graphics();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (walk(x, y) || furniture.has(y * w + x)) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) if (walk(x + dx, y + dy)) near = true;
      if (near) walls.rect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  walls.fill(COLORS.wall);
  root.addChild(walls);

  // Wall edges: every floor tile side that faces a solid tile.
  const edges = new Graphics();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!walk(x, y)) continue;
      const px = x * TILE;
      const py = y * TILE;
      if (!walk(x, y - 1)) edges.moveTo(px, py).lineTo(px + TILE, py);
      if (!walk(x, y + 1)) edges.moveTo(px, py + TILE).lineTo(px + TILE, py + TILE);
      if (!walk(x - 1, y)) edges.moveTo(px, py).lineTo(px, py + TILE);
      if (!walk(x + 1, y)) edges.moveTo(px + TILE, py).lineTo(px + TILE, py + TILE);
    }
  }
  edges.stroke({ width: 3, color: COLORS.wallEdge, alpha: 0.9 });
  root.addChild(edges);

  // Furniture.
  const furn = new Graphics();
  for (const r of map.def.obstacles) {
    furn.roundRect(r.x * TILE + 2, r.y * TILE + 2, r.w * TILE - 4, r.h * TILE - 4, 6).fill(COLORS.furniture).stroke({ width: 2, color: COLORS.furnitureEdge });
  }
  root.addChild(furn);

  // Consoles (task stations) and repair panels.
  const consoles = new Graphics();
  for (const s of map.def.taskStations) {
    consoles.roundRect(s.pos.x * TILE - 11, s.pos.y * TILE - 11, 22, 22, 4).fill(COLORS.station).stroke({ width: 2, color: COLORS.stationEdge });
    consoles.rect(s.pos.x * TILE - 7, s.pos.y * TILE - 7, 14, 8).fill(0x9ad8f0);
  }
  for (const s of map.def.sabotageStations) {
    consoles.roundRect(s.pos.x * TILE - 10, s.pos.y * TILE - 10, 20, 20, 3).fill(0x51405a).stroke({ width: 2, color: 0xc9a0dc });
  }
  root.addChild(consoles);

  // Vents.
  const vents = new Graphics();
  for (const v of map.def.vents) {
    const x = v.pos.x * TILE;
    const y = v.pos.y * TILE;
    vents.roundRect(x - 15, y - 11, 30, 22, 4).fill(COLORS.vent).stroke({ width: 2, color: COLORS.ventEdge });
    for (let i = -8; i <= 8; i += 5.3) vents.moveTo(x - 11, y + i * 0.9).lineTo(x + 11, y + i * 0.9);
  }
  vents.stroke({ width: 2, color: COLORS.ventEdge, alpha: 0.7 });
  root.addChild(vents);

  // Emergency beacon.
  const b = map.def.emergencyButton.pos;
  const beacon = new Graphics();
  beacon.circle(b.x * TILE, b.y * TILE, 20).fill(0x55606f).stroke({ width: 3, color: 0x9aa7bd });
  beacon.circle(b.x * TILE, b.y * TILE, 12).fill(COLORS.beacon).stroke({ width: 2, color: 0xffb3b5 });
  root.addChild(beacon);

  // Room names.
  for (const area of map.areas) {
    if (area.kind !== "room") continue;
    const r = area.rects[0]!;
    const t = new Text({
      text: area.name.toUpperCase(),
      style: { fontFamily: "system-ui, sans-serif", fontSize: 22, fontWeight: "700", fill: COLORS.label, letterSpacing: 3 },
    });
    t.alpha = 0.55;
    t.anchor.set(0.5, 0);
    t.position.set((r.x + r.w / 2) * TILE, r.y * TILE + 8);
    root.addChild(t);
  }
  return root;
}

import type { Vec2 } from "@deduction/shared";
import type { GameMap } from "./compile";

export interface AsciiMarker {
  readonly pos: Vec2;
  readonly char: string;
}

/**
 * Debug rendering: `#` wall, `.` room floor, `:` corridor floor, `T` task station, `S` sabotage repair,
 * `V` vent, `E` emergency button, plus caller-supplied markers (e.g. player initials).
 */
export function renderAscii(map: GameMap, markers: readonly AsciiMarker[] = []): string {
  const rows: string[][] = [];
  for (let y = 0; y < map.height; y++) {
    const row: string[] = [];
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      if (map.walkable[i] !== 1) row.push("#");
      else row.push(map.areas[map.areaIndex[i] as number]?.kind === "corridor" ? ":" : ".");
    }
    rows.push(row);
  }
  const put = (p: Vec2, c: string) => {
    const row = rows[Math.floor(p.y)];
    if (row && Math.floor(p.x) >= 0 && Math.floor(p.x) < row.length) row[Math.floor(p.x)] = c;
  };
  map.def.taskStations.forEach((s) => put(s.pos, "T"));
  map.def.sabotageStations.forEach((s) => put(s.pos, "S"));
  map.def.vents.forEach((v) => put(v.pos, "V"));
  put(map.def.emergencyButton.pos, "E");
  markers.forEach((m) => put(m.pos, m.char));
  return rows.map((r) => r.join("")).join("\n");
}

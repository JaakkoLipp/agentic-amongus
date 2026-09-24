import { compileMap, type GameMap } from "./compile";
import { OUTPOST_KAPPA } from "./outpostKappa";
import type { MapDefinition } from "./types";

export type { AreaDef, CompiledArea, Doorway, MapDefinition, SabotageStationDef, TaskStationDef, VentDef } from "./types";
export { compileMap, MapValidationError, type GameMap } from "./compile";
export {
  PLAYER_RADIUS,
  areaAt,
  areaName,
  boxFits,
  hasLineOfSight,
  isWalkablePoint,
  isWalkableTile,
  moveWithCollision,
  nearestWalkable,
  segmentClear,
} from "./geometry";
export { distanceField, findPath, travelDistance } from "./pathfinding";
export { renderAscii, type AsciiMarker } from "./ascii";
export { OUTPOST_KAPPA } from "./outpostKappa";

export const MAP_DEFINITIONS: Readonly<Record<string, MapDefinition>> = {
  [OUTPOST_KAPPA.id]: OUTPOST_KAPPA,
};

const compiled = new Map<string, GameMap>();

/** Compiled maps are immutable and shared between matches (only lazy caches are filled in). */
export function getMap(id: string): GameMap {
  let map = compiled.get(id);
  if (!map) {
    const def = MAP_DEFINITIONS[id];
    if (!def) throw new Error(`Unknown map: ${id}`);
    map = compileMap(def);
    compiled.set(id, map);
  }
  return map;
}

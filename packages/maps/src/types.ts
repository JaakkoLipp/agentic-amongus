import type { AreaId, Rect, SabotageKind, StationId, TaskKind, Vec2, VentId } from "@deduction/shared";

/**
 * Static map data. Coordinates are in tiles; a tile is walkable if it lies inside any area rect and outside every
 * obstacle rect. Everything else is wall. Walls are at least one tile thick, so tile-grid line-of-sight is exact
 * enough for vision and occlusion.
 */
export interface AreaDef {
  readonly id: AreaId;
  readonly name: string;
  readonly kind: "room" | "corridor";
  readonly rects: readonly Rect[];
}

export interface TaskStationDef {
  readonly id: StationId;
  readonly roomId: AreaId;
  readonly pos: Vec2;
  readonly taskKind: TaskKind;
  readonly label: string;
}

export interface SabotageStationDef {
  readonly id: StationId;
  readonly kind: SabotageKind;
  readonly roomId: AreaId;
  readonly pos: Vec2;
  readonly label: string;
}

export interface VentDef {
  readonly id: VentId;
  readonly roomId: AreaId;
  readonly pos: Vec2;
  /** Undirected links; the compiler symmetrizes them. */
  readonly links: readonly VentId[];
}

export interface MapDefinition {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** Rooms first: when rects overlap, the earlier area owns the tile. */
  readonly areas: readonly AreaDef[];
  /** Solid furniture inside rooms (tables, crates, reactor core). Blocks movement and vision. */
  readonly obstacles: readonly Rect[];
  readonly taskStations: readonly TaskStationDef[];
  readonly sabotageStations: readonly SabotageStationDef[];
  readonly vents: readonly VentDef[];
  readonly emergencyButton: { readonly roomId: AreaId; readonly pos: Vec2 };
  /** Players spawn on a ring around this point at match start and after every meeting. */
  readonly spawn: { readonly center: Vec2; readonly radius: number };
}

/** Opening between two areas (derived): where a corridor meets a room. Rendered as a door frame. */
export interface Doorway {
  readonly id: string;
  readonly areas: readonly [AreaId, AreaId];
  readonly tiles: readonly Vec2[];
  readonly center: Vec2;
}

export interface CompiledArea extends AreaDef {
  readonly index: number;
  readonly center: Vec2;
  readonly tileCount: number;
}

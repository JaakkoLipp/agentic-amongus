import { dist, isCriticalSabotage, secondsToTicks, type ActionResult, type PlayerId, type SabotageKind, type StationId } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import { OK, reject, type EngineContext } from "../context";
import type { GameState, PlayerState } from "../state";
import { cancelTask } from "./tasks";

/**
 * Sabotage model:
 * - lights: crew vision shrinks until the single panel is held for `repairHoldSec`.
 * - comms: global task progress is hidden until the single dish is held.
 * - oxygen (critical): two stations, each fixed independently by holding it.
 * - reactor (critical): two stations that must be held at the same time for `repairHoldSec`.
 * Critical sabotages end the match for the infiltrators when the countdown runs out. Only one sabotage at a time.
 */
export function validateSabotage(state: GameState, p: PlayerState, _kind: SabotageKind): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (p.role !== "infiltrator") return reject("wrong_role");
  if (state.sabotage !== null) return reject("sabotage_active");
  if (state.tick < state.sabotageReadyAtTick) return reject("cooldown");
  return OK;
}

export function startSabotage(ctx: EngineContext, p: PlayerState, kind: SabotageKind): void {
  const { state, map } = ctx;
  const deadlineTick = isCriticalSabotage(kind) ? state.tick + secondsToTicks(state.settings.criticalSabotageSec) : null;
  state.sabotage = {
    kind,
    saboteurId: p.id,
    startedTick: state.tick,
    deadlineTick,
    stations: map.def.sabotageStations.filter((s) => s.kind === kind).map((s) => ({ stationId: s.id, fixed: false, fixedBy: [] })),
    simultaneousSinceTick: null,
  };
  ctx.emit({ type: "SABOTAGE_STARTED", kind, saboteurId: p.id, deadlineTick });
}

export function validateStartRepair(state: GameState, map: GameMap, p: PlayerState, stationId: StationId): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (!p.alive) return reject("dead");
  if (p.ventId !== null) return reject("in_vent");
  if (p.repair !== null) return reject("busy");
  const sab = state.sabotage;
  const entry = sab?.stations.find((s) => s.stationId === stationId);
  if (!sab || !entry) return reject("invalid_target");
  if (entry.fixed) return reject("task_done");
  const station = map.sabotageStationById.get(stationId)!;
  if (dist(p.pos, station.pos) > state.settings.useRange) return reject("out_of_range");
  return OK;
}

export function startRepair(ctx: EngineContext, p: PlayerState, stationId: StationId): void {
  cancelTask(ctx, p);
  p.moveIntent = { mode: "stop" };
  p.route = null;
  p.repair = { stationId, startedTick: ctx.state.tick };
}

export function stopRepair(_ctx: EngineContext, p: PlayerState): void {
  p.repair = null;
}

function holdersOf(state: GameState, stationId: StationId): PlayerState[] {
  return state.players.filter((p) => p.alive && p.repair?.stationId === stationId);
}

/** Per-tick repair progress and critical countdown. Returns true if a critical sabotage just expired. */
export function tickSabotage(ctx: EngineContext): boolean {
  const { state } = ctx;
  const sab = state.sabotage;
  if (!sab) return false;
  const hold = secondsToTicks(state.settings.repairHoldSec);

  if (sab.kind === "reactor") {
    const allHeld = sab.stations.every((s) => holdersOf(state, s.stationId).length > 0);
    if (!allHeld) sab.simultaneousSinceTick = null;
    else if (sab.simultaneousSinceTick === null) sab.simultaneousSinceTick = state.tick;
    else if (state.tick - sab.simultaneousSinceTick >= hold) {
      const fixers = sab.stations.flatMap((s) => holdersOf(state, s.stationId).map((p) => p.id));
      for (const s of sab.stations) {
        s.fixed = true;
        s.fixedBy = holdersOf(state, s.stationId).map((p) => p.id);
      }
      finishSabotage(ctx, fixers);
      return false;
    }
  } else {
    for (const s of sab.stations) {
      if (s.fixed) continue;
      const done = holdersOf(state, s.stationId).filter((p) => state.tick - p.repair!.startedTick >= hold);
      if (done.length === 0) continue;
      s.fixed = true;
      s.fixedBy = done.map((p) => p.id);
      for (const p of done) p.repair = null;
      ctx.emit({ type: "SABOTAGE_STATION_FIXED", kind: sab.kind, stationId: s.stationId, playerIds: s.fixedBy });
    }
    if (sab.stations.every((s) => s.fixed)) {
      finishSabotage(ctx, sab.stations.flatMap((s) => s.fixedBy));
      return false;
    }
  }
  return sab.deadlineTick !== null && state.tick >= sab.deadlineTick;
}

function finishSabotage(ctx: EngineContext, fixerIds: PlayerId[]): void {
  const { state } = ctx;
  const sab = state.sabotage!;
  for (const p of state.players) if (p.repair && sab.stations.some((s) => s.stationId === p.repair!.stationId)) p.repair = null;
  state.sabotage = null;
  state.sabotageReadyAtTick = state.tick + secondsToTicks(state.settings.sabotageCooldownSec);
  ctx.emit({ type: "SABOTAGE_FIXED", kind: sab.kind, fixerIds: [...new Set(fixerIds)] });
}

/** Meetings reset any active sabotage (critical countdowns included). */
export function clearSabotage(ctx: EngineContext, reason: "meeting" | "match_end"): void {
  const { state } = ctx;
  const sab = state.sabotage;
  if (!sab) return;
  state.sabotage = null;
  for (const p of state.players) p.repair = null;
  state.sabotageReadyAtTick = state.tick + secondsToTicks(state.settings.sabotageCooldownSec);
  ctx.emit({ type: "SABOTAGE_CLEARED", kind: sab.kind, reason });
}

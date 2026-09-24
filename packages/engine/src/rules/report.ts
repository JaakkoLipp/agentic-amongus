import { dist, isCriticalSabotage, type ActionResult, type BodyId } from "@deduction/shared";
import { hasLineOfSight, type GameMap } from "@deduction/maps";
import { OK, reject, type EngineContext } from "../context";
import type { GameState, PlayerState } from "../state";
import { canSeePoint } from "../vision";
import { startMeeting } from "./meeting";

export function validateReport(state: GameState, map: GameMap, p: PlayerState, bodyId: BodyId): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (!p.alive) return reject("dead");
  if (p.ventId !== null) return reject("in_vent");
  const body = state.bodies.find((b) => b.id === bodyId);
  // A body the reporter cannot see is indistinguishable from a nonexistent one: rejection reasons must not leak deaths.
  if (!body || !canSeePoint(state, map, p, body.pos)) return reject("invalid_target");
  if (body.reported) return reject("already_reported");
  if (dist(p.pos, body.pos) > state.settings.reportRange) return reject("out_of_range");
  if (!hasLineOfSight(map, p.pos, body.pos)) return reject("no_line_of_sight");
  return OK;
}

export function applyReport(ctx: EngineContext, p: PlayerState, bodyId: BodyId): void {
  const body = ctx.state.bodies.find((b) => b.id === bodyId)!;
  body.reported = true;
  ctx.emit({ type: "BODY_REPORTED", reporterId: p.id, bodyId, victimId: body.victimId, roomId: body.roomId });
  startMeeting(ctx, "body", p.id, body);
}

export function validateEmergency(state: GameState, p: PlayerState): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (!p.alive) return reject("dead");
  if (p.ventId !== null) return reject("in_vent");
  if (p.emergencyMeetingsLeft <= 0) return reject("no_meetings_left");
  if (state.tick < state.emergencyReadyAtTick) return reject("cooldown");
  if (state.sabotage && isCriticalSabotage(state.sabotage.kind)) return reject("sabotage_active");
  return OK;
}

export function validateEmergencyRange(state: GameState, map: GameMap, p: PlayerState): ActionResult {
  return dist(p.pos, map.def.emergencyButton.pos) <= state.settings.useRange ? OK : reject("out_of_range");
}

export function applyEmergency(ctx: EngineContext, p: PlayerState): void {
  p.emergencyMeetingsLeft--;
  ctx.emit({ type: "EMERGENCY_CALLED", callerId: p.id });
  startMeeting(ctx, "emergency", p.id, null);
}

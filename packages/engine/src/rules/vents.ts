import { dist, secondsToTicks, type ActionResult, type VentId } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import { OK, reject, type EngineContext } from "../context";
import type { GameState, PlayerState } from "../state";
import { witnessesOfPoint } from "../vision";
import { cancelTask } from "./tasks";
import { placePlayer } from "./movement";

/** Vents are hidden traversal for living infiltrators only. Entering and exiting can be seen; travel cannot. */
export function validateEnterVent(state: GameState, map: GameMap, p: PlayerState, ventId: VentId): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (!p.alive) return reject("dead");
  if (p.role !== "infiltrator") return reject("wrong_role");
  if (p.ventId !== null) return reject("in_vent");
  if (state.tick < p.ventReadyAtTick) return reject("cooldown");
  const vent = map.ventById.get(ventId);
  if (!vent) return reject("invalid_target");
  if (dist(p.pos, vent.pos) > state.settings.useRange) return reject("out_of_range");
  return OK;
}

export function enterVent(ctx: EngineContext, p: PlayerState, ventId: VentId): void {
  const vent = ctx.map.ventById.get(ventId)!;
  const witnesses = witnessesOfPoint(ctx.state, ctx.map, p.pos, [p.id]);
  cancelTask(ctx, p);
  p.ventId = ventId;
  p.moveIntent = { mode: "stop" };
  placePlayer(ctx, p, vent.pos, false);
  p.ventReadyAtTick = ctx.state.tick + secondsToTicks(ctx.state.settings.ventCooldownSec);
  ctx.emit({ type: "VENT_ENTERED", playerId: p.id, ventId, witnesses });
}

export function validateMoveVent(state: GameState, map: GameMap, p: PlayerState, toVentId: VentId): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (p.ventId === null) return reject("not_in_vent");
  if (state.tick < p.ventReadyAtTick) return reject("cooldown");
  if (!(map.ventLinks.get(p.ventId) ?? []).includes(toVentId)) return reject("invalid_target");
  return OK;
}

export function moveVent(ctx: EngineContext, p: PlayerState, toVentId: VentId): void {
  const from = p.ventId!;
  p.ventId = toVentId;
  placePlayer(ctx, p, ctx.map.ventById.get(toVentId)!.pos, false);
  p.ventReadyAtTick = ctx.state.tick + secondsToTicks(ctx.state.settings.ventCooldownSec);
  ctx.emit({ type: "VENT_MOVED", playerId: p.id, fromVentId: from, toVentId });
}

export function validateExitVent(state: GameState, p: PlayerState): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (p.ventId === null) return reject("not_in_vent");
  if (state.tick < p.ventReadyAtTick) return reject("cooldown");
  return OK;
}

export function exitVent(ctx: EngineContext, p: PlayerState): void {
  const ventId = p.ventId!;
  p.ventId = null;
  p.ventReadyAtTick = ctx.state.tick + secondsToTicks(ctx.state.settings.ventCooldownSec);
  const witnesses = witnessesOfPoint(ctx.state, ctx.map, p.pos, [p.id]);
  ctx.emit({ type: "VENT_EXITED", playerId: p.id, ventId, witnesses });
  // Venting never produced room events; reconcile the room now that the player is visible again.
  placePlayer(ctx, p, p.pos, true);
}

/** Meetings pull everyone out of the vents silently. */
export function forceExitVent(p: PlayerState): void {
  p.ventId = null;
}

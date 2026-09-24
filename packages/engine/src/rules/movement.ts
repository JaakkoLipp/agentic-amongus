import { clampUnit, dist, normalize, TICK_RATE, type Vec2 } from "@deduction/shared";
import { areaAt, findPath, moveWithCollision, type GameMap } from "@deduction/maps";
import type { EngineContext } from "../context";
import type { PlayerState, RouteState } from "../state";
import { witnessesOfPlayer } from "../vision";
import { cancelTask } from "./tasks";
import { stopRepair } from "./sabotage";

const RETARGET_EPSILON = 0.35;
const STUCK_TICKS = 12;
const MAX_REPATHS = 3;

/** Advance every player's position by one tick. Only called while the match is in the playing phase. */
export function tickMovement(ctx: EngineContext): void {
  const { state, map } = ctx;
  const step = state.settings.playerSpeed / TICK_RATE;
  for (const p of state.players) {
    p.moving = false;
    if (p.ventId !== null) continue;
    const intent = p.moveIntent;
    let desired: Vec2;
    if (intent.mode === "direction") {
      p.route = null;
      const d = clampUnit(intent.dir);
      desired = { x: d.x * step, y: d.y * step };
    } else if (intent.mode === "path") {
      desired = routeStep(map, p, intent.target, step);
    } else {
      p.route = null;
      continue;
    }
    const expected = Math.hypot(desired.x, desired.y);
    if (expected < 1e-9) continue;

    const next = moveWithCollision(map, p.pos, desired);
    const moved = dist(next, p.pos);
    if (p.route && moved < expected * 0.3) handleStuck(map, p, p.route);
    if (moved < 1e-6) continue;

    p.facing = normalize(desired);
    p.pos = next;
    p.moving = true;
    if (p.taskSession) cancelTask(ctx, p);
    if (p.repair) stopRepair(ctx, p);
    updateRoom(ctx, p);
  }
}

function planRoute(map: GameMap, p: PlayerState, target: Vec2, repaths: number): RouteState {
  const waypoints = findPath(map, p.pos, target);
  return { target, waypoints: waypoints ?? [], index: 0, stuckTicks: 0, repaths, arrived: false, unreachable: waypoints === null };
}

/** Walk up to `step` tiles along the current route, re-planning when the target moved. */
function routeStep(map: GameMap, p: PlayerState, target: Vec2, step: number): Vec2 {
  if (!p.route || dist(p.route.target, target) > RETARGET_EPSILON) p.route = planRoute(map, p, target, 0);
  const route = p.route;
  if (route.arrived || route.unreachable) return { x: 0, y: 0 };
  let x = p.pos.x;
  let y = p.pos.y;
  let remaining = step;
  while (remaining > 1e-9 && route.index < route.waypoints.length) {
    const wp = route.waypoints[route.index]!;
    const d = Math.hypot(wp.x - x, wp.y - y);
    if (d <= remaining) {
      x = wp.x;
      y = wp.y;
      remaining -= d;
      route.index++;
    } else {
      x += ((wp.x - x) / d) * remaining;
      y += ((wp.y - y) / d) * remaining;
      remaining = 0;
    }
  }
  // The final waypoint is the (walkable-snapped) target itself.
  if (route.index >= route.waypoints.length) route.arrived = true;
  return { x: x - p.pos.x, y: y - p.pos.y };
}

function handleStuck(map: GameMap, p: PlayerState, route: RouteState): void {
  route.stuckTicks++;
  if (route.stuckTicks < STUCK_TICKS) return;
  if (route.repaths >= MAX_REPATHS) {
    route.unreachable = true;
    return;
  }
  p.route = planRoute(map, p, route.target, route.repaths + 1);
}

export function updateRoom(ctx: EngineContext, p: PlayerState): void {
  const next = areaAt(ctx.map, p.pos);
  if (next === p.roomId) return;
  const prev = p.roomId;
  const witnesses = witnessesOfPlayer(ctx.state, ctx.map, p);
  if (prev !== null) ctx.emit({ type: "PLAYER_LEFT_ROOM", playerId: p.id, roomId: prev, toRoomId: next, witnesses });
  p.roomId = next;
  if (next !== null) ctx.emit({ type: "PLAYER_ENTERED_ROOM", playerId: p.id, roomId: next, fromRoomId: prev, witnesses });
}

/** Teleport (spawn after meetings, kill snap, vent exit). Does not emit room events for teleports into the same room. */
export function placePlayer(ctx: EngineContext, p: PlayerState, pos: Vec2, emitRoomEvents: boolean): void {
  p.pos = pos;
  p.route = null;
  p.moving = false;
  if (emitRoomEvents) updateRoom(ctx, p);
  else p.roomId = areaAt(ctx.map, pos);
}

import { dist, secondsToTicks, type AgentGoal, type Vec2 } from "@deduction/shared";
import type { GoalExecutor } from "../types";
import { areaCenter, done, elapsed, failed, farRoom, randomPointInRoom, running, STOP, travel, visibleOthers } from "../helpers";

type G<T extends AgentGoal["type"]> = GoalExecutor<Extract<AgentGoal, { type: T }>>;

export const WAIT: G<"WAIT"> = (ctx, goal, active) => (elapsed(ctx, active) >= goal.durationTicks ? done() : running(STOP));

export const MOVE_TO: G<"MOVE_TO"> = (ctx, goal, active) => {
  const center = areaCenter(ctx, goal.roomId);
  if (!center) return failed(`unknown room ${goal.roomId}`);
  if (ctx.obs.self.roomId === goal.roomId && dist(ctx.obs.self.pos, center) < 3) return done();
  const { arrived, step } = travel(ctx, active, center, 1);
  return arrived ? done() : step;
};

/** Go to the room, then sweep a couple of spots in it. */
export const INVESTIGATE: G<"INVESTIGATE"> = (ctx, goal, active) => {
  const s = active.scratch;
  if (!s.waypoints) {
    const center = areaCenter(ctx, goal.roomId);
    if (!center) return failed(`unknown room ${goal.roomId}`);
    const spots = [center, randomPointInRoom(ctx, goal.roomId), randomPointInRoom(ctx, goal.roomId)].filter((p): p is Vec2 => p !== null);
    s.waypoints = spots;
    s.index = 0;
  }
  const target = s.waypoints[s.index ?? 0];
  if (!target) return done();
  const { arrived, step } = travel(ctx, active, target, 1);
  if (arrived) {
    s.index = (s.index ?? 0) + 1;
    s.lastDist = undefined;
    return running(STOP);
  }
  return step;
};

/** Join other players: the visible crowd if any, else the room where most people were recently seen. */
export const SEEK_GROUP: G<"SEEK_GROUP"> = (ctx, goal, active) => {
  if (elapsed(ctx, active) >= goal.durationTicks) return done();
  const others = visibleOthers(ctx).concat(ctx.obs.visiblePlayers.filter((v) => ctx.obs.teammates.includes(v.id) && !v.ghost));
  const near = others.filter((v) => dist(v.pos, ctx.obs.self.pos) < 5);
  if (near.length >= 2) return done();
  if (others.length > 0) {
    const c = others.reduce((acc, v) => ({ x: acc.x + v.pos.x / others.length, y: acc.y + v.pos.y / others.length }), { x: 0, y: 0 });
    return travel(ctx, active, c, 2).step;
  }
  const recent = new Map<string, number>();
  for (const lk of ctx.memory.lastKnown.values()) {
    if (!lk.roomId || ctx.obs.tick - lk.tick > secondsToTicks(40) || ctx.memory.isKnownDead(lk.playerId)) continue;
    recent.set(lk.roomId, (recent.get(lk.roomId) ?? 0) + 1);
  }
  const best = [...recent.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? ctx.map.def.emergencyButton.roomId;
  const center = areaCenter(ctx, best) ?? ctx.map.def.spawn.center;
  const { arrived, step } = travel(ctx, active, center, 2);
  return arrived ? done() : step;
};

/** Leave the area of the most recent body for a distant room. */
export const FLEE_BODY: G<"FLEE_BODY"> = (ctx, _goal, active) => {
  const s = active.scratch;
  if (!s.waypoints) {
    const body = ctx.memory.bodies[ctx.memory.bodies.length - 1];
    const from = body?.pos ?? ctx.obs.self.pos;
    const room = farRoom(ctx, from, [body?.roomId ?? null, ctx.obs.self.roomId]);
    const center = room ? areaCenter(ctx, room) : null;
    if (!center) return failed("nowhere to flee");
    s.waypoints = [center];
  }
  const { arrived, step } = travel(ctx, active, s.waypoints[0]!, 2);
  return arrived ? done() : step;
};

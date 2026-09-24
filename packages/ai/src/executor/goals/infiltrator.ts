import { dist, secondsToTicks, type AgentGoal, type PlayerId, type VentId } from "@deduction/shared";
import { travelDistance } from "@deduction/maps";
import type { ActiveGoal, ExecContext, ExecStep, GoalExecutor } from "../types";
import { areaCenter, canAct, done, elapsed, estimatedPosition, failed, isolatedTargets, pathTo, randomPointInRoom, roomIds, running, STOP, travel, visibleOthers, witnessCount } from "../helpers";

type G<T extends AgentGoal["type"]> = GoalExecutor<Extract<AgentGoal, { type: T }>>;

/** Approach a target and strike when in range. `requireNoWitnesses` makes it wait for a clean opportunity. */
function stalk(ctx: ExecContext, active: ActiveGoal, targetId: PlayerId, requireNoWitnesses: boolean): ExecStep {
  if (ctx.memory.isKnownDead(targetId)) return failed(`${targetId} is already dead`);
  const est = estimatedPosition(ctx, targetId);
  if (!est) return failed(`no idea where ${targetId} is`);
  const s = active.scratch;
  if (est.live) s.lastSeenTick = ctx.obs.tick;
  if (est.live && ctx.obs.legal.kill.includes(targetId) && (!requireNoWitnesses || witnessCount(ctx, targetId) === 0)) {
    return done([{ type: "KILL", targetId }]);
  }
  if (!est.live) {
    const { arrived, step } = travel(ctx, active, est.pos, 1);
    return arrived ? failed(`lost ${targetId}`) : step;
  }
  if (!s.target || dist(s.target, est.pos) > 0.6) s.target = est.pos;
  // Close in but do not stand on top of them while waiting for the cooldown or for witnesses to leave.
  const d = dist(ctx.obs.self.pos, est.pos);
  const ready = (ctx.obs.self.killCooldownTicks ?? 0) === 0;
  if (!ready && d < 2.5) return running(STOP);
  return running(pathTo(s.target));
}

export const KILL: G<"KILL"> = (ctx, goal, active) =>
  elapsed(ctx, active) > secondsToTicks(15) ? failed("kill window passed") : stalk(ctx, active, goal.playerId, false);

export const HUNT: G<"HUNT"> = (ctx, goal, active) => {
  if (elapsed(ctx, active) >= goal.durationTicks) return done([], "hunt timed out");
  const targetId = goal.playerId ?? active.scratch.stage ?? isolatedTargets(ctx)[0]?.id;
  if (!targetId) return SEEK_ISOLATED_PLAYER(ctx, { type: "SEEK_ISOLATED_PLAYER", durationTicks: goal.durationTicks }, active);
  active.scratch.stage = targetId;
  return stalk(ctx, active, targetId, true);
};

/**
 * Roam quieter parts of the map looking for someone alone. Once an isolated player is in view, shadow them so the
 * controller can decide whether to strike.
 */
export const SEEK_ISOLATED_PLAYER: G<"SEEK_ISOLATED_PLAYER"> = (ctx, goal, active) => {
  if (elapsed(ctx, active) >= goal.durationTicks) return done();
  const target = isolatedTargets(ctx)[0];
  if (target) {
    if (ctx.obs.legal.kill.includes(target.id)) return done([], `isolated target ${target.id} in range`);
    return running(pathTo(target.pos));
  }
  const s = active.scratch;
  if (!s.target || dist(s.target, ctx.obs.self.pos) < 1.5) {
    const hub = ctx.map.def.emergencyButton.roomId;
    const room = ctx.rng.pick(roomIds(ctx, [hub, ctx.obs.self.roomId]));
    s.target = randomPointInRoom(ctx, room) ?? areaCenter(ctx, room) ?? ctx.map.def.spawn.center;
    s.lastDist = undefined;
  }
  const { arrived, step } = travel(ctx, active, s.target, 1.5);
  if (arrived || step.status === "failed") {
    s.target = undefined;
    return running(STOP);
  }
  return step;
};

function ventRoute(ctx: ExecContext, from: VentId, to: VentId): VentId[] | null {
  const prev = new Map<VentId, VentId | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const v = queue.shift()!;
    if (v === to) break;
    for (const n of ctx.map.ventLinks.get(v) ?? []) {
      if (prev.has(n)) continue;
      prev.set(n, v);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return null;
  const route: VentId[] = [];
  for (let v: VentId | null = to; v !== null && v !== from; v = prev.get(v) ?? null) route.unshift(v);
  return route;
}

/** Enter the nearest vent, travel through the network, and pop out when nobody is watching. */
export const VENT: G<"VENT"> = (ctx, goal, active) => {
  const self = ctx.obs.self;
  const s = active.scratch;
  if (self.inVentId === null) {
    if (s.stage === "exited") return done();
    if (ctx.obs.legal.ventEnter) return canAct(ctx, active, 0.5) ? running(STOP, [{ type: "ENTER_VENT", ventId: ctx.obs.legal.ventEnter }]) : running(STOP);
    if (!s.taskId) {
      const vents = [...ctx.map.def.vents].sort((a, b) => travelDistance(ctx.map, self.pos, a.pos) - travelDistance(ctx.map, self.pos, b.pos));
      const vent = vents[0];
      if (!vent) return failed("no vents on this map");
      s.taskId = vent.id;
    }
    const vent = ctx.map.ventById.get(s.taskId)!;
    return travel(ctx, active, vent.pos, Math.min(0.8, ctx.settings.useRange * 0.6)).step;
  }
  if (!s.ventPath) {
    const destination = goal.ventId && goal.ventId !== self.inVentId ? goal.ventId : ctx.rng.pick([...(ctx.map.ventLinks.get(self.inVentId) ?? [self.inVentId])]);
    s.ventPath = ventRoute(ctx, self.inVentId, destination) ?? [];
    s.lastProgressTick = ctx.obs.tick;
  }
  const next = s.ventPath[0];
  if (next !== undefined) {
    if (ctx.obs.legal.ventMove.includes(next)) {
      s.ventPath = s.ventPath.slice(1);
      return running(STOP, [{ type: "MOVE_VENT", toVentId: next }]);
    }
    return running(STOP);
  }
  const watched = visibleOthers(ctx).length > 0;
  const waited = ctx.obs.tick - (s.lastProgressTick ?? ctx.obs.tick) > secondsToTicks(5);
  if (ctx.obs.legal.ventExit && (!watched || waited)) {
    s.stage = "exited";
    return done([{ type: "EXIT_VENT" }]);
  }
  return running(STOP);
};

export const EXIT_VENT: G<"EXIT_VENT"> = (ctx, _goal, active) => {
  if (ctx.obs.self.inVentId === null) return done();
  if (ctx.obs.legal.ventExit) return canAct(ctx, active, 0.3) ? done([{ type: "EXIT_VENT" }]) : running(STOP);
  return running(STOP);
};

export const SABOTAGE: G<"SABOTAGE"> = (ctx, goal) =>
  ctx.obs.legal.sabotage.includes(goal.kind) ? done([{ type: "SABOTAGE", kind: goal.kind }]) : failed(`cannot sabotage ${goal.kind} now`);

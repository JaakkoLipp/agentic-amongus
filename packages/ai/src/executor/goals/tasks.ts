import { dist, secondsToTicks, type AgentGoal, type StationId } from "@deduction/shared";
import { travelDistance } from "@deduction/maps";
import type { GoalExecutor } from "../types";
import { canAct, done, elapsed, failed, nearestTask, pendingTasks, running, STOP, travel } from "../helpers";

type G<T extends AgentGoal["type"]> = GoalExecutor<Extract<AgentGoal, { type: T }>>;

const MAX_ATTEMPTS = 4;

/**
 * Walk to a console and start the task. The answer itself is a separate "task_answer" decision made by the
 * controller from the views it was shown; this executor only keeps the agent standing still while it works.
 * Infiltrators use the exact same flow for fake tasks.
 */
export const GO_DO_TASK: G<"GO_DO_TASK"> = (ctx, goal, active) => {
  const s = active.scratch;
  const active_ = ctx.obs.activeTask;
  if (active_) {
    s.taskId = active_.taskId;
    return running(STOP);
  }
  if (!s.taskId) {
    const chosen = goal.taskId ? ctx.obs.tasks.find((t) => t.taskId === goal.taskId && !t.done) : nearestTask(ctx);
    if (!chosen) return pendingTasks(ctx).length === 0 ? done([], "no tasks left") : failed(`task ${goal.taskId} unavailable`);
    s.taskId = chosen.taskId;
    s.attempts = 0;
  }
  const task = ctx.obs.tasks.find((t) => t.taskId === s.taskId);
  if (!task) return failed(`unknown task ${s.taskId}`);
  if (task.done) return done();
  if (ctx.obs.legal.startTask.includes(task.taskId)) {
    if ((s.attempts ?? 0) >= MAX_ATTEMPTS) return failed(`gave up on ${task.taskId}`);
    if (!canAct(ctx, active, 1)) return running(STOP);
    s.attempts = (s.attempts ?? 0) + 1;
    return running(STOP, [{ type: "START_TASK", taskId: task.taskId }]);
  }
  return travel(ctx, active, task.pos, Math.min(0.8, ctx.settings.useRange * 0.6)).step;
};

export const FAKE_TASK: G<"FAKE_TASK"> = (ctx, goal, active) => GO_DO_TASK(ctx, { type: "GO_DO_TASK", taskId: goal.taskId }, active);

/** Go to an unfixed repair station of the active sabotage and hold it until the sabotage is resolved. */
export const FIX_SABOTAGE: G<"FIX_SABOTAGE"> = (ctx, _goal, active) => {
  const sab = ctx.obs.sabotage;
  if (!sab) return done();
  if (!ctx.obs.self.alive) return failed("ghosts cannot repair");
  const s = active.scratch;
  if (ctx.obs.self.repairingStationId) {
    s.stage = ctx.obs.self.repairingStationId;
    return running(STOP);
  }
  const open = sab.stations.filter((st) => !st.fixed);
  if (open.length === 0) return done();
  let station = open.find((st) => st.stationId === s.stage);
  if (!station) {
    // Prefer a station nobody is visibly holding (matters for the two-handed reactor), then the closest.
    const held = new Set(ctx.obs.visiblePlayers.filter((v) => v.activity === "repair").map((v) => v.stationId as StationId));
    const ranked = [...open].sort((a, b) => {
      const ha = held.has(a.stationId) ? 1 : 0;
      const hb = held.has(b.stationId) ? 1 : 0;
      return ha - hb || travelDistance(ctx.map, ctx.obs.self.pos, a.pos) - travelDistance(ctx.map, ctx.obs.self.pos, b.pos);
    });
    station = ranked[0]!;
    s.stage = station.stationId;
  }
  if (ctx.obs.legal.repair.includes(station.stationId)) {
    return canAct(ctx, active, 0.5) ? running(STOP, [{ type: "START_REPAIR", stationId: station.stationId }]) : running(STOP);
  }
  if (dist(ctx.obs.self.pos, station.pos) < 0.8 && elapsed(ctx, active) > secondsToTicks(30)) return failed("cannot repair here");
  return travel(ctx, active, station.pos, Math.min(0.8, ctx.settings.useRange * 0.6)).step;
};

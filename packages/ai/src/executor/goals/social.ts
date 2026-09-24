import { dist, secondsToTicks, type AgentGoal, type PlayerId } from "@deduction/shared";
import type { ActiveGoal, ExecContext, ExecStep, GoalExecutor } from "../types";
import { done, elapsed, estimatedPosition, failed, farRoom, areaCenter, nearestTask, pathTo, pendingTasks, running, STOP, travel, visibleOthers } from "../helpers";
import { GO_DO_TASK } from "./tasks";

type G<T extends AgentGoal["type"]> = GoalExecutor<Extract<AgentGoal, { type: T }>>;

/**
 * Shared "stay within [min, max] of a player" behaviour. Tracks the live position while visible and the last-known
 * position otherwise; gives up once the last sighting has been checked and the player is still nowhere to be seen.
 */
function shadow(ctx: ExecContext, active: ActiveGoal, playerId: PlayerId, minDist: number, maxDist: number, durationTicks: number): ExecStep {
  if (elapsed(ctx, active) >= durationTicks) return done();
  if (ctx.memory.isKnownDead(playerId)) return failed(`${playerId} is dead`);
  const est = estimatedPosition(ctx, playerId);
  if (!est) return failed(`no idea where ${playerId} is`);
  const s = active.scratch;
  const d = dist(ctx.obs.self.pos, est.pos);
  if (est.live) {
    s.lastSeenTick = ctx.obs.tick;
    if (d > maxDist) {
      // Only re-target when the player moved noticeably, so the engine does not re-plan every step.
      if (!s.target || dist(s.target, est.pos) > 1) s.target = est.pos;
      return running(pathTo(s.target));
    }
    if (d < minDist) return running(STOP);
    return running(STOP);
  }
  const { arrived, step } = travel(ctx, active, est.pos, 1);
  if (arrived) return failed(`lost track of ${playerId}`);
  return step;
}

export const FOLLOW: G<"FOLLOW"> = (ctx, goal, active) => shadow(ctx, active, goal.playerId, 1.2, 2.5, goal.durationTicks);
export const OBSERVE: G<"OBSERVE"> = (ctx, goal, active) => shadow(ctx, active, goal.playerId, 3.5, 5.5, goal.durationTicks);
export const PROTECT_TEAMMATE: G<"PROTECT_TEAMMATE"> = (ctx, goal, active) => shadow(ctx, active, goal.playerId, 2, 3.5, goal.durationTicks);
export const FRAME_PLAYER: G<"FRAME_PLAYER"> = (ctx, goal, active) => {
  if (active.scratch.stage !== "noted") {
    ctx.memory.note(`Trying to frame ${goal.playerId}: stay nearby, then point at them in the next meeting.`, 240);
    active.scratch.stage = "noted";
  }
  return shadow(ctx, active, goal.playerId, 4, 6, goal.durationTicks);
};

/** Stick close to a buddy; if one of my own consoles is right here, use it while they work. */
export const BUDDY_UP: G<"BUDDY_UP"> = (ctx, goal, active) => {
  if (elapsed(ctx, active) >= goal.durationTicks) return done();
  const buddy = estimatedPosition(ctx, goal.playerId);
  const task = nearestTask(ctx);
  if (buddy?.live && task && dist(task.pos, ctx.obs.self.pos) < 6 && dist(task.pos, buddy.pos) < 8) {
    const step = GO_DO_TASK(ctx, { type: "GO_DO_TASK", taskId: task.taskId }, active);
    return step.status === "running" ? step : running(STOP);
  }
  return shadow(ctx, active, goal.playerId, 1, 2, goal.durationTicks);
};

/** Blend in next to someone and fake a nearby console, so they can vouch for me later. */
export const CREATE_ALIBI: G<"CREATE_ALIBI"> = (ctx, goal, active) => {
  if (elapsed(ctx, active) >= goal.durationTicks) return done();
  const witness = goal.playerId ?? visibleOthers(ctx)[0]?.id ?? null;
  if (!witness) {
    const step = GO_DO_TASK(ctx, { type: "GO_DO_TASK", taskId: null }, active);
    return step.status === "running" ? step : done();
  }
  const pending = pendingTasks(ctx).filter((t) => dist(t.pos, ctx.obs.self.pos) < 6);
  if (pending.length > 0 && estimatedPosition(ctx, witness)?.live) {
    const step = GO_DO_TASK(ctx, { type: "GO_DO_TASK", taskId: pending[0]!.taskId }, active);
    if (step.status === "running") return step;
  }
  return shadow(ctx, active, witness, 2, 4, goal.durationTicks);
};

/** Keep away from a player; when they close in, head for a room far from them. */
export const AVOID: G<"AVOID"> = (ctx, goal, active) => {
  if (elapsed(ctx, active) >= goal.durationTicks) return done();
  const threat = estimatedPosition(ctx, goal.playerId);
  if (!threat || !threat.live || dist(threat.pos, ctx.obs.self.pos) > 7) {
    if (active.scratch.target) {
      const { arrived, step } = travel(ctx, active, active.scratch.target, 2);
      if (!arrived) return step;
    }
    return running(STOP);
  }
  if (!active.scratch.target || dist(active.scratch.target, threat.pos) < 6) {
    const room = farRoom(ctx, threat.pos, [ctx.obs.self.roomId]);
    const center = room ? areaCenter(ctx, room) : null;
    if (!center) return failed("nowhere to go");
    active.scratch.target = center;
    active.scratch.lastDist = undefined;
  }
  return travel(ctx, active, active.scratch.target, 2).step;
};

/** Walk up to a player and say something to their face. */
export const CONFRONT: G<"CONFRONT"> = (ctx, goal, active) => {
  if (elapsed(ctx, active) > secondsToTicks(25)) return failed("could not reach them");
  const est = estimatedPosition(ctx, goal.playerId);
  if (!est) return failed(`no idea where ${goal.playerId} is`);
  if (est.live && dist(est.pos, ctx.obs.self.pos) <= 3 && ctx.obs.legal.speak) {
    return done([{ type: "SPEAK", text: goal.utterance }]);
  }
  return shadow(ctx, active, goal.playerId, 1.5, 2.5, secondsToTicks(25));
};

export const SPEAK_NEARBY: G<"SPEAK_NEARBY"> = (ctx, goal, active) => {
  if (ctx.obs.legal.speak) return done([{ type: "SPEAK", text: goal.utterance }]);
  return elapsed(ctx, active) > secondsToTicks(4) ? failed("could not speak") : running(STOP);
};

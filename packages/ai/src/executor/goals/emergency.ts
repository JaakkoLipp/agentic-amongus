import { dist, secondsToTicks, type AgentGoal } from "@deduction/shared";
import type { ActiveGoal, ExecContext, ExecStep, GoalExecutor } from "../types";
import { canAct, done, elapsed, failed, running, STOP, travel } from "../helpers";

type G<T extends AgentGoal["type"]> = GoalExecutor<Extract<AgentGoal, { type: T }>>;

function reportBody(ctx: ExecContext, active: ActiveGoal, bodyId: string | null): ExecStep {
  const visible = ctx.obs.visibleBodies;
  const target =
    (bodyId ? visible.find((b) => b.bodyId === bodyId) : undefined) ??
    [...visible].sort((a, b) => dist(a.pos, ctx.obs.self.pos) - dist(b.pos, ctx.obs.self.pos))[0] ??
    (bodyId ? ctx.memory.bodies.find((b) => b.bodyId === bodyId) : ctx.memory.bodies[ctx.memory.bodies.length - 1]);
  if (!target) return failed("no body to report");
  if (ctx.obs.legal.report.includes(target.bodyId)) return done([{ type: "REPORT_BODY", bodyId: target.bodyId }]);
  const { arrived, step } = travel(ctx, active, target.pos, 1);
  if (arrived && !visible.some((b) => b.bodyId === target.bodyId)) return failed("the body is gone");
  return step;
}

export const REPORT_BODY: G<"REPORT_BODY"> = (ctx, goal, active) => reportBody(ctx, active, goal.bodyId);
export const SELF_REPORT: G<"SELF_REPORT"> = (ctx, goal, active) => reportBody(ctx, active, goal.bodyId);

export const CALL_MEETING: G<"CALL_MEETING"> = (ctx, _goal, active) => {
  if (ctx.obs.self.emergencyMeetingsLeft <= 0) return failed("no emergency meetings left");
  if (ctx.obs.legal.emergency) return canAct(ctx, active, 0.5) ? done([{ type: "CALL_EMERGENCY" }]) : running(STOP);
  const { arrived, step } = travel(ctx, active, ctx.map.def.emergencyButton.pos, Math.min(0.8, ctx.settings.useRange * 0.6));
  if (arrived && elapsed(ctx, active) > secondsToTicks(45)) return failed("button unavailable");
  return step;
};

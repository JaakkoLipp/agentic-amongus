import type { AgentGoal, GoalType } from "@deduction/shared";
import type { ActiveGoal, ExecContext, ExecStep, GoalExecutor } from "./types";
import { failed } from "./helpers";
import { FLEE_BODY, INVESTIGATE, MOVE_TO, SEEK_GROUP, WAIT } from "./goals/movement";
import { AVOID, BUDDY_UP, CONFRONT, CREATE_ALIBI, FOLLOW, FRAME_PLAYER, OBSERVE, PROTECT_TEAMMATE, SPEAK_NEARBY } from "./goals/social";
import { FAKE_TASK, FIX_SABOTAGE, GO_DO_TASK } from "./goals/tasks";
import { CALL_MEETING, REPORT_BODY, SELF_REPORT } from "./goals/emergency";
import { EXIT_VENT, HUNT, KILL, SABOTAGE, SEEK_ISOLATED_PLAYER, VENT } from "./goals/infiltrator";

export type { ActiveGoal, ExecContext, ExecStatus, ExecStep, GoalScratch } from "./types";

type ExecutorTable = { [K in GoalType]: GoalExecutor<Extract<AgentGoal, { type: K }>> };

/** One deterministic executor per goal type. LLMs choose goals; these turn goals into movement and actions. */
const EXECUTORS: ExecutorTable = {
  WAIT,
  MOVE_TO,
  GO_DO_TASK,
  FOLLOW,
  AVOID,
  OBSERVE,
  INVESTIGATE,
  BUDDY_UP,
  SEEK_GROUP,
  FIX_SABOTAGE,
  REPORT_BODY,
  CALL_MEETING,
  CONFRONT,
  SPEAK_NEARBY,
  FAKE_TASK,
  SEEK_ISOLATED_PLAYER,
  HUNT,
  KILL,
  VENT,
  EXIT_VENT,
  SABOTAGE,
  CREATE_ALIBI,
  FLEE_BODY,
  SELF_REPORT,
  FRAME_PLAYER,
  PROTECT_TEAMMATE,
};

export function executeGoal(ctx: ExecContext, active: ActiveGoal): ExecStep {
  const self = ctx.obs.self;
  const goal = active.goal;
  // Ghosts can only keep doing tasks (crew) — everything else is meaningless after death.
  if (!self.alive && goal.type !== "GO_DO_TASK" && goal.type !== "WAIT" && goal.type !== "MOVE_TO") return failed("dead");
  // Never linger inside a vent unless the goal is about vents.
  if (self.inVentId !== null && goal.type !== "VENT" && goal.type !== "EXIT_VENT" && goal.type !== "SABOTAGE") {
    return ctx.obs.legal.ventExit ? { move: null, actions: [{ type: "EXIT_VENT" }], status: "running" } : { move: null, actions: [], status: "running" };
  }
  const executor = EXECUTORS[goal.type] as GoalExecutor;
  return executor(ctx, goal, active);
}

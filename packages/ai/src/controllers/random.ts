import {
  CREW_GOAL_TYPES,
  GOAL_TYPES,
  normalizeGoalDecision,
  secondsToTicks,
  type AgentDecision,
  type ControllerKind,
  type DecisionRequest,
  type GoalDecision,
  type GoalType,
  type PlayerController,
  type PlayerObservation,
} from "@deduction/shared";
import { solveFromViews } from "@deduction/tasks";
import type { AgentContext } from "../context";
import { fallbackDecision } from "./fallback";
import { randomAnswer } from "./taskSolving";

const PHRASES = ["Where was everyone?", "I was doing tasks.", "Skip?", "I think {p} is sus.", "{p} was with me.", "Who found the body?", "Vote {p}.", "No idea honestly."];

/**
 * Chaos monkey. Picks random goals (sometimes with dead or unknown targets), random answers and random votes, which
 * exercises validation, executor failure paths and fallbacks. It is "random but purposeful": roughly half its goals
 * are tasks and it answers honestly half the time, so all-random matches still finish. Only sees its observation.
 */
export class RandomController implements PlayerController {
  readonly kind: ControllerKind = "random";

  constructor(private readonly ctx: AgentContext) {}

  async decide(obs: PlayerObservation, request: DecisionRequest): Promise<AgentDecision> {
    const { rng, map } = this.ctx;
    switch (request.kind) {
      case "roam": {
        const types: readonly GoalType[] = obs.self.role === "crew" ? CREW_GOAL_TYPES : GOAL_TYPES;
        let goal: GoalType = rng.pick(types);
        if (rng.chance(0.45)) goal = obs.self.role === "crew" ? "GO_DO_TASK" : "FAKE_TASK";
        if (obs.legal.kill.length > 0 && rng.chance(0.35)) goal = "KILL";
        const raw: GoalDecision = {
          goal,
          targetPlayerId: goal === "KILL" && obs.legal.kill.length > 0 ? rng.pick(obs.legal.kill) : rng.pick(obs.roster).id,
          targetRoomId: rng.pick(map.areas).id,
          targetTaskId: obs.tasks.length > 0 && rng.chance(0.5) ? rng.pick(obs.tasks).taskId : null,
          sabotageKind: rng.pick(["lights", "reactor", "oxygen", "comms"] as const),
          ventId: rng.chance(0.5) ? rng.pick(map.def.vents).id : null,
          durationSeconds: rng.int(3, 15),
          utterance: rng.chance(0.1) ? "hey" : null,
          reasonSummary: "random",
        };
        const norm = normalizeGoalDecision(raw, obs.self.role);
        if (!norm.ok) return fallbackDecision(request, obs);
        return { kind: "roam", goal: norm.goal, utterance: raw.utterance, reasonSummary: "random" };
      }
      case "task_answer": {
        const task = obs.activeTask;
        if (!task?.view.answerFormat) return { kind: "task_answer", taskId: task?.taskId ?? "", answer: null, thinkTicks: 0, reasonSummary: "random" };
        const seen = this.ctx.memory.taskViewsFor(task.taskId);
        const solved = rng.chance(0.5) ? solveFromViews(task.kind, seen.length > 0 ? seen : [task.view]) : null;
        return { kind: "task_answer", taskId: task.taskId, answer: solved ?? randomAnswer(task.view.answerFormat, rng), thinkTicks: secondsToTicks(rng.float(0.5, 6)), reasonSummary: "random" };
      }
      case "meeting_speech": {
        if (rng.chance(0.4)) return { kind: "meeting_speech", text: null, reasonSummary: "random silence" };
        const who = rng.pick(obs.roster).name;
        return { kind: "meeting_speech", text: rng.pick(PHRASES).replace("{p}", who), reasonSummary: "random" };
      }
      case "vote":
        return { kind: "vote", target: obs.legal.vote.length > 0 ? rng.pick(obs.legal.vote) : "skip", reasonSummary: "random" };
    }
  }
}

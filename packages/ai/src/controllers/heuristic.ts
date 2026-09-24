import type { AgentDecision, ControllerKind, DecisionRequest, MeetingId, PlayerController, PlayerObservation } from "@deduction/shared";
import { DIFFICULTY_PROFILES, type AgentContext } from "../context";
import { crewRoam, infiltratorRoam } from "./heuristicRoam";
import { heuristicStatement, heuristicVote } from "./heuristicSocial";
import { solveLikeABot } from "./taskSolving";

/**
 * Rule-based agent. Uses only its observation and its own memory; personality shifts every threshold.
 * Serves as the M1 baseline opponent, the LLM fallback, and the reference for "legitimate information only".
 */
export class HeuristicController implements PlayerController {
  readonly kind: ControllerKind = "heuristic";
  private readonly said = new Map<MeetingId, Set<string>>();

  constructor(private readonly ctx: AgentContext) {}

  async decide(obs: PlayerObservation, request: DecisionRequest): Promise<AgentDecision> {
    return this.decideSync(obs, request);
  }

  decideSync(obs: PlayerObservation, request: DecisionRequest): AgentDecision {
    const ctx = this.ctx;
    switch (request.kind) {
      case "roam": {
        const choice = obs.self.role === "crew" ? crewRoam(ctx, obs) : infiltratorRoam(ctx, obs);
        return { kind: "roam", goal: choice.goal, utterance: choice.utterance ?? null, reasonSummary: choice.reason };
      }
      case "task_answer": {
        const task = obs.activeTask;
        if (!task) return { kind: "task_answer", taskId: "", answer: null, thinkTicks: 0, reasonSummary: "no active task" };
        const views = ctx.memory.taskViewsFor(task.taskId);
        const seen = views.length > 0 && views[views.length - 1]?.phase === "answer" ? views : [...views, task.view];
        const solved = solveLikeABot(seen, DIFFICULTY_PROFILES[ctx.difficulty], ctx.personality.traits, ctx.memoryQuality, ctx.rng);
        return { kind: "task_answer", taskId: task.taskId, answer: solved.answer, thinkTicks: solved.thinkTicks, reasonSummary: solved.mistake ? "unsure, best guess" : "solved" };
      }
      case "meeting_speech": {
        const meetingId = obs.meeting?.meetingId;
        if (!meetingId) return { kind: "meeting_speech", text: null, reasonSummary: "no meeting" };
        const said = this.said.get(meetingId) ?? new Set<string>();
        this.said.set(meetingId, said);
        const line = heuristicStatement(ctx, obs, said, request.addressedBy ?? []);
        if (!line) return { kind: "meeting_speech", text: null, reasonSummary: "nothing new to add" };
        said.add(line.key);
        return { kind: "meeting_speech", text: line.text, reasonSummary: line.key };
      }
      case "vote": {
        const v = heuristicVote(ctx, obs);
        return { kind: "vote", target: v.target, reasonSummary: v.reason };
      }
    }
  }
}

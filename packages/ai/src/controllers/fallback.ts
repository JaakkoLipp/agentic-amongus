import { isCriticalSabotage, secondsToTicks, type AgentDecision, type DecisionRequest, type PlayerObservation } from "@deduction/shared";

/**
 * Deterministic safety net used whenever a controller fails (provider down, timeout, invalid output, impossible
 * goal). Keeps the agent doing something sensible so the match never stalls:
 *   crew        -> report a visible body, fix a critical sabotage, else nearest unfinished task
 *   infiltrator -> fake the nearest task, else blend into a group
 */
export function fallbackDecision(request: DecisionRequest, obs: PlayerObservation): AgentDecision {
  const reason = "fallback";
  switch (request.kind) {
    case "task_answer":
      return { kind: "task_answer", taskId: obs.activeTask?.taskId ?? "", answer: null, thinkTicks: 0, reasonSummary: reason };
    case "meeting_speech":
      return { kind: "meeting_speech", text: null, reasonSummary: reason };
    case "vote":
      return { kind: "vote", target: "skip", reasonSummary: reason };
    case "roam":
      break;
  }
  const hasTasks = obs.tasks.some((t) => !t.done);
  if (obs.self.inVentId !== null) return roam({ type: "EXIT_VENT" });
  if (!obs.self.alive) return roam(hasTasks && obs.self.role === "crew" ? { type: "GO_DO_TASK", taskId: null } : { type: "WAIT", durationTicks: secondsToTicks(10) });
  if (obs.self.role === "crew") {
    if (obs.visibleBodies.length > 0) return roam({ type: "REPORT_BODY", bodyId: obs.visibleBodies[0]!.bodyId });
    if (obs.sabotage && isCriticalSabotage(obs.sabotage.kind)) return roam({ type: "FIX_SABOTAGE" });
    return roam(hasTasks ? { type: "GO_DO_TASK", taskId: null } : { type: "SEEK_GROUP", durationTicks: secondsToTicks(15) });
  }
  return roam(hasTasks ? { type: "FAKE_TASK", taskId: null } : { type: "SEEK_GROUP", durationTicks: secondsToTicks(15) });

  function roam(goal: Extract<AgentDecision, { kind: "roam" }>["goal"]): AgentDecision {
    return { kind: "roam", goal, utterance: null, reasonSummary: reason };
  }
}

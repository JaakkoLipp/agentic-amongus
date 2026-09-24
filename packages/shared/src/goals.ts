import { z } from "zod";
import type { AreaId, BodyId, PlayerId, TaskId, Tick, VentId } from "./ids";
import type { Role, SabotageKind } from "./roles";
import { secondsToTicks } from "./time";

/**
 * High-level agent goals. An LLM (or heuristic) picks one of these a few times per minute; a deterministic goal
 * executor turns it into movement targets and actions every tick. LLMs never steer movement directly.
 */
export const CREW_GOAL_TYPES = [
  "MOVE_TO",
  "GO_DO_TASK",
  "FOLLOW",
  "AVOID",
  "OBSERVE",
  "INVESTIGATE",
  "BUDDY_UP",
  "SEEK_GROUP",
  "FIX_SABOTAGE",
  "REPORT_BODY",
  "CALL_MEETING",
  "CONFRONT",
  "SPEAK_NEARBY",
  "WAIT",
] as const;

/** Infiltrators may also use every crew goal (blending in is the point). */
export const INFILTRATOR_GOAL_TYPES = [
  "FAKE_TASK",
  "SEEK_ISOLATED_PLAYER",
  "HUNT",
  "KILL",
  "VENT",
  "EXIT_VENT",
  "SABOTAGE",
  "CREATE_ALIBI",
  "FLEE_BODY",
  "SELF_REPORT",
  "FRAME_PLAYER",
  "PROTECT_TEAMMATE",
] as const;

export const GOAL_TYPES = [...CREW_GOAL_TYPES, ...INFILTRATOR_GOAL_TYPES] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export const goalAllowedForRole = (type: GoalType, role: Role): boolean =>
  role === "infiltrator" || (CREW_GOAL_TYPES as readonly string[]).includes(type);

/** Normalized goal used by executors. Durations are in ticks; `null` targets mean "pick the sensible default". */
export type AgentGoal =
  | { readonly type: "WAIT"; readonly durationTicks: Tick }
  | { readonly type: "MOVE_TO"; readonly roomId: AreaId }
  | { readonly type: "GO_DO_TASK"; readonly taskId: TaskId | null }
  | { readonly type: "FOLLOW"; readonly playerId: PlayerId; readonly durationTicks: Tick }
  | { readonly type: "AVOID"; readonly playerId: PlayerId; readonly durationTicks: Tick }
  | { readonly type: "OBSERVE"; readonly playerId: PlayerId; readonly durationTicks: Tick }
  | { readonly type: "INVESTIGATE"; readonly roomId: AreaId }
  | { readonly type: "BUDDY_UP"; readonly playerId: PlayerId; readonly durationTicks: Tick }
  | { readonly type: "SEEK_GROUP"; readonly durationTicks: Tick }
  | { readonly type: "FIX_SABOTAGE" }
  | { readonly type: "REPORT_BODY"; readonly bodyId: BodyId | null }
  | { readonly type: "CALL_MEETING" }
  | { readonly type: "CONFRONT"; readonly playerId: PlayerId; readonly utterance: string }
  | { readonly type: "SPEAK_NEARBY"; readonly utterance: string }
  | { readonly type: "FAKE_TASK"; readonly taskId: TaskId | null }
  | { readonly type: "SEEK_ISOLATED_PLAYER"; readonly durationTicks: Tick }
  | { readonly type: "HUNT"; readonly playerId: PlayerId | null; readonly durationTicks: Tick }
  | { readonly type: "KILL"; readonly playerId: PlayerId }
  /** Enter the nearest vent and travel through the network to `ventId` (or just hide if null). */
  | { readonly type: "VENT"; readonly ventId: VentId | null }
  | { readonly type: "EXIT_VENT" }
  | { readonly type: "SABOTAGE"; readonly kind: SabotageKind }
  | { readonly type: "CREATE_ALIBI"; readonly playerId: PlayerId | null; readonly durationTicks: Tick }
  | { readonly type: "FLEE_BODY" }
  | { readonly type: "SELF_REPORT"; readonly bodyId: BodyId | null }
  | { readonly type: "FRAME_PLAYER"; readonly playerId: PlayerId; readonly durationTicks: Tick }
  | { readonly type: "PROTECT_TEAMMATE"; readonly playerId: PlayerId; readonly durationTicks: Tick };

/**
 * Flat structured-output schema for roaming decisions (what an LLM returns). Nullable fields keep it easy for
 * small local models to fill in. Validated with Zod, then normalized with `normalizeGoalDecision`.
 */
export const GoalDecisionSchema = z.object({
  goal: z.enum(GOAL_TYPES),
  targetPlayerId: z.string().max(32).nullable().default(null),
  targetRoomId: z.string().max(48).nullable().default(null),
  targetTaskId: z.string().max(64).nullable().default(null),
  sabotageKind: z.enum(["lights", "reactor", "oxygen", "comms"]).nullable().default(null),
  ventId: z.string().max(48).nullable().default(null),
  durationSeconds: z.number().min(1).max(60).nullable().default(null),
  utterance: z.string().max(200).nullable().default(null),
  reasonSummary: z.string().max(240).nullable().default(null),
});
export type GoalDecision = z.infer<typeof GoalDecisionSchema>;

export type NormalizeResult = { readonly ok: true; readonly goal: AgentGoal } | { readonly ok: false; readonly error: string };

const DEFAULT_GOAL_SECONDS = 12;

/** Structural normalization only; semantic checks (does the target exist / is it visible) happen in the executor. */
export function normalizeGoalDecision(d: GoalDecision, role: Role): NormalizeResult {
  if (!goalAllowedForRole(d.goal, role)) return { ok: false, error: `goal ${d.goal} not allowed for ${role}` };
  const durationTicks = secondsToTicks(d.durationSeconds ?? DEFAULT_GOAL_SECONDS);
  const needPlayer = (): PlayerId | null => d.targetPlayerId;
  const needRoom = (): AreaId | null => d.targetRoomId;
  const missing = (field: string): NormalizeResult => ({ ok: false, error: `${d.goal} requires ${field}` });

  switch (d.goal) {
    case "WAIT":
      return { ok: true, goal: { type: "WAIT", durationTicks: secondsToTicks(d.durationSeconds ?? 3) } };
    case "MOVE_TO":
    case "INVESTIGATE": {
      const roomId = needRoom();
      if (!roomId) return missing("targetRoomId");
      return { ok: true, goal: { type: d.goal, roomId } };
    }
    case "GO_DO_TASK":
    case "FAKE_TASK":
      return { ok: true, goal: { type: d.goal, taskId: d.targetTaskId } };
    case "FOLLOW":
    case "AVOID":
    case "OBSERVE":
    case "BUDDY_UP":
    case "FRAME_PLAYER":
    case "PROTECT_TEAMMATE": {
      const playerId = needPlayer();
      if (!playerId) return missing("targetPlayerId");
      return { ok: true, goal: { type: d.goal, playerId, durationTicks } };
    }
    case "KILL": {
      const playerId = needPlayer();
      if (!playerId) return missing("targetPlayerId");
      return { ok: true, goal: { type: "KILL", playerId } };
    }
    case "HUNT":
    case "CREATE_ALIBI":
      return { ok: true, goal: { type: d.goal, playerId: d.targetPlayerId, durationTicks } };
    case "SEEK_GROUP":
    case "SEEK_ISOLATED_PLAYER":
      return { ok: true, goal: { type: d.goal, durationTicks } };
    case "FIX_SABOTAGE":
    case "CALL_MEETING":
    case "EXIT_VENT":
    case "FLEE_BODY":
      return { ok: true, goal: { type: d.goal } };
    case "REPORT_BODY":
    case "SELF_REPORT":
      return { ok: true, goal: { type: d.goal, bodyId: null } };
    case "CONFRONT": {
      const playerId = needPlayer();
      if (!playerId) return missing("targetPlayerId");
      return { ok: true, goal: { type: "CONFRONT", playerId, utterance: d.utterance ?? "Where have you been?" } };
    }
    case "SPEAK_NEARBY":
      if (!d.utterance) return missing("utterance");
      return { ok: true, goal: { type: "SPEAK_NEARBY", utterance: d.utterance } };
    case "VENT":
      return { ok: true, goal: { type: "VENT", ventId: d.ventId } };
    case "SABOTAGE":
      if (!d.sabotageKind) return missing("sabotageKind");
      return { ok: true, goal: { type: "SABOTAGE", kind: d.sabotageKind } };
  }
}

/** Short human-readable label used in logs and the inspector timeline. */
export function describeGoal(goal: AgentGoal): string {
  switch (goal.type) {
    case "MOVE_TO":
    case "INVESTIGATE":
      return `${goal.type} ${goal.roomId}`;
    case "GO_DO_TASK":
    case "FAKE_TASK":
      return goal.taskId ? `${goal.type} ${goal.taskId}` : goal.type;
    case "FOLLOW":
    case "AVOID":
    case "OBSERVE":
    case "BUDDY_UP":
    case "FRAME_PLAYER":
    case "PROTECT_TEAMMATE":
    case "KILL":
    case "CONFRONT":
      return `${goal.type} ${goal.playerId}`;
    case "HUNT":
    case "CREATE_ALIBI":
      return goal.playerId ? `${goal.type} ${goal.playerId}` : goal.type;
    case "SABOTAGE":
      return `SABOTAGE ${goal.kind}`;
    case "VENT":
      return goal.ventId ? `VENT to ${goal.ventId}` : "VENT";
    default:
      return goal.type;
  }
}

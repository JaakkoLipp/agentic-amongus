import { z } from "zod";
import type { BodyId, PlayerId, StationId, TaskId, VentId } from "./ids";
import type { SabotageKind } from "./roles";
import type { Vec2 } from "./math";

export type VoteTarget = PlayerId | "skip";

/**
 * Discrete player actions. Humans send these over the WebSocket; agents produce them through goal executors.
 * The engine validates every one against the authoritative state — nothing here is trusted.
 */
export type PlayerAction =
  | { readonly type: "START_TASK"; readonly taskId: TaskId }
  | { readonly type: "CANCEL_TASK" }
  | { readonly type: "SUBMIT_TASK_ANSWER"; readonly taskId: TaskId; readonly answer: unknown }
  | { readonly type: "KILL"; readonly targetId: PlayerId }
  | { readonly type: "REPORT_BODY"; readonly bodyId: BodyId }
  | { readonly type: "CALL_EMERGENCY" }
  | { readonly type: "ENTER_VENT"; readonly ventId: VentId }
  | { readonly type: "MOVE_VENT"; readonly toVentId: VentId }
  | { readonly type: "EXIT_VENT" }
  | { readonly type: "SABOTAGE"; readonly kind: SabotageKind }
  | { readonly type: "START_REPAIR"; readonly stationId: StationId }
  | { readonly type: "STOP_REPAIR" }
  /** Proximity speech while playing; a meeting message during meeting discussion phases. */
  | { readonly type: "SPEAK"; readonly text: string }
  | { readonly type: "VOTE"; readonly target: VoteTarget };

export type PlayerActionType = PlayerAction["type"];

/** Continuous movement intent, separate from discrete actions. */
export type MoveIntent =
  | { readonly mode: "stop" }
  /** Direct input (human WASD). Direction is clamped to unit length. */
  | { readonly mode: "direction"; readonly dir: Vec2 }
  /** Engine pathfinds to the target point and follows the route. Used by agent goal executors. */
  | { readonly mode: "path"; readonly target: Vec2 };

export type ActionRejectReason =
  | "not_playing"
  | "dead"
  | "wrong_role"
  | "out_of_range"
  | "no_line_of_sight"
  | "cooldown"
  | "invalid_target"
  | "busy"
  | "in_vent"
  | "not_in_vent"
  | "unknown_task"
  | "task_done"
  | "wrong_phase"
  | "already_reported"
  | "no_meetings_left"
  | "sabotage_active"
  | "already_voted"
  | "malformed"
  | "rate_limited";

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: ActionRejectReason };

const id = z.string().min(1).max(64);
const SabotageKindSchema = z.enum(["lights", "reactor", "oxygen", "comms"]);

/** Wire-level validation of actions arriving from untrusted clients. */
export const PlayerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("START_TASK"), taskId: id }),
  z.object({ type: z.literal("CANCEL_TASK") }),
  z.object({ type: z.literal("SUBMIT_TASK_ANSWER"), taskId: id, answer: z.unknown() }),
  z.object({ type: z.literal("KILL"), targetId: id }),
  z.object({ type: z.literal("REPORT_BODY"), bodyId: id }),
  z.object({ type: z.literal("CALL_EMERGENCY") }),
  z.object({ type: z.literal("ENTER_VENT"), ventId: id }),
  z.object({ type: z.literal("MOVE_VENT"), toVentId: id }),
  z.object({ type: z.literal("EXIT_VENT") }),
  z.object({ type: z.literal("SABOTAGE"), kind: SabotageKindSchema }),
  z.object({ type: z.literal("START_REPAIR"), stationId: id }),
  z.object({ type: z.literal("STOP_REPAIR") }),
  z.object({ type: z.literal("SPEAK"), text: z.string().min(1).max(500) }),
  z.object({ type: z.literal("VOTE"), target: id }),
]);

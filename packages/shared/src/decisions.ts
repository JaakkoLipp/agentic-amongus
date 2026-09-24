import type { PlayerId, TaskId, Tick } from "./ids";
import type { VoteTarget } from "./actions";
import type { AgentGoal } from "./goals";
import type { TaskAnswer } from "./tasks";

/**
 * Decisions are requested by the runtime's scheduler, never polled per frame.
 * Each kind is a separate inference for LLM agents (in particular, speech and voting are never combined).
 */
export type DecisionKind = "roam" | "task_answer" | "meeting_speech" | "vote";

export type DecisionTrigger =
  | "initial"
  | "heartbeat"
  | "goal_completed"
  | "goal_failed"
  | "body_seen"
  | "player_appeared"
  | "player_disappeared"
  | "kill_opportunity"
  | "kill_witnessed"
  | "vent_witnessed"
  | "sabotage_started"
  | "sabotage_ended"
  | "heard_speech"
  | "addressed"
  | "task_answer_phase"
  | "meeting_turn"
  | "voting_started"
  | "revision_changed";

export interface DecisionRequest {
  readonly kind: DecisionKind;
  /**
   * The agent's decision revision when the request was issued. Results that come back after the revision moved on
   * (meeting started, agent died, goal invalidated, sabotage changed...) are discarded as stale.
   */
  readonly revision: number;
  readonly tick: Tick;
  readonly triggers: readonly DecisionTrigger[];
  /** For meeting_speech: players who addressed this agent since it last spoke. */
  readonly addressedBy?: readonly PlayerId[];
}

export type AgentDecision =
  | { readonly kind: "roam"; readonly goal: AgentGoal; readonly utterance: string | null; readonly reasonSummary: string | null }
  | {
      readonly kind: "task_answer";
      readonly taskId: TaskId;
      /** null = give up and walk away from the console. */
      readonly answer: TaskAnswer | null;
      /** Simulated thinking time before the answer is submitted (heuristic bots); LLM latency is real instead. */
      readonly thinkTicks: Tick;
      readonly reasonSummary: string | null;
    }
  /** `text: null` = deliberately stay quiet this turn. */
  | { readonly kind: "meeting_speech"; readonly text: string | null; readonly reasonSummary: string | null }
  | { readonly kind: "vote"; readonly target: VoteTarget; readonly reasonSummary: string | null };

export type DecisionOf<K extends DecisionKind> = Extract<AgentDecision, { kind: K }>;

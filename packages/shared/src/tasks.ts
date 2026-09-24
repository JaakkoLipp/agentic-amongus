import type { JsonObject, TaskId, Tick } from "./ids";

/**
 * Public task model shared by engine, AI and client.
 * Concrete generators/validators live in @deduction/tasks; this file only holds what crosses package boundaries.
 */
export const TASK_KINDS = [
  "sequence_recall",
  "working_memory",
  "pattern_match",
  "symbol_match",
  "arithmetic",
  "instruction_following",
  "classification",
  "anomaly_detection",
  "temporal_reasoning",
  "spatial_reasoning",
  "route_planning",
  "rule_composition",
  "short_logic",
  "sorting",
  "checksum",
] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export type TaskDifficulty = 1 | 2 | 3;

/**
 * Tasks run as a short sequence of phases.
 * Memory tasks use observe -> delay -> answer, and the answer-phase view must not contain the remembered data.
 * Non-memory tasks usually have a single answer phase.
 */
export type TaskPhaseKind = "observe" | "delay" | "answer";

export interface TaskPhaseSpec {
  readonly kind: TaskPhaseKind;
  /** Auto-advance after this many ticks; `null` means "until the player answers" (answer phase only). */
  readonly durationTicks: Tick | null;
}

/** How an answer must be shaped. Drives the generic human UI and the LLM answer schema. */
export type AnswerFormat =
  | { readonly type: "sequence"; readonly length: number; readonly alphabet: readonly string[] }
  | { readonly type: "choice"; readonly options: readonly TaskOption[] }
  | { readonly type: "multi_choice"; readonly options: readonly TaskOption[]; readonly count: number | null }
  | { readonly type: "number" }
  | { readonly type: "text"; readonly maxLength: number }
  | { readonly type: "ordering"; readonly items: readonly TaskOption[] }
  | { readonly type: "path"; readonly nodes: readonly string[] };

export interface TaskOption {
  readonly id: string;
  readonly label: string;
}

/** Raw answer as submitted by a human or an agent. Validated per task kind by a Zod schema before checking. */
export type TaskAnswer = string | number | readonly string[];

/**
 * Everything a player is shown during one phase of a task instance.
 * The same view is rendered graphically for humans and serialized for LLMs, so both see identical information.
 */
export interface TaskView {
  readonly taskId: TaskId;
  readonly kind: TaskKind;
  readonly phase: TaskPhaseKind;
  readonly title: string;
  /** Plain-language instruction for this phase. */
  readonly prompt: string;
  /** Kind-specific structured payload for rendering (grid cells, symbols, log lines, graph edges...). */
  readonly content: JsonObject;
  /** Present only in the answer phase. */
  readonly answerFormat: AnswerFormat | null;
}

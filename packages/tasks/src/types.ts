import type { z } from "zod";
import type {
  JsonObject,
  Rng,
  TaskAnswer,
  TaskDifficulty,
  TaskId,
  TaskKind,
  TaskPhaseKind,
  TaskPhaseSpec,
  TaskView,
} from "@deduction/shared";

export type TaskCategory = "memory" | "perception" | "arithmetic" | "reasoning" | "planning" | "ordering";

/**
 * A generated task. `data` is server-only: it may contain the solution and must never be sent to a client or LLM
 * directly — only `TaskView`s produced by the definition are shown to players.
 */
export interface TaskInstance<D extends JsonObject = JsonObject> {
  readonly id: TaskId;
  readonly kind: TaskKind;
  readonly difficulty: TaskDifficulty;
  readonly data: D;
}

export interface TaskDefinition<D extends JsonObject = JsonObject, A extends TaskAnswer = TaskAnswer> {
  readonly kind: TaskKind;
  /** Short in-world console name, e.g. "Relay Sequence". */
  readonly title: string;
  readonly category: TaskCategory;
  /** Memory tasks hide the information before the answer phase. */
  readonly isMemoryTask: boolean;

  /** Pure and deterministic given the RNG state. */
  generate(rng: Rng, difficulty: TaskDifficulty): D;

  /** Phase schedule. Memory tasks: observe -> delay -> answer. Others: answer only. */
  phases(data: D, difficulty: TaskDifficulty): readonly TaskPhaseSpec[];

  /** What the player sees in a phase. For memory tasks the answer view must not contain the remembered data. */
  view(instance: TaskInstance<D>, phase: TaskPhaseKind): TaskView;

  /** Shape validation for untrusted answers (from humans over the wire, or from LLM output). */
  readonly answerSchema: z.ZodType<A>;

  /** Deterministic correctness check. Never trusts the caller. */
  check(data: D, answer: A): boolean;

  /**
   * Reference solver that may only use the views a player was shown (in phase order).
   * Used by tests to prove every task is solvable from its views, and by heuristic bots to "solve honestly".
   * Returns null if the views do not contain enough information (e.g. only the answer view of a memory task).
   */
  solveFromViews(views: readonly TaskView[]): TaskAnswer | null;
}

export type AnswerCheck =
  | { readonly ok: true; readonly correct: boolean }
  | { readonly ok: false; readonly reason: "malformed" | "wrong_task" };

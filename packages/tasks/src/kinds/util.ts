import { z } from "zod";
import type {
  AnswerFormat,
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
import type { TaskDefinition } from "../types";

/**
 * Identity helper that gives the object literal contextual typing for its data/answer types.
 * The result is assignable to the erased `TaskDefinition` used by `TASK_DEFINITIONS` without any cast:
 * TaskDefinition's callbacks use method syntax (bivariant parameters) and `answerSchema` is covariant.
 */
export function defineTask<D extends JsonObject, A extends TaskAnswer>(def: TaskDefinition<D, A>): TaskDefinition<D, A> {
  return def;
}

// ---------------------------------------------------------------------------------------------------------------
// Phases

export const DELAY_TICKS = 30;
export const ANSWER_ONLY_PHASES: readonly TaskPhaseSpec[] = [{ kind: "answer", durationTicks: null }];

/** observe (75 / 90 / 105 ticks by difficulty) -> 1 s delay -> answer. */
export function memoryPhases(difficulty: TaskDifficulty): readonly TaskPhaseSpec[] {
  return [
    { kind: "observe", durationTicks: 60 + 15 * difficulty },
    { kind: "delay", durationTicks: DELAY_TICKS },
    { kind: "answer", durationTicks: null },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Views

type ViewTarget = { readonly id: TaskId; readonly kind: TaskKind };

/** `answerFormat` is forced to null outside the answer phase. */
export function buildView(
  instance: ViewTarget,
  title: string,
  phase: TaskPhaseKind,
  prompt: string,
  content: JsonObject,
  answerFormat: AnswerFormat | null = null,
): TaskView {
  return {
    taskId: instance.id,
    kind: instance.kind,
    phase,
    title,
    prompt,
    content,
    answerFormat: phase === "answer" ? answerFormat : null,
  };
}

/**
 * Convention for phases that are not in a kind's schedule (observe/delay of an answer-only task):
 * return an empty standby view rather than throwing, so a mis-sequenced caller can never crash or leak data.
 */
export function standbyView(instance: ViewTarget, title: string, phase: TaskPhaseKind): TaskView {
  return buildView(instance, title, phase, "Stand by. This console has nothing to show in this phase.", {});
}

/** Parse the content of the first view with the given phase. Null if absent or not shaped as expected. */
export function readView<T>(views: readonly TaskView[], phase: TaskPhaseKind, schema: z.ZodType<T>): T | null {
  const view = views.find((v) => v.phase === phase);
  if (!view) return null;
  const parsed = schema.safeParse(view.content);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Answers

export const CHOICE_IDS = ["A", "B", "C", "D"] as const;
export const choiceIdSchema = z.enum(CHOICE_IDS);

/** "A", "B", ... for index 0, 1, ... */
export const letter = (index: number): string => String.fromCharCode(65 + index);

/** Integer answers: finite, safe, bounded. Rejects NaN, Infinity, fractions and strings. */
export const integerAnswerSchema = z.int().min(-1_000_000).max(1_000_000);

export const hasNoDuplicates = (items: readonly string[]): boolean => new Set(items).size === items.length;

export function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Set equality; a list with duplicates never matches. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (!hasNoDuplicates(a) || !hasNoDuplicates(b) || a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((v) => bs.has(v));
}

// ---------------------------------------------------------------------------------------------------------------
// Misc

/** Shuffle, retrying (bounded) until the order differs from the input. Lists of length < 2 are returned as-is. */
export function shuffleChanged<T>(rng: Rng, items: readonly T[]): T[] {
  let out = rng.shuffle(items);
  for (let i = 0; i < 20 && items.length > 1 && out.every((v, k) => v === items[k]); i++) out = rng.shuffle(items);
  if (items.length > 1 && out.every((v, k) => v === items[k])) out = [...items.slice(1), ...items.slice(0, 1)];
  return out;
}

/** All permutations (only used for tiny lists, n <= 6). */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) out.push([item, ...perm]);
  });
  return out;
}

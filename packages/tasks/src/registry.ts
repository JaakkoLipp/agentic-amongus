import type {
  AnswerFormat,
  Rng,
  TaskAnswer,
  TaskDifficulty,
  TaskId,
  TaskKind,
  TaskPhaseKind,
  TaskPhaseSpec,
  TaskView,
} from "@deduction/shared";
import { answerFitsFormat } from "./format";
import { TASK_DEFINITIONS } from "./kinds";
import type { AnswerCheck, TaskDefinition, TaskInstance } from "./types";

const byKind = new Map<TaskKind, TaskDefinition>(TASK_DEFINITIONS.map((d) => [d.kind, d]));

export function getTaskDefinition(kind: TaskKind): TaskDefinition {
  const def = byKind.get(kind);
  if (!def) throw new Error(`Unknown task kind: ${kind}`);
  return def;
}

export const registeredTaskKinds = (): TaskKind[] => [...byKind.keys()];

export function generateTaskInstance(id: TaskId, kind: TaskKind, difficulty: TaskDifficulty, rng: Rng): TaskInstance {
  const def = getTaskDefinition(kind);
  return { id, kind, difficulty, data: def.generate(rng, difficulty) };
}

export const taskPhases = (instance: TaskInstance): readonly TaskPhaseSpec[] =>
  getTaskDefinition(instance.kind).phases(instance.data, instance.difficulty);

export const taskView = (instance: TaskInstance, phase: TaskPhaseKind): TaskView =>
  getTaskDefinition(instance.kind).view(instance, phase);

/** The single validation entry point used for humans and agents alike. */
export function checkTaskAnswer(instance: TaskInstance, rawAnswer: unknown): AnswerCheck {
  const def = getTaskDefinition(instance.kind);
  const parsed = def.answerSchema.safeParse(rawAnswer);
  if (!parsed.success) return { ok: false, reason: "malformed" };
  // Per-instance shape: right length, only ids offered in this instance, orderings are permutations.
  if (!answerFitsFormat(parsed.data, def.view(instance, "answer").answerFormat)) return { ok: false, reason: "malformed" };
  return { ok: true, correct: def.check(instance.data, parsed.data) };
}

export function solveFromViews(kind: TaskKind, views: readonly TaskView[]): TaskAnswer | null {
  return getTaskDefinition(kind).solveFromViews(views);
}

/**
 * Produce a plausible but different answer. Heuristic bots use this to make human-like mistakes
 * without any task-specific cheating.
 */
export function mutateAnswer(correct: TaskAnswer, format: AnswerFormat, rng: Rng): TaskAnswer {
  if (typeof correct === "number") {
    const delta = rng.pick([-3, -2, -1, 1, 2, 3, 10, -10]);
    return correct + delta;
  }
  if (typeof correct === "string") {
    if (format.type === "choice") {
      const others = format.options.filter((o) => o.id !== correct);
      return others.length > 0 ? rng.pick(others).id : correct;
    }
    return correct.length > 0 ? correct.slice(0, -1) : "?";
  }
  const arr = [...correct];
  if (format.type === "multi_choice") {
    // Selections are sets, so reordering would not change the answer: swap one selected id for an unselected one.
    const unselected = format.options.map((o) => o.id).filter((id) => !correct.includes(id));
    if (arr.length > 0 && unselected.length > 0) {
      arr[rng.int(0, arr.length - 1)] = rng.pick(unselected);
      return arr;
    }
    if (arr.length > 0) return arr.slice(0, -1);
    return unselected.length > 0 ? [rng.pick(unselected)] : ["?"];
  }
  if (arr.length >= 2) {
    const i = rng.int(0, arr.length - 2);
    const a = arr[i] as string;
    arr[i] = arr[i + 1] as string;
    arr[i + 1] = a;
    if (arr.some((v, k) => v !== correct[k])) return arr;
  }
  if (format.type === "sequence" && format.alphabet.length > 1 && arr.length > 0) {
    const i = rng.int(0, arr.length - 1);
    const alternatives = format.alphabet.filter((s) => s !== arr[i]);
    arr[i] = rng.pick(alternatives);
    return arr;
  }
  return arr.length > 0 ? arr.slice(0, -1) : ["?"];
}

/** Compact, deterministic text rendering of a view for LLM prompts and logs. */
export function describeTaskView(view: TaskView): string {
  const lines = [`TASK ${view.title} [${view.kind}] phase=${view.phase}`, view.prompt];
  if (Object.keys(view.content).length > 0) lines.push(`DATA ${JSON.stringify(view.content)}`);
  if (view.answerFormat) lines.push(`ANSWER_FORMAT ${JSON.stringify(view.answerFormat)}`);
  return lines.join("\n");
}

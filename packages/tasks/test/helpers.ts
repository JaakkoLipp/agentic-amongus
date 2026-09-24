import { deriveRng } from "@deduction/shared";
import type { AnswerFormat, JsonObject, TaskDifficulty, TaskKind, TaskView } from "@deduction/shared";
import { generateTaskInstance, taskPhases, taskView } from "../src";
import type { TaskInstance } from "../src";

export const DIFFICULTIES: readonly TaskDifficulty[] = [1, 2, 3];
export const SEEDS = 150;

/** Task ids deliberately contain no digits so "does the view reveal the digits" checks stay meaningful. */
export const makeInstance = (kind: TaskKind, difficulty: TaskDifficulty, seed: number): TaskInstance =>
  generateTaskInstance(`task-${kind}`, kind, difficulty, deriveRng(seed, "test", kind, difficulty));

/** Hand-written fixture instance. */
export const fixture = (kind: TaskKind, data: JsonObject, difficulty: TaskDifficulty = 1): TaskInstance => ({
  id: "fixture",
  kind,
  difficulty,
  data,
});

export const viewsFor = (instance: TaskInstance): TaskView[] =>
  taskPhases(instance).map((p) => taskView(instance, p.kind));

export function answerFormatOf(instance: TaskInstance): AnswerFormat {
  const format = taskView(instance, "answer").answerFormat;
  if (!format) throw new Error("answer view has no answerFormat");
  return format;
}

export const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

/** Every object key appearing anywhere in a JSON value. */
export function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
  }
  return [];
}

/** Loop over SEEDS generated instances of one kind and difficulty. */
export function forEachInstance(
  kind: TaskKind,
  difficulty: TaskDifficulty,
  fn: (instance: TaskInstance, seed: number) => void,
  seeds = SEEDS,
): void {
  for (let seed = 0; seed < seeds; seed++) fn(makeInstance(kind, difficulty, seed), seed);
}

/** Typed access to an instance's data in tests (the data shape is owned by the kind under test). */
export const dataOf = <D>(instance: TaskInstance): D => instance.data as unknown as D;

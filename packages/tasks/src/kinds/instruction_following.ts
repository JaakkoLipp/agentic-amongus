import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, integerAnswerSchema, readView, standbyView } from "./util";

const TITLE = "Coolant Procedure";

const STEP_OPS = [
  "add",
  "subtract",
  "double",
  "halve_if_even",
  "add_if_odd",
  "subtract_if_greater",
  "add_if_less",
] as const;
type StepOp = (typeof STEP_OPS)[number];
const CONDITIONAL: readonly StepOp[] = ["halve_if_even", "add_if_odd", "subtract_if_greater", "add_if_less"];

/** `amount` / `threshold` are null when the operation does not use them. */
export type Step = { op: StepOp; amount: number | null; threshold: number | null };
export type InstructionData = { start: number; steps: Step[] };

const MAX_VALUE = 60;
const STEP_COUNT: Record<TaskDifficulty, number> = { 1: 3, 2: 4, 3: 5 };
const MIN_CONDITIONALS: Record<TaskDifficulty, number> = { 1: 0, 2: 1, 3: 2 };
const OP_WEIGHT: Record<TaskDifficulty, Readonly<Record<StepOp, number>>> = {
  1: { add: 4, subtract: 3, double: 3, halve_if_even: 1, add_if_odd: 1, subtract_if_greater: 0, add_if_less: 0 },
  2: { add: 3, subtract: 3, double: 2, halve_if_even: 2, add_if_odd: 2, subtract_if_greater: 1, add_if_less: 1 },
  3: { add: 2, subtract: 2, double: 2, halve_if_even: 2, add_if_odd: 2, subtract_if_greater: 2, add_if_less: 2 },
};

export function applyStep(value: number, step: Step): number {
  const amount = step.amount ?? 0;
  const threshold = step.threshold ?? 0;
  switch (step.op) {
    case "add":
      return value + amount;
    case "subtract":
      return value - amount;
    case "double":
      return value * 2;
    case "halve_if_even":
      return value % 2 === 0 ? value / 2 : value;
    case "add_if_odd":
      return Math.abs(value % 2) === 1 ? value + amount : value;
    case "subtract_if_greater":
      return value > threshold ? value - amount : value;
    case "add_if_less":
      return value < threshold ? value + amount : value;
  }
}

export function stepText(step: Step): string {
  const amount = step.amount ?? 0;
  const threshold = step.threshold ?? 0;
  switch (step.op) {
    case "add":
      return `Add ${amount}.`;
    case "subtract":
      return `Subtract ${amount}.`;
    case "double":
      return "Double the value.";
    case "halve_if_even":
      return "If the value is even, halve it.";
    case "add_if_odd":
      return `If the value is odd, add ${amount}.`;
    case "subtract_if_greater":
      return `If the value is greater than ${threshold}, subtract ${amount}.`;
    case "add_if_less":
      return `If the value is less than ${threshold}, add ${amount}.`;
  }
}

function randomStep(rng: Rng, value: number, difficulty: TaskDifficulty): Step {
  const weights = OP_WEIGHT[difficulty];
  const op = rng.weighted(STEP_OPS, (o) => {
    if (o === "subtract" && value < 1) return 0;
    if (o === "double" && value > 25) return 0;
    return weights[o];
  });
  switch (op) {
    case "add":
      return { op, amount: rng.int(1, 9), threshold: null };
    case "subtract":
      return { op, amount: rng.int(1, Math.min(9, value)), threshold: null };
    case "double":
    case "halve_if_even":
      return { op, amount: null, threshold: null };
    case "add_if_odd":
      return { op, amount: rng.int(1, 5), threshold: null };
    case "subtract_if_greater": {
      // When the condition holds, value >= threshold + 1 >= amount, so the result stays non-negative.
      const threshold = rng.int(Math.max(0, value - 4), value + 4);
      return { op, amount: rng.int(1, Math.min(9, threshold + 1)), threshold };
    }
    case "add_if_less":
      return { op, amount: rng.int(1, 9), threshold: rng.int(Math.max(1, value - 4), value + 4) };
  }
}

export function runProcedure(start: number, steps: readonly Step[]): number {
  return steps.reduce(applyStep, start);
}

function tryGenerate(rng: Rng, difficulty: TaskDifficulty): InstructionData | null {
  const start = rng.int(2, 12);
  const steps: Step[] = [];
  let value = start;
  while (steps.length < STEP_COUNT[difficulty]) {
    const step = randomStep(rng, value, difficulty);
    const next = applyStep(value, step);
    if (next < 0 || next > MAX_VALUE) return null;
    steps.push(step);
    value = next;
  }
  const conditionals = steps.filter((s) => CONDITIONAL.includes(s.op)).length;
  return conditionals >= MIN_CONDITIONALS[difficulty] ? { start, steps } : null;
}

/** Always valid from start 6: 6 -> 9 -> 10 -> 5 -> 10 -> 6. */
const FALLBACK_STEPS: readonly Step[] = [
  { op: "add", amount: 3, threshold: null },
  { op: "add_if_odd", amount: 1, threshold: null },
  { op: "halve_if_even", amount: null, threshold: null },
  { op: "double", amount: null, threshold: null },
  { op: "subtract", amount: 4, threshold: null },
];

const stepSchema = z.object({
  op: z.enum(STEP_OPS),
  amount: z.number().nullable(),
  threshold: z.number().nullable(),
});
const answerContent = z.object({ start: z.number(), steps: z.array(stepSchema).max(16) });

/** Reasoning: run a start value through 3/4/5 ordered (partly conditional) steps. */
export const instructionFollowing = defineTask<InstructionData, number>({
  kind: "instruction_following",
  title: TITLE,
  category: "reasoning",
  isMemoryTask: false,

  generate(rng, difficulty) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const data = tryGenerate(rng, difficulty);
      if (data) return data;
    }
    return { start: 6, steps: FALLBACK_STEPS.slice(0, STEP_COUNT[difficulty]) };
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { start, steps } = instance.data;
    return buildView(
      instance,
      TITLE,
      phase,
      `Start with the value ${start} and apply the steps in order, top to bottom. A conditional step only applies ` +
        "if its condition is true for the value at that moment. Enter the final value.",
      { start, steps: steps.map((s) => ({ text: stepText(s), op: s.op, amount: s.amount, threshold: s.threshold })) },
      { type: "number" },
    );
  },

  answerSchema: integerAnswerSchema,

  check: (data, answer) => runProcedure(data.start, data.steps) === answer,

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    return content ? runProcedure(content.start, content.steps) : null;
  },
});

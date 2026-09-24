import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, integerAnswerSchema, readView, standbyView } from "./util";

const TITLE = "Power Calibration";
export const TIMES = "×";

/** Alternating number / operator tokens, e.g. ["17", "+", "8", "-", "4"]. Operators: + - ×. */
export type ArithmeticData = { tokens: string[] };

/** Signed terms after collapsing multiplications (× binds tighter than + and -). Null if malformed. */
function signedTerms(tokens: readonly string[]): number[] | null {
  if (tokens.length % 2 === 0) return null;
  const terms: number[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const tok = tokens[i] ?? "";
    if (!/^\d{1,6}$/.test(tok)) return null;
    const value = Number(tok);
    const op = i === 0 ? "+" : tokens[i - 1];
    if (op === TIMES) {
      const last = terms.pop();
      if (last === undefined) return null;
      terms.push(last * value);
    } else if (op === "+" || op === "-") {
      terms.push(op === "+" ? value : -value);
    } else {
      return null;
    }
  }
  return terms;
}

/** Value of the expression with standard precedence; null if the token list is malformed. */
export function evaluateExpression(tokens: readonly string[]): number | null {
  const terms = signedTerms(tokens);
  return terms ? terms.reduce((acc, t) => acc + t, 0) : null;
}

/** Every left-to-right partial result is non-negative and the result stays small. */
function isFriendly(tokens: readonly string[]): boolean {
  const terms = signedTerms(tokens);
  if (!terms) return false;
  let acc = 0;
  for (const t of terms) {
    acc += t;
    if (acc < 0) return false;
  }
  return acc <= 250;
}

const NUMBER_RANGE: Record<TaskDifficulty, readonly [number, number]> = { 1: [2, 20], 2: [2, 30], 3: [2, 25] };

function randomTokens(rng: Rng, difficulty: TaskDifficulty): string[] {
  const opCount = difficulty === 1 ? 2 : 3;
  const ops = Array.from({ length: opCount }, () => rng.pick(["+", "-"]));
  const timesAt = difficulty === 3 ? rng.int(0, opCount - 1) : -1;
  if (timesAt >= 0) ops[timesAt] = TIMES;
  const [lo, hi] = NUMBER_RANGE[difficulty];
  const nums = Array.from({ length: opCount + 1 }, (_, i) => {
    if (i === timesAt) return rng.int(2, 12);
    if (i === timesAt + 1) return rng.int(2, 9);
    return rng.int(lo, hi);
  });
  return nums.flatMap((n, i) => (i === 0 ? [String(n)] : [ops[i - 1] ?? "+", String(n)]));
}

const answerContent = z.object({ tokens: z.array(z.string().max(8)).max(32) });

/** Arithmetic: evaluate a short expression (d1: 2 ops +/-, d2: 3 ops, d3: 3 ops incl. one ×). */
export const arithmetic = defineTask<ArithmeticData, number>({
  kind: "arithmetic",
  title: TITLE,
  category: "arithmetic",
  isMemoryTask: false,

  generate(rng, difficulty) {
    let tokens = randomTokens(rng, difficulty);
    for (let attempt = 0; attempt < 200 && !isFriendly(tokens); attempt++) tokens = randomTokens(rng, difficulty);
    // Deterministic fallback: turning every minus into a plus always keeps partial results non-negative.
    if (!isFriendly(tokens)) tokens = tokens.map((t) => (t === "-" ? "+" : t));
    return { tokens };
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const tokens = instance.data.tokens;
    return buildView(
      instance,
      TITLE,
      phase,
      "Compute the value of the calibration expression and enter it as a whole number. Multiplication (×) is done " +
        "before addition and subtraction; otherwise work from left to right.",
      { expression: tokens.join(" "), tokens: [...tokens] },
      { type: "number" },
    );
  },

  answerSchema: integerAnswerSchema,

  check: (data, answer) => evaluateExpression(data.tokens) === answer,

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    return content ? evaluateExpression(content.tokens) : null;
  },
});

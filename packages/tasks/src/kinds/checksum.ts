import { z } from "zod";
import type { TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, integerAnswerSchema, readView, standbyView } from "./util";

const TITLE = "Packet Checksum";
export const CHECKSUM_RULES = ["digit_sum", "alternating", "weighted"] as const;
type ChecksumRule = (typeof CHECKSUM_RULES)[number];

/** `packet` is a string of decimal digits. */
export type ChecksumData = { packet: string; rule: ChecksumRule };

const LENGTH: Record<TaskDifficulty, number> = { 1: 4, 2: 6, 3: 8 };
const RULE: Record<TaskDifficulty, ChecksumRule> = { 1: "digit_sum", 2: "alternating", 3: "weighted" };

export const RULE_TEXT: Record<ChecksumRule, string> = {
  digit_sum: "Add up all the digits. The checksum is the last digit of the total (the total modulo 10).",
  alternating:
    "Number the digits 1, 2, 3, ... from the left. Subtract the sum of the digits in even positions (2nd, 4th, ...) " +
    "from the sum of the digits in odd positions (1st, 3rd, ...). The checksum is that difference modulo 10, as a " +
    "digit from 0 to 9: if the difference is negative, keep adding 10 until it is between 0 and 9 " +
    "(for example 7 - 20 = -13 gives 7).",
  weighted:
    "Multiply the digits by the weights 1, 2, 1, 2, ... from the left (1st digit x1, 2nd digit x2, 3rd digit x1, " +
    "...), add up the products, and take the last digit of the total (the total modulo 10).",
};

const mod10 = (n: number): number => ((n % 10) + 10) % 10;

/** Checksum digit 0-9, or null if the packet is not all digits. */
export function computeChecksum(packet: string, rule: ChecksumRule): number | null {
  if (!/^\d+$/.test(packet)) return null;
  const digits = [...packet].map(Number);
  // Index i is 0-based, so the 1-based position is odd when i is even.
  const weight = (i: number): number => {
    if (rule === "digit_sum") return 1;
    if (rule === "alternating") return i % 2 === 0 ? 1 : -1;
    return i % 2 === 0 ? 1 : 2;
  };
  return mod10(digits.reduce((acc, d, i) => acc + d * weight(i), 0));
}

const answerContent = z.object({ packet: z.string().max(32), rule: z.enum(CHECKSUM_RULES) });

/** Arithmetic: checksum of a 4/6/8-digit packet (d1 digit sum, d2 alternating difference, d3 1-2 weighted sum). */
export const checksum = defineTask<ChecksumData, number>({
  kind: "checksum",
  title: TITLE,
  category: "arithmetic",
  isMemoryTask: false,

  generate(rng, difficulty) {
    const packet = Array.from({ length: LENGTH[difficulty] }, () => String(rng.int(0, 9))).join("");
    return { packet, rule: RULE[difficulty] };
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { packet, rule } = instance.data;
    return buildView(
      instance,
      TITLE,
      phase,
      `Compute the checksum of the packet ${packet}. Rule: ${RULE_TEXT[rule]} Enter a single digit from 0 to 9.`,
      { packet, digits: [...packet].map(Number), rule, ruleText: RULE_TEXT[rule] },
      { type: "number" },
    );
  },

  answerSchema: integerAnswerSchema,

  check: (data, answer) => computeChecksum(data.packet, data.rule) === answer,

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    return content ? computeChecksum(content.packet, content.rule) : null;
  },
});

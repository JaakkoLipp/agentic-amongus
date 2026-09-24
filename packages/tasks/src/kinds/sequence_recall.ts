import { z } from "zod";
import type { TaskDifficulty } from "@deduction/shared";
import { buildView, defineTask, memoryPhases, readView, sameSequence } from "./util";

const TITLE = "Relay Sequence";
export const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const LENGTH: Record<TaskDifficulty, number> = { 1: 4, 2: 5, 3: 6 };

/** The digits to remember, as single-character strings. */
export type SequenceRecallData = { digits: string[] };

const observeContent = z.object({ digits: z.array(z.enum(DIGITS)).min(1).max(16) });

/** Memory: see 4/5/6 digits, wait, reproduce them in order. */
export const sequenceRecall = defineTask<SequenceRecallData, readonly string[]>({
  kind: "sequence_recall",
  title: TITLE,
  category: "memory",
  isMemoryTask: true,

  generate(rng, difficulty) {
    const digits: string[] = [];
    while (digits.length < LENGTH[difficulty]) {
      const next = rng.pick(DIGITS);
      // No immediate repeats: a doubled digit is easy to misread on a relay display.
      if (next !== digits[digits.length - 1]) digits.push(next);
    }
    return { digits };
  },

  phases: (_data, difficulty) => memoryPhases(difficulty),

  view(instance, phase) {
    const length = instance.data.digits.length;
    if (phase === "observe") {
      return buildView(
        instance,
        TITLE,
        phase,
        `Memorize this ${length}-digit relay sequence. It will be hidden before you answer.`,
        { digits: [...instance.data.digits], length },
      );
    }
    if (phase === "delay") {
      return buildView(instance, TITLE, phase, "The sequence is hidden. Keep it in mind.", { length });
    }
    return buildView(
      instance,
      TITLE,
      phase,
      `Enter the ${length}-digit relay sequence you memorized, in the order it was shown.`,
      { length },
      { type: "sequence", length, alphabet: DIGITS },
    );
  },

  answerSchema: z.array(z.enum(DIGITS)).min(1).max(16),

  check: (data, answer) => sameSequence(answer, data.digits),

  solveFromViews: (views) => readView(views, "observe", observeContent)?.digits ?? null,
});

import { z } from "zod";
import type { TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, readView, sameSequence, shuffleChanged, standbyView } from "./util";

const TITLE = "Crate Stacking";
const CODE_LETTERS = ["H", "J", "K", "M", "N", "P", "Q", "T", "V", "X"] as const;
/** Crate codes: one capital letter plus one digit, e.g. "K4". */
const CRATE_CODE = /^[A-Z][0-9]$/;

export type SortingCrate = { id: string; weightKg: number };
/** `crates` in display order; weights are distinct. */
export type SortingData = { crates: SortingCrate[] };

const CRATE_COUNT: Record<TaskDifficulty, number> = { 1: 4, 2: 5, 3: 6 };
/** Gap between consecutive weights: wide at d1, as small as 1 kg at d3. */
const GAP: Record<TaskDifficulty, readonly [number, number]> = { 1: [6, 15], 2: [3, 9], 3: [1, 6] };

export const sortByWeight = (crates: readonly { id: string; weightKg: number }[]): string[] =>
  [...crates].sort((a, b) => a.weightKg - b.weightKg).map((c) => c.id);

const answerContent = z.object({
  crates: z.array(z.object({ id: z.string(), weightKg: z.number() })).max(16),
});

/** Ordering: sort 4/5/6 crates lightest to heaviest (weight gaps shrink with difficulty). */
export const sorting = defineTask<SortingData, readonly string[]>({
  kind: "sorting",
  title: TITLE,
  category: "ordering",
  isMemoryTask: false,

  generate(rng, difficulty) {
    const n = CRATE_COUNT[difficulty];
    const [minGap, maxGap] = GAP[difficulty];
    const letters = rng.sample(CODE_LETTERS, n);
    let weight = rng.int(5, 30);
    const sorted = letters.map((l) => {
      const crate = { id: `${l}${rng.int(1, 9)}`, weightKg: weight };
      weight += rng.int(minGap, maxGap);
      return crate;
    });
    return { crates: shuffleChanged(rng, sorted) };
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const crates = instance.data.crates;
    return buildView(
      instance,
      TITLE,
      phase,
      "Stack the crates in order of weight: list them from lightest to heaviest. All weights are different.",
      { crates: crates.map((c) => ({ id: c.id, label: `Crate ${c.id}`, weightKg: c.weightKg })) },
      { type: "ordering", items: crates.map((c) => ({ id: c.id, label: `Crate ${c.id} (${c.weightKg} kg)` })) },
    );
  },

  answerSchema: z.array(z.string().regex(CRATE_CODE)).min(1).max(12),

  check: (data, answer) => sameSequence(answer, sortByWeight(data.crates)),

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    return content ? sortByWeight(content.crates) : null;
  },
});

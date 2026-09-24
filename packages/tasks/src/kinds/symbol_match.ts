import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import {
  ANSWER_ONLY_PHASES,
  buildView,
  choiceIdSchema,
  defineTask,
  letter,
  readView,
  sameSequence,
  standbyView,
} from "./util";

const TITLE = "Glyph Match";
export const GLYPHS: Readonly<Record<string, string>> = {
  triangle: "▲",
  circle: "●",
  square: "■",
  diamond: "◆",
  star: "★",
  cross: "✚",
  pentagon: "⬟",
  hexagon: "⬢",
};
const NAMES = Object.keys(GLYPHS);
const LENGTH: Record<TaskDifficulty, number> = { 1: 3, 2: 4, 3: 5 };
/** Share of distractors made by an adjacent swap (harder to spot) rather than a substitution. */
const SWAP_CHANCE: Record<TaskDifficulty, number> = { 1: 0.2, 2: 0.5, 3: 0.8 };

/** Glyph sequences stored by glyph name. */
export type SymbolMatchData = { target: string[]; candidates: { id: string; names: string[] }[]; answer: string };

const glyphOf = (name: string): string => GLYPHS[name] ?? "?";

function mutate(rng: Rng, seq: readonly string[], swapChance: number): string[] {
  const out = seq.slice();
  if (out.length >= 2 && rng.chance(swapChance)) {
    const i = rng.int(0, out.length - 2);
    [out[i], out[i + 1]] = [out[i + 1] ?? "", out[i] ?? ""];
  } else {
    const i = rng.int(0, out.length - 1);
    out[i] = rng.pick(NAMES.filter((n) => n !== out[i]));
  }
  return out;
}

const answerContent = z.object({
  target: z.array(z.string()).max(16),
  candidates: z.array(z.object({ id: z.string(), glyphs: z.array(z.string()).max(16) })).max(8),
});

/** Perception: which of 4 glyph strings is identical to the target (others: one substitution or adjacent swap)? */
export const symbolMatch = defineTask<SymbolMatchData, string>({
  kind: "symbol_match",
  title: TITLE,
  category: "perception",
  isMemoryTask: false,

  generate(rng, difficulty) {
    // Distinct glyphs, so every adjacent swap produces a visible change.
    const target = rng.sample(NAMES, LENGTH[difficulty]);
    const seen = new Set([target.join(" ")]);
    const variants: string[][] = [target];
    for (let attempt = 0; variants.length < 4 && attempt < 200; attempt++) {
      const d = mutate(rng, target, SWAP_CHANCE[difficulty]);
      if (seen.has(d.join(" "))) continue;
      seen.add(d.join(" "));
      variants.push(d);
    }
    if (variants.length !== 4) throw new Error("symbol_match: failed to build distractors");
    const order = rng.shuffle(variants);
    return {
      target,
      candidates: order.map((names, i) => ({ id: letter(i), names })),
      answer: letter(order.indexOf(target)),
    };
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { target, candidates } = instance.data;
    return buildView(
      instance,
      TITLE,
      phase,
      "Which candidate shows exactly the same glyphs as the target, in the same order? Exactly one candidate matches.",
      {
        target: target.map(glyphOf),
        targetNames: [...target],
        candidates: candidates.map((c) => ({ id: c.id, glyphs: c.names.map(glyphOf), names: [...c.names] })),
      },
      {
        type: "choice",
        options: candidates.map((c) => ({ id: c.id, label: `${c.id}: ${c.names.map(glyphOf).join(" ")}` })),
      },
    );
  },

  answerSchema: choiceIdSchema,

  check: (data, answer) => answer === data.answer,

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    if (!content) return null;
    return content.candidates.find((c) => sameSequence(c.glyphs, content.target))?.id ?? null;
  },
});

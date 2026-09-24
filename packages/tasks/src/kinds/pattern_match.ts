import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, choiceIdSchema, defineTask, letter, readView, standbyView } from "./util";

const TITLE = "Signal Pattern";
const SIZE = 3;
const ON = "#";
const OFF = ".";

/** A pattern is SIZE rows of "#" (lit) / "." (dark). */
type Pattern = string[];
export type PatternMatchData = { target: Pattern; candidates: { id: string; rows: Pattern }[]; answer: string };

const key = (p: readonly string[]): string => p.join("/");

/** Rotate 90 degrees clockwise: out[r][c] = in[n-1-c][r]. */
export function rotateClockwise(p: readonly string[]): Pattern {
  const n = p.length;
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => p[n - 1 - c]?.[r] ?? OFF).join(""),
  );
}

/** The pattern rotated by 0, 90, 180 and 270 degrees. */
export function rotations(p: readonly string[]): Pattern[] {
  const out: Pattern[] = [p.slice()];
  for (let i = 0; i < 3; i++) out.push(rotateClockwise(out[out.length - 1] ?? p));
  return out;
}

export const matchesUnderRotation = (target: readonly string[], candidate: readonly string[]): boolean =>
  rotations(target).some((r) => key(r) === key(candidate));

const litCount = (p: readonly string[]): number => [...p.join("")].filter((ch) => ch === ON).length;

function toggle(p: readonly string[], index: number): Pattern {
  const r = Math.floor(index / SIZE);
  const c = index % SIZE;
  return p.map((row, i) => (i === r ? [...row].map((ch, j) => (j === c ? (ch === ON ? OFF : ON) : ch)).join("") : row));
}

const mirror = (p: readonly string[]): Pattern => p.map((row) => [...row].reverse().join(""));

function randomTarget(rng: Rng): Pattern {
  for (let attempt = 0; attempt < 200; attempt++) {
    const cells = Array.from({ length: SIZE * SIZE }, () => (rng.chance(0.45) ? ON : OFF));
    const p = Array.from({ length: SIZE }, (_, r) => cells.slice(r * SIZE, r * SIZE + SIZE).join(""));
    const n = litCount(p);
    // 3..6 lit cells and no rotational symmetry, so each rotation looks different.
    if (n >= 3 && n <= 6 && new Set(rotations(p).map(key)).size === 4) return p;
  }
  return ["##.", ".#.", "..."];
}

type DistractorKind = "flip" | "mirror" | "move";
/** flip changes the lit count (easy); mirror and move keep it (harder). */
const PLAN: Record<TaskDifficulty, readonly DistractorKind[]> = {
  1: ["flip", "flip", "flip"],
  2: ["mirror", "flip", "flip"],
  3: ["mirror", "move", "move"],
};

function makeDistractor(rng: Rng, target: Pattern, kind: DistractorKind): Pattern {
  const base = rng.pick(rotations(target));
  if (kind === "mirror") return mirror(base);
  if (kind === "flip") return toggle(base, rng.int(0, SIZE * SIZE - 1));
  const cells = [...base.join("")];
  const lit = cells.flatMap((ch, i) => (ch === ON ? [i] : []));
  const dark = cells.flatMap((ch, i) => (ch === OFF ? [i] : []));
  return toggle(toggle(base, rng.pick(lit)), rng.pick(dark));
}

const patternSchema = z.array(z.string().max(8)).max(8);
const answerContent = z.object({
  target: patternSchema,
  candidates: z.array(z.object({ id: z.string(), rows: patternSchema })).max(8),
});

/** Perception: which of 4 candidates is the 3x3 target rotated (never mirrored)? */
export const patternMatch = defineTask<PatternMatchData, string>({
  kind: "pattern_match",
  title: TITLE,
  category: "perception",
  isMemoryTask: false,

  generate(rng, difficulty) {
    const target = randomTarget(rng);
    const rots = rotations(target);
    const correct = (difficulty === 1 ? rng.pick(rots) : rots[rng.int(1, 3)]) ?? target;
    const used = new Set([key(correct)]);
    const distractors: Pattern[] = [];
    for (const kind of PLAN[difficulty]) {
      for (let attempt = 0; attempt < 60; attempt++) {
        // Fall back to single flips, which can never match (they change the lit count).
        const d = makeDistractor(rng, target, attempt < 30 ? kind : "flip");
        if (used.has(key(d)) || matchesUnderRotation(target, d)) continue;
        used.add(key(d));
        distractors.push(d);
        break;
      }
    }
    if (distractors.length !== 3) throw new Error("pattern_match: failed to build distractors");
    const order = rng.shuffle([correct, ...distractors]);
    return {
      target,
      candidates: order.map((rows, i) => ({ id: letter(i), rows })),
      answer: letter(order.indexOf(correct)),
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
      "The target signal is a 3x3 grid (# = lit, . = dark). Exactly one candidate shows the same pattern, possibly " +
        "rotated by 90, 180 or 270 degrees (never mirrored). Which candidate matches the target?",
      {
        size: SIZE,
        target: [...target],
        candidates: candidates.map((c) => ({ id: c.id, rows: [...c.rows] })),
      },
      { type: "choice", options: candidates.map((c) => ({ id: c.id, label: `Candidate ${c.id}` })) },
    );
  },

  answerSchema: choiceIdSchema,

  check: (data, answer) => answer === data.answer,

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    if (!content) return null;
    return content.candidates.find((c) => matchesUnderRotation(content.target, c.rows))?.id ?? null;
  },
});

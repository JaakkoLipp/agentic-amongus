import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, hasNoDuplicates, readView, sameSet, standbyView } from "./util";

const TITLE = "Breaker Logic";
export const SWITCH_IDS = ["S1", "S2", "S3", "S4"] as const;
const SWITCH_COUNT: Record<TaskDifficulty, number> = { 1: 3, 2: 3, 3: 4 };
const MIN_CLUES = 2;
const MAX_CLUES = 4;

export type Clue =
  | { type: "is_on" | "is_off"; a: string }
  | { type: "not_both" | "at_least_one" | "same" | "different"; a: string; b: string }
  | { type: "implies"; a: string; aOn: boolean; b: string; bOn: boolean }
  | { type: "exactly"; count: number };
/** `on` is the hidden solution: the switches that are ON. */
export type ShortLogicData = { switches: string[]; clues: Clue[]; on: string[] };

type Assignment = ReadonlySet<string>;

export function clueHolds(clue: Clue, on: Assignment, switches: readonly string[]): boolean {
  switch (clue.type) {
    case "is_on":
      return on.has(clue.a);
    case "is_off":
      return !on.has(clue.a);
    case "not_both":
      return !(on.has(clue.a) && on.has(clue.b));
    case "at_least_one":
      return on.has(clue.a) || on.has(clue.b);
    case "same":
      return on.has(clue.a) === on.has(clue.b);
    case "different":
      return on.has(clue.a) !== on.has(clue.b);
    case "implies":
      return on.has(clue.a) !== clue.aOn || on.has(clue.b) === clue.bOn;
    case "exactly":
      return switches.filter((s) => on.has(s)).length === clue.count;
  }
}

const state = (isOn: boolean): string => (isOn ? "ON" : "OFF");

export function clueText(clue: Clue): string {
  switch (clue.type) {
    case "is_on":
      return `${clue.a} is ON.`;
    case "is_off":
      return `${clue.a} is OFF.`;
    case "not_both":
      return `${clue.a} and ${clue.b} are not both ON.`;
    case "at_least_one":
      return `At least one of ${clue.a} and ${clue.b} is ON.`;
    case "same":
      return `${clue.a} and ${clue.b} are in the same position (both ON or both OFF).`;
    case "different":
      return `${clue.a} and ${clue.b} are in different positions (one ON, one OFF).`;
    case "implies":
      return `If ${clue.a} is ${state(clue.aOn)}, then ${clue.b} is ${state(clue.bOn)}.`;
    case "exactly":
      return `Exactly ${clue.count} switch${clue.count === 1 ? " is" : "es are"} ON.`;
  }
}

/** Every ON/OFF assignment of the switches, as the set of ON switches. */
export function allAssignments(switches: readonly string[]): Set<string>[] {
  return Array.from({ length: 1 << switches.length }, (_, mask) => new Set(switches.filter((_, i) => (mask >> i) & 1)));
}

export function solutions(switches: readonly string[], clues: readonly Clue[]): Set<string>[] {
  return allAssignments(switches).filter((on) => clues.every((c) => clueHolds(c, on, switches)));
}

type ClueFamily = "atomic" | "exactly" | "relational";
const FAMILY_WEIGHT: Record<TaskDifficulty, Readonly<Record<ClueFamily, number>>> = {
  1: { atomic: 3, exactly: 2, relational: 2 },
  2: { atomic: 1, exactly: 1, relational: 4 },
  3: { atomic: 1, exactly: 1, relational: 5 },
};

/** A random clue that is true for the hidden assignment. */
function randomTrueClue(rng: Rng, switches: readonly string[], on: Assignment, difficulty: TaskDifficulty): Clue {
  const weights = FAMILY_WEIGHT[difficulty];
  const family = rng.weighted(["atomic", "exactly", "relational"] as const, (f) => weights[f]);
  if (family === "exactly") return { type: "exactly", count: switches.filter((s) => on.has(s)).length };
  const [a, b] = rng.sample(switches, 2);
  const sa = a ?? "S1";
  const sb = b ?? "S2";
  if (family === "atomic") return { type: on.has(sa) ? "is_on" : "is_off", a: sa };
  const candidates: Clue[] = [
    { type: "not_both", a: sa, b: sb },
    { type: "at_least_one", a: sa, b: sb },
    { type: on.has(sa) === on.has(sb) ? "same" : "different", a: sa, b: sb },
    { type: "implies", a: sa, aOn: rng.chance(0.5), b: sb, bOn: rng.chance(0.5) },
  ];
  const valid = candidates.filter((c) => clueHolds(c, on, switches));
  return rng.pick(valid);
}

function tryGenerate(rng: Rng, difficulty: TaskDifficulty): ShortLogicData | null {
  const switches = SWITCH_IDS.slice(0, SWITCH_COUNT[difficulty]);
  const on = new Set(switches.filter(() => rng.chance(0.5)));
  const clues: Clue[] = [];
  let remaining = allAssignments(switches);
  for (let guard = 0; remaining.length > 1 && guard < 40; guard++) {
    const clue = randomTrueClue(rng, switches, on, difficulty);
    const next = remaining.filter((a) => clueHolds(clue, a, switches));
    if (next.length === remaining.length) continue; // clue adds no information
    clues.push(clue);
    remaining = next;
  }
  if (remaining.length !== 1) return null;
  const minimal = withoutRedundantClues(switches, clues);
  if (minimal.length < MIN_CLUES || minimal.length > MAX_CLUES) return null;
  // From d2 on, at most one clue may name a switch state outright.
  if (difficulty >= 2 && minimal.filter((c) => c.type === "is_on" || c.type === "is_off").length > 1) return null;
  return { switches, clues: minimal, on: switches.filter((s) => on.has(s)) };
}

/** Drop clues implied by the others, so every remaining clue is needed (e.g. "exactly 4 ON" makes "S1 is ON" moot). */
function withoutRedundantClues(switches: readonly string[], clues: readonly Clue[]): Clue[] {
  let kept = [...clues];
  for (const clue of clues) {
    const reduced = kept.filter((c) => c !== clue);
    if (solutions(switches, reduced).length === 1) kept = reduced;
  }
  return kept;
}

const clueSchema = z.union([
  z.object({ type: z.enum(["is_on", "is_off"]), a: z.string() }),
  z.object({ type: z.enum(["not_both", "at_least_one", "same", "different"]), a: z.string(), b: z.string() }),
  z.object({ type: z.literal("implies"), a: z.string(), aOn: z.boolean(), b: z.string(), bOn: z.boolean() }),
  z.object({ type: z.literal("exactly"), count: z.number() }),
]);
const answerContent = z.object({ switches: z.array(z.string()).max(8), clues: z.array(clueSchema).max(16) });

/** Reasoning: deduce which of 3/3/4 breaker switches are ON from 2-4 clues with a unique solution. */
export const shortLogic = defineTask<ShortLogicData, readonly string[]>({
  kind: "short_logic",
  title: TITLE,
  category: "reasoning",
  isMemoryTask: false,

  generate(rng, difficulty) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const data = tryGenerate(rng, difficulty);
      if (data) return data;
    }
    // Fallback: one atomic clue per switch (3-4 clues, always unique).
    const switches = SWITCH_IDS.slice(0, SWITCH_COUNT[difficulty]);
    const on = switches.filter(() => rng.chance(0.5));
    const clues: Clue[] = switches.map((s) => ({ type: on.includes(s) ? "is_on" : "is_off", a: s }));
    return { switches, clues, on };
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { switches, clues } = instance.data;
    return buildView(
      instance,
      TITLE,
      phase,
      "Each breaker switch is either ON or OFF. Exactly one combination fits all the clues. Select every switch " +
        "that is ON (select none if they are all OFF).",
      { switches: [...switches], clues: clues.map((c) => ({ text: clueText(c), ...c })) },
      { type: "multi_choice", options: switches.map((s) => ({ id: s, label: s })), count: null },
    );
  },

  answerSchema: z.array(z.enum(SWITCH_IDS)).max(SWITCH_IDS.length).refine(hasNoDuplicates),

  check: (data, answer) => sameSet(answer, data.on),

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    if (!content) return null;
    const found = solutions(content.switches, content.clues);
    const only = found.length === 1 ? found[0] : undefined;
    return only ? content.switches.filter((s) => only.has(s)) : null;
  },
});

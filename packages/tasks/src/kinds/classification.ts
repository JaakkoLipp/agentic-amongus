import { z } from "zod";
import type { JsonValue, Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, readView, sameSequence, standbyView } from "./util";

const TITLE = "Cargo Routing";
export const BAYS = ["A", "B", "C"] as const;
const FLAGS = ["fragile", "cold", "hazardous"] as const;
type Flag = (typeof FLAGS)[number];

export type Condition =
  | { type: "flag"; flag: Flag }
  | { type: "min_weight"; kg: number }
  | { type: "max_weight"; kg: number };
/** `condition: null` is the final "otherwise" rule. */
export type Rule = { condition: Condition | null; bay: string };
export type Crate = { code: string; weightKg: number; fragile: boolean; cold: boolean; hazardous: boolean };
/** `shownFlags` are the crate attributes displayed (always a superset of the flags used by rules). */
export type ClassificationData = { rules: Rule[]; crates: Crate[]; shownFlags: Flag[] };

type CrateLike = { weightKg: number; fragile?: boolean; cold?: boolean; hazardous?: boolean };

function matches(condition: Condition, crate: CrateLike): boolean {
  switch (condition.type) {
    case "flag":
      return crate[condition.flag] === true;
    case "min_weight":
      return crate.weightKg >= condition.kg;
    case "max_weight":
      return crate.weightKg < condition.kg;
  }
}

/** First matching rule wins; null if no rule (not even "otherwise") applies. */
export function routeCrate(rules: readonly Rule[], crate: CrateLike): string | null {
  return rules.find((r) => r.condition === null || matches(r.condition, crate))?.bay ?? null;
}

const FLAG_TEXT: Record<Flag, string> = { fragile: "fragile", cold: "cold (refrigerated)", hazardous: "hazardous" };

function ruleText(rule: Rule): string {
  const c = rule.condition;
  if (c === null) return `Otherwise -> Bay ${rule.bay}`;
  if (c.type === "flag") return `If the crate is ${FLAG_TEXT[c.flag]} -> Bay ${rule.bay}`;
  if (c.type === "min_weight") return `If the crate weighs ${c.kg} kg or more -> Bay ${rule.bay}`;
  return `If the crate weighs less than ${c.kg} kg -> Bay ${rule.bay}`;
}

function crateText(crate: Crate, shown: readonly Flag[]): string {
  const flags = shown.filter((f) => crate[f]);
  return `Crate ${crate.code}: ${crate.weightKg} kg${flags.length > 0 ? `, ${flags.join(", ")}` : ""}`;
}

const CRATE_COUNT: Record<TaskDifficulty, number> = { 1: 3, 2: 4, 3: 5 };

function randomConditions(rng: Rng, difficulty: TaskDifficulty): Condition[] {
  if (difficulty === 1) return [{ type: "flag", flag: "fragile" }, { type: "min_weight", kg: 50 }];
  const pool: Condition[] = [
    { type: "flag", flag: "fragile" },
    { type: "flag", flag: "cold" },
    { type: "min_weight", kg: rng.pick([40, 50, 60]) },
    { type: "max_weight", kg: rng.pick([15, 20, 25]) },
  ];
  if (difficulty === 3) pool.push({ type: "flag", flag: "hazardous" });
  return rng.sample(pool, difficulty === 2 ? 2 : 3);
}

function tryGenerate(rng: Rng, difficulty: TaskDifficulty): { data: ClassificationData; orderMatters: boolean } | null {
  const conditions = randomConditions(rng, difficulty);
  const bays = difficulty === 3 ? rng.shuffle([...BAYS, rng.pick(BAYS)]) : rng.shuffle(BAYS);
  const rules: Rule[] = [...conditions, null].map((condition, i) => ({ condition, bay: bays[i] ?? "C" }));
  const used = new Set(conditions.flatMap((c) => (c.type === "flag" ? [c.flag] : [])));
  const extra = difficulty === 1 ? [] : FLAGS.filter((f) => !used.has(f) && rng.chance(0.5)).slice(0, 1);
  const shownFlags = FLAGS.filter((f) => used.has(f) || extra.includes(f));
  const codes = rng.sample(["K", "M", "P", "T", "V", "X", "H", "J", "N", "Q"], CRATE_COUNT[difficulty]);
  const crates: Crate[] = codes.map((letter) => ({
    code: `${letter}${rng.int(10, 99)}`,
    weightKg: rng.int(5, 95),
    fragile: shownFlags.includes("fragile") && rng.chance(0.35),
    cold: shownFlags.includes("cold") && rng.chance(0.35),
    hazardous: shownFlags.includes("hazardous") && rng.chance(0.35),
  }));
  const answer = crates.map((c) => routeCrate(rules, c));
  if (new Set(answer).size < 2) return null;
  const orderMatters = crates.some((c) => conditions.filter((cond) => matches(cond, c)).length >= 2);
  return { data: { rules, crates, shownFlags }, orderMatters };
}

const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("flag"), flag: z.enum(FLAGS) }),
  z.object({ type: z.literal("min_weight"), kg: z.number() }),
  z.object({ type: z.literal("max_weight"), kg: z.number() }),
]);
const answerContent = z.object({
  rules: z.array(z.object({ condition: conditionSchema.nullable(), bay: z.string() })).max(16),
  crates: z
    .array(
      z.object({
        weightKg: z.number(),
        fragile: z.boolean().optional(),
        cold: z.boolean().optional(),
        hazardous: z.boolean().optional(),
      }),
    )
    .max(16),
});

/** Reasoning: route 3/4/5 crates with ordered first-match rules (2/2/3 conditions + otherwise). */
export const classification = defineTask<ClassificationData, readonly string[]>({
  kind: "classification",
  title: TITLE,
  category: "reasoning",
  isMemoryTask: false,

  generate(rng, difficulty) {
    let fallback: ClassificationData | null = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = tryGenerate(rng, difficulty);
      if (!result) continue;
      // Prefer instances where at least one crate matches two rules, so rule order matters.
      if (difficulty === 1 || result.orderMatters) return result.data;
      fallback ??= result.data;
    }
    if (fallback) return fallback;
    throw new Error("classification: generation failed");
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { rules, crates, shownFlags } = instance.data;
    return buildView(
      instance,
      TITLE,
      phase,
      "Route each crate to a cargo bay. Check the rules from top to bottom; the first rule that fits the crate " +
        "decides its bay. Answer with one bay letter (A, B or C) per crate, in the order the crates are listed.",
      {
        rules: rules.map((r) => ({ text: ruleText(r), condition: r.condition, bay: r.bay })),
        crates: crates.map((c) => {
          const shown: Record<string, JsonValue> = { code: c.code, weightKg: c.weightKg };
          for (const f of shownFlags) shown[f] = c[f];
          shown.text = crateText(c, shownFlags);
          return shown;
        }),
        attributes: ["weightKg", ...shownFlags],
      },
      { type: "sequence", length: crates.length, alphabet: BAYS },
    );
  },

  answerSchema: z.array(z.enum(BAYS)).min(1).max(12),

  check(data, answer) {
    const expected = data.crates.map((c) => routeCrate(data.rules, c) ?? "?");
    return sameSequence(answer, expected);
  },

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    if (!content) return null;
    const bays = content.crates.map((c) => routeCrate(content.rules, c));
    return bays.every((b): b is string => b !== null) ? bays : null;
  },
});

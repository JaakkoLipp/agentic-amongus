import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, readView, standbyView } from "./util";

const TITLE = "Beacon Orientation";
/** Clockwise order. */
export const DIRECTIONS = ["up", "right", "down", "left"] as const;
type Direction = (typeof DIRECTIONS)[number];
const COLORS = ["amber", "teal", "violet", "grey"] as const;
const SHAPES = ["triangle", "circle", "square", "diamond"] as const;

type Attribute = "color" | "shape" | "direction";
type Action = "reverse" | "rotate_cw" | "rotate_ccw";
/** Direction conditions test the beacon's direction at the moment the rule is applied. */
export type Condition = { attribute: Attribute; value: string; negate: boolean };
export type Rule = { condition: Condition; action: Action };
/** Colors/shapes are plain strings so hand-written fixtures (e.g. the spec's "red triangle") also work. */
export type Beacon = { color: string; shape: string; direction: Direction };
export type RuleCompositionData = { beacon: Beacon; rules: Rule[] };

const TURN: Record<Action, number> = { rotate_cw: 1, reverse: 2, rotate_ccw: 3 };

function holds(c: Condition, beacon: { color: string; shape: string }, direction: Direction): boolean {
  const actual = c.attribute === "color" ? beacon.color : c.attribute === "shape" ? beacon.shape : direction;
  return (actual === c.value) !== c.negate;
}

/** Apply rules top to bottom; returns the final direction and which rules fired. */
export function runRules(
  beacon: { color: string; shape: string; direction: Direction },
  rules: readonly Rule[],
): { direction: Direction; fired: boolean[] } {
  let direction = beacon.direction;
  const fired = rules.map((r) => {
    if (!holds(r.condition, beacon, direction)) return false;
    direction = DIRECTIONS[(DIRECTIONS.indexOf(direction) + TURN[r.action]) % 4] ?? direction;
    return true;
  });
  return { direction, fired };
}

const ACTION_TEXT: Record<Action, string> = {
  reverse: "reverse its direction",
  rotate_cw: "rotate it 90 degrees clockwise",
  rotate_ccw: "rotate it 90 degrees counterclockwise",
};

function conditionText(c: Condition): string {
  const not = c.negate ? "not " : "";
  if (c.attribute === "color") return `it is ${not}${c.value}`;
  if (c.attribute === "shape") return `it is ${not}a ${c.value}`;
  return `it is ${not}currently pointing ${c.value}`;
}

export const ruleText = (r: Rule): string => `If ${conditionText(r.condition)}, ${ACTION_TEXT[r.action]}.`;
export const beaconText = (b: Beacon): string => `${b.color} ${b.shape} pointing ${b.direction}`;
const withArticle = (phrase: string): string => `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;

const RULE_COUNT: Record<TaskDifficulty, number> = { 1: 2, 2: 3, 3: 4 };

function randomRule(rng: Rng, beacon: Beacon, direction: Direction, difficulty: TaskDifficulty): Rule {
  const attributes: Attribute[] = difficulty === 1 ? ["color", "shape"] : ["color", "shape", "direction"];
  const attribute = rng.pick(attributes);
  const values: readonly string[] = attribute === "color" ? COLORS : attribute === "shape" ? SHAPES : DIRECTIONS;
  const own = attribute === "color" ? beacon.color : attribute === "shape" ? beacon.shape : direction;
  const value = rng.chance(0.55) ? own : rng.pick(values.filter((v) => v !== own));
  const negate = difficulty === 3 && rng.chance(0.3);
  return { condition: { attribute, value, negate }, action: rng.pick(["reverse", "rotate_cw", "rotate_ccw"] as const) };
}

function tryGenerate(rng: Rng, difficulty: TaskDifficulty): RuleCompositionData | null {
  const beacon: Beacon = { color: rng.pick(COLORS), shape: rng.pick(SHAPES), direction: rng.pick(DIRECTIONS) };
  const rules: Rule[] = [];
  let direction = beacon.direction;
  while (rules.length < RULE_COUNT[difficulty]) {
    const rule = randomRule(rng, beacon, direction, difficulty);
    rules.push(rule);
    direction = runRules(beacon, rules).direction;
  }
  const { fired } = runRules(beacon, rules);
  const firedCount = fired.filter(Boolean).length;
  // At least one rule fires, and from d2 on at least one does not (so conditions must actually be read).
  if (firedCount === 0 || (difficulty >= 2 && firedCount === rules.length)) return null;
  return { beacon, rules };
}

const conditionSchema = z.object({
  attribute: z.enum(["color", "shape", "direction"]),
  value: z.string(),
  negate: z.boolean(),
});
const answerContent = z.object({
  beacon: z.object({ color: z.string(), shape: z.string(), direction: z.enum(DIRECTIONS) }),
  rules: z.array(z.object({ condition: conditionSchema, action: z.enum(["reverse", "rotate_cw", "rotate_ccw"]) })).max(16),
});

/** Reasoning: apply 2/3/4 conditional rotation rules in order (d2 adds direction tests, d3 negations). */
export const ruleComposition = defineTask<RuleCompositionData, string>({
  kind: "rule_composition",
  title: TITLE,
  category: "reasoning",
  isMemoryTask: false,

  generate(rng, difficulty) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const data = tryGenerate(rng, difficulty);
      if (data) return data;
    }
    throw new Error("rule_composition: generation failed");
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { beacon, rules } = instance.data;
    return buildView(
      instance,
      TITLE,
      phase,
      `The beacon is ${withArticle(beaconText(beacon))}. Apply the rules in order, top to bottom; a rule only acts if its ` +
        "condition is true at that moment (direction conditions use the current direction). Which way does the " +
        "beacon point at the end?",
      {
        beacon: { ...beacon, text: beaconText(beacon) },
        rules: rules.map((r) => ({ text: ruleText(r), condition: { ...r.condition }, action: r.action })),
      },
      { type: "choice", options: DIRECTIONS.map((d) => ({ id: d, label: d.charAt(0).toUpperCase() + d.slice(1) })) },
    );
  },

  answerSchema: z.enum(DIRECTIONS),

  check: (data, answer) => runRules(data.beacon, data.rules).direction === answer,

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    return content ? runRules(content.beacon, content.rules).direction : null;
  },
});

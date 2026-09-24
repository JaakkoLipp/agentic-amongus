import { describe, expect, it } from "vitest";
import { TASK_KINDS } from "@deduction/shared";
import type { AnswerFormat, TaskAnswer } from "@deduction/shared";
import { checkTaskAnswer, solveFromViews } from "../src";
import { answerFitsFormat } from "../src/format";
import { answerFormatOf, DIFFICULTIES, forEachInstance, viewsFor } from "./helpers";

const MALFORMED = { ok: false, reason: "malformed" };
const HUGE = 10_000;

/** Inputs that are wrong for every answer shape. */
const UNIVERSAL_BAD: unknown[] = [
  undefined,
  null,
  true,
  {},
  { answer: "A" },
  NaN,
  Infinity,
  -Infinity,
  Symbol("x"),
  () => 1,
  [[]],
  [null],
  [1, 2, 3],
  Array.from({ length: HUGE }, () => "A"),
  Array.from({ length: HUGE }, () => "x"),
];

/** Shape-specific malformed inputs derived from the instance's format and correct answer. */
function badAnswersFor(format: AnswerFormat, correct: TaskAnswer): unknown[] {
  const list = typeof correct === "object" ? [...correct] : [];
  switch (format.type) {
    case "number":
      return ["21", "", 1.5, -0.25, 1e12, -1e12, [21], { value: 21 }, String(correct)];
    case "choice": {
      const ids = format.options.map((o) => o.id);
      return ["", "Z9", "a", "not-an-option", "A".repeat(HUGE), 0, 1, [correct], { id: correct }, ` ${String(correct)}`, `${String(correct)} `, String(correct).toLowerCase() === String(correct) ? "UP" : String(correct).toLowerCase(), ids];
    }
    case "sequence": {
      const other = format.alphabet.find((s) => s !== list[0]) ?? "?";
      return [
        [...list, other], // too long
        list.slice(0, -1), // too short
        [],
        list.join(""),
        list.map((s) => (/^\d$/.test(s) ? Number(s) : 1)),
        [...list.slice(0, -1), "x"],
        [...list.slice(0, -1), "?"],
        Array.from({ length: HUGE }, () => format.alphabet[0]),
      ];
    }
    case "multi_choice": {
      const ids = format.options.map((o) => o.id);
      const bad: unknown[] = [
        ["ZZ"],
        ["Z9"],
        list.length > 0 ? [...list, list[0]] : [ids[0], ids[0]], // duplicate id
        list.join(","),
        [1],
        Array.from({ length: HUGE }, () => ids[0]),
        [...ids, ...ids],
      ];
      if (format.count !== null) bad.push(list.slice(0, -1), ids.filter((id) => !list.includes(id)).slice(0, format.count + 1));
      if (ids.length < 4) bad.push(["S4"]); // an id the kind knows but this instance does not offer
      return bad;
    }
    case "ordering": {
      const first = list[0] ?? "";
      return [
        list.slice(0, -1), // missing one
        [...list, first], // duplicate / too long
        [...list.slice(0, -1), first], // duplicate, right length
        [...list.slice(0, -1), "@@"],
        [],
        list.join(" "),
        list.map((s) => (s.toUpperCase() === s ? s.toLowerCase() : s.toUpperCase())), // wrong case
        Array.from({ length: HUGE }, () => first),
      ];
    }
    case "path":
      return [[], ["H"], [...list.slice(0, -1), "H"], list.join(""), list.join("-"), [1, 2], ["a", "b"], Array.from({ length: HUGE }, () => "A")];
    case "text":
      return [];
  }
}

describe.each(TASK_KINDS)("%s rejects malformed answers", (kind) => {
  it.each(DIFFICULTIES)("difficulty %i", (difficulty) => {
    forEachInstance(
      kind,
      difficulty,
      (instance, seed) => {
        const correct = solveFromViews(kind, viewsFor(instance));
        if (correct === null) throw new Error(`unsolvable seed ${seed}`);
        const format = answerFormatOf(instance);
        for (const bad of [...UNIVERSAL_BAD, ...badAnswersFor(format, correct)]) {
          let result: unknown;
          expect(() => {
            result = checkTaskAnswer(instance, bad);
          }).not.toThrow();
          const shown = typeof bad === "object" && Array.isArray(bad) && bad.length > 20 ? `array(${bad.length})` : String(bad);
          expect(result, `seed ${seed} input ${shown}`).toEqual(MALFORMED);
        }
      },
      30,
    );
  });
});

describe("answerFitsFormat", () => {
  const options = [
    { id: "A", label: "A" },
    { id: "B", label: "B" },
    { id: "C", label: "C" },
  ];

  it("checks every format shape", () => {
    expect(answerFitsFormat(3, { type: "number" })).toBe(true);
    expect(answerFitsFormat("3", { type: "number" })).toBe(false);
    expect(answerFitsFormat("hi", { type: "text", maxLength: 2 })).toBe(true);
    expect(answerFitsFormat("hey", { type: "text", maxLength: 2 })).toBe(false);
    expect(answerFitsFormat("B", { type: "choice", options })).toBe(true);
    expect(answerFitsFormat("D", { type: "choice", options })).toBe(false);
    expect(answerFitsFormat(["1", "2"], { type: "sequence", length: 2, alphabet: ["1", "2"] })).toBe(true);
    expect(answerFitsFormat(["1"], { type: "sequence", length: 2, alphabet: ["1", "2"] })).toBe(false);
    expect(answerFitsFormat(["1", "3"], { type: "sequence", length: 2, alphabet: ["1", "2"] })).toBe(false);
    expect(answerFitsFormat(["A", "C"], { type: "multi_choice", options, count: 2 })).toBe(true);
    expect(answerFitsFormat(["A"], { type: "multi_choice", options, count: 2 })).toBe(false);
    expect(answerFitsFormat(["A", "A"], { type: "multi_choice", options, count: 2 })).toBe(false);
    expect(answerFitsFormat([], { type: "multi_choice", options, count: null })).toBe(true);
    expect(answerFitsFormat(["C", "A", "B"], { type: "ordering", items: options })).toBe(true);
    expect(answerFitsFormat(["C", "A"], { type: "ordering", items: options })).toBe(false);
    expect(answerFitsFormat(["C", "A", "A"], { type: "ordering", items: options })).toBe(false);
    expect(answerFitsFormat(["A", "B"], { type: "path", nodes: ["A", "B"] })).toBe(true);
    expect(answerFitsFormat(["A", "Q"], { type: "path", nodes: ["A", "B"] })).toBe(false);
    expect(answerFitsFormat([], { type: "path", nodes: ["A", "B"] })).toBe(false);
    expect(answerFitsFormat("A", null)).toBe(false);
  });
});

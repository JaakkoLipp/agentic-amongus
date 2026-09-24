import { describe, expect, it } from "vitest";
import { deriveRng, TASK_KINDS } from "@deduction/shared";
import type { TaskKind } from "@deduction/shared";
import {
  checkTaskAnswer,
  describeTaskView,
  generateTaskInstance,
  getTaskDefinition,
  mutateAnswer,
  registeredTaskKinds,
  TASK_DEFINITIONS,
  taskPhases,
  taskView,
} from "../src";
import { fixture } from "./helpers";

const CATEGORIES = ["memory", "perception", "arithmetic", "reasoning", "planning", "ordering"];

describe("task registry", () => {
  it("registers every TASK_KIND exactly once, in TASK_KINDS order", () => {
    expect(TASK_DEFINITIONS.map((d) => d.kind)).toEqual([...TASK_KINDS]);
    expect([...registeredTaskKinds()].sort()).toEqual([...TASK_KINDS].sort());
    for (const kind of TASK_KINDS) expect(getTaskDefinition(kind).kind).toBe(kind);
  });

  it("gives every definition a distinct title and a known category", () => {
    expect(new Set(TASK_DEFINITIONS.map((d) => d.title)).size).toBe(TASK_DEFINITIONS.length);
    for (const def of TASK_DEFINITIONS) expect(CATEGORIES).toContain(def.category);
  });

  it("throws for an unknown kind", () => {
    expect(() => getTaskDefinition("warp_drive" as TaskKind)).toThrow(/Unknown task kind/);
  });

  it("generates instances through the public API", () => {
    const instance = generateTaskInstance("t-1", "arithmetic", 2, deriveRng(7, "registry"));
    expect(instance).toMatchObject({ id: "t-1", kind: "arithmetic", difficulty: 2 });
    expect(taskPhases(instance)).toEqual([{ kind: "answer", durationTicks: null }]);
    expect(taskView(instance, "answer").taskId).toBe("t-1");
  });

  it("uses independent RNG draws: different seeds usually give different data", () => {
    for (const kind of TASK_KINDS) {
      const datas = new Set(
        Array.from({ length: 20 }, (_, seed) =>
          JSON.stringify(generateTaskInstance("t", kind, 2, deriveRng(seed, "variety", kind)).data),
        ),
      );
      expect(datas.size, kind).toBeGreaterThan(10);
    }
  });

  it("describes views compactly for LLM prompts", () => {
    const instance = fixture("arithmetic", { tokens: ["17", "+", "8", "-", "4"] });
    const text = describeTaskView(taskView(instance, "answer"));
    expect(text).toContain("TASK Power Calibration [arithmetic] phase=answer");
    expect(text).toContain('"expression":"17 + 8 - 4"');
    expect(text).toContain('ANSWER_FORMAT {"type":"number"}');
  });

  it("returns wrong_task never and malformed for garbage without throwing", () => {
    const instance = fixture("sorting", { crates: [{ id: "K4", weightKg: 3 }, { id: "M2", weightKg: 1 }] });
    expect(checkTaskAnswer(instance, { toString: () => "boom" })).toEqual({ ok: false, reason: "malformed" });
    expect(checkTaskAnswer(instance, ["M2", "K4"])).toEqual({ ok: true, correct: true });
  });
});

describe("mutateAnswer", () => {
  const options = ["A1", "B1", "C1", "D1"].map((id) => ({ id, label: id }));

  it("changes the set for multi_choice answers instead of reordering them", () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = deriveRng(seed, "mutate-multi");
      const count = mutateAnswer(["A1", "C1"], { type: "multi_choice", options, count: 2 }, rng);
      expect(Array.isArray(count)).toBe(true);
      if (!Array.isArray(count)) continue;
      expect(count).toHaveLength(2);
      expect([...count].sort()).not.toEqual(["A1", "C1"]);
    }
    const rng = deriveRng(1, "mutate-edge");
    expect(mutateAnswer([], { type: "multi_choice", options, count: null }, rng)).toHaveLength(1);
    expect(mutateAnswer(["A1", "B1", "C1", "D1"], { type: "multi_choice", options, count: null }, rng)).toHaveLength(3);
  });

  it("changes numbers, choices and sequences", () => {
    const rng = deriveRng(3, "mutate");
    expect(mutateAnswer(5, { type: "number" }, rng)).not.toBe(5);
    expect(mutateAnswer("A", { type: "choice", options }, rng)).not.toBe("A");
    expect(mutateAnswer(["1", "1"], { type: "sequence", length: 2, alphabet: ["1", "2"] }, rng)).not.toEqual(["1", "1"]);
  });
});

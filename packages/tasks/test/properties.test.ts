import { describe, expect, it } from "vitest";
import { deriveRng, TASK_KINDS } from "@deduction/shared";
import {
  checkTaskAnswer,
  describeTaskView,
  getTaskDefinition,
  mutateAnswer,
  solveFromViews,
  taskPhases,
  taskView,
} from "../src";
import { allKeys, DIFFICULTIES, forEachInstance, makeInstance, roundTrip, viewsFor } from "./helpers";

const MEMORY_KINDS = ["sequence_recall", "working_memory"];
const TICKS_PER_SECOND = 30;
/** Keys that would indicate server-only solution data leaking into a view. */
const SOLUTION_KEYS = ["answer", "anomaly", "order", "on", "solution", "correct"];
const PLAYER_COLORS = /\b(red|blue|green|yellow|orange|purple|white|black|pink|cyan|brown|lime)\b/i;
const CORRECT = { ok: true, correct: true };

describe.each(TASK_KINDS)("%s", (kind) => {
  const def = getTaskDefinition(kind);
  const isMemory = MEMORY_KINDS.includes(kind);

  it("declares memory-ness consistently", () => {
    expect(def.kind).toBe(kind);
    expect(def.isMemoryTask).toBe(isMemory);
    expect(def.title.length).toBeGreaterThan(0);
  });

  it.each(DIFFICULTIES)("difficulty %i: deterministic and JSON round-trippable", (difficulty) => {
    forEachInstance(kind, difficulty, (instance, seed) => {
      const again = makeInstance(kind, difficulty, seed);
      expect(again.data, `seed ${seed}`).toStrictEqual(instance.data);
      expect(roundTrip(instance.data), `seed ${seed}`).toStrictEqual(instance.data);
      for (const view of viewsFor(instance)) {
        expect(roundTrip(view), `seed ${seed} ${view.phase}`).toStrictEqual(view);
        expect(view.taskId).toBe(instance.id);
        expect(view.kind).toBe(kind);
      }
    });
  });

  it.each(DIFFICULTIES)("difficulty %i: phase schedule and answerFormat placement", (difficulty) => {
    forEachInstance(kind, difficulty, (instance, seed) => {
      const phases = taskPhases(instance);
      if (isMemory) {
        expect(phases.map((p) => p.kind)).toEqual(["observe", "delay", "answer"]);
        const [observe, delay] = phases;
        expect(observe?.durationTicks).toBeGreaterThanOrEqual(75);
        expect(observe?.durationTicks).toBeLessThanOrEqual(105);
        expect(delay?.durationTicks).toBe(30);
      } else {
        expect(phases.map((p) => p.kind)).toEqual(["answer"]);
      }
      expect(phases[phases.length - 1]?.durationTicks).toBeNull();
      const preAnswer = phases.slice(0, -1).reduce((sum, p) => sum + (p.durationTicks ?? Infinity), 0);
      expect(preAnswer).toBeLessThanOrEqual(10 * TICKS_PER_SECOND);

      for (const view of viewsFor(instance)) {
        expect(view.answerFormat === null, `seed ${seed} ${view.phase}`).toBe(view.phase !== "answer");
        expect(view.prompt.length).toBeGreaterThan(10);
        expect(view.phase).toBeDefined();
      }
    });
  });

  it.each(DIFFICULTIES)("difficulty %i: solvable from views; mutated answers are rejected", (difficulty) => {
    forEachInstance(kind, difficulty, (instance, seed) => {
      const views = viewsFor(instance);
      const answer = solveFromViews(kind, views);
      expect(answer, `seed ${seed}`).not.toBeNull();
      if (answer === null) return;
      expect(checkTaskAnswer(instance, answer), `seed ${seed}`).toEqual(CORRECT);
      expect(checkTaskAnswer(instance, roundTrip(answer)), `seed ${seed}`).toEqual(CORRECT);

      const format = views[views.length - 1]?.answerFormat;
      if (!format) throw new Error("missing answer format");
      for (let k = 0; k < 4; k++) {
        const wrong = mutateAnswer(answer, format, deriveRng(seed, "mutate", k));
        expect(checkTaskAnswer(instance, wrong), `seed ${seed} mutation ${JSON.stringify(wrong)}`).not.toEqual(CORRECT);
      }

      // Choice tasks: exactly one offered option is correct.
      if (format.type === "choice") {
        const correct = format.options.filter((o) => {
          const r = checkTaskAnswer(instance, o.id);
          return r.ok && r.correct;
        });
        expect(correct.map((o) => o.id), `seed ${seed}`).toEqual([answer]);
        expect(new Set(format.options.map((o) => o.id)).size).toBe(format.options.length);
        expect(format.options.length).toBeGreaterThanOrEqual(4);
      }
    });
  });

  it.each(DIFFICULTIES)("difficulty %i: views carry no solution fields and no player color names", (difficulty) => {
    forEachInstance(kind, difficulty, (instance, seed) => {
      for (const view of viewsFor(instance)) {
        const keys = allKeys(view.content);
        for (const k of SOLUTION_KEYS) expect(keys, `seed ${seed} ${view.phase}`).not.toContain(k);
        expect(describeTaskView(view), `seed ${seed}`).not.toMatch(PLAYER_COLORS);
      }
    });
  });

  if (!isMemory) {
    it("returns an empty standby view for phases outside its schedule", () => {
      const instance = makeInstance(kind, 2, 1);
      for (const phase of ["observe", "delay"] as const) {
        const view = taskView(instance, phase);
        expect(view.phase).toBe(phase);
        expect(view.content).toEqual({});
        expect(view.answerFormat).toBeNull();
      }
    });
  }
});

describe("memory tasks hide the remembered data", () => {
  it.each(DIFFICULTIES)("sequence_recall difficulty %i", (difficulty) => {
    forEachInstance("sequence_recall", difficulty, (instance, seed) => {
      const views = viewsFor(instance);
      const [observe, delay, answer] = views;
      if (!observe || !delay || !answer) throw new Error("expected three views");
      const digits = solveFromViews("sequence_recall", [observe]);
      expect(Array.isArray(digits)).toBe(true);
      if (!Array.isArray(digits)) return;
      expect(solveFromViews("sequence_recall", [answer]), `seed ${seed}`).toBeNull();
      expect(solveFromViews("sequence_recall", [delay, answer]), `seed ${seed}`).toBeNull();
      for (const hidden of [delay, answer]) {
        const json = JSON.stringify(hidden);
        expect(json).not.toContain(digits.join(""));
        expect(json).not.toContain(digits.join(" "));
        expect(json).not.toContain(JSON.stringify(digits));
        expect(allKeys(hidden.content)).not.toContain("digits");
      }
    });
  });

  it.each(DIFFICULTIES)("working_memory difficulty %i", (difficulty) => {
    forEachInstance("working_memory", difficulty, (instance, seed) => {
      const [observe, delay, answer] = viewsFor(instance);
      if (!observe || !delay || !answer) throw new Error("expected three views");
      const lit = solveFromViews("working_memory", [observe]);
      expect(Array.isArray(lit)).toBe(true);
      if (!Array.isArray(lit)) return;
      expect(solveFromViews("working_memory", [answer]), `seed ${seed}`).toBeNull();
      expect(solveFromViews("working_memory", [delay, answer]), `seed ${seed}`).toBeNull();
      for (const hidden of [delay, answer]) {
        const json = JSON.stringify(hidden.content);
        for (const cell of lit) expect(json, `seed ${seed}`).not.toContain(`"${cell}"`);
        expect(json).not.toContain("#");
        expect(allKeys(hidden.content)).not.toContain("lit");
        expect(allKeys(hidden.content)).not.toContain("grid");
      }
    });
  });
});

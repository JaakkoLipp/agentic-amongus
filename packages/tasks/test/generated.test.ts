import { describe, expect, it } from "vitest";
import type { TaskDifficulty } from "@deduction/shared";
import { checkTaskAnswer, solveFromViews } from "../src";
import type { TaskInstance } from "../src";
import type { AnomalyData } from "../src/kinds/anomaly_detection";
import { removableLines } from "../src/kinds/anomaly_detection";
import type { ArithmeticData } from "../src/kinds/arithmetic";
import type { ChecksumData } from "../src/kinds/checksum";
import type { ClassificationData } from "../src/kinds/classification";
import type { InstructionData } from "../src/kinds/instruction_following";
import { runProcedure } from "../src/kinds/instruction_following";
import type { PatternMatchData } from "../src/kinds/pattern_match";
import { matchesUnderRotation } from "../src/kinds/pattern_match";
import type { GraphEdge, RouteData } from "../src/kinds/route_planning";
import { hopDistances } from "../src/kinds/route_planning";
import type { RuleCompositionData } from "../src/kinds/rule_composition";
import { runRules } from "../src/kinds/rule_composition";
import type { SequenceRecallData } from "../src/kinds/sequence_recall";
import type { ShortLogicData } from "../src/kinds/short_logic";
import { allAssignments, solutions } from "../src/kinds/short_logic";
import type { SortingData } from "../src/kinds/sorting";
import type { SpatialData } from "../src/kinds/spatial_reasoning";
import type { SymbolMatchData } from "../src/kinds/symbol_match";
import type { TemporalData } from "../src/kinds/temporal_reasoning";
import { permutations } from "../src/kinds/util";
import type { WorkingMemoryData } from "../src/kinds/working_memory";
import { dataOf, DIFFICULTIES, forEachInstance, viewsFor } from "./helpers";

const CORRECT = { ok: true, correct: true };
const isCorrect = (instance: TaskInstance, answer: unknown): boolean => {
  const r = checkTaskAnswer(instance, answer);
  return r.ok && r.correct;
};
const solved = (instance: TaskInstance): unknown => solveFromViews(instance.kind, viewsFor(instance));
function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === "string")) {
    throw new Error(`expected a string list, got ${JSON.stringify(value)}`);
  }
  return value;
}
const byDifficulty = <T>(d: TaskDifficulty, values: readonly [T, T, T]): T => values[d - 1] as T;

describe("difficulty scaling", () => {
  it.each(DIFFICULTIES)("sizes scale with difficulty %i", (d) => {
    forEachInstance("sequence_recall", d, (i) => {
      const digits = dataOf<SequenceRecallData>(i).digits;
      expect(digits).toHaveLength(byDifficulty(d, [4, 5, 6]));
      digits.forEach((v, k) => expect(v).not.toBe(digits[k - 1]));
    });
    forEachInstance("working_memory", d, (i) =>
      expect(dataOf<WorkingMemoryData>(i).lit).toHaveLength(byDifficulty(d, [3, 4, 5])),
    );
    forEachInstance("symbol_match", d, (i) =>
      expect(dataOf<SymbolMatchData>(i).target).toHaveLength(byDifficulty(d, [3, 4, 5])),
    );
    forEachInstance("arithmetic", d, (i) => {
      const tokens = dataOf<ArithmeticData>(i).tokens;
      const ops = tokens.filter((_, k) => k % 2 === 1);
      expect(ops).toHaveLength(byDifficulty(d, [2, 3, 3]));
      expect(ops.filter((o) => o === "×")).toHaveLength(d === 3 ? 1 : 0);
    });
    forEachInstance("instruction_following", d, (i) =>
      expect(dataOf<InstructionData>(i).steps).toHaveLength(byDifficulty(d, [3, 4, 5])),
    );
    forEachInstance("classification", d, (i) => {
      const data = dataOf<ClassificationData>(i);
      expect(data.crates).toHaveLength(byDifficulty(d, [3, 4, 5]));
      expect(data.rules).toHaveLength(byDifficulty(d, [3, 3, 4]));
      expect(data.rules[data.rules.length - 1]?.condition).toBeNull();
    });
    forEachInstance("anomaly_detection", d, (i) =>
      expect(dataOf<AnomalyData>(i).lines).toHaveLength(byDifficulty(d, [4, 5, 6])),
    );
    forEachInstance("temporal_reasoning", d, (i) =>
      expect(dataOf<TemporalData>(i).events).toHaveLength(byDifficulty(d, [3, 4, 5])),
    );
    forEachInstance("spatial_reasoning", d, (i) =>
      expect(dataOf<SpatialData>(i).moves).toHaveLength(byDifficulty(d, [3, 4, 5])),
    );
    forEachInstance("route_planning", d, (i) =>
      expect(dataOf<RouteData>(i).nodes).toHaveLength(byDifficulty(d, [5, 6, 7])),
    );
    forEachInstance("rule_composition", d, (i) =>
      expect(dataOf<RuleCompositionData>(i).rules).toHaveLength(byDifficulty(d, [2, 3, 4])),
    );
    forEachInstance("short_logic", d, (i) => {
      const data = dataOf<ShortLogicData>(i);
      expect(data.switches).toHaveLength(byDifficulty(d, [3, 3, 4]));
      expect(data.clues.length).toBeGreaterThanOrEqual(2);
      expect(data.clues.length).toBeLessThanOrEqual(4);
    });
    forEachInstance("sorting", d, (i) =>
      expect(dataOf<SortingData>(i).crates).toHaveLength(byDifficulty(d, [4, 5, 6])),
    );
    forEachInstance("checksum", d, (i) =>
      expect(dataOf<ChecksumData>(i).packet).toHaveLength(byDifficulty(d, [4, 6, 8])),
    );
  });
});

describe("kind-specific wrong answers over generated instances", () => {
  it.each(DIFFICULTIES)("sequence_recall: every single-digit substitution is wrong (d%i)", (d) => {
    forEachInstance("sequence_recall", d, (instance) => {
      const digits = dataOf<SequenceRecallData>(instance).digits;
      digits.forEach((v, k) => {
        const wrong = [...digits];
        wrong[k] = v === "0" ? "1" : "0";
        expect(isCorrect(instance, wrong)).toBe(false);
      });
    });
  });

  it.each(DIFFICULTIES)("working_memory: any order accepted, any one-cell change rejected (d%i)", (d) => {
    forEachInstance("working_memory", d, (instance) => {
      const lit = dataOf<WorkingMemoryData>(instance).lit;
      expect(isCorrect(instance, [...lit].reverse())).toBe(true);
      const unlit = ["A1", "B2", "C3", "D4", "A4", "D1"].find((c) => !lit.includes(c)) ?? "B3";
      lit.forEach((_, k) => {
        const wrong = [...lit];
        wrong[k] = unlit;
        expect(checkTaskAnswer(instance, wrong)).toEqual({ ok: true, correct: false });
      });
    });
  });

  it.each(DIFFICULTIES)("pattern_match / symbol_match: exactly one candidate matches (d%i)", (d) => {
    forEachInstance("pattern_match", d, (instance) => {
      const data = dataOf<PatternMatchData>(instance);
      const matching = data.candidates.filter((c) => matchesUnderRotation(data.target, c.rows));
      expect(matching.map((c) => c.id)).toEqual([data.answer]);
    });
    forEachInstance("symbol_match", d, (instance) => {
      const data = dataOf<SymbolMatchData>(instance);
      const same = data.candidates.filter((c) => c.names.join() === data.target.join());
      expect(same.map((c) => c.id)).toEqual([data.answer]);
      for (const c of data.candidates) {
        // Every distractor differs from the target in one substitution or one adjacent swap.
        const diff = c.names.flatMap((n, k) => (n === data.target[k] ? [] : [k]));
        expect(diff.length === 0 || diff.length === 1 || (diff.length === 2 && diff[1] === (diff[0] ?? 0) + 1)).toBe(true);
      }
    });
  });

  it.each(DIFFICULTIES)("arithmetic / instruction_following / checksum: off-by-one is wrong (d%i)", (d) => {
    for (const kind of ["arithmetic", "instruction_following", "checksum"] as const) {
      forEachInstance(kind, d, (instance) => {
        const answer = solved(instance);
        expect(typeof answer).toBe("number");
        if (typeof answer !== "number") return;
        expect(isCorrect(instance, answer + 1)).toBe(false);
        expect(isCorrect(instance, answer - 1)).toBe(false);
        if (kind === "arithmetic") expect(answer).toBeGreaterThanOrEqual(0);
        if (kind === "checksum") expect(answer >= 0 && answer <= 9).toBe(true);
      });
    }
    forEachInstance("instruction_following", d, (instance) => {
      const data = dataOf<InstructionData>(instance);
      let value = data.start;
      for (const step of data.steps) {
        value = runProcedure(value, [step]);
        expect(value >= 0 && value <= 60 && Number.isInteger(value)).toBe(true);
      }
    });
  });

  it.each(DIFFICULTIES)("classification: changing any one bay is wrong (d%i)", (d) => {
    forEachInstance("classification", d, (instance) => {
      const answer = stringList(solved(instance));
      expect(new Set(answer).size).toBeGreaterThanOrEqual(2);
      answer.forEach((bay, k) => {
        const wrong = [...answer];
        wrong[k] = bay === "A" ? "B" : "A";
        expect(checkTaskAnswer(instance, wrong)).toEqual({ ok: true, correct: false });
      });
    });
  });

  it.each(DIFFICULTIES)("anomaly_detection: exactly one removable line and it is the answer (d%i)", (d) => {
    forEachInstance("anomaly_detection", d, (instance) => {
      const data = dataOf<AnomalyData>(instance);
      const removable = removableLines(data.lines);
      expect(removable).toHaveLength(1);
      expect(data.lines[removable[0] ?? -1]?.id).toBe(data.anomaly);
    });
  });

  it.each(DIFFICULTIES)("temporal_reasoning: every other permutation is wrong (d%i)", (d) => {
    forEachInstance("temporal_reasoning", d, (instance) => {
      const data = dataOf<TemporalData>(instance);
      expect(data.events.map((e) => e.id)).not.toEqual(data.order); // display order never gives it away
      const correct = permutations(data.order).filter((p) => isCorrect(instance, p));
      expect(correct).toEqual([data.order]);
    }, 60);
  });

  it.each(DIFFICULTIES)("spatial_reasoning: four distinct in-grid options including the answer (d%i)", (d) => {
    forEachInstance("spatial_reasoning", d, (instance) => {
      const data = dataOf<SpatialData>(instance);
      expect(new Set(data.options).size).toBe(4);
      expect(data.options).toContain(solved(instance));
      for (const cell of data.options) expect(cell).toMatch(/^[A-E][1-5]$/);
    });
  });

  it.each(DIFFICULTIES)("rule_composition: at least one rule fires, and from d2 one does not (d%i)", (d) => {
    forEachInstance("rule_composition", d, (instance) => {
      const data = dataOf<RuleCompositionData>(instance);
      for (const color of ["red", "blue", "green", "yellow", "orange", "purple", "white", "black"]) {
        expect(data.beacon.color).not.toBe(color);
      }
      const { fired } = runRules(data.beacon, data.rules);
      expect(fired.some(Boolean)).toBe(true);
      if (d >= 2) expect(fired.every(Boolean)).toBe(false);
    });
  });

  it.each(DIFFICULTIES)("short_logic: the clues have exactly one solution; every other assignment is wrong (d%i)", (d) => {
    forEachInstance("short_logic", d, (instance) => {
      const data = dataOf<ShortLogicData>(instance);
      expect(solutions(data.switches, data.clues)).toHaveLength(1);
      // Every clue is needed, and from d2 on at most one clue states a switch outright.
      for (const clue of data.clues) {
        expect(solutions(data.switches, data.clues.filter((c) => c !== clue)).length).toBeGreaterThan(1);
      }
      if (d >= 2) expect(data.clues.filter((c) => c.type === "is_on" || c.type === "is_off").length).toBeLessThanOrEqual(1);
      for (const assignment of allAssignments(data.switches)) {
        const answer = data.switches.filter((s) => assignment.has(s));
        const same = answer.length === data.on.length && answer.every((s) => data.on.includes(s));
        expect(isCorrect(instance, answer)).toBe(same);
      }
    });
  });

  it.each(DIFFICULTIES)("sorting: every adjacent swap is wrong; weights are distinct (d%i)", (d) => {
    forEachInstance("sorting", d, (instance) => {
      const data = dataOf<SortingData>(instance);
      expect(new Set(data.crates.map((c) => c.weightKg)).size).toBe(data.crates.length);
      expect(new Set(data.crates.map((c) => c.id)).size).toBe(data.crates.length);
      const answer = stringList(solved(instance));
      expect(data.crates.map((c) => c.id)).not.toEqual(answer); // not pre-sorted
      for (let k = 0; k + 1 < answer.length; k++) {
        const wrong = [...answer];
        [wrong[k], wrong[k + 1]] = [wrong[k + 1] ?? "", wrong[k] ?? ""];
        expect(isCorrect(instance, wrong)).toBe(false);
      }
    });
  });
});

describe("route_planning over generated maps", () => {
  /** All simple paths from start to goal over edges that pass `usable`. */
  function simplePaths(edges: readonly GraphEdge[], start: string, goal: string, usable: (e: GraphEdge) => boolean): string[][] {
    const out: string[][] = [];
    const walk = (path: string[]): void => {
      const node = path[path.length - 1] ?? "";
      if (node === goal) {
        out.push(path);
        return;
      }
      for (const e of edges) {
        if (!usable(e) || (e.a !== node && e.b !== node)) continue;
        const next = e.a === node ? e.b : e.a;
        if (!path.includes(next)) walk([...path, next]);
      }
    };
    walk([start]);
    return out;
  }

  it.each(DIFFICULTIES)("accepts every shortest route and rejects longer or blocked ones (d%i)", (d) => {
    let alternatives = 0;
    let detours = 0;
    forEachInstance("route_planning", d, (instance, seed) => {
      const data = dataOf<RouteData>(instance);
      const blocked = data.edges.filter((e) => e.blocked);
      expect(blocked.length).toBeGreaterThanOrEqual(1);
      const best = hopDistances(data.edges, data.start).get(data.goal);
      expect(best, `seed ${seed}: goal reachable`).toBeDefined();
      expect(best ?? 0).toBeGreaterThanOrEqual(2);

      // A blocked link lies on a shortest route of the unblocked map, so it actually matters.
      const naiveBest = hopDistances(
        data.edges.map((e) => ({ ...e, blocked: false })),
        data.start,
      ).get(data.goal);
      const naiveShortest = simplePaths(data.edges, data.start, data.goal, () => true).filter(
        (p) => p.length - 1 === naiveBest,
      );
      const hit = naiveShortest.some((p) =>
        p.slice(1).some((v, k) => blocked.some((e) => (e.a === v && e.b === p[k]) || (e.b === v && e.a === p[k]))),
      );
      expect(hit, `seed ${seed}: a blocked link matters`).toBe(true);
      if ((best ?? 0) > (naiveBest ?? 0)) detours++;

      const open = simplePaths(data.edges, data.start, data.goal, (e) => !e.blocked);
      const shortest = open.filter((p) => p.length - 1 === best);
      if (shortest.length > 1) alternatives++;
      for (const p of shortest) expect(checkTaskAnswer(instance, p), `seed ${seed} ${p.join("")}`).toEqual(CORRECT);
      for (const p of open.filter((q) => q.length - 1 > (best ?? 0))) {
        expect(checkTaskAnswer(instance, p), `seed ${seed} longer ${p.join("")}`).toEqual({ ok: true, correct: false });
      }
      const viaBlocked = simplePaths(data.edges, data.start, data.goal, () => true).filter(
        (p) => !open.some((q) => q.join() === p.join()),
      );
      for (const p of viaBlocked) {
        expect(checkTaskAnswer(instance, p), `seed ${seed} blocked ${p.join("")}`).toEqual({ ok: true, correct: false });
      }
    });
    expect(alternatives, "some maps have several shortest routes").toBeGreaterThan(0);
    expect(detours, "most blocks force a detour").toBeGreaterThan(75);
  });
});

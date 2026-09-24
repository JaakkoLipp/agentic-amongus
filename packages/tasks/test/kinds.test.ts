import { describe, expect, it } from "vitest";
import type { TaskKind } from "@deduction/shared";
import { checkTaskAnswer, solveFromViews, taskView } from "../src";
import type { TaskInstance } from "../src";
import { isConsistentLog, removableLines } from "../src/kinds/anomaly_detection";
import { evaluateExpression } from "../src/kinds/arithmetic";
import { computeChecksum } from "../src/kinds/checksum";
import { routeCrate } from "../src/kinds/classification";
import { runProcedure } from "../src/kinds/instruction_following";
import { matchesUnderRotation, rotateClockwise } from "../src/kinds/pattern_match";
import { shortestPath } from "../src/kinds/route_planning";
import { runRules } from "../src/kinds/rule_composition";
import { solutions } from "../src/kinds/short_logic";
import { simulateDrone } from "../src/kinds/spatial_reasoning";
import { consistentOrders } from "../src/kinds/temporal_reasoning";
import { fixture, viewsFor } from "./helpers";

const CORRECT = { ok: true, correct: true };
const WRONG = { ok: true, correct: false };
const MALFORMED = { ok: false, reason: "malformed" };

/** Assert a list of [answer, expected result] pairs against one fixture. */
function expectResults(instance: TaskInstance, cases: readonly [unknown, object][]): void {
  for (const [answer, expected] of cases) {
    expect(checkTaskAnswer(instance, answer), JSON.stringify(answer)).toEqual(expected);
  }
}

const solve = (kind: TaskKind, instance: TaskInstance): unknown => solveFromViews(kind, viewsFor(instance));

describe("sequence_recall", () => {
  const instance = fixture("sequence_recall", { digits: ["4", "1", "7", "3"] });

  it("accepts only the exact sequence", () => {
    expectResults(instance, [
      [["4", "1", "7", "3"], CORRECT],
      [["4", "1", "3", "7"], WRONG],
      [["3", "7", "1", "4"], WRONG],
      [["4", "1", "7"], MALFORMED],
      [["4", "1", "7", "3", "0"], MALFORMED],
      ["4173", MALFORMED],
      [[4, 1, 7, 3], MALFORMED],
    ]);
  });

  it("shows the digits only while observing", () => {
    expect(taskView(instance, "observe").content).toMatchObject({ digits: ["4", "1", "7", "3"] });
    expect(taskView(instance, "delay").content).toEqual({ length: 4 });
    expect(taskView(instance, "answer").content).toEqual({ length: 4 });
    expect(solve("sequence_recall", instance)).toEqual(["4", "1", "7", "3"]);
  });
});

describe("working_memory", () => {
  const instance = fixture("working_memory", { lit: ["A1", "C2", "D4"] });

  it("accepts the lit set in any order", () => {
    expectResults(instance, [
      [["A1", "C2", "D4"], CORRECT],
      [["D4", "A1", "C2"], CORRECT],
      [["A1", "C2", "D3"], WRONG],
      [["A1", "C2"], MALFORMED],
      [["A1", "C2", "D4", "B1"], MALFORMED],
      [["A1", "A1", "C2"], MALFORMED],
      [["A1", "C2", "E5"], MALFORMED],
    ]);
  });

  it("renders the grid with row 1 on top", () => {
    expect(taskView(instance, "observe").content).toMatchObject({ grid: ["#...", "..#.", "....", "...#"] });
  });
});

describe("pattern_match", () => {
  const target = ["##.", ".#.", "..."];

  it("rotates clockwise", () => {
    expect(rotateClockwise(target)).toEqual(["..#", ".##", "..."]);
    expect(rotateClockwise(rotateClockwise(rotateClockwise(rotateClockwise(target))))).toEqual(target);
  });

  it("matches rotations but never mirror images or flips of a chiral pattern", () => {
    expect(matchesUnderRotation(target, ["...", ".#.", ".##"])).toBe(true);
    expect(matchesUnderRotation(target, [".##", ".#.", "..."])).toBe(false); // mirror
    expect(matchesUnderRotation(target, ["##.", ".##", "..."])).toBe(false); // one extra cell
  });

  it("checks the choice and solves from the view", () => {
    const instance = fixture("pattern_match", {
      target,
      candidates: [
        { id: "A", rows: [".##", ".#.", "..."] },
        { id: "B", rows: ["##.", ".##", "..."] },
        { id: "C", rows: ["..#", ".##", "..."] },
        { id: "D", rows: ["#..", "##.", "..."] },
      ],
      answer: "C",
    });
    expectResults(instance, [
      ["C", CORRECT],
      ["A", WRONG],
      ["E", MALFORMED],
      ["c", MALFORMED],
    ]);
    expect(solve("pattern_match", instance)).toBe("C");
  });
});

describe("symbol_match", () => {
  it("finds the identical glyph string", () => {
    const instance = fixture("symbol_match", {
      target: ["triangle", "circle", "square"],
      candidates: [
        { id: "A", names: ["circle", "triangle", "square"] },
        { id: "B", names: ["triangle", "circle", "square"] },
        { id: "C", names: ["triangle", "circle", "star"] },
        { id: "D", names: ["triangle", "square", "circle"] },
      ],
      answer: "B",
    });
    expectResults(instance, [
      ["B", CORRECT],
      ["A", WRONG],
      ["D", WRONG],
      [["B"], MALFORMED],
    ]);
    expect(solve("symbol_match", instance)).toBe("B");
    expect(taskView(instance, "answer").content).toMatchObject({ target: ["▲", "●", "■"] });
  });
});

describe("arithmetic", () => {
  it("evaluates with precedence", () => {
    expect(evaluateExpression(["17", "+", "8", "-", "4"])).toBe(21);
    expect(evaluateExpression(["14", "+", "6", "×", "3", "-", "5"])).toBe(27);
    expect(evaluateExpression(["2", "×", "9", "-", "4", "+", "1"])).toBe(15);
    expect(evaluateExpression(["20", "-", "3", "×", "4"])).toBe(8);
    expect(evaluateExpression(["1", "+"])).toBeNull();
    expect(evaluateExpression(["1", "/", "2"])).toBeNull();
  });

  it("checks the spec example 17 + 8 - 4 = 21", () => {
    const instance = fixture("arithmetic", { tokens: ["17", "+", "8", "-", "4"] });
    expectResults(instance, [
      [21, CORRECT],
      [22, WRONG],
      [-21, WRONG],
      ["21", MALFORMED],
      [21.5, MALFORMED],
      [NaN, MALFORMED],
    ]);
    expect(taskView(instance, "answer").content).toMatchObject({ expression: "17 + 8 - 4" });
    expect(solve("arithmetic", instance)).toBe(21);
  });
});

describe("instruction_following", () => {
  it("applies conditional steps against the current value", () => {
    const steps = [
      { op: "add", amount: 4, threshold: null }, // 7 -> 11
      { op: "double", amount: null, threshold: null }, // 22
      { op: "add_if_odd", amount: 1, threshold: null }, // even: 22
      { op: "halve_if_even", amount: null, threshold: null }, // 11
      { op: "subtract_if_greater", amount: 3, threshold: 10 }, // 8
      { op: "add_if_less", amount: 9, threshold: 5 }, // not < 5: 8
    ] as const;
    expect(runProcedure(7, steps.map((s) => ({ ...s })))).toBe(8);
    const instance = fixture("instruction_following", { start: 7, steps: steps.map((s) => ({ ...s })) });
    expectResults(instance, [
      [8, CORRECT],
      [17, WRONG],
      [8.5, MALFORMED],
    ]);
    expect(solve("instruction_following", instance)).toBe(8);
  });
});

describe("classification", () => {
  const rules = [
    { condition: { type: "flag", flag: "fragile" }, bay: "A" },
    { condition: { type: "min_weight", kg: 50 }, bay: "B" },
    { condition: null, bay: "C" },
  ] as const;
  const crates = [
    { code: "K12", weightKg: 60, fragile: true, cold: false, hazardous: false }, // fragile wins over heavy
    { code: "M20", weightKg: 70, fragile: false, cold: false, hazardous: false },
    { code: "P31", weightKg: 10, fragile: false, cold: false, hazardous: false },
    { code: "T44", weightKg: 50, fragile: false, cold: false, hazardous: false }, // boundary: 50 kg or more
  ];

  it("routes by the first matching rule", () => {
    expect(crates.map((c) => routeCrate([...rules], c))).toEqual(["A", "B", "C", "B"]);
  });

  it("checks the per-crate bay sequence", () => {
    const instance = fixture("classification", { rules: [...rules], crates, shownFlags: ["fragile"] });
    expectResults(instance, [
      [["A", "B", "C", "B"], CORRECT],
      [["B", "B", "C", "B"], WRONG],
      [["A", "B", "C", "C"], WRONG],
      [["A", "B", "C"], MALFORMED],
      [["A", "B", "C", "D"], MALFORMED],
      ["ABCB", MALFORMED],
    ]);
    expect(solve("classification", instance)).toEqual(["A", "B", "C", "B"]);
  });
});

describe("anomaly_detection", () => {
  const entry = (minute: number, unit: string, event: string) => ({ minute, unit, event });

  it("defines consistency and the removable line precisely", () => {
    expect(isConsistentLog([entry(784, "Drone K", "docked"), entry(787, "Drone K", "undocked")])).toBe(true);
    expect(isConsistentLog([entry(784, "Drone K", "undocked")])).toBe(false);
    expect(isConsistentLog([entry(784, "Drone K", "docked"), entry(784, "Drone M", "docked")])).toBe(false);
    // The spec's example (13:04, 13:07, 13:05) is ambiguous: dropping either of the last two lines fixes it,
    // which is why generated logs place a time anomaly below two earlier-stamped lines.
    expect(
      removableLines([entry(784, "Drone K", "docked"), entry(787, "Drone M", "docked"), entry(785, "Drone P", "docked")]),
    ).toEqual([1, 2]);
  });

  it("finds a time anomaly", () => {
    const instance = fixture("anomaly_detection", {
      lines: [
        { id: "L1", minute: 784, unit: "Drone K", event: "docked" },
        { id: "L2", minute: 787, unit: "Drone M", event: "docked" },
        { id: "L3", minute: 789, unit: "Drone K", event: "undocked" },
        { id: "L4", minute: 782, unit: "Drone P", event: "docked" },
      ],
      anomaly: "L4",
    });
    expectResults(instance, [
      ["L4", CORRECT],
      ["L3", WRONG],
      ["L5", MALFORMED], // not offered in this 4-line log
      ["l4", MALFORMED],
    ]);
    expect(solve("anomaly_detection", instance)).toBe("L4");
    expect(taskView(instance, "answer").content).toMatchObject({ lines: [{ text: "13:04 Drone K docked" }, {}, {}, {}] });
  });

  it("finds an undock before any dock", () => {
    const instance = fixture("anomaly_detection", {
      lines: [
        { id: "L1", minute: 784, unit: "Drone K", event: "docked" },
        { id: "L2", minute: 786, unit: "Drone M", event: "undocked" },
        { id: "L3", minute: 788, unit: "Drone K", event: "undocked" },
      ],
      anomaly: "L2",
    });
    expect(solve("anomaly_detection", instance)).toBe("L2");
    expectResults(instance, [
      ["L2", CORRECT],
      ["L1", WRONG],
    ]);
  });
});

describe("temporal_reasoning", () => {
  const instance = fixture("temporal_reasoning", {
    events: [
      { id: "calibration", label: "Calibration" },
      { id: "hull_scan", label: "Hull scan" },
      { id: "refuel", label: "Refuel" },
    ],
    statements: [
      { earlier: "refuel", later: "calibration", phrasing: "before" },
      { earlier: "calibration", later: "hull_scan", phrasing: "after" },
    ],
    order: ["refuel", "calibration", "hull_scan"],
  });

  it("has a unique consistent order", () => {
    expect(
      consistentOrders(["calibration", "hull_scan", "refuel"], [
        { earlier: "refuel", later: "calibration" },
        { earlier: "calibration", later: "hull_scan" },
      ]),
    ).toEqual([["refuel", "calibration", "hull_scan"]]);
    expect(consistentOrders(["a", "b", "c"], [{ earlier: "a", later: "c" }])).toHaveLength(3);
  });

  it("checks the ordering and phrases statements both ways", () => {
    expectResults(instance, [
      [["refuel", "calibration", "hull_scan"], CORRECT],
      [["calibration", "refuel", "hull_scan"], WRONG],
      [["refuel", "calibration"], MALFORMED],
      [["refuel", "calibration", "calibration"], MALFORMED],
      [["refuel", "calibration", "inventory"], MALFORMED],
    ]);
    expect(solve("temporal_reasoning", instance)).toEqual(["refuel", "calibration", "hull_scan"]);
    const texts = JSON.stringify(taskView(instance, "answer").content);
    expect(texts).toContain("Refuel happened before Calibration.");
    expect(texts).toContain("Hull scan happened after Calibration.");
  });
});

describe("spatial_reasoning", () => {
  it("simulates moves with row 1 at the top", () => {
    const fwd = (steps: number) => ({ action: "forward" as const, steps });
    const turn = (action: "turn_left" | "turn_right" | "turn_around") => ({ action, steps: null });
    expect(simulateDrone("B4", "north", [fwd(2), turn("turn_right"), fwd(3)])).toBe("E2");
    expect(simulateDrone("C3", "east", [turn("turn_left"), fwd(2), turn("turn_around"), fwd(4)])).toBe("C5");
    expect(simulateDrone("A1", "north", [fwd(1)])).toBeNull();
    expect(simulateDrone("E5", "west", [fwd(4), turn("turn_right"), fwd(4)])).toBe("A1");
  });

  it("checks the chosen cell", () => {
    const instance = fixture("spatial_reasoning", {
      start: "B4",
      facing: "north",
      moves: [
        { action: "forward", steps: 2 },
        { action: "turn_right", steps: null },
        { action: "forward", steps: 3 },
      ],
      options: ["B2", "B5", "E2", "E4"],
    });
    expectResults(instance, [
      ["E2", CORRECT],
      ["E4", WRONG],
      ["C3", MALFORMED], // a real cell, but not one of the offered options
      ["F9", MALFORMED],
    ]);
    expect(solve("spatial_reasoning", instance)).toBe("E2");
  });
});

describe("route_planning", () => {
  const node = (id: string, x: number, y: number) => ({ id, x, y });
  const edge = (a: string, b: string, blocked = false) => ({ a, b, blocked });

  it("handles the spec map (A-B-D, A-C, B-E, C-E, B-D blocked) plus an E-D link", () => {
    const instance = fixture("route_planning", {
      nodes: [node("A", 0, 0), node("B", 1, 0), node("D", 2, 0), node("C", 0, 1), node("E", 1, 1)],
      edges: [edge("A", "B"), edge("B", "D", true), edge("A", "C"), edge("B", "E"), edge("C", "E"), edge("D", "E")],
      start: "A",
      goal: "D",
    });
    expectResults(instance, [
      [["A", "B", "E", "D"], CORRECT],
      [["A", "C", "E", "D"], CORRECT], // an equally short alternative
      [["A", "B", "D"], WRONG], // uses the blocked link
      [["A", "C", "E", "B", "D"], WRONG], // longer, and blocked
      [["B", "E", "D"], WRONG], // wrong start
      [["A", "B", "E"], WRONG], // wrong goal
      [["A", "B", "A", "B", "E", "D"], WRONG], // repeats nodes
      [["A", "F", "D"], MALFORMED], // F is not on this map
      [[], MALFORMED],
    ]);
    expect(solve("route_planning", instance)).toEqual(["A", "B", "E", "D"]);
  });

  it("rejects a longer valid route", () => {
    const instance = fixture("route_planning", {
      nodes: [node("A", 0, 0), node("B", 1, 0), node("C", 2, 0), node("D", 2, 1), node("E", 0, 1)],
      edges: [edge("A", "B"), edge("B", "C"), edge("C", "D"), edge("A", "E"), edge("E", "D"), edge("B", "D", true)],
      start: "A",
      goal: "D",
    });
    expectResults(instance, [
      [["A", "E", "D"], CORRECT],
      [["A", "B", "C", "D"], WRONG],
      [["A", "B", "D"], WRONG],
    ]);
  });

  it("treats the literal spec map as unreachable (D's only link is blocked)", () => {
    const edges = [edge("A", "B"), edge("B", "D", true), edge("A", "C"), edge("B", "E"), edge("C", "E")];
    expect(shortestPath(edges, "A", "D")).toBeNull();
    const instance = fixture("route_planning", {
      nodes: [node("A", 0, 0), node("B", 1, 0), node("D", 2, 0), node("C", 0, 1), node("E", 1, 1)],
      edges,
      start: "A",
      goal: "D",
    });
    expectResults(instance, [[["A", "B", "D"], WRONG]]);
  });
});

describe("rule_composition", () => {
  it("solves the spec example: red triangle pointing up", () => {
    const data = {
      beacon: { color: "red", shape: "triangle", direction: "up" },
      rules: [
        { condition: { attribute: "color", value: "red", negate: false }, action: "reverse" },
        { condition: { attribute: "shape", value: "triangle", negate: false }, action: "rotate_cw" },
      ],
    } as const;
    const instance = fixture("rule_composition", {
      beacon: { ...data.beacon },
      rules: data.rules.map((r) => ({ condition: { ...r.condition }, action: r.action })),
    });
    expectResults(instance, [
      ["left", CORRECT],
      ["down", WRONG],
      ["up", WRONG],
      ["west", MALFORMED],
      ["Left", MALFORMED],
    ]);
    expect(solve("rule_composition", instance)).toBe("left");
  });

  it("evaluates direction conditions against the current direction and supports negation", () => {
    const result = runRules({ color: "amber", shape: "circle", direction: "right" }, [
      { condition: { attribute: "direction", value: "right", negate: false }, action: "rotate_cw" }, // -> down
      { condition: { attribute: "direction", value: "right", negate: false }, action: "reverse" }, // skipped
      { condition: { attribute: "shape", value: "square", negate: true }, action: "rotate_ccw" }, // -> right
    ]);
    expect(result).toEqual({ direction: "right", fired: [true, false, true] });
  });
});

describe("short_logic", () => {
  const instance = fixture("short_logic", {
    switches: ["S1", "S2", "S3"],
    clues: [
      { type: "is_on", a: "S1" },
      { type: "different", a: "S1", b: "S2" },
      { type: "exactly", count: 2 },
    ],
    on: ["S1", "S3"],
  });

  it("has a unique solution", () => {
    const found = solutions(["S1", "S2", "S3"], [
      { type: "is_on", a: "S1" },
      { type: "different", a: "S1", b: "S2" },
      { type: "exactly", count: 2 },
    ]);
    expect(found.map((s) => [...s].sort())).toEqual([["S1", "S3"]]);
  });

  it("checks the ON set regardless of order", () => {
    expectResults(instance, [
      [["S1", "S3"], CORRECT],
      [["S3", "S1"], CORRECT],
      [["S1"], WRONG],
      [["S1", "S2", "S3"], WRONG],
      [[], WRONG],
      [["S1", "S1"], MALFORMED],
      [["S4"], MALFORMED], // this instance has no S4
      ["S1,S3", MALFORMED],
    ]);
    expect(solve("short_logic", instance)).toEqual(["S1", "S3"]);
  });

  it("accepts an empty answer when every switch is OFF", () => {
    const allOff = fixture("short_logic", {
      switches: ["S1", "S2", "S3"],
      clues: [
        { type: "exactly", count: 0 },
        { type: "implies", a: "S1", aOn: true, b: "S2", bOn: true },
      ],
      on: [],
    });
    expectResults(allOff, [
      [[], CORRECT],
      [["S2"], WRONG],
    ]);
    expect(solve("short_logic", allOff)).toEqual([]);
  });
});

describe("sorting", () => {
  it("orders crates lightest to heaviest", () => {
    const instance = fixture("sorting", {
      crates: [
        { id: "K4", weightKg: 37 },
        { id: "M2", weightKg: 12 },
        { id: "P7", weightKg: 55 },
        { id: "T3", weightKg: 20 },
      ],
    });
    expectResults(instance, [
      [["M2", "T3", "K4", "P7"], CORRECT],
      [["P7", "K4", "T3", "M2"], WRONG],
      [["M2", "K4", "T3", "P7"], WRONG],
      [["M2", "T3", "K4"], MALFORMED],
      [["m2", "t3", "k4", "p7"], MALFORMED],
      [["M2", "T3", "K4", "X9"], MALFORMED],
    ]);
    expect(solve("sorting", instance)).toEqual(["M2", "T3", "K4", "P7"]);
  });
});

describe("checksum", () => {
  it("computes each rule", () => {
    expect(computeChecksum("4829", "digit_sum")).toBe(3); // 23
    expect(computeChecksum("482913", "alternating")).toBe(7); // (4+2+1) - (8+9+3) = -13
    expect(computeChecksum("9102", "alternating")).toBe(6); // (9+0) - (1+2) = 6
    expect(computeChecksum("4829", "weighted")).toBe(0); // 4 + 16 + 2 + 18 = 40
    expect(computeChecksum("48291375", "weighted")).toBe(4); // 64
    expect(computeChecksum("12a4", "digit_sum")).toBeNull();
  });

  it("checks a digit answer", () => {
    const instance = fixture("checksum", { packet: "482913", rule: "alternating" }, 2);
    expectResults(instance, [
      [7, CORRECT],
      [-3, WRONG],
      [3, WRONG],
      ["7", MALFORMED],
    ]);
    expect(solve("checksum", instance)).toBe(7);
  });
});

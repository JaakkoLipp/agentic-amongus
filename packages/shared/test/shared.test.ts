import { describe, expect, it } from "vitest";
import {
  compassDirection,
  deriveRng,
  GameSettingsSchema,
  GoalDecisionSchema,
  normalizeGoalDecision,
  PlayerActionSchema,
  resolveGameSettings,
  Rng,
} from "@deduction/shared";

describe("Rng", () => {
  it("is deterministic and snapshot-able", () => {
    const a = Rng.fromSeed(42);
    const b = Rng.fromSeed(42);
    const seqA = Array.from({ length: 20 }, () => a.nextUint32());
    expect(Array.from({ length: 20 }, () => b.nextUint32())).toEqual(seqA);
    const snap = a.snapshot();
    const x = a.next();
    expect(new Rng(snap).next()).toBe(x);
  });

  it("derived streams are independent of each other", () => {
    const tasks = deriveRng(1, "tasks").next();
    const roles = deriveRng(1, "roles");
    roles.next();
    roles.next();
    expect(deriveRng(1, "tasks").next()).toBe(tasks);
    expect(deriveRng(1, "tasks").next()).not.toBe(deriveRng(2, "tasks").next());
  });

  it("int stays in range and shuffle is a permutation", () => {
    const r = Rng.fromSeed(3);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(-2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("settings", () => {
  it("defaults describe a 10-player, 2-infiltrator match", () => {
    const s = resolveGameSettings();
    expect(s).toMatchObject({ playerCount: 10, infiltratorCount: 2, mapId: "outpost-kappa", confirmEjects: true });
  });

  it("rejects out-of-range values", () => {
    expect(GameSettingsSchema.safeParse({ playerCount: 40 }).success).toBe(false);
    expect(GameSettingsSchema.safeParse({ killCooldownSec: -1 }).success).toBe(false);
  });
});

describe("goal decisions (structured LLM output)", () => {
  it("normalizes a valid decision", () => {
    const parsed = GoalDecisionSchema.parse({ goal: "FOLLOW", targetPlayerId: "purple", durationSeconds: 12, reasonSummary: "Purple was near the previous body." });
    expect(normalizeGoalDecision(parsed, "crew")).toEqual({ ok: true, goal: { type: "FOLLOW", playerId: "purple", durationTicks: 360 } });
  });

  it("rejects missing targets and role-forbidden goals", () => {
    expect(normalizeGoalDecision(GoalDecisionSchema.parse({ goal: "FOLLOW" }), "crew").ok).toBe(false);
    expect(normalizeGoalDecision(GoalDecisionSchema.parse({ goal: "KILL", targetPlayerId: "red" }), "crew").ok).toBe(false);
    expect(normalizeGoalDecision(GoalDecisionSchema.parse({ goal: "KILL", targetPlayerId: "red" }), "infiltrator").ok).toBe(true);
  });

  it("schema rejects free-form junk", () => {
    expect(GoalDecisionSchema.safeParse({ goal: "TELEPORT" }).success).toBe(false);
    expect(GoalDecisionSchema.safeParse("MOVE_TO Electrical").success).toBe(false);
  });
});

describe("wire actions", () => {
  it("validates client actions", () => {
    expect(PlayerActionSchema.safeParse({ type: "KILL", targetId: "red" }).success).toBe(true);
    expect(PlayerActionSchema.safeParse({ type: "KILL" }).success).toBe(false);
    expect(PlayerActionSchema.safeParse({ type: "SPEAK", text: "x".repeat(501) }).success).toBe(false);
  });
});

describe("compassDirection", () => {
  it("uses screen coordinates (+y is south)", () => {
    expect(compassDirection({ x: 0, y: 1 })).toBe("south");
    expect(compassDirection({ x: 1, y: -1 })).toBe("northeast");
    expect(compassDirection({ x: 0, y: 0 })).toBeNull();
  });
});

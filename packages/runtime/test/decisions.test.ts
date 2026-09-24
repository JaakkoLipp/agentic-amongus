import { describe, expect, it } from "vitest";
import {
  secondsToTicks,
  type AgentDecision,
  type ControllerKind,
  type DecisionRequest,
  type PlayerController,
  type PlayerId,
  type PlayerObservation,
} from "@deduction/shared";
import { areaAt } from "@deduction/maps";
import { MatchRunner } from "@deduction/runtime";

interface Call {
  readonly obs: PlayerObservation;
  readonly request: DecisionRequest;
  resolve(d: AgentDecision): void;
  reject(e: Error): void;
}

/** A controller whose answers the test hands out manually — stands in for a slow LLM. */
class ManualController implements PlayerController {
  readonly calls: Call[] = [];
  constructor(readonly kind: ControllerKind = "llm") {}
  decide(obs: PlayerObservation, request: DecisionRequest): Promise<AgentDecision> {
    return new Promise((resolve, reject) => this.calls.push({ obs, request, resolve, reject }));
  }
}

function setup(controller: PlayerController, extra: { decisionTimeoutMs?: number } = {}) {
  let seat: PlayerId | null = null;
  const runner = new MatchRunner({
    settings: { seed: 11 },
    mode: "realtime",
    controllerFactory: (ctx) => {
      if (seat === null && ctx.playerId !== "red") {
        seat = ctx.playerId;
        return controller;
      }
      return null;
    },
    ...extra,
  });
  const id = seat as PlayerId | null;
  if (!id) throw new Error("no seat assigned");
  return { runner, id, host: runner.hosts.get(id)! };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function tickUntil(runner: MatchRunner, cond: () => boolean, max = 600): void {
  for (let i = 0; i < max && !cond(); i++) runner.tick();
  if (!cond()) throw new Error("condition not reached");
}

describe("asynchronous decisions", () => {
  it("stale LLM decisions are discarded after a meeting starts", async () => {
    const manual = new ManualController();
    const { runner, id, host } = setup(manual);
    tickUntil(runner, () => manual.calls.length > 0);
    const first = manual.calls[0]!;
    expect(first.request.kind).toBe("roam");

    // Something important happens while the model is "thinking": red calls an emergency meeting.
    const red = runner.match.state.players.find((p) => p.id === "red")!;
    red.pos = runner.match.map.def.emergencyButton.pos;
    red.roomId = areaAt(runner.match.map, red.pos);
    runner.match.state.emergencyReadyAtTick = 0;
    expect(runner.match.submitAction("red", { type: "CALL_EMERGENCY" })).toEqual({ ok: true });
    for (let i = 0; i < 6; i++) runner.tick();

    first.resolve({ kind: "roam", goal: { type: "MOVE_TO", roomId: "electrical" }, utterance: null, reasonSummary: "late answer" });
    await flush();
    // Every agent that was mid-decision when the meeting started is affected; check the one we control.
    expect(runner.metrics.staleDecisions).toBeGreaterThanOrEqual(1);
    expect(host.decisionLog.map((d) => d.outcome)).toEqual(["stale"]);
    expect(host.currentGoal).toBeNull();
    expect(runner.match.state.players.find((p) => p.id === id)!.moveIntent).toEqual({ mode: "stop" });
  });

  it("invalid LLM output triggers the deterministic fallback", async () => {
    const manual = new ManualController();
    const { runner, host } = setup(manual);
    tickUntil(runner, () => manual.calls.length > 0);
    manual.calls[0]!.resolve({ kind: "roam", goal: { type: "FOLLOW", playerId: "nobody", durationTicks: 90 }, utterance: null, reasonSummary: "hallucinated player" });
    await flush();
    expect(runner.metrics.invalidDecisions).toBe(1);
    expect(runner.metrics.fallbacks).toBe(1);
    expect(host.decisionLog.map((d) => d.outcome)).toEqual(["invalid", "applied"]);
    expect(host.decisionLog.at(-1)?.source).toBe("fallback");
    expect(["GO_DO_TASK", "FAKE_TASK"]).toContain(host.currentGoal?.type);
  });

  it("a decision of the wrong kind is rejected and replaced by the fallback", async () => {
    const manual = new ManualController();
    const { runner, host } = setup(manual);
    tickUntil(runner, () => manual.calls.length > 0);
    manual.calls[0]!.resolve({ kind: "vote", target: "skip", reasonSummary: "confused model" });
    await flush();
    expect(runner.metrics.fallbacks).toBe(1);
    expect(host.currentGoal).not.toBeNull();
  });

  it("provider errors trigger the fallback and never crash the match", async () => {
    const manual = new ManualController();
    const { runner, host } = setup(manual);
    tickUntil(runner, () => manual.calls.length > 0);
    manual.calls[0]!.reject(new Error("connection refused"));
    await flush();
    expect(runner.metrics.controllerErrors).toBe(1);
    expect(runner.metrics.fallbacks).toBe(1);
    expect(host.currentGoal).not.toBeNull();
  });

  it("slow controllers time out into the fallback", async () => {
    const manual = new ManualController("llm");
    const { runner, host } = setup(manual, { decisionTimeoutMs: 20 });
    tickUntil(runner, () => manual.calls.length > 0);
    await new Promise((r) => setTimeout(r, 60));
    expect(runner.metrics.controllerErrors).toBe(1);
    expect(runner.metrics.fallbacks).toBe(1);
    expect(host.currentGoal).not.toBeNull();
  });

  it("an agent keeps executing its previous goal while the next decision is pending", async () => {
    const manual = new ManualController();
    const { runner, id, host } = setup(manual);
    tickUntil(runner, () => manual.calls.length > 0);
    manual.calls[0]!.resolve({ kind: "roam", goal: { type: "MOVE_TO", roomId: "electrical" }, utterance: null, reasonSummary: "go" });
    await flush();
    expect(host.currentGoal?.type).toBe("MOVE_TO");

    // The heartbeat asks again; that request is never answered, yet the agent keeps walking.
    tickUntil(runner, () => manual.calls.length > 1, secondsToTicks(10));
    const before = { ...runner.match.state.players.find((p) => p.id === id)!.pos };
    for (let i = 0; i < 60; i++) runner.tick();
    const after = runner.match.state.players.find((p) => p.id === id)!.pos;
    expect(host.hasPendingDecision).toBe(true);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(3);
  });

  it("the simulation tick never waits for inference", () => {
    const manual = new ManualController();
    const { runner } = setup(manual);
    const start = runner.match.tick;
    for (let i = 0; i < 300; i++) runner.tick();
    expect(runner.match.tick).toBe(start + 300);
    expect(manual.calls.length).toBe(1);
  });
});

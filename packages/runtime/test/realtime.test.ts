import { describe, expect, it } from "vitest";
import { MatchRunner } from "@deduction/runtime";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("realtime loop", () => {
  it("runs ticks against the wall clock and stops on request", async () => {
    const runner = new MatchRunner({ settings: { seed: 3 }, mode: "realtime" });
    let ticks = 0;
    runner.startRealtime({ tickMs: 2, onTick: () => ticks++ });
    expect(runner.isRunningRealtime).toBe(true);
    await wait(120);
    runner.stopRealtime();
    expect(runner.isRunningRealtime).toBe(false);
    expect(ticks).toBeGreaterThan(10);
    expect(runner.match.tick).toBe(ticks);
    const stoppedAt = runner.match.tick;
    await wait(30);
    expect(runner.match.tick).toBe(stoppedAt);
  });

  it("does not fast-forward through a long stall", async () => {
    const runner = new MatchRunner({ settings: { seed: 3 }, mode: "realtime" });
    runner.startRealtime({ tickMs: 5, maxCatchUpTicks: 3 });
    await wait(20);
    const before = runner.match.tick;
    const until = performance.now() + 200; // block the event loop: ~40 ticks are "owed"
    while (performance.now() < until) {
      // busy wait
    }
    await wait(1);
    runner.stopRealtime();
    expect(runner.match.tick - before).toBeLessThanOrEqual(4); // one catch-up burst (+1 slack for a slow host)
  });

  it("stops by itself when the match ends", async () => {
    const runner = new MatchRunner({ settings: { seed: 3 }, mode: "realtime" });
    runner.startRealtime({ tickMs: 1 });
    await wait(10);
    // Every infiltrator drops dead: the crew win on the next tick.
    for (const p of runner.match.state.players) if (p.role === "infiltrator") p.alive = false;
    await wait(30);
    expect(runner.isOver).toBe(true);
    expect(runner.isRunningRealtime).toBe(false);
    expect(runner.match.state.outcome?.winner).toBe("crew");
  });

  it("reports a crash inside the loop through onError and stops", async () => {
    const runner = new MatchRunner({ settings: { seed: 3 }, mode: "realtime" });
    const errors: string[] = [];
    let calls = 0;
    runner.startRealtime({
      tickMs: 1,
      onTick: () => {
        if (++calls === 3) throw new Error("boom");
      },
      onError: (e) => errors.push(e.message),
    });
    await wait(30);
    expect(errors).toEqual(["boom"]);
    expect(runner.isRunningRealtime).toBe(false);
    expect(runner.match.tick).toBe(3);
  });

  it("records human movement changes and actions in the replay", () => {
    const runner = new MatchRunner({ settings: { seed: 3 }, seats: { red: "human" }, recordReplay: true });
    runner.setHumanMove("red", { x: 1, y: 0 });
    runner.setHumanMove("red", { x: 1, y: 0 });
    runner.tick();
    runner.setHumanMove("red", { x: 0, y: 0 });
    expect(runner.submitHumanAction("red", { type: "CALL_EMERGENCY" }).ok).toBe(false);
    // Only human seats may use the human path.
    expect(runner.submitHumanAction("blue", { type: "CALL_EMERGENCY" })).toEqual({ ok: false, reason: "invalid_target" });
    const human = runner.replay!.lines.filter((l) => l.kind === "agent" && l.record.type === "HUMAN_INPUT");
    expect(human.map((l) => (l.kind === "agent" ? l.record.data : null))).toEqual([
      { move: { x: 1, y: 0 } },
      { move: { x: 0, y: 0 } },
      { action: { type: "CALL_EMERGENCY" }, ok: false },
    ]);
  });
});

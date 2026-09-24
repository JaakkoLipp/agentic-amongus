import { describe, expect, it } from "vitest";
import { eventStreamDigest } from "@deduction/engine";
import { MatchRunner, simulateMatch } from "@deduction/runtime";

async function digestFor(seed: number, controllers: "heuristic" | "random" = "heuristic") {
  const runner = new MatchRunner({ settings: { seed }, defaultController: controllers, recordEvents: true });
  const summary = await runner.runToEnd();
  return { digest: eventStreamDigest(runner.match.log), summary };
}

describe("match runner", () => {
  it("is deterministic in lockstep mode: same seed, same event stream", async () => {
    const a = await digestFor(1234);
    const b = await digestFor(1234);
    expect(a.digest).toBe(b.digest);
    expect(a.summary.winner).toBe(b.summary.winner);
    const c = await digestFor(1235);
    expect(c.digest).not.toBe(a.digest);
  });

  it("random controllers are deterministic too", async () => {
    expect((await digestFor(77, "random")).digest).toBe((await digestFor(77, "random")).digest);
  });

  it("records a replay whose header carries seed, map version, roles and task instances", async () => {
    const runner = new MatchRunner({ settings: { seed: 5 }, recordEvents: true, recordReplay: true });
    await runner.runToEnd();
    const lines = runner.replay!.toJsonl().trim().split("\n").map((l) => JSON.parse(l) as { kind: string; header?: Record<string, unknown>; event?: { type: string } });
    const header = lines[0]!.header!;
    expect(header).toMatchObject({ format: "agentic-deduction-replay/1", seed: 5, mapId: "outpost-kappa", mapVersion: "1.0.0" });
    expect(Object.keys(header.roles as object)).toHaveLength(10);
    expect((header.tasks as unknown[]).length).toBe(50);
    expect(lines.at(-1)!.event!.type).toBe("MATCH_ENDED");
  });

  it("heuristic agents produce meeting discussion grounded in the match and vote separately", async () => {
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      const runner = new MatchRunner({ settings: { seed }, recordEvents: true });
      await runner.runToEnd();
      const messages = runner.match.log.filter((e) => e.type === "MEETING_MESSAGE");
      const votes = runner.match.log.filter((e) => e.type === "VOTE_CAST");
      if (messages.length > 0 && votes.length > 0) {
        found = true;
        for (const host of runner.hosts.values()) {
          const kinds = new Set(host.decisionLog.map((d) => d.kind));
          if (kinds.has("vote")) expect(host.decisionLog.some((d) => d.kind === "vote" && d.summary.startsWith("vote"))).toBe(true);
        }
      }
    }
    expect(found).toBe(true);
  });

  it("simulateMatch reports completed matches without impossible states", async () => {
    for (const controllers of ["heuristic", "random", "mixed"] as const) {
      for (let seed = 300; seed < 306; seed++) {
        const r = await simulateMatch(seed, { settings: {}, controllers, checkInvariants: true, recordReplay: false });
        expect(r.status, `${controllers} seed ${seed}: ${r.error}`).toBe("completed");
        expect(r.summary!.metrics.invariantViolations).toEqual([]);
      }
    }
  });
});

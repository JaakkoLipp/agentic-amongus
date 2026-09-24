import { describe, expect, it } from "vitest";
import { secondsToTicks, type SabotageKind } from "@deduction/shared";
import type { Match } from "@deduction/engine";
import {
  act,
  callEmergency,
  COMMONS,
  crewIds,
  eventsOf,
  expectOk,
  infiltratorIds,
  killNow,
  lastSeq,
  newMatch,
  place,
  player,
  scatter,
  smallMatch,
  step,
  stepUntilPlaying,
} from "./helpers";

const station = (m: Match, id: string) => m.map.sabotageStationById.get(id)!.pos;

/** Setup: lift the sabotage cooldown, then sabotage through the real action. */
function sabotage(m: Match, kind: SabotageKind): string {
  const inf = infiltratorIds(m)[0]!;
  m.state.sabotageReadyAtTick = m.tick;
  expectOk(act(m, inf, { type: "SABOTAGE", kind }), `SABOTAGE ${kind}`);
  return inf;
}

describe("sabotage", () => {
  it("lights are fixed by holding the panel for repairHoldSec", () => {
    const m = smallMatch();
    const [fixer] = crewIds(m) as [string];
    const hold = secondsToTicks(m.state.settings.repairHoldSec);
    sabotage(m, "lights");
    expect(m.observe(fixer).self.visionRadius).toBeLessThan(m.state.settings.crewVision);

    place(m, fixer, station(m, "lights_panel"));
    expect(m.observe(fixer).legal.repair).toEqual(["lights_panel"]);
    // Letting go early does not count.
    expectOk(act(m, fixer, { type: "START_REPAIR", stationId: "lights_panel" }));
    step(m, hold - 10);
    expectOk(act(m, fixer, { type: "STOP_REPAIR" }));
    step(m, 20);
    expect(m.state.sabotage?.kind).toBe("lights");

    expectOk(act(m, fixer, { type: "START_REPAIR", stationId: "lights_panel" }));
    expect(act(m, fixer, { type: "START_REPAIR", stationId: "lights_panel" })).toEqual({ ok: false, reason: "busy" });
    expect(m.observe(fixer, false).self.activity).toBe("repair");
    step(m, hold - 1);
    expect(m.state.sabotage?.kind).toBe("lights");
    step(m, 1);
    expect(m.state.sabotage).toBeNull();
    expect(eventsOf(m, "SABOTAGE_FIXED")).toEqual([expect.objectContaining({ kind: "lights", fixerIds: [fixer] })]);
    expect(player(m, fixer).repair).toBeNull();
    expect(m.observe(fixer).self.visionRadius).toBe(m.state.settings.crewVision);
  });

  it("walking away interrupts a repair", () => {
    const m = smallMatch();
    const [fixer] = crewIds(m) as [string];
    sabotage(m, "lights");
    place(m, fixer, station(m, "lights_panel"));
    expectOk(act(m, fixer, { type: "START_REPAIR", stationId: "lights_panel" }));
    m.setMoveIntent(fixer, { mode: "direction", dir: { x: 1, y: 0 } });
    step(m, secondsToTicks(m.state.settings.repairHoldSec) + 5);
    expect(player(m, fixer).repair).toBeNull();
    expect(m.state.sabotage?.kind).toBe("lights");
  });

  it("reactor needs both stations held simultaneously", () => {
    const m = smallMatch();
    const [left, right] = crewIds(m) as [string, string];
    const hold = secondsToTicks(m.state.settings.repairHoldSec);
    sabotage(m, "reactor");
    place(m, left, station(m, "reactor_left"));
    place(m, right, station(m, "reactor_right"));

    // One side alone, however long: nothing.
    expectOk(act(m, left, { type: "START_REPAIR", stationId: "reactor_left" }));
    step(m, 2 * hold);
    expect(m.state.sabotage?.kind).toBe("reactor");
    // Taking turns: nothing either.
    expectOk(act(m, left, { type: "STOP_REPAIR" }));
    expectOk(act(m, right, { type: "START_REPAIR", stationId: "reactor_right" }));
    step(m, 2 * hold);
    expect(m.state.sabotage?.kind).toBe("reactor");
    expect(m.state.sabotage?.stations.every((s) => !s.fixed)).toBe(true);

    // Both at once for the hold time: fixed.
    expectOk(act(m, left, { type: "START_REPAIR", stationId: "reactor_left" }));
    let steps = 0;
    while (m.state.sabotage && steps < 3 * hold) {
      m.step();
      steps++;
    }
    expect(m.state.sabotage).toBeNull();
    expect(steps).toBeGreaterThanOrEqual(hold);
    expect(steps).toBeLessThanOrEqual(hold + 1);
    const fixed = eventsOf(m, "SABOTAGE_FIXED");
    expect(fixed).toHaveLength(1);
    expect([...fixed[0]!.fixerIds].sort()).toEqual([left, right].sort());
    expect(player(m, left).repair).toBeNull();
    expect(player(m, right).repair).toBeNull();
    expect(m.state.phase).toBe("playing");
  });

  it("oxygen stations are fixed independently", () => {
    const m = smallMatch();
    const [a, b] = crewIds(m) as [string, string];
    const hold = secondsToTicks(m.state.settings.repairHoldSec);
    sabotage(m, "oxygen");

    place(m, a, station(m, "oxygen_life"));
    expectOk(act(m, a, { type: "START_REPAIR", stationId: "oxygen_life" }));
    step(m, hold);
    expect(eventsOf(m, "SABOTAGE_STATION_FIXED")).toEqual([expect.objectContaining({ kind: "oxygen", stationId: "oxygen_life", playerIds: [a] })]);
    expect(m.state.sabotage?.kind).toBe("oxygen");
    expect(m.observe(a).sabotage?.stations).toEqual([
      expect.objectContaining({ stationId: "oxygen_life", fixed: true }),
      expect.objectContaining({ stationId: "oxygen_hydro", fixed: false }),
    ]);
    expect(player(m, a).repair).toBeNull();
    expect(act(m, a, { type: "START_REPAIR", stationId: "oxygen_life" })).toEqual({ ok: false, reason: "task_done" });

    // Much later, and nobody at the first station any more: the second station completes the fix.
    step(m, 3 * hold);
    place(m, b, station(m, "oxygen_hydro"));
    expectOk(act(m, b, { type: "START_REPAIR", stationId: "oxygen_hydro" }));
    step(m, hold);
    expect(m.state.sabotage).toBeNull();
    expect([...eventsOf(m, "SABOTAGE_FIXED")[0]!.fixerIds].sort()).toEqual([a, b].sort());
  });

  it("critical sabotage timeout makes the infiltrators win (critical_sabotage)", () => {
    for (const kind of ["reactor", "oxygen"] as const) {
      const m = smallMatch({ criticalSabotageSec: 10 });
      sabotage(m, kind);
      const deadline = m.state.sabotage!.deadlineTick!;
      expect(deadline).toBe(m.tick + secondsToTicks(10));
      expect(m.observe(crewIds(m)[0]!).sabotage?.deadlineTick).toBe(deadline);
      step(m, deadline - m.tick - 1);
      expect(m.state.phase, kind).toBe("playing");
      m.step();
      expect(m.state.phase, kind).toBe("ended");
      expect(m.state.outcome).toMatchObject({ winner: "infiltrators", reason: "critical_sabotage", tick: deadline });
      expect(eventsOf(m, "MATCH_ENDED")).toEqual([expect.objectContaining({ winner: "infiltrators", reason: "critical_sabotage" })]);
      expect(eventsOf(m, "SABOTAGE_CLEARED")).toEqual([expect.objectContaining({ kind, reason: "match_end" })]);
    }
  });

  it("lights and comms have no deadline", () => {
    for (const kind of ["lights", "comms"] as const) {
      const m = smallMatch({ criticalSabotageSec: 10 });
      sabotage(m, kind);
      expect(m.state.sabotage!.deadlineTick).toBeNull();
      step(m, secondsToTicks(15));
      expect(m.state.phase, kind).toBe("playing");
    }
  });

  it("comms sabotage hides global task progress until fixed", () => {
    const m = smallMatch();
    const [crew] = crewIds(m) as [string];
    expect(m.observe(crew).taskProgress).not.toBeNull();
    sabotage(m, "comms");
    expect(m.observe(crew).taskProgress).toBeNull();
    place(m, crew, station(m, "comms_dish"));
    expectOk(act(m, crew, { type: "START_REPAIR", stationId: "comms_dish" }));
    step(m, secondsToTicks(m.state.settings.repairHoldSec));
    expect(m.state.sabotage).toBeNull();
    expect(m.observe(crew).taskProgress).toEqual(m.state.taskProgress);
  });

  it("only one sabotage at a time, and the cooldown is respected", () => {
    const m = smallMatch({ sabotageCooldownSec: 10 });
    const [inf] = infiltratorIds(m) as [string];
    const [crew] = crewIds(m) as [string];
    // Initial cooldown.
    const initial = m.state.sabotageReadyAtTick;
    expect(initial).toBeGreaterThan(0);
    expect(act(m, inf, { type: "SABOTAGE", kind: "lights" })).toEqual({ ok: false, reason: "cooldown" });
    expect(m.observe(inf).legal.sabotage).toEqual([]);
    step(m, initial);
    expect(m.observe(inf).legal.sabotage).toEqual(["lights", "reactor", "oxygen", "comms"]);
    expectOk(act(m, inf, { type: "SABOTAGE", kind: "lights" }));
    for (const kind of ["lights", "reactor", "oxygen", "comms"] as const) {
      expect(act(m, inf, { type: "SABOTAGE", kind }), kind).toEqual({ ok: false, reason: "sabotage_active" });
    }
    expect(act(m, crew, { type: "SABOTAGE", kind: "reactor" })).toEqual({ ok: false, reason: "wrong_role" });
    expect(eventsOf(m, "SABOTAGE_STARTED")).toHaveLength(1);

    place(m, crew, station(m, "lights_panel"));
    expectOk(act(m, crew, { type: "START_REPAIR", stationId: "lights_panel" }));
    step(m, secondsToTicks(m.state.settings.repairHoldSec));
    expect(m.state.sabotage).toBeNull();
    const cooldown = secondsToTicks(10);
    expect(m.state.sabotageReadyAtTick).toBe(m.tick + cooldown);
    expect(act(m, inf, { type: "SABOTAGE", kind: "comms" })).toEqual({ ok: false, reason: "cooldown" });
    step(m, cooldown - 1);
    expect(act(m, inf, { type: "SABOTAGE", kind: "comms" })).toEqual({ ok: false, reason: "cooldown" });
    step(m, 1);
    expectOk(act(m, inf, { type: "SABOTAGE", kind: "comms" }));
  });

  it("a meeting clears the active sabotage (critical countdown included)", () => {
    const m = newMatch({ criticalSabotageSec: 10, meeting: { revealSec: 0, statementsSec: 1, discussionSec: 0, finalStatementsSec: 0, votingSec: 5, resultSec: 0 } });
    const [inf] = infiltratorIds(m) as [string];
    const [victim, reporter, holder] = crewIds(m) as [string, string, string];
    scatter(m, [inf, victim, reporter]);
    sabotage(m, "reactor");
    const deadline = m.state.sabotage!.deadlineTick!;
    place(m, holder, station(m, "reactor_left"));
    expectOk(act(m, holder, { type: "START_REPAIR", stationId: "reactor_left" }));

    const kill = killNow(m, inf, victim, COMMONS);
    place(m, reporter, { x: COMMONS.x - 2, y: COMMONS.y });
    const since = lastSeq(m);
    const meetingTick = m.tick;
    expectOk(act(m, reporter, { type: "REPORT_BODY", bodyId: kill.bodyId }));
    expect(m.state.sabotage).toBeNull();
    expect(player(m, holder).repair).toBeNull();
    expect(eventsOf(m, "SABOTAGE_CLEARED", since)).toEqual([expect.objectContaining({ kind: "reactor", reason: "meeting" })]);
    expect(m.observe(reporter).sabotage).toBeNull();

    stepUntilPlaying(m);
    step(m, Math.max(0, deadline - m.tick) + 30);
    expect(m.state.phase).toBe("playing");
    expect(m.state.outcome).toBeNull();
    // The sabotage cooldown restarted when the sabotage was cleared.
    expect(m.state.sabotageReadyAtTick).toBe(meetingTick + secondsToTicks(m.state.settings.sabotageCooldownSec));
  });

  it("an emergency meeting clears lights", () => {
    const m = smallMatch();
    sabotage(m, "lights");
    callEmergency(m, crewIds(m)[0]!);
    expect(m.state.sabotage).toBeNull();
    expect(eventsOf(m, "SABOTAGE_CLEARED")).toEqual([expect.objectContaining({ kind: "lights", reason: "meeting" })]);
  });
});

import { describe, expect, it } from "vitest";
import { secondsToTicks } from "@deduction/shared";
import type { GameState, Match } from "@deduction/engine";
import { validateReport } from "../src/rules/report";
import {
  act,
  BUTTON,
  COMMONS,
  crewIds,
  eventsOf,
  expectOk,
  FAST_MEETING,
  infiltratorIds,
  killNow,
  newMatch,
  place,
  player,
  scatter,
  smallMatch,
  step,
  stepToMeetingPhase,
  stepUntilPlaying,
} from "./helpers";

/** Everyone still alive votes skip, then the meeting runs out. */
function finishMeeting(m: Match): void {
  stepToMeetingPhase(m, "voting");
  for (const id of m.state.meeting!.participants) expectOk(act(m, id, { type: "VOTE", target: "skip" }), "VOTE");
  stepUntilPlaying(m);
}

describe("report", () => {
  it("dead player cannot report", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const [victim, other] = crewIds(m) as [string, string];
    scatter(m, [inf, victim, other]);
    const kill = killNow(m, inf, victim, COMMONS);
    killNow(m, inf, other, { x: COMMONS.x, y: COMMONS.y + 2 });
    // The first victim's ghost stands right next to both bodies.
    place(m, victim, { x: COMMONS.x - 1, y: COMMONS.y + 1 });
    expect(act(m, victim, { type: "REPORT_BODY", bodyId: kill.bodyId })).toEqual({ ok: false, reason: "dead" });
    expect(m.observe(victim).legal.report).toEqual([]);
    expect(m.state.phase).toBe("playing");
    expect(m.state.bodies.every((b) => !b.reported)).toBe(true);
  });

  it("dead player cannot call an emergency meeting", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const [victim] = crewIds(m) as [string];
    killNow(m, inf, victim, COMMONS);
    place(m, victim, BUTTON);
    m.state.emergencyReadyAtTick = m.tick;
    expect(act(m, victim, { type: "CALL_EMERGENCY" })).toEqual({ ok: false, reason: "dead" });
    expect(m.observe(victim).legal.emergency).toBe(false);
    expect(m.state.phase).toBe("playing");
  });

  it("a living player in range reports a body and starts a meeting", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const [victim, reporter] = crewIds(m) as [string, string];
    scatter(m, [inf, victim, reporter]);
    const kill = killNow(m, inf, victim, COMMONS);
    place(m, reporter, { x: COMMONS.x - 3, y: COMMONS.y }); // 3 > 2.5
    expect(act(m, reporter, { type: "REPORT_BODY", bodyId: kill.bodyId })).toEqual({ ok: false, reason: "out_of_range" });
    place(m, reporter, { x: COMMONS.x - 2.4, y: COMMONS.y });
    expect(m.observe(reporter).legal.report).toEqual([kill.bodyId]);
    expectOk(act(m, reporter, { type: "REPORT_BODY", bodyId: kill.bodyId }));
    expect(m.state.phase).toBe("meeting");
    expect(m.state.meeting).toMatchObject({ reason: "body", callerId: reporter, victimId: victim, bodyRoomId: "commons" });
  });

  it("body can only be reported once", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const [victim, r1, r2] = crewIds(m) as [string, string, string];
    scatter(m, [inf, victim, r1, r2]);
    const kill = killNow(m, inf, victim, COMMONS);
    place(m, r1, { x: COMMONS.x - 2, y: COMMONS.y });
    place(m, r2, { x: COMMONS.x, y: COMMONS.y - 2 });

    expectOk(act(m, r1, { type: "REPORT_BODY", bodyId: kill.bodyId }));
    expect(act(m, r2, { type: "REPORT_BODY", bodyId: kill.bodyId }).ok).toBe(false);
    expect(act(m, r1, { type: "REPORT_BODY", bodyId: kill.bodyId }).ok).toBe(false);
    expect(eventsOf(m, "BODY_REPORTED")).toHaveLength(1);
    expect(eventsOf(m, "MEETING_STARTED")).toHaveLength(1);

    // Pure validator on the reported body (a copy of the state put back into the playing phase).
    const copy = structuredClone(m.state) as GameState;
    copy.phase = "playing";
    copy.meeting = null;
    const reporter2 = copy.players.find((p) => p.id === r2)!;
    expect(copy.bodies.find((b) => b.id === kill.bodyId)?.reported).toBe(true);
    expect(validateReport(copy, m.map, reporter2, kill.bodyId)).toEqual({ ok: false, reason: "already_reported" });
    // ...while an unreported body in the same situation would be accepted.
    copy.bodies.find((b) => b.id === kill.bodyId)!.reported = false;
    expect(validateReport(copy, m.map, reporter2, kill.bodyId)).toEqual({ ok: true });

    // After the meeting the body is gone for good.
    finishMeeting(m);
    expect(m.state.bodies).toEqual([]);
    place(m, r2, { x: COMMONS.x, y: COMMONS.y - 2 });
    expect(act(m, r2, { type: "REPORT_BODY", bodyId: kill.bodyId })).toEqual({ ok: false, reason: "invalid_target" });
  });
});

describe("emergency meeting", () => {
  it("requires the button range", () => {
    const m = newMatch();
    const [a] = crewIds(m) as [string];
    m.state.emergencyReadyAtTick = 0;
    const range = m.state.settings.useRange;
    place(m, a, { x: BUTTON.x + range + 0.1, y: BUTTON.y });
    expect(act(m, a, { type: "CALL_EMERGENCY" })).toEqual({ ok: false, reason: "out_of_range" });
    expect(m.observe(a).legal.emergency).toBe(false);
    place(m, a, { x: BUTTON.x + range - 0.1, y: BUTTON.y });
    expect(m.observe(a).legal.emergency).toBe(true);
    expectOk(act(m, a, { type: "CALL_EMERGENCY" }));
    expect(m.state.meeting).toMatchObject({ reason: "emergency", callerId: a, victimId: null });
    expect(eventsOf(m, "EMERGENCY_CALLED")).toEqual([expect.objectContaining({ callerId: a })]);
  });

  it("obeys the initial cooldown, the cooldown after a meeting, and the per-player limit", () => {
    const m = smallMatch({ meeting: FAST_MEETING });
    const [a, b] = crewIds(m) as [string, string];
    const cooldown = secondsToTicks(m.state.settings.emergencyCooldownSec);
    expect(m.state.settings.emergencyMeetingsPerPlayer).toBe(1);

    place(m, a, BUTTON);
    expect(act(m, a, { type: "CALL_EMERGENCY" })).toEqual({ ok: false, reason: "cooldown" });
    step(m, cooldown - 1);
    expect(act(m, a, { type: "CALL_EMERGENCY" })).toEqual({ ok: false, reason: "cooldown" });
    step(m, 1);
    expectOk(act(m, a, { type: "CALL_EMERGENCY" }));
    expect(player(m, a).emergencyMeetingsLeft).toBe(0);
    finishMeeting(m);
    const endTick = m.tick;
    expect(m.state.emergencyReadyAtTick).toBe(endTick + cooldown);

    // Another player right after the meeting: cooldown.
    place(m, b, BUTTON);
    expect(act(m, b, { type: "CALL_EMERGENCY" })).toEqual({ ok: false, reason: "cooldown" });
    step(m, cooldown);
    // The first caller has used up their meeting; the other player still has one.
    place(m, a, BUTTON);
    expect(act(m, a, { type: "CALL_EMERGENCY" })).toEqual({ ok: false, reason: "no_meetings_left" });
    expect(m.observe(a).self.emergencyMeetingsLeft).toBe(0);
    expectOk(act(m, b, { type: "CALL_EMERGENCY" }));
  });

  it("is blocked during a critical sabotage (but not during lights)", () => {
    for (const kind of ["reactor", "oxygen", "lights", "comms"] as const) {
      const m = newMatch();
      const [inf] = infiltratorIds(m) as [string];
      const [a] = crewIds(m) as [string];
      m.state.sabotageReadyAtTick = 0;
      m.state.emergencyReadyAtTick = 0;
      expectOk(act(m, inf, { type: "SABOTAGE", kind }));
      place(m, a, BUTTON);
      const critical = kind === "reactor" || kind === "oxygen";
      expect(act(m, a, { type: "CALL_EMERGENCY" }), kind).toEqual(critical ? { ok: false, reason: "sabotage_active" } : { ok: true });
    }
  });
});

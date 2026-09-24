import { describe, expect, it } from "vitest";
import { deriveRng, dist, type GameEventType, type PlayerId, type Vec2 } from "@deduction/shared";
import { canSeePoint, checkInvariants, createInitialState, eventStreamDigest, Match, type GameState, type PlayerState } from "@deduction/engine";
import { mutateAnswer, taskPhases, taskView } from "@deduction/tasks";
import { crewIds, FAST_MEETING, infiltratorIds, solve } from "./helpers";

/**
 * A deterministic scripted match: crew walk to their stations and solve tasks (one of them answers wrong at first),
 * one infiltrator hunts, the other sabotages and travels through vents, crew report bodies, fix sabotage, talk and
 * vote. Only real actions and move intents are used (no state mutation), so two runs with the same seed must agree.
 */
function runScript(seed: number, onTick?: (m: Match) => void, maxTicks = 3_600): Match {
  const m = new Match({
    settings: { seed, playerCount: 8, infiltratorCount: 2, tasksPerPlayer: 3, meeting: FAST_MEETING, sabotageCooldownSec: 10, criticalSabotageSec: 30 },
    recordEvents: true,
  });
  const s = m.state.settings;
  const crew = crewIds(m);
  const [hunter, saboteur] = infiltratorIds(m) as [PlayerId, PlayerId];
  const P = (id: PlayerId): PlayerState => m.state.players.find((p) => p.id === id)!;
  const goTo = (id: PlayerId, target: Vec2) => m.setMoveIntent(id, { mode: "path", target });
  let saboteurStage = 0;
  const wrongRng = deriveRng(seed, "script-wrong");

  const doTasks = (p: PlayerState, wrongFirst: boolean) => {
    if (p.taskSession) {
      const session = p.taskSession;
      if (session.phases[session.phaseIndex]?.kind !== "answer") return;
      const record = m.state.tasks[session.taskId]!;
      const views = taskPhases(record.instance).map((ph) => taskView(record.instance, ph.kind));
      const correct = solve(record.instance.kind, views);
      const answer = wrongFirst && record.attempts === 1 ? mutateAnswer(correct, views.at(-1)!.answerFormat!, wrongRng) : correct;
      m.submitAction(p.id, { type: "SUBMIT_TASK_ANSWER", taskId: session.taskId, answer });
      return;
    }
    const next = p.taskIds.map((id) => m.state.tasks[id]!).find((t) => !t.done);
    if (!next) return;
    const pos = m.map.taskStationById.get(next.stationId)!.pos;
    if (dist(p.pos, pos) <= s.useRange) m.submitAction(p.id, { type: "START_TASK", taskId: next.id });
    else goTo(p.id, pos);
  };

  const drivePlaying = () => {
    const sab = m.state.sabotage;
    crew.forEach((id, i) => {
      const p = P(id);
      if (p.alive) {
        // Walk up to any body in sight and report it.
        const body = m.state.bodies.find((b) => !b.reported && canSeePoint(m.state, m.map, p, b.pos));
        if (body) {
          if (dist(body.pos, p.pos) > s.reportRange - 0.5) goTo(id, body.pos);
          else m.submitAction(id, { type: "REPORT_BODY", bodyId: body.id });
          return;
        }
        // One crew member calls an emergency meeting later on.
        if (i === 4 && m.tick >= 1_300 && p.emergencyMeetingsLeft > 0) {
          const button = m.map.def.emergencyButton.pos;
          if (dist(p.pos, button) <= s.useRange) m.submitAction(id, { type: "CALL_EMERGENCY" });
          else goTo(id, button);
          return;
        }
        // Designated fixers handle sabotage.
        if (sab && (i === 1 || i === 2)) {
          const stations = sab.stations.filter((st) => !st.fixed);
          const st = stations[(i - 1) % stations.length];
          if (st) {
            const pos = m.map.sabotageStationById.get(st.stationId)!.pos;
            if (p.repair?.stationId === st.stationId) return;
            if (dist(p.pos, pos) <= s.useRange) m.submitAction(id, { type: "START_REPAIR", stationId: st.stationId });
            else goTo(id, pos);
            return;
          }
        }
        if (m.tick === 200 + i * 7) m.submitAction(id, { type: "SPEAK", text: `crew ${id} checking in` });
      }
      doTasks(p, i === 0);
    });

    // Hunter: chase the nearest living crew member once the kill is ready, otherwise fake tasks.
    const h = P(hunter);
    if (h.alive) {
      if (m.tick >= h.killReadyAtTick) {
        const targets = crew.map(P).filter((c) => c.alive);
        targets.sort((a, b) => dist(a.pos, h.pos) - dist(b.pos, h.pos));
        const target = targets[0];
        if (target) {
          if (dist(target.pos, h.pos) <= s.killRange) m.submitAction(hunter, { type: "KILL", targetId: target.id });
          else goTo(hunter, target.pos);
        }
      } else doTasks(h, false);
    }

    // Saboteur: lights -> vent trip -> reactor -> fake tasks.
    const sb = P(saboteur);
    if (!sb.alive) return;
    const vent = m.map.ventById.get("vent_commons")!;
    switch (saboteurStage) {
      case 0:
        if (m.submitAction(saboteur, { type: "SABOTAGE", kind: "lights" }).ok) saboteurStage = 1;
        else doTasks(sb, false);
        break;
      case 1:
        if (dist(sb.pos, vent.pos) <= s.useRange && m.submitAction(saboteur, { type: "ENTER_VENT", ventId: vent.id }).ok) saboteurStage = 2;
        else goTo(saboteur, vent.pos);
        break;
      case 2:
        if (sb.ventId === null) saboteurStage = 4; // pulled out by a meeting
        else if (m.submitAction(saboteur, { type: "MOVE_VENT", toVentId: m.map.ventLinks.get(sb.ventId ?? vent.id)![0]! }).ok) saboteurStage = 3;
        break;
      case 3:
        if (sb.ventId === null || m.submitAction(saboteur, { type: "EXIT_VENT" }).ok) saboteurStage = 4;
        break;
      case 4:
        if (m.state.sabotage === null && m.tick >= m.state.sabotageReadyAtTick) {
          if (m.submitAction(saboteur, { type: "SABOTAGE", kind: "reactor" }).ok) saboteurStage = 5;
        } else doTasks(sb, false);
        break;
      default:
        doTasks(sb, false);
    }
  };

  const driveMeeting = () => {
    const meeting = m.state.meeting!;
    if (meeting.phase === "statements" && meeting.messages.length === 0) {
      m.submitAction(meeting.callerId, { type: "SPEAK", text: meeting.reason === "body" ? "I found a body." : "Emergency!" });
    }
    if (meeting.phase !== "voting") return;
    for (const id of meeting.participants) {
      if (meeting.votes[id] !== undefined) continue;
      // Crew vote out the hunter after a body report; everyone else skips.
      const target = meeting.reason === "body" && crew.includes(id) && P(hunter).alive ? hunter : "skip";
      m.submitAction(id, { type: "VOTE", target });
    }
  };

  for (let t = 0; t < maxTicks && m.state.phase !== "ended"; t++) {
    if (m.state.phase === "playing") drivePlaying();
    else if (m.state.phase === "meeting") driveMeeting();
    m.step();
    for (const p of m.state.players) m.observe(p.id); // drain inboxes like a real runner would
    onTick?.(m);
  }
  return m;
}

const count = (m: Match, type: GameEventType): number => m.log.filter((e) => e.type === type).length;

describe("determinism", () => {
  it("two matches with the same seed and the same scripted actions produce identical event streams", () => {
    const a = runScript(7);
    const b = runScript(7);
    expect(a.log.length).toBeGreaterThan(100);
    expect(eventStreamDigest(a.log)).toBe(eventStreamDigest(b.log));
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    // A different seed diverges.
    expect(eventStreamDigest(runScript(8).log)).not.toBe(eventStreamDigest(a.log));
  });

  it("setup (roles, task instances, spawn) depends only on the seed", () => {
    const summary = (m: Match) =>
      m.state.players.map((p) => ({
        id: p.id,
        role: p.role,
        pos: p.pos,
        roomId: p.roomId,
        tasks: p.taskIds.map((t) => ({ t, stationId: m.state.tasks[t]!.stationId, data: m.state.tasks[t]!.instance.data })),
      }));
    const a = new Match({ settings: { seed: 42 }, matchId: "a", recordEvents: true });
    // Same seed, different match id and different non-setup rules.
    const b = new Match({
      settings: { seed: 42, killCooldownSec: 60, crewVision: 5, playerSpeed: 6, meeting: FAST_MEETING, confirmEjects: false, sabotageCooldownSec: 60 },
      matchId: "b",
      recordEvents: true,
    });
    expect(summary(b)).toEqual(summary(a));
    expect(eventStreamDigest(b.log)).toBe(eventStreamDigest(a.log));
    // createInitialState is a pure function of (settings, map, matchId).
    expect(createInitialState(a.state.settings, a.map, "x")).toEqual(createInitialState(a.state.settings, a.map, "x"));

    // Other seeds give other setups.
    expect(summary(new Match({ settings: { seed: 43 } }))).not.toEqual(summary(a));
    const roleSets = new Set(
      Array.from({ length: 12 }, (_, seed) => JSON.stringify(new Match({ settings: { seed } }).state.players.map((p) => p.role))),
    );
    expect(roleSets.size).toBeGreaterThan(3);
  });
});

describe("invariants", () => {
  it("checkInvariants returns [] across a scripted scenario", () => {
    const violations: string[] = [];
    const m = runScript(7, (match) => violations.push(...checkInvariants(match.state, match.map)));
    expect(violations).toEqual([]);
    // The scenario exercised the interesting rules.
    for (const type of ["PLAYER_KILLED", "BODY_REPORTED", "MEETING_STARTED", "VOTES_REVEALED", "PLAYER_COMPLETED_TASK", "PLAYER_FAILED_TASK", "SABOTAGE_STARTED", "VENT_ENTERED", "VENT_MOVED", "VENT_EXITED", "PLAYER_SPOKE", "MEETING_MESSAGE", "EMERGENCY_CALLED", "PLAYER_EJECTED"] as const) {
      expect(count(m, type), type).toBeGreaterThan(0);
    }
  });

  it("checkInvariants returns violations for deliberately corrupted states", () => {
    const m = new Match({ settings: { seed: 3, playerCount: 5, infiltratorCount: 1, tasksPerPlayer: 2 } });
    const pristine = structuredClone(m.state) as GameState;
    expect(checkInvariants(pristine, m.map)).toEqual([]);

    const crewOf = (s: GameState) => s.players.find((p) => p.role === "crew")!;
    const infOf = (s: GameState) => s.players.find((p) => p.role === "infiltrator")!;
    const corruptions: [string, RegExp, (s: GameState) => void][] = [
      ["player inside a wall", /inside a wall/, (s) => (crewOf(s).pos = { x: 0.5, y: 0.5 })],
      ["non-finite position", /non-finite position/, (s) => (crewOf(s).pos = { x: Number.NaN, y: 3 })],
      ["progress mismatch", /progress 2 != completed crew tasks 0/, (s) => (s.taskProgress.completed = 2)],
      ["progress total mismatch", /progress total/, (s) => (s.taskProgress.total += 1)],
      ["alive with a death cause", /alive with deathCause/, (s) => (crewOf(s).deathCause = "killed")],
      [
        "dead without death info",
        /dead without death info/,
        (s) => {
          crewOf(s).alive = false;
        },
      ],
      ["crew in a vent", /not a living infiltrator/, (s) => (crewOf(s).ventId = "vent_commons")],
      ["infiltrator in a vent at the wrong spot", /not at its position/, (s) => (infOf(s).ventId = "vent_commons")],
      ["phase/meeting mismatch", /phase meeting but meeting=null/, (s) => (s.phase = "meeting")],
      ["ended without outcome", /phase ended but outcome=null/, (s) => (s.phase = "ended")],
      [
        "body of a living player",
        /was not killed/,
        (s) => {
          const victim = crewOf(s);
          s.bodies.push({ id: "body-x", victimId: victim.id, killerId: infOf(s).id, pos: victim.pos, roomId: victim.roomId, tick: 0, witnesses: [], seenBy: [], reported: false });
        },
      ],
      [
        "parity while still playing",
        /infiltrator parity/,
        (s) => {
          for (const p of s.players.filter((x) => x.role === "crew").slice(0, 3)) {
            p.alive = false;
            p.deathCause = "killed";
            p.deathTick = 0;
          }
        },
      ],
      [
        "working on someone else's task",
        /does not own/,
        (s) => {
          const other = s.players.find((p) => p.id !== crewOf(s).id)!;
          crewOf(s).taskSession = { taskId: other.taskIds[0]!, stationId: "x", phases: [], startedTick: 0, attempt: 1, phaseIndex: 0, phaseStartedTick: 0 };
        },
      ],
    ];
    for (const [name, pattern, corrupt] of corruptions) {
      const s = structuredClone(m.state) as GameState;
      corrupt(s);
      const violations = checkInvariants(s, m.map);
      expect(violations.length, name).toBeGreaterThan(0);
      expect(violations.some((v) => pattern.test(v)), `${name}: ${violations.join("; ")}`).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import { dist, type TaskView, type Vec2 } from "@deduction/shared";
import { canSeePlayer, visionRadius } from "@deduction/engine";
import { solveFromViews } from "@deduction/tasks";
import {
  act,
  allKeys,
  COMMONS,
  completeTask,
  crewIds,
  expectOk,
  findMatchWithTask,
  infiltratorIds,
  killNow,
  newMatch,
  perceived,
  place,
  player,
  scatter,
  solve,
  stationOf,
  step,
  stepToPerception,
  stepUntil,
} from "./helpers";

/** Keys of authoritative state that must never reach an observation. */
const SECRET_KEYS = [
  "killerId",
  "saboteurId",
  "countsForProgress",
  "witnesses",
  "seenBy",
  "hearers",
  "instance",
  "data",
  "roles",
  "killReadyAtTick",
  "moveIntent",
  "route",
  "deathCause",
  "fixedBy",
];

describe("observation secrecy", () => {
  it("agent observation does not contain secret state (crew observer)", () => {
    const m = newMatch();
    const [killer, saboteur] = infiltratorIds(m) as [string, string];
    const [observer, victim, worker] = crewIds(m) as [string, string, string];
    scatter(m);

    // Things that happen out of the observer's sight: a kill and a crew task completion.
    killNow(m, killer, victim, COMMONS);
    expectOk(completeTask(m, worker, player(m, worker).taskIds[0]!), "crew task");
    // Things that happen in plain sight: the saboteur fakes a task right next to the observer, then sabotages comms.
    const fakeTask = player(m, saboteur).taskIds[0]!;
    const station = stationOf(m, fakeTask).pos;
    place(m, observer, { x: station.x, y: station.y });
    expectOk(completeTask(m, saboteur, fakeTask), "fake task");
    m.state.sabotageReadyAtTick = m.tick;
    expectOk(act(m, saboteur, { type: "SABOTAGE", kind: "lights" }));
    stepToPerception(m);

    const obs = m.observe(observer);
    // The observer did perceive things (so the checks below are meaningful).
    expect(perceived(obs.events, "SAW_TASK_STOP").some((e) => e.playerId === saboteur)).toBe(true);
    expect(perceived(obs.events, "SABOTAGE_STARTED")).toHaveLength(1);
    expect(obs.visiblePlayers.map((v) => v.id)).toContain(saboteur);

    const json = JSON.stringify(obs);
    const keys = new Set(allKeys(obs));
    for (const k of SECRET_KEYS) expect(keys.has(k), `observation leaks key ${k}`).toBe(false);
    // The only role in the observation is the observer's own.
    expect(allKeys(obs).filter((k) => k === "role")).toHaveLength(1);
    expect(obs.self.role).toBe("crew");
    for (const r of obs.roster) expect(r.knownRole, `role of ${r.id}`).toBe(r.id === observer ? "crew" : null);
    expect(obs.teammates).toEqual([]);

    // Unwitnessed death: still "alive" for this observer.
    expect(obs.roster.find((r) => r.id === victim)?.knownStatus).toBe("alive");
    expect(obs.visibleBodies).toEqual([]);

    // No other player's task ids, and no task instance data at all (own tasks included).
    for (const p of m.state.players) {
      if (p.id === observer) continue;
      for (const t of p.taskIds) expect(json.includes(`"${t}"`), `leaks task id ${t}`).toBe(false);
    }
    for (const record of Object.values(m.state.tasks)) {
      expect(json.includes(JSON.stringify(record.instance.data)), `leaks instance data of ${record.id}`).toBe(false);
    }
    expect(obs.tasks.map((t) => t.taskId)).toEqual(player(m, observer).taskIds);

    // Crew legal actions contain nothing infiltrator-only.
    expect(obs.legal.kill).toEqual([]);
    expect(obs.legal.sabotage).toEqual([]);
    expect(obs.legal.ventEnter).toBeNull();
    expect(obs.self.killCooldownTicks).toBeNull();
    expect(obs.self.sabotageCooldownTicks).toBeNull();
  });

  it("a kill witness learns the killer; nobody else does", () => {
    const m = newMatch();
    const [killer] = infiltratorIds(m) as [string];
    const [witness, victim, bystander] = crewIds(m) as [string, string, string];
    scatter(m, [witness]);
    place(m, witness, { x: COMMONS.x - 4, y: COMMONS.y });
    killNow(m, killer, victim, COMMONS);

    const wObs = m.observe(witness);
    const sawKill = perceived(wObs.events, "SAW_KILL");
    expect(sawKill).toHaveLength(1);
    expect(sawKill[0]).toMatchObject({ killerId: killer, victimId: victim });
    expect(wObs.roster.find((r) => r.id === victim)?.knownStatus).toBe("dead");
    // Seeing the kill does not reveal the killer's role in the roster.
    expect(wObs.roster.find((r) => r.id === killer)?.knownRole).toBeNull();

    const bObs = m.observe(bystander);
    expect(JSON.stringify(bObs).includes("killerId")).toBe(false);
    expect(bObs.roster.find((r) => r.id === victim)?.knownStatus).toBe("alive");
    // The victim learns who killed them.
    expect(perceived(m.observe(victim).events, "WAS_KILLED")[0]?.killerId).toBe(killer);
  });

  it("an infiltrator observer sees its teammates' roles (and nothing about crew roles)", () => {
    const m = newMatch();
    const [inf, mate] = infiltratorIds(m) as [string, string];
    const obs = m.observe(inf);
    expect(obs.self.role).toBe("infiltrator");
    expect(obs.teammates).toEqual([mate]);
    for (const r of obs.roster) {
      const expected = r.id === inf || r.id === mate ? "infiltrator" : null;
      expect(r.knownRole, r.id).toBe(expected);
    }
    // Fake tasks are presented exactly like real ones (no counts-for-progress flag).
    expect(obs.tasks.length).toBe(m.state.settings.tasksPerPlayer);
    expect(new Set(allKeys(obs)).has("countsForProgress")).toBe(false);
  });

  it("memory task answer view does not leak the answer", () => {
    for (const kind of ["sequence_recall", "working_memory"] as const) {
      const { match: m, playerId, taskId } = findMatchWithTask([kind], "crew");
      scatter(m, [playerId]);
      place(m, playerId, stationOf(m, taskId).pos);
      expectOk(act(m, playerId, { type: "START_TASK", taskId }));

      const observeView = m.observe(playerId).activeTask?.view;
      expect(observeView?.phase, kind).toBe("observe");
      const secretKeys = kind === "sequence_recall" ? ["digits"] : ["lit", "grid"];
      const secrets = secretKeys.map((k) => JSON.stringify(observeView!.content[k]));
      for (const s of secrets) expect(s, `${kind} observe view shows the data`).toMatch(/^\[/);

      const views: TaskView[] = [observeView!];
      stepUntil(m, () => m.observe(playerId, false).activeTask?.phase === "delay", 500);
      views.push(m.observe(playerId).activeTask!.view);
      stepUntil(m, () => m.observe(playerId, false).activeTask?.phase === "answer", 500);
      const answerObs = m.observe(playerId);
      const answerView = answerObs.activeTask!.view;
      views.push(answerView);

      for (const later of [views[1]!, answerView]) {
        for (const k of secretKeys) expect(Object.keys(later.content), `${kind} ${later.phase}`).not.toContain(k);
        for (const s of secrets) expect(JSON.stringify(later).includes(s), `${kind} ${later.phase} leaks ${s}`).toBe(false);
      }
      // Nothing else in the answer-phase observation carries the data either.
      const obsJson = JSON.stringify(answerObs);
      for (const s of secrets) expect(obsJson.includes(s), `${kind} observation leaks ${s}`).toBe(false);
      if (kind === "sequence_recall") {
        const digits = (observeView!.content["digits"] as string[]).join("");
        expect(obsJson.includes(digits)).toBe(false);
      }
      // The answer is not derivable from the post-observe views, only from the full sequence.
      expect(solveFromViews(kind, [answerView])).toBeNull();
      expect(solveFromViews(kind, [views[1]!, answerView])).toBeNull();
      const answer = solve(kind, views);
      expectOk(act(m, playerId, { type: "SUBMIT_TASK_ANSWER", taskId, answer }));
      expect(m.state.tasks[taskId]!.done).toBe(true);
    }
  });
});

describe("perception", () => {
  it("PLAYER_LEFT_VISIBILITY reports the observer's LAST sighting position, and PLAYER_BECAME_VISIBLE when it comes back", () => {
    const m = newMatch();
    const [obsId, targetId] = crewIds(m) as [string, string];
    scatter(m, [obsId, targetId]);
    place(m, obsId, { x: 41.5, y: 34.5 });
    place(m, targetId, { x: 45.5, y: 34.5 });
    stepToPerception(m);
    m.observe(obsId);
    const O = player(m, obsId);
    const T = player(m, targetId);
    const vision = visionRadius(m.state, O);

    // Walk the target east, out of sight. Record where the observer last saw it at a visibility update.
    m.setMoveIntent(targetId, { mode: "direction", dir: { x: 1, y: 0 } });
    let lastSeen: Vec2 | null = null;
    stepUntil(
      m,
      () => {
        if (m.tick % 3 === 0 && canSeePlayer(m.state, m.map, O, T)) lastSeen = { ...T.pos };
        return dist(O.pos, T.pos) > vision + 4;
      },
      300,
    );
    step(m, 30); // keep walking out of sight: the last-known location must not follow
    m.setMoveIntent(targetId, { mode: "stop" });
    stepToPerception(m);

    const events = m.observe(obsId).events;
    const left = perceived(events, "PLAYER_LEFT_VISIBILITY").filter((e) => e.playerId === targetId);
    expect(left).toHaveLength(1);
    expect(lastSeen).not.toBeNull();
    expect(left[0]!.lastPos).toEqual(lastSeen);
    expect(dist(left[0]!.lastPos, O.pos)).toBeLessThanOrEqual(vision);
    expect(dist(left[0]!.lastPos, T.pos)).toBeGreaterThan(3);
    expect(left[0]!.heading).toBe("east");
    // Nothing else about the unseen target reached the observer (no room changes, no positions).
    expect(events.filter((e) => "playerId" in e && e.playerId === targetId && e.type !== "PLAYER_LEFT_VISIBILITY")).toEqual([]);
    expect(m.observe(obsId).visiblePlayers.map((v) => v.id)).not.toContain(targetId);

    // Walk back into sight.
    m.setMoveIntent(targetId, { mode: "direction", dir: { x: -1, y: 0 } });
    stepUntil(m, () => m.tick % 3 === 0 && canSeePlayer(m.state, m.map, O, T), 300);
    const back = perceived(m.observe(obsId).events, "PLAYER_BECAME_VISIBLE").filter((e) => e.playerId === targetId);
    expect(back).toHaveLength(1);
    expect(back[0]!.pos).toEqual(T.pos);
    expect(back[0]!.roomId).toBe(T.roomId);
  });

  it("PLAYER_LEFT_VISIBILITY never reveals where an unseen target went (teleport case)", () => {
    const m = newMatch();
    const [obsId, targetId] = crewIds(m) as [string, string];
    scatter(m, [obsId, targetId]);
    place(m, obsId, { x: 41.5, y: 34.5 });
    const seenAt = { x: 44.5, y: 34.5 };
    place(m, targetId, seenAt);
    stepToPerception(m);
    m.observe(obsId);
    place(m, targetId, { x: 6.5, y: 60.5 }); // Electrical, far away
    stepToPerception(m);
    const left = perceived(m.observe(obsId).events, "PLAYER_LEFT_VISIBILITY").filter((e) => e.playerId === targetId);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ lastPos: seenAt, roomId: "commons", heading: null });
  });

  it("deaths are not leaked: a far crew member sees the victim alive until the body is seen or a meeting announces it", () => {
    const m = newMatch();
    const [killer] = infiltratorIds(m) as [string];
    const [victim, far, finder] = crewIds(m) as [string, string, string];
    scatter(m);
    const kill = killNow(m, killer, victim, COMMONS);
    step(m, 30);

    const statusFor = (who: string) => m.observe(who, false).roster.find((r) => r.id === victim)?.knownStatus;
    const farObs = m.observe(far);
    expect(farObs.roster.find((r) => r.id === victim)?.knownStatus).toBe("alive");
    expect(farObs.visibleBodies).toEqual([]);
    expect(farObs.events.some((e) => e.type === "SAW_KILL" || e.type === "SAW_BODY" || e.type === "WAS_KILLED")).toBe(false);
    expect(statusFor(finder)).toBe("alive");

    // The finder walks into the Commons and sees the body.
    place(m, finder, { x: COMMONS.x - 5, y: COMMONS.y });
    stepToPerception(m);
    const finderObs = m.observe(finder);
    expect(perceived(finderObs.events, "SAW_BODY").map((e) => e.victimId)).toEqual([victim]);
    expect(finderObs.visibleBodies.map((b) => b.bodyId)).toEqual([kill.bodyId]);
    expect(statusFor(finder)).toBe("dead");
    expect(statusFor(far)).toBe("alive");

    // Reporting starts a meeting, which announces the death to everyone.
    place(m, finder, { x: COMMONS.x - 2, y: COMMONS.y });
    expectOk(act(m, finder, { type: "REPORT_BODY", bodyId: kill.bodyId }));
    const started = perceived(m.observe(far).events, "MEETING_STARTED");
    expect(started).toHaveLength(1);
    expect(started[0]!.deadSinceLastMeeting).toEqual([victim]);
    expect(statusFor(far)).toBe("dead");
  });

  // Body ids are sequential, so a probe for "body-1" from across the map must look exactly like a probe for a
  // nonexistent body: rejection reasons must not leak unwitnessed deaths.
  it("REPORT_BODY rejection reasons do not reveal an unseen body", () => {
    const m = newMatch();
    const [killer] = infiltratorIds(m) as [string];
    const [victim, far] = crewIds(m) as [string, string];
    scatter(m);
    killNow(m, killer, victim, COMMONS);
    expect(m.observe(far).visibleBodies).toEqual([]);
    const existing = act(m, far, { type: "REPORT_BODY", bodyId: "body-1" });
    const missing = act(m, far, { type: "REPORT_BODY", bodyId: "body-2" });
    expect(existing).toEqual(missing);
  });
});

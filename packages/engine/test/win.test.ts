import { describe, expect, it } from "vitest";
import type { PlayerAction } from "@deduction/shared";
import { checkWin, type GameState, type Match } from "@deduction/engine";
import {
  act,
  armKill,
  BUTTON,
  callEmergency,
  COMMONS,
  completeTask,
  crewIds,
  eventsOf,
  expectOk,
  infiltratorIds,
  killNow,
  newMatch,
  place,
  player,
  smallMatch,
  stepToMeetingPhase,
  stepUntil,
} from "./helpers";

function expectEnded(m: Match, winner: string, reason: string): void {
  expect(m.state.phase).toBe("ended");
  expect(m.state.outcome).toMatchObject({ winner, reason, tick: m.tick });
  expect(m.state.meeting).toBeNull();
  expect(m.state.sabotage).toBeNull();
  const ended = eventsOf(m, "MATCH_ENDED");
  expect(ended).toEqual([expect.objectContaining({ winner, reason })]);
  // The end reveals every role.
  expect(ended[0]!.roles).toEqual(Object.fromEntries(m.state.players.map((p) => [p.id, p.role])));
  for (const p of m.state.players) {
    const obs = m.observe(p.id);
    expect(obs.phase).toBe("ended");
    expect(obs.outcome).toEqual({ winner, reason });
    expect(obs.roster.every((r) => r.knownRole === player(m, r.id).role)).toBe(true);
  }
}

describe("win conditions", () => {
  it("crew wins when all infiltrators are eliminated (ejected)", () => {
    const m = smallMatch();
    const [inf] = infiltratorIds(m) as [string];
    const crew = crewIds(m);
    callEmergency(m, crew[0]!);
    stepToMeetingPhase(m, "voting");
    for (const id of crew) expectOk(act(m, id, { type: "VOTE", target: inf }));
    expectOk(act(m, inf, { type: "VOTE", target: "skip" }));
    stepToMeetingPhase(m, "result");
    expect(player(m, inf).deathCause).toBe("ejected");
    expect(m.state.phase).toBe("meeting"); // the result is shown before the match ends
    stepUntil(m, () => m.state.phase !== "meeting", 1_000);
    expectEnded(m, "crew", "all_infiltrators_ejected");
  });

  it("crew wins through task completion (every crew task through the real task path)", () => {
    const m = newMatch({ playerCount: 4, infiltratorCount: 1, tasksPerPlayer: 1 });
    const crew = crewIds(m);
    expect(m.state.taskProgress).toEqual({ completed: 0, total: crew.length });
    // The infiltrator's fake task changes nothing.
    const [inf] = infiltratorIds(m) as [string];
    expectOk(completeTask(m, inf, player(m, inf).taskIds[0]!), "fake task");
    expect(m.state.taskProgress.completed).toBe(0);

    crew.forEach((id, i) => {
      expect(m.state.phase).toBe("playing");
      expect(completeTask(m, id, player(m, id).taskIds[0]!)).toEqual({ ok: true });
      expect(m.state.taskProgress.completed).toBe(i + 1);
    });
    expectEnded(m, "crew", "tasks_completed");
  });

  it("a crew ghost's tasks still count toward the task win", () => {
    const m = newMatch({ playerCount: 5, infiltratorCount: 1, tasksPerPlayer: 1 });
    const [inf] = infiltratorIds(m) as [string];
    const crew = crewIds(m);
    killNow(m, inf, crew[0]!, COMMONS);
    expect(player(m, crew[0]!).alive).toBe(false);
    for (const id of crew) expect(completeTask(m, id, player(m, id).taskIds[0]!)).toEqual({ ok: true });
    expectEnded(m, "crew", "tasks_completed");
  });

  it("infiltrators win at parity (small match, kills)", () => {
    const m = newMatch({ playerCount: 4, infiltratorCount: 1, tasksPerPlayer: 1 });
    const [inf] = infiltratorIds(m) as [string];
    const [c1, c2] = crewIds(m) as [string, string];
    killNow(m, inf, c1, COMMONS);
    expect(m.state.phase).toBe("playing"); // 1 infiltrator vs 2 crew
    killNow(m, inf, c2, { x: COMMONS.x, y: COMMONS.y + 3 });
    expectEnded(m, "infiltrators", "infiltrator_parity");
  });

  it("no actions are accepted after the match ended", () => {
    const m = newMatch({ playerCount: 4, infiltratorCount: 1, tasksPerPlayer: 1 });
    const [inf] = infiltratorIds(m) as [string];
    const [c1, c2, c3] = crewIds(m) as [string, string, string];
    killNow(m, inf, c1, COMMONS);
    const lastKill = killNow(m, inf, c2, { x: COMMONS.x, y: COMMONS.y + 3 });
    expect(m.state.phase).toBe("ended");

    const tick = m.tick;
    const stateBefore = JSON.stringify(m.state);
    place(m, c3, BUTTON);
    armKill(m, inf);
    const attempts: [string, PlayerAction][] = [
      [inf, { type: "KILL", targetId: c3 }],
      [c3, { type: "REPORT_BODY", bodyId: lastKill.bodyId }],
      [c3, { type: "CALL_EMERGENCY" }],
      [c3, { type: "START_TASK", taskId: player(m, c3).taskIds[0]! }],
      [c3, { type: "SUBMIT_TASK_ANSWER", taskId: player(m, c3).taskIds[0]!, answer: 1 }],
      [c3, { type: "CANCEL_TASK" }],
      [inf, { type: "SABOTAGE", kind: "reactor" }],
      [inf, { type: "ENTER_VENT", ventId: "vent_commons" }],
      [inf, { type: "MOVE_VENT", toVentId: "vent_cargo" }],
      [inf, { type: "EXIT_VENT" }],
      [c3, { type: "START_REPAIR", stationId: "reactor_left" }],
      [c3, { type: "STOP_REPAIR" }],
      [c3, { type: "SPEAK", text: "hello?" }],
      [c3, { type: "VOTE", target: "skip" }],
    ];
    for (const [who, action] of attempts) expect(act(m, who, action).ok, action.type).toBe(false);

    m.setMoveIntent(c3, { mode: "direction", dir: { x: 1, y: 0 } });
    for (let i = 0; i < 10; i++) m.step();
    expect(m.tick).toBe(tick);
    expect(player(m, c3).moveIntent).toEqual({ mode: "stop" });
    expect(player(m, c3).pos).toEqual(BUTTON);
    expect(player(m, c3).alive).toBe(true);
    expect(eventsOf(m, "MATCH_ENDED")).toHaveLength(1);
    const legal = m.observe(c3).legal;
    expect(legal).toMatchObject({ move: false, startTask: [], report: [], kill: [], emergency: false, sabotage: [], repair: [], speak: false, vote: [] });
    // Apart from the setup teleport above, only rejections were recorded.
    const after = JSON.parse(JSON.stringify(m.state)) as GameState;
    const before = JSON.parse(stateBefore) as GameState;
    expect(after.outcome).toEqual(before.outcome);
    expect(after.bodies).toEqual(before.bodies);
    expect(after.taskProgress).toEqual(before.taskProgress);
  });
});

describe("checkWin (pure)", () => {
  function state(mutate: (s: GameState) => void): GameState {
    const m = newMatch({ playerCount: 5, infiltratorCount: 1, tasksPerPlayer: 1 });
    const s = structuredClone(m.state) as GameState;
    mutate(s);
    return s;
  }
  const kill = (s: GameState, n: number, role: "crew" | "infiltrator") =>
    s.players.filter((p) => p.role === role && p.alive).slice(0, n).forEach((p) => (p.alive = false));

  it("returns null while nothing is decided", () => {
    expect(checkWin(state(() => {}))).toBeNull();
    expect(checkWin(state((s) => kill(s, 2, "crew")))).toBeNull(); // 1 vs 2
    expect(checkWin(state((s) => (s.taskProgress.completed = s.taskProgress.total - 1)))).toBeNull();
  });

  it("all infiltrators dead -> crew", () => {
    expect(checkWin(state((s) => kill(s, 1, "infiltrator")))).toEqual({ winner: "crew", reason: "all_infiltrators_ejected" });
  });

  it("all crew tasks done -> crew", () => {
    expect(checkWin(state((s) => (s.taskProgress.completed = s.taskProgress.total)))).toEqual({ winner: "crew", reason: "tasks_completed" });
  });

  it("parity -> infiltrators", () => {
    expect(checkWin(state((s) => kill(s, 3, "crew")))).toEqual({ winner: "infiltrators", reason: "infiltrator_parity" });
    expect(checkWin(state((s) => kill(s, 4, "crew")))).toEqual({ winner: "infiltrators", reason: "infiltrator_parity" });
  });

  it("precedence: eliminating the infiltrators beats tasks and parity; tasks beat parity", () => {
    const allDead = state((s) => {
      kill(s, 1, "infiltrator");
      kill(s, 4, "crew");
      s.taskProgress.completed = s.taskProgress.total;
    });
    expect(checkWin(allDead)).toEqual({ winner: "crew", reason: "all_infiltrators_ejected" });
    const tasksAndParity = state((s) => {
      kill(s, 3, "crew");
      s.taskProgress.completed = s.taskProgress.total;
    });
    expect(checkWin(tasksAndParity)).toEqual({ winner: "crew", reason: "tasks_completed" });
  });

  it("a match without crew tasks is never won by tasks", () => {
    expect(checkWin(state((s) => (s.taskProgress = { completed: 0, total: 0 })))).toBeNull();
  });
});

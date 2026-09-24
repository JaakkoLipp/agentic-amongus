import { describe, expect, it } from "vitest";
import { deriveRng, secondsToTicks, type Vec2 } from "@deduction/shared";
import { boxFits } from "@deduction/maps";
import type { Match } from "@deduction/engine";
import { checkTaskAnswer, mutateAnswer } from "@deduction/tasks";
import {
  act,
  completeTask,
  crewIds,
  eventsOf,
  expectOk,
  findMatchWithTask,
  infiltratorIds,
  lastSeq,
  newMatch,
  perceived,
  place,
  player,
  runTaskToAnswer,
  scatter,
  solve,
  stationOf,
  step,
  stepUntil,
} from "./helpers";

function spotAtDistance(m: Match, center: Vec2, d: number): Vec2 {
  for (let k = 0; k < 64; k++) {
    const a = (2 * Math.PI * k) / 64;
    const p = { x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d };
    if (boxFits(m.map, p)) return p;
  }
  throw new Error("no free spot at that distance");
}

function crewTask(m: Match): { crew: string; taskId: string } {
  const crew = crewIds(m)[0]!;
  return { crew, taskId: player(m, crew).taskIds[0]! };
}

describe("tasks", () => {
  it("task validator accepts a correct answer (crew progress +1)", () => {
    const m = newMatch();
    const { crew, taskId } = crewTask(m);
    const since = lastSeq(m);
    expect(m.state.taskProgress.completed).toBe(0);

    expect(completeTask(m, crew, taskId)).toEqual({ ok: true });
    const record = m.state.tasks[taskId]!;
    expect(record.done).toBe(true);
    expect(record.completedTick).toBe(m.tick);
    expect(m.state.taskProgress.completed).toBe(1);
    expect(eventsOf(m, "PLAYER_COMPLETED_TASK", since)).toEqual([
      expect.objectContaining({ playerId: crew, taskId, countsForProgress: true, attempts: 1 }),
    ]);
    expect(eventsOf(m, "TASK_PROGRESS", since)).toEqual([expect.objectContaining({ completed: 1, total: m.state.taskProgress.total })]);

    const obs = m.observe(crew);
    expect(perceived(obs.events, "OWN_TASK_RESULT")).toEqual([expect.objectContaining({ taskId, result: "completed" })]);
    expect(perceived(obs.events, "TASK_PROGRESS").at(-1)).toMatchObject({ completed: 1 });
    expect(obs.tasks.find((t) => t.taskId === taskId)?.done).toBe(true);
    expect(obs.activeTask).toBeNull();
    expect(obs.taskProgress?.completed).toBe(1);
    // A finished task cannot be started again.
    expect(act(m, crew, { type: "START_TASK", taskId })).toEqual({ ok: false, reason: "task_done" });
  });

  it("task validator rejects an incorrect answer (task stays open, PLAYER_FAILED_TASK, can restart)", () => {
    const m = newMatch();
    const { crew, taskId } = crewTask(m);
    const record = m.state.tasks[taskId]!;
    const kind = record.instance.kind;

    const views = runTaskToAnswer(m, crew, taskId);
    const correct = solve(kind, views);
    const wrong = mutateAnswer(correct, views.at(-1)!.answerFormat!, deriveRng(3, "wrong-answer"));
    expect(checkTaskAnswer(record.instance, wrong)).toEqual({ ok: true, correct: false });
    const since = lastSeq(m);
    expect(act(m, crew, { type: "SUBMIT_TASK_ANSWER", taskId, answer: wrong })).toEqual({ ok: true });

    expect(record.done).toBe(false);
    expect(m.state.taskProgress.completed).toBe(0);
    expect(player(m, crew).taskSession).toBeNull();
    expect(eventsOf(m, "PLAYER_FAILED_TASK", since)).toEqual([expect.objectContaining({ playerId: crew, taskId, reason: "wrong_answer" })]);
    expect(eventsOf(m, "PLAYER_COMPLETED_TASK", since)).toEqual([]);
    expect(eventsOf(m, "TASK_PROGRESS", since)).toEqual([]);
    const obs = m.observe(crew);
    expect(perceived(obs.events, "OWN_TASK_RESULT")).toEqual([expect.objectContaining({ taskId, result: "wrong_answer" })]);
    expect(obs.legal.startTask).toContain(taskId);

    // Restart: a fresh attempt (memory tasks replay their observe phase), then the correct answer completes it.
    const views2 = runTaskToAnswer(m, crew, taskId);
    expect(m.observe(crew, false).activeTask?.attempt).toBe(2);
    expect(views2.map((v) => v.phase)).toEqual(views.map((v) => v.phase));
    expect(act(m, crew, { type: "SUBMIT_TASK_ANSWER", taskId, answer: solve(kind, views2) })).toEqual({ ok: true });
    expect(record.done).toBe(true);
    expect(record.attempts).toBe(2);
    expect(m.state.taskProgress.completed).toBe(1);
  });

  it("malformed answers are handled without throwing", () => {
    const m = newMatch();
    const { crew, taskId } = crewTask(m);
    const circular: Record<string, unknown> = { a: 1 };
    circular["self"] = circular;
    const payloads: unknown[] = [
      undefined,
      null,
      {},
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "x".repeat(100_000),
      [[["deep"]]],
      { answer: { nested: [1, 2, 3] } },
      circular,
      Symbol("answer"),
      () => 42,
      new Date(0),
    ];
    for (const answer of payloads) {
      runTaskToAnswer(m, crew, taskId);
      const since = lastSeq(m);
      let result: unknown;
      expect(() => {
        result = act(m, crew, { type: "SUBMIT_TASK_ANSWER", taskId, answer });
      }, String(typeof answer)).not.toThrow();
      expect(result).toEqual({ ok: true });
      expect(eventsOf(m, "PLAYER_FAILED_TASK", since)).toEqual([expect.objectContaining({ taskId, reason: "malformed" })]);
      expect(m.state.tasks[taskId]!.done).toBe(false);
      expect(player(m, crew).taskSession).toBeNull();
    }
    expect(m.state.taskProgress.completed).toBe(0);
    // Without a session the answer is rejected outright.
    expect(act(m, crew, { type: "SUBMIT_TASK_ANSWER", taskId, answer: 1 })).toEqual({ ok: false, reason: "unknown_task" });
    // The event log stays serializable.
    expect(() => JSON.stringify(m.log)).not.toThrow();
  });

  it("fake task (infiltrator) does not increase crew progress", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const taskId = player(m, inf).taskIds[0]!;
    const since = lastSeq(m);
    expect(m.state.tasks[taskId]!.countsForProgress).toBe(false);
    expect(completeTask(m, inf, taskId)).toEqual({ ok: true });
    expect(m.state.tasks[taskId]!.done).toBe(true);
    expect(m.state.taskProgress.completed).toBe(0);
    expect(eventsOf(m, "PLAYER_COMPLETED_TASK", since)).toEqual([expect.objectContaining({ playerId: inf, countsForProgress: false })]);
    expect(eventsOf(m, "TASK_PROGRESS", since)).toEqual([]);
    // To its owner it looks like any other completed task.
    const obs = m.observe(inf);
    expect(perceived(obs.events, "OWN_TASK_RESULT")).toEqual([expect.objectContaining({ taskId, result: "completed" })]);
    expect(obs.taskProgress).toEqual({ completed: 0, total: m.state.taskProgress.total });
  });

  it("moving cancels a task session", () => {
    const m = newMatch();
    const { crew, taskId } = crewTask(m);
    const station = stationOf(m, taskId);
    runTaskToAnswer(m, crew, taskId);
    expect(player(m, crew).taskSession).not.toBeNull();
    const since = lastSeq(m);
    const roomCenter = m.map.areaById.get(m.map.taskStationById.get(station.stationId)!.roomId)!.center;
    m.setMoveIntent(crew, { mode: "path", target: roomCenter });
    step(m, 2);
    expect(player(m, crew).pos).not.toEqual(station.pos);
    expect(player(m, crew).taskSession).toBeNull();
    expect(eventsOf(m, "PLAYER_CANCELLED_TASK", since)).toEqual([expect.objectContaining({ playerId: crew, taskId })]);
    expect(m.state.tasks[taskId]!.done).toBe(false);
    expect(m.observe(crew).activeTask).toBeNull();
    expect(act(m, crew, { type: "SUBMIT_TASK_ANSWER", taskId, answer: 1 })).toEqual({ ok: false, reason: "unknown_task" });
  });

  it("task cannot be started out of range (or someone else's task)", () => {
    const m = newMatch();
    const { crew, taskId } = crewTask(m);
    const station = stationOf(m, taskId).pos;
    const range = m.state.settings.useRange;
    place(m, crew, spotAtDistance(m, station, range + 0.3));
    expect(m.observe(crew).legal.startTask).not.toContain(taskId);
    expect(act(m, crew, { type: "START_TASK", taskId })).toEqual({ ok: false, reason: "out_of_range" });
    expect(player(m, crew).taskSession).toBeNull();

    const otherTask = player(m, crewIds(m)[1]!).taskIds[0]!;
    place(m, crew, stationOf(m, otherTask).pos);
    expect(act(m, crew, { type: "START_TASK", taskId: otherTask })).toEqual({ ok: false, reason: "unknown_task" });

    place(m, crew, spotAtDistance(m, station, range - 0.3));
    expect(m.observe(crew).legal.startTask).toContain(taskId);
    expectOk(act(m, crew, { type: "START_TASK", taskId }));
    expect(act(m, crew, { type: "START_TASK", taskId })).toEqual({ ok: false, reason: "busy" });
  });

  it("an answer phase left open times out (PLAYER_FAILED_TASK timeout)", () => {
    const m = newMatch({ taskAnswerTimeoutSec: 5 });
    const { crew, taskId } = crewTask(m);
    runTaskToAnswer(m, crew, taskId);
    const answerStarted = player(m, crew).taskSession!.phaseStartedTick;
    const since = lastSeq(m);
    stepUntil(m, () => player(m, crew).taskSession === null, 1_000);
    expect(m.tick - answerStarted).toBe(secondsToTicks(5));
    expect(eventsOf(m, "PLAYER_FAILED_TASK", since)).toEqual([expect.objectContaining({ taskId, reason: "timeout" })]);
    expect(perceived(m.observe(crew).events, "OWN_TASK_RESULT")).toEqual([expect.objectContaining({ taskId, result: "timeout" })]);
    expect(m.state.tasks[taskId]!.done).toBe(false);
  });

  it("answer cannot be submitted before the answer phase", () => {
    const { match: m, playerId, taskId } = findMatchWithTask(["sequence_recall", "working_memory"], "crew");
    scatter(m, [playerId]);
    place(m, playerId, stationOf(m, taskId).pos);
    expectOk(act(m, playerId, { type: "START_TASK", taskId }));
    const views = [m.observe(playerId).activeTask!.view];
    expect(views[0]!.phase).toBe("observe");
    const answer = solve(stationOf(m, taskId).kind, views);

    expect(m.observe(playerId, false).legal.submitAnswer).toBeNull();
    expect(act(m, playerId, { type: "SUBMIT_TASK_ANSWER", taskId, answer })).toEqual({ ok: false, reason: "wrong_phase" });
    stepUntil(m, () => m.observe(playerId, false).activeTask?.phase === "delay", 500);
    expect(act(m, playerId, { type: "SUBMIT_TASK_ANSWER", taskId, answer })).toEqual({ ok: false, reason: "wrong_phase" });
    // The rejected early answers did not end the session.
    expect(player(m, playerId).taskSession).not.toBeNull();
    stepUntil(m, () => m.observe(playerId, false).activeTask?.phase === "answer", 500);
    expect(m.observe(playerId, false).legal.submitAnswer).toBe(taskId);
    expect(act(m, playerId, { type: "SUBMIT_TASK_ANSWER", taskId: "not-my-task", answer })).toEqual({ ok: false, reason: "unknown_task" });
    expect(act(m, playerId, { type: "SUBMIT_TASK_ANSWER", taskId, answer })).toEqual({ ok: true });
    expect(m.state.tasks[taskId]!.done).toBe(true);
  });
});

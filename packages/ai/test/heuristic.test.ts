import { describe, expect, it } from "vitest";
import { deriveRng, resolveGameSettings, type DecisionRequest, type PlayerId } from "@deduction/shared";
import type { Match } from "@deduction/engine";
import { ARCHETYPES, HeuristicController, type AgentContext, type Personality } from "@deduction/ai";
import { crewIds, infiltratorIds, memoryFor, newMatch, place, scatter, seconds, step } from "./helpers";

const request = (kind: DecisionRequest["kind"]): DecisionRequest => ({ kind, revision: 0, tick: 0, triggers: ["heartbeat"] });

function controllerFor(match: Match, id: PlayerId, traits: Personality) {
  const memory = memoryFor(match, id, traits);
  const ctx: AgentContext = {
    playerId: id,
    memory,
    personality: { archetype: "analyst", traits },
    map: match.map,
    settings: resolveGameSettings(match.state.settings),
    difficulty: "normal",
    memoryQuality: 1,
    rng: deriveRng(1, "test", id),
  };
  return { memory, controller: new HeuristicController(ctx) };
}

function startVoting(match: Match): void {
  const caller = crewIds(match)[2]!;
  place(match, caller, match.map.def.emergencyButton.pos);
  match.state.emergencyReadyAtTick = 0;
  expect(match.submitAction(caller, { type: "CALL_EMERGENCY" })).toEqual({ ok: true });
  for (let i = 0; i < seconds(10) && match.state.meeting?.phase !== "voting"; i++) match.step();
  expect(match.state.meeting?.phase).toBe("voting");
}

describe("heuristic controller", () => {
  it("personality changes behaviour: the same evidence gets an impulsive vote but a cautious skip", () => {
    const match = newMatch({ meeting: { revealSec: 0, statementsSec: 0, discussionSec: 0, finalStatementsSec: 0, votingSec: 30, resultSec: 0 } });
    const [voter, suspect] = crewIds(match) as [string, string];
    startVoting(match);
    const obs = match.observe(voter, false);
    const decisions = [ARCHETYPES.impulsive.traits, ARCHETYPES.cautious.traits].map((traits) => {
      const { memory, controller } = controllerFor(match, voter, traits);
      memory.update(obs);
      memory.belief(suspect)!.suspicion = 0.55;
      return controller.decideSync(obs, request("vote"));
    });
    expect(decisions[0]).toMatchObject({ kind: "vote", target: suspect });
    expect(decisions[1]).toMatchObject({ kind: "vote", target: "skip" });
  });

  it("a crew member who sees a body reports it", () => {
    const match = newMatch();
    scatter(match);
    const killer = infiltratorIds(match)[0]!;
    const [victim, finder] = crewIds(match) as [string, string];
    place(match, killer, { x: 46, y: 35 });
    place(match, victim, { x: 47, y: 35 });
    match.state.players.find((p) => p.id === killer)!.killReadyAtTick = 0;
    match.submitAction(killer, { type: "KILL", targetId: victim });
    place(match, killer, { x: 8, y: 8 });
    place(match, finder, { x: 50, y: 37 });
    step(match, 3);
    const { memory, controller } = controllerFor(match, finder, ARCHETYPES.rookie.traits);
    const obs = match.observe(finder);
    memory.update(obs);
    const d = controller.decideSync(obs, request("roam"));
    expect(d).toMatchObject({ kind: "roam", goal: { type: "REPORT_BODY" } });
  });

  it("an infiltrator with a ready kill strikes an isolated target", () => {
    const match = newMatch();
    scatter(match);
    const killer = infiltratorIds(match)[0]!;
    const target = crewIds(match)[0]!;
    place(match, killer, { x: 10, y: 60 });
    place(match, target, { x: 11, y: 60 });
    match.state.players.find((p) => p.id === killer)!.killReadyAtTick = 0;
    step(match, 3);
    const { memory, controller } = controllerFor(match, killer, ARCHETYPES.impulsive.traits);
    const obs = match.observe(killer);
    memory.update(obs);
    const d = controller.decideSync(obs, request("roam"));
    // Kill outright or hunt (the hunt executor strikes as soon as nobody is watching) — both go for the lone target.
    expect(d.kind === "roam" && ["KILL", "HUNT"].includes(d.goal.type)).toBe(true);
    if (d.kind === "roam" && d.goal.type === "KILL") expect(d.goal.playerId).toBe(target);
  });

  it("answers memory tasks only from the views it was shown", () => {
    const hasRecall = (m: Match) => m.state.players.find((p) => p.role === "crew" && p.taskIds.some((id) => m.state.tasks[id]!.instance.kind === "sequence_recall"));
    let match = newMatch({ taskDifficulty: 1 });
    for (let seed = 1; !hasRecall(match); seed++) match = newMatch({ seed, taskDifficulty: 1 });
    const crew = hasRecall(match)!;
    const taskId = crew.taskIds.find((id) => match.state.tasks[id]!.instance.kind === "sequence_recall")!;
    const station = match.map.taskStationById.get(match.state.tasks[taskId]!.stationId)!;
    place(match, crew.id, station.pos);
    const { memory, controller } = controllerFor(match, crew.id, ARCHETYPES.analyst.traits);
    expect(match.submitAction(crew.id, { type: "START_TASK", taskId })).toEqual({ ok: true });
    for (let i = 0; i < seconds(6); i++) {
      memory.update(match.observe(crew.id));
      if (match.observe(crew.id, false).activeTask?.phase === "answer") break;
      match.step();
    }
    const obs = match.observe(crew.id);
    memory.update(obs);
    expect(memory.taskViewsFor(taskId).map((v) => v.phase)).toEqual(["observe", "delay", "answer"]);
    const d = controller.decideSync(obs, request("task_answer"));
    expect(d.kind === "task_answer" && Array.isArray(d.answer) && d.answer.length === 4).toBe(true);
    expect(d.kind === "task_answer" && d.thinkTicks > 0).toBe(true);
  });
});

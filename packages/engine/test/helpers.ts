import {
  type ActionResult,
  type GameEvent,
  type GameEventOf,
  type GameEventType,
  type GameSettingsInput,
  type MeetingPhase,
  type MeetingTiming,
  type PerceivedEvent,
  type PerceivedEventOf,
  type PerceivedEventType,
  type PlayerAction,
  type PlayerId,
  type TaskAnswer,
  type TaskKind,
  type TaskView,
  type Vec2,
} from "@deduction/shared";
import { areaAt, boxFits } from "@deduction/maps";
import { Match, PERCEPTION_INTERVAL_TICKS, type PlayerState } from "@deduction/engine";
import { solveFromViews } from "@deduction/tasks";

/** Meeting timings that keep meeting tests fast (voting has a 5 s schema minimum). */
export const FAST_MEETING: MeetingTiming = {
  revealSec: 0,
  statementsSec: 1,
  discussionSec: 0,
  finalStatementsSec: 0,
  votingSec: 5,
  resultSec: 0,
};

/** Commons floor points that are open (no furniture) and in mutual line of sight. */
export const COMMONS = { x: 46.5, y: 35.5 } as const;
export const BUTTON: Vec2 = { x: 50, y: 35 };

export function newMatch(settings: GameSettingsInput = {}): Match {
  return new Match({ settings: { seed: 1, ...settings }, recordEvents: true });
}

/** Small match (1 infiltrator) with fast meetings. */
export function smallMatch(settings: GameSettingsInput = {}): Match {
  return newMatch({ playerCount: 5, infiltratorCount: 1, tasksPerPlayer: 2, meeting: FAST_MEETING, ...settings });
}

export function player(match: Match, id: PlayerId): PlayerState {
  const p = match.state.players.find((x) => x.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

export const crewIds = (match: Match): PlayerId[] => match.state.players.filter((p) => p.role === "crew").map((p) => p.id);
export const infiltratorIds = (match: Match): PlayerId[] =>
  match.state.players.filter((p) => p.role === "infiltrator").map((p) => p.id);

/** Test SETUP only: teleport a player, keeping roomId consistent and clearing movement. */
export function place(match: Match, id: PlayerId, pos: Vec2): void {
  if (!boxFits(match.map, pos)) throw new Error(`test setup error: (${pos.x}, ${pos.y}) is not a free spot`);
  const p = player(match, id);
  p.pos = { x: pos.x, y: pos.y };
  p.roomId = areaAt(match.map, pos);
  p.route = null;
  p.moveIntent = { mode: "stop" };
  p.moving = false;
}

export function step(match: Match, ticks: number): void {
  for (let i = 0; i < ticks; i++) match.step();
}

/** Step until `pred` holds (checked before each step). Returns the number of steps taken. */
export function stepUntil(match: Match, pred: () => boolean, maxTicks = 20_000): number {
  for (let i = 0; i <= maxTicks; i++) {
    if (pred()) return i;
    match.step();
  }
  throw new Error(`condition not reached within ${maxTicks} ticks`);
}

/** Step (at least once) to the next tick on which visibility diffs are computed. */
export function stepToPerception(match: Match): void {
  do match.step();
  while (match.tick % PERCEPTION_INTERVAL_TICKS !== 0);
}

/**
 * Spots in different rooms, mutually out of sight and far (> 11 tiles) from the Commons, so tests control exactly
 * who can see whom.
 */
export const SCATTER_SPOTS: readonly Vec2[] = [
  { x: 34.5, y: 10.5 }, // security
  { x: 82.5, y: 6.5 }, // navigation
  { x: 8.5, y: 28.5 }, // engines
  { x: 93.5, y: 42.5 }, // life support
  { x: 82.5, y: 66.5 }, // infirmary
  { x: 38.5, y: 66.5 }, // cargo
  { x: 72.5, y: 60.5 }, // hydroponics
  { x: 60.5, y: 6.5 }, // comms
  { x: 20.5, y: 54.5 }, // electrical
  { x: 18.5, y: 6.5 }, // reactor
  { x: 93.5, y: 17.5 }, // navigation
  { x: 18.5, y: 42.5 }, // engines
];

/** Park everyone (except `keep`) in separate far-away rooms, then drain every inbox. */
export function scatter(match: Match, keep: readonly PlayerId[] = []): void {
  let i = 0;
  for (const p of match.state.players) {
    if (keep.includes(p.id)) continue;
    place(match, p.id, SCATTER_SPOTS[i++]!);
  }
  stepToPerception(match);
  drainAll(match);
}

export function drainAll(match: Match): void {
  for (const p of match.state.players) match.observe(p.id);
}

export function eventsOf<T extends GameEventType>(match: Match, type: T, sinceSeq = -1): GameEventOf<T>[] {
  return match.log.filter((e: GameEvent): e is GameEventOf<T> => e.type === type && e.seq > sinceSeq);
}

export const lastSeq = (match: Match): number => match.log[match.log.length - 1]?.seq ?? -1;

export function perceived<T extends PerceivedEventType>(events: readonly PerceivedEvent[], type: T): PerceivedEventOf<T>[] {
  return events.filter((e): e is PerceivedEventOf<T> => e.type === type);
}

export function expectOk(result: ActionResult, what = "action"): void {
  if (!result.ok) throw new Error(`${what} rejected: ${result.reason}`);
}

export function act(match: Match, id: PlayerId, action: PlayerAction): ActionResult {
  return match.submitAction(id, action);
}

/** Setup: make the infiltrator's kill available right now. */
export function armKill(match: Match, id: PlayerId): void {
  player(match, id).killReadyAtTick = match.tick;
}

/** Place killer next to victim (in the open Commons by default) and kill through the real action path. */
export function killNow(match: Match, killerId: PlayerId, victimId: PlayerId, at: Vec2 = COMMONS): GameEventOf<"PLAYER_KILLED"> {
  place(match, victimId, at);
  place(match, killerId, { x: at.x + 1, y: at.y });
  armKill(match, killerId);
  expectOk(match.submitAction(killerId, { type: "KILL", targetId: victimId }), "KILL");
  const ev = eventsOf(match, "PLAYER_KILLED").pop();
  if (!ev) throw new Error("no PLAYER_KILLED event");
  return ev;
}

// ---------------------------------------------------------------------------------------------------------------
// Tasks

export function stationOf(match: Match, taskId: string): { pos: Vec2; kind: TaskKind; stationId: string } {
  const record = match.state.tasks[taskId];
  if (!record) throw new Error(`no task ${taskId}`);
  const station = match.map.taskStationById.get(record.stationId);
  if (!station) throw new Error(`no station ${record.stationId}`);
  return { pos: station.pos, kind: record.instance.kind, stationId: station.id };
}

/** START_TASK at the station, then step until the answer phase. Returns the views shown, in phase order. */
export function runTaskToAnswer(match: Match, id: PlayerId, taskId: string): TaskView[] {
  place(match, id, stationOf(match, taskId).pos);
  expectOk(match.submitAction(id, { type: "START_TASK", taskId }), "START_TASK");
  const views: TaskView[] = [];
  let lastPhase = -1;
  for (let i = 0; i < 2_000; i++) {
    const active = match.observe(id, false).activeTask;
    if (!active) throw new Error("task session ended before the answer phase");
    if (active.phaseIndex !== lastPhase) {
      views.push(active.view);
      lastPhase = active.phaseIndex;
    }
    if (active.phase === "answer") return views;
    match.step();
  }
  throw new Error("answer phase never reached");
}

export function solve(kind: TaskKind, views: readonly TaskView[]): TaskAnswer {
  const answer = solveFromViews(kind, views);
  if (answer === null) throw new Error(`views do not solve ${kind}`);
  return answer;
}

/** Complete a task through the real action path (place at station, START_TASK, wait, submit the solved answer). */
export function completeTask(match: Match, id: PlayerId, taskId: string): ActionResult {
  const views = runTaskToAnswer(match, id, taskId);
  return match.submitAction(id, { type: "SUBMIT_TASK_ANSWER", taskId, answer: solve(stationOf(match, taskId).kind, views) });
}

/**
 * Find a (seeded, deterministic) match in which some player of the wanted role owns a task of one of `kinds`.
 * Roles and task lists depend only on the seed, so this is a stable search.
 */
export function findMatchWithTask(
  kinds: readonly TaskKind[],
  role: "crew" | "infiltrator",
  settings: GameSettingsInput = {},
): { match: Match; playerId: PlayerId; taskId: string } {
  for (let seed = 1; seed < 500; seed++) {
    const match = newMatch({ ...settings, seed });
    for (const p of match.state.players) {
      if (p.role !== role) continue;
      const taskId = p.taskIds.find((t) => kinds.includes(match.state.tasks[t]!.instance.kind));
      if (taskId) return { match, playerId: p.id, taskId };
    }
  }
  throw new Error(`no seed gives a ${role} a task of kind ${kinds.join("/")}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Meetings

/** Setup + real action: walk the caller onto the button, lift the global cooldown, CALL_EMERGENCY. */
export function callEmergency(match: Match, callerId: PlayerId): void {
  place(match, callerId, BUTTON);
  match.state.emergencyReadyAtTick = match.tick;
  expectOk(match.submitAction(callerId, { type: "CALL_EMERGENCY" }), "CALL_EMERGENCY");
}

export function stepToMeetingPhase(match: Match, phase: MeetingPhase, maxTicks = 20_000): void {
  stepUntil(match, () => match.state.meeting?.phase === phase, maxTicks);
}

export function stepUntilPlaying(match: Match, maxTicks = 20_000): void {
  stepUntil(match, () => match.state.phase !== "meeting", maxTicks);
}

/** Every key that appears anywhere in a JSON-like value. */
export function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...allKeys(v)]);
  return [];
}

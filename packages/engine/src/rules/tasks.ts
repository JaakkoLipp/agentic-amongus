import { dist, secondsToTicks, type ActionResult, type TaskId } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import { checkTaskAnswer, taskPhases } from "@deduction/tasks";
import { OK, reject, type EngineContext } from "../context";
import type { GameState, PlayerState, TaskRecord } from "../state";
import { witnessesOfPlayer } from "../vision";

/** Living players and crew ghosts do tasks. Dead infiltrators have nothing left to fake. */
export const canDoTasks = (p: PlayerState): boolean => p.alive || p.role === "crew";

export function stationPosOf(map: GameMap, record: TaskRecord) {
  const station = map.taskStationById.get(record.stationId);
  if (!station) throw new Error(`task ${record.id} references unknown station ${record.stationId}`);
  return station.pos;
}

export function validateStartTask(state: GameState, map: GameMap, p: PlayerState, taskId: TaskId): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (!canDoTasks(p)) return reject("dead");
  if (p.ventId !== null) return reject("in_vent");
  if (p.taskSession !== null || p.repair !== null) return reject("busy");
  const record = state.tasks[taskId];
  if (!record || record.ownerId !== p.id) return reject("unknown_task");
  if (record.done) return reject("task_done");
  if (dist(p.pos, stationPosOf(map, record)) > state.settings.useRange) return reject("out_of_range");
  return OK;
}

export function startTask(ctx: EngineContext, p: PlayerState, taskId: TaskId): void {
  const record = ctx.state.tasks[taskId]!;
  record.attempts++;
  p.moveIntent = { mode: "stop" };
  p.route = null;
  p.taskSession = {
    taskId,
    stationId: record.stationId,
    phases: taskPhases(record.instance),
    startedTick: ctx.state.tick,
    attempt: record.attempts,
    phaseIndex: 0,
    phaseStartedTick: ctx.state.tick,
  };
  ctx.emit({
    type: "PLAYER_STARTED_TASK",
    playerId: p.id,
    taskId,
    kind: record.instance.kind,
    stationId: record.stationId,
    witnesses: witnessesOfPlayer(ctx.state, ctx.map, p),
  });
}

export function cancelTask(ctx: EngineContext, p: PlayerState): void {
  const session = p.taskSession;
  if (!session) return;
  p.taskSession = null;
  ctx.emit({ type: "PLAYER_CANCELLED_TASK", playerId: p.id, taskId: session.taskId, stationId: session.stationId, witnesses: witnessesOfPlayer(ctx.state, ctx.map, p) });
}

export function validateSubmitAnswer(state: GameState, p: PlayerState, taskId: TaskId): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  const session = p.taskSession;
  if (!session || session.taskId !== taskId) return reject("unknown_task");
  if (session.phases[session.phaseIndex]?.kind !== "answer") return reject("wrong_phase");
  return OK;
}

/**
 * The single answer path for humans and agents. Malformed and wrong answers both end the session (the task stays
 * open and can be restarted, which replays any observe phase). A correct fake task never moves crew progress.
 */
export function submitAnswer(ctx: EngineContext, p: PlayerState, taskId: TaskId, answer: unknown): void {
  const { state } = ctx;
  const session = p.taskSession!;
  const record = state.tasks[taskId]!;
  const check = checkTaskAnswer(record.instance, answer);
  p.taskSession = null;
  const witnesses = witnessesOfPlayer(state, ctx.map, p);
  if (!check.ok || !check.correct) {
    ctx.emit({
      type: "PLAYER_FAILED_TASK",
      playerId: p.id,
      taskId,
      stationId: record.stationId,
      reason: check.ok ? "wrong_answer" : "malformed",
      witnesses,
    });
    return;
  }
  record.done = true;
  record.completedTick = state.tick;
  ctx.emit({
    type: "PLAYER_COMPLETED_TASK",
    playerId: p.id,
    taskId,
    stationId: record.stationId,
    countsForProgress: record.countsForProgress,
    attempts: record.attempts,
    durationTicks: state.tick - session.startedTick,
    witnesses,
  });
  if (record.countsForProgress) {
    state.taskProgress.completed++;
    ctx.emit({ type: "TASK_PROGRESS", completed: state.taskProgress.completed, total: state.taskProgress.total });
  }
}

/** Advance timed phases (observe -> delay -> answer) and time out abandoned answer phases. */
export function tickTasks(ctx: EngineContext): void {
  const { state } = ctx;
  const timeout = secondsToTicks(state.settings.taskAnswerTimeoutSec);
  for (const p of state.players) {
    const session = p.taskSession;
    if (!session) continue;
    const phase = session.phases[session.phaseIndex];
    if (!phase) continue;
    const elapsed = state.tick - session.phaseStartedTick;
    if (phase.durationTicks !== null && elapsed >= phase.durationTicks && session.phaseIndex < session.phases.length - 1) {
      session.phaseIndex++;
      session.phaseStartedTick = state.tick;
    } else if (phase.kind === "answer" && elapsed >= timeout) {
      p.taskSession = null;
      ctx.emit({ type: "PLAYER_FAILED_TASK", playerId: p.id, taskId: session.taskId, stationId: session.stationId, reason: "timeout", witnesses: witnessesOfPlayer(state, ctx.map, p) });
    }
  }
}

import {
  MEETING_PHASES,
  secondsToTicks,
  SPEECH_PHASES,
  type ActionResult,
  type MeetingOutcome,
  type MeetingPhase,
  type MeetingReason,
  type MeetingResult,
  type PlayerId,
  type Tick,
  type VoteTarget,
} from "@deduction/shared";
import { OK, reject, type EngineContext } from "../context";
import { getPlayer, type BodyState, type GameState, type PlayerState } from "../state";
import { spawnPositions } from "../setup";
import { cancelTask } from "./tasks";
import { clearSabotage } from "./sabotage";
import { forceExitVent } from "./vents";
import { placePlayer } from "./movement";

/** Max meeting messages per player per meeting (anti-spam; also bounds LLM cost). */
export const MAX_MEETING_MESSAGES = 8;

function phaseDuration(state: GameState, phase: MeetingPhase): Tick {
  const t = state.settings.meeting;
  switch (phase) {
    case "reveal":
      return secondsToTicks(t.revealSec);
    case "statements":
      return secondsToTicks(t.statementsSec);
    case "discussion":
      return secondsToTicks(t.discussionSec);
    case "final_statements":
      return secondsToTicks(t.finalStatementsSec);
    case "voting":
      return secondsToTicks(t.votingSec);
    case "result":
      return secondsToTicks(t.resultSec);
  }
}

export function startMeeting(ctx: EngineContext, reason: MeetingReason, callerId: PlayerId, body: BodyState | null): void {
  const { state } = ctx;
  for (const p of state.players) {
    cancelTask(ctx, p);
    p.repair = null;
    p.moveIntent = { mode: "stop" };
    p.route = null;
    p.moving = false;
    if (p.ventId !== null) forceExitVent(p);
    p.meetingMessagesSent = 0;
  }
  clearSabotage(ctx, "meeting");
  const newlyPublic = state.players.filter((p) => !p.alive && !state.publicDeaths.includes(p.id)).map((p) => p.id);
  state.publicDeaths.push(...newlyPublic);
  state.meetingCount++;
  const meetingId = `meeting-${state.meetingCount}`;
  state.phase = "meeting";
  state.meeting = {
    id: meetingId,
    reason,
    callerId,
    victimId: body?.victimId ?? null,
    bodyRoomId: body?.roomId ?? null,
    startedTick: state.tick,
    participants: state.players.filter((p) => p.alive).map((p) => p.id),
    phase: "reveal",
    phaseStartedTick: state.tick,
    phaseEndsAtTick: state.tick + phaseDuration(state, "reveal"),
    messages: [],
    votes: {},
    result: null,
  };
  ctx.emit({ type: "MEETING_STARTED", meetingId, reason, callerId, victimId: body?.victimId ?? null, bodyRoomId: body?.roomId ?? null, deadSinceLastMeeting: newlyPublic });
  ctx.emit({ type: "MEETING_PHASE_CHANGED", meetingId, phase: "reveal", endsAtTick: state.meeting.phaseEndsAtTick });
}

export function validateMeetingSpeech(state: GameState, p: PlayerState): ActionResult {
  const m = state.meeting;
  if (state.phase !== "meeting" || !m) return reject("not_playing");
  if (!p.alive || !m.participants.includes(p.id)) return reject("dead");
  if (!SPEECH_PHASES.includes(m.phase)) return reject("wrong_phase");
  if (state.tick < p.speechReadyAtTick || p.meetingMessagesSent >= MAX_MEETING_MESSAGES) return reject("rate_limited");
  return OK;
}

export function applyMeetingSpeech(ctx: EngineContext, p: PlayerState, text: string): void {
  const { state } = ctx;
  const m = state.meeting!;
  p.meetingMessagesSent++;
  p.speechReadyAtTick = state.tick + secondsToTicks(state.settings.speechCooldownSec);
  const event = ctx.emit({ type: "MEETING_MESSAGE", meetingId: m.id, playerId: p.id, text });
  m.messages.push({ seq: event.seq, tick: state.tick, playerId: p.id, text });
}

export function validateVote(state: GameState, p: PlayerState, target: VoteTarget): ActionResult {
  const m = state.meeting;
  if (state.phase !== "meeting" || !m) return reject("not_playing");
  if (!p.alive || !m.participants.includes(p.id)) return reject("dead");
  if (m.phase !== "voting") return reject("wrong_phase");
  if (m.votes[p.id] !== undefined) return reject("already_voted");
  if (target !== "skip") {
    const t = getPlayer(state, target);
    if (!t || !t.alive || !m.participants.includes(target)) return reject("invalid_target");
  }
  return OK;
}

export function castVote(ctx: EngineContext, p: PlayerState, target: VoteTarget): void {
  const m = ctx.state.meeting!;
  m.votes[p.id] = target;
  ctx.emit({ type: "VOTE_CAST", meetingId: m.id, voterId: p.id, target });
}

/**
 * Pure tally. Most votes wins only with a strict plurality over every other player AND over skip.
 * Ties and skip-majorities eject nobody. Non-voters count for nothing.
 */
export function tallyVotes(participants: readonly PlayerId[], votes: Readonly<Record<PlayerId, VoteTarget>>): { tally: Record<string, number>; outcome: MeetingOutcome; ejectedId: PlayerId | null } {
  const tally: Record<string, number> = {};
  let cast = 0;
  for (const voter of participants) {
    const v = votes[voter];
    if (v === undefined) continue;
    cast++;
    tally[v] = (tally[v] ?? 0) + 1;
  }
  if (cast === 0) return { tally, outcome: "no_votes", ejectedId: null };
  const skip = tally["skip"] ?? 0;
  let best: PlayerId | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [target, count] of Object.entries(tally)) {
    if (target === "skip") continue;
    if (count > bestCount) {
      best = target;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) tied = true;
  }
  if (best === null || skip >= bestCount) return { tally, outcome: "skipped", ejectedId: null };
  if (tied) return { tally, outcome: "tie", ejectedId: null };
  return { tally, outcome: "ejected", ejectedId: best };
}

function enterPhase(ctx: EngineContext, phase: MeetingPhase): void {
  const { state } = ctx;
  const m = state.meeting!;
  m.phase = phase;
  m.phaseStartedTick = state.tick;
  m.phaseEndsAtTick = state.tick + phaseDuration(state, phase);
  ctx.emit({ type: "MEETING_PHASE_CHANGED", meetingId: m.id, phase, endsAtTick: m.phaseEndsAtTick });
  if (phase === "result") resolveVotes(ctx);
}

function resolveVotes(ctx: EngineContext): void {
  const { state } = ctx;
  const m = state.meeting!;
  const { tally, outcome, ejectedId } = tallyVotes(m.participants, m.votes);
  const votes: Record<PlayerId, VoteTarget | null> = {};
  for (const id of m.participants) votes[id] = m.votes[id] ?? null;
  const ejected = ejectedId ? getPlayer(state, ejectedId) : undefined;
  const result: MeetingResult = {
    votes,
    tally,
    outcome,
    ejectedId,
    ejectedRole: ejected && state.settings.confirmEjects ? ejected.role : null,
  };
  m.result = result;
  ctx.emit({ type: "VOTES_REVEALED", meetingId: m.id, votes, tally, outcome, ejectedId });
  if (ejected) {
    ejected.alive = false;
    ejected.deathTick = state.tick;
    ejected.deathCause = "ejected";
    state.publicDeaths.push(ejected.id);
    ctx.emit({ type: "PLAYER_EJECTED", meetingId: m.id, playerId: ejected.id, role: ejected.role, roleRevealed: state.settings.confirmEjects });
  }
}

/**
 * Advance meeting phases. Zero-length phases are skipped; voting ends early once every participant has voted.
 * Returns true when the meeting has fully finished this tick (caller runs win checks and returns to play).
 */
export function tickMeeting(ctx: EngineContext): boolean {
  const { state } = ctx;
  const m = state.meeting;
  if (!m) return false;
  const allVoted = m.phase === "voting" && m.participants.every((id) => !getPlayer(state, id)?.alive || m.votes[id] !== undefined);
  if (state.tick < m.phaseEndsAtTick && !allVoted) return false;
  let idx = MEETING_PHASES.indexOf(m.phase);
  while (true) {
    idx++;
    const next = MEETING_PHASES[idx];
    if (next === undefined) {
      endMeeting(ctx);
      return true;
    }
    enterPhase(ctx, next);
    if (m.phaseEndsAtTick > state.tick || next === "result") return false;
  }
}

function endMeeting(ctx: EngineContext): void {
  const { state, map } = ctx;
  const m = state.meeting!;
  state.meeting = null;
  state.phase = "playing";
  state.bodies = [];
  const spawns = spawnPositions(map, state.players.length);
  state.players.forEach((p, i) => {
    placePlayer(ctx, p, spawns[i]!, false);
    p.killReadyAtTick = state.tick + secondsToTicks(state.settings.killCooldownSec);
    p.speechReadyAtTick = state.tick;
  });
  state.emergencyReadyAtTick = state.tick + secondsToTicks(state.settings.emergencyCooldownSec);
  ctx.emit({ type: "MEETING_ENDED", meetingId: m.id });
}

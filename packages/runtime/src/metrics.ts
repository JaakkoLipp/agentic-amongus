import type { GameEvent, PlayerId, Role, Team, Tick, WinReason } from "@deduction/shared";
import type { GameState } from "@deduction/engine";

/** Per-match counters, filled from the authoritative event stream plus the runtime's decision bookkeeping. */
export interface MatchMetrics {
  winner: Team | null;
  reason: WinReason | null;
  durationTicks: Tick;
  kills: number;
  meetings: number;
  bodyReports: number;
  emergencyMeetings: number;
  ejections: number;
  correctEjections: number;
  skippedVotes: number;
  tiedVotes: number;
  votesCast: number;
  votesForInfiltrators: number;
  crewTasksCompleted: number;
  crewTasksTotal: number;
  fakeTasksCompleted: number;
  taskAttemptsFailed: number;
  taskFailuresByReason: Record<string, number>;
  taskCompletionTicks: number[];
  sabotages: Record<string, number>;
  sabotagesFixed: number;
  ventUses: number;
  meetingMessages: number;
  nearbySpeech: number;
  invalidActions: number;
  invalidByReason: Record<string, number>;
  decisions: number;
  decisionsApplied: number;
  staleDecisions: number;
  invalidDecisions: number;
  fallbacks: number;
  controllerErrors: number;
  decisionLatencyMs: number[];
  invariantViolations: string[];
}

export function emptyMetrics(): MatchMetrics {
  return {
    winner: null,
    reason: null,
    durationTicks: 0,
    kills: 0,
    meetings: 0,
    bodyReports: 0,
    emergencyMeetings: 0,
    ejections: 0,
    correctEjections: 0,
    skippedVotes: 0,
    tiedVotes: 0,
    votesCast: 0,
    votesForInfiltrators: 0,
    crewTasksCompleted: 0,
    crewTasksTotal: 0,
    fakeTasksCompleted: 0,
    taskAttemptsFailed: 0,
    taskFailuresByReason: {},
    taskCompletionTicks: [],
    sabotages: {},
    sabotagesFixed: 0,
    ventUses: 0,
    meetingMessages: 0,
    nearbySpeech: 0,
    invalidActions: 0,
    invalidByReason: {},
    decisions: 0,
    decisionsApplied: 0,
    staleDecisions: 0,
    invalidDecisions: 0,
    fallbacks: 0,
    controllerErrors: 0,
    decisionLatencyMs: [],
    invariantViolations: [],
  };
}

const bump = (rec: Record<string, number>, key: string) => {
  rec[key] = (rec[key] ?? 0) + 1;
};

export function recordEvent(m: MatchMetrics, e: GameEvent, state: Readonly<GameState>): void {
  const roleOf = (id: PlayerId): Role | undefined => state.players.find((p) => p.id === id)?.role;
  switch (e.type) {
    case "PLAYER_KILLED":
      m.kills++;
      break;
    case "MEETING_STARTED":
      m.meetings++;
      if (e.reason === "body") m.bodyReports++;
      else m.emergencyMeetings++;
      break;
    case "VOTE_CAST":
      m.votesCast++;
      if (e.target !== "skip" && roleOf(e.target) === "infiltrator") m.votesForInfiltrators++;
      break;
    case "VOTES_REVEALED":
      if (e.outcome === "skipped" || e.outcome === "no_votes") m.skippedVotes++;
      if (e.outcome === "tie") m.tiedVotes++;
      break;
    case "PLAYER_EJECTED":
      m.ejections++;
      if (e.role === "infiltrator") m.correctEjections++;
      break;
    case "PLAYER_COMPLETED_TASK":
      if (e.countsForProgress) m.crewTasksCompleted++;
      else m.fakeTasksCompleted++;
      m.taskCompletionTicks.push(e.durationTicks);
      break;
    case "PLAYER_FAILED_TASK":
      m.taskAttemptsFailed++;
      bump(m.taskFailuresByReason, e.reason);
      break;
    case "SABOTAGE_STARTED":
      bump(m.sabotages, e.kind);
      break;
    case "SABOTAGE_FIXED":
      m.sabotagesFixed++;
      break;
    case "VENT_ENTERED":
      m.ventUses++;
      break;
    case "MEETING_MESSAGE":
      m.meetingMessages++;
      break;
    case "PLAYER_SPOKE":
      m.nearbySpeech++;
      break;
    case "ACTION_REJECTED":
      m.invalidActions++;
      bump(m.invalidByReason, `${e.action}:${e.reason}`);
      break;
    case "MATCH_ENDED":
      m.winner = e.winner;
      m.reason = e.reason;
      m.durationTicks = e.tick;
      break;
    default:
      break;
  }
}

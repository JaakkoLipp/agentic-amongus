import type {
  AreaId,
  BodyId,
  GameSettings,
  MatchId,
  MeetingId,
  MeetingMessage,
  MeetingPhase,
  MeetingReason,
  MeetingResult,
  MoveIntent,
  PlayerId,
  Role,
  SabotageKind,
  StationId,
  TaskId,
  TaskPhaseSpec,
  Team,
  Tick,
  Vec2,
  VentId,
  VoteTarget,
  WinReason,
} from "@deduction/shared";
import type { TaskInstance } from "@deduction/tasks";

/**
 * Authoritative match state. Lives only on the server (or in the headless simulator). Plain data, JSON-friendly,
 * mutated exclusively by engine rule functions. Nothing outside the engine should read it except through
 * `buildObservation` (agents/clients) or after the match (replay/inspector).
 */
export interface GameState {
  readonly matchId: MatchId;
  readonly seed: number;
  readonly mapId: string;
  readonly mapVersion: string;
  readonly settings: GameSettings;
  tick: Tick;
  phase: GamePhase;
  /** Fixed seating order; also the deterministic processing order. */
  readonly players: PlayerState[];
  bodies: BodyState[];
  readonly tasks: Record<TaskId, TaskRecord>;
  taskProgress: { completed: number; total: number };
  sabotage: SabotageState | null;
  sabotageReadyAtTick: Tick;
  meeting: MeetingState | null;
  meetingCount: number;
  emergencyReadyAtTick: Tick;
  /** Deaths announced to everyone (at meeting start, or by ejection). */
  publicDeaths: PlayerId[];
  outcome: MatchOutcome | null;
  nextEventSeq: number;
  nextBodyNumber: number;
}

export type GamePhase = "playing" | "meeting" | "ended";

export interface MatchOutcome {
  readonly winner: Team;
  readonly reason: WinReason;
  readonly tick: Tick;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: string;
  readonly role: Role;
  alive: boolean;
  deathTick: Tick | null;
  deathCause: "killed" | "ejected" | null;
  pos: Vec2;
  facing: Vec2;
  roomId: AreaId | null;
  moveIntent: MoveIntent;
  route: RouteState | null;
  /** Moved during the last tick. */
  moving: boolean;
  killReadyAtTick: Tick;
  ventId: VentId | null;
  ventReadyAtTick: Tick;
  taskIds: TaskId[];
  taskSession: TaskSession | null;
  repair: RepairState | null;
  emergencyMeetingsLeft: number;
  speechReadyAtTick: Tick;
  meetingMessagesSent: number;
}

/** Engine-side route following for `MoveIntent.mode === "path"`. */
export interface RouteState {
  target: Vec2;
  waypoints: Vec2[];
  index: number;
  stuckTicks: number;
  repaths: number;
  arrived: boolean;
  unreachable: boolean;
}

export interface TaskRecord {
  readonly id: TaskId;
  readonly ownerId: PlayerId;
  readonly stationId: StationId;
  readonly instance: TaskInstance;
  /** False for infiltrators' fake tasks. Hidden from every observation. */
  readonly countsForProgress: boolean;
  done: boolean;
  attempts: number;
  completedTick: Tick | null;
}

export interface TaskSession {
  readonly taskId: TaskId;
  readonly stationId: StationId;
  readonly phases: readonly TaskPhaseSpec[];
  readonly startedTick: Tick;
  readonly attempt: number;
  phaseIndex: number;
  phaseStartedTick: Tick;
}

export interface RepairState {
  readonly stationId: StationId;
  readonly startedTick: Tick;
}

export interface BodyState {
  readonly id: BodyId;
  readonly victimId: PlayerId;
  /** Secret. Never exposed through observations. */
  readonly killerId: PlayerId;
  readonly pos: Vec2;
  readonly roomId: AreaId | null;
  readonly tick: Tick;
  /** Players who saw the kill happen. */
  readonly witnesses: PlayerId[];
  /** Players who have laid eyes on the body. */
  readonly seenBy: PlayerId[];
  reported: boolean;
}

export interface SabotageState {
  readonly kind: SabotageKind;
  readonly saboteurId: PlayerId;
  readonly startedTick: Tick;
  readonly deadlineTick: Tick | null;
  readonly stations: SabotageStationState[];
  /** Reactor: tick since which every station has been held simultaneously. */
  simultaneousSinceTick: Tick | null;
}

export interface SabotageStationState {
  readonly stationId: StationId;
  fixed: boolean;
  fixedBy: PlayerId[];
}

export interface MeetingState {
  readonly id: MeetingId;
  readonly reason: MeetingReason;
  readonly callerId: PlayerId;
  readonly victimId: PlayerId | null;
  readonly bodyRoomId: AreaId | null;
  readonly startedTick: Tick;
  /** Players alive when the meeting started; the only ones who may speak or vote. */
  readonly participants: PlayerId[];
  phase: MeetingPhase;
  phaseStartedTick: Tick;
  phaseEndsAtTick: Tick;
  messages: MeetingMessage[];
  votes: Record<PlayerId, VoteTarget>;
  result: MeetingResult | null;
}

export function getPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  for (const p of state.players) if (p.id === id) return p;
  return undefined;
}

export function requirePlayer(state: GameState, id: PlayerId): PlayerState {
  const p = getPlayer(state, id);
  if (!p) throw new Error(`unknown player ${id}`);
  return p;
}

export const aliveCount = (state: GameState, role?: Role): number =>
  state.players.reduce((n, p) => n + (p.alive && (role === undefined || p.role === role) ? 1 : 0), 0);

import type { AreaId, BodyId, MatchId, MeetingId, PlayerId, StationId, TaskId, Tick, VentId } from "./ids";
import type { ActionRejectReason, PlayerActionType, VoteTarget } from "./actions";
import type { CompassDirection, Vec2 } from "./math";
import type { MeetingOutcome, MeetingPhase, MeetingReason, MeetingView } from "./meeting";
import type { Role, SabotageKind, Team, WinReason } from "./roles";
import type { TaskKind, TaskPhaseKind, TaskView } from "./tasks";

/**
 * What one player can legitimately perceive right now. Produced by the engine's `buildObservation(state, map, id)`
 * and consumed by every controller (human UI, heuristic bots, LLM agents).
 *
 * Invariants (enforced by tests):
 * - no other player's role unless publicly revealed (ejection with role reveal) or an infiltrator teammate
 * - positions only for players currently in vision (range + wall occlusion + lights)
 * - no deaths that the observer has not witnessed or been told about in a meeting
 * - no fake-task state, no other players' task lists, no hidden killer/saboteur identities
 *
 * Memory (last-known locations, suspicion, claims) is NOT part of the observation — each agent builds it
 * from the stream of observations it has received.
 */
export interface PlayerObservation {
  readonly matchId: MatchId;
  readonly tick: Tick;
  readonly phase: "playing" | "meeting" | "ended";
  readonly self: SelfView;
  /** Fellow infiltrators (empty for crew). */
  readonly teammates: readonly PlayerId[];
  readonly roster: readonly RosterEntry[];
  readonly visiblePlayers: readonly VisiblePlayer[];
  readonly visibleBodies: readonly VisibleBody[];
  /** Perceived events since this player's previous observation. */
  readonly events: readonly PerceivedEvent[];
  /** Own task list (for infiltrators these are fake tasks). */
  readonly tasks: readonly OwnTask[];
  readonly activeTask: ActiveTaskView | null;
  /** Null while communications are sabotaged. */
  readonly taskProgress: { readonly completed: number; readonly total: number } | null;
  readonly sabotage: SabotageView | null;
  readonly legal: LegalActions;
  readonly meeting: MeetingView | null;
  readonly outcome: { readonly winner: Team; readonly reason: WinReason } | null;
}

export type PlayerActivity = "idle" | "moving" | "task" | "repair";

export interface SelfView {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: string;
  readonly role: Role;
  readonly alive: boolean;
  readonly pos: Vec2;
  readonly roomId: AreaId | null;
  readonly facing: Vec2;
  readonly activity: PlayerActivity;
  readonly inVentId: VentId | null;
  readonly visionRadius: number;
  /** Ticks until a kill is possible; null for crew. */
  readonly killCooldownTicks: Tick | null;
  /** Ticks until sabotage is possible; null for crew. */
  readonly sabotageCooldownTicks: Tick | null;
  readonly emergencyMeetingsLeft: number;
  readonly speechCooldownTicks: Tick;
  readonly repairingStationId: StationId | null;
}

export interface RosterEntry {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: string;
  /** What this observer knows: "dead" only if they saw the body/kill or a meeting announced it. */
  readonly knownStatus: "alive" | "dead" | "ejected";
  /** Role, only if legitimately known (self, infiltrator teammates, or revealed on ejection). */
  readonly knownRole: Role | null;
}

export interface VisiblePlayer {
  readonly id: PlayerId;
  readonly pos: Vec2;
  readonly roomId: AreaId | null;
  readonly facing: Vec2;
  readonly activity: PlayerActivity;
  /** Station being used, if the player is visibly at a console. */
  readonly stationId: StationId | null;
  /** Only ghosts can see ghosts. */
  readonly ghost: boolean;
}

export interface VisibleBody {
  readonly bodyId: BodyId;
  readonly victimId: PlayerId;
  readonly pos: Vec2;
  readonly roomId: AreaId | null;
}

export interface OwnTask {
  readonly taskId: TaskId;
  readonly kind: TaskKind;
  readonly title: string;
  readonly stationId: StationId;
  readonly roomId: AreaId;
  readonly pos: Vec2;
  readonly done: boolean;
}

export interface ActiveTaskView {
  readonly taskId: TaskId;
  readonly kind: TaskKind;
  readonly stationId: StationId;
  readonly phase: TaskPhaseKind;
  readonly phaseIndex: number;
  readonly phaseCount: number;
  readonly phaseEndsAtTick: Tick | null;
  readonly attempt: number;
  readonly view: TaskView;
}

export interface SabotageView {
  readonly kind: SabotageKind;
  readonly startedTick: Tick;
  readonly deadlineTick: Tick | null;
  readonly stations: readonly { readonly stationId: StationId; readonly roomId: AreaId; readonly pos: Vec2; readonly fixed: boolean }[];
}

/** Actions that are legal for this player at this tick. The HUD shows exactly these; bots choose from them. */
export interface LegalActions {
  readonly move: boolean;
  readonly startTask: readonly TaskId[];
  readonly cancelTask: boolean;
  readonly submitAnswer: TaskId | null;
  readonly report: readonly BodyId[];
  readonly kill: readonly PlayerId[];
  readonly emergency: boolean;
  readonly ventEnter: VentId | null;
  readonly ventMove: readonly VentId[];
  readonly ventExit: boolean;
  readonly sabotage: readonly SabotageKind[];
  readonly repair: readonly StationId[];
  readonly speak: boolean;
  readonly vote: readonly VoteTarget[];
}

/**
 * Observer-relative events. Derived from authoritative events using the witness lists computed by the engine,
 * so an agent's memory can only ever contain things it actually saw or heard.
 */
export type PerceivedEventBody =
  | { readonly type: "PLAYER_BECAME_VISIBLE"; readonly playerId: PlayerId; readonly pos: Vec2; readonly roomId: AreaId | null }
  | { readonly type: "PLAYER_LEFT_VISIBILITY"; readonly playerId: PlayerId; readonly lastPos: Vec2; readonly roomId: AreaId | null; readonly heading: CompassDirection | null }
  | { readonly type: "SAW_ENTER_ROOM"; readonly playerId: PlayerId; readonly roomId: AreaId; readonly fromRoomId: AreaId | null }
  | { readonly type: "SAW_LEAVE_ROOM"; readonly playerId: PlayerId; readonly roomId: AreaId; readonly toRoomId: AreaId | null }
  | { readonly type: "SAW_TASK_START"; readonly playerId: PlayerId; readonly stationId: StationId; readonly roomId: AreaId | null }
  /** Completed, failed and cancelled look identical from the outside. */
  | { readonly type: "SAW_TASK_STOP"; readonly playerId: PlayerId; readonly stationId: StationId; readonly roomId: AreaId | null }
  | { readonly type: "SAW_KILL"; readonly killerId: PlayerId; readonly victimId: PlayerId; readonly bodyId: BodyId; readonly pos: Vec2; readonly roomId: AreaId | null }
  | { readonly type: "SAW_BODY"; readonly bodyId: BodyId; readonly victimId: PlayerId; readonly pos: Vec2; readonly roomId: AreaId | null }
  | { readonly type: "SAW_VENT"; readonly playerId: PlayerId; readonly ventId: VentId; readonly roomId: AreaId | null; readonly action: "enter" | "exit" }
  | { readonly type: "HEARD_SPEECH"; readonly speakerId: PlayerId; readonly text: string }
  | { readonly type: "TASK_PROGRESS"; readonly completed: number; readonly total: number }
  | { readonly type: "OWN_TASK_RESULT"; readonly taskId: TaskId; readonly result: "completed" | "wrong_answer" | "malformed" | "timeout" }
  | { readonly type: "OWN_VENT_MOVE"; readonly fromVentId: VentId; readonly toVentId: VentId }
  | { readonly type: "ACTION_REJECTED"; readonly action: PlayerActionType | "unknown"; readonly reason: ActionRejectReason }
  | { readonly type: "WAS_KILLED"; readonly killerId: PlayerId }
  | { readonly type: "SABOTAGE_STARTED"; readonly kind: SabotageKind; readonly deadlineTick: Tick | null }
  | { readonly type: "SABOTAGE_FIXED"; readonly kind: SabotageKind }
  | { readonly type: "BODY_REPORTED"; readonly reporterId: PlayerId; readonly victimId: PlayerId; readonly roomId: AreaId | null }
  | { readonly type: "EMERGENCY_CALLED"; readonly callerId: PlayerId }
  | { readonly type: "MEETING_STARTED"; readonly meetingId: MeetingId; readonly reason: MeetingReason; readonly callerId: PlayerId; readonly victimId: PlayerId | null; readonly bodyRoomId: AreaId | null; readonly deadSinceLastMeeting: readonly PlayerId[] }
  | { readonly type: "MEETING_PHASE"; readonly meetingId: MeetingId; readonly phase: MeetingPhase; readonly endsAtTick: Tick }
  | { readonly type: "MEETING_MESSAGE"; readonly meetingId: MeetingId; readonly playerId: PlayerId; readonly text: string }
  | { readonly type: "VOTE_CAST"; readonly meetingId: MeetingId; readonly voterId: PlayerId }
  | { readonly type: "VOTES_REVEALED"; readonly meetingId: MeetingId; readonly votes: Readonly<Record<PlayerId, VoteTarget | null>>; readonly outcome: MeetingOutcome; readonly ejectedId: PlayerId | null }
  | { readonly type: "PLAYER_EJECTED"; readonly playerId: PlayerId; readonly role: Role | null }
  | { readonly type: "MEETING_ENDED"; readonly meetingId: MeetingId }
  | { readonly type: "MATCH_ENDED"; readonly winner: Team; readonly reason: WinReason; readonly roles: Readonly<Record<PlayerId, Role>> };

export type PerceivedEventType = PerceivedEventBody["type"];
export type PerceivedEvent = PerceivedEventBody & { readonly tick: Tick };
export type PerceivedEventOf<T extends PerceivedEventType> = Extract<PerceivedEvent, { type: T }>;

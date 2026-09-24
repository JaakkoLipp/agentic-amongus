import type { AreaId, BodyId, MeetingId, PlayerId, StationId, TaskId, Tick, VentId } from "./ids";
import type { ActionRejectReason, PlayerActionType, VoteTarget } from "./actions";
import type { MeetingOutcome, MeetingPhase, MeetingReason } from "./meeting";
import type { Role, SabotageKind, Team, WinReason } from "./roles";
import type { TaskKind } from "./tasks";
import type { Vec2 } from "./math";

/**
 * Authoritative game events. The engine is the only producer. Game rules, AI perception, logging and replay all
 * consume this stream. Events may contain secrets (roles, killers, fake-task flags) — they are never sent to a
 * client or agent directly; `PerceivedEvent`s (see observation.ts) are derived per observer instead.
 *
 * `witnesses` is computed at emission time from real geometry (vision range + wall occlusion) and lists the
 * players who could legitimately perceive the event.
 */
export type GameEventBody =
  | { readonly type: "MATCH_STARTED"; readonly seed: number; readonly mapId: string; readonly mapVersion: string; readonly playerIds: readonly PlayerId[] }
  | { readonly type: "ROLES_ASSIGNED"; readonly roles: Readonly<Record<PlayerId, Role>> }
  | { readonly type: "TASKS_ASSIGNED"; readonly playerId: PlayerId; readonly taskIds: readonly TaskId[] }
  | { readonly type: "PLAYER_LEFT_ROOM"; readonly playerId: PlayerId; readonly roomId: AreaId; readonly toRoomId: AreaId | null; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "PLAYER_ENTERED_ROOM"; readonly playerId: PlayerId; readonly roomId: AreaId; readonly fromRoomId: AreaId | null; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "PLAYER_STARTED_TASK"; readonly playerId: PlayerId; readonly taskId: TaskId; readonly kind: TaskKind; readonly stationId: StationId; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "PLAYER_CANCELLED_TASK"; readonly playerId: PlayerId; readonly taskId: TaskId; readonly stationId: StationId; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "PLAYER_COMPLETED_TASK"; readonly playerId: PlayerId; readonly taskId: TaskId; readonly stationId: StationId; readonly countsForProgress: boolean; readonly attempts: number; readonly durationTicks: Tick; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "PLAYER_FAILED_TASK"; readonly playerId: PlayerId; readonly taskId: TaskId; readonly stationId: StationId; readonly reason: "wrong_answer" | "malformed" | "timeout"; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "TASK_PROGRESS"; readonly completed: number; readonly total: number }
  | { readonly type: "PLAYER_KILLED"; readonly killerId: PlayerId; readonly victimId: PlayerId; readonly bodyId: BodyId; readonly pos: Vec2; readonly roomId: AreaId | null; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "BODY_SEEN"; readonly bodyId: BodyId; readonly victimId: PlayerId; readonly observerId: PlayerId; readonly roomId: AreaId | null }
  | { readonly type: "BODY_REPORTED"; readonly reporterId: PlayerId; readonly bodyId: BodyId; readonly victimId: PlayerId; readonly roomId: AreaId | null }
  | { readonly type: "EMERGENCY_CALLED"; readonly callerId: PlayerId }
  | { readonly type: "MEETING_STARTED"; readonly meetingId: MeetingId; readonly reason: MeetingReason; readonly callerId: PlayerId; readonly victimId: PlayerId | null; readonly bodyRoomId: AreaId | null; readonly deadSinceLastMeeting: readonly PlayerId[] }
  | { readonly type: "MEETING_PHASE_CHANGED"; readonly meetingId: MeetingId; readonly phase: MeetingPhase; readonly endsAtTick: Tick }
  | { readonly type: "MEETING_MESSAGE"; readonly meetingId: MeetingId; readonly playerId: PlayerId; readonly text: string }
  | { readonly type: "VOTE_CAST"; readonly meetingId: MeetingId; readonly voterId: PlayerId; readonly target: VoteTarget }
  | { readonly type: "VOTES_REVEALED"; readonly meetingId: MeetingId; readonly votes: Readonly<Record<PlayerId, VoteTarget | null>>; readonly tally: Readonly<Record<string, number>>; readonly outcome: MeetingOutcome; readonly ejectedId: PlayerId | null }
  | { readonly type: "PLAYER_EJECTED"; readonly meetingId: MeetingId; readonly playerId: PlayerId; readonly role: Role; readonly roleRevealed: boolean }
  | { readonly type: "MEETING_ENDED"; readonly meetingId: MeetingId }
  | { readonly type: "SABOTAGE_STARTED"; readonly kind: SabotageKind; readonly saboteurId: PlayerId; readonly deadlineTick: Tick | null }
  | { readonly type: "SABOTAGE_STATION_FIXED"; readonly kind: SabotageKind; readonly stationId: StationId; readonly playerIds: readonly PlayerId[] }
  | { readonly type: "SABOTAGE_FIXED"; readonly kind: SabotageKind; readonly fixerIds: readonly PlayerId[] }
  | { readonly type: "SABOTAGE_CLEARED"; readonly kind: SabotageKind; readonly reason: "meeting" | "match_end" }
  | { readonly type: "VENT_ENTERED"; readonly playerId: PlayerId; readonly ventId: VentId; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "VENT_MOVED"; readonly playerId: PlayerId; readonly fromVentId: VentId; readonly toVentId: VentId }
  | { readonly type: "VENT_EXITED"; readonly playerId: PlayerId; readonly ventId: VentId; readonly witnesses: readonly PlayerId[] }
  | { readonly type: "PLAYER_SPOKE"; readonly playerId: PlayerId; readonly text: string; readonly hearers: readonly PlayerId[] }
  | { readonly type: "ACTION_REJECTED"; readonly playerId: PlayerId; readonly action: PlayerActionType | "unknown"; readonly reason: ActionRejectReason }
  | { readonly type: "MATCH_ENDED"; readonly winner: Team; readonly reason: WinReason; readonly roles: Readonly<Record<PlayerId, Role>> };

export type GameEventType = GameEventBody["type"];

export type GameEvent = GameEventBody & { readonly seq: number; readonly tick: Tick };

export type GameEventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

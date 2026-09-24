import type { GameEvent, PerceivedEventBody, PlayerId } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import type { GameState } from "./state";

export type Delivery = readonly [PlayerId, PerceivedEventBody];

/**
 * Pure mapping from one authoritative event to what each player perceives. This is the only bridge from secret
 * engine events into agent-visible information; witness lists were computed from geometry at emission time.
 */
export function perceiveEvent(event: GameEvent, state: GameState, map: GameMap): Delivery[] {
  const everyone = (body: PerceivedEventBody): Delivery[] => state.players.map((p) => [p.id, body] as const);
  const to = (ids: readonly PlayerId[], body: PerceivedEventBody): Delivery[] => ids.map((id) => [id, body] as const);
  const station = (id: string) => map.taskStationById.get(id)?.roomId ?? null;

  switch (event.type) {
    case "PLAYER_LEFT_ROOM":
      return to(event.witnesses, { type: "SAW_LEAVE_ROOM", playerId: event.playerId, roomId: event.roomId, toRoomId: event.toRoomId });
    case "PLAYER_ENTERED_ROOM":
      return to(event.witnesses, { type: "SAW_ENTER_ROOM", playerId: event.playerId, roomId: event.roomId, fromRoomId: event.fromRoomId });
    case "PLAYER_STARTED_TASK":
      return to(event.witnesses, { type: "SAW_TASK_START", playerId: event.playerId, stationId: event.stationId, roomId: station(event.stationId) });
    case "PLAYER_CANCELLED_TASK":
      return to(event.witnesses, { type: "SAW_TASK_STOP", playerId: event.playerId, stationId: event.stationId, roomId: station(event.stationId) });
    case "PLAYER_COMPLETED_TASK":
      return [
        ...to(event.witnesses, { type: "SAW_TASK_STOP", playerId: event.playerId, stationId: event.stationId, roomId: station(event.stationId) }),
        [event.playerId, { type: "OWN_TASK_RESULT", taskId: event.taskId, result: "completed" }],
      ];
    case "PLAYER_FAILED_TASK":
      return [
        ...to(event.witnesses, { type: "SAW_TASK_STOP", playerId: event.playerId, stationId: event.stationId, roomId: station(event.stationId) }),
        [event.playerId, { type: "OWN_TASK_RESULT", taskId: event.taskId, result: event.reason }],
      ];
    case "TASK_PROGRESS":
      if (state.sabotage?.kind === "comms") return [];
      return everyone({ type: "TASK_PROGRESS", completed: event.completed, total: event.total });
    case "PLAYER_KILLED":
      return [
        ...to(event.witnesses, { type: "SAW_KILL", killerId: event.killerId, victimId: event.victimId, bodyId: event.bodyId, pos: event.pos, roomId: event.roomId }),
        [event.victimId, { type: "WAS_KILLED", killerId: event.killerId }],
      ];
    case "BODY_SEEN":
      return [[event.observerId, { type: "SAW_BODY", bodyId: event.bodyId, victimId: event.victimId, pos: bodyPos(state, event.bodyId), roomId: event.roomId }]];
    case "BODY_REPORTED":
      return everyone({ type: "BODY_REPORTED", reporterId: event.reporterId, victimId: event.victimId, roomId: event.roomId });
    case "EMERGENCY_CALLED":
      return everyone({ type: "EMERGENCY_CALLED", callerId: event.callerId });
    case "MEETING_STARTED":
      return everyone({
        type: "MEETING_STARTED",
        meetingId: event.meetingId,
        reason: event.reason,
        callerId: event.callerId,
        victimId: event.victimId,
        bodyRoomId: event.bodyRoomId,
        deadSinceLastMeeting: event.deadSinceLastMeeting,
      });
    case "MEETING_PHASE_CHANGED":
      return everyone({ type: "MEETING_PHASE", meetingId: event.meetingId, phase: event.phase, endsAtTick: event.endsAtTick });
    case "MEETING_MESSAGE":
      return everyone({ type: "MEETING_MESSAGE", meetingId: event.meetingId, playerId: event.playerId, text: event.text });
    case "VOTE_CAST":
      return everyone({ type: "VOTE_CAST", meetingId: event.meetingId, voterId: event.voterId });
    case "VOTES_REVEALED":
      return everyone({ type: "VOTES_REVEALED", meetingId: event.meetingId, votes: event.votes, outcome: event.outcome, ejectedId: event.ejectedId });
    case "PLAYER_EJECTED":
      return everyone({ type: "PLAYER_EJECTED", playerId: event.playerId, role: event.roleRevealed ? event.role : null });
    case "MEETING_ENDED":
      return everyone({ type: "MEETING_ENDED", meetingId: event.meetingId });
    case "SABOTAGE_STARTED":
      return everyone({ type: "SABOTAGE_STARTED", kind: event.kind, deadlineTick: event.deadlineTick });
    case "SABOTAGE_FIXED":
    case "SABOTAGE_CLEARED":
      return everyone({ type: "SABOTAGE_FIXED", kind: event.kind });
    case "VENT_ENTERED":
      return to(event.witnesses, { type: "SAW_VENT", playerId: event.playerId, ventId: event.ventId, roomId: map.ventById.get(event.ventId)?.roomId ?? null, action: "enter" });
    case "VENT_EXITED":
      return to(event.witnesses, { type: "SAW_VENT", playerId: event.playerId, ventId: event.ventId, roomId: map.ventById.get(event.ventId)?.roomId ?? null, action: "exit" });
    case "VENT_MOVED":
      return [[event.playerId, { type: "OWN_VENT_MOVE", fromVentId: event.fromVentId, toVentId: event.toVentId }]];
    case "PLAYER_SPOKE":
      return to(event.hearers, { type: "HEARD_SPEECH", speakerId: event.playerId, text: event.text });
    case "ACTION_REJECTED":
      return [[event.playerId, { type: "ACTION_REJECTED", action: event.action, reason: event.reason }]];
    case "MATCH_ENDED":
      return everyone({ type: "MATCH_ENDED", winner: event.winner, reason: event.reason, roles: event.roles });
    case "MATCH_STARTED":
    case "ROLES_ASSIGNED":
    case "TASKS_ASSIGNED":
    case "SABOTAGE_STATION_FIXED":
      return [];
  }
}

function bodyPos(state: GameState, bodyId: string) {
  return state.bodies.find((b) => b.id === bodyId)?.pos ?? { x: 0, y: 0 };
}

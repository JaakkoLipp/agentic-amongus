import type {
  ActiveTaskView,
  MeetingView,
  OwnTask,
  PerceivedEvent,
  PlayerActivity,
  PlayerObservation,
  RosterEntry,
  SabotageView,
  VisibleBody,
  VisiblePlayer,
} from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import { getTaskDefinition, taskView } from "@deduction/tasks";
import { requirePlayer, type GameState, type PlayerState } from "./state";
import { canSeePlayer, canSeePoint, visionRadius } from "./vision";
import { computeLegalActions } from "./legal";

/**
 * Build what `playerId` can legitimately perceive. Pure: depends only on (state, map, playerId, events).
 * This is the ONLY way game information reaches controllers — human clients and AI agents alike.
 */
export function buildObservation(state: GameState, map: GameMap, playerId: string, events: readonly PerceivedEvent[] = []): PlayerObservation {
  const self = requirePlayer(state, playerId);
  const ended = state.phase === "ended";

  const visiblePlayers: VisiblePlayer[] = [];
  const visibleBodies: VisibleBody[] = [];
  if (state.phase === "playing") {
    for (const t of state.players) {
      if (t.id === self.id || !canSeePlayer(state, map, self, t)) continue;
      visiblePlayers.push({
        id: t.id,
        pos: t.pos,
        roomId: t.roomId,
        facing: t.facing,
        activity: activityOf(t),
        stationId: t.taskSession?.stationId ?? t.repair?.stationId ?? null,
        ghost: !t.alive,
      });
    }
    for (const b of state.bodies) {
      if (canSeePoint(state, map, self, b.pos)) visibleBodies.push({ bodyId: b.id, victimId: b.victimId, pos: b.pos, roomId: b.roomId });
    }
  }

  const tasks: OwnTask[] = self.taskIds.map((id) => {
    const record = state.tasks[id]!;
    const station = map.taskStationById.get(record.stationId)!;
    return { taskId: id, kind: record.instance.kind, title: getTaskDefinition(record.instance.kind).title, stationId: station.id, roomId: station.roomId, pos: station.pos, done: record.done };
  });

  let activeTask: ActiveTaskView | null = null;
  const session = self.taskSession;
  if (session) {
    const phase = session.phases[session.phaseIndex]!;
    const record = state.tasks[session.taskId]!;
    activeTask = {
      taskId: session.taskId,
      kind: record.instance.kind,
      stationId: session.stationId,
      phase: phase.kind,
      phaseIndex: session.phaseIndex,
      phaseCount: session.phases.length,
      phaseEndsAtTick: phase.durationTicks === null ? null : session.phaseStartedTick + phase.durationTicks,
      attempt: session.attempt,
      view: taskView(record.instance, phase.kind),
    };
  }

  const sab = state.sabotage;
  const sabotage: SabotageView | null = sab
    ? {
        kind: sab.kind,
        startedTick: sab.startedTick,
        deadlineTick: sab.deadlineTick,
        stations: sab.stations.map((s) => {
          const def = map.sabotageStationById.get(s.stationId)!;
          return { stationId: s.stationId, roomId: def.roomId, pos: def.pos, fixed: s.fixed };
        }),
      }
    : null;

  const isInfiltrator = self.role === "infiltrator";
  return {
    matchId: state.matchId,
    tick: state.tick,
    phase: state.phase,
    self: {
      id: self.id,
      name: self.name,
      color: self.color,
      role: self.role,
      alive: self.alive,
      pos: self.pos,
      roomId: self.roomId,
      facing: self.facing,
      activity: activityOf(self),
      inVentId: self.ventId,
      visionRadius: visionRadius(state, self),
      killCooldownTicks: isInfiltrator ? Math.max(0, self.killReadyAtTick - state.tick) : null,
      sabotageCooldownTicks: isInfiltrator ? Math.max(0, state.sabotageReadyAtTick - state.tick) : null,
      emergencyMeetingsLeft: self.emergencyMeetingsLeft,
      speechCooldownTicks: Math.max(0, self.speechReadyAtTick - state.tick),
      repairingStationId: self.repair?.stationId ?? null,
    },
    teammates: isInfiltrator ? state.players.filter((p) => p.role === "infiltrator" && p.id !== self.id).map((p) => p.id) : [],
    roster: state.players.map((p) => rosterEntry(state, self, p, ended)),
    visiblePlayers,
    visibleBodies,
    events,
    tasks,
    activeTask,
    taskProgress: sab?.kind === "comms" ? null : { ...state.taskProgress },
    sabotage,
    legal: computeLegalActions(state, map, self),
    meeting: meetingView(state),
    outcome: state.outcome ? { winner: state.outcome.winner, reason: state.outcome.reason } : null,
  };
}

function activityOf(p: PlayerState): PlayerActivity {
  if (p.taskSession) return "task";
  if (p.repair) return "repair";
  return p.moving ? "moving" : "idle";
}

function rosterEntry(state: GameState, self: PlayerState, p: PlayerState, ended: boolean): RosterEntry {
  let knownStatus: RosterEntry["knownStatus"] = "alive";
  if (p.deathCause === "ejected") knownStatus = "ejected";
  else if (!p.alive) {
    const known =
      p.id === self.id ||
      state.publicDeaths.includes(p.id) ||
      ended ||
      state.bodies.some((b) => b.victimId === p.id && (b.seenBy.includes(self.id) || b.reported));
    if (known) knownStatus = "dead";
  }
  let knownRole: RosterEntry["knownRole"] = null;
  if (ended || p.id === self.id || (self.role === "infiltrator" && p.role === "infiltrator")) knownRole = p.role;
  else if (p.deathCause === "ejected" && state.settings.confirmEjects) knownRole = p.role;
  return { id: p.id, name: p.name, color: p.color, knownStatus, knownRole };
}

/** Public meeting information (identical for every participant). */
export function meetingView(state: GameState): MeetingView | null {
  const m = state.meeting;
  if (!m) return null;
  return {
    meetingId: m.id,
    reason: m.reason,
    callerId: m.callerId,
    victimId: m.victimId,
    bodyRoomId: m.bodyRoomId,
    phase: m.phase,
    phaseEndsAtTick: m.phaseEndsAtTick,
    participants: [...m.participants],
    messages: [...m.messages],
    voted: m.participants.filter((id) => m.votes[id] !== undefined),
    result: m.result,
  };
}

import { dist, SPEECH_PHASES, type LegalActions, type PlayerId, type SabotageKind, type VoteTarget } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import type { GameState, PlayerState } from "./state";
import { validateKill } from "./rules/kill";
import { validateEmergency, validateEmergencyRange, validateReport } from "./rules/report";
import { validateEnterVent } from "./rules/vents";
import { validateSabotage, validateStartRepair } from "./rules/sabotage";
import { validateStartTask } from "./rules/tasks";
import { validateSpeak } from "./rules/speech";
import { validateVote } from "./rules/meeting";
import { canSeePoint } from "./vision";

const SABOTAGE_KINDS: readonly SabotageKind[] = ["lights", "reactor", "oxygen", "comms"];

/**
 * Pure: the set of actions this player could perform right now. Built from the same validators the engine uses,
 * so "shown as legal" and "accepted" can never disagree. Only includes targets the player can legitimately see.
 */
export function computeLegalActions(state: GameState, map: GameMap, p: PlayerState): LegalActions {
  const playing = state.phase === "playing";
  const inMeeting = state.phase === "meeting";
  const session = p.taskSession;

  const startTask = playing ? p.taskIds.filter((id) => validateStartTask(state, map, p, id).ok) : [];
  const report = playing
    ? state.bodies.filter((b) => canSeePoint(state, map, p, b.pos) && validateReport(state, map, p, b.id).ok).map((b) => b.id)
    : [];
  const kill: PlayerId[] = playing && p.role === "infiltrator" ? state.players.filter((t) => validateKill(state, map, p, t.id).ok).map((t) => t.id) : [];
  const emergency = playing && validateEmergency(state, p).ok && validateEmergencyRange(state, map, p).ok;

  let ventEnter: string | null = null;
  if (playing && p.role === "infiltrator" && p.alive && p.ventId === null) {
    let bestD = Infinity;
    for (const v of map.def.vents) {
      const d = dist(p.pos, v.pos);
      if (d < bestD && validateEnterVent(state, map, p, v.id).ok) {
        bestD = d;
        ventEnter = v.id;
      }
    }
  }
  const ventMove = playing && p.ventId !== null && state.tick >= p.ventReadyAtTick ? [...(map.ventLinks.get(p.ventId) ?? [])] : [];
  const ventExit = playing && p.ventId !== null && state.tick >= p.ventReadyAtTick;

  const sabotage = playing && p.role === "infiltrator" ? SABOTAGE_KINDS.filter((k) => validateSabotage(state, p, k).ok) : [];
  const repair = playing && state.sabotage ? state.sabotage.stations.filter((s) => validateStartRepair(state, map, p, s.stationId).ok).map((s) => s.stationId) : [];

  const speak = (playing || (inMeeting && state.meeting !== null && SPEECH_PHASES.includes(state.meeting.phase))) && validateSpeak(state, p).ok;

  const vote: VoteTarget[] = [];
  if (inMeeting && state.meeting && validateVote(state, p, "skip").ok) {
    vote.push("skip");
    for (const id of state.meeting.participants) if (validateVote(state, p, id).ok) vote.push(id);
  }

  return {
    move: playing && p.ventId === null,
    startTask,
    cancelTask: session !== null,
    submitAnswer: session && session.phases[session.phaseIndex]?.kind === "answer" ? session.taskId : null,
    report,
    kill,
    emergency,
    ventEnter,
    ventMove,
    ventExit,
    sabotage,
    repair,
    speak,
    vote,
  };
}

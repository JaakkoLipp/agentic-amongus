import { boxFits, type GameMap } from "@deduction/maps";
import { aliveCount, type GameState } from "./state";

/**
 * Pure consistency checks over the authoritative state. The simulator runs these every tick; any returned string
 * is an "impossible state" and fails the run.
 */
export function checkInvariants(state: GameState, map: GameMap): string[] {
  const out: string[] = [];
  const fail = (msg: string) => out.push(`tick ${state.tick}: ${msg}`);

  if ((state.phase === "meeting") !== (state.meeting !== null)) fail(`phase ${state.phase} but meeting=${state.meeting ? "set" : "null"}`);
  if ((state.phase === "ended") !== (state.outcome !== null)) fail(`phase ${state.phase} but outcome=${state.outcome ? "set" : "null"}`);

  for (const p of state.players) {
    if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) fail(`${p.id} has non-finite position`);
    else if (p.ventId === null && !boxFits(map, p.pos)) fail(`${p.id} is inside a wall at (${p.pos.x.toFixed(2)}, ${p.pos.y.toFixed(2)})`);
    if (p.ventId !== null) {
      if (!p.alive || p.role !== "infiltrator") fail(`${p.id} is in a vent but is not a living infiltrator`);
      const vent = map.ventById.get(p.ventId);
      if (!vent) fail(`${p.id} is in unknown vent ${p.ventId}`);
      else if (vent.pos.x !== p.pos.x || vent.pos.y !== p.pos.y) fail(`${p.id} is in vent ${p.ventId} but not at its position`);
      if (p.taskSession) fail(`${p.id} has a task session inside a vent`);
    }
    if (!p.alive) {
      if (p.deathTick === null || p.deathCause === null) fail(`${p.id} is dead without death info`);
      if (p.repair) fail(`${p.id} is dead but repairing`);
      if (p.taskSession && p.role !== "crew") fail(`dead infiltrator ${p.id} has a task session`);
    } else if (p.deathCause !== null) fail(`${p.id} is alive with deathCause ${p.deathCause}`);
    if (p.taskSession) {
      const record = state.tasks[p.taskSession.taskId];
      if (!record || record.ownerId !== p.id) fail(`${p.id} works on a task it does not own`);
      else if (record.done) fail(`${p.id} works on a finished task`);
    }
    if (state.phase !== "playing" && (p.taskSession || p.repair || p.ventId)) fail(`${p.id} is busy outside of play`);
  }

  const victims = new Set<string>();
  for (const b of state.bodies) {
    if (victims.has(b.victimId)) fail(`two bodies for ${b.victimId}`);
    victims.add(b.victimId);
    const victim = state.players.find((p) => p.id === b.victimId);
    if (!victim || victim.alive || victim.deathCause !== "killed") fail(`body ${b.id} belongs to a player who was not killed`);
    const killer = state.players.find((p) => p.id === b.killerId);
    if (!killer || killer.role !== "infiltrator") fail(`body ${b.id} has a non-infiltrator killer`);
  }

  const crewDone = Object.values(state.tasks).filter((t) => t.countsForProgress && t.done).length;
  const crewTotal = Object.values(state.tasks).filter((t) => t.countsForProgress).length;
  if (state.taskProgress.completed !== crewDone) fail(`progress ${state.taskProgress.completed} != completed crew tasks ${crewDone}`);
  if (state.taskProgress.total !== crewTotal) fail(`progress total ${state.taskProgress.total} != crew tasks ${crewTotal}`);
  if (state.taskProgress.completed > state.taskProgress.total) fail("progress exceeds total");

  const m = state.meeting;
  if (m) {
    for (const [voter, target] of Object.entries(m.votes)) {
      if (!m.participants.includes(voter)) fail(`${voter} voted without being a participant`);
      if (target !== "skip" && !m.participants.includes(target)) fail(`${voter} voted for non-participant ${target}`);
    }
  }

  if (state.sabotage && state.phase !== "playing") fail(`sabotage ${state.sabotage.kind} active outside of play`);

  if (state.phase === "playing") {
    if (aliveCount(state, "infiltrator") === 0) fail("no living infiltrators but the match is still playing");
    if (aliveCount(state, "infiltrator") >= aliveCount(state, "crew")) fail("infiltrator parity but the match is still playing");
  }
  return out;
}

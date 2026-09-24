import { dist, isCriticalSabotage, secondsToTicks, type AgentGoal, type PlayerObservation, type SabotageKind } from "@deduction/shared";
import { travelDistance } from "@deduction/maps";
import type { AgentContext } from "../context";

export interface RoamChoice {
  readonly goal: AgentGoal;
  readonly reason: string;
  readonly utterance?: string | null;
}

const sec = secondsToTicks;

/** Crew roaming policy: report > act on witnessed crimes > critical repairs > tasks (alone or with a buddy) > patrol. */
export function crewRoam(ctx: AgentContext, obs: PlayerObservation): RoamChoice {
  const { memory, rng } = ctx;
  const p = ctx.personality.traits;
  const name = (id: string) => obs.roster.find((r) => r.id === id)?.name ?? id;
  const pending = obs.tasks.filter((t) => !t.done);

  if (!obs.self.alive) {
    return pending.length > 0 ? { goal: { type: "GO_DO_TASK", taskId: null }, reason: "ghost: keep helping with tasks" } : { goal: { type: "WAIT", durationTicks: sec(15) }, reason: "ghost with nothing left to do" };
  }

  const body = [...obs.visibleBodies].sort((a, b) => dist(a.pos, obs.self.pos) - dist(b.pos, obs.self.pos))[0];
  if (body) return { goal: { type: "REPORT_BODY", bodyId: body.bodyId }, reason: `found ${name(body.victimId)}'s body` };

  const sinceMeeting = memory.lastMeetingEndTick;
  const killSeen = memory.witnessedKills.filter((k) => k.tick >= sinceMeeting && !memory.isKnownDead(k.killerId)).at(-1);
  if (killSeen) {
    if (obs.self.emergencyMeetingsLeft > 0) return { goal: { type: "CALL_MEETING" }, reason: `I saw ${name(killSeen.killerId)} kill someone`, utterance: `${name(killSeen.killerId)} is a killer!` };
    return { goal: { type: "AVOID", playerId: killSeen.killerId, durationTicks: sec(20) }, reason: `staying away from ${name(killSeen.killerId)}` };
  }
  const ventSeen = memory.ventSightings.filter((v) => v.tick >= sinceMeeting && !memory.isKnownDead(v.playerId)).at(-1);
  if (ventSeen && obs.self.emergencyMeetingsLeft > 0 && rng.chance(0.5 + p.aggression * 0.5)) {
    return { goal: { type: "CALL_MEETING" }, reason: `I saw ${name(ventSeen.playerId)} use a vent` };
  }

  const sab = obs.sabotage;
  if (sab) {
    const nearest = Math.min(...sab.stations.filter((s) => !s.fixed).map((s) => travelDistance(ctx.map, obs.self.pos, s.pos)));
    const critical = isCriticalSabotage(sab.kind);
    const willing = critical ? nearest < 70 || rng.chance(0.5) : sab.kind === "lights" ? nearest < 30 && rng.chance(0.7 - p.riskTolerance * 0.3) : rng.chance(0.3);
    if (willing) return { goal: { type: "FIX_SABOTAGE" }, reason: `${sab.kind} is sabotaged` };
  }

  // Someone I strongly suspect is right here and I am alone with them.
  const threat = obs.visiblePlayers
    .filter((v) => !v.ghost && (memory.belief(v.id)?.suspicion ?? 0) >= 0.75)
    .sort((a, b) => dist(a.pos, obs.self.pos) - dist(b.pos, obs.self.pos))[0];
  if (threat && dist(threat.pos, obs.self.pos) < 6 && obs.visiblePlayers.filter((v) => !v.ghost).length === 1) {
    return p.aggression > 0.6 && p.riskTolerance > 0.5
      ? { goal: { type: "OBSERVE", playerId: threat.id, durationTicks: sec(12) }, reason: `keeping an eye on ${name(threat.id)}` }
      : { goal: { type: "AVOID", playerId: threat.id, durationTicks: sec(12) }, reason: `not staying alone with ${name(threat.id)}` };
  }

  if (pending.length > 0) {
    const trusted = obs.visiblePlayers.filter((v) => !v.ghost && (memory.belief(v.id)?.trust ?? 0) >= 0.6).sort((a, b) => (memory.belief(b.id)?.trust ?? 0) - (memory.belief(a.id)?.trust ?? 0))[0];
    if (trusted && rng.chance(p.sociability * 0.35)) {
      return { goal: { type: "BUDDY_UP", playerId: trusted.id, durationTicks: sec(15) }, reason: `sticking with ${name(trusted.id)}, who I trust` };
    }
    return { goal: { type: "GO_DO_TASK", taskId: null }, reason: `${pending.length} tasks left` };
  }

  const top = memory.suspects()[0];
  if (top && top.suspicion >= 0.5 && rng.chance(0.3 + p.aggression * 0.4)) {
    return { goal: { type: "OBSERVE", playerId: top.id, durationTicks: sec(15) }, reason: `watching ${name(top.id)} (suspicion ${Math.round(top.suspicion * 100)})` };
  }
  if (rng.chance(p.sociability)) return { goal: { type: "SEEK_GROUP", durationTicks: sec(20) }, reason: "tasks done; staying with the group" };
  const room = rng.pick(ctx.map.areas.filter((a) => a.kind === "room")).id;
  return { goal: { type: "INVESTIGATE", roomId: room }, reason: "tasks done; patrolling" };
}

/**
 * Infiltrator policy: never leave a fresh body behind, strike isolated targets when the kill is ready,
 * sabotage to split the crew, and otherwise fake tasks and build alibis.
 */
export function infiltratorRoam(ctx: AgentContext, obs: PlayerObservation): RoamChoice {
  const { memory, rng } = ctx;
  const p = ctx.personality.traits;
  const self = obs.self;
  const name = (id: string) => obs.roster.find((r) => r.id === id)?.name ?? id;
  const mates = new Set(obs.teammates);
  const others = obs.visiblePlayers.filter((v) => !v.ghost && !mates.has(v.id));

  if (!self.alive) {
    const kind = obs.legal.sabotage.length > 0 && rng.chance(0.3) ? rng.pick(obs.legal.sabotage) : null;
    return kind ? { goal: { type: "SABOTAGE", kind }, reason: "ghost sabotage" } : { goal: { type: "WAIT", durationTicks: sec(20) }, reason: "ghost" };
  }
  if (self.inVentId !== null) return { goal: { type: "EXIT_VENT" }, reason: "leave the vent" };

  const body = obs.visibleBodies[0];
  if (body) {
    const myKill = memory.episodic.some((m) => m.kind === "own_kill" && m.subjects.includes(body.victimId));
    if (myKill) {
      if (others.length === 0 && rng.chance(0.1 + p.deceptionSkill * 0.25)) return { goal: { type: "SELF_REPORT", bodyId: body.bodyId }, reason: "self-report to look innocent" };
      if (others.length === 0 && obs.legal.ventEnter && rng.chance(0.4 + p.riskTolerance * 0.4)) return { goal: { type: "VENT", ventId: null }, reason: "escape through the vent" };
      return { goal: { type: "FLEE_BODY" }, reason: "get away from the body" };
    }
    if (others.length > 0 && rng.chance(0.5)) return { goal: { type: "REPORT_BODY", bodyId: body.bodyId }, reason: "someone will report it anyway — look helpful" };
    return { goal: { type: "FLEE_BODY" }, reason: "not getting caught near a body" };
  }

  const sab = obs.sabotage;
  if (sab && isCriticalSabotage(sab.kind)) {
    const station = sab.stations.find((s) => !s.fixed);
    if (station && rng.chance(0.5 + p.aggression * 0.3)) return { goal: { type: "HUNT", playerId: null, durationTicks: sec(15) }, reason: "the crew is split up by the sabotage" };
    if (station) return { goal: { type: "MOVE_TO", roomId: station.roomId }, reason: "pretend to help with the sabotage" };
  }

  const killReady = (self.killCooldownTicks ?? 1) === 0;
  if (killReady) {
    const lone = others.filter((t) => others.every((o) => o.id === t.id || dist(o.pos, t.pos) > 7));
    const target = lone.sort((a, b) => dist(a.pos, self.pos) - dist(b.pos, self.pos))[0];
    const crowded = others.length > 1;
    if (target && !crowded && rng.chance(0.45 + p.aggression * 0.35 + p.riskTolerance * 0.15)) {
      return { goal: { type: "KILL", playerId: target.id }, reason: `${name(target.id)} is alone` };
    }
    if (rng.chance(0.4 + p.aggression * 0.4)) return { goal: { type: "HUNT", playerId: null, durationTicks: sec(20) }, reason: "kill is ready — looking for someone alone" };
  }

  if (obs.legal.sabotage.length > 0 && rng.chance(0.15 + p.aggression * 0.15)) {
    const weights: Record<SabotageKind, number> = { lights: killReady ? 0.5 : 0.25, reactor: 0.25, oxygen: 0.25, comms: 0.12 };
    const kind = rng.weighted(obs.legal.sabotage, (k) => weights[k]);
    return { goal: { type: "SABOTAGE", kind }, reason: `sabotage ${kind} to split the crew` };
  }

  if (others.length > 0 && rng.chance(p.sociability * 0.3)) {
    return { goal: { type: "CREATE_ALIBI", playerId: others[0]!.id, durationTicks: sec(15) }, reason: `being seen with ${name(others[0]!.id)}` };
  }
  const frameTarget = memory.suspects().find((s) => s.suspicion > 0.4);
  if (frameTarget && rng.chance(p.deceptionSkill * 0.15)) {
    return { goal: { type: "FRAME_PLAYER", playerId: frameTarget.id, durationTicks: sec(15) }, reason: `${name(frameTarget.id)} already looks suspicious` };
  }
  if (obs.tasks.some((t) => !t.done)) return { goal: { type: "FAKE_TASK", taskId: null }, reason: "fake a task to blend in" };
  return { goal: { type: "SEEK_ISOLATED_PLAYER", durationTicks: sec(20) }, reason: "wander and look for chances" };
}

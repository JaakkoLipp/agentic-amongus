import { type PlayerId, type PlayerObservation, type VoteTarget } from "@deduction/shared";
import { areaName } from "@deduction/maps";
import type { AgentContext } from "../context";

interface Statement {
  readonly key: string;
  readonly priority: number;
  readonly text: string;
}

/** Meeting messages from this meeting that accuse `target`, by distinct speakers. */
function accusersOf(ctx: AgentContext, obs: PlayerObservation, target: PlayerId): Set<PlayerId> {
  const since = obs.meeting ? obs.meeting.messages[0]?.tick ?? obs.tick : obs.tick;
  const out = new Set<PlayerId>();
  for (const s of ctx.memory.social) if (s.channel === "meeting" && s.tick >= since && s.accuses.includes(target)) out.add(s.speakerId);
  return out;
}

function lastRoomBeforeMeeting(ctx: AgentContext, obs: PlayerObservation, avoid: string | null): string | null {
  const trail = ctx.memory.ownTrail.filter((t) => ctx.map.areaById.get(t.roomId)?.kind === "room");
  const meetingStart = obs.meeting ? obs.tick - 300 : obs.tick;
  const candidates = trail.filter((t) => t.tick <= meetingStart + 300 && t.roomId !== avoid);
  return (candidates.at(-1) ?? trail.at(-1))?.roomId ?? null;
}

/**
 * Grounded meeting statements: every sentence comes from this agent's own memory (what it saw, heard, did).
 * Infiltrators build their lies from the same material — claimed routes, borrowed suspicions, deflections.
 */
export function heuristicStatement(ctx: AgentContext, obs: PlayerObservation, alreadySaid: ReadonlySet<string>, addressedBy: readonly PlayerId[]): { key: string; text: string } | null {
  const { memory, rng, map } = ctx;
  const p = ctx.personality.traits;
  const m = obs.meeting;
  if (!m) return null;
  const name = (id: string) => obs.roster.find((r) => r.id === id)?.name ?? id;
  const room = (id: string | null) => areaName(map, id);
  const participants = new Set(m.participants);
  const options: Statement[] = [];
  const self = obs.self.id;

  if (obs.self.role === "crew") {
    for (const k of memory.witnessedKills) {
      if (participants.has(k.killerId)) options.push({ key: `kill:${k.killerId}`, priority: 100, text: `I saw ${name(k.killerId)} kill ${name(k.victimId)} in ${room(k.roomId)}! Vote ${name(k.killerId)}.` });
    }
    for (const v of memory.ventSightings) {
      if (participants.has(v.playerId)) options.push({ key: `vent:${v.playerId}`, priority: 95, text: `${name(v.playerId)} ${v.action === "enter" ? "went into" : "came out of"} a vent in ${room(v.roomId)}. I saw it myself.` });
    }
    if (m.callerId === self && m.victimId) options.push({ key: "report", priority: 85, text: `I found ${name(m.victimId)}'s body in ${room(m.bodyRoomId)}.` });
    const top = memory.suspects().filter((s) => participants.has(s.id))[0];
    if (top && top.suspicion >= 0.45) {
      const why = memory.belief(top.id)?.evidence.filter((e) => e.suspicionDelta > 0).at(-1)?.reason;
      options.push({ key: `sus:${top.id}`, priority: 40 + top.suspicion * 30 + p.aggression * 10, text: why ? `${name(top.id)} is suspicious: ${why}.` : `I don't trust ${name(top.id)}.` });
    }
    const trusted = [...memory.beliefs.entries()].filter(([id, b]) => participants.has(id) && b.trust >= 0.8).sort((a, b) => b[1].trust - a[1].trust)[0];
    if (trusted) options.push({ key: `clear:${trusted[0]}`, priority: 30, text: `${name(trusted[0])} seems clear to me, I watched them do real tasks.` });
    const where = lastRoomBeforeMeeting(ctx, obs, null);
    options.push({ key: "alibi", priority: addressedBy.length > 0 ? 75 : 20, text: where ? `I was in ${room(where)} doing tasks${addressedBy.length > 0 ? `, ${name(addressedBy[0]!)}` : ""}.` : "I was doing my tasks." });
    if (!top || top.suspicion < 0.45) options.push({ key: "skip", priority: 12, text: "I don't have enough to go on. Skip unless someone saw something." });
  } else {
    const accusedMe = accusersOf(ctx, obs, self);
    const mates = new Set(obs.teammates);
    const where = lastRoomBeforeMeeting(ctx, obs, m.bodyRoomId);
    // Deflect onto whoever the crew already doubts, else onto an accuser, else anyone not on my team.
    const crewCandidates = m.participants.filter((id) => id !== self && !mates.has(id));
    const scapegoat =
      [...crewCandidates].sort((a, b) => accusersOf(ctx, obs, b).size - accusersOf(ctx, obs, a).size || (a < b ? -1 : 1)).find((id) => accusersOf(ctx, obs, id).size > 0) ??
      [...accusedMe].find((id) => !mates.has(id)) ??
      (crewCandidates.length > 0 ? rng.pick(crewCandidates) : null);
    if (accusedMe.size > 0 || addressedBy.length > 0) {
      options.push({
        key: "defend",
        priority: 90,
        text: `${where ? `I was in ${room(where)} the whole time.` : "I was doing tasks."}${scapegoat && rng.chance(0.4 + p.deceptionSkill * 0.5) ? ` Why is nobody asking about ${name(scapegoat)}?` : ""}`,
      });
    }
    if (m.callerId === self && m.victimId) options.push({ key: "report", priority: 85, text: `I found ${name(m.victimId)} in ${room(m.bodyRoomId)}. I just walked in on it.` });
    const frameNote = memory.strategic.find((n) => n.text.startsWith("Trying to frame"));
    const framed = frameNote ? crewCandidates.find((id) => frameNote.text.includes(id)) : undefined;
    if (framed && m.bodyRoomId) options.push({ key: `frame:${framed}`, priority: 55 + p.deceptionSkill * 20, text: `${name(framed)} was hanging around ${room(m.bodyRoomId)} earlier.` });
    if (scapegoat && accusersOf(ctx, obs, scapegoat).size > 0) options.push({ key: `pile:${scapegoat}`, priority: 45, text: `Yeah, ${name(scapegoat)} has been acting weird.` });
    // Betray a teammate who is clearly going down anyway, to buy trust.
    for (const mate of mates) {
      if (participants.has(mate) && accusersOf(ctx, obs, mate).size >= Math.ceil(m.participants.length / 3) && rng.chance(p.deceptionSkill * 0.4)) {
        options.push({ key: `betray:${mate}`, priority: 60, text: `Honestly ${name(mate)} is sus to me too.` });
      }
    }
    options.push({ key: "alibi", priority: 20, text: where ? `I was doing tasks in ${room(where)}.` : "I was doing my tasks." });
  }

  const fresh = options.filter((o) => !alreadySaid.has(o.key)).sort((a, b) => b.priority - a.priority);
  const best = fresh[0];
  if (!best) return null;
  // Low-value lines only get said by talkative agents.
  if (best.priority < 50 && !rng.chance(0.25 + p.talkativeness * 0.75)) return null;
  return { key: best.key, text: best.text };
}

export function heuristicVote(ctx: AgentContext, obs: PlayerObservation): { target: VoteTarget; reason: string } {
  const { memory, rng } = ctx;
  const p = ctx.personality.traits;
  const m = obs.meeting;
  const legal = new Set(obs.legal.vote);
  const name = (id: string) => obs.roster.find((r) => r.id === id)?.name ?? id;
  const ok = (id: PlayerId) => legal.has(id) && id !== obs.self.id;
  if (!m) return { target: "skip", reason: "no meeting" };

  if (obs.self.role === "crew") {
    const killer = memory.witnessedKills.map((k) => k.killerId).find(ok);
    if (killer) return { target: killer, reason: `I saw ${name(killer)} kill` };
    const venter = memory.ventSightings.map((v) => v.playerId).find(ok);
    if (venter) return { target: venter, reason: `I saw ${name(venter)} vent` };
    const threshold = 0.75 - 0.35 * p.voteConfidence;
    const top = memory.suspects().filter((s) => ok(s.id))[0];
    if (top && top.suspicion >= threshold) return { target: top.id, reason: `suspicion ${Math.round(top.suspicion * 100)} >= ${Math.round(threshold * 100)}` };
    return { target: "skip", reason: "not confident enough" };
  }

  const mates = new Set(obs.teammates);
  const crew = m.participants.filter((id) => ok(id) && !mates.has(id));
  const pile = crew.map((id) => ({ id, n: accusersOf(ctx, obs, id).size })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1))[0];
  if (pile && pile.n >= 2) return { target: pile.id, reason: `bandwagon on ${name(pile.id)}` };
  for (const mate of mates) {
    if (ok(mate) && accusersOf(ctx, obs, mate).size >= Math.ceil(m.participants.length / 2) && rng.chance(0.4 * p.deceptionSkill)) {
      return { target: mate, reason: `sacrifice ${name(mate)} to look credible` };
    }
  }
  const accuser = [...accusersOf(ctx, obs, obs.self.id)].find((id) => ok(id) && !mates.has(id));
  if (accuser && rng.chance(p.aggression)) return { target: accuser, reason: `push back on ${name(accuser)}` };
  if (pile && pile.n === 1 && rng.chance(0.3 + p.deceptionSkill * 0.3)) return { target: pile.id, reason: `nudge the vote onto ${name(pile.id)}` };
  return { target: "skip", reason: "stay quiet in the vote" };
}

import {
  clamp,
  formatClock,
  secondsToTicks,
  type DecisionTrigger,
  type PerceivedEvent,
  type PlayerId,
  type PlayerObservation,
  type Role,
  type RosterEntry,
  type TaskId,
  type TaskView,
  type Tick,
} from "@deduction/shared";
import { areaName, type GameMap } from "@deduction/maps";
import type { Personality } from "../personality";
import { parseUtterance } from "./textSignals";
import type {
  BeliefChange,
  EpisodicMemory,
  KnownBody,
  LastKnownLocation,
  MemoryImportance,
  PlayerBelief,
  SocialMemory,
  StrategicNote,
  VentSighting,
  WitnessedKill,
} from "./types";

export interface AgentMemoryOptions {
  readonly selfId: PlayerId;
  readonly map: GameMap;
  readonly personality: Personality;
  /** 0..1, from the lobby "memory quality" setting and AI difficulty. */
  readonly memoryQuality: number;
  /** Public rule knowledge: how many infiltrators exist. */
  readonly infiltratorCount: number;
}

export interface MemoryUpdate {
  readonly triggers: readonly DecisionTrigger[];
  /** True if something happened that makes any in-flight decision stale. */
  readonly invalidates: boolean;
  /** Players who addressed this agent by name since the last update. */
  readonly addressedBy: readonly PlayerId[];
}

const NEAR_BODY_WINDOW_SEC = 25;
const REAPPEAR_TRIGGER_SEC = 8;

/**
 * One agent's private memory, built only from the observations it received. Layers:
 * episodic (what I saw), social (what I heard), beliefs (numeric suspicion/trust with evidence),
 * strategic notes, plus last-known locations and task views seen during observe phases.
 */
export class AgentMemory {
  readonly selfId: PlayerId;
  role: Role = "crew";
  alive = true;
  tick: Tick = 0;
  readonly lastKnown = new Map<PlayerId, LastKnownLocation>();
  readonly episodic: EpisodicMemory[] = [];
  readonly social: SocialMemory[] = [];
  readonly beliefs = new Map<PlayerId, PlayerBelief>();
  readonly beliefTimeline: BeliefChange[] = [];
  readonly strategic: StrategicNote[] = [];
  readonly knownDead = new Set<PlayerId>();
  readonly knownRoles = new Map<PlayerId, Role>();
  readonly teammates = new Set<PlayerId>();
  readonly bodies: KnownBody[] = [];
  readonly witnessedKills: WitnessedKill[] = [];
  readonly ventSightings: VentSighting[] = [];
  /** Rooms this agent itself passed through, for honest alibis. */
  readonly ownTrail: { readonly tick: Tick; readonly roomId: string }[] = [];
  roster: readonly RosterEntry[] = [];
  meetingsSeen = 0;
  lastMeetingEndTick: Tick = 0;
  private readonly taskViews = new Map<TaskId, { attempt: number; views: TaskView[] }>();
  private readonly options: AgentMemoryOptions;
  private nextId = 1;
  private initialized = false;

  constructor(options: AgentMemoryOptions) {
    this.options = options;
    this.selfId = options.selfId;
  }

  get personality(): Personality {
    return this.options.personality;
  }

  /** Ingest one observation. Returns scheduling triggers for the agent host. */
  update(obs: PlayerObservation): MemoryUpdate {
    const triggers = new Set<DecisionTrigger>();
    const addressedBy = new Set<PlayerId>();
    let invalidates = false;
    this.tick = obs.tick;
    this.roster = obs.roster;
    if (!this.initialized) this.initialize(obs);
    if (this.alive && !obs.self.alive) invalidates = true;
    this.alive = obs.self.alive;

    for (const r of obs.roster) {
      if (r.knownStatus !== "alive") this.knownDead.add(r.id);
      if (r.knownRole) this.knownRoles.set(r.id, r.knownRole);
    }
    if (obs.self.roomId && this.ownTrail[this.ownTrail.length - 1]?.roomId !== obs.self.roomId) {
      this.ownTrail.push({ tick: obs.tick, roomId: obs.self.roomId });
      if (this.ownTrail.length > 60) this.ownTrail.shift();
    }

    // Events first: they happened before the live snapshot below, which must always win.
    const previouslySeen = new Map([...this.lastKnown].map(([id, lk]) => [id, lk] as const));
    for (const e of obs.events) {
      const r = this.ingest(e, obs, triggers, addressedBy);
      invalidates ||= r;
    }

    // Live sightings. Players out of view keep their last sighting (never their real position).
    const visibleIds = new Set<PlayerId>();
    for (const v of obs.visiblePlayers) {
      if (v.ghost) continue;
      visibleIds.add(v.id);
      const prev = previouslySeen.get(v.id);
      if (!prev || (!prev.visibleNow && obs.tick - prev.tick > secondsToTicks(REAPPEAR_TRIGGER_SEC))) triggers.add("player_appeared");
      this.lastKnown.set(v.id, { playerId: v.id, pos: v.pos, roomId: v.roomId, tick: obs.tick, heading: null, visibleNow: true });
    }
    for (const [id, lk] of this.lastKnown) {
      if (lk.visibleNow && !visibleIds.has(id)) this.lastKnown.set(id, { ...lk, visibleNow: false });
    }

    if (obs.activeTask) {
      const { taskId, attempt, view } = obs.activeTask;
      let entry = this.taskViews.get(taskId);
      if (!entry || entry.attempt !== attempt) {
        entry = { attempt, views: [] };
        this.taskViews.set(taskId, entry);
      }
      const last = entry.views[entry.views.length - 1];
      if (!last || last.phase !== view.phase) entry.views.push(view);
      if (view.phase === "answer") triggers.add("task_answer_phase");
    }

    if (obs.tick % 90 === 0) this.prune();
    return { triggers: [...triggers], invalidates, addressedBy: [...addressedBy] };
  }

  private initialize(obs: PlayerObservation): void {
    this.initialized = true;
    this.role = obs.self.role;
    for (const t of obs.teammates) this.teammates.add(t);
    const others = obs.roster.filter((r) => r.id !== this.selfId);
    const prior = clamp(this.options.infiltratorCount / Math.max(1, others.length), 0.05, 0.5);
    for (const r of others) {
      const teammate = this.teammates.has(r.id);
      this.beliefs.set(r.id, { suspicion: teammate ? 0 : prior, trust: teammate ? 1 : 0.5, evidence: [] });
    }
  }

  private ingest(e: PerceivedEvent, obs: PlayerObservation, triggers: Set<DecisionTrigger>, addressedBy: Set<PlayerId>): boolean {
    const name = (id: PlayerId) => obs.roster.find((r) => r.id === id)?.name ?? id;
    const room = (id: string | null) => areaName(this.options.map, id);
    switch (e.type) {
      case "PLAYER_LEFT_VISIBILITY": {
        const lk = this.lastKnown.get(e.playerId);
        if (!lk || lk.tick <= e.tick) {
          this.lastKnown.set(e.playerId, { playerId: e.playerId, pos: e.lastPos, roomId: e.roomId, tick: Math.min(lk?.tick ?? e.tick, e.tick), heading: e.heading, visibleNow: false });
        }
        this.remember(e.tick, "low", "lost_sight", `${name(e.playerId)} left my view in ${room(e.roomId)}${e.heading ? ` heading ${e.heading}` : ""}`, [e.playerId], e.roomId);
        triggers.add("player_disappeared");
        return false;
      }
      case "SAW_ENTER_ROOM":
        this.remember(e.tick, "low", "movement", `saw ${name(e.playerId)} enter ${room(e.roomId)}`, [e.playerId], e.roomId);
        return false;
      case "SAW_LEAVE_ROOM":
        this.remember(e.tick, "low", "movement", `saw ${name(e.playerId)} leave ${room(e.roomId)}`, [e.playerId], e.roomId);
        return false;
      case "SAW_TASK_START":
        this.remember(e.tick, "low", "task_seen", `saw ${name(e.playerId)} start using a console in ${room(e.roomId)}`, [e.playerId], e.roomId);
        return false;
      case "SAW_TASK_STOP": {
        // If the public progress bar ticks up at the same moment, that player very likely did a real task.
        const progressSameTick = obs.events.some((x) => x.type === "TASK_PROGRESS" && x.tick === e.tick);
        const stopsSameTick = obs.events.filter((x) => x.type === "SAW_TASK_STOP" && x.tick === e.tick).length;
        if (progressSameTick && stopsSameTick === 1 && this.role === "crew") {
          this.adjust(e.playerId, -0.15, 0.2, `progress bar moved as ${name(e.playerId)} finished a console`);
        }
        return false;
      }
      case "SAW_KILL":
        this.witnessedKills.push({ killerId: e.killerId, victimId: e.victimId, roomId: e.roomId, tick: e.tick });
        this.knownDead.add(e.victimId);
        this.remember(e.tick, "critical", "kill", `SAW ${name(e.killerId)} KILL ${name(e.victimId)} in ${room(e.roomId)}`, [e.killerId, e.victimId], e.roomId);
        if (!this.teammates.has(e.killerId)) this.adjust(e.killerId, 1, -1, `saw them kill ${name(e.victimId)}`);
        this.addBody({ bodyId: e.bodyId, victimId: e.victimId, pos: e.pos, roomId: e.roomId, seenTick: e.tick });
        triggers.add("kill_witnessed");
        triggers.add("body_seen");
        return true;
      case "SAW_BODY":
        this.knownDead.add(e.victimId);
        this.addBody({ bodyId: e.bodyId, victimId: e.victimId, pos: e.pos, roomId: e.roomId, seenTick: e.tick });
        this.remember(e.tick, "critical", "body", `found ${name(e.victimId)}'s body in ${room(e.roomId)}`, [e.victimId], e.roomId);
        this.suspectPlayersNear(e.roomId, e.tick, e.victimId);
        triggers.add("body_seen");
        return true;
      case "SAW_VENT":
        this.ventSightings.push({ playerId: e.playerId, ventId: e.ventId, roomId: e.roomId, tick: e.tick, action: e.action });
        this.remember(e.tick, "critical", "vent", `SAW ${name(e.playerId)} ${e.action === "enter" ? "go into" : "come out of"} a vent in ${room(e.roomId)}`, [e.playerId], e.roomId);
        if (!this.teammates.has(e.playerId)) this.adjust(e.playerId, 1, -1, "saw them use a vent");
        triggers.add("vent_witnessed");
        return true;
      case "HEARD_SPEECH": {
        const toMe = this.recordSpeech(e.tick, e.speakerId, e.text, "nearby", obs);
        if (toMe) addressedBy.add(e.speakerId);
        triggers.add(toMe ? "addressed" : "heard_speech");
        return false;
      }
      case "OWN_TASK_RESULT":
        this.taskViews.delete(e.taskId);
        if (e.result !== "completed") this.remember(e.tick, "low", "task_fail", `my ${e.taskId.split(":")[1] ?? "task"} attempt failed (${e.result})`, [], obs.self.roomId);
        return false;
      case "WAS_KILLED":
        this.alive = false;
        this.remember(e.tick, "critical", "death", `I was killed by ${name(e.killerId)}`, [e.killerId], obs.self.roomId);
        return true;
      case "SABOTAGE_STARTED":
        this.remember(e.tick, "medium", "sabotage", `${e.kind} sabotage started`, [], null);
        triggers.add("sabotage_started");
        return true;
      case "SABOTAGE_FIXED":
        triggers.add("sabotage_ended");
        return true;
      case "BODY_REPORTED":
        this.knownDead.add(e.victimId);
        this.remember(e.tick, "medium", "report", `${name(e.reporterId)} reported ${name(e.victimId)}'s body in ${room(e.roomId)}`, [e.reporterId, e.victimId], e.roomId);
        return true;
      case "EMERGENCY_CALLED":
        this.remember(e.tick, "medium", "emergency", `${name(e.callerId)} called an emergency meeting`, [e.callerId], null);
        return true;
      case "MEETING_STARTED":
        this.meetingsSeen++;
        for (const id of e.deadSinceLastMeeting) this.knownDead.add(id);
        if (e.deadSinceLastMeeting.length > 0) {
          this.remember(e.tick, "medium", "deaths", `dead since last meeting: ${e.deadSinceLastMeeting.map(name).join(", ")}`, [...e.deadSinceLastMeeting], null);
        }
        return true;
      case "MEETING_PHASE":
        return e.phase === "voting" || e.phase === "result";
      case "MEETING_MESSAGE": {
        if (e.playerId === this.selfId) return false;
        const toMe = this.recordSpeech(e.tick, e.playerId, e.text, "meeting", obs);
        if (toMe) addressedBy.add(e.playerId);
        return false;
      }
      case "PLAYER_EJECTED":
        this.knownDead.add(e.playerId);
        if (e.role) this.knownRoles.set(e.playerId, e.role);
        this.remember(e.tick, "critical", "ejection", `${name(e.playerId)} was ejected${e.role ? ` (${e.role})` : ""}`, [e.playerId], null);
        if (e.role) this.learnFromEjection(e.playerId, e.role, obs);
        return false;
      case "MEETING_ENDED":
        this.lastMeetingEndTick = e.tick;
        return true;
      case "MATCH_ENDED":
        for (const [id, role] of Object.entries(e.roles)) this.knownRoles.set(id, role);
        return true;
      case "PLAYER_BECAME_VISIBLE":
      case "TASK_PROGRESS":
      case "OWN_VENT_MOVE":
      case "ACTION_REJECTED":
      case "VOTE_CAST":
      case "VOTES_REVEALED":
        return false;
    }
  }

  private recordSpeech(tick: Tick, speakerId: PlayerId, text: string, channel: "meeting" | "nearby", obs: PlayerObservation): boolean {
    const signal = parseUtterance(text, obs.roster, this.options.map, speakerId);
    const addressedToMe = signal.mentions.includes(this.selfId);
    this.social.push({
      id: this.nextId++,
      tick,
      speakerId,
      text,
      channel,
      accuses: signal.accuses,
      defends: signal.defends,
      roomsMentioned: signal.roomsMentioned,
      addressedToMe,
      expiresAtTick: tick + this.ttl(channel === "meeting" ? "medium" : "low"),
    });
    if (this.social.length > 400) this.social.splice(0, this.social.length - 400);
    const speakerTrust = this.beliefs.get(speakerId)?.trust ?? 0.5;
    const speakerSusp = this.beliefs.get(speakerId)?.suspicion ?? 0.3;
    const credibility = clamp(speakerTrust - speakerSusp * 0.5, 0.05, 1);
    const speaker = obs.roster.find((r) => r.id === speakerId)?.name ?? speakerId;
    for (const target of signal.accuses) {
      if (target === this.selfId) {
        // I know my own role: a crew member accused falsely learns something about the accuser.
        if (this.role === "crew") this.adjust(speakerId, 0.12, -0.1, `${speaker} accused me, and I know I am innocent`);
        continue;
      }
      if (this.teammates.has(target)) continue;
      this.adjust(target, 0.12 * credibility, -0.03, `${speaker} accused them`);
    }
    for (const target of signal.defends) {
      if (target === this.selfId || this.teammates.has(target)) continue;
      this.adjust(target, -0.06 * credibility, 0.06 * credibility, `${speaker} vouched for them`);
    }
    return addressedToMe;
  }

  private learnFromEjection(ejectedId: PlayerId, role: Role, obs: PlayerObservation): void {
    const lastVotes = [...obs.events].reverse().find((x) => x.type === "VOTES_REVEALED");
    if (lastVotes?.type !== "VOTES_REVEALED") return;
    for (const [voter, target] of Object.entries(lastVotes.votes)) {
      if (voter === this.selfId || target !== ejectedId) continue;
      if (role === "infiltrator") this.adjust(voter, -0.1, 0.12, `voted out ${ejectedId}, who was an infiltrator`);
      else this.adjust(voter, 0.1, -0.08, `voted out ${ejectedId}, who was crew`);
    }
  }

  private suspectPlayersNear(roomId: string | null, tick: Tick, victimId: PlayerId): void {
    if (!roomId || this.role !== "crew") return;
    const neighbours = new Set([roomId, ...(this.options.map.adjacency.get(roomId) ?? [])]);
    const window = secondsToTicks(NEAR_BODY_WINDOW_SEC);
    for (const lk of this.lastKnown.values()) {
      if (lk.playerId === victimId || lk.playerId === this.selfId || !lk.roomId) continue;
      if (tick - lk.tick > window || !neighbours.has(lk.roomId)) continue;
      const weight = lk.roomId === roomId ? 0.25 : 0.1;
      this.adjust(lk.playerId, weight * (1 - (tick - lk.tick) / window), 0, `seen near ${areaName(this.options.map, roomId)} shortly before the body was found`);
    }
  }

  private addBody(b: KnownBody): void {
    if (!this.bodies.some((x) => x.bodyId === b.bodyId)) this.bodies.push(b);
  }

  /** Deterministic numeric belief layer. Personality scales the deltas; every change is logged with a reason. */
  adjust(playerId: PlayerId, suspicionDelta: number, trustDelta: number, reason: string): void {
    const b = this.beliefs.get(playerId);
    if (!b) return;
    const p = this.options.personality;
    const sd = suspicionDelta >= 1 || suspicionDelta <= -1 ? suspicionDelta : suspicionDelta * (0.5 + p.suspicionRate);
    const td = trustDelta >= 1 || trustDelta <= -1 ? trustDelta : trustDelta * (0.5 + p.trustRate);
    const before = { s: b.suspicion, t: b.trust };
    b.suspicion = clamp(b.suspicion + sd, 0, 1);
    b.trust = clamp(b.trust + td, 0, 1);
    b.evidence.push({ tick: this.tick, suspicionDelta: b.suspicion - before.s, trustDelta: b.trust - before.t, reason });
    if (b.evidence.length > 40) b.evidence.shift();
    if (Math.abs(b.suspicion - before.s) >= 0.01 || Math.abs(b.trust - before.t) >= 0.01) {
      this.beliefTimeline.push({ tick: this.tick, playerId, suspicionBefore: before.s, suspicionAfter: b.suspicion, trustBefore: before.t, trustAfter: b.trust, reason });
    }
  }

  note(text: string, ttlSec: number | null = 120): void {
    this.strategic.push({ tick: this.tick, text, expiresAtTick: ttlSec === null ? null : this.tick + secondsToTicks(ttlSec) });
    if (this.strategic.length > 20) this.strategic.shift();
  }

  remember(tick: Tick, importance: MemoryImportance, kind: string, text: string, subjects: readonly PlayerId[], roomId: string | null): void {
    const ttl = this.ttl(importance);
    this.episodic.push({ id: this.nextId++, tick, importance, kind, text, subjects, roomId, expiresAtTick: ttl === Infinity ? null : tick + ttl });
  }

  /** Lifetime in ticks for a memory class, scaled by memory quality and the agent's memory reliance. */
  ttl(importance: MemoryImportance): number {
    const q = this.options.memoryQuality;
    const r = this.options.personality.memoryReliance;
    switch (importance) {
      case "critical":
        return Infinity;
      case "medium":
        return secondsToTicks(180 + 300 * q * (0.5 + r / 2));
      case "low":
        return secondsToTicks(45 + 180 * q * (0.5 + r / 2));
    }
  }

  prune(): void {
    const alive = <T extends { expiresAtTick: Tick | null }>(x: T) => x.expiresAtTick === null || x.expiresAtTick > this.tick;
    const keepEpisodic = this.episodic.filter(alive);
    this.episodic.splice(0, this.episodic.length, ...keepEpisodic);
    const keepSocial = this.social.filter(alive);
    this.social.splice(0, this.social.length, ...keepSocial);
    const keepNotes = this.strategic.filter(alive);
    this.strategic.splice(0, this.strategic.length, ...keepNotes);
    // Last-known locations fade too: very old sightings are forgotten unless memory reliance is high.
    const forgetAfter = this.ttl("low") * 2;
    for (const [id, lk] of this.lastKnown) if (!lk.visibleNow && this.tick - lk.tick > forgetAfter) this.lastKnown.delete(id);
  }

  taskViewsFor(taskId: TaskId): readonly TaskView[] {
    return this.taskViews.get(taskId)?.views ?? [];
  }

  belief(playerId: PlayerId): PlayerBelief | undefined {
    return this.beliefs.get(playerId);
  }

  isKnownDead(id: PlayerId): boolean {
    return this.knownDead.has(id);
  }

  /** Living, non-teammate players ordered by suspicion (highest first). */
  suspects(): { id: PlayerId; suspicion: number; trust: number }[] {
    return [...this.beliefs.entries()]
      .filter(([id]) => !this.knownDead.has(id) && !this.teammates.has(id) && this.knownRoles.get(id) !== "crew")
      .map(([id, b]) => ({ id, suspicion: b.suspicion, trust: b.trust }))
      .sort((a, b) => b.suspicion - a.suspicion || (a.id < b.id ? -1 : 1));
  }

  recentEpisodic(limit: number, minImportance: MemoryImportance = "low"): EpisodicMemory[] {
    const rank = { low: 0, medium: 1, critical: 2 } as const;
    return this.episodic.filter((m) => rank[m.importance] >= rank[minImportance]).slice(-limit);
  }

  /** Human-readable timeline line, e.g. "02:14 saw Purple enter Electrical". */
  static format(m: EpisodicMemory): string {
    return `${formatClock(m.tick)} ${m.text}`;
  }
}

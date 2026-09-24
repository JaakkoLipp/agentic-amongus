import {
  describeGoal,
  goalAllowedForRole,
  secondsToTicks,
  type ActionResult,
  type AgentDecision,
  type AgentGoal,
  type DecisionKind,
  type DecisionRequest,
  type DecisionTrigger,
  type GameSettings,
  type MoveIntent,
  type PlayerAction,
  type PlayerController,
  type PlayerId,
  type PlayerObservation,
  type Rng,
  type TaskAnswer,
  type TaskId,
  type Tick,
} from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import type { AgentMemory } from "./memory/agentMemory";
import type { AssignedPersonality } from "./personality";
import { executeGoal, type ActiveGoal } from "./executor";
import { fallbackDecision } from "./controllers/fallback";

export interface AgentHostOptions {
  readonly playerId: PlayerId;
  readonly controller: PlayerController;
  readonly memory: AgentMemory;
  readonly personality: AssignedPersonality;
  readonly map: GameMap;
  readonly settings: GameSettings;
  /** Executor/scheduling randomness (separate stream from the controller's). */
  readonly rng: Rng;
  /** Roaming heartbeat interval range in seconds. */
  readonly heartbeatSec?: readonly [number, number];
}

export type DecisionOutcome = "applied" | "stale" | "invalid";

export interface GoalRecord {
  readonly tick: Tick;
  readonly goal: string;
  readonly reason: string | null;
  readonly source: "controller" | "fallback";
  ended?: { readonly tick: Tick; readonly status: "done" | "failed" | "replaced"; readonly note: string | null };
}

export interface DecisionRecord {
  readonly tick: Tick;
  readonly kind: DecisionKind;
  readonly outcome: DecisionOutcome;
  readonly source: "controller" | "fallback";
  readonly summary: string;
  readonly reasonSummary: string | null;
}

/** Triggers that justify re-deciding before the heartbeat. */
const URGENT: ReadonlySet<DecisionTrigger> = new Set<DecisionTrigger>([
  "goal_completed",
  "goal_failed",
  "body_seen",
  "kill_witnessed",
  "vent_witnessed",
  "sabotage_started",
  "sabotage_ended",
  "addressed",
  "revision_changed",
  "kill_opportunity",
]);
const MIN_DECISION_GAP_SEC = 1;

/**
 * Runs one AI seat: owns its memory, its current goal and the goal executor, and decides WHEN the controller
 * should be asked for a decision. It never talks to the engine directly — the runtime feeds it observations and
 * applies the movement intents/actions it returns. Controllers may be slow; the agent keeps executing its current
 * goal while a decision is in flight, and results that arrive after the decision revision moved on are discarded.
 */
export class AgentHost {
  readonly playerId: PlayerId;
  readonly controller: PlayerController;
  readonly memory: AgentMemory;
  readonly personality: AssignedPersonality;
  readonly goalHistory: GoalRecord[] = [];
  readonly decisionLog: DecisionRecord[] = [];
  revision = 0;
  lastObservation: PlayerObservation | null = null;

  private goal: ActiveGoal | null = null;
  private goalRecord: GoalRecord | null = null;
  private pendingPlay: DecisionKind | null = null;
  private pendingMeeting = new Set<DecisionKind>();
  private triggers = new Set<DecisionTrigger>(["initial"]);
  private addressedBy = new Set<PlayerId>();
  private nextHeartbeat: Tick = 0;
  private lastDecisionTick: Tick = -1000;
  private scheduledAnswer: { taskId: TaskId; answer: TaskAnswer; atTick: Tick } | null = null;
  private answeredKey: string | null = null;
  private queued: PlayerAction[] = [];
  private lastPhase: PlayerObservation["phase"] | null = null;
  private readonly opts: AgentHostOptions;

  constructor(opts: AgentHostOptions) {
    this.opts = opts;
    this.playerId = opts.playerId;
    this.controller = opts.controller;
    this.memory = opts.memory;
    this.personality = opts.personality;
  }

  get currentGoal(): AgentGoal | null {
    return this.goal?.goal ?? null;
  }

  get hasPendingDecision(): boolean {
    return this.pendingPlay !== null || this.pendingMeeting.size > 0;
  }

  /** Ingest the latest observation (memory, triggers, invalidation). */
  perceive(obs: PlayerObservation): void {
    this.lastObservation = obs;
    const update = this.memory.update(obs);
    for (const t of update.triggers) this.triggers.add(t);
    for (const id of update.addressedBy) this.addressedBy.add(id);
    if (update.invalidates) this.bumpRevision();
    if (this.lastPhase !== obs.phase) {
      if (this.lastPhase !== null) this.bumpRevision();
      this.lastPhase = obs.phase;
      this.endGoal("replaced", `phase changed to ${obs.phase}`);
      this.scheduledAnswer = null;
      this.queued = [];
    }
    if (this.scheduledAnswer && obs.activeTask?.taskId !== this.scheduledAnswer.taskId) this.scheduledAnswer = null;
    if (obs.self.role === "infiltrator" && obs.legal.kill.length > 0 && this.goal?.goal.type !== "KILL" && this.goal?.goal.type !== "HUNT") {
      this.triggers.add("kill_opportunity");
    }
  }

  /** Movement intent and actions for this agent step. Only meaningful while playing. */
  step(obs: PlayerObservation): { move: MoveIntent | null; actions: PlayerAction[] } {
    const actions = this.queued;
    this.queued = [];
    if (obs.phase !== "playing") return { move: null, actions };

    if (this.scheduledAnswer && obs.tick >= this.scheduledAnswer.atTick) {
      if (obs.legal.submitAnswer === this.scheduledAnswer.taskId) {
        actions.push({ type: "SUBMIT_TASK_ANSWER", taskId: this.scheduledAnswer.taskId, answer: this.scheduledAnswer.answer });
      }
      this.scheduledAnswer = null;
    }
    if (!this.goal) return { move: obs.activeTask || obs.self.repairingStationId ? null : { mode: "stop" }, actions };

    const result = executeGoal({ obs, memory: this.memory, map: this.opts.map, settings: this.opts.settings, rng: this.opts.rng }, this.goal);
    actions.push(...result.actions);
    if (result.status !== "running") {
      this.triggers.add(result.status === "done" ? "goal_completed" : "goal_failed");
      this.endGoal(result.status, result.note ?? null);
    }
    return { move: result.move, actions };
  }

  /** Feedback from the engine for actions this agent submitted. */
  actionResult(action: PlayerAction, result: ActionResult, tick: Tick): void {
    if (action.type === "KILL" && result.ok) {
      const victim = this.memory.roster.find((r) => r.id === action.targetId)?.name ?? action.targetId;
      this.memory.remember(tick, "critical", "own_kill", `I killed ${victim}`, [action.targetId], this.lastObservation?.self.roomId ?? null);
      this.memory.note(`Avoid being seen near ${victim}'s body.`, 90);
    }
  }

  /**
   * Whether the controller should be asked for a playing-phase decision now (roam or task answer).
   * Heartbeat every few seconds (jittered), earlier on urgent triggers, never more than one in flight.
   */
  nextRequest(obs: PlayerObservation): DecisionRequest | null {
    if (this.pendingPlay !== null || obs.phase !== "playing") return null;
    const task = obs.activeTask;
    if (task) {
      const key = `${task.taskId}#${task.attempt}`;
      if (task.phase === "answer" && !this.scheduledAnswer && this.answeredKey !== key) {
        return this.makeRequest("task_answer", obs, ["task_answer_phase"]);
      }
      return null;
    }
    if (obs.self.repairingStationId && this.goal) return null;
    const urgent = [...this.triggers].some((t) => URGENT.has(t));
    const due = !this.goal || obs.tick >= this.nextHeartbeat || urgent;
    if (!due) return null;
    if (this.goal && obs.tick - this.lastDecisionTick < secondsToTicks(MIN_DECISION_GAP_SEC)) return null;
    const triggers = this.triggers.size > 0 ? [...this.triggers] : (["heartbeat"] as DecisionTrigger[]);
    return this.makeRequest("roam", obs, triggers);
  }

  /** Meeting speech and votes are requested by the runtime's meeting director. */
  meetingRequest(kind: "meeting_speech" | "vote", obs: PlayerObservation): DecisionRequest | null {
    if (this.pendingMeeting.has(kind) || obs.phase !== "meeting" || !obs.self.alive) return null;
    const trigger: DecisionTrigger = kind === "vote" ? "voting_started" : this.addressedBy.size > 0 ? "addressed" : "meeting_turn";
    return this.makeRequest(kind, obs, [trigger]);
  }

  private makeRequest(kind: DecisionKind, obs: PlayerObservation, triggers: readonly DecisionTrigger[]): DecisionRequest {
    const request: DecisionRequest = {
      kind,
      revision: this.revision,
      tick: obs.tick,
      triggers,
      ...(kind === "meeting_speech" ? { addressedBy: [...this.addressedBy] } : {}),
    };
    if (kind === "roam" || kind === "task_answer") {
      this.pendingPlay = kind;
      if (kind === "roam") {
        this.triggers.clear();
        const [lo, hi] = this.opts.heartbeatSec ?? [3, 6];
        this.nextHeartbeat = obs.tick + secondsToTicks(this.opts.rng.float(lo, hi));
        this.lastDecisionTick = obs.tick;
      }
    } else {
      this.pendingMeeting.add(kind);
      if (kind === "meeting_speech") this.addressedBy.clear();
    }
    return request;
  }

  private clearPending(request: DecisionRequest): void {
    if (request.kind === "roam" || request.kind === "task_answer") {
      if (this.pendingPlay === request.kind) this.pendingPlay = null;
    } else this.pendingMeeting.delete(request.kind);
  }

  /**
   * Apply a decision for a request this host issued. Returns actions to submit right away.
   * Stale (revision moved on) and invalid decisions change nothing.
   */
  accept(request: DecisionRequest, decision: AgentDecision, source: "controller" | "fallback"): { outcome: DecisionOutcome; actions: PlayerAction[] } {
    this.clearPending(request);
    const obs = this.lastObservation;
    const log = (outcome: DecisionOutcome, summary: string) => {
      this.decisionLog.push({ tick: obs?.tick ?? request.tick, kind: request.kind, outcome, source, summary, reasonSummary: "reasonSummary" in decision ? decision.reasonSummary : null });
      if (this.decisionLog.length > 500) this.decisionLog.shift();
    };
    // Votes and speech stay valid across harmless revisions within the same meeting phase group;
    // everything else must match exactly.
    if (request.revision !== this.revision) {
      log("stale", `stale ${request.kind} (rev ${request.revision} -> ${this.revision})`);
      if (request.kind === "roam") this.triggers.add("revision_changed");
      return { outcome: "stale", actions: [] };
    }
    if (decision.kind !== request.kind || !obs) {
      log("invalid", `expected ${request.kind}, got ${decision.kind}`);
      return { outcome: "invalid", actions: [] };
    }
    switch (decision.kind) {
      case "roam": {
        const problem = this.validateGoal(decision.goal, obs);
        if (problem) {
          log("invalid", `invalid goal ${describeGoal(decision.goal)}: ${problem}`);
          return { outcome: "invalid", actions: [] };
        }
        this.adoptGoal(decision.goal, decision.reasonSummary, source, obs.tick);
        log("applied", describeGoal(decision.goal));
        const actions: PlayerAction[] = [];
        if (decision.utterance && obs.legal.speak) actions.push({ type: "SPEAK", text: decision.utterance });
        return { outcome: "applied", actions };
      }
      case "task_answer": {
        const task = obs.activeTask;
        if (!task || task.taskId !== decision.taskId) {
          log("stale", "task no longer active");
          return { outcome: "stale", actions: [] };
        }
        this.answeredKey = `${task.taskId}#${task.attempt}`;
        if (decision.answer === null) {
          log("applied", `gave up on ${task.taskId}`);
          return { outcome: "applied", actions: [{ type: "CANCEL_TASK" }] };
        }
        this.scheduledAnswer = { taskId: task.taskId, answer: decision.answer, atTick: obs.tick + Math.max(0, decision.thinkTicks) };
        log("applied", `answer ${task.taskId}`);
        return { outcome: "applied", actions: [] };
      }
      case "meeting_speech":
        log("applied", decision.text ? `said: ${decision.text}` : "stayed quiet");
        return { outcome: "applied", actions: decision.text ? [{ type: "SPEAK", text: decision.text }] : [] };
      case "vote":
        log("applied", `vote ${decision.target}`);
        return { outcome: "applied", actions: [{ type: "VOTE", target: decision.target }] };
    }
  }

  /** Deterministic replacement when the controller failed (error, timeout, invalid output). Apply it via `accept`. */
  fallbackFor(request: DecisionRequest): AgentDecision | null {
    const obs = this.lastObservation;
    return obs ? fallbackDecision(request, obs) : null;
  }

  /** Give up on a request without applying anything (frees the slot so a new request can be made). */
  release(request: DecisionRequest): void {
    this.clearPending(request);
  }

  private adoptGoal(goal: AgentGoal, reason: string | null, source: "controller" | "fallback", tick: Tick): void {
    this.endGoal("replaced", null);
    this.goal = { goal, startedTick: tick, scratch: {} };
    this.goalRecord = { tick, goal: describeGoal(goal), reason, source };
    this.goalHistory.push(this.goalRecord);
    if (this.goalHistory.length > 1000) this.goalHistory.shift();
  }

  private endGoal(status: "done" | "failed" | "replaced", note: string | null): void {
    if (this.goalRecord && !this.goalRecord.ended) this.goalRecord.ended = { tick: this.lastObservation?.tick ?? 0, status, note };
    this.goal = null;
    this.goalRecord = null;
  }

  private bumpRevision(): void {
    this.revision++;
    this.triggers.add("revision_changed");
  }

  /** Semantic check of a structurally valid goal against what this agent knows. */
  private validateGoal(goal: AgentGoal, obs: PlayerObservation): string | null {
    if (!goalAllowedForRole(goal.type, obs.self.role)) return "not allowed for my role";
    const known = new Set(obs.roster.map((r) => r.id));
    const map = this.opts.map;
    switch (goal.type) {
      case "FOLLOW":
      case "AVOID":
      case "OBSERVE":
      case "BUDDY_UP":
      case "CONFRONT":
      case "KILL":
      case "FRAME_PLAYER":
      case "PROTECT_TEAMMATE":
        if (!known.has(goal.playerId)) return `unknown player ${goal.playerId}`;
        if (goal.playerId === obs.self.id) return "cannot target myself";
        if (goal.type === "PROTECT_TEAMMATE" && !obs.teammates.includes(goal.playerId)) return "not a teammate";
        if (goal.type === "KILL" && obs.teammates.includes(goal.playerId)) return "cannot kill a teammate";
        return null;
      case "HUNT":
      case "CREATE_ALIBI":
        return goal.playerId !== null && !known.has(goal.playerId) ? `unknown player ${goal.playerId}` : null;
      case "MOVE_TO":
      case "INVESTIGATE":
        return map.areaById.has(goal.roomId) ? null : `unknown room ${goal.roomId}`;
      case "GO_DO_TASK":
      case "FAKE_TASK":
        return goal.taskId !== null && !obs.tasks.some((t) => t.taskId === goal.taskId) ? `not my task ${goal.taskId}` : null;
      case "VENT":
        return goal.ventId !== null && !map.ventById.has(goal.ventId) ? `unknown vent ${goal.ventId}` : null;
      default:
        return null;
    }
  }
}

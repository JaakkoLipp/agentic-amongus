import {
  deriveRng,
  resolveGameSettings,
  secondsToTicks,
  type AgentDecision,
  type AiDifficulty,
  type ControllerKind,
  type DecisionRequest,
  type GameSettingsInput,
  type PlayerAction,
  type PlayerController,
  type PlayerId,
  type PlayerObservation,
  type Role,
  type RosterEntry,
  type Team,
  type Tick,
  type WinReason,
} from "@deduction/shared";
import { checkInvariants, Match, meetingView, ReplayRecorder } from "@deduction/engine";
import { AgentHost, AgentMemory, assignPersonalities, HeuristicController, RandomController, type AgentContext } from "@deduction/ai";
import { MeetingDirector } from "./meetingDirector";
import { emptyMetrics, recordEvent, type MatchMetrics } from "./metrics";

export type RunnerMode = "lockstep" | "realtime";

export interface RunnerAiOptions {
  readonly difficulty?: AiDifficulty;
  readonly memoryQuality?: number;
  readonly personalityVariation?: number;
}

export interface MatchRunnerOptions {
  readonly settings?: GameSettingsInput;
  readonly matchId?: string;
  readonly ai?: RunnerAiOptions;
  /** Controller per seat; unspecified seats use `defaultController`. "human" seats get no agent host. */
  readonly seats?: Readonly<Record<PlayerId, ControllerKind>>;
  readonly defaultController?: Exclude<ControllerKind, "human">;
  /** Build a controller for an AI seat (tests, LLM agents). Returning null uses the built-in controller. */
  readonly controllerFactory?: (ctx: AgentContext, kind: ControllerKind) => PlayerController | null;
  /**
   * lockstep: every in-flight decision is awaited before the next tick (deterministic; headless simulation).
   * realtime: decisions land whenever they resolve; the simulation never waits (server play with LLMs).
   */
  readonly mode?: RunnerMode;
  readonly checkInvariants?: boolean;
  readonly recordEvents?: boolean;
  readonly recordReplay?: boolean;
  /** Timeout for slow (LLM) controllers. Built-in controllers are never timed out. */
  readonly decisionTimeoutMs?: number;
  /** Agents perceive and run their executors every N ticks (staggered by seat). */
  readonly agentStepTicks?: number;
}

export interface MatchSummary {
  readonly matchId: string;
  readonly seed: number;
  readonly winner: Team | null;
  readonly reason: WinReason | null;
  readonly durationTicks: Tick;
  readonly stalled: boolean;
  readonly roles: Readonly<Record<PlayerId, Role>>;
  readonly controllers: Readonly<Record<PlayerId, ControllerKind>>;
  readonly metrics: MatchMetrics;
}

const MAX_VIOLATIONS = 20;

class DecisionTimeout extends Error {}

/**
 * Glue between the authoritative engine and the players. Owns one agent host per AI seat, the meeting director
 * and metrics. The engine stays unaware of controllers; this runner converts agent output into ordinary validated
 * actions and movement intents.
 */
export class MatchRunner {
  readonly match: Match;
  readonly hosts = new Map<PlayerId, AgentHost>();
  readonly controllers: Record<PlayerId, ControllerKind> = {};
  readonly metrics: MatchMetrics = emptyMetrics();
  readonly replay: ReplayRecorder | null;
  private readonly director: MeetingDirector;
  private readonly pending = new Set<Promise<void>>();
  private readonly opts: MatchRunnerOptions;
  private readonly stepEvery: number;
  private readonly hostOrder: AgentHost[];
  private realtimeTimer: ReturnType<typeof setInterval> | null = null;
  private asyncError: Error | null = null;

  constructor(opts: MatchRunnerOptions = {}) {
    this.opts = opts;
    const settings = resolveGameSettings(opts.settings ?? {});
    this.match = new Match({ settings, recordEvents: opts.recordEvents ?? false, ...(opts.matchId ? { matchId: opts.matchId } : {}) });
    this.stepEvery = Math.max(1, opts.agentStepTicks ?? 3);
    const state = this.match.state;
    const ai = opts.ai ?? {};
    const personalities = assignPersonalities(state.players.map((p) => p.id), settings.seed, ai.personalityVariation ?? 0.3);

    for (const p of state.players) {
      const kind = opts.seats?.[p.id] ?? opts.defaultController ?? "heuristic";
      this.controllers[p.id] = kind;
      if (kind === "human") continue;
      const personality = personalities[p.id]!;
      const memoryQuality = ai.memoryQuality ?? 0.7;
      const memory = new AgentMemory({ selfId: p.id, map: this.match.map, personality: personality.traits, memoryQuality, infiltratorCount: settings.infiltratorCount });
      const ctx: AgentContext = {
        playerId: p.id,
        memory,
        personality,
        map: this.match.map,
        settings,
        difficulty: ai.difficulty ?? "normal",
        memoryQuality,
        rng: deriveRng(settings.seed, "controller", p.id),
      };
      const controller = opts.controllerFactory?.(ctx, kind) ?? builtInController(ctx, kind);
      this.hosts.set(p.id, new AgentHost({ playerId: p.id, controller, memory, personality, map: this.match.map, settings, rng: deriveRng(settings.seed, "host", p.id) }));
    }
    this.hostOrder = [...this.hosts.values()];

    const roster: RosterEntry[] = state.players.map((p) => ({ id: p.id, name: p.name, color: p.color, knownStatus: "alive", knownRole: null }));
    this.director = new MeetingDirector(this.hosts, this.match.map, deriveRng(settings.seed, "director"), roster);
    this.match.onEvent((e, s) => recordEvent(this.metrics, e, s));
    this.metrics.crewTasksTotal = state.taskProgress.total;
    this.replay = opts.recordReplay ? new ReplayRecorder(this.match, this.controllers) : null;
  }

  get isOver(): boolean {
    return this.match.isOver;
  }

  /** Human input path (server): direct movement. */
  setHumanMove(playerId: PlayerId, dir: { x: number; y: number }): void {
    if (this.controllers[playerId] === "human") this.match.setMoveIntent(playerId, { mode: "direction", dir });
  }

  /** Human input path (server): any discrete action, validated by the engine like everyone else's. */
  submitHumanAction(playerId: PlayerId, action: PlayerAction) {
    return this.match.submitAction(playerId, action);
  }

  /** Synchronous part of one simulation tick: agents perceive/act, the director hands out turns, the engine steps. */
  tick(): void {
    const match = this.match;
    if (match.isOver) return;
    const t = match.tick;
    this.hostOrder.forEach((host, i) => {
      if ((t + i) % this.stepEvery === 0) this.stepAgent(host);
    });

    for (const req of this.director.update(t, meetingView(match.state))) {
      const obs = match.observe(req.host.playerId);
      req.host.perceive(obs);
      const request = req.host.meetingRequest(req.kind, obs);
      if (request) this.launch(req.host, request, obs);
    }

    match.step();

    if (this.opts.checkInvariants) {
      const violations = checkInvariants(match.state, match.map);
      if (violations.length > 0 && this.metrics.invariantViolations.length < MAX_VIOLATIONS) this.metrics.invariantViolations.push(...violations.slice(0, MAX_VIOLATIONS));
    }
    if (match.isOver) this.finish();
  }

  /** Wait until every in-flight decision has been applied (lockstep). */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
    if (this.asyncError) throw this.asyncError;
  }

  async runToEnd(maxTicks?: number): Promise<MatchSummary> {
    const limit = maxTicks ?? secondsToTicks(this.match.state.settings.maxMatchSec) + 30;
    const lockstep = (this.opts.mode ?? "lockstep") === "lockstep";
    while (!this.match.isOver && this.match.tick < limit) {
      this.tick();
      if (lockstep && this.pending.size > 0) await this.settle();
    }
    await this.settle();
    return this.summary();
  }

  /** Real-time loop for interactive play. The tick never awaits inference. */
  startRealtime(tickMs: number, onTick?: () => void): void {
    if (this.realtimeTimer) return;
    this.realtimeTimer = setInterval(() => {
      this.tick();
      onTick?.();
      if (this.match.isOver) this.stopRealtime();
    }, tickMs);
  }

  stopRealtime(): void {
    if (this.realtimeTimer) clearInterval(this.realtimeTimer);
    this.realtimeTimer = null;
  }

  summary(): MatchSummary {
    const s = this.match.state;
    return {
      matchId: s.matchId,
      seed: s.seed,
      winner: s.outcome?.winner ?? null,
      reason: s.outcome?.reason ?? null,
      durationTicks: s.tick,
      stalled: !s.outcome || s.outcome.reason === "time_limit",
      roles: Object.fromEntries(s.players.map((p) => [p.id, p.role])),
      controllers: { ...this.controllers },
      metrics: this.metrics,
    };
  }

  private stepAgent(host: AgentHost): void {
    const obs = this.match.observe(host.playerId);
    host.perceive(obs);
    const cmd = host.step(obs);
    if (cmd.move) this.match.setMoveIntent(host.playerId, cmd.move);
    for (const action of cmd.actions) this.submit(host, action);
    const request = host.nextRequest(obs);
    if (request) this.launch(host, request, obs);
  }

  private submit(host: AgentHost, action: PlayerAction): void {
    const result = this.match.submitAction(host.playerId, action);
    host.actionResult(action, result, this.match.tick);
  }

  /** Ask the controller asynchronously; the agent keeps executing its current goal meanwhile. */
  private launch(host: AgentHost, request: DecisionRequest, obs: PlayerObservation): void {
    const metrics = this.metrics;
    metrics.decisions++;
    const started = performance.now();
    const timeoutMs = this.opts.decisionTimeoutMs;
    const slow = host.controller.kind === "llm";
    const task = (async () => {
      let decision: AgentDecision | null = null;
      try {
        const call = host.controller.decide(obs, request);
        decision = slow && timeoutMs ? await withTimeout(call, timeoutMs) : await call;
      } catch {
        metrics.controllerErrors++;
      }
      if (slow && metrics.decisionLatencyMs.length < 5000) metrics.decisionLatencyMs.push(performance.now() - started);
      if (this.match.isOver) {
        host.release(request);
        return;
      }
      // The world moved on while the controller was thinking: refresh perception so the revision check sees it.
      if (host.lastObservation && host.lastObservation.tick !== this.match.tick) host.perceive(this.match.observe(host.playerId));
      let result = decision ? host.accept(request, decision, "controller") : null;
      if (result?.outcome === "invalid") metrics.invalidDecisions++;
      if (!result || result.outcome === "invalid") {
        const fb = host.fallbackFor(request);
        metrics.fallbacks++;
        if (!fb) {
          host.release(request);
          return;
        }
        result = host.accept(request, fb, "fallback");
      }
      if (result.outcome === "stale") metrics.staleDecisions++;
      else if (result.outcome === "applied") metrics.decisionsApplied++;
      const record = host.decisionLog.at(-1);
      if (this.replay && record) {
        this.replay.recordAgent({
          type: result.outcome === "stale" ? "AGENT_STALE" : record.source === "fallback" ? "AGENT_FALLBACK" : "AGENT_DECISION",
          tick: this.match.tick,
          playerId: host.playerId,
          data: { kind: record.kind, outcome: record.outcome, summary: record.summary, reasonSummary: record.reasonSummary, requestTick: request.tick, revision: request.revision },
        });
      }
      for (const action of result.actions) this.submit(host, action);
    })()
      .catch((err: unknown) => {
        // A bug while applying a decision must surface as a crash, not an unhandled rejection.
        this.asyncError ??= err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  private finish(): void {
    for (const host of this.hostOrder) host.perceive(this.match.observe(host.playerId));
  }
}

function builtInController(ctx: AgentContext, kind: ControllerKind): PlayerController {
  switch (kind) {
    case "random":
      return new RandomController(ctx);
    case "heuristic":
    case "llm": // LLM controllers arrive in Milestone 5; until then the seat plays heuristically.
    case "human":
      return new HeuristicController(ctx);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DecisionTimeout(`decision timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

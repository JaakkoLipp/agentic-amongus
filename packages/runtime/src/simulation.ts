import { PLAYER_IDENTITIES, ticksToSeconds, type ControllerKind, type GameSettingsInput, type PlayerId } from "@deduction/shared";
import { MatchRunner, type MatchSummary, type RunnerAiOptions } from "./matchRunner";

export type ControllerMix = "heuristic" | "random" | "mixed";

export interface SimulationConfig {
  readonly settings: GameSettingsInput;
  readonly controllers: ControllerMix;
  readonly ai?: RunnerAiOptions;
  readonly checkInvariants: boolean;
  readonly recordReplay: boolean;
}

/** Result of one headless match, including failure modes the simulator must report. */
export interface SimulatedMatch {
  readonly seed: number;
  readonly status: "completed" | "stalled" | "crashed";
  readonly summary: MatchSummary | null;
  readonly error: string | null;
  readonly wallMs: number;
  readonly replayJsonl: string | null;
}

function seatsFor(mix: ControllerMix, seed: number, playerCount: number): Record<PlayerId, ControllerKind> {
  const seats: Record<PlayerId, ControllerKind> = {};
  PLAYER_IDENTITIES.slice(0, playerCount).forEach((p, i) => {
    seats[p.id] = mix === "mixed" ? ((i + seed) % 3 === 0 ? "random" : "heuristic") : mix;
  });
  return seats;
}

export async function simulateMatch(seed: number, config: SimulationConfig): Promise<SimulatedMatch> {
  const started = performance.now();
  const settings = { ...config.settings, seed };
  let runner: MatchRunner | null = null;
  try {
    runner = new MatchRunner({
      settings,
      seats: seatsFor(config.controllers, seed, settings.playerCount ?? 10),
      mode: "lockstep",
      checkInvariants: config.checkInvariants,
      recordEvents: config.recordReplay,
      recordReplay: config.recordReplay,
      ...(config.ai ? { ai: config.ai } : {}),
    });
    const summary = await runner.runToEnd();
    const failed = summary.stalled || summary.metrics.invariantViolations.length > 0;
    return {
      seed,
      status: summary.stalled ? "stalled" : "completed",
      summary,
      error: summary.metrics.invariantViolations.length > 0 ? `impossible state: ${summary.metrics.invariantViolations[0]}` : null,
      wallMs: performance.now() - started,
      replayJsonl: failed && runner.replay ? runner.replay.toJsonl() : null,
    };
  } catch (err) {
    return {
      seed,
      status: "crashed",
      summary: runner?.summary() ?? null,
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
      wallMs: performance.now() - started,
      replayJsonl: runner?.replay?.toJsonl() ?? null,
    };
  }
}

export interface SimulationReport {
  matches: number;
  completed: number;
  crashed: number;
  stalled: number;
  impossibleStates: number;
  crewWins: number;
  infiltratorWins: number;
  winsByReason: Record<string, number>;
  avgDurationSec: number;
  avgMeetings: number;
  avgKills: number;
  avgEjections: number;
  ejectionAccuracy: number;
  taskCompletionRate: number;
  taskFailureRate: number;
  avgTaskSeconds: number;
  invalidActions: number;
  invalidActionsPerMatch: number;
  topInvalidActions: [string, number][];
  decisions: number;
  staleDecisions: number;
  fallbacks: number;
  controllerErrors: number;
  sabotages: Record<string, number>;
  simulatedHours: number;
  wallSeconds: number;
  failures: { seed: number; status: string; error: string | null }[];
}

export function aggregate(results: readonly SimulatedMatch[], wallSeconds: number): SimulationReport {
  const ok = results.filter((r) => r.summary);
  const sum = (f: (m: SimulatedMatch) => number) => ok.reduce((acc, r) => acc + f(r), 0);
  const m = (r: SimulatedMatch) => r.summary!.metrics;
  const winsByReason: Record<string, number> = {};
  const invalid: Record<string, number> = {};
  const sabotages: Record<string, number> = {};
  let taskTicks = 0;
  let taskCount = 0;
  for (const r of ok) {
    const s = r.summary!;
    if (s.reason && r.status === "completed") winsByReason[`${s.winner}:${s.reason}`] = (winsByReason[`${s.winner}:${s.reason}`] ?? 0) + 1;
    for (const [k, v] of Object.entries(s.metrics.invalidByReason)) invalid[k] = (invalid[k] ?? 0) + v;
    for (const [k, v] of Object.entries(s.metrics.sabotages)) sabotages[k] = (sabotages[k] ?? 0) + v;
    for (const t of s.metrics.taskCompletionTicks) {
      taskTicks += t;
      taskCount++;
    }
  }
  const completed = results.filter((r) => r.status === "completed");
  const impossible = results.filter((r) => (r.summary?.metrics.invariantViolations.length ?? 0) > 0).length;
  const n = Math.max(1, ok.length);
  const ejections = sum((r) => m(r).ejections);
  const attempts = sum((r) => m(r).crewTasksCompleted + m(r).fakeTasksCompleted + m(r).taskAttemptsFailed);
  return {
    matches: results.length,
    completed: completed.length,
    crashed: results.filter((r) => r.status === "crashed").length,
    stalled: results.filter((r) => r.status === "stalled").length,
    impossibleStates: impossible,
    crewWins: completed.filter((r) => r.summary!.winner === "crew").length,
    infiltratorWins: completed.filter((r) => r.summary!.winner === "infiltrators").length,
    winsByReason,
    avgDurationSec: sum((r) => ticksToSeconds(r.summary!.durationTicks)) / n,
    avgMeetings: sum((r) => m(r).meetings) / n,
    avgKills: sum((r) => m(r).kills) / n,
    avgEjections: ejections / n,
    ejectionAccuracy: ejections > 0 ? sum((r) => m(r).correctEjections) / ejections : 0,
    taskCompletionRate: sum((r) => m(r).crewTasksCompleted) / Math.max(1, sum((r) => m(r).crewTasksTotal)),
    taskFailureRate: sum((r) => m(r).taskAttemptsFailed) / Math.max(1, attempts),
    avgTaskSeconds: taskCount > 0 ? ticksToSeconds(taskTicks / taskCount) : 0,
    invalidActions: sum((r) => m(r).invalidActions),
    invalidActionsPerMatch: sum((r) => m(r).invalidActions) / n,
    topInvalidActions: Object.entries(invalid).sort((a, b) => b[1] - a[1]).slice(0, 8),
    decisions: sum((r) => m(r).decisions),
    staleDecisions: sum((r) => m(r).staleDecisions),
    fallbacks: sum((r) => m(r).fallbacks),
    controllerErrors: sum((r) => m(r).controllerErrors),
    sabotages,
    simulatedHours: sum((r) => ticksToSeconds(r.summary!.durationTicks)) / 3600,
    wallSeconds,
    failures: results.filter((r) => r.status !== "completed" || r.error).map((r) => ({ seed: r.seed, status: r.status, error: r.error })),
  };
}

export function formatReport(r: SimulationReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `matches completed   ${r.completed} / ${r.matches}`,
    `crew wins           ${r.crewWins} (${pct(r.crewWins / Math.max(1, r.completed))})`,
    `infiltrator wins    ${r.infiltratorWins} (${pct(r.infiltratorWins / Math.max(1, r.completed))})`,
    ...Object.entries(r.winsByReason)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k.padEnd(36)} ${v}`),
    `average duration    ${(r.avgDurationSec / 60).toFixed(2)} min (game time)`,
    `average meetings    ${r.avgMeetings.toFixed(2)}`,
    `average kills       ${r.avgKills.toFixed(2)}`,
    `average ejections   ${r.avgEjections.toFixed(2)} (accuracy ${pct(r.ejectionAccuracy)})`,
    `crew task progress  ${pct(r.taskCompletionRate)} of assigned tasks, ${pct(r.taskFailureRate)} of attempts failed, ${r.avgTaskSeconds.toFixed(1)} s avg`,
    `sabotages           ${Object.entries(r.sabotages).map(([k, v]) => `${k}=${v}`).join(" ") || "none"}`,
    `decisions           ${r.decisions} (stale ${r.staleDecisions}, fallbacks ${r.fallbacks}, errors ${r.controllerErrors})`,
    `invalid actions     ${r.invalidActions} (${r.invalidActionsPerMatch.toFixed(1)} per match)`,
    ...r.topInvalidActions.map(([k, v]) => `  ${k.padEnd(36)} ${v}`),
    `impossible states   ${r.impossibleStates}`,
    `crashes             ${r.crashed}`,
    `stalled games       ${r.stalled}`,
    `simulated           ${r.simulatedHours.toFixed(1)} game-hours in ${r.wallSeconds.toFixed(1)} s wall`,
  ];
  return lines.join("\n");
}


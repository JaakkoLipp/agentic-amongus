import type { AgentGoal, GameSettings, MoveIntent, PlayerAction, PlayerObservation, Rng, Tick, Vec2 } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import type { AgentMemory } from "../memory/agentMemory";

/** Everything a goal executor may read. Note: no GameState — only the agent's observation and its own memory. */
export interface ExecContext {
  readonly obs: PlayerObservation;
  readonly memory: AgentMemory;
  readonly map: GameMap;
  /** Public rules (ranges, cooldown lengths). Every player knows them. */
  readonly settings: GameSettings;
  readonly rng: Rng;
}

export type ExecStatus = "running" | "done" | "failed";

export interface ExecStep {
  /** null = keep the current movement intent. */
  readonly move: MoveIntent | null;
  readonly actions: readonly PlayerAction[];
  readonly status: ExecStatus;
  readonly note?: string;
}

/** Per-goal scratch space, reset whenever a new goal is adopted. */
export interface GoalScratch {
  target?: Vec2;
  waypoints?: Vec2[];
  index?: number;
  taskId?: string;
  attempts?: number;
  stage?: string;
  lastDist?: number;
  lastProgressTick?: Tick;
  lastSeenTick?: Tick;
  lastActionTick?: Tick;
  ventPath?: string[];
}

export interface ActiveGoal {
  readonly goal: AgentGoal;
  readonly startedTick: Tick;
  readonly scratch: GoalScratch;
}

export type GoalExecutor<G extends AgentGoal = AgentGoal> = (ctx: ExecContext, goal: G, active: ActiveGoal) => ExecStep;

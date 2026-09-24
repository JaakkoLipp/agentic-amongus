import type { AiDifficulty, GameSettings, PlayerId, Rng } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import type { AgentMemory } from "./memory/agentMemory";
import type { AssignedPersonality } from "./personality";

/**
 * What a controller is constructed with. It is private to one agent: its own memory, its own personality, and
 * public knowledge (map, rules). Controllers never get a reference to the engine or GameState.
 */
export interface AgentContext {
  readonly playerId: PlayerId;
  readonly memory: AgentMemory;
  readonly personality: AssignedPersonality;
  readonly map: GameMap;
  readonly settings: GameSettings;
  readonly difficulty: AiDifficulty;
  /** 0..1 lobby setting; lower means sloppier memory tasks and faster forgetting. */
  readonly memoryQuality: number;
  readonly rng: Rng;
}

/** Difficulty never grants information; it only changes precision, speed and mistake rates. */
export interface DifficultyProfile {
  readonly taskErrorRate: number;
  readonly memoryTaskPenalty: number;
  readonly thinkTimeScale: number;
  readonly suspicionNoise: number;
}

export const DIFFICULTY_PROFILES: Readonly<Record<AiDifficulty, DifficultyProfile>> = {
  easy: { taskErrorRate: 0.22, memoryTaskPenalty: 0.15, thinkTimeScale: 1.4, suspicionNoise: 0.2 },
  normal: { taskErrorRate: 0.1, memoryTaskPenalty: 0.08, thinkTimeScale: 1, suspicionNoise: 0.1 },
  hard: { taskErrorRate: 0.04, memoryTaskPenalty: 0.03, thinkTimeScale: 0.7, suspicionNoise: 0.03 },
};

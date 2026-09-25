import { z } from "zod";

/**
 * Authoritative rule settings for one match. Distances are in tiles, speeds in tiles/second, times in seconds
 * (converted to ticks by the engine).
 */
export const MeetingTimingSchema = z.object({
  revealSec: z.number().min(0).max(30).default(4),
  statementsSec: z.number().min(0).max(300).default(25),
  discussionSec: z.number().min(0).max(600).default(45),
  finalStatementsSec: z.number().min(0).max(300).default(15),
  votingSec: z.number().min(5).max(300).default(30),
  resultSec: z.number().min(0).max(30).default(6),
});
export type MeetingTiming = z.infer<typeof MeetingTimingSchema>;

export const GameSettingsSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff).default(1),
  mapId: z.string().default("outpost-kappa"),
  playerCount: z.number().int().min(4).max(12).default(10),
  infiltratorCount: z.number().int().min(1).max(3).default(2),

  playerSpeed: z.number().min(1).max(12).default(4.5),
  crewVision: z.number().min(2).max(30).default(7),
  infiltratorVision: z.number().min(2).max(30).default(9),
  /** Crew vision multiplier while lights are sabotaged. Infiltrators are unaffected. */
  lightsVisionFactor: z.number().min(0.1).max(1).default(0.35),
  hearingRange: z.number().min(1).max(30).default(6),

  killCooldownSec: z.number().min(5).max(120).default(25),
  initialKillCooldownSec: z.number().min(0).max(120).default(12),
  killRange: z.number().min(0.5).max(4).default(1.6),
  reportRange: z.number().min(0.5).max(6).default(2.5),
  useRange: z.number().min(0.5).max(4).default(1.4),

  tasksPerPlayer: z.number().int().min(1).max(12).default(5),
  taskDifficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** A task session that sits in its answer phase longer than this fails automatically. */
  taskAnswerTimeoutSec: z.number().min(5).max(300).default(45),

  emergencyMeetingsPerPlayer: z.number().int().min(0).max(5).default(1),
  emergencyCooldownSec: z.number().min(0).max(120).default(15),
  meeting: MeetingTimingSchema.default(MeetingTimingSchema.parse({})),
  /** Reveal the ejected player's role ("role reveal on eject"). */
  confirmEjects: z.boolean().default(true),

  proximitySpeech: z.boolean().default(true),
  speechCooldownSec: z.number().min(0).max(30).default(2.5),
  maxUtteranceChars: z.number().int().min(20).max(500).default(160),

  sabotageCooldownSec: z.number().min(5).max(180).default(30),
  criticalSabotageSec: z.number().min(10).max(180).default(45),
  repairHoldSec: z.number().min(0.5).max(10).default(2),
  ventCooldownSec: z.number().min(0).max(30).default(1),

  /** Hard safety valve: the match ends as `time_limit` after this long. Headless simulation treats it as a stall. */
  maxMatchSec: z.number().min(60).max(7200).default(1800),
});
export type GameSettings = z.infer<typeof GameSettingsSchema>;
export type GameSettingsInput = z.input<typeof GameSettingsSchema>;

export const resolveGameSettings = (input: GameSettingsInput = {}): GameSettings => GameSettingsSchema.parse(input);

/** AI-side configuration chosen in the lobby. The engine never reads this. */
export const AiDifficultySchema = z.enum(["easy", "normal", "hard"]);
export type AiDifficulty = z.infer<typeof AiDifficultySchema>;

export const LlmProviderConfigSchema = z.object({
  baseUrl: z.string().url().default("http://127.0.0.1:8080/v1"),
  apiKey: z.string().default(""),
  model: z.string().default("local-model"),
  timeoutMs: z.number().int().min(500).max(120_000).default(15_000),
  maxTokens: z.number().int().min(16).max(8192).default(400),
  temperature: z.number().min(0).max(2).default(0.7),
});
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;

export const ControllerKindSchema = z.enum(["human", "random", "heuristic", "llm"]);
export type ControllerKind = z.infer<typeof ControllerKindSchema>;

export const AiSettingsSchema = z.object({
  defaultController: ControllerKindSchema.exclude(["human"]).default("heuristic"),
  difficulty: AiDifficultySchema.default("normal"),
  /** 0 = sloppy memory, 1 = precise memory. */
  memoryQuality: z.number().min(0).max(1).default(0.7),
  /** 0 = every agent uses its archetype exactly, 1 = heavy random jitter. */
  personalityVariation: z.number().min(0).max(1).default(0.3),
  /** Fast model: roaming, simple decisions, tasks. */
  provider: LlmProviderConfigSchema.default(LlmProviderConfigSchema.parse({})),
  /** Optional stronger model for meetings and votes; falls back to `provider`. */
  meetingProvider: LlmProviderConfigSchema.nullable().default(null),
  maxConcurrentInferences: z.number().int().min(1).max(64).default(4),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const LobbySettingsSchema = z.object({
  game: GameSettingsSchema.default(GameSettingsSchema.parse({})),
  ai: AiSettingsSchema.default(AiSettingsSchema.parse({})),
  humanPlayer: z.boolean().default(true),
  /** Seat (player id / colour) the human plays. Must be one of the first `playerCount` identities. */
  humanSeat: z.string().min(1).max(64).default("red"),
  debug: z.boolean().default(false),
});
export type LobbySettings = z.infer<typeof LobbySettingsSchema>;
export type LobbySettingsInput = z.input<typeof LobbySettingsSchema>;

/**
 * Rules a client may know during a match. The seed is withheld until the match ends: roles, task assignment and
 * task instances all derive from it, so knowing it would reveal the infiltrators.
 */
export type PublicGameSettings = Omit<GameSettings, "seed">;

export function publicGameSettings(settings: GameSettings): PublicGameSettings {
  const { seed: _seed, ...rest } = settings;
  return rest;
}

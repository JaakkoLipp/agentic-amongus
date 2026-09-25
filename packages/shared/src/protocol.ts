import { z } from "zod";
import { PlayerActionSchema, type ActionResult, type PlayerAction } from "./actions";
import type { MatchId, PlayerId, Tick } from "./ids";
import type { PerceivedEvent, PlayerObservation } from "./observation";
import type { Role, Team, WinReason } from "./roles";
import type { PublicGameSettings } from "./settings";

/**
 * WebSocket protocol (see docs/PROTOCOL.md).
 *
 * The server never sends authoritative GameState. Each client receives the same `PlayerObservation` an agent in
 * that seat would receive, so the human is bound by exactly the same partial observability as the AI players.
 * Full information (roles, seed, replay) is only released after MATCH_ENDED.
 *
 * Client -> server messages are validated with Zod; the server then validates game legality in the engine.
 */
export const PROTOCOL_VERSION = 1;

/** Largest client message the server accepts (bytes). Task answers and speech are far smaller. */
export const MAX_CLIENT_MESSAGE_BYTES = 16 * 1024;

export const ClientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), protocol: z.literal(PROTOCOL_VERSION), name: z.string().max(24).optional() }),
  /** Movement input, sent on change and at most ~30 Hz. */
  z.object({
    t: z.literal("input"),
    seq: z.number().int().nonnegative(),
    dir: z.object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) }),
  }),
  /** Any discrete action: tasks, kill, report, vent, sabotage, repair, speech, vote. */
  z.object({ t: z.literal("action"), seq: z.number().int().nonnegative(), action: PlayerActionSchema }),
  /** Start (or restart) a match. `settings` is validated by the server with `LobbySettingsSchema`. */
  z.object({ t: z.literal("start_match"), settings: z.unknown().optional() }),
  /** Abandon the current match and return to the lobby. */
  z.object({ t: z.literal("leave_match") }),
  z.object({ t: z.literal("ping"), at: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export interface PublicMatchSummary {
  readonly matchId: MatchId;
  readonly winner: Team;
  readonly reason: WinReason;
  readonly durationTicks: Tick;
  /** Revealed only now: re-running this seed reproduces the setup (roles, tasks, spawns). */
  readonly seed: number;
  readonly roles: Readonly<Record<PlayerId, Role>>;
  /** Path/URL of the recorded replay, for the post-game inspector. */
  readonly replayRef: string | null;
}

export type ServerMessage =
  | { readonly t: "welcome"; readonly protocol: number }
  | {
      readonly t: "match_started";
      readonly matchId: MatchId;
      readonly playerId: PlayerId;
      readonly mapId: string;
      readonly mapVersion: string;
      readonly settings: PublicGameSettings;
    }
  /** Per-player observation, sent at ~15 Hz. `observation.events` is always empty: events travel in `events`. */
  | { readonly t: "snapshot"; readonly observation: PlayerObservation }
  /** Perceived events for this player since the previous flush, sent right before the snapshot that follows them. */
  | { readonly t: "events"; readonly tick: Tick; readonly events: readonly PerceivedEvent[] }
  | { readonly t: "action_result"; readonly seq: number; readonly action: PlayerAction["type"]; readonly result: ActionResult }
  | { readonly t: "match_ended"; readonly summary: PublicMatchSummary }
  | { readonly t: "error"; readonly message: string }
  | { readonly t: "pong"; readonly at: number; readonly serverTick: Tick };

export type ServerMessageType = ServerMessage["t"];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { t: T }>;

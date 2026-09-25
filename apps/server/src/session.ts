import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ClientMessageSchema,
  LobbySettingsSchema,
  MAX_CLIENT_MESSAGE_BYTES,
  PLAYER_IDENTITIES,
  PROTOCOL_VERSION,
  publicGameSettings,
  type ClientMessage,
  type LobbySettings,
  type PlayerId,
  type PublicMatchSummary,
  type ServerMessage,
} from "@deduction/shared";
import { MatchRunner } from "@deduction/runtime";

export interface GameSessionOptions {
  /** Deliver one message to this session's client. */
  readonly send: (msg: ServerMessage) => void;
  /**
   * "realtime": the session drives its own fixed-timestep loop (the server).
   * "manual": the owner advances time with `advance()` (tests, deterministic tools).
   */
  readonly clock?: "realtime" | "manual";
  /** Wall-clock milliseconds per tick in realtime mode (default: 30 Hz). */
  readonly tickMs?: number;
  /** A snapshot is sent every N ticks (default 2, i.e. 15 Hz at 30 ticks/s). */
  readonly snapshotEveryTicks?: number;
  /** Write each finished match as a JSONL replay into this directory. */
  readonly replayDir?: string | null;
  /** Source of the secret per-match seed (default `Math.random`). */
  readonly random?: () => number;
  readonly log?: (message: string, data?: Record<string, unknown>) => void;
}

/** Errors a client can fix itself; reported back as an `error` message. */
class ClientError extends Error {}

/**
 * One connected client and (at most) one match it plays in. Transport-agnostic: the WebSocket route feeds raw
 * frames into `receive()` and forwards everything passed to `send`.
 *
 * The human seat is an ordinary `"human"` seat of a realtime `MatchRunner`. Everything the client learns comes from
 * `match.observe(seat)` — exactly what an AI agent in that seat would see — plus the seed-free public rules. The
 * seed, all roles and the replay are released only in `match_ended`.
 */
export class GameSession {
  private readonly opts: GameSessionOptions;
  private readonly snapshotEvery: number;
  private runner: MatchRunner | null = null;
  private humanId: PlayerId | null = null;
  private helloReceived = false;
  private endedSent = false;
  private lastPhase: string | null = null;
  private closed = false;

  constructor(opts: GameSessionOptions) {
    this.opts = opts;
    this.snapshotEvery = Math.max(1, Math.floor(opts.snapshotEveryTicks ?? 2));
  }

  /** The running match, if any (tests and diagnostics; never exposed to the client). */
  get currentRunner(): MatchRunner | null {
    return this.runner;
  }

  get playerId(): PlayerId | null {
    return this.humanId;
  }

  /** Raw frame from the transport: size check, JSON parse, schema validation, then `handle`. */
  receive(raw: string): void {
    if (this.closed) return;
    if (raw.length > MAX_CLIENT_MESSAGE_BYTES) return this.error("message too large");
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return this.error("invalid JSON");
    }
    const parsed = ClientMessageSchema.safeParse(data);
    if (!parsed.success) {
      const t = typeof data === "object" && data !== null && "t" in data ? String((data as { t: unknown }).t) : "?";
      return this.error(`invalid message (t=${t.slice(0, 32)})`);
    }
    this.handle(parsed.data);
  }

  handle(msg: ClientMessage): void {
    if (this.closed) return;
    try {
      this.dispatch(msg);
    } catch (err) {
      if (err instanceof ClientError) this.error(err.message);
      else throw err;
    }
  }

  /**
   * Manual clock only: run up to `ticks` simulation ticks, flushing snapshots exactly as the realtime loop does.
   * The runner is in lockstep mode here, so agents' decisions land before the next tick (deterministic).
   */
  async advance(ticks = 1): Promise<void> {
    if (!this.manual) throw new Error("advance() requires clock: manual");
    for (let i = 0; i < ticks; i++) {
      const runner = this.runner;
      if (!runner || runner.isOver) return;
      runner.tick();
      await runner.settle();
      this.afterTick(runner);
    }
  }

  private get manual(): boolean {
    return this.opts.clock === "manual";
  }

  /** Transport closed: stop the match loop and drop everything. */
  close(): void {
    this.closed = true;
    this.stopMatch();
  }

  private dispatch(msg: ClientMessage): void {
    if (msg.t === "ping") {
      this.send({ t: "pong", at: msg.at, serverTick: this.runner?.match.tick ?? 0 });
      return;
    }
    if (msg.t === "hello") {
      this.helloReceived = true;
      this.send({ t: "welcome", protocol: PROTOCOL_VERSION });
      return;
    }
    if (!this.helloReceived) throw new ClientError("send hello first");

    switch (msg.t) {
      case "start_match":
        this.startMatch(msg.settings);
        return;
      case "leave_match":
        this.stopMatch();
        return;
      case "input": {
        const { runner, humanId } = this.requireMatch();
        runner.setHumanMove(humanId, msg.dir);
        return;
      }
      case "action": {
        const { runner, humanId } = this.requireMatch();
        const result = runner.submitHumanAction(humanId, msg.action);
        this.send({ t: "action_result", seq: msg.seq, action: msg.action.type, result });
        // Actions change what the player sees (task views, meeting state): don't make them wait for the next snapshot.
        this.flush(runner);
        return;
      }
    }
  }

  private requireMatch(): { runner: MatchRunner; humanId: PlayerId } {
    if (!this.runner || !this.humanId) throw new ClientError("no match in progress");
    return { runner: this.runner, humanId: this.humanId };
  }

  private startMatch(rawSettings: unknown): void {
    const lobby = this.parseLobby(rawSettings);
    const seats = PLAYER_IDENTITIES.slice(0, lobby.game.playerCount).map((p) => p.id);
    if (!seats.includes(lobby.humanSeat)) throw new ClientError(`seat ${lobby.humanSeat} is not in this match`);

    this.stopMatch();
    let runner: MatchRunner;
    try {
      runner = new MatchRunner({
        settings: lobby.game,
        // Never derived from the seed: observations carry the match id.
        matchId: `m-${randomUUID()}`,
        mode: this.manual ? "lockstep" : "realtime",
        seats: { [lobby.humanSeat]: "human" },
        defaultController: lobby.ai.defaultController,
        ai: { difficulty: lobby.ai.difficulty, memoryQuality: lobby.ai.memoryQuality, personalityVariation: lobby.ai.personalityVariation },
        recordEvents: false,
        recordReplay: Boolean(this.opts.replayDir),
      });
    } catch (err) {
      // Settings that pass the schema but not the map/rules (e.g. too many infiltrators for the player count).
      throw new ClientError(err instanceof Error ? err.message : String(err));
    }
    this.runner = runner;
    this.humanId = lobby.humanSeat;
    this.endedSent = false;
    this.lastPhase = runner.match.state.phase;
    const map = runner.match.map;
    this.opts.log?.("match started", { matchId: runner.match.state.matchId, seat: lobby.humanSeat, players: lobby.game.playerCount });
    this.send({
      t: "match_started",
      matchId: runner.match.state.matchId,
      playerId: lobby.humanSeat,
      mapId: map.id,
      mapVersion: map.version,
      settings: publicGameSettings(runner.match.state.settings),
    });
    this.flush(runner);

    if (!this.manual) {
      runner.startRealtime({
        ...(this.opts.tickMs ? { tickMs: this.opts.tickMs } : {}),
        onTick: () => this.afterTick(runner),
        onError: (err) => {
          this.opts.log?.("match crashed", { error: err.message });
          this.error("the match stopped because of a server error");
          this.stopMatch();
        },
      });
    }
  }

  private parseLobby(raw: unknown): LobbySettings {
    const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const game = typeof input.game === "object" && input.game !== null ? (input.game as Record<string, unknown>) : {};
    // No seed requested: pick a secret one. (A player who picks their own seed can work out the roles offline.)
    const seed = game.seed ?? Math.floor((this.opts.random ?? Math.random)() * 0x100000000);
    const parsed = LobbySettingsSchema.safeParse({ ...input, game: { ...game, seed } });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ClientError(`invalid settings${issue ? `: ${issue.path.join(".")} ${issue.message}` : ""}`);
    }
    if (!parsed.data.humanPlayer) throw new ClientError("matches without a human player are not supported yet");
    return parsed.data;
  }

  private stopMatch(): void {
    this.runner?.stopRealtime();
    this.runner = null;
    this.humanId = null;
  }

  private afterTick(runner: MatchRunner): void {
    if (runner !== this.runner) return;
    const phase = runner.match.state.phase;
    if (runner.isOver || phase !== this.lastPhase || runner.match.tick % this.snapshotEvery === 0) this.flush(runner);
    this.lastPhase = phase;
    if (runner.isOver && !this.endedSent) this.finish(runner);
  }

  /** Drain the seat's perceived events and send them, then a fresh snapshot. */
  private flush(runner: MatchRunner): void {
    if (!this.humanId || this.closed) return;
    const obs = runner.match.observe(this.humanId);
    if (obs.events.length > 0) this.send({ t: "events", tick: obs.tick, events: obs.events });
    this.send({ t: "snapshot", observation: { ...obs, events: [] } });
  }

  private finish(runner: MatchRunner): void {
    this.endedSent = true;
    const summary = runner.summary();
    const replayRef = this.writeReplay(runner);
    const out: PublicMatchSummary = {
      matchId: summary.matchId,
      winner: summary.winner ?? "infiltrators",
      reason: summary.reason ?? "time_limit",
      durationTicks: summary.durationTicks,
      seed: summary.seed,
      roles: summary.roles,
      replayRef,
    };
    this.opts.log?.("match ended", { matchId: out.matchId, winner: out.winner, reason: out.reason, seconds: Math.round(out.durationTicks / 30) });
    this.send({ t: "match_ended", summary: out });
  }

  private writeReplay(runner: MatchRunner): string | null {
    const dir = this.opts.replayDir;
    if (!dir || !runner.replay) return null;
    try {
      mkdirSync(dir, { recursive: true });
      const file = `${runner.match.state.matchId}.jsonl`;
      writeFileSync(join(dir, file), runner.replay.toJsonl());
      return file;
    } catch (err) {
      this.opts.log?.("could not write replay", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  private error(message: string): void {
    this.send({ t: "error", message });
  }

  private send(msg: ServerMessage): void {
    if (!this.closed) this.opts.send(msg);
  }
}

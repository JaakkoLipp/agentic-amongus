import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION } from "@deduction/shared";
import { GameSession, type GameSessionOptions } from "./session";

export interface ServerOptions {
  /** Built client (`apps/client/dist`) to serve at `/`. Skipped when missing (use the Vite dev server instead). */
  readonly clientDir?: string | null;
  readonly replayDir?: string | null;
  /** Session overrides (tests: faster ticks). */
  readonly session?: Pick<GameSessionOptions, "tickMs" | "snapshotEveryTicks" | "random">;
  readonly logger?: boolean;
  /** Messages a client may send per second before being cut off (default 240; movement input is ≤ 30/s). */
  readonly maxMessagesPerSecond?: number;
}

/**
 * HTTP + WebSocket host. Every WebSocket connection gets its own `GameSession`, i.e. its own single-player match
 * against AI agents. `/ws` speaks the protocol in docs/PROTOCOL.md; `/health` is for tooling.
 */
export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const sessions = new Set<GameSession>();
  const maxRate = opts.maxMessagesPerSecond ?? 240;

  await app.register(websocket, { options: { maxPayload: MAX_CLIENT_MESSAGE_BYTES } });

  app.get("/health", async () => ({ ok: true, protocol: PROTOCOL_VERSION, sessions: sessions.size }));

  app.get("/ws", { websocket: true }, (socket) => {
    const session = new GameSession({
      ...opts.session,
      replayDir: opts.replayDir ?? null,
      clock: "realtime",
      send: (msg) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      },
      log: (message, data) => app.log.info(data ?? {}, message),
    });
    sessions.add(session);

    let windowStart = Date.now();
    let count = 0;
    socket.on("message", (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > maxRate) {
        socket.close(1008, "rate limit exceeded");
        return;
      }
      if (isBinary) {
        socket.send(JSON.stringify({ t: "error", message: "binary frames are not supported" }));
        return;
      }
      try {
        session.receive(data.toString());
      } catch (err) {
        app.log.error(err, "session crashed");
        socket.close(1011, "internal error");
      }
    });
    socket.on("close", () => {
      session.close();
      sessions.delete(session);
    });
  });

  if (opts.clientDir && existsSync(opts.clientDir)) {
    await app.register(fastifyStatic, { root: opts.clientDir });
  }

  app.addHook("onClose", async () => {
    for (const s of sessions) s.close();
    sessions.clear();
  });
  return app;
}

import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PROTOCOL_VERSION, type ServerMessage, type ServerMessageOf, type ServerMessageType } from "@deduction/shared";
import { buildServer, type ServerOptions } from "../src/app";

let app: FastifyInstance | null = null;

const sessionsAt = async (host: string) => ((await (await fetch(`http://${host}/health`)).json()) as { sessions: number }).sessions;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function start(opts: ServerOptions = {}) {
  app = await buildServer(opts);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  return `127.0.0.1:${addr.port}`;
}

/** Minimal protocol client over a real socket. */
async function connect(host: string) {
  const ws = new WebSocket(`ws://${host}/ws`);
  const inbox: ServerMessage[] = [];
  const waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("socket error")));
  });
  const closed = new Promise<{ code: number }>((resolve) => ws.addEventListener("close", (ev) => resolve({ code: ev.code })));
  return {
    ws,
    inbox,
    closed,
    send: (msg: unknown) => ws.send(typeof msg === "string" ? msg : JSON.stringify(msg)),
    next<T extends ServerMessageType>(t: T, pred: (m: ServerMessageOf<T>) => boolean = () => true, timeoutMs = 5000): Promise<ServerMessageOf<T>> {
      const found = inbox.find((m): m is ServerMessageOf<T> => m.t === t && pred(m as ServerMessageOf<T>));
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${t}`)), timeoutMs);
        waiters.push({
          pred: (m) => m.t === t && pred(m as ServerMessageOf<T>),
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m as ServerMessageOf<T>);
          },
        });
      });
    },
  };
}

describe("server over a real WebSocket", () => {
  it("serves /health", async () => {
    const host = await start();
    const res = await fetch(`http://${host}/health`);
    expect(await res.json()).toEqual({ ok: true, protocol: PROTOCOL_VERSION, sessions: 0 });
  });

  it("plays: hello -> welcome -> start_match -> snapshots; input moves the seat", async () => {
    const host = await start({ session: { tickMs: 2 } });
    const c = await connect(host);
    c.send({ t: "hello", protocol: PROTOCOL_VERSION });
    await c.next("welcome");
    c.send({ t: "start_match", settings: { game: { seed: 7 }, humanSeat: "green" } });
    const started = await c.next("match_started");
    expect(started.playerId).toBe("green");
    const first = await c.next("snapshot");
    c.send({ t: "input", seq: 0, dir: { x: 0, y: 1 } });
    const later = await c.next("snapshot", (s) => s.observation.self.pos.y > first.observation.self.pos.y + 1);
    expect(later.observation.tick).toBeGreaterThan(first.observation.tick);
    c.send({ t: "action", seq: 1, action: { type: "CALL_EMERGENCY" } });
    const result = await c.next("action_result");
    expect(result).toMatchObject({ seq: 1, action: "CALL_EMERGENCY", result: { ok: false } });
    c.ws.close();
  });

  it("runs a match to match_ended and writes the replay", async () => {
    const replayDir = mkdtempSync(join(tmpdir(), "deduction-replays-"));
    // Short matches: 4 players, 1 task each, fast ticks.
    const host = await start({ replayDir, session: { tickMs: 0.2 } });
    const c = await connect(host);
    c.send({ t: "hello", protocol: PROTOCOL_VERSION });
    c.send({ t: "start_match", settings: { game: { seed: 5, playerCount: 4, infiltratorCount: 1, tasksPerPlayer: 1 } } });
    const ended = await c.next("match_ended", () => true, 60_000);
    expect(ended.summary.seed).toBe(5);
    expect(Object.keys(ended.summary.roles)).toHaveLength(4);
    expect(ended.summary.replayRef).toMatch(/\.jsonl$/);
    expect(readdirSync(replayDir)).toEqual([ended.summary.replayRef]);
    c.ws.close();
  }, 70_000);

  it("reports protocol errors and drops clients that flood the server", async () => {
    const host = await start({ maxMessagesPerSecond: 20 });
    const c = await connect(host);
    c.send("not json");
    expect((await c.next("error")).message).toBe("invalid JSON");
    for (let i = 0; i < 50; i++) c.send({ t: "ping", at: i });
    expect((await c.closed).code).toBe(1008);
  });

  it("stops the match when the client disconnects", async () => {
    const host = await start({ session: { tickMs: 5 } });
    const c = await connect(host);
    c.send({ t: "hello", protocol: PROTOCOL_VERSION });
    c.send({ t: "start_match" });
    await c.next("snapshot");
    expect(await sessionsAt(host)).toBe(1);
    c.ws.close();
    await c.closed;
    await new Promise((r) => setTimeout(r, 50));
    expect(await sessionsAt(host)).toBe(0);
  });

  it("serves the built client when a client directory is given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deduction-client-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Agentic Deduction</title>");
    const host = await start({ clientDir: dir });
    const res = await fetch(`http://${host}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Agentic Deduction");
  });
});

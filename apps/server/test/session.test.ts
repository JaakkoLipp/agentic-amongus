import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, secondsToTicks, type ServerMessage, type ServerMessageOf, type ServerMessageType } from "@deduction/shared";
import { GameSession } from "../src/session";
import { ScriptedHuman } from "./scriptedHuman";

function harness(onMessage?: (msg: ServerMessage) => void) {
  const out: ServerMessage[] = [];
  const session = new GameSession({
    clock: "manual",
    random: () => 0.25,
    send: (m) => {
      out.push(m);
      onMessage?.(m);
    },
  });
  const send = (msg: unknown) => session.receive(JSON.stringify(msg));
  const of = <T extends ServerMessageType>(t: T) => out.filter((m): m is ServerMessageOf<T> => m.t === t);
  const last = <T extends ServerMessageType>(t: T) => of(t).at(-1);
  return { session, out, send, of, last };
}

function started(settings: Record<string, unknown> = { game: { seed: 42 } }) {
  const h = harness();
  h.send({ t: "hello", protocol: PROTOCOL_VERSION });
  h.send({ t: "start_match", settings });
  return h;
}

describe("game session: handshake and validation", () => {
  it("answers hello with welcome and requires it before anything else", async () => {
    const h = harness();
    h.send({ t: "start_match" });
    expect(h.last("error")?.message).toBe("send hello first");
    h.send({ t: "hello", protocol: PROTOCOL_VERSION, name: "Ada" });
    expect(h.last("welcome")).toEqual({ t: "welcome", protocol: PROTOCOL_VERSION });
  });

  it("rejects malformed frames without throwing", async () => {
    const h = harness();
    h.session.receive("{not json");
    h.send({ t: "hello", protocol: 999 });
    h.send({ t: "input", seq: -1, dir: { x: 5, y: 0 } });
    h.send({ t: "action", seq: 1, action: { type: "TELEPORT" } });
    h.send([1, 2, 3]);
    h.session.receive("x".repeat(20_000));
    expect(h.of("error").map((e) => e.message)).toEqual([
      "invalid JSON",
      "invalid message (t=hello)",
      "invalid message (t=input)",
      "invalid message (t=action)",
      "invalid message (t=?)",
      "message too large",
    ]);
    expect(h.of("welcome")).toHaveLength(0);
  });

  it("rejects inputs and actions when no match is running", async () => {
    const h = harness();
    h.send({ t: "hello", protocol: PROTOCOL_VERSION });
    h.send({ t: "input", seq: 0, dir: { x: 1, y: 0 } });
    h.send({ t: "action", seq: 1, action: { type: "CALL_EMERGENCY" } });
    expect(h.of("error").map((e) => e.message)).toEqual(["no match in progress", "no match in progress"]);
  });

  it("rejects invalid lobby settings with a readable reason", async () => {
    const h = harness();
    h.send({ t: "hello", protocol: PROTOCOL_VERSION });
    h.send({ t: "start_match", settings: { game: { playerCount: 99 } } });
    expect(h.last("error")?.message).toMatch(/^invalid settings: game\.playerCount/);
    h.send({ t: "start_match", settings: { game: { playerCount: 5, infiltratorCount: 3 } } });
    expect(h.last("error")?.message).toMatch(/infiltrators need at least/);
    h.send({ t: "start_match", settings: { game: { playerCount: 5 }, humanSeat: "lime" } });
    expect(h.last("error")?.message).toBe("seat lime is not in this match");
    h.send({ t: "start_match", settings: { humanPlayer: false } });
    expect(h.last("error")?.message).toMatch(/not supported/);
    expect(h.of("match_started")).toHaveLength(0);
  });

  it("answers ping with pong and the server tick", async () => {
    const h = started();
    await h.session.advance(7);
    h.send({ t: "ping", at: 123 });
    expect(h.last("pong")).toEqual({ t: "pong", at: 123, serverTick: 7 });
  });
});

describe("game session: what the client learns", () => {
  it("starts a match on the requested seat without revealing the seed", async () => {
    const h = started({ game: { seed: 4242, playerCount: 8, infiltratorCount: 2 }, humanSeat: "black" });
    const ms = h.last("match_started")!;
    expect(ms).toMatchObject({ playerId: "black", mapId: "outpost-kappa", mapVersion: "1.0.0" });
    expect(ms.settings).not.toHaveProperty("seed");
    expect(ms.settings.playerCount).toBe(8);
    expect(ms.matchId).not.toContain("4242");
    const snap = h.last("snapshot")!;
    expect(snap.observation.self.id).toBe("black");
    expect(snap.observation.matchId).toBe(ms.matchId);
    expect(JSON.stringify(h.out)).not.toMatch(/4242/);
  });

  it("picks a secret seed when none is requested", async () => {
    const h = started({});
    await h.session.advance(1);
    expect(h.session.currentRunner!.match.state.seed).toBe(Math.floor(0.25 * 0x100000000));
    expect(JSON.stringify(h.out)).not.toContain(String(Math.floor(0.25 * 0x100000000)));
  });

  it("sends snapshots at the configured rate and events separately", async () => {
    const h = started();
    const before = h.of("snapshot").length;
    await h.session.advance(30);
    expect(h.of("snapshot").length - before).toBe(15);
    for (const s of h.of("snapshot")) expect(s.observation.events).toEqual([]);
    const perceived = h.of("events").flatMap((e) => e.events);
    expect(perceived.some((e) => e.type === "PLAYER_BECAME_VISIBLE")).toBe(true);
  });

  it("the human's observation hides other roles (unless teammates)", async () => {
    const h = started({ game: { seed: 9 } });
    const obs = h.last("snapshot")!.observation;
    for (const r of obs.roster) {
      if (r.id === obs.self.id) expect(r.knownRole).toBe(obs.self.role);
      else if (obs.teammates.includes(r.id)) expect(r.knownRole).toBe("infiltrator");
      else expect(r.knownRole).toBeNull();
    }
  });

  it("WASD input moves the human seat; zero input stops it", async () => {
    const h = started();
    await h.session.advance(2);
    const start = h.last("snapshot")!.observation.self.pos;
    h.send({ t: "input", seq: 1, dir: { x: 1, y: 0 } });
    await h.session.advance(30);
    const moved = h.last("snapshot")!.observation.self.pos;
    expect(moved.x).toBeGreaterThan(start.x + 2);
    h.send({ t: "input", seq: 2, dir: { x: 0, y: 0 } });
    await h.session.advance(10);
    const stopped = h.last("snapshot")!.observation.self.pos;
    await h.session.advance(10);
    expect(h.last("snapshot")!.observation.self.pos).toEqual(stopped);
  });

  it("answers every action with action_result and an immediate snapshot", async () => {
    const h = started();
    h.send({ t: "input", seq: 1, dir: { x: 1, y: 0 } });
    await h.session.advance(60); // walk away from the beacon
    const snaps = h.of("snapshot").length;
    h.send({ t: "action", seq: 7, action: { type: "CALL_EMERGENCY" } });
    expect(h.last("action_result")).toEqual({ t: "action_result", seq: 7, action: "CALL_EMERGENCY", result: { ok: false, reason: "cooldown" } });
    expect(h.of("snapshot").length).toBe(snaps + 1);
  });

  it("leave_match stops the match and a new start_match replaces it", async () => {
    const h = started();
    const first = h.last("match_started")!.matchId;
    h.send({ t: "leave_match" });
    expect(h.session.currentRunner).toBeNull();
    h.send({ t: "start_match", settings: { game: { seed: 43 } } });
    expect(h.last("match_started")!.matchId).not.toBe(first);
  });
});

/** Play one whole match through the protocol alone, like a person in the browser would. */
async function playMatch(seed: number, seat: string) {
  let human: ScriptedHuman | null = null;
  const h = harness((m) => human?.onMessage(m));
  human = new ScriptedHuman((raw) => h.session.receive(raw));
  h.send({ t: "hello", protocol: PROTOCOL_VERSION });
  h.send({ t: "start_match", settings: { game: { seed }, humanSeat: seat } });
  const limit = secondsToTicks(1800) + 10;
  for (let t = 0; t < limit && !human.ended; t += 3) {
    await h.session.advance(3);
    human.think();
  }
  return { h, human };
}

describe("a human can play complete matches (protocol only)", () => {
  it("as crew: does tasks, joins meetings, and sees the end with every role revealed", async () => {
    const { h, human } = await playMatch(21, "red");
    const role = h.of("snapshot")[0]!.observation.self.role;
    expect(human.ended).toBe(true);
    const end = h.last("match_ended")!.summary;
    expect(end.seed).toBe(21);
    expect(Object.keys(end.roles)).toHaveLength(10);
    expect(end.roles.red).toBe(role);
    expect(end.reason).not.toBe("time_limit");
    const results = human.results.filter((r) => r.action === "SUBMIT_TASK_ANSWER");
    if (role === "crew") expect(results.filter((r) => r.ok).length).toBeGreaterThan(0);
    // The HUD only offers legal actions, so a client that follows `legal` is (almost) never rejected.
    const rejected = human.results.filter((r) => !r.ok);
    expect(rejected.length).toBeLessThanOrEqual(Math.max(2, human.results.length * 0.05));
    const ended = h.of("events").flatMap((e) => e.events).find((e) => e.type === "MATCH_ENDED");
    expect(ended).toBeDefined();
  });

  it("across seeds and seats, every match ends properly (crew and infiltrator seats)", async () => {
    const roles = new Set<string>();
    // Seeds 101-103 put the human on the crew, 106/108/113 make them an infiltrator.
    for (const [seed, seat] of [
      [101, "red"],
      [102, "blue"],
      [103, "green"],
      [106, "cyan"],
      [108, "white"],
      [113, "red"],
    ] as const) {
      const { h, human } = await playMatch(seed, seat);
      expect(human.ended, `seed ${seed}`).toBe(true);
      const end = h.last("match_ended")!.summary;
      expect(end.reason, `seed ${seed}`).not.toBe("time_limit");
      roles.add(end.roles[seat]!);
    }
    expect([...roles].sort()).toEqual(["crew", "infiltrator"]);
  });
});

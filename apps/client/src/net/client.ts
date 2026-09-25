import { PROTOCOL_VERSION, type LobbySettingsInput, type PlayerAction, type ServerMessage, type Vec2 } from "@deduction/shared";
import { getMap } from "@deduction/maps";
import type { ClientStore } from "../state/store";
import { describeEvent, describeRejection } from "../state/describe";

/** While a direction is held, re-send it this often: meetings reset every movement intent on the server. */
const INPUT_REFRESH_MS = 250;
const PING_MS = 2000;

export function defaultServerUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

/**
 * The only way the client talks to the game. Sends intents (movement, actions); everything it knows comes back as
 * per-seat snapshots and perceived events. It never simulates or validates game rules itself.
 */
export class GameClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private dir: Vec2 = { x: 0, y: 0 };
  private lastInputAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    readonly store: ClientStore,
    private readonly url: string = defaultServerUrl(),
  ) {}

  connect(): void {
    this.disconnect();
    this.store.update({ connection: "connecting", error: null });
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.send({ t: "hello", protocol: PROTOCOL_VERSION });
      this.store.update({ connection: "open" });
    });
    ws.addEventListener("message", (ev) => {
      try {
        this.receive(JSON.parse(String(ev.data)) as ServerMessage);
      } catch (err) {
        console.error("bad server message", err);
      }
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.store.update({ connection: "closed" });
      this.stopTimers();
    });
    this.timers.push(
      setInterval(() => this.send({ t: "ping", at: performance.now() }), PING_MS),
      setInterval(() => {
        if ((this.dir.x !== 0 || this.dir.y !== 0) && performance.now() - this.lastInputAt >= INPUT_REFRESH_MS) this.sendInput();
      }, INPUT_REFRESH_MS / 2),
    );
  }

  disconnect(): void {
    this.stopTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  startMatch(settings: LobbySettingsInput): void {
    this.send({ t: "start_match", settings });
  }

  leaveMatch(): void {
    this.send({ t: "leave_match" });
    this.store.leftMatch();
  }

  /** Desired movement direction (WASD). Sent on change, and refreshed while held. */
  setMove(dir: Vec2): void {
    if (dir.x === this.dir.x && dir.y === this.dir.y) return;
    this.dir = dir;
    this.sendInput();
  }

  act(action: PlayerAction): void {
    this.send({ t: "action", seq: this.seq++, action });
  }

  private sendInput(): void {
    this.lastInputAt = performance.now();
    this.send({ t: "input", seq: this.seq++, dir: this.dir });
  }

  private receive(msg: ServerMessage): void {
    const store = this.store;
    switch (msg.t) {
      case "welcome":
        return;
      case "match_started":
        store.matchStarted({ matchId: msg.matchId, playerId: msg.playerId, map: getMap(msg.mapId), settings: msg.settings });
        return;
      case "snapshot": {
        const prevPhase = store.get().obs?.phase;
        store.snapshot(msg.observation, performance.now());
        // Back from a meeting while still holding a key: the server stopped us, so say it again.
        if (prevPhase === "meeting" && msg.observation.phase === "playing") this.sendInput();
        return;
      }
      case "events": {
        const match = store.get().match;
        if (!match) return;
        store.events(msg.events, (e) => describeEvent({ selfId: match.playerId, map: match.map, obs: store.get().obs }, e));
        return;
      }
      case "action_result":
        if (!msg.result.ok) store.rejected(msg.action, msg.result.reason, describeRejection);
        return;
      case "match_ended":
        store.update({ summary: msg.summary });
        return;
      case "error":
        store.update({ error: msg.message });
        store.toast(msg.message, "bad", 4000);
        return;
      case "pong":
        store.update({ pingMs: Math.round(performance.now() - msg.at) });
        return;
    }
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private stopTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}

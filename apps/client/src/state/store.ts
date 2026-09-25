import type {
  ActionRejectReason,
  MatchId,
  PerceivedEvent,
  PlayerActionType,
  PlayerId,
  PlayerObservation,
  PublicGameSettings,
  PublicMatchSummary,
  Tick,
} from "@deduction/shared";
import type { GameMap } from "@deduction/maps";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface MatchInfo {
  readonly matchId: MatchId;
  readonly playerId: PlayerId;
  readonly map: GameMap;
  readonly settings: PublicGameSettings;
}

export type LogTone = "info" | "good" | "bad" | "alert" | "speech";

export interface LogEntry {
  readonly id: number;
  readonly tick: Tick;
  readonly text: string;
  readonly tone: LogTone;
}

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly tone: LogTone;
  readonly until: number;
}

/** What the last meeting announcement said (the observation's meeting view does not carry the death list). */
export interface MeetingAnnouncement {
  readonly meetingId: string;
  readonly deadSinceLastMeeting: readonly PlayerId[];
}

export interface ClientState {
  readonly connection: ConnectionStatus;
  readonly error: string | null;
  readonly match: MatchInfo | null;
  /** Latest observation (its `events` are always empty; events arrive separately and feed `log`). */
  readonly obs: PlayerObservation | null;
  readonly log: readonly LogEntry[];
  readonly toasts: readonly Toast[];
  readonly announcement: MeetingAnnouncement | null;
  readonly summary: PublicMatchSummary | null;
  readonly pingMs: number | null;
}

/** One received snapshot with its local arrival time, for interpolation in the renderer. */
export interface TimedObservation {
  readonly obs: PlayerObservation;
  readonly at: number;
}

const INITIAL: ClientState = {
  connection: "connecting",
  error: null,
  match: null,
  obs: null,
  log: [],
  toasts: [],
  announcement: null,
  summary: null,
  pingMs: null,
};

const MAX_LOG = 60;
const MAX_BUFFER = 12;

/**
 * Client-side state. React reads it through `useSyncExternalStore`; the Pixi renderer reads the snapshot buffer
 * directly every frame. Nothing here is authoritative: it is just the latest things the server told this seat.
 */
export class ClientStore {
  private state: ClientState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private nextId = 1;
  /** Recent snapshots, oldest first. */
  readonly buffer: TimedObservation[] = [];
  /** Perceived-event listeners (sound, effects). */
  private readonly eventListeners = new Set<(events: readonly PerceivedEvent[]) => void>();

  get = (): ClientState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  onEvents(fn: (events: readonly PerceivedEvent[]) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  update(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  matchStarted(match: MatchInfo): void {
    this.buffer.length = 0;
    this.update({ match, obs: null, log: [], toasts: [], announcement: null, summary: null, error: null });
  }

  leftMatch(): void {
    this.buffer.length = 0;
    this.update({ match: null, obs: null, log: [], toasts: [], announcement: null, summary: null });
  }

  snapshot(obs: PlayerObservation, at: number): void {
    this.buffer.push({ obs, at });
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    const now = performance.now();
    const toasts = this.state.toasts.filter((t) => t.until > now);
    this.update({ obs, toasts });
  }

  events(events: readonly PerceivedEvent[], describe: (e: PerceivedEvent) => { text: string; tone: LogTone; toast?: boolean } | null): void {
    const added: LogEntry[] = [];
    const toasts: Toast[] = [];
    let announcement = this.state.announcement;
    const now = performance.now();
    for (const e of events) {
      if (e.type === "MEETING_STARTED") announcement = { meetingId: e.meetingId, deadSinceLastMeeting: e.deadSinceLastMeeting };
      const d = describe(e);
      if (!d) continue;
      const id = this.nextId++;
      added.push({ id, tick: e.tick, text: d.text, tone: d.tone });
      if (d.toast) toasts.push({ id, text: d.text, tone: d.tone, until: now + 4500 });
    }
    for (const fn of this.eventListeners) fn(events);
    if (added.length === 0 && announcement === this.state.announcement) return;
    this.update({
      log: [...this.state.log, ...added].slice(-MAX_LOG),
      toasts: [...this.state.toasts.filter((t) => t.until > now), ...toasts].slice(-4),
      announcement,
    });
  }

  toast(text: string, tone: LogTone, ms = 2500): void {
    const now = performance.now();
    const t: Toast = { id: this.nextId++, text, tone, until: now + ms };
    this.update({ toasts: [...this.state.toasts.filter((x) => x.until > now && x.text !== text), t].slice(-4) });
  }

  rejected(action: PlayerActionType, reason: ActionRejectReason, describe: (a: PlayerActionType, r: ActionRejectReason) => string): void {
    this.toast(describe(action, reason), "bad");
  }
}

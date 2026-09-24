import type { GameEvent, GameSettings, JsonObject, PlayerId, Role, TaskKind, Tick } from "@deduction/shared";
import type { Match } from "./match";

export const REPLAY_FORMAT = "agentic-deduction-replay/1";

export interface ReplayHeader {
  readonly format: typeof REPLAY_FORMAT;
  readonly matchId: string;
  readonly seed: number;
  readonly mapId: string;
  readonly mapVersion: string;
  readonly settings: GameSettings;
  readonly roles: Readonly<Record<PlayerId, Role>>;
  readonly controllers: Readonly<Record<PlayerId, string>>;
  readonly tasks: readonly { readonly id: string; readonly ownerId: PlayerId; readonly stationId: string; readonly kind: TaskKind; readonly difficulty: number; readonly data: JsonObject }[];
}

/** Agent-side records (decisions, reason summaries) appended by the runtime; the engine never produces these. */
export interface ReplayAgentRecord {
  readonly type: "AGENT_DECISION" | "AGENT_FALLBACK" | "AGENT_STALE" | "AGENT_NOTE";
  readonly tick: Tick;
  readonly playerId: PlayerId;
  readonly data: JsonObject;
}

export type ReplayLine = { readonly kind: "header"; readonly header: ReplayHeader } | { readonly kind: "event"; readonly event: GameEvent } | { readonly kind: "agent"; readonly record: ReplayAgentRecord };

/**
 * Records a match as JSONL: one header line (seed, map version, settings, roles, task instances), then every
 * authoritative event and agent decision in order. Because setup is fully seeded and the engine is deterministic,
 * the header plus controller decisions are enough to re-simulate the match.
 */
export class ReplayRecorder {
  readonly lines: ReplayLine[] = [];

  constructor(match: Match, controllers: Readonly<Record<PlayerId, string>>) {
    const s = match.state;
    this.lines.push({
      kind: "header",
      header: {
        format: REPLAY_FORMAT,
        matchId: s.matchId,
        seed: s.seed,
        mapId: s.mapId,
        mapVersion: s.mapVersion,
        settings: s.settings,
        roles: Object.fromEntries(s.players.map((p) => [p.id, p.role])),
        controllers,
        tasks: Object.values(s.tasks).map((t) => ({ id: t.id, ownerId: t.ownerId, stationId: t.stationId, kind: t.instance.kind, difficulty: t.instance.difficulty, data: t.instance.data })),
      },
    });
    for (const e of match.log) this.lines.push({ kind: "event", event: e });
    match.onEvent((event) => {
      this.lines.push({ kind: "event", event });
    });
  }

  recordAgent(record: ReplayAgentRecord): void {
    this.lines.push({ kind: "agent", record });
  }

  toJsonl(): string {
    return this.lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  }
}

/** Stable digest of an event stream (FNV-1a over JSON). Used to assert determinism. */
export function eventStreamDigest(events: readonly GameEvent[]): string {
  let h = 0x811c9dc5;
  for (const e of events) {
    const s = JSON.stringify(e);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

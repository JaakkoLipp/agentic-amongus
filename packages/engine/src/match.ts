import {
  compassDirection,
  PlayerActionSchema,
  resolveGameSettings,
  secondsToTicks,
  type ActionResult,
  type GameEvent,
  type GameEventBody,
  type GameSettings,
  type GameSettingsInput,
  type MatchId,
  type MoveIntent,
  type PerceivedEvent,
  type PerceivedEventBody,
  type PlayerAction,
  type PlayerId,
  type PlayerObservation,
  type AreaId,
  type Team,
  type Vec2,
  type WinReason,
} from "@deduction/shared";
import { getMap, type GameMap } from "@deduction/maps";
import { reject, type EngineContext } from "./context";
import { getPlayer, type GameState, type PlayerState } from "./state";
import { createInitialState, roleMap } from "./setup";
import { perceiveEvent } from "./perception";
import { buildObservation } from "./observation";
import { visiblePlayerIds, canSeePoint } from "./vision";
import { tickMovement } from "./rules/movement";
import { cancelTask, startTask, submitAnswer, tickTasks, validateStartTask, validateSubmitAnswer } from "./rules/tasks";
import { applyKill, validateKill } from "./rules/kill";
import { applyEmergency, applyReport, validateEmergency, validateEmergencyRange, validateReport } from "./rules/report";
import { enterVent, exitVent, moveVent, validateEnterVent, validateExitVent, validateMoveVent } from "./rules/vents";
import { clearSabotage, startRepair, startSabotage, stopRepair, tickSabotage, validateSabotage, validateStartRepair } from "./rules/sabotage";
import { applySpeak, sanitizeUtterance, validateSpeak } from "./rules/speech";
import { castVote, tickMeeting, validateVote } from "./rules/meeting";
import { checkWin } from "./rules/win";

/** Visibility diffs (appear/disappear, first sight of bodies) are computed at 10 Hz. */
export const PERCEPTION_INTERVAL_TICKS = 3;
const MAX_INBOX = 2000;

export interface MatchOptions {
  readonly settings?: GameSettingsInput | GameSettings;
  readonly matchId?: MatchId;
  readonly map?: GameMap;
  /** Keep every authoritative event in memory (replays, tests). Off in bulk simulation. */
  readonly recordEvents?: boolean;
}

export type EventListener = (event: GameEvent, state: Readonly<GameState>) => void;

interface Sighting {
  readonly pos: Vec2;
  readonly roomId: AreaId | null;
  readonly facing: Vec2;
  readonly moving: boolean;
}

/**
 * One authoritative match. Owns the state and is the only writer. Knows nothing about controllers, networking or
 * LLMs: inputs arrive as `submitAction` / `setMoveIntent`, outputs leave as events and per-player observations.
 */
export class Match implements EngineContext {
  readonly state: GameState;
  readonly map: GameMap;
  readonly log: GameEvent[] = [];
  private readonly recordEvents: boolean;
  private readonly inboxes = new Map<PlayerId, PerceivedEvent[]>();
  /** Per observer: what each currently visible player looked like at the last perception update. */
  private readonly visible = new Map<PlayerId, Map<PlayerId, Sighting>>();
  private readonly listeners: EventListener[] = [];

  constructor(options: MatchOptions = {}) {
    const settings = resolveGameSettings(options.settings ?? {});
    this.map = options.map ?? getMap(settings.mapId);
    this.recordEvents = options.recordEvents ?? false;
    this.state = createInitialState(settings, this.map, options.matchId ?? `match-${settings.seed}`);
    for (const p of this.state.players) {
      this.inboxes.set(p.id, []);
      this.visible.set(p.id, new Map());
    }
    this.emit({ type: "MATCH_STARTED", seed: settings.seed, mapId: this.map.id, mapVersion: this.map.version, playerIds: this.state.players.map((p) => p.id) });
    this.emit({ type: "ROLES_ASSIGNED", roles: roleMap(this.state) });
    for (const p of this.state.players) this.emit({ type: "TASKS_ASSIGNED", playerId: p.id, taskIds: [...p.taskIds] });
    this.updatePerception();
  }

  get tick(): number {
    return this.state.tick;
  }

  get isOver(): boolean {
    return this.state.phase === "ended";
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  emit(body: GameEventBody): GameEvent {
    const event = { ...body, seq: this.state.nextEventSeq++, tick: this.state.tick } as GameEvent;
    if (this.recordEvents) this.log.push(event);
    for (const [playerId, perceived] of perceiveEvent(event, this.state, this.map)) this.deliver(playerId, perceived);
    for (const l of this.listeners) l(event, this.state);
    return event;
  }

  private deliver(playerId: PlayerId, body: PerceivedEventBody): void {
    const inbox = this.inboxes.get(playerId);
    if (!inbox) return;
    inbox.push({ ...body, tick: this.state.tick } as PerceivedEvent);
    if (inbox.length > MAX_INBOX) inbox.splice(0, inbox.length - MAX_INBOX);
  }

  /** Observation for one player; drains that player's perceived-event inbox unless `drain` is false. */
  observe(playerId: PlayerId, drain = true): PlayerObservation {
    const inbox = this.inboxes.get(playerId) ?? [];
    const events = drain ? inbox.splice(0, inbox.length) : [...inbox];
    return buildObservation(this.state, this.map, playerId, events);
  }

  setMoveIntent(playerId: PlayerId, intent: MoveIntent): void {
    const p = getPlayer(this.state, playerId);
    if (!p || this.state.phase !== "playing") return;
    if (intent.mode === "direction" && !(Number.isFinite(intent.dir.x) && Number.isFinite(intent.dir.y))) return;
    if (intent.mode === "path" && !(Number.isFinite(intent.target.x) && Number.isFinite(intent.target.y))) return;
    p.moveIntent = intent;
  }

  submitAction(playerId: PlayerId, action: PlayerAction): ActionResult {
    const p = getPlayer(this.state, playerId);
    if (!p) return reject("invalid_target");
    // In-process callers skip the wire schema; never let a malformed action throw inside a rule.
    const parsed = PlayerActionSchema.safeParse(action);
    const result = parsed.success ? this.dispatch(p, parsed.data) : reject("malformed");
    if (!result.ok) this.emit({ type: "ACTION_REJECTED", playerId, action: parsed.success ? parsed.data.type : "unknown", reason: result.reason });
    return result;
  }

  private dispatch(p: PlayerState, action: PlayerAction): ActionResult {
    const { state, map } = this;
    const run = (check: ActionResult, apply: () => void): ActionResult => {
      if (check.ok) apply();
      return check;
    };
    switch (action.type) {
      case "START_TASK":
        return run(validateStartTask(state, map, p, action.taskId), () => startTask(this, p, action.taskId));
      case "CANCEL_TASK":
        return run(p.taskSession ? { ok: true } : reject("unknown_task"), () => cancelTask(this, p));
      case "SUBMIT_TASK_ANSWER":
        return run(validateSubmitAnswer(state, p, action.taskId), () => {
          submitAnswer(this, p, action.taskId, action.answer);
          this.checkWinNow();
        });
      case "KILL":
        return run(validateKill(state, map, p, action.targetId), () => {
          applyKill(this, p, getPlayer(state, action.targetId)!);
          this.checkWinNow();
        });
      case "REPORT_BODY":
        return run(validateReport(state, map, p, action.bodyId), () => applyReport(this, p, action.bodyId));
      case "CALL_EMERGENCY": {
        const check = validateEmergency(state, p);
        return run(check.ok ? validateEmergencyRange(state, map, p) : check, () => applyEmergency(this, p));
      }
      case "ENTER_VENT":
        return run(validateEnterVent(state, map, p, action.ventId), () => enterVent(this, p, action.ventId));
      case "MOVE_VENT":
        return run(validateMoveVent(state, map, p, action.toVentId), () => moveVent(this, p, action.toVentId));
      case "EXIT_VENT":
        return run(validateExitVent(state, p), () => exitVent(this, p));
      case "SABOTAGE":
        return run(validateSabotage(state, p, action.kind), () => startSabotage(this, p, action.kind));
      case "START_REPAIR":
        return run(validateStartRepair(state, map, p, action.stationId), () => startRepair(this, p, action.stationId));
      case "STOP_REPAIR":
        return run(p.repair ? { ok: true } : reject("invalid_target"), () => stopRepair(this, p));
      case "SPEAK": {
        const text = sanitizeUtterance(action.text, state.settings.maxUtteranceChars);
        if (text === null) return reject("malformed");
        return run(validateSpeak(state, p), () => applySpeak(this, p, text));
      }
      case "VOTE":
        return run(validateVote(state, p, action.target), () => castVote(this, p, action.target));
    }
  }

  /** Advance the simulation by one tick. No-op once the match has ended. */
  step(): void {
    const state = this.state;
    if (state.phase === "ended") return;
    state.tick++;
    const phaseBefore = state.phase;

    if (state.phase === "playing") {
      tickMovement(this);
      tickTasks(this);
      if (tickSabotage(this)) {
        this.endMatch("infiltrators", "critical_sabotage");
        return;
      }
    } else if (state.phase === "meeting") {
      tickMeeting(this);
    }
    if (this.checkWinNow()) return;
    if (state.tick >= secondsToTicks(state.settings.maxMatchSec)) {
      this.endMatch("infiltrators", "time_limit");
      return;
    }
    if (state.phase !== phaseBefore || state.tick % PERCEPTION_INTERVAL_TICKS === 0) this.updatePerception();
  }

  private checkWinNow(): boolean {
    if (this.state.phase !== "playing") return false;
    const win = checkWin(this.state);
    if (!win) return false;
    this.endMatch(win.winner, win.reason);
    return true;
  }

  private endMatch(winner: Team, reason: WinReason): void {
    const state = this.state;
    if (state.phase === "ended") return;
    clearSabotage(this, "match_end");
    for (const p of state.players) {
      p.moveIntent = { mode: "stop" };
      p.route = null;
      p.moving = false;
      p.taskSession = null;
      p.repair = null;
      p.ventId = null;
    }
    state.phase = "ended";
    state.meeting = null;
    state.outcome = { winner, reason, tick: state.tick };
    this.emit({ type: "MATCH_ENDED", winner, reason, roles: roleMap(state) });
  }

  /**
   * Visibility diffs and first sightings of bodies, delivered straight into observers' inboxes.
   * A player who drops out of sight is reported with the position/heading from the observer's LAST sighting,
   * never their current (unseen) position.
   */
  private updatePerception(): void {
    const { state, map } = this;
    const playing = state.phase === "playing";
    for (const observer of state.players) {
      const prev = this.visible.get(observer.id)!;
      const now = new Map<PlayerId, Sighting>();
      if (playing) {
        for (const id of visiblePlayerIds(state, map, observer)) {
          const t = getPlayer(state, id)!;
          now.set(id, { pos: t.pos, roomId: t.roomId, facing: t.facing, moving: t.moving });
          if (!prev.has(id)) this.deliver(observer.id, { type: "PLAYER_BECAME_VISIBLE", playerId: id, pos: t.pos, roomId: t.roomId });
        }
        for (const [id, last] of prev) {
          if (now.has(id)) continue;
          this.deliver(observer.id, {
            type: "PLAYER_LEFT_VISIBILITY",
            playerId: id,
            lastPos: last.pos,
            roomId: last.roomId,
            heading: last.moving ? compassDirection(last.facing) : null,
          });
        }
        for (const body of state.bodies) {
          if (body.seenBy.includes(observer.id) || !canSeePoint(state, map, observer, body.pos)) continue;
          body.seenBy.push(observer.id);
          this.emit({ type: "BODY_SEEN", bodyId: body.id, victimId: body.victimId, observerId: observer.id, roomId: body.roomId });
        }
      }
      this.visible.set(observer.id, now);
    }
  }
}

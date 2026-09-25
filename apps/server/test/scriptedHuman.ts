import { dist, type PlayerAction, type PlayerObservation, type ServerMessage, type TaskView, type Vec2 } from "@deduction/shared";
import { findPath, getMap, type GameMap } from "@deduction/maps";
import { solveFromViews } from "@deduction/tasks";

/**
 * A stand-in for a human at the keyboard: it only ever sees server messages (exactly what the browser gets) and
 * only sends what the browser can send — WASD-style directions and actions offered in `observation.legal`.
 * Public map geometry is fair game (the client renders it too). Used to prove the protocol is enough to play a
 * complete match.
 */
export class ScriptedHuman {
  obs: PlayerObservation | null = null;
  readonly received: ServerMessage[] = [];
  readonly sentActions: PlayerAction[] = [];
  readonly results: { action: string; ok: boolean; reason?: string }[] = [];
  ended = false;
  private seq = 0;
  private map: GameMap | null = null;
  private route: Vec2[] = [];
  private routeTarget: Vec2 | null = null;
  private lastPos: Vec2 | null = null;
  private stuckTicks = 0;
  private views: TaskView[] = [];
  private viewsKey = "";
  private answered = "";
  private spokeInMeeting: string | null = null;

  constructor(private readonly send: (raw: string) => void) {}

  onMessage(msg: ServerMessage): void {
    this.received.push(msg);
    if (msg.t === "match_started") this.map = getMap(msg.mapId);
    if (msg.t === "snapshot") this.obs = msg.observation;
    if (msg.t === "action_result") this.results.push({ action: msg.action, ok: msg.result.ok, ...(msg.result.ok ? {} : { reason: msg.result.reason }) });
    if (msg.t === "match_ended") this.ended = true;
  }

  /** Called every few ticks, like a person reacting to the screen. */
  think(): void {
    const obs = this.obs;
    if (!obs || !this.map || obs.phase === "ended") return;
    if (obs.phase === "meeting") return this.meeting(obs);
    const legal = obs.legal;

    if (obs.activeTask) return this.solveTask(obs);
    if (legal.report.length > 0) return this.act({ type: "REPORT_BODY", bodyId: legal.report[0]! });
    if (legal.kill.length > 0) return this.act({ type: "KILL", targetId: legal.kill[0]! });
    if (obs.self.repairingStationId) return this.move({ x: 0, y: 0 });
    if (legal.repair.length > 0 && obs.self.role === "crew") {
      this.move({ x: 0, y: 0 });
      return this.act({ type: "START_REPAIR", stationId: legal.repair[0]! });
    }
    if (legal.startTask.length > 0) {
      this.move({ x: 0, y: 0 });
      return this.act({ type: "START_TASK", taskId: legal.startTask[0]! });
    }

    const target = this.pickTarget(obs);
    if (target) this.walkTo(obs.self.pos, target);
    else this.move({ x: 0, y: 0 });
  }

  private pickTarget(obs: PlayerObservation): Vec2 | null {
    const me = obs.self.pos;
    const sab = obs.sabotage;
    if (sab && obs.self.role === "crew" && obs.self.alive) {
      const open = sab.stations.filter((s) => !s.fixed).sort((a, b) => dist(me, a.pos) - dist(me, b.pos));
      if (open[0]) return open[0].pos;
    }
    if (obs.self.role === "infiltrator" && obs.self.alive) {
      const prey = obs.visiblePlayers.filter((p) => !p.ghost && !obs.teammates.includes(p.id)).sort((a, b) => dist(me, a.pos) - dist(me, b.pos));
      if (prey[0]) return prey[0].pos;
    }
    const todo = obs.tasks.filter((t) => !t.done).sort((a, b) => dist(me, a.pos) - dist(me, b.pos));
    return todo[0]?.pos ?? null;
  }

  private walkTo(from: Vec2, target: Vec2): void {
    const map = this.map!;
    const moved = this.lastPos ? dist(this.lastPos, from) : 1;
    this.stuckTicks = moved < 0.05 ? this.stuckTicks + 1 : 0;
    this.lastPos = from;
    if (!this.routeTarget || dist(this.routeTarget, target) > 0.5 || this.route.length === 0 || this.stuckTicks > 3) {
      this.route = findPath(map, from, target) ?? [];
      this.routeTarget = target;
      this.stuckTicks = 0;
    }
    while (this.route.length > 0 && dist(this.route[0]!, from) < 0.25) this.route.shift();
    const next = this.route[0];
    if (!next) return this.move({ x: 0, y: 0 });
    const dx = next.x - from.x;
    const dy = next.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    this.move({ x: dx / len, y: dy / len });
  }

  private solveTask(obs: PlayerObservation): void {
    const task = obs.activeTask!;
    this.move({ x: 0, y: 0 });
    const key = `${task.taskId}#${task.attempt}`;
    if (key !== this.viewsKey) {
      this.viewsKey = key;
      this.views = [];
    }
    if (this.views.at(-1)?.phase !== task.view.phase) this.views.push(task.view);
    if (task.phase !== "answer" || obs.legal.submitAnswer !== task.taskId || this.answered === key) return;
    this.answered = key;
    this.act({ type: "SUBMIT_TASK_ANSWER", taskId: task.taskId, answer: solveFromViews(task.kind, this.views) });
  }

  private meeting(obs: PlayerObservation): void {
    const m = obs.meeting;
    // Meetings reset every movement intent: forget what was last sent.
    this.lastDir = { x: 0, y: 0 };
    this.route = [];
    if (!m) return;
    if (obs.legal.speak && this.spokeInMeeting !== m.meetingId && m.phase === "discussion") {
      this.spokeInMeeting = m.meetingId;
      return this.act({ type: "SPEAK", text: "I was doing my tasks. No idea yet." });
    }
    if (obs.legal.vote.includes("skip")) this.act({ type: "VOTE", target: "skip" });
  }

  private lastDir: Vec2 = { x: 0, y: 0 };
  private move(dir: Vec2): void {
    if (dir.x === this.lastDir.x && dir.y === this.lastDir.y) return;
    this.lastDir = dir;
    this.send(JSON.stringify({ t: "input", seq: this.seq++, dir }));
  }

  private act(action: PlayerAction): void {
    this.sentActions.push(action);
    this.send(JSON.stringify({ t: "action", seq: this.seq++, action }));
  }
}

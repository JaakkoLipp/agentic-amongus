import { dist, secondsToTicks, type AreaId, type MoveIntent, type OwnTask, type PlayerAction, type PlayerId, type Vec2, type VisiblePlayer } from "@deduction/shared";
import { nearestWalkable, travelDistance } from "@deduction/maps";
import type { ActiveGoal, ExecContext, ExecStep } from "./types";

export const STOP: MoveIntent = { mode: "stop" };
export const pathTo = (target: Vec2): MoveIntent => ({ mode: "path", target });

export const running = (move: MoveIntent | null, actions: readonly PlayerAction[] = []): ExecStep => ({ move, actions, status: "running" });
export const done = (actions: readonly PlayerAction[] = [], note?: string): ExecStep => ({ move: actions.length > 0 ? null : STOP, actions, status: "done", ...(note ? { note } : {}) });
export const failed = (note: string): ExecStep => ({ move: STOP, actions: [], status: "failed", note });

const STUCK_SEC = 6;

/**
 * Walk towards `target`. Reports arrival within `arriveDist`, and fails the goal if the distance stops shrinking
 * for several seconds (blocked route, unreachable point).
 */
export function travel(ctx: ExecContext, active: ActiveGoal, target: Vec2, arriveDist = 0.6): { arrived: boolean; step: ExecStep } {
  const d = dist(ctx.obs.self.pos, target);
  if (d <= arriveDist) return { arrived: true, step: running(STOP) };
  const s = active.scratch;
  const tick = ctx.obs.tick;
  if (s.lastDist === undefined || d < s.lastDist - 0.4 || !s.target || dist(s.target, target) > 1) {
    s.lastDist = d;
    s.lastProgressTick = tick;
  }
  s.target = target;
  if (tick - (s.lastProgressTick ?? tick) > secondsToTicks(STUCK_SEC)) return { arrived: false, step: failed("stuck: no progress towards destination") };
  return { arrived: false, step: running(pathTo(target)) };
}

export const visiblePlayer = (ctx: ExecContext, id: PlayerId): VisiblePlayer | undefined =>
  ctx.obs.visiblePlayers.find((v) => v.id === id && !v.ghost);

/** Living, non-ghost visible players that are not my infiltrator teammates. */
export function visibleOthers(ctx: ExecContext): VisiblePlayer[] {
  const mates = new Set(ctx.obs.teammates);
  return ctx.obs.visiblePlayers.filter((v) => !v.ghost && !mates.has(v.id));
}

/** Best current estimate of where a player is: live position if visible, otherwise the last sighting. */
export function estimatedPosition(ctx: ExecContext, id: PlayerId): { pos: Vec2; live: boolean } | null {
  const v = visiblePlayer(ctx, id);
  if (v) return { pos: v.pos, live: true };
  const lk = ctx.memory.lastKnown.get(id);
  return lk ? { pos: lk.pos, live: false } : null;
}

export function pendingTasks(ctx: ExecContext): OwnTask[] {
  return ctx.obs.tasks.filter((t) => !t.done);
}

export function nearestTask(ctx: ExecContext, tasks: readonly OwnTask[] = pendingTasks(ctx)): OwnTask | null {
  let best: OwnTask | null = null;
  let bestD = Infinity;
  for (const t of tasks) {
    const d = travelDistance(ctx.map, ctx.obs.self.pos, t.pos);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function areaCenter(ctx: ExecContext, roomId: AreaId): Vec2 | null {
  return ctx.map.areaById.get(roomId)?.center ?? null;
}

/** Deterministic pseudo-random walkable point inside a room (for investigating / wandering). */
export function randomPointInRoom(ctx: ExecContext, roomId: AreaId): Vec2 | null {
  const area = ctx.map.areaById.get(roomId);
  if (!area) return null;
  const rect = ctx.rng.pick(area.rects);
  for (let i = 0; i < 8; i++) {
    const p = { x: rect.x + 1 + ctx.rng.next() * Math.max(0, rect.w - 2), y: rect.y + 1 + ctx.rng.next() * Math.max(0, rect.h - 2) };
    const snapped = nearestWalkable(ctx.map, p);
    if (ctx.map.areaIndex[Math.floor(snapped.y) * ctx.map.width + Math.floor(snapped.x)] === area.index) return snapped;
  }
  return area.center;
}

/** Rooms (not corridors), optionally excluding some. */
export function roomIds(ctx: ExecContext, exclude: readonly (AreaId | null)[] = []): AreaId[] {
  return ctx.map.areas.filter((a) => a.kind === "room" && !exclude.includes(a.id)).map((a) => a.id);
}

/** A room far (by walking distance) from `from`, used for fleeing. */
export function farRoom(ctx: ExecContext, from: Vec2, exclude: readonly (AreaId | null)[] = []): AreaId | null {
  const candidates = roomIds(ctx, exclude)
    .map((id) => ({ id, d: travelDistance(ctx.map, from, ctx.map.areaById.get(id)!.center), mine: travelDistance(ctx.map, ctx.obs.self.pos, ctx.map.areaById.get(id)!.center) }))
    .filter((c) => Number.isFinite(c.d) && Number.isFinite(c.mine));
  if (candidates.length === 0) return null;
  // Far from the danger, but not absurdly far from me.
  candidates.sort((a, b) => b.d - b.mine * 0.5 - (a.d - a.mine * 0.5));
  return candidates[0]!.id;
}

/** How many other (non-teammate, non-target) players I can currently see — potential witnesses. */
export function witnessCount(ctx: ExecContext, targetId: PlayerId | null): number {
  return visibleOthers(ctx).filter((v) => v.id !== targetId).length;
}

/** Visible crew-candidates that look isolated from my point of view, nearest first. */
export function isolatedTargets(ctx: ExecContext): VisiblePlayer[] {
  const others = visibleOthers(ctx);
  return others
    .filter((t) => others.every((o) => o.id === t.id || dist(o.pos, t.pos) > 7))
    .sort((a, b) => dist(a.pos, ctx.obs.self.pos) - dist(b.pos, ctx.obs.self.pos));
}

export const elapsed = (ctx: ExecContext, active: ActiveGoal): number => ctx.obs.tick - active.startedTick;

/** Throttle repeated attempts of the same action (the engine may reject while e.g. cooldowns tick down). */
export function canAct(ctx: ExecContext, active: ActiveGoal, everySec = 1): boolean {
  const last = active.scratch.lastActionTick;
  if (last !== undefined && ctx.obs.tick - last < secondsToTicks(everySec)) return false;
  active.scratch.lastActionTick = ctx.obs.tick;
  return true;
}

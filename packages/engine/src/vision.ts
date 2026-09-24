import { distSq, type PlayerId, type Vec2 } from "@deduction/shared";
import { hasLineOfSight, type GameMap } from "@deduction/maps";
import type { GameState, PlayerState } from "./state";

/**
 * Pure visibility rules. Everything an agent learns about the world passes through these functions.
 *
 * - Vision is a disc (radius depends on role, lights sabotage, ghost state) clipped by walls and obstacles.
 * - Players inside vents are invisible to everyone else.
 * - Ghosts are only visible to other ghosts; ghosts see further and ignore lights.
 * - Nobody perceives the world during a meeting.
 */

export function visionRadius(state: GameState, observer: PlayerState): number {
  const s = state.settings;
  if (!observer.alive) return s.crewVision * 1.5;
  if (observer.role === "infiltrator") return s.infiltratorVision;
  const lightsOut = state.sabotage?.kind === "lights";
  return lightsOut ? Math.max(1.5, s.crewVision * s.lightsVisionFactor) : s.crewVision;
}

export function canSeePoint(state: GameState, map: GameMap, observer: PlayerState, point: Vec2): boolean {
  if (state.phase !== "playing") return false;
  const r = visionRadius(state, observer);
  if (distSq(observer.pos, point) > r * r) return false;
  return hasLineOfSight(map, observer.pos, point);
}

export function canSeePlayer(state: GameState, map: GameMap, observer: PlayerState, target: PlayerState): boolean {
  if (observer.id === target.id) return true;
  if (target.ventId !== null) return false;
  if (!target.alive && observer.alive) return false;
  return canSeePoint(state, map, observer, target.pos);
}

/** Everyone (other than `exclude`) who could see `point` right now. */
export function witnessesOfPoint(state: GameState, map: GameMap, point: Vec2, exclude: readonly PlayerId[] = []): PlayerId[] {
  const out: PlayerId[] = [];
  for (const p of state.players) {
    if (exclude.includes(p.id)) continue;
    if (canSeePoint(state, map, p, point)) out.push(p.id);
  }
  return out;
}

/**
 * Everyone who could see `target` at its current position. Used for movement/task events. Venting and ghost
 * concealment are applied by the caller's choice of timing (e.g. a vent entry is witnessed before hiding).
 */
export function witnessesOfPlayer(state: GameState, map: GameMap, target: PlayerState): PlayerId[] {
  const out: PlayerId[] = [];
  for (const p of state.players) {
    if (p.id === target.id) continue;
    if (!target.alive && p.alive) continue;
    if (canSeePoint(state, map, p, target.pos)) out.push(p.id);
  }
  return out;
}

export function visiblePlayerIds(state: GameState, map: GameMap, observer: PlayerState): PlayerId[] {
  const out: PlayerId[] = [];
  for (const t of state.players) if (t.id !== observer.id && canSeePlayer(state, map, observer, t)) out.push(t.id);
  return out;
}

/**
 * Proximity speech: audible within hearing range if there is line of sight, or within half the range through walls.
 * Only living players speak to and hear living players; ghosts hear everyone but are never heard by the living.
 */
export function hearers(state: GameState, map: GameMap, speaker: PlayerState): PlayerId[] {
  const range = state.settings.hearingRange;
  const out: PlayerId[] = [];
  for (const p of state.players) {
    if (p.id === speaker.id) continue;
    if (p.alive && !speaker.alive) continue;
    const d2 = distSq(p.pos, speaker.pos);
    if (d2 > range * range) continue;
    if (d2 <= (range / 2) * (range / 2) || hasLineOfSight(map, p.pos, speaker.pos)) out.push(p.id);
  }
  return out;
}

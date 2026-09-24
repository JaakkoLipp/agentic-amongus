import { dist, secondsToTicks, type ActionResult, type PlayerId } from "@deduction/shared";
import { hasLineOfSight, nearestWalkable, type GameMap } from "@deduction/maps";
import { OK, reject, type EngineContext } from "../context";
import { getPlayer, type GameState, type PlayerState } from "../state";
import { canSeePlayer, witnessesOfPoint } from "../vision";
import { cancelTask } from "./tasks";
import { stopRepair } from "./sabotage";
import { placePlayer } from "./movement";

export function validateKill(state: GameState, map: GameMap, killer: PlayerState, targetId: PlayerId): ActionResult {
  if (state.phase !== "playing") return reject("not_playing");
  if (!killer.alive) return reject("dead");
  if (killer.role !== "infiltrator") return reject("wrong_role");
  if (killer.ventId !== null) return reject("in_vent");
  if (state.tick < killer.killReadyAtTick) return reject("cooldown");
  const target = getPlayer(state, targetId);
  // Unseen targets (dead, venting, out of sight) all look the same, so rejections cannot reveal unwitnessed deaths.
  if (!target || target.id === killer.id || target.role === "infiltrator" || !target.alive || !canSeePlayer(state, map, killer, target)) return reject("invalid_target");
  if (dist(killer.pos, target.pos) > state.settings.killRange) return reject("out_of_range");
  if (!hasLineOfSight(map, killer.pos, target.pos)) return reject("no_line_of_sight");
  return OK;
}

/** Kill: the victim becomes a ghost, a body is left behind, the killer snaps onto the body's position. */
export function applyKill(ctx: EngineContext, killer: PlayerState, victim: PlayerState): void {
  const { state, map } = ctx;
  const pos = victim.pos;
  // Witnesses are decided before anything moves: they must see the spot where it happens.
  const witnesses = witnessesOfPoint(state, map, pos, [killer.id, victim.id]);
  cancelTask(ctx, victim);
  stopRepair(ctx, victim);
  cancelTask(ctx, killer);
  victim.alive = false;
  victim.deathTick = state.tick;
  victim.deathCause = "killed";
  victim.moveIntent = { mode: "stop" };
  victim.route = null;
  const bodyId = `body-${state.nextBodyNumber++}`;
  state.bodies.push({ id: bodyId, victimId: victim.id, killerId: killer.id, pos, roomId: victim.roomId, tick: state.tick, witnesses, seenBy: [...witnesses, killer.id], reported: false });
  killer.killReadyAtTick = state.tick + secondsToTicks(state.settings.killCooldownSec);
  placePlayer(ctx, killer, nearestWalkable(map, pos), true);
  ctx.emit({ type: "PLAYER_KILLED", killerId: killer.id, victimId: victim.id, bodyId, pos, roomId: victim.roomId, witnesses });
}

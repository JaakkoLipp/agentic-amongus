import type { ActionRejectReason, ActionResult, GameEvent, GameEventBody } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import type { GameState } from "./state";

/** What rule functions get: the mutable state, the static map, and the single way to record what happened. */
export interface EngineContext {
  readonly state: GameState;
  readonly map: GameMap;
  emit(body: GameEventBody): GameEvent;
}

export const OK: ActionResult = { ok: true };
export const reject = (reason: ActionRejectReason): ActionResult => ({ ok: false, reason });

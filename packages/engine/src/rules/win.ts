import type { Team, WinReason } from "@deduction/shared";
import { aliveCount, type GameState } from "../state";

export interface WinResult {
  readonly winner: Team;
  readonly reason: WinReason;
}

/**
 * Pure win check over the current state (critical sabotage expiry and the time limit are detected by the tick loop
 * and passed in). Order matters: an ejection that removes the last infiltrator wins for the crew even if parity
 * would otherwise hold.
 */
export function checkWin(state: GameState): WinResult | null {
  const infiltrators = aliveCount(state, "infiltrator");
  const crew = aliveCount(state, "crew");
  if (infiltrators === 0) return { winner: "crew", reason: "all_infiltrators_ejected" };
  if (state.taskProgress.total > 0 && state.taskProgress.completed >= state.taskProgress.total) return { winner: "crew", reason: "tasks_completed" };
  if (infiltrators >= crew) return { winner: "infiltrators", reason: "infiltrator_parity" };
  return null;
}

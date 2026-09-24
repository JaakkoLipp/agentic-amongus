/**
 * Roles. "Infiltrator" is this project's impostor-equivalent; "crew" are everyone else.
 * Teams and roles are 1:1 for now; the split exists so extra roles (e.g. an engineer who may vent) can join a team later.
 */
export type Role = "crew" | "infiltrator";
export type Team = "crew" | "infiltrators";

export const teamOf = (role: Role): Team => (role === "infiltrator" ? "infiltrators" : "crew");

export type WinReason =
  | "all_infiltrators_ejected"
  | "tasks_completed"
  | "infiltrator_parity"
  | "critical_sabotage"
  /** Safety valve only; the simulator reports these as stalled. */
  | "time_limit";

export type SabotageKind = "lights" | "reactor" | "oxygen" | "comms";

/** Critical sabotages end the match for the infiltrators when their countdown expires. */
export const CRITICAL_SABOTAGES: readonly SabotageKind[] = ["reactor", "oxygen"];
export const isCriticalSabotage = (k: SabotageKind): boolean => CRITICAL_SABOTAGES.includes(k);

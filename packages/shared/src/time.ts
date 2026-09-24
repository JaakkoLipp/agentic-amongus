import type { Tick } from "./ids";

/** Fixed simulation rate. Movement, cooldowns and timers advance once per tick. */
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;

export const secondsToTicks = (seconds: number): Tick => Math.round(seconds * TICK_RATE);
export const ticksToSeconds = (ticks: Tick): number => ticks / TICK_RATE;

/** `mm:ss` match clock used in logs, memories and the inspector timeline. */
export function formatClock(tick: Tick): string {
  const total = Math.max(0, Math.floor(tick / TICK_RATE));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

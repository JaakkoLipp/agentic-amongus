import { useEffect, useState, useSyncExternalStore } from "react";
import { TICK_MS, type Tick } from "@deduction/shared";
import type { ClientState, ClientStore } from "./store";

export function useClientState(store: ClientStore): ClientState {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Re-render every `ms` while mounted (countdowns). */
export function useTicker(ms = 100): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** The server tick right now, estimated from the latest snapshot and the time since it arrived. */
export function estimatedTick(store: ClientStore, now: number): Tick {
  const last = store.buffer.at(-1);
  if (!last) return 0;
  if (last.obs.phase === "ended") return last.obs.tick;
  return last.obs.tick + Math.max(0, now - last.at) / TICK_MS;
}

export function secondsUntil(store: ClientStore, tick: Tick | null, now: number): number | null {
  if (tick === null) return null;
  return Math.max(0, (tick - estimatedTick(store, now)) * (TICK_MS / 1000));
}

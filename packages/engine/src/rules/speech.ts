import { secondsToTicks, type ActionResult } from "@deduction/shared";
import { OK, reject, type EngineContext } from "../context";
import type { GameState, PlayerState } from "../state";
import { hearers } from "../vision";
import { applyMeetingSpeech, validateMeetingSpeech } from "./meeting";

/** Collapse whitespace, strip control characters, cap length. Returns null if nothing speakable remains. */
export function sanitizeUtterance(text: string, maxChars: number): string | null {
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length === 0) return null;
  return clean.length > maxChars ? `${clean.slice(0, maxChars - 1)}…` : clean;
}

export function validateSpeak(state: GameState, p: PlayerState): ActionResult {
  if (state.phase === "meeting") return validateMeetingSpeech(state, p);
  if (state.phase !== "playing") return reject("not_playing");
  if (!state.settings.proximitySpeech) return reject("wrong_phase");
  if (!p.alive) return reject("dead");
  if (p.ventId !== null) return reject("in_vent");
  if (state.tick < p.speechReadyAtTick) return reject("rate_limited");
  return OK;
}

/** Proximity speech while playing (only nearby players hear it), meeting message during a meeting. */
export function applySpeak(ctx: EngineContext, p: PlayerState, text: string): void {
  if (ctx.state.phase === "meeting") {
    applyMeetingSpeech(ctx, p, text);
    return;
  }
  p.speechReadyAtTick = ctx.state.tick + secondsToTicks(ctx.state.settings.speechCooldownSec);
  ctx.emit({ type: "PLAYER_SPOKE", playerId: p.id, text, hearers: hearers(ctx.state, ctx.map, p) });
}

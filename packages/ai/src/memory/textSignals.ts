import type { AreaId, PlayerId, RosterEntry } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";

/**
 * Cheap, deterministic reading of free-form speech (human or agent). Heuristic agents use it to react to what
 * people say in meetings; LLM agents read the raw text instead. Never used to parse commands.
 */
export interface TextSignal {
  readonly mentions: readonly PlayerId[];
  readonly accuses: readonly PlayerId[];
  readonly defends: readonly PlayerId[];
  readonly roomsMentioned: readonly AreaId[];
  readonly suggestsSkip: boolean;
  readonly isQuestion: boolean;
}

const ACCUSE = new Set(["kill", "killed", "killer", "killing", "vent", "vented", "venting", "sus", "suspicious", "sussy", "impostor", "imposter", "infiltrator", "lying", "liar", "lie", "lies", "eject", "fake", "faking", "faked", "weird", "following", "murderer", "guilty", "traitor", "vote"]);
const DEFEND = new Set(["clear", "cleared", "safe", "innocent", "trust", "vouch", "confirm", "confirmed", "alibi", "with"]);
const NEGATORS = new Set(["not", "never", "isn't", "wasn't", "didn't", "no", "dont", "don't"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

export function parseUtterance(text: string, roster: readonly RosterEntry[], map: GameMap | null, speakerId: PlayerId | null = null): TextSignal {
  const tokens = tokenize(text);
  const nameToId = new Map<string, PlayerId>();
  for (const r of roster) {
    nameToId.set(r.name.toLowerCase(), r.id);
    nameToId.set(r.id.toLowerCase(), r.id);
  }
  const mentionPositions: { id: PlayerId; index: number }[] = [];
  tokens.forEach((t, index) => {
    const id = nameToId.get(t);
    if (id && id !== speakerId) mentionPositions.push({ id, index });
  });
  const keywordPositions: { index: number; stance: "accuse" | "defend" }[] = [];
  tokens.forEach((t, index) => {
    let stance: "accuse" | "defend" | null = ACCUSE.has(t) ? "accuse" : DEFEND.has(t) ? "defend" : null;
    if (!stance) return;
    const prev = tokens[index - 1];
    if (prev && NEGATORS.has(prev)) stance = stance === "accuse" ? "defend" : "accuse";
    keywordPositions.push({ index, stance });
  });

  const accuses = new Set<PlayerId>();
  const defends = new Set<PlayerId>();
  for (const m of mentionPositions) {
    let best: { stance: "accuse" | "defend"; d: number } | null = null;
    for (const k of keywordPositions) {
      const d = Math.abs(k.index - m.index);
      if (d <= 6 && (!best || d < best.d)) best = { stance: k.stance, d };
    }
    if (best?.stance === "accuse") accuses.add(m.id);
    else if (best?.stance === "defend") defends.add(m.id);
  }

  const roomsMentioned: AreaId[] = [];
  if (map) {
    const lower = ` ${tokens.join(" ")} `;
    for (const area of map.areas) {
      const full = area.name.toLowerCase();
      // Rooms also match on their first word ("electrical", "cargo", "life"); corridors only on the full name,
      // so "heading north" is not read as "North Hall".
      const names = area.kind === "room" ? [full, area.id.replace(/_/g, " "), full.split(" ")[0]!] : [full];
      if (names.some((n) => lower.includes(` ${n} `))) roomsMentioned.push(area.id);
    }
  }

  return {
    mentions: [...new Set(mentionPositions.map((m) => m.id))],
    accuses: [...accuses],
    defends: [...defends],
    roomsMentioned,
    suggestsSkip: tokens.includes("skip"),
    isQuestion: text.includes("?") || ["where", "who", "why", "what"].includes(tokens[0] ?? ""),
  };
}

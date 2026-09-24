import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, readView, standbyView } from "./util";

const TITLE = "Log Audit";
const UNITS = ["Drone H", "Drone J", "Drone K", "Drone M", "Drone P", "Drone T", "Drone V", "Drone X"] as const;
export const LINE_IDS = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"] as const;

type LogEvent = "docked" | "undocked";
/** `minute` is minutes after midnight. */
export type LogLine = { id: string; minute: number; unit: string; event: LogEvent };
export type AnomalyData = { lines: LogLine[]; anomaly: string };

type Entry = { readonly minute: number; readonly unit: string; readonly event: string };

export const RULES_TEXT =
  "Rules: (1) each line's time must be later than the line above it; (2) every unit starts undocked, must dock " +
  "before it can undock, and cannot dock again until it has undocked.";

/** A log is consistent if times strictly increase and each unit alternates docked/undocked, starting with docked. */
export function isConsistentLog(entries: readonly Entry[]): boolean {
  const docked = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const prev = entries[i - 1];
    if (!e) return false;
    if (prev && e.minute <= prev.minute) return false;
    if (e.event === "docked") {
      if (docked.has(e.unit)) return false;
      docked.add(e.unit);
    } else if (e.event === "undocked") {
      if (!docked.has(e.unit)) return false;
      docked.delete(e.unit);
    } else {
      return false;
    }
  }
  return true;
}

/** Indices of the lines whose removal makes the log consistent. */
export function removableLines(entries: readonly Entry[]): number[] {
  return entries.flatMap((_, i) => (isConsistentLog(entries.filter((__, k) => k !== i)) ? [i] : []));
}

export const formatTime = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function parseTime(time: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const LINE_COUNT: Record<TaskDifficulty, number> = { 1: 4, 2: 5, 3: 6 };
const MAIN_UNITS: Record<TaskDifficulty, number> = { 1: 2, 2: 2, 3: 3 };

type Draft = { minute: number; unit: string; event: LogEvent };

function tryGenerate(rng: Rng, difficulty: TaskDifficulty): AnomalyData | null {
  const n = LINE_COUNT[difficulty];
  const names = rng.sample(UNITS, MAIN_UNITS[difficulty] + 1);
  const spare = names[names.length - 1] ?? "Drone Z";
  const main = names.slice(0, -1);

  // A consistent base log of n-1 events.
  const isDocked = new Set<string>();
  const base: Draft[] = [];
  for (let k = 0; k < n - 1; k++) {
    const unit = rng.pick(main);
    base.push({ minute: 0, unit, event: isDocked.has(unit) ? "undocked" : "docked" });
    if (isDocked.has(unit)) isDocked.delete(unit);
    else isDocked.add(unit);
  }

  const kind = rng.chance(0.5) ? "time" : "undock";
  let at: number;
  let bad: Draft;
  if (kind === "time") {
    // A natural next event for a unit with no later events, but stamped too early.
    at = rng.int(2, n - 1);
    const unit = rng.pick([spare, ...main.filter((u) => !base.slice(at).some((e) => e.unit === u))]);
    const dockedBefore = base.slice(0, at).filter((e) => e.unit === unit).length % 2 === 1;
    bad = { minute: 0, unit, event: dockedBefore ? "undocked" : "docked" };
  } else {
    // An undock by a unit that has not docked yet.
    at = rng.int(0, n - 1);
    const unit = rng.pick([spare, ...main.filter((u) => !base.slice(0, at).some((e) => e.unit === u))]);
    bad = { minute: 0, unit, event: "undocked" };
  }
  const drafts = [...base.slice(0, at), bad, ...base.slice(at)];

  let minute = rng.int(6 * 60, 20 * 60);
  for (const d of drafts) {
    d.minute = minute;
    minute += rng.int(1, 4);
  }
  if (kind === "time") {
    const first = drafts[0]?.minute ?? 0;
    const twoAbove = drafts[at - 2]?.minute ?? first;
    // Easy: earlier than every line above. Harder: only earlier than the lines two or more above it.
    bad.minute = difficulty === 1 ? rng.int(first - 8, first - 1) : rng.int(first - 6, twoAbove - 1);
  }

  const removable = removableLines(drafts);
  if (isConsistentLog(drafts) || removable.length !== 1 || removable[0] !== at) return null;
  const lines = drafts.map((d, i) => ({ id: LINE_IDS[i] ?? `L${i + 1}`, ...d }));
  return { lines, anomaly: lines[at]?.id ?? "" };
}

const lineText = (l: LogLine): string => `${formatTime(l.minute)} ${l.unit} ${l.event}`;

const answerContent = z.object({
  lines: z
    .array(z.object({ id: z.string(), time: z.string(), unit: z.string(), event: z.string() }))
    .max(16),
});

/** Reasoning: find the one log line (of 4/5/6) that breaks chronology or dock/undock order. */
export const anomalyDetection = defineTask<AnomalyData, string>({
  kind: "anomaly_detection",
  title: TITLE,
  category: "reasoning",
  isMemoryTask: false,

  generate(rng, difficulty) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const data = tryGenerate(rng, difficulty);
      if (data) return data;
    }
    throw new Error("anomaly_detection: generation failed");
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const lines = instance.data.lines;
    return buildView(
      instance,
      TITLE,
      phase,
      `Audit the docking log. ${RULES_TEXT} Exactly one line breaks the rules: removing it would make the log ` +
        "valid. Which line is it?",
      {
        rules: RULES_TEXT,
        lines: lines.map((l) => ({ id: l.id, time: formatTime(l.minute), unit: l.unit, event: l.event, text: lineText(l) })),
      },
      { type: "choice", options: lines.map((l) => ({ id: l.id, label: `${l.id}: ${lineText(l)}` })) },
    );
  },

  answerSchema: z.enum(LINE_IDS),

  check: (data, answer) => answer === data.anomaly,

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    if (!content) return null;
    const entries: Entry[] = [];
    for (const l of content.lines) {
      const minute = parseTime(l.time);
      if (minute === null) return null;
      entries.push({ minute, unit: l.unit, event: l.event });
    }
    const removable = removableLines(entries);
    return removable.length === 1 ? (content.lines[removable[0] ?? -1]?.id ?? null) : null;
  },
});

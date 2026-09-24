import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import {
  ANSWER_ONLY_PHASES,
  buildView,
  defineTask,
  permutations,
  readView,
  sameSequence,
  shuffleChanged,
  standbyView,
} from "./util";

const TITLE = "Shift Schedule";
const EVENTS = [
  { id: "calibration", label: "Calibration" },
  { id: "refuel", label: "Refuel" },
  { id: "hull_scan", label: "Hull scan" },
  { id: "filter_swap", label: "Filter swap" },
  { id: "data_sync", label: "Data sync" },
  { id: "airlock_test", label: "Airlock test" },
  { id: "inventory", label: "Inventory" },
  { id: "fire_drill", label: "Fire drill" },
] as const;
export const EVENT_IDS = EVENTS.map((e) => e.id);
const EVENT_COUNT: Record<TaskDifficulty, number> = { 1: 3, 2: 4, 3: 5 };

type Event = { id: string; label: string };
/** "before": "<earlier> happened before <later>."; "after": "<later> happened after <earlier>." */
export type Statement = { earlier: string; later: string; phrasing: "before" | "after" };
/** `events` is the (shuffled) display order; `order` is the true order, earliest first. */
export type TemporalData = { events: Event[]; statements: Statement[]; order: string[] };

type Pair = { readonly earlier: string; readonly later: string };

/** All orderings of `ids` consistent with every statement. */
export function consistentOrders(ids: readonly string[], statements: readonly Pair[]): string[][] {
  return permutations(ids).filter((perm) =>
    statements.every((s) => {
      const a = perm.indexOf(s.earlier);
      const b = perm.indexOf(s.later);
      return a >= 0 && b >= 0 && a < b;
    }),
  );
}

function statementText(s: Statement, labels: ReadonlyMap<string, string>): string {
  const earlier = labels.get(s.earlier) ?? s.earlier;
  const later = labels.get(s.later) ?? s.later;
  return s.phrasing === "before" ? `${earlier} happened before ${later}.` : `${later} happened after ${earlier}.`;
}

function statement(rng: Rng, earlier: string, later: string): Statement {
  return { earlier, later, phrasing: rng.chance(0.5) ? "before" : "after" };
}

const answerContent = z.object({
  events: z.array(z.object({ id: z.string() })).max(8),
  statements: z.array(z.object({ earlier: z.string(), later: z.string() })).max(16),
});

/** Reasoning: order 3/4/5 events from shuffled pairwise before/after statements with a unique solution. */
export const temporalReasoning = defineTask<TemporalData, readonly string[]>({
  kind: "temporal_reasoning",
  title: TITLE,
  category: "reasoning",
  isMemoryTask: false,

  generate(rng, difficulty) {
    const chosen: Event[] = rng.sample(EVENTS, EVENT_COUNT[difficulty]).map((e) => ({ id: e.id, label: e.label }));
    const order = chosen.map((e) => e.id);
    // Every adjacent pair must be stated for the order to be unique; d2/d3 add one redundant long-range fact.
    const statements = order.slice(1).map((later, i) => statement(rng, order[i] ?? "", later));
    if (difficulty >= 2) {
      const i = rng.int(0, order.length - 3);
      const j = rng.int(i + 2, order.length - 1);
      statements.push(statement(rng, order[i] ?? "", order[j] ?? ""));
    }
    if (consistentOrders(order, statements).length !== 1) throw new Error("temporal_reasoning: ambiguous order");
    return { events: shuffleChanged(rng, chosen), statements: rng.shuffle(statements), order };
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { events, statements } = instance.data;
    const labels = new Map(events.map((e) => [e.id, e.label]));
    return buildView(
      instance,
      TITLE,
      phase,
      "Using the statements, put the shift events in the order they happened, earliest first. " +
        "Exactly one order fits all statements.",
      {
        events: events.map((e) => ({ id: e.id, label: e.label })),
        statements: statements.map((s) => ({ text: statementText(s, labels), earlier: s.earlier, later: s.later })),
      },
      { type: "ordering", items: events.map((e) => ({ id: e.id, label: e.label })) },
    );
  },

  answerSchema: z.array(z.enum(EVENT_IDS)).min(1).max(8),

  check: (data, answer) => sameSequence(answer, data.order),

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    if (!content) return null;
    const orders = consistentOrders(
      content.events.map((e) => e.id),
      content.statements,
    );
    return orders.length === 1 ? (orders[0] ?? null) : null;
  },
});

import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, hasNoDuplicates, readView, standbyView } from "./util";

const TITLE = "Navigation Plot";
export const NODE_IDS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
/** Nodes sit on a small lattice (x 0..3, y 0..2) so the map can be drawn without crossings. */
const LATTICE_W = 4;
const LATTICE_H = 3;

export type GraphNode = { id: string; x: number; y: number };
export type GraphEdge = { a: string; b: string; blocked: boolean };
export type RouteData = { nodes: GraphNode[]; edges: GraphEdge[]; start: string; goal: string };

type EdgeLike = { readonly a: string; readonly b: string; readonly blocked: boolean };

/** Hop distance from `from` to every reachable node over open edges. */
export function hopDistances(edges: readonly EdgeLike[], from: string): Map<string, number> {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i] ?? "";
    const d = dist.get(node) ?? 0;
    for (const e of edges) {
      if (e.blocked || (e.a !== node && e.b !== node)) continue;
      const next = e.a === node ? e.b : e.a;
      if (!dist.has(next)) {
        dist.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

/** One shortest open path (BFS order), or null if the goal is unreachable. */
export function shortestPath(edges: readonly EdgeLike[], start: string, goal: string): string[] | null {
  const toGoal = hopDistances(edges, goal);
  let d = toGoal.get(start);
  if (d === undefined) return null;
  const path = [start];
  let node = start;
  while (node !== goal) {
    const next = edges
      .filter((e) => !e.blocked && (e.a === node || e.b === node))
      .map((e) => (e.a === node ? e.b : e.a))
      .filter((n) => toGoal.get(n) === (d ?? 0) - 1)
      .sort()[0];
    if (next === undefined) return null;
    path.push(next);
    node = next;
    d = (d ?? 0) - 1;
  }
  return path;
}

/** Valid = starts/ends right, no repeats, every hop over an open edge. Correct = valid and minimal hop count. */
export function isShortestRoute(data: RouteData, path: readonly string[]): boolean {
  if (path[0] !== data.start || path[path.length - 1] !== data.goal || !hasNoDuplicates(path)) return false;
  const open = (u: string, v: string): boolean =>
    data.edges.some((e) => !e.blocked && ((e.a === u && e.b === v) || (e.a === v && e.b === u)));
  for (let i = 1; i < path.length; i++) if (!open(path[i - 1] ?? "", path[i] ?? "")) return false;
  const best = hopDistances(data.edges, data.start).get(data.goal);
  return best !== undefined && path.length - 1 === best;
}

const NODE_COUNT: Record<TaskDifficulty, number> = { 1: 5, 2: 6, 3: 7 };
const MIN_HOPS: Record<TaskDifficulty, number> = { 1: 2, 2: 2, 3: 3 };
const EXTRA_BLOCKS: Record<TaskDifficulty, number> = { 1: 0, 2: 1, 3: 1 };

const blockEdge = (edges: readonly GraphEdge[], target: GraphEdge): GraphEdge[] =>
  edges.map((x) => (x === target ? { ...x, blocked: true } : x));

const reachable = (edges: readonly EdgeLike[], start: string, goal: string): boolean =>
  hopDistances(edges, start).has(goal);

function randomGraph(rng: Rng, n: number): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
  // Grow a connected blob of lattice points.
  const key = (x: number, y: number): string => `${x},${y}`;
  const points = [{ x: rng.int(0, LATTICE_W - 1), y: rng.int(0, LATTICE_H - 1) }];
  const taken = new Set(points.map((p) => key(p.x, p.y)));
  while (points.length < n) {
    const frontier = points
      .flatMap((p) => [
        { x: p.x + 1, y: p.y },
        { x: p.x - 1, y: p.y },
        { x: p.x, y: p.y + 1 },
        { x: p.x, y: p.y - 1 },
      ])
      .filter((p) => p.x >= 0 && p.x < LATTICE_W && p.y >= 0 && p.y < LATTICE_H && !taken.has(key(p.x, p.y)));
    if (frontier.length === 0) return null;
    const p = rng.pick(frontier);
    taken.add(key(p.x, p.y));
    points.push(p);
  }
  points.sort((p, q) => p.y - q.y || p.x - q.x);
  const nodes = points.map((p, i) => ({ id: NODE_IDS[i] ?? "?", x: p.x, y: p.y }));
  const at = (x: number, y: number): string | undefined => nodes.find((v) => v.x === x && v.y === y)?.id;

  const edges: GraphEdge[] = [];
  const link = (a: string | undefined, b: string | undefined): void => {
    if (a !== undefined && b !== undefined) edges.push({ a: a < b ? a : b, b: a < b ? b : a, blocked: false });
  };
  for (const v of nodes) {
    if (rng.chance(0.85)) link(v.id, at(v.x + 1, v.y));
    if (rng.chance(0.85)) link(v.id, at(v.x, v.y + 1));
    // At most one diagonal per lattice square, so edges never cross.
    if (rng.chance(0.2)) {
      if (rng.chance(0.5)) link(v.id, at(v.x + 1, v.y + 1));
      else link(at(v.x + 1, v.y), at(v.x, v.y + 1));
    }
  }
  const first = nodes[0]?.id ?? "A";
  const connected = hopDistances(edges, first).size === nodes.length;
  return connected && edges.length >= nodes.length ? { nodes, edges } : null;
}

function tryGenerate(rng: Rng, difficulty: TaskDifficulty, requireDetour: boolean): RouteData | null {
  const graph = randomGraph(rng, NODE_COUNT[difficulty]);
  if (!graph) return null;
  const { nodes, edges } = graph;
  const pairs = nodes.flatMap((s) =>
    nodes.flatMap((g) => {
      const d = hopDistances(edges, s.id).get(g.id) ?? 0;
      return s.id !== g.id && d >= MIN_HOPS[difficulty] ? [{ start: s.id, goal: g.id }] : [];
    }),
  );
  if (pairs.length === 0) return null;
  const { start, goal } = rng.pick(pairs);

  // Block an edge on a shortest path; prefer one whose loss forces a longer detour.
  const fromStart = hopDistances(edges, start);
  const toGoal = hopDistances(edges, goal);
  const best = fromStart.get(goal) ?? 0;
  const onShortest = edges.filter(
    (e) =>
      (fromStart.get(e.a) ?? 99) + 1 + (toGoal.get(e.b) ?? 99) === best ||
      (fromStart.get(e.b) ?? 99) + 1 + (toGoal.get(e.a) ?? 99) === best,
  );
  const keepsRoute = onShortest.filter((e) => reachable(blockEdge(edges, e), start, goal));
  const detours = keepsRoute.filter((e) => (hopDistances(blockEdge(edges, e), start).get(goal) ?? 0) > best);
  const pool = detours.length > 0 ? detours : requireDetour ? [] : keepsRoute;
  if (pool.length === 0) return null;
  let current = blockEdge(edges, rng.pick(pool));

  for (let k = 0; k < EXTRA_BLOCKS[difficulty]; k++) {
    const options = current.filter((e) => !e.blocked && reachable(blockEdge(current, e), start, goal));
    if (options.length > 0) current = blockEdge(current, rng.pick(options));
  }
  return { nodes, edges: current, start, goal };
}

const answerContent = z.object({
  edges: z.array(z.object({ a: z.string(), b: z.string(), blocked: z.boolean() })).max(64),
  start: z.string(),
  goal: z.string(),
});

/** Planning: shortest open route on a 5/6/7-node lattice map with 1/2/2 blocked links. */
export const routePlanning = defineTask<RouteData, readonly string[]>({
  kind: "route_planning",
  title: TITLE,
  category: "planning",
  isMemoryTask: false,

  generate(rng, difficulty) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      // First try hard for a block that forces a detour; later accept one that only removes a shortest route.
      const data = tryGenerate(rng, difficulty, attempt < 200);
      if (data) return data;
    }
    throw new Error("route_planning: generation failed");
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { nodes, edges, start, goal } = instance.data;
    return buildView(
      instance,
      TITLE,
      phase,
      `Plot the shortest route from ${start} to ${goal}. Travel only along open links; blocked links cannot be ` +
        "used. Enter the route as the list of nodes from start to goal with the fewest hops (any shortest route " +
        "is accepted).",
      {
        nodes: nodes.map((v) => ({ id: v.id, x: v.x, y: v.y })),
        edges: edges.map((e) => ({ a: e.a, b: e.b, blocked: e.blocked, text: `${e.a}-${e.b} ${e.blocked ? "blocked" : "open"}` })),
        start,
        goal,
      },
      { type: "path", nodes: nodes.map((v) => v.id) },
    );
  },

  answerSchema: z.array(z.enum(NODE_IDS)).min(1).max(16),

  check: (data, answer) => isShortestRoute(data, answer),

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    return content ? shortestPath(content.edges, content.start, content.goal) : null;
  },
});

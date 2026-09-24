import { z } from "zod";
import type { Rng, TaskDifficulty } from "@deduction/shared";
import { ANSWER_ONLY_PHASES, buildView, defineTask, readView, standbyView } from "./util";

const TITLE = "Drone Pilot";
const SIZE = 5;
const COLUMNS = ["A", "B", "C", "D", "E"] as const;
export const HEADINGS = ["north", "east", "south", "west"] as const;
type Heading = (typeof HEADINGS)[number];
/** Row 1 is the top row, so north decreases the row number. */
const STEP: Record<Heading, readonly [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
export const GRID_CELLS: readonly string[] = [1, 2, 3, 4, 5].flatMap((r) => COLUMNS.map((c) => `${c}${r}`));

type MoveAction = "forward" | "turn_left" | "turn_right" | "turn_around";
/** `steps` is null for turns. */
export type Move = { action: MoveAction; steps: number | null };
export type SpatialData = { start: string; facing: Heading; moves: Move[]; options: string[] };

type Pos = { col: number; row: number };
type State = Pos & { heading: number };

const cellName = (p: Pos): string => `${COLUMNS[p.col] ?? "?"}${p.row + 1}`;
function parseCell(cell: string): Pos | null {
  const col = COLUMNS.findIndex((c) => c === cell[0]);
  const row = Number(cell.slice(1)) - 1;
  return cell.length === 2 && col >= 0 && Number.isInteger(row) && row >= 0 && row < SIZE ? { col, row } : null;
}
const inGrid = (p: Pos): boolean => p.col >= 0 && p.col < SIZE && p.row >= 0 && p.row < SIZE;

function apply(s: State, m: Move, mirrorTurns = false): State {
  const turn = (d: number): State => ({ ...s, heading: (s.heading + (mirrorTurns ? -d : d) + 4) % 4 });
  if (m.action === "turn_left") return turn(-1);
  if (m.action === "turn_right") return turn(1);
  if (m.action === "turn_around") return turn(2);
  const [dx, dy] = STEP[HEADINGS[s.heading] ?? "north"];
  const n = m.steps ?? 0;
  return { ...s, col: s.col + dx * n, row: s.row + dy * n };
}

/** Final cell, or null if the route leaves the grid at any point. */
export function simulateDrone(start: string, facing: string, moves: readonly Move[], mirrorTurns = false): string | null {
  const pos = parseCell(start);
  const heading = HEADINGS.findIndex((h) => h === facing);
  if (!pos || heading < 0) return null;
  let s: State = { ...pos, heading };
  for (const m of moves) {
    s = apply(s, m, mirrorTurns);
    if (!inGrid(s)) return null;
  }
  return cellName(s);
}

/** How far the drone can fly straight ahead before leaving the grid. */
function room(s: State): number {
  let n = 0;
  while (inGrid(apply(s, { action: "forward", steps: n + 1 }))) n++;
  return n;
}

export function moveText(m: Move): string {
  if (m.action === "forward") return `Forward ${m.steps ?? 0}`;
  if (m.action === "turn_left") return "Turn left";
  if (m.action === "turn_right") return "Turn right";
  return "Turn around";
}

const MOVE_COUNT: Record<TaskDifficulty, number> = { 1: 3, 2: 4, 3: 5 };

function tryMoves(rng: Rng, start: State, difficulty: TaskDifficulty): Move[] | null {
  const moves: Move[] = [];
  let s = start;
  while (moves.length < MOVE_COUNT[difficulty]) {
    const prev = moves[moves.length - 1];
    const free = room(s);
    const wantForward = free > 0 && (prev === undefined || prev.action !== "forward" || rng.chance(0.25));
    let m: Move;
    if (wantForward) m = { action: "forward", steps: rng.int(1, Math.min(3, free)) };
    else if (difficulty === 3 && rng.chance(0.25)) m = { action: "turn_around", steps: null };
    else m = { action: rng.pick(["turn_left", "turn_right"] as const), steps: null };
    moves.push(m);
    s = apply(s, m);
  }
  const forwards = moves.filter((m) => m.action === "forward").length;
  return forwards >= 2 && forwards < moves.length ? moves : null;
}

/** Plausible wrong endpoints: mirrored turns, a skipped move, the start cell, then neighbours of the answer. */
function distractors(rng: Rng, data: Omit<SpatialData, "options">, answer: string): string[] {
  const { start, facing, moves } = data;
  const plausible = [
    simulateDrone(start, facing, moves, true),
    simulateDrone(start, facing, moves.slice(0, -1)),
    ...moves.map((_, i) => simulateDrone(start, facing, moves.filter((__, k) => k !== i))),
    start,
  ];
  const answerPos = parseCell(answer) ?? { col: 0, row: 0 };
  const nearby = GRID_CELLS.filter((c) => {
    const p = parseCell(c);
    return p !== null && Math.abs(p.col - answerPos.col) + Math.abs(p.row - answerPos.row) <= 2;
  });
  const picked: string[] = [];
  for (const c of [...rng.shuffle(plausible), ...rng.shuffle(nearby), ...rng.shuffle(GRID_CELLS)]) {
    if (c !== null && c !== answer && !picked.includes(c)) picked.push(c);
    if (picked.length === 3) break;
  }
  return picked;
}

const moveSchema = z.object({
  action: z.enum(["forward", "turn_left", "turn_right", "turn_around"]),
  steps: z.number().int().min(0).max(SIZE).nullable(),
});
const answerContent = z.object({
  start: z.string(),
  facing: z.string(),
  moves: z.array(moveSchema).max(16),
});

/** Reasoning: fly a drone on a 5x5 grid through 3/4/5 moves (d3 adds "turn around"); pick the final cell of 4. */
export const spatialReasoning = defineTask<SpatialData, string>({
  kind: "spatial_reasoning",
  title: TITLE,
  category: "reasoning",
  isMemoryTask: false,

  generate(rng, difficulty) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const s: State = { col: rng.int(0, SIZE - 1), row: rng.int(0, SIZE - 1), heading: rng.int(0, 3) };
      const moves = tryMoves(rng, s, difficulty);
      if (!moves) continue;
      const base = { start: cellName(s), facing: HEADINGS[s.heading] ?? "north", moves };
      const answer = simulateDrone(base.start, base.facing, moves);
      if (answer === null) continue;
      const options = [answer, ...distractors(rng, base, answer)].sort();
      return { ...base, options };
    }
    throw new Error("spatial_reasoning: generation failed");
  },

  phases: () => ANSWER_ONLY_PHASES,

  view(instance, phase) {
    if (phase !== "answer") return standbyView(instance, TITLE, phase);
    const { start, facing, moves, options } = instance.data;
    return buildView(
      instance,
      TITLE,
      phase,
      `The drone starts at ${start} facing ${facing}. Columns A-E run left to right and rows 1-5 run top to bottom ` +
        "(north is up, toward row 1; east is right, toward column E). Turns rotate the drone in place by 90 degrees " +
        "(turn around is 180 degrees); forward N moves N cells in the facing direction. Where does the drone end up?",
      {
        columns: [...COLUMNS],
        rows: [1, 2, 3, 4, 5],
        start,
        facing,
        moves: moves.map((m) => ({ text: moveText(m), action: m.action, steps: m.steps })),
      },
      { type: "choice", options: options.map((c) => ({ id: c, label: c })) },
    );
  },

  answerSchema: z.enum(GRID_CELLS),

  check: (data, answer) => simulateDrone(data.start, data.facing, data.moves) === answer,

  solveFromViews(views) {
    const content = readView(views, "answer", answerContent);
    return content ? simulateDrone(content.start, content.facing, content.moves) : null;
  },
});

import { z } from "zod";
import type { TaskDifficulty } from "@deduction/shared";
import { buildView, defineTask, hasNoDuplicates, memoryPhases, readView, sameSet } from "./util";

const TITLE = "Reactor Pattern";
const COLUMNS = ["A", "B", "C", "D"] as const;
const ROWS = [1, 2, 3, 4] as const;
/** Row-major cell ids: A1 B1 C1 D1 A2 ... D4 (row 1 is the top row). */
export const CELL_IDS: readonly string[] = ROWS.flatMap((r) => COLUMNS.map((c) => `${c}${r}`));
const LIT_COUNT: Record<TaskDifficulty, number> = { 1: 3, 2: 4, 3: 5 };

/** Lit cells in row-major order. */
export type WorkingMemoryData = { lit: string[] };

const observeContent = z.object({ lit: z.array(z.enum(CELL_IDS)).max(16) });

const grid = (lit: readonly string[]): string[] =>
  ROWS.map((r) => COLUMNS.map((c) => (lit.includes(`${c}${r}`) ? "#" : ".")).join(""));

/** Memory: see 3/4/5 lit cells on a 4x4 grid, wait, select them. */
export const workingMemory = defineTask<WorkingMemoryData, readonly string[]>({
  kind: "working_memory",
  title: TITLE,
  category: "memory",
  isMemoryTask: true,

  generate(rng, difficulty) {
    const chosen = new Set(rng.sample(CELL_IDS, LIT_COUNT[difficulty]));
    return { lit: CELL_IDS.filter((id) => chosen.has(id)) };
  },

  phases: (_data, difficulty) => memoryPhases(difficulty),

  view(instance, phase) {
    const litCount = instance.data.lit.length;
    const frame = { columns: [...COLUMNS], rows: [...ROWS] };
    if (phase === "observe") {
      return buildView(
        instance,
        TITLE,
        phase,
        `Memorize which ${litCount} of the 16 reactor cells are lit. Cells are named by column letter A-D and ` +
          "row number 1-4 (row 1 is the top row); in the grid, # is lit and . is dark. The pattern will be hidden " +
          "before you answer.",
        { ...frame, lit: [...instance.data.lit], grid: grid(instance.data.lit) },
      );
    }
    if (phase === "delay") {
      return buildView(instance, TITLE, phase, "The pattern is hidden. Keep it in mind.", { ...frame, litCount });
    }
    return buildView(
      instance,
      TITLE,
      phase,
      `Select the ${litCount} reactor cells that were lit (columns A-D, rows 1-4, row 1 at the top).`,
      { ...frame, litCount },
      { type: "multi_choice", options: CELL_IDS.map((id) => ({ id, label: id })), count: litCount },
    );
  },

  answerSchema: z.array(z.enum(CELL_IDS)).max(16).refine(hasNoDuplicates),

  check: (data, answer) => sameSet(answer, data.lit),

  solveFromViews: (views) => readView(views, "observe", observeContent)?.lit ?? null,
});

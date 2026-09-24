import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import { aggregate, formatReport, simulateMatch, type ControllerMix, type SimulatedMatch, type SimulationConfig } from "../simulation";

/**
 * Headless batch simulation:  pnpm simulate --matches 1000 [--seed 1] [--players 10] [--infiltrators 2]
 *   [--controllers heuristic|random|mixed] [--workers N] [--difficulty easy|normal|hard] [--no-invariants]
 *   [--replay-dir DIR] [--json]
 * Exit code is non-zero if any match crashed, stalled or hit an impossible state.
 */
const { values } = parseArgs({
  options: {
    matches: { type: "string", default: "100" },
    seed: { type: "string", default: "1" },
    players: { type: "string", default: "10" },
    infiltrators: { type: "string", default: "2" },
    controllers: { type: "string", default: "heuristic" },
    workers: { type: "string" },
    difficulty: { type: "string", default: "normal" },
    "no-invariants": { type: "boolean", default: false },
    "replay-dir": { type: "string" },
    "max-minutes": { type: "string", default: "30" },
    json: { type: "boolean", default: false },
    quiet: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

const matches = Math.max(1, Number(values.matches));
const firstSeed = Number(values.seed);
const mix = values.controllers as ControllerMix;
if (!["heuristic", "random", "mixed"].includes(mix)) throw new Error(`--controllers must be heuristic, random or mixed (got ${mix})`);
const difficulty = values.difficulty as "easy" | "normal" | "hard";
const config: SimulationConfig = {
  settings: { playerCount: Number(values.players), infiltratorCount: Number(values.infiltrators), maxMatchSec: Number(values["max-minutes"]) * 60 },
  controllers: mix,
  ai: { difficulty },
  checkInvariants: !values["no-invariants"],
  recordReplay: Boolean(values["replay-dir"]),
};
const workers = Math.max(1, Math.min(matches, values.workers ? Number(values.workers) : Math.max(1, availableParallelism() - 1)));
const seeds = Array.from({ length: matches }, (_, i) => firstSeed + i);

const started = performance.now();
const results: SimulatedMatch[] = [];
let lastPrint = 0;
const progress = (r: SimulatedMatch) => {
  results.push(r);
  if (values.quiet || values.json) return;
  const now = performance.now();
  if (now - lastPrint > 1000 || results.length === matches) {
    lastPrint = now;
    const bad = results.filter((x) => x.status !== "completed").length;
    process.stdout.write(`\r  ${results.length}/${matches} matches (${bad} failed)   `);
  }
};

if (workers === 1) {
  for (const seed of seeds) progress(await simulateMatch(seed, config));
} else {
  const chunks: number[][] = Array.from({ length: workers }, () => []);
  seeds.forEach((s, i) => chunks[i % workers]!.push(s));
  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolveChunk, rejectChunk) => {
          const worker = new Worker(new URL("./simWorker.ts", import.meta.url), { workerData: { seeds: chunk, config } });
          let received = 0;
          worker.on("message", (r: SimulatedMatch) => {
            received++;
            progress(r);
          });
          worker.on("error", rejectChunk);
          worker.on("exit", (code) => {
            if (received < chunk.length) {
              for (const seed of chunk.slice(received)) progress({ seed, status: "crashed", summary: null, error: `worker exited with code ${code}`, wallMs: 0, replayJsonl: null });
            }
            resolveChunk();
          });
        }),
    ),
  );
}
if (!values.quiet && !values.json) process.stdout.write("\n");

const report = aggregate(results, (performance.now() - started) / 1000);
if (values["replay-dir"]) {
  const dir = resolve(values["replay-dir"]);
  mkdirSync(dir, { recursive: true });
  for (const r of results) if (r.replayJsonl) writeFileSync(join(dir, `match-${r.seed}-${r.status}.jsonl`), r.replayJsonl);
}
if (values.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(formatReport(report));
  for (const f of report.failures.slice(0, 10)) console.log(`  seed ${f.seed}: ${f.status}${f.error ? ` — ${f.error.split("\n")[0]}` : ""}`);
}
process.exitCode = report.crashed + report.stalled + report.impossibleStates > 0 ? 1 : 0;

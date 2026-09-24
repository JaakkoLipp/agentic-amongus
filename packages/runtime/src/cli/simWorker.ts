import { parentPort, workerData } from "node:worker_threads";
import { simulateMatch, type SimulationConfig } from "../simulation";

interface WorkerInput {
  readonly seeds: readonly number[];
  readonly config: SimulationConfig;
}

const input = workerData as WorkerInput;
for (const seed of input.seeds) {
  const result = await simulateMatch(seed, input.config);
  parentPort?.postMessage(result);
}

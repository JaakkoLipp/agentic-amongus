// Worker-thread entry for the TypeScript CLIs. Node's built-in type stripping would otherwise load the .ts worker
// without tsx's resolver (extensionless imports fail), so register tsx inside the worker first.
import { register } from "tsx/esm/api";
import { workerData } from "node:worker_threads";

register();
await import(workerData.entry);

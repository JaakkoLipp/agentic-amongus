// Development: game server (auto-restarts on change) + Vite dev server with hot reload.
// Open http://localhost:5173 — Vite proxies /ws to the game server on :8787.
import { spawn } from "node:child_process";

const procs = [
  spawn("pnpm", ["exec", "tsx", "watch", "apps/server/src/main.ts"], { stdio: "inherit", env: { ...process.env, PORT: process.env.PORT ?? "8787" } }),
  spawn("pnpm", ["--filter", "@deduction/client", "exec", "vite"], { stdio: "inherit" }),
];

const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => {
  if (code !== null && code !== 0) {
    stop();
    process.exitCode = code;
  }
});

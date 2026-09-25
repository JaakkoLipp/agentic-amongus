import { resolve } from "node:path";
import { buildServer } from "./app";

/**
 * Start the game server.
 *   PORT (8787), HOST (127.0.0.1), CLIENT_DIR (apps/client/dist), REPLAY_DIR (unset = no replays)
 */
const here = import.meta.dirname;
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";
const clientDir = resolve(process.env.CLIENT_DIR ?? resolve(here, "../../client/dist"));
const replayDir = process.env.REPLAY_DIR ? resolve(process.env.REPLAY_DIR) : null;

const app = await buildServer({ clientDir, replayDir, logger: true });
await app.listen({ port, host });
app.log.info(`Agentic Deduction server on http://${host}:${port} (WebSocket /ws)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

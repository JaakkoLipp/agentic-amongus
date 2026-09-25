import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Dev: the Vite server proxies the game WebSocket to the Fastify server (`pnpm server`, port 8787). */
const serverPort = Number(process.env.SERVER_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: `ws://127.0.0.1:${serverPort}`, ws: true },
      "/health": { target: `http://127.0.0.1:${serverPort}` },
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
});

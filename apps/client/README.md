# Client

React + Vite + PixiJS browser client. It renders the per-seat `PlayerObservation` it receives over the WebSocket and sends inputs and actions. It holds no game rules and imports only `@deduction/shared` and `@deduction/maps` (enforced by `tests/architecture.test.ts`). See `docs/PROTOCOL.md` and the "Client" section of `docs/ARCHITECTURE.md`.

```bash
pnpm dev     # from the repo root: game server + Vite dev server (http://localhost:5173)
pnpm build   # production build into apps/client/dist (served by the game server)
pnpm e2e     # headless browser run against a running server (apps/client/e2e/play.ts)
```

Layout: `src/net` (WebSocket client), `src/state` (store, event text, lobby settings), `src/render` (PixiJS scene), `src/hud` (React overlays), `src/input` (keyboard), `test/` (unit tests), `e2e/` (Playwright driver).

# Server

Fastify + WebSocket host. Each connection gets a `GameSession` (`src/session.ts`): a realtime `MatchRunner` from `@deduction/runtime` with the human's seat, streaming per-seat snapshots and perceived events, and mapping client messages to engine inputs. See `docs/PROTOCOL.md`.

```bash
pnpm server          # from the repo root; serves apps/client/dist if it has been built
```

Environment: `PORT` (8787), `HOST` (127.0.0.1), `CLIENT_DIR` (apps/client/dist), `REPLAY_DIR` (write each finished match as JSONL).

Tests: `test/session.test.ts` (protocol, secrecy, full matches played by `test/scriptedHuman.ts`) and `test/server.test.ts` (real WebSocket).

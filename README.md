# Agentic Deduction

An original browser social-deduction game: one human against autonomous AI agents aboard **Outpost Kappa**. Crew do short cognitive tasks and try to find the hidden **infiltrators**, who kill, vent and sabotage. Meetings are held in free-form discussion, followed by a vote.

The project is built to feel like a real game first and an AI benchmark second. Every player, human or LLM, has the same rules, the same partial observation, and the same task instances.

> Status: **Milestone 2 complete.** You can play full matches in the browser against heuristic agents, on top of the headless deterministic engine and batch simulation from Milestone 1. LLM agents (M5) come next, after gameplay polish (M3) and memory work (M4). See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

Requires Node ≥ 22.12 and pnpm 10.

```bash
pnpm install
```

Play (builds the client, then serves it and the game on http://127.0.0.1:8787):

```bash
pnpm start
```

Develop with hot reload (Vite on http://localhost:5173, game server on :8787):

```bash
pnpm dev
```

Controls: `WASD`/arrows move, `E` use (task, repair), `R` report, `M` emergency meeting, `Q` kill, `V` vent, `F` sabotage, `Enter` talk to nearby players, `Tab` map, `Esc` close a task.

Headless:

```bash
pnpm simulate --matches 1000
```

```bash
pnpm test
```

```bash
pnpm typecheck
```

Other tools:

```bash
pnpm simulate --matches 200 --controllers mixed --difficulty hard --replay-dir replays
```

```bash
pnpm inspect-match --seed 42
```

```bash
pnpm map:ascii
```

```bash
pnpm e2e -- --seed 1   # browser end-to-end run against a running server (see docs/TESTING.md)
```

Server environment variables: `PORT` (8787), `HOST` (127.0.0.1), `CLIENT_DIR` (apps/client/dist), `REPLAY_DIR` (unset = no replays).

## Layout

```text
apps/client       React + Vite + PixiJS browser client (renders one seat's observation)
apps/server       Fastify + WebSocket game server (one match per connection)
packages/shared    domain types, settings, protocol, seeded RNG
packages/maps      Outpost Kappa, tile geometry, line of sight, pathfinding
packages/tasks     15 cognitive task kinds (generate / view / validate)
packages/engine    authoritative rules, tick loop, vision, perception, observations, replay
packages/ai        agent host, goal executors, memory & beliefs, personalities, controllers
packages/runtime   match runner, meeting director, metrics, simulate & inspect CLIs
tests/             cross-package tests (architecture boundaries)
docs/              design and architecture documents
```

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) and [docs/AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md). The latest status and next steps are in [docs/HANDOFF.md](docs/HANDOFF.md). LLM agents working on this repo must follow [AGENTS.md](AGENTS.md).

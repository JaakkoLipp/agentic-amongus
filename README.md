# Agentic Deduction

An original browser social-deduction game: one human against autonomous AI agents aboard **Outpost Kappa**. Crew do short cognitive tasks and try to find the hidden **infiltrators**, who kill, vent and sabotage. Meetings are held in free-form discussion, followed by a vote.

The project is built to feel like a real game first and an AI benchmark second. Every player, human or LLM, has the same rules, the same partial observation, and the same task instances.

> Status: **Milestone 1 complete.** The headless deterministic engine, heuristic and random agents, and batch simulation all work. The browser client (M2) and LLM agents (M5) come next. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

Requires Node ≥ 22.12 and pnpm 10.

```bash
pnpm install
```

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

## Layout

```text
apps/client, apps/server   (Milestone 2)
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

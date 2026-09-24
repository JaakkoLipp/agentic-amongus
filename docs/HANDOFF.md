# Handoff

Update this file at the end of every session (see [AGENTS.md](../AGENTS.md)).

## Current state (2026-09-24)

**Where it was left:** Milestones 0 and 1 are complete.

- The monorepo, docs, core domain types and headless deterministic engine all work.
- Random and heuristic controllers, the match runner, meeting director, metrics, replay recording, and the `simulate` / `inspect-match` CLIs all exist.
- `pnpm typecheck` passes, and `pnpm test` passes 495 tests in 25 files.
- `pnpm simulate --matches 1000` gives 1000/1000 completed with 0 crashes, 0 impossible states, 0 stalled games and 0 invalid actions. Heuristic, mixed and random controllers were all checked, with 4–12 players and 1–3 infiltrators.
- Committed and pushed to `main` ("Milestone 0 + 1" commit). `agentic-amongus-prompt.md` (the original spec) is intentionally left untracked.

**What's next (Milestone 2: browser client):**

1. `apps/server`: Fastify + WebSocket. Host `MatchRunner` (`packages/runtime`) in `realtime` mode with one seat set to `"human"`. Validate messages with `ClientMessageSchema`. Send per-seat `snapshot` (observation, ~15–20 Hz) and `events` messages as described in `docs/PROTOCOL.md`.
2. `apps/client`: React + Vite + PixiJS. Render the static map from `@deduction/maps` plus the observation (visible players and bodies). Camera follow, WASD → `input`, and a HUD that shows only `observation.legal` actions.
3. Acceptance: a human can play complete matches against heuristic bots.

**Open issues / backlog** (details in `docs/ROADMAP.md`):

- Heuristic crew rarely eject anyone (about 0.1 ejections per match), and critical sabotage decides about 18% of matches. Tuning is planned for Milestones 4 and 7 (claims, contradiction detection, LLM discussion).
- `LLMController` is not implemented yet (Milestone 5). `"llm"` seats currently play heuristically.
- Task progress timing lets a witness tell real tasks from fake ones. This is intentional; it's documented in `docs/TASK_SYSTEM.md`.

## Log

- 2026-09-24: M0 + M1 built. Two subagents wrote the task kinds and the engine/map tests. Fixed four engine bugs they found: wall-clipping paths, report/kill rejection reasons leaking unseen deaths, the killer's own-body awareness, and the kill-cooldown doc mismatch. Added `AGENTS.md` handoff rule.

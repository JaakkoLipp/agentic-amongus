# Notes for LLM coding agents

## Always leave a handoff note

**Before you end any working session, update [`docs/HANDOFF.md`](docs/HANDOFF.md).** The next agent, or the human, starts from that file, so it must answer two questions:

1. **Where did you leave off?** What you changed and what state it is in (done, half-done, broken), with the test, typecheck and simulation results. Say what is committed and what is not.
2. **What's next?** Concrete next steps in priority order, plus open questions, known bugs and risks.

Rules:

- Replace the "Current state" section; don't let it go stale. Add a line to the log at the bottom with the date and a one-line summary.
- Be specific: file paths, commands, failing test names, seeds that reproduce a problem.
- If you stop in the middle of a change, say exactly what is unfinished and how to resume it.
- Keep it short. Durable design belongs in `docs/*.md`, not in the handoff.

## Start of a session

1. Read `docs/HANDOFF.md`, then `docs/ROADMAP.md` for the milestone plan.
2. Run `pnpm install`, `pnpm typecheck` and `pnpm test` to confirm the baseline before changing anything.

## Project essentials

- pnpm + TypeScript monorepo. Architecture: `docs/ARCHITECTURE.md`. AI design: `docs/AI_ARCHITECTURE.md`. Tests: `docs/TESTING.md`.
- Commands: `pnpm test`, `pnpm typecheck`, `pnpm simulate --matches 1000`, `pnpm inspect-match --seed N`, `pnpm map:ascii`. Play: `pnpm start` (build + server on :8787) or `pnpm dev` (hot reload on :5173). Browser e2e: `pnpm e2e -- --seed 1` against a running server (see `docs/TESTING.md`).
- The client (`apps/client`) may import only `@deduction/shared` and `@deduction/maps`; everything else it knows comes from the server's per-seat messages (`docs/PROTOCOL.md`).
- The engine owns all game state. AI code must only use `PlayerObservation` and its own memory; `packages/ai` must never import `@deduction/engine` (enforced by `tests/architecture.test.ts`).
- Work milestone by milestone, following the steps in `docs/ROADMAP.md`. Keep changes small, run tests after each step, and update the docs you touched.

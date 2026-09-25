# Handoff

Update this file at the end of every session (see [AGENTS.md](../AGENTS.md)).

## Current state (2026-09-25)

**Where it was left:** Milestones 0, 1 and 2 are complete. A human can play full matches in the browser against heuristic bots.

- **Server (`apps/server`).**
  - `GameSession` (`src/session.ts`) runs one realtime `MatchRunner` per WebSocket, with the human seat.
  - It validates frames, keeps the seed secret until `match_ended`, and uses a random match id.
  - It sends per-seat `events` + `snapshot` at 15 Hz, `action_result` for every action, and `match_ended` with roles and seed.
  - Optional JSONL replays via `REPLAY_DIR`.
  - `buildServer()` (`src/app.ts`, Fastify) serves `/ws`, `/health`, the built client, and a 240 msg/s flood limit.
- **Client (`apps/client`).** React + Vite + PixiJS:
  - lobby, map rendering, interpolation and own dead-reckoning, a line-of-sight darkness overlay, and a minimap;
  - an action bar from `observation.legal` with hotkeys;
  - a generic task panel for every `AnswerFormat`, a meeting panel, an event log and toasts, proximity chat, and an end screen.
  - It imports only `shared` and `maps` (architecture test).
- **Protocol changes** (`packages/shared/src/protocol.ts`, `docs/PROTOCOL.md`):
  - `welcome` is now just `{protocol}`; the seat, map and seed-free `PublicGameSettings` arrive in `match_started`;
  - new `leave_match`;
  - `PublicMatchSummary` gains `seed` and typed roles;
  - `LobbySettingsSchema.humanSeat`.
- **Runtime changes** (`packages/runtime/src/matchRunner.ts`):
  - `startRealtime(opts)` is now a fixed-timestep loop (catch-up capped at 5 ticks; errors go to `onError`);
  - human inputs are recorded as `HUMAN_INPUT` replay records;
  - `submitHumanAction` only works for human seats.
- **Simulate CLI fix.** Worker threads under Node 22.22 loaded `.ts` with native type stripping and bypassed tsx, so `pnpm simulate` failed with ERR_MODULE_NOT_FOUND. Workers now start through `packages/runtime/src/cli/workerBoot.mjs`, which registers tsx first.
- **Results.**
  - `pnpm typecheck` passes (root config and `apps/client/tsconfig.json`).
  - `pnpm test` passes 530 tests in 29 files.
  - `pnpm simulate --matches 1000` reproduces the M1 reference exactly: 644/356, 6.05 min average, 0 crashes, impossible states, stalls or invalid actions.
  - `pnpm e2e` passes both seats: seed 1 crew (won on tasks via the UI), and seed 18 `--tasks 4` infiltrator (fake tasks, 2 kills, 2 vents, 2 sabotages, meetings with speech and votes).
- **Git.** Committed and pushed to branch `claude/project-continuation-o4cxc4`; not merged to `main`. The original spec `agentic-amongus-prompt.md` is untracked on purpose and was **not present in this cloud clone**, so this session worked from the docs and this handoff.

**What's next (in priority order):**

1. **Milestone 3 polish** (scope is in `docs/ROADMAP.md`):
   - per-kind task visuals (the generic renderer works but is plain);
   - kill, vent and report animations, and an ejection screen;
   - sabotage effects on the map, sound placeholders, and a help overlay.
2. **Networking quality:**
   - echo the last processed input `seq` in snapshots and reconcile own movement (today the client dead-reckons from the last snapshot);
   - allow reconnecting to a running match (today a disconnect ends the session).
3. **Milestone 4:** claims, contradictions and alibis in agent memory, and suspicion calibration. Ejections are still rare, about 0.12 per match.
4. **Milestone 5:** `LLMController` (the provider settings already exist in `AiSettingsSchema`).

**Open issues / risks:**

- **Software WebGL.** Under SwiftShader (this container: 4 cores, no GPU), 4× MSAA stalled the page for seconds via GPU syncs. The renderer now detects software GL (`isSoftwareRenderer` in `render/renderer.ts`) and disables MSAA and high-DPI. Real GPUs are unaffected.
- **e2e browser pin.** `pnpm e2e` pins `playwright@1.56.1` to match the preinstalled Chromium (`/opt/pw-browsers`, build 1194). Elsewhere, run `npx playwright install chromium` or set `CHROMIUM_PATH`.
  - The driver dispatches WASD as in-page `KeyboardEvent`s, because real key presses wait for a rendered frame, and uses real key presses for hotkeys and typing.
  - It reads `window.__deduction.store`, which holds only this seat's data.
  - If the match ends mid-click it logs a harmless 5 s click timeout.
- **Spectator matches.** `humanPlayer: false` is rejected by the server.
- **Bundle size.** The client bundle is about 650 kB minified (Pixi + React + zod). Code-splitting is not done.
- **Balance** (unchanged from M1): critical sabotage decides about 19% of matches, and heuristic crew rarely eject.

## Log

- 2026-09-24: M0 + M1 built. Two subagents wrote the task kinds and the engine/map tests. Fixed four engine bugs they found: wall-clipping paths, report/kill rejection reasons leaking unseen deaths, the killer's own-body awareness, and the kill-cooldown doc mismatch. Added `AGENTS.md` handoff rule.
- 2026-09-25: M2 built. Server (`GameSession` + Fastify WebSocket), React/Pixi client, protocol v1 finalized (secret seed, `match_started`, `leave_match`), fixed-timestep realtime loop, and `HUMAN_INPUT` replay records. Protocol-only scripted-human tests and Playwright `pnpm e2e` both play full matches. Fixed the simulate worker loader (tsx in workers) and a software-GL stall (MSAA auto-off).

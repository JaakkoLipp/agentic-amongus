# Architecture

## Principles

1. **The server owns the truth.** One `Match` holds the authoritative `GameState` and is its only writer. Clients and agents send intents; the engine validates every one.
2. **Everyone sees through `buildObservation`.** Human clients and AI agents receive the same per-player `PlayerObservation`. No one outside the engine reads `GameState` during a match.
3. **The engine knows nothing about controllers, networking, rendering, or LLMs.** Package boundaries enforce this, and `tests/architecture.test.ts` checks the imports.
4. **Determinism.** All randomness flows from the match seed through labelled RNG streams. The engine itself uses no randomness after setup. Lockstep runs are exactly reproducible.

## Packages

```text
apps/client   React + Vite + PixiJS; renders one seat's observations, sends inputs (knows shared + maps only)
apps/server   Fastify + WebSocket; one GameSession (realtime MatchRunner, human seat) per connection

packages/shared   ids, math, seeded Rng, settings (Zod), actions, events, observation, goals, decisions,
                  PlayerController interface, protocol
packages/maps     map data (Outpost Kappa), compiled tile grids, line of sight, collision, A*, distance fields
packages/tasks    15 cognitive task kinds: generators, phase schedules, views, Zod answer schemas, validators
packages/engine   GameState, rules, tick loop, vision, perception, observation builder, invariants, replay
packages/ai       AgentHost (scheduling + staleness), goal executors, memory/beliefs, personalities,
                  Heuristic/Random controllers (LLM controller in M5)
packages/runtime  MatchRunner (lockstep/realtime), MeetingDirector, metrics, simulate + inspect CLIs
```

Allowed dependencies (enforced): `shared ← maps ← engine`, `shared ← tasks ← engine`, `shared/maps/tasks ← ai`, `engine + ai ← runtime`, `runtime ← apps/server`, and `shared + maps ← apps/client`. **`ai` does not depend on `engine`**, so agent code cannot import or read `GameState`. The **client never imports engine, runtime, ai or tasks**: it cannot simulate or peek at anything the server did not send.

Packages export their TypeScript source directly (`"exports": "./src/index.ts"`), so there is no build step. `tsx` runs the CLIs, Vitest runs the tests, and Vite will bundle the client.

## Authoritative state (`packages/engine/src/state.ts`)

```ts
GameState   { matchId, seed, mapId/mapVersion, settings, tick, phase: "playing" | "meeting" | "ended",
              players[], bodies[], tasks{}, taskProgress, sabotage, sabotageReadyAtTick, meeting,
              emergencyReadyAtTick, publicDeaths[], outcome, nextEventSeq }
PlayerState { id, name, color, role, alive, deathTick/deathCause, pos, facing, roomId, moveIntent, route,
              killReadyAtTick, ventId, taskIds[], taskSession, repair, emergencyMeetingsLeft, speechReadyAtTick }
TaskRecord  { id, ownerId, stationId, instance (secret data), countsForProgress (secret), done, attempts }
BodyState   { id, victimId, killerId (secret), pos, roomId, witnesses[], seenBy[], reported }
MeetingState{ id, reason, callerId, victimId, participants[], phase, phaseEndsAtTick, messages[], votes{}, result }
```

All timing is kept in integer ticks at 30 Hz. Positions are in tile units, and a player is a 0.6×0.6 box.

## Inputs

- `setMoveIntent(id, intent)` takes one of three modes. `direction` is human WASD. `path` has the engine pathfind and follow a route to a target; agent executors use it. `stop` halts.
- `submitAction(id, action)` handles discrete actions: `START_TASK`, `CANCEL_TASK`, `SUBMIT_TASK_ANSWER`, `KILL`, `REPORT_BODY`, `CALL_EMERGENCY`, `ENTER_VENT`/`MOVE_VENT`/`EXIT_VENT`, `SABOTAGE`, `START_REPAIR`/`STOP_REPAIR`, `SPEAK`, `VOTE`.

Each rule has a pure validator (`validateKill(state, map, killer, target) → ActionResult`) and an apply function that mutates the state and emits events. `computeLegalActions` is built from the same validators, so an action the HUD offers is always accepted. Rejected actions return a reason and emit a private `ACTION_REJECTED` event, which feeds the invalid-action metrics. Rejection reasons must not leak hidden state: a body or kill target the actor cannot see is always `invalid_target`, the same as a nonexistent one. Every action is schema-checked first, so malformed in-process calls are rejected rather than thrown.

## Tick loop (`Match.step`)

```text
tick++
playing: movement (route following, collision, room enter/leave events, moving cancels task/repair)
         -> task phase timers & answer timeouts -> sabotage repair holds & critical countdown
meeting: meeting phase timers, early end of voting, vote tally, ejection, respawn
win check -> time-limit safety valve -> perception update (every 3 ticks: visibility diffs, first sight of bodies)
```

## Events and perception

Every authoritative change is a `GameEvent` (`PLAYER_ENTERED_ROOM`, `PLAYER_KILLED`, `BODY_REPORTED`, `VOTE_CAST`, `SABOTAGE_STARTED`, `MATCH_ENDED`, …; see `shared/src/events.ts`). Events may carry secrets such as the killer, the saboteur, or the fake-task flag. At emission time the engine computes **witness lists** from real geometry.

`perceiveEvent(event, state, map)` is a pure function. It turns one authoritative event into per-player `PerceivedEvent`s: witnesses get `SAW_KILL`, hearers get `HEARD_SPEECH`, everyone gets `MEETING_MESSAGE`, and so on. Visibility diffs (`PLAYER_BECAME_VISIBLE` / `PLAYER_LEFT_VISIBILITY` with the *last seen* position and heading) and first sightings of bodies (`BODY_SEEN`) are computed at 10 Hz. Each player has an inbox, drained by `observe(id)`.

Consumers of the event stream:

- **Rules**: the event log is authoritative history.
- **AI memory**: only perceived events arrive, via observations.
- **Metrics**: runtime listeners.
- **Replay**: JSONL recorder.

## Observation (`buildObservation(state, map, playerId)`)

Contains: self (role, position, cooldowns, vision radius), infiltrator teammates, roster with *known* status and roles, visible players and bodies, perceived events since the last observation, own tasks, active task view (phase-specific), task progress (hidden under comms sabotage), sabotage, legal actions, public meeting view, and the outcome.

Never contains: other players' roles (unless revealed), unseen positions, unwitnessed deaths or kills, venting, fake-task flags, other players' tasks, or any task's secret data.

## Runtime (`packages/runtime`)

`MatchRunner` owns one `Match`, one `AgentHost` per AI seat, the `MeetingDirector`, and the metrics. Each tick:

1. Every agent due this tick (every 3 ticks, staggered by seat) observes, perceives, runs its goal executor (move intent + actions), and may start an **asynchronous** decision.
2. The meeting director hands out speech and vote turns.
3. `match.step()`.
4. Invariants are checked (if enabled).

There are two modes:

- **lockstep** (headless simulation, tests): pending decisions are awaited between ticks, which is deterministic.
- **realtime** (server): decisions land whenever the controller answers. The tick never waits, and late answers are checked against the agent's decision revision and discarded if stale. `startRealtime()` is a fixed-timestep scheduler (30 Hz against the wall clock, at most 5 catch-up ticks after a stall, then the backlog is dropped). It stops by itself when the match ends or a decision fails to apply.

Humans use the same path. The server maps WebSocket inputs to `setMoveIntent`/`submitAction` on their seat.

## Server (`apps/server`)

`buildServer()` (Fastify) serves `/ws`, `/health`, and the built client (`apps/client/dist`) when present. Each WebSocket connection gets a `GameSession`:

- It validates frames (size, JSON, `ClientMessageSchema`), parses lobby settings (`LobbySettingsSchema`), and picks a secret seed when none was requested.
- It creates a realtime `MatchRunner` with the human seat and a random match id, and starts the runner's fixed-timestep loop.
- After every tick it flushes, every 2 ticks, on phase changes and after actions: the seat's perceived events (`events`) and a fresh observation (`snapshot`). At the end it sends `match_ended` with the seed and roles, and optionally writes the JSONL replay (`REPLAY_DIR`).

The session is transport-agnostic (`send` callback plus `receive(raw)`), so tests drive it with a manual clock (`clock: "manual"` puts the runner in lockstep). `apps/server/test/scriptedHuman.ts` plays whole matches through the protocol alone.

## Client (`apps/client`)

- `net/client.ts` (`GameClient`): WebSocket, `hello`, typed message handling, input refresh while a key is held, ping.
- `state/store.ts` (`ClientStore`): latest observation, a 12-snapshot buffer for interpolation, the event log and toasts, the meeting announcement, and the end summary. React reads it with `useSyncExternalStore`; the renderer reads the buffer every frame.
- `render/` (PixiJS):
  - static map layer drawn once;
  - other players interpolated 110 ms in the past between snapshots, and the own figure dead-reckoned from the last snapshot along the server-reported heading, then smoothed;
  - bodies, task and repair markers, vent links;
  - a darkness overlay cut by a line-of-sight polygon (`render/visibility.ts`, the same grid traversal as the engine).
  - On software GL (no GPU) MSAA and high-DPI rendering are turned off.
- `hud/`: lobby, top bar, task list, minimap, event log, toasts, proximity chat, action bar (`legal` actions plus hotkeys), task panel (`TaskView` + `AnswerFormat`), meeting panel, end screen.

## Replay

`ReplayRecorder` writes JSONL:

- a header with format, seed, map id and version, settings, roles, controllers, and every task instance;
- every authoritative event;
- agent decision records, and `HUMAN_INPUT` records (movement changes and actions) for human seats.

Setup is seeded and the engine is deterministic, so re-running the seed with the same decisions reproduces the match. `eventStreamDigest` hashes an event stream to assert this.

## Deviations from the original specification

- **Extra package `packages/runtime`.** It is the glue between engine and controllers (scheduling, meeting turn-taking, metrics, simulate CLI). Neither the engine nor the AI package may own it without breaking their independence. The server will reuse it.
- **Vision, perception, and observation arrive in Milestone 1, not 4.** Controllers consume `PlayerObservation` from day one. Giving M1 bots full state would have meant rewriting them later and could have hidden leaks. Memory, beliefs, and personality exist in a first version. Milestone 4 deepens them.
- **`PlayerController.decide(observation, request)`** takes an explicit `DecisionRequest` (roam / task answer / meeting speech / vote). This keeps "speech" and "vote" separate inferences while every controller keeps a single method.
- **Tile-grid geometry.** Collision, line of sight, and A* run on the same 1-tile grid, with walls at least one tile thick. Points of interest get cached distance fields, so routing to a station costs a gradient descent rather than an A* search.
- **Role names.** The impostor-equivalent role is called *infiltrator*. The map, rooms, and task names are original.
- **Protocol handshake.** `welcome` no longer carries the seat: the seat, map and public settings arrive in `match_started`, since a connection can play several matches. The seed stays secret until `match_ended` (see [PROTOCOL.md](PROTOCOL.md)).

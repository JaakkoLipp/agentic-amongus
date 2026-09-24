# Roadmap

Before each milestone: inspect the existing architecture, list the files that will change, state the design, implement incrementally, run the tests, fix failures, and update these docs.

## Milestone 0: Documentation ✅

Game design, architecture, AI architecture, task system, protocol, testing, and this roadmap. Core domain types are defined in `packages/shared`: game state, player and role state, controller interface, events, task interface, observation, meeting state machine, goal schema, and protocol.

## Milestone 1: Headless deterministic engine ✅

Players, roles, rooms and room graph, movement with collision, pathfinding, tasks (15 cognitive kinds), kills, bodies, reports, emergency meetings, meetings, votes, ejections, sabotage, vents, win conditions, and seeded RNG. Random and heuristic controllers, the runner, metrics, replay recording, and the `simulate` / `inspect-match` CLIs.

**Acceptance:** `pnpm simulate --matches 1000` completes 1000 matches with no crashes, impossible states (the invariant checker runs every tick), or stalled games. This holds for heuristic, random, and mixed controllers. See [TESTING.md](TESTING.md).

Also delivered early, because M1 bots consume observations: real geometric vision, hearing, the observation builder, perceived events, a first version of memory, beliefs, and personalities, the meeting director, and async decision scheduling with stale-decision rejection and fallbacks.

## Milestone 2: Browser client

Fastify server with the WebSocket protocol (`PROTOCOL.md`); `MatchRunner` in realtime mode. React + Vite client with a PixiJS renderer: camera follow, room geometry, player sprites and labels, a HUD with context actions from `observation.legal`, and WASD input. One seat set to `human`, the rest heuristic.
**Acceptance:** a human can play complete matches against heuristic bots.

## Milestone 3: Complete normal gameplay

Task UIs rendered from `TaskView` + `AnswerFormat`, kill and body rendering, meeting UI (chat, timers, votes, results), vent UI, sabotage UI and effects, lighting (vision radius and lights sabotage), animations, sound placeholders.
**Acceptance:** the game feels playable without any AI inference.

## Milestone 4: Partial observability and memory (deepening)

Vision, hearing, and memory already exist. This milestone adds:

- claim tracking (room and route claims per player) and contradiction detection against one's own sightings;
- alibi confirmation between players;
- tuning of the suspicion and trust calibration;
- finer memory decay and imprecision at low memory quality;
- personality effects measured in simulation.

Acceptance: bots act only on information they legitimately possess. Add tests that compare agent memory against the recorded perception.

## Milestone 5: LLMController

Provider abstraction over OpenAI-compatible APIs (base URL, key, model, timeout, max tokens, temperature). Prompt builders from observation plus memory; structured output with Zod; one retry, then fallback; async inference with timeouts; revision tracking (already in `AgentHost`). Memory tasks use a separate observe-phase inference. Enable LLM control for **one** agent first.
**Acceptance:** one LLM agent finishes a full match without freezing or corrupting the simulation.

## Milestone 6: Multiple AI agents

Progress from 1 to 3, 5, and then 9 LLM agents. Adds an inference concurrency limiter (`maxConcurrentInferences`), staggering and jitter, and latency, token, and failure metrics. Fast and strong model split.
**Acceptance:** nine agents run at once without locking the game loop.

## Milestone 7: Meetings and social intelligence

Free-form discussion with questions and answers, accusations, defenses, alibis, contradictions, and changing opinions. Social memory, a separate voting inference with the final transcript, the human treated as an ordinary player, and personality-dependent speech.
**Acceptance:** agents discuss specific observed events rather than generic dialogue.

## Milestone 8: Infiltrator strategy

LLM-level strategy for fake tasks, hunting, isolation detection, sabotage timing, vent routes, self-reports, alibis, framing, deflection, and teammate coordination.
**Acceptance:** infiltrator AI can win without cheating or reading crew secrets.

## Milestone 9: Polish and inspection

Post-game replay viewer and per-agent inspector: what the agent saw and heard, memory, last-known locations, suspicion and trust over time (from `beliefTimeline`), goals over time (`goalHistory`), task performance, statements, votes, and decision summaries. Belief graphs, metrics dashboard, settings persistence, animation and audio polish.

## Known issues / tuning backlog

From the M1 run of 1000 heuristic matches:

- **Ejections are rare** (about 0.1 per match). Heuristic crew mostly win through tasks (about 63%), so social deduction is weak. Milestones 4 and 7 address this with claims, contradictions, and LLM discussion.
- **Critical sabotage wins about 18%** of matches. The crew's response to the reactor, which needs two players holding at once, is slow. Tune the repair timer or crew coordination once humans are in the loop.
- Heuristic infiltrators never use proximity speech; LLM agents will.
- Map v1 has one layout. Door-closing sabotage is not modelled yet; doorways are derived and ready for it.

# Testing

Current suite: **495 tests in 25 files**, about 7 s.

```bash
pnpm test                      # all Vitest suites (unit + integration)
pnpm typecheck                 # strict TypeScript over every package and test
pnpm simulate --matches 1000   # headless batch simulation (acceptance check)
pnpm inspect-match --seed N    # debug one match: outcome, per-player state, goals, event tail
```

## Layers

| Layer | Where | What |
|---|---|---|
| Task properties | `packages/tasks/test` | For every kind × difficulty × 150 seeds: determinism, JSON round-trip, phase schedule, solvable from views alone, memory views leak nothing, mutated answers rejected, malformed input never throws, hand-written fixtures including the spec examples |
| Map & geometry | `packages/maps/test` | Map validates and is fully connected; every station, vent and the beacon is reachable; line of sight is symmetric; collision fuzz never enters walls; path waypoints are clear |
| Engine rules | `packages/engine/test` | Vision, occlusion, lights, observation secrecy (including rejection reasons that must not leak unseen deaths), kills, reports, emergency, vents, tasks and fake tasks, movement and route following, meetings and voting, sabotage, win conditions, malformed input, determinism over a scripted match, invariants |
| Agents | `packages/ai/test` | Free-text parsing, memory (last-known locations, witnessed kills, decay, social updates), personality effects, heuristic policies, honest task solving |
| Runtime | `packages/runtime/test` | Stale decisions discarded, invalid output / errors / timeouts → fallback, agents keep moving while inference is pending, the tick never waits, lockstep determinism, replay header, simulation smoke runs |
| Architecture | `tests/architecture.test.ts` | Package dependency rules; the engine has no UI, network or LLM imports; AI code cannot import the engine |
| Simulation | `pnpm simulate` | 1000+ full matches with the invariant checker on every tick |

## Required tests (from the specification) and where they live

| Requirement | Test |
|---|---|
| player cannot see through walls | `engine/test/vision.test.ts` |
| player cannot see beyond vision range | `engine/test/vision.test.ts` |
| lights reduce crew visibility | `engine/test/vision.test.ts` |
| dead player cannot report | `engine/test/report.test.ts` |
| dead player cannot vote | `engine/test/meeting.test.ts` |
| crew player cannot kill | `engine/test/kill.test.ts` |
| kill fails outside range | `engine/test/kill.test.ts` |
| kill obeys cooldown | `engine/test/kill.test.ts` |
| impostor (infiltrator) can vent / crew cannot vent | `engine/test/vents.test.ts` |
| task validator accepts correct / rejects incorrect answer | `tasks/test/*`, `engine/test/tasks.test.ts` |
| fake task does not increase crew progress | `engine/test/tasks.test.ts` |
| body can only be reported once | `engine/test/report.test.ts` |
| tie vote works / skip works / ejection works | `engine/test/meeting.test.ts` |
| crew wins when all infiltrators are eliminated | `engine/test/win.test.ts` |
| crew wins through task completion | `engine/test/win.test.ts` |
| infiltrators win at parity | `engine/test/win.test.ts` |
| agent observation does not contain secret state | `engine/test/observation.test.ts` |
| agent cannot see invisible player | `engine/test/vision.test.ts` |
| last-known locations stop updating outside vision | `ai/test/memory.test.ts`, `engine/test/observation.test.ts` |
| stale LLM decisions are discarded | `runtime/test/decisions.test.ts` |
| invalid LLM output triggers fallback | `runtime/test/decisions.test.ts` |

## Invariants ("impossible states")

`checkInvariants(state, map)` in `packages/engine/src/invariants.ts` is pure. The simulator and the runtime tests run it after every tick. It checks:

- phase, meeting and outcome consistency;
- nobody stands inside a wall;
- only living infiltrators are in vents, and they sit at the vent position;
- the dead have death info and do not repair;
- task sessions belong to their owner and are not already finished;
- nobody is busy outside of play;
- at most one body per victim, and every killer is an infiltrator;
- task progress equals the number of completed crew tasks;
- only participants vote, and only for participants;
- no sabotage outside of play;
- the match never continues past a win condition (no living infiltrators, or parity).

## Simulation report

`pnpm simulate --matches N [--controllers heuristic|random|mixed] [--players P] [--infiltrators K] [--difficulty easy|normal|hard] [--workers W] [--replay-dir DIR] [--json]` prints:

- matches completed;
- crew and infiltrator wins, broken down by reason;
- average duration, meetings, kills, and ejections (with accuracy);
- task progress, failure rate, and average solve time;
- sabotages;
- decisions (stale, fallbacks, errors);
- invalid actions and their top reasons;
- impossible states, crashes, and stalled games (matches that hit the 30-minute safety cap).

The exit code is non-zero if any match crashed, stalled, or hit an impossible state. With `--replay-dir`, failed matches are written as JSONL replays.

Reference run (Milestone 1, 24-core machine, heuristic controllers, default settings):

```text
matches completed   1000 / 1000
crew wins           644 (64.4%)       infiltrator wins   356 (35.6%)
average duration    6.05 min          average meetings   2.38       average kills 4.12
invalid actions     0                 impossible states  0          crashes 0      stalled games 0
simulated           100.8 game-hours in 24.4 s wall
```

## Determinism

The same seed and the same controller decisions produce an identical event stream (`eventStreamDigest`). Lockstep mode with heuristic or random controllers is fully deterministic, and tests assert this at both engine and runner level. Controllers draw from their own labelled RNG streams, so adding randomness in one subsystem never perturbs another.

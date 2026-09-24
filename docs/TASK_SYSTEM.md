# Task System

Tasks are short cognitive microtasks of about 2–10 seconds. The **same instance** is solved by humans (graphical UI) and agents (structured text/JSON), through the **same validator**. Nothing is simulated with timers.

## Model (`packages/tasks`, public types in `packages/shared/src/tasks.ts`)

```ts
TaskInstance { id, kind, difficulty: 1|2|3, data }        // data is server-only (may contain the solution)
TaskDefinition {
  kind, title, category, isMemoryTask,
  generate(rng, difficulty) -> data                        // pure, seeded
  phases(data) -> [{ kind: "observe"|"delay"|"answer", durationTicks | null }]
  view(instance, phase) -> TaskView                        // what the player sees in that phase
  answerSchema: Zod                                        // shape validation for untrusted input
  check(data, answer) -> boolean                           // deterministic correctness
  solveFromViews(views) -> answer | null                   // reference solver using only what was shown
}
TaskView { taskId, kind, phase, title, prompt, content (JSON), answerFormat (answer phase only) }
AnswerFormat = sequence | choice | multi_choice | number | text | ordering | path
```

`checkTaskAnswer(instance, raw)` is the single entry point. It Zod-parses the answer, then checks that it fits *this instance's* answer format (length, offered ids, permutation). The result is `{ok:false, reason:"malformed"}` or `{ok:true, correct}`. It never throws.

## Lifecycle in the engine

1. The player stands within 1.4 tiles of the station for one of their tasks and sends `START_TASK`. A session starts at phase 0, the attempt counter increments, and observers see `SAW_TASK_START`.
2. Timed phases advance automatically: observe (2.5–3.5 s) → delay (1 s) → answer. The observation carries `activeTask.view` for the **current phase only**.
3. `SUBMIT_TASK_ANSWER` is accepted only in the answer phase.
   - Correct: the task is marked done. It counts toward progress **only for crew** (`countsForProgress` is secret).
   - Wrong or malformed: the session ends with `PLAYER_FAILED_TASK`. The task stays open, and a restart replays the observe phase.
4. Moving, being killed, a meeting, or a 45 s answer timeout ends the session.
5. From the outside, completed, failed, and cancelled look the same (`SAW_TASK_STOP`). A careful observer can still notice the public progress bar ticking at the moment someone finishes, which is legitimate evidence.

## Memory tasks actually test memory

For `sequence_recall` and `working_memory`, the observe view shows the data. The delay and answer views do not contain it; tests assert this for every generated instance. Heuristic agents answer from the views they saw in the observe phase (`AgentMemory.taskViewsFor`). LLM agents (M5) will get the observe view in one inference and the answer prompt without it, so they must carry the information themselves.

## Fake tasks

Infiltrators get an ordinary task list and use the exact same flow and validator. A correct fake task changes nothing for the crew. Slow or failed attempts keep the infiltrator visibly standing at a console, which is observable behaviour.

## The 15 kinds

| Kind | Console | Category | Answer | d1 → d3 |
|---|---|---|---|---|
| `sequence_recall` | Relay / Junction Sequencer | memory | sequence of digits | length 4 → 6 |
| `working_memory` | Core Pattern Array, Scan Recall | memory | set of lit cells (4×4) | 3 → 5 cells |
| `pattern_match` | Signal Matcher, Growth Monitor | perception | choice (rotated 3×3 pattern) | near-misses → mirrors |
| `symbol_match` | Notice Board, Sample Labeler | perception | choice (identical glyph string) | 3 → 5 glyphs |
| `arithmetic` | Power Calibration, Nutrient Mixer | arithmetic | number | 2 ops → 3 ops with × |
| `instruction_following` | Coolant Procedure, Dosage Calculator | reasoning | number | 3 → 5 steps, conditionals |
| `classification` | Cargo Router | reasoning | bay per item (A/B/C) | 3 → 5 items, ordered rules |
| `anomaly_detection` | Log Audit Terminal | reasoning | choice (inconsistent line) | 4 → 6 lines |
| `temporal_reasoning` | Shift Scheduler | reasoning | ordering of events | 3 → 5 events |
| `spatial_reasoning` | Drone Pilot Console | planning | choice (final cell) | 3 → 5 moves |
| `route_planning` | Route Plotter | planning | path (any shortest valid route) | 5 → 7 nodes, blocked links |
| `rule_composition` | Beacon Aligner | reasoning | choice (final direction) | 2 → 4 rules, negations |
| `short_logic` | Scrubber / Breaker Board | reasoning | set of switches that are on | unique-solution clues |
| `sorting` | Crate Stacker | ordering | ordering by weight | 4 → 6 crates |
| `checksum` | Packet Verifier | arithmetic | number | digit sum → weighted mod 10 |

Task content uses neutral labels ("Drone K", "Unit 4"), never player colour names, so agents cannot confuse task text with the real match.

## Assignment

Each player gets `tasksPerPlayer` distinct stations sampled from the map (`deriveRng(seed, "task-assignment", playerId)`). Each station gets its own instance (`deriveRng(seed, "task-instance", playerId, stationId)`), so instances differ per player and are fully reproducible. Task ids are `"<player>:<station>"`.

## Adding a task kind

1. Add the kind to `TASK_KINDS` in `packages/shared/src/tasks.ts`.
2. Implement `packages/tasks/src/kinds/<kind>.ts` with `defineTask({...})` and register it in `kinds/index.ts`.
3. Put it on at least one station in the map.
4. The property tests in `packages/tasks/test` automatically cover determinism, JSON round-trips, solvability from views, memory leakage, mutation rejection, and malformed input. Also add a few hand-written fixtures.

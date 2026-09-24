# Game Design

**Agentic Deduction** is an original social-deduction game played in a browser. One human plays with nine autonomous agents (LLM-driven from Milestone 5, heuristic before that) aboard **Outpost Kappa**, a research station. Most players are **crew**. One or two are secretly **infiltrators**.

The game is designed to feel like a real game first and an AI benchmark second. Every player, human or AI, is bound by the same rules, sees the world through the same partial observation, and solves the same task instances.

## Match flow

```text
setup (seeded) -> playing <-> meeting -> ended
```

- **Setup**: every player gets a color identity (Red, Blue, …), a role, a personal list of task instances, and a spawn point around the Commons emergency beacon. All of it is derived from the match seed.
- **Playing**: real-time top-down movement at 30 ticks/s. Players do tasks, and infiltrators kill, vent, and sabotage.
- **Meeting**: starts when a body is reported or the emergency beacon is used. Players discuss, then vote.
- **Ended**: one side has won. Every role and the full replay become visible.

## Roles

| | Crew | Infiltrator |
|---|---|---|
| Goal | Finish all crew tasks, or eject every infiltrator | Reach parity with the crew, or let a critical sabotage run out |
| Tasks | Real; each completion advances global progress | Fake list; solving one never moves progress |
| Kill | – | A visible living crew member within 1.6 tiles; 25 s cooldown (12 s at match start, full 25 s again after every meeting) |
| Vents | – | Enter, travel along links, and exit. Entry and exit can be seen; travel cannot |
| Sabotage | – | Lights, comms, reactor, oxygen (one at a time, 30 s cooldown) |
| Vision | 7 tiles (35% of that while lights are out) | 9 tiles, unaffected by lights |
| Knows | Own role | Own role and its infiltrator teammates |

**Ghosts.** Dead players become ghosts. Only other ghosts can see them. Crew ghosts keep doing tasks, which still counts toward the crew win. Ghosts cannot report, vote, speak to the living, repair, or vent. Dead infiltrators may still sabotage.

## Perception

- **Vision** is a disc clipped by walls and furniture using tile-grid ray casting. Nobody perceives the world during a meeting.
- **Hearing** (proximity speech) reaches 6 tiles with line of sight, or 3 tiles through walls. Only listeners in range hear it and remember it.
- **Deaths are private.** A death is known only to players who saw the kill or the body, until a meeting announces everyone who died since the last one.
- **Last-known locations.** When a player leaves sight, observers keep only where they last saw them and which way they were heading.

## Tasks

Tasks are short cognitive microtasks of about 2–10 s, such as recalling a digit sequence, planning a route, or computing a checksum. They are generated once per player and station. Humans see a graphical UI. Agents see a structured rendering of the same view, and both submit through the same validator. Memory tasks run observe → delay → answer, and the answer view no longer contains the data. A wrong answer fails the attempt; the task stays open and can be restarted. See [TASK_SYSTEM.md](TASK_SYSTEM.md).

## Kills, bodies, reports, emergency meetings

- A kill leaves a body at the victim's position, and the killer snaps onto that spot. Witnesses are computed from real geometry at that instant.
- Any living player may report a body within 2.5 tiles and in line of sight. A body can be reported only once.
- The emergency beacon in the Commons calls a meeting. Each player gets one use per match, with a 15 s cooldown after the start and after each meeting. It cannot be used during a critical sabotage.

## Sabotage

| Kind | Effect | Fix |
|---|---|---|
| Lights | Crew vision radius × 0.35 | Hold the Electrical lighting breaker for 2 s |
| Comms | Global task progress hidden | Hold the Comms Array dish for 2 s |
| Oxygen (critical) | 45 s countdown | Hold both regulators (Life Support, Hydroponics); each one is fixed independently |
| Reactor (critical) | 45 s countdown | Hold **both** reactor stabilizers **at the same time** for 2 s |

Any meeting clears the active sabotage. When a critical countdown reaches zero, the infiltrators win.

## Meetings

The meeting is its own state machine, with engine-enforced timing:

```text
reveal (4 s) -> statements (25 s) -> discussion (45 s) -> final_statements (15 s)
  -> voting (30 s, ends early when all have voted) -> result (6 s) -> back to play / match end
```

- At the start, every death since the last meeting is announced, active sabotage is cleared, and everyone is pulled out of tasks and vents.
- Speech is free text: no command syntax, at most 160 characters, one message per 2.5 s, 8 messages per meeting.
- Votes are cast separately from speech and are final. The options are any living participant or **skip**.
- **Tally**: a player is ejected only with a strict plurality over every other player *and* over skip. Ties and skip majorities eject nobody.
- When the meeting ends, everyone respawns around the beacon, bodies are cleared, and kill cooldowns reset.
- With **role reveal on eject** (on by default), the ejected player's role is announced.

## Win conditions

Checked after kills, task completions, ejections, and sabotage timers:

1. All infiltrators are dead → **crew** win.
2. All crew tasks are complete (ghosts included) → **crew** win.
3. Living infiltrators ≥ living crew → **infiltrators** win.
4. A critical sabotage countdown expires → **infiltrators** win.

A 30-minute hard cap (`time_limit`) exists only as a safety valve. The simulator counts it as a stalled game.

## Outpost Kappa (map v1.0.0)

The map is 100×72 tiles, with eleven rooms and five corridors. Two long halls run north and south, with passages and a narrow maintenance tunnel between them:

```text
  Reactor   Security   Comms Array                 Navigation
  ================ North Hall ============================
  Engine Room ==West Passage== Commons ==East Passage== Life Support
  ================ South Hall ============================
  Electrical ~~tunnel~~ Cargo Bay     Hydroponics  Infirmary
```

The map has 22 task stations covering all 15 task kinds, 6 sabotage repair stations, and 11 vents in four networks: Reactor–Engines–Electrical, Navigation–Life Support–Infirmary, Security–Comms, and Commons–Cargo–Hydroponics. Furniture (tables, crates, the reactor core, a planter) blocks both movement and vision. Run `pnpm map:ascii` to print it.

## Settings (defaults)

Every setting lives in `GameSettingsSchema` in `packages/shared/src/settings.ts`, and every one is validated.

| Setting | Default | | Setting | Default |
|---|---|---|---|---|
| players / infiltrators | 10 / 2 | | tasks per player / difficulty | 5 / 2 |
| player speed | 4.5 tiles/s | | kill cooldown / initial | 25 s / 12 s |
| crew / infiltrator vision | 7 / 9 tiles | | kill / report / use range | 1.6 / 2.5 / 1.4 tiles |
| lights factor | 0.35 | | emergency meetings / cooldown | 1 / 15 s |
| hearing range | 6 tiles | | sabotage cooldown / critical timer | 30 s / 45 s |
| role reveal on eject | on | | proximity speech | on |

AI settings (provider, model, meeting model, difficulty, memory quality, personality variation) live in `AiSettingsSchema`. The engine never reads them.

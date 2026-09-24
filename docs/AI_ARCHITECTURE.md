# AI Architecture

Each AI seat has a **brain** and a **body**.

- The brain is a `PlayerController` (heuristic, random, and LLM from M5). It makes a few slow, high-level decisions.
- The body is an `AgentHost` with deterministic goal executors. It keeps the character moving and acting every agent step (10 Hz) and never waits for the brain.

```text
                observation (10 Hz)                                  engine
Match ──────────────────────────────▶ AgentHost ── move intent / actions ──▶ Match
                                        │  memory.update(obs)
                                        │  executeGoal(current goal)
                                        │  nextRequest()? ──▶ controller.decide(obs, request)  (async)
                                        ◀──────────── decision (checked against revision) ◀──┘
```

## Controller interface

```ts
interface PlayerController {
  readonly kind: "human" | "random" | "heuristic" | "llm";
  decide(observation: PlayerObservation, request: DecisionRequest): Promise<AgentDecision>;
}
```

| Decision kind | When | Result |
|---|---|---|
| `roam` | no goal, goal finished or failed, heartbeat (3–6 s, jittered per agent), or an urgent trigger | `{ goal: AgentGoal, utterance, reasonSummary }` |
| `task_answer` | active task reaches its answer phase | `{ taskId, answer \| null, thinkTicks }` |
| `meeting_speech` | the meeting director gives this agent a turn | `{ text \| null }` (null = stay quiet) |
| `vote` | voting phase | `{ target: playerId \| "skip" }` |

Speech and votes are always separate requests. A vote is requested after the discussion, with the full transcript in the observation.

Controllers are built with an `AgentContext`: their own memory, personality, the map, the public rules, difficulty, and an RNG stream. They never receive a reference to the engine.

## Scheduling, revisions and staleness (`AgentHost`)

- At most one playing-phase decision (roam or task answer) is in flight per agent. Meeting speech and votes have their own slots.
- **Urgent triggers** can re-plan before the heartbeat, but no sooner than 1 s after the previous decision: goal completed/failed, body seen, kill or vent witnessed, sabotage started/ended, directly addressed, kill opportunity, revision changed.
- **Decision revision.** The host increments `revision` when the world invalidates plans: meeting started/ended, the agent died, a body seen, a kill or vent witnessed, a sabotage started/ended, voting started, results shown. Each request carries the revision it was made at. Before applying a late answer, the runner refreshes the agent's perception; if the revision moved on, the decision is **discarded as stale** and a new request follows.
- **Validation.** Every roam decision is checked against what the agent knows: allowed for its role, known player, not itself, known room or vent, own task. An invalid decision, the wrong decision kind, a thrown error, or a timeout (LLM controllers) all fall back to the deterministic **fallback policy**:
  - crew: report a visible body, else fix a critical sabotage, else go to the nearest unfinished task;
  - infiltrator: fake the nearest task, else join a group.
- While a decision is pending, the current goal keeps executing. A slow model never freezes a character or blocks the tick.

## Goals and executors (`packages/ai/src/executor`)

The LLM never steers movement. It chooses a goal, and an executor turns it into `MoveIntent { mode: "path", target }` plus actions. The engine then does A* (or a distance-field descent), path following, collision, and re-pathing.

| Crew goals | Behaviour |
|---|---|
| `MOVE_TO room`, `INVESTIGATE room` | Walk to the room centre; investigate also sweeps two random spots |
| `GO_DO_TASK task?` | Walk to the (nearest) own console, `START_TASK`, stand still while solving |
| `FOLLOW` / `OBSERVE` / `BUDDY_UP p` | Shadow a player at 1.2–2.5 / 3.5–5.5 / 1–2 tiles, using the **live position if visible, else the last-known position**. Fails once the last sighting has been checked and the player is gone |
| `AVOID p` | When the threat is within 7 tiles, head for a room far from it |
| `SEEK_GROUP` | Walk to the visible crowd, or to where most players were recently seen |
| `FIX_SABOTAGE` | Nearest unfixed station, preferring one nobody is visibly holding (reactor), then hold it |
| `REPORT_BODY`, `CALL_MEETING` | Walk to the body or beacon and use it |
| `CONFRONT p`, `SPEAK_NEARBY` | Approach and speak (proximity speech) |
| `WAIT` | Stand still |

| Infiltrator goals | Behaviour |
|---|---|
| `FAKE_TASK` | Same flow as a real task (the solve is real; the progress is not) |
| `SEEK_ISOLATED_PLAYER`, `HUNT p?` | Roam quiet rooms. Hunt only kills when no non-teammate witness is visible |
| `KILL p` | Approach and kill when legal |
| `VENT vent?`, `EXIT_VENT` | Reach the nearest vent, travel the network (BFS over links), and exit when unobserved (or after 5 s) |
| `SABOTAGE kind` | Trigger it if legal |
| `CREATE_ALIBI`, `FRAME_PLAYER`, `PROTECT_TEAMMATE` | Be seen near a crew member while faking a nearby console / shadow a target (and note to accuse them later) / stay near a teammate |
| `FLEE_BODY`, `SELF_REPORT` | Leave for a distant room / report one's own kill |

## Memory (`AgentMemory`)

Memory is built only from observations the agent received.

| Layer | Contents |
|---|---|
| Episodic | "saw Purple enter Electrical", "found Green's body in Cargo Bay", "SAW White go into a vent" |
| Social | Heard speech and meeting messages, parsed into accusations, vouches, and rooms mentioned (`parseUtterance`) |
| Beliefs | Per player: `suspicion`, `trust`, evidence list, and a timeline of every change with its reason (for the inspector) |
| Strategic | Short notes: "Avoid being seen near Green's body", "Trying to frame Blue…" |
| Last-known locations | Position, room, tick, and heading at the last sighting. Never updated while the player is out of sight |
| Task views | The views shown during the observe phase of the current attempt (used honestly for memory tasks) |

**Decay classes**, scaled by memory quality and the agent's `memoryReliance`:

- critical (kills, bodies, vents, ejections): whole match;
- medium (claims, reports, sabotage): about 3–8 min;
- low (movement sightings): about 1–4 min.

Very old last-known locations are forgotten.

**Deterministic belief layer.** Personality scales each change: suspicion deltas × (0.5 + `suspicionRate`), trust deltas × (0.5 + `trustRate`).

| Evidence | Effect |
|---|---|
| Witnessed kill or vent | Suspicion → 1 (certain) |
| Seen in or next to the body's room within 25 s before the body | Suspicion + up to 0.25 |
| The progress bar ticks at the exact moment a watched player finishes a console | Trust + 0.2, suspicion − 0.15. This is a legitimate public-information deduction |
| Accused by another player | + 0.12 × credibility of the speaker (trust − suspicion/2) |
| Vouched for | − 0.06 × credibility |
| A crew member falsely accused **me** | The accuser's suspicion rises |
| Voted out a revealed infiltrator | Trust + |
| Voted out a revealed crew member | Suspicion + |

The LLM layer (M5+) will interpret this state; it does not replace it.

## Personalities

Nine archetypes (`packages/ai/src/personality.ts`), jittered per seat by the "personality variation" setting:

- Detective
- Paranoid
- Social
- Lone Wolf
- Manipulator
- Cautious
- Impulsive
- Analyst
- Rookie

Traits change behaviour, not only wording:

- `riskTolerance`: repairing lights alone, killing near possible witnesses, self-reporting.
- `aggression`: hunting frequency, confronting instead of avoiding, retaliatory votes.
- `sociability`: buddying up, seeking groups, alibis.
- `talkativeness`: meeting turns taken, whether low-value lines are said.
- `voteConfidence`: suspicion needed to vote instead of skip (0.40–0.75).
- `suspicionRate`/`trustRate`: belief update speed.
- `memoryReliance`: memory lifetime and memory-task accuracy.
- `deceptionSkill`: framing, deflection, betraying a doomed teammate.

## Difficulty

Difficulty never grants information. It changes task error rate (4–22%), the extra error on memory tasks, thinking time, and suspicion noise.

## Meeting director (`packages/runtime/src/meetingDirector.ts`)

The director keeps the discussion conversational:

- **Statements.** The caller speaks first, then the others in a talkativeness-weighted order, about 2.2 s apart.
- **Discussion.** Anyone *named* in a new message, including by the human, jumps to the front of the queue. Otherwise one volunteer is picked about every 3.5 s, favouring talkative agents who have spoken least.
- **Final statements.** A talkativeness-weighted subset speaks.
- **Voting.** Every agent gets a separate vote request, staggered.

Agents may decline a turn (`text: null`).

## Heuristic controller (M1 baseline and LLM fallback)

- **Crew roam:** report a visible body → call a meeting if a kill or vent was witnessed → fix sabotage (always if critical) → avoid or observe a strongly suspected player when alone with them → tasks (sometimes buddying up with a trusted player) → watch the top suspect, join a group, or patrol.
- **Infiltrator roam:** exit the vent → after one's own kill: self-report, vent away, or flee → during a critical sabotage: hunt the split crew → with the kill ready: kill an isolated target with no witnesses, or hunt → sometimes sabotage (lights preferred when the kill is ready) → build an alibi, frame, or fake tasks.
- **Speech:** only statements grounded in memory:
  - crew: "I saw Red kill Blue in Cargo Bay", vent sightings, the report, the top suspect with the reason for the suspicion, an alibi from the agent's own trail;
  - infiltrators: an alibi that avoids the body's room, deflecting onto whoever is already doubted, piling on, framing, and occasionally betraying a doomed teammate.
- **Vote:** crew vote for a witnessed killer or venter, else the top suspect above the personality threshold, else skip. Infiltrators join a bandwagon on a crew member, push back on their accuser, and never vote for a teammate unless sacrificing them.
- **Task answers:** `solveFromViews` over exactly the views the agent saw, with difficulty- and memory-dependent mistakes and a simulated thinking time.

## LLM controller (Milestones 5–7, planned)

- `LLMProvider.generate<T>(request)` over OpenAI-compatible APIs (llama.cpp, vLLM, gateways, cloud), with base URL, key, model, timeout, max tokens, and temperature. A fast model handles roam and task decisions; an optional stronger model handles meetings and votes.
- Prompts are built from the observation plus memory summaries: recent episodic and social memory, last-known locations, beliefs with evidence, strategic notes, and role abilities. The full state is never included, and there is no "lie cleverly" instruction.
- Output is structured JSON validated by Zod (`GoalDecisionSchema` and speech/vote schemas). The controller retries once on invalid output; after that the host's fallback applies. Only a short `reasonSummary` is requested and stored, never chain-of-thought.
- Concurrency limits and staggering across agents come from `maxConcurrentInferences` and heartbeat jitter.

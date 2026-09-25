# WebSocket Protocol

Implemented in Milestone 2 by `apps/server` (`GameSession`) and `apps/client` (`GameClient`). The types live in `packages/shared/src/protocol.ts`, `actions.ts` and `observation.ts`. Every message is one JSON text frame.

## Rules

- **The server is authoritative.** The client sends inputs only. Every message is Zod-validated (`ClientMessageSchema`), then the engine validates it for game legality.
- **Humans get exactly an agent's view.** The server never sends `GameState`. Each client receives the `PlayerObservation` for its seat, the same structure an AI agent in that seat would receive, so partial observability applies to the human too.
- **Secrets are released only after `MATCH_ENDED`:** all roles, the **seed** and the replay. The seed is withheld during play because roles and task data derive from it, so `match_started` carries `PublicGameSettings` (the settings minus the seed). The match id is random and never derived from the seed.
- **Versioning.** `PROTOCOL_VERSION` is sent in `hello` and answered in `welcome`.
- **One match per connection.** Each WebSocket gets its own `GameSession`, a single-player match against AI agents. Closing the socket stops the match.

## Client → server

| `t` | Payload | Notes |
|---|---|---|
| `hello` | `{ protocol, name? }` | Must come first; anything else before it gets `error: "send hello first"` |
| `start_match` | `{ settings? }` | `settings` is validated with `LobbySettingsSchema` (`game`, `ai`, `humanSeat`, `humanPlayer`, `debug`). With no `game.seed`, the server picks a secret random seed. Starting again replaces the current match |
| `leave_match` | `{}` | Stop the current match (back to the lobby) |
| `input` | `{ seq, dir: {x, y} }` | WASD direction in [-1, 1]; `{0,0}` stops. Sent on change and **repeated every 250 ms while held**, because meetings reset every movement intent |
| `action` | `{ seq, action: PlayerAction }` | Task start/cancel/answer, kill, report, emergency, vent, sabotage, repair, `SPEAK` (proximity speech while playing, meeting text during meeting speech phases), `VOTE` |
| `ping` | `{ at }` | Answered with `pong` |

## Server → client

| `t` | Payload | When |
|---|---|---|
| `welcome` | `{ protocol }` | Reply to `hello` |
| `match_started` | `{ matchId, playerId, mapId, mapVersion, settings: PublicGameSettings }` | After `start_match` |
| `events` | `{ tick, events: PerceivedEvent[] }` | Everything the seat perceived since the previous flush, sent right before the snapshot that follows it |
| `snapshot` | `{ observation: PlayerObservation }` | Every 2 ticks (15 Hz), on every phase change, and right after each `action`. `observation.events` is always empty: events travel in `events` |
| `action_result` | `{ seq, action, result: {ok} \| {ok:false, reason} }` | Reply to every `action` |
| `match_ended` | `{ summary: PublicMatchSummary }` | Once: winner, reason, duration, **seed**, every role, replay file name (if the server records replays) |
| `error` | `{ message }` | Malformed frame, bad settings, no match running, … |
| `pong` | `{ at, serverTick }` | Reply to `ping` |

Limits: frames over 16 KiB are rejected (`MAX_CLIENT_MESSAGE_BYTES`), binary frames are refused, and a client sending more than 240 messages per second is disconnected (close code 1008).

## Session lifecycle

```text
connect -> hello -> welcome
        -> start_match -> match_started, events/snapshot ... (15 Hz)
             action -> action_result + snapshot
             ... MATCH_ENDED perceived -> final events + snapshot -> match_ended
        -> start_match (again) | leave_match | close
```

## Rendering from observations

The client renders the static map from `@deduction/maps` (public geometry) plus `observation.visiblePlayers`, `visibleBodies`, `sabotage`, and `activeTask.view`. The darkness overlay is a line-of-sight polygon computed from the map and the player's own position and vision radius, so it reveals nothing. The HUD enables only `observation.legal` actions:

- USE (`E`): `startTask` / `repair`
- REPORT (`R`)
- EMERGENCY (`M`)
- KILL (`Q`), VENT (`V`, then `1`–`9` to move), SABOTAGE (`F`, then `1`–`4`): infiltrators only

The meeting UI uses `observation.meeting`: phase, timer, transcript, who has voted, and the revealed votes at the end. The dead-since-last-meeting list comes from the `MEETING_STARTED` event.

## Human seat in the runtime

`GameSession` hosts a `MatchRunner` in `realtime` mode with the human's seat set to `"human"`. The runner's fixed-timestep loop (`startRealtime`) ticks at 30 Hz against the wall clock, catches up at most 5 ticks after a stall, and never awaits AI inference. `input` becomes `runner.setHumanMove(seat, dir)`, and `action` becomes `runner.submitHumanAction(seat, action)`. Both are also recorded in the replay as `HUMAN_INPUT` records. Tests use `clock: "manual"`: the runner is then in lockstep mode and `await session.advance(n)` steps it deterministically.

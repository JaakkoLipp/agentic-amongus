# WebSocket Protocol (high level)

The protocol will be implemented in Milestone 2. The types already live in `packages/shared/src/protocol.ts`, `actions.ts` and `observation.ts`.

## Rules

- **The server is authoritative.** The client sends inputs only. Every message is Zod-validated (`ClientMessageSchema`), then the engine validates it for game legality.
- **Humans get exactly an agent's view.** The server never sends `GameState`. Each client receives the `PlayerObservation` for its seat, the same structure an AI agent in that seat would receive, so partial observability applies to the human too. Full information (all roles, replay, agent inspection) is released only after `MATCH_ENDED`.
- **Versioning.** `PROTOCOL_VERSION` is exchanged in `hello` / `welcome`.

## Client → server

| `t` | Payload | Notes |
|---|---|---|
| `hello` | `{ protocol, name? }` | First message |
| `input` | `{ seq, dir: {x, y} }` | WASD direction in [-1, 1]; sent on change, at most 30 Hz. Maps to `MoveIntent { mode: "direction" }` |
| `action` | `{ seq, action: PlayerAction }` | Task start/cancel/answer, kill, report, emergency, vent, sabotage, repair, `SPEAK` (proximity or meeting text), `VOTE` |
| `start_match` | `{ settings? }` | Lobby: settings validated with `LobbySettingsSchema` |
| `ping` | `{ at }` | Latency |

## Server → client

| `t` | Payload | Rate |
|---|---|---|
| `welcome` | `{ protocol, playerId, mapId, mapVersion }` | once |
| `snapshot` | `{ observation: PlayerObservation }` | about 15–20 Hz |
| `events` | `{ tick, events: PerceivedEvent[] }` | whenever the seat perceives something |
| `action_result` | `{ seq, action, result: {ok} \| {ok:false, reason} }` | per action |
| `match_ended` | `{ summary: PublicMatchSummary }` (roles, replay reference) | once |
| `error`, `pong` | – | – |

## Rendering from observations

The client renders the static map from `@deduction/maps`, which is public geometry, plus `observation.visiblePlayers`, `visibleBodies`, `sabotage`, and `activeTask.view`. The HUD shows only `observation.legal` actions:

- USE: `startTask` / `repair`
- REPORT
- KILL
- VENT
- SABOTAGE
- EMERGENCY

The meeting UI uses `observation.meeting`: phase, timer, transcript, who has voted, and the result.

## Human seat in the runtime

The server hosts a `MatchRunner` in `realtime` mode with the human's seat set to `"human"`. `input` becomes `runner.setHumanMove(seat, dir)`, and `action` becomes `runner.submitHumanAction(seat, action)`. AI decisions never block the 30 Hz loop.

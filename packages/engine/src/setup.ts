import {
  deriveRng,
  PLAYER_IDENTITIES,
  secondsToTicks,
  type GameSettings,
  type MatchId,
  type PlayerId,
  type Role,
  type TaskId,
  type Vec2,
} from "@deduction/shared";
import { areaAt, nearestWalkable, type GameMap } from "@deduction/maps";
import { generateTaskInstance, registeredTaskKinds } from "@deduction/tasks";
import type { GameState, PlayerState, TaskRecord } from "./state";

export class InvalidSettingsError extends Error {}

export function validateSettingsForMap(settings: GameSettings, map: GameMap): void {
  if (settings.mapId !== map.id) throw new InvalidSettingsError(`settings.mapId ${settings.mapId} does not match map ${map.id}`);
  if (settings.infiltratorCount * 2 >= settings.playerCount) {
    throw new InvalidSettingsError(`${settings.infiltratorCount} infiltrators need at least ${settings.infiltratorCount * 2 + 1} players`);
  }
  if (settings.playerCount > PLAYER_IDENTITIES.length) throw new InvalidSettingsError("too many players");
}

/** Ring of spawn points around the map's spawn centre (also used after every meeting). */
export function spawnPositions(map: GameMap, count: number): Vec2[] {
  const { center, radius } = map.def.spawn;
  const out: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    out.push(nearestWalkable(map, { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }));
  }
  return out;
}

/**
 * Deterministic match setup: identities, roles, per-player task instances and spawn positions all derive from
 * `settings.seed` through labelled RNG streams.
 */
export function createInitialState(settings: GameSettings, map: GameMap, matchId: MatchId): GameState {
  validateSettingsForMap(settings, map);
  const identities = PLAYER_IDENTITIES.slice(0, settings.playerCount);
  const roleRng = deriveRng(settings.seed, "roles");
  const infiltrators = new Set(roleRng.sample(identities.map((p) => p.id), settings.infiltratorCount));
  const spawns = spawnPositions(map, identities.length);
  const killReady = secondsToTicks(settings.initialKillCooldownSec);

  const tasks: Record<TaskId, TaskRecord> = {};
  const available = new Set(registeredTaskKinds());
  const stations = map.def.taskStations.filter((s) => available.has(s.taskKind));

  const players: PlayerState[] = identities.map((identity, i) => {
    const role: Role = infiltrators.has(identity.id) ? "infiltrator" : "crew";
    const taskRng = deriveRng(settings.seed, "task-assignment", identity.id);
    const chosen = taskRng.sample(stations, Math.min(settings.tasksPerPlayer, stations.length));
    const taskIds = chosen.map((station) => {
      const id: TaskId = `${identity.id}:${station.id}`;
      const instance = generateTaskInstance(id, station.taskKind, settings.taskDifficulty, deriveRng(settings.seed, "task-instance", identity.id, station.id));
      tasks[id] = { id, ownerId: identity.id, stationId: station.id, instance, countsForProgress: role === "crew", done: false, attempts: 0, completedTick: null };
      return id;
    });
    const pos = spawns[i]!;
    return {
      id: identity.id,
      name: identity.name,
      color: identity.color,
      role,
      alive: true,
      deathTick: null,
      deathCause: null,
      pos,
      facing: { x: 0, y: 1 },
      roomId: areaAt(map, pos),
      moveIntent: { mode: "stop" },
      route: null,
      moving: false,
      killReadyAtTick: killReady,
      ventId: null,
      ventReadyAtTick: 0,
      taskIds,
      taskSession: null,
      repair: null,
      emergencyMeetingsLeft: settings.emergencyMeetingsPerPlayer,
      speechReadyAtTick: 0,
      meetingMessagesSent: 0,
    };
  });

  const total = Object.values(tasks).filter((t) => t.countsForProgress).length;
  return {
    matchId,
    seed: settings.seed,
    mapId: map.id,
    mapVersion: map.version,
    settings,
    tick: 0,
    phase: "playing",
    players,
    bodies: [],
    tasks,
    taskProgress: { completed: 0, total },
    sabotage: null,
    sabotageReadyAtTick: secondsToTicks(Math.max(settings.initialKillCooldownSec, settings.sabotageCooldownSec / 2)),
    meeting: null,
    meetingCount: 0,
    emergencyReadyAtTick: secondsToTicks(settings.emergencyCooldownSec),
    publicDeaths: [],
    outcome: null,
    nextEventSeq: 0,
    nextBodyNumber: 1,
  };
}

export const roleMap = (state: GameState): Record<PlayerId, Role> =>
  Object.fromEntries(state.players.map((p) => [p.id, p.role]));

import { secondsToTicks, type GameSettingsInput, type PlayerId, type Vec2 } from "@deduction/shared";
import { areaAt } from "@deduction/maps";
import { Match, type PlayerState } from "@deduction/engine";
import { AgentMemory, ARCHETYPES, type Personality } from "@deduction/ai";

export function newMatch(settings: GameSettingsInput = {}): Match {
  return new Match({ settings: { seed: 7, ...settings }, recordEvents: true });
}

export function player(match: Match, id: PlayerId): PlayerState {
  const p = match.state.players.find((x) => x.id === id);
  if (!p) throw new Error(`no player ${id}`);
  return p;
}

/** Test setup only: teleport a player (keeps roomId consistent). */
export function place(match: Match, id: PlayerId, pos: Vec2): void {
  const p = player(match, id);
  p.pos = pos;
  p.roomId = areaAt(match.map, pos);
  p.route = null;
}

export function step(match: Match, ticks: number): void {
  for (let i = 0; i < ticks; i++) match.step();
}

export const crewIds = (match: Match): PlayerId[] => match.state.players.filter((p) => p.role === "crew").map((p) => p.id);
export const infiltratorIds = (match: Match): PlayerId[] => match.state.players.filter((p) => p.role === "infiltrator").map((p) => p.id);

/** Park everyone far apart in rooms that cannot see each other so tests control exactly who sees whom. */
export function scatter(match: Match): void {
  const spots: Vec2[] = [
    { x: 8, y: 8 },
    { x: 90, y: 8 },
    { x: 8, y: 30 },
    { x: 90, y: 30 },
    { x: 8, y: 64 },
    { x: 90, y: 64 },
    { x: 34, y: 10 },
    { x: 56, y: 8 },
    { x: 40, y: 64 },
    { x: 68, y: 62 },
    { x: 20, y: 40 },
    { x: 80, y: 40 },
  ];
  match.state.players.forEach((p, i) => place(match, p.id, spots[i]!));
  step(match, 3);
}

export function memoryFor(match: Match, id: PlayerId, traits: Personality = ARCHETYPES.analyst.traits): AgentMemory {
  return new AgentMemory({ selfId: id, map: match.map, personality: traits, memoryQuality: 1, infiltratorCount: match.state.settings.infiltratorCount });
}

export const seconds = secondsToTicks;

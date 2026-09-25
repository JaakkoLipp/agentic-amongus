import type { LobbySettingsInput } from "@deduction/shared";

/** What the lobby form holds; persisted in localStorage between visits. */
export interface LobbyChoices {
  seat: string;
  players: number;
  infiltrators: number;
  tasksPerPlayer: number;
  taskDifficulty: 1 | 2 | 3;
  botDifficulty: "easy" | "normal" | "hard";
  bots: "heuristic" | "random";
  seed: string;
}

const DEFAULTS: LobbyChoices = {
  seat: "red",
  players: 10,
  infiltrators: 2,
  tasksPerPlayer: 5,
  taskDifficulty: 2,
  botDifficulty: "normal",
  bots: "heuristic",
  seed: "",
};

const STORAGE_KEY = "deduction.lobby.v1";

export function loadChoices(): LobbyChoices {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<LobbyChoices>) };
  } catch {
    // Storage unavailable (private mode): defaults are fine.
  }
  return DEFAULTS;
}

export function saveChoices(c: LobbyChoices): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

export function toLobbySettings(c: LobbyChoices): LobbySettingsInput {
  const seed = c.seed.trim() === "" ? undefined : Number(c.seed);
  return {
    humanSeat: c.seat,
    game: {
      playerCount: c.players,
      infiltratorCount: c.infiltrators,
      tasksPerPlayer: c.tasksPerPlayer,
      taskDifficulty: c.taskDifficulty,
      ...(seed !== undefined && Number.isInteger(seed) && seed >= 0 ? { seed } : {}),
    },
    ai: { difficulty: c.botDifficulty, defaultController: c.bots },
  };
}

import { useState } from "react";
import { PLAYER_IDENTITIES } from "@deduction/shared";
import { loadChoices, saveChoices, type LobbyChoices } from "../state/lobby";

export function Lobby(props: { onStart: (choices: LobbyChoices) => void; connected: boolean; error: string | null }) {
  const [c, setC] = useState<LobbyChoices>(loadChoices);
  const set = <K extends keyof LobbyChoices>(k: K, v: LobbyChoices[K]) => {
    setC((prev) => {
      const next = { ...prev, [k]: v };
      // Keep the choices consistent: the seat must exist and infiltrators must be a minority.
      const seats = PLAYER_IDENTITIES.slice(0, next.players).map((p) => p.id);
      if (!seats.includes(next.seat)) next.seat = seats[0]!;
      while (next.infiltrators > 1 && next.infiltrators * 2 >= next.players) next.infiltrators--;
      return next;
    });
  };
  const seats = PLAYER_IDENTITIES.slice(0, c.players);
  const seedOk = c.seed.trim() === "" || /^\d{1,10}$/.test(c.seed.trim());

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>
          Agentic <span>Deduction</span>
        </h1>
        <p className="tagline">Outpost Kappa. One of you is not who they say they are.</p>

        <section>
          <h2>Your colour</h2>
          <div className="seats">
            {seats.map((p) => (
              <button
                key={p.id}
                className={`seat ${c.seat === p.id ? "selected" : ""}`}
                style={{ background: p.color }}
                title={p.name}
                aria-label={p.name}
                aria-pressed={c.seat === p.id}
                onClick={() => set("seat", p.id)}
              />
            ))}
          </div>
        </section>

        <section className="grid2">
          <label>
            Players
            <input type="range" min={4} max={12} value={c.players} onChange={(e) => set("players", Number(e.target.value))} />
            <b>{c.players}</b>
          </label>
          <label>
            Infiltrators
            <input type="range" min={1} max={3} value={c.infiltrators} onChange={(e) => set("infiltrators", Number(e.target.value))} />
            <b>{c.infiltrators}</b>
          </label>
          <label>
            Tasks each
            <input type="range" min={1} max={10} value={c.tasksPerPlayer} onChange={(e) => set("tasksPerPlayer", Number(e.target.value))} />
            <b>{c.tasksPerPlayer}</b>
          </label>
          <label>
            Task difficulty
            <select value={c.taskDifficulty} onChange={(e) => set("taskDifficulty", Number(e.target.value) as 1 | 2 | 3)}>
              <option value={1}>Easy</option>
              <option value={2}>Normal</option>
              <option value={3}>Hard</option>
            </select>
          </label>
          <label>
            Bots
            <select value={c.bots} onChange={(e) => set("bots", e.target.value as LobbyChoices["bots"])}>
              <option value="heuristic">Heuristic agents</option>
              <option value="random">Random (testing)</option>
            </select>
          </label>
          <label>
            Bot skill
            <select value={c.botDifficulty} onChange={(e) => set("botDifficulty", e.target.value as LobbyChoices["botDifficulty"])}>
              <option value="easy">Easy</option>
              <option value="normal">Normal</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label className="wide">
            Seed
            <input
              type="text"
              inputMode="numeric"
              placeholder="secret (random)"
              value={c.seed}
              className={seedOk ? "" : "invalid"}
              onChange={(e) => set("seed", e.target.value)}
            />
          </label>
        </section>
        <p className="hint">A fixed seed reproduces a match exactly, including who the infiltrators are. Leave it empty to play fair.</p>

        <button
          className="primary start"
          disabled={!props.connected || !seedOk}
          onClick={() => {
            saveChoices(c);
            props.onStart(c);
          }}
        >
          {props.connected ? "Start match" : "Connecting…"}
        </button>
        {props.error && <p className="error">{props.error}</p>}

        <details className="controls">
          <summary>Controls</summary>
          <ul>
            <li>
              <kbd>W</kbd>
              <kbd>A</kbd>
              <kbd>S</kbd>
              <kbd>D</kbd> / arrows: move
            </li>
            <li>
              <kbd>E</kbd> use (task, repair) · <kbd>R</kbd> report · <kbd>M</kbd> emergency meeting
            </li>
            <li>
              <kbd>Q</kbd> kill · <kbd>V</kbd> vent · <kbd>F</kbd> sabotage (infiltrators)
            </li>
            <li>
              <kbd>Enter</kbd> talk to players nearby · <kbd>Esc</kbd> close a task
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}

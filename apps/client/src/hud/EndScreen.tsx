import { formatClock, teamOf, type PlayerObservation, type PublicMatchSummary } from "@deduction/shared";
import { WIN_REASON_TEXT } from "../state/describe";

/** After MATCH_ENDED the server releases every role and the seed; nothing here was known during play. */
export function EndScreen(props: { obs: PlayerObservation; summary: PublicMatchSummary | null; onAgain: () => void; onLobby: () => void }) {
  const { obs, summary } = props;
  const outcome = summary ? { winner: summary.winner, reason: summary.reason } : obs.outcome;
  if (!outcome) return null;
  const won = teamOf(obs.self.role) === outcome.winner;
  return (
    <div className="end-backdrop">
      <div className={`end ${won ? "won" : "lost"}`}>
        <h1>{won ? "Victory" : "Defeat"}</h1>
        <p className="winner">
          {outcome.winner === "crew" ? "Crew" : "Infiltrators"} win. {WIN_REASON_TEXT[outcome.reason]}
        </p>
        <ul className="roles">
          {obs.roster.map((r) => {
            const role = summary?.roles[r.id] ?? r.knownRole;
            return (
              <li key={r.id} className={role ?? ""}>
                <span className="dot" style={{ background: r.color }} />
                <b>
                  {r.name}
                  {r.id === obs.self.id && " (you)"}
                </b>
                <span className={`role-tag ${role ?? ""}`}>{role ?? "?"}</span>
                <span className="muted">{r.knownStatus !== "alive" ? r.knownStatus : ""}</span>
              </li>
            );
          })}
        </ul>
        {summary && (
          <p className="muted">
            Match length {formatClock(summary.durationTicks)} · seed {summary.seed}
            {summary.replayRef && ` · replay ${summary.replayRef}`}
          </p>
        )}
        <div className="row">
          <button className="primary" onClick={props.onAgain}>
            Play again
          </button>
          <button onClick={props.onLobby}>Lobby</button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { GameClient } from "./net/client";
import { ClientStore } from "./state/store";
import { useClientState } from "./state/hooks";
import { Lobby } from "./hud/Lobby";
import { loadChoices, toLobbySettings, type LobbyChoices } from "./state/lobby";
import { GameView } from "./GameView";

declare global {
  interface Window {
    /** For browser automation (e2e). Holds only what the server sent this seat. */
    __deduction?: { store: ClientStore };
  }
}

export function App() {
  const client = useMemo(() => new GameClient(new ClientStore()), []);
  window.__deduction = { store: client.store };
  const state = useClientState(client.store);
  const [lastChoices, setLastChoices] = useState<LobbyChoices>(loadChoices);

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  const start = (c: LobbyChoices) => {
    setLastChoices(c);
    client.startMatch(toLobbySettings(c));
  };

  if (state.connection === "closed") {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1>
            Agentic <span>Deduction</span>
          </h1>
          <p className="error">Lost the connection to the game server.</p>
          <button className="primary" onClick={() => client.connect()}>
            Reconnect
          </button>
        </div>
      </div>
    );
  }

  if (state.match) {
    return <GameView key={state.match.matchId} client={client} match={state.match} onAgain={() => start(lastChoices)} onLobby={() => client.leaveMatch()} />;
  }
  return <Lobby onStart={start} connected={state.connection === "open"} error={state.error} />;
}

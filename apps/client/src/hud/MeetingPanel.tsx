import { useEffect, useRef, useState } from "react";
import type { MeetingPhase, PlayerId, PlayerObservation, VoteTarget } from "@deduction/shared";
import { areaName, type GameMap } from "@deduction/maps";
import type { MeetingAnnouncement } from "../state/store";

const PHASE_LABEL: Record<MeetingPhase, string> = {
  reveal: "Meeting called",
  statements: "Opening statements",
  discussion: "Discussion",
  final_statements: "Final statements",
  voting: "Voting",
  result: "Results",
};

/**
 * Meeting screen, built only from the public `observation.meeting` view plus the announcement event: who called it,
 * who died, the transcript, who has voted (not for whom), and the revealed votes at the end.
 */
export function MeetingPanel(props: {
  obs: PlayerObservation;
  map: GameMap;
  announcement: MeetingAnnouncement | null;
  maxChars: number;
  secondsLeft: number | null;
  onVote: (target: VoteTarget) => void;
  onSpeak: (text: string) => void;
}) {
  const { obs, map } = props;
  const m = obs.meeting!;
  const self = obs.self.id;
  const [picked, setPicked] = useState<VoteTarget | null>(null);
  const [text, setText] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const roster = new Map(obs.roster.map((r) => [r.id, r]));
  const name = (id: PlayerId) => (id === self ? "You" : (roster.get(id)?.name ?? id));
  const color = (id: PlayerId) => roster.get(id)?.color ?? "#888";
  const canVote = obs.legal.vote.length > 0;
  const iVoted = m.voted.includes(self);
  const dead = props.announcement?.meetingId === m.meetingId ? props.announcement.deadSinceLastMeeting : [];
  const result = m.result;

  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [m.messages.length]);
  useEffect(() => setPicked(null), [m.meetingId]);

  const votesFor = (target: VoteTarget) => (result ? Object.entries(result.votes).filter(([, t]) => t === target).map(([voter]) => voter) : []);

  const send = () => {
    const t = text.trim();
    if (!t || !obs.legal.speak) return;
    props.onSpeak(t);
    setText("");
  };

  return (
    <div className="meeting-backdrop">
      <div className="meeting" role="dialog" aria-label="Meeting">
        <header>
          <div>
            <h2>
              {m.reason === "body" ? (
                <>
                  {name(m.callerId)} reported {m.victimId ? `${name(m.victimId)}'s` : "a"} body
                  {m.bodyRoomId ? ` in ${areaName(map, m.bodyRoomId)}` : ""}
                </>
              ) : (
                <>{name(m.callerId)} called an emergency meeting</>
              )}
            </h2>
            <p className="muted">{dead.length > 0 ? `Dead since the last meeting: ${dead.map(name).join(", ")}` : "Nobody died since the last meeting."}</p>
          </div>
          <div className="phase">
            <span>{PHASE_LABEL[m.phase]}</span>
            {props.secondsLeft !== null && <b>{Math.ceil(props.secondsLeft)}s</b>}
          </div>
        </header>

        <div className="meeting-body">
          <section className="voters">
            <div className="cards">
              {obs.roster.map((r) => {
                const participant = m.participants.includes(r.id);
                const votable = obs.legal.vote.includes(r.id);
                const received = votesFor(r.id);
                return (
                  <button
                    key={r.id}
                    className={`card ${participant ? "" : "out"} ${picked === r.id ? "picked" : ""} ${result?.ejectedId === r.id ? "ejected" : ""}`}
                    disabled={!votable}
                    onClick={() => setPicked(r.id)}
                  >
                    <span className="dot" style={{ background: r.color }} />
                    <span className="card-name">
                      {r.name}
                      {r.id === self && " (you)"}
                    </span>
                    {r.knownRole && r.id !== self && <span className={`role-tag ${r.knownRole}`}>{r.knownRole}</span>}
                    {!participant && <span className="status">{r.knownStatus === "ejected" ? "ejected" : "dead"}</span>}
                    {participant && m.voted.includes(r.id) && !result && <span className="voted">voted</span>}
                    {received.length > 0 && (
                      <span className="received">
                        {received.map((v) => (
                          <span key={v} className="mini-dot" style={{ background: color(v) }} title={name(v)} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="vote-row">
              <button className={`skip ${picked === "skip" ? "picked" : ""}`} disabled={!obs.legal.vote.includes("skip")} onClick={() => setPicked("skip")}>
                Skip vote
                {votesFor("skip").length > 0 && (
                  <span className="received">
                    {votesFor("skip").map((v) => (
                      <span key={v} className="mini-dot" style={{ background: color(v) }} title={name(v)} />
                    ))}
                  </span>
                )}
              </button>
              {canVote && (
                <button
                  className="primary"
                  disabled={picked === null}
                  onClick={() => {
                    if (picked !== null) props.onVote(picked);
                  }}
                >
                  {picked === null ? "Pick someone" : picked === "skip" ? "Confirm skip" : `Vote ${name(picked)}`}
                </button>
              )}
              {!canVote && m.phase === "voting" && <span className="muted">{iVoted ? "Vote cast." : "You can't vote."}</span>}
              {m.phase !== "voting" && !result && <span className="muted">Voting opens after the discussion.</span>}
            </div>
            {result && <ResultLine result={result} name={name} />}
          </section>

          <section className="chat">
            <div className="transcript" ref={transcript}>
              {m.messages.length === 0 && <p className="muted">No one has spoken yet.</p>}
              {m.messages.map((msg) => (
                <div key={msg.seq} className={`msg ${msg.playerId === self ? "mine" : ""}`}>
                  <span className="dot" style={{ background: color(msg.playerId) }} />
                  <b>{name(msg.playerId)}</b> <span>{msg.text}</span>
                </div>
              ))}
            </div>
            <form
              className="say"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                value={text}
                maxLength={props.maxChars}
                disabled={!obs.self.alive}
                placeholder={!obs.self.alive ? "Ghosts can't talk to the living" : obs.legal.speak ? "Say something…" : "Wait for your next chance to speak"}
                onChange={(e) => setText(e.target.value)}
                aria-label="Meeting message"
              />
              <button className="primary" disabled={!obs.legal.speak || text.trim() === ""}>
                Send
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function ResultLine({ result, name }: { result: NonNullable<PlayerObservation["meeting"]>["result"] & object; name: (id: PlayerId) => string }) {
  let text: string;
  if (result.outcome === "ejected" && result.ejectedId) {
    const who = name(result.ejectedId);
    const role = result.ejectedRole === null ? "" : result.ejectedRole === "infiltrator" ? " They were an infiltrator." : " They were not an infiltrator.";
    text = `${who} ${who === "You" ? "were" : "was"} ejected.${role}`;
  } else if (result.outcome === "tie") text = "Tie. No one was ejected.";
  else if (result.outcome === "skipped") text = "Skipped. No one was ejected.";
  else text = "No votes. No one was ejected.";
  return <p className="result">{text}</p>;
}

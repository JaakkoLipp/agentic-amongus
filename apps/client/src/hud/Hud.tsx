import { useEffect, useRef, useState } from "react";
import { formatClock, isCriticalSabotage, type PlayerObservation } from "@deduction/shared";
import { areaName, type GameMap } from "@deduction/maps";
import type { LogEntry, Toast } from "../state/store";
import { SABOTAGE_LABEL } from "../state/describe";

export function TopBar(props: { obs: PlayerObservation; map: GameMap; pingMs: number | null; onLeave: () => void }) {
  const { obs, map } = props;
  const self = obs.self;
  const progress = obs.taskProgress;
  const teammates = obs.teammates.map((id) => obs.roster.find((r) => r.id === id)?.name ?? id);
  return (
    <div className="top-bar">
      <div className={`role-badge ${self.role}`}>
        <span className="dot" style={{ background: self.color }} />
        <div>
          <b>{self.role === "infiltrator" ? "Infiltrator" : "Crew"}</b>
          {!self.alive && <span className="ghost-tag">ghost</span>}
          <small>{self.role === "infiltrator" ? (teammates.length ? `with ${teammates.join(", ")}` : "alone") : "Finish tasks, find the infiltrators"}</small>
        </div>
      </div>
      <div className="progress" title="Crew task progress">
        <span>Tasks</span>
        {progress ? (
          <div className="bar">
            <div className="fill" style={{ width: `${(progress.completed / Math.max(1, progress.total)) * 100}%` }} />
            <em>
              {progress.completed}/{progress.total}
            </em>
          </div>
        ) : (
          <div className="bar comms-down">
            <em>comms down</em>
          </div>
        )}
      </div>
      <div className="where">
        <b>{self.inVentId ? "In a vent" : areaName(map, self.roomId)}</b>
        <small>
          {formatClock(obs.tick)}
          {props.pingMs !== null && ` · ${props.pingMs} ms`}
        </small>
      </div>
      <button className="icon leave" onClick={props.onLeave} title="Leave match">
        Leave
      </button>
    </div>
  );
}

export function SabotageBanner(props: { obs: PlayerObservation; secondsLeft: number | null }) {
  const sab = props.obs.sabotage;
  if (!sab) return null;
  const critical = isCriticalSabotage(sab.kind);
  const open = sab.stations.filter((s) => !s.fixed).length;
  return (
    <div className={`sabotage-banner ${critical ? "critical" : ""}`}>
      <b>{SABOTAGE_LABEL[sab.kind]}</b>
      {props.secondsLeft !== null && <span className="countdown">{Math.ceil(props.secondsLeft)}s</span>}
      <span>
        {sab.kind === "reactor"
          ? "Two people must hold both stabilizers at the same time."
          : `${open} repair point${open === 1 ? "" : "s"} left. Stand at one and press E.`}
      </span>
    </div>
  );
}

export function TaskList(props: { obs: PlayerObservation; map: GameMap }) {
  const { obs, map } = props;
  const [open, setOpen] = useState(true);
  const fake = obs.self.role === "infiltrator";
  return (
    <div className={`task-list ${open ? "" : "collapsed"}`}>
      <button className="tl-head" onClick={() => setOpen((o) => !o)}>
        {fake ? "Fake tasks" : "Tasks"} {open ? "▾" : "▸"}
      </button>
      {open && (
        <ul>
          {obs.tasks.map((t) => (
            <li key={t.taskId} className={t.done ? "done" : ""}>
              {areaName(map, t.roomId)}: {t.title}
            </li>
          ))}
          {fake && <li className="muted note">Pretend to do these. They don't help the crew.</li>}
        </ul>
      )}
    </div>
  );
}

export function EventLog(props: { log: readonly LogEntry[] }) {
  return (
    <div className="event-log" aria-live="polite">
      {props.log.slice(-8).map((e) => (
        <div key={e.id} className={`log ${e.tone}`}>
          <span className="t">{formatClock(e.tick)}</span> {e.text}
        </div>
      ))}
    </div>
  );
}

export function Toasts(props: { toasts: readonly Toast[] }) {
  return (
    <div className="toasts">
      {props.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Proximity speech: only players within hearing range hear it. */
export function ChatBox(props: { canSpeak: boolean; maxChars: number; open: boolean; setOpen: (o: boolean) => void; onSpeak: (text: string) => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (props.open) input.current?.focus();
  }, [props.open]);
  if (!props.open) return <div className="chat-hint">Press Enter to talk to players nearby</div>;
  return (
    <form
      className="proximity-chat"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (t && props.canSpeak) props.onSpeak(t);
        setText("");
        props.setOpen(false);
      }}
    >
      <input
        ref={input}
        value={text}
        maxLength={props.maxChars}
        placeholder={props.canSpeak ? "Say something to players nearby…" : "Wait a moment before speaking again"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.setOpen(false);
        }}
        onBlur={() => props.setOpen(false)}
        aria-label="Proximity chat"
      />
    </form>
  );
}

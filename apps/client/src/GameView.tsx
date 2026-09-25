import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerAction, TaskAnswer } from "@deduction/shared";
import type { GameClient } from "./net/client";
import type { MatchInfo } from "./state/store";
import { secondsUntil, useClientState, useTicker } from "./state/hooks";
import { GameRenderer } from "./render/renderer";
import { MovementKeys, isTyping } from "./input/keyboard";
import { ActionBar } from "./hud/ActionBar";
import { ChatBox, EventLog, SabotageBanner, TaskList, Toasts, TopBar } from "./hud/Hud";
import { Minimap } from "./hud/Minimap";
import { TaskPanel } from "./hud/TaskPanel";
import { MeetingPanel } from "./hud/MeetingPanel";
import { EndScreen } from "./hud/EndScreen";

export function GameView(props: { client: GameClient; match: MatchInfo; onAgain: () => void; onLobby: () => void }) {
  const { client, match } = props;
  const store = client.store;
  const state = useClientState(store);
  const now = useTicker(100);
  const host = useRef<HTMLDivElement>(null);
  const keys = useRef<MovementKeys | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const obs = state.obs;

  const act = useCallback((a: PlayerAction) => client.act(a), [client]);

  // Renderer lifetime = match lifetime.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new GameRenderer(store, match.map);
    void renderer.mount(el);
    const onWheel = (e: WheelEvent) => {
      renderer.zoom = Math.min(2.2, Math.max(0.55, renderer.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      renderer.destroy();
    };
  }, [store, match]);

  useEffect(() => {
    const k = new MovementKeys((dir) => client.setMove(dir));
    keys.current = k;
    const detach = k.attach();
    return () => {
      detach();
      client.setMove({ x: 0, y: 0 });
    };
  }, [client]);

  // Movement is off while a modal owns the keyboard (tasks, meeting, chat) and whenever the engine says so.
  const modal = obs !== null && (obs.activeTask !== null || obs.phase !== "playing" || chatOpen);
  useEffect(() => {
    keys.current?.setEnabled(!modal && (obs?.legal.move ?? false));
  }, [modal, obs?.legal.move]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !isTyping(e) && obs?.phase === "playing" && !obs.activeTask) {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [obs?.phase, obs?.activeTask]);

  const cancelTask = useCallback(() => act({ type: "CANCEL_TASK" }), [act]);
  const submitAnswer = useCallback((answer: TaskAnswer) => {
    const t = store.get().obs?.activeTask;
    if (t) act({ type: "SUBMIT_TASK_ANSWER", taskId: t.taskId, answer });
  }, [act, store]);

  const settings = match.settings;
  const task = obs?.activeTask ?? null;

  return (
    <div className="game">
      <div className="canvas-host" ref={host} />
      {!obs && <div className="loading">Waiting for the first snapshot…</div>}
      {obs && (
        <>
          <TopBar obs={obs} map={match.map} pingMs={state.pingMs} onLeave={props.onLobby} />
          <SabotageBanner obs={obs} secondsLeft={secondsUntil(store, obs.sabotage?.deadlineTick ?? null, now)} />
          <TaskList obs={obs} map={match.map} />
          <Minimap obs={obs} map={match.map} />
          <EventLog log={state.log} />
          <Toasts toasts={state.toasts} />
          {obs.phase === "playing" && (
            <>
              <ChatBox canSpeak={obs.legal.speak} maxChars={settings.maxUtteranceChars} open={chatOpen} setOpen={setChatOpen} onSpeak={(text) => act({ type: "SPEAK", text })} />
              <ActionBar obs={obs} map={match.map} act={act} />
            </>
          )}
          {task && obs.phase === "playing" && (
            <TaskPanel
              task={task}
              canSubmit={obs.legal.submitAnswer === task.taskId}
              secondsLeft={secondsUntil(store, task.phaseEndsAtTick, now)}
              onSubmit={submitAnswer}
              onCancel={cancelTask}
            />
          )}
          {obs.phase === "meeting" && obs.meeting && (
            <MeetingPanel
              obs={obs}
              map={match.map}
              announcement={state.announcement}
              maxChars={settings.maxUtteranceChars}
              secondsLeft={secondsUntil(store, obs.meeting.phaseEndsAtTick, now)}
              onVote={(target) => act({ type: "VOTE", target })}
              onSpeak={(text) => act({ type: "SPEAK", text })}
            />
          )}
          {obs.phase === "ended" && <EndScreen obs={obs} summary={state.summary} onAgain={props.onAgain} onLobby={props.onLobby} />}
        </>
      )}
    </div>
  );
}

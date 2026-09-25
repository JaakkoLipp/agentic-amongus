import { useEffect, useState } from "react";
import { dist, TICK_MS, type PlayerAction, type PlayerObservation, type SabotageKind } from "@deduction/shared";
import { areaName, type GameMap } from "@deduction/maps";
import { isTyping } from "../input/keyboard";
import { SABOTAGE_LABEL } from "../state/describe";

interface Btn {
  readonly id: string;
  readonly label: string;
  readonly key: string;
  readonly enabled: boolean;
  readonly action: PlayerAction | null;
  readonly cooldown?: number | null;
  readonly tone?: "danger" | "use" | "alert";
  readonly onClick?: () => void;
}

/**
 * Context actions. Every button's action comes straight from `observation.legal`, so a button that is enabled is
 * an action the engine will accept. Hotkeys fire the same actions.
 */
export function ActionBar(props: { obs: PlayerObservation; map: GameMap; act: (a: PlayerAction) => void }) {
  const { obs, map, act } = props;
  const [sabotageOpen, setSabotageOpen] = useState(false);
  const legal = obs.legal;
  const self = obs.self;
  const infiltrator = self.role === "infiltrator";
  const secs = (ticks: number | null) => (ticks && ticks > 0 ? Math.ceil((ticks * TICK_MS) / 1000) : null);

  const nearestKill = legal.kill
    .map((id) => ({ id, p: obs.visiblePlayers.find((v) => v.id === id) }))
    .sort((a, b) => (a.p ? dist(a.p.pos, self.pos) : 99) - (b.p ? dist(b.p.pos, self.pos) : 99))[0]?.id;

  const use: PlayerAction | null = legal.startTask[0]
    ? { type: "START_TASK", taskId: legal.startTask[0] }
    : legal.repair[0] && !self.repairingStationId
      ? { type: "START_REPAIR", stationId: legal.repair[0] }
      : null;
  const vent: PlayerAction | null = legal.ventExit ? { type: "EXIT_VENT" } : legal.ventEnter ? { type: "ENTER_VENT", ventId: legal.ventEnter } : null;

  const buttons: Btn[] = [
    { id: "use", label: self.repairingStationId ? "Repairing…" : legal.repair.length && !legal.startTask.length ? "Repair" : "Use", key: "E", enabled: use !== null, action: use, tone: "use" },
    { id: "report", label: "Report", key: "R", enabled: legal.report.length > 0, action: legal.report[0] ? { type: "REPORT_BODY", bodyId: legal.report[0] } : null, tone: "alert" },
    { id: "emergency", label: "Emergency", key: "M", enabled: legal.emergency, action: legal.emergency ? { type: "CALL_EMERGENCY" } : null, tone: "alert" },
  ];
  if (infiltrator && self.alive) {
    buttons.push(
      { id: "kill", label: "Kill", key: "Q", enabled: nearestKill !== undefined, action: nearestKill ? { type: "KILL", targetId: nearestKill } : null, cooldown: secs(self.killCooldownTicks), tone: "danger" },
      { id: "vent", label: self.inVentId ? "Exit vent" : "Vent", key: "V", enabled: vent !== null, action: vent, tone: "danger" },
    );
  }
  if (infiltrator) {
    buttons.push({
      id: "sabotage",
      label: "Sabotage",
      key: "F",
      enabled: legal.sabotage.length > 0,
      action: null,
      cooldown: secs(self.sabotageCooldownTicks),
      tone: "danger",
      onClick: () => setSabotageOpen((o) => !o),
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The task panel is modal: its own keys (digits, letters) must not trigger actions behind it.
      if (isTyping(e) || e.repeat || e.metaKey || e.ctrlKey || e.altKey || obs.activeTask) return;
      const key = e.key.toUpperCase();
      if (sabotageOpen && /^[1-4]$/.test(e.key)) {
        const kind = legal.sabotage[Number(e.key) - 1];
        if (kind) act({ type: "SABOTAGE", kind });
        setSabotageOpen(false);
        return;
      }
      if (self.inVentId && /^[1-9]$/.test(e.key)) {
        const to = legal.ventMove[Number(e.key) - 1];
        if (to) act({ type: "MOVE_VENT", toVentId: to });
        return;
      }
      const b = buttons.find((x) => x.key === key || (x.id === "use" && e.code === "Space"));
      if (!b) return;
      e.preventDefault();
      if (b.onClick) b.onClick();
      else if (b.enabled && b.action) act(b.action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (legal.sabotage.length === 0) setSabotageOpen(false);
  }, [legal.sabotage.length]);

  return (
    <div className="action-bar">
      {self.inVentId && legal.ventMove.length > 0 && (
        <div className="vent-menu">
          {legal.ventMove.map((to, i) => {
            const v = map.ventById.get(to);
            return (
              <button key={to} onClick={() => act({ type: "MOVE_VENT", toVentId: to })}>
                <kbd>{i + 1}</kbd> {v ? areaName(map, v.roomId) : to}
              </button>
            );
          })}
        </div>
      )}
      {sabotageOpen && (
        <div className="sabotage-menu">
          {legal.sabotage.map((kind: SabotageKind, i) => (
            <button
              key={kind}
              onClick={() => {
                act({ type: "SABOTAGE", kind });
                setSabotageOpen(false);
              }}
            >
              <kbd>{i + 1}</kbd> {SABOTAGE_LABEL[kind]}
            </button>
          ))}
        </div>
      )}
      <div className="buttons">
        {buttons.map((b) => (
          <button
            key={b.id}
            className={`action ${b.tone ?? ""} ${b.enabled ? "ready" : ""}`}
            disabled={!b.enabled}
            onClick={() => (b.onClick ? b.onClick() : b.action && act(b.action))}
            title={`${b.label} (${b.key})`}
          >
            <span className="action-label">{b.label}</span>
            <kbd>{b.key}</kbd>
            {b.cooldown ? <span className="cooldown">{b.cooldown}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

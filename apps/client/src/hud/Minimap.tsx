import { useEffect, useRef, useState } from "react";
import type { PlayerObservation } from "@deduction/shared";
import type { GameMap } from "@deduction/maps";
import { isTyping } from "../input/keyboard";

/**
 * Station map: public floor plan plus things this player legitimately knows — their own position, their own
 * unfinished task consoles and active sabotage repair points. Tab toggles the large view.
 */
export function Minimap(props: { obs: PlayerObservation; map: GameMap }) {
  const { map, obs } = props;
  const [big, setBig] = useState(false);
  const base = useRef<HTMLCanvasElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = big ? 7 : 2.4;

  // Pre-render the floor plan once per size.
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = Math.ceil(map.width * scale);
    c.height = Math.ceil(map.height * scale);
    const g = c.getContext("2d");
    if (!g) return;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const a = map.areaIndex[y * map.width + x]!;
        if (a < 0 || map.walkable[y * map.width + x] !== 1) continue;
        g.fillStyle = map.areas[a]!.kind === "room" ? "#3a4558" : "#2a3242";
        g.fillRect(x * scale, y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
    if (big) {
      g.fillStyle = "#b8c3d6";
      g.font = "600 13px system-ui, sans-serif";
      g.textAlign = "center";
      for (const area of map.areas) if (area.kind === "room") g.fillText(area.name, area.center.x * scale, area.center.y * scale);
    }
    base.current = c;
  }, [map, scale, big]);

  // Tab toggles the big map while roaming; in meetings and task panels it keeps moving keyboard focus.
  const roaming = obs.phase === "playing" && obs.activeTask === null;
  useEffect(() => {
    if (!roaming) {
      setBig(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || isTyping(e)) return;
      e.preventDefault();
      setBig((b) => !b);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [roaming]);

  // Redraw only when something on the map changed (canvas redraws are not free under software rendering).
  const drawKey = [
    big,
    Math.round(obs.self.pos.x * 2),
    Math.round(obs.self.pos.y * 2),
    obs.tasks.filter((t) => !t.done).map((t) => t.taskId).join(),
    (obs.sabotage?.stations ?? []).filter((s) => !s.fixed).map((s) => s.stationId).join(),
  ].join("|");
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g || !base.current) return;
    if (c.width !== base.current.width || c.height !== base.current.height) {
      c.width = base.current.width;
      c.height = base.current.height;
    }
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(base.current, 0, 0);
    const dot = (x: number, y: number, r: number, fill: string, stroke?: string) => {
      g.beginPath();
      g.arc(x * scale, y * scale, r, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      if (stroke) {
        g.strokeStyle = stroke;
        g.lineWidth = 1.5;
        g.stroke();
      }
    };
    const r = big ? 6 : 3;
    for (const t of obs.tasks) if (!t.done) dot(t.pos.x, t.pos.y, r, "#f5d90a");
    for (const s of obs.sabotage?.stations ?? []) if (!s.fixed) dot(s.pos.x, s.pos.y, r + 1, "#ff3b3b");
    const b = map.def.emergencyButton.pos;
    dot(b.x, b.y, r - 1, "#e5484d", "#ffffff");
    dot(obs.self.pos.x, obs.self.pos.y, r + 1.5, obs.self.color, "#ffffff");
  }, [drawKey]);

  return (
    <div className={`minimap ${big ? "big" : ""}`} onClick={() => setBig((v) => !v)} title="Map (Tab)">
      <canvas ref={canvas} />
    </div>
  );
}

import type { Vec2 } from "@deduction/shared";

const DIRS: Record<string, Vec2> = {
  KeyW: { x: 0, y: -1 },
  ArrowUp: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/** True when the key event belongs to a text field (chat, task answers) rather than the game. */
export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * WASD / arrow keys -> a unit movement direction. Hotkeys (E, R, Q, …) are handled by the HUD, which knows which
 * actions are currently legal.
 */
export class MovementKeys {
  private readonly held = new Set<string>();
  private enabled = true;

  constructor(private readonly onChange: (dir: Vec2) => void) {}

  attach(): () => void {
    const down = (e: KeyboardEvent) => {
      if (!(e.code in DIRS) || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      if (!this.held.has(e.code)) {
        this.held.add(e.code);
        this.emit();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (this.held.delete(e.code)) this.emit();
    };
    const blur = () => {
      this.held.clear();
      this.emit();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }

  /** Disable while a modal (task, meeting, chat) is open: the figure stops. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) this.held.clear();
    this.emit();
  }

  private emit(): void {
    let x = 0;
    let y = 0;
    if (this.enabled) {
      for (const code of this.held) {
        x += DIRS[code]!.x;
        y += DIRS[code]!.y;
      }
    }
    x = Math.sign(x);
    y = Math.sign(y);
    const len = Math.hypot(x, y) || 1;
    this.onChange({ x: x / len, y: y / len });
  }
}

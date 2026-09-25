import { Application, Container, Graphics } from "pixi.js";
import { moveWithCollision, type GameMap } from "@deduction/maps";
import type { PlayerId, PlayerObservation, Vec2, VisiblePlayer } from "@deduction/shared";
import type { ClientStore, TimedObservation } from "../state/store";
import { buildMapLayer, TILE } from "./mapLayer";
import { bodySprite, PlayerSprite } from "./sprites";
import { visibilityPolygon } from "./visibility";

/** Other players are drawn this far in the past, between two received snapshots. */
const INTERP_DELAY_MS = 110;
/** Own movement is dead-reckoned from the last snapshot for at most this long. */
const MAX_EXTRAPOLATE_MS = 120;
/** Tiles visible from the camera centre to the top edge, at zoom 1. */
const BASE_HALF_VIEW_TILES = 11;

/**
 * PixiJS view of one seat's observation. Draws the static map once, then every frame: other visible players
 * (interpolated between snapshots), the own figure (dead-reckoned, smoothed), bodies, task and repair markers, and a
 * darkness overlay with a line-of-sight light polygon. It renders only what the server sent this seat.
 */
export class GameRenderer {
  private app: Application | null = null;
  private world = new Container();
  private markers = new Graphics();
  private bodies = new Container();
  private playersLayer = new Container();
  private fog = new Graphics();
  private readonly sprites = new Map<PlayerId, PlayerSprite>();
  private readonly bodySprites = new Map<string, Container>();
  private self: Vec2 | null = null;
  private selfSprite: PlayerSprite | null = null;
  private time = 0;
  private destroyed = false;
  private fogKey = "";
  zoom = 1;

  constructor(
    private readonly store: ClientStore,
    private readonly map: GameMap,
  ) {}

  async mount(host: HTMLElement): Promise<void> {
    const app = new Application();
    // Software GL (no GPU, e.g. SwiftShader in CI or remote desktops) can't afford MSAA or high-DPI buffers.
    const software = isSoftwareRenderer();
    await app.init({
      resizeTo: host,
      background: 0x07090d,
      antialias: !software,
      autoDensity: true,
      resolution: software ? 1 : Math.min(2, window.devicePixelRatio || 1),
      powerPreference: "high-performance",
    });
    if (this.destroyed) {
      app.destroy(true);
      return;
    }
    this.app = app;
    host.appendChild(app.canvas);
    this.world.addChild(buildMapLayer(this.map), this.markers, this.bodies, this.playersLayer, this.fog);
    app.stage.addChild(this.world);
    app.ticker.add((t) => this.frame(t.deltaMS));
  }

  destroy(): void {
    this.destroyed = true;
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
    this.app?.destroy(true, { children: true });
    this.app = null;
  }

  private frame(dtMs: number): void {
    const app = this.app;
    const buffer = this.store.buffer;
    const latest = buffer.at(-1);
    if (!app || !latest) return;
    this.time += dtMs / 1000;
    const obs = latest.obs;
    const now = performance.now();

    const selfTarget = this.extrapolateSelf(latest, now);
    const k = 1 - Math.exp(-dtMs / 45);
    this.self = this.self && Math.hypot(this.self.x - selfTarget.x, this.self.y - selfTarget.y) < 3 ? lerp(this.self, selfTarget, k) : selfTarget;
    const me = this.self;

    this.drawPlayers(obs, now, dtMs);
    this.drawBodies(obs);
    this.drawMarkers(obs);

    // Camera: centre on the own figure.
    const halfView = BASE_HALF_VIEW_TILES / this.zoom;
    const scale = app.screen.height / (2 * halfView * TILE);
    this.world.scale.set(scale);
    this.world.position.set(app.screen.width / 2 - me.x * TILE * scale, app.screen.height / 2 - me.y * TILE * scale);

    this.drawFog(obs, me, app.screen.width / scale / TILE, app.screen.height / scale / TILE);
  }

  /** Own position: last server position, moved forward along the server-reported heading while moving. */
  private extrapolateSelf(latest: TimedObservation, now: number): Vec2 {
    const s = latest.obs.self;
    if (s.activity !== "moving" || latest.obs.phase !== "playing") return s.pos;
    const speed = this.store.get().match?.settings.playerSpeed ?? 4.5;
    let remaining = (Math.min(now - latest.at, MAX_EXTRAPOLATE_MS) / 1000) * speed;
    let pos = s.pos;
    while (remaining > 1e-6) {
      const step = Math.min(0.15, remaining);
      pos = moveWithCollision(this.map, pos, { x: s.facing.x * step, y: s.facing.y * step });
      remaining -= step;
    }
    return pos;
  }

  private drawPlayers(obs: PlayerObservation, now: number, dtMs: number): void {
    const roster = new Map(obs.roster.map((r) => [r.id, r]));
    const renderAt = now - INTERP_DELAY_MS;
    const [a, b, t] = bracket(this.store.buffer, renderAt);
    const seen = new Set<PlayerId>();

    for (const vp of obs.visiblePlayers) {
      const r = roster.get(vp.id);
      if (!r) continue;
      seen.add(vp.id);
      let sprite = this.sprites.get(vp.id);
      if (!sprite) {
        sprite = new PlayerSprite(r.color, r.name, false);
        this.sprites.set(vp.id, sprite);
        this.playersLayer.addChild(sprite.root);
      }
      sprite.root.visible = true;
      const pa = a ? findPlayer(a.obs, vp.id) : null;
      const pb = b ? findPlayer(b.obs, vp.id) : null;
      const pos = pa && pb ? lerp(pa.pos, pb.pos, t) : (pb ?? pa ?? vp).pos;
      const facing = (pb ?? vp).facing;
      sprite.update(pos.x * TILE, pos.y * TILE, facing.x, vp.ghost, vp.activity === "task" || vp.activity === "repair", dtMs);
      sprite.root.zIndex = pos.y;
    }
    // Keep sprites of players who left sight (hidden): re-creating them would re-rasterize their name labels.
    for (const [id, sprite] of this.sprites) sprite.root.visible = seen.has(id);

    // Self.
    const s = obs.self;
    if (!this.selfSprite) {
      this.selfSprite = new PlayerSprite(s.color, s.name, true);
      this.playersLayer.addChild(this.selfSprite.root);
    }
    const me = this.self!;
    this.selfSprite.root.visible = s.inVentId === null;
    this.selfSprite.update(me.x * TILE, me.y * TILE, s.facing.x, !s.alive, s.activity === "task" || s.activity === "repair", dtMs);
    this.selfSprite.root.zIndex = me.y + 0.001;
    this.playersLayer.sortableChildren = true;
  }

  private drawBodies(obs: PlayerObservation): void {
    const roster = new Map(obs.roster.map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const body of obs.visibleBodies) {
      seen.add(body.bodyId);
      let sprite = this.bodySprites.get(body.bodyId);
      if (!sprite) {
        sprite = bodySprite(roster.get(body.victimId)?.color ?? "#888888");
        this.bodySprites.set(body.bodyId, sprite);
        this.bodies.addChild(sprite);
      }
      sprite.position.set(body.pos.x * TILE, body.pos.y * TILE);
    }
    for (const [id, sprite] of this.bodySprites) {
      if (seen.has(id)) continue;
      sprite.destroy({ children: true });
      this.bodySprites.delete(id);
    }
  }

  private drawMarkers(obs: PlayerObservation): void {
    const g = this.markers;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    // Own unfinished tasks: yellow ring, brighter when it can be started right here.
    for (const task of obs.tasks) {
      if (task.done) continue;
      const ready = obs.legal.startTask.includes(task.taskId);
      g.circle(task.pos.x * TILE, task.pos.y * TILE, 20 + pulse * 3).stroke({ width: ready ? 4 : 2.5, color: 0xf5d90a, alpha: ready ? 1 : 0.55 + 0.3 * pulse });
    }
    // Sabotage repair points.
    for (const st of obs.sabotage?.stations ?? []) {
      if (st.fixed) {
        g.circle(st.pos.x * TILE, st.pos.y * TILE, 20).stroke({ width: 3, color: 0x30a46c, alpha: 0.8 });
        continue;
      }
      g.circle(st.pos.x * TILE, st.pos.y * TILE, 22 + pulse * 6).stroke({ width: 4, color: 0xff3b3b, alpha: 0.5 + 0.5 * pulse });
    }
    // In a vent: show where each link leads.
    const vent = obs.self.inVentId ? this.map.ventById.get(obs.self.inVentId) : null;
    if (vent) {
      g.circle(vent.pos.x * TILE, vent.pos.y * TILE, 18 + pulse * 4).stroke({ width: 3, color: 0xe5484d });
      for (const to of obs.legal.ventMove) {
        const v = this.map.ventById.get(to);
        if (!v) continue;
        g.moveTo(vent.pos.x * TILE, vent.pos.y * TILE).lineTo(v.pos.x * TILE, v.pos.y * TILE);
      }
      g.stroke({ width: 3, color: 0xe5484d, alpha: 0.45 });
    }
  }

  /**
   * Darkness outside the own line of sight. Purely cosmetic: the server already decided what is visible.
   * The light polygon is star-shaped around the player, so the darkness is drawn as one quad per ray segment
   * reaching out past the screen edge (no polygon holes to triangulate).
   */
  private drawFog(obs: PlayerObservation, me: Vec2, viewW: number, viewH: number): void {
    const f = this.fog;
    const alpha = obs.self.alive ? 0.72 : 0.45;
    const key = obs.phase === "playing" ? `${me.x.toFixed(2)},${me.y.toFixed(2)},${obs.self.visionRadius},${alpha},${Math.round(viewW)}x${Math.round(viewH)}` : "off";
    if (key === this.fogKey) return;
    this.fogKey = key;
    f.clear();
    if (obs.phase !== "playing") return;
    const far = Math.hypot(viewW, viewH) + 4;
    const poly = visibilityPolygon(this.map, me, obs.self.visionRadius);
    const n = poly.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = poly[i * 2]!;
      const ay = poly[i * 2 + 1]!;
      const bx = poly[j * 2]!;
      const by = poly[j * 2 + 1]!;
      // Ray angles (the polygon has one vertex per evenly spaced ray).
      const aa = (i / n) * Math.PI * 2;
      const ba = (j / n) * Math.PI * 2;
      f.poly([
        ax * TILE,
        ay * TILE,
        bx * TILE,
        by * TILE,
        (me.x + Math.cos(ba) * far) * TILE,
        (me.y + Math.sin(ba) * far) * TILE,
        (me.x + Math.cos(aa) * far) * TILE,
        (me.y + Math.sin(aa) * far) * TILE,
      ]);
    }
    f.fill({ color: 0x000000, alpha });
  }
}

function isSoftwareRenderer(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

function findPlayer(obs: PlayerObservation, id: PlayerId): VisiblePlayer | null {
  return obs.visiblePlayers.find((p) => p.id === id) ?? null;
}

/** Snapshots around `time`, and the blend factor between them. */
function bracket(buffer: readonly TimedObservation[], time: number): [TimedObservation | null, TimedObservation | null, number] {
  if (buffer.length === 0) return [null, null, 0];
  for (let i = buffer.length - 1; i > 0; i--) {
    const a = buffer[i - 1]!;
    const b = buffer[i]!;
    if (a.at <= time && time <= b.at) return [a, b, b.at === a.at ? 1 : (time - a.at) / (b.at - a.at)];
  }
  const last = buffer.at(-1)!;
  return time > last.at ? [null, last, 1] : [buffer[0]!, null, 0];
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

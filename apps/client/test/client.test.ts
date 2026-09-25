import { describe, expect, it } from "vitest";
import { LobbySettingsSchema, type PerceivedEvent, type PlayerObservation } from "@deduction/shared";
import { getMap, hasLineOfSight, isWalkablePoint } from "@deduction/maps";
import { castRay, visibilityPolygon } from "../src/render/visibility";
import { describeEvent, describeRejection } from "../src/state/describe";
import { ClientStore } from "../src/state/store";
import { loadChoices, toLobbySettings } from "../src/state/lobby";

const map = getMap("outpost-kappa");

describe("light polygon ray caster", () => {
  it("agrees with the engine's line of sight: clear up to the hit, wall right after it", () => {
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const o = { x: 2 + ((i * 37) % 96) + 0.37, y: 2 + ((i * 53) % 68) + 0.61 };
      if (!isWalkablePoint(map, o)) continue;
      const angle = (i * 2.399963) % (Math.PI * 2);
      const d = castRay(map, o, angle, 12);
      const at = (t: number) => ({ x: o.x + Math.cos(angle) * t, y: o.y + Math.sin(angle) * t });
      if (d > 0.1) expect(hasLineOfSight(map, o, at(d - 0.05))).toBe(true);
      if (d < 12) expect(isWalkablePoint(map, at(d + 0.02))).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("builds one vertex per ray, never further than the vision radius", () => {
    const o = map.def.emergencyButton.pos;
    const poly = visibilityPolygon(map, { x: o.x, y: o.y - 2 }, 7, 64);
    expect(poly).toHaveLength(128);
    for (let i = 0; i < poly.length; i += 2) expect(Math.hypot(poly[i]! - o.x, poly[i + 1]! - (o.y - 2))).toBeLessThanOrEqual(7 + 1e-9);
  });
});

const obs = {
  self: { id: "red" },
  roster: [
    { id: "red", name: "Red", color: "#e5484d", knownStatus: "alive", knownRole: "crew" },
    { id: "blue", name: "Blue", color: "#3e63dd", knownStatus: "alive", knownRole: null },
    { id: "green", name: "Green", color: "#30a46c", knownStatus: "alive", knownRole: null },
  ],
} as unknown as PlayerObservation;

describe("event descriptions", () => {
  const ctx = { selfId: "red", map, obs };
  it("names players and rooms from the seat's own knowledge", () => {
    const kill = { type: "SAW_KILL", tick: 10, killerId: "blue", victimId: "green", bodyId: "b1", pos: { x: 0, y: 0 }, roomId: "cargo" } as PerceivedEvent;
    expect(describeEvent(ctx, kill)).toEqual({ text: "You saw Blue kill Green in Cargo Bay!", tone: "alert", toast: true });
    const killed = { type: "WAS_KILLED", tick: 10, killerId: "blue" } as PerceivedEvent;
    expect(describeEvent(ctx, killed)?.text).toMatch(/^Blue killed you/);
  });

  it("skips noisy visibility events", () => {
    const seen = { type: "PLAYER_BECAME_VISIBLE", tick: 1, playerId: "blue", pos: { x: 0, y: 0 }, roomId: null } as PerceivedEvent;
    expect(describeEvent(ctx, seen)).toBeNull();
  });

  it("explains rejected actions", () => {
    expect(describeRejection("KILL", "cooldown")).toBe("Kill: Not ready yet (cooldown).");
  });
});

describe("client store", () => {
  it("logs described events, raises toasts and remembers the meeting announcement", () => {
    const store = new ClientStore();
    const events = [
      { type: "PLAYER_BECAME_VISIBLE", tick: 1, playerId: "blue", pos: { x: 0, y: 0 }, roomId: null },
      { type: "MEETING_STARTED", tick: 2, meetingId: "m1", reason: "body", callerId: "blue", victimId: "green", bodyRoomId: null, deadSinceLastMeeting: ["green"] },
    ] as PerceivedEvent[];
    store.events(events, (e) => describeEvent({ selfId: "red", map, obs }, e));
    const s = store.get();
    expect(s.log.map((l) => l.text)).toEqual(["Meeting. Dead since the last meeting: Green."]);
    expect(s.announcement).toEqual({ meetingId: "m1", deadSinceLastMeeting: ["green"] });
  });

  it("keeps a bounded snapshot buffer for interpolation", () => {
    const store = new ClientStore();
    for (let i = 0; i < 30; i++) store.snapshot({ ...obs, tick: i } as PlayerObservation, i * 66);
    expect(store.buffer).toHaveLength(12);
    expect(store.buffer.at(-1)!.obs.tick).toBe(29);
    expect(store.get().obs?.tick).toBe(29);
  });
});

describe("lobby settings", () => {
  it("produce valid lobby settings; an empty seed stays secret", () => {
    const choices = { ...loadChoices(), seat: "cyan", players: 10, seed: "" };
    const settings = toLobbySettings(choices);
    expect(settings.game).not.toHaveProperty("seed");
    expect(LobbySettingsSchema.safeParse(settings).success).toBe(true);
    expect(toLobbySettings({ ...choices, seed: "123" }).game?.seed).toBe(123);
  });
});

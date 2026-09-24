import { describe, expect, it } from "vitest";
import { dist, TICK_RATE } from "@deduction/shared";
import { boxFits } from "@deduction/maps";
import { checkInvariants } from "@deduction/engine";
import { crewIds, eventsOf, newMatch, place, player, scatter, step, stepUntil } from "./helpers";

describe("movement", () => {
  it("direction intent moves at playerSpeed, and diagonals are not faster", () => {
    const m = newMatch();
    const [a, b] = crewIds(m) as [string, string];
    scatter(m, [a, b]);
    place(m, a, { x: 40.5, y: 34.5 });
    place(m, b, { x: 40.5, y: 37.5 });
    m.setMoveIntent(a, { mode: "direction", dir: { x: 1, y: 0 } });
    m.setMoveIntent(b, { mode: "direction", dir: { x: 1, y: -1 } });
    step(m, TICK_RATE);
    const speed = m.state.settings.playerSpeed;
    expect(dist(player(m, a).pos, { x: 40.5, y: 34.5 })).toBeCloseTo(speed, 6);
    expect(dist(player(m, b).pos, { x: 40.5, y: 37.5 })).toBeCloseTo(speed, 6);
    expect(m.observe(a).self.activity).toBe("moving");
    // Non-finite input is ignored.
    m.setMoveIntent(a, { mode: "direction", dir: { x: Number.NaN, y: 0 } });
    expect(player(m, a).moveIntent).toEqual({ mode: "direction", dir: { x: 1, y: 0 } });
  });

  it("walls stop movement and the player box never overlaps a wall", () => {
    const m = newMatch();
    const [a] = crewIds(m) as [string];
    scatter(m, [a]);
    place(m, a, { x: 40.5, y: 27.5 });
    m.setMoveIntent(a, { mode: "direction", dir: { x: 0, y: -1 } }); // into the Commons' north wall
    step(m, 60);
    const p = player(m, a);
    expect(p.pos.y).toBeGreaterThan(26);
    expect(boxFits(m.map, p.pos)).toBe(true);
    expect(p.roomId).toBe("commons");
    expect(checkInvariants(m.state, m.map)).toEqual([]);
  });

  it("path intent reaches a far station, emitting room changes on the way", () => {
    const m = newMatch();
    const [a] = crewIds(m) as [string];
    const target = m.map.taskStationById.get("reactor_pattern")!.pos;
    m.setMoveIntent(a, { mode: "path", target });
    stepUntil(m, () => player(m, a).route?.arrived === true, 3_000);
    expect(dist(player(m, a).pos, target)).toBeLessThan(m.state.settings.useRange);
    expect(player(m, a).roomId).toBe("reactor");
    // Every room change follows a doorway of the room graph, starting in the Commons and ending in the Reactor.
    const entered = eventsOf(m, "PLAYER_ENTERED_ROOM").filter((e) => e.playerId === a);
    expect(entered.at(-1)?.roomId).toBe("reactor");
    expect(entered[0]?.fromRoomId).toBe("commons");
    for (const e of entered) expect(m.map.adjacency.get(e.fromRoomId!), `${e.fromRoomId} -> ${e.roomId}`).toContain(e.roomId);
  });

  // Regression: the route follower used to get stuck on a wall corner here and mark the route unreachable.
  it("path intent from an off-centre start reaches its target", () => {
    const m = newMatch();
    const [a] = crewIds(m) as [string];
    scatter(m, [a]);
    place(m, a, { x: 84.62353530107066, y: 35.93795475852676 }); // Life Support, low in its tile row
    const target = { x: 21.5, y: 35.5 }; // West Passage
    m.setMoveIntent(a, { mode: "path", target });
    stepUntil(m, () => player(m, a).route?.arrived === true || player(m, a).route?.unreachable === true, 3_000);
    expect(player(m, a).route?.unreachable).toBe(false);
    expect(dist(player(m, a).pos, target)).toBeLessThan(0.5);
  });
});

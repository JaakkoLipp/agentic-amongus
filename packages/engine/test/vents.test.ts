import { describe, expect, it } from "vitest";
import { dist, secondsToTicks } from "@deduction/shared";
import { hasLineOfSight } from "@deduction/maps";
import type { Match } from "@deduction/engine";
import {
  act,
  crewIds,
  eventsOf,
  expectOk,
  infiltratorIds,
  killNow,
  newMatch,
  perceived,
  place,
  player,
  scatter,
  step,
  stepToPerception,
} from "./helpers";

const NEAR_COMMONS_VENT = { x: 58.5, y: 27.5 }; // 1 tile from vent_commons (59.5, 27.5)
const visibleIds = (m: Match, id: string): string[] => m.observe(id, false).visiblePlayers.map((v) => v.id);

describe("vents", () => {
  it("infiltrator can vent: enter, move along a link, exit (hidden while inside, room updated)", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const [commonsWatcher, cargoWatcher] = crewIds(m) as [string, string];
    scatter(m, [inf, commonsWatcher, cargoWatcher]);
    const cooldown = secondsToTicks(m.state.settings.ventCooldownSec);
    const ventCommons = m.map.ventById.get("vent_commons")!;
    const ventCargo = m.map.ventById.get("vent_cargo")!;
    place(m, inf, NEAR_COMMONS_VENT);
    place(m, commonsWatcher, { x: 54.5, y: 27.5 });
    place(m, cargoWatcher, { x: 52.5, y: 55.5 }); // Cargo Bay, in sight of vent_cargo
    stepToPerception(m);
    m.observe(cargoWatcher);

    expect(m.observe(inf).legal.ventEnter).toBe("vent_commons");
    expectOk(act(m, inf, { type: "ENTER_VENT", ventId: "vent_commons" }));
    const I = player(m, inf);
    expect(I.ventId).toBe("vent_commons");
    expect(I.pos).toEqual(ventCommons.pos);
    expect(visibleIds(m, commonsWatcher)).not.toContain(inf);
    let self = m.observe(inf);
    expect(self.self.inVentId).toBe("vent_commons");
    expect(self.legal.move).toBe(false);
    expect(self.legal.ventMove).toEqual([]); // vent cooldown
    expect(act(m, inf, { type: "MOVE_VENT", toVentId: "vent_cargo" })).toEqual({ ok: false, reason: "cooldown" });
    // Moving intents do nothing while inside.
    m.setMoveIntent(inf, { mode: "direction", dir: { x: -1, y: 0 } });
    step(m, cooldown);
    expect(I.pos).toEqual(ventCommons.pos);

    self = m.observe(inf);
    expect(self.legal.ventMove).toEqual(["vent_cargo"]);
    expect(self.legal.ventExit).toBe(true);
    expectOk(act(m, inf, { type: "MOVE_VENT", toVentId: "vent_cargo" }));
    expect(I.ventId).toBe("vent_cargo");
    expect(I.pos).toEqual(ventCargo.pos);
    expect(I.roomId).toBe("cargo");
    expect(dist(player(m, cargoWatcher).pos, I.pos)).toBeLessThan(m.state.settings.crewVision);
    expect(visibleIds(m, cargoWatcher)).not.toContain(inf); // still hidden at the destination
    expect(perceived(m.observe(inf).events, "OWN_VENT_MOVE")).toEqual([
      expect.objectContaining({ fromVentId: "vent_commons", toVentId: "vent_cargo" }),
    ]);
    // Vent travel itself is unseen: nobody else hears about the move.
    stepToPerception(m);
    expect(m.observe(cargoWatcher).events.filter((e) => "playerId" in e && e.playerId === inf)).toEqual([]);

    step(m, cooldown);
    m.setMoveIntent(inf, { mode: "stop" });
    expectOk(act(m, inf, { type: "EXIT_VENT" }));
    expect(I.ventId).toBeNull();
    expect(I.roomId).toBe("cargo");
    expect(visibleIds(m, cargoWatcher)).toContain(inf);
    const exited = eventsOf(m, "VENT_EXITED")[0]!;
    expect(exited.witnesses).toContain(cargoWatcher);
    expect(exited.witnesses).not.toContain(commonsWatcher);
    stepToPerception(m);
    const cargoEvents = m.observe(cargoWatcher).events;
    expect(perceived(cargoEvents, "SAW_VENT")).toEqual([expect.objectContaining({ playerId: inf, ventId: "vent_cargo", action: "exit", roomId: "cargo" })]);
    expect(perceived(cargoEvents, "PLAYER_BECAME_VISIBLE").map((e) => e.playerId)).toContain(inf);
    // No room events were emitted for the trip through the vents.
    expect(eventsOf(m, "PLAYER_LEFT_ROOM").filter((e) => e.playerId === inf)).toEqual([]);
  });

  it("crew player cannot vent", () => {
    const m = newMatch();
    const [crew] = crewIds(m) as [string];
    place(m, crew, NEAR_COMMONS_VENT);
    expect(act(m, crew, { type: "ENTER_VENT", ventId: "vent_commons" })).toEqual({ ok: false, reason: "wrong_role" });
    expect(act(m, crew, { type: "MOVE_VENT", toVentId: "vent_cargo" })).toEqual({ ok: false, reason: "not_in_vent" });
    expect(act(m, crew, { type: "EXIT_VENT" })).toEqual({ ok: false, reason: "not_in_vent" });
    expect(m.observe(crew).legal.ventEnter).toBeNull();
    expect(player(m, crew).ventId).toBeNull();
  });

  it("a dead infiltrator cannot vent, and venting needs the use range", () => {
    const m = newMatch();
    const [inf, mate] = infiltratorIds(m) as [string, string];
    place(m, inf, { x: 56.5, y: 27.5 }); // 3 tiles from the vent
    expect(act(m, inf, { type: "ENTER_VENT", ventId: "vent_commons" })).toEqual({ ok: false, reason: "out_of_range" });
    expect(act(m, inf, { type: "ENTER_VENT", ventId: "vent_nowhere" })).toEqual({ ok: false, reason: "invalid_target" });
    // Infiltrators can only die by ejection; simulate that outcome directly (setup).
    const p = player(m, mate);
    p.alive = false;
    p.deathCause = "ejected";
    p.deathTick = m.tick;
    place(m, mate, NEAR_COMMONS_VENT);
    expect(act(m, mate, { type: "ENTER_VENT", ventId: "vent_commons" })).toEqual({ ok: false, reason: "dead" });
  });

  it("cannot move to a non-linked vent", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    place(m, inf, NEAR_COMMONS_VENT);
    expectOk(act(m, inf, { type: "ENTER_VENT", ventId: "vent_commons" }));
    step(m, secondsToTicks(m.state.settings.ventCooldownSec));
    expect(m.map.ventLinks.get("vent_commons")).toEqual(["vent_cargo"]);
    for (const toVentId of ["vent_reactor", "vent_hydroponics", "vent_commons", "vent_nowhere"]) {
      expect(act(m, inf, { type: "MOVE_VENT", toVentId }), toVentId).toEqual({ ok: false, reason: "invalid_target" });
    }
    expect(player(m, inf).ventId).toBe("vent_commons");
    // Two hops along links are fine.
    expectOk(act(m, inf, { type: "MOVE_VENT", toVentId: "vent_cargo" }));
    step(m, secondsToTicks(m.state.settings.ventCooldownSec));
    expectOk(act(m, inf, { type: "MOVE_VENT", toVentId: "vent_hydroponics" }));
    expect(player(m, inf).roomId).toBe("hydroponics");
  });

  it("entering is witnessed by players who can see the vent", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const [near, behindWall, farAway, ghost] = crewIds(m) as [string, string, string, string];
    scatter(m, [inf, near, behindWall, farAway, ghost]);
    killNow(m, inf, ghost, { x: 40.5, y: 38.5 });
    place(m, inf, NEAR_COMMONS_VENT);
    place(m, near, { x: 54.5, y: 27.5 }); // 4 tiles, open floor
    place(m, behindWall, { x: 58.5, y: 22.5 }); // North Hall, 5 tiles, wall rows 24-25 in between
    place(m, farAway, { x: 40.5, y: 42.5 }); // same room, out of range
    place(m, ghost, { x: 56.5, y: 28.5 }); // a ghost next to the vent also sees it
    expect(hasLineOfSight(m.map, player(m, behindWall).pos, NEAR_COMMONS_VENT)).toBe(false);
    stepToPerception(m);
    for (const id of [near, behindWall, farAway, ghost]) m.observe(id);

    expectOk(act(m, inf, { type: "ENTER_VENT", ventId: "vent_commons" }));
    const entered = eventsOf(m, "VENT_ENTERED")[0]!;
    expect([...entered.witnesses].sort()).toEqual([ghost, near].sort());
    expect(perceived(m.observe(near).events, "SAW_VENT")).toEqual([
      expect.objectContaining({ playerId: inf, ventId: "vent_commons", roomId: "commons", action: "enter" }),
    ]);
    for (const id of [behindWall, farAway]) expect(perceived(m.observe(id).events, "SAW_VENT"), id).toEqual([]);
  });
});

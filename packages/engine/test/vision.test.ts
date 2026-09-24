import { describe, expect, it } from "vitest";
import { dist } from "@deduction/shared";
import { hasLineOfSight } from "@deduction/maps";
import { canSeePlayer, type Match } from "@deduction/engine";
import { act, crewIds, expectOk, infiltratorIds, killNow, newMatch, place, player, scatter, stepToPerception } from "./helpers";

const visibleIds = (match: Match, id: string): string[] => match.observe(id, false).visiblePlayers.map((v) => v.id);

describe("vision", () => {
  it("player cannot see through walls", () => {
    const m = newMatch();
    const [a, behindWall, inRoom] = crewIds(m) as [string, string, string];
    const [inf] = infiltratorIds(m) as [string];
    scatter(m, [a, behindWall, inRoom, inf]);
    place(m, a, { x: 40.5, y: 27.5 }); // Commons, north-west corner
    place(m, behindWall, { x: 40.5, y: 22.5 }); // North Hall: 5 tiles away, wall rows 24-25 in between
    place(m, inRoom, { x: 45.5, y: 27.5 }); // Commons: 5 tiles away, open floor
    place(m, inf, { x: 40.5, y: 21.5 }); // North Hall: 6 tiles away, behind the wall (infiltrator vision 9)

    expect(dist(player(m, a).pos, player(m, behindWall).pos)).toBeLessThan(m.state.settings.crewVision);
    expect(hasLineOfSight(m.map, player(m, a).pos, player(m, behindWall).pos)).toBe(false);

    stepToPerception(m);
    expect(visibleIds(m, a)).toContain(inRoom);
    expect(visibleIds(m, a)).not.toContain(behindWall);
    expect(visibleIds(m, a)).not.toContain(inf);
    // Occlusion is symmetric, and a longer vision radius does not help.
    expect(visibleIds(m, behindWall)).not.toContain(a);
    expect(visibleIds(m, inf)).not.toContain(a);
    expect(visibleIds(m, inf)).toContain(behindWall);
  });

  it("player cannot see beyond vision range (infiltrator vision 9 > crew 7 at the same distance)", () => {
    const m = newMatch();
    const [crew, target] = crewIds(m) as [string, string];
    const [inf] = infiltratorIds(m) as [string];
    scatter(m, [crew, target, inf]);
    place(m, target, { x: 48.5, y: 34.5 });
    place(m, crew, { x: 40.5, y: 34.5 }); // 8 tiles west, open floor
    place(m, inf, { x: 56.5, y: 34.5 }); // 8 tiles east, open floor

    const crewObs = m.observe(crew);
    const infObs = m.observe(inf);
    expect(crewObs.self.visionRadius).toBe(7);
    expect(infObs.self.visionRadius).toBe(9);
    expect(crewObs.visiblePlayers.map((v) => v.id)).not.toContain(target);
    expect(infObs.visiblePlayers.map((v) => v.id)).toContain(target);

    // Inside crew range the crew member sees the target too.
    place(m, crew, { x: 42.5, y: 34.5 }); // 6 tiles
    expect(visibleIds(m, crew)).toContain(target);
    // Beyond infiltrator range the infiltrator does not.
    place(m, inf, { x: 58.5, y: 34.5 }); // 10 tiles
    expect(visibleIds(m, inf)).not.toContain(target);
    // Out-of-range players are absent from the perceived stream as well.
    stepToPerception(m);
    expect(m.observe(inf).events.filter((e) => e.type === "PLAYER_BECAME_VISIBLE" && e.playerId === target)).toEqual([]);
  });

  it("lights sabotage reduces crew visibility but not infiltrator visibility", () => {
    const m = newMatch();
    const [crew, target] = crewIds(m) as [string, string];
    const [inf] = infiltratorIds(m) as [string];
    scatter(m, [crew, target, inf]);
    place(m, target, { x: 48.5, y: 34.5 });
    place(m, crew, { x: 44.5, y: 34.5 }); // 4 tiles
    place(m, inf, { x: 52.5, y: 34.5 }); // 4 tiles

    expect(visibleIds(m, crew)).toContain(target);
    expect(visibleIds(m, inf)).toContain(target);

    m.state.sabotageReadyAtTick = m.tick; // setup: skip the initial sabotage cooldown
    expectOk(act(m, inf, { type: "SABOTAGE", kind: "lights" }));

    const s = m.state.settings;
    const crewObs = m.observe(crew);
    expect(crewObs.self.visionRadius).toBeCloseTo(s.crewVision * s.lightsVisionFactor, 6);
    expect(crewObs.visiblePlayers.map((v) => v.id)).not.toContain(target);
    const infObs = m.observe(inf);
    expect(infObs.self.visionRadius).toBe(s.infiltratorVision);
    expect(infObs.visiblePlayers.map((v) => v.id)).toContain(target);

    // Up close the crew member still sees.
    place(m, crew, { x: 46.5, y: 34.5 }); // 2 tiles < 2.45
    expect(visibleIds(m, crew)).toContain(target);
  });

  describe("invisible players", () => {
    it("a player inside a vent is not in visiblePlayers (not even for a teammate)", () => {
      const m = newMatch();
      const [inf, mate] = infiltratorIds(m) as [string, string];
      const [crew] = crewIds(m) as [string];
      scatter(m, [inf, mate, crew]);
      place(m, inf, { x: 58.5, y: 27.5 }); // 1 tile from vent_commons (59.5, 27.5)
      place(m, crew, { x: 54.5, y: 27.5 });
      place(m, mate, { x: 55.5, y: 28.5 });
      expect(visibleIds(m, crew)).toContain(inf);
      expect(visibleIds(m, mate)).toContain(inf);

      expectOk(act(m, inf, { type: "ENTER_VENT", ventId: "vent_commons" }));
      expect(visibleIds(m, crew)).not.toContain(inf);
      expect(visibleIds(m, mate)).not.toContain(inf);
      expect(canSeePlayer(m.state, m.map, player(m, crew), player(m, inf))).toBe(false);
      expect(m.observe(inf, false).self.inVentId).toBe("vent_commons");

      // The next visibility update tells the watchers the player vanished from where they last saw them.
      stepToPerception(m);
      const left = m.observe(crew).events.filter((e) => e.type === "PLAYER_LEFT_VISIBILITY" && e.playerId === inf);
      expect(left).toHaveLength(1);
    });

    it("a ghost is not visible to the living, but ghosts see each other (and the living)", () => {
      const m = newMatch();
      const [inf] = infiltratorIds(m) as [string];
      const [ghostA, ghostB, living] = crewIds(m) as [string, string, string];
      scatter(m, [inf, ghostA, ghostB, living]);
      killNow(m, inf, ghostA, { x: 44.5, y: 37.5 });
      killNow(m, inf, ghostB, { x: 52.5, y: 37.5 });

      place(m, ghostA, { x: 46.5, y: 33.5 });
      place(m, ghostB, { x: 47.5, y: 33.5 });
      place(m, living, { x: 47.5, y: 34.5 }); // 1 tile from both ghosts
      stepToPerception(m);

      const livingObs = m.observe(living);
      expect(livingObs.visiblePlayers.map((v) => v.id)).not.toContain(ghostA);
      expect(livingObs.visiblePlayers.map((v) => v.id)).not.toContain(ghostB);
      expect(livingObs.visiblePlayers.map((v) => v.id)).toContain(inf);
      expect(livingObs.visiblePlayers.every((v) => !v.ghost)).toBe(true);

      const aObs = m.observe(ghostA);
      const seenB = aObs.visiblePlayers.find((v) => v.id === ghostB);
      expect(seenB?.ghost).toBe(true);
      expect(aObs.visiblePlayers.find((v) => v.id === living)?.ghost).toBe(false);
      expect(m.observe(ghostB).visiblePlayers.find((v) => v.id === ghostA)?.ghost).toBe(true);
    });
  });
});

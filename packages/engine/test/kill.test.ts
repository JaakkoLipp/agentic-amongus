import { describe, expect, it } from "vitest";
import { dist, secondsToTicks } from "@deduction/shared";
import { hasLineOfSight } from "@deduction/maps";
import {
  act,
  armKill,
  crewIds,
  eventsOf,
  expectOk,
  infiltratorIds,
  newMatch,
  perceived,
  place,
  player,
  scatter,
  step,
} from "./helpers";

describe("kill", () => {
  it("crew player cannot kill (wrong_role)", () => {
    const m = newMatch();
    const [a, b] = crewIds(m) as [string, string];
    const [inf] = infiltratorIds(m) as [string];
    place(m, a, { x: 46.5, y: 35.5 });
    place(m, b, { x: 47.5, y: 35.5 });
    place(m, inf, { x: 46.5, y: 36.5 });
    step(m, secondsToTicks(m.state.settings.initialKillCooldownSec) + 1);
    expect(act(m, a, { type: "KILL", targetId: b })).toEqual({ ok: false, reason: "wrong_role" });
    expect(act(m, a, { type: "KILL", targetId: inf })).toEqual({ ok: false, reason: "wrong_role" });
    expect(m.observe(a, false).legal.kill).toEqual([]);
    expect(player(m, b).alive && player(m, inf).alive).toBe(true);
    expect(perceived(m.observe(a).events, "ACTION_REJECTED").map((e) => e.reason)).toEqual(["wrong_role", "wrong_role"]);
  });

  it("kill fails outside range (out_of_range) and through walls (no_line_of_sight)", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const [victim] = crewIds(m) as [string];
    scatter(m, [inf, victim]);
    armKill(m, inf);
    const range = m.state.settings.killRange;

    place(m, inf, { x: 44.5, y: 35.5 });
    place(m, victim, { x: 46.5, y: 35.5 }); // 2.0 > 1.6
    expect(act(m, inf, { type: "KILL", targetId: victim })).toEqual({ ok: false, reason: "out_of_range" });
    expect(m.observe(inf).legal.kill).toEqual([]);

    // Diagonal across the corner of a Commons table (obstacle tiles x42-45, y29-30).
    place(m, inf, { x: 41.6, y: 29.6 });
    place(m, victim, { x: 42.5, y: 28.6 });
    expect(dist(player(m, inf).pos, player(m, victim).pos)).toBeLessThan(range);
    expect(hasLineOfSight(m.map, player(m, inf).pos, player(m, victim).pos)).toBe(false);
    // A target behind a wall is not visible, so it is indistinguishable from any other invalid target.
    expect(act(m, inf, { type: "KILL", targetId: victim })).toEqual({ ok: false, reason: "invalid_target" });

    // Diagonal across the wall corner of the Commons north doorway (wall tile 47,25).
    place(m, inf, { x: 47.6, y: 26.3 });
    place(m, victim, { x: 48.5, y: 25.4 });
    expect(dist(player(m, inf).pos, player(m, victim).pos)).toBeLessThan(range);
    expect(hasLineOfSight(m.map, player(m, inf).pos, player(m, victim).pos)).toBe(false);
    // A target behind a wall is not visible, so it is indistinguishable from any other invalid target.
    expect(act(m, inf, { type: "KILL", targetId: victim })).toEqual({ ok: false, reason: "invalid_target" });
    expect(m.observe(inf).legal.kill).toEqual([]);
    expect(player(m, victim).alive).toBe(true);

    // In range with line of sight it works.
    place(m, inf, { x: 44.9, y: 35.5 });
    place(m, victim, { x: 46.4, y: 35.5 }); // 1.5
    expect(m.observe(inf, false).legal.kill).toEqual([victim]);
    expect(act(m, inf, { type: "KILL", targetId: victim })).toEqual({ ok: true });
  });

  it("kill obeys the initial cooldown, then the cooldown after a successful kill", () => {
    const m = newMatch();
    const [inf] = infiltratorIds(m) as [string];
    const [v1, v2] = crewIds(m) as [string, string];
    const s = m.state.settings;
    place(m, inf, { x: 46.5, y: 35.5 });
    place(m, v1, { x: 47.5, y: 35.5 });

    expect(act(m, inf, { type: "KILL", targetId: v1 })).toEqual({ ok: false, reason: "cooldown" });
    const ready = secondsToTicks(s.initialKillCooldownSec);
    expect(m.observe(inf, false).self.killCooldownTicks).toBe(ready);
    step(m, ready - 1);
    expect(act(m, inf, { type: "KILL", targetId: v1 })).toEqual({ ok: false, reason: "cooldown" });
    step(m, 1);
    expect(m.tick).toBe(ready);
    expect(act(m, inf, { type: "KILL", targetId: v1 })).toEqual({ ok: true });

    const killTick = m.tick;
    place(m, v2, { x: 47.5, y: 36.5 });
    expect(act(m, inf, { type: "KILL", targetId: v2 })).toEqual({ ok: false, reason: "cooldown" });
    expect(m.observe(inf, false).self.killCooldownTicks).toBe(secondsToTicks(s.killCooldownSec));
    step(m, secondsToTicks(s.killCooldownSec) - 1);
    expect(act(m, inf, { type: "KILL", targetId: v2 })).toEqual({ ok: false, reason: "cooldown" });
    step(m, 1);
    expect(m.tick - killTick).toBe(secondsToTicks(s.killCooldownSec));
    expect(act(m, inf, { type: "KILL", targetId: v2 })).toEqual({ ok: true });
  });

  it("infiltrators cannot kill each other (or themselves, or the dead)", () => {
    const m = newMatch();
    const [a, b] = infiltratorIds(m) as [string, string];
    const [crew] = crewIds(m) as [string];
    scatter(m, [a, b, crew]);
    place(m, a, { x: 46.5, y: 35.5 });
    place(m, b, { x: 47.5, y: 35.5 });
    place(m, crew, { x: 46.5, y: 36.5 });
    armKill(m, a);
    armKill(m, b);
    expect(act(m, a, { type: "KILL", targetId: b })).toEqual({ ok: false, reason: "invalid_target" });
    expect(act(m, b, { type: "KILL", targetId: a })).toEqual({ ok: false, reason: "invalid_target" });
    expect(act(m, a, { type: "KILL", targetId: a })).toEqual({ ok: false, reason: "invalid_target" });
    expect(m.observe(a).legal.kill).toEqual([crew]);
    expectOk(act(m, a, { type: "KILL", targetId: crew }));
    expect(act(m, b, { type: "KILL", targetId: crew })).toEqual({ ok: false, reason: "invalid_target" });
    expect(player(m, a).alive && player(m, b).alive).toBe(true);
  });

  it("a kill creates a body at the victim position, the victim becomes a ghost, and witnesses match who could see it", () => {
    const m = newMatch();
    const [killer] = infiltratorIds(m) as [string];
    const [victim, w1, w2, occluded, tooFar] = crewIds(m) as [string, string, string, string, string];
    scatter(m, [killer, victim, w1, w2, occluded, tooFar]);
    const at = { x: 46.5, y: 38.5 };
    place(m, victim, at);
    place(m, killer, { x: 47.5, y: 38.5 });
    place(m, w1, { x: 41.5, y: 38.5 }); // 5 tiles, open floor
    place(m, w2, { x: 46.5, y: 33.5 }); // 5 tiles, open floor
    place(m, occluded, { x: 44.5, y: 42.5 }); // within range, behind the table at x42-45, y40-41
    place(m, tooFar, { x: 58.5, y: 31.5 }); // same room, out of range
    const vision = m.state.settings.crewVision;
    expect(dist(player(m, occluded).pos, at)).toBeLessThan(vision);
    expect(hasLineOfSight(m.map, player(m, occluded).pos, at)).toBe(false);
    expect(dist(player(m, tooFar).pos, at)).toBeGreaterThan(vision);

    // Independent expectation from geometry: everyone (other than killer and victim) in range with line of sight.
    const expected = m.state.players
      .filter((p) => p.id !== killer && p.id !== victim)
      .filter((p) => {
        const r = p.role === "infiltrator" ? m.state.settings.infiltratorVision : vision;
        return dist(p.pos, at) <= r && hasLineOfSight(m.map, p.pos, at);
      })
      .map((p) => p.id)
      .sort();
    expect(expected).toEqual([w1, w2].sort());

    armKill(m, killer);
    expectOk(act(m, killer, { type: "KILL", targetId: victim }));
    const ev = eventsOf(m, "PLAYER_KILLED")[0]!;
    expect([...ev.witnesses].sort()).toEqual(expected);
    expect(ev).toMatchObject({ killerId: killer, victimId: victim, pos: at, roomId: "commons" });

    const v = player(m, victim);
    expect(v.alive).toBe(false);
    expect(v.deathCause).toBe("killed");
    expect(v.deathTick).toBe(m.tick);
    expect(m.state.bodies).toHaveLength(1);
    expect(m.state.bodies[0]).toMatchObject({ id: ev.bodyId, victimId: victim, killerId: killer, pos: at, roomId: "commons", reported: false });
    expect(player(m, killer).pos).toEqual(at); // the killer snaps onto the body

    for (const w of [w1, w2]) {
      const obs = m.observe(w);
      expect(perceived(obs.events, "SAW_KILL")).toEqual([expect.objectContaining({ killerId: killer, victimId: victim, bodyId: ev.bodyId })]);
      expect(obs.roster.find((r) => r.id === victim)?.knownStatus).toBe("dead");
    }
    for (const n of [occluded, tooFar]) {
      const obs = m.observe(n);
      expect(perceived(obs.events, "SAW_KILL")).toEqual([]);
      expect(obs.roster.find((r) => r.id === victim)?.knownStatus).toBe("alive");
    }
    const ghost = m.observe(victim);
    expect(ghost.self.alive).toBe(false);
    expect(perceived(ghost.events, "WAS_KILLED")).toEqual([expect.objectContaining({ killerId: killer })]);
    // The ghost keeps moving but can no longer be killed or be seen by the living.
    expect(act(m, killer, { type: "KILL", targetId: victim }).ok).toBe(false);
    expect(m.observe(w1).visiblePlayers.map((p) => p.id)).not.toContain(victim);
  });

  it("the killer knows its victim is dead right away (no self-discovery of its own body)", () => {
    const m = newMatch();
    const [killer] = infiltratorIds(m) as [string];
    const [victim] = crewIds(m) as [string];
    scatter(m, [killer, victim]);
    place(m, victim, { x: 46.5, y: 35.5 });
    place(m, killer, { x: 47.5, y: 35.5 });
    armKill(m, killer);
    expectOk(act(m, killer, { type: "KILL", targetId: victim }));
    const obs = m.observe(killer);
    expect(obs.visibleBodies.map((b) => b.victimId)).toEqual([victim]);
    expect(obs.roster.find((r) => r.id === victim)?.knownStatus).toBe("dead");
    step(m, 3);
    expect(perceived(m.observe(killer).events, "SAW_BODY")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { ARCHETYPES } from "@deduction/ai";
import { crewIds, infiltratorIds, memoryFor, newMatch, place, scatter, seconds, step } from "./helpers";

describe("agent memory", () => {
  it("last-known locations stop updating outside vision", () => {
    const match = newMatch();
    scatter(match);
    const [observer, target] = crewIds(match) as [string, string];
    const memory = memoryFor(match, observer);
    place(match, observer, { x: 46, y: 35 });
    place(match, target, { x: 49, y: 35 });
    step(match, 3);
    memory.update(match.observe(observer));
    expect(memory.lastKnown.get(target)).toMatchObject({ pos: { x: 49, y: 35 }, roomId: "commons", visibleNow: true });

    // Target walks behind walls, far away. The memory keeps the last sighting.
    place(match, target, { x: 8, y: 60 });
    step(match, 3);
    memory.update(match.observe(observer));
    const lk = memory.lastKnown.get(target)!;
    expect(lk.visibleNow).toBe(false);
    expect(lk.pos).toEqual({ x: 49, y: 35 });
    expect(lk.roomId).toBe("commons");

    place(match, target, { x: 90, y: 10 });
    step(match, 30);
    memory.update(match.observe(observer));
    expect(memory.lastKnown.get(target)!.pos).toEqual({ x: 49, y: 35 });
  });

  it("witnessing a kill makes the killer maximally suspicious and the victim known dead", () => {
    const match = newMatch();
    scatter(match);
    const killer = infiltratorIds(match)[0]!;
    const [victim, witness] = crewIds(match) as [string, string];
    const memory = memoryFor(match, witness);
    place(match, killer, { x: 46, y: 35 });
    place(match, victim, { x: 47, y: 35 });
    place(match, witness, { x: 50, y: 37 });
    match.state.players.find((p) => p.id === killer)!.killReadyAtTick = 0;
    expect(match.submitAction(killer, { type: "KILL", targetId: victim })).toEqual({ ok: true });
    step(match, 3);
    const update = memory.update(match.observe(witness));
    expect(update.triggers).toContain("kill_witnessed");
    expect(update.invalidates).toBe(true);
    expect(memory.belief(killer)!.suspicion).toBe(1);
    expect(memory.isKnownDead(victim)).toBe(true);
    expect(memory.witnessedKills).toHaveLength(1);
  });

  it("a crew member who did not witness anything learns nothing about the kill", () => {
    const match = newMatch();
    scatter(match);
    const killer = infiltratorIds(match)[0]!;
    const [victim, bystander] = crewIds(match) as [string, string];
    const memory = memoryFor(match, bystander);
    place(match, killer, { x: 46, y: 35 });
    place(match, victim, { x: 47, y: 35 });
    match.state.players.find((p) => p.id === killer)!.killReadyAtTick = 0;
    match.submitAction(killer, { type: "KILL", targetId: victim });
    step(match, 3);
    memory.update(match.observe(bystander));
    expect(memory.isKnownDead(victim)).toBe(false);
    expect(memory.witnessedKills).toHaveLength(0);
    expect(memory.belief(killer)!.suspicion).toBeLessThan(0.5);
  });

  it("personality scales suspicion updates (paranoid > cautious)", () => {
    const match = newMatch();
    const [a, target] = crewIds(match) as [string, string];
    const paranoid = memoryFor(match, a, ARCHETYPES.paranoid.traits);
    const cautious = memoryFor(match, a, ARCHETYPES.cautious.traits);
    for (const m of [paranoid, cautious]) {
      m.update(match.observe(a, false));
      m.adjust(target, 0.2, 0, "test evidence");
    }
    expect(paranoid.belief(target)!.suspicion).toBeGreaterThan(cautious.belief(target)!.suspicion);
    expect(paranoid.beliefTimeline.at(-1)?.reason).toBe("test evidence");
  });

  it("low-value memories decay while critical ones persist", () => {
    const match = newMatch();
    const id = crewIds(match)[0]!;
    const memory = memoryFor(match, id);
    memory.update(match.observe(id, false));
    memory.remember(0, "low", "movement", "saw someone walk by", [], null);
    memory.remember(0, "critical", "vent", "saw someone vent", [], null);
    memory.tick = seconds(60 * 20);
    memory.prune();
    expect(memory.episodic.map((m) => m.kind)).toEqual(["vent"]);
  });

  it("an accusation from a trusted speaker raises suspicion; accusing me as crew raises suspicion of the accuser", () => {
    const match = newMatch({ meeting: { revealSec: 0, statementsSec: 30, discussionSec: 0, finalStatementsSec: 0, votingSec: 5, resultSec: 0 } });
    const [listener, accuser, accused] = crewIds(match) as [string, string, string];
    const memory = memoryFor(match, listener);
    memory.update(match.observe(listener));
    const before = memory.belief(accused)!.suspicion;
    const accuserBefore = memory.belief(accuser)!.suspicion;
    const caller = match.state.players.find((p) => p.id === accuser)!;
    place(match, accuser, match.map.def.emergencyButton.pos);
    match.state.emergencyReadyAtTick = 0;
    expect(match.submitAction(caller.id, { type: "CALL_EMERGENCY" })).toEqual({ ok: true });
    step(match, 2);
    const name = (id: string) => match.state.players.find((p) => p.id === id)!.name;
    expect(match.submitAction(accuser, { type: "SPEAK", text: `${name(accused)} is sus, I saw them fake a task` })).toEqual({ ok: true });
    step(match, seconds(3));
    expect(match.submitAction(accuser, { type: "SPEAK", text: `${name(listener)} is lying` })).toEqual({ ok: true });
    memory.update(match.observe(listener));
    expect(memory.belief(accused)!.suspicion).toBeGreaterThan(before);
    expect(memory.belief(accuser)!.suspicion).toBeGreaterThan(accuserBefore);
    expect(memory.social.filter((s) => s.channel === "meeting")).toHaveLength(2);
  });
});

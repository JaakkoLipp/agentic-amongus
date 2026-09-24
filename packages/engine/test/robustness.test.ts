import { describe, expect, it } from "vitest";
import type { PlayerAction } from "@deduction/shared";
import { checkInvariants } from "@deduction/engine";
import { act, armKill, COMMONS, crewIds, eventsOf, infiltratorIds, killNow, newMatch, place, scatter } from "./helpers";

describe("robustness against untrusted input", () => {
  it("malformed in-process actions are rejected, never thrown", () => {
    const m = newMatch();
    const [id] = crewIds(m) as [string];
    const junk = [
      { type: "BOGUS" },
      { type: "SPEAK", text: 42 },
      { type: "KILL" },
      { type: "VOTE", target: null },
      null,
      "KILL red",
    ] as unknown as PlayerAction[];
    for (const action of junk) expect(act(m, id, action)).toEqual({ ok: false, reason: "malformed" });
    expect(eventsOf(m, "ACTION_REJECTED").every((e) => e.reason === "malformed")).toBe(true);
    expect(checkInvariants(m.state, m.map)).toEqual([]);
  });

  it("KILL rejections do not reveal whether an unseen crew member is still alive", () => {
    const m = newMatch();
    const [a, b] = infiltratorIds(m) as [string, string];
    const [victim, other] = crewIds(m) as [string, string];
    scatter(m);
    // Infiltrator A kills in the Commons; infiltrator B is far away and sees nothing.
    killNow(m, a, victim, COMMONS);
    armKill(m, b);
    place(m, b, { x: 8, y: 8 });
    const deadTarget = act(m, b, { type: "KILL", targetId: victim });
    const aliveTarget = act(m, b, { type: "KILL", targetId: other });
    expect(deadTarget).toEqual(aliveTarget);
    expect(deadTarget).toEqual({ ok: false, reason: "invalid_target" });
  });
});

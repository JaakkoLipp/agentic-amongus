import { describe, expect, it } from "vitest";
import { PLAYER_IDENTITIES, type RosterEntry } from "@deduction/shared";
import { getMap } from "@deduction/maps";
import { parseUtterance } from "@deduction/ai";

const roster: RosterEntry[] = PLAYER_IDENTITIES.slice(0, 10).map((p) => ({ id: p.id, name: p.name, color: p.color, knownStatus: "alive", knownRole: null }));
const map = getMap("outpost-kappa");

describe("parseUtterance (free-form meeting text, no command syntax)", () => {
  it("detects a question addressed to a player", () => {
    const s = parseUtterance("where were you red?", roster, map, "blue");
    expect(s.mentions).toEqual(["red"]);
    expect(s.isQuestion).toBe(true);
  });

  it("reads an accusation", () => {
    const s = parseUtterance("blue is lying", roster, map, "green");
    expect(s.accuses).toEqual(["blue"]);
    expect(s.defends).toEqual([]);
  });

  it("reads a vouch", () => {
    const s = parseUtterance("yellow can confirm me", roster, map, "green");
    expect(s.defends).toEqual(["yellow"]);
  });

  it("extracts rooms from sightings without treating them as accusations", () => {
    const s = parseUtterance("I saw purple leave electrical", roster, map, "green");
    expect(s.mentions).toEqual(["purple"]);
    expect(s.roomsMentioned).toContain("electrical");
    expect(s.accuses).toEqual([]);
  });

  it("recognizes skip", () => {
    expect(parseUtterance("skip", roster, map, "green").suggestsSkip).toBe(true);
  });

  it("flips stance after a negation and ignores the speaker's own name", () => {
    const s = parseUtterance("Red is not sus, I am Green", roster, map, "green");
    expect(s.defends).toEqual(["red"]);
    expect(s.mentions).not.toContain("green");
  });

  it("does not read compass directions as corridor names", () => {
    expect(parseUtterance("she went north", roster, map, null).roomsMentioned).toEqual([]);
  });
});

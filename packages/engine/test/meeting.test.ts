import { describe, expect, it } from "vitest";
import { MEETING_PHASES, secondsToTicks, type MeetingPhase, type PlayerId, type VoteTarget } from "@deduction/shared";
import { spawnPositions, tallyVotes, type Match } from "@deduction/engine";
import {
  act,
  callEmergency,
  COMMONS,
  crewIds,
  eventsOf,
  expectOk,
  FAST_MEETING,
  infiltratorIds,
  killNow,
  lastSeq,
  newMatch,
  perceived,
  place,
  player,
  scatter,
  smallMatch,
  step,
  stepToMeetingPhase,
  stepUntil,
  stepUntilPlaying,
} from "./helpers";

/** Run a meeting to its voting phase and cast the given votes (voter -> target). */
function vote(m: Match, votes: Readonly<Record<PlayerId, VoteTarget>>): void {
  stepToMeetingPhase(m, "voting");
  for (const [voter, target] of Object.entries(votes)) expectOk(act(m, voter, { type: "VOTE", target }), `VOTE ${voter}`);
}

/** 5 players: the infiltrator plus four crew, in seating order. */
function seats(m: Match): { inf: PlayerId; crew: [PlayerId, PlayerId, PlayerId, PlayerId] } {
  return { inf: infiltratorIds(m)[0]!, crew: crewIds(m) as [PlayerId, PlayerId, PlayerId, PlayerId] };
}

describe("meeting phases", () => {
  it("phases run reveal -> statements -> discussion -> final_statements -> voting -> result -> playing", () => {
    const timing = { revealSec: 0.5, statementsSec: 0.5, discussionSec: 0.5, finalStatementsSec: 0.5, votingSec: 5, resultSec: 0.5 };
    const m = smallMatch({ meeting: timing });
    const since = lastSeq(m);
    callEmergency(m, crewIds(m)[0]!);
    expect(m.state.meeting?.phase).toBe("reveal");

    const resting: (MeetingPhase | "playing")[] = [];
    while (m.state.phase === "meeting") {
      m.step();
      const phase = m.state.meeting?.phase ?? "playing";
      if (resting.at(-1) !== phase) resting.push(phase);
    }
    expect(resting).toEqual(["reveal", "statements", "discussion", "final_statements", "voting", "result", "playing"]);

    const changes = eventsOf(m, "MEETING_PHASE_CHANGED", since);
    expect(changes.map((e) => e.phase)).toEqual([...MEETING_PHASES]);
    const secs: Record<MeetingPhase, number> = {
      reveal: timing.revealSec,
      statements: timing.statementsSec,
      discussion: timing.discussionSec,
      final_statements: timing.finalStatementsSec,
      voting: timing.votingSec,
      result: timing.resultSec,
    };
    for (const e of changes) expect(e.endsAtTick - e.tick, e.phase).toBe(secondsToTicks(secs[e.phase]));
    // Nobody voted: the voting phase ran its full length, then the result was revealed and play resumed.
    const revealed = eventsOf(m, "VOTES_REVEALED", since);
    expect(revealed).toEqual([expect.objectContaining({ outcome: "no_votes", ejectedId: null })]);
    const ended = eventsOf(m, "MEETING_ENDED", since);
    expect(ended).toHaveLength(1);
    expect(ended[0]!.seq).toBeGreaterThan(revealed[0]!.seq);
    expect(m.state.phase).toBe("playing");
    expect(m.state.meeting).toBeNull();
  });

  it("zero-length phases are skipped", () => {
    const m = smallMatch({ meeting: FAST_MEETING }); // reveal, discussion, final_statements, result = 0 s
    callEmergency(m, crewIds(m)[0]!);
    const resting = new Set<string>();
    stepUntil(m, () => {
      if (m.state.meeting) resting.add(m.state.meeting.phase);
      return m.state.phase === "playing";
    });
    expect(resting.has("statements")).toBe(true);
    expect(resting.has("voting")).toBe(true);
    expect(resting.has("discussion")).toBe(false);
    expect(resting.has("final_statements")).toBe(false);
    // The phase order itself is preserved.
    const order = eventsOf(m, "MEETING_PHASE_CHANGED").map((e) => e.phase);
    expect(order.filter((p) => resting.has(p))).toEqual(MEETING_PHASES.filter((p) => resting.has(p)));
  });
});

describe("meeting speech and votes", () => {
  it("speech is only allowed in speech phases and only by living participants", () => {
    const timing = { revealSec: 1, statementsSec: 1, discussionSec: 1, finalStatementsSec: 1, votingSec: 5, resultSec: 1 };
    const m = newMatch({ meeting: timing, speechCooldownSec: 0 });
    const [inf] = infiltratorIds(m) as [string];
    const [victim, speaker, reporter, farAway] = crewIds(m) as [string, string, string, string];
    scatter(m, [inf, victim, speaker, reporter]);
    const kill = killNow(m, inf, victim, COMMONS);
    place(m, reporter, { x: COMMONS.x - 2, y: COMMONS.y });
    expectOk(act(m, reporter, { type: "REPORT_BODY", bodyId: kill.bodyId }));
    expect(m.state.meeting!.participants).not.toContain(victim);

    expect(m.state.meeting!.phase).toBe("reveal");
    expect(act(m, speaker, { type: "SPEAK", text: "too early" })).toEqual({ ok: false, reason: "wrong_phase" });
    expect(m.observe(speaker).legal.speak).toBe(false);

    for (const phase of ["statements", "discussion", "final_statements"] as const) {
      stepToMeetingPhase(m, phase);
      expect(m.observe(speaker, false).legal.speak, phase).toBe(true);
      expectOk(act(m, speaker, { type: "SPEAK", text: `hello in ${phase}` }), phase);
      expect(act(m, victim, { type: "SPEAK", text: "boo" }), phase).toEqual({ ok: false, reason: "dead" });
      expect(m.observe(victim, false).legal.speak).toBe(false);
    }
    stepToMeetingPhase(m, "voting");
    expect(act(m, speaker, { type: "SPEAK", text: "too late" })).toEqual({ ok: false, reason: "wrong_phase" });
    expect(act(m, speaker, { type: "SPEAK", text: "   \n\t " })).toEqual({ ok: false, reason: "malformed" });

    const messages = m.state.meeting!.messages;
    expect(messages.map((msg) => [msg.playerId, msg.text])).toEqual([
      [speaker, "hello in statements"],
      [speaker, "hello in discussion"],
      [speaker, "hello in final_statements"],
    ]);
    // Meeting messages reach everyone, even players who were far away when it started.
    expect(perceived(m.observe(farAway).events, "MEETING_MESSAGE")).toHaveLength(3);
  });

  it("meeting speech is rate limited", () => {
    const m = smallMatch({ meeting: { ...FAST_MEETING, statementsSec: 10 } });
    const [a] = crewIds(m) as [string];
    callEmergency(m, a);
    stepToMeetingPhase(m, "statements");
    expectOk(act(m, a, { type: "SPEAK", text: "one" }));
    expect(act(m, a, { type: "SPEAK", text: "two" })).toEqual({ ok: false, reason: "rate_limited" });
    step(m, secondsToTicks(m.state.settings.speechCooldownSec));
    expectOk(act(m, a, { type: "SPEAK", text: "two" }));
  });

  it("dead player cannot vote (and cannot be voted for)", () => {
    const m = smallMatch();
    const { inf, crew } = seats(m);
    const [victim, reporter] = crew;
    scatter(m, [inf, victim, reporter]);
    const kill = killNow(m, inf, victim, COMMONS);
    place(m, reporter, { x: COMMONS.x - 2, y: COMMONS.y });
    expectOk(act(m, reporter, { type: "REPORT_BODY", bodyId: kill.bodyId }));
    stepToMeetingPhase(m, "voting");
    expect(act(m, victim, { type: "VOTE", target: "skip" })).toEqual({ ok: false, reason: "dead" });
    expect(m.observe(victim).legal.vote).toEqual([]);
    expect(act(m, reporter, { type: "VOTE", target: victim })).toEqual({ ok: false, reason: "invalid_target" });
    expect(m.observe(reporter).legal.vote).not.toContain(victim);
    expect(m.state.meeting!.votes[victim]).toBeUndefined();
  });

  it("votes are final (and only allowed during voting)", () => {
    const m = smallMatch();
    const { inf, crew } = seats(m);
    callEmergency(m, crew[0]);
    expect(act(m, crew[0], { type: "VOTE", target: inf })).toEqual({ ok: false, reason: "wrong_phase" });
    stepToMeetingPhase(m, "voting");
    expect(m.observe(crew[0]).legal.vote).toEqual(["skip", ...m.state.meeting!.participants]);
    expectOk(act(m, crew[0], { type: "VOTE", target: inf }));
    expect(act(m, crew[0], { type: "VOTE", target: crew[1] })).toEqual({ ok: false, reason: "already_voted" });
    expect(act(m, crew[0], { type: "VOTE", target: "skip" })).toEqual({ ok: false, reason: "already_voted" });
    expect(m.state.meeting!.votes[crew[0]]).toBe(inf);
    expect(m.observe(crew[0]).legal.vote).toEqual([]);
    // Others only learn that a vote was cast, not for whom.
    const cast = perceived(m.observe(crew[1]).events, "VOTE_CAST");
    expect(cast).toEqual([expect.objectContaining({ voterId: crew[0] })]);
    expect(JSON.stringify(cast)).not.toContain(`"target"`);
    expect(m.observe(crew[1]).meeting!.voted).toEqual([crew[0]]);
  });

  it("voting ends early when everyone voted", () => {
    const m = smallMatch();
    const { crew } = seats(m);
    callEmergency(m, crew[0]);
    stepToMeetingPhase(m, "voting");
    const votingEnds = m.state.meeting!.phaseEndsAtTick;
    for (const id of m.state.meeting!.participants) expectOk(act(m, id, { type: "VOTE", target: "skip" }));
    m.step();
    expect(m.state.meeting?.phase ?? "playing").not.toBe("voting");
    const revealed = eventsOf(m, "VOTES_REVEALED");
    expect(revealed).toHaveLength(1);
    expect(revealed[0]!.tick).toBeLessThan(votingEnds);
  });

  it("tie vote ejects nobody", () => {
    const m = smallMatch();
    const { inf, crew } = seats(m);
    callEmergency(m, crew[0]);
    vote(m, { [crew[0]]: crew[2], [crew[1]]: crew[2], [crew[2]]: crew[3], [crew[3]]: crew[3], [inf]: "skip" });
    stepUntilPlaying(m);
    const revealed = eventsOf(m, "VOTES_REVEALED")[0]!;
    expect(revealed).toMatchObject({ outcome: "tie", ejectedId: null });
    expect(revealed.tally).toEqual({ [crew[2]]: 2, [crew[3]]: 2, skip: 1 });
    expect(eventsOf(m, "PLAYER_EJECTED")).toEqual([]);
    expect(m.state.players.every((p) => p.alive)).toBe(true);
  });

  it("skip works: a skip majority or a skip tie ejects nobody", () => {
    const cases: { name: string; votes: (s: ReturnType<typeof seats>) => Record<PlayerId, VoteTarget>; outcome: string }[] = [
      {
        name: "skip majority",
        votes: ({ inf, crew }) => ({ [crew[0]]: "skip", [crew[1]]: "skip", [crew[2]]: "skip", [crew[3]]: inf, [inf]: crew[3] }),
        outcome: "skipped",
      },
      {
        name: "skip tie",
        votes: ({ inf, crew }) => ({ [crew[0]]: "skip", [crew[1]]: "skip", [crew[2]]: inf, [crew[3]]: inf, [inf]: crew[0] }),
        outcome: "skipped",
      },
    ];
    for (const c of cases) {
      const m = smallMatch();
      callEmergency(m, crewIds(m)[0]!);
      vote(m, c.votes(seats(m)));
      stepUntilPlaying(m);
      expect(eventsOf(m, "VOTES_REVEALED")[0], c.name).toMatchObject({ outcome: c.outcome, ejectedId: null });
      expect(m.state.players.every((p) => p.alive), c.name).toBe(true);
    }
  });

  it("ejection works: the player dies with cause 'ejected', role revealed iff confirmEjects", () => {
    for (const confirmEjects of [true, false]) {
      const m = smallMatch({ confirmEjects });
      const { inf, crew } = seats(m);
      const target = crew[3];
      callEmergency(m, crew[0]);
      vote(m, { [crew[0]]: target, [crew[1]]: target, [crew[2]]: target, [target]: inf, [inf]: "skip" });
      stepToMeetingPhase(m, "result");

      const t = player(m, target);
      expect(t.alive).toBe(false);
      expect(t.deathCause).toBe("ejected");
      expect(m.state.meeting!.result).toMatchObject({ outcome: "ejected", ejectedId: target, ejectedRole: confirmEjects ? "crew" : null });
      expect(eventsOf(m, "PLAYER_EJECTED")).toEqual([expect.objectContaining({ playerId: target, role: "crew", roleRevealed: confirmEjects })]);

      const obs = m.observe(crew[0]);
      expect(perceived(obs.events, "PLAYER_EJECTED")).toEqual([expect.objectContaining({ playerId: target, role: confirmEjects ? "crew" : null })]);
      expect(obs.roster.find((r) => r.id === target)).toMatchObject({ knownStatus: "ejected", knownRole: confirmEjects ? "crew" : null });
      // The infiltrator's role stays hidden either way.
      expect(obs.roster.find((r) => r.id === inf)?.knownRole).toBeNull();

      stepUntilPlaying(m);
      expect(m.state.phase).toBe("playing"); // 3 crew vs 1 infiltrator: the game goes on
      expect(act(m, target, { type: "CALL_EMERGENCY" }).ok).toBe(false);
    }
  });
});

describe("after the meeting", () => {
  it("players are back at spawn, bodies cleared, kill cooldown reset", () => {
    const m = newMatch({ meeting: FAST_MEETING });
    const [inf] = infiltratorIds(m) as [string];
    const [v1, v2, reporter] = crewIds(m) as [string, string, string];
    scatter(m);
    const kill = killNow(m, inf, v1, COMMONS);
    killNow(m, inf, v2, { x: 8.5, y: 30.5 }); // a second, unreported body in the Engine Room
    expect(m.state.bodies).toHaveLength(2);
    place(m, reporter, { x: COMMONS.x - 2, y: COMMONS.y });
    expectOk(act(m, reporter, { type: "REPORT_BODY", bodyId: kill.bodyId }));
    expect(eventsOf(m, "MEETING_STARTED")[0]!.deadSinceLastMeeting).toEqual([v1, v2]);
    stepUntilPlaying(m);

    const endTick = m.tick;
    const spawns = spawnPositions(m.map, m.state.players.length);
    m.state.players.forEach((p, i) => {
      expect(p.pos, p.id).toEqual(spawns[i]);
      expect(p.roomId, p.id).toBe("commons");
      expect(p.killReadyAtTick, p.id).toBeGreaterThanOrEqual(endTick + secondsToTicks(m.state.settings.initialKillCooldownSec));
    });
    expect(m.state.bodies).toEqual([]);
    expect(m.observe(inf).self.killCooldownTicks).toBeGreaterThan(0);
    expect(act(m, inf, { type: "KILL", targetId: reporter })).toMatchObject({ ok: false });
    expect(m.state.emergencyReadyAtTick).toBe(endTick + secondsToTicks(m.state.settings.emergencyCooldownSec));
    expect(eventsOf(m, "MEETING_ENDED")).toHaveLength(1);
  });

  // Design: the reduced cooldown applies only at match start; after every meeting the full kill cooldown restarts.
  it("kill cooldown after a meeting is the full kill cooldown", () => {
    const m = smallMatch();
    const [inf] = infiltratorIds(m) as [string];
    callEmergency(m, crewIds(m)[0]!);
    stepUntilPlaying(m);
    expect(player(m, inf).killReadyAtTick).toBe(m.tick + secondsToTicks(m.state.settings.killCooldownSec));
  });
});

describe("tallyVotes (pure)", () => {
  const P = ["a", "b", "c", "d", "e"];
  const cases: {
    name: string;
    participants?: string[];
    votes: Record<string, VoteTarget>;
    outcome: "ejected" | "tie" | "skipped" | "no_votes";
    ejectedId: string | null;
    tally?: Record<string, number>;
  }[] = [
    { name: "no votes", votes: {}, outcome: "no_votes", ejectedId: null, tally: {} },
    { name: "unanimous", votes: { a: "c", b: "c", c: "a", d: "c", e: "c" }, outcome: "ejected", ejectedId: "c", tally: { c: 4, a: 1 } },
    { name: "single vote is a plurality", votes: { a: "b" }, outcome: "ejected", ejectedId: "b" },
    { name: "plurality over a split field", votes: { a: "c", b: "c", c: "d", d: "e", e: "skip" }, outcome: "ejected", ejectedId: "c" },
    { name: "two-way tie", votes: { a: "c", b: "c", c: "d", d: "d", e: "skip" }, outcome: "tie", ejectedId: null },
    { name: "tie found after a lower leader", votes: { a: "e", b: "c", c: "c", d: "d", e: "d" }, outcome: "tie", ejectedId: null },
    { name: "tie resolved by a later higher count", votes: { a: "b", b: "c", c: "d", d: "d" }, outcome: "ejected", ejectedId: "d" },
    { name: "skip majority", votes: { a: "skip", b: "skip", c: "skip", d: "a", e: "a" }, outcome: "skipped", ejectedId: null },
    { name: "skip equals the leader", votes: { a: "skip", b: "skip", c: "a", d: "a", e: "b" }, outcome: "skipped", ejectedId: null },
    { name: "all skip", votes: { a: "skip", b: "skip" }, outcome: "skipped", ejectedId: null, tally: { skip: 2 } },
    { name: "skip beats a tie", votes: { a: "skip", b: "skip", c: "skip", d: "a", e: "b" }, outcome: "skipped", ejectedId: null },
    { name: "leader beats skip", votes: { a: "skip", b: "c", c: "d", d: "c", e: "c" }, outcome: "ejected", ejectedId: "c" },
    {
      name: "non-participants' votes are ignored",
      participants: ["a", "b", "c"],
      votes: { a: "b", x: "c", y: "c", z: "c" },
      outcome: "ejected",
      ejectedId: "b",
      tally: { b: 1 },
    },
    { name: "only non-participants voted", participants: ["a", "b"], votes: { x: "a" }, outcome: "no_votes", ejectedId: null },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = tallyVotes(c.participants ?? P, c.votes);
      expect(r.outcome).toBe(c.outcome);
      expect(r.ejectedId).toBe(c.ejectedId);
      if (c.tally) expect(r.tally).toEqual(c.tally);
    });
  }
});

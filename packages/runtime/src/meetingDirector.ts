import { secondsToTicks, type MeetingId, type MeetingPhase, type MeetingView, type PlayerId, type Rng, type RosterEntry, type Tick } from "@deduction/shared";
import { parseUtterance, type AgentHost } from "@deduction/ai";
import type { GameMap } from "@deduction/maps";

export interface DirectorRequest {
  readonly host: AgentHost;
  readonly kind: "meeting_speech" | "vote";
}

const STATEMENT_GAP_SEC = 2.2;
const DISCUSSION_GAP_SEC = 3.5;
const VOTE_STAGGER_SEC = 0.4;

/**
 * Turn-taking for AI agents during meetings, so discussion reads like a conversation rather than nine parallel
 * monologues. Uses only public meeting information (transcript, participants) plus each agent's own traits.
 * Humans are never scheduled — they type whenever they like, and their messages feed the same queue logic
 * (being named in a message moves an agent up the queue).
 */
export class MeetingDirector {
  private meetingId: MeetingId | null = null;
  private phase: MeetingPhase | null = null;
  private queue: PlayerId[] = [];
  private nextTurnTick: Tick = 0;
  private spoken = new Map<PlayerId, number>();
  private processedMessages = 0;
  private voteQueue: PlayerId[] = [];
  private finalGiven = new Set<PlayerId>();

  constructor(
    private readonly hosts: ReadonlyMap<PlayerId, AgentHost>,
    private readonly map: GameMap,
    private readonly rng: Rng,
    /** Public identities (names are public knowledge), used to spot who is being addressed. */
    private readonly roster: readonly RosterEntry[],
  ) {}

  update(tick: Tick, meeting: MeetingView | null): DirectorRequest[] {
    if (!meeting) {
      this.meetingId = null;
      this.phase = null;
      return [];
    }
    if (meeting.meetingId !== this.meetingId) this.startMeeting(meeting);
    if (meeting.phase !== this.phase) this.enterPhase(tick, meeting);

    const out: DirectorRequest[] = [];
    const participants = new Set(meeting.participants);
    const eligible = (id: PlayerId) => participants.has(id) && this.hosts.has(id);

    // Anyone named in a new message gets bumped to the front of the queue (answering questions/accusations).
    for (const msg of meeting.messages.slice(this.processedMessages)) {
      for (const mentioned of parseUtterance(msg.text, this.roster, this.map, msg.playerId).mentions) {
        if (!eligible(mentioned) || mentioned === msg.playerId) continue;
        this.queue = [mentioned, ...this.queue.filter((q) => q !== mentioned)];
      }
    }
    this.processedMessages = meeting.messages.length;

    if (meeting.phase === "voting") {
      if (tick >= this.nextTurnTick && this.voteQueue.length > 0) {
        const id = this.voteQueue.shift()!;
        const host = this.hosts.get(id);
        if (host && eligible(id)) out.push({ host, kind: "vote" });
        this.nextTurnTick = tick + secondsToTicks(VOTE_STAGGER_SEC);
      }
      return out;
    }
    if (meeting.phase !== "statements" && meeting.phase !== "discussion" && meeting.phase !== "final_statements") return out;
    if (tick < this.nextTurnTick) return out;

    if (this.queue.length === 0 && meeting.phase === "discussion") this.queue = this.pickVolunteers(meeting);
    const next = this.queue.shift();
    if (!next) return out;
    const host = this.hosts.get(next);
    if (!host || !eligible(next)) return out;
    out.push({ host, kind: "meeting_speech" });
    this.spoken.set(next, (this.spoken.get(next) ?? 0) + 1);
    this.nextTurnTick = tick + secondsToTicks(meeting.phase === "discussion" ? DISCUSSION_GAP_SEC : STATEMENT_GAP_SEC);
    return out;
  }

  private startMeeting(meeting: MeetingView): void {
    this.meetingId = meeting.meetingId;
    this.phase = null;
    this.queue = [];
    this.spoken.clear();
    this.processedMessages = 0;
    this.voteQueue = [];
    this.finalGiven.clear();
  }

  private enterPhase(tick: Tick, meeting: MeetingView): void {
    this.phase = meeting.phase;
    this.nextTurnTick = tick + secondsToTicks(0.8);
    const ai = meeting.participants.filter((id) => this.hosts.has(id));
    const talk = (id: PlayerId) => this.hosts.get(id)?.personality.traits.talkativeness ?? 0.5;
    if (meeting.phase === "statements") {
      // Whoever called the meeting speaks first; everyone else in a talkativeness-weighted random order.
      const rest = ai.filter((id) => id !== meeting.callerId);
      const ordered: PlayerId[] = [];
      while (rest.length > 0) {
        const pick = this.rng.weighted(rest, (id) => 0.2 + talk(id));
        ordered.push(pick);
        rest.splice(rest.indexOf(pick), 1);
      }
      this.queue = ai.includes(meeting.callerId) ? [meeting.callerId, ...ordered] : ordered;
    } else if (meeting.phase === "final_statements") {
      this.queue = this.rng.shuffle(ai.filter((id) => !this.finalGiven.has(id) && this.rng.chance(0.25 + talk(id) * 0.5)));
      for (const id of this.queue) this.finalGiven.add(id);
    } else if (meeting.phase === "voting") {
      this.queue = [];
      this.voteQueue = this.rng.shuffle(ai);
    }
  }

  /** Who speaks up when nobody was addressed: talkative agents who have said the least so far. */
  private pickVolunteers(meeting: MeetingView): PlayerId[] {
    const ai = meeting.participants.filter((id) => this.hosts.has(id));
    const volunteers = ai.filter((id) => this.rng.chance((this.hosts.get(id)?.personality.traits.talkativeness ?? 0.5) / (1 + (this.spoken.get(id) ?? 0))));
    return volunteers.slice(0, 1);
  }
}

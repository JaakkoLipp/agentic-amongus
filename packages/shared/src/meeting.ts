import type { AreaId, MeetingId, PlayerId, Tick } from "./ids";
import type { VoteTarget } from "./actions";
import type { Role } from "./roles";

/**
 * Meeting state machine (engine-enforced timing; the runtime's meeting director decides who talks when):
 *
 *   reveal -> statements -> discussion -> final_statements -> voting -> result -> (back to playing | match end)
 *
 * Speech is legal in statements, discussion and final_statements. Votes are legal only in voting and are final.
 * Voting ends early once every living player has voted.
 */
export const MEETING_PHASES = ["reveal", "statements", "discussion", "final_statements", "voting", "result"] as const;
export type MeetingPhase = (typeof MEETING_PHASES)[number];

export const SPEECH_PHASES: readonly MeetingPhase[] = ["statements", "discussion", "final_statements"];

export type MeetingReason = "body" | "emergency";

export type MeetingOutcome = "ejected" | "tie" | "skipped" | "no_votes";

export interface MeetingMessage {
  readonly seq: number;
  readonly tick: Tick;
  readonly playerId: PlayerId;
  readonly text: string;
}

export interface MeetingResult {
  /** voterId -> target (null = did not vote). Revealed to everyone at the result phase. */
  readonly votes: Readonly<Record<PlayerId, VoteTarget | null>>;
  readonly tally: Readonly<Record<string, number>>;
  readonly outcome: MeetingOutcome;
  readonly ejectedId: PlayerId | null;
  /** Null unless role reveal on eject is enabled. */
  readonly ejectedRole: Role | null;
}

/** Public meeting information (identical for every living player). */
export interface MeetingView {
  readonly meetingId: MeetingId;
  readonly reason: MeetingReason;
  readonly callerId: PlayerId;
  readonly victimId: PlayerId | null;
  readonly bodyRoomId: AreaId | null;
  readonly phase: MeetingPhase;
  readonly phaseEndsAtTick: Tick;
  readonly participants: readonly PlayerId[];
  readonly messages: readonly MeetingMessage[];
  /** Who has voted so far (not for whom). */
  readonly voted: readonly PlayerId[];
  readonly result: MeetingResult | null;
}

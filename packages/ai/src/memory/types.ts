import type { AreaId, BodyId, CompassDirection, PlayerId, Tick, Vec2, VentId } from "@deduction/shared";

/**
 * Memory classes decide how long an entry survives:
 * - critical: kills, bodies, vent sightings, direct accusations, strong contradictions — whole match
 * - medium: claims, statements, alibis, suspicious behaviour — several minutes / meetings
 * - low: ordinary movement and mundane sightings — one to four minutes
 */
export type MemoryImportance = "critical" | "medium" | "low";

export interface EpisodicMemory {
  readonly id: number;
  readonly tick: Tick;
  readonly importance: MemoryImportance;
  readonly kind: string;
  readonly text: string;
  readonly subjects: readonly PlayerId[];
  readonly roomId: AreaId | null;
  readonly expiresAtTick: Tick | null;
}

export interface SocialMemory {
  readonly id: number;
  readonly tick: Tick;
  readonly speakerId: PlayerId;
  readonly text: string;
  readonly channel: "meeting" | "nearby";
  readonly accuses: readonly PlayerId[];
  readonly defends: readonly PlayerId[];
  readonly roomsMentioned: readonly AreaId[];
  readonly addressedToMe: boolean;
  readonly expiresAtTick: Tick | null;
}

/** Where a player was when this agent last saw them. Never updated while the player is out of sight. */
export interface LastKnownLocation {
  readonly playerId: PlayerId;
  readonly pos: Vec2;
  readonly roomId: AreaId | null;
  readonly tick: Tick;
  readonly heading: CompassDirection | null;
  readonly visibleNow: boolean;
}

export interface BeliefEvidence {
  readonly tick: Tick;
  readonly suspicionDelta: number;
  readonly trustDelta: number;
  readonly reason: string;
}

export interface PlayerBelief {
  suspicion: number;
  trust: number;
  readonly evidence: BeliefEvidence[];
}

/** One point on the inspector's suspicion/trust timeline. */
export interface BeliefChange {
  readonly tick: Tick;
  readonly playerId: PlayerId;
  readonly suspicionBefore: number;
  readonly suspicionAfter: number;
  readonly trustBefore: number;
  readonly trustAfter: number;
  readonly reason: string;
}

export interface KnownBody {
  readonly bodyId: BodyId;
  readonly victimId: PlayerId;
  readonly pos: Vec2;
  readonly roomId: AreaId | null;
  readonly seenTick: Tick;
}

export interface WitnessedKill {
  readonly killerId: PlayerId;
  readonly victimId: PlayerId;
  readonly roomId: AreaId | null;
  readonly tick: Tick;
}

export interface VentSighting {
  readonly playerId: PlayerId;
  readonly ventId: VentId;
  readonly roomId: AreaId | null;
  readonly tick: Tick;
  readonly action: "enter" | "exit";
}

export interface StrategicNote {
  readonly tick: Tick;
  readonly text: string;
  readonly expiresAtTick: Tick | null;
}

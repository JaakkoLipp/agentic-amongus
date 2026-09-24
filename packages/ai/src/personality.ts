import { clamp, deriveRng, type PlayerId, type Rng } from "@deduction/shared";

/**
 * Behavioural personality. Every trait is in [0, 1] and changes decisions (thresholds, goal choice, timing),
 * not just wording.
 */
export interface Personality {
  /** Willingness to be alone / kill with possible witnesses / act on thin evidence. */
  readonly riskTolerance: number;
  /** How fast suspicion rises from evidence. */
  readonly suspicionRate: number;
  /** How fast trust rises from confirmations and alibis. */
  readonly trustRate: number;
  /** Preference for staying near others (buddy up, seek group). */
  readonly sociability: number;
  /** Accusing, confronting, hunting (infiltrator) frequency. */
  readonly aggression: number;
  /** Infiltrator: quality of lies, framing, alibi construction. */
  readonly deceptionSkill: number;
  /** Probability of speaking when given a meeting turn. */
  readonly talkativeness: number;
  /** How long ordinary memories last and how much old evidence weighs. */
  readonly memoryReliance: number;
  /** Suspicion needed before voting for someone instead of skipping (higher = votes on less evidence). */
  readonly voteConfidence: number;
}

export const ARCHETYPES = {
  detective: { label: "Detective", traits: { riskTolerance: 0.55, suspicionRate: 0.6, trustRate: 0.5, sociability: 0.45, aggression: 0.6, deceptionSkill: 0.55, talkativeness: 0.7, memoryReliance: 0.85, voteConfidence: 0.55 } },
  paranoid: { label: "Paranoid", traits: { riskTolerance: 0.25, suspicionRate: 0.9, trustRate: 0.2, sociability: 0.3, aggression: 0.7, deceptionSkill: 0.4, talkativeness: 0.6, memoryReliance: 0.6, voteConfidence: 0.75 } },
  social: { label: "Social", traits: { riskTolerance: 0.4, suspicionRate: 0.4, trustRate: 0.75, sociability: 0.9, aggression: 0.3, deceptionSkill: 0.5, talkativeness: 0.85, memoryReliance: 0.5, voteConfidence: 0.45 } },
  lone_wolf: { label: "Lone Wolf", traits: { riskTolerance: 0.8, suspicionRate: 0.5, trustRate: 0.3, sociability: 0.1, aggression: 0.5, deceptionSkill: 0.5, talkativeness: 0.3, memoryReliance: 0.6, voteConfidence: 0.5 } },
  manipulator: { label: "Manipulator", traits: { riskTolerance: 0.6, suspicionRate: 0.5, trustRate: 0.4, sociability: 0.7, aggression: 0.55, deceptionSkill: 0.9, talkativeness: 0.8, memoryReliance: 0.7, voteConfidence: 0.6 } },
  cautious: { label: "Cautious", traits: { riskTolerance: 0.15, suspicionRate: 0.45, trustRate: 0.45, sociability: 0.65, aggression: 0.25, deceptionSkill: 0.45, talkativeness: 0.45, memoryReliance: 0.7, voteConfidence: 0.3 } },
  impulsive: { label: "Impulsive", traits: { riskTolerance: 0.9, suspicionRate: 0.75, trustRate: 0.6, sociability: 0.5, aggression: 0.85, deceptionSkill: 0.35, talkativeness: 0.75, memoryReliance: 0.35, voteConfidence: 0.85 } },
  analyst: { label: "Analyst", traits: { riskTolerance: 0.45, suspicionRate: 0.5, trustRate: 0.5, sociability: 0.4, aggression: 0.4, deceptionSkill: 0.6, talkativeness: 0.55, memoryReliance: 0.95, voteConfidence: 0.45 } },
  rookie: { label: "Rookie", traits: { riskTolerance: 0.5, suspicionRate: 0.55, trustRate: 0.65, sociability: 0.6, aggression: 0.45, deceptionSkill: 0.25, talkativeness: 0.5, memoryReliance: 0.3, voteConfidence: 0.6 } },
} as const satisfies Record<string, { label: string; traits: Personality }>;

export type ArchetypeId = keyof typeof ARCHETYPES;
export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

export interface AssignedPersonality {
  readonly archetype: ArchetypeId;
  readonly traits: Personality;
}

export function jitterPersonality(base: Personality, variation: number, rng: Rng): Personality {
  const j = (v: number) => clamp(v + rng.float(-variation, variation) * 0.5, 0, 1);
  return {
    riskTolerance: j(base.riskTolerance),
    suspicionRate: j(base.suspicionRate),
    trustRate: j(base.trustRate),
    sociability: j(base.sociability),
    aggression: j(base.aggression),
    deceptionSkill: j(base.deceptionSkill),
    talkativeness: j(base.talkativeness),
    memoryReliance: j(base.memoryReliance),
    voteConfidence: j(base.voteConfidence),
  };
}

/** Distinct archetypes per seat (cycling if there are more seats than archetypes), jittered deterministically. */
export function assignPersonalities(playerIds: readonly PlayerId[], seed: number, variation: number): Record<PlayerId, AssignedPersonality> {
  const rng = deriveRng(seed, "personalities");
  const order = rng.shuffle(ARCHETYPE_IDS);
  const out: Record<PlayerId, AssignedPersonality> = {};
  playerIds.forEach((id, i) => {
    const archetype = order[i % order.length]!;
    out[id] = { archetype, traits: jitterPersonality(ARCHETYPES[archetype].traits, variation, deriveRng(seed, "personality", id)) };
  });
  return out;
}

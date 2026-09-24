import type { TaskDefinition } from "../types";
import { anomalyDetection } from "./anomaly_detection";
import { arithmetic } from "./arithmetic";
import { checksum } from "./checksum";
import { classification } from "./classification";
import { instructionFollowing } from "./instruction_following";
import { patternMatch } from "./pattern_match";
import { routePlanning } from "./route_planning";
import { ruleComposition } from "./rule_composition";
import { sequenceRecall } from "./sequence_recall";
import { shortLogic } from "./short_logic";
import { sorting } from "./sorting";
import { spatialReasoning } from "./spatial_reasoning";
import { symbolMatch } from "./symbol_match";
import { temporalReasoning } from "./temporal_reasoning";
import { workingMemory } from "./working_memory";

/** Every task kind, in `TASK_KINDS` order. */
export const TASK_DEFINITIONS: readonly TaskDefinition[] = [
  sequenceRecall,
  workingMemory,
  patternMatch,
  symbolMatch,
  arithmetic,
  instructionFollowing,
  classification,
  anomalyDetection,
  temporalReasoning,
  spatialReasoning,
  routePlanning,
  ruleComposition,
  shortLogic,
  sorting,
  checksum,
];

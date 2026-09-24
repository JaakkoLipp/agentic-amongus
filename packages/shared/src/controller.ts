import type { AgentDecision, DecisionRequest } from "./decisions";
import type { PlayerObservation } from "./observation";
import type { ControllerKind } from "./settings";

/**
 * The single "brain" interface shared by every kind of player. The engine never sees controllers: the runtime
 * asks a controller for a decision, and the resulting goal/answer/speech/vote reaches the engine as ordinary,
 * validated player actions. A HumanController resolves decisions from UI input; LLM/heuristic/random
 * controllers compute them.
 *
 * Contract:
 * - `decide` may be slow (LLM) and must never be awaited by the simulation tick in real-time mode.
 * - The observation is the only game information a controller receives. Agent memory is built from the stream
 *   of observations by the agent host (see @deduction/ai) and injected into controllers that need it.
 * - Implementations must not throw for bad model output; the host still guards with a fallback.
 */
export interface PlayerController {
  readonly kind: ControllerKind;
  decide(observation: PlayerObservation, request: DecisionRequest): Promise<AgentDecision>;
  dispose?(): void;
}

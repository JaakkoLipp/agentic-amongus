import { secondsToTicks, type AnswerFormat, type Rng, type TaskAnswer, type TaskView } from "@deduction/shared";
import { getTaskDefinition, mutateAnswer, solveFromViews } from "@deduction/tasks";
import type { DifficultyProfile } from "../context";
import type { Personality } from "../personality";

/** A random but well-formed answer for a format (used by the random controller and as a last resort). */
export function randomAnswer(format: AnswerFormat, rng: Rng): TaskAnswer {
  switch (format.type) {
    case "sequence":
      return Array.from({ length: format.length }, () => rng.pick(format.alphabet));
    case "choice":
      return rng.pick(format.options).id;
    case "multi_choice":
      return rng.sample(format.options, format.count ?? rng.int(0, format.options.length)).map((o) => o.id);
    case "number":
      return rng.int(0, 99);
    case "text":
      return "?";
    case "ordering":
      return rng.shuffle(format.items).map((o) => o.id);
    case "path":
      return rng.sample(format.nodes, Math.min(3, format.nodes.length));
  }
}

/**
 * Honest bot solving: only the views this agent was actually shown (observe phase included, if it was there).
 * Mistakes are injected at a difficulty/personality dependent rate, with longer "thinking" for harder tasks.
 */
export function solveLikeABot(views: readonly TaskView[], profile: DifficultyProfile, personality: Personality, memoryQuality: number, rng: Rng): { answer: TaskAnswer | null; thinkTicks: number; mistake: boolean } {
  const answerView = views[views.length - 1];
  if (!answerView || answerView.phase !== "answer" || !answerView.answerFormat) return { answer: null, thinkTicks: 0, mistake: false };
  const def = getTaskDefinition(answerView.kind);
  const correct = solveFromViews(answerView.kind, views);
  let errorRate = profile.taskErrorRate;
  if (def.isMemoryTask) errorRate += profile.memoryTaskPenalty * (1.5 - memoryQuality) * (1.3 - personality.memoryReliance * 0.6);
  const mistake = correct === null || rng.chance(errorRate);
  const answer = correct === null ? randomAnswer(answerView.answerFormat, rng) : mistake ? mutateAnswer(correct, answerView.answerFormat, rng) : correct;
  const base = def.category === "planning" || def.category === "reasoning" ? 3.5 : 2.2;
  const thinkTicks = secondsToTicks((base + rng.float(0, 2.5)) * profile.thinkTimeScale);
  return { answer, thinkTicks, mistake };
}

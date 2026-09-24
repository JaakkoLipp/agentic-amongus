import type { AnswerFormat, TaskAnswer } from "@deduction/shared";

const isList = (answer: TaskAnswer): answer is readonly string[] => typeof answer === "object";

/**
 * Does a (schema-valid) answer fit the concrete answer format the player was shown?
 * Per-kind Zod schemas only know static bounds; this catches per-instance problems such as a sequence of the
 * wrong length, an option id that is not offered in this instance, or an ordering that is not a permutation.
 */
export function answerFitsFormat(answer: TaskAnswer, format: AnswerFormat | null): boolean {
  if (format === null) return false;
  switch (format.type) {
    case "number":
      return typeof answer === "number" && Number.isFinite(answer);
    case "text":
      return typeof answer === "string" && answer.length <= format.maxLength;
    case "choice":
      return typeof answer === "string" && format.options.some((o) => o.id === answer);
    case "sequence":
      return isList(answer) && answer.length === format.length && answer.every((s) => format.alphabet.includes(s));
    case "multi_choice": {
      if (!isList(answer) || new Set(answer).size !== answer.length) return false;
      if (format.count !== null && answer.length !== format.count) return false;
      return answer.every((id) => format.options.some((o) => o.id === id));
    }
    case "ordering": {
      if (!isList(answer) || answer.length !== format.items.length || new Set(answer).size !== answer.length) {
        return false;
      }
      return answer.every((id) => format.items.some((o) => o.id === id));
    }
    case "path":
      return isList(answer) && answer.length > 0 && answer.every((id) => format.nodes.includes(id));
  }
}

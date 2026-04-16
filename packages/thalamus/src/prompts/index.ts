/**
 * Prompts barrel. Hoisting convention: one LLM prompt per file, named by
 * business concept. Services import the builder / constant from here instead
 * of keeping template strings inline.
 */

export {
  buildPlannerSystemPrompt,
  type PlannerPromptInput,
} from "./planner.prompt";
export {
  buildOpacityScoutSystemPrompt,
  type OpacityScoutPromptInput,
} from "./opacity-scout.prompt";

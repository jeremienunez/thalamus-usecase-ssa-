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
export {
  buildReflexionSystemPrompt,
  type ReflexionPromptInput,
} from "./reflexion.prompt";
export {
  DEFAULT_NANO_SWARM_PROFILE,
  type NanoSwarmProfile,
  type Lens,
} from "./nano-swarm.prompt";
export { DEFAULT_CURATOR_PROMPT } from "./curator.prompt";
export {
  buildGenericPlannerSystemPrompt,
  type GenericPlannerPromptInput,
} from "./planner-generic.prompt";

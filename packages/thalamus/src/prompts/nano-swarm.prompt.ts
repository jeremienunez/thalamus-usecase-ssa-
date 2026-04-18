/**
 * NanoSwarm — agnostic profile type + default.
 *
 * The nano swarm is a generic fan-out/merge algorithm: decompose scout
 * queries into micro-queries, run them in waves, dedup results. The
 * *domain flavour* — researcher lenses, keyword → lens mapping, the call
 * instructions — lives entirely in this profile. Consumers inject a
 * domain-specific profile via `setNanoSwarmProfile()`; the package ships
 * a minimal generic default so the module is runnable + testable alone.
 */

import type { ExplorationQuery } from "../explorer/scout";

export interface Lens {
  readonly id: string;
  readonly lens: string;
}

export interface NanoSwarmProfile {
  /** Full lens catalog, used to fill remaining slots after pickLenses(). */
  readonly lenses: readonly Lens[];
  /** Per-query lens selection (typically 4-8 lenses most relevant). */
  pickLenses(query: ExplorationQuery): readonly Lens[];
  /** Build the `instructions` system prompt for one nano call. */
  buildCallInstructions(lens: string): string;
  /** Build the user-side `input` for one nano call. */
  buildCallInput(microQuery: string): string;
}

export const DEFAULT_NANO_SWARM_PROFILE: NanoSwarmProfile = {
  lenses: [
    { id: "news", lens: "recent news and published articles" },
    { id: "trend", lens: "emerging patterns and longitudinal trends" },
    { id: "data", lens: "quantitative data, statistics, and benchmarks" },
    { id: "market", lens: "market intelligence, pricing, and demand" },
  ],
  pickLenses() {
    return DEFAULT_NANO_SWARM_PROFILE.lenses;
  },
  buildCallInstructions(lens) {
    return `You are a specialized research nano-agent.
Your expertise: ${lens}
Search the web and return structured findings.
Be concise but data-rich.`;
  },
  buildCallInput(microQuery) {
    return `Search: ${microQuery}

For each source found, return:
- URL
- Title
- 120-word summary with specific entities, numbers, and dates.
Return at least 2 sources.`;
  },
};

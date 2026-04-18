/**
 * SimAgentPersonaComposer — kernel ↔ pack contract for persona derivation.
 *
 * Given a subject snapshot + arbitrary hints (e.g. risk-profile tweak from
 * a PerturbationSpec), the pack composes a persona string + goals + constraint
 * bag. The kernel injects these verbatim into the turn prompt.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.3 (impl lifts
 * inferRiskProfile + composePersona/Goals/Constraints verbatim from
 * packages/sweep/src/sim/agent-builder.ts into apps/console-api).
 */

import type { SimSubjectSnapshot } from "./subject.port";

export interface ComposedPersona {
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}

export interface SimAgentPersonaComposer {
  compose(
    subject: SimSubjectSnapshot,
    hints: Record<string, unknown>,
  ): ComposedPersona;
}

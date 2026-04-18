/**
 * SsaPersonaComposer — SSA persona / goals / constraints derivation.
 *
 * TODO(Plan 2 · B.3): lift verbatim from
 *   packages/sweep/src/sim/agent-builder.ts lines ~159-240:
 *     - inferRiskProfile(snapshot, hints)
 *     - composePersona(subject, riskProfile)
 *     - composeGoals(subject, riskProfile)
 *     - composeConstraints(subject, hints)
 *     - riskProfileDescription(riskProfile)
 *   Adapt to read from subject.attributes.{operatorCountry, satelliteCount,
 *   regimeMix, platformMix, avgLaunchYear}.
 *
 * Determinism is load-bearing (same subject + same hints → same persona) —
 * required by the E2E fixture-replay cache.
 */

import type {
  SimAgentPersonaComposer,
  AgentSubjectSnapshot,
  ComposedPersona,
} from "@interview/sweep";

export class SsaPersonaComposer implements SimAgentPersonaComposer {
  compose(
    _subject: AgentSubjectSnapshot,
    _hints: Record<string, unknown>,
  ): ComposedPersona {
    // TODO(B.3): implement via inferRiskProfile + composePersona/Goals/Constraints.
    throw new Error("SsaPersonaComposer.compose: TODO Plan 2 · B.3");
  }
}

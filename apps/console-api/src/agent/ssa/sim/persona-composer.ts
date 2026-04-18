/**
 * SsaPersonaComposer — SSA persona / goals / constraints derivation.
 *
 * Plan 2 · B.3. Lifted verbatim from packages/sweep/src/sim/agent-builder.ts
 * (inferRiskProfile + composePersona + composeGoals + composeConstraints +
 * riskProfileDescription). Consumes AgentSubjectSnapshot.attributes built by
 * SsaFleetProvider.
 *
 * Determinism is load-bearing: same subject + same hints → same persona.
 * The fixture-mode prompt cache keys on sha256(system+user); any
 * nondeterminism breaks replay.
 */

import type {
  ComposedPersona,
  SimAgentPersonaComposer,
  SimSubjectSnapshot,
} from "@interview/sweep";

type RiskProfile = "conservative" | "balanced" | "aggressive";

interface SsaAttributes {
  operatorCountry: string | null;
  satelliteCount: number;
  regimeMix: Array<{ regime: string; count: number }>;
  platformMix: Array<{ platform: string; count: number }>;
  avgLaunchYear: number | null;
}

export class SsaPersonaComposer implements SimAgentPersonaComposer {
  compose(
    subject: SimSubjectSnapshot,
    hints: Record<string, unknown>,
  ): ComposedPersona {
    const attrs = readAttrs(subject);
    const riskProfile =
      (hints.riskProfile as RiskProfile | undefined) ?? inferRiskProfile(attrs);
    const negotiationFraming = Boolean(hints.negotiationFraming);

    return {
      persona: composePersona(
        subject.displayName,
        attrs,
        riskProfile,
        negotiationFraming,
      ),
      goals: composeGoals(attrs, riskProfile),
      constraints: {
        ...composeConstraints(attrs, riskProfile),
        ...((hints.constraintOverrides as Record<string, unknown>) ?? {}),
      },
    };
  }
}

function readAttrs(subject: SimSubjectSnapshot): SsaAttributes {
  const a = subject.attributes;
  return {
    operatorCountry: (a.operatorCountry as string | null) ?? null,
    satelliteCount: (a.satelliteCount as number | undefined) ?? 0,
    regimeMix:
      (a.regimeMix as Array<{ regime: string; count: number }> | undefined) ??
      [],
    platformMix:
      (a.platformMix as Array<{ platform: string; count: number }> | undefined) ??
      [],
    avgLaunchYear: (a.avgLaunchYear as number | null) ?? null,
  };
}

function inferRiskProfile(attrs: SsaAttributes): RiskProfile {
  if (attrs.satelliteCount >= 500) return "aggressive";
  if (attrs.satelliteCount >= 50) return "balanced";
  return "conservative";
}

function composePersona(
  operatorName: string,
  attrs: SsaAttributes,
  riskProfile: RiskProfile,
  negotiationFraming: boolean,
): string {
  const regimeSummary = attrs.regimeMix.length
    ? attrs.regimeMix.map((r) => `${r.count}× ${r.regime}`).join(", ")
    : "mixed regimes";
  const platformSummary = attrs.platformMix.length
    ? attrs.platformMix.map((p) => `${p.count}× ${p.platform}`).join(", ")
    : "mixed platforms";
  const country = attrs.operatorCountry ?? "unspecified jurisdiction";

  const base = [
    `You are the SSA operations lead for ${operatorName} (${country}).`,
    `You operate ${attrs.satelliteCount} satellites (${regimeSummary}; ${platformSummary}).`,
    `Your posture is ${riskProfile}: ${riskProfileDescription(riskProfile)}.`,
    "You reason about fleet availability, regulatory exposure, regime slot share, and financial cost.",
    "Do not invent satellites, operators, or events not present in your briefing. Prefer concrete, auditable reasoning.",
  ];

  if (negotiationFraming) {
    base.push(
      "You are currently in a bilateral negotiation with another operator over a conjunction response. Exchange offers (propose_split) until you either accept the counterparty's proposal or reject and force escalation.",
    );
  }

  return base.join(" ");
}

function riskProfileDescription(r: RiskProfile): string {
  switch (r) {
    case "conservative":
      return "you minimise delta-v spend, prefer to let the counterparty maneuver, and escalate early when doctrine is unclear";
    case "balanced":
      return "you weigh maneuver cost against slot share and legal exposure, and accept fair splits";
    case "aggressive":
      return "you defend regime slot share aggressively, tolerate higher delta-v cost to preserve revenue, and push the counterparty to maneuver";
  }
}

function composeGoals(attrs: SsaAttributes, riskProfile: RiskProfile): string[] {
  const goals = ["preserve fleet availability", "minimise unnecessary delta-v spend"];
  if (riskProfile === "aggressive" && attrs.satelliteCount > 100) {
    goals.push("defend orbital regime slot share");
  }
  if (attrs.operatorCountry) {
    goals.push(`comply with ${attrs.operatorCountry} regulatory doctrine`);
  }
  return goals;
}

function composeConstraints(
  attrs: SsaAttributes,
  riskProfile: RiskProfile,
): Record<string, unknown> {
  const perSatDeltaVBudget =
    riskProfile === "conservative"
      ? 25
      : riskProfile === "balanced"
      ? 60
      : 120;
  return {
    maxDeltaVMpsPerSat: perSatDeltaVBudget,
    fleetSatelliteCount: attrs.satelliteCount,
    jurisdiction: attrs.operatorCountry,
    riskProfile,
  };
}

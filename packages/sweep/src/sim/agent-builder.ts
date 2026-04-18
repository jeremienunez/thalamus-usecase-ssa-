/**
 * Agent builder — synthesises a sim_agent row from a pack-provided subject.
 *
 * Persona composition is deterministic: same subject + same riskProfile
 * always yields the same system-prompt string. That's load-bearing for
 * fixture-mode swarm determinism (the cortex prompt cache key is a sha256
 * of system+user, so any nondeterminism breaks replay).
 *
 * Plan 2 · B.1: fleet data read via SimFleetProvider port; SQL lives in the
 * pack (apps/console-api/.../satellite-fleet.repository.ts) or in the legacy
 * fallback adapter (./legacy-ssa-fleet.ts).
 *
 * Plan 2 · B.3 will lift inferRiskProfile + composePersona/Goals/Constraints
 * into the SSA pack (SimAgentPersonaComposer); kept inline here until then.
 */

import type { Database, NewSimAgent } from "@interview/db-schema";
import { simAgent } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";
import type { SimFleetProvider } from "./ports";
import type { FleetSnapshot } from "./types";

const logger = createLogger("sim-agent-builder");

export type RiskProfile = "conservative" | "balanced" | "aggressive";

export interface BuildAgentDeps {
  db: Database;
  fleet: SimFleetProvider;
}

export interface BuildAgentOpts {
  simRunId: number;
  operatorId: number;
  agentIndex: number;
  riskProfile?: RiskProfile;
  constraintOverrides?: Record<string, unknown>;
  negotiationFraming?: boolean; // true for UC3 agents
}

export interface BuildAgentResult {
  agentId: number;
  operatorName: string;
  fleetSnapshot: FleetSnapshot;
}

/**
 * Build one agent: read subject snapshot via the fleet port, compose persona,
 * insert row. Caller is responsible for opening a transaction if it needs
 * atomicity across multiple agents in one fish.
 */
export async function buildOperatorAgent(
  deps: BuildAgentDeps,
  opts: BuildAgentOpts,
): Promise<BuildAgentResult> {
  const subject = await deps.fleet.getAgentSubject({
    kind: "operator",
    id: opts.operatorId,
  });
  const snapshot = toFleetSnapshot(subject);

  const riskProfile = opts.riskProfile ?? inferRiskProfile(snapshot);
  const persona = composePersona(
    snapshot,
    riskProfile,
    opts.negotiationFraming ?? false,
  );
  const goals = composeGoals(snapshot, riskProfile);
  const constraints = {
    ...composeConstraints(snapshot, riskProfile),
    ...(opts.constraintOverrides ?? {}),
  };

  const insert: NewSimAgent = {
    simRunId: BigInt(opts.simRunId),
    operatorId: BigInt(opts.operatorId),
    agentIndex: opts.agentIndex,
    persona,
    goals,
    constraints,
  };

  const [row] = await deps.db
    .insert(simAgent)
    .values(insert)
    .returning({ id: simAgent.id });
  if (!row) {
    throw new Error(`Failed to insert sim_agent for operator ${opts.operatorId}`);
  }

  logger.debug(
    {
      simRunId: opts.simRunId,
      operatorId: opts.operatorId,
      riskProfile,
      satelliteCount: snapshot.satelliteCount,
    },
    "built sim_agent",
  );

  return {
    agentId: Number(row.id),
    operatorName: snapshot.operatorName,
    fleetSnapshot: snapshot,
  };
}

// -----------------------------------------------------------------------
// Subject → FleetSnapshot adapter (pack attributes → SSA-typed struct).
// Plan 2 · B.3 moves FleetSnapshot definition + this adapter into the pack.
// -----------------------------------------------------------------------

function toFleetSnapshot(subject: {
  displayName: string;
  attributes: Record<string, unknown>;
}): FleetSnapshot {
  const a = subject.attributes;
  return {
    operatorName: subject.displayName,
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

// -----------------------------------------------------------------------
// Persona / goals / constraints — pure functions of (snapshot, riskProfile).
// Plan 2 · B.3 relocates these to apps/console-api/src/agent/ssa/sim/persona-composer.ts.
// -----------------------------------------------------------------------

function inferRiskProfile(snapshot: FleetSnapshot): RiskProfile {
  if (snapshot.satelliteCount >= 500) return "aggressive";
  if (snapshot.satelliteCount >= 50) return "balanced";
  return "conservative";
}

function composePersona(
  snapshot: FleetSnapshot,
  riskProfile: RiskProfile,
  negotiationFraming: boolean,
): string {
  const regimeSummary = snapshot.regimeMix.length
    ? snapshot.regimeMix.map((r) => `${r.count}× ${r.regime}`).join(", ")
    : "mixed regimes";
  const platformSummary = snapshot.platformMix.length
    ? snapshot.platformMix.map((p) => `${p.count}× ${p.platform}`).join(", ")
    : "mixed platforms";
  const country = snapshot.operatorCountry ?? "unspecified jurisdiction";

  const base = [
    `You are the SSA operations lead for ${snapshot.operatorName} (${country}).`,
    `You operate ${snapshot.satelliteCount} satellites (${regimeSummary}; ${platformSummary}).`,
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

function composeGoals(snapshot: FleetSnapshot, riskProfile: RiskProfile): string[] {
  const goals = ["preserve fleet availability", "minimise unnecessary delta-v spend"];
  if (riskProfile === "aggressive" && snapshot.satelliteCount > 100) {
    goals.push("defend orbital regime slot share");
  }
  if (snapshot.operatorCountry) {
    goals.push(`comply with ${snapshot.operatorCountry} regulatory doctrine`);
  }
  return goals;
}

function composeConstraints(
  snapshot: FleetSnapshot,
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
    fleetSatelliteCount: snapshot.satelliteCount,
    jurisdiction: snapshot.operatorCountry,
    riskProfile,
  };
}

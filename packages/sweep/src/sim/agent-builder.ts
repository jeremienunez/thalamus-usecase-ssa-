/**
 * Agent builder — synthesises a sim_agent row from a KG operator.
 *
 * Persona composition is deterministic: same operator + same riskProfile
 * always yields the same system-prompt string. That's load-bearing for
 * fixture-mode swarm determinism (the cortex prompt cache key is a sha256
 * of system+user, so any nondeterminism breaks replay).
 */

import { sql } from "drizzle-orm";
import type { Database, NewSimAgent } from "@interview/db-schema";
import { simAgent } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";
import type { FleetSnapshot } from "./types";

const logger = createLogger("sim-agent-builder");

export type RiskProfile = "conservative" | "balanced" | "aggressive";

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
 * Build one agent: read operator + fleet stats, compose persona, insert row.
 * Caller is responsible for opening a transaction if it needs atomicity
 * across multiple agents in one fish.
 */
export async function buildOperatorAgent(
  db: Database,
  opts: BuildAgentOpts,
): Promise<BuildAgentResult> {
  const snapshot = await loadFleetSnapshot(db, opts.operatorId);
  const riskProfile = opts.riskProfile ?? inferRiskProfile(snapshot);
  const persona = composePersona(snapshot, riskProfile, opts.negotiationFraming ?? false);
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

  const [row] = await db.insert(simAgent).values(insert).returning({ id: simAgent.id });
  if (!row) throw new Error(`Failed to insert sim_agent for operator ${opts.operatorId}`);

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
// Fleet snapshot — one aggregate query per agent build
// -----------------------------------------------------------------------

async function loadFleetSnapshot(
  db: Database,
  operatorId: number,
): Promise<FleetSnapshot> {
  const result = await db.execute(sql`
    WITH fleet AS (
      SELECT
        s.id,
        s.launch_year,
        orr.name AS regime_name,
        pc.name AS platform_name
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN orbit_regime orr    ON orr.id = oc.orbit_regime_id
      LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
      WHERE s.operator_id = ${BigInt(operatorId)}
    )
    SELECT
      op.name AS operator_name,
      oc.name AS country_name,
      (SELECT count(*)::int FROM fleet) AS satellite_count,
      (SELECT avg(launch_year)::int FROM fleet WHERE launch_year IS NOT NULL) AS avg_launch_year,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('regime', regime_name, 'count', c))
         FROM (SELECT regime_name, count(*)::int AS c FROM fleet
               WHERE regime_name IS NOT NULL
               GROUP BY regime_name ORDER BY c DESC LIMIT 5) r),
        '[]'::jsonb
      ) AS regime_mix,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('platform', platform_name, 'count', c))
         FROM (SELECT platform_name, count(*)::int AS c FROM fleet
               WHERE platform_name IS NOT NULL
               GROUP BY platform_name ORDER BY c DESC LIMIT 5) p),
        '[]'::jsonb
      ) AS platform_mix
    FROM operator op
    LEFT JOIN satellite s2          ON s2.operator_id = op.id
    LEFT JOIN operator_country oc   ON oc.id = s2.operator_country_id
    WHERE op.id = ${BigInt(operatorId)}
    GROUP BY op.name, oc.name
    LIMIT 1
  `);

  const row = result.rows[0] as
    | {
        operator_name: string;
        country_name: string | null;
        satellite_count: number | null;
        avg_launch_year: number | null;
        regime_mix: Array<{ regime: string; count: number }> | null;
        platform_mix: Array<{ platform: string; count: number }> | null;
      }
    | undefined;

  if (!row) {
    throw new Error(`Operator ${operatorId} not found`);
  }

  return {
    operatorName: row.operator_name,
    operatorCountry: row.country_name,
    satelliteCount: row.satellite_count ?? 0,
    regimeMix: row.regime_mix ?? [],
    platformMix: row.platform_mix ?? [],
    avgLaunchYear: row.avg_launch_year,
  };
}

// -----------------------------------------------------------------------
// Persona / goals / constraints — pure functions of (snapshot, riskProfile)
// -----------------------------------------------------------------------

function inferRiskProfile(snapshot: FleetSnapshot): RiskProfile {
  // Heuristic: large commercial fleets (LEO comms) tend to be aggressive on
  // slot share; small science / research fleets tend to be conservative.
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
  const goals = [
    "preserve fleet availability",
    "minimise unnecessary delta-v spend",
  ];
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
  // Coarse cost model — refined later by queryReplacementCost at turn time
  // for the specific satellite under discussion. These are fleet-wide priors.
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

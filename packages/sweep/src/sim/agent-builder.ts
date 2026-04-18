/**
 * Agent builder — synthesises a sim_agent row from a pack-provided subject.
 *
 * Plan 2 · B.1 + B.3: fleet snapshot and persona composition are both
 * delegated to pack ports. The kernel owns only the sim_agent INSERT.
 *
 * Determinism is load-bearing: same subject + same hints → same
 * persona/goals/constraints. The fixture-mode prompt cache keys on
 * sha256(system+user); any nondeterminism breaks replay.
 */

import type { Database, NewSimAgent } from "@interview/db-schema";
import { simAgent } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";
import type { SimFleetProvider, SimAgentPersonaComposer } from "./ports";
import type { FleetSnapshot } from "./types";

const logger = createLogger("sim-agent-builder");

export type RiskProfile = "conservative" | "balanced" | "aggressive";

export interface BuildAgentDeps {
  db: Database;
  fleet: SimFleetProvider;
  persona: SimAgentPersonaComposer;
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
 * Build one agent: read subject snapshot via the fleet port, compose persona
 * via the persona port, insert row. Caller is responsible for opening a
 * transaction if it needs atomicity across multiple agents in one fish.
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

  const composed = deps.persona.compose(subject, {
    riskProfile: opts.riskProfile,
    negotiationFraming: opts.negotiationFraming ?? false,
    constraintOverrides: opts.constraintOverrides,
  });

  const insert: NewSimAgent = {
    simRunId: BigInt(opts.simRunId),
    operatorId: BigInt(opts.operatorId),
    agentIndex: opts.agentIndex,
    persona: composed.persona,
    goals: composed.goals,
    constraints: composed.constraints,
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
// Plan 2 · B.7 will drop the FleetSnapshot type along with types.ts compat;
// until then this adapter keeps the legacy return type stable.
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

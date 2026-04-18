/**
 * Telemetry swarm launcher — public entry point for UC_TELEMETRY.
 *
 * Given a satellite id + fish count, resolves the satellite's operator + bus
 * archetype, flattens the datasheet prior, and delegates to SwarmService.
 *
 * Perturbations: K fish, each with a distinct riskProfile persona. Optional
 * ±5% datasheet-range jitter per fish gives the aggregator spread.
 *
 * Returns LaunchSwarmResult from SwarmService — caller polls sim_swarm.status
 * until done/failed via the existing BullMQ fish/aggregate pipeline.
 */

import { sql } from "drizzle-orm";
import type { Database, SeedRefs, PerturbationSpec, SwarmConfig } from "@interview/db-schema";
import { createLogger, stepLog } from "@interview/shared/observability";
import type { SwarmService, LaunchSwarmResult } from "@interview/sweep";
import { lookupBusPrior } from "../bus-datasheets/loader";

const logger = createLogger("telemetry-swarm");

const DEFAULT_FISH_COUNT = 30;
const MAX_FISH_CONCURRENCY = 16; // stay under OpenAI nano tier RPM

export interface TelemetrySwarmOpts {
  satelliteId: number;
  /** K fish. Default 5 (conservative / balanced / aggressive / balanced×2). */
  fishCount?: number;
  /** Optional jitter on the published ranges, expressed as ±fraction (0..1). Default 0.05. */
  priorJitter?: number;
  config?: Partial<SwarmConfig>;
  createdBy?: number;
}

type RiskProfile = "conservative" | "balanced" | "aggressive";

function pickPersonas(k: number): RiskProfile[] {
  // Spread across the three extremes first, then oversample "balanced"
  // to keep the median anchored.
  const base: RiskProfile[] = ["conservative", "balanced", "aggressive"];
  const out: RiskProfile[] = [];
  for (let i = 0; i < k; i++) out.push(base[i % base.length]!);
  return out;
}

async function loadTargetContext(
  db: Database,
  satelliteId: number,
): Promise<{
  operatorId: number;
  satelliteName: string;
  busName: string | null;
} | null> {
  const rows = await db.execute(sql`
    SELECT
      s.id::int          AS id,
      s.name             AS name,
      s.operator_id::int AS operator_id,
      sb.name            AS bus_name
    FROM satellite s
    LEFT JOIN satellite_bus sb ON sb.id = s.satellite_bus_id
    WHERE s.id = ${BigInt(satelliteId)}
    LIMIT 1
  `);
  const r = rows.rows[0] as
    | { id: number; name: string; operator_id: number | null; bus_name: string | null }
    | undefined;
  if (!r) return null;
  if (r.operator_id == null) return null;
  return {
    operatorId: r.operator_id,
    satelliteName: r.name,
    busName: r.bus_name,
  };
}

export async function startTelemetrySwarm(
  deps: { db: Database; swarmService: SwarmService },
  opts: TelemetrySwarmOpts,
): Promise<LaunchSwarmResult> {
  const fishCount = opts.fishCount ?? DEFAULT_FISH_COUNT;

  stepLog(logger, "swarm", "start", {
    kind: "uc_telemetry_inference",
    satelliteId: opts.satelliteId,
    fishCount,
  });

  try {
  const target = await loadTargetContext(deps.db, opts.satelliteId);
  if (!target) {
    throw new Error(
      `Satellite ${opts.satelliteId} not found (or missing operator) — cannot launch telemetry swarm`,
    );
  }

  const priorLookup = lookupBusPrior(target.busName);
  if (!priorLookup.found) {
    logger.warn(
      { satelliteId: opts.satelliteId, busName: target.busName },
      "no bus datasheet matched — fish will infer without a published prior and cap confidence at 0.25",
    );
  }

  const baseSeed: SeedRefs = {
    operatorIds: [target.operatorId],
    telemetryTargetSatelliteId: opts.satelliteId,
    busDatasheetPrior: priorLookup.prior ?? undefined,
  };

  const personas = pickPersonas(fishCount);
  const perturbations: PerturbationSpec[] = personas.map((riskProfile, i) => ({
    kind: "persona_tweak",
    agentIndex: 0, // single-agent swarm — the target-operator persona
    riskProfile,
    ...(i > 2 ? {} : {}), // hook: datasheet_jitter perturbation could live here
  }));

  const cfg: SwarmConfig = {
    llmMode: opts.config?.llmMode ?? "cloud",
    quorumPct: opts.config?.quorumPct ?? 0.6,
    perFishTimeoutMs: opts.config?.perFishTimeoutMs ?? 60_000,
    fishConcurrency:
      opts.config?.fishConcurrency ??
      Math.min(fishCount, MAX_FISH_CONCURRENCY),
    nanoModel: opts.config?.nanoModel ?? "gpt-5-nano",
    seed: opts.config?.seed ?? Math.floor(Math.random() * 1_000_000),
  };

  const title = `uc_telemetry:${opts.satelliteId}:${target.satelliteName}`;
  const result = await deps.swarmService.launchSwarm({
    kind: "uc_telemetry_inference",
    title,
    baseSeed,
    perturbations,
    config: cfg,
    createdBy: opts.createdBy,
  });

  logger.info(
    {
      swarmId: result.swarmId,
      satelliteId: opts.satelliteId,
      busName: target.busName,
      busMatched: priorLookup.found,
      fishCount: result.fishCount,
    },
    "telemetry swarm launched",
  );

  stepLog(logger, "swarm", "done", {
    swarmId: result.swarmId,
    satelliteId: opts.satelliteId,
    fishCount: result.fishCount,
    busMatched: priorLookup.found,
  });

  return result;
  } catch (err) {
    stepLog(logger, "swarm", "error", {
      satelliteId: opts.satelliteId,
      err: (err as Error)?.message,
    });
    throw err;
  }
}

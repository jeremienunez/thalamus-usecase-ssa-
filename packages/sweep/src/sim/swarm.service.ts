/**
 * Swarm Service — fan out K fish, track quorum, fire aggregator.
 *
 * Orchestration flow:
 *   launchSwarm() → create sim_swarm + K sim_runs (via orchestrator.createFish)
 *                 → enqueue K swarmFish jobs
 *   swarm-fish.worker → drain fish turns inline → onFishComplete()
 *   onFishComplete() counts done+failed fish; when done+failed >= size,
 *                    enqueues swarmAggregate job (dedupe by swarmId).
 *   swarm-aggregate.worker → aggregator.aggregate(), swarmReporter.render(),
 *                            emitSuggestion() (UC3), mark swarm done.
 *
 * Failure semantics:
 *   - A fish that throws (LLM unrecoverable, DB error, timeout) is marked
 *     sim_run.status='failed'. The swarm continues until all fish are
 *     accounted for; the aggregator applies quorum threshold.
 *   - If done+failed >= size but succeeded < quorum, swarm transitions to
 *     'failed' with no suggestion emitted.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Queue } from "bullmq";
import type { Database } from "@interview/db-schema";
import { simRun, simSwarm } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";
import type { LaunchSwarmInput } from "./schema";
import type { SimOrchestrator } from "./sim-orchestrator.service";
import type { SwarmConfig, SimConfig, SimKind, SeedRefs, PerturbationSpec } from "./types";
import { applyPerturbation } from "./perturbation";

const logger = createLogger("swarm-service");

export interface SwarmFishJobPayload {
  swarmId: number;
  simRunId: number;
  fishIndex: number;
}

export interface SwarmAggregateJobPayload {
  swarmId: number;
}

export interface SwarmServiceDeps {
  db: Database;
  orchestrator: SimOrchestrator;
  swarmFishQueue: Queue<SwarmFishJobPayload>;
  swarmAggregateQueue: Queue<SwarmAggregateJobPayload>;
}

export interface LaunchSwarmOpts extends LaunchSwarmInput {
  createdBy?: number;
}

export interface LaunchSwarmResult {
  swarmId: number;
  fishCount: number;
  firstSimRunId: number;
}

export interface SwarmStatus {
  swarmId: number;
  kind: SimKind;
  status: "pending" | "running" | "done" | "failed";
  size: number;
  done: number;
  failed: number;
  running: number;
  pending: number;
  reportFindingId: number | null;
  suggestionId: number | null;
}

export class SwarmService {
  constructor(private readonly deps: SwarmServiceDeps) {}

  async launchSwarm(opts: LaunchSwarmOpts): Promise<LaunchSwarmResult> {
    const { kind, title, baseSeed, perturbations, config } = opts;
    if (perturbations.length < 1) {
      throw new Error("launchSwarm requires at least 1 perturbation");
    }
    if (kind === "uc3_conjunction" && (baseSeed.operatorIds?.length ?? 0) !== 2) {
      throw new Error("UC3 swarm requires exactly 2 operatorIds in baseSeed");
    }
    if (kind === "uc1_operator_behavior" && (baseSeed.operatorIds?.length ?? 0) < 1) {
      throw new Error("UC1 swarm requires at least 1 operatorId in baseSeed");
    }
    if (kind === "uc_telemetry_inference") {
      if ((baseSeed.operatorIds?.length ?? 0) !== 1) {
        throw new Error(
          "UC_TELEMETRY swarm requires exactly 1 operatorId in baseSeed (the target satellite's operator)",
        );
      }
      if (baseSeed.telemetryTargetSatelliteId == null) {
        throw new Error(
          "UC_TELEMETRY swarm requires baseSeed.telemetryTargetSatelliteId",
        );
      }
    }

    // 1. Insert sim_swarm row.
    const swarmConfig: SwarmConfig = {
      llmMode: config.llmMode,
      quorumPct: config.quorumPct,
      perFishTimeoutMs: config.perFishTimeoutMs,
      fishConcurrency: config.fishConcurrency,
      nanoModel: config.nanoModel,
      seed: config.seed,
    };
    const [swarmRow] = await this.deps.db
      .insert(simSwarm)
      .values({
        kind,
        title,
        baseSeed: baseSeed as SeedRefs,
        perturbations: perturbations as PerturbationSpec[],
        size: perturbations.length,
        config: swarmConfig,
        status: "running",
        createdBy: opts.createdBy !== undefined ? BigInt(opts.createdBy) : null,
      })
      .returning({ id: simSwarm.id });
    if (!swarmRow) throw new Error("insert sim_swarm returned no row");
    const swarmId = Number(swarmRow.id);

    // 2. For each perturbation, create a fish (sim_run + agents) via the
    // orchestrator, then enqueue its swarm-fish job.
    const maxTurns =
      kind === "uc3_conjunction" ? 20 : 15; // defaults; caller can override via config extensions later
    const firstSimRunIds: number[] = [];
    for (let i = 0; i < perturbations.length; i++) {
      const spec = perturbations[i] as PerturbationSpec;
      const fishSeed = applyPerturbation(baseSeed as SeedRefs, spec);
      const simConfig: SimConfig = {
        turnsPerDay: fishSeed.turnsPerDay ?? 1,
        maxTurns,
        llmMode: config.llmMode,
        seed: config.seed + i,
        nanoModel: config.nanoModel,
      };
      const fish = await this.deps.orchestrator.createFish({
        swarmId,
        fishIndex: i,
        kind,
        seedApplied: fishSeed,
        perturbation: spec,
        config: simConfig,
      });

      // Mark fish as running — the worker will drain its turns inline.
      await this.deps.db
        .update(simRun)
        .set({ status: "running" })
        .where(eq(simRun.id, BigInt(fish.simRunId)));

      await this.deps.swarmFishQueue.add(
        "swarm-fish",
        { swarmId, simRunId: fish.simRunId, fishIndex: i },
        { jobId: `swarm-${swarmId}-fish-${i}` },
      );
      firstSimRunIds.push(fish.simRunId);
    }

    logger.info(
      { swarmId, kind, fishCount: perturbations.length, concurrency: config.fishConcurrency },
      "swarm launched",
    );

    return {
      swarmId,
      fishCount: perturbations.length,
      firstSimRunId: firstSimRunIds[0],
    };
  }

  /**
   * Called by the swarm-fish worker after each fish completes (done or
   * failed). Enqueues the aggregate job once all fish are accounted for.
   */
  async onFishComplete(swarmId: number): Promise<{ aggregateEnqueued: boolean }> {
    const counts = await this.countFishByStatus(swarmId);
    const swarm = await this.loadSwarm(swarmId);
    if (!swarm) return { aggregateEnqueued: false };
    const accounted = counts.done + counts.failed;
    if (accounted < swarm.size) return { aggregateEnqueued: false };

    await this.deps.swarmAggregateQueue.add(
      "swarm-aggregate",
      { swarmId },
      { jobId: `swarm-${swarmId}-aggregate` },
    );
    logger.info(
      { swarmId, done: counts.done, failed: counts.failed, size: swarm.size },
      "all fish accounted for — aggregate enqueued",
    );
    return { aggregateEnqueued: true };
  }

  async status(swarmId: number): Promise<SwarmStatus | null> {
    const swarm = await this.loadSwarm(swarmId);
    if (!swarm) return null;
    const counts = await this.countFishByStatus(swarmId);
    return {
      swarmId,
      kind: swarm.kind,
      status: swarm.status,
      size: swarm.size,
      done: counts.done,
      failed: counts.failed,
      running: counts.running,
      pending: counts.pending,
      reportFindingId: swarm.outcomeReportFindingId,
      suggestionId: swarm.suggestionId,
    };
  }

  async abort(swarmId: number): Promise<void> {
    // Mark the swarm failed and cascade to any still-pending fish.
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(simSwarm)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(simSwarm.id, BigInt(swarmId)));
      await tx
        .update(simRun)
        .set({ status: "failed", completedAt: new Date() })
        .where(
          and(
            eq(simRun.swarmId, BigInt(swarmId)),
            sql`${simRun.status} IN ('pending','running')`,
          ),
        );
    });
    logger.warn({ swarmId }, "swarm aborted");
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private async loadSwarm(swarmId: number) {
    const rows = await this.deps.db.execute(sql`
      SELECT id, kind, size, status,
             outcome_report_finding_id, suggestion_id
      FROM sim_swarm WHERE id = ${BigInt(swarmId)} LIMIT 1
    `);
    const r = rows.rows[0] as
      | {
          id: string | number;
          kind: SimKind;
          size: number;
          status: "pending" | "running" | "done" | "failed";
          outcome_report_finding_id: string | number | null;
          suggestion_id: string | number | null;
        }
      | undefined;
    if (!r) return null;
    return {
      id: Number(r.id),
      kind: r.kind,
      size: r.size,
      status: r.status,
      outcomeReportFindingId: r.outcome_report_finding_id !== null ? Number(r.outcome_report_finding_id) : null,
      suggestionId: r.suggestion_id !== null ? Number(r.suggestion_id) : null,
    };
  }

  private async countFishByStatus(
    swarmId: number,
  ): Promise<{ done: number; failed: number; running: number; pending: number }> {
    const rows = await this.deps.db.execute(sql`
      SELECT status, count(*)::int AS c
      FROM sim_run WHERE swarm_id = ${BigInt(swarmId)}
      GROUP BY status
    `);
    const out = { done: 0, failed: 0, running: 0, pending: 0 };
    for (const row of rows.rows as Array<{ status: keyof typeof out; c: number }>) {
      if (row.status in out) out[row.status] = row.c;
    }
    return out;
  }
}

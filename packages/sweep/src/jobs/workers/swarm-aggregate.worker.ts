/**
 * swarm-aggregate worker — fires once per swarm when all fish are accounted for.
 *
 * Responsibilities:
 *   1. Call AggregatorService.aggregate(swarmId) → SwarmAggregate.
 *   2. (Optional, v0) Emit a coverage report via SimSwarmReporter once that
 *      service lands. For now, the aggregate is stored back on sim_swarm
 *      as JSONB so downstream consumers (routes, demos) can render.
 *   3. For UC3 when modal.fraction ≥ 0.5 AND modal.kind ∈ {accept, maneuver},
 *      emit a sweep_suggestion tagged with sim_swarm_id + distribution.
 *   4. Transition sim_swarm.status to 'done' (quorum met) or 'failed'
 *      (below quorum).
 */

import type { Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";
import { simSwarm } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";
import type { AggregatorService, SwarmAggregate } from "../../sim/aggregator.service";
import type {
  TelemetryAggregatorService,
  TelemetryAggregate,
} from "../../sim/aggregator-telemetry";
import type { SwarmAggregateJobPayload } from "../../sim/swarm.service";
import { createWorker } from "./helpers";

const logger = createLogger("swarm-aggregate-worker");

const MODAL_SUGGESTION_THRESHOLD = 0.5;

export interface SwarmAggregateWorkerDeps {
  db: Database;
  aggregator: AggregatorService;
  /**
   * Optional telemetry-specific aggregator. Required when any
   * uc_telemetry_inference swarm may land here; absent callers get narrative
   * UC1/UC3 aggregation only.
   */
  telemetryAggregator?: TelemetryAggregatorService;
  /** Callback to emit a sweep_suggestion from the modal outcome (UC3). */
  emitSuggestion?: (
    swarmId: number,
    aggregate: SwarmAggregate,
  ) => Promise<number | null>;
  /**
   * Callback to emit K sweep_suggestions (one per scalar) from a telemetry
   * inference aggregate. Required to close the UC_TELEMETRY loop end-to-end;
   * when absent, the swarm closes but no suggestions are emitted.
   */
  emitTelemetrySuggestions?: (
    swarmId: number,
    aggregate: TelemetryAggregate,
  ) => Promise<number[]>;
  concurrency?: number;
}

export function createSwarmAggregateWorker(
  deps: SwarmAggregateWorkerDeps,
): Worker<SwarmAggregateJobPayload> {
  return createWorker<SwarmAggregateJobPayload>({
    name: "swarm-aggregate",
    concurrency: deps.concurrency ?? 2,
    processor: async (job) => {
      const { swarmId } = job.data;

      // Route by swarm kind — telemetry inference takes a different
      // aggregator (scalar stats, not embedding clusters) and emits one
      // suggestion per scalar instead of one suggestion per modal action.
      const swarmKindRows = await deps.db.execute(sql`
        SELECT kind FROM sim_swarm WHERE id = ${BigInt(swarmId)} LIMIT 1
      `);
      const kind = (swarmKindRows.rows[0] as { kind?: string } | undefined)?.kind;

      if (kind === "uc_telemetry_inference") {
        if (!deps.telemetryAggregator) {
          throw new Error(
            `swarm ${swarmId} is uc_telemetry_inference but the worker was not configured with a telemetryAggregator — wire it in the DI container`,
          );
        }
        return await runTelemetryPath({
          db: deps.db,
          swarmId,
          telemetryAggregator: deps.telemetryAggregator,
          emitTelemetrySuggestions: deps.emitTelemetrySuggestions,
        });
      }

      const aggregate = await deps.aggregator.aggregate(swarmId);

      // Persist aggregate snapshot for downstream consumers.
      await deps.db.execute(sql`
        UPDATE sim_swarm
        SET config = jsonb_set(
              config,
              '{aggregate}',
              ${JSON.stringify(aggregate)}::jsonb,
              true
            )
        WHERE id = ${BigInt(swarmId)}
      `);

      // UC3 modal → suggestion (only when the callback is wired and modal is
      // non-ambiguous AND points at a concrete action). `kind` was resolved
      // at the top of the processor.
      let suggestionId: number | null = null;
      if (
        kind === "uc3_conjunction" &&
        aggregate.modal !== null &&
        aggregate.modal.fraction >= MODAL_SUGGESTION_THRESHOLD &&
        (aggregate.modal.actionKind === "accept" ||
          aggregate.modal.actionKind === "maneuver") &&
        deps.emitSuggestion
      ) {
        try {
          suggestionId = await deps.emitSuggestion(swarmId, aggregate);
        } catch (err) {
          logger.error(
            { swarmId, err: (err as Error).message },
            "emitSuggestion failed; swarm will still close",
          );
        }
      }

      // Transition swarm status.
      const finalStatus: "done" | "failed" = aggregate.quorumMet ? "done" : "failed";
      await deps.db
        .update(simSwarm)
        .set({
          status: finalStatus,
          completedAt: new Date(),
          suggestionId: suggestionId !== null ? BigInt(suggestionId) : null,
        })
        .where(eq(simSwarm.id, BigInt(swarmId)));

      logger.info(
        {
          swarmId,
          status: finalStatus,
          quorumMet: aggregate.quorumMet,
          modalKind: aggregate.modal?.actionKind ?? null,
          modalFraction: aggregate.modal?.fraction ?? null,
          suggestionId,
          divergenceScore: Number(aggregate.divergenceScore.toFixed(3)),
        },
        "swarm closed",
      );

      return { status: finalStatus, aggregate, suggestionId };
    },
  });
}

/**
 * uc_telemetry_inference close-out.
 *
 * 1. TelemetryAggregatorService computes per-scalar {median, σ, n}.
 * 2. emitTelemetrySuggestions (when wired) emits one sweep_suggestion per
 *    scalar with provenance.source = "sim_swarm_telemetry".
 * 3. sim_swarm.status transitions to done / failed based on quorum.
 */
async function runTelemetryPath(args: {
  db: Database;
  swarmId: number;
  telemetryAggregator: TelemetryAggregatorService;
  emitTelemetrySuggestions?: (
    swarmId: number,
    aggregate: TelemetryAggregate,
  ) => Promise<number[]>;
}): Promise<{
  status: "done" | "failed";
  telemetryAggregate: TelemetryAggregate | null;
  suggestionIds: number[];
}> {
  const aggregate = await args.telemetryAggregator.aggregate({
    swarmId: args.swarmId,
  });

  if (!aggregate) {
    await args.db
      .update(simSwarm)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simSwarm.id, BigInt(args.swarmId)));
    logger.warn(
      { swarmId: args.swarmId },
      "telemetry aggregate returned null — marking swarm failed",
    );
    return { status: "failed", telemetryAggregate: null, suggestionIds: [] };
  }

  // Snapshot the aggregate on sim_swarm.config for downstream rendering.
  await args.db.execute(sql`
    UPDATE sim_swarm
    SET config = jsonb_set(
          config,
          '{telemetryAggregate}',
          ${JSON.stringify(aggregate)}::jsonb,
          true
        )
    WHERE id = ${BigInt(args.swarmId)}
  `);

  let suggestionIds: number[] = [];
  if (args.emitTelemetrySuggestions && aggregate.quorumMet) {
    try {
      suggestionIds = await args.emitTelemetrySuggestions(args.swarmId, aggregate);
    } catch (err) {
      logger.error(
        { swarmId: args.swarmId, err: (err as Error).message },
        "emitTelemetrySuggestions failed; swarm will still close",
      );
    }
  }

  const finalStatus: "done" | "failed" = aggregate.quorumMet ? "done" : "failed";
  await args.db
    .update(simSwarm)
    .set({
      status: finalStatus,
      completedAt: new Date(),
      // sim_swarm.suggestionId is scalar; for telemetry we emit N suggestions.
      // Store the first id as a pointer; the full list lives on config.telemetryAggregate.
      suggestionId: suggestionIds.length > 0 ? BigInt(suggestionIds[0]!) : null,
    })
    .where(eq(simSwarm.id, BigInt(args.swarmId)));

  logger.info(
    {
      swarmId: args.swarmId,
      status: finalStatus,
      quorumMet: aggregate.quorumMet,
      scalarsCount: Object.keys(aggregate.scalars).length,
      suggestionCount: suggestionIds.length,
      simConfidence: Number(aggregate.simConfidence.toFixed(3)),
    },
    "telemetry swarm closed",
  );

  return { status: finalStatus, telemetryAggregate: aggregate, suggestionIds };
}

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
import type { SwarmAggregateJobPayload } from "../../sim/swarm.service";
import { createWorker } from "./helpers";

const logger = createLogger("swarm-aggregate-worker");

const MODAL_SUGGESTION_THRESHOLD = 0.5;

export interface SwarmAggregateWorkerDeps {
  db: Database;
  aggregator: AggregatorService;
  /** Callback to emit a sweep_suggestion from the modal outcome (UC3). */
  emitSuggestion?: (
    swarmId: number,
    aggregate: SwarmAggregate,
  ) => Promise<number | null>;
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
      // non-ambiguous AND points at a concrete action).
      let suggestionId: number | null = null;
      const swarmKindRows = await deps.db.execute(sql`
        SELECT kind FROM sim_swarm WHERE id = ${BigInt(swarmId)} LIMIT 1
      `);
      const kind = (swarmKindRows.rows[0] as { kind?: string } | undefined)?.kind;

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

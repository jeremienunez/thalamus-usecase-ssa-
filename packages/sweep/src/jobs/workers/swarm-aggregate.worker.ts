import type { Worker } from "bullmq";
import { createLogger } from "@interview/shared/observability";
import type {
  SimOutcomeResolver,
  SimSwarmStore,
} from "../../sim/ports";
import type { SwarmAggregateJobPayload } from "../../sim/swarm.service";
import { createWorker } from "./helpers";

const logger = createLogger("swarm-aggregate-worker");

export interface SwarmAggregateWorkerDeps {
  swarmStore: SimSwarmStore;
  resolver: SimOutcomeResolver;
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
      const [swarm, terminals] = await Promise.all([
        deps.swarmStore.getSwarm(swarmId),
        deps.swarmStore.listTerminalsForSwarm(swarmId),
      ]);
      if (!swarm) {
        throw new Error(`sim_swarm ${swarmId} not found`);
      }

      const resolved = await deps.resolver.resolve({
        swarmId,
        terminals,
        swarm: {
          id: swarm.id,
          kind: swarm.kind,
          size: swarm.size,
          config: swarm.config as unknown as Record<string, unknown>,
          baseSeed: swarm.baseSeed as Record<string, unknown>,
        },
      });

      if (resolved.snapshotKey && resolved.snapshot) {
        await deps.swarmStore.snapshotAggregate({
          swarmId,
          key: resolved.snapshotKey,
          value: resolved.snapshot,
        });
      }

      await deps.swarmStore.closeSwarm({
        swarmId,
        status: resolved.status,
        ...(resolved.primarySuggestionId === undefined
          ? {}
          : { suggestionId: resolved.primarySuggestionId }),
        ...(resolved.reportFindingId === undefined
          ? {}
          : { reportFindingId: resolved.reportFindingId }),
      });

      logger.info(
        {
          swarmId,
          status: resolved.status,
          snapshotKey: resolved.snapshotKey ?? null,
          suggestionId: resolved.primarySuggestionId ?? null,
          reportFindingId: resolved.reportFindingId ?? null,
        },
        "swarm closed",
      );

      return resolved;
    },
  });
}

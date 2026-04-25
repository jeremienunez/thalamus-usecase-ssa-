import { createLogger } from "@interview/shared/observability";
import type { SimOrchestrator } from "./sim-orchestrator.service";
import type { SwarmConfig, SimConfig, SimKind } from "./types";
import type {
  SwarmAggregateGate,
  SimKindGuard,
  SimPerturbationPack,
  SimQueuePort,
  SimRuntimeStore,
  SimSwarmStore,
} from "./ports";

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
  store: SimRuntimeStore;
  swarmStore: SimSwarmStore;
  orchestrator: SimOrchestrator;
  queue: SimQueuePort;
  aggregateGate: SwarmAggregateGate;
  kindGuard: SimKindGuard;
  perturbationPack: SimPerturbationPack;
}

export interface LaunchSwarmOpts {
  kind: string;
  title: string;
  baseSeed: Record<string, unknown>;
  perturbations: Array<Record<string, unknown>>;
  config: {
    llmMode: "cloud" | "fixtures" | "record";
    quorumPct: number;
    perFishTimeoutMs: number;
    fishConcurrency: number;
    nanoModel: string;
    seed: number;
  };
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
  timeout: number;
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
    if (!isNoopPerturbation(perturbations[0])) {
      throw new Error("launchSwarm requires fish 0 perturbation to be { kind: \"noop\" }");
    }
    this.deps.kindGuard.validateLaunch({ kind, baseSeed });

    const swarmConfig: SwarmConfig = {
      llmMode: config.llmMode,
      quorumPct: config.quorumPct,
      perFishTimeoutMs: config.perFishTimeoutMs,
      fishConcurrency: config.fishConcurrency,
      nanoModel: config.nanoModel,
      seed: config.seed,
    };
    const swarmId = await this.deps.store.insertSwarm({
      kind,
      title,
      baseSeed,
      perturbations: perturbations as Array<{ kind: string; [key: string]: unknown }>,
      size: perturbations.length,
      config: swarmConfig,
      status: "running",
      createdBy: opts.createdBy ?? null,
    });
    await this.deps.aggregateGate.reset(swarmId);

    const maxTurns = this.deps.kindGuard.defaultMaxTurns(kind);
    const firstSimRunIds: number[] = [];
    for (let i = 0; i < perturbations.length; i++) {
      const spec = perturbations[i];
      const fishSeed = this.deps.perturbationPack.applyToSeed({
        baseSeed,
        spec,
      });
      const simConfig: SimConfig = {
        turnsPerDay: readPositiveInt(fishSeed.turnsPerDay, 1),
        maxTurns,
        llmMode: config.llmMode,
        seed: config.seed + i,
        nanoModel: config.nanoModel,
        perFishTimeoutMs: config.perFishTimeoutMs,
      };
      const fish = await this.deps.orchestrator.createFish({
        swarmId,
        fishIndex: i,
        kind,
        seedApplied: fishSeed,
        perturbation: spec as { kind: string; [key: string]: unknown },
        config: simConfig,
      });

      firstSimRunIds.push(fish.simRunId);
    }

    await this.activatePendingFish(swarmId, swarmConfig);

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

  async onFishComplete(swarmId: number): Promise<{ aggregateEnqueued: boolean }> {
    const swarm = await this.loadSwarm(swarmId);
    if (!swarm) return { aggregateEnqueued: false };
    await this.activatePendingFish(swarmId, swarm.config);
    const counts = await this.countFishByStatus(swarmId);
    const accounted = counts.done + counts.failed + counts.timeout;
    if (accounted < swarm.size) return { aggregateEnqueued: false };
    const claimed = await this.deps.aggregateGate.claim(swarmId);
    if (!claimed) {
      logger.debug(
        {
          swarmId,
          done: counts.done,
          failed: counts.failed,
          timeout: counts.timeout,
          size: swarm.size,
        },
        "aggregate already claimed for swarm",
      );
      return { aggregateEnqueued: false };
    }

    try {
      await this.deps.queue.enqueueSwarmAggregate({
        swarmId,
        jobId: `swarm-${swarmId}-aggregate`,
      });
    } catch (error) {
      await this.deps.aggregateGate.release(swarmId);
      throw error;
    }
    logger.info(
      {
        swarmId,
        done: counts.done,
        failed: counts.failed,
        timeout: counts.timeout,
        size: swarm.size,
      },
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
      timeout: counts.timeout,
      running: counts.running,
      pending: counts.pending,
      reportFindingId: swarm.outcomeReportFindingId,
      suggestionId: swarm.suggestionId,
    };
  }

  async abort(swarmId: number): Promise<void> {
    await this.deps.swarmStore.abortSwarm(swarmId);
    logger.warn({ swarmId }, "swarm aborted");
  }

  private async loadSwarm(swarmId: number) {
    return this.deps.swarmStore.getSwarm(swarmId);
  }

  private async countFishByStatus(
    swarmId: number,
  ): Promise<{ done: number; failed: number; timeout: number; running: number; pending: number }> {
    const counts = await this.deps.swarmStore.countFishByStatus(swarmId);
    return {
      done: counts.done,
      failed: counts.failed,
      timeout: counts.timeout,
      running: counts.running,
      pending: counts.pending,
    };
  }

  private async activatePendingFish(
    swarmId: number,
    config: Pick<SwarmConfig, "fishConcurrency">,
  ): Promise<number> {
    const counts = await this.countFishByStatus(swarmId);
    if (counts.pending < 1) return 0;
    const fishConcurrency = readPositiveInt(config.fishConcurrency, 1);
    const openSlots = fishConcurrency - counts.running;
    if (openSlots < 1) return 0;

    const claimed = await this.deps.swarmStore.claimPendingFishForSwarm(
      swarmId,
      Math.min(openSlots, counts.pending),
    );
    for (const fish of claimed) {
      await this.deps.queue.enqueueSwarmFish({
        swarmId,
        simRunId: fish.simRunId,
        fishIndex: fish.fishIndex,
        jobId: `swarm-${swarmId}-fish-${fish.fishIndex}`,
      });
    }
    if (claimed.length > 0) {
      logger.info(
        {
          swarmId,
          claimed: claimed.length,
          fishConcurrency,
          runningBefore: counts.running,
          pendingBefore: counts.pending,
        },
        "swarm fish claimed and enqueued",
      );
    }
    return claimed.length;
  }
}

function readPositiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function isNoopPerturbation(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "noop"
  );
}

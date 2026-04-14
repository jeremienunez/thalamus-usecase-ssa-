/**
 * Sweep DI container — wires Redis-backed sweep repos with the SatelliteRepository
 * and Thalamus's ResearchGraphService for cross-domain KG logging.
 *
 * Also wires the sim-engine services (SPEC-SW-006): MemoryService, the two
 * turn runners (DAG for UC1, Sequential for UC3), the orchestrator, and the
 * god channel. The sim-turn BullMQ worker must be constructed separately
 * via createSimTurnWorker(container) — workers are process-scoped, not
 * container-scoped, so we don't spin them up eagerly here.
 */

import type IORedis from "ioredis";
import type { Database } from "@interview/db-schema";
import type { CortexRegistry } from "@interview/thalamus";
import type { ResearchGraphService } from "@interview/thalamus/services/research-graph.service";
import { SatelliteRepository } from "../repositories/satellite.repository";
import { SweepRepository } from "../repositories/sweep.repository";
import { NanoSweepService } from "../services/nano-sweep.service";
import { SweepResolutionService } from "../services/sweep-resolution.service";
import { MessagingService } from "../services/messaging.service";
import { AdminSweepController } from "../controllers/admin-sweep.controller";
import { MemoryService, type EmbedFn } from "../sim/memory.service";
import { SequentialTurnRunner } from "../sim/turn-runner-sequential";
import { DagTurnRunner } from "../sim/turn-runner-dag";
import { SimOrchestrator } from "../sim/sim-orchestrator.service";
import { GodChannelService } from "../sim/god-channel.service";
import { AggregatorService } from "../sim/aggregator.service";
import { SwarmService } from "../sim/swarm.service";
import {
  simTurnQueue,
  swarmFishQueue,
  swarmAggregateQueue,
} from "../jobs/queues";

export interface AdminControllers {
  sweep: AdminSweepController;
}

export interface SimServices {
  memoryService: MemoryService;
  sequentialRunner: SequentialTurnRunner;
  dagRunner: DagTurnRunner;
  orchestrator: SimOrchestrator;
  godChannel: GodChannelService;
  aggregator: AggregatorService;
  swarmService: SwarmService;
}

export interface SweepContainer {
  satelliteRepo: SatelliteRepository;
  sweepRepo: SweepRepository;
  nanoSweepService: NanoSweepService;
  resolutionService: SweepResolutionService;
  messagingService: MessagingService;
  adminControllers: AdminControllers;
  sim?: SimServices;
}

export interface BuildSweepOpts {
  db: Database;
  redis: IORedis;
  /** Optional graph service injected so resolutions can log to the KG */
  graphService?: ResearchGraphService;
  /** Optional sim-engine deps. When supplied, container.sim is wired. */
  sim?: {
    cortexRegistry: CortexRegistry;
    embed: EmbedFn;
    llmMode: "cloud" | "fixtures" | "record";
  };
}

export function buildSweepContainer(opts: BuildSweepOpts): SweepContainer {
  const { db, redis } = opts;

  const satelliteRepo = new SatelliteRepository(db);
  const sweepRepo = new SweepRepository(redis);
  const messagingService = new MessagingService();

  const nanoSweepService = new NanoSweepService(satelliteRepo, sweepRepo);
  const resolutionService = new SweepResolutionService(
    satelliteRepo,
    sweepRepo,
    opts.graphService ?? null,
    db,
  );

  const adminControllers: AdminControllers = {
    sweep: new AdminSweepController(
      nanoSweepService,
      sweepRepo,
      resolutionService,
    ),
  };

  let sim: SimServices | undefined;
  if (opts.sim) {
    const memoryService = new MemoryService(db, opts.sim.embed);
    const sequentialRunner = new SequentialTurnRunner({
      db,
      memory: memoryService,
      cortexRegistry: opts.sim.cortexRegistry,
      llmMode: opts.sim.llmMode,
    });
    const dagRunner = new DagTurnRunner({
      db,
      memory: memoryService,
      cortexRegistry: opts.sim.cortexRegistry,
      llmMode: opts.sim.llmMode,
    });
    const orchestrator = new SimOrchestrator({ db, simTurnQueue });
    const godChannel = new GodChannelService(orchestrator);
    const aggregator = new AggregatorService({ db, embed: opts.sim.embed });
    const swarmService = new SwarmService({
      db,
      orchestrator,
      swarmFishQueue,
      swarmAggregateQueue,
    });
    sim = {
      memoryService,
      sequentialRunner,
      dagRunner,
      orchestrator,
      godChannel,
      aggregator,
      swarmService,
    };
  }

  return {
    satelliteRepo,
    sweepRepo,
    nanoSweepService,
    resolutionService,
    messagingService,
    adminControllers,
    sim,
  };
}

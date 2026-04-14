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
import { TelemetryAggregatorService } from "../sim/aggregator-telemetry";
import { SwarmService } from "../sim/swarm.service";
import { ConfidenceService } from "@interview/thalamus";
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
  telemetryAggregator: TelemetryAggregatorService;
  swarmService: SwarmService;
  /**
   * Shared ConfidenceService instance — in-memory for now (SPEC-TH-040
   * pure algorithmic core). Passed to the sweep-resolution onSimUpdateAccepted
   * hook so reviewer-accepted sim inferences get their source_class bumped.
   */
  confidenceService: ConfidenceService;
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
    const telemetryAggregator = new TelemetryAggregatorService({ db });
    const swarmService = new SwarmService({
      db,
      orchestrator,
      swarmFishQueue,
      swarmAggregateQueue,
    });
    const confidenceService = new ConfidenceService();

    // Wire reviewer-accept of a sim-swarm-telemetry suggestion to a
    // ConfidenceService promotion. We treat the suggestion's (satelliteId,
    // field) pair as the edge id (stable int fingerprint). On first accept
    // the edge is initialised in SIM_UNCORROBORATED, then promoted via
    // reviewer-accept evidence to OSINT_CORROBORATED.
    resolutionService.setOnSimUpdateAccepted(async (event) => {
      const edgeId = telemetryEdgeId(event.satelliteId, event.field);
      try {
        await confidenceService.read(edgeId);
      } catch {
        // First-time accept — seed the edge in SIM_UNCORROBORATED so the
        // promotion below is a legitimate transition, not a bare insert.
        confidenceService.initialWrite(edgeId);
      }
      await confidenceService.promote({
        edgeId,
        evidence: {
          kind: "reviewer-accept",
          analystId: 0, // no analyst-user model yet; 0 = system accept
          citation: `sim_swarm:${event.swarmId ?? "?"} field=${event.field}`,
        },
      });
    });

    sim = {
      memoryService,
      sequentialRunner,
      dagRunner,
      orchestrator,
      godChannel,
      aggregator,
      telemetryAggregator,
      swarmService,
      confidenceService,
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

/**
 * Deterministic edge id derived from (satelliteId, field).
 *
 * ConfidenceService.edges is keyed by a numeric edgeId — for telemetry we
 * don't have a real research_edge row; we synthesise one so promotions are
 * idempotent across (sat, field) pairs.
 *
 * FNV-1a 32-bit over `"${satelliteId}:${field}"` bit-shifted into positive
 * range. Collision probability across our ~1500 sats × 8 fields = 12k pairs
 * is negligible on a 2^31 space.
 */
function telemetryEdgeId(satelliteId: bigint, field: string): number {
  const s = `${satelliteId.toString()}:${field}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 1; // clear the sign bit — stay in the positive 31-bit range
}

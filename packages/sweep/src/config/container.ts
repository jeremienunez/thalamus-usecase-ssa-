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
import type {
  FindingDomainSchema,
  DomainAuditProvider,
  SweepPromotionAdapter,
  FindingRoutingPolicy,
  ResolutionHandlerRegistry,
  IngestionSourceProvider,
} from "../ports";
import type { SimFleetProvider, SimTurnTargetProvider } from "../sim/ports";
import { LegacySsaFleetProvider } from "../sim/legacy-ssa-fleet";
import { LegacySsaTurnTargetProvider } from "../sim/legacy-ssa-targets";
import { SatelliteRepository } from "../repositories/satellite.repository";
import { SweepRepository } from "../repositories/sweep.repository";
import {
  NanoSweepService,
  LegacyNanoSweepAuditProvider,
} from "../services/nano-sweep.service";
import {
  SweepResolutionService,
  type OnSimUpdateAccepted,
} from "../services/sweep-resolution.service";
import { createLegacySsaResolutionRegistry } from "../services/legacy-ssa-resolution";
import { LegacySsaPromotionAdapter } from "../services/legacy-ssa-promotion";
import { MessagingService } from "../services/messaging.service";
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
    /**
     * Plan 2 · B.1 — SimFleetProvider port. When omitted, the container
     * constructs LegacySsaFleetProvider (sweep-internal fallback). Console-api
     * injects SsaFleetProvider (agent/ssa/sim/fleet-provider.ts).
     */
    fleet?: SimFleetProvider;
    /**
     * Plan 2 · B.2 — SimTurnTargetProvider port. When omitted, falls back
     * to LegacySsaTurnTargetProvider.
     */
    targets?: SimTurnTargetProvider;
  };
  /**
   * Optional port overrides. When a field is supplied, the container skips
   * its legacy SSA-inlined construction and uses the injected port.
   * Wired incrementally across Plan 1 Phases 2-3; unused here but typed so
   * callers can start passing them without waiting for the full cutover.
   */
  ports?: {
    findingSchema?: FindingDomainSchema;
    audit?: DomainAuditProvider;
    promotion?: SweepPromotionAdapter;
    findingRouting?: FindingRoutingPolicy;
    resolutionHandlers?: ResolutionHandlerRegistry;
    ingestion?: IngestionSourceProvider[];
  };
}

export function buildSweepContainer(opts: BuildSweepOpts): SweepContainer {
  const { db, redis } = opts;

  const satelliteRepo = new SatelliteRepository(db);
  const sweepRepo = opts.ports?.findingSchema
    ? new SweepRepository({ redis, schema: opts.ports.findingSchema })
    : new SweepRepository(redis);
  const messagingService = new MessagingService();

  // Audit provider: prefer injected port; otherwise fall back to the
  // legacy SSA pipeline preserved inside the sweep package. Remove the
  // fallback in Phase 4 once console-api is the sole wiring path.
  const auditProvider =
    opts.ports?.audit ??
    new LegacyNanoSweepAuditProvider(satelliteRepo, sweepRepo);
  const nanoSweepService = new NanoSweepService({
    audit: auditProvider,
    sweepRepo,
    domain: "ssa",
  });

  // Resolution: prefer injected ports; otherwise fall back to the legacy
  // SSA registry + promotion adapter preserved inside the sweep package.
  // The sim-provenance hook (onSimUpdateAccepted) is wired via the legacy
  // registry's deps lazily — the cb is supplied after confidenceService
  // exists, in the opts.sim block below. We use a mutable holder so the
  // container can fill it after construction.
  const simHook: { cb: OnSimUpdateAccepted | null } = { cb: null };
  const legacyResolutionRegistry =
    opts.ports?.resolutionHandlers ??
    createLegacySsaResolutionRegistry({
      db,
      satelliteRepo,
      // Defer to the mutable holder so the sim block below can inject
      // after confidenceService is built.
      onSimUpdateAccepted: (event) => simHook.cb?.(event) ?? Promise.resolve(),
    });
  const legacyPromotion =
    opts.ports?.promotion ??
    new LegacySsaPromotionAdapter({
      db,
      graphService: opts.graphService ?? null,
    });
  const resolutionService = new SweepResolutionService({
    registry: legacyResolutionRegistry,
    promotion: legacyPromotion,
    sweepRepo,
  });

  let sim: SimServices | undefined;
  if (opts.sim) {
    // Plan 2 · B.1 / B.2 — sim ports: use the injected SSA providers or
    // fall back to the legacy SQL adapters (allowlisted until Étape 4).
    const fleet: SimFleetProvider =
      opts.sim.fleet ?? new LegacySsaFleetProvider(db);
    const targets: SimTurnTargetProvider =
      opts.sim.targets ?? new LegacySsaTurnTargetProvider(db);
    const memoryService = new MemoryService(db, opts.sim.embed, fleet);
    const sequentialRunner = new SequentialTurnRunner({
      db,
      memory: memoryService,
      cortexRegistry: opts.sim.cortexRegistry,
      llmMode: opts.sim.llmMode,
      targets,
    });
    const dagRunner = new DagTurnRunner({
      db,
      memory: memoryService,
      cortexRegistry: opts.sim.cortexRegistry,
      llmMode: opts.sim.llmMode,
      targets,
    });
    const orchestrator = new SimOrchestrator({ db, simTurnQueue, fleet });
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
    //
    // Plan 1 Task 2.3: the cb flows into the legacy resolution registry's
    // update_field handler via the simHook mutable holder. Plan 2 will move
    // this into a dedicated sim promotion path on the port.
    simHook.cb = async (event) => {
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
    };

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

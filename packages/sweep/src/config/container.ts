/**
 * Sweep DI container — wires Redis-backed sweep repos and the sim-engine
 * services (SPEC-SW-006: MemoryService, two turn runners, orchestrator,
 * god channel). The sim-turn BullMQ worker is built separately via
 * createSimTurnWorker(container) — workers are process-scoped, not
 * container-scoped.
 *
 * Domain-owned data access is the caller's responsibility through the
 * injected ports (DomainAuditProvider, SweepPromotionAdapter,
 * ResolutionHandlerRegistry, IngestionSourceProvider). The package holds
 * zero app-owned DB code.
 */

import type IORedis from "ioredis";
import type { CortexRegistry } from "@interview/thalamus";
import type {
  FindingDomainSchema,
  DomainAuditProvider,
  SweepPromotionAdapter,
  FindingRoutingPolicy,
  ResolutionHandlerRegistry,
  IngestionSourceProvider,
} from "../ports";
import type {
  SimSubjectProvider,
  SimQueuePort,
  SimRuntimeStore,
  SimScenarioContextProvider,
  SimSwarmStore,
  SimAgentPersonaComposer,
  SimPromptComposer,
  SimCortexSelector,
  SimActionSchemaProvider,
  SimPerturbationPack,
  SimAggregationStrategy,
  SimKindGuard,
} from "../sim/ports";
import { SweepRepository } from "../repositories/sweep.repository";
import { NanoSweepService } from "../services/nano-sweep.service";
import { SweepResolutionService } from "../services/sweep-resolution.service";
import { MessagingService } from "../services/messaging.service";
import { MemoryService, type EmbedFn } from "../sim/memory.service";
import { SequentialTurnRunner } from "../sim/turn-runner-sequential";
import { DagTurnRunner } from "../sim/turn-runner-dag";
import { SimOrchestrator } from "../sim/sim-orchestrator.service";
import { AggregatorService } from "../sim/aggregator.service";
import { SwarmService } from "../sim/swarm.service";
import { RedisSwarmAggregateGate } from "../sim/swarm-aggregate-gate";
import { ConfidenceService } from "@interview/thalamus";

export interface SimServices {
  memoryService: MemoryService;
  sequentialRunner: SequentialTurnRunner;
  dagRunner: DagTurnRunner;
  orchestrator: SimOrchestrator;
  aggregator: AggregatorService;
  swarmService: SwarmService;
  /**
   * Shared ConfidenceService instance — in-memory for now (SPEC-TH-040
   * pure algorithmic core). Passed to the sweep-resolution onSimUpdateAccepted
   * hook so reviewer-accepted sim inferences get their source_class bumped.
   */
  confidenceService: ConfidenceService;
}

export interface SweepContainer {
  sweepRepo: SweepRepository;
  nanoSweepService: NanoSweepService;
  resolutionService: SweepResolutionService;
  messagingService: MessagingService;
  sim?: SimServices;
}

export interface BuildSweepOpts {
  redis: IORedis;
  /**
   * Optional sim-engine deps. When supplied, container.sim is wired.
   * Plan 2 · B.11: every sim port is REQUIRED. Callers must inject a
   * concrete implementation — no sweep-internal fallback.
   */
  sim?: {
    cortexRegistry: CortexRegistry;
    embed: EmbedFn;
    llmMode: "cloud" | "fixtures" | "record";
    queue: SimQueuePort;
    runtimeStore: SimRuntimeStore;
    swarmStore: SimSwarmStore;
    subjects: SimSubjectProvider;
    scenarioContext: SimScenarioContextProvider;
    persona: SimAgentPersonaComposer;
    prompt: SimPromptComposer;
    cortexSelector: SimCortexSelector;
    schemaProvider: SimActionSchemaProvider;
    perturbationPack: SimPerturbationPack;
    aggStrategy: SimAggregationStrategy;
    kindGuard: SimKindGuard;
  };
  /**
   * App-owned sweep ports.
   *
   * The package no longer carries fallback implementations: every
   * boundary-crossing concern (audit, promotion, resolution handlers) is
   * injected by the caller. The app supplies the adapters; the CLI and E2E
   * supply disabled stubs because they don't run those paths in-process.
   */
  ports: {
    findingSchema?: FindingDomainSchema;
    findingDomain?: string;
    audit: DomainAuditProvider;
    promotion: SweepPromotionAdapter;
    findingRouting?: FindingRoutingPolicy;
    resolutionHandlers: ResolutionHandlerRegistry;
    ingestion?: IngestionSourceProvider[];
  };
}

export function buildSweepContainer(opts: BuildSweepOpts): SweepContainer {
  const { redis } = opts;

  const sweepRepo = opts.ports.findingSchema
    ? new SweepRepository({
        redis,
        schema: opts.ports.findingSchema,
        domain: opts.ports.findingDomain,
      })
    : new SweepRepository(redis);
  const messagingService = new MessagingService();

  const nanoSweepService = new NanoSweepService({
    audit: opts.ports.audit,
    sweepRepo,
    domain: opts.ports.findingDomain ?? "generic",
  });

  const resolutionService = new SweepResolutionService({
    registry: opts.ports.resolutionHandlers,
    promotion: opts.ports.promotion,
    sweepRepo,
  });

  let sim: SimServices | undefined;
  if (opts.sim) {
    // Plan 2 · B.11: sim ports are required — caller injects every
    // concrete implementation. Sweep-internal fallbacks deleted.
    const {
      queue,
      subjects,
      runtimeStore,
      swarmStore,
      scenarioContext,
      persona,
      prompt,
      cortexSelector,
      schemaProvider,
      perturbationPack,
      aggStrategy,
      kindGuard,
    } = opts.sim;
    const memoryService = new MemoryService(runtimeStore, opts.sim.embed, subjects);
    const sequentialRunner = new SequentialTurnRunner({
      store: runtimeStore,
      memory: memoryService,
      cortexRegistry: opts.sim.cortexRegistry,
      llmMode: opts.sim.llmMode,
      targets: scenarioContext,
      prompt,
      cortexSelector,
      schemaProvider,
    });
    const dagRunner = new DagTurnRunner({
      store: runtimeStore,
      memory: memoryService,
      cortexRegistry: opts.sim.cortexRegistry,
      llmMode: opts.sim.llmMode,
      targets: scenarioContext,
      prompt,
      cortexSelector,
      schemaProvider,
    });
    const orchestrator = new SimOrchestrator({
      store: runtimeStore,
      queue,
      subjects,
      persona,
      perturbationPack,
    });
    const aggregator = new AggregatorService({
      swarmStore,
      embed: opts.sim.embed,
      strategy: aggStrategy,
    });
    const swarmService = new SwarmService({
      store: runtimeStore,
      swarmStore,
      orchestrator,
      queue,
      aggregateGate: new RedisSwarmAggregateGate(redis),
      kindGuard,
      perturbationPack,
    });
    // Sim source-class promotion is now owned by the injected promotion
    // adapter. The legacy in-package simHook → registry chain
    // was removed when ports.promotion + ports.resolutionHandlers became
    // required (CLAUDE.md §3.2 — no second contract).
    const confidenceService = new ConfidenceService();

    sim = {
      memoryService,
      sequentialRunner,
      dagRunner,
      orchestrator,
      aggregator,
      swarmService,
      confidenceService,
    };
  }

  return {
    sweepRepo,
    nanoSweepService,
    resolutionService,
    messagingService,
    sim,
  };
}

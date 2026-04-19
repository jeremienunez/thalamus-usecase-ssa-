// apps/console-api/src/container.ts
/**
 * Composition root for the console-api layered stack.
 *
 * Consumes a pre-built `ContainerConfig` (db, redis, webSearch) from the
 * caller — env reading lives in `server.ts`. Tests inject their own
 * infra. `close()` is the caller's responsibility for infra; this
 * function only returns a no-op close (routes tear down via Fastify).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type Redis from "ioredis";
import type * as schema from "@interview/db-schema";
import type { FastifyBaseLogger } from "fastify";
import {
  buildThalamusContainer,
  setNanoConfigProvider,
  setNanoSwarmConfigProvider,
  setNanoSwarmProfile,
  setCuratorPrompt,
  type WebSearchPort,
} from "@interview/thalamus";
import {
  SSA_NANO_SWARM_PROFILE,
  SSA_CURATOR_PROMPT,
} from "./prompts";
import {
  buildSweepContainer,
  createIngestionRegistry,
  createIngestionWorker,
  ingestionQueue,
  registerSchedulers,
  SimSubjectHttpAdapter,
  SimHttpClient,
  type SimHttpTransport,
  SimQueueHttpAdapter,
  SimRuntimeStoreHttpAdapter,
  SimSwarmStoreHttpAdapter,
  SimScenarioContextHttpAdapter,
  simTurnQueue,
  swarmAggregateQueue,
  swarmFishQueue,
  type SuggestionFeedbackRow,
} from "@interview/sweep";
import { IngestionService } from "./services/ingestion.service";

// SSA sweep pack — port implementations consumed by buildSweepContainer.
import {
  ssaFindingSchema,
  SsaPromotionAdapter,
  createSsaResolutionRegistry,
  SsaAuditProvider,
  SsaFindingRoutingPolicy,
  createSsaIngestionProvider,
} from "./agent/ssa/sweep";
import {
  SsaActionSchemaProvider,
  SsaAggregationStrategy,
  SsaCortexSelector,
  SsaKindGuard,
  SsaPersonaComposer,
  SsaPerturbationPack,
  SsaPromptRenderer,
  startPcEstimatorSwarm,
  startTelemetrySwarm,
} from "./agent/ssa/sim";

export const SSA_SKILLS_DIR = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "./agent/ssa/skills",
);

export interface ContainerConfig {
  db: NodePgDatabase<typeof schema>;
  redis: Redis;
  webSearch: WebSearchPort;
  simLlmMode?: "cloud" | "fixtures" | "record";
  simKernelSharedSecret?: string;
  /** Optional override; defaults to bundled SSA skill pack */
  skillsDir?: string;
}

import { SatelliteRepository } from "./repositories/satellite.repository";
import { ConjunctionRepository } from "./repositories/conjunction.repository";
import { KgRepository } from "./repositories/kg.repository";
import { FindingRepository } from "./repositories/finding.repository";
import { ResearchEdgeRepository } from "./repositories/research-edge.repository";
import { EnrichmentCycleRepository } from "./repositories/enrichment-cycle.repository";
import { SweepAuditRepository } from "./repositories/sweep-audit.repository";
import { SweepFeedbackRepository } from "./repositories/sweep-feedback.repository";
import { RuntimeConfigRepository } from "./repositories/runtime-config.repository";
import { ReflexionRepository } from "./repositories/reflexion.repository";
import { StatsRepository } from "./repositories/stats.repository";

import { SatelliteViewService } from "./services/satellite-view.service";
import { ConjunctionViewService } from "./services/conjunction-view.service";
import { KgViewService } from "./services/kg-view.service";
import { FindingViewService } from "./services/finding-view.service";
import { StatsService } from "./services/stats.service";
import { NanoResearchService } from "./services/nano-research.service";
import { EnrichmentFindingService } from "./services/enrichment-finding.service";
import { MissionService } from "./services/mission.service";
import { SweepTaskPlanner } from "./services/sweep-task-planner.service";
import { MissionTaskWorker } from "./services/mission-worker.service";
import { MissionFillWriter } from "./services/mission-fill-writer.service";
import { KnnPropagationService } from "./services/knn-propagation.service";
import { ReflexionService } from "./services/reflexion.service";
import { CycleRunnerService } from "./services/cycle-runner.service";
import { AutonomyService } from "./services/autonomy.service";
import { ReplChatService } from "./services/repl-chat.service";
import { IntentClassifier } from "./services/intent-classifier.service";
import { ChatReplyService } from "./services/chat-reply.service";
import { CycleStreamPump } from "./services/cycle-stream-pump.service";
import { CycleSummariser } from "./services/cycle-summariser.service";
import { thalamusLlmTransportFactory } from "./services/llm-transport.adapter";
import { ReplTurnService } from "./services/repl-turn.service";
import { SweepSuggestionsService } from "./services/sweep-suggestions.service";
import { SourceRepository } from "./repositories/source.repository";
import { SourceDataService } from "./services/source-data.service";
import { SatelliteAuditRepository } from "./repositories/satellite-audit.repository";
import { SatelliteEnrichmentRepository } from "./repositories/satellite-enrichment.repository";
import { FleetAnalysisRepository } from "./repositories/fleet-analysis.repository";
import { TrafficForecastRepository } from "./repositories/traffic-forecast.repository";
import { SatelliteAuditService } from "./services/satellite-audit.service";
import { SatelliteEnrichmentService } from "./services/satellite-enrichment.service";
import { OrbitalAnalysisService } from "./services/orbital-analysis.service";
import { OpacityService } from "./services/opacity.service";
import { SatelliteFleetRepository } from "./repositories/satellite-fleet.repository";
import { SimRunRepository } from "./repositories/sim-run.repository";
import { SimTurnRepository } from "./repositories/sim-turn.repository";
import { SimAgentRepository } from "./repositories/sim-agent.repository";
import { SimSwarmRepository } from "./repositories/sim-swarm.repository";
import { SimMemoryRepository } from "./repositories/sim-memory.repository";
import { SimTerminalRepository } from "./repositories/sim-terminal.repository";
import { SimAgentService } from "./services/sim-agent.service";
import { SimGodChannelService } from "./services/sim-god-channel.service";
import { SimTargetService } from "./services/sim-target.service";
import { SimFleetService } from "./services/sim-fleet.service";
import { SimSwarmStoreService } from "./services/sim-swarm-store.service";
import { SimRunService } from "./services/sim-run.service";
import { SimSwarmService } from "./services/sim-swarm.service";
import { SimTurnService } from "./services/sim-turn.service";
import { SimMemoryService } from "./services/sim-memory.service";
import { SimTerminalService } from "./services/sim-terminal.service";
import { SimPromotionService } from "./services/sim-promotion.service";
import { RuntimeConfigService } from "./services/runtime-config.service";
import { SatelliteSweepChatRepository } from "./repositories/satellite-sweep-chat.repository";
import { SatelliteSweepChatService } from "./services/satellite-sweep-chat.service";
import { VizService } from "./services/viz.service";
import { SatelliteService } from "./services/satellite-ephemeris.service";
import { SatelliteSweepChatController } from "./controllers/satellite-sweep-chat.controller";

import { buildCortexDataProvider } from "./agent/ssa/cortex-data-provider";
import { buildSsaDomainConfig } from "./agent/ssa/domain-config";

import type { AppServices } from "./routes";
import { snapshotHealth, type HealthSnapshot } from "./infra/health-snapshot";

export async function buildContainer(
  config: ContainerConfig,
  logger: FastifyBaseLogger,
  simTransport: SimHttpTransport,
): Promise<{
  services: AppServices;
  info: { cortices: number };
  snapshot: HealthSnapshot;
}> {
  const { db, redis, webSearch } = config;
  const skillsDir = config.skillsDir ?? SSA_SKILLS_DIR;

  // repos
  const satelliteRepo = new SatelliteRepository(db);
  const conjunctionRepo = new ConjunctionRepository(db);
  const kgRepo = new KgRepository(db);
  const findingRepo = new FindingRepository(db);
  const edgeRepo = new ResearchEdgeRepository(db);
  const cycleRepo = new EnrichmentCycleRepository(db);
  const auditRepo = new SweepAuditRepository(db);
  const reflexionRepo = new ReflexionRepository(db);
  const statsRepo = new StatsRepository(db);
  const sourceRepo = new SourceRepository(db);
  const satelliteAuditRepo = new SatelliteAuditRepository(db);
  const satelliteEnrichmentRepo = new SatelliteEnrichmentRepository(db);
  const fleetAnalysisRepo = new FleetAnalysisRepository(db);
  const trafficForecastRepo = new TrafficForecastRepository(db);
  const satelliteFleetRepo = new SatelliteFleetRepository(db);

  // Cortex-facing data services (same contract as the HTTP routes).
  const sourceDataService = new SourceDataService(sourceRepo);
  const satelliteAuditService = new SatelliteAuditService(satelliteAuditRepo);
  const satelliteEnrichmentService = new SatelliteEnrichmentService(
    satelliteRepo,
    satelliteEnrichmentRepo,
  );
  const orbitalAnalysisService = new OrbitalAnalysisService(
    fleetAnalysisRepo,
    trafficForecastRepo,
  );
  const opacityService = new OpacityService(reflexionRepo);
  const conjunctionViewService = new ConjunctionViewService(conjunctionRepo);

  const dataProvider = buildCortexDataProvider({
    sourceData: sourceDataService,
    satelliteAudit: satelliteAuditService,
    satelliteEnrichment: satelliteEnrichmentService,
    orbitalAnalysis: orbitalAnalysisService,
    opacity: opacityService,
    conjunctionView: conjunctionViewService,
  });

  // ─── Runtime-tunable config (exposed via /api/config/runtime) ───────
  // Build FIRST so thalamus/sweep pickups read from Redis at call time.
  // CLAUDE.md §1: the package-side code consumes ConfigProvider<T> ports
  // — never a direct Redis handle — so the HTTP surface is the only write
  // path ops can use to tune knobs.
  const runtimeConfigService = new RuntimeConfigService(
    new RuntimeConfigRepository(redis),
  );
  setNanoConfigProvider(runtimeConfigService.provider("thalamus.nano"));
  setNanoSwarmConfigProvider(
    runtimeConfigService.provider("thalamus.nanoSwarm"),
  );

  // Inject SSA domain profile into the (agnostic) thalamus package.
  // Package ships generic defaults; console-api owns the métier.
  setNanoSwarmProfile(SSA_NANO_SWARM_PROFILE);
  setCuratorPrompt(SSA_CURATOR_PROMPT);

  const thalamus = buildThalamusContainer({
    db,
    skillsDir,
    dataProvider,
    domainConfig: buildSsaDomainConfig(),
    webSearch,
  });

  // ─── Sweep SSA port wiring (Plan 1 Task 3.1) ─────────────────────
  //
  // Six port impls flow into buildSweepContainer via opts.ports. Audit is
  // now mandatory; the remaining ports still override sweep-side legacy
  // fallbacks until their cutover is complete.
  const sweepFeedbackRepo = new SweepFeedbackRepository(redis);

  // SSA pack uses console-api's own SatelliteRepository and Drizzle handle;
  // the sweep package carries zero domain persistence code — every fetcher
  // captures `db` via its factory and the kernel registry sees only opaque
  // IngestionSource objects.
  const ssaIngestionProvider = createSsaIngestionProvider(db);

  const ssaPromotion = new SsaPromotionAdapter({
    sweepAuditRepo: auditRepo,
    // Plan 1 scope: no ConfidenceService wired here — avoids a build-order
    // cycle with the legacy sweep/sim wiring, which still owns its own
    // ConfidenceService inside buildSweepContainer when opts.sim is set.
    // Plan 2 consolidates sim source-class promotion through this adapter.
    confidence: null,
  });
  const ssaResolutionRegistry = createSsaResolutionRegistry({
    db,
    satelliteRepo,
  });
  // `SsaAuditProvider` needs `sweep.sweepRepo.loadPastFeedback`, but the
  // sweep container is built after the audit provider (which itself feeds
  // into `buildSweepContainer` as a port). A shared holder closes the
  // wiring cycle without post-build casts: the same object reference is
  // passed to the provider and mutated below once `sweep` resolves.
  const sweepRepoHolder: {
    loadPastFeedback: () => Promise<SuggestionFeedbackRow[]>;
  } = {
    loadPastFeedback: async () => {
      throw new Error(
        "sweepRepoHolder: sweep container not yet wired — audit called too early",
      );
    },
  };
  const ssaAuditProvider = new SsaAuditProvider({
    satelliteRepo,
    sweepRepo: sweepRepoHolder,
    feedbackRepo: sweepFeedbackRepo,
    config: runtimeConfigService.provider("sweep.nanoSweep"),
  });
  const ssaFindingRouting = new SsaFindingRoutingPolicy();
  const simRunRepo = new SimRunRepository(db);
  const simTurnRepo = new SimTurnRepository(db);
  const simAgentRepo = new SimAgentRepository(db);
  const simSwarmRepo = new SimSwarmRepository(db);
  const simMemoryRepo = new SimMemoryRepository(db);
  const simTerminalRepo = new SimTerminalRepository(db);
  const simTargetService = new SimTargetService(
    simRunRepo,
    satelliteRepo,
    conjunctionRepo,
  );
  const ssaPersonaComposer = new SsaPersonaComposer();
  const ssaPromptRenderer = new SsaPromptRenderer();
  const ssaCortexSelector = new SsaCortexSelector();
  const ssaActionSchemaProvider = new SsaActionSchemaProvider();
  const ssaPerturbationPack = new SsaPerturbationPack();
  const ssaAggregationStrategy = new SsaAggregationStrategy();
  const ssaKindGuard = new SsaKindGuard();
  const simSwarmStoreService = new SimSwarmStoreService(
    db,
    simSwarmRepo,
    simRunRepo,
    simTerminalRepo,
  );
  const simHttp = new SimHttpClient(simTransport);
  const simQueue = new SimQueueHttpAdapter(simHttp, {
    kernelSecret: config.simKernelSharedSecret,
  });
  const simRuntimeStore = new SimRuntimeStoreHttpAdapter(simHttp);
  const simSwarmStore = new SimSwarmStoreHttpAdapter(simHttp);
  const simSubjectProvider = new SimSubjectHttpAdapter(simHttp);
  const simScenarioContextProvider = new SimScenarioContextHttpAdapter(simHttp);

  const sweep = buildSweepContainer({
    redis,
    sim: {
      cortexRegistry: thalamus.registry,
      embed: thalamus.embedder.embedQuery.bind(thalamus.embedder),
      llmMode: config.simLlmMode ?? "cloud",
      queue: simQueue,
      runtimeStore: simRuntimeStore,
      swarmStore: simSwarmStore,
      subjects: simSubjectProvider,
      scenarioContext: simScenarioContextProvider,
      persona: ssaPersonaComposer,
      prompt: ssaPromptRenderer,
      cortexSelector: ssaCortexSelector,
      schemaProvider: ssaActionSchemaProvider,
      perturbationPack: ssaPerturbationPack,
      aggStrategy: ssaAggregationStrategy,
      kindGuard: ssaKindGuard,
    },
    ports: {
      findingSchema: ssaFindingSchema,
      findingDomain: "ssa",
      audit: ssaAuditProvider,
      promotion: ssaPromotion,
      findingRouting: ssaFindingRouting,
      resolutionHandlers: ssaResolutionRegistry,
      ingestion: [ssaIngestionProvider],
    },
  });
  if (!sweep.sim) {
    throw new Error("sweep sim services failed to initialize");
  }

  // Rebind the shared holder to the real repo now that sweep is built.
  // `ssaAuditProvider.deps.sweepRepo` === `sweepRepoHolder` (same reference),
  // so assigning the method here flows through without reaching into private
  // fields or casting.
  sweepRepoHolder.loadPastFeedback = () =>
    sweep.sweepRepo.loadPastFeedback();

  // services
  const enrichmentFinding = new EnrichmentFindingService(
    cycleRepo,
    findingRepo,
    edgeRepo,
    sweepFeedbackRepo,
  );
  const nanoResearch = new NanoResearchService();
  const missionFillWriter = new MissionFillWriter(
    satelliteRepo,
    auditRepo,
    enrichmentFinding,
  );
  const missionWorker = new MissionTaskWorker(
    nanoResearch,
    missionFillWriter,
    logger,
  );
  const sweepTaskPlanner = new SweepTaskPlanner(satelliteRepo);
  const missionService = new MissionService(
    sweepTaskPlanner,
    missionWorker,
    sweep.sweepRepo,
    logger,
  );
  const cycleRunner = new CycleRunnerService(thalamus, sweep, logger);
  const autonomyService = new AutonomyService(cycleRunner, logger);

  // Ingestion harness: registry → worker → service. The SSA provider is
  // built above from the factory (each fetcher closes over `db`), so the
  // registry receives opaque IngestionSource objects with no Drizzle surface.
  const ingestionRegistry = createIngestionRegistry({
    providers: [ssaIngestionProvider],
  });
  const ingestionWorker = createIngestionWorker(ingestionRegistry);
  const ingestionService = new IngestionService(
    ingestionQueue,
    ingestionRegistry,
  );
  void registerSchedulers().catch((err) =>
    logger.error({ err }, "Failed to register BullMQ schedulers"),
  );
  // Touch the worker so the linter doesn't strip the binding; the BullMQ
  // worker registers its own listeners and lives until Redis disconnects.
  void ingestionWorker;

  // REPL chat — small collaborators behind the LlmTransportFactory port.
  const llmFactory = thalamusLlmTransportFactory;
  const intentClassifier = new IntentClassifier(llmFactory);
  const chatReplyService = new ChatReplyService(llmFactory);
  const cycleStreamPump = new CycleStreamPump();
  const cycleSummariser = new CycleSummariser(llmFactory);
  const replChat = new ReplChatService(
    thalamus,
    intentClassifier,
    chatReplyService,
    cycleStreamPump,
    cycleSummariser,
  );

  const simGodChannelService = new SimGodChannelService(
    simRunRepo,
    simAgentRepo,
    simTurnRepo,
  );
  const simFleetService = new SimFleetService(satelliteFleetRepo);
  const simRunService = new SimRunService(
    simRunRepo,
    simAgentRepo,
    simTurnRepo,
  );
  const simAgentService = new SimAgentService(simAgentRepo);
  const simSwarmService = new SimSwarmService(simSwarmRepo, simRunRepo);
  const simTurnService = new SimTurnService(simTurnRepo);
  const simMemoryService = new SimMemoryService(simMemoryRepo);
  const simTerminalService = new SimTerminalService(simTerminalRepo);
  const simPromotionService = new SimPromotionService({
    db,
    sweepRepo: sweep.sweepRepo,
    satelliteRepo,
    swarmRepo: simSwarmRepo,
    embed: thalamus.embedder.embedQuery.bind(thalamus.embedder),
  });

  // Satellite sweep chat — per-satellite LLM chat with SSE streaming + HITL
  // finding extraction. Consumes stubbed Viz/Satellite services + dedicated
  // Redis repo (keys: satellite-sweep:{id}:messages|findings:...).
  const satelliteSweepChatRepo = new SatelliteSweepChatRepository(redis);
  const satelliteSweepChatService = new SatelliteSweepChatService(
    satelliteRepo,
    satelliteSweepChatRepo,
    new VizService(),
    new SatelliteService(),
  );
  const satelliteSweepChatController = new SatelliteSweepChatController(
    satelliteSweepChatService,
  );

  const services: AppServices = {
    satelliteView: new SatelliteViewService(satelliteRepo),
    conjunctionView: conjunctionViewService,
    kgView: new KgViewService(kgRepo),
    findingView: new FindingViewService(findingRepo, edgeRepo),
    stats: new StatsService(statsRepo),
    mission: missionService,
    reflexion: new ReflexionService(
      reflexionRepo,
      cycleRepo,
      findingRepo,
      edgeRepo,
    ),
    knnPropagation: new KnnPropagationService(
      satelliteRepo,
      auditRepo,
      enrichmentFinding,
    ),
    autonomy: autonomyService,
    cycles: cycleRunner,
    replChat,
    replTurn: new ReplTurnService(),
    sweepSuggestions: new SweepSuggestionsService({
      sweepRepo: sweep.sweepRepo,
      resolutionService: sweep.resolutionService,
    }),
    sourceData: sourceDataService,
    satelliteAudit: satelliteAuditService,
    satelliteEnrichment: satelliteEnrichmentService,
    orbitalAnalysis: orbitalAnalysisService,
    opacity: opacityService,
    ingestion: ingestionService,
    sim: {
      orchestrator: sweep.sim.orchestrator,
      swarmStatus: sweep.sim.swarmService,
      swarmStore: simSwarmStoreService,
      run: simRunService,
      agent: simAgentService,
      swarm: simSwarmService,
      turn: simTurnService,
      memory: simMemoryService,
      terminal: simTerminalService,
      queue: {
        enqueueSimTurn: async ({ simRunId, turnIndex, jobId }) => {
          await simTurnQueue.add(
            "sim-turn",
            { simRunId, turnIndex },
            jobId ? { jobId } : undefined,
          );
        },
        enqueueSwarmFish: async ({ swarmId, simRunId, fishIndex, jobId }) => {
          await swarmFishQueue.add(
            "swarm-fish",
            { swarmId, simRunId, fishIndex },
            jobId ? { jobId } : undefined,
          );
        },
        enqueueSwarmAggregate: async ({ swarmId, jobId }) => {
          await swarmAggregateQueue.add(
            "swarm-aggregate",
            { swarmId },
            jobId ? { jobId } : undefined,
          );
        },
      },
      launcher: {
        startTelemetry: (opts) =>
          startTelemetrySwarm(
            { satelliteRepo, swarmService: sweep.sim!.swarmService },
            opts,
          ),
        startPc: (opts) =>
          startPcEstimatorSwarm(
            { conjunctionRepo, swarmService: sweep.sim!.swarmService },
            opts,
          ),
      },
      godChannel: simGodChannelService,
      target: simTargetService,
      fleet: simFleetService,
      promotion: simPromotionService,
    },
    runtimeConfig: runtimeConfigService,
    satelliteSweepChat: satelliteSweepChatController,
  };

  const snapshot = await snapshotHealth(db, redis, thalamus.registry.size());

  return {
    services,
    info: { cortices: thalamus.registry.size() },
    snapshot,
  };
}

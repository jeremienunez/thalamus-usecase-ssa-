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
  type WebSearchPort,
} from "@interview/thalamus";
import {
  buildSweepContainer,
  createIngestionRegistry,
  createIngestionWorker,
  ingestionQueue,
  registerSchedulers,
} from "@interview/sweep";
import { IngestionService } from "./services/ingestion.service";

export const SSA_SKILLS_DIR = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "./agent/ssa/skills",
);

export interface ContainerConfig {
  db: NodePgDatabase<typeof schema>;
  redis: Redis;
  webSearch: WebSearchPort;
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

import { buildCortexDataProvider } from "./agent/ssa/cortex-data-provider";
import { buildSsaDomainConfig } from "./agent/ssa/domain-config";

import type { AppServices } from "./routes";
import { snapshotHealth, type HealthSnapshot } from "./infra/health-snapshot";

export async function buildContainer(
  config: ContainerConfig,
  logger: FastifyBaseLogger,
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

  const thalamus = buildThalamusContainer({
    db,
    skillsDir,
    dataProvider,
    domainConfig: buildSsaDomainConfig(),
    webSearch,
  });
  const sweep = buildSweepContainer({ db, redis });

  // services
  const sweepFeedbackRepo = new SweepFeedbackRepository(redis);
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

  // Ingestion harness (Phase 2): registry → worker → service.
  // Phase 3 fetchers register into `ingestionRegistry` as they're added.
  const ingestionRegistry = createIngestionRegistry({ db });
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
  };

  const snapshot = await snapshotHealth(db, redis, thalamus.registry.size());

  return {
    services,
    info: { cortices: thalamus.registry.size() },
    snapshot,
  };
}

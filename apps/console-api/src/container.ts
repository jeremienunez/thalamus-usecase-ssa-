// apps/console-api/src/container.ts
/**
 * Composition root for the console-api layered stack.
 *
 * Reads env (DATABASE_URL, REDIS_URL), opens the Postgres pool + Redis
 * connection, builds the thalamus + sweep containers, instantiates every
 * repository + service, and returns an `AppServices` bundle ready for
 * `registerAllRoutes`. The corresponding `close()` tears the whole stack
 * down — used by tests so the vitest process can exit cleanly.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import * as schema from "@interview/db-schema";
import type { FastifyBaseLogger } from "fastify";
import { buildThalamusContainer } from "@interview/thalamus";
import { buildSweepContainer } from "@interview/sweep";

const SSA_SKILLS_DIR = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "./agent/ssa/skills",
);

import { SatelliteRepository } from "./repositories/satellite.repository";
import { ConjunctionRepository } from "./repositories/conjunction.repository";
import { KgRepository } from "./repositories/kg.repository";
import { FindingRepository } from "./repositories/finding.repository";
import { ResearchEdgeRepository } from "./repositories/research-edge.repository";
import { EnrichmentCycleRepository } from "./repositories/enrichment-cycle.repository";
import { SweepAuditRepository } from "./repositories/sweep-audit.repository";
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
import { KnnPropagationService } from "./services/knn-propagation.service";
import { ReflexionService } from "./services/reflexion.service";
import { CycleRunnerService } from "./services/cycle-runner.service";
import { AutonomyService } from "./services/autonomy.service";
import { ReplChatService } from "./services/repl-chat.service";
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

import type { AppServices } from "./routes";
import { snapshotHealth, type HealthSnapshot } from "./infra/health-snapshot";

export async function buildContainer(logger: FastifyBaseLogger): Promise<{
  services: AppServices;
  close: () => Promise<void>;
  info: { databaseUrl: string; redisUrl: string; cortices: number };
  snapshot: HealthSnapshot;
}> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://thalamus:thalamus@localhost:5433/thalamus";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema }) as unknown as NodePgDatabase<
    typeof schema
  >;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // Data provider: maps skill frontmatter sqlHelper names → repo method calls.
  // TODO: wire each entry to the corresponding repo method once services are built.
  const dataProvider: Record<string, (params: Record<string, unknown>) => Promise<unknown[]>> = {};

  const thalamus = buildThalamusContainer({
    db,
    skillsDir: SSA_SKILLS_DIR,
    dataProvider,
  });
  const sweep = buildSweepContainer({ db, redis });

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

  // services
  const enrichmentFinding = new EnrichmentFindingService(
    cycleRepo,
    findingRepo,
    edgeRepo,
    redis,
  );
  const nanoResearch = new NanoResearchService();
  const missionService = new MissionService(
    satelliteRepo,
    auditRepo,
    nanoResearch,
    enrichmentFinding,
    sweep.sweepRepo,
    logger,
  );
  const cycleRunner = new CycleRunnerService(thalamus, sweep, logger);
  const autonomyService = new AutonomyService(cycleRunner, logger);
  const replChat = new ReplChatService(thalamus);

  const services: AppServices = {
    satelliteView: new SatelliteViewService(satelliteRepo),
    conjunctionView: new ConjunctionViewService(conjunctionRepo),
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
    sourceData: new SourceDataService(sourceRepo),
    satelliteAudit: new SatelliteAuditService(satelliteAuditRepo),
    satelliteEnrichment: new SatelliteEnrichmentService(
      satelliteRepo,
      satelliteEnrichmentRepo,
    ),
    orbitalAnalysis: new OrbitalAnalysisService(
      fleetAnalysisRepo,
      trafficForecastRepo,
    ),
  };

  const snapshot = await snapshotHealth(db, redis, thalamus.registry.size());

  return {
    services,
    close: async () => {
      await pool.end();
      redis.disconnect();
    },
    info: {
      databaseUrl: databaseUrl.replace(/:\/\/[^@]+@/, "://***@"),
      redisUrl,
      cortices: thalamus.registry.size(),
    },
    snapshot,
  };
}

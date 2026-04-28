// apps/console-api/src/routes/index.ts
import type { FastifyInstance } from "fastify";
import type { SatelliteViewService } from "../services/satellite-view.service";
import type { PayloadViewService } from "../services/payload-view.service";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import type { KgViewService } from "../services/kg-view.service";
import type { FindingViewService } from "../services/finding-view.service";
import type { StatsService } from "../services/stats.service";
import type { MissionService } from "../services/mission.service";
import type { ReflexionService } from "../services/reflexion.service";
import type { KnnPropagationService } from "../services/knn-propagation.service";
import type { AutonomyService } from "../services/autonomy.service";
import type { CycleRunnerService } from "../services/cycle-runner.service";
import type { ReplChatService } from "../services/repl-chat.service";
import type { ReplFollowUpService } from "../services/repl-followup.service";
import type { ReplTurnService } from "../services/repl-turn.service";
import type { SweepSuggestionsService } from "../services/sweep-suggestions.service";
import type { SourceDataService } from "../services/source-data.service";
import type { SatelliteAuditService } from "../services/satellite-audit.service";
import type { SatelliteEnrichmentService } from "../services/satellite-enrichment.service";
import type { OrbitalAnalysisService } from "../services/orbital-analysis.service";
import type { OpacityService } from "../services/opacity.service";
import type { IngestionService } from "../services/ingestion.service";
import type { RuntimeConfigService } from "../services/runtime-config.service";
import type { TemporalMemoryService } from "../services/temporal-memory.service";
import type { TemporalShadowRunService } from "../services/temporal-shadow-run.service";
import type { SatelliteSweepChatController } from "../controllers/satellite-sweep-chat.controller";

import { registerHealthRoutes } from "./health.routes";
import { registerSatelliteRoutes } from "./satellites.routes";
import { registerPayloadsRoutes } from "./payloads.routes";
import { registerConjunctionRoutes } from "./conjunctions.routes";
import { registerKgRoutes } from "./kg.routes";
import { registerFindingsRoutes } from "./findings.routes";
import { registerWhyRoutes } from "./why.routes";
import { registerStatsRoutes } from "./stats.routes";
import { registerSweepRoutes } from "./sweep.routes";
import { registerReflexionRoutes } from "./reflexion.routes";
import { registerKnnPropagationRoutes } from "./knn-propagation.routes";
import { registerAutonomyRoutes } from "./autonomy.routes";
import { registerCyclesRoutes } from "./cycles.routes";
import { registerResearchWriteRoutes } from "./research-write.routes";
import type { ResearchWriterPort } from "@interview/thalamus";
import { registerReplRoutes } from "./repl.routes";
import { registerSourceRoutes } from "./sources.routes";
import { registerSatelliteAuditRoutes } from "./satellite-audit.routes";
import { registerSatelliteEnrichmentRoutes } from "./satellite-enrichment.routes";
import { registerOrbitalRoutes } from "./orbital.routes";
import { registerOpacityRoutes } from "./opacity.routes";
import { registerIngestionRoutes } from "./ingestion.routes";
import { registerSimRoutes, type SimRouteServices } from "./sim.routes";
import { registerRuntimeConfigRoutes } from "./runtime-config.routes";
import { satelliteSweepChatRoutes } from "./satellite-sweep-chat.routes";
import { registerTemporalRoutes } from "./temporal.routes";

export type { SweepSuggestionsDeps } from "../services/sweep-suggestions.service";

export type AppServices = {
  satelliteView: SatelliteViewService;
  payloadView: PayloadViewService;
  conjunctionView: ConjunctionViewService;
  kgView: KgViewService;
  findingView: FindingViewService;
  stats: StatsService;
  mission: MissionService;
  reflexion: ReflexionService;
  knnPropagation: KnnPropagationService;
  autonomy: AutonomyService;
  cycles: CycleRunnerService;
  replChat: ReplChatService;
  replFollowUps: ReplFollowUpService;
  replTurn: ReplTurnService;
  sweepSuggestions: SweepSuggestionsService;
  sourceData: SourceDataService;
  satelliteAudit: SatelliteAuditService;
  satelliteEnrichment: SatelliteEnrichmentService;
  orbitalAnalysis: OrbitalAnalysisService;
  opacity: OpacityService;
  ingestion: IngestionService;
  sim: SimRouteServices;
  runtimeConfig: RuntimeConfigService;
  temporalMemory: TemporalMemoryService;
  temporalShadow: TemporalShadowRunService;
  satelliteSweepChat: SatelliteSweepChatController;
  researchWriter: ResearchWriterPort;
};

type RouteConfig = {
  simKernelSharedSecret?: string;
};

export function registerAllRoutes(
  app: FastifyInstance,
  s: AppServices,
  config: RouteConfig = {},
): void {
  registerHealthRoutes(app);
  registerSatelliteRoutes(app, s.satelliteView);
  registerPayloadsRoutes(app, s.payloadView);
  registerConjunctionRoutes(app, s.conjunctionView);
  registerKgRoutes(app, s.kgView);
  registerFindingsRoutes(app, s.findingView);
  registerWhyRoutes(app, s.findingView);
  registerStatsRoutes(app, s.stats);
  registerSweepRoutes(app, s.sweepSuggestions, s.mission);
  registerReflexionRoutes(app, s.reflexion);
  registerKnnPropagationRoutes(app, s.knnPropagation);
  registerAutonomyRoutes(app, s.autonomy);
  registerCyclesRoutes(app, s.cycles);
  registerResearchWriteRoutes(app, s.researchWriter, {
    simKernelSharedSecret: config.simKernelSharedSecret,
  });
  registerReplRoutes(app, s.replChat, s.replFollowUps, s.replTurn);
  registerSourceRoutes(app, s.sourceData);
  registerSatelliteAuditRoutes(app, s.satelliteAudit);
  registerSatelliteEnrichmentRoutes(app, s.satelliteEnrichment);
  registerOrbitalRoutes(app, s.orbitalAnalysis);
  registerOpacityRoutes(app, s.opacity);
  registerIngestionRoutes(app, s.ingestion);
  registerSimRoutes(app, s.sim, {
    simKernelSharedSecret: config.simKernelSharedSecret,
  });
  registerRuntimeConfigRoutes(app, s.runtimeConfig);
  registerTemporalRoutes(app, {
    memory: s.temporalMemory,
    shadow: s.temporalShadow,
  });

  // Per-satellite chat with its own auth scope (authenticate + requireTier).
  // Mounted via app.register so the preHandlers installed inside the plugin
  // stay scoped and don't leak onto neighbouring routes.
  app.register(
    async (scope) => {
      await satelliteSweepChatRoutes(scope, s.satelliteSweepChat);
    },
    { prefix: "/api/satellites" },
  );
}

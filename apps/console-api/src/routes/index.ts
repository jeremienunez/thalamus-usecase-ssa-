// apps/console-api/src/routes/index.ts
import type { FastifyInstance } from "fastify";
import type { SatelliteViewService } from "../services/satellite-view.service";
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
import type { ReplTurnService } from "../services/repl-turn.service";
import type { SweepSuggestionsService } from "../services/sweep-suggestions.service";
import type { SourceDataService } from "../services/source-data.service";
import type { SatelliteAuditService } from "../services/satellite-audit.service";
import type { SatelliteEnrichmentService } from "../services/satellite-enrichment.service";
import type { OrbitalAnalysisService } from "../services/orbital-analysis.service";
import type { OpacityService } from "../services/opacity.service";

import { registerHealthRoutes } from "./health.routes";
import { registerSatelliteRoutes } from "./satellites.routes";
import { registerConjunctionRoutes } from "./conjunctions.routes";
import { registerKgRoutes } from "./kg.routes";
import { registerFindingsRoutes } from "./findings.routes";
import { registerStatsRoutes } from "./stats.routes";
import { registerSweepRoutes } from "./sweep.routes";
import { registerReflexionRoutes } from "./reflexion.routes";
import { registerKnnPropagationRoutes } from "./knn-propagation.routes";
import { registerAutonomyRoutes } from "./autonomy.routes";
import { registerCyclesRoutes } from "./cycles.routes";
import { registerReplRoutes } from "./repl.routes";
import { registerSourceRoutes } from "./sources.routes";
import { registerSatelliteAuditRoutes } from "./satellite-audit.routes";
import { registerSatelliteEnrichmentRoutes } from "./satellite-enrichment.routes";
import { registerOrbitalRoutes } from "./orbital.routes";
import { registerOpacityRoutes } from "./opacity.routes";

export type { SweepDeps } from "../controllers/sweep-suggestions.controller";

export type AppServices = {
  satelliteView: SatelliteViewService;
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
  replTurn: ReplTurnService;
  sweepSuggestions: SweepSuggestionsService;
  sourceData: SourceDataService;
  satelliteAudit: SatelliteAuditService;
  satelliteEnrichment: SatelliteEnrichmentService;
  orbitalAnalysis: OrbitalAnalysisService;
  opacity: OpacityService;
};

export function registerAllRoutes(
  app: FastifyInstance,
  s: AppServices,
): void {
  registerHealthRoutes(app);
  registerSatelliteRoutes(app, s.satelliteView);
  registerConjunctionRoutes(app, s.conjunctionView);
  registerKgRoutes(app, s.kgView);
  registerFindingsRoutes(app, s.findingView);
  registerStatsRoutes(app, s.stats);
  registerSweepRoutes(app, s.sweepSuggestions, s.mission);
  registerReflexionRoutes(app, s.reflexion);
  registerKnnPropagationRoutes(app, s.knnPropagation);
  registerAutonomyRoutes(app, s.autonomy);
  registerCyclesRoutes(app, s.cycles);
  registerReplRoutes(app, s.replChat, s.replTurn);
  registerSourceRoutes(app, s.sourceData);
  registerSatelliteAuditRoutes(app, s.satelliteAudit);
  registerSatelliteEnrichmentRoutes(app, s.satelliteEnrichment);
  registerOrbitalRoutes(app, s.orbitalAnalysis);
  registerOpacityRoutes(app, s.opacity);
}

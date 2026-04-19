/** Legacy shim. DTOs live in shared/types; runtime delegates to adapters/api/*. Phase 7 deletes this file. */
export type {
  Regime,
  SourceClass,
  FindingStatus,
  EntityClass,
  SatelliteDTO,
  ConjunctionDTO,
  KgNodeDTO,
  KgEdgeDTO,
  FindingDTO,
  SweepSuggestionDTO,
  MissionTaskDTO,
  MissionStateDTO,
  AutonomyTickDTO,
  AutonomyStateDTO,
  CycleDTO,
} from "@/shared/types";

import type { Regime, FindingStatus } from "@/shared/types";
import { createFetchApiClient } from "@/adapters/api/client";
import { createSatellitesApi } from "@/adapters/api/satellites";
import { createConjunctionsApi } from "@/adapters/api/conjunctions";
import { createKgApi } from "@/adapters/api/kg";
import { createFindingsApi } from "@/adapters/api/findings";
import { createStatsApi } from "@/adapters/api/stats";
import { createCyclesApi, type CycleKind } from "@/adapters/api/cycles";
import { createSweepApi } from "@/adapters/api/sweep";
import { createMissionApi } from "@/adapters/api/mission";
import { createAutonomyApi } from "@/adapters/api/autonomy";

const _fetcher = createFetchApiClient();
const _satellites = createSatellitesApi(_fetcher);
const _conjunctions = createConjunctionsApi(_fetcher);
const _kg = createKgApi(_fetcher);
const _findings = createFindingsApi(_fetcher);
const _stats = createStatsApi(_fetcher);
const _cycles = createCyclesApi(_fetcher);
const _sweep = createSweepApi(_fetcher);
const _mission = createMissionApi(_fetcher);
const _autonomy = createAutonomyApi(_fetcher);

export const api = {
  satellites: (regime?: Regime) => _satellites.list(regime),
  conjunctions: (minPc = 0) => _conjunctions.list(minPc),
  kgNodes: () => _kg.listNodes(),
  kgEdges: () => _kg.listEdges(),
  findings: (params?: { status?: FindingStatus; cortex?: string }) => _findings.list(params),
  finding: (id: string) => _findings.findById(id),
  decision: (id: string, decision: FindingStatus, reason?: string) =>
    _findings.decide(id, decision, reason),
  stats: () => _stats.get(),
  runCycle: (kind: CycleKind) => _cycles.run(kind),
  cycles: () => _cycles.list(),
  sweepSuggestions: () => _sweep.listSuggestions(),
  missionStatus: () => _mission.status(),
  missionStart: () => _mission.start(),
  missionStop: () => _mission.stop(),
  autonomyStatus: () => _autonomy.status(),
  autonomyStart: (intervalSec?: number) => _autonomy.start(intervalSec),
  autonomyStop: () => _autonomy.stop(),
  reviewSuggestion: (id: string, accept: boolean, reason?: string) =>
    _sweep.review(id, accept, reason),
};

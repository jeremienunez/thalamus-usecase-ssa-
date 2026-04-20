import { createFetchApiClient, type ApiFetcher } from "./client";
import { createSatellitesApi, type SatellitesApiPort } from "./satellites";
import { createPayloadsApi, type PayloadsApiPort } from "./payloads";
import { createConjunctionsApi, type ConjunctionsApiPort } from "./conjunctions";
import { createKgApi, type KgApiPort } from "./kg";
import { createFindingsApi, type FindingsApiPort } from "./findings";
import { createStatsApi, type StatsApiPort } from "./stats";
import { createCyclesApi, type CyclesApiPort } from "./cycles";
import { createSweepApi, type SweepApiPort } from "./sweep";
import { createMissionApi, type MissionApiPort } from "./mission";
import { createAutonomyApi, type AutonomyApiPort } from "./autonomy";

export type { ApiFetcher };
export type {
  SatellitesApiPort,
  PayloadsApiPort,
  ConjunctionsApiPort,
  KgApiPort,
  FindingsApiPort,
  StatsApiPort,
  CyclesApiPort,
  SweepApiPort,
  MissionApiPort,
  AutonomyApiPort,
};
export type { CycleKind } from "./cycles";

export interface ApiClient {
  satellites: SatellitesApiPort;
  payloads: PayloadsApiPort;
  conjunctions: ConjunctionsApiPort;
  kg: KgApiPort;
  findings: FindingsApiPort;
  stats: StatsApiPort;
  cycles: CyclesApiPort;
  sweep: SweepApiPort;
  mission: MissionApiPort;
  autonomy: AutonomyApiPort;
}

export function createApiClient(opts?: { fetcher?: ApiFetcher }): ApiClient {
  const f = opts?.fetcher ?? createFetchApiClient();
  return {
    satellites: createSatellitesApi(f),
    payloads: createPayloadsApi(f),
    conjunctions: createConjunctionsApi(f),
    kg: createKgApi(f),
    findings: createFindingsApi(f),
    stats: createStatsApi(f),
    cycles: createCyclesApi(f),
    sweep: createSweepApi(f),
    mission: createMissionApi(f),
    autonomy: createAutonomyApi(f),
  };
}

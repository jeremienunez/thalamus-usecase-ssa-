import type { ApiFetcher } from "./client";
import type { MissionStateDto } from "@/dto/http";

export interface MissionApiPort {
  status(): Promise<MissionStateDto>;
  start(): Promise<{ ok: boolean; state: MissionStateDto }>;
  stop(): Promise<{ ok: boolean; state: MissionStateDto }>;
}

export function createMissionApi(f: ApiFetcher): MissionApiPort {
  return {
    status: () => f.getJson(`/api/sweep/mission/status`),
    start: () => f.postJson(`/api/sweep/mission/start`, undefined),
    stop: () => f.postJson(`/api/sweep/mission/stop`, undefined),
  };
}

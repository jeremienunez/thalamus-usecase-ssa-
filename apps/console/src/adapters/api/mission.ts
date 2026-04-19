import type { ApiFetcher } from "./client";
import type { MissionStateDTO } from "@/shared/types";

export interface MissionApiPort {
  status(): Promise<MissionStateDTO>;
  start(): Promise<{ ok: boolean; state: MissionStateDTO }>;
  stop(): Promise<{ ok: boolean; state: MissionStateDTO }>;
}

export function createMissionApi(f: ApiFetcher): MissionApiPort {
  return {
    status: () => f.getJson(`/api/sweep/mission/status`),
    start: () => f.postJson(`/api/sweep/mission/start`, undefined),
    stop: () => f.postJson(`/api/sweep/mission/stop`, undefined),
  };
}

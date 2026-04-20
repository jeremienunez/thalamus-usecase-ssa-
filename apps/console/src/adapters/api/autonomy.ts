import type { ApiFetcher } from "./client";
import type { AutonomyStateDTO } from "@/transformers/http";

export interface AutonomyApiPort {
  status(): Promise<AutonomyStateDTO>;
  start(intervalSec?: number): Promise<{ ok: boolean; state: AutonomyStateDTO }>;
  stop(): Promise<{ ok: boolean; state: AutonomyStateDTO }>;
  reset(): Promise<{ ok: boolean; state: AutonomyStateDTO }>;
}

export function createAutonomyApi(f: ApiFetcher): AutonomyApiPort {
  return {
    status: () => f.getJson(`/api/autonomy/status`),
    start: (intervalSec) =>
      f.postJson(
        `/api/autonomy/start`,
        intervalSec === undefined ? {} : { intervalSec },
      ),
    stop: () => f.postJson(`/api/autonomy/stop`, undefined),
    reset: () => f.postJson(`/api/autonomy/reset`, undefined),
  };
}

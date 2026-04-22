import type { ApiFetcher } from "./client";
import type { AutonomyStateDto } from "@/dto/http";

export interface AutonomyApiPort {
  status(): Promise<AutonomyStateDto>;
  start(intervalSec?: number): Promise<{ ok: boolean; state: AutonomyStateDto }>;
  stop(): Promise<{ ok: boolean; state: AutonomyStateDto }>;
  reset(): Promise<{ ok: boolean; state: AutonomyStateDto }>;
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

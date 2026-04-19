import type { ApiFetcher } from "./client";
import type { StatsDTO } from "@/shared/types";

export interface StatsApiPort {
  get(): Promise<StatsDTO>;
}

export function createStatsApi(f: ApiFetcher): StatsApiPort {
  return { get: () => f.getJson(`/api/stats`) };
}

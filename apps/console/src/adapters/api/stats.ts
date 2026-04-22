import type { ApiFetcher } from "./client";
import type { StatsDto } from "@/dto/http";

export interface StatsApiPort {
  get(): Promise<StatsDto>;
}

export function createStatsApi(f: ApiFetcher): StatsApiPort {
  return { get: () => f.getJson(`/api/stats`) };
}

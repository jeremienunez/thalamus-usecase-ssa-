import type { ApiFetcher } from "./client";
import type { Regime, SatelliteDto } from "@/dto/http";

export interface SatellitesApiPort {
  list(regime?: Regime): Promise<{ items: SatelliteDto[]; count: number }>;
}

export function createSatellitesApi(f: ApiFetcher): SatellitesApiPort {
  return {
    list: (regime) =>
      f.getJson(`/api/satellites${regime ? `?regime=${regime}` : ""}`),
  };
}

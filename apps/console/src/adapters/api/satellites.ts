import type { ApiFetcher } from "./client";
import type { Regime, SatelliteDTO } from "@/transformers/http";

export interface SatellitesApiPort {
  list(regime?: Regime): Promise<{ items: SatelliteDTO[]; count: number }>;
}

export function createSatellitesApi(f: ApiFetcher): SatellitesApiPort {
  return {
    list: (regime) =>
      f.getJson(`/api/satellites${regime ? `?regime=${regime}` : ""}`),
  };
}

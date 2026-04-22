import type { ApiFetcher } from "./client";
import type { PayloadDto } from "@/dto/http";

/**
 * Per-satellite payload manifest port.
 *
 * One call = one HTTP GET against /api/satellites/:id/payloads. The response
 * shape mirrors the sibling list endpoints ({ items, count }) so the usecase
 * layer stays uniform across entity queries.
 */
export interface PayloadsApiPort {
  listForSatellite(
    satelliteId: number,
  ): Promise<{ items: PayloadDto[]; count: number }>;
}

export function createPayloadsApi(f: ApiFetcher): PayloadsApiPort {
  return {
    listForSatellite: (satelliteId) =>
      f.getJson(`/api/satellites/${satelliteId}/payloads`),
  };
}

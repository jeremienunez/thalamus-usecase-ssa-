// STUBBED FOR INTERVIEW EXTRACTION — original service is out of scope.
// Only the `getEphemerisHistory` method is consumed by satellite-sweep-chat.service.

import { createLogger } from "@interview/shared";

const logger = createLogger("satellite-service-stub");

export interface EphemerisHistoryPoint {
  date: string;
  apogeeKm: number;
  perigeeKm: number;
  source?: string;
}

export class SatelliteService {
  async getEphemerisHistory(
    _satelliteId: number,
  ): Promise<EphemerisHistoryPoint[]> {
    logger.debug("getEphemerisHistory stub called", {
      satelliteId: _satelliteId,
    });
    return [];
  }
}

// STUBBED FOR INTERVIEW EXTRACTION — original service is out of scope.
// Only `getLifetimeCurve` is consumed by satellite-sweep-chat.service.

import { createLogger } from "@interview/shared";

const logger = createLogger("viz-service-stub");

export interface LifetimeCurvePoint {
  ageYears: number;
  quality: number;
}

export interface LifetimeCurve {
  satelliteId: number;
  peakAge: number;
  points: LifetimeCurvePoint[];
}

export class VizService {
  async getLifetimeCurve(
    satelliteId: number,
  ): Promise<LifetimeCurve | null> {
    logger.debug("getLifetimeCurve stub called", { satelliteId });
    return null;
  }
}

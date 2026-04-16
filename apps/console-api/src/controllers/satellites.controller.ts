import type { FastifyRequest } from "fastify";
import type { Regime } from "@interview/shared";
import type { SatelliteViewService } from "../services/satellite-view.service";
import { asyncHandler } from "../utils/async-handler";

export function satellitesController(service: SatelliteViewService) {
  return asyncHandler<
    FastifyRequest<{ Querystring: { regime?: string; limit?: string } }>
  >(async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 2000), 5000);
    const regime = (req.query.regime as Regime | undefined) ?? undefined;
    return service.list({ limit, regime });
  });
}

import type { FastifyRequest } from "fastify";
import { RegimeSchema } from "@interview/shared";
import type { SatelliteViewService } from "../services/satellite-view.service";
import { asyncHandler } from "../utils/async-handler";

export function satellitesController(service: SatelliteViewService) {
  return asyncHandler<
    FastifyRequest<{ Querystring: { regime?: string; limit?: string } }>
  >(async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 2000), 5000);
    const parsedRegime = req.query.regime
      ? RegimeSchema.safeParse(req.query.regime)
      : null;
    const regime = parsedRegime?.success ? parsedRegime.data : undefined;
    return service.list({ limit, regime });
  });
}

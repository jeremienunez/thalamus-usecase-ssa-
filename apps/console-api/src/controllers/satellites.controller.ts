import type { FastifyRequest } from "fastify";
import type { SatelliteViewService } from "../services/satellite-view.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { SatellitesQuerySchema } from "../schemas";

export type SatellitesControllerPort = Pick<SatelliteViewService, "list">;

export function satellitesController(service: SatellitesControllerPort) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, SatellitesQuerySchema, reply);
      if (q === null) return;
      return service.list({ limit: q.limit, regime: q.regime });
    },
  );
}

import type { FastifyRequest } from "fastify";
import type { SatelliteEnrichmentService } from "../services/satellite-enrichment.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  SatelliteIdParamsSchema,
  OperatorNameParamsSchema,
  CatalogContextQuerySchema,
  ReplacementCostQuerySchema,
  LaunchCostQuerySchema,
} from "../schemas/satellite-audit.schema";

export function satelliteFullController(service: SatelliteEnrichmentService) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SatelliteIdParamsSchema, reply);
      if (params === null) return;
      return service.findFull(BigInt(params.id));
    },
  );
}

export function satellitesByOperatorController(
  service: SatelliteEnrichmentService,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, OperatorNameParamsSchema, reply);
      if (params === null) return;
      return service.listByOperator(params.name);
    },
  );
}

export function catalogContextController(
  service: SatelliteEnrichmentService,
) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, CatalogContextQuerySchema, reply);
      if (q === null) return;
      return service.catalogContext({
        source: q.source,
        sinceEpoch: q.sinceEpoch,
        limit: q.limit,
      });
    },
  );
}

export function replacementCostController(
  service: SatelliteEnrichmentService,
) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, ReplacementCostQuerySchema, reply);
      if (q === null) return;
      return service.replacementCost({ satelliteId: q.satelliteId });
    },
  );
}

export function launchCostController(service: SatelliteEnrichmentService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, LaunchCostQuerySchema, reply);
      if (q === null) return;
      return service.launchCost({
        orbitRegime: q.orbitRegime,
        minLaunchCost: q.minLaunchCost,
        maxLaunchCost: q.maxLaunchCost,
        limit: q.limit,
      });
    },
  );
}

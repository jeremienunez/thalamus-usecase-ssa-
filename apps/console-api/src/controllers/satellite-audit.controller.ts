import type { FastifyRequest } from "fastify";
import type { SatelliteAuditService } from "../services/satellite-audit.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  AuditDataQuerySchema,
  AuditClassificationQuerySchema,
  ApogeeHistoryQuerySchema,
} from "../schemas/satellite-audit.schema";

export function auditDataController(service: SatelliteAuditService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, AuditDataQuerySchema, reply);
      if (q === null) return;
      return service.auditData({ orbitRegime: q.orbitRegime, limit: q.limit });
    },
  );
}

export function auditClassificationController(
  service: SatelliteAuditService,
) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, AuditClassificationQuerySchema, reply);
      if (q === null) return;
      return service.auditClassification({ limit: q.limit });
    },
  );
}

export function auditApogeeController(service: SatelliteAuditService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, ApogeeHistoryQuerySchema, reply);
      if (q === null) return;
      return service.listApogeeHistory({
        noradId: q.noradId,
        windowDays: q.windowDays,
        limit: q.limit,
      });
    },
  );
}

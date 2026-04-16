import type { FastifyRequest } from "fastify";
import type { SourceDataService } from "../services/source-data.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  AdvisoryQuerySchema,
  RssQuerySchema,
  ManeuverQuerySchema,
  ObservationQuerySchema,
  CorrelationQuerySchema,
  PrimerQuerySchema,
} from "../schemas";

export function advisoryController(service: SourceDataService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, AdvisoryQuerySchema, reply);
      if (q === null) return;
      return service.listAdvisory(q);
    },
  );
}

export function rssController(service: SourceDataService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, RssQuerySchema, reply);
      if (q === null) return;
      return service.listRss(q);
    },
  );
}

export function maneuverController(service: SourceDataService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, ManeuverQuerySchema, reply);
      if (q === null) return;
      return service.listManeuverSources(q);
    },
  );
}

export function observationsController(service: SourceDataService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, ObservationQuerySchema, reply);
      if (q === null) return;
      return service.listObservationSources(q);
    },
  );
}

export function correlationController(service: SourceDataService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, CorrelationQuerySchema, reply);
      if (q === null) return;
      return service.listCorrelationSources(q);
    },
  );
}

export function primerController(service: SourceDataService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, PrimerQuerySchema, reply);
      if (q === null) return;
      return service.listOrbitalPrimer(q);
    },
  );
}

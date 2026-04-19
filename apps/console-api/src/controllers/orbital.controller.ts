import type { FastifyRequest } from "fastify";
import type { OrbitalAnalysisService } from "../services/orbital-analysis.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  FleetQuerySchema,
  RegimeParamsSchema,
  RegimeQuerySchema,
  SlotsQuerySchema,
  TrafficQuerySchema,
  DebrisForecastQuerySchema,
  LaunchManifestQuerySchema,
} from "../schemas";

export function fleetController(service: OrbitalAnalysisService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, FleetQuerySchema, reply);
      if (q === null) return;
      return service.analyzeFleet({ operatorId: q.operatorId, limit: q.limit });
    },
  );
}

export function regimeController(service: OrbitalAnalysisService) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Querystring: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, RegimeParamsSchema, reply);
      if (params === null) return;
      const q = parseOrReply(req.query, RegimeQuerySchema, reply);
      if (q === null) return;
      return service.profileRegime({
        id: params.id,
        operatorCountryName: q.operatorCountryName,
        operatorCountryId: q.operatorCountryId,
        orbitRegime: q.orbitRegime,
        limit: q.limit,
      });
    },
  );
}

export function slotsController(service: OrbitalAnalysisService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, SlotsQuerySchema, reply);
      if (q === null) return;
      return service.planSlots({
        operatorId: q.operatorId,
        limit: q.limit,
      });
    },
  );
}

export function trafficController(service: OrbitalAnalysisService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, TrafficQuerySchema, reply);
      if (q === null) return;
      return service.analyzeTraffic({
        windowDays: q.windowDays,
        regimeId: q.regimeId,
        limit: q.limit,
      });
    },
  );
}

export function debrisForecastController(service: OrbitalAnalysisService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, DebrisForecastQuerySchema, reply);
      if (q === null) return;
      return service.forecastDebris({
        regimeId: q.regimeId,
        limit: q.limit,
      });
    },
  );
}

export function launchManifestController(service: OrbitalAnalysisService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, LaunchManifestQuerySchema, reply);
      if (q === null) return;
      return service.launchManifest({
        horizonDays: q.horizonDays,
        limit: q.limit,
      });
    },
  );
}

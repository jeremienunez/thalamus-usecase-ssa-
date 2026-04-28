import type { FastifyRequest } from "fastify";
import type { RunTemporalShadowInput } from "../types/temporal.types";
import type { TemporalMemoryService } from "../services/temporal-memory.service";
import type { TemporalShadowRunService } from "../services/temporal-shadow-run.service";
import { TemporalPatternQuerySchema, TemporalShadowRunBodySchema } from "../schemas";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";

export type TemporalControllerPort = Pick<TemporalMemoryService, "queryPatterns">;
export type TemporalShadowControllerPort = Pick<
  TemporalShadowRunService,
  "runClosedWindow"
>;

export function temporalPatternsController(service: TemporalControllerPort) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const query = parseOrReply(req.query, TemporalPatternQuerySchema, reply);
      if (query === null) return;
      return service.queryPatterns(query);
    },
  );
}

export function temporalShadowRunController(service: TemporalShadowControllerPort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, TemporalShadowRunBodySchema, reply);
    if (body === null) return;
    if (body.from === undefined || body.to === undefined) {
      throw new Error("validated temporal shadow run body is missing window bounds");
    }
    const input: RunTemporalShadowInput = {
      from: body.from,
      to: body.to,
      sourceDomain: body.sourceDomain,
      params: body.params,
      targetOutcomes: body.targetOutcomes,
      sourceScope: body.sourceScope,
      projectionVersion: body.projectionVersion,
    };
    return service.runClosedWindow(input);
  });
}

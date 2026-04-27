import type { FastifyRequest } from "fastify";
import type { TemporalMemoryService } from "../services/temporal-memory.service";
import { TemporalPatternQuerySchema } from "../schemas";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";

export type TemporalControllerPort = Pick<TemporalMemoryService, "queryPatterns">;

export function temporalPatternsController(service: TemporalControllerPort) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const query = parseOrReply(req.query, TemporalPatternQuerySchema, reply);
      if (query === null) return;
      return service.queryPatterns(query);
    },
  );
}

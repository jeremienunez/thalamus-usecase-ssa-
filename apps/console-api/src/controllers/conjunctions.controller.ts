import type { FastifyRequest } from "fastify";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { ConjunctionsQuerySchema } from "../schemas";

export function conjunctionsController(service: ConjunctionViewService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, ConjunctionsQuerySchema, reply);
      if (q === null) return;
      // Schema defaults minPc to 0, so at runtime it's always present; the
      // `?? 0` keeps the static types aligned with the service signature.
      return service.list({ minPc: q.minPc ?? 0 });
    },
  );
}

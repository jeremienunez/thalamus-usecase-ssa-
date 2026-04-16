import type { FastifyRequest } from "fastify";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import { asyncHandler } from "../utils/async-handler";

export function conjunctionsController(service: ConjunctionViewService) {
  return asyncHandler<FastifyRequest<{ Querystring: { minPc?: string } }>>(
    async (req) => {
      const minPc = Number(req.query.minPc ?? 0);
      return service.list({ minPc });
    },
  );
}

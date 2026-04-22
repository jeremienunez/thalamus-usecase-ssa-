// apps/console-api/src/controllers/knn-propagation.controller.ts
import type { FastifyRequest } from "fastify";
import type { KnnPropagationService } from "../services/knn-propagation.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { KnnPropagateBodySchema } from "../schemas";

export type KnnPropagationControllerPort = Pick<
  KnnPropagationService,
  "propagate"
>;

export function knnPropagateController(service: KnnPropagationControllerPort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, KnnPropagateBodySchema, reply);
    if (body === null) return;
    return service.propagate({
      field: body.field,
      k: body.k,
      minSim: body.minSim,
      limit: body.limit,
      dryRun: body.dryRun,
    });
  });
}

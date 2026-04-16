// apps/console-api/src/controllers/knn-propagation.controller.ts
import type { FastifyRequest } from "fastify";
import type { KnnPropagationService } from "../services/knn-propagation.service";
import type { KnnPropagateBody } from "../types";
import { MISSION_WRITABLE_COLUMNS } from "../utils/field-constraints";
import { asyncHandler } from "../utils/async-handler";

export function knnPropagateController(service: KnnPropagationService) {
  return asyncHandler<FastifyRequest<{ Body: KnnPropagateBody }>>(
    async (req, reply) => {
      const field = req.body?.field ?? "";
      if (!MISSION_WRITABLE_COLUMNS[field]) {
        return reply.code(400).send({
          error: `field must be one of ${Object.keys(MISSION_WRITABLE_COLUMNS).join(", ")}`,
        });
      }
      const k = Math.max(3, Math.min(15, req.body?.k ?? 5));
      const minSim = Math.max(0.5, Math.min(0.99, req.body?.minSim ?? 0.8));
      const limit = Math.max(1, Math.min(2000, req.body?.limit ?? 500));
      const dryRun = req.body?.dryRun === true;
      return service.propagate({ field, k, minSim, limit, dryRun });
    },
  );
}

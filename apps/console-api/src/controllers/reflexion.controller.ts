// apps/console-api/src/controllers/reflexion.controller.ts
import type { FastifyRequest } from "fastify";
import type { ReflexionService } from "../services/reflexion.service";
import type { ReflexionBody } from "../types";
import { asyncHandler } from "../utils/async-handler";

export function reflexionController(service: ReflexionService) {
  return asyncHandler<FastifyRequest<{ Body: ReflexionBody }>>(
    async (req, reply) => {
      const result = await service.runPass(req.body);
      if ("error" in result)
        return reply.code(result.code).send({ error: result.error });
      return result;
    },
  );
}

// apps/console-api/src/controllers/reflexion.controller.ts
import type { FastifyRequest } from "fastify";
import type { ReflexionService } from "../services/reflexion.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { ReflexionPassBodySchema } from "../schemas";

export function reflexionController(service: ReflexionService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, ReflexionPassBodySchema, reply);
    if (body === null) return;
    // Service throws HttpError — asyncHandler maps .statusCode to the reply.
    return service.runPass(body);
  });
}

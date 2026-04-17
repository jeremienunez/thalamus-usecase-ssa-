// apps/console-api/src/controllers/reflexion.controller.ts
import type { FastifyRequest } from "fastify";
import type { ReflexionService } from "../services/reflexion.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { ReflexionPassBodySchema } from "../schemas";
import type { ReflexionPassInput } from "../types/reflexion.types";

export function reflexionController(service: ReflexionService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, ReflexionPassBodySchema, reply);
    if (body === null) return;
    // Schema applies defaults at runtime; cast asserts the post-validation
    // shape that the service contract requires.
    return service.runPass(body as ReflexionPassInput);
  });
}

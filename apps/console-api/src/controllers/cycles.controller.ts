// apps/console-api/src/controllers/cycles.controller.ts
import type { FastifyRequest } from "fastify";
import type { CycleRunnerService } from "../services/cycle-runner.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { CycleRunBodySchema } from "../schemas";

const DEFAULT_QUERY =
  "Current SSA situation — upcoming conjunctions, catalog anomalies, debris forecast";

export function cycleRunController(service: CycleRunnerService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, CycleRunBodySchema, reply);
    if (body === null) return;
    const query = body.query ?? DEFAULT_QUERY;
    const result = await service.runUserCycle(body.kind, query);
    if (result.cycle.error)
      return reply.code(500).send({ ...result, error: result.cycle.error });
    return result;
  });
}

export function cycleHistoryController(service: CycleRunnerService) {
  return asyncHandler(async () => ({ items: service.listHistory() }));
}

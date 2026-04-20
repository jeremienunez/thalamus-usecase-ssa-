// apps/console-api/src/controllers/cycles.controller.ts
import type { FastifyRequest } from "fastify";
import type { CycleRunnerService } from "../services/cycle-runner.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { CycleRunBodySchema } from "../schemas";
import { toCycleRunResponseDto } from "../transformers/cycle-run.transformer";

const DEFAULT_QUERY =
  "Current SSA situation — upcoming conjunctions, catalog anomalies, debris forecast";

export function cycleRunController(service: CycleRunnerService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, CycleRunBodySchema, reply);
    if (body === null) return;
    const query = body.query ?? DEFAULT_QUERY;
    const result = await service.runUserCycle(body.kind, query);
    // Wire projection is owned by the transformer — the controller only
    // chooses the status code and adds the top-level `error` mirror on
    // the failure path (see CycleRunResponseDto).
    const dto = toCycleRunResponseDto(result.cycle);
    if (result.cycle.error)
      return reply.code(500).send({ ...dto, error: result.cycle.error });
    return dto;
  });
}

export function cycleHistoryController(service: CycleRunnerService) {
  return asyncHandler(async () => ({ items: service.listHistory() }));
}

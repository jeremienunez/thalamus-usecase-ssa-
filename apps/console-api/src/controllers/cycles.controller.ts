// apps/console-api/src/controllers/cycles.controller.ts
import type { FastifyRequest } from "fastify";
import type { CycleKind } from "../types";
import type { CycleRunnerService } from "../services/cycle-runner.service";
import { asyncHandler } from "../utils/async-handler";

export function cycleRunController(service: CycleRunnerService) {
  return asyncHandler<
    FastifyRequest<{ Body: { kind?: CycleKind; query?: string } }>
  >(async (req, reply) => {
    const kind = req.body?.kind;
    if (kind !== "thalamus" && kind !== "fish" && kind !== "both") {
      return reply
        .code(400)
        .send({ error: "kind must be 'thalamus' | 'fish' | 'both'" });
    }
    const query =
      req.body?.query?.trim() ||
      "Current SSA situation — upcoming conjunctions, catalog anomalies, debris forecast";
    const result = await service.runUserCycle(kind, query);
    if ("error" in result) return reply.code(500).send(result);
    return result;
  });
}

export function cycleHistoryController(service: CycleRunnerService) {
  return asyncHandler(async () => ({ items: service.listHistory() }));
}

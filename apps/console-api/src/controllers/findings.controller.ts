import type { FastifyRequest } from "fastify";
import type { FindingViewService } from "../services/finding-view.service";
import { asyncHandler } from "../utils/async-handler";

export function findingsListController(service: FindingViewService) {
  return asyncHandler<
    FastifyRequest<{ Querystring: { status?: string; cortex?: string } }>
  >(async (req) => {
    return service.list(req.query);
  });
}

export function findingByIdController(service: FindingViewService) {
  return asyncHandler<FastifyRequest<{ Params: { id: string } }>>(
    async (req, reply) => {
      const out = await service.findById(req.params.id);
      if (out === "invalid") return reply.code(400).send({ error: "invalid id" });
      if (out === null) return reply.code(404).send({ error: "not found" });
      return out;
    },
  );
}

export function findingDecisionController(service: FindingViewService) {
  return asyncHandler<
    FastifyRequest<{
      Params: { id: string };
      Body: { decision: string; reason?: string };
    }>
  >(async (req, reply) => {
    const decision = req.body?.decision ?? "";
    const out = await service.updateDecision(req.params.id, decision);
    if (out === "invalid")
      return reply.code(400).send({ error: "invalid id or decision" });
    if (out === null) return reply.code(404).send({ error: "not found" });
    return { ok: true, finding: out };
  });
}

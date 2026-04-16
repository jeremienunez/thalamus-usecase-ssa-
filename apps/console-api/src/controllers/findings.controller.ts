import type { FastifyRequest } from "fastify";
import type { FindingViewService } from "../services/finding-view.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  FindingsListQuerySchema,
  FindingIdParamsSchema,
  FindingDecisionBodySchema,
} from "../schemas";

export function findingsListController(service: FindingViewService) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, FindingsListQuerySchema, reply);
      if (q === null) return;
      return service.list(q);
    },
  );
}

export function findingByIdController(service: FindingViewService) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, FindingIdParamsSchema, reply);
      if (params === null) return;
      const out = await service.findById(params.id);
      if (out === "invalid-id")
        return reply.code(400).send({ error: "invalid id" });
      if (out === null) return reply.code(404).send({ error: "not found" });
      return out;
    },
  );
}

export function findingDecisionController(service: FindingViewService) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, FindingIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, FindingDecisionBodySchema, reply);
      if (body === null) return;
      const out = await service.updateDecision(params.id, body.decision);
      if (out === "invalid-id")
        return reply.code(400).send({ error: "invalid id" });
      if (out === "invalid-decision")
        return reply.code(400).send({ error: "invalid decision" });
      if (out === null) return reply.code(404).send({ error: "not found" });
      return { ok: true, finding: out };
    },
  );
}

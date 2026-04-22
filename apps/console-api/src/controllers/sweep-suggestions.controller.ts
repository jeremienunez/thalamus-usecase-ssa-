// apps/console-api/src/controllers/sweep-suggestions.controller.ts
import type { FastifyRequest } from "fastify";
import type { SweepSuggestionsService } from "../services/sweep-suggestions.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { SweepReviewParamsSchema, SweepReviewBodySchema } from "../schemas";

export type SweepSuggestionsControllerPort = Pick<
  SweepSuggestionsService,
  "list" | "review"
>;

export function sweepSuggestionsListController(
  service: SweepSuggestionsControllerPort,
) {
  return asyncHandler(() => service.list());
}

export function sweepReviewController(service: SweepSuggestionsControllerPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SweepReviewParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, SweepReviewBodySchema, reply);
      if (body === null) return;
      const result = await service.review(params.id, body.accept, body.reason);
      if (result.ok === false)
        return reply.code(404).send({ error: "not found" });
      return result;
    },
  );
}

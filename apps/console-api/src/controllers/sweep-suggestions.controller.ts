// apps/console-api/src/controllers/sweep-suggestions.controller.ts
import type { FastifyRequest } from "fastify";
import type { SweepSuggestionsService } from "../services/sweep-suggestions.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { SweepReviewParamsSchema, SweepReviewBodySchema } from "../schemas";

/**
 * Structural deps for sweep-suggestions controllers. Kept here so the
 * container can compose it from `@interview/sweep` at boot, and so the
 * service file imports its shape back from this module.
 */
export interface SweepDeps {
  sweepRepo: {
    list(opts: { reviewed: boolean; limit: number }): Promise<{
      rows: Array<{
        id: string;
        title: string;
        description: string;
        suggestedAction: string;
        category: string;
        severity: string;
        operatorCountryName: string | null;
        affectedSatellites: number;
        createdAt: string;
        accepted: boolean;
        resolutionStatus: string;
        resolutionPayload: string | null;
      }>;
    }>;
    review(id: string, accept: boolean, reason?: string): Promise<boolean>;
  };
  resolutionService: { resolve(id: string): Promise<unknown> };
}

export function sweepSuggestionsListController(
  service: SweepSuggestionsService,
) {
  return asyncHandler(() => service.list());
}

export function sweepReviewController(service: SweepSuggestionsService) {
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

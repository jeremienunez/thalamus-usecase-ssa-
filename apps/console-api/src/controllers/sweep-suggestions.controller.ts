// apps/console-api/src/controllers/sweep-suggestions.controller.ts
import type { FastifyRequest } from "fastify";
import { asyncHandler } from "../utils/async-handler";

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

export function sweepSuggestionsListController(deps: SweepDeps) {
  return asyncHandler(async () => {
    const res = await deps.sweepRepo.list({ reviewed: false, limit: 100 });
    const items = res.rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      suggestedAction: r.suggestedAction,
      category: r.category,
      severity: r.severity,
      operatorCountryName: r.operatorCountryName,
      affectedSatellites: r.affectedSatellites,
      createdAt: r.createdAt,
      accepted: r.accepted,
      resolutionStatus: r.resolutionStatus,
      hasPayload: Boolean(r.resolutionPayload),
    }));
    return { items, total: items.length };
  });
}

export function sweepReviewController(deps: SweepDeps) {
  return asyncHandler<
    FastifyRequest<{
      Params: { id: string };
      Body: { accept: boolean; reason?: string };
    }>
  >(async (req, reply) => {
    const { id } = req.params;
    const { accept, reason } = req.body ?? { accept: false };
    const ok = await deps.sweepRepo.review(id, accept, reason);
    if (!ok) return reply.code(404).send({ error: "not found" });
    if (accept) {
      const resolution = await deps.resolutionService.resolve(id);
      return { ok: true, reviewed: true, resolution };
    }
    return { ok: true, reviewed: true, resolution: null };
  });
}

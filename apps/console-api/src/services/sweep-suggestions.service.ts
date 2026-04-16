// apps/console-api/src/services/sweep-suggestions.service.ts
/**
 * Service layer for sweep suggestions.
 *
 * Thin DTO-projection layer around the @interview/sweep `sweepRepo` + the
 * sweep resolution service. Controllers delegate to this class so route
 * handlers stay boring (just request/reply glue).
 */
import type { SweepDeps } from "../controllers/sweep-suggestions.controller";

export type SuggestionListItem = {
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
  hasPayload: boolean;
};

export type ReviewResult =
  | { ok: true; reviewed: true; resolution: unknown | null }
  | { ok: false; notFound: true };

export class SweepSuggestionsService {
  constructor(private readonly deps: SweepDeps) {}

  async list(): Promise<{ items: SuggestionListItem[]; count: number }> {
    const res = await this.deps.sweepRepo.list({ reviewed: false, limit: 100 });
    const items: SuggestionListItem[] = res.rows.map((r) => ({
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
    return { items, count: items.length };
  }

  async review(
    id: string,
    accept: boolean,
    reason?: string,
  ): Promise<ReviewResult> {
    const ok = await this.deps.sweepRepo.review(id, accept, reason);
    if (!ok) return { ok: false, notFound: true };
    if (accept) {
      const resolution = await this.deps.resolutionService.resolve(id);
      return { ok: true, reviewed: true, resolution };
    }
    return { ok: true, reviewed: true, resolution: null };
  }
}

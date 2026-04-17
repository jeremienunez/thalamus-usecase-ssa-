// apps/console-api/src/services/sweep-suggestions.service.ts
/**
 * Service layer for sweep suggestions.
 *
 * Thin DTO-projection layer around the @interview/sweep `sweepRepo` + the
 * sweep resolution service. Controllers delegate to this class so route
 * handlers stay boring (just request/reply glue).
 */
import { toSuggestionListItem } from "../transformers/sweep-suggestions.transformer";
import type { SuggestionListItem } from "../types/sweep.types";

export type { SuggestionListItem } from "../types/sweep.types";

/**
 * Structural deps for sweep-suggestions. Owned by the service (DIP: the
 * consumer declares its port). The container composes this from
 * `@interview/sweep` at boot; the controller imports this type for wiring.
 */
export interface SweepSuggestionsDeps {
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

export type ReviewResult =
  | { ok: true; reviewed: true; resolution: unknown | null }
  | { ok: false; notFound: true };

export class SweepSuggestionsService {
  constructor(private readonly deps: SweepSuggestionsDeps) {}

  async list(): Promise<{ items: SuggestionListItem[]; count: number }> {
    const res = await this.deps.sweepRepo.list({ reviewed: false, limit: 100 });
    const items = res.rows.map(toSuggestionListItem);
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

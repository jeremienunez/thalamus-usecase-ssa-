import type { ApiFetcher } from "./client";
import type { SweepSuggestionDto } from "@/dto/http";

export interface SweepApiPort {
  listSuggestions(): Promise<{ items: SweepSuggestionDto[]; count: number }>;
  review(
    id: string,
    accept: boolean,
    reason?: string,
  ): Promise<{
    ok: boolean;
    reviewed: boolean;
    resolution: { status: string; affectedRows: number; errors?: string[] } | null;
  }>;
}

export function createSweepApi(f: ApiFetcher): SweepApiPort {
  return {
    listSuggestions: () => f.getJson(`/api/sweep/suggestions`),
    review: (id, accept, reason) =>
      f.postJson(`/api/sweep/suggestions/${encodeURIComponent(id)}/review`, {
        accept,
        reason,
      }),
  };
}

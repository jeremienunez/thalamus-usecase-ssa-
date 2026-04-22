import type { ApiFetcher } from "./client";
import type { FindingDto, FindingStatus } from "@/dto/http";

export interface FindingsApiPort {
  list(params?: {
    status?: FindingStatus;
    cortex?: string;
  }): Promise<{ items: FindingDto[]; count: number }>;
  findById(id: string): Promise<FindingDto>;
  decide(
    id: string,
    decision: FindingStatus,
    reason?: string,
  ): Promise<{ ok: boolean; finding: FindingDto }>;
}

export function createFindingsApi(f: ApiFetcher): FindingsApiPort {
  return {
    list: (params) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.cortex) qs.set("cortex", params.cortex);
      return f.getJson(`/api/findings${qs.toString() ? `?${qs}` : ""}`);
    },
    findById: (id) => f.getJson(`/api/findings/${encodeURIComponent(id)}`),
    decide: (id, decision, reason) =>
      f.postJson(`/api/findings/${encodeURIComponent(id)}/decision`, {
        decision,
        reason,
      }),
  };
}

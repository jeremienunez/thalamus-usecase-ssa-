import { toStatsView } from "../transformers/stats.transformer";
import type { AggregateCounts, StatsView } from "../types/stats.types";

export type { StatsView };

// ── Port (structural — repo satisfies this by duck typing) ────────
export interface StatsReadPort {
  aggregates(): Promise<AggregateCounts>;
  findingsByStatus(): Promise<Array<{ status: string; count: number }>>;
  findingsByCortex(): Promise<Array<{ cortex: string; count: number }>>;
}

export class StatsService {
  constructor(private readonly repo: StatsReadPort) {}

  async snapshot(): Promise<StatsView> {
    const [agg, byStatus, byCortex] = await Promise.all([
      this.repo.aggregates(),
      this.repo.findingsByStatus(),
      this.repo.findingsByCortex(),
    ]);
    return toStatsView(agg, byStatus, byCortex);
  }
}

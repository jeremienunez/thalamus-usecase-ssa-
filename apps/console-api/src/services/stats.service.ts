import { mapFindingStatus } from "../utils/finding-status";
import type { StatsRepository } from "../repositories/stats.repository";

export type StatsView = {
  satellites: number;
  conjunctions: number;
  kgNodes: number;
  kgEdges: number;
  findings: number;
  researchCycles: number;
  byStatus: Record<string, number>;
  byCortex: Record<string, number>;
};

export class StatsService {
  constructor(private readonly repo: StatsRepository) {}

  async snapshot(): Promise<StatsView> {
    const [agg, byStatusRaw, byCortex] = await Promise.all([
      this.repo.aggregates(),
      this.repo.findingsByStatus(),
      this.repo.findingsByCortex(),
    ]);

    const byStatusMapped = new Map<string, number>();
    for (const r of byStatusRaw) {
      const mapped = mapFindingStatus(r.status);
      byStatusMapped.set(
        mapped,
        (byStatusMapped.get(mapped) ?? 0) + Number(r.count),
      );
    }

    return {
      satellites: Number(agg.satellites),
      conjunctions: Number(agg.conjunctions),
      kgNodes: Number(agg.satellites) + Number(agg.findings),
      kgEdges: Number(agg.kg_edges),
      findings: Number(agg.findings),
      researchCycles: Number(agg.research_cycles),
      byStatus: Object.fromEntries(byStatusMapped),
      byCortex: Object.fromEntries(
        byCortex.map((r) => [r.cortex, Number(r.count)]),
      ),
    };
  }
}

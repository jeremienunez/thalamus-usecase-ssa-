import type {
  AggregateCounts,
  StatsView,
} from "../types/stats.types";
import { mapFindingStatus } from "./finding-status.transformer";

export function toStatsView(
  agg: AggregateCounts,
  byStatus: Array<{ status: string; count: number }>,
  byCortex: Array<{ cortex: string; count: number }>,
): StatsView {
  const byStatusMapped = new Map<string, number>();
  for (const r of byStatus) {
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

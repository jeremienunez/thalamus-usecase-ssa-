// apps/console-api/src/types/stats.types.ts
export type AggregateCounts = {
  satellites: number;
  conjunctions: number;
  findings: number;
  kg_edges: number;
  research_cycles: number;
};

export type GroupedCount = { key: string; count: number };

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

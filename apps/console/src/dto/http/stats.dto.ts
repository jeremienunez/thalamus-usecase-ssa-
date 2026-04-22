export type StatsDto = {
  satellites: number;
  conjunctions: number;
  kgNodes: number;
  kgEdges: number;
  findings: number;
  byStatus: Record<string, number>;
  byCortex: Record<string, number>;
};

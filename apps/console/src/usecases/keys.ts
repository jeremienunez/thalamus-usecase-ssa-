import type { FindingStatus, Regime } from "@/dto/http";

/** Centralised TanStack Query keys. One tuple shape per cacheable resource. */
export const qk = {
  satellites: (regime?: Regime) => ["satellites", regime] as const,
  satellitePayloads: (satelliteId: number) =>
    ["satellite-payloads", satelliteId] as const,
  conjunctions: (minPc?: number) => ["conjunctions", minPc] as const,
  kg: () => ["kg"] as const,
  findings: (status?: FindingStatus, cortex?: string) =>
    ["findings", status, cortex] as const,
  finding: (id: string) => ["finding", id] as const,
  stats: () => ["stats"] as const,
  cycles: () => ["cycles"] as const,
  sweepSuggestions: () => ["sweep-suggestions"] as const,
  missionStatus: () => ["sweep-mission-status"] as const,
  autonomyStatus: () => ["autonomy-status"] as const,
};

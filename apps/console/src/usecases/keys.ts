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
  operatorSwarms: (status?: string, kind?: string, cursor?: string) =>
    ["sim-operator-swarms", status, kind, cursor] as const,
  operatorSwarmStatus: (swarmId: string) =>
    ["sim-operator-swarm-status", swarmId] as const,
  operatorSwarmClusters: (swarmId: string) =>
    ["sim-operator-swarm-clusters", swarmId] as const,
  operatorSwarmTerminals: (swarmId: string) =>
    ["sim-operator-swarm-terminals", swarmId] as const,
  operatorFishTimeline: (swarmId: string, fishIndex: number) =>
    ["sim-operator-fish-timeline", swarmId, fishIndex] as const,
  operatorReviewEvidence: (swarmId: string) =>
    ["sim-operator-review-evidence", swarmId] as const,
};

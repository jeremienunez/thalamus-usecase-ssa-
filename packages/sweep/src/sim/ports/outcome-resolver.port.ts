import type { SimSwarmTerminalRow } from "./swarm-store.port";

export interface SimResolvedOutcome {
  status: "done" | "failed";
  snapshotKey?: string;
  snapshot?: Record<string, unknown> | null;
  primarySuggestionId?: number | null;
  reportFindingId?: number | null;
}

export interface SimOutcomeResolver {
  resolve(args: {
    swarmId: number;
    terminals: SimSwarmTerminalRow[];
    swarm: {
      id: number;
      kind: string;
      size: number;
      config: Record<string, unknown>;
      baseSeed: Record<string, unknown>;
    };
  }): Promise<SimResolvedOutcome>;
}

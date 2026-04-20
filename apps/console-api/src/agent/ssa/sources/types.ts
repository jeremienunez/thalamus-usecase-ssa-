export interface SourceResult {
  type: string;
  source: string;
  url?: string;
  data: unknown;
  fetchedAt: string;
  latencyMs: number;
}

export type SourceFetcher = (
  params: Record<string, unknown>,
) => Promise<SourceResult[]>;

/**
 * Known SSA-domain source keys. Kept as a string-literal union so the
 * registry can route by `cortexName → SourceFetcher[]` while skills
 * and planners refer to sources by a stable identifier.
 */
export type SourceKind =
  | "celestrak"
  | "space-weather"
  | "launch-market"
  | "bus-archetype"
  | "orbit-regime"
  | "spectra"
  | "regulation"
  | "knowledge-graph";

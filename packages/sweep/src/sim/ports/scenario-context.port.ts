/**
 * SimScenarioContextProvider — kernel ↔ pack contract for per-run prompt bags.
 */

export interface SimScenarioContextProvider {
  loadContext(args: {
    simRunId: number;
    seedHints: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
}

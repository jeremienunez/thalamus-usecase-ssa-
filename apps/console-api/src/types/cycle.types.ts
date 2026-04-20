// apps/console-api/src/types/cycle.types.ts
import type { CycleKind } from "../schemas/cycles.schema";

export type { CycleKind };

/**
 * Per-finding projection returned by `POST /api/cycles/run` when the cycle
 * ran the thalamus path. Shape matches what the CLI adapter consumes
 * (packages/cli/src/adapters/thalamus.http.ts). Kept small on purpose —
 * richer lookups go via `/api/findings`.
 */
export type CycleRunFinding = {
  id: string;
  title: string;
  summary: string;
  sourceClass: string;
  confidence: number;
  evidenceRefs: string[];
};

export type CycleRun = {
  id: string;
  kind: CycleKind;
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
  error?: string;
  /**
   * Populated only for kind="thalamus"|"both" when the thalamus branch ran.
   * Absent on fish-only runs so the existing UI contract stays additive.
   */
  findings?: CycleRunFinding[];
  /** Total LLM cost in USD for the thalamus branch, when applicable. */
  costUsd?: number;
};

// apps/console-api/src/types/cycle.types.ts
import type { CycleKind } from "../schemas/cycles.schema";

export type { CycleKind };

export type CycleRun = {
  id: string;
  kind: CycleKind;
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
  error?: string;
};

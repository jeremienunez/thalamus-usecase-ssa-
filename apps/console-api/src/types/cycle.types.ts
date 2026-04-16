// apps/console-api/src/types/cycle.types.ts
export type CycleKind = "thalamus" | "fish" | "both";

export type CycleRun = {
  id: string;
  kind: CycleKind;
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
  error?: string;
};

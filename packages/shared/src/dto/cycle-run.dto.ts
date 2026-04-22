export type CycleRunFindingDto = {
  id: string;
  title: string;
  summary: string;
  sourceClass: string;
  confidence: number;
  evidenceRefs: string[];
};

export type CycleRunDto = {
  id: string;
  kind: "thalamus" | "fish" | "both";
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
  error?: string;
  findings?: CycleRunFindingDto[];
  costUsd?: number;
};

export type CycleRunResponseDto = {
  cycle: CycleRunDto;
  error?: string;
};

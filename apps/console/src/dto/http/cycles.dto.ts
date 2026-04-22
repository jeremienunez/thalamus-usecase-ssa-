export type CycleDto = {
  id: string;
  kind: "thalamus" | "fish" | "both";
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
};

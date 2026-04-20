// apps/console-api/src/types/autonomy.types.ts
export type AutonomyAction = "thalamus" | "sweep-nullscan" | "fish-swarm";

export type AutonomyTick = {
  id: string;
  action: AutonomyAction;
  queryOrMode: string;
  startedAt: string;
  completedAt: string;
  emitted: number;
  costUsd: number;
  error?: string;
};

export type AutonomyState = {
  running: boolean;
  intervalMs: number;
  tickCount: number;
  currentTick: AutonomyTick | null;
  history: AutonomyTick[];
  startedAt: string | null;
  rotationIdx: number;
  queryIdx: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  stoppedReason:
    | null
    | "daily_budget_exhausted"
    | "monthly_budget_exhausted"
    | "max_thalamus_cycles_per_day"
    | "stopped_by_operator";
};

export type AutonomyTickDTO = {
  id: string;
  action: "thalamus" | "sweep-nullscan" | "fish-swarm";
  queryOrMode: string;
  startedAt: string;
  completedAt: string;
  emitted: number;
  costUsd: number;
  error?: string;
};

export type AutonomyStateDTO = {
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
  tickCount: number;
  currentTick: AutonomyTickDTO | null;
  history: AutonomyTickDTO[];
  dailySpendUsd: number;
  monthlySpendUsd: number;
  thalamusCyclesToday: number;
  stoppedReason:
    | null
    | "daily_budget_exhausted"
    | "monthly_budget_exhausted"
    | "max_thalamus_cycles_per_day"
    | "stopped_by_operator";
  nextTickInMs: number | null;
};

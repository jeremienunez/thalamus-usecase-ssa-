// apps/console-api/src/types/mission.types.ts
export type MissionTask = {
  suggestionId: string;
  satelliteId: string;
  satelliteName: string;
  noradId: number | null;
  field: string;
  operatorCountry: string;
  status: "pending" | "researching" | "filled" | "unobtainable" | "error";
  value: string | number | null;
  confidence: number;
  source: string | null;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type MissionState = {
  running: boolean;
  startedAt: string | null;
  tasks: MissionTask[];
  completedCount: number;
  filledCount: number;
  unobtainableCount: number;
  errorCount: number;
  cursor: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
};

export type NanoResult = {
  ok: boolean;
  value: string | number | null;
  confidence: number;
  source: string;
  unit: string;
  reason: string;
};

export type MissionStateView = {
  running: boolean;
  startedAt: string | null;
  total: number;
  completed: number;
  filled: number;
  unobtainable: number;
  errors: number;
  cursor: number;
  currentTask: MissionTask | null;
  recent: MissionTask[];
};

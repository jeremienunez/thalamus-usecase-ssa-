export type SweepSuggestionDTO = {
  id: string;
  title: string;
  description: string;
  suggestedAction: string;
  category: string;
  severity: "info" | "warning" | "critical";
  operatorCountryName: string;
  affectedSatellites: number;
  createdAt: string;
  accepted: boolean | null;
  resolutionStatus: string | null;
  hasPayload: boolean;
};

export type MissionTaskDTO = {
  suggestionId: string;
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

export type MissionStateDTO = {
  running: boolean;
  startedAt: string | null;
  total: number;
  completed: number;
  filled: number;
  unobtainable: number;
  errors: number;
  cursor: number;
  currentTask: MissionTaskDTO | null;
  recent: MissionTaskDTO[];
};

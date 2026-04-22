export type SweepSuggestionDto = {
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

export type MissionTaskDto = {
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

export type MissionStateDto = {
  running: boolean;
  startedAt: string | null;
  total: number;
  completed: number;
  filled: number;
  unobtainable: number;
  errors: number;
  cursor: number;
  currentTask: MissionTaskDto | null;
  recent: MissionTaskDto[];
};

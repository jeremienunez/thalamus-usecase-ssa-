export interface OperatorFleetSnapshot {
  operatorName: string;
  operatorCountry: string | null;
  satelliteCount: number;
  regimeMix: Array<{ regime: string; count: number }>;
  platformMix: Array<{ platform: string; count: number }>;
  avgLaunchYear: number | null;
}

export interface SimAgentSubjectSnapshot {
  displayName: string;
  attributes: Record<string, unknown>;
}

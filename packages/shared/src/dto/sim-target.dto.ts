export interface TelemetryTargetDto {
  satelliteId: number;
  satelliteName: string;
  noradId: number | null;
  regime: string | null;
  launchYear: number | null;
  busArchetype: string | null;
  busDatasheetPrior: Record<
    string,
    { typical: number; min: number; max: number; unit: string }
  > | null;
  sources: string[];
}

export interface PcEstimatorTargetDto {
  conjunctionId: number;
  tca: string | null;
  missDistanceKm: number | null;
  relativeVelocityKmps: number | null;
  currentPc: number | null;
  hardBodyRadiusMeters: number | null;
  combinedSigmaKm: number | null;
  primary: {
    id: number;
    name: string;
    noradId: number | null;
    bus: string | null;
  };
  secondary: {
    id: number;
    name: string;
    noradId: number | null;
    bus: string | null;
  };
  assumptions: {
    hardBodyRadiusMeters: number;
    covarianceScale: "tight" | "nominal" | "loose";
  } | null;
}

export interface SimScenarioContextDto {
  telemetryTarget: TelemetryTargetDto | null;
  pcEstimatorTarget: PcEstimatorTargetDto | null;
}

export interface SimTargetsDto {
  scenarioContext: SimScenarioContextDto | null;
}

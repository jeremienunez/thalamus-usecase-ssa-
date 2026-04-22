export interface TelemetryTargetView {
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

export interface PcEstimatorTargetView {
  conjunctionId: number;
  tca: Date | null;
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

export interface SimTargetsBag {
  telemetryTarget: TelemetryTargetView | null;
  pcEstimatorTarget: PcEstimatorTargetView | null;
}

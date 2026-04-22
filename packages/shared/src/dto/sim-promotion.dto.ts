export interface TelemetryPromotionScalarStatsDto {
  median: number;
  sigma: number;
  min: number;
  max: number;
  mean: number;
  n: number;
  values: number[];
  unit: string;
  avgFishConfidence: number;
}

export interface TelemetryPromotionAggregateDto {
  swarmId: number;
  satelliteId: number;
  totalFish: number;
  succeededFish: number;
  failedFish: number;
  quorumMet: boolean;
  scalars: Record<string, TelemetryPromotionScalarStatsDto | undefined>;
  simConfidence: number;
}

export interface SimPromotionTelemetryDto {
  swarmId: string;
  aggregate: TelemetryPromotionAggregateDto;
}

import type {
  PcEstimatorTargetView,
  SimTargetsBag,
  TelemetryTargetView,
} from "../services/sim-target.service";

export type TelemetryTargetDto = TelemetryTargetView;

export interface PcEstimatorTargetDto
  extends Omit<PcEstimatorTargetView, "tca"> {
  tca: string | null;
}

export interface SimTargetsDto {
  scenarioContext: {
    telemetryTarget: TelemetryTargetDto | null;
    pcEstimatorTarget: PcEstimatorTargetDto | null;
  } | null;
}

export function toSimTargetsDto(bag: SimTargetsBag): SimTargetsDto {
  return {
    scenarioContext: {
      telemetryTarget: bag.telemetryTarget,
      pcEstimatorTarget: bag.pcEstimatorTarget
        ? {
            ...bag.pcEstimatorTarget,
            tca: bag.pcEstimatorTarget.tca
              ? bag.pcEstimatorTarget.tca.toISOString()
              : null,
          }
        : null,
    },
  };
}

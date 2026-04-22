import type {
  PcEstimatorTargetDto,
  SimTargetsDto,
  TelemetryTargetDto,
} from "@interview/shared/dto/sim-target.dto";
import type { SimTargetsBag } from "../types/sim-target.types";

export function toSimTargetsDto(bag: SimTargetsBag): SimTargetsDto {
  return {
    scenarioContext: {
      telemetryTarget: bag.telemetryTarget as TelemetryTargetDto | null,
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

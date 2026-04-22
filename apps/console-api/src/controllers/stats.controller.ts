import type { StatsService } from "../services/stats.service";
import { asyncHandler } from "../utils/async-handler";

export type StatsControllerPort = Pick<StatsService, "snapshot">;

export function statsController(service: StatsControllerPort) {
  return asyncHandler(() => service.snapshot());
}

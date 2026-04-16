import type { StatsService } from "../services/stats.service";
import { asyncHandler } from "../utils/async-handler";

export function statsController(service: StatsService) {
  return asyncHandler(() => service.snapshot());
}

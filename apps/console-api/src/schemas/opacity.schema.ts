import { z } from "zod";
import { clampedInt, clampedNumber } from "./clamp";

export const OpacityCandidatesQuerySchema = z.object({
  limit: clampedInt(1, 500, 50),
  minScoreFloor: clampedNumber(0, 1, 0).optional(),
});
export type OpacityCandidatesQuery = z.infer<typeof OpacityCandidatesQuerySchema>;

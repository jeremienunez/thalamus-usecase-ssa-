import { z } from "zod";
import { clampedInt } from "./clamp";

export const SweepReviewParamsSchema = z.object({
  id: z.string().min(1).max(128), // strict id
});
export type SweepReviewParams = z.infer<typeof SweepReviewParamsSchema>;

export const SweepReviewBodySchema = z.object({
  accept: z.boolean(), // strict
  reason: z.string().max(2000).optional(),
});
export type SweepReviewBody = z.infer<typeof SweepReviewBodySchema>;

export const MissionStartBodySchema = z.object({
  maxSatsPerSuggestion: clampedInt(1, 20, 5), // clamp
});
export type MissionStartBody = z.infer<typeof MissionStartBodySchema>;

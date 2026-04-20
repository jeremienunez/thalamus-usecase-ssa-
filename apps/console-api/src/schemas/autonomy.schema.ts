import { z } from "zod";
import { clampedInt } from "./clamp";

export const AutonomyStartBodySchema = z.object({
  intervalSec: clampedInt(15, 600, 45).optional(),
});
export type AutonomyStartBody = z.infer<typeof AutonomyStartBodySchema>;

import { z } from "zod";
import { clampedInt } from "./clamp";

export const AutonomyStartBodySchema = z.object({
  intervalSec: clampedInt(15, 600, 45), // clamp
});
export type AutonomyStartBody = z.infer<typeof AutonomyStartBodySchema>;

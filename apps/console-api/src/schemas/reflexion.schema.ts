import { z } from "zod";
import { clampedNumber } from "./clamp";

export const ReflexionPassBodySchema = z.object({
  noradId: z.coerce.number().int().positive().max(99_999_999).finite(), // strict
  dIncMax: clampedNumber(0.01, 5, 0.3), // clamp
  dRaanMax: clampedNumber(0.1, 20, 5.0), // clamp
  dMmMax: clampedNumber(0.001, 0.5, 0.05), // clamp
});
export type ReflexionPassBody = z.infer<typeof ReflexionPassBodySchema>;

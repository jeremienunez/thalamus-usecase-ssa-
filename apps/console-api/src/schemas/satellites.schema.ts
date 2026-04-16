import { z } from "zod";
import { RegimeSchema } from "@interview/shared";
import { clampedInt } from "./clamp";

export const SatellitesQuerySchema = z.object({
  regime: RegimeSchema.optional(), // strict enum
  limit: clampedInt(1, 5000, 2000), // clamp
});
export type SatellitesQuery = z.infer<typeof SatellitesQuerySchema>;

import { z } from "zod";
import { clampedInt, clampedNumber } from "./clamp";

const WritableField = z.enum(["variant", "lifetime", "power", "mass_kg", "launch_year"]);

export const KnnPropagateBodySchema = z.object({
  field: WritableField, // strict
  k: clampedInt(3, 15, 5), // clamp
  minSim: clampedNumber(0.5, 0.99, 0.8), // clamp
  limit: clampedInt(1, 2000, 500), // clamp
  // `z.boolean()` not `.coerce.boolean()` — JSON bodies deliver real booleans,
  // and coercion would treat the string "false" as truthy if this endpoint
  // ever gets hit via querystring.
  dryRun: z.boolean().default(false),
});
export type KnnPropagateBody = z.infer<typeof KnnPropagateBodySchema>;

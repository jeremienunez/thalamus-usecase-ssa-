import { z } from "zod";
import { clampedNumber } from "./clamp";

export const ConjunctionsQuerySchema = z.object({
  minPc: clampedNumber(0, 1, 0), // clamp
});
export type ConjunctionsQuery = z.infer<typeof ConjunctionsQuerySchema>;

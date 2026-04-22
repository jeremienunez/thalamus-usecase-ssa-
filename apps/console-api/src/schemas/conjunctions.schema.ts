import { z } from "zod";
import { clampedInt, clampedNumber } from "./clamp";
import { optionalNonEmptyString } from "../utils/request-schema";

export const ConjunctionsQuerySchema = z.object({
  minPc: clampedNumber(0, 1, 0), // clamp
});
export type ConjunctionsQuery = z.infer<typeof ConjunctionsQuerySchema>;

export const ScreenQuerySchema = z.object({
  windowHours: clampedInt(1, 8760, 168),
  primaryNoradId: optionalNonEmptyString(),
  limit: clampedInt(1, 500, 20),
});
export type ScreenQuery = z.infer<typeof ScreenQuerySchema>;

export const KnnCandidatesQuerySchema = z.object({
  targetNoradId: z.preprocess(
    (v) => (typeof v === "string" ? Number(v) : v),
    z.number().int().finite(),
  ),
  knnK: clampedInt(1, 1000, 200),
  limit: clampedInt(1, 500, 50),
  marginKm: clampedNumber(0, 500, 20),
  objectClass: optionalNonEmptyString(),
  excludeSameFamily: z.preprocess(
    (v) => (v === "true" || v === true ? true : false),
    z.boolean().default(false),
  ),
  efSearch: clampedInt(10, 1000, 100),
});
export type KnnCandidatesQuery = z.infer<typeof KnnCandidatesQuerySchema>;

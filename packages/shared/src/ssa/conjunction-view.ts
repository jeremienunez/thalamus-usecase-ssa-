import { z } from "zod";

export const RegimeSchema = z.enum(["LEO", "MEO", "GEO", "HEO"]);
export type Regime = z.infer<typeof RegimeSchema>;

export const CovarianceQualitySchema = z.enum(["HIGH", "MED", "LOW"]);
export type CovarianceQuality = z.infer<typeof CovarianceQualitySchema>;

export const ConjunctionActionSchema = z.enum([
  "maneuver_candidate",
  "monitor",
  "no_action",
]);
export type ConjunctionAction = z.infer<typeof ConjunctionActionSchema>;

export const ConjunctionViewSchema = z.object({
  id: z.number(),
  primaryId: z.number(),
  secondaryId: z.number(),
  primaryName: z.string(),
  secondaryName: z.string(),
  regime: RegimeSchema,
  epoch: z.string(),
  minRangeKm: z.number(),
  relativeVelocityKmps: z.number(),
  probabilityOfCollision: z.number(),
  combinedSigmaKm: z.number(),
  hardBodyRadiusM: z.number(),
  pcMethod: z.string(),
  computedAt: z.string(),
  covarianceQuality: CovarianceQualitySchema,
  action: ConjunctionActionSchema,
});

export type ConjunctionView = z.infer<typeof ConjunctionViewSchema>;

export function deriveCovarianceQuality(sigmaKm: number): CovarianceQuality {
  if (sigmaKm < 0.1) return "HIGH";
  if (sigmaKm < 1) return "MED";
  return "LOW";
}

export function deriveAction(pc: number): ConjunctionAction {
  if (pc >= 1e-4) return "maneuver_candidate";
  if (pc >= 1e-6) return "monitor";
  return "no_action";
}

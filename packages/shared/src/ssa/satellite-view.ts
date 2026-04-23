import { z } from "zod";
import { RegimeSchema, type Regime } from "./conjunction-view";

export const ClassificationTierSchema = z.enum(["unclassified", "sensitive", "restricted"]);
export type ClassificationTier = z.infer<typeof ClassificationTierSchema>;

export const TelemetryViewSchema = z.object({
  powerDraw: z.number().nullable(),
  thermalMargin: z.number().nullable(),
  pointingAccuracy: z.number().nullable(),
  attitudeRate: z.number().nullable(),
  linkBudget: z.number().nullable(),
  dataRate: z.number().nullable(),
  payloadDuty: z.number().nullable(),
  eclipseRatio: z.number().nullable(),
  solarArrayHealth: z.number().nullable(),
  batteryDepthOfDischarge: z.number().nullable(),
  propellantRemaining: z.number().nullable(),
  radiationDose: z.number().nullable(),
  debrisProximity: z.number().nullable(),
  missionAge: z.number().nullable(),
});
export type TelemetryView = z.infer<typeof TelemetryViewSchema>;

export const SatelliteViewSchema = z.object({
  id: z.number(),
  name: z.string(),
  noradId: z.number(),
  regime: RegimeSchema,
  operator: z.string(),
  country: z.string(),
  inclinationDeg: z.number(),
  semiMajorAxisKm: z.number(),
  eccentricity: z.number(),
  raanDeg: z.number(),
  argPerigeeDeg: z.number(),
  meanAnomalyDeg: z.number(),
  meanMotionRevPerDay: z.number(),
  epoch: z.string(),
  massKg: z.number().nullable(),
  classificationTier: ClassificationTierSchema,
  opacityScore: z.number().nullable(),
  tleLine1: z.string().nullable().optional(),
  tleLine2: z.string().nullable().optional(),
  launchYear: z.number().nullable().optional(),
  objectClass: z.string().nullable().optional(),
  photoUrl: z.string().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  platformClass: z.string().nullable().optional(),
  busName: z.string().nullable().optional(),
  busGeneration: z.string().nullable().optional(),
  telemetry: TelemetryViewSchema.nullable().optional(),
  lastTleIngestedAt: z.string().nullable().optional(),
  meanMotionDrift: z.number().nullable().optional(),
});
export type SatelliteView = z.infer<typeof SatelliteViewSchema>;

export function normaliseRegime(raw: string | null | undefined): Regime {
  if (!raw) return "LEO";
  const r = raw.toLowerCase();
  if (r.includes("geo")) return "GEO";
  if (r.includes("meo")) return "MEO";
  if (r.includes("heo") || r.includes("hi")) return "HEO";
  return "LEO";
}

export function regimeFromMeanMotion(mm: number | null | undefined): Regime {
  if (mm == null) return "LEO";
  if (mm < 1.1) return "GEO";
  if (mm < 5) return "MEO";
  if (mm < 11) return "HEO";
  return "LEO";
}

export function smaFromMeanMotion(mm: number): number {
  // Kepler: a = ∛( μ · (T/2π)² ), T in seconds, μ = 398600.4418 km³/s²
  const period = 86400 / mm;
  return Math.pow(398600.4418 * Math.pow(period / (2 * Math.PI), 2), 1 / 3);
}

export function classificationTier(raw: string | null): ClassificationTier {
  if (!raw) return "unclassified";
  const r = raw.toLowerCase();
  if (r.includes("restrict") || r.includes("classif")) return "restricted";
  if (r.includes("sensit") || r.includes("limit")) return "sensitive";
  return "unclassified";
}

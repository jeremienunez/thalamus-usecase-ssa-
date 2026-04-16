import { z } from "zod";
import { clampedInt } from "./clamp";

export const FleetQuerySchema = z.object({
  operatorId: z.string().regex(/^\d+$/, "operatorId must be numeric").optional(),
  limit: clampedInt(1, 500, 10),
});
export type FleetQuery = z.infer<typeof FleetQuerySchema>;

export const RegimeParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "id must be a positive integer"),
});
export type RegimeParams = z.infer<typeof RegimeParamsSchema>;

export const RegimeQuerySchema = z.object({
  operatorCountryName: z.string().min(1).max(128).optional(),
  operatorCountryId: z.string().regex(/^\d+$/).optional(),
  orbitRegime: z.string().min(1).max(64).optional(),
  limit: clampedInt(1, 500, 10),
});
export type RegimeQuery = z.infer<typeof RegimeQuerySchema>;

export const SlotsQuerySchema = z.object({
  operatorId: z.string().regex(/^\d+$/, "operatorId must be numeric").optional(),
  horizonYears: clampedInt(1, 50, 5),
  limit: clampedInt(1, 500, 20),
});
export type SlotsQuery = z.infer<typeof SlotsQuerySchema>;

export const TrafficQuerySchema = z.object({
  windowDays: clampedInt(1, 365, 30),
  regimeId: z.string().regex(/^\d+$/).optional(),
  limit: clampedInt(1, 200, 30),
});
export type TrafficQuery = z.infer<typeof TrafficQuerySchema>;

export const DebrisForecastQuerySchema = z.object({
  regimeId: z.string().regex(/^\d+$/).optional(),
  horizonYears: clampedInt(1, 100, 10),
  limit: clampedInt(1, 200, 20),
});
export type DebrisForecastQuery = z.infer<typeof DebrisForecastQuerySchema>;

export const LaunchManifestQuerySchema = z.object({
  horizonDays: clampedInt(1, 3650, 365),
  regimeId: z.string().regex(/^\d+$/).optional(),
  limit: clampedInt(1, 200, 30),
});
export type LaunchManifestQuery = z.infer<typeof LaunchManifestQuerySchema>;

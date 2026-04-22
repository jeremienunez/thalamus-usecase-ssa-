import { z } from "zod";
import { clampedInt } from "./clamp";
import { numericIdString } from "../utils/request-schema";

export const FleetQuerySchema = z.object({
  operatorId: numericIdString("operatorId must be numeric").optional(),
  limit: clampedInt(1, 500, 10),
});
export type FleetQuery = z.infer<typeof FleetQuerySchema>;

export const RegimeParamsSchema = z.object({
  id: numericIdString("id must be a positive integer"),
});
export type RegimeParams = z.infer<typeof RegimeParamsSchema>;

export const RegimeQuerySchema = z.object({
  operatorCountryName: z.string().min(1).max(128).optional(),
  operatorCountryId: numericIdString().optional(),
  orbitRegime: z.string().min(1).max(64).optional(),
  limit: clampedInt(1, 500, 10),
});
export type RegimeQuery = z.infer<typeof RegimeQuerySchema>;

export const SlotsQuerySchema = z.object({
  operatorId: numericIdString("operatorId must be numeric").optional(),
  limit: clampedInt(1, 500, 20),
});
export type SlotsQuery = z.infer<typeof SlotsQuerySchema>;

export const TrafficQuerySchema = z.object({
  windowDays: clampedInt(1, 365, 30),
  regimeId: numericIdString().optional(),
  limit: clampedInt(1, 200, 30),
});
export type TrafficQuery = z.infer<typeof TrafficQuerySchema>;

export const DebrisForecastQuerySchema = z.object({
  regimeId: numericIdString().optional(),
  limit: clampedInt(1, 200, 20),
});
export type DebrisForecastQuery = z.infer<typeof DebrisForecastQuerySchema>;

export const LaunchManifestQuerySchema = z.object({
  horizonDays: clampedInt(1, 3650, 365),
  limit: clampedInt(1, 200, 30),
});
export type LaunchManifestQuery = z.infer<typeof LaunchManifestQuerySchema>;

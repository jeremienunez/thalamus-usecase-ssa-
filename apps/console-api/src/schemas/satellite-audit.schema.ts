import { z } from "zod";
import { clampedInt } from "./clamp";
import {
  numericIdString,
  optionalFiniteNumber,
} from "../utils/request-schema";

export const AuditDataQuerySchema = z.object({
  orbitRegime: z.string().optional(),
  limit: clampedInt(1, 200, 20),
});
export type AuditDataQuery = z.infer<typeof AuditDataQuerySchema>;

export const AuditClassificationQuerySchema = z.object({
  limit: clampedInt(1, 500, 50),
});
export type AuditClassificationQuery = z.infer<
  typeof AuditClassificationQuerySchema
>;

export const ApogeeHistoryQuerySchema = z.object({
  noradId: z.string().optional(),
  windowDays: clampedInt(1, 365, 30),
  limit: clampedInt(1, 100, 15),
});
export type ApogeeHistoryQuery = z.infer<typeof ApogeeHistoryQuerySchema>;

export const SatelliteIdParamsSchema = z.object({
  id: numericIdString("id must be numeric"),
});
export type SatelliteIdParams = z.infer<typeof SatelliteIdParamsSchema>;

export const OperatorNameParamsSchema = z.object({
  name: z.string().min(1),
});
export type OperatorNameParams = z.infer<typeof OperatorNameParamsSchema>;

export const CatalogContextQuerySchema = z.object({
  source: z.string().optional(),
  sinceEpoch: z.string().optional(),
  limit: clampedInt(1, 500, 50),
});
export type CatalogContextQuery = z.infer<typeof CatalogContextQuerySchema>;

export const ReplacementCostQuerySchema = z.object({
  satelliteId: numericIdString("satelliteId must be numeric"),
});
export type ReplacementCostQuery = z.infer<typeof ReplacementCostQuerySchema>;

export const LaunchCostQuerySchema = z.object({
  orbitRegime: z.string().optional(),
  minLaunchCost: optionalFiniteNumber(),
  maxLaunchCost: optionalFiniteNumber(),
  limit: clampedInt(1, 500, 50),
});
export type LaunchCostQuery = z.infer<typeof LaunchCostQuerySchema>;

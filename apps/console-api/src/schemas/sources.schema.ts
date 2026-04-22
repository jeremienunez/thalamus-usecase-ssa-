import { z } from "zod";
import { clampedInt } from "./clamp";
import {
  optionalFiniteNumber,
  optionalNonEmptyString,
} from "../utils/request-schema";

const optionalString = optionalNonEmptyString();

export const AdvisoryQuerySchema = z.object({
  sinceIso: optionalString,
  operatorId: optionalString,
  category: optionalString,
  limit: clampedInt(1, 200, 25),
});
export type AdvisoryQuery = z.infer<typeof AdvisoryQuerySchema>;

export const RssQuerySchema = z.object({
  category: optionalString,
  days: clampedInt(1, 90, 7),
  limit: clampedInt(1, 200, 50),
});
export type RssQuery = z.infer<typeof RssQuerySchema>;

export const ManeuverQuerySchema = z.object({
  conjunctionEventId: optionalString,
  maxDeltaVmps: optionalFiniteNumber(),
  limit: clampedInt(1, 200, 15),
});
export type ManeuverQuery = z.infer<typeof ManeuverQuerySchema>;

export const ObservationQuerySchema = z.object({
  stationId: optionalString,
  windowMinutes: clampedInt(1, 1440, 60),
  limit: clampedInt(1, 200, 20),
});
export type ObservationQuery = z.infer<typeof ObservationQuerySchema>;

export const CorrelationQuerySchema = z.object({
  conjunctionEventId: optionalString,
  limit: clampedInt(1, 200, 20),
});
export type CorrelationQuery = z.infer<typeof CorrelationQuerySchema>;

export const PrimerQuerySchema = z.object({
  topic: optionalString,
  stakeholderLevel: optionalString,
  limit: clampedInt(1, 200, 20),
});
export type PrimerQuery = z.infer<typeof PrimerQuerySchema>;

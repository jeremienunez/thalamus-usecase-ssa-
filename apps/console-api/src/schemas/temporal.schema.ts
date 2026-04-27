import { z } from "zod";
import { clampedInt } from "./clamp";

const TemporalSourceDomainSchema = z.enum([
  "production",
  "simulation",
  "simulation_seeded",
  "mixed",
]);

const booleanLike = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return value;
}, z.boolean().default(false));

export const TemporalPatternQuerySchema = z.object({
  terminalStatus: z.string().min(1).max(64).optional(),
  sourceDomain: TemporalSourceDomainSchema.optional(),
  includeAuditOnly: booleanLike,
  limit: clampedInt(1, 50, 20),
  cursor: z.string().min(1).max(256).optional(),
});

export type TemporalPatternQuery = z.infer<typeof TemporalPatternQuerySchema>;

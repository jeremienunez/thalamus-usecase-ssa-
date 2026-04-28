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

const dateString = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const TemporalShadowRunBodySchema = z.object({
  from: dateString,
  to: dateString,
  sourceDomain: TemporalSourceDomainSchema.exclude(["mixed"]).default("simulation"),
  targetOutcomes: z.array(z.string().min(1).max(64)).max(16).optional(),
  sourceScope: z.string().min(1).max(128).optional(),
  projectionVersion: z.string().min(1).max(128).optional(),
  params: z
    .object({
      pattern_window_ms: z.number().int().positive().optional(),
      pre_trace_decay_ms: z.number().int().positive().optional(),
      learning_rate: z.number().positive().max(1).optional(),
      activation_threshold: z.number().min(0).max(1).optional(),
      min_support: z.number().int().positive().optional(),
      max_steps: z.number().int().positive().max(8).optional(),
      pattern_version: z.string().min(1).max(128).optional(),
    })
    .strict()
    .optional(),
});

export type TemporalShadowRunBody = z.infer<typeof TemporalShadowRunBodySchema>;

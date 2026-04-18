/**
 * LegacySsaActionSchemaProvider + legacy SSA Zod schemas.
 *
 * Fallback path identical to apps/console-api/src/agent/ssa/sim/action-schema.ts.
 * Used when buildSweepContainer is called without opts.sim.schemaProvider.
 * Also re-exports godEventSchema so god-channel.service.ts (moved to the pack
 * in B.6) keeps compiling in the meantime.
 *
 * Deleted at Plan 2 Étape 4 (along with god-channel.service.ts which moves
 * in B.6).
 */

import { z } from "zod";
import { TELEMETRY_SCALAR_KEYS } from "@interview/db-schema";
import type { SimActionSchemaProvider } from "./ports";

const scalarValueSchema = z.object({
  value: z.number().finite(),
  unit: z.string().min(1).max(16),
});

const telemetryScalarsSchema = z.object(
  Object.fromEntries(
    TELEMETRY_SCALAR_KEYS.map((k) => [k, scalarValueSchema]),
  ) as Record<(typeof TELEMETRY_SCALAR_KEYS)[number], typeof scalarValueSchema>,
);

export const turnActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("maneuver"),
    satelliteId: z.number().int().positive(),
    deltaVmps: z.number().nonnegative(),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal("propose_split"),
    ownShareDeltaV: z.number().nonnegative(),
    counterpartyShareDeltaV: z.number().nonnegative(),
    reason: z.string().min(1),
  }),
  z.object({ kind: z.literal("accept"), reason: z.string().min(1) }),
  z.object({ kind: z.literal("reject"), reason: z.string().min(1) }),
  z.object({
    kind: z.literal("launch"),
    satelliteCount: z.number().int().positive(),
    regimeId: z.number().int().positive().optional(),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal("retire"),
    satelliteId: z.number().int().positive(),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal("lobby"),
    policyTopic: z.string().min(1),
    stance: z.enum(["support", "oppose"]),
    reason: z.string().min(1),
  }),
  z.object({ kind: z.literal("hold"), reason: z.string().min(1) }),
  z.object({
    kind: z.literal("infer_telemetry"),
    satelliteId: z.number().int().positive(),
    scalars: telemetryScalarsSchema,
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
  }),
  z.object({
    kind: z.literal("estimate_pc"),
    conjunctionId: z.number().int().positive(),
    pcEstimate: z.number().min(0).max(1),
    pcBand: z.object({
      p5: z.number().min(0).max(1),
      p50: z.number().min(0).max(1),
      p95: z.number().min(0).max(1),
    }),
    dominantMode: z.enum([
      "elliptical-overlap",
      "short-encounter",
      "long-encounter",
      "unknown",
    ]),
    rationale: z.string().max(600),
    assumptions: z.object({
      hardBodyRadiusMeters: z.number().positive(),
      covarianceScale: z.enum(["tight", "nominal", "loose"]),
      conjunctionGeometry: z.string().max(120),
    }),
    flags: z
      .array(
        z.enum([
          "low-data",
          "high-uncertainty",
          "degraded-covariance",
          "field-required",
        ]),
      )
      .default([]),
  }),
]);

export const godEventSchema = z.object({
  kind: z.enum([
    "regulation",
    "asat_event",
    "launch_surge",
    "debris_cascade",
    "custom",
  ]),
  summary: z.string().min(1),
  detail: z.string().optional(),
  targetSatelliteId: z.number().int().positive().optional(),
  targetOperatorId: z.number().int().positive().optional(),
});

export const perturbationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("noop") }),
  z.object({ kind: z.literal("god_event"), event: godEventSchema }),
  z.object({
    kind: z.literal("constraint_override"),
    agentIndex: z.number().int().nonnegative(),
    overrides: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("persona_tweak"),
    agentIndex: z.number().int().nonnegative(),
    riskProfile: z.enum(["conservative", "balanced", "aggressive"]),
  }),
  z.object({
    kind: z.literal("launch_surge"),
    regimeId: z.number().int().positive(),
    extraSatellites: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("delta_v_budget"),
    agentIndex: z.number().int().nonnegative(),
    maxPerSat: z.number().positive(),
  }),
  z.object({
    kind: z.literal("pc_assumptions"),
    hardBodyRadiusMeters: z.number().positive(),
    covarianceScale: z.enum(["tight", "nominal", "loose"]),
  }),
]);

export const busDatasheetPriorSchema = z.object({
  busArchetype: z.string(),
  scalars: z.record(
    z.string(),
    z.object({
      typical: z.number(),
      min: z.number(),
      max: z.number(),
      unit: z.string(),
    }),
  ),
});

export const seedRefsSchema = z.object({
  operatorIds: z.array(z.number().int().positive()).optional(),
  conjunctionFindingId: z.number().int().positive().optional(),
  horizonDays: z.number().int().positive().default(5),
  turnsPerDay: z.number().int().positive().default(1),
  telemetryTargetSatelliteId: z.number().int().positive().optional(),
  busDatasheetPrior: busDatasheetPriorSchema.optional(),
  pcEstimatorTarget: z.number().int().positive().optional(),
  pcAssumptions: z
    .object({
      hardBodyRadiusMeters: z.number().positive(),
      covarianceScale: z.enum(["tight", "nominal", "loose"]),
    })
    .optional(),
});

export const launchSwarmSchema = z.object({
  kind: z.enum([
    "uc1_operator_behavior",
    "uc3_conjunction",
    "uc_telemetry_inference",
    "uc_pc_estimator",
  ]),
  title: z.string().min(1),
  baseSeed: seedRefsSchema,
  perturbations: z.array(perturbationSchema).min(1),
  config: z.any(),
});

export type LaunchSwarmInput = z.infer<typeof launchSwarmSchema>;

export class LegacySsaActionSchemaProvider implements SimActionSchemaProvider {
  actionSchema(): z.ZodTypeAny {
    return turnActionSchema;
  }
}

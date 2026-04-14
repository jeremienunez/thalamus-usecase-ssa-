/**
 * Zod schemas for sim engine.
 *
 * These validate LLM-produced turn outputs and perturbation payloads at the
 * edges of the system. The action discriminated union mirrors TurnAction in
 * @interview/db-schema/sim.ts — keep the two in sync.
 */

import { z } from "zod";

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
]);

export const turnResponseSchema = z.object({
  action: turnActionSchema,
  rationale: z.string().min(10),
  observableSummary: z.string().min(5),
});

export type TurnResponseParsed = z.infer<typeof turnResponseSchema>;

// -----------------------------------------------------------------------
// Perturbation schemas — validate user-supplied swarm configs on routes.
// -----------------------------------------------------------------------

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
]);

export const swarmConfigSchema = z.object({
  llmMode: z.enum(["cloud", "fixtures", "record"]),
  quorumPct: z.number().min(0).max(1).default(0.8),
  perFishTimeoutMs: z.number().int().positive().default(60_000),
  fishConcurrency: z.number().int().min(1).max(16).default(8),
  nanoModel: z.string().default("gpt-5.4-nano"),
  seed: z.number().int().default(42),
});

export const seedRefsSchema = z.object({
  operatorIds: z.array(z.number().int().positive()).optional(),
  conjunctionFindingId: z.number().int().positive().optional(),
  horizonDays: z.number().int().positive().default(5),
  turnsPerDay: z.number().int().positive().default(1),
});

export const launchSwarmSchema = z.object({
  kind: z.enum(["uc1_operator_behavior", "uc3_conjunction"]),
  title: z.string().min(1),
  baseSeed: seedRefsSchema,
  perturbations: z.array(perturbationSchema).min(1),
  config: swarmConfigSchema,
});

export type LaunchSwarmInput = z.infer<typeof launchSwarmSchema>;

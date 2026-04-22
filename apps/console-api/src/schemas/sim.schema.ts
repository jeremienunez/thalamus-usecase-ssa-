import { z } from "zod";
import { numericIdString } from "../utils/request-schema";

const NumericIdStringSchema = numericIdString();

export const SimKindSchema = z.enum([
  "uc1_operator_behavior",
  "uc3_conjunction",
  "uc_telemetry_inference",
  "uc_pc_estimator",
]);
export const SimRunStatusSchema = z.enum([
  "pending",
  "running",
  "paused",
  "done",
  "failed",
]);
export const SimSwarmStatusSchema = z.enum(["pending", "running", "done", "failed"]);
export const MemoryKindSchema = z.enum(["self_action", "observation", "belief"]);
export const TurnActorKindSchema = z.enum(["agent", "god", "system"]);
export const TurnActionSchema = z.record(z.string(), z.unknown());
const OpaqueBagSchema = z.record(z.string(), z.unknown());
const OpaqueKindedBagSchema = z.object({ kind: z.string().min(1) }).catchall(z.unknown());

export const SeedRefsSchema = OpaqueBagSchema;
export const PerturbationSpecSchema = OpaqueKindedBagSchema;

export const SwarmConfigSchema = z.object({
  llmMode: z.enum(["cloud", "fixtures", "record"]),
  quorumPct: z.number().min(0).max(1),
  perFishTimeoutMs: z.number().int().positive(),
  fishConcurrency: z.number().int().positive(),
  nanoModel: z.string(),
  seed: z.number().int(),
});

export const SimConfigSchema = z.object({
  turnsPerDay: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  llmMode: z.enum(["cloud", "fixtures", "record"]),
  seed: z.number().int(),
  nanoModel: z.string(),
});

// ── Path params ───────────────────────────────────────────────────────

export const SimRunIdParamsSchema = z.object({
  id: NumericIdStringSchema,
});
export type SimRunIdParams = z.infer<typeof SimRunIdParamsSchema>;

export const SimSwarmIdParamsSchema = z.object({
  id: NumericIdStringSchema,
});
export type SimSwarmIdParams = z.infer<typeof SimSwarmIdParamsSchema>;

// ── God-event injection ───────────────────────────────────────────────

export const GodEventKindSchema = z.enum([
  "regulation",
  "asat_event",
  "launch_surge",
  "debris_cascade",
  "custom",
]);
export type GodEventKind = z.infer<typeof GodEventKindSchema>;

export const GodEventInjectBodySchema = z.object({
  kind: GodEventKindSchema,
  summary: z.string().min(1).max(500),
  detail: z.string().max(4000).optional(),
  targetSatelliteId: z.number().int().positive().optional(),
  targetOperatorId: z.number().int().positive().optional(),
});
export type GodEventInjectBody = z.infer<typeof GodEventInjectBodySchema>;

// ── Run / swarm rows ──────────────────────────────────────────────────

export const CreateRunBodySchema = z.object({
  swarmId: NumericIdStringSchema,
  fishIndex: z.number().int().nonnegative(),
  kind: SimKindSchema,
  seedApplied: SeedRefsSchema,
  perturbation: PerturbationSpecSchema,
  config: SimConfigSchema,
});

export const UpdateRunStatusBodySchema = z.object({
  status: SimRunStatusSchema,
  completedAt: z.string().datetime().nullable().optional(),
});

export const CreateSwarmBodySchema = z.object({
  kind: SimKindSchema,
  title: z.string().min(1).max(200),
  baseSeed: SeedRefsSchema,
  perturbations: z.array(PerturbationSpecSchema).min(1),
  size: z.number().int().positive(),
  config: SwarmConfigSchema,
  createdBy: NumericIdStringSchema.optional(),
});

export const LinkOutcomeBodySchema = z
  .object({
    reportFindingId: NumericIdStringSchema.optional(),
    suggestionId: NumericIdStringSchema.optional(),
  })
  .refine((body) => body.reportFindingId !== undefined || body.suggestionId !== undefined, {
    message: "at least one of reportFindingId or suggestionId must be provided",
  });

export const SnapshotAggregateBodySchema = z.object({
  key: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
});

export const CloseSwarmBodySchema = z.object({
  status: z.enum(["done", "failed"]),
  suggestionId: NumericIdStringSchema.nullable().optional(),
  reportFindingId: NumericIdStringSchema.nullable().optional(),
  completedAt: z.string().datetime().optional(),
});

// ── Turn persistence ──────────────────────────────────────────────────

export const CreateAgentBodySchema = z.object({
  subjectId: NumericIdStringSchema.nullable(),
  agentIndex: z.number().int().nonnegative(),
  persona: z.string().min(1),
  goals: z.array(z.string()),
  constraints: z.record(z.string(), z.unknown()),
});

export const InsertAgentTurnBodySchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  agentId: NumericIdStringSchema,
  action: TurnActionSchema,
  rationale: z.string().nullable(),
  observableSummary: z.string().min(1),
  llmCostUsd: z.number().nullable(),
});

export const PersistTurnBatchBodySchema = z.object({
  agentTurns: z.array(InsertAgentTurnBodySchema),
  memoryRows: z.array(
    z.object({
      agentId: NumericIdStringSchema,
      turnIndex: z.number().int().nonnegative(),
      kind: MemoryKindSchema,
      content: z.string().min(1),
      embedding: z.array(z.number()).nullable(),
    }),
  ),
});

export const InsertGodTurnBodySchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  action: TurnActionSchema,
  rationale: z.string().min(1),
  observableSummary: z.string().min(1),
});

export const ListGodEventsQuerySchema = z.object({
  beforeTurn: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

// ── Memory ────────────────────────────────────────────────────────────

export const WriteMemoryBatchBodySchema = z.array(
  z.object({
    agentId: NumericIdStringSchema,
    turnIndex: z.number().int().nonnegative(),
    kind: MemoryKindSchema,
    content: z.string().min(1),
    embedding: z.array(z.number()).nullable(),
  }),
);

export const MemorySearchBodySchema = z.object({
  agentId: NumericIdStringSchema,
  vec: z.array(z.number()).min(1),
  k: z.number().int().min(1).max(50),
});

export const MemoryRecentQuerySchema = z.object({
  agentId: NumericIdStringSchema,
  k: z.coerce.number().int().min(1).max(50),
});

export const ObservableQuerySchema = z.object({
  sinceTurn: z.coerce.number().int(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  excludeAgentId: NumericIdStringSchema.optional(),
});

// ── Queue ─────────────────────────────────────────────────────────────

export const EnqueueSimTurnBodySchema = z.object({
  simRunId: NumericIdStringSchema,
  turnIndex: z.number().int().nonnegative(),
  jobId: z.string().min(1).optional(),
});

export const EnqueueSwarmFishBodySchema = z.object({
  swarmId: NumericIdStringSchema,
  simRunId: NumericIdStringSchema,
  fishIndex: z.number().int().nonnegative(),
  jobId: z.string().min(1).optional(),
});

export const EnqueueSwarmAggregateBodySchema = z.object({
  swarmId: NumericIdStringSchema,
  jobId: z.string().min(1).optional(),
});

// ── Launchers ────────────────────────────────────────────────────────

export const StartTelemetryBodySchema = z.object({
  satelliteId: NumericIdStringSchema,
  fishCount: z.number().int().min(1).max(100).optional(),
  priorJitter: z.number().min(0).max(1).optional(),
  config: SwarmConfigSchema.partial().optional(),
  createdBy: NumericIdStringSchema.optional(),
});

export const StartPcBodySchema = z.object({
  conjunctionId: NumericIdStringSchema,
  fishCount: z.number().int().min(1).max(100).optional(),
  config: SwarmConfigSchema.partial().optional(),
  createdBy: NumericIdStringSchema.optional(),
});

export const StartStandaloneBodySchema = z.object({
  kind: z.enum(["uc1_operator_behavior", "uc3_conjunction"]),
  title: z.string().min(1).max(200),
  operatorIds: z.array(NumericIdStringSchema).min(1),
  horizonDays: z.number().int().positive().optional(),
  turnsPerDay: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
  llmMode: z.enum(["cloud", "fixtures", "record"]),
  nanoModel: z.string().optional(),
  seed: z.number().int().optional(),
  createdBy: NumericIdStringSchema.optional(),
  conjunctionFindingId: NumericIdStringSchema.optional(),
});

// ── SSA agent-subject / author-labels ─────────────────────────────────

export const AgentSubjectQuerySchema = z.object({
  kind: z.string().min(1),
  id: NumericIdStringSchema,
});
export type AgentSubjectQuery = z.infer<typeof AgentSubjectQuerySchema>;

export const AuthorLabelsBodySchema = z.object({
  agentIds: z
    .array(NumericIdStringSchema)
    .min(1)
    .max(500),
});
export type AuthorLabelsBody = z.infer<typeof AuthorLabelsBodySchema>;

const SwarmClusterSchema = z.object({
  label: z.string().min(1),
  fraction: z.number(),
  memberFishIndexes: z.array(z.number().int().nonnegative()),
  exemplarSimRunId: z.number().int().nonnegative(),
  exemplarAction: TurnActionSchema,
  exemplarSummary: z.string(),
  centroid: z.array(z.number()).nullable(),
});

const SwarmAggregateInputSchema = z.object({
  swarmId: z.number().int().nonnegative().optional(),
  totalFish: z.number().int().nonnegative(),
  quorumMet: z.boolean(),
  succeededFish: z.number().int().nonnegative(),
  failedFish: z.number().int().nonnegative(),
  clusters: z.array(SwarmClusterSchema),
  modal: z
    .object({
      actionKind: z.string().min(1),
      fraction: z.number(),
      exemplarSimRunId: z.number().int().nonnegative(),
      exemplarAction: TurnActionSchema,
    })
    .nullable(),
  divergenceScore: z.number(),
});

const TelemetryScalarStatsSchema = z.object({
  median: z.number(),
  sigma: z.number(),
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  n: z.number().int().positive(),
  values: z.array(z.number()),
  unit: z.string().min(1),
  avgFishConfidence: z.number().min(0).max(1),
});

const TelemetryAggregateInputSchema = z.object({
  swarmId: z.number().int().nonnegative().optional(),
  satelliteId: z.number().int().nonnegative(),
  totalFish: z.number().int().nonnegative(),
  succeededFish: z.number().int().nonnegative(),
  failedFish: z.number().int().nonnegative(),
  quorumMet: z.boolean(),
  scalars: z.record(z.string(), TelemetryScalarStatsSchema),
  simConfidence: z.number().min(0).max(1),
});

export const PromotionFromModalBodySchema = z.object({
  swarmId: NumericIdStringSchema,
  aggregate: SwarmAggregateInputSchema,
});

export const PromotionTelemetryBodySchema = z.object({
  swarmId: NumericIdStringSchema,
  aggregate: TelemetryAggregateInputSchema,
});

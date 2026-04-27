import {
  pgTable,
  bigserial,
  bigint,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { simRun } from "./sim";

export type TemporalSourceDomain =
  | "production"
  | "simulation"
  | "simulation_seeded"
  | "mixed";

export type TemporalProjectionStatus = "running" | "completed" | "failed";
export type TemporalLearningStatus = "running" | "completed" | "failed";
export type TemporalEvaluationStatus = "running" | "completed" | "failed";

export type TemporalPatternStatus =
  | "candidate"
  | "reviewable"
  | "accepted"
  | "rejected"
  | "deprecated";

export type TemporalPatternExampleRole =
  | "positive"
  | "negative"
  | "counterexample";

export interface TemporalScoreComponents {
  temporal_weight: number;
  support_factor: number;
  lift_factor: number;
  negative_penalty: number;
  stability_factor: number;
}

export const temporalProjectionRun = pgTable(
  "temporal_projection_run",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    projectionVersion: text("projection_version").notNull(),
    sourceScope: text("source_scope").notNull(),
    fromTs: timestamp("from_ts", { withTimezone: true }).notNull(),
    toTs: timestamp("to_ts", { withTimezone: true }).notNull(),
    inputSnapshotHash: text("input_snapshot_hash").notNull(),
    status: text("status").$type<TemporalProjectionStatus>().notNull(),
    metricsJson: jsonb("metrics_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    scopeIdx: index("idx_temporal_projection_run_scope").on(
      t.sourceScope,
      t.createdAt,
    ),
    snapshotIdx: index("idx_temporal_projection_run_snapshot").on(
      t.inputSnapshotHash,
    ),
    statusIdx: index("idx_temporal_projection_run_status").on(t.status),
  }),
);

export const temporalEvent = pgTable(
  "temporal_event",
  {
    id: text("id").primaryKey(),
    projectionRunId: bigint("projection_run_id", { mode: "bigint" })
      .notNull()
      .references(() => temporalProjectionRun.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventSource: text("event_source").notNull(),
    entityId: text("entity_id"),
    simRunId: bigint("sim_run_id", { mode: "bigint" }).references(
      () => simRun.id,
      { onDelete: "set null" },
    ),
    fishIndex: integer("fish_index"),
    turnIndex: integer("turn_index"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    agentId: text("agent_id"),
    actionKind: text("action_kind"),
    confidenceBefore: real("confidence_before"),
    confidenceAfter: real("confidence_after"),
    reviewOutcome: text("review_outcome"),
    terminalStatus: text("terminal_status"),
    embeddingId: text("embedding_id"),
    seededByPatternId: text("seeded_by_pattern_id"),
    sourceDomain: text("source_domain").$type<TemporalSourceDomain>().notNull(),
    canonicalSignature: text("canonical_signature").notNull(),
    sourceTable: text("source_table").notNull(),
    sourcePk: text("source_pk").notNull(),
    payloadHash: text("payload_hash").notNull(),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    timeDomainIdx: index("idx_temporal_event_time_domain").on(
      t.occurredAt,
      t.sourceDomain,
    ),
    simIdx: index("idx_temporal_event_sim").on(
      t.simRunId,
      t.fishIndex,
      t.turnIndex,
    ),
    seededIdx: index("idx_temporal_event_seeded").on(t.seededByPatternId),
    embeddingIdx: index("idx_temporal_event_embedding").on(t.embeddingId),
    signatureIdx: index("idx_temporal_event_signature").on(
      t.canonicalSignature,
      t.occurredAt,
    ),
    sourceUniq: uniqueIndex("uniq_temporal_event_source").on(
      t.projectionRunId,
      t.sourceTable,
      t.sourcePk,
      t.eventType,
    ),
  }),
);

export const temporalLearningRun = pgTable(
  "temporal_learning_run",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    patternVersion: text("pattern_version").notNull(),
    sourceDomain: text("source_domain").$type<TemporalSourceDomain>().notNull(),
    inputSnapshotHash: text("input_snapshot_hash").notNull(),
    paramsJson: jsonb("params_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status").$type<TemporalLearningStatus>().notNull(),
    metricsJson: jsonb("metrics_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    snapshotIdx: index("idx_temporal_learning_run_snapshot").on(
      t.inputSnapshotHash,
      t.patternVersion,
    ),
    statusIdx: index("idx_temporal_learning_run_status").on(t.status),
    domainIdx: index("idx_temporal_learning_run_domain").on(
      t.sourceDomain,
      t.startedAt,
    ),
  }),
);

export const temporalPatternHypothesis = pgTable(
  "temporal_pattern_hypothesis",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    patternHash: text("pattern_hash").notNull(),
    patternVersion: text("pattern_version").notNull(),
    status: text("status").$type<TemporalPatternStatus>().notNull(),
    sourceDomain: text("source_domain").$type<TemporalSourceDomain>().notNull(),
    terminalStatus: text("terminal_status").notNull(),
    patternWindowMs: integer("pattern_window_ms").notNull(),
    patternScore: real("pattern_score").notNull(),
    supportCount: integer("support_count").notNull(),
    negativeSupportCount: integer("negative_support_count").notNull().default(0),
    baselineRate: real("baseline_rate"),
    lift: real("lift"),
    scoreComponentsJson: jsonb("score_components_json")
      .$type<TemporalScoreComponents>()
      .notNull()
      .default({
        temporal_weight: 0,
        support_factor: 0,
        lift_factor: 0,
        negative_penalty: 0,
        stability_factor: 1,
      }),
    createdFromLearningRunId: bigint("created_from_learning_run_id", {
      mode: "bigint",
    })
      .notNull()
      .references(() => temporalLearningRun.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    hashVersionUniq: uniqueIndex("uniq_temporal_pattern_hash_version").on(
      t.patternHash,
      t.patternVersion,
    ),
    visibilityIdx: index("idx_temporal_pattern_visibility").on(
      t.status,
      t.terminalStatus,
      t.sourceDomain,
    ),
    learningRunIdx: index("idx_temporal_pattern_learning_run").on(
      t.createdFromLearningRunId,
    ),
  }),
);

export const temporalPatternStep = pgTable(
  "temporal_pattern_step",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    patternId: bigint("pattern_id", { mode: "bigint" })
      .notNull()
      .references(() => temporalPatternHypothesis.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    eventSignature: text("event_signature").notNull(),
    eventType: text("event_type").notNull(),
    eventSource: text("event_source").notNull(),
    avgDeltaMs: integer("avg_delta_ms").notNull(),
    supportCount: integer("support_count").notNull(),
  },
  (t) => ({
    patternStepUniq: uniqueIndex("uniq_temporal_pattern_step").on(
      t.patternId,
      t.stepIndex,
    ),
    signatureIdx: index("idx_temporal_pattern_step_signature").on(
      t.eventSignature,
    ),
  }),
);

export const temporalPatternEdge = pgTable(
  "temporal_pattern_edge",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    patternId: bigint("pattern_id", { mode: "bigint" })
      .notNull()
      .references(() => temporalPatternHypothesis.id, { onDelete: "cascade" }),
    fromSignature: text("from_signature").notNull(),
    toSignature: text("to_signature").notNull(),
    weight: real("weight").notNull(),
    supportCount: integer("support_count").notNull(),
    avgDeltaMs: integer("avg_delta_ms").notNull(),
  },
  (t) => ({
    patternIdx: index("idx_temporal_pattern_edge_pattern").on(t.patternId),
    transitionUniq: uniqueIndex("uniq_temporal_pattern_edge").on(
      t.patternId,
      t.fromSignature,
      t.toSignature,
    ),
    transitionIdx: index("idx_temporal_pattern_edge_transition").on(
      t.fromSignature,
      t.toSignature,
    ),
  }),
);

export const temporalPatternExample = pgTable(
  "temporal_pattern_example",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    patternId: bigint("pattern_id", { mode: "bigint" })
      .notNull()
      .references(() => temporalPatternHypothesis.id, { onDelete: "cascade" }),
    eventId: text("event_id")
      .notNull()
      .references(() => temporalEvent.id, { onDelete: "cascade" }),
    role: text("role").$type<TemporalPatternExampleRole>().notNull(),
    entityId: text("entity_id"),
    simRunId: bigint("sim_run_id", { mode: "bigint" }).references(
      () => simRun.id,
      { onDelete: "set null" },
    ),
    fishIndex: integer("fish_index"),
    turnIndex: integer("turn_index"),
    embeddingId: text("embedding_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    patternEventUniq: uniqueIndex("uniq_temporal_pattern_example").on(
      t.patternId,
      t.eventId,
      t.role,
    ),
    patternIdx: index("idx_temporal_pattern_example_pattern").on(t.patternId),
    eventIdx: index("idx_temporal_pattern_example_event").on(t.eventId),
  }),
);

export const temporalPatternReview = pgTable(
  "temporal_pattern_review",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    patternId: bigint("pattern_id", { mode: "bigint" })
      .notNull()
      .references(() => temporalPatternHypothesis.id, { onDelete: "cascade" }),
    reviewerId: bigint("reviewer_id", { mode: "bigint" }),
    reviewOutcome: text("review_outcome").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    patternIdx: index("idx_temporal_pattern_review_pattern").on(
      t.patternId,
      t.createdAt,
    ),
  }),
);

export const temporalPatternSeededRun = pgTable(
  "temporal_pattern_seeded_run",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    patternId: bigint("pattern_id", { mode: "bigint" })
      .notNull()
      .references(() => temporalPatternHypothesis.id, { onDelete: "cascade" }),
    simRunId: bigint("sim_run_id", { mode: "bigint" })
      .notNull()
      .references(() => simRun.id, { onDelete: "cascade" }),
    seedReason: text("seed_reason").notNull(),
    sourceDomain: text("source_domain").$type<TemporalSourceDomain>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    patternRunUniq: uniqueIndex("uniq_temporal_pattern_seeded_run").on(
      t.patternId,
      t.simRunId,
    ),
    simRunIdx: index("idx_temporal_pattern_seeded_run_sim").on(t.simRunId),
  }),
);

export const temporalPatternQueryLog = pgTable(
  "temporal_pattern_query_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    consumer: text("consumer").notNull(),
    patternId: bigint("pattern_id", { mode: "bigint" }).references(
      () => temporalPatternHypothesis.id,
      { onDelete: "set null" },
    ),
    queryHash: text("query_hash").notNull(),
    usedForSeed: boolean("used_for_seed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    consumerIdx: index("idx_temporal_pattern_query_log_consumer").on(
      t.consumer,
      t.createdAt,
    ),
    patternIdx: index("idx_temporal_pattern_query_log_pattern").on(t.patternId),
  }),
);

export const temporalEvaluationRun = pgTable(
  "temporal_evaluation_run",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    trainWindow: text("train_window").notNull(),
    validationWindow: text("validation_window").notNull(),
    testWindow: text("test_window").notNull(),
    configHash: text("config_hash").notNull(),
    baselinesJson: jsonb("baselines_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status").$type<TemporalEvaluationStatus>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    configIdx: index("idx_temporal_evaluation_run_config").on(t.configHash),
    statusIdx: index("idx_temporal_evaluation_run_status").on(t.status),
  }),
);

export const temporalEvaluationMetric = pgTable(
  "temporal_evaluation_metric",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    evaluationRunId: bigint("evaluation_run_id", { mode: "bigint" })
      .notNull()
      .references(() => temporalEvaluationRun.id, { onDelete: "cascade" }),
    metricName: text("metric_name").notNull(),
    metricValue: real("metric_value").notNull(),
    segment: text("segment").notNull(),
    baselineName: text("baseline_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runMetricIdx: index("idx_temporal_evaluation_metric_run").on(
      t.evaluationRunId,
      t.metricName,
      t.segment,
    ),
  }),
);

export type TemporalProjectionRun = typeof temporalProjectionRun.$inferSelect;
export type NewTemporalProjectionRun = typeof temporalProjectionRun.$inferInsert;

export type TemporalEvent = typeof temporalEvent.$inferSelect;
export type NewTemporalEvent = typeof temporalEvent.$inferInsert;

export type TemporalLearningRun = typeof temporalLearningRun.$inferSelect;
export type NewTemporalLearningRun = typeof temporalLearningRun.$inferInsert;

export type TemporalPatternHypothesis =
  typeof temporalPatternHypothesis.$inferSelect;
export type NewTemporalPatternHypothesis =
  typeof temporalPatternHypothesis.$inferInsert;

export type TemporalPatternStep = typeof temporalPatternStep.$inferSelect;
export type NewTemporalPatternStep = typeof temporalPatternStep.$inferInsert;

export type TemporalPatternEdge = typeof temporalPatternEdge.$inferSelect;
export type NewTemporalPatternEdge = typeof temporalPatternEdge.$inferInsert;

export type TemporalPatternExample = typeof temporalPatternExample.$inferSelect;
export type NewTemporalPatternExample = typeof temporalPatternExample.$inferInsert;

export type TemporalPatternReview = typeof temporalPatternReview.$inferSelect;
export type NewTemporalPatternReview = typeof temporalPatternReview.$inferInsert;

export type TemporalPatternSeededRun =
  typeof temporalPatternSeededRun.$inferSelect;
export type NewTemporalPatternSeededRun =
  typeof temporalPatternSeededRun.$inferInsert;

export type TemporalPatternQueryLog =
  typeof temporalPatternQueryLog.$inferSelect;
export type NewTemporalPatternQueryLog =
  typeof temporalPatternQueryLog.$inferInsert;

export type TemporalEvaluationRun = typeof temporalEvaluationRun.$inferSelect;
export type NewTemporalEvaluationRun =
  typeof temporalEvaluationRun.$inferInsert;

export type TemporalEvaluationMetric =
  typeof temporalEvaluationMetric.$inferSelect;
export type NewTemporalEvaluationMetric =
  typeof temporalEvaluationMetric.$inferInsert;

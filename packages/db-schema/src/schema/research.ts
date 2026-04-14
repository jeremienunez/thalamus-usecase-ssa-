import { sql } from "drizzle-orm";
import {
  pgTable,
  bigserial,
  bigint,
  text,
  timestamp,
  jsonb,
  real,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ResearchStatus } from "@interview/shared";
import {
  cortexEnum,
  findingTypeEnum,
  findingStatusEnum,
  urgencyEnum,
  entityTypeEnum,
  relationEnum,
  cycleTriggerEnum,
  cycleStatusEnum,
} from "../enums";
import { vector, EMBEDDING_DIMENSIONS } from "./_vector";

// Note on id modes:
//   Drizzle 0.30 `bigserial` supports only `{ mode: "number" | "bigint" }`.
//   We use "bigint" across the KG tables. The extracted research-cycle.repository
//   declares `id: string` in signatures — that is a pre-existing code mismatch
//   (obs 4369 drift) to be addressed at the repo boundary, not here.

/**
 * Thalamus knowledge graph — cycles, findings, edges.
 *
 * Design: generic machinery (Research*) produces, links, and invalidates findings.
 * The SSA vocabulary lives downstream in `satellite.ts` and the enum values. Edges
 * are polymorphic ({entityType, entityId}) — no FK; orphan cleanup runs in SQL via
 * [research-edge.repository.ts#cleanOrphans](../../../thalamus/src/repositories/research-edge.repository.ts).
 *
 * Types: $inferSelect / $inferInsert derive Drizzle types carrying the pgEnum
 * literal unions narrowed to the shared TS enums via `.$type<...>()`.
 */

// -----------------------------------------------------------------------
// Research cycle — one per research run
// -----------------------------------------------------------------------

export const researchCycle = pgTable(
  "research_cycle",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    triggerType: cycleTriggerEnum("trigger_type").notNull(),
    triggerSource: text("trigger_source"),
    userId: bigint("user_id", { mode: "bigint" }),
    dagPlan: jsonb("dag_plan"),
    // Plain text[] — the planner emits `plan.nodes.map(n => n.cortex)` as string[];
    // DB-level enum on array columns is awkward in Postgres, so we keep this
    // un-narrowed and rely on the cortex registry for value validation upstream.
    corticesUsed: text("cortices_used").array(),
    status: cycleStatusEnum("status").notNull(),
    findingsCount: integer("findings_count").notNull().default(0),
    totalCost: real("total_cost"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    startedIdx: index("idx_research_cycle_started").on(t.startedAt),
    statusIdx: index("idx_research_cycle_status").on(t.status),
  }),
);

// -----------------------------------------------------------------------
// Research finding — the atomic output of a cortex
// -----------------------------------------------------------------------

export const researchFinding = pgTable(
  "research_finding",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    researchCycleId: bigint("research_cycle_id", { mode: "bigint" })
      .notNull()
      .references(() => researchCycle.id, { onDelete: "cascade" }),
    cortex: cortexEnum("cortex").notNull(),
    findingType: findingTypeEnum("finding_type").notNull(),
    status: findingStatusEnum("status")
      .notNull()
      .default(ResearchStatus.Active),
    urgency: urgencyEnum("urgency"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    evidence: jsonb("evidence").notNull().default([]),
    reasoning: text("reasoning"),
    confidence: real("confidence").notNull(),
    impactScore: real("impact_score"),
    busContext: jsonb("bus_context"),
    reflexionNotes: jsonb("reflexion_notes"),
    iteration: integer("iteration").notNull().default(0),
    dedupHash: text("dedup_hash"),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    cycleIdx: index("idx_research_finding_cycle").on(t.researchCycleId),
    statusCreatedIdx: index("idx_research_finding_status_created").on(
      t.status,
      t.createdAt,
    ),
    cortexTypeIdx: index("idx_research_finding_cortex_type").on(
      t.cortex,
      t.findingType,
    ),
    dedupIdx: uniqueIndex("uniq_research_finding_dedup")
      .on(t.dedupHash)
      .where(sql`dedup_hash IS NOT NULL`),
    expiresIdx: index("idx_research_finding_expires").on(t.expiresAt),
    // HNSW index on embedding is created in the migration via raw SQL
    // (CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)) — Drizzle
    // does not model HNSW natively. See migration 0000_init.sql.
  }),
);

// -----------------------------------------------------------------------
// Research edge — finding → entity link (polymorphic, no FK on target)
// -----------------------------------------------------------------------

export const researchEdge = pgTable(
  "research_edge",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    findingId: bigint("finding_id", { mode: "bigint" })
      .notNull()
      .references(() => researchFinding.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull(),
    entityId: bigint("entity_id", { mode: "bigint" }).notNull(),
    relation: relationEnum("relation").notNull(),
    weight: real("weight").default(1.0),
    context: jsonb("context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    findingIdx: index("idx_research_edge_finding").on(t.findingId),
    entityIdx: index("idx_research_edge_entity").on(t.entityType, t.entityId),
    relationIdx: index("idx_research_edge_relation").on(t.relation),
  }),
);

// -----------------------------------------------------------------------
// Types — single source of truth for consumers
// -----------------------------------------------------------------------

export type ResearchCycle = typeof researchCycle.$inferSelect;
export type NewResearchCycle = typeof researchCycle.$inferInsert;

export type ResearchFinding = typeof researchFinding.$inferSelect;
export type NewResearchFinding = typeof researchFinding.$inferInsert;

export type ResearchEdge = typeof researchEdge.$inferSelect;
export type NewResearchEdge = typeof researchEdge.$inferInsert;

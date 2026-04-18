import { sql } from "drizzle-orm";
import {
  pgTable,
  bigserial,
  bigint,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { operator } from "./satellite";
import { researchFinding } from "./research";
import { vector, EMBEDDING_DIMENSIONS } from "./_vector";

/**
 * Multi-agent simulation swarm — SPEC-SW-006.
 *
 * Model: a `sim_swarm` fans out K `sim_run` fish, each of which is a short
 * multi-agent simulation with a perturbed seed. Each fish owns its own
 * `sim_agent` rows, `sim_turn` timeline, and `sim_agent_memory` vector store.
 * Memory is strictly scoped by (sim_run_id, agent_id) — fish never bleed.
 *
 * Driver choice is per-fish (sim_run.kind): DAG for parallel multi-agent
 * turns (UC1), Sequential for alternating negotiation (UC3). Both drivers
 * write to sim_turn in a byte-compatible shape so the reporter reads uniformly.
 */

// -----------------------------------------------------------------------
// Supporting types — payload shapes stored in jsonb columns.
// Kept here (not in shared) because they are orchestration-internal.
// -----------------------------------------------------------------------

export type SimKind = string;
export type SimSwarmStatus = "pending" | "running" | "done" | "failed";
export type SimRunStatus = "pending" | "running" | "paused" | "done" | "failed";
export type ActorKind = "agent" | "god" | "system";
export type MemoryKind = "self_action" | "observation" | "belief";

export type SeedRefs = Record<string, unknown>;

export interface SwarmConfig {
  llmMode: "cloud" | "fixtures" | "record";
  quorumPct: number;
  perFishTimeoutMs: number;
  fishConcurrency: number;
  nanoModel: string;
  seed: number;
}

export interface SimConfig {
  turnsPerDay: number;
  maxTurns: number;
  llmMode: "cloud" | "fixtures" | "record";
  seed: number;
  nanoModel: string;
}

export type PerturbationSpec = { kind: string; [key: string]: unknown };

export type TurnAction = { kind: string; [key: string]: unknown };

// -----------------------------------------------------------------------
// Swarm — fan-out container
// -----------------------------------------------------------------------

export const simSwarm = pgTable(
  "sim_swarm",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    kind: text("kind").$type<SimKind>().notNull(),
    title: text("title").notNull(),
    baseSeed: jsonb("base_seed").$type<SeedRefs>().notNull(),
    perturbations: jsonb("perturbations").$type<PerturbationSpec[]>().notNull(),
    size: integer("size").notNull(),
    config: jsonb("config").$type<SwarmConfig>().notNull(),
    status: text("status").$type<SimSwarmStatus>().notNull().default("pending"),
    outcomeReportFindingId: bigint("outcome_report_finding_id", {
      mode: "bigint",
    }).references(() => researchFinding.id, { onDelete: "set null" }),
    suggestionId: bigint("suggestion_id", { mode: "bigint" }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: bigint("created_by", { mode: "bigint" }),
  },
  (t) => ({
    statusIdx: index("idx_sim_swarm_status").on(t.status),
    startedIdx: index("idx_sim_swarm_started").on(t.startedAt),
    kindStatusIdx: index("idx_sim_swarm_kind_status").on(t.kind, t.status),
  }),
);

// -----------------------------------------------------------------------
// Fish — one simulation run inside a swarm
// -----------------------------------------------------------------------

export const simRun = pgTable(
  "sim_run",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    swarmId: bigint("swarm_id", { mode: "bigint" })
      .notNull()
      .references(() => simSwarm.id, { onDelete: "cascade" }),
    fishIndex: integer("fish_index").notNull(),
    kind: text("kind").$type<SimKind>().notNull(),
    seedApplied: jsonb("seed_applied").$type<SeedRefs>().notNull(),
    perturbation: jsonb("perturbation").$type<PerturbationSpec>().notNull(),
    config: jsonb("config").$type<SimConfig>().notNull(),
    status: text("status").$type<SimRunStatus>().notNull().default("pending"),
    reportFindingId: bigint("report_finding_id", {
      mode: "bigint",
    }).references(() => researchFinding.id, { onDelete: "set null" }),
    llmCostUsd: real("llm_cost_usd"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    swarmIdx: index("idx_sim_run_swarm").on(t.swarmId),
    statusIdx: index("idx_sim_run_status").on(t.status),
    uniqFish: uniqueIndex("uniq_sim_run_swarm_fish").on(t.swarmId, t.fishIndex),
  }),
);

// -----------------------------------------------------------------------
// Agent — persona bound to an operator, scoped to one fish
// -----------------------------------------------------------------------

export const simAgent = pgTable(
  "sim_agent",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    simRunId: bigint("sim_run_id", { mode: "bigint" })
      .notNull()
      .references(() => simRun.id, { onDelete: "cascade" }),
    operatorId: bigint("operator_id", { mode: "bigint" }).references(
      () => operator.id,
    ),
    agentIndex: integer("agent_index").notNull(),
    persona: text("persona").notNull(),
    goals: jsonb("goals").$type<string[]>().notNull().default([]),
    constraints: jsonb("constraints")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdx: index("idx_sim_agent_run").on(t.simRunId),
    uniqAgent: uniqueIndex("uniq_sim_agent_run_index").on(
      t.simRunId,
      t.agentIndex,
    ),
  }),
);

// -----------------------------------------------------------------------
// Turn — canonical timeline entry (both drivers write here)
// -----------------------------------------------------------------------

export const simTurn = pgTable(
  "sim_turn",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    simRunId: bigint("sim_run_id", { mode: "bigint" })
      .notNull()
      .references(() => simRun.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    // agentId is null for actor_kind='god' | 'system'.
    agentId: bigint("agent_id", { mode: "bigint" }).references(
      () => simAgent.id,
      { onDelete: "cascade" },
    ),
    action: jsonb("action").$type<TurnAction>().notNull(),
    rationale: text("rationale").notNull(),
    observableSummary: text("observable_summary").notNull(),
    llmCostUsd: real("llm_cost_usd"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runTurnIdx: index("idx_sim_turn_run_turn").on(t.simRunId, t.turnIndex),
    actorIdx: index("idx_sim_turn_actor").on(t.actorKind),
    // Unique on (run, turn, agent) — god turns all share agent_id=null so they
    // would collide; the partial constraint restricts uniqueness to agent turns.
    // (God turns are appended sequentially; a soft dedupe in the orchestrator
    // guards against duplicates without needing a composite unique.)
    uniqAgentTurn: uniqueIndex("uniq_sim_turn_run_turn_agent")
      .on(t.simRunId, t.turnIndex, t.agentId)
      .where(sql`agent_id IS NOT NULL`),
  }),
);

// -----------------------------------------------------------------------
// Agent memory — append-only vector store, scoped per (run, agent)
// -----------------------------------------------------------------------

export const simAgentMemory = pgTable(
  "sim_agent_memory",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    simRunId: bigint("sim_run_id", { mode: "bigint" })
      .notNull()
      .references(() => simRun.id, { onDelete: "cascade" }),
    agentId: bigint("agent_id", { mode: "bigint" })
      .notNull()
      .references(() => simAgent.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    kind: text("kind").$type<MemoryKind>().notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    scopeIdx: index("idx_sim_memory_run_agent").on(t.simRunId, t.agentId),
    kindIdx: index("idx_sim_memory_kind").on(t.kind),
    // HNSW index on embedding is created in a follow-on migration — see
    // migrations/000X_sim_memory_hnsw.sql.
  }),
);

// -----------------------------------------------------------------------
// Inferred types
// -----------------------------------------------------------------------

export type SimSwarm = typeof simSwarm.$inferSelect;
export type NewSimSwarm = typeof simSwarm.$inferInsert;

export type SimRun = typeof simRun.$inferSelect;
export type NewSimRun = typeof simRun.$inferInsert;

export type SimAgent = typeof simAgent.$inferSelect;
export type NewSimAgent = typeof simAgent.$inferInsert;

export type SimTurn = typeof simTurn.$inferSelect;
export type NewSimTurn = typeof simTurn.$inferInsert;

export type SimAgentMemory = typeof simAgentMemory.$inferSelect;
export type NewSimAgentMemory = typeof simAgentMemory.$inferInsert;

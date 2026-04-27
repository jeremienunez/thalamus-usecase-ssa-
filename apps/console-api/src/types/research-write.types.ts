/**
 * Business DTOs for the research-write port surface.
 *
 * These shapes are deliberately structural: service ports do not expose
 * Drizzle `$inferInsert` contracts. The concrete writer maps them to the DB
 * schema at the persistence boundary.
 */
import {
  ResearchCortex,
  ResearchCycleStatus,
  ResearchCycleTrigger,
  ResearchEntityType,
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared/enum";

export type CreateResearchCycleInput = {
  triggerType: ResearchCycleTrigger;
  triggerSource?: string | null;
  userId?: bigint | null;
  dagPlan?: unknown;
  corticesUsed?: ResearchCortex[] | string[] | null;
  status: ResearchCycleStatus;
  findingsCount?: number;
  totalCost?: number | null;
  error?: string | null;
  startedAt?: Date;
  completedAt?: Date | null;
};

export type StoreResearchFindingInput = {
  researchCycleId: bigint;
  cortex: ResearchCortex;
  findingType: ResearchFindingType;
  status?: ResearchStatus;
  urgency?: ResearchUrgency | null;
  title: string;
  summary: string;
  evidence?: unknown;
  reasoning?: string | null;
  confidence: number;
  impactScore?: number | null;
  extensions?: Record<string, unknown> | null;
  reflexionNotes?: unknown;
  iteration?: number;
  dedupHash?: string | null;
  embedding?: number[] | null;
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type LinkCycleFindingInput = {
  researchCycleId: bigint;
  researchFindingId: bigint;
  iteration?: number;
  isDedupHit?: boolean;
};

export type CreateResearchEdgeInput = {
  findingId: bigint;
  entityType: ResearchEntityType;
  entityId: bigint;
  relation: ResearchRelation;
  weight?: number | null;
  context?: unknown;
  createdAt?: Date;
};

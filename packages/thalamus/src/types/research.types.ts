/**
 * Thalamus research DTOs — public type layer.
 *
 * Plain TS shapes used by services, ports, and callers. NO Drizzle, NO
 * ORM imports — the repository layer is responsible for producing these
 * from the underlying entity rows (via transformers).
 */

import type {
  ResearchCycleTrigger,
  ResearchCycleStatus,
  ResearchCortex,
  ResearchFindingType,
  ResearchStatus,
  ResearchUrgency,
  ResearchEntityType,
  ResearchRelation,
} from "@interview/shared/enum";

// ── Cycle ──────────────────────────────────────────────────────────
export interface ResearchCycle {
  id: bigint;
  triggerType: ResearchCycleTrigger;
  triggerSource: string | null;
  userId: bigint | null;
  dagPlan: unknown;
  corticesUsed: string[] | null;
  status: ResearchCycleStatus;
  findingsCount: number;
  totalCost: number | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface NewResearchCycle {
  triggerType: ResearchCycleTrigger;
  triggerSource?: string | null;
  userId?: bigint | null;
  dagPlan?: unknown;
  corticesUsed?: string[] | null;
  status: ResearchCycleStatus;
  findingsCount?: number;
  totalCost?: number | null;
  error?: string | null;
  startedAt?: Date;
  completedAt?: Date | null;
}

// ── Finding ────────────────────────────────────────────────────────
export interface ResearchFinding {
  id: bigint;
  researchCycleId: bigint;
  cortex: ResearchCortex;
  findingType: ResearchFindingType;
  status: ResearchStatus;
  urgency: ResearchUrgency | null;
  title: string;
  summary: string;
  evidence: unknown;
  reasoning: string | null;
  confidence: number;
  impactScore: number | null;
  busContext: unknown;
  reflexionNotes: unknown;
  iteration: number;
  dedupHash: string | null;
  embedding: number[] | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewResearchFinding {
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
  busContext?: unknown;
  reflexionNotes?: unknown;
  iteration?: number;
  dedupHash?: string | null;
  embedding?: number[] | null;
  expiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

// ── Edge ───────────────────────────────────────────────────────────
export interface ResearchEdge {
  id: bigint;
  findingId: bigint;
  entityType: ResearchEntityType;
  entityId: bigint;
  relation: ResearchRelation;
  weight: number | null;
  context: unknown;
  createdAt: Date;
}

export interface NewResearchEdge {
  findingId: bigint;
  entityType: ResearchEntityType;
  entityId: bigint;
  relation: ResearchRelation;
  weight?: number | null;
  context?: unknown;
  createdAt?: Date;
}

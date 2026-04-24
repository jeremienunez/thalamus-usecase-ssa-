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
  ResearchFindingType,
  ResearchStatus,
  ResearchUrgency,
  ResearchRelation,
} from "@interview/shared/enum";

// ── Cycle ──────────────────────────────────────────────────────────
export interface ResearchVerificationTargetHint {
  entityType: string | null;
  entityId: bigint | null;
  sourceCortex: string | null;
  sourceTitle: string | null;
  confidence: number | null;
}

export interface ResearchCycleVerification {
  needsVerification: boolean;
  reasonCodes: string[];
  targetHints: ResearchVerificationTargetHint[];
  confidence: number;
}

export interface ResearchPersistenceResult {
  storedCount: number;
  failedCount: number;
  failures: Array<{ title: string; message: string }>;
}

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

export interface ResearchCycleRunResult extends ResearchCycle {
  verification: ResearchCycleVerification;
  persistence?: ResearchPersistenceResult;
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
  cortex: string;
  findingType: ResearchFindingType;
  status: ResearchStatus;
  urgency: ResearchUrgency | null;
  title: string;
  summary: string;
  evidence: unknown;
  reasoning: string | null;
  confidence: number;
  impactScore: number | null;
  /**
   * Generic extension point. DB column is still `bus_context` (historical
   * SSA name) — the Drizzle schema maps it to this field on read/write.
   */
  extensions: Record<string, unknown> | null;
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
  cortex: string;
  findingType: ResearchFindingType;
  status?: ResearchStatus;
  urgency?: ResearchUrgency | null;
  title: string;
  summary: string;
  evidence?: unknown;
  reasoning?: string | null;
  confidence: number;
  impactScore?: number | null;
  /** See `ResearchFinding.extensions`. DB column is `bus_context`. */
  extensions?: Record<string, unknown> | null;
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
  entityType: string;
  entityId: bigint;
  relation: ResearchRelation;
  weight: number | null;
  context: unknown;
  createdAt: Date;
}

export interface NewResearchEdge {
  findingId: bigint;
  entityType: string;
  entityId: bigint;
  relation: ResearchRelation;
  weight?: number | null;
  context?: unknown;
  createdAt?: Date;
}

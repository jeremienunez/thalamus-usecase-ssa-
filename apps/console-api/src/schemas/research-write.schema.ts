import { z } from "zod";
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
import { numericIdString } from "../utils/request-schema";

const BigIntIdSchema = numericIdString().transform((value) => BigInt(value));
const DateTimeSchema = z.string().datetime().transform((value) => new Date(value));

export const ResearchCycleIdParamsSchema = z.object({
  id: BigIntIdSchema,
});
export interface ResearchCycleIdParams {
  id: bigint;
}

export interface ResearchCycleWriteBody {
  triggerType: ResearchCycleTrigger;
  triggerSource?: string | null;
  userId?: bigint | null;
  dagPlan?: unknown;
  corticesUsed?: Array<ResearchCortex | string> | null;
  status: ResearchCycleStatus;
  findingsCount?: number;
  totalCost?: number | null;
  error?: string | null;
  startedAt?: Date;
  completedAt?: Date | null;
}

export const ResearchCycleWriteBodySchema = z
  .object({
    triggerType: z.nativeEnum(ResearchCycleTrigger),
    triggerSource: z.string().nullable().optional(),
    userId: BigIntIdSchema.nullable().optional(),
    dagPlan: z.unknown().optional(),
    corticesUsed: z
      .array(z.union([z.nativeEnum(ResearchCortex), z.string().min(1)]))
      .nullable()
      .optional(),
    status: z.nativeEnum(ResearchCycleStatus),
    findingsCount: z.number().int().nonnegative().optional(),
    totalCost: z.number().nonnegative().nullable().optional(),
    error: z.string().nullable().optional(),
    startedAt: DateTimeSchema.optional(),
    completedAt: DateTimeSchema.nullable().optional(),
  })
  .strict();

export interface ResearchFindingWriteBody {
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
}

export const ResearchFindingWriteBodySchema = z
  .object({
    researchCycleId: BigIntIdSchema,
    cortex: z.nativeEnum(ResearchCortex),
    findingType: z.nativeEnum(ResearchFindingType),
    status: z.nativeEnum(ResearchStatus).optional(),
    urgency: z.nativeEnum(ResearchUrgency).nullable().optional(),
    title: z.string().min(1).max(500),
    summary: z.string().min(1).max(4000),
    evidence: z.unknown().optional(),
    reasoning: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1),
    impactScore: z.number().nullable().optional(),
    extensions: z.record(z.string(), z.unknown()).nullable().optional(),
    reflexionNotes: z.unknown().optional(),
    iteration: z.number().int().nonnegative().optional(),
    dedupHash: z.string().min(1).nullable().optional(),
    embedding: z.array(z.number()).nullable().optional(),
    expiresAt: DateTimeSchema.nullable().optional(),
    createdAt: DateTimeSchema.optional(),
    updatedAt: DateTimeSchema.optional(),
  })
  .strict();

export interface ResearchEmissionEdgeBody {
  entityType: ResearchEntityType;
  entityId: bigint;
  relation: ResearchRelation;
  weight?: number | null;
  context?: unknown;
  createdAt?: Date;
}

export const ResearchEmissionEdgeBodySchema = z
  .object({
    entityType: z.nativeEnum(ResearchEntityType),
    entityId: BigIntIdSchema,
    relation: z.nativeEnum(ResearchRelation),
    weight: z.number().nullable().optional(),
    context: z.unknown().optional(),
    createdAt: DateTimeSchema.optional(),
  })
  .strict();

export interface ResearchFindingEmissionBody {
  finding: ResearchFindingWriteBody;
  link: {
    cycleId: bigint;
    iteration?: number;
  };
  edges: ResearchEmissionEdgeBody[];
}

export const ResearchFindingEmissionBodySchema = z
  .object({
    finding: ResearchFindingWriteBodySchema,
    link: z
      .object({
        cycleId: BigIntIdSchema,
        iteration: z.number().int().nonnegative().optional(),
      })
      .strict(),
    edges: z.array(ResearchEmissionEdgeBodySchema).default([]),
  })
  .strict();

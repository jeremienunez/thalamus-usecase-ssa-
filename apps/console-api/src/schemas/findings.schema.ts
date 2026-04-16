import { z } from "zod";
import { FindingStatusSchema } from "@interview/shared";

export const FindingsListQuerySchema = z.object({
  status: FindingStatusSchema.optional(),
  cortex: z.string().min(1).max(64).optional(),
});
export type FindingsListQuery = z.infer<typeof FindingsListQuerySchema>;

export const FindingIdParamsSchema = z.object({
  id: z.string().regex(/^(f:)?\d+$/, "id must be a positive integer, optionally prefixed with 'f:'"),
});
export type FindingIdParams = z.infer<typeof FindingIdParamsSchema>;

export const FindingDecisionBodySchema = z.object({
  decision: FindingStatusSchema,
});
export type FindingDecisionBody = z.infer<typeof FindingDecisionBodySchema>;

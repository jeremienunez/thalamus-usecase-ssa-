import { z } from "zod";

export const ReplChatBodySchema = z.object({
  input: z.string().trim().min(1).max(4000),
});
export type ReplChatBody = z.infer<typeof ReplChatBodySchema>;

export const ReplTurnBodySchema = z.object({
  input: z.string().trim().min(1).max(4000),
  sessionId: z.string().min(1).max(128).default("anon"),
});
export type ReplTurnBody = z.infer<typeof ReplTurnBodySchema>;

const ReplFollowUpTargetSchema = z.object({
  entityType: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),
  refs: z.record(z.string()).nullable().optional(),
});

const ReplFollowUpPlanItemSchema = z.object({
  followupId: z.string().min(1).max(128),
  kind: z.string().min(1).max(128),
  auto: z.boolean(),
  title: z.string().min(1).max(400),
  rationale: z.string().min(1).max(2000),
  score: z.number(),
  gateScore: z.number(),
  costClass: z.enum(["low", "medium"]),
  reasonCodes: z.array(z.string().min(1).max(128)),
  target: ReplFollowUpTargetSchema.nullable().optional(),
});

export const ReplFollowUpRunBodySchema = z.object({
  query: z.string().trim().min(1).max(4000),
  parentCycleId: z.string().trim().min(1).max(128),
  item: ReplFollowUpPlanItemSchema,
});
export type ReplFollowUpRunBody = z.infer<typeof ReplFollowUpRunBodySchema>;

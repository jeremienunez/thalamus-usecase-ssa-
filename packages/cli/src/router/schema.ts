import { z } from "zod";

export const StepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("query"),     q: z.string().min(1) }),
  z.object({ action: z.literal("telemetry"), satId: z.string().min(1) }),
  z.object({
    action: z.literal("logs"),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    service: z.string().optional(),
    sinceMs: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("graph"),   entity: z.string().min(1) }),
  z.object({ action: z.literal("accept"),  suggestionId: z.string().min(1) }),
  z.object({ action: z.literal("explain"), findingId: z.string().min(1) }),
  z.object({ action: z.literal("pc"), conjunctionId: z.string().min(1) }),
  z.object({
    action: z.literal("candidates"),
    targetNoradId: z.number().int().positive(),
    objectClass: z.enum(["payload", "rocket_stage", "debris", "unknown"]).optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  z.object({
    action: z.literal("clarify"),
    question: z.string().min(1),
    options: z.array(z.enum(["query", "telemetry", "logs", "graph", "accept", "explain", "pc", "candidates"])).min(2),
  }),
]);

export type Step = z.infer<typeof StepSchema>;

export const RouterPlanSchema = z.object({
  steps: z.array(StepSchema).min(1).max(8),
  confidence: z.number().min(0).max(1),
});

export type RouterPlan = z.infer<typeof RouterPlanSchema>;

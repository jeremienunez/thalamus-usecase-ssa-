import { z } from "zod";

export const FindingStatusSchema = z.enum(["pending", "accepted", "rejected", "in-review"]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingEvidenceSchema = z.object({
  kind: z.enum(["osint", "field", "derived"]),
  uri: z.string(),
  snippet: z.string(),
});
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

export const FindingViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  cortex: z.string(),
  status: FindingStatusSchema,
  priority: z.number(),
  createdAt: z.string(),
  linkedEntityIds: z.array(z.string()),
  evidence: z.array(FindingEvidenceSchema),
});
export type FindingView = z.infer<typeof FindingViewSchema>;

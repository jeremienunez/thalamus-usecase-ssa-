import { z } from "zod";

export const CycleKindSchema = z.enum(["thalamus", "fish", "both"]);
export type CycleKind = z.infer<typeof CycleKindSchema>;

export const CycleRunBodySchema = z.object({
  kind: CycleKindSchema,
  query: z.string().trim().min(1).max(1000).optional(),
});
export type CycleRunBody = z.infer<typeof CycleRunBodySchema>;

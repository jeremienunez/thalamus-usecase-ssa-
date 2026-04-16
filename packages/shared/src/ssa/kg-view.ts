import { z } from "zod";

export const KgEntityClassSchema = z.enum([
  "Satellite",
  "Operator",
  "OrbitRegime",
  "Payload",
]);
export type KgEntityClass = z.infer<typeof KgEntityClassSchema>;

export const KgNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  class: KgEntityClassSchema,
  degree: z.number(),
  x: z.number(),
  y: z.number(),
  cortex: z.string(),
});
export type KgNode = z.infer<typeof KgNodeSchema>;

export const KgEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relation: z.string(),
});
export type KgEdge = z.infer<typeof KgEdgeSchema>;

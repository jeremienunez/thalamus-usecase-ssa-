import { z } from "zod";

export const ssaCategoryEnum = z.enum([
  "mass_anomaly",
  "missing_data",
  "doctrine_mismatch",
  "relationship_error",
  "enrichment",
  "briefing_angle",
]);
export type SsaCategory = z.infer<typeof ssaCategoryEnum>;

export const ssaSeverityEnum = z.enum(["critical", "warning", "info"]);
export type SsaSeverity = z.infer<typeof ssaSeverityEnum>;

export const updateFieldActionSchema = z.object({
  kind: z.literal("update_field"),
  satelliteIds: z.array(z.string()).optional(),
  field: z.string().regex(/^[a-z_][a-z0-9_]*$/),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.number()),
    z.record(z.string(), z.unknown()),
    z.null(),
  ]),
});

export const linkPayloadActionSchema = z.object({
  kind: z.literal("link_payload"),
  satelliteIds: z.array(z.string()).optional(),
  payloadName: z.string(),
  role: z.enum(["primary", "secondary", "auxiliary"]).optional(),
});

export const unlinkPayloadActionSchema = z.object({
  kind: z.literal("unlink_payload"),
  satelliteIds: z.array(z.string()).optional(),
  payloadName: z.string(),
});

export const reassignOperatorCountryActionSchema = z.object({
  kind: z.literal("reassign_operator_country"),
  satelliteIds: z.array(z.string()).optional(),
  fromName: z.string(),
  toName: z.string(),
});

export const enrichActionSchema = z.object({
  kind: z.literal("enrich"),
  satelliteIds: z.array(z.string()).optional(),
});

export const ssaResolutionActionSchema = z.discriminatedUnion("kind", [
  updateFieldActionSchema,
  linkPayloadActionSchema,
  unlinkPayloadActionSchema,
  reassignOperatorCountryActionSchema,
  enrichActionSchema,
]);

export type UpdateFieldAction = z.infer<typeof updateFieldActionSchema>;
export type LinkPayloadAction = z.infer<typeof linkPayloadActionSchema>;
export type UnlinkPayloadAction = z.infer<typeof unlinkPayloadActionSchema>;
export type ReassignOperatorCountryAction = z.infer<
  typeof reassignOperatorCountryActionSchema
>;
export type EnrichAction = z.infer<typeof enrichActionSchema>;
export type SsaResolutionAction = z.infer<typeof ssaResolutionActionSchema>;

export const ssaResolutionPayloadSchema = z.object({
  type: ssaCategoryEnum.optional().default("missing_data"),
  actions: z.array(ssaResolutionActionSchema).min(1),
});
export type SsaResolutionPayload = z.infer<typeof ssaResolutionPayloadSchema>;

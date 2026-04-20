import { z } from "zod";

/**
 * Route param validation for /api/satellites/:id/payloads.
 * The `id` path param is a satellite bigint serialised as a string — we
 * parse it as a positive integer and hand it to the service as bigint.
 */
export const PayloadsParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, "satellite id must be a positive integer"),
});
export type PayloadsParams = z.infer<typeof PayloadsParamsSchema>;

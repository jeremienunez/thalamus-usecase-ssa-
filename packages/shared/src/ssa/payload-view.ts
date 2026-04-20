import { z } from "zod";

/**
 * PayloadView — one entry in the list of payloads aboard a given satellite.
 *
 * Edge-shape for GET /api/satellites/:id/payloads. Derived from the M2M
 * `satellite_payload` join + the `payload` catalog row: payload identity
 * comes from `payload`, per-link role / mass budget / power budget come
 * from the join table.
 */
export const PayloadViewSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  role: z.string().nullable(),
  massKg: z.number().nullable(),
  powerW: z.number().nullable(),
  photoUrl: z.string().nullable(),
});
export type PayloadView = z.infer<typeof PayloadViewSchema>;

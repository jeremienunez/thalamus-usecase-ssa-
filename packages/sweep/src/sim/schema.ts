/**
 * Generic sim kernel schemas.
 *
 * Domain-specific schemas live in the owning app pack.
 *
 * The kernel keeps only:
 *   - buildTurnResponseSchema(action) — wraps a pack-supplied action schema
 *     in the common envelope {action, rationale, observableSummary}
 *   - swarmConfigSchema — runtime config common to every sim kind
 */

import { z } from "zod";

/**
 * Wrap a pack-supplied action schema in the turn-response envelope.
 * Called per turn via `deps.schemaProvider.actionSchema()` in the turn runners.
 */
export function buildTurnResponseSchema<T extends z.ZodTypeAny>(action: T) {
  return z.object({
    action,
    rationale: z.string().min(10),
    observableSummary: z.string().min(5),
  });
}

export const swarmConfigSchema = z.object({
  llmMode: z.enum(["cloud", "fixtures", "record"]),
  quorumPct: z.number().min(0).max(1).default(0.8),
  perFishTimeoutMs: z.number().int().positive().default(60_000),
  fishConcurrency: z.number().int().min(1).max(50).default(8),
  nanoModel: z.string().default("gpt-5.4-nano"),
  seed: z.number().int().default(42),
});

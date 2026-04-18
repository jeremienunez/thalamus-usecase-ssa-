/**
 * SimActionSchemaProvider — kernel ↔ pack contract for the sim action Zod schema.
 *
 * The kernel's turn-runner consumes this port to build the per-turn response
 * envelope: `{ action, rationale, observableSummary }`. The pack owns the
 * shape of `action` (e.g. SSA: maneuver | wait | evaluate_telemetry | ...).
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.5 (impl moves SSA schemas to
 * apps/console-api/src/agent/ssa/sim/action-schema.ts).
 */

import type { z } from "zod";

export interface SimActionSchemaProvider {
  /** Returns the pack-owned action schema. Validated per turn. */
  actionSchema(): z.ZodTypeAny;
}

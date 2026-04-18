/**
 * SsaKindGuard — accepts only SSA-supported sim kinds + provides defaults.
 *
 * TODO(Plan 2 · B.9): implement —
 *   validateLaunch: throw on unknown kind; accept
 *     "uc1_debris_breakup" | "uc3_conjunction" |
 *     "uc_telemetry_inference" | "uc_pc_estimator".
 *   defaultMaxTurns: SSA current defaults (UC3 = 3, telemetry = 1, pc = 1, uc1 = 4).
 *
 * Source: packages/sweep/src/sim/swarm.service.ts guards +
 *   DEFAULT_TURNS_PER_DAY.
 */

import type { SimKindGuard } from "@interview/sweep";

export class SsaKindGuard implements SimKindGuard {
  validateLaunch(_kind: string): void {
    // TODO(B.9): throw if not in the SSA allow-list.
    throw new Error("SsaKindGuard.validateLaunch: TODO Plan 2 · B.9");
  }

  defaultMaxTurns(_kind: string): number {
    // TODO(B.9): dispatch on kind.
    throw new Error("SsaKindGuard.defaultMaxTurns: TODO Plan 2 · B.9");
  }
}

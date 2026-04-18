/**
 * SsaSimPromotionAdapter — sim modal → SSA suggestion.
 *
 * Delegates to Plan 1's SsaPromotionAdapter (apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts).
 * Sim-sourced suggestions flow through the SAME promotion path as
 * sweep-sourced ones — zero duplicate KG-write logic.
 *
 * TODO(Plan 2 · B.9): implement promote() by mapping SimPromoteInput
 *   (swarmId, action, distribution, label, evidence) into
 *   AcceptedSuggestionInput and calling sweepPromotion.promote().
 *
 * Source body: packages/sweep/src/sim/promote.ts (emitSuggestionFromModal +
 * emitTelemetrySuggestions + isKgPromotable + isTerminal + loadSimTurn).
 * Split: the kernel keeps the "am I terminal?" helpers; this adapter owns
 * the KG-write + Redis-write + audit-trail path.
 */

import type {
  SimPromotionAdapter,
  SimPromoteInput,
  SimPromoteResult,
} from "@interview/sweep";
import type { SsaPromotionAdapter } from "../sweep/promotion.ssa";

export interface SsaSimPromotionDeps {
  sweepPromotion: SsaPromotionAdapter;
}

export class SsaSimPromotionAdapter implements SimPromotionAdapter {
  constructor(private readonly _deps: SsaSimPromotionDeps) {}

  async promote(_input: SimPromoteInput): Promise<SimPromoteResult> {
    // TODO(B.9): map sim modal → AcceptedSuggestionInput; delegate to
    //   this._deps.sweepPromotion.promote(mapped); return { suggestionId, findingId }.
    throw new Error("SsaSimPromotionAdapter.promote: TODO Plan 2 · B.9");
  }
}

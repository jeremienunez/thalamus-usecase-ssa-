/**
 * SsaPromotionAdapter — SSA implementation of SweepPromotionAdapter.
 *
 * Two side-effects after a resolution handler returns ok:
 *   1. Durable `sweep_audit` row via SweepAuditRepository.insertResolutionAudit.
 *      Mirrors the legacy writeAudit body in sweep-resolution.service.ts.
 *   2. Optional ConfidenceService bump for sim-sourced suggestions
 *      (SIM_UNCORROBORATED → OSINT_CORROBORATED). In Plan 1 we pass
 *      `confidence: null` to avoid a container-construction cycle; the
 *      legacy sweepContainer.setOnSimUpdateAccepted hook keeps firing.
 *      Plan 2 consolidates confidence promotion here.
 */

import type { ConfidenceService } from "@interview/thalamus";
import type {
  SweepPromotionAdapter,
  AcceptedSuggestionInput,
  PromotionResult,
} from "@interview/sweep";
import type { ResolutionAuditInsertInput } from "../../../types/sweep.types";

export interface SsaSweepAuditPort {
  insertResolutionAudit(input: ResolutionAuditInsertInput): Promise<void>;
}

export interface SsaPromotionDeps {
  sweepAuditRepo: SsaSweepAuditPort;
  /**
   * Optional by design — pass null in Plan 1 wiring. When absent, confidence
   * promotion is a no-op (the sim hook in sweep's container still runs).
   */
  confidence?: ConfidenceService | null;
}

export class SsaPromotionAdapter implements SweepPromotionAdapter {
  constructor(private readonly deps: SsaPromotionDeps) {}

  async promote(input: AcceptedSuggestionInput): Promise<PromotionResult> {
    const df = input.domainFields;
    const now = new Date().toISOString();

    try {
      await this.deps.sweepAuditRepo.insertResolutionAudit({
        suggestionId: input.suggestionId,
        operatorCountryId:
          df.operatorCountryId == null ? null : String(df.operatorCountryId),
        operatorCountryName: String(df.operatorCountryName ?? ""),
        category: String(df.category ?? ""),
        severity: String(df.severity ?? ""),
        title: String(df.title ?? ""),
        description: String(df.description ?? ""),
        suggestedAction: String(df.suggestedAction ?? ""),
        affectedSatellites: Number(df.affectedSatellites ?? 0),
        webEvidence: df.webEvidence == null ? null : String(df.webEvidence),
        accepted: true,
        reviewerNote: input.reviewerNote,
        reviewedAt: now,
        resolutionStatus: "success",
        resolutionPayload: input.resolutionPayload
          ? JSON.parse(input.resolutionPayload)
          : null,
        resolutionErrors: null,
        resolvedAt: now,
      });
    } catch (err) {
      // Audit failure is non-fatal in the legacy path (writeAudit catches).
      // We mirror that: the handler already mutated state, losing the trail
      // shouldn't roll it back. Surface as a soft warning via errors[].
      return {
        ok: true,
        errors: [
          `sweep_audit write failed: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }

    // Confidence promotion is sim-scoped; Plan 1 delegates to the legacy
    // sweepContainer.setOnSimUpdateAccepted hook (still active). When
    // Plan 2 supplies a ConfidenceService here, sim-telemetry accepts bump
    // source_class from SIM_UNCORROBORATED → OSINT_CORROBORATED.
    if (this.deps.confidence) {
      // Plan 2 lands the full promote() call + telemetryEdgeId construction.
      // See packages/sweep/src/config/container.ts:151-175 for the legacy
      // implementation to mirror.
    }

    return { ok: true };
  }
}

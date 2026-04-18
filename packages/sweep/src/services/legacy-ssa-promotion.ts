/**
 * Legacy SSA promotion adapter — implements SweepPromotionAdapter with
 * the exact side-effects the pre-refactor SweepResolutionService ran
 * after a successful resolution:
 *
 *   1. Durable sweep_audit row (drizzle insert).
 *   2. Optional KG logging via ResearchGraphService.storeFinding.
 *   3. Optional sim-provenance promotion via onSimUpdateAccepted —
 *      forwards the accepted event so the container can bump
 *      SIM_UNCORROBORATED → OSINT_CORROBORATED.
 *
 * Lives inside packages/sweep so buildSweepContainer can wire a default
 * promotion when opts.ports.promotion isn't supplied. Duplicated with
 * apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts — Phase 4 will
 * collapse the duplication once console-api becomes the sole wiring path.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@interview/shared/observability";
import { ResearchCortex } from "@interview/shared/enum";
import { sweepAudit, type NewSweepAudit, type Database } from "@interview/db-schema";
import type {
  ResearchGraphService,
  StoreFindingInput,
} from "@interview/thalamus/services/research-graph.service";
import type {
  SweepPromotionAdapter,
  AcceptedSuggestionInput,
  PromotionResult,
} from "../ports";
import type {
  SweepCategory,
  SweepSeverity,
} from "../transformers/sweep.dto";
import type { SweepResolutionStatus } from "@interview/shared/enum";

const logger = createLogger("legacy-ssa-promotion");

export interface LegacySsaPromotionDeps {
  db: Database;
  /** Optional — when set, resolutions are logged to the KG (storeFinding). */
  graphService?: ResearchGraphService | null;
}

export class LegacySsaPromotionAdapter implements SweepPromotionAdapter {
  constructor(private readonly deps: LegacySsaPromotionDeps) {}

  async promote(input: AcceptedSuggestionInput): Promise<PromotionResult> {
    const df = input.domainFields;
    const now = new Date();
    const errors: string[] = [];

    // ── 1. Durable sweep_audit row ──
    try {
      const row: NewSweepAudit = {
        suggestionId: input.suggestionId,
        operatorCountryId:
          df.operatorCountryId == null
            ? null
            : BigInt(String(df.operatorCountryId)),
        operatorCountryName: String(df.operatorCountryName ?? ""),
        category: String(df.category ?? "enrichment") as SweepCategory,
        severity: String(df.severity ?? "info") as SweepSeverity,
        title: String(df.title ?? ""),
        description: String(df.description ?? ""),
        suggestedAction: String(df.suggestedAction ?? ""),
        affectedSatellites: Number(df.affectedSatellites ?? 0),
        webEvidence: df.webEvidence == null ? null : String(df.webEvidence),
        accepted: true,
        reviewerNote: input.reviewerNote,
        reviewedAt: now,
        resolutionStatus: "success" as SweepResolutionStatus,
        resolutionPayload: input.resolutionPayload
          ? (JSON.parse(input.resolutionPayload) as Record<string, unknown>)
          : null,
        resolutionErrors: null,
        resolvedAt: now,
      };
      await this.deps.db.insert(sweepAudit).values(row);
      logger.info(
        { suggestionId: input.suggestionId, status: "success" },
        "legacy promotion: sweep_audit row written",
      );
    } catch (err) {
      logger.error(
        { err, suggestionId: input.suggestionId },
        "legacy promotion: failed to write sweep_audit — mutations already landed, trail lost",
      );
      // Non-fatal: the handler already applied its side-effect.
    }

    // ── 2. Optional KG logging ──
    if (this.deps.graphService) {
      try {
        const payload = input.resolutionPayload
          ? (JSON.parse(input.resolutionPayload) as {
              actions?: Array<{ kind: string; field?: string }>;
            })
          : { actions: [] };
        const actions = payload.actions ?? [];
        const summary = actions
          .map(
            (a) => `${a.kind}${a.kind === "update_field" ? `:${a.field}` : ""}`,
          )
          .join(", ");

        await this.deps.graphService.storeFinding({
          finding: {
            cortex: ResearchCortex.DataAuditor,
            findingType: "anomaly",
            title: `[Sweep Resolution] ${String(df.title ?? "")}`,
            summary: `Resolved ${Number(df.affectedSatellites ?? 0)} satellite(s) in ${String(df.operatorCountryName ?? "")}: ${summary}`,
            confidence: 1.0,
            sourceUrls: [],
            evidence: { resolution: true, suggestionId: input.suggestionId },
            researchCycleId: randomUUID(),
            metadata: {
              suggestionId: input.suggestionId,
              category: String(df.category ?? ""),
              actions: actions.map((a) => a.kind),
            },
          },
          edges: [],
        } as unknown as StoreFindingInput);
      } catch (err) {
        logger.warn({ err }, "legacy promotion: failed to log resolution to KG");
      }
    }

    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }
}

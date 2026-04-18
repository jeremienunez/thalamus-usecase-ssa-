/**
 * SweepResolutionService — domain-agnostic façade.
 *
 * Delegates:
 *   - per-action execution → ResolutionHandlerRegistry port
 *   - post-resolution side-effects (audit row, KG logging,
 *     sim source-class promotion) → SweepPromotionAdapter port
 *
 * Both ports are required by BuildSweepOpts: the app pack supplies the
 * implementations; CLI/E2E supply disabled stubs when they don't run the
 * resolution path in-process.
 *
 * Public API preserved for CLI + console-api + AdminSweepController:
 *   - resolve(id)                            1-arg form
 *   - resolve(id, selections)                2-arg form (disambiguation)
 */

import { createLogger } from "@interview/shared/observability";
import type {
  ResolutionHandlerRegistry,
  SweepPromotionAdapter,
} from "../ports";
import type { SweepRepository } from "../repositories/sweep.repository";
import {
  resolutionPayloadSchema,
  type ResolutionPayload,
  type ResolutionResult,
  type PendingSelection,
} from "../transformers/sweep.dto";

const logger = createLogger("sweep-resolution");

export interface SweepResolutionDeps {
  registry: ResolutionHandlerRegistry;
  promotion: SweepPromotionAdapter;
  sweepRepo: SweepRepository;
}

export class SweepResolutionService {
  constructor(private readonly deps: SweepResolutionDeps) {}

  /**
   * Resolve a suggestion. 1-arg form for console-api + CLI; 2-arg form for
   * AdminSweepController disambiguation re-submissions.
   */
  async resolve(suggestionId: string): Promise<ResolutionResult>;
  async resolve(
    suggestionId: string,
    selections: Record<string, string | number> | undefined,
  ): Promise<ResolutionResult>;
  async resolve(
    suggestionId: string,
    selections?: Record<string, string | number>,
  ): Promise<ResolutionResult> {
    // 1. Load the generic row — requires the repo's schema to be wired.
    const generic = await this.deps.sweepRepo.getGeneric(suggestionId);
    if (!generic) {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["Suggestion not found"],
      };
    }
    if (generic.accepted !== true) {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["Suggestion not accepted"],
      };
    }
    if (!generic.resolutionPayload) {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["No resolution payload"],
      };
    }

    // 2. Parse + validate payload.
    let payload: ResolutionPayload;
    try {
      const raw = JSON.parse(generic.resolutionPayload);
      const parsed = resolutionPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          status: "failed",
          affectedRows: 0,
          errors: [`Invalid payload: ${parsed.error.message}`],
        };
      }
      payload = parsed.data;
    } catch {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["Malformed payload JSON"],
      };
    }

    // 3. Dispatch each action through the registry.
    let totalAffected = 0;
    const errors: string[] = [];
    const pendingSelections: PendingSelection[] = [];

    for (const action of payload.actions) {
      const handler = this.deps.registry.get(action.kind);
      if (!handler) {
        errors.push(`Unknown action: ${action.kind}`);
        continue;
      }
      try {
        const hr = await handler.handle(
          action as unknown as Record<string, unknown>,
          {
            suggestionId,
            reviewer: null,
            reviewerNote: generic.reviewerNote,
            selectors: selections,
            domainContext: generic.domainFields,
          },
        );
        totalAffected += hr.affectedRows;
        if (hr.pending && hr.pending.length > 0) {
          pendingSelections.push(
            ...(hr.pending as unknown as PendingSelection[]),
          );
        }
        if (!hr.ok && hr.errors) {
          errors.push(...hr.errors);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${action.kind}: ${msg}`);
        logger.error(
          { err, action: action.kind, suggestionId },
          "Resolution action failed",
        );
      }
    }

    // 4. If any handler needs disambiguation and the caller didn't supply
    //    selections, return pending.
    if (pendingSelections.length > 0 && !selections) {
      const result: ResolutionResult = {
        status: "pending_selection",
        affectedRows: 0,
        pendingSelections,
      };
      await this.deps.sweepRepo.updateResolution(suggestionId, {
        status: "pending_selection",
        pendingSelections,
      });
      return result;
    }

    // 5. Compute final status.
    const status: ResolutionResult["status"] =
      errors.length === 0
        ? "success"
        : totalAffected > 0
          ? "partial"
          : "failed";

    const resolvedAt = new Date().toISOString();

    // 6. Promotion: sweep_audit + KG + optional sim-confidence — the adapter
    //    owns what's actually done. Errors are non-fatal (mutations already
    //    landed). Only run when at least one action succeeded.
    if (status !== "failed") {
      try {
        const pr = await this.deps.promotion.promote({
          suggestionId,
          domain: generic.domain,
          domainFields: generic.domainFields,
          resolutionPayload: generic.resolutionPayload,
          reviewer: null,
          reviewerNote: generic.reviewerNote,
        });
        if (!pr.ok && pr.errors) errors.push(...pr.errors);
      } catch (err) {
        logger.warn({ err, suggestionId }, "Promotion threw — mutations stand");
      }
    }

    const result: ResolutionResult = {
      status,
      resolvedAt,
      affectedRows: totalAffected,
      errors: errors.length > 0 ? errors : undefined,
    };

    // 7. Persist final resolution status back to Redis.
    await this.deps.sweepRepo.updateResolution(suggestionId, {
      status: result.status,
      resolvedAt: result.resolvedAt,
      errors: result.errors,
    });

    logger.info(
      {
        suggestionId,
        status,
        affected: totalAffected,
        errors: errors.length,
      },
      "Resolution complete",
    );

    return result;
  }
}

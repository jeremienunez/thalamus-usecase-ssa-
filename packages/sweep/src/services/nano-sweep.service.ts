/**
 * Nano Sweep Service — domain-agnostic façade.
 *
 * Preserves the public `sweep(limit, mode)` signature callers depend on
 * (CycleRunnerService, sweep.worker), delegates candidate generation to an
 * injected DomainAuditProvider, persists via SweepRepository.insertGeneric,
 * and fires completion callbacks. Zero domain knowledge.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@interview/shared/observability";
import type { DomainAuditProvider } from "../ports";
import type { SweepRepository } from "../repositories/sweep.repository";

const logger = createLogger("nano-sweep");

/**
 * Reported by NanoSweepService.sweep for completion callbacks + the admin
 * reporter. Post-refactor, fields sourced from the audit provider are
 * filled at best-effort: suggestionsStored is authoritative, the rest
 * are provider-specific and zero-filled when the port doesn't expose them.
 */
export interface SweepResult {
  totalOperatorCountries: number;
  totalCalls: number;
  successCalls: number;
  suggestionsStored: number;
  wallTimeMs: number;
  estimatedCost: number;
}

export type SweepCompleteCallback = (result: SweepResult) => Promise<void>;

// ─── NanoSweepService façade ─────────────────────────────────────────

export interface NanoSweepDeps {
  audit: DomainAuditProvider;
  sweepRepo: SweepRepository;
  /** Domain discriminator forwarded to SweepRepository.insertGeneric. */
  domain: string;
}

export class NanoSweepService {
  private onCompleteCallbacks: SweepCompleteCallback[] = [];

  constructor(private readonly deps: NanoSweepDeps) {}

  onComplete(cb: SweepCompleteCallback): void {
    this.onCompleteCallbacks.push(cb);
  }

  /**
   * Façade preserved for CycleRunnerService + AdminSweepController +
   * sweep.worker. Runs one audit wave via DomainAuditProvider and
   * persists each candidate through SweepRepository.insertGeneric.
   *
   * @param limit forwarded as AuditCycleContext.limit (0 = let the provider
   *              decide; preserves the pre-refactor optional-param behavior)
   * @param mode passed through to the provider ("dataQuality" | "nullScan" |
   *             "briefing"; other domains can mint their own strings).
   */
  async sweep(
    limit = 0,
    mode = "dataQuality",
  ): Promise<SweepResult> {
    const cycleId = randomUUID();
    const start = Date.now();
    const candidates = await this.deps.audit.runAudit({
      cycleId,
      mode,
      limit,
    });

    let stored = 0;
    for (const c of candidates) {
      await this.deps.sweepRepo.insertGeneric({
        domain: this.deps.domain,
        domainFields: c.domainFields,
        resolutionPayload: c.resolutionPayload,
      });
      stored++;
    }

    const result: SweepResult = {
      totalOperatorCountries: 0, // provider-specific; no longer engine-visible
      totalCalls: 0,
      successCalls: 0,
      suggestionsStored: stored,
      wallTimeMs: Date.now() - start,
      estimatedCost: 0,
    };

    for (const cb of this.onCompleteCallbacks) {
      try {
        await cb(result);
      } catch (err) {
        logger.error({ err }, "sweep onComplete callback failed");
      }
    }

    logger.info(
      { cycleId, mode, stored, ms: result.wallTimeMs },
      "nano sweep complete",
    );

    return result;
  }
}

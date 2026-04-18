/**
 * DomainAuditProvider — engine → pack.
 *
 * The pack runs the audit pass (prompt composition, nano calls, batching,
 * result validation). It returns candidates; the engine persists them via
 * SweepRepository.insertGeneric with the pack's FindingDomainSchema.
 *
 * Legacy compat: AuditCycleContext carries `limit` + `mode` so the
 * NanoSweepService.sweep(limit, mode) façade can forward them unchanged.
 */

export interface AuditCycleContext {
  /** Correlation id for logging + tracing across the audit wave. */
  cycleId: string;

  /**
   * Mode passed by the caller, preserved from the original
   * NanoSweepService.sweep(limit, mode) signature. Pack decides meaning.
   */
  mode: string;

  /**
   * Batch / wave limit passed by the caller. Pack decides how to honor it.
   */
  limit: number;
}

export interface AuditCandidate {
  /** Domain payload matching FindingDomainSchema.serialize input shape. */
  domainFields: Record<string, unknown>;
  /** Serialized resolution action (JSON string) that the review flow will execute. */
  resolutionPayload: string | null;
}

export interface DomainAuditProvider {
  /**
   * Run one audit pass. Returns candidates the engine will persist.
   */
  runAudit(ctx: AuditCycleContext): Promise<AuditCandidate[]>;

  /**
   * Optional feedback mining. Engine calls after each review so the pack
   * can refine prompts / weights. Not required for minimal operation.
   */
  recordFeedback?(input: {
    suggestionId: string;
    accepted: boolean;
    reviewerNote: string | null;
    domainFields: Record<string, unknown>;
  }): Promise<void>;
}

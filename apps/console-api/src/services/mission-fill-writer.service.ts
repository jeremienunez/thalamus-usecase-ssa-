// apps/console-api/src/services/mission-fill-writer.service.ts
import type { AuditInsertInput } from "../types/sweep.types";
import { MISSION_WRITABLE_COLUMNS, inRange } from "../utils/field-constraints";
import type { EnrichmentFindingService } from "./enrichment-finding.service";

// ── Ports ───────────────────────────────────────────────────────────
export interface SatellitesFillPort {
  updateField(
    satelliteId: bigint,
    field: string,
    value: string | number,
  ): Promise<void>;
}

export interface SweepAuditWritePort {
  insertEnrichmentSuccess(input: AuditInsertInput): Promise<void>;
}

/**
 * Persistence-only collaborator for the mission pipeline. Coerces the
 * incoming value to the column's expected shape, bails on out-of-range
 * numerics, then fans out to: satellite update, audit insert, enrichment
 * emit. No scheduling, no LLM, no task mutation.
 */
export class MissionFillWriter {
  constructor(
    private readonly satellites: SatellitesFillPort,
    private readonly audit: SweepAuditWritePort,
    private readonly enrichment: EnrichmentFindingService,
  ) {}

  async applyFill(
    satelliteId: string,
    field: string,
    value: string | number,
    source: string,
  ): Promise<void> {
    const kind = MISSION_WRITABLE_COLUMNS[field];
    if (!kind) return;
    const coerced =
      kind === "numeric"
        ? typeof value === "number"
          ? value
          : Number.parseFloat(String(value).replace(/[^\d.+-]/g, ""))
        : String(value);
    if (kind === "numeric" && !Number.isFinite(coerced as number)) return;
    if (kind === "numeric" && !inRange(field, coerced as number)) return;

    await this.satellites.updateField(BigInt(satelliteId), field, coerced);
    await this.audit.insertEnrichmentSuccess({
      suggestionId: `mission:${satelliteId}:${field}`,
      operatorCountryName: "mission-fill",
      title: `Fill ${field}=${coerced} on satellite ${satelliteId}`,
      description: "",
      suggestedAction: `UPDATE satellite SET ${field}=${coerced}`,
      affectedSatellites: 1,
      webEvidence: source,
      resolutionPayload: { field, value: coerced, source },
    });
    await this.enrichment.emit({
      kind: "mission",
      satelliteId,
      field,
      value: coerced,
      confidence: 0.9,
      source,
    });
  }
}

// apps/console-api/src/services/mission-fill-writer.service.ts
import type { AuditInsertInput } from "../types/sweep.types";
import { MISSION_WRITABLE_COLUMNS, inRange } from "../utils/field-constraints";
import type { EnrichmentEmitPort } from "./enrichment-finding.service";

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

export type MissionFillResult =
  | { applied: true; value: string | number }
  | { applied: false; reason: string };

/**
 * Persistence-only collaborator for the mission pipeline. Coerces the
 * incoming value to the column's expected shape, bails on out-of-range
 * numerics, then fans out to: satellite update, audit insert, enrichment
 * emit. Returns whether the fill was actually persisted so the caller can
 * keep task state honest (`filled` means a real write happened).
 */
export class MissionFillWriter {
  constructor(
    private readonly satellites: SatellitesFillPort,
    private readonly audit: SweepAuditWritePort,
    private readonly enrichment: EnrichmentEmitPort,
  ) {}

  async applyFill(
    satelliteId: string,
    field: string,
    value: string | number,
    source: string,
  ): Promise<MissionFillResult> {
    const kind = MISSION_WRITABLE_COLUMNS[field];
    if (!kind) {
      return { applied: false, reason: `unsupported field '${field}'` };
    }
    const coerced =
      kind === "numeric"
        ? typeof value === "number"
          ? value
          : Number.parseFloat(String(value).replace(/[^\d.+-]/g, ""))
        : String(value);
    if (kind === "numeric" && !Number.isFinite(coerced as number)) {
      return { applied: false, reason: `non-finite numeric value for '${field}'` };
    }
    if (kind === "numeric" && !inRange(field, coerced as number)) {
      return { applied: false, reason: `out-of-range value for '${field}'` };
    }

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
    return { applied: true, value: coerced };
  }
}

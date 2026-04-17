/**
 * SsaFindingSchema — SSA implementation of the FindingDomainSchema port.
 *
 * Maps the flat SSA payload (operatorCountryId, operatorCountryName, category,
 * severity, title, description, affectedSatellites, suggestedAction,
 * webEvidence) into/out of the flat Redis hash stored by SweepRepository.
 *
 * Today the flat hash is the source of truth; `blob` is unused because no
 * SSA field benefits from non-indexed JSON storage. Future domains can use
 * blob for large/nested payloads without changing the engine.
 */

import { z } from "zod";
import type { FindingDomainSchema } from "@interview/sweep";

const ssaCategoryEnum = z.enum([
  "mass_anomaly",
  "missing_data",
  "doctrine_mismatch",
  "relationship_error",
  "enrichment",
  "briefing_angle",
]);

const ssaSeverityEnum = z.enum(["critical", "warning", "info"]);

const ssaInsert = z.object({
  operatorCountryId: z
    .union([z.bigint(), z.string(), z.null()])
    .transform((v) => (v === null ? null : String(v))),
  operatorCountryName: z.string(),
  category: ssaCategoryEnum,
  severity: ssaSeverityEnum,
  title: z.string(),
  description: z.string(),
  affectedSatellites: z.number().int(),
  suggestedAction: z.string(),
  webEvidence: z.string().nullable(),
});

export type SsaFindingPayload = z.infer<typeof ssaInsert>;

export const ssaFindingSchema: FindingDomainSchema = {
  /**
   * Fields the SSA pack wants queryable via indexed filters. `accepted` is a
   * row-level column (written by the engine, not the pack) so it appears
   * here for symmetry with engine-side index construction.
   */
  indexedFields: [
    "operatorCountryId",
    "category",
    "severity",
    "accepted",
  ],

  serialize(input) {
    const parsed = ssaInsert.parse(input);
    return {
      flatFields: {
        operatorCountryId: parsed.operatorCountryId,
        operatorCountryName: parsed.operatorCountryName,
        category: parsed.category,
        severity: parsed.severity,
        title: parsed.title,
        description: parsed.description,
        affectedSatellites: parsed.affectedSatellites,
        suggestedAction: parsed.suggestedAction,
        webEvidence: parsed.webEvidence,
      },
      blob: {},
    };
  },

  deserialize(raw) {
    const f = raw.flatFields;
    return {
      operatorCountryId: f.operatorCountryId ?? null,
      operatorCountryName: f.operatorCountryName ?? "",
      category: f.category ?? "",
      severity: f.severity ?? "",
      title: f.title ?? "",
      description: f.description ?? "",
      affectedSatellites: Number(f.affectedSatellites ?? 0),
      suggestedAction: f.suggestedAction ?? "",
      webEvidence: f.webEvidence ?? null,
    };
  },
};

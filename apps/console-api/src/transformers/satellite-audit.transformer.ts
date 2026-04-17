/**
 * DTO transformers for satellite audit endpoints.
 */
import type {
  SatelliteDataAuditRow,
  SatelliteClassificationAuditRow,
  ApogeeHistoryRow,
  SatelliteDataAuditView,
  SatelliteClassificationAuditView,
  ApogeeHistoryView,
} from "../types/satellite-audit.types";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function toIsoOrNull(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}

function idOrNull(v: string | number | bigint | null | undefined): string | null {
  return v == null ? null : String(v);
}

// ──────────────────────────────────────────────────────────────────────────────
// Transformers
// ──────────────────────────────────────────────────────────────────────────────

export function toSatelliteDataAuditView(
  r: SatelliteDataAuditRow,
): SatelliteDataAuditView {
  return {
    regimeId: idOrNull(r.regimeId),
    regimeName: r.regimeName ?? null,
    satellitesInRegime: Number(r.satellitesInRegime),
    missingMass: Number(r.missingMass),
    missingLaunchYear: Number(r.missingLaunchYear),
    outOfRangeLaunchYear: Number(r.outOfRangeLaunchYear),
    missingOperator: Number(r.missingOperator),
    missingOperatorCountry: Number(r.missingOperatorCountry),
    missingPlatformClass: Number(r.missingPlatformClass),
    missingTelemetrySummary: Number(r.missingTelemetrySummary),
    avgTelemetryScalarNullCount: Number(r.avgTelemetryScalarNullCount),
    flaggedCount: Number(r.flaggedCount),
  };
}

export function toSatelliteClassificationAuditView(
  r: SatelliteClassificationAuditRow,
): SatelliteClassificationAuditView {
  return {
    satelliteId: String(r.satelliteId),
    satelliteName: r.satelliteName,
    noradId: r.noradId ?? null,
    operatorName: r.operatorName ?? null,
    platformClass: r.platformClass ?? null,
    classificationTier: r.classificationTier ?? null,
    launchYear: r.launchYear ?? null,
    massKg: r.massKg == null ? null : Number(r.massKg),
    flag: r.flag,
    details: r.details,
  };
}

export function toApogeeHistoryView(r: ApogeeHistoryRow): ApogeeHistoryView {
  return {
    kind: r.kind,
    title: r.title,
    summary: r.summary ?? null,
    url: r.url ?? null,
    publishedAt: toIsoOrNull(r.publishedAt),
    noradId: r.noradId ?? null,
    meanMotion: r.meanMotion ?? null,
    inclination: r.inclination ?? null,
    eccentricity: r.eccentricity ?? null,
    f107: r.f107 ?? null,
    apIndex: r.apIndex ?? null,
    kpIndex: r.kpIndex ?? null,
    sunspotNumber: r.sunspotNumber ?? null,
    weatherSource: r.weatherSource ?? null,
  };
}

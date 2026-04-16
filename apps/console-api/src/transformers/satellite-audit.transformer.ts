/**
 * DTO transformers for satellite audit endpoints.
 *
 * Invariants:
 *  - ids exposed as string (never bigint / numeric leak)
 *  - timestamps exposed as ISO string
 *  - nullable columns stay explicitly `| null` (no silent fallback)
 *  - camelCase throughout
 */

// ──────────────────────────────────────────────────────────────────────────────
// Row types (input) — match repository shapes exactly
// ──────────────────────────────────────────────────────────────────────────────

export type SatelliteDataAuditRow = {
  regimeId: string | null;
  regimeName: string | null;
  satellitesInRegime: number;
  missingMass: number;
  missingLaunchYear: number;
  outOfRangeLaunchYear: number;
  missingOperator: number;
  missingOperatorCountry: number;
  missingPlatformClass: number;
  missingTelemetrySummary: number;
  avgTelemetryScalarNullCount: number;
  flaggedCount: number;
};

export type SatelliteClassificationAuditRow = {
  satelliteId: string;
  satelliteName: string;
  operatorName: string | null;
  platformClass: string | null;
  classificationTier: string | null;
  launchYear: number | null;
  massKg: number | null;
  flag: string;
  details: string;
};

export type ApogeeHistoryRow = {
  kind: "news" | "satellite";
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  noradId: number | null;
  meanMotion: number | null;
  inclination: number | null;
  eccentricity: number | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// DTO types (output)
// ──────────────────────────────────────────────────────────────────────────────

export type SatelliteDataAuditView = {
  regimeId: string | null;
  regimeName: string | null;
  satellitesInRegime: number;
  missingMass: number;
  missingLaunchYear: number;
  outOfRangeLaunchYear: number;
  missingOperator: number;
  missingOperatorCountry: number;
  missingPlatformClass: number;
  missingTelemetrySummary: number;
  avgTelemetryScalarNullCount: number;
  flaggedCount: number;
};

export type SatelliteClassificationAuditView = {
  satelliteId: string;
  satelliteName: string;
  operatorName: string | null;
  platformClass: string | null;
  classificationTier: string | null;
  launchYear: number | null;
  massKg: number | null;
  flag: string;
  details: string;
};

export type ApogeeHistoryView = {
  kind: "news" | "satellite";
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  noradId: number | null;
  meanMotion: number | null;
  inclination: number | null;
  eccentricity: number | null;
};

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
  };
}

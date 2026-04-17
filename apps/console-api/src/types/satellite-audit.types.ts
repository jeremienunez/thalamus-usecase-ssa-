/**
 * DTOs for satellite audit endpoints.
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
  /** Real NORAD catalog ID. NULL means not tracked in our catalog — the
   *  cortex-llm wrapper tells the LLM to cite '(NORAD unavailable)', never
   *  a substitute. */
  noradId: number | null;
  operatorName: string | null;
  platformClass: string | null;
  classificationTier: string | null;
  launchYear: number | null;
  massKg: number | null;
  flag: string;
  details: string;
};

export type ApogeeHistoryKind =
  | "news"
  | "satellite"
  | "tle_history"
  | "weather";

export type ApogeeHistoryRow = {
  kind: ApogeeHistoryKind;
  title: string;
  summary: string | null;
  url: string | null;
  /** ISO-Z — for `kind="tle_history"` or `"weather"` this is the sample epoch. */
  publishedAt: string | null;
  noradId: number | null;
  meanMotion: number | null;
  inclination: number | null;
  eccentricity: number | null;
  /** kind="weather" fields — null on other rows. */
  f107: number | null;
  apIndex: number | null;
  kpIndex: number | null;
  sunspotNumber: number | null;
  weatherSource: string | null;
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
  noradId: number | null;
  operatorName: string | null;
  platformClass: string | null;
  classificationTier: string | null;
  launchYear: number | null;
  massKg: number | null;
  flag: string;
  details: string;
};

export type ApogeeHistoryView = {
  kind: ApogeeHistoryKind;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  noradId: number | null;
  meanMotion: number | null;
  inclination: number | null;
  eccentricity: number | null;
  f107: number | null;
  apIndex: number | null;
  kpIndex: number | null;
  sunspotNumber: number | null;
  weatherSource: string | null;
};

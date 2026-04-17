// apps/console-api/src/types/traffic-forecast.types.ts

// ── Row types (mirror repo return shapes) ──────────────────────────
export type OrbitalTrafficRow = {
  kind: "density" | "news";
  regimeName: string | null;
  satelliteCount: number | null;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  baselines: Record<string, unknown> | null;
};

export type DebrisForecastRow = {
  kind: "density" | "paper" | "news" | "weather" | "fragmentation";
  regimeName: string | null;
  satelliteCount: number | null;
  avgMissionAge: number | null;
  title: string | null;
  abstract: string | null;
  authors: string[] | null;
  url: string | null;
  publishedAt: string | null;
  /** kind="weather" fields — null on other rows. */
  f107: number | null;
  apIndex: number | null;
  kpIndex: number | null;
  sunspotNumber: number | null;
  weatherSource: string | null;
  /** kind="fragmentation" fields — null on other rows. */
  fragmentParentName: string | null;
  fragmentParentNoradId: number | null;
  fragmentParentCountry: string | null;
  fragmentsCataloged: number | null;
  fragmentParentMassKg: number | null;
  fragmentEventType: string | null;
  fragmentCause: string | null;
};

export type LaunchManifestRow = {
  kind: "db" | "news" | "notam" | "itu";
  title: string;
  detail: string | null;
  year: number | null;
  vehicle: string | null;
  url: string | null;
  publishedAt: string | null;
  // LL2-enriched columns (Phase 3c) — populated only when kind="db" AND
  // the launch row has an externalLaunchId (LL2-sourced). Legacy seed
  // rows surface as `kind="db"` with all of these null.
  externalLaunchId: string | null;
  operatorName: string | null;
  operatorCountry: string | null;
  padName: string | null;
  padLocation: string | null;
  plannedNet: string | null;
  plannedWindowStart: string | null;
  plannedWindowEnd: string | null;
  status: string | null;
  orbitName: string | null;
  missionName: string | null;
  missionDescription: string | null;
  rideshare: boolean | null;
  // NOTAM-specific columns (Phase 3d). kind="notam" only.
  notamId: string | null;
  notamState: string | null;
  notamType: string | null;
  notamStart: string | null;
  notamEnd: string | null;
  // ITU-filing columns (Phase 3f). kind="itu" only.
  ituFilingId: string | null;
  ituConstellation: string | null;
  ituAdministration: string | null;
  ituOrbitClass: string | null;
  ituAltitudeKm: number | null;
  ituPlannedSatellites: number | null;
  ituFrequencyBands: string[] | null;
  ituStatus: string | null;
};

export type LaunchEpochWeatherRow = {
  year: number;
  operatorCountryName: string;
  orbitRegimeName: string;
  solarFluxIndex: number | null;
  solarFluxRegion: string | null;
  kpIndex: number | null;
  kpClass: string | null;
  radiationIndex: number | null;
  radiationClass: string | null;
  climate: Record<string, unknown> | null;
};

// ── View DTO types ─────────────────────────────────────────────────
export type OrbitalTrafficView = {
  id: string;
  kind: "density" | "news";
  regimeName: string | null;
  satelliteCount: number | null;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  baselines: Record<string, unknown> | null;
};

export type DebrisForecastView = {
  id: string;
  kind: "density" | "paper" | "news" | "weather" | "fragmentation";
  regimeName: string | null;
  satelliteCount: number | null;
  avgMissionAge: number | null;
  title: string | null;
  abstract: string | null;
  authors: string[];
  url: string | null;
  publishedAt: string | null;
  f107: number | null;
  apIndex: number | null;
  kpIndex: number | null;
  sunspotNumber: number | null;
  weatherSource: string | null;
  fragmentParentName: string | null;
  fragmentParentNoradId: number | null;
  fragmentParentCountry: string | null;
  fragmentsCataloged: number | null;
  fragmentParentMassKg: number | null;
  fragmentEventType: string | null;
  fragmentCause: string | null;
};

export type LaunchManifestView = {
  id: string;
  kind: "db" | "news" | "notam" | "itu";
  title: string;
  detail: string | null;
  year: number | null;
  vehicle: string | null;
  url: string | null;
  publishedAt: string | null;
  externalLaunchId: string | null;
  operatorName: string | null;
  operatorCountry: string | null;
  padName: string | null;
  padLocation: string | null;
  plannedNet: string | null;
  plannedWindowStart: string | null;
  plannedWindowEnd: string | null;
  status: string | null;
  orbitName: string | null;
  missionName: string | null;
  missionDescription: string | null;
  rideshare: boolean | null;
  notamId: string | null;
  notamState: string | null;
  notamType: string | null;
  notamStart: string | null;
  notamEnd: string | null;
  ituFilingId: string | null;
  ituConstellation: string | null;
  ituAdministration: string | null;
  ituOrbitClass: string | null;
  ituAltitudeKm: number | null;
  ituPlannedSatellites: number | null;
  ituFrequencyBands: string[] | null;
  ituStatus: string | null;
};

export type LaunchEpochWeatherView = {
  id: string;
  year: number;
  operatorCountryName: string;
  orbitRegimeName: string;
  solarFluxIndex: number | null;
  solarFluxRegion: string | null;
  kpIndex: number | null;
  kpClass: string | null;
  radiationIndex: number | null;
  radiationClass: string | null;
  climate: Record<string, unknown> | null;
};

// apps/console-api/src/types/orbital-analysis.types.ts

type FleetMix = Array<{ regime: string; count: number }>;
type PlatformMix = Array<{ platform: string; count: number }>;
type BusMix = Array<{ bus: string; count: number }>;

type FleetAnalysisShape<TOperatorId> = {
  operatorId: TOperatorId;
  operatorName: string;
  country: string | null;
  satelliteCount: number;
  avgAgeYears: number | null;
  regimeMix: FleetMix;
  platformMix: PlatformMix;
  busMix: BusMix;
};

type RegimeProfileShape = {
  regimeId: string;
  regimeName: string;
  altitudeBand: string | null;
  operatorCountryId: string | null;
  operatorCountryName: string | null;
  satelliteCount: number;
  operatorCount: number;
  topOperators: string[];
  doctrineKeys: string[];
};

type OrbitSlotShape<TRegimeId, TOperatorId> = {
  regimeId: TRegimeId;
  regimeName: string;
  operatorId: TOperatorId;
  operatorName: string | null;
  satellitesInRegime: number;
  shareOfRegimePct: number;
};

type OrbitalTrafficShape = {
  kind: "density" | "news";
  regimeName: string | null;
  satelliteCount: number | null;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  baselines: Record<string, unknown> | null;
  branchFilterApplied: boolean | null;
};

type DebrisForecastShape<TAuthors> = {
  kind: "density" | "paper" | "news" | "weather" | "fragmentation";
  regimeName: string | null;
  satelliteCount: number | null;
  avgMissionAge: number | null;
  title: string | null;
  abstract: string | null;
  authors: TAuthors;
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
  branchFilterApplied: boolean | null;
};

type LaunchManifestShape = {
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

type LaunchEpochWeatherShape = {
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

// ── Fleet analysis rows / views ───────────────────────────────────
export type FleetAnalysisRow = FleetAnalysisShape<number>;
export type FleetAnalysisView = FleetAnalysisShape<string> & { id: string };

export type RegimeProfileRow = RegimeProfileShape;
export type RegimeProfileView = RegimeProfileShape & { id: string };

export type OrbitSlotRow = OrbitSlotShape<number, number | null>;
export type OrbitSlotView = OrbitSlotShape<string, string | null> & { id: string };

// ── Traffic / forecast rows / views ───────────────────────────────
export type OrbitalTrafficRow = OrbitalTrafficShape;
export type OrbitalTrafficView = OrbitalTrafficShape & { id: string };

export type DebrisForecastRow = DebrisForecastShape<string[] | null>;
export type DebrisForecastView = DebrisForecastShape<string[]> & { id: string };

export type LaunchManifestRow = LaunchManifestShape;
export type LaunchManifestView = LaunchManifestShape & { id: string };

export type LaunchEpochWeatherRow = LaunchEpochWeatherShape;
export type LaunchEpochWeatherView = LaunchEpochWeatherShape & { id: string };

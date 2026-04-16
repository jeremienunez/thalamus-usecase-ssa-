// ---- shared helpers ----------------------------------------------------
function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- row types (mirror repo return shapes) ----------------------------
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
  kind: "density" | "paper" | "news";
  regimeName: string | null;
  satelliteCount: number | null;
  avgMissionAge: number | null;
  title: string | null;
  abstract: string | null;
  authors: string[] | null;
  url: string | null;
  publishedAt: string | null;
};

export type LaunchManifestRow = {
  kind: "db" | "news";
  title: string;
  detail: string | null;
  year: number | null;
  vehicle: string | null;
  url: string | null;
  publishedAt: string | null;
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

// ---- DTO types ---------------------------------------------------------
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
  kind: "density" | "paper" | "news";
  regimeName: string | null;
  satelliteCount: number | null;
  avgMissionAge: number | null;
  title: string | null;
  abstract: string | null;
  authors: string[];
  url: string | null;
  publishedAt: string | null;
};

export type LaunchManifestView = {
  id: string;
  kind: "db" | "news";
  title: string;
  detail: string | null;
  year: number | null;
  vehicle: string | null;
  url: string | null;
  publishedAt: string | null;
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

// ---- transformers ------------------------------------------------------
export function toOrbitalTrafficView(
  r: OrbitalTrafficRow,
  i: number,
): OrbitalTrafficView {
  return {
    id: `traffic:${r.kind}:${i}:${r.url ?? r.regimeName ?? r.title ?? "_"}`,
    kind: r.kind,
    regimeName: r.regimeName ?? null,
    satelliteCount: r.satelliteCount ?? null,
    title: r.title ?? null,
    url: r.url ?? null,
    publishedAt: toIso(r.publishedAt),
    baselines: r.baselines ?? null,
  };
}

export function toDebrisForecastView(
  r: DebrisForecastRow,
  i: number,
): DebrisForecastView {
  return {
    id: `debris:${r.kind}:${i}:${r.url ?? r.regimeName ?? r.title ?? "_"}`,
    kind: r.kind,
    regimeName: r.regimeName ?? null,
    satelliteCount: r.satelliteCount ?? null,
    avgMissionAge: r.avgMissionAge ?? null,
    title: r.title ?? null,
    abstract: r.abstract ?? null,
    authors: Array.isArray(r.authors) ? r.authors : [],
    url: r.url ?? null,
    publishedAt: toIso(r.publishedAt),
  };
}

export function toLaunchManifestView(
  r: LaunchManifestRow,
  i: number,
): LaunchManifestView {
  return {
    id: `launch:${r.kind}:${i}:${r.url ?? r.title}`,
    kind: r.kind,
    title: r.title,
    detail: r.detail ?? null,
    year: r.year ?? null,
    vehicle: r.vehicle ?? null,
    url: r.url ?? null,
    publishedAt: toIso(r.publishedAt),
  };
}

export function toLaunchEpochWeatherView(
  r: LaunchEpochWeatherRow,
): LaunchEpochWeatherView {
  return {
    id: `weather:${r.year}:${r.operatorCountryName}:${r.orbitRegimeName}`,
    year: r.year,
    operatorCountryName: r.operatorCountryName,
    orbitRegimeName: r.orbitRegimeName,
    solarFluxIndex: r.solarFluxIndex ?? null,
    solarFluxRegion: r.solarFluxRegion ?? null,
    kpIndex: r.kpIndex ?? null,
    kpClass: r.kpClass ?? null,
    radiationIndex: r.radiationIndex ?? null,
    radiationClass: r.radiationClass ?? null,
    climate: r.climate ?? null,
  };
}

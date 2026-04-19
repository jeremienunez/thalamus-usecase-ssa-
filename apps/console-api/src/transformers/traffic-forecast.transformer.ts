import type {
  OrbitalTrafficRow,
  OrbitalTrafficView,
  DebrisForecastRow,
  DebrisForecastView,
  LaunchManifestRow,
  LaunchManifestView,
  LaunchEpochWeatherRow,
  LaunchEpochWeatherView,
} from "../types/traffic-forecast.types";

// ---- shared helpers ----------------------------------------------------
function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

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
    branchFilterApplied: r.branchFilterApplied ?? null,
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
    f107: r.f107 ?? null,
    apIndex: r.apIndex ?? null,
    kpIndex: r.kpIndex ?? null,
    sunspotNumber: r.sunspotNumber ?? null,
    weatherSource: r.weatherSource ?? null,
    fragmentParentName: r.fragmentParentName ?? null,
    fragmentParentNoradId: r.fragmentParentNoradId ?? null,
    fragmentParentCountry: r.fragmentParentCountry ?? null,
    fragmentsCataloged: r.fragmentsCataloged ?? null,
    fragmentParentMassKg: r.fragmentParentMassKg ?? null,
    fragmentEventType: r.fragmentEventType ?? null,
    fragmentCause: r.fragmentCause ?? null,
    branchFilterApplied: r.branchFilterApplied ?? null,
  };
}

export function toLaunchManifestView(
  r: LaunchManifestRow,
  i: number,
): LaunchManifestView {
  return {
    id: `launch:${r.kind}:${i}:${r.url ?? r.externalLaunchId ?? r.title}`,
    kind: r.kind,
    title: r.title,
    detail: r.detail ?? null,
    year: r.year ?? null,
    vehicle: r.vehicle ?? null,
    url: r.url ?? null,
    publishedAt: toIso(r.publishedAt),
    externalLaunchId: r.externalLaunchId ?? null,
    operatorName: r.operatorName ?? null,
    operatorCountry: r.operatorCountry ?? null,
    padName: r.padName ?? null,
    padLocation: r.padLocation ?? null,
    plannedNet: toIso(r.plannedNet),
    plannedWindowStart: toIso(r.plannedWindowStart),
    plannedWindowEnd: toIso(r.plannedWindowEnd),
    status: r.status ?? null,
    orbitName: r.orbitName ?? null,
    missionName: r.missionName ?? null,
    missionDescription: r.missionDescription ?? null,
    rideshare: r.rideshare ?? null,
    notamId: r.notamId ?? null,
    notamState: r.notamState ?? null,
    notamType: r.notamType ?? null,
    notamStart: toIso(r.notamStart),
    notamEnd: toIso(r.notamEnd),
    ituFilingId: r.ituFilingId ?? null,
    ituConstellation: r.ituConstellation ?? null,
    ituAdministration: r.ituAdministration ?? null,
    ituOrbitClass: r.ituOrbitClass ?? null,
    ituAltitudeKm: r.ituAltitudeKm ?? null,
    ituPlannedSatellites: r.ituPlannedSatellites ?? null,
    ituFrequencyBands: r.ituFrequencyBands ?? null,
    ituStatus: r.ituStatus ?? null,
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

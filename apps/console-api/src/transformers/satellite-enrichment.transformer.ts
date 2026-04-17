// Transformers for SatelliteEnrichmentService.
// Invariants: id: string, dates ISO, nulls explicit, camelCase.
import type {
  FindByIdFullRow,
  ListByOperatorRow,
  CatalogContextRow,
  ReplacementCostRow,
  LaunchCostRow,
  PayloadContextRow,
  SatelliteFullView,
  SatelliteListView,
  CatalogContextView,
  ReplacementCostView,
  LaunchCostView,
  PayloadContextView,
} from "../types/satellite.types";

// ---- shared helpers ----------------------------------------------------
function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function idOrNull(
  v: bigint | number | string | null | undefined,
): string | null {
  return v === null || v === undefined ? null : String(v);
}

// ---- shared DTO fragment ----------------------------------------------
type OperatorHeader = {
  id: string;
  name: string;
  slug: string;
  launchYear: number | null;
  operatorId: string | null;
  operatorName: string | null;
  operatorCountryId: string | null;
  operatorCountryName: string | null;
  platformClassId: string | null;
  platformClassName: string | null;
  orbitRegimeId: string | null;
  orbitRegimeName: string | null;
  telemetrySummary: Record<string, unknown> | null;
};

function toOperatorHeader(r: FindByIdFullRow | ListByOperatorRow): OperatorHeader {
  return {
    id: String(r.id),
    name: r.name,
    slug: r.slug,
    launchYear: r.launchYear ?? null,
    operatorId: idOrNull(r.operatorId),
    operatorName: r.operatorName ?? null,
    operatorCountryId: idOrNull(r.operatorCountryId),
    operatorCountryName: r.operatorCountryName ?? null,
    platformClassId: idOrNull(r.platformClassId),
    platformClassName: r.platformClassName ?? null,
    orbitRegimeId: idOrNull(r.orbitRegimeId),
    orbitRegimeName: r.orbitRegimeName ?? null,
    telemetrySummary: r.telemetrySummary ?? null,
  };
}

// ---- transformers ------------------------------------------------------
export function toSatelliteFullView(r: FindByIdFullRow): SatelliteFullView {
  return toOperatorHeader(r);
}

export function toSatelliteListView(r: ListByOperatorRow): SatelliteListView {
  return toOperatorHeader(r);
}

export function toCatalogContextView(r: CatalogContextRow): CatalogContextView {
  return {
    satelliteId: String(r.satelliteId),
    name: r.name,
    noradId: r.noradId ?? null,
    operator: r.operator ?? null,
    operatorCountry: r.operatorCountry ?? null,
    platformClass: r.platformClass ?? null,
    orbitRegime: r.orbitRegime ?? null,
    launchYear: r.launchYear ?? null,
    ingestedAt: toIso(r.ingestedAt),
  };
}

export function toReplacementCostView(
  r: ReplacementCostRow,
): ReplacementCostView {
  return {
    satelliteId: String(r.satelliteId),
    name: r.name,
    operatorName: r.operatorName ?? null,
    massKg: r.massKg ?? null,
    busName: r.busName ?? null,
    payloadNames: r.payloadNames ?? [],
    estimatedCost: r.estimatedCost,
    breakdown: r.breakdown,
  };
}

export function toLaunchCostView(r: LaunchCostRow): LaunchCostView {
  return {
    id: String(r.id),
    name: r.name,
    launchCost: r.launchCost ?? null,
    launchYear: r.launchYear ?? null,
    operatorCountryName: r.operatorCountryName,
    orbitRegimeName: r.orbitRegimeName,
    platformClass: r.platformClass ?? null,
    kMultiplier: r.kMultiplier ?? null,
    busName: r.busName ?? null,
    manifestSourceCount: r.manifestSourceCount,
    inclinationDeg: r.inclinationDeg ?? null,
    altitudeKm: r.altitudeKm ?? null,
    eccentricity: r.eccentricity ?? null,
    regimeType: r.regimeType ?? null,
    slotCapacityMax: r.slotCapacityMax ?? null,
    solarFluxZone: r.solarFluxZone ?? null,
    radiationZone: r.radiationZone ?? null,
    solarFluxIndex: r.solarFluxIndex ?? null,
    kpIndex: r.kpIndex ?? null,
    radiationIndex: r.radiationIndex ?? null,
  };
}

export function toPayloadContextView(r: PayloadContextRow): PayloadContextView {
  return { ...r };
}

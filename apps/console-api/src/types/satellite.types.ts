// DTOs for satellite view + enrichment domains.
// Invariants: id: string, dates ISO, nulls explicit, camelCase.

// ---- row types (authoritative; repos re-export) ------------------------

export type SatelliteOrbitalRow = {
  id: string;
  name: string;
  norad_id: number | null;
  operator: string | null;
  operator_country: string | null;
  launch_year: number | null;
  mass_kg: number | null;
  classification_tier: string | null;
  opacity_score: string | null;
  telemetry_summary: Record<string, unknown> | null;
};

export type SatelliteNameRow = {
  id: string;
  name: string;
  norad_id: string | null;
};

export type FindByIdFullRow = {
  id: bigint;
  name: string;
  slug: string;
  noradId: number | null;
  launchYear: number | null;
  operatorName: string | null;
  operatorId: bigint | null;
  operatorCountryName: string | null;
  operatorCountryId: bigint | null;
  platformClassName: string | null;
  platformClassId: bigint | null;
  orbitRegimeName: string | null;
  orbitRegimeId: bigint | null;
  telemetrySummary: Record<string, unknown> | null;
};

export type ListByOperatorRow = FindByIdFullRow;

export type CatalogContextRow = {
  satelliteId: number;
  name: string;
  noradId: number | null;
  operator: string | null;
  operatorCountry: string | null;
  platformClass: string | null;
  orbitRegime: string | null;
  launchYear: number | null;
  ingestedAt: string;
};

export type ReplacementCostRawRow = {
  satelliteId: number;
  name: string;
  noradId: number | null;
  operatorName: string | null;
  massKg: number | null;
  busName: string | null;
  payloadNames: string[];
};

export type ReplacementCostRow = ReplacementCostRawRow & {
  estimatedCost: { low: number; mid: number; high: number; currency: "USD" };
  breakdown: { bus: number; payload: number; launch: number };
};

export type LaunchCostRow = {
  id: string;
  name: string;
  noradId: number | null;
  launchCost: number | null;
  launchYear: number | null;
  operatorCountryName: string;
  orbitRegimeName: string;
  platformClass: string | null;
  kMultiplier: number | null;
  busName: string | null;
  manifestSourceCount: number;
  inclinationDeg: number | null;
  altitudeKm: number | null;
  eccentricity: number | null;
  regimeType: string | null;
  slotCapacityMax: string | null;
  solarFluxZone: string | null;
  radiationZone: string | null;
  solarFluxIndex: number | null;
  kpIndex: number | null;
  radiationIndex: number | null;
};

export type PayloadContextRow = { type: string; [key: string]: unknown };

// ---- DTO (view) types --------------------------------------------------

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

export type SatelliteFullView = OperatorHeader;
export type SatelliteListView = OperatorHeader;

export type CatalogContextView = {
  satelliteId: string;
  name: string;
  noradId: number | null;
  operator: string | null;
  operatorCountry: string | null;
  platformClass: string | null;
  orbitRegime: string | null;
  launchYear: number | null;
  ingestedAt: string | null;
};

export type ReplacementCostView = {
  satelliteId: string;
  name: string;
  operatorName: string | null;
  massKg: number | null;
  busName: string | null;
  payloadNames: string[];
  estimatedCost: { low: number; mid: number; high: number; currency: "USD" };
  breakdown: { bus: number; payload: number; launch: number };
};

export type LaunchCostView = {
  id: string;
  name: string;
  launchCost: number | null;
  launchYear: number | null;
  operatorCountryName: string;
  orbitRegimeName: string;
  platformClass: string | null;
  kMultiplier: number | null;
  busName: string | null;
  manifestSourceCount: number;
  inclinationDeg: number | null;
  altitudeKm: number | null;
  eccentricity: number | null;
  regimeType: string | null;
  slotCapacityMax: string | null;
  solarFluxZone: string | null;
  radiationZone: string | null;
  solarFluxIndex: number | null;
  kpIndex: number | null;
  radiationIndex: number | null;
};

export type PayloadContextView = {
  type: string;
  [key: string]: unknown;
};

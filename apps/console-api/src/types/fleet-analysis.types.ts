// apps/console-api/src/types/fleet-analysis.types.ts

// ── Row types (mirror repo return shapes) ──────────────────────────
export type FleetAnalysisRow = {
  operatorId: number;
  operatorName: string;
  country: string | null;
  satelliteCount: number;
  avgAgeYears: number | null;
  regimeMix: Record<string, number>;
  platformMix: Record<string, number>;
  busMix: Record<string, number>;
};

export type RegimeProfileRow = {
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

export type OrbitSlotRow = {
  regimeId: number;
  regimeName: string;
  operatorId: number | null;
  operatorName: string | null;
  satellitesInRegime: number;
  shareOfRegimePct: number;
};

// ── View DTO types ─────────────────────────────────────────────────
export type FleetAnalysisView = {
  id: string;
  operatorId: string;
  operatorName: string;
  country: string | null;
  satelliteCount: number;
  avgAgeYears: number | null;
  regimeMix: Record<string, number>;
  platformMix: Record<string, number>;
  busMix: Record<string, number>;
};

export type RegimeProfileView = {
  id: string;
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

export type OrbitSlotView = {
  id: string;
  regimeId: string;
  regimeName: string;
  operatorId: string | null;
  operatorName: string | null;
  satellitesInRegime: number;
  shareOfRegimePct: number;
};

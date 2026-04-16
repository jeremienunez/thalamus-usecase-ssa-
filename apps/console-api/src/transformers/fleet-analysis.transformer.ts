// ---- row types (mirror repo return shapes) ----------------------------
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

// ---- DTO types ---------------------------------------------------------
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

// ---- transformers ------------------------------------------------------
export function toFleetAnalysisView(r: FleetAnalysisRow): FleetAnalysisView {
  const operatorId = String(r.operatorId);
  return {
    id: `fleet:${operatorId}`,
    operatorId,
    operatorName: r.operatorName,
    country: r.country ?? null,
    satelliteCount: r.satelliteCount,
    avgAgeYears: r.avgAgeYears ?? null,
    regimeMix: r.regimeMix ?? {},
    platformMix: r.platformMix ?? {},
    busMix: r.busMix ?? {},
  };
}

export function toRegimeProfileView(r: RegimeProfileRow): RegimeProfileView {
  const regimeId = String(r.regimeId);
  const countryId = r.operatorCountryId == null ? null : String(r.operatorCountryId);
  return {
    id: `regime:${regimeId}:${countryId ?? "_"}`,
    regimeId,
    regimeName: r.regimeName,
    altitudeBand: r.altitudeBand ?? null,
    operatorCountryId: countryId,
    operatorCountryName: r.operatorCountryName ?? null,
    satelliteCount: r.satelliteCount,
    operatorCount: r.operatorCount,
    topOperators: (r.topOperators ?? []).filter((x): x is string => x != null),
    doctrineKeys: r.doctrineKeys ?? [],
  };
}

export function toOrbitSlotView(r: OrbitSlotRow): OrbitSlotView {
  const regimeId = String(r.regimeId);
  const operatorId = r.operatorId == null ? null : String(r.operatorId);
  return {
    id: `slot:${regimeId}:${operatorId ?? "_"}`,
    regimeId,
    regimeName: r.regimeName,
    operatorId,
    operatorName: r.operatorName ?? null,
    satellitesInRegime: r.satellitesInRegime,
    shareOfRegimePct: r.shareOfRegimePct,
  };
}

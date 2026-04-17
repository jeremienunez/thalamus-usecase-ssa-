// apps/console-api/src/types/reflexion.types.ts
// ── Reflexion DTOs ──────────────────────────────────────────────────
export type ReflexionTarget = {
  id: string;
  name: string;
  norad_id: number | null;
  object_class: string | null;
  operator_country: string | null;
  classification_tier: string | null;
  platform_name: string | null;
  inc: number | null;
  raan: number | null;
  mm: number | null;
  ma: number | null;
  apogee: number | null;
  perigee: number | null;
};

export type CoplaneRow = {
  id: string;
  norad_id: string;
  name: string;
  operator_country: string | null;
  tier: string | null;
  object_class: string | null;
  platform: string | null;
  d_inc: number;
  d_raan: number;
  lag_min: number;
};

export type BeltRow = {
  country: string | null;
  tier: string | null;
  object_class: string | null;
  n: string;
};

export type MilRow = {
  id: string;
  norad_id: string;
  name: string;
  country: string | null;
  tier: string | null;
  d_inc: number;
};

export type ReflexionTargetView = {
  noradId: number;
  name: string;
  declared: {
    operator_country: string | null;
    classification_tier: string | null;
    object_class: string | null;
    platform: string | null;
  };
  orbital: {
    inclinationDeg: number;
    raanDeg: number;
    meanMotionRevPerDay: number;
    apogeeKm: number | null;
    perigeeKm: number | null;
  };
};

export type CoplaneView = {
  noradId: number;
  name: string;
  country: string | null;
  tier: string | null;
  class: string | null;
  platform: string | null;
  dInc: number;
  dRaan: number;
  lagMin: number;
};

export type BeltView = {
  country: string | null;
  tier: string | null;
  class: string | null;
  n: number;
};

export type MilPeerView = {
  noradId: number;
  name: string;
  country: string | null;
  tier: string | null;
  dInc: number;
};

export interface ReflexionPassInput {
  noradId: number;
  dIncMax: number;
  dRaanMax: number;
  dMmMax: number;
}

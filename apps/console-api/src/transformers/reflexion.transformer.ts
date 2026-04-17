import type {
  ReflexionTarget,
  CoplaneRow,
  BeltRow,
  MilRow,
  ReflexionTargetView,
  CoplaneView,
  BeltView,
  MilPeerView,
} from "../types/reflexion.types";

export function toReflexionTargetView(
  norad: number,
  t: ReflexionTarget & { inc: number; raan: number; mm: number },
): ReflexionTargetView {
  return {
    noradId: norad,
    name: t.name,
    declared: {
      operator_country: t.operator_country,
      classification_tier: t.classification_tier,
      object_class: t.object_class,
      platform: t.platform_name,
    },
    orbital: {
      inclinationDeg: t.inc,
      raanDeg: t.raan,
      meanMotionRevPerDay: t.mm,
      apogeeKm: t.apogee,
      perigeeKm: t.perigee,
    },
  };
}

export function toCoplaneView(r: CoplaneRow): CoplaneView {
  return {
    noradId: Number(r.norad_id),
    name: r.name,
    country: r.operator_country,
    tier: r.tier,
    class: r.object_class,
    platform: r.platform,
    dInc: Number(r.d_inc.toFixed(3)),
    dRaan: Number(r.d_raan.toFixed(2)),
    lagMin: Number(r.lag_min.toFixed(1)),
  };
}

export function toBeltView(r: BeltRow): BeltView {
  return {
    country: r.country,
    tier: r.tier,
    class: r.object_class,
    n: Number(r.n),
  };
}

export function toMilPeerView(r: MilRow): MilPeerView {
  return {
    noradId: Number(r.norad_id),
    name: r.name,
    country: r.country,
    tier: r.tier,
    dInc: Number(r.d_inc.toFixed(3)),
  };
}

import type { SatelliteView } from "@interview/shared";
import {
  normaliseRegime,
  regimeFromMeanMotion,
  smaFromMeanMotion,
  classificationTier,
} from "@interview/shared";
import type { SatelliteOrbitalRow } from "../types/satellite.types";

export function toSatelliteView(r: SatelliteOrbitalRow): SatelliteView {
  const ts = r.telemetry_summary ?? {};
  const mm = Number(ts.meanMotion ?? 15);
  const inc = Number(ts.inclination ?? 0);
  const ecc = Number(ts.eccentricity ?? 0);
  const regime =
    typeof ts.regime === "string"
      ? normaliseRegime(String(ts.regime))
      : regimeFromMeanMotion(mm);
  const opacityScore = r.opacity_score ? Number(r.opacity_score) : null;
  return {
    id: Number(r.id),
    name: r.name,
    noradId: r.norad_id ?? 0,
    regime,
    operator: r.operator ?? "Unknown",
    country: r.operator_country ?? "—",
    inclinationDeg: inc,
    semiMajorAxisKm: smaFromMeanMotion(mm),
    eccentricity: ecc,
    raanDeg: Number(ts.raan ?? 0),
    argPerigeeDeg: Number(ts.argPerigee ?? 0),
    meanAnomalyDeg: Number(ts.meanAnomaly ?? 0),
    meanMotionRevPerDay: mm,
    epoch: typeof ts.epoch === "string" ? ts.epoch : new Date().toISOString(),
    massKg: r.mass_kg ?? 0,
    classificationTier: classificationTier(r.classification_tier),
    opacityScore,
  };
}

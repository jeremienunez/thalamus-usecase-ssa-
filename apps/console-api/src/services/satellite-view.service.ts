import type { SatelliteView, Regime } from "@interview/shared";
import {
  normaliseRegime,
  regimeFromMeanMotion,
  smaFromMeanMotion,
  classificationTier,
} from "@interview/shared";
import {
  SatelliteRepository,
  type SatelliteOrbitalRow,
} from "../repositories/satellite.repository";

export class SatelliteViewService {
  constructor(private readonly repo: SatelliteRepository) {}

  async list(opts: {
    limit: number;
    regime?: Regime;
  }): Promise<{ items: SatelliteView[]; total: number }> {
    const rows = await this.repo.listWithOrbital(opts.limit);
    const items = rows.map(toView);
    const filtered = opts.regime
      ? items.filter((s) => s.regime === opts.regime)
      : items;
    return { items: filtered, total: filtered.length };
  }
}

function toView(r: SatelliteOrbitalRow): SatelliteView {
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

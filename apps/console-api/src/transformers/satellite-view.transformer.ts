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
    massKg: r.mass_kg ?? null,
    classificationTier: classificationTier(r.classification_tier),
    opacityScore,
    tleLine1: typeof ts.tleLine1 === "string" ? ts.tleLine1 : null,
    tleLine2: typeof ts.tleLine2 === "string" ? ts.tleLine2 : null,
    launchYear: r.launch_year,
    objectClass: r.object_class,
    photoUrl: r.photo_url,
    shortDescription: r.g_short_description,
    description: r.g_description,
    platformClass: r.platform_class_name,
    busName: r.bus_name,
    busGeneration: r.bus_generation,
    telemetry: {
      powerDraw: r.power_draw,
      thermalMargin: r.thermal_margin,
      pointingAccuracy: r.pointing_accuracy,
      attitudeRate: r.attitude_rate,
      linkBudget: r.link_budget,
      dataRate: r.data_rate,
      payloadDuty: r.payload_duty,
      eclipseRatio: r.eclipse_ratio,
      solarArrayHealth: r.solar_array_health,
      batteryDepthOfDischarge: r.battery_depth_of_discharge,
      propellantRemaining: r.propellant_remaining,
      radiationDose: r.radiation_dose,
      debrisProximity: r.debris_proximity,
      missionAge: r.mission_age,
    },
    lastTleIngestedAt: r.last_tle_ingested_at,
    meanMotionDrift: r.mean_motion_drift,
  };
}

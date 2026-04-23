import { describe, it, expect } from "vitest";
import { toSatelliteView } from "../../../src/transformers/satellite-view.transformer";
import type { SatelliteOrbitalRow } from "../../../src/repositories/satellite.repository";

function row(over: Partial<SatelliteOrbitalRow> = {}): SatelliteOrbitalRow {
  return {
    id: "1",
    name: "SAT-1",
    norad_id: 12345,
    operator: "SpaceX",
    operator_country: "USA",
    launch_year: 2020,
    mass_kg: 300,
    classification_tier: null,
    opacity_score: null,
    telemetry_summary: {
      meanMotion: 15,
      inclination: 53,
      eccentricity: 0.001,
      raan: 100,
      argPerigee: 10,
      meanAnomaly: 20,
      epoch: "2024-01-01T00:00:00.000Z",
    },
    object_class: null,
    photo_url: null,
    g_short_description: null,
    g_description: null,
    platform_class_name: null,
    bus_name: null,
    bus_generation: null,
    power_draw: null,
    thermal_margin: null,
    pointing_accuracy: null,
    attitude_rate: null,
    link_budget: null,
    data_rate: null,
    payload_duty: null,
    eclipse_ratio: null,
    solar_array_health: null,
    battery_depth_of_discharge: null,
    propellant_remaining: null,
    radiation_dose: null,
    debris_proximity: null,
    mission_age: null,
    last_tle_ingested_at: null,
    mean_motion_drift: null,
    ...over,
  };
}

describe("toSatelliteView", () => {
  it("honours telemetry_summary.regime via normaliseRegime", () => {
    const v = toSatelliteView(
      row({
        telemetry_summary: {
          ...row().telemetry_summary,
          regime: "GEO",
        },
      }),
    );
    expect(v.regime).toBe("GEO");
  });

  it("derives regime from meanMotion when telemetry_summary.regime absent", () => {
    const ts = { ...row().telemetry_summary };
    delete (ts as Record<string, unknown>).regime;
    const v = toSatelliteView(row({ telemetry_summary: ts }));
    // meanMotion=15 → LEO per regimeFromMeanMotion
    expect(v.regime).toBe("LEO");
  });

  it("falls back to Unknown operator when null", () => {
    const v = toSatelliteView(row({ operator: null }));
    expect(v.operator).toBe("Unknown");
  });

  it("falls back to — for country when null", () => {
    const v = toSatelliteView(row({ operator_country: null }));
    expect(v.country).toBe("—");
  });

  it("defaults noradId to 0 when null", () => {
    const v = toSatelliteView(row({ norad_id: null }));
    expect(v.noradId).toBe(0);
  });

  it("keeps massKg null when source mass is absent", () => {
    const v = toSatelliteView(row({ mass_kg: null }));
    expect(v.massKg).toBeNull();
  });

  it("parses opacity_score string to number", () => {
    const v = toSatelliteView(row({ opacity_score: "0.5" }));
    expect(v.opacityScore).toBe(0.5);
  });

  it("returns null opacityScore when opacity_score is null", () => {
    const v = toSatelliteView(row({ opacity_score: null }));
    expect(v.opacityScore).toBeNull();
  });

  it("falls back to current ISO when epoch is not a string", () => {
    const ts: Record<string, unknown> = {
      ...row().telemetry_summary,
      epoch: 12345,
    };
    const v = toSatelliteView(row({ telemetry_summary: ts }));
    // must be a valid ISO string
    expect(typeof v.epoch).toBe("string");
    expect(() => new Date(v.epoch).toISOString()).not.toThrow();
    expect(new Date(v.epoch).toISOString()).toBe(v.epoch);
  });

  it("maps numeric fields from telemetry_summary", () => {
    const v = toSatelliteView(row());
    expect(v.inclinationDeg).toBe(53);
    expect(v.eccentricity).toBe(0.001);
    expect(v.raanDeg).toBe(100);
    expect(v.argPerigeeDeg).toBe(10);
    expect(v.meanAnomalyDeg).toBe(20);
    expect(v.meanMotionRevPerDay).toBe(15);
    expect(v.semiMajorAxisKm).toBeGreaterThan(0);
  });

  it("passes platformClass / busName / busGeneration through from joined tables", () => {
    const v = toSatelliteView(
      row({
        platform_class_name: "comms",
        bus_name: "Starlink V2",
        bus_generation: "gen 2",
      }),
    );
    expect(v.platformClass).toBe("comms");
    expect(v.busName).toBe("Starlink V2");
    expect(v.busGeneration).toBe("gen 2");
  });

  it("leaves platformClass / bus fields null when joins miss", () => {
    const v = toSatelliteView(row());
    expect(v.platformClass).toBeNull();
    expect(v.busName).toBeNull();
    expect(v.busGeneration).toBeNull();
  });

  it("builds a 14D telemetry block with all scalars passed through", () => {
    const v = toSatelliteView(
      row({
        power_draw: 12000,
        thermal_margin: 8,
        pointing_accuracy: 0.05,
        attitude_rate: 0.2,
        link_budget: 52.3,
        data_rate: 500,
        payload_duty: 0.95,
        eclipse_ratio: 0.22,
        solar_array_health: 0.98,
        battery_depth_of_discharge: 0.34,
        propellant_remaining: 0.67,
        radiation_dose: 12,
        debris_proximity: 0.12,
        mission_age: 4.2,
      }),
    );
    expect(v.telemetry).toMatchObject({
      powerDraw: 12000,
      thermalMargin: 8,
      pointingAccuracy: 0.05,
      attitudeRate: 0.2,
      linkBudget: 52.3,
      dataRate: 500,
      payloadDuty: 0.95,
      eclipseRatio: 0.22,
      solarArrayHealth: 0.98,
      batteryDepthOfDischarge: 0.34,
      propellantRemaining: 0.67,
      radiationDose: 12,
      debrisProximity: 0.12,
      missionAge: 4.2,
    });
  });

  it("telemetry is an all-null object when the satellite has no readings", () => {
    const v = toSatelliteView(row());
    expect(v.telemetry).toBeDefined();
    expect(
      Object.values(v.telemetry!).every((x) => x === null),
    ).toBe(true);
  });

  it("passes lastTleIngestedAt + meanMotionDrift through from tle_history joins", () => {
    const v = toSatelliteView(
      row({
        last_tle_ingested_at: "2026-04-20T22:00:00.000Z",
        mean_motion_drift: 0.0012,
      }),
    );
    expect(v.lastTleIngestedAt).toBe("2026-04-20T22:00:00.000Z");
    expect(v.meanMotionDrift).toBeCloseTo(0.0012);
  });

  it("leaves lastTleIngestedAt + meanMotionDrift null when no TLE history exists", () => {
    const v = toSatelliteView(row());
    expect(v.lastTleIngestedAt).toBeNull();
    expect(v.meanMotionDrift).toBeNull();
  });
});

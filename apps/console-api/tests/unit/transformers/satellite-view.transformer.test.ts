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

  it("parses opacity_score string to number", () => {
    const v = toSatelliteView(row({ opacity_score: "0.5" }));
    expect(v.opacityScore).toBe(0.5);
  });

  it("returns null opacityScore when opacity_score is null", () => {
    const v = toSatelliteView(row({ opacity_score: null }));
    expect(v.opacityScore).toBeNull();
  });

  it("falls back to current ISO when epoch is not a string", () => {
    const ts = { ...row().telemetry_summary, epoch: 12345 as unknown as string };
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
});

import { describe, expect, it } from "vitest";
import {
  COSPAR_PATTERNS,
  extractSatelliteEntities,
  NORAD_ID_PATTERNS,
  uniqueMatches,
} from "../../../../../src/agent/ssa/explorer/satellite-entity-patterns";

describe("satellite-entity-patterns", () => {
  it("deduplicates capture-group matches case-insensitively", () => {
    const ids = uniqueMatches(
      "NORAD 25544 satcat 25544 2023-042B 2023-042B",
      NORAD_ID_PATTERNS,
    );
    const cospar = uniqueMatches(
      "2023-042B 2023-042B",
      COSPAR_PATTERNS,
    );

    expect(ids).toEqual(["25544"]);
    expect(cospar).toEqual(["2023-042b"]);
  });

  it("extracts SSA entities and telemetry-like values from free text", () => {
    const entities = extractSatelliteEntities(`
      SpaceX reported Starlink-1234 (NORAD 25544, 2023-042B) on Falcon 9.
      The spacecraft remains in sun-synchronous transfer analysis with 550 km altitude
      and 12 days of commissioning.
    `);

    expect(entities).toMatchObject({
      noradIds: ["25544"],
      cosparIds: ["2023-042b"],
      satellites: ["starlink-1234"],
      launchVehicles: ["falcon 9"],
      orbitRegimes: ["sun-synchronous"],
      operators: ["spacex"],
      hasSatelliteContent: true,
    });
    expect(entities.dataPoints).toEqual(expect.arrayContaining(["550", "12"]));
  });

  it("keeps hasSatelliteContent false when the text has no SSA signal", () => {
    const entities = extractSatelliteEntities(
      "Insurance rates rose by 4% after the quarterly market review.",
    );

    expect(entities.hasSatelliteContent).toBe(false);
    expect(entities.satellites).toEqual([]);
    expect(entities.operators).toEqual([]);
  });
});

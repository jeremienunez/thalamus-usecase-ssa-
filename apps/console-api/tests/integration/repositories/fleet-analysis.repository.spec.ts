import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FleetAnalysisRepository } from "../../../src/repositories/fleet-analysis.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: FleetAnalysisRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new FleetAnalysisRepository(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await seedFixtures();
});

afterAll(async () => {
  if (harness) await harness.close();
});

async function seedFixtures(): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO orbit_regime (id, name, altitude_band) VALUES
      (1, 'LEO', '160-2000km'),
      (2, 'GEO', '35786km')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator_country (id, name, slug, orbit_regime_id, doctrine) VALUES
      (1, 'France', 'france', 1, '{"sharing":"open","licensing":"civil"}'::jsonb),
      (2, 'USA', 'usa', 2, '{"sharing":"restricted"}'::jsonb)
  `);
  await harness.db.execute(sql`
    INSERT INTO platform_class (id, name) VALUES
      (1, 'EO'),
      (2, 'Comms')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite_bus (id, name, generation) VALUES
      (1, 'LEOStar', 'v2'),
      (2, 'A2100', 'block-3')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator (id, name, slug) VALUES
      (1, 'CNES', 'cnes'),
      (2, 'SpaceX', 'spacex')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite (
      id, name, slug, norad_id, operator_id, operator_country_id, platform_class_id, satellite_bus_id, launch_year
    ) VALUES
      (1, 'Fleet A', 'fleet-a', 8001, 1, 1, 1, 1, 2020),
      (2, 'Fleet B', 'fleet-b', 8002, 1, 1, 1, 1, 2024),
      (3, 'Relay One', 'relay-one', 8003, 2, 2, 2, 2, 2021)
  `);
}

describe("FleetAnalysisRepository", () => {
  it("analyzes operator fleets with age and mix rollups", async () => {
    const rows = await repo.analyzeOperatorFleet({ operatorId: 1, limit: 5 });

    expect(rows).toEqual([
      expect.objectContaining({
        operatorId: 1,
        operatorName: "CNES",
        country: "France",
        satelliteCount: 2,
        regimeMix: [{ regime: "LEO", count: 2 }],
        platformMix: [{ platform: "EO", count: 2 }],
        busMix: [{ bus: "LEOStar", count: 2 }],
      }),
    ]);
    expect(rows[0]?.avgAgeYears).not.toBeNull();
  });

  it("profiles orbit regimes by operator country and exposes doctrine keys", async () => {
    const rows = await repo.profileOrbitRegime({
      operatorCountryName: "France",
      limit: 5,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        regimeName: "LEO",
        operatorCountryName: "France",
        satelliteCount: 2,
        operatorCount: 1,
        topOperators: ["CNES"],
        doctrineKeys: ["sharing", "licensing"],
      }),
    ]);
  });

  it("plans orbit slots from the migrated SQL function", async () => {
    const rows = await repo.planOrbitSlots({ operatorId: 1, limit: 5 });

    expect(rows).toEqual([
      expect.objectContaining({
        regimeName: "LEO",
        operatorName: "CNES",
        satellitesInRegime: 2,
      }),
    ]);
  });
});

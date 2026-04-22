import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SatelliteEnrichmentRepository } from "../../../src/repositories/satellite-enrichment.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SatelliteEnrichmentRepository;

function halfvecLiteral(head: number[]): string {
  const values = Array.from({ length: 2048 }, (_, index) => head[index] ?? 0);
  return `[${values.join(",")}]`;
}

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SatelliteEnrichmentRepository(harness.db);
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
      (1, 'Low Earth Orbit', '160-2000km'),
      (2, 'Geostationary Orbit', '35786km')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator_country (id, name, slug, orbit_regime_id, doctrine) VALUES
      (1, 'France', 'france', 1, '{"regime":{"orbit":{"inclination_deg":97.4,"altitude_km":550,"eccentricity":0.001,"regime_type":"sun-synchronous"},"environment":{"classification":{"solar_flux_zone":"moderate","radiation_zone":"low"}}},"slot_capacity_max":"12"}'::jsonb),
      (2, 'USA', 'usa', 2, '{"regime":{"orbit":{"inclination_deg":0,"altitude_km":35786,"eccentricity":0,"regime_type":"geo"}}}'::jsonb)
  `);
  await harness.db.execute(sql`
    INSERT INTO operator (id, name, slug) VALUES
      (1, 'CNES', 'cnes')
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
    INSERT INTO payload (id, name, slug, technical_profile, photo_url) VALUES
      (10, 'Alpha Sensor', 'alpha-sensor', NULL, 'https://example.test/alpha.png'),
      (11, 'Beta Relay', 'beta-relay', '{"lastUpdated":"2026-04-21T00:00:00Z","band":"x"}'::jsonb, 'https://example.test/beta.png')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite (
      id, name, slug, norad_id, operator_id, operator_country_id, platform_class_id, satellite_bus_id,
      launch_year, mass_kg, created_at
    ) VALUES
      (1, 'Catalog Alpha', 'catalog-alpha', 9201, 1, 1, 1, 1, 2024, 1200, '2026-04-22T08:00:00Z'),
      (2, 'Catalog Beta', 'catalog-beta', 9202, 1, 1, 1, 1, 2023, 1300, '2026-04-20T08:00:00Z'),
      (3, 'Geo Relay', 'geo-relay', 9203, 1, 2, 2, 2, 2022, 1400, '2026-04-21T08:00:00Z')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite_payload (
      satellite_id, payload_id, role, mass_kg, power_w
    ) VALUES
      (1, 10, 'primary', 120, 450),
      (1, 11, 'relay', 40, 80),
      (2, 10, 'primary', 115, 430),
      (3, 11, 'relay', 42, 82)
  `);
  await harness.db.execute(sql`
    INSERT INTO research_cycle (
      id, trigger_type, trigger_source, status
    ) VALUES (
      1, 'daemon', 'fixtures', 'completed'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO research_finding (
      id, research_cycle_id, cortex, finding_type, status, title, summary, evidence, confidence
    ) VALUES (
      1, 1, 'strategist', 'insight', 'active',
      'Payload finding',
      'Existing payload note',
      '[]'::jsonb,
      0.82
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO research_edge (
      finding_id, entity_type, entity_id, relation
    ) VALUES (
      1, 'payload', 10, 'about'
    )
  `);
  await harness.db.execute(sql`
    UPDATE satellite SET embedding = ${halfvecLiteral([1, 0])}::halfvec(2048) WHERE id = 1
  `);
  await harness.db.execute(sql`
    UPDATE satellite SET embedding = ${halfvecLiteral([0.8, 0.2])}::halfvec(2048) WHERE id = 2
  `);
  await harness.db.execute(sql`
    UPDATE satellite SET embedding = ${halfvecLiteral([0.2, 0.8])}::halfvec(2048) WHERE id = 3
  `);
}

describe("SatelliteEnrichmentRepository", () => {
  it("lists catalog context with since filters and reads replacement-cost inputs", async () => {
    const catalog = await repo.listCatalogContext({
      sinceEpoch: "2026-04-21T00:00:00Z",
      limit: 10,
    });
    const replacement = await repo.findReplacementCostInputs({ satelliteId: 1n });

    expect(catalog.map((row) => row.name)).toEqual(["Catalog Alpha", "Geo Relay"]);
    expect(catalog[0]).toMatchObject({
      noradId: 9201,
      operatorCountry: "France",
      orbitRegime: "Low Earth Orbit",
    });
    expect(replacement).toEqual([
      {
        satelliteId: 1,
        name: "Catalog Alpha",
        noradId: 9201,
        operatorName: "CNES",
        massKg: 1200,
        busName: "LEOStar",
        payloadNames: ["Alpha Sensor", "Beta Relay"],
      },
    ]);
  });

  it("searches nearest neighbours from the live satellite embedding", async () => {
    const rows = await repo.searchByTelemetry(
      Array.from({ length: 2048 }, (_, index) => (index === 0 ? 1 : 0)),
      { orbitRegime: "Low Earth Orbit", limit: 5 },
    );

    expect(rows.map((row) => row.name)).toEqual(["Catalog Alpha", "Catalog Beta"]);
    expect(rows[0]?.similarity).toBeGreaterThan(rows[1]?.similarity ?? 0);
  });

  it("returns payload profiler batch targets and single-payload context", async () => {
    const batch = await repo.getPayloadContext({ batch: true, limit: 5 });
    const single = await repo.getPayloadContext({ payloadId: 10, limit: 10 });

    expect(batch[0]).toMatchObject({
      type: "batch_target",
      payloadId: "10",
      payloadName: "Alpha Sensor",
      profileConfidence: null,
      satelliteCount: 2,
    });
    expect(single).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "identity",
          payloadId: "10",
          name: "Alpha Sensor",
          profileConfidence: null,
        }),
        expect.objectContaining({
          type: "satellite_distribution",
          totalSatellites: 2,
          role: "primary",
          operatorCountryName: "France",
          orbitRegimeName: "Low Earth Orbit",
        }),
        expect.objectContaining({
          type: "payload_allocation",
          role: "primary",
          massKg: 120,
          powerW: 450,
        }),
        expect.objectContaining({
          type: "prior_finding",
          title: "Payload finding",
          findingType: "insight",
        }),
      ]),
    );
  });
});

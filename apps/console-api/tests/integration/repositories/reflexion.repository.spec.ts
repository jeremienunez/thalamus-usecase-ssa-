import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReflexionRepository } from "../../../src/repositories/reflexion.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: ReflexionRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new ReflexionRepository(harness.db);
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
      (1, 'LEO', '160-2000km')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator_country (id, name, slug, orbit_regime_id, doctrine) VALUES
      (1, 'US Space Force', 'ussf', 1, '{"sharing":"restricted"}'::jsonb),
      (2, 'France', 'france', 1, '{"sharing":"open"}'::jsonb)
  `);
  await harness.db.execute(sql`
    INSERT INTO platform_class (id, name) VALUES
      (1, 'SIGINT'),
      (2, 'EO')
  `);
  await harness.db.execute(sql`
    INSERT INTO operator (id, name, slug) VALUES
      (1, 'USSF', 'ussf'),
      (2, 'CNES', 'cnes')
  `);
  await harness.db.execute(sql`
    INSERT INTO source (id, name, slug, kind, url, category) VALUES
      (1, 'Catalog Diff', 'spacetrack-satcat-diff', 'osint', 'https://example/diff', 'catalog')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite (
      id, name, slug, norad_id, object_class, operator_country_id, operator_id, platform_class_id,
      launch_year, classification_tier, telemetry_summary, metadata
    ) VALUES
      (
        1, 'TARGET-1', 'target-1', 9001, 'payload', 1, 1, 1,
        2023, 'classified',
        '{"noradId":9001,"inclination":98.2,"raan":120.0,"meanMotion":14.8,"meanAnomaly":20.0}'::jsonb,
        '{"apogeeKm":550,"perigeeKm":540}'::jsonb
      ),
      (
        2, 'COPLANE-PEER', 'coplane-peer', 9002, 'payload', 2, 2, 2,
        2022, 'allied',
        '{"noradId":9002,"inclination":98.1,"raan":119.6,"meanMotion":14.79,"meanAnomaly":24.0}'::jsonb,
        '{"apogeeKm":548,"perigeeKm":538}'::jsonb
      ),
      (
        3, 'USA TOPAZ', 'usa-topaz', 9003, 'payload', 1, 1, 1,
        2021, 'classified',
        '{"noradId":9003,"inclination":98.25,"raan":120.2,"meanMotion":14.81,"meanAnomaly":22.0}'::jsonb,
        '{"apogeeKm":551,"perigeeKm":541}'::jsonb
      )
  `);
  await harness.db.execute(sql`
    INSERT INTO amateur_track (
      source_id, observed_at, candidate_norad_id, citation_url, raw_excerpt, resolved_satellite_id
    ) VALUES
      (1, now() - interval '2 days', 9001, 'https://example/diff/1', 'catalog dropout', 1)
  `);
}

describe("ReflexionRepository", () => {
  it("finds the target satellite and returns null for unknown NORAD ids", async () => {
    expect(await repo.findTarget(9001)).toMatchObject({
      id: "1",
      name: "TARGET-1",
      operator_country: "US Space Force",
      platform_name: "SIGINT",
      inc: 98.2,
      raan: 120,
      mm: 14.8,
    });
    expect(await repo.findTarget(9999)).toBeNull();
  });

  it("surfaces coplane peers, belt counts, and military lineage peers", async () => {
    const coplane = await repo.findStrictCoplane(
      9001,
      { inc: 98.2, raan: 120, mm: 14.8, ma: 20 },
      1,
      1,
      1,
    );
    expect(coplane.map((row) => row.name)).toEqual([
      "USA TOPAZ",
      "COPLANE-PEER",
    ]);

    const belt = await repo.findInclinationBelt(9001, 98.2, 1);
    expect(belt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ country: "US Space Force", n: "1" }),
        expect.objectContaining({ country: "France", n: "1" }),
      ]),
    );

    const milPeers = await repo.findMilLineagePeers(9001, 98.2, 1);
    expect(milPeers.map((row) => row.name)).toEqual(["USA TOPAZ"]);
  });

  it("lists opacity candidates and persists opacity scores", async () => {
    const rows = await repo.listOpacityCandidates({ limit: 10 });
    expect(rows[0]).toMatchObject({
      satelliteId: 1,
      name: "TARGET-1",
      noradId: 9001,
      operatorCountry: "US Space Force",
      orbitRegime: "LEO",
      payloadUndisclosed: true,
      operatorSensitive: true,
      amateurObservationsCount: 1,
      catalogDropoutCount: 1,
    });

    await repo.writeOpacityScore(1, 0.731);
    const updated = await harness.db.execute<{ opacity_score: string }>(sql`
      SELECT opacity_score::text
      FROM satellite
      WHERE id = 1
    `);
    expect(updated.rows[0]?.opacity_score).toBe("0.731");
  });
});

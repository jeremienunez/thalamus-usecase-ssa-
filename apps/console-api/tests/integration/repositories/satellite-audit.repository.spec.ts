import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SatelliteAuditRepository } from "../../../src/repositories/satellite-audit.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SatelliteAuditRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SatelliteAuditRepository(harness.db);
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
    INSERT INTO operator_country (id, name, slug, orbit_regime_id) VALUES
      (1, 'France', 'france', 1),
      (2, 'USA', 'usa', 2)
  `);
  await harness.db.execute(sql`
    INSERT INTO operator (id, name, slug) VALUES
      (1, 'CNES', 'cnes')
  `);
  await harness.db.execute(sql`
    INSERT INTO platform_class (id, name) VALUES
      (1, 'earth_observation')
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite (
      id, name, slug, norad_id, operator_id, operator_country_id, platform_class_id,
      launch_year, mass_kg, telemetry_summary, classification_tier, mission_age,
      is_experimental, rating
    ) VALUES
      (
        1, 'Nominal Sat', 'nominal-sat', 9101, 1, 1, 1,
        2024, 1200,
        '{"meanMotion":"15.2","inclination":"97.4","eccentricity":"0.001"}'::jsonb,
        'tier-1', 1.2, false, 0.6
      ),
      (
        2, 'Incomplete Sat', 'incomplete-sat', 9102, NULL, 1, NULL,
        NULL, NULL,
        NULL,
        NULL, NULL, false, NULL
      ),
      (
        3, 'EO Heavy', 'eo-heavy', 9103, 1, 2, 1,
        2022, 6200,
        '{"meanMotion":"1.0"}'::jsonb,
        'tier-2', 3.0, false, 0.7
      ),
      (
        4, 'Temporal Oddity', 'temporal-oddity', 9104, 1, 2, 1,
        1985, 900,
        '{"meanMotion":"1.0"}'::jsonb,
        'tier-2', 2.0, false, 0.7
      ),
      (
        5, 'Experimental Ace', 'experimental-ace', 9105, 1, 2, 1,
        2023, 700,
        '{"meanMotion":"1.0"}'::jsonb,
        'tier-2', 1.0, true, 0.95
      )
  `);
  await harness.db.execute(sql`
    INSERT INTO tle_history (
      satellite_id, norad_id, epoch, mean_motion, eccentricity, inclination_deg,
      raan, arg_of_perigee, mean_anomaly, bstar
    ) VALUES
      (1, 9101, '2026-04-21T00:00:00Z', 15.2, 0.001, 97.4, 10, 20, 30, 0.0001),
      (1, 9101, '2026-04-20T00:00:00Z', 15.1, 0.001, 97.3, 9, 19, 29, 0.0002)
  `);
  await harness.db.execute(sql`
    INSERT INTO source (id, name, slug, kind, url, category) VALUES
      (1, 'Orbital News', 'orbital-news', 'rss', 'https://example.test/rss', 'NEWS')
  `);
  await harness.db.execute(sql`
    INSERT INTO source_item (
      source_id, external_id, title, abstract, url, published_at, fetched_at
    ) VALUES (
      1,
      'apogee-1',
      'Apogee drift reported for Nominal Sat',
      'Orbit raise under review',
      'https://example.test/apogee',
      now() - interval '1 day',
      now()
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO space_weather_forecast (
      epoch, f107, ap_index, kp_index, sunspot_number, issued_at, source
    ) VALUES
      (now() + interval '1 day', 130, 12, 3, 50, now() - interval '2 hours', 'noaa'),
      (now() + interval '1 day', 140, 15, 4, 55, now() - interval '1 hour', 'noaa')
  `);
}

describe("SatelliteAuditRepository", () => {
  it("audits data completeness by regime with flagged counts", async () => {
    const rows = await repo.auditDataCompleteness({
      orbitRegime: "Low Earth Orbit",
      limit: 5,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        regimeName: "Low Earth Orbit",
        satellitesInRegime: 2,
        missingMass: 1,
        missingLaunchYear: 1,
        missingOperator: 1,
        missingPlatformClass: 1,
        missingTelemetrySummary: 1,
        flaggedCount: 1,
      }),
    ]);
  });

  it("flags classification anomalies across the seeded edge cases", async () => {
    const rows = await repo.auditClassification({ limit: 10 });

    expect(rows.map((row) => row.flag)).toEqual([
      "eo_mass_outlier",
      "experimental_high_rating",
      "missing_tier",
      "temporal_impossible",
    ]);
    expect(rows.map((row) => row.satelliteName)).toEqual([
      "EO Heavy",
      "Experimental Ace",
      "Incomplete Sat",
      "Temporal Oddity",
    ]);
  });

  it("combines tle history, catalog, weather, and news into apogee history", async () => {
    const rows = await repo.listApogeeHistory({
      noradId: 9101,
      limit: 5,
    });

    expect(rows.map((row) => row.kind)).toEqual([
      "tle_history",
      "tle_history",
      "satellite",
      "weather",
      "news",
    ]);
    expect(rows[0]).toMatchObject({
      noradId: 9101,
      meanMotion: 15.2,
    });
    expect(rows[2]).toMatchObject({
      title: "Nominal Sat",
      meanMotion: 15.2,
    });
    expect(rows[3]).toMatchObject({
      weatherSource: "noaa",
      f107: 140,
    });
    expect(rows[4]).toMatchObject({
      title: "Apogee drift reported for Nominal Sat",
    });
  });
});

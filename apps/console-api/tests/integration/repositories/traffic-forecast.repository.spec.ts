import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TrafficForecastRepository } from "../../../src/repositories/traffic-forecast.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: TrafficForecastRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new TrafficForecastRepository(harness.db);
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
    INSERT INTO orbit_regime (id, name, altitude_band, baselines) VALUES
      (1, 'Low Earth Orbit', '160-2000km', '{"launches":{"mean":3}}'::jsonb),
      (2, 'Geostationary Orbit', '35786km', '{"launches":{"mean":1}}'::jsonb)
  `);
  await harness.db.execute(sql`
    INSERT INTO operator_country (id, name, slug, orbit_regime_id) VALUES
      (1, 'France', 'france', 1),
      (2, 'USA', 'usa', 2)
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite (
      id, name, slug, norad_id, operator_country_id, launch_year, mission_age, telemetry_summary
    ) VALUES
      (1, 'Traffic Alpha', 'traffic-alpha', 9301, 1, 2024, 1.0, '{"regime":"leo"}'::jsonb),
      (2, 'Traffic Geo', 'traffic-geo', 9302, 2, 2020, 4.0, '{"regime":"geo"}'::jsonb)
  `);
  await harness.db.execute(sql`
    INSERT INTO source (id, name, slug, kind, url, category) VALUES
      (1, 'Traffic News', 'traffic-news', 'rss', 'https://example.test/rss', 'NEWS'),
      (2, 'Debris Papers', 'debris-papers', 'arxiv', 'https://example.test/arxiv', 'SCIENCE')
  `);
  await harness.db.execute(sql`
    INSERT INTO source_item (
      source_id, external_id, title, abstract, url, published_at, fetched_at, authors
    ) VALUES
      (
        1, 'traffic-1',
        'Orbital traffic congestion rising in LEO',
        'Close approach activity continues',
        'https://example.test/traffic',
        now() - interval '1 day',
        now(),
        ARRAY['Reporter']
      ),
      (
        1, 'debris-news-1',
        'Debris breakup raises Kessler concerns',
        'Fragmentation event under review',
        'https://example.test/debris-news',
        now() - interval '2 days',
        now(),
        ARRAY['Reporter']
      ),
      (
        2, 'paper-1',
        'Debris fragmentation under a Kessler regime',
        'kessler cascade analysis',
        'https://example.test/paper',
        now() - interval '3 days',
        now(),
        ARRAY['Analyst']
      )
  `);
  await harness.db.execute(sql`
    INSERT INTO space_weather_forecast (
      epoch, f107, ap_index, kp_index, sunspot_number, issued_at, source
    ) VALUES (
      now() + interval '1 day',
      132,
      11,
      3,
      44,
      now(),
      'noaa'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO fragmentation_event (
      parent_norad_id, parent_name, parent_operator_country, date_utc, regime_name,
      fragments_cataloged, parent_mass_kg, event_type, cause, source_url, source
    ) VALUES (
      43000,
      'Fragment Parent',
      'France',
      now() - interval '10 days',
      'LEO',
      24,
      900,
      'breakup',
      'battery',
      'https://example.test/fragment',
      'curated'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO launch (
      year, name, vehicle, external_launch_id, operator_name, operator_country,
      pad_name, pad_location, planned_net, planned_window_start, planned_window_end,
      status, orbit_name, mission_name, mission_description, rideshare
    ) VALUES (
      2026,
      'Launch Alpha',
      'Falcon 9',
      'launch-alpha',
      'SpaceX',
      'USA',
      'SLC-40',
      'Florida',
      now() + interval '7 days',
      now() + interval '7 days',
      now() + interval '7 days' + interval '1 hour',
      'go',
      'LEO',
      'Mission Alpha',
      'Primary rideshare launch',
      true
    )
  `);
}

describe("TrafficForecastRepository", () => {
  it("analyzes orbital traffic with density + news branches", async () => {
    const rows = await repo.analyzeOrbitalTraffic({
      regimeId: 1,
      windowDays: 30,
      limit: 10,
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "density",
          regimeName: "Low Earth Orbit",
          satelliteCount: 1,
          branchFilterApplied: true,
        }),
        expect.objectContaining({
          kind: "news",
          title: "Orbital traffic congestion rising in LEO",
          branchFilterApplied: false,
        }),
      ]),
    );
  });

  it("forecasts debris across density, paper, news, weather, and fragmentation branches", async () => {
    const rows = await repo.forecastDebris({ regimeId: 1, limit: 20 });
    const kinds = rows.map((row) => row.kind);

    expect(kinds).toEqual(
      expect.arrayContaining([
        "density",
        "paper",
        "news",
        "weather",
        "fragmentation",
      ]),
    );
    expect(rows.find((row) => row.kind === "fragmentation")).toMatchObject({
      fragmentParentName: "Fragment Parent",
      fragmentParentCountry: "France",
      fragmentsCataloged: 24,
      branchFilterApplied: true,
    });
  });

  it("lists launch manifest rows and leaves launch epoch weather empty", async () => {
    const rows = await repo.listLaunchManifest({ horizonDays: 30, limit: 10 });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "db",
          title: "Launch Alpha",
          vehicle: "Falcon 9",
          missionName: "Mission Alpha",
        }),
      ]),
    );
    expect(await repo.getLaunchEpochWeather({ limit: 5 })).toEqual([]);
  });
});

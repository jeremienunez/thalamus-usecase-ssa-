import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SpaceWeatherRepository } from "../../../src/repositories/space-weather.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SpaceWeatherRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SpaceWeatherRepository(harness.db);
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
    INSERT INTO space_weather_forecast (
      id, source, epoch, f107, ap_index, kp_index, sunspot_number, issued_at
    ) VALUES
      (1, 'noaa-swpc-27do', now() + interval '1 day', 120, 11, 3, null, now() - interval '2 hours'),
      (2, 'noaa-swpc-27do', now() + interval '1 day', 125, 12, 4, null, now() - interval '1 hour'),
      (3, 'gfz-kp', now() + interval '2 days', null, null, 5, null, now() - interval '3 hours'),
      (4, 'sidc-eisn', now() + interval '8 days', null, null, null, 99, now() - interval '1 hour')
  `);
}

describe("SpaceWeatherRepository", () => {
  it("returns the latest row per source and epoch within the horizon", async () => {
    const rows = await repo.listLatestForecast(3, 10);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source: "gfz-kp",
      kpIndex: 5,
    });
    expect(rows[1]).toMatchObject({
      source: "noaa-swpc-27do",
      f107: 125,
      apIndex: 12,
      kpIndex: 4,
    });
  });

  it("counts rows overall and by source", async () => {
    expect(await repo.countRows()).toBe(4);
    expect(await repo.countBySource()).toEqual({
      "noaa-swpc-27do": 2,
      "gfz-kp": 1,
      "sidc-eisn": 1,
    });
  });

  it("returns no forecast rows when the horizon excludes the data", async () => {
    await harness.reset();
    expect(await repo.listLatestForecast(1, 10)).toEqual([]);
    expect(await repo.countRows()).toBe(0);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { orbitRegime, operatorCountry, satellite } from "@interview/db-schema";

import { TleHistoryRepository } from "../../../src/repositories/tle-history.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: TleHistoryRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new TleHistoryRepository(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await seedFixtures();
});

afterAll(async () => {
  if (harness) await harness.close();
});

async function seedFixtures(): Promise<void> {
  await harness.db.insert(orbitRegime).values({
    id: 1n,
    name: "Low Earth Orbit",
    altitudeBand: "160-2000km",
  });
  await harness.db.insert(operatorCountry).values({
    id: 1n,
    name: "France",
    slug: "france",
    orbitRegimeId: 1n,
  });
  await harness.db.insert(satellite).values({
    id: 1n,
    name: "History sat",
    slug: "history-sat",
    noradId: 9010,
    operatorCountryId: 1n,
    launchYear: 2024,
  });
}

describe("TleHistoryRepository", () => {
  it("upserts rows idempotently and counts stored history", async () => {
    const inserted = await repo.upsertMany([
      {
        satelliteId: 1n,
        noradId: 9010,
        epoch: new Date("2026-04-01T00:00:00Z"),
        meanMotion: 15.1,
        eccentricity: 0.001,
        inclinationDeg: 97.4,
        raan: 10,
        argOfPerigee: 20,
        meanAnomaly: 30,
        bstar: 0.0001,
      },
      {
        satelliteId: 1n,
        noradId: 9010,
        epoch: new Date("2026-04-02T00:00:00Z"),
        meanMotion: 15.2,
        eccentricity: 0.002,
        inclinationDeg: 97.5,
        raan: 11,
        argOfPerigee: 21,
        meanAnomaly: 31,
        bstar: 0.0002,
      },
    ]);

    expect(inserted).toBe(2);
    expect(
      await repo.upsertMany([
        {
          satelliteId: 1n,
          noradId: 9010,
          epoch: new Date("2026-04-02T00:00:00Z"),
          meanMotion: 15.2,
          eccentricity: 0.002,
          inclinationDeg: 97.5,
          raan: 11,
          argOfPerigee: 21,
          meanAnomaly: 31,
          bstar: 0.0002,
        },
      ]),
    ).toBe(0);
    expect(await repo.countRows()).toBe(2);
  });

  it("lists recent snapshots by satellite and NORAD newest-first", async () => {
    await repo.upsertMany([
      {
        satelliteId: 1n,
        noradId: 9010,
        epoch: new Date("2026-04-01T00:00:00Z"),
        meanMotion: 15.1,
        eccentricity: 0.001,
        inclinationDeg: 97.4,
        raan: 10,
        argOfPerigee: 20,
        meanAnomaly: 30,
        bstar: 0.0001,
      },
      {
        satelliteId: 1n,
        noradId: 9010,
        epoch: new Date("2026-04-03T00:00:00Z"),
        meanMotion: 15.3,
        eccentricity: 0.003,
        inclinationDeg: 97.6,
        raan: 12,
        argOfPerigee: 22,
        meanAnomaly: 32,
        bstar: 0.0003,
      },
    ]);

    const bySatellite = await repo.listRecentForSatellite(1n, 5);
    const byNorad = await repo.listRecentForNorad(9010, 5);

    expect(bySatellite.map((row) => row.epoch)).toEqual([
      "2026-04-03 00:00:00+00",
      "2026-04-01 00:00:00+00",
    ]);
    expect(byNorad.map((row) => row.meanMotion)).toEqual([15.3, 15.1]);
  });
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PayloadRepository } from "../../../src/repositories/payload.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: PayloadRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new PayloadRepository(harness.db);
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
    INSERT INTO satellite (id, name, slug, norad_id)
    VALUES (1, 'Carrier', 'carrier', 5001)
  `);
  await harness.db.execute(sql`
    INSERT INTO payload (id, name, slug, photo_url)
    VALUES
      (10, 'Camera', 'camera', 'https://img/camera'),
      (11, 'AIS Receiver', 'ais-receiver', null)
  `);
  await harness.db.execute(sql`
    INSERT INTO satellite_payload (satellite_id, payload_id, role, mass_kg, power_w)
    VALUES
      (1, 10, 'primary', 120.5, 80.0),
      (1, 11, 'secondary', 15.0, 12.0)
  `);
}

describe("PayloadRepository", () => {
  it("lists payload rows for a satellite ordered by payload name", async () => {
    const rows = await repo.listBySatelliteId(1n);

    expect(rows).toEqual([
      {
        id: "11",
        name: "AIS Receiver",
        slug: "ais-receiver",
        role: "secondary",
        mass_kg: 15,
        power_w: 12,
        photo_url: null,
      },
      {
        id: "10",
        name: "Camera",
        slug: "camera",
        role: "primary",
        mass_kg: 120.5,
        power_w: 80,
        photo_url: "https://img/camera",
      },
    ]);
  });

  it("returns an empty list when the satellite has no payload manifest", async () => {
    expect(await repo.listBySatelliteId(999n)).toEqual([]);
  });
});

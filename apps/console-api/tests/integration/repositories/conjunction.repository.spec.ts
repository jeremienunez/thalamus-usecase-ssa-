import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import * as schema from "@interview/db-schema";
import { ConjunctionRepository } from "../../../src/repositories/conjunction.repository";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let repo: ConjunctionRepository;

async function recreateTempTables(): Promise<void> {
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.conjunction_event"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.satellite"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.satellite_bus"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.operator"));

  await db.execute(sql.raw(`
    CREATE TEMP TABLE operator (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE satellite_bus (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE satellite (
      id bigint PRIMARY KEY,
      name text NOT NULL,
      norad_id integer,
      operator_id bigint,
      satellite_bus_id bigint,
      telemetry_summary jsonb
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE conjunction_event (
      id bigint PRIMARY KEY,
      primary_satellite_id bigint NOT NULL,
      secondary_satellite_id bigint NOT NULL,
      epoch timestamptz NOT NULL,
      min_range_km real NOT NULL,
      relative_velocity_kmps real,
      probability_of_collision real,
      primary_sigma_km real,
      secondary_sigma_km real,
      combined_sigma_km real,
      hard_body_radius_m real,
      pc_method text,
      computed_at timestamptz NOT NULL
    )
  `));
}

async function seedFixtures(): Promise<void> {
  await db.execute(sql`
    INSERT INTO operator (id, name)
    VALUES
      (${1n}, ${"NASA"}),
      (${2n}, ${"SpaceX"})
  `);
  await db.execute(sql`
    INSERT INTO satellite_bus (id, name)
    VALUES (${10n}, ${"A2100"})
  `);
  await db.execute(sql`
    INSERT INTO satellite (id, name, norad_id, operator_id, satellite_bus_id, telemetry_summary)
    VALUES
      (${100n}, ${"ISS"}, ${25544}, ${1n}, ${10n}, ${JSON.stringify({ regime: "LEO", tleEpoch: "2026-04-20T12:00:00.000Z" })}::jsonb),
      (${200n}, ${"STARLINK-1000"}, ${50001}, ${2n}, ${null}, ${JSON.stringify({ regime: "LEO" })}::jsonb)
  `);
  await db.execute(sql.raw(`
    INSERT INTO conjunction_event (
      id,
      primary_satellite_id,
      secondary_satellite_id,
      epoch,
      min_range_km,
      relative_velocity_kmps,
      probability_of_collision,
      primary_sigma_km,
      secondary_sigma_km,
      combined_sigma_km,
      hard_body_radius_m,
      pc_method,
      computed_at
    ) VALUES (
      7,
      100,
      200,
      now() + interval '1 hour',
      1.5,
      12.3,
      1e-5,
      0.2,
      0.3,
      0.36,
      15,
      'foster-gaussian',
      now()
    )
  `));
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle<typeof schema>(pool, { schema });
  repo = new ConjunctionRepository(db);
});

beforeEach(async () => {
  await recreateTempTables();
  await seedFixtures();
});

afterAll(async () => {
  await pool.end();
});

describe("ConjunctionRepository", () => {
  it("screens by the satellite norad_id column even when telemetry_summary lacks noradId", async () => {
    const rows = await repo.screenConjunctions({
      windowHours: 2,
      primaryNoradId: 25544,
      limit: 10,
    });

    expect(rows).toEqual([
      {
        conjunctionId: 7,
        primarySatellite: "ISS",
        primaryNoradId: 25544,
        secondarySatellite: "STARLINK-1000",
        secondaryNoradId: 50001,
        epoch: expect.any(String),
        minRangeKm: 1.5,
        relativeVelocityKmps: 12.3,
        probabilityOfCollision: 1e-5,
        primarySigmaKm: 0.2,
        secondarySigmaKm: 0.3,
        combinedSigmaKm: 0.36,
        hardBodyRadiusM: 15,
        pcMethod: "foster-gaussian",
        operatorPrimary: "NASA",
        operatorSecondary: "SpaceX",
        regime: "LEO",
        primaryTleEpoch: "2026-04-20T12:00:00.000Z",
      },
    ]);
  });

  it("returns norad ids from the satellite columns on findByIdWithSatellites", async () => {
    const row = await repo.findByIdWithSatellites(7n);

    expect(row).toMatchObject({
      id: 7n,
      primary: {
        id: 100n,
        name: "ISS",
        noradId: 25544,
        busName: "A2100",
        operatorId: 1n,
      },
      secondary: {
        id: 200n,
        name: "STARLINK-1000",
        noradId: 50001,
        busName: null,
        operatorId: 2n,
      },
    });
  });

  it("excludes conjunctions with zero range or missing relative velocity from list and screen reads", async () => {
    await db.execute(sql.raw(`
      INSERT INTO conjunction_event (
        id,
        primary_satellite_id,
        secondary_satellite_id,
        epoch,
        min_range_km,
        relative_velocity_kmps,
        probability_of_collision,
        primary_sigma_km,
        secondary_sigma_km,
        combined_sigma_km,
        hard_body_radius_m,
        pc_method,
        computed_at
      ) VALUES (
        8,
        100,
        200,
        now() + interval '2 hour',
        0,
        NULL,
        4e-4,
        0.2,
        0.3,
        0.36,
        15,
        'foster-gaussian',
        now()
      )
    `));

    const listed = await repo.listAboveMinPc(0);
    expect(listed.map((row) => Number(row.id))).toEqual([7]);

    const screened = await repo.screenConjunctions({
      windowHours: 3,
      primaryNoradId: 25544,
      limit: 10,
    });
    expect(screened.map((row) => row.conjunctionId)).toEqual([7]);
  });
});

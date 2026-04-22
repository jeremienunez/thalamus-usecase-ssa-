import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import * as schema from "@interview/db-schema";
import { SatelliteRepository } from "../../../src/repositories/satellite.repository";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

type Fixtures = {
  geoExplicitId: bigint;
  geoDerivedId: bigint;
  leoDerivedId: bigint;
  noRaanId: bigint;
  massNullCandidateId: bigint;
  targetId: bigint;
  nearId: bigint;
  midId: bigint;
  farId: bigint;
  nullLifetimeId: bigint;
};

let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let repo: SatelliteRepository;
let fixtures: Fixtures;

function halfvecLiteral(head: number[]): string {
  const values = Array.from({ length: 2048 }, (_, index) => head[index] ?? 0);
  return `[${values.join(",")}]`;
}

async function recreateTempTables(): Promise<void> {
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.tle_history"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.satellite"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.satellite_bus"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.platform_class"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.operator_country"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.operator"));

  await db.execute(sql.raw(`
    CREATE TEMP TABLE operator (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE operator_country (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE platform_class (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE satellite_bus (
      id bigint PRIMARY KEY,
      name text NOT NULL,
      generation text
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE satellite (
      id bigint PRIMARY KEY,
      name text NOT NULL,
      norad_id integer,
      operator_id bigint,
      operator_country_id bigint,
      platform_class_id bigint,
      satellite_bus_id bigint,
      launch_year integer,
      mass_kg real,
      classification_tier text,
      opacity_score numeric(4, 3),
      telemetry_summary jsonb,
      object_class text,
      photo_url text,
      g_short_description text,
      g_description text,
      power_draw real,
      thermal_margin real,
      pointing_accuracy real,
      attitude_rate real,
      link_budget real,
      data_rate real,
      payload_duty real,
      eclipse_ratio real,
      solar_array_health real,
      battery_depth_of_discharge real,
      propellant_remaining real,
      radiation_dose real,
      debris_proximity real,
      mission_age real,
      lifetime real,
      power real,
      variant text,
      embedding halfvec(2048)
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE tle_history (
      satellite_id bigint NOT NULL,
      ingested_at timestamptz NOT NULL,
      mean_motion real NOT NULL
    )
  `));
}

async function insertSatellite(args: {
  id: bigint;
  name: string;
  noradId: number;
  telemetrySummary: Record<string, unknown> | null;
  objectClass?: string;
  massKg?: number | null;
  lifetime?: number | null;
  embeddingHead?: number[] | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO satellite (
      id,
      name,
      norad_id,
      operator_id,
      operator_country_id,
      launch_year,
      mass_kg,
      telemetry_summary,
      object_class,
      lifetime
    ) VALUES (
      ${args.id},
      ${args.name},
      ${args.noradId},
      ${1n},
      ${1n},
      ${2024},
      ${args.massKg ?? null},
      ${JSON.stringify(args.telemetrySummary)}::jsonb,
      ${args.objectClass ?? "payload"},
      ${args.lifetime ?? null}
    )
  `);

  if (args.embeddingHead) {
    const literal = halfvecLiteral(args.embeddingHead);
    await db.execute(sql`
      UPDATE satellite
      SET embedding = ${literal}::halfvec(2048)
      WHERE id = ${args.id}
    `);
  }
}

async function seedFixtures(): Promise<Fixtures> {
  await db.execute(sql`
    INSERT INTO operator_country (id, name) VALUES (${1n}, ${"Test Country"})
  `);
  await db.execute(sql`
    INSERT INTO operator (id, name) VALUES (${1n}, ${"Test Operator"})
  `);

  const ids = {
    geoExplicitId: 1n,
    geoDerivedId: 2n,
    leoDerivedId: 3n,
    noRaanId: 4n,
    massNullCandidateId: 5n,
    targetId: 8n,
    nearId: 9n,
    midId: 10n,
    farId: 11n,
    nullLifetimeId: 12n,
  } satisfies Fixtures;

  await insertSatellite({
    id: ids.geoExplicitId,
    name: "geo-explicit",
    noradId: 1001,
    telemetrySummary: { raan: 10, regime: "GEO", meanMotion: 15 },
    massKg: 120,
    lifetime: null,
    embeddingHead: [0.5, 0.5],
  });
  await insertSatellite({
    id: ids.geoDerivedId,
    name: "geo-derived",
    noradId: 1002,
    telemetrySummary: { raan: 20, meanMotion: 1.0 },
    massKg: 130,
    lifetime: null,
    embeddingHead: [0.45, 0.55],
  });
  await insertSatellite({
    id: ids.leoDerivedId,
    name: "leo-derived",
    noradId: 1003,
    telemetrySummary: { raan: 30, meanMotion: 15 },
    massKg: 140,
    lifetime: null,
    embeddingHead: [0.4, 0.6],
  });
  await insertSatellite({
    id: ids.noRaanId,
    name: "missing-raan",
    noradId: 1004,
    telemetrySummary: { meanMotion: 15 },
    massKg: 150,
    lifetime: null,
    embeddingHead: [0.35, 0.65],
  });
  await insertSatellite({
    id: ids.massNullCandidateId,
    name: "mass-null-candidate",
    noradId: 1005,
    telemetrySummary: { raan: 40, meanMotion: 14 },
    massKg: null,
    lifetime: null,
    embeddingHead: [0.3, 0.7],
  });
  await insertSatellite({
    id: 6n,
    name: "mass-null-no-embedding",
    noradId: 1006,
    telemetrySummary: { raan: 50, meanMotion: 14 },
    massKg: null,
    lifetime: null,
  });
  await insertSatellite({
    id: 7n,
    name: "mass-null-rocket-stage",
    noradId: 1007,
    telemetrySummary: { raan: 60, meanMotion: 14 },
    objectClass: "rocket_stage",
    massKg: null,
    lifetime: null,
    embeddingHead: [0.25, 0.75],
  });
  await insertSatellite({
    id: ids.targetId,
    name: "knn-target",
    noradId: 1008,
    telemetrySummary: { raan: 70, meanMotion: 14 },
    massKg: 160,
    lifetime: 10,
    embeddingHead: [1, 0],
  });
  await insertSatellite({
    id: ids.nearId,
    name: "knn-near",
    noradId: 1009,
    telemetrySummary: { raan: 80, meanMotion: 14 },
    massKg: 170,
    lifetime: 11,
    embeddingHead: [0.99, 0.01],
  });
  await insertSatellite({
    id: ids.midId,
    name: "knn-mid",
    noradId: 1010,
    telemetrySummary: { raan: 90, meanMotion: 14 },
    massKg: 180,
    lifetime: 20,
    embeddingHead: [0.8, 0.2],
  });
  await insertSatellite({
    id: ids.farId,
    name: "knn-far",
    noradId: 1011,
    telemetrySummary: { raan: 100, meanMotion: 14 },
    massKg: 190,
    lifetime: 30,
    embeddingHead: [0.2, 0.98],
  });
  await insertSatellite({
    id: ids.nullLifetimeId,
    name: "knn-null-lifetime",
    noradId: 1012,
    telemetrySummary: { raan: 110, meanMotion: 14 },
    massKg: 200,
    lifetime: null,
    embeddingHead: [0.999, 0.001],
  });

  await db.execute(sql`
    INSERT INTO tle_history (satellite_id, ingested_at, mean_motion)
    VALUES
      (${ids.geoExplicitId}, ${"2026-04-20T01:00:00.000Z"}::timestamptz, ${14.8}),
      (${ids.geoExplicitId}, ${"2026-04-21T01:00:00.000Z"}::timestamptz, ${15.0})
  `);

  return ids;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle<typeof schema>(pool, { schema });
  await db.execute(sql.raw("CREATE EXTENSION IF NOT EXISTS vector"));
  repo = new SatelliteRepository(db);
});

beforeEach(async () => {
  await recreateTempTables();
  fixtures = await seedFixtures();
});

afterAll(async () => {
  await pool.end();
});

describe("SatelliteRepository", () => {
  it("listWithOrbital returns only rows that carry raan and computes latest TLE drift", async () => {
    const rows = await repo.listWithOrbital(20);
    const geoExplicit = rows.find((row) => row.id === String(fixtures.geoExplicitId));

    expect(rows.map((row) => row.id)).toEqual([
      "1",
      "2",
      "3",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
    expect(rows.map((row) => row.id)).not.toContain(String(fixtures.noRaanId));
    expect(
      new Date(String(geoExplicit?.last_tle_ingested_at)).toISOString(),
    ).toBe("2026-04-21T01:00:00.000Z");
    expect(geoExplicit?.mean_motion_drift).toBeCloseTo(0.2, 5);
  });

  it("listWithOrbital applies limit after the orbital filter and ordering", async () => {
    const rows = await repo.listWithOrbital(2);

    expect(rows.map((row) => row.id)).toEqual(["1", "2"]);
  });

  it("listWithOrbital('GEO') prefers telemetry_summary.regime over the meanMotion fallback", async () => {
    const rows = await repo.listWithOrbital(10, "GEO");

    expect(rows.map((row) => row.id)).toEqual([
      String(fixtures.geoExplicitId),
      String(fixtures.geoDerivedId),
    ]);
  });

  it("listWithOrbital('LEO') derives the regime from meanMotion when no explicit regime is present", async () => {
    const rows = await repo.listWithOrbital(20, "LEO");

    expect(rows.map((row) => row.id)).toContain(String(fixtures.leoDerivedId));
    expect(rows.map((row) => row.id)).not.toContain(String(fixtures.geoExplicitId));
  });

  it("listNullCandidatesForField rejects fields outside the whitelist", async () => {
    await expect(repo.listNullCandidatesForField("password", 5)).rejects.toThrow(
      /unsupported field/,
    );
  });

  it("listNullCandidatesForField returns only payloads with embedding and a NULL target field", async () => {
    const rows = await repo.listNullCandidatesForField("mass_kg", 10);

    expect(rows).toEqual([
      {
        id: String(fixtures.massNullCandidateId),
        name: "mass-null-candidate",
        noradId: 1005,
      },
    ]);
  });

  it("knnNeighboursForField excludes the target, drops NULL values and orders by cosine distance", async () => {
    const rows = await repo.knnNeighboursForField(fixtures.targetId, "lifetime", 3);

    expect(rows.map((row) => row.id)).toEqual([
      String(fixtures.nearId),
      String(fixtures.midId),
      String(fixtures.farId),
    ]);
    expect(rows.map((row) => row.value)).toEqual([11, 20, 30]);
    expect(rows.map((row) => row.id)).not.toContain(String(fixtures.targetId));
    expect(rows.map((row) => row.id)).not.toContain(
      String(fixtures.nullLifetimeId),
    );
    expect(rows[0]!.cos_distance).toBeLessThan(rows[1]!.cos_distance);
    expect(rows[1]!.cos_distance).toBeLessThan(rows[2]!.cos_distance);
  });
});

import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import * as schema from "@interview/db-schema";
import { KgRepository } from "../../../src/repositories/kg.repository";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let repo: KgRepository;

async function recreateTempTables(): Promise<void> {
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.research_edge"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.orbit_regime"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.operator"));

  await db.execute(sql.raw(`
    CREATE TEMP TABLE operator (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE orbit_regime (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE research_edge (
      id bigint PRIMARY KEY,
      finding_id bigint NOT NULL,
      entity_type text NOT NULL,
      entity_id bigint NOT NULL,
      relation text NOT NULL
    )
  `));
}

async function seedFixtures(): Promise<void> {
  await db.execute(sql`
    INSERT INTO operator (id, name)
    VALUES (${2n}, ${"ESA"})
  `);
  await db.execute(sql`
    INSERT INTO orbit_regime (id, name)
    VALUES (${7n}, ${"LEO"})
  `);
  await db.execute(sql`
    INSERT INTO research_edge (id, finding_id, entity_type, entity_id, relation)
    VALUES
      (${10n}, ${4n}, ${"satellite"}, ${3n}, ${"about"}),
      (${11n}, ${4n}, ${"operator"}, ${2n}, ${"owned_by"}),
      (${12n}, ${4n}, ${"orbit_regime"}, ${7n}, ${"in_regime"}),
      (${13n}, ${5n}, ${"operator"}, ${999n}, ${"owned_by"})
  `);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema }) as unknown as NodePgDatabase<typeof schema>;
  repo = new KgRepository(db);
});

beforeEach(async () => {
  await recreateTempTables();
  await seedFixtures();
});

afterAll(async () => {
  await pool.end();
});

describe("KgRepository.listRecentEdges", () => {
  it("resolves operator and orbit regime ids to display names for graph edges", async () => {
    const rows = await repo.listRecentEdges(10);

    expect(rows).toEqual([
      {
        id: "13",
        finding_id: "5",
        entity_type: "operator",
        entity_id: "999",
        relation: "owned_by",
      },
      {
        id: "12",
        finding_id: "4",
        entity_type: "orbit_regime",
        entity_id: "LEO",
        relation: "in_regime",
      },
      {
        id: "11",
        finding_id: "4",
        entity_type: "operator",
        entity_id: "ESA",
        relation: "owned_by",
      },
      {
        id: "10",
        finding_id: "4",
        entity_type: "satellite",
        entity_id: "3",
        relation: "about",
      },
    ]);
  });
});

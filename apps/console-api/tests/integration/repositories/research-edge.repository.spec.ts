import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import * as schema from "@interview/db-schema";
import { ResearchEdgeRepository } from "../../../src/repositories/research-edge.repository";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

let pool: Pool;
let db: NodePgDatabase<typeof schema>;
let repo: ResearchEdgeRepository;

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
      finding_id bigint NOT NULL,
      entity_type text NOT NULL,
      entity_id bigint NOT NULL
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
    INSERT INTO research_edge (finding_id, entity_type, entity_id)
    VALUES
      (${42n}, ${"satellite"}, ${123n}),
      (${42n}, ${"operator"}, ${2n}),
      (${42n}, ${"orbit_regime"}, ${7n}),
      (${43n}, ${"operator"}, ${999n})
  `);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle(pool, { schema }) as unknown as NodePgDatabase<typeof schema>;
  repo = new ResearchEdgeRepository(db);
});

beforeEach(async () => {
  await recreateTempTables();
  await seedFixtures();
});

afterAll(async () => {
  await pool.end();
});

describe("ResearchEdgeRepository", () => {
  it("findByFindingIds resolves operator and orbit regime ids to display names", async () => {
    const rows = (await repo.findByFindingIds([42n])).sort((a, b) =>
      `${a.entity_type}:${a.entity_id}`.localeCompare(
        `${b.entity_type}:${b.entity_id}`,
      ),
    );

    expect(rows).toEqual([
      { finding_id: "42", entity_type: "operator", entity_id: "ESA" },
      { finding_id: "42", entity_type: "orbit_regime", entity_id: "LEO" },
      { finding_id: "42", entity_type: "satellite", entity_id: "123" },
    ]);
  });

  it("findByFindingId keeps the raw id when the name lookup is missing", async () => {
    const rows = await repo.findByFindingId(43n, 10);

    expect(rows).toEqual([
      { entity_type: "operator", entity_id: "999" },
    ]);
  });
});

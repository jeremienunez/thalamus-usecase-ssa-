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
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.research_finding"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.satellite"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.operator_country"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.payload"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.satellite_bus"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.launch"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.orbit_regime"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS pg_temp.operator"));

  await db.execute(sql.raw(`
    CREATE TEMP TABLE research_finding (
      id bigint PRIMARY KEY,
      title text NOT NULL,
      summary text NOT NULL,
      confidence real NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE satellite (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
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
    CREATE TEMP TABLE orbit_regime (
      id bigint PRIMARY KEY,
      name text NOT NULL
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE payload (
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
    CREATE TEMP TABLE launch (
      id bigint PRIMARY KEY,
      name text,
      mission_name text
    )
  `));
  await db.execute(sql.raw(`
    CREATE TEMP TABLE research_edge (
      id bigint PRIMARY KEY,
      finding_id bigint NOT NULL,
      relation text NOT NULL,
      entity_type text NOT NULL,
      entity_id bigint NOT NULL,
      created_at timestamptz NOT NULL
    )
  `));
}

async function seedFixtures(): Promise<void> {
  await db.execute(sql`
    INSERT INTO research_finding (id, title, summary, confidence)
    VALUES
      (${42n}, ${"Collision risk for SAT-123"}, ${"Potential conjunction around SAT-123 in LEO"}, ${0.91}),
      (${43n}, ${"Unknown operator link"}, ${"Operator entity missing from catalog"}, ${0.55}),
      (${44n}, ${"Payload attribution drift"}, ${"Payload and bus mapping need review"}, ${0.81}),
      (${45n}, ${"Launch chain watch"}, ${"Mission tie should stay readable"}, ${0.73})
  `);
  await db.execute(sql`
    INSERT INTO satellite (id, name)
    VALUES (${123n}, ${"SAT-123"})
  `);
  await db.execute(sql`
    INSERT INTO operator (id, name)
    VALUES (${2n}, ${"ESA"})
  `);
  await db.execute(sql`
    INSERT INTO operator_country (id, name)
    VALUES (${6n}, ${"France"})
  `);
  await db.execute(sql`
    INSERT INTO orbit_regime (id, name)
    VALUES (${7n}, ${"LEO"})
  `);
  await db.execute(sql`
    INSERT INTO payload (id, name)
    VALUES (${55n}, ${"Payload Alpha"})
  `);
  await db.execute(sql`
    INSERT INTO satellite_bus (id, name)
    VALUES (${77n}, ${"Bus-77"})
  `);
  await db.execute(sql`
    INSERT INTO launch (id, name, mission_name)
    VALUES (${88n}, ${"Transporter"}, ${"Transporter-42"})
  `);
  await db.execute(sql`
    INSERT INTO research_edge (id, finding_id, relation, entity_type, entity_id, created_at)
    VALUES
      (${1n}, ${42n}, ${"affects"}, ${"satellite"}, ${123n}, ${new Date("2026-04-22T08:00:00Z")}),
      (${2n}, ${42n}, ${"supports"}, ${"operator"}, ${2n}, ${new Date("2026-04-22T08:01:00Z")}),
      (${3n}, ${42n}, ${"about"}, ${"orbit_regime"}, ${7n}, ${new Date("2026-04-22T08:02:00Z")}),
      (${4n}, ${43n}, ${"contradicts"}, ${"operator"}, ${999n}, ${new Date("2026-04-22T08:03:00Z")}),
      (${5n}, ${44n}, ${"about"}, ${"payload"}, ${55n}, ${new Date("2026-04-22T08:04:00Z")}),
      (${6n}, ${44n}, ${"supports"}, ${"operator_country"}, ${6n}, ${new Date("2026-04-22T08:05:00Z")}),
      (${7n}, ${44n}, ${"similar_to"}, ${"satellite_bus"}, ${77n}, ${new Date("2026-04-22T08:06:00Z")}),
      (${8n}, ${45n}, ${"about"}, ${"launch"}, ${88n}, ${new Date("2026-04-22T08:07:00Z")}),
      (${9n}, ${45n}, ${"supports"}, ${"finding"}, ${42n}, ${new Date("2026-04-22T08:08:00Z")})
  `);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  db = drizzle<typeof schema>(pool, { schema });
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

  it("findEdgesByFindingId returns a human-readable finding -> entity view", async () => {
    const rows = (await repo.findEdgesByFindingId(44n, 10)).sort((a, b) =>
      a.to_name.localeCompare(b.to_name),
    );

    expect(rows).toEqual([
      {
        from_name: "Payload attribution drift",
        relation: "similar_to",
        to_name: "Bus-77",
      },
      {
        from_name: "Payload attribution drift",
        relation: "supports",
        to_name: "France",
      },
      {
        from_name: "Payload attribution drift",
        relation: "about",
        to_name: "Payload Alpha",
      },
    ]);
  });

  it("findNeighbourhood searches finding titles and resolved target labels, using finding confidence", async () => {
    const byTarget = await repo.findNeighbourhood("Transporter", 10);
    expect(byTarget).toEqual([
      {
        from_name: "Launch chain watch",
        from_type: "finding",
        relation: "about",
        to_name: "Transporter-42",
        to_type: "launch",
        confidence: 0.73,
      },
    ]);

    const bySource = await repo.findNeighbourhood("Collision risk", 10);
    expect(bySource).toEqual([
      {
        from_name: "Collision risk for SAT-123",
        from_type: "finding",
        relation: "about",
        to_name: "LEO",
        to_type: "orbit_regime",
        confidence: 0.91,
      },
      {
        from_name: "Collision risk for SAT-123",
        from_type: "finding",
        relation: "supports",
        to_name: "ESA",
        to_type: "operator",
        confidence: 0.91,
      },
      {
        from_name: "Collision risk for SAT-123",
        from_type: "finding",
        relation: "affects",
        to_name: "SAT-123",
        to_type: "satellite",
        confidence: 0.91,
      },
    ]);
  });
});

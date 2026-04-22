import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import {
  E2E_DATABASE_URL,
  cleanupKnnFixture,
  KNN_NEIGHBOUR_IDS,
  KNN_TARGET_ID,
  seedKnnFixture,
} from "./helpers/db-fixtures";

/**
 * Integration — enrichment findings emitted by KNN-propagation.
 *
 * Given: a running console-api + a populated catalogue with payload embeddings.
 * When:  we POST knn-propagate with dryRun=false on a small batch
 * Then:  the endpoint (a) writes to satellite, (b) writes to sweep_audit,
 *        (c) emits a research_finding for each fill, (d) attaches research_edge
 *        rows linking the filled sat to its KNN neighbours (similar_to).
 *
 * This is the bridge that lets Thalamus cortices reason on KNN fills.
 */

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";
let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await seedKnnFixture(client);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await cleanupKnnFixture(client);
  } finally {
    client.release();
    await pool.end();
  }
});

describe("KNN fill emits research_finding + research_edge", () => {
  it("writes a finding per fill with similar_to edges to the neighbours", async () => {
    const client = await pool.connect();
    try {
      const beforeRes = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM research_finding
         WHERE cortex = 'data_auditor' AND title LIKE 'KNN fill%'`,
      );
      const before = Number(beforeRes.rows[0]!.n);

      // Fire a short propagation to generate at least one fill.
      const res = await fetch(`${BASE}/api/sweep/mission/knn-propagate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          field: "mass_kg",
          k: 3,
          minSim: 0.85,
          limit: 10_000,
          dryRun: false,
        }),
      });
      const body = (await res.json()) as { filled: number; attempted: number };
      expect(body.attempted).toBeGreaterThan(0);
      expect(body.filled).toBeGreaterThan(0);

      const afterRes = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM research_finding
         WHERE cortex = 'data_auditor' AND title LIKE 'KNN fill%'`,
      );
      const after = Number(afterRes.rows[0]!.n);
      expect(after - before).toBe(body.filled);

      const latest = await client.query<{ id: string; title: string; summary: string }>(
        `SELECT id::text AS id, title::text, summary::text
         FROM research_finding
         WHERE cortex = 'data_auditor'
           AND title = 'KNN fill · mass_kg=100'
           AND summary LIKE $1
         ORDER BY id DESC LIMIT 1`,
        [`%#${String(KNN_TARGET_ID)}%`],
      );
      expect(latest.rows[0]).toBeDefined();
      expect(latest.rows[0]!.summary).toContain(`#${String(KNN_TARGET_ID)}`);
      const fid = latest.rows[0]!.id;

      const edges = await client.query<{
        relation: string;
        entity_type: string;
        entity_id: string;
      }>(
        `SELECT relation::text, entity_type::text, entity_id::text
         FROM research_edge
         WHERE finding_id = $1::bigint`,
        [fid],
      );

      const aboutIds = edges.rows
        .filter((edge) => edge.relation === "about")
        .map((edge) => edge.entity_id);
      expect(aboutIds).toContain(String(KNN_TARGET_ID));

      const similarIds = edges.rows
        .filter((edge) => edge.relation === "similar_to")
        .map((edge) => edge.entity_id);
      for (const neighbourId of KNN_NEIGHBOUR_IDS) {
        expect(similarIds).toContain(String(neighbourId));
      }
    } finally {
      client.release();
    }
  });
});

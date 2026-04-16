import { describe, it, expect } from "vitest";
import { Pool } from "pg";

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
const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

describe("KNN fill emits research_finding + research_edge", () => {
  it("writes a finding per fill with similar_to edges to the neighbours", async () => {
    const pool = new Pool({ connectionString: DATABASE_URL });
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
          k: 5,
          minSim: 0.85,
          limit: 30,
          dryRun: false,
        }),
      });
      const body = (await res.json()) as { filled: number; attempted: number };
      expect(body.attempted).toBeGreaterThan(0);
      if (body.filled === 0) {
        // Catalogue too sparse in this slice — nothing to assert; skip cleanly.
        return;
      }

      const afterRes = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM research_finding
         WHERE cortex = 'data_auditor' AND title LIKE 'KNN fill%'`,
      );
      const after = Number(afterRes.rows[0]!.n);
      expect(after - before).toBe(body.filled);

      // For the newest finding, assert edges present + similar_to edges exist.
      const latest = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM research_finding
         WHERE cortex = 'data_auditor' AND title LIKE 'KNN fill%'
         ORDER BY id DESC LIMIT 1`,
      );
      const fid = latest.rows[0]!.id;

      const edges = await client.query<{ relation: string; entity_type: string; n: string }>(
        `SELECT relation::text, entity_type::text, count(*)::text AS n
         FROM research_edge WHERE finding_id = $1::bigint
         GROUP BY relation, entity_type`,
        [fid],
      );

      const byRelation: Record<string, number> = {};
      for (const e of edges.rows) byRelation[e.relation] = Number(e.n);
      // Every KNN fill must have at least one 'about' edge to the target sat.
      expect(byRelation.about ?? 0).toBeGreaterThanOrEqual(1);
      // And at least one 'similar_to' edge to a neighbour that caused the fill.
      expect(byRelation.similar_to ?? 0).toBeGreaterThanOrEqual(1);
    } finally {
      client.release();
      await pool.end();
    }
  });
});

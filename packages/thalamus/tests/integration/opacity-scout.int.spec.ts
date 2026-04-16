/**
 * OpacityScout — live Postgres integration test.
 *
 * Connects to the docker-compose `thalamus-postgres:5433` instance (assumed
 * healthy; the test is skipped gracefully when unreachable so CI without
 * docker does not explode).
 *
 * Seeds an isolated mini-fixture inside a transaction that rolls back at the
 * end of the test — zero residue on the shared DB.
 *
 * Covers:
 *   - `listOpacityCandidates` surfaces a satellite with undisclosed payload
 *   - the `operatorSensitive` branch fires on a flagged country
 *   - an amateur_track observation rolls up into `amateurObservationsCount`
 *   - `writeOpacityScore` persists the score + timestamp on satellite
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@interview/db-schema";
import {
  listOpacityCandidates,
  writeOpacityScore,
  computeOpacityScore,
} from "../../src/cortices/queries/opacity-scout";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

let client: Client | null = null;
let db: NodePgDatabase<typeof schema> | null = null;
let dbReachable = false;

beforeAll(async () => {
  try {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    db = drizzle(client, { schema });
    // Sanity — if the amateur_track table is missing the push didn't run.
    await db.execute(sql`SELECT 1 FROM amateur_track LIMIT 1`);
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (client) await client.end();
});

describe("OpacityScout — live Postgres fusion", () => {
  it("surfaces an undisclosed-payload satellite with amateur observation", async () => {
    if (!dbReachable || !db) {
      console.warn("Skipping — Postgres unreachable on", DATABASE_URL);
      return;
    }

    // Wrap the whole scenario in a transaction we rollback — zero residue.
    await db.transaction(async (tx) => {
      // Seed — pick slugs unlikely to collide with existing data.
      const stamp = Date.now().toString(36);
      const operatorCountrySlug = `opacity-it-usff-${stamp}`;
      const satelliteSlug = `opacity-it-sat-${stamp}`;
      const payloadSlug = `opacity-it-undisclosed-${stamp}`;
      const sourceSlug = `opacity-it-source-${stamp}`;

      const opcRes = await tx.execute<{ id: string }>(sql`
        INSERT INTO operator_country (name, slug)
        VALUES ('USSF', ${operatorCountrySlug})
        RETURNING id
      `);
      const opc = opcRes.rows[0];

      const satRes = await tx.execute<{ id: string }>(sql`
        INSERT INTO satellite (name, slug, operator_country_id)
        VALUES (${`OpacityIT ${stamp}`}, ${satelliteSlug}, ${opc.id}::bigint)
        RETURNING id
      `);
      const sat = satRes.rows[0];

      const plRes = await tx.execute<{ id: string }>(sql`
        INSERT INTO payload (name, slug)
        VALUES ('undisclosed reconnaissance payload', ${payloadSlug})
        RETURNING id
      `);
      const pl = plRes.rows[0];

      await tx.execute(sql`
        INSERT INTO satellite_payload (satellite_id, payload_id)
        VALUES (${sat.id}::bigint, ${pl.id}::bigint)
      `);

      const srcRes = await tx.execute<{ id: string }>(sql`
        INSERT INTO source (name, slug, kind, url)
        VALUES ('Opacity IT source', ${sourceSlug}, 'osint', 'https://example.invalid/')
        RETURNING id
      `);
      const src = srcRes.rows[0];

      await tx.execute(sql`
        INSERT INTO amateur_track (
          source_id, observed_at, candidate_norad_id, citation_url, resolved_satellite_id
        )
        VALUES (
          ${src.id}::bigint,
          now(),
          99999,
          'https://satobs.org/seesat/Apr-2026/msg00001.html',
          ${sat.id}::bigint
        )
      `);

      // Act
      const rows = await listOpacityCandidates(
        tx as unknown as NodePgDatabase<typeof schema>,
        { limit: 500 },
      );

      const hit = rows.find((r) => r.name === `OpacityIT ${stamp}`);
      expect(hit, "expected the seeded satellite to surface").toBeDefined();
      if (!hit) return;

      expect(hit.payloadUndisclosed).toBe(true);
      expect(hit.operatorSensitive).toBe(true);
      expect(hit.amateurObservationsCount).toBeGreaterThanOrEqual(1);
      expect(hit.operatorCountry).toBe("USSF");

      // Compute + writeback
      const score = computeOpacityScore({
        payloadUndisclosed: hit.payloadUndisclosed,
        operatorSensitive: hit.operatorSensitive,
        amateurObservationsCount: hit.amateurObservationsCount,
        catalogDropoutCount: hit.catalogDropoutCount,
        distinctAmateurSources: hit.distinctAmateurSources,
      });
      expect(score).toBeGreaterThanOrEqual(0.7);

      await writeOpacityScore(
        tx as unknown as NodePgDatabase<typeof schema>,
        hit.satelliteId,
        score,
      );

      const afterRes = await tx.execute<{
        opacity_score: string | null;
        opacity_computed_at: Date | null;
      }>(sql`
        SELECT opacity_score, opacity_computed_at
        FROM satellite WHERE id = ${hit.satelliteId}::bigint
      `);
      const after = afterRes.rows[0];
      expect(after.opacity_score).not.toBeNull();
      expect(Number(after.opacity_score)).toBeCloseTo(score, 3);
      expect(after.opacity_computed_at).not.toBeNull();

      // Rollback the whole transaction (throw an error Vitest ignores).
      throw new TransactionRollback();
    }).catch((err) => {
      if (!(err instanceof TransactionRollback)) throw err;
    });
  });
});

class TransactionRollback extends Error {
  constructor() {
    super("intentional rollback");
  }
}

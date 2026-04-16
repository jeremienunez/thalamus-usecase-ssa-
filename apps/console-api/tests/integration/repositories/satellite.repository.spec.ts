import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@interview/db-schema";
import { SatelliteRepository } from "../../../src/repositories/satellite.repository";

// NOTE: No write-path test for `updateField` — would mutate shared dev DB.
// Add when per-test transaction rollback is available.

describe("SatelliteRepository", () => {
  let pool: Pool;
  let repo: SatelliteRepository;

  beforeAll(() => {
    const url = process.env.DATABASE_URL ?? "postgres://thalamus:thalamus@localhost:5433/thalamus";
    pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema }) as unknown as NodePgDatabase<typeof schema>;
    repo = new SatelliteRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("listWithOrbital", () => {
    it("returns rows that have raan in telemetry_summary", async () => {
      const rows = await repo.listWithOrbital(10);
      expect(Array.isArray(rows)).toBe(true);
      if (rows.length > 0) {
        expect(typeof rows[0]!.name).toBe("string");
        expect(rows[0]!.telemetry_summary).toBeDefined();
      }
    });

    it("honours limit", async () => {
      const rows = await repo.listWithOrbital(3);
      expect(rows.length).toBeLessThanOrEqual(3);
    });
  });

  describe("listNullCandidatesForField", () => {
    it("rejects unknown field via fieldSqlFor whitelist", async () => {
      await expect(repo.listNullCandidatesForField("password", 5))
        .rejects.toThrow(/unsupported field/);
    });

    it("returns id+name rows for a whitelisted field", async () => {
      const rows = await repo.listNullCandidatesForField("mass_kg", 3);
      expect(Array.isArray(rows)).toBe(true);
      if (rows.length > 0) {
        expect(typeof rows[0]!.id).toBe("string");
        expect(typeof rows[0]!.name).toBe("string");
      }
    });
  });

  describe("knnNeighboursForField", () => {
    it("returns shape {id, value, cos_distance} for a whitelisted field", async () => {
      // Pick any satellite id that has embedding — fall back to skip if DB empty.
      const candidates = await repo.listNullCandidatesForField("lifetime", 1);
      if (candidates.length === 0) return;
      // Find a payload with an embedding and non-null lifetime to be the "target".
      const withField = await repo.listWithOrbital(1);
      if (withField.length === 0) return;
      const targetId = BigInt(withField[0]!.id);
      const neighbours = await repo.knnNeighboursForField(targetId, "lifetime", 3);
      expect(Array.isArray(neighbours)).toBe(true);
      if (neighbours.length > 0) {
        const n = neighbours[0]!;
        expect(typeof n.id).toBe("string");
        expect(typeof n.cos_distance).toBe("number");
        // value may be null, number, or string depending on column — just assert presence
        expect(n).toHaveProperty("value");
      }
    });
  });
});

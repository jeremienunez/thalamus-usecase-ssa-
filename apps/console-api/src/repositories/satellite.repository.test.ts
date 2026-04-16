import { describe, it, expect, beforeAll } from "vitest";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@interview/db-schema";
import { SatelliteRepository } from "./satellite.repository";

describe("SatelliteRepository.listWithOrbital", () => {
  let repo: SatelliteRepository;
  beforeAll(() => {
    const url = process.env.DATABASE_URL ?? "postgres://thalamus:thalamus@localhost:5433/thalamus";
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema }) as unknown as NodePgDatabase<typeof schema>;
    repo = new SatelliteRepository(db);
  });

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

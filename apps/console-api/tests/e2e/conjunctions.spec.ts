import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { ConjunctionViewSchema } from "@interview/shared";
import {
  cleanupConjunctionFixture,
  E2E_DATABASE_URL,
  CONJUNCTION_PRIMARY_NORAD_ID,
  CONJUNCTION_SECONDARY_NORAD_ID,
  seedConjunctionFixture,
} from "./helpers/db-fixtures";

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";
let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await seedConjunctionFixture(client);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await cleanupConjunctionFixture(client);
  } finally {
    client.release();
    await pool.end();
  }
});

describe("GET /api/conjunctions*", () => {
  it("returns items matching ConjunctionView schema", async () => {
    const res = await fetch(`${BASE}/api/conjunctions?minPc=0`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { items: unknown[]; count: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.count).toBe(body.items.length);
    const parsed = ConjunctionViewSchema.safeParse(body.items[0]);
    expect(
      parsed.success,
      JSON.stringify(parsed.error?.issues ?? {}, null, 2),
    ).toBe(true);
  });

  it("applies the minPc filter and can return an empty set", async () => {
    const res = await fetch(`${BASE}/api/conjunctions?minPc=0.001`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { items: unknown[]; count: number };
    expect(body).toEqual({ items: [], count: 0 });
  });

  it("screens by NORAD and respects the limit query", async () => {
    const res = await fetch(
      `${BASE}/api/conjunctions/screen?primaryNoradId=${CONJUNCTION_PRIMARY_NORAD_ID}&limit=1`,
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      items: Array<{
        primaryNoradId: number;
        secondaryNoradId: number;
        primarySatellite: string;
        secondarySatellite: string;
      }>;
      count: number;
    };
    expect(body.count).toBe(1);
    expect(body.items).toEqual([
      expect.objectContaining({
        primaryNoradId: CONJUNCTION_PRIMARY_NORAD_ID,
        secondaryNoradId: CONJUNCTION_SECONDARY_NORAD_ID,
        primarySatellite: "ISS",
        secondarySatellite: "STARLINK-1000",
      }),
    ]);
  });

  it("returns no screened conjunctions when the NORAD filter misses", async () => {
    const res = await fetch(
      `${BASE}/api/conjunctions/screen?primaryNoradId=99999999&limit=5`,
    );
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { items: unknown[]; count: number };
    expect(body).toEqual({ items: [], count: 0 });
  });
});

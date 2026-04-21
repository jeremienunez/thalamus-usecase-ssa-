import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { Pool } from "pg";
import { ConjunctionViewSchema } from "@interview/shared";
import {
  E2E_DATABASE_URL,
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
  await pool.end();
});

describe("GET /api/conjunctions", () => {
  it("returns items matching ConjunctionView schema", async () => {
    const res = await fetch(`${BASE}/api/conjunctions?minPc=0`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { items: unknown[]; count: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    const parsed = ConjunctionViewSchema.safeParse(body.items[0]);
    expect(
      parsed.success,
      JSON.stringify(parsed.error?.issues ?? {}, null, 2),
    ).toBe(true);
  });
});

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EnrichmentCycleRepository } from "../../../src/repositories/enrichment-cycle.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: EnrichmentCycleRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
});

beforeEach(async () => {
  await harness.reset();
  repo = new EnrichmentCycleRepository(harness.db);
});

afterAll(async () => {
  if (harness) await harness.close();
});

describe("EnrichmentCycleRepository", () => {
  it("creates the catalog-enrichment cycle lazily and caches its id", async () => {
    const first = await repo.getOrCreate();
    const second = await repo.getOrCreate();

    expect(second).toBe(first);

    const rows = await harness.db.execute<{ id: string; trigger_source: string }>(sql`
      SELECT id::text, trigger_source
      FROM research_cycle
      WHERE trigger_source = 'catalog-enrichment'
    `);
    expect(rows.rows).toEqual([
      { id: first.toString(), trigger_source: "catalog-enrichment" },
    ]);
  });

  it("reuses the most recent existing catalog-enrichment cycle", async () => {
    await harness.db.execute(sql`
      INSERT INTO research_cycle (id, trigger_type, trigger_source, status, findings_count)
      VALUES
        (40, 'system', 'catalog-enrichment', 'running', 0),
        (41, 'system', 'catalog-enrichment', 'completed', 1)
    `);

    const id = await repo.getOrCreate();

    expect(id).toBe(41n);
  });
});

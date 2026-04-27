import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FindingRepository } from "../../../src/repositories/finding.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: FindingRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new FindingRepository(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await seedFixtures();
});

afterAll(async () => {
  if (harness) await harness.close();
});

async function seedFixtures(): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO research_cycle (id, trigger_type, trigger_source, status, findings_count)
    VALUES
      (1, 'system', 'seed-primary', 'running', 2),
      (2, 'user', 'seed-secondary', 'completed', 1)
  `);

  await harness.db.execute(sql`
    INSERT INTO research_finding (
      id,
      research_cycle_id,
      cortex,
      finding_type,
      status,
      urgency,
      title,
      summary,
      evidence,
      reasoning,
      confidence,
      impact_score,
      created_at,
      updated_at
    ) VALUES
      (
        10,
        1,
        'orbital_analyst',
        'insight',
        'active',
        'medium',
        'Primary finding',
        'Primary summary',
        '[{"url":"https://alpha"}]'::jsonb,
        'primary reasoning',
        0.82,
        0.71,
        now() - interval '2 days',
        now() - interval '2 days'
      ),
      (
        11,
        1,
        'strategist',
        'alert',
        'archived',
        'high',
        'Archived finding',
        'Archived summary',
        '[{"url":"https://beta"}]'::jsonb,
        'archived reasoning',
        0.63,
        0.55,
        now() - interval '1 day',
        now() - interval '1 day'
      ),
      (
        12,
        2,
        'orbital_analyst',
        'trend',
        'invalidated',
        'low',
        'Secondary cycle finding',
        'Secondary summary',
        '[{"url":"https://gamma"}]'::jsonb,
        'secondary reasoning',
        0.41,
        0.20,
        now(),
        now()
      )
  `);
}

describe("FindingRepository", () => {
  it("lists findings with status and cortex filters", async () => {
    const active = await repo.list({ status: "active" });
    expect(active.map((row) => row.id)).toEqual(["10"]);

    const orbital = await repo.list({ cortex: "orbital_analyst" });
    expect(orbital.map((row) => row.id)).toEqual(["12", "10"]);
  });

  it("finds detail rows", async () => {
    const detail = await repo.findById(10n);
    expect(detail).toMatchObject({
      id: "10",
      title: "Primary finding",
      evidence: [{ url: "https://alpha" }],
    });
  });

  it("updates status for existing rows and returns false for missing ids", async () => {
    expect(await repo.updateStatus(10n, "archived")).toBe(true);
    expect((await repo.findById(10n))?.status).toBe("archived");
    expect(await repo.updateStatus(999n, "invalidated")).toBe(false);
  });
});

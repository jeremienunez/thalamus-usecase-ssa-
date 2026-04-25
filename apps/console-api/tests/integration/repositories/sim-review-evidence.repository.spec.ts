import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SimReviewEvidenceRepository } from "../../../src/repositories/sim-review-evidence.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SimReviewEvidenceRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SimReviewEvidenceRepository(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await seedFixture();
});

afterAll(async () => {
  if (harness) await harness.close();
});

async function seedFixture(): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO sim_swarm (
      id, kind, title, base_seed, perturbations, size, config, status
    ) VALUES (
      1,
      'uc3_conjunction',
      'Evidence swarm',
      '{"target": 7}'::jsonb,
      '[{"kind":"noop"}]'::jsonb,
      1,
      '{"llmMode":"fixtures","quorumPct":0.8,"perFishTimeoutMs":1000,"fishConcurrency":1,"nanoModel":"stub","seed":42}'::jsonb,
      'done'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_run (
      id, swarm_id, fish_index, kind, seed_applied, perturbation, config, status
    ) VALUES (
      10,
      1,
      0,
      'uc3_conjunction',
      '{"target": 7}'::jsonb,
      '{"kind":"noop"}'::jsonb,
      '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":42,"nanoModel":"stub"}'::jsonb,
      'done'
    )
  `);
}

describe("SimReviewEvidenceRepository", () => {
  it("persists and lists durable sim review evidence", async () => {
    const row = await repo.insert({
      swarmId: 1n,
      simRunId: 10n,
      scope: "fish",
      question: "Why did fish 0 maneuver?",
      answer: "Because its terminal action selected maneuver.",
      evidenceRefs: [{ kind: "sim_turn", id: "100" }],
      traceExcerpt: { fishIndex: 0, turns: [100] },
      createdBy: 1n,
    });

    expect(row).toMatchObject({
      swarmId: 1n,
      simRunId: 10n,
      scope: "fish",
      question: "Why did fish 0 maneuver?",
      answer: "Because its terminal action selected maneuver.",
      evidenceRefs: [{ kind: "sim_turn", id: "100" }],
      traceExcerpt: { fishIndex: 0, turns: [100] },
      createdBy: 1n,
      createdAt: expect.any(Date),
    });
    expect(typeof row.id).toBe("bigint");
    await expect(repo.listForSwarm(1n)).resolves.toEqual([row]);
  });
});

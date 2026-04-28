import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TemporalSeededRunRepository } from "../../../src/repositories/temporal-seeded-run.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: TemporalSeededRunRepository;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new TemporalSeededRunRepository(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await seedFixtures();
});

afterAll(async () => {
  if (harness) await harness.close();
});

describe("TemporalSeededRunRepository", () => {
  it("persists an idempotent audit link from temporal pattern to seeded sim run", async () => {
    const first = await repo.insert({
      patternId: 123n,
      simRunId: 10n,
      seedReason: "followup_seeded_by_temporal_pattern",
      sourceDomain: "simulation_seeded",
    });
    const second = await repo.insert({
      patternId: 123n,
      simRunId: 10n,
      seedReason: "followup_seeded_by_temporal_pattern",
      sourceDomain: "simulation_seeded",
    });

    expect(first).toMatchObject({
      patternId: 123n,
      simRunId: 10n,
      seedReason: "followup_seeded_by_temporal_pattern",
      sourceDomain: "simulation_seeded",
    });
    expect(second).toBeNull();

    const rows = await harness.db.execute<{
      pattern_id: string;
      sim_run_id: string;
      seed_reason: string;
      source_domain: string;
    }>(sql`
      SELECT pattern_id::text, sim_run_id::text, seed_reason, source_domain
      FROM temporal_pattern_seeded_run
    `);
    expect(rows.rows).toEqual([
      {
        pattern_id: "123",
        sim_run_id: "10",
        seed_reason: "followup_seeded_by_temporal_pattern",
        source_domain: "simulation_seeded",
      },
    ]);
  });
});

async function seedFixtures(): Promise<void> {
  await harness.db.execute(sql`
    INSERT INTO temporal_learning_run (
      id, pattern_version, source_domain, input_snapshot_hash, status
    ) VALUES (
      77,
      'temporal-v0.2.0',
      'production',
      'seeded-run-test',
      'completed'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO temporal_pattern_hypothesis (
      id,
      pattern_hash,
      pattern_version,
      status,
      source_domain,
      terminal_status,
      pattern_window_ms,
      pattern_score,
      support_count,
      negative_support_count,
      created_from_learning_run_id
    ) VALUES (
      123,
      'pattern-hash-123',
      'temporal-v0.2.0',
      'accepted',
      'production',
      'timeout',
      900000,
      0.9,
      8,
      1,
      77
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_swarm (
      id, kind, title, base_seed, perturbations, size, config, status
    ) VALUES (
      1,
      'uc_pc_estimator',
      'THL seeded swarm',
      '{"subjectIds":[7],"seeded_by_pattern_id":"123"}'::jsonb,
      '[{"kind":"noop"}]'::jsonb,
      1,
      '{"llmMode":"fixtures","quorumPct":0.8,"perFishTimeoutMs":1000,"fishConcurrency":1,"nanoModel":"stub","seed":42}'::jsonb,
      'running'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_run (
      id, swarm_id, fish_index, kind, seed_applied, perturbation, config, status
    ) VALUES (
      10,
      1,
      0,
      'uc_pc_estimator',
      '{"subjectIds":[7],"seeded_by_pattern_id":"123"}'::jsonb,
      '{"kind":"noop"}'::jsonb,
      '{"turnsPerDay":1,"maxTurns":8,"llmMode":"fixtures","seed":42,"nanoModel":"stub"}'::jsonb,
      'pending'
    )
  `);
}

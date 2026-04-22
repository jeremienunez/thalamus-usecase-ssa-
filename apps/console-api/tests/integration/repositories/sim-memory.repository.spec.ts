import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SimMemoryRepository } from "../../../src/repositories/sim-memory.repository";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

let harness: IntegrationHarness;
let repo: SimMemoryRepository;

function vec(head: number[]): number[] {
  return Array.from({ length: 2048 }, (_, index) => head[index] ?? 0);
}

beforeAll(async () => {
  harness = await createIntegrationHarness();
  repo = new SimMemoryRepository(harness.db);
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
    INSERT INTO sim_swarm (
      id, kind, title, base_seed, perturbations, size, config, status
    ) VALUES (
      1,
      'telemetry',
      'Memory swarm',
      '{"target": 1}'::jsonb,
      '[{"kind":"baseline"}]'::jsonb,
      2,
      '{"llmMode":"fixtures","quorumPct":60,"perFishTimeoutMs":1000,"fishConcurrency":1,"nanoModel":"stub","seed":42}'::jsonb,
      'running'
    )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_run (
      id, swarm_id, fish_index, kind, seed_applied, perturbation, config, status
    ) VALUES
      (
        10, 1, 0, 'telemetry',
        '{"target": 1}'::jsonb,
        '{"kind":"baseline"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":42,"nanoModel":"stub"}'::jsonb,
        'running'
      ),
      (
        11, 1, 1, 'telemetry',
        '{"target": 1}'::jsonb,
        '{"kind":"offset"}'::jsonb,
        '{"turnsPerDay":4,"maxTurns":8,"llmMode":"fixtures","seed":43,"nanoModel":"stub"}'::jsonb,
        'running'
      )
  `);
  await harness.db.execute(sql`
    INSERT INTO sim_agent (
      id, sim_run_id, operator_id, agent_index, persona, goals, constraints
    ) VALUES
      (100, 10, NULL, 1, 'lead', '[]'::jsonb, '{}'::jsonb),
      (101, 11, NULL, 1, 'other', '[]'::jsonb, '{}'::jsonb)
  `);
}

describe("SimMemoryRepository", () => {
  it("writes batches in order and returns recent rows newest-first", async () => {
    expect(await repo.writeMany([])).toEqual([]);

    const ids = await repo.writeMany([
      {
        simRunId: 10n,
        agentId: 100n,
        turnIndex: 1,
        kind: "observation",
        content: "first observation",
        embedding: vec([1, 0]),
      },
      {
        simRunId: 10n,
        agentId: 100n,
        turnIndex: 2,
        kind: "self_action",
        content: "second action",
        embedding: vec([0.8, 0.2]),
      },
    ]);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeLessThan(ids[1]);

    const rows = await repo.topKByRecency({
      simRunId: 10n,
      agentId: 100n,
      k: 5,
    });
    expect(rows.map((row) => row.content)).toEqual([
      "second action",
      "first observation",
    ]);
  });

  it("searches vector matches within the run+agent scope only", async () => {
    await repo.writeMany([
      {
        simRunId: 10n,
        agentId: 100n,
        turnIndex: 1,
        kind: "observation",
        content: "alpha",
        embedding: vec([1, 0]),
      },
      {
        simRunId: 10n,
        agentId: 100n,
        turnIndex: 2,
        kind: "belief",
        content: "beta",
        embedding: vec([0.4, 0.6]),
      },
      {
        simRunId: 11n,
        agentId: 101n,
        turnIndex: 1,
        kind: "observation",
        content: "foreign scope",
        embedding: vec([1, 0]),
      },
    ]);

    const rows = await repo.topKByVector({
      simRunId: 10n,
      agentId: 100n,
      vec: vec([1, 0]),
      k: 5,
    });

    expect(rows.map((row) => row.content)).toEqual(["alpha", "beta"]);
    expect(rows[0]?.score).toBeGreaterThan(rows[1]?.score ?? 0);
  });
});
